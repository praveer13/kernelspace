/**
 * fit-physics — the replay and the fit on the pinned snapshot (docs/specs/s5.md §5.3-5.6; S5-06).
 *
 *   bun scripts/fit-physics.ts     load and check the extract, select and filter, replay every kept point through
 *                                  EngineV2, fit each row on F, score LOO over F, H, LOTPO and LOSO, evaluate G1-G5,
 *                                  run the consistency check (§5.6), and compare each figure with the spec's [proto]
 *
 * Every constant of the selection, the filters, the split, the replay, the grid and the gates is read from the protocol
 * block through `readProtocol()` (S5-D46); the chip, model and harness numbers from their claims. The report goes to
 * stdout and is byte-identical from run to run; the replay and fit times go to stderr, so `> out.txt` twice and `cmp`
 * checks it. S5-07 adds `--write` (table.ts, report.json) and `verify:physics --full` on top of these exports.
 *
 * Exports are pure helpers for tests/physics/{replay,fit}.test.ts; the CLI runs only under `import.meta.main`.
 */
import { readFileSync } from 'node:fs'
import { claimNumber, getClaim } from '../src/data/claims/all'
import { hash32 } from '../src/lib/rng'
import { napkinSpec } from '../src/lib/world/physics/card'
import { evaluateRow, cardParams, linkGBsOf, makeFitRow, preparePoint, type FitGrid, type FitPoint, type FitRow, type GateRules, type RowEvaluation } from '../src/lib/world/physics/fit'
import {
  medianWindowSteps,
  predictMedianTtft,
  predictTpot,
  replayPoint,
  replayRow,
  runEngine,
  stepSeconds,
  type ReplayPoint,
  type ReplaySettings,
  type StepLog,
} from '../src/lib/world/physics/replay'
import type { CardSpec, ChipShape, ModelShape } from '../src/lib/world/physics/types'
import { EXTRACT_PATH, isKept, kvTokenLimit, readExtract, sha256Hex, type PointRow } from './fetch-physics-points'
import { gridValues, readProtocol, type Protocol, type ProtocolRow } from './physics-protocol'

/* ------------------------------ claims ------------------------------ */

/** Units the physics claims carry, and the factor to SI (B, B/s, FLOP/s, parameters), Boot's `claimNumber(id, scale)` way. */
const UNIT_SCALE: Record<string, number> = {
  'TB/s': 1e12,
  TFLOPS: 1e12,
  GB: 1e9,
  'B params': 1e9,
  B: 1,
  'bytes/token': 1,
  tokens: 1,
  'tokens per block': 1,
}

/** A numeric claim in SI units. Throws on a unit this script does not know, rather than guessing a scale. */
export function claimSI(id: string): number {
  const { unit } = getClaim(id)
  const scale = unit === undefined ? 1 : UNIT_SCALE[unit]
  if (scale === undefined) throw new Error(`claim ${id}: unit ${unit} has no SI scale here`)
  return claimNumber(id, scale)
}

/** A protocol row's chip and model, from its claims (§3.3). */
export function rowShapes(protocol: Protocol, prow: ProtocolRow): { chip: ChipShape; model: ModelShape } {
  const m = protocol.model
  return {
    chip: { bwBps: claimSI(prow.bw), peakFlops: claimSI(prow.peak), hbmBytes: claimSI(prow.hbm) },
    model: {
      params: claimSI(m.params),
      layers: claimSI(m.layers),
      hidden: claimSI(m.hidden),
      kvBytesPerToken: claimSI(m.kvBytesPerToken),
      weightBytes: claimSI(prow.weightBytes),
    },
  }
}

/** The replay's settings: the protocol's, with the token budget and block size from their claims (S5-D34). */
export function replaySettings(protocol: Protocol): ReplaySettings {
  return {
    promptsPerConc: protocol.replay.promptsPerConc,
    rangeRatio: protocol.replay.rangeRatio,
    batchTokens: claimSI(protocol.replay.batchTokens),
    blockSize: claimSI(protocol.replay.blockSize),
    gpuMemUtil: protocol.filters.gpuMemUtil,
  }
}

/** The fit's grid and procedure, from the protocol (S5-D35). */
export function fitGrid(protocol: Protocol): FitGrid {
  const linear = protocol.fit.linear.join(',')
  if (linear !== 'layerUs,seqUs,invLinkGBs') throw new Error(`fit.ts fits (layerUs, seqUs, invLinkGBs); the protocol names ${linear}`)
  return {
    etaMem: gridValues(protocol.fit.etaMem),
    etaFlop: gridValues(protocol.fit.etaFlop),
    etaFlopStart: protocol.fit.etaFlopStart,
    ttftRounds: protocol.fit.ttftRounds,
  }
}

/** The replay seed rule `hash32('<prefix>' + id)`, read from the protocol. */
export function seedOf(protocol: Protocol): (id: string) => number {
  const m = /^hash32\('([^']*)' \+ id\)$/.exec(protocol.replay.seed)
  if (!m) throw new Error(`replay.seed is not of the form hash32('<prefix>' + id): ${protocol.replay.seed}`)
  const prefix = m[1]
  return (id) => hash32(prefix + id)
}

/** The ISL of G3's points ("… points with isl 8192 …", protocol `gates.G3.population`). */
export function ttftIsl(protocol: Protocol): number {
  const m = /\bisl (\d+)\b/.exec(protocol.gates.G3.population)
  if (!m) throw new Error(`gates.G3.population names no isl: ${protocol.gates.G3.population}`)
  return Number(m[1])
}

/* ------------------------------ load, select, filter, split ------------------------------ */

/** The extract, checked against the dataset claim, which names its sha256 (§5.3 step 1). */
export function loadExtract(file: string = EXTRACT_PATH): { rows: PointRow[]; sha256: string } {
  const sha256 = sha256Hex(readFileSync(file))
  const dataset = getClaim('bench.inferencex.llama70b-2025-10-29')
  if (!dataset.boundary?.includes(sha256)) throw new Error(`the extract's sha256 ${sha256} is not the one the dataset claim names`)
  return { rows: readExtract(file), sha256 }
}

export interface Drop {
  row: PointRow
  /** 'KV' and/or 'TTFT', with the figures */
  reasons: string[]
}

export interface RowSelection {
  prow: ProtocolRow
  /** the protocol's selection on this row's hardware and precision */
  selected: PointRow[]
  kept: PointRow[]
  dropped: Drop[]
  fit: PointRow[]
  heldOut: PointRow[]
}

/**
 * Per protocol row: the selection (`select`, the row's hardware and precision), the KV rule and the preemption rule
 * (`filters`, with W and kv from the model byte claims and HBM from the capacity claim), and the split by concurrency.
 * Throws on a point whose TP is not one of the row's fit TPs or whose concurrency is in neither subset.
 */
export function selectPoints(protocol: Protocol, extract: readonly PointRow[], resolve: (id: string) => number = claimSI): RowSelection[] {
  const { fitConc, heldOutConc } = protocol.split
  return protocol.rows.map((prow) => {
    const selected = extract.filter((r) => isKept(r, protocol) && r.hardware === prow.hardware && r.precision === prow.precision)
    const kept: PointRow[] = []
    const dropped: Drop[] = []
    for (const r of selected) {
      if (!prow.fitTp.includes(r.decode_tp)) throw new Error(`point ${r.id}: TP ${r.decode_tp} is not a fit TP of ${prow.key}`)
      const reasons: string[] = []
      const need = r.conc * (r.isl + r.osl)
      const room = kvTokenLimit(protocol, prow, r.decode_tp, resolve)
      if (need > room) reasons.push(`KV: ${r.conc} × (${r.isl} + ${r.osl}) = ${need} > ${room}`)
      if (r.median_ttft >= protocol.filters.ttftMaxSeconds) reasons.push(`TTFT: median ${r.median_ttft.toFixed(2)} s ≥ ${protocol.filters.ttftMaxSeconds} s`)
      if (reasons.length) dropped.push({ row: r, reasons })
      else kept.push(r)
    }
    for (const r of kept) {
      if (!fitConc.includes(r.conc) && !heldOutConc.includes(r.conc)) throw new Error(`point ${r.id}: concurrency ${r.conc} is in neither F nor H`)
    }
    return {
      prow,
      selected,
      kept,
      dropped,
      fit: kept.filter((r) => fitConc.includes(r.conc)),
      heldOut: kept.filter((r) => heldOutConc.includes(r.conc)),
    }
  })
}

/** The dropped ids across rows, sorted; the run stops unless they are exactly the protocol's `expectDropped`. */
export function droppedIds(sel: readonly RowSelection[]): string[] {
  return sel.flatMap((s) => s.dropped.map((d) => d.row.id)).sort()
}

/* ------------------------------ replay and fit ------------------------------ */

export const replayPointOf = (r: PointRow, seed: (id: string) => number): ReplayPoint => ({
  id: r.id,
  tp: r.decode_tp,
  conc: r.conc,
  isl: r.isl,
  osl: r.osl,
  seed: seed(r.id),
})

export interface ReplayedRow {
  sel: RowSelection
  chip: ChipShape
  model: ModelShape
  /** F then H, each in id order */
  order: PointRow[]
  points: FitPoint[]
  steps: number
  seqSteps: number
}

/** Replays a row's kept points (F, then H) and prices them for the fit; `keep` is told every log before it is dropped. */
export function replayRowPoints(
  protocol: Protocol,
  sel: RowSelection,
  settings: ReplaySettings,
  keep: (log: StepLog) => void = () => {},
): ReplayedRow {
  const { chip, model } = rowShapes(protocol, sel.prow)
  const seed = seedOf(protocol)
  const order = [...sel.fit, ...sel.heldOut]
  let steps = 0
  let seqSteps = 0
  const points = order.map((r) => {
    const log = replayPoint(napkinSpec(chip, model), replayPointOf(r, seed), settings)
    keep(log)
    steps += log.steps
    for (let s = 0; s < log.steps; s++) seqSteps += log.seqs[s]
    return preparePoint(log, chip, model, { tpot: r.mean_tpot, ttft: r.median_ttft })
  })
  return { sel, chip, model, order, points, steps, seqSteps }
}

/** The fit row and its split, ready for `evaluateRow`. */
export function fitRowOf(protocol: Protocol, rr: ReplayedRow): { row: FitRow; split: { fit: number[]; heldOut: number[]; ttftIsl: number } } {
  const nF = rr.sel.fit.length
  return {
    row: makeFitRow(rr.chip, rr.model, fitGrid(protocol), rr.points),
    split: {
      fit: rr.points.slice(0, nF).map((_, i) => i),
      heldOut: rr.points.slice(nF).map((_, i) => nF + i),
      ttftIsl: ttftIsl(protocol),
    },
  }
}

/* ------------------------------ consistency (§5.6) ------------------------------ */

/**
 * §5.6's configurations for a row: its smallest box TP at the smallest fit concurrency on the smallest shape, its largest
 * box TP at the largest fit concurrency on the smallest shape, and its smallest box TP at the smallest fit concurrency on
 * the required shape (G5's, 8k/1k). Each is a kept point of the row (throws if one is missing).
 */
export function consistencyPoints(protocol: Protocol, sel: RowSelection): PointRow[] {
  const tps = [...sel.prow.boxTp].sort((a, b) => a - b)
  const concs = [...protocol.split.fitConc].sort((a, b) => a - b)
  const shapes = [...new Set(sel.kept.map((r) => `${r.isl}/${r.osl}`))]
    .map((s) => s.split('/').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const [small] = shapes
  const req = protocol.gates.G5.shapeRequired
  const want: [number, number, number, number][] = [
    [tps[0], concs[0], small[0], small[1]],
    [tps[tps.length - 1], concs[concs.length - 1], small[0], small[1]],
    [tps[0], concs[0], req[0], req[1]],
  ]
  if (want.length !== protocol.consistency.configsPerRow) throw new Error(`§5.6 names ${want.length} configurations; the protocol says ${protocol.consistency.configsPerRow}`)
  return want.map(([tp, c, isl, osl]) => {
    const r = sel.kept.find((p) => p.decode_tp === tp && p.conc === c && p.isl === isl && p.osl === osl)
    if (!r) throw new Error(`${sel.prow.key}: no kept point at TP ${tp}, c ${c}, ${isl}/${osl}`)
    return r
  })
}

export interface ConsistencyResult {
  id: string
  tp: number
  conc: number
  isl: number
  osl: number
  /** µs */
  predTpotUs: number
  engineTpotUs: number
  predTtftUs: number
  engineTtftUs: number
  /** |Δ median TTFT| bound, µs: 0.5 × the steps in the median windows */
  ttftBoundUs: number
  tpotOk: boolean
  ttftOk: boolean
}

/** The weighted-sum prediction against a real `EngineV2` run with `spec`, on a replayed point (§5.6). */
export function consistencyOf(log: StepLog, spec: CardSpec, settings: ReplaySettings, seed: number, tpotMaxAbsUs: number): ConsistencyResult {
  const p: ReplayPoint = { id: log.id, tp: log.tp, conc: log.conc, isl: log.isl, osl: log.osl, seed }
  const stepS = stepSeconds(log, spec)
  const predTpotUs = predictTpot(log, spec, stepS) * 1e6
  const predTtftUs = predictMedianTtft(log, spec, stepS) * 1e6
  const ttftBoundUs = 0.5 * medianWindowSteps(log, spec, stepS)
  const run = runEngine(replayRow(spec, p, settings), p, settings)
  return {
    id: log.id,
    tp: log.tp,
    conc: log.conc,
    isl: log.isl,
    osl: log.osl,
    predTpotUs,
    engineTpotUs: run.meanTpotUs,
    predTtftUs,
    engineTtftUs: run.medianTtftUs,
    ttftBoundUs,
    tpotOk: Math.abs(run.meanTpotUs - predTpotUs) <= tpotMaxAbsUs,
    ttftOk: Math.abs(run.medianTtftUs - predTtftUs) <= ttftBoundUs,
  }
}

/* ------------------------------ the spec's [proto] figures ------------------------------ */

/** §4.2's [proto] figures (prototype runs, all-points populations where noted) and §3.3's parameters, for comparison only. */
export const PROTO: Record<string, {
  g1: [number, number, number]
  g2: [number, number, number]
  ttftAllLoo: [number, number]
  ttftHeldMean: number
  lotpo: [number, number]
  loso: [number, number]
  params: { etaMem: number; etaFlop: number; layerUs: number; seqUs: number; linkGBs: number; harnessMs: number }
}> = {
  'h100-vllm-0-10-2-fp8': {
    g1: [5.0, 11.3, 12.3], g2: [3.8, 11.1, 12.7], ttftAllLoo: [7.4, 15.8], ttftHeldMean: 8.9, lotpo: [6.0, 10.5], loso: [7.5, 16.6],
    params: { etaMem: 0.89, etaFlop: 0.52, layerUs: 72.2, seqUs: 60.8, linkGBs: 212, harnessMs: 21.2 },
  },
  'b200-vllm-0-10-2-fp8': {
    g1: [3.5, 7.1, 15.3], g2: [3.2, 6.0, 11.7], ttftAllLoo: [9.8, 16.5], ttftHeldMean: 8.7, lotpo: [4.0, 7.7], loso: [10.4, 28.6],
    params: { etaMem: 0.84, etaFlop: 0.46, layerUs: 61.7, seqUs: 32.5, linkGBs: 291, harnessMs: 52.1 },
  },
  'b200-vllm-0-10-2-nvfp4': {
    g1: [4.4, 6.8, 24.6], g2: [2.8, 5.2, 16.8], ttftAllLoo: [12.1, 20.4], ttftHeldMean: 7.7, lotpo: [4.0, 7.5], loso: [11.5, 29.7],
    params: { etaMem: 0.76, etaFlop: 0.34, layerUs: 69.9, seqUs: 29.0, linkGBs: 284, harnessMs: 41.8 },
  },
}

/* ------------------------------ printing ------------------------------ */

const pc = (x: number) => (100 * x).toFixed(1)
const ms = (s: number) => (s * 1e3).toFixed(2)
const pad = (s: string | number, n: number) => String(s).padStart(n)
const padR = (s: string | number, n: number) => String(s).padEnd(n)

/** A comparison line: ours, the [proto] figure and the difference in points, flagged when it exceeds 2 points. */
function compare(label: string, ours: number, proto: number, note = ''): string {
  const d = 100 * ours - proto
  return `  ${padR(label, 34)} ${pad(pc(ours), 6)} vs [proto] ${pad(proto.toFixed(1), 5)}  Δ ${pad((d >= 0 ? '+' : '') + d.toFixed(1), 6)}${Math.abs(d) > 2 ? '  > 2 points' : ''}${note ? `  (${note})` : ''}`
}

export function printRow(rr: ReplayedRow, ev: RowEvaluation, out: (line: string) => void): void {
  const { sel } = rr
  const key = sel.prow.key
  out(`\n=== ${key}: ${sel.selected.length} selected, ${sel.kept.length} kept (F ${sel.fit.length} / H ${sel.heldOut.length})`)
  for (const d of sel.dropped) out(`  dropped ${d.row.id} (TP ${d.row.decode_tp}, c ${d.row.conc}, ${d.row.isl}/${d.row.osl}): ${d.reasons.join('; ')}`)
  const f = ev.full
  const proto = PROTO[key]
  out(`  fit on F: η_m ${f.etaMem.toFixed(2)}, η_f ${f.etaFlop.toFixed(2)}, t_layer ${f.layerUs.toFixed(1)} µs, t_seq ${f.seqUs.toFixed(1)} µs, β ${linkGBsOf(f).toFixed(0)} GB/s, harness ${(f.harnessS * 1e3).toFixed(1)} ms`)
  const r = ev.ranges
  out(`  LOO refit ranges: η_m ${r.etaMem[0].toFixed(2)}–${r.etaMem[1].toFixed(2)}, η_f ${r.etaFlop[0].toFixed(2)}–${r.etaFlop[1].toFixed(2)}, t_layer ${r.layerUs[0].toFixed(1)}–${r.layerUs[1].toFixed(1)} µs, t_seq ${r.seqUs[0].toFixed(1)}–${r.seqUs[1].toFixed(1)} µs, β ${r.linkGBs[0].toFixed(0)}–${r.linkGBs[1].toFixed(0)} GB/s, harness ${r.harnessMs[0].toFixed(1)}–${r.harnessMs[1].toFixed(1)} ms`)
  if (proto) {
    const p = proto.params
    out(`  §3.3 [proto]: η_m ${p.etaMem}, η_f ${p.etaFlop}, t_layer ${p.layerUs} µs, t_seq ${p.seqUs} µs, β ${p.linkGBs} GB/s, harness ${p.harnessMs} ms`)
  }
  out(`  bound flags: ${ev.boundFlags.length ? ev.boundFlags.join('; ') : 'none'}`)
  out(`  objective: TPOT Σ(rel err)² ${f.tpotSse.toExponential(6)}, TTFT ${f.ttftSse.toExponential(6)}`)
  out('')
  out(`  ${padR('id', 6)} set ${pad('TP', 2)} ${pad('c', 3)} ${padR('shape', 9)} | ${pad('TPOT ms', 8)} ${pad('full', 8)} ${pad('LOO/H', 8)} ${pad('err %', 6)} | ${pad('TTFT ms', 8)} ${pad('full', 8)} ${pad('LOO/H', 8)} ${pad('err %', 6)} | run`)
  const runOf = new Map(rr.order.map((p) => [p.id, p.run_url]))
  for (const p of ev.points) {
    const signed = (pred: number, meas: number) => {
      const e = 100 * (pred / meas - 1)
      return (e >= 0 ? '+' : '') + e.toFixed(1)
    }
    out(
      `  ${padR(p.id, 6)} ${p.subset}   ${pad(p.tp, 2)} ${pad(p.conc, 3)} ${padR(`${p.isl}/${p.osl}`, 9)} | ` +
        `${pad(ms(p.measTpot), 8)} ${pad(ms(p.fullTpot), 8)} ${pad(ms(p.outTpot), 8)} ${pad(signed(p.outTpot, p.measTpot), 6)} | ` +
        `${pad(ms(p.measTtft), 8)} ${pad(ms(p.fullTtft), 8)} ${pad(ms(p.outTtft), 8)} ${pad(signed(p.outTtft, p.measTtft), 6)} | ${runOf.get(p.id) ?? ''}`,
    )
  }
  out('')
  const worst = ev.points.filter((p) => p.subset === 'F').sort((a, b) => b.tpotError - a.tpotError || a.id.localeCompare(b.id)).slice(0, 3)
  out(`  worst three F points (TPOT LOO): ${worst.map((p) => `${p.id} TP ${p.tp} c ${p.conc} ${p.isl}/${p.osl} ${pc(p.tpotError)} % ${runOf.get(p.id)}`).join(' | ')}`)
  for (const g of ['G1', 'G2', 'G3', 'G4', 'G5'] as const) out(`  ${g} ${ev.gates[g].ok ? 'pass' : 'FAIL'}: ${ev.gates[g].detail}`)
  out(`  G1 max ${pc(ev.g1.max)} %; G2 max ${pc(ev.g2.max)} %; G3 p90 ${pc(ev.g3.p90)} %, max ${pc(ev.g3.max)} %; held-out TTFT at that ISL: n ${ev.heldOutTtft.n}, mean ${pc(ev.heldOutTtft.mean)} %, p90 ${pc(ev.heldOutTtft.p90)} %`)
  out(`  verdict: ${ev.calibrated ? 'calibrated' : 'failed'}${ev.calibrated ? (ev.ttftEligible ? ', TTFT eligible' : ', TTFT not eligible') : ''}`)
  const group = (name: string, x: RowEvaluation['lotpo']) => {
    for (const g of x.groups) out(`  ${name} ${padR(g.group, 10)} fitted on ${pad(g.fitted, 2)} F points, predicts ${pad(g.stats.n, 2)}: mean ${pc(g.stats.mean)} %, p90 ${pc(g.stats.p90)} %, max ${pc(g.stats.max)} % (η_m ${g.params.etaMem.toFixed(2)}, η_f ${g.params.etaFlop.toFixed(2)})`)
    out(`  ${name} all: n ${x.all.n}, mean ${pc(x.all.mean)} %, p90 ${pc(x.all.p90)} %, max ${pc(x.all.max)} %`)
  }
  group('LOTPO', ev.lotpo)
  group('LOSO', ev.loso)
  if (proto) {
    out('  against §4.2 [proto] (percent; Δ in points):')
    out(compare('G1 TPOT LOO over F: mean', ev.g1.mean, proto.g1[0]))
    out(compare('G1 p90', ev.g1.p90, proto.g1[1]))
    out(compare('G1 max', ev.g1.max, proto.g1[2]))
    out(compare('G2 held-out H: mean', ev.g2.mean, proto.g2[0]))
    out(compare('G2 p90', ev.g2.p90, proto.g2[1]))
    out(compare('G2 max', ev.g2.max, proto.g2[2]))
    out(compare('G3 TTFT 8k LOO mean', ev.g3.mean, proto.ttftAllLoo[0], '[proto] is all-points LOO; G3 is F-LOO'))
    out(compare('G3 TTFT 8k LOO p90', ev.g3.p90, proto.ttftAllLoo[1], '[proto] is all-points LOO; G3 is F-LOO'))
    out(compare('TTFT 8k held-out mean', ev.heldOutTtft.mean, proto.ttftHeldMean))
    out(compare('LOTPO mean', ev.lotpo.all.mean, proto.lotpo[0], '[proto] fitted F ∪ H; here F only'))
    out(compare('LOTPO p90', ev.lotpo.all.p90, proto.lotpo[1], '[proto] fitted F ∪ H; here F only'))
    out(compare('LOSO mean', ev.loso.all.mean, proto.loso[0], '[proto] fitted F ∪ H; here F only'))
    out(compare('LOSO p90', ev.loso.all.p90, proto.loso[1], '[proto] fitted F ∪ H; here F only'))
  }
}

/* ------------------------------ the command line ------------------------------ */

function main(): void {
  const protocol = readProtocol()
  const out = (line: string) => console.log(line)
  const time = (line: string) => console.error(line)
  const { rows: extract, sha256 } = loadExtract()
  out(`${protocol.id} v${protocol.version} (${protocol.date}); extract ${sha256} (${extract.length} rows), the sha256 the dataset claim names`)
  const sel = selectPoints(protocol, extract)
  const dropped = droppedIds(sel)
  const expected = [...protocol.filters.expectDropped].sort()
  out(`selection ${sel.map((s) => `${s.prow.key} ${s.selected.length}`).join(', ')}; dropped ${dropped.join(', ')}`)
  if (dropped.join(',') !== expected.join(',')) {
    console.error(`fit-physics: the filters dropped ${dropped.join(', ')}, the protocol expects ${expected.join(', ')}; stopping`)
    process.exit(1)
  }
  const settings = replaySettings(protocol)
  const seed = seedOf(protocol)
  out(`replay: ${settings.promptsPerConc}·c requests at t = 0, range ratio ${settings.rangeRatio}, budget ${settings.batchTokens}, block ${settings.blockSize}, pool at ${settings.gpuMemUtil} of HBM`)
  let failedConsistency = false
  for (const s of sel) {
    const consist = new Set(consistencyPoints(protocol, s).map((r) => r.id))
    const logs = new Map<string, StepLog>()
    const t0 = performance.now()
    const rr = replayRowPoints(protocol, s, settings, (log) => {
      if (consist.has(log.id)) logs.set(log.id, log)
    })
    const t1 = performance.now()
    const { row, split } = fitRowOf(protocol, rr)
    const ev = evaluateRow(row, split, protocol.gates as GateRules)
    const t2 = performance.now()
    time(`${s.prow.key}: replay ${((t1 - t0) / 1e3).toFixed(1)} s (${rr.points.length} points, ${rr.steps} steps, ${rr.seqSteps} sequence-steps); ` +
      `fit ${((t2 - t1) / 1e3).toFixed(1)} s (${row.counts.kernels} kernels, ${row.counts.windows} window sets, memoised)`)
    printRow(rr, ev, out)
    const spec: CardSpec = { chip: rr.chip, model: rr.model, params: cardParams(ev.full) }
    out(`  consistency (§5.6), EngineV2 with the fit on F and its integer-µs clock against the weighted sums:`)
    for (const id of consist) {
      const log = logs.get(id)
      if (!log) throw new Error(`no log kept for ${id}`)
      const c = consistencyOf(log, spec, settings, seed(id), protocol.consistency.tpotMaxAbsUs)
      if (!c.tpotOk || !c.ttftOk) failedConsistency = true
      out(
        `  ${padR(id, 6)} TP ${c.tp} c ${pad(c.conc, 2)} ${padR(`${c.isl}/${c.osl}`, 9)} mean TPOT ${c.engineTpotUs.toFixed(4)} vs ${c.predTpotUs.toFixed(4)} µs ` +
          `(|Δ| ${Math.abs(c.engineTpotUs - c.predTpotUs).toFixed(4)} ≤ ${protocol.consistency.tpotMaxAbsUs}: ${c.tpotOk ? 'ok' : 'FAIL'}); ` +
          `median TTFT ${c.engineTtftUs.toFixed(4)} vs ${c.predTtftUs.toFixed(4)} µs (|Δ| ${Math.abs(c.engineTtftUs - c.predTtftUs).toFixed(4)} ≤ ${c.ttftBoundUs}: ${c.ttftOk ? 'ok' : 'FAIL'})`,
      )
    }
  }
  if (failedConsistency) {
    console.error('fit-physics: the consistency check failed (§5.6, §9.4 stop rule 2)')
    process.exit(1)
  }
}

if (import.meta.main) main()
