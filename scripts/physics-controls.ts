/**
 * physics-controls — the printed, never-gated panels R2 (docs/specs/s5.md §4.4, §5.2, §5.4, §5.8; S5-D3, S5-D23, S5-D65; O13).
 *
 *   bun scripts/physics-controls.ts           compute the three panels, print them and write docs/physics/controls.json
 *   bun scripts/physics-controls.ts --print   the same, without writing (the nightly job's mode: it prints whether the
 *                                             committed file still holds)
 *
 * The panels:
 *  - NIM cross-harness: every H100 FP8 row of the NIM 1.8.0 page (vendor, backend unstated) that passes the protocol's
 *    filters, replayed through EngineV2 with the shipped H100 table's parameters, its mean TPOT against NIM's ITL;
 *  - the out-of-sample control: the frozen card form refitted on the MI325X and MI355X vLLM FP8 rows of the same snapshot
 *    (in the extract, never used for selection), replayed at their own token budget (protocol `controls`, 131,072), with
 *    the protocol's filters, split, grid and statistics; its LOO over the fit subset is G1's population;
 *  - the frozen-form report on any newer snapshot dropped into src/data/physics/points/ (an `inferencex-l70-<date>.json`
 *    later than the pinned one): the shipped table's predictions on it, and the form refitted on it.
 *
 * It never fails: an error is printed and the committed file is left as it is, and the exit code is 0 (the nightly job
 * neither fails nor files the nightly-failure issue). controls.json is committed and refreshed by the integrator at each
 * s5 integration (S5-D65); its `claimValues` reproduce the `phys.control.*` and `phys.nim.*` claims (verify:claims).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { claimNumber, getClaim } from '../src/data/claims/all'
import { hash32 } from '../src/lib/rng'
import { napkinSpec } from '../src/lib/world/physics/card'
import { errorStats, evaluateRow, linkGBsOf, makeFitRow, preparePoint, type ErrorStats } from '../src/lib/world/physics/fit'
import { predictTpot, replayPoint, type ReplaySettings } from '../src/lib/world/physics/replay'
import { PHYSICS_ROWS, PHYS_ID } from '../src/lib/world/physics/table'
import type { CardSpec, ChipShape, ModelShape } from '../src/lib/world/physics/types'
import { EXTRACT_PATH, NIM_SHA256, readExtract, readNim, sha256Hex, type NimRow, type PointRow } from './fetch-physics-points'
import { fitGrid, replayPointOf, replaySettings, seedOf, selectPoints, ttftIsl, type RowSelection } from './fit-physics'
import { protocolSha256, readProtocol, type Protocol, type ProtocolRow } from './physics-protocol'
import { CONTROLS_PATH, prettyJson } from './verify-physics'

export const CONTROLS_COMMAND = 'bun scripts/physics-controls.ts'

/** Units the control claims carry, to SI (the AMD pages print PFLOPs as well as TFLOPs). */
const UNIT_SCALE: Record<string, number> = { 'TB/s': 1e12, TFLOPS: 1e12, PFLOPS: 1e15, GB: 1e9, 'B params': 1e9, B: 1, 'bytes/token': 1 }

/** A numeric claim in SI units; throws on a unit it does not know. */
export function claimIn(id: string): number {
  const { unit } = getClaim(id)
  const scale = unit === undefined ? 1 : UNIT_SCALE[unit]
  if (scale === undefined) throw new Error(`claim ${id}: unit ${unit} has no SI scale here`)
  return claimNumber(id, scale)
}

const hasClaim = (id: string): boolean => {
  try {
    getClaim(id)
    return true
  } catch {
    return false
  }
}

const round = (x: number, per: number): number => Math.round(x * per) / per
const statsOf = (s: ErrorStats) => ({ n: s.n, mean: s.mean, p90: s.p90, max: s.max })

/* ------------------------------ NIM cross-harness ------------------------------ */

/** The NIM page's model names, by the architecture the card reads. */
export function nimFamily(model: string): '70b' | '8b' | null {
  if (/-70b-/i.test(model)) return '70b'
  if (/-8b-/i.test(model)) return '8b'
  return null
}

/** The group a NIM row is reported in (and its claim, `phys.nim.<key>.itl-mean`): 70B by TP, 8B by TP. */
export const nimGroup = (r: Pick<NimRow, 'model' | 'tp'>): string | null => {
  const f = nimFamily(r.model)
  return f === '70b' ? `h100-tp${r.tp}` : f === '8b' ? `8b-tp${r.tp}` : null
}

/** A model's card shape: 70B from the protocol's claims, 8B from the zoo's; FP8 weights (1 B per parameter) and FP8 KV. */
export function nimModel(protocol: Protocol, family: '70b' | '8b'): ModelShape {
  if (family === '70b') {
    const m = protocol.model
    return { params: claimIn(m.params), layers: claimIn(m.layers), hidden: claimIn(m.hidden), kvBytesPerToken: claimIn(m.kvBytesPerToken), weightBytes: claimIn('model.llama3-70b.weight-bytes-fp8') }
  }
  const params = claimIn('model.llama3-8b.params')
  // the claim is BF16 KV (2 B per element); the panel assumes FP8 KV (1 B), as the 70B rows run, so half of it
  return { params, layers: claimIn('model.llama3-8b.layers'), hidden: claimIn('model.llama3-8b.hidden-size'), kvBytesPerToken: claimIn('model.llama3-8b.kv-bytes-per-token') / 2, weightBytes: params }
}

export interface NimPoint {
  group: string
  model: string
  tp: number
  isl: number
  osl: number
  conc: number
  /** NIM's ITL and the engine's mean TPOT with the H100 table's parameters, ms */
  itlMs: number
  predMs: number
  error: number
}

export interface NimPanel {
  source: string
  sha256: string
  row: string
  settings: ReplaySettings
  assumptions: string[]
  dropped: { model: string; tp: number; isl: number; osl: number; conc: number; reason: string }[]
  groups: { key: string; n: number; mean: number; p90: number; max: number; bias: number }[]
  points: NimPoint[]
}

/** The NIM panel: every H100 FP8 row that passes the protocol's filters, through EngineV2 with the H100 table's card. */
export function nimPanel(protocol: Protocol): NimPanel {
  const nim = readNim()
  if (nim.sha256 !== NIM_SHA256) throw new Error(`the NIM extract records sha256 ${nim.sha256}, expected ${NIM_SHA256}`)
  const h100 = PHYSICS_ROWS.find((r) => r.key.startsWith('h100-'))
  if (!h100) throw new Error('the table has no H100 row')
  const base = replaySettings(protocol)
  // NIM's tables give one ISL and one OSL each, so the lengths are fixed (ratio 1); the budget and block are the harness's
  const settings: ReplaySettings = { ...base, rangeRatio: 1 }
  const dropped: NimPanel['dropped'] = []
  const points: NimPoint[] = []
  const rows = nim.rows.filter((r) => r.gpu === 'H100' && r.prec === 'fp8')
  for (const r of rows) {
    const group = nimGroup(r)
    const family = nimFamily(r.model)
    if (!group || !family) {
      dropped.push({ model: r.model, tp: r.tp, isl: r.isl, osl: r.osl, conc: r.conc, reason: 'not a Llama-3 70B or 8B row' })
      continue
    }
    const model = nimModel(protocol, family)
    const room = Math.floor((protocol.filters.gpuMemUtil * h100.spec.chip.hbmBytes * r.tp - model.weightBytes) / model.kvBytesPerToken)
    const reasons: string[] = []
    if (r.conc * (r.isl + r.osl) > room) reasons.push(`KV: ${r.conc} × (${r.isl} + ${r.osl}) > ${room}`)
    if (r.ttft >= protocol.filters.ttftMaxSeconds * 1e3) reasons.push(`TTFT: ${r.ttft} ms ≥ ${protocol.filters.ttftMaxSeconds} s`)
    if (reasons.length) {
      dropped.push({ model: r.model, tp: r.tp, isl: r.isl, osl: r.osl, conc: r.conc, reason: reasons.join('; ') })
      continue
    }
    const spec: CardSpec = { chip: h100.spec.chip, model, params: h100.spec.params }
    const seed = hash32(`nim:${r.model}:${r.tp}:${r.isl}/${r.osl}:${r.conc}`)
    const log = replayPoint(spec, { id: `nim ${r.model} TP ${r.tp} ${r.isl}/${r.osl} c ${r.conc}`, tp: r.tp, conc: r.conc, isl: r.isl, osl: r.osl, seed }, settings)
    const predMs = predictTpot(log, spec) * 1e3
    points.push({ group, model: r.model, tp: r.tp, isl: r.isl, osl: r.osl, conc: r.conc, itlMs: r.itl, predMs, error: predMs / r.itl - 1 })
  }
  const keys = [...new Set(points.map((p) => p.group))].sort()
  const groups = keys.map((key) => {
    const e = points.filter((p) => p.group === key).map((p) => p.error)
    const s = errorStats(e.map((x) => Math.abs(x)))
    let bias = 0
    for (const x of e) bias += x
    return { key, n: s.n, mean: s.mean, p90: s.p90, max: s.max, bias: bias / e.length }
  })
  return {
    source: nim.source,
    sha256: nim.sha256,
    row: h100.key,
    settings,
    assumptions: [
      `the card's parameters are the shipped ${h100.key} table's (fitted on InferenceX, vLLM 0.10.2); NIM's backend is unstated`,
      'lengths fixed at the table\'s ISL and OSL (range ratio 1); 10 requests per unit of concurrency, all at t = 0 (the replay of §5.3)',
      'FP8 weights at 1 B per parameter and FP8 KV at 1 B per element for every model (the 8B KV claim is BF16, so half of it)',
      'the protocol\'s filters: the KV rule with the H100 capacity claim, and median TTFT below 3 s',
    ],
    dropped,
    groups,
    points,
  }
}

/* ------------------------------ the MI325X / MI355X control ------------------------------ */

/** The peak claims a control row reads (O13): registered only when each quote was fetched by curl. */
export const controlClaims = (hardware: string) => ({ bw: `hw.${hardware}.hbm-bw`, peak: `hw.${hardware}.fp8-dense`, hbm: `hw.${hardware}.hbm-capacity` })

export interface ControlRow {
  hardware: string
  precision: string
  batchTokens: number
  claims: { bw: string; peak: string; hbm: string }
  /** why the row was not run, or null */
  skipped: string | null
  selected: number
  kept: number
  nFit: number
  nHeldOut: number
  dropped: { id: string; reasons: string[] }[]
  params: { etaMem: number; etaFlop: number; layerUs: number; seqUs: number; linkGBs: number | null; harnessMs: number } | null
  loo: { n: number; mean: number; p90: number; max: number } | null
  heldOut: { n: number; mean: number; p90: number; max: number } | null
  ttftLoo: { n: number; mean: number; p90: number; max: number } | null
  gates: Record<string, { ok: boolean; detail: string }> | null
  worst: { id: string; tp: number; conc: number; isl: number; osl: number; error: number; runUrl: string }[]
}

/** The frozen card form refitted on one control population with the protocol's procedure, at the control's budget. */
export function controlRow(protocol: Protocol, extract: readonly PointRow[], c: Protocol['controls'][number]): ControlRow {
  const claims = controlClaims(c.hardware)
  const empty: ControlRow = { hardware: c.hardware, precision: c.precision, batchTokens: c.batchTokens, claims, skipped: null, selected: 0, kept: 0, nFit: 0, nHeldOut: 0, dropped: [], params: null, loo: null, heldOut: null, ttftLoo: null, gates: null, worst: [] }
  const missing = Object.values(claims).filter((id) => !hasClaim(id))
  if (missing.length) return { ...empty, skipped: `no claim ${missing.join(', ')} (O13: registered only when its quote is fetched)` }
  const fp8 = protocol.rows.find((r) => r.precision === c.precision)
  if (!fp8) return { ...empty, skipped: `no protocol row at precision ${c.precision} to take the weight bytes from` }
  const tps = [...new Set(extract.filter((r) => r.hardware === c.hardware && r.precision === c.precision).map((r) => r.decode_tp))].sort((a, b) => a - b)
  const prow: ProtocolRow = { key: `${c.hardware}-vllm-${c.precision}`, hardware: c.hardware, precision: c.precision, fitTp: tps, boxTp: tps, ...claims, weightBytes: fp8.weightBytes }
  const [sel] = selectPoints({ ...protocol, rows: [prow] }, extract, claimIn) as RowSelection[]
  const chip: ChipShape = { bwBps: claimIn(claims.bw), peakFlops: claimIn(claims.peak), hbmBytes: claimIn(claims.hbm) }
  const m = protocol.model
  const model: ModelShape = { params: claimIn(m.params), layers: claimIn(m.layers), hidden: claimIn(m.hidden), kvBytesPerToken: claimIn(m.kvBytesPerToken), weightBytes: claimIn(fp8.weightBytes) }
  const settings: ReplaySettings = { ...replaySettings(protocol), batchTokens: c.batchTokens }
  const seed = seedOf(protocol)
  const order = [...sel.fit, ...sel.heldOut]
  const points = order.map((r) => preparePoint(replayPoint(napkinSpec(chip, model), replayPointOf(r, seed), settings), chip, model, { tpot: r.mean_tpot, ttft: r.median_ttft }))
  const nF = sel.fit.length
  const row = makeFitRow(chip, model, fitGrid(protocol), points)
  const ev = evaluateRow(row, { fit: points.slice(0, nF).map((_, i) => i), heldOut: points.slice(nF).map((_, i) => nF + i), ttftIsl: ttftIsl(protocol) }, protocol.gates)
  const runOf = new Map(order.map((p) => [p.id, p.run_url]))
  const f = ev.full
  const link = linkGBsOf(f)
  return {
    ...empty,
    selected: sel.selected.length,
    kept: sel.kept.length,
    nFit: nF,
    nHeldOut: sel.heldOut.length,
    dropped: sel.dropped.map((d) => ({ id: d.row.id, reasons: d.reasons })),
    params: { etaMem: f.etaMem, etaFlop: f.etaFlop, layerUs: f.layerUs, seqUs: f.seqUs, linkGBs: Number.isFinite(link) ? link : null, harnessMs: f.harnessS * 1e3 },
    loo: statsOf(ev.g1),
    heldOut: statsOf(ev.g2),
    ttftLoo: statsOf(ev.g3),
    gates: Object.fromEntries((['G1', 'G2', 'G3', 'G4', 'G5'] as const).map((g) => [g, { ok: ev.gates[g].ok, detail: ev.gates[g].detail }])),
    worst: ev.points
      .filter((p) => p.subset === 'F')
      .sort((a, b) => b.tpotError - a.tpotError || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((p) => ({ id: p.id, tp: p.tp, conc: p.conc, isl: p.isl, osl: p.osl, error: p.tpotError, runUrl: runOf.get(p.id) ?? '' })),
  }
}

/* ------------------------------ the frozen-form report on newer snapshots ------------------------------ */

const SNAPSHOT_FILE = /^inferencex-l70-(\d{4}-\d{2}-\d{2})\.json$/

/** Snapshot files in `dir` later than the pinned one (named `inferencex-l70-<date>.json`), oldest first. */
export function newerSnapshots(dir: string, pinned: string = EXTRACT_PATH): { file: string; date: string }[] {
  const base = SNAPSHOT_FILE.exec(pinned.split('/').pop() ?? '')
  if (!base) throw new Error(`the pinned extract ${pinned} is not named inferencex-l70-<date>.json`)
  return readdirSync(dir)
    .map((name) => ({ name, m: SNAPSHOT_FILE.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null && x.m[1] > base[1])
    .map((x) => ({ file: `${dir}/${x.name}`, date: x.m[1] }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface NewerReport {
  file: string
  date: string
  sha256: string
  rows: { key: string; kept: number; nFit: number; frozenTable: { n: number; mean: number; p90: number; max: number }; refitLoo: { n: number; mean: number; p90: number; max: number } | null }[]
}

/** One newer snapshot: the shipped table's TPOT error on its kept points of each row, and the frozen form refitted on it (LOO over F). */
export function newerReport(protocol: Protocol, file: string, date: string): NewerReport {
  const extract = readExtract(file)
  const seed = seedOf(protocol)
  const settings = replaySettings(protocol)
  const rows = selectPoints(protocol, extract, claimIn).map((sel) => {
    const table = PHYSICS_ROWS.find((r) => r.key === sel.prow.key)
    if (!table) throw new Error(`the table has no row ${sel.prow.key}`)
    const { chip, model } = table.spec
    const order = [...sel.fit, ...sel.heldOut]
    const logs = order.map((r) => replayPoint(table.spec, replayPointOf(r, seed), settings))
    const frozen = errorStats(logs.map((log, i) => Math.abs(predictTpot(log, table.spec) / order[i].mean_tpot - 1)))
    let refitLoo: NewerReport['rows'][number]['refitLoo'] = null
    if (sel.fit.length >= 2) {
      const points = logs.map((log, i) => preparePoint(log, chip, model, { tpot: order[i].mean_tpot, ttft: order[i].median_ttft }))
      const nF = sel.fit.length
      const ev = evaluateRow(makeFitRow(chip, model, fitGrid(protocol), points), { fit: points.slice(0, nF).map((_, i) => i), heldOut: points.slice(nF).map((_, i) => nF + i), ttftIsl: ttftIsl(protocol) }, protocol.gates)
      refitLoo = statsOf(ev.g1)
    }
    return { key: sel.prow.key, kept: sel.kept.length, nFit: sel.fit.length, frozenTable: statsOf(frozen), refitLoo }
  })
  return { file: file.split('/').pop() ?? file, date, sha256: sha256Hex(readFileSync(file)), rows }
}

/* ------------------------------ the file ------------------------------ */

export const CONTROL_CLAIM_ROUNDING = 'the error statistics in percent to 0.1'

export interface Controls {
  schema: 1
  generatedBy: string
  physId: string
  protocol: { version: number; sha256: string }
  nim: NimPanel
  control: ControlRow[]
  newer: NewerReport[]
  claimRounding: string
  claimValues: Record<string, number>
}

/** The claim values the panels reproduce: `phys.nim.<group>.itl-mean` and `phys.control.<chip>.loo-tpot-{mean,p90}`. */
export function controlClaimValues(nim: NimPanel, control: readonly ControlRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const g of nim.groups) out[`phys.nim.${g.key}.itl-mean`] = round(100 * g.mean, 10)
  for (const c of control) {
    if (!c.loo) continue
    out[`phys.control.${c.hardware}.loo-tpot-mean`] = round(100 * c.loo.mean, 10)
    out[`phys.control.${c.hardware}.loo-tpot-p90`] = round(100 * c.loo.p90, 10)
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => a[0].localeCompare(b[0])))
}

export function buildControls(protocol: Protocol = readProtocol(), note: (line: string) => void = () => {}): Controls {
  const t0 = performance.now()
  const nim = nimPanel(protocol)
  const t1 = performance.now()
  note(`NIM: ${nim.points.length} rows replayed in ${((t1 - t0) / 1e3).toFixed(1)} s`)
  const extract = readExtract()
  const control = protocol.controls.map((c) => {
    const s = performance.now()
    const r = controlRow(protocol, extract, c)
    note(`control ${c.hardware}: ${r.skipped ?? `${r.kept} kept points, replayed and fitted in ${((performance.now() - s) / 1e3).toFixed(1)} s`}`)
    return r
  })
  const dir = EXTRACT_PATH.slice(0, EXTRACT_PATH.lastIndexOf('/'))
  const newer = newerSnapshots(dir).map(({ file, date }) => newerReport(protocol, file, date))
  return {
    schema: 1,
    generatedBy: CONTROLS_COMMAND,
    physId: PHYS_ID,
    protocol: { version: protocol.version, sha256: protocolSha256() },
    nim,
    control,
    newer,
    claimRounding: CONTROL_CLAIM_ROUNDING,
    claimValues: controlClaimValues(nim, control),
  }
}

export const renderControls = (c: Controls): string => `${prettyJson(c)}\n`

const pc = (x: number) => `${(100 * x).toFixed(1)} %`

/** The spec's [proto] figures (§4.4), for comparison only. */
export const CONTROL_PROTO: Record<string, string> = {
  'h100-tp2': 'n = 27, mean 5.9 %',
  'h100-tp4': 'n = 66, mean 17.2 %',
  '8b-tp1': 'n = 59, mean 32.1 % (+28.5 % bias)',
  mi325x: '8.6 / 19.1 / 24.8 % (mean / p90 / max, all-points LOO at budget 8,192)',
  mi355x: '5.5 / 12.7 / 19.2 % (mean / p90 / max, all-points LOO at budget 8,192)',
}

export function printControls(c: Controls, out: (line: string) => void): void {
  out(`NIM 1.8.0 cross-harness (${c.nim.source}), H100 FP8 rows through EngineV2 with ${c.nim.row}'s table:`)
  for (const g of c.nim.groups) out(`  ${g.key}: n ${g.n}, mean |error| ${pc(g.mean)}, p90 ${pc(g.p90)}, max ${pc(g.max)}, bias ${pc(g.bias)}   [proto] ${CONTROL_PROTO[g.key] ?? '—'}`)
  out(`  dropped by the filters: ${c.nim.dropped.length}`)
  out('out-of-sample control (the frozen card form refitted per chip, protocol procedure, at the control budget):')
  for (const r of c.control) {
    if (r.skipped || !r.params || !r.loo || !r.heldOut) {
      out(`  ${r.hardware}: skipped (${r.skipped})`)
      continue
    }
    const p = r.params
    out(`  ${r.hardware} ${r.precision} at budget ${r.batchTokens}: ${r.kept} kept (F ${r.nFit} / H ${r.nHeldOut}); η_m ${p.etaMem.toFixed(2)}, η_f ${p.etaFlop.toFixed(2)}, t_layer ${p.layerUs.toFixed(1)} µs, t_seq ${p.seqUs.toFixed(1)} µs, β ${p.linkGBs === null ? '—' : p.linkGBs.toFixed(0)} GB/s`)
    out(`    TPOT LOO over F: mean ${pc(r.loo.mean)}, p90 ${pc(r.loo.p90)}, max ${pc(r.loo.max)}; held out: mean ${pc(r.heldOut.mean)}, p90 ${pc(r.heldOut.p90)}; G1 ${r.gates?.G1.ok ? 'would pass' : 'would fail'}   [proto] ${CONTROL_PROTO[r.hardware] ?? '—'}`)
  }
  out(c.newer.length === 0 ? 'frozen-form report: no snapshot newer than the pinned one in src/data/physics/points/' : 'frozen-form report on newer snapshots:')
  for (const n of c.newer) for (const r of n.rows) out(`  ${n.date} ${r.key}: the shipped table on ${r.kept} kept points mean ${pc(r.frozenTable.mean)}, p90 ${pc(r.frozenTable.p90)}; refitted LOO over F ${r.refitLoo ? `mean ${pc(r.refitLoo.mean)}, p90 ${pc(r.refitLoo.p90)}` : '—'}`)
  out(`claim values: ${Object.entries(c.claimValues).map(([k, v]) => `${k} ${v}`).join('; ')}`)
}

function main(): void {
  const print = process.argv.includes('--print')
  try {
    const controls = buildControls(readProtocol(), (line) => console.error(line))
    printControls(controls, (line) => console.log(line))
    const text = renderControls(controls)
    let committed = ''
    try {
      committed = readFileSync(CONTROLS_PATH, 'utf8')
    } catch {
      committed = ''
    }
    console.log(committed === text ? 'controls.json: the committed file holds' : 'controls.json: differs from the committed file (the integrator refreshes it at each s5 integration)')
    if (!print) {
      writeFileSync(CONTROLS_PATH, text)
      console.log(`wrote ${CONTROLS_PATH}`)
    }
  } catch (e) {
    // never fails (§5.2): print and leave the committed file as it is
    console.error(`physics-controls: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
    console.error('physics-controls: nothing written; this job never fails')
  }
  process.exit(0)
}

if (import.meta.main) main()
