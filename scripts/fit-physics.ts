/**
 * fit-physics — the replay, the fit and the generated table and report (docs/specs/s5.md §5.3-5.8; S5-06, S5-07).
 *
 *   bun scripts/fit-physics.ts           load and check the extract, select and filter, replay every kept point through
 *                                        EngineV2, fit each row on F, score LOO over F, H, LOTPO and LOSO, evaluate G1-G5,
 *                                        run the consistency check (§5.6), and compare each figure with the spec's [proto]
 *   bun scripts/fit-physics.ts --write   the same, then write src/lib/world/physics/table.ts and docs/physics/report.json
 *
 * Every constant of the selection, the filters, the split, the replay, the grid and the gates is read from the protocol
 * block through `readProtocol()` (S5-D46); the chip, model and harness numbers from their claims. The report goes to
 * stdout and is byte-identical from run to run; the replay and fit times go to stderr, so `> out.txt` twice and `cmp`
 * checks it. `verify:physics --full` (scripts/verify-physics.ts) calls `runGate`, `renderTable` and `renderReport` and
 * diffs their text with the committed files, so a generated file is never edited by hand.
 *
 * Exports are pure helpers for tests/physics/{replay,fit,verify-physics}.test.ts and verify-physics; the CLI runs only
 * under `import.meta.main`. Nothing here imports the generated table: it is this script's output.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { claimNumber, getClaim } from '../src/data/claims/all'
import { SIM_TICK_SECONDS } from '../src/lib/fleet-model'
import { rev32, stableStringify } from '../src/lib/ledger/stable'
import { hash32 } from '../src/lib/rng'
import { EMPTY_ENVELOPE } from '../src/lib/world/physics/box'
import { napkinSpec, stepCard } from '../src/lib/world/physics/card'
import { ENGINE_V2_REV } from '../src/lib/world/physics/engine-v2'
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
import type { CalibratedRow, CardSpec, ChipShape, ModelShape, RowEnvelope, StepCard, StepLoad } from '../src/lib/world/physics/types'
import { EXTRACT_PATH, isKept, kvTokenLimit, readExtract, readNim, sha256Hex, tpotClaimId, ttftClaimId, type PointRow } from './fetch-physics-points'
import { gridValues, protocolSha256, readProtocol, type Protocol, type ProtocolRow } from './physics-protocol'

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

/* ------------------------------ the gate run ------------------------------ */

/** One row after the run: its selection, its replays priced for the fit, its evaluation, the card it fitted and its checks. */
export interface RowRun {
  sel: RowSelection
  rr: ReplayedRow
  ev: RowEvaluation
  /** the fit on F as a card (the table's spec) */
  spec: CardSpec
  /** the largest in-box step of F ∪ H's replays (§6.3) */
  envelope: RowEnvelope
  /** §5.6, with the fit on F as the engine's card */
  consistency: ConsistencyResult[]
  /** wall time, for stderr only (never in a generated file) */
  replayS: number
  fitS: number
}

export interface GateRun {
  protocol: Protocol
  protocolSha256: string
  extractSha256: string
  settings: ReplaySettings
  rows: RowRun[]
}

/**
 * The whole gate on the committed snapshot: load and check the extract, select and filter, replay, fit, evaluate and run
 * §5.6's consistency check, per protocol row. Throws when the filters do not drop exactly the protocol's ids.
 */
export function runGate(protocol: Protocol = readProtocol(), note: (line: string) => void = () => {}): GateRun {
  const { rows: extract, sha256 } = loadExtract()
  const sel = selectPoints(protocol, extract)
  const dropped = droppedIds(sel)
  const expected = [...protocol.filters.expectDropped].sort()
  if (dropped.join(',') !== expected.join(',')) throw new Error(`the filters dropped ${dropped.join(', ')}, the protocol expects ${expected.join(', ')}`)
  const settings = replaySettings(protocol)
  const seed = seedOf(protocol)
  const rows: RowRun[] = []
  for (const s of sel) {
    const consist = new Set(consistencyPoints(protocol, s).map((r) => r.id))
    const logs = new Map<string, StepLog>()
    let envelope: RowEnvelope = { ...EMPTY_ENVELOPE }
    const t0 = performance.now()
    const rr = replayRowPoints(protocol, s, settings, (log) => {
      if (consist.has(log.id)) logs.set(log.id, log)
      // the envelope is the box's: only the row's box TPs count (NVFP4 is fitted on TP 1-8 and boxed to TP 1-4)
      if (!s.prow.boxTp.includes(log.tp)) return
      let { tokens, decodeSeqs, kvTokensPerGpu, attnPairsPerGpu } = envelope
      for (let i = 0; i < log.steps; i++) {
        tokens = Math.max(tokens, log.tokens[i])
        decodeSeqs = Math.max(decodeSeqs, log.decodeSeqs[i])
        kvTokensPerGpu = Math.max(kvTokensPerGpu, log.kvTokens[i] / log.tp)
        attnPairsPerGpu = Math.max(attnPairsPerGpu, log.attnPairs[i] / log.tp)
      }
      envelope = { tokens, decodeSeqs, kvTokensPerGpu, attnPairsPerGpu }
    })
    const t1 = performance.now()
    const { row, split } = fitRowOf(protocol, rr)
    const ev = evaluateRow(row, split, protocol.gates as GateRules)
    const t2 = performance.now()
    const spec: CardSpec = { chip: rr.chip, model: rr.model, params: cardParams(ev.full) }
    const consistency = [...consist].map((id) => {
      const log = logs.get(id)
      if (!log) throw new Error(`no log kept for ${id}`)
      return consistencyOf(log, spec, settings, seed(id), protocol.consistency.tpotMaxAbsUs)
    })
    note(
      `${s.prow.key}: replay ${((t1 - t0) / 1e3).toFixed(1)} s (${rr.points.length} points, ${rr.steps} steps, ${rr.seqSteps} sequence-steps); ` +
        `fit ${((t2 - t1) / 1e3).toFixed(1)} s (${row.counts.kernels} kernels, ${row.counts.windows} window sets, memoised)`,
    )
    rows.push({ sel: s, rr, ev, spec, envelope, consistency, replayS: (t1 - t0) / 1e3, fitS: (t2 - t1) / 1e3 })
  }
  return { protocol, protocolSha256: protocolSha256(), extractSha256: sha256, settings, rows }
}

/* ------------------------------ the generated table (§5.8, §6.3-6.4) ------------------------------ */

/** The status line the artifacts carry until the owner signs (S5-D28, S5-D64). */
export const FIT_STATUS = 'adopted by the build on 2026-10-18, unsigned'

/** The table's row for a run: the fit on F as a calibrated (or failed) row, with its box, envelope, eligibility and label figures. */
export function tableRowOf(run: RowRun, settings: ReplaySettings): CalibratedRow {
  const { sel, ev } = run
  const shapes = [...new Set(sel.kept.map((r) => `${r.isl}/${r.osl}`))]
    .map((x) => x.split('/').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([isl, osl]) => ({ isl, osl }))
  return {
    key: sel.prow.key,
    status: ev.calibrated ? 'calibrated' : 'failed',
    spec: run.spec,
    harnessMs: ev.full.harnessS * 1e3,
    box: {
      tp: [...sel.prow.boxTp],
      maxNumSeqs: Math.max(...sel.kept.map((r) => r.conc)),
      shapes,
      batchTokens: settings.batchTokens,
    },
    envelope: run.envelope,
    eligible: { tpot: ev.calibrated, ttft: ev.ttftEligible },
    label: { tpot: { p90: ev.g1.p90, n: ev.g1.n }, ttft: { mean: ev.g3.mean, p90: ev.g3.p90, n: ev.g3.n } },
  }
}

/** One measured option of a row: an F point in its box. TPOT is the published mean, seconds. */
export interface IxPoint {
  id: string
  tp: number
  conc: number
  isl: number
  osl: number
  tpot: number
}

/** Measured TPOT per in-box F option, in id order, per row key. */
export function ixInbox(run: GateRun): Record<string, IxPoint[]> {
  const out: Record<string, IxPoint[]> = {}
  for (const r of run.rows) {
    out[r.sel.prow.key] = r.sel.fit
      .filter((p) => r.sel.prow.boxTp.includes(p.decode_tp))
      .map((p) => ({ id: p.id, tp: p.decode_tp, conc: p.conc, isl: p.isl, osl: p.osl, tpot: p.mean_tpot }))
      .sort((a, b) => Number(a.id) - Number(b.id))
  }
  return out
}

export const DATASET_CLAIM = 'bench.inferencex.llama70b-2025-10-29'

/** The claims the fit read: the model, chip and byte claims of every row, the harness claims the replay read, and the dataset claim. */
export function inputClaimIds(protocol: Protocol): string[] {
  const m = protocol.model
  const ids = new Set<string>([m.params, m.layers, m.hidden, m.kvBytesPerToken, protocol.replay.batchTokens, protocol.replay.blockSize, DATASET_CLAIM])
  for (const r of protocol.rows) for (const id of [r.bw, r.peak, r.hbm, r.weightBytes]) ids.add(id)
  return [...ids].sort()
}

export interface InputClaim {
  id: string
  value: number | string
  verifiedAt: string
}

/** The input claims as they are in the registry now. */
export function readInputClaims(protocol: Protocol): InputClaim[] {
  return inputClaimIds(protocol).map((id) => {
    const c = getClaim(id)
    return { id, value: c.value, verifiedAt: c.verifiedAt }
  })
}

/** The table's input hash (§5.2): the extract's sha256, the engine's rev and every input claim's value. A refit changes it. */
export const inputHashOf = (extractSha256: string, claims: readonly { id: string; value: number | string }[]): string =>
  sha256Hex(stableStringify({ extract: extractSha256, engine: ENGINE_V2_REV, claims: claims.map((c) => ({ id: c.id, value: c.value })) }))

/** How a value is written: TypeScript (single quotes, bare keys) or JSON; one line where it fits `width`, one member per line where it does not. */
interface TextStyle {
  quote(s: string): string
  key(k: string): string
  width: number
  /** a comma after the last member of a multi-line list (TypeScript yes, JSON no) */
  trailing: boolean
}

const TS_STYLE: TextStyle = {
  quote: (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
  key: (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`),
  width: 120,
  trailing: true,
}
const JSON_STYLE: TextStyle = { quote: (s) => JSON.stringify(s), key: (k) => JSON.stringify(k), width: 420, trailing: false }

function pretty(value: unknown, st: TextStyle, indent = ''): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('pretty: a non-finite number')
    return String(value)
  }
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return st.quote(value)
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const parts = value.map((v) => pretty(v, st, inner))
    const one = `[${parts.join(', ')}]`
    if (!one.includes('\n') && indent.length + one.length <= st.width) return one
    return `[\n${parts.map((p) => `${inner}${p}`).join(',\n')}${st.trailing ? ',' : ''}\n${indent}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return '{}'
    const parts = entries.map(([k, v]) => `${st.key(k)}: ${pretty(v, st, inner)}`)
    const one = `{ ${parts.join(', ')} }`
    if (!one.includes('\n') && indent.length + one.length <= st.width) return one
    return `{\n${parts.map((p) => `${inner}${p}`).join(',\n')}${st.trailing ? ',' : ''}\n${indent}}`
  }
  throw new Error(`pretty: cannot write a ${typeof value}`)
}

/** The table's rows, as `table.ts` holds them. */
export const tableRows = (run: GateRun): CalibratedRow[] => run.rows.map((r) => tableRowOf(r, run.settings))

/** The content-addressed id of a set of rows under the engine's rev (§6.4): `v2-` and `rev32` of both. */
export const physIdOf = (rows: readonly CalibratedRow[]): string => `v2-${rev32({ rows, engine: ENGINE_V2_REV })}`

/** The text of `src/lib/world/physics/table.ts`: the rows, their content-addressed id, the measured in-box options and the inputs. */
export function renderTable(run: GateRun): string {
  const rows = tableRows(run)
  const claims = readInputClaims(run.protocol)
  const block = (v: unknown) => pretty(v, TS_STYLE)
  return [
    '/**',
    ' * GENERATED by `bun scripts/fit-physics.ts --write` (docs/specs/s5.md §5.8, §6.4; S5-07). Never edit by hand:',
    ' * `bun run verify:physics --full` regenerates this file in memory and fails on any difference.',
    ' *',
    ' * The frozen, content-addressed table `EngineV2` reads (I3: the engine never calls `claimNumber`). Each row is the fit on',
    ' * the fit subset F of one InferenceX sweep (vLLM 0.10.2, 2025-10-29) with its coverage box, step envelope, eligibility',
    ' * per metric and the figures an H4 label prints (errors are fractions: 0.113 is 11.3 %). `PHYS_ID` hashes the rows and',
    ' * the engine rev, so a refit, an input-claim change, a new snapshot or a scheduler change gives a new id. The harness',
    ' * term (`harnessMs`) is a fitted TTFT residual outside the engine (S5-D11), not physics.',
    ' */',
    '',
    "import type { CalibratedRow } from './types'",
    '',
    '/** One measured option of a row: an F point in its box. TPOT is the published mean, seconds. */',
    'export interface IxPoint {',
    '  id: string',
    '  tp: number',
    '  conc: number',
    '  isl: number',
    '  osl: number',
    '  tpot: number',
    '}',
    '',
    `export const FIT_STATUS = ${TS_STYLE.quote(FIT_STATUS)}`,
    '',
    `export const PHYS_ID = ${TS_STYLE.quote(physIdOf(rows))}`,
    '',
    "/** The sha256 of the extract, the engine rev and every input claim's value below: `verify:physics` recomputes it. */",
    `export const INPUT_HASH = ${TS_STYLE.quote(inputHashOf(run.extractSha256, claims))}`,
    '',
    `export const PHYSICS_ROWS: readonly CalibratedRow[] = ${block(rows)}`,
    '',
    '/** Measured TPOT per in-box F option of each row (H2: where every option is a published point, the engine must agree with it). */',
    `export const IX_INBOX: Readonly<Record<string, readonly IxPoint[]>> = ${block(ixInbox(run))}`,
    '',
    '/** The claims the fit read, with the value and `verifiedAt` they had: a claim that moved needs a refit, never a silent re-grade. */',
    `export const INPUT_CLAIMS: readonly { id: string; value: number | string; verifiedAt: string }[] = ${block(claims)}`,
    '',
  ].join('\n')
}

/* ------------------------------ the worked examples (§3.6, §3.7, S5-D59) ------------------------------ */

/** The Fleet's prefill chunk (`fleet-week.ts` CFG): v1 prefills 128 tokens a tick (§3.7 step 8). */
const V1_PREFILL_CHUNK = 128

/** Mean of the integers [⌊ratio·L⌋, L], the harness's uniform lengths. */
const meanLength = (L: number, ratio: number): number => (Math.floor(ratio * L) + L) / 2

export interface WorkedExample {
  id: string
  row: string
  /** what the published number is */
  metric: 'tpot' | 'ttft'
  tp: number
  conc: number
  isl: number
  osl: number
  /** the claim that holds the measured value */
  measuredClaim: string
  runUrl: string
  /** how the load was drawn, in words */
  derivation: string
  load: StepLoad
  /** the η = 1 card */
  napkin: StepCard
  napkinMs: number
  /** the fitted card (the table's parameters) */
  card: StepCard
  cardMs: number
  /** the row's TTFT residual, added to the card only when comparing with a published TTFT (S5-D11); 0 for a TPOT example */
  harnessMs: number
  cardPlusHarnessMs: number
  v1Ms: number
  measuredMs: number
  /** signed relative errors against the measured value */
  error: { napkin: number; card: number; cardPlusHarness: number; v1: number }
}

/**
 * Example A (id 41187, a decode step) and example B (id 40518, a prefill step): the loads of §3.6 and §3.7, priced by the
 * napkin card and by the table's card, beside v1's flat tick and the published value. The tab prints these (S5-D59).
 */
export function workedExamples(run: GateRun): WorkedExample[] {
  const ratio = run.settings.rangeRatio
  // a run over fewer rows than the protocol's (a test's) holds fewer examples; verify:physics requires both in the report
  return ([['41187', 'decode'], ['40518', 'prefill']] as const).flatMap(([id, mode]): WorkedExample[] => {
    const rowRun = run.rows.find((r) => r.sel.kept.some((p) => p.id === id))
    const point = rowRun?.sel.kept.find((p) => p.id === id)
    if (!rowRun || !point) return []
    const { chip, model } = rowRun.rr
    const { conc, decode_tp: tp } = point
    const inMean = meanLength(point.isl, ratio)
    const outMean = meanLength(point.osl, ratio)
    let load: StepLoad
    let derivation: string
    let v1Ms: number
    if (mode === 'decode') {
      // §3.6: a typical decoding sequence sits at the prompt mean plus half the output mean; every user is decoding
      const ctx = inMean + outMean / 2
      const kv = conc * ctx
      load = { seqs: conc, tokens: conc, kvTokens: kv, attnPairs: kv }
      derivation =
        `lengths uniform on [floor(${ratio} x L), L]: prompt mean ${inMean}, output mean ${outMean}; ${conc} users decode at context ${inMean} + ${outMean} / 2 = ${ctx}, ` +
        `so K = A = ${conc} x ${ctx} = ${kv}, T = seqs = ${conc}`
      v1Ms = SIM_TICK_SECONDS * 1e3
    } else {
      // §3.7: one prompt of the mean length prefills in one step (it fits the budget) beside the other users' decodes
      const p = Math.round(inMean)
      const half = Math.round(outMean / 2)
      const dctx = p + half
      const d = conc - 1
      load = { seqs: conc, tokens: p + d, kvTokens: p + d * dctx, attnPairs: (p * (p + 1)) / 2 + d * dctx }
      derivation =
        `lengths uniform on [floor(${ratio} x L), L]: prompt mean ${inMean}, taken as p = ${p}; it prefills in one step beside ${d} decodes at context ${p} + ${half} = ${dctx}, ` +
        `so T = ${load.tokens}, K = ${load.kvTokens}, A = ${p} x ${p + 1} / 2 + ${d} x ${dctx} = ${load.attnPairs}, seqs = ${conc}`
      v1Ms = (Math.ceil(p / V1_PREFILL_CHUNK) - 1) * SIM_TICK_SECONDS * 1e3
    }
    const napkin = stepCard(napkinSpec(chip, model), tp, load)
    const card = stepCard(rowRun.spec, tp, load)
    const measuredMs = (mode === 'decode' ? point.mean_tpot : point.median_ttft) * 1e3
    const harnessMs = mode === 'decode' ? 0 : rowRun.ev.full.harnessS * 1e3
    const cardMs = card.us / 1e3
    const napkinMs = napkin.stepS * 1e3
    const cp = { prow: rowRun.sel.prow, row: point }
    return [{
      id,
      row: rowRun.sel.prow.key,
      metric: mode === 'decode' ? 'tpot' : 'ttft',
      tp,
      conc,
      isl: point.isl,
      osl: point.osl,
      measuredClaim: mode === 'decode' ? tpotClaimId(cp) : ttftClaimId(cp),
      runUrl: point.run_url,
      derivation,
      load,
      napkin,
      napkinMs,
      card,
      cardMs,
      harnessMs,
      cardPlusHarnessMs: cardMs + harnessMs,
      v1Ms,
      measuredMs,
      error: {
        napkin: napkinMs / measuredMs - 1,
        card: cardMs / measuredMs - 1,
        cardPlusHarness: (cardMs + harnessMs) / measuredMs - 1,
        v1: v1Ms / measuredMs - 1,
      },
    }]
  })
}

/* ------------------------------ the report (§5.8) ------------------------------ */

export interface ReportPoint {
  id: string
  subset: 'F' | 'H'
  tp: number
  conc: number
  isl: number
  osl: number
  /** seconds */
  measTpot: number
  fullTpot: number
  /** F: the leave-one-out refit's prediction; H: the fit on all of F */
  outTpot: number
  tpotError: number
  measTtft: number
  fullTtft: number
  outTtft: number
  ttftError: number
  runUrl: string
}

export interface ReportStats {
  n: number
  mean: number
  p90: number
  max: number
}

export interface ReportGroup extends ReportStats {
  group: string
  fitted: number
  etaMem: number
  etaFlop: number
}

export interface ReportRow {
  key: string
  hardware: string
  precision: string
  status: 'calibrated' | 'failed'
  ttftEligible: boolean
  selected: number
  kept: number
  nFit: number
  nHeldOut: number
  dropped: { id: string; tp: number; conc: number; isl: number; osl: number; reasons: string[] }[]
  /** the fit on F; linkGBs is null when the fit has no link term */
  params: { etaMem: number; etaFlop: number; layerUs: number; seqUs: number; linkGBs: number | null; harnessMs: number }
  /** min and max over the n leave-one-out refits */
  refit: Record<'etaMem' | 'etaFlop' | 'layerUs' | 'seqUs' | 'linkGBs' | 'harnessMs', [number | null, number | null]>
  boundFlags: string[]
  gates: Record<'G1' | 'G2' | 'G3' | 'G4' | 'G5', { ok: boolean; detail: string }>
  stats: { g1: ReportStats; g2: ReportStats; g3: ReportStats; heldOutTtft: ReportStats }
  r1: {
    worst: { id: string; tp: number; conc: number; isl: number; osl: number; error: number; runUrl: string }[]
    lotpo: { groups: ReportGroup[]; all: ReportStats }
    loso: { groups: ReportGroup[]; all: ReportStats }
  }
  eligible: { tpot: boolean; ttft: boolean }
  box: CalibratedRow['box']
  envelope: RowEnvelope
  label: CalibratedRow['label']
  consistency: {
    id: string
    tp: number
    conc: number
    isl: number
    osl: number
    predTpotUs: number
    engineTpotUs: number
    predTtftUs: number
    engineTtftUs: number
    ttftBoundUs: number
    ok: boolean
  }[]
  points: ReportPoint[]
}

export interface Report {
  schema: 1
  fitStatus: string
  physId: string
  engineRev: string
  protocol: { id: string; version: number; sha256: string }
  extract: { sha256: string; rawSha256: string }
  nim: { sha256: string }
  inputHash: string
  settings: { batchTokens: number; blockSize: number; promptsPerConc: number; rangeRatio: number; gpuMemUtil: number }
  rows: ReportRow[]
  workedExamples: WorkedExample[]
  claimRounding: string
  /** every `phys.<row>.*` claim S5-07 owns, at its registered rounding: what `verify:claims` reproduces them from */
  claimValues: Record<string, number>
}

const finite = (x: number): number | null => (Number.isFinite(x) ? x : null)
const statsOf = (s: ReportStats): ReportStats => ({ n: s.n, mean: s.mean, p90: s.p90, max: s.max })

/** The claim rounding: η to the grid's 0.01, parameters to 0.1, percent to 0.1 (the figures the tab and the labels print). */
export const CLAIM_ROUNDING = 'eta-mem and eta-flop to 0.01; layer-us, seq-us, link-gbs and harness-ms to 0.1; the error statistics in percent to 0.1'
const round = (x: number, per: number): number => Math.round(x * per) / per

/** The six parameter claims and six gate-statistic claims each row owns (§4.5): 36 for the three rows. */
export const PARAM_CLAIMS = ['eta-mem', 'eta-flop', 'layer-us', 'seq-us', 'link-gbs', 'harness-ms'] as const
export const STAT_CLAIMS = ['loo-tpot-mean', 'loo-tpot-p90', 'heldout-tpot-mean', 'heldout-tpot-p90', 'loo-ttft8k-mean', 'loo-ttft8k-p90'] as const
export const physClaimId = (rowKey: string, name: (typeof PARAM_CLAIMS)[number] | (typeof STAT_CLAIMS)[number]): string => `phys.${rowKey}.${name}`

/** The values of a row's 12 claims at their registered rounding. Throws for a row with no link term (its claim has no value). */
export function claimValuesOf(row: Pick<ReportRow, 'key' | 'params' | 'stats'>): Record<string, number> {
  const p = row.params
  if (p.linkGBs === null) throw new Error(`${row.key}: the fit has no link term, so phys.${row.key}.link-gbs has no value`)
  const v: Record<(typeof PARAM_CLAIMS)[number] | (typeof STAT_CLAIMS)[number], number> = {
    'eta-mem': round(p.etaMem, 100),
    'eta-flop': round(p.etaFlop, 100),
    'layer-us': round(p.layerUs, 10),
    'seq-us': round(p.seqUs, 10),
    'link-gbs': round(p.linkGBs, 10),
    'harness-ms': round(p.harnessMs, 10),
    'loo-tpot-mean': round(100 * row.stats.g1.mean, 10),
    'loo-tpot-p90': round(100 * row.stats.g1.p90, 10),
    'heldout-tpot-mean': round(100 * row.stats.g2.mean, 10),
    'heldout-tpot-p90': round(100 * row.stats.g2.p90, 10),
    'loo-ttft8k-mean': round(100 * row.stats.g3.mean, 10),
    'loo-ttft8k-p90': round(100 * row.stats.g3.p90, 10),
  }
  return Object.fromEntries((Object.keys(v) as (keyof typeof v)[]).map((name) => [physClaimId(row.key, name), v[name]]))
}

export function reportRowOf(run: RowRun, settings: ReplaySettings): ReportRow {
  const { sel, ev } = run
  const runOf = new Map([...sel.fit, ...sel.heldOut].map((p) => [p.id, p.run_url]))
  const f = ev.full
  const group = (g: RowEvaluation['lotpo']['groups'][number]): ReportGroup => ({ group: g.group, fitted: g.fitted, ...statsOf(g.stats), etaMem: g.params.etaMem, etaFlop: g.params.etaFlop })
  const rng = (r: [number, number]): [number | null, number | null] => [finite(r[0]), finite(r[1])]
  const worst = ev.points
    .filter((p) => p.subset === 'F')
    .sort((a, b) => b.tpotError - a.tpotError || a.id.localeCompare(b.id))
    .slice(0, 3)
  const table = tableRowOf(run, settings)
  return {
    key: sel.prow.key,
    hardware: sel.prow.hardware,
    precision: sel.prow.precision,
    status: table.status,
    ttftEligible: ev.ttftEligible,
    selected: sel.selected.length,
    kept: sel.kept.length,
    nFit: sel.fit.length,
    nHeldOut: sel.heldOut.length,
    dropped: sel.dropped.map((d) => ({ id: d.row.id, tp: d.row.decode_tp, conc: d.row.conc, isl: d.row.isl, osl: d.row.osl, reasons: d.reasons })),
    params: { etaMem: f.etaMem, etaFlop: f.etaFlop, layerUs: f.layerUs, seqUs: f.seqUs, linkGBs: finite(linkGBsOf(f)), harnessMs: table.harnessMs },
    refit: {
      etaMem: rng(ev.ranges.etaMem),
      etaFlop: rng(ev.ranges.etaFlop),
      layerUs: rng(ev.ranges.layerUs),
      seqUs: rng(ev.ranges.seqUs),
      linkGBs: rng(ev.ranges.linkGBs),
      harnessMs: rng(ev.ranges.harnessMs),
    },
    boundFlags: ev.boundFlags,
    gates: {
      G1: { ok: ev.gates.G1.ok, detail: ev.gates.G1.detail },
      G2: { ok: ev.gates.G2.ok, detail: ev.gates.G2.detail },
      G3: { ok: ev.gates.G3.ok, detail: ev.gates.G3.detail },
      G4: { ok: ev.gates.G4.ok, detail: ev.gates.G4.detail },
      G5: { ok: ev.gates.G5.ok, detail: ev.gates.G5.detail },
    },
    stats: { g1: statsOf(ev.g1), g2: statsOf(ev.g2), g3: statsOf(ev.g3), heldOutTtft: statsOf(ev.heldOutTtft) },
    r1: {
      worst: worst.map((p) => ({ id: p.id, tp: p.tp, conc: p.conc, isl: p.isl, osl: p.osl, error: p.tpotError, runUrl: runOf.get(p.id) ?? '' })),
      lotpo: { groups: ev.lotpo.groups.map(group), all: statsOf(ev.lotpo.all) },
      loso: { groups: ev.loso.groups.map(group), all: statsOf(ev.loso.all) },
    },
    eligible: table.eligible,
    box: table.box,
    envelope: table.envelope,
    label: table.label,
    consistency: run.consistency.map((c) => ({
      id: c.id,
      tp: c.tp,
      conc: c.conc,
      isl: c.isl,
      osl: c.osl,
      predTpotUs: c.predTpotUs,
      engineTpotUs: c.engineTpotUs,
      predTtftUs: c.predTtftUs,
      engineTtftUs: c.engineTtftUs,
      ttftBoundUs: c.ttftBoundUs,
      ok: c.tpotOk && c.ttftOk,
    })),
    points: ev.points.map((p) => ({ ...p, runUrl: runOf.get(p.id) ?? '' })),
  }
}

/** The report (§5.8) as an object: everything `report.json` holds. */
export function buildReport(run: GateRun): Report {
  const rows = run.rows.map((r) => reportRowOf(r, run.settings))
  const claims = readInputClaims(run.protocol)
  const claimValues: Record<string, number> = {}
  for (const row of rows) Object.assign(claimValues, claimValuesOf(row))
  const s = run.settings
  return {
    schema: 1,
    fitStatus: FIT_STATUS,
    physId: physIdOf(tableRows(run)),
    engineRev: ENGINE_V2_REV,
    protocol: { id: run.protocol.id, version: run.protocol.version, sha256: run.protocolSha256 },
    extract: { sha256: run.extractSha256, rawSha256: run.protocol.snapshot.rawSha256 },
    nim: { sha256: readNim().sha256 },
    inputHash: inputHashOf(run.extractSha256, claims),
    settings: { batchTokens: s.batchTokens, blockSize: s.blockSize, promptsPerConc: s.promptsPerConc, rangeRatio: s.rangeRatio, gpuMemUtil: s.gpuMemUtil },
    rows,
    workedExamples: workedExamples(run),
    claimRounding: CLAIM_ROUNDING,
    claimValues,
  }
}

/** The text of `docs/physics/report.json`. */
export const renderReport = (run: GateRun): string => `${pretty(buildReport(run), JSON_STYLE)}\n`

export const TABLE_PATH = new URL('../src/lib/world/physics/table.ts', import.meta.url).pathname
export const REPORT_PATH = new URL('../docs/physics/report.json', import.meta.url).pathname

/* ------------------------------ the command line ------------------------------ */

function main(): void {
  const write = process.argv.includes('--write')
  const protocol = readProtocol()
  const out = (line: string) => console.log(line)
  const time = (line: string) => console.error(line)
  let run: GateRun
  try {
    run = runGate(protocol, time)
  } catch (e) {
    console.error(`fit-physics: ${e instanceof Error ? e.message : String(e)}; stopping`)
    process.exit(1)
  }
  const sel = run.rows.map((r) => r.sel)
  out(`${protocol.id} v${protocol.version} (${protocol.date}); extract ${run.extractSha256} (${readExtract().length} rows), the sha256 the dataset claim names`)
  out(`selection ${sel.map((s) => `${s.prow.key} ${s.selected.length}`).join(', ')}; dropped ${droppedIds(sel).join(', ')}`)
  const settings = run.settings
  out(`replay: ${settings.promptsPerConc}·c requests at t = 0, range ratio ${settings.rangeRatio}, budget ${settings.batchTokens}, block ${settings.blockSize}, pool at ${settings.gpuMemUtil} of HBM`)
  let failedConsistency = false
  for (const r of run.rows) {
    printRow(r.rr, r.ev, out)
    out(`  consistency (§5.6), EngineV2 with the fit on F and its integer-µs clock against the weighted sums:`)
    for (const c of r.consistency) {
      if (!c.tpotOk || !c.ttftOk) failedConsistency = true
      out(
        `  ${padR(c.id, 6)} TP ${c.tp} c ${pad(c.conc, 2)} ${padR(`${c.isl}/${c.osl}`, 9)} mean TPOT ${c.engineTpotUs.toFixed(4)} vs ${c.predTpotUs.toFixed(4)} µs ` +
          `(|Δ| ${Math.abs(c.engineTpotUs - c.predTpotUs).toFixed(4)} ≤ ${protocol.consistency.tpotMaxAbsUs}: ${c.tpotOk ? 'ok' : 'FAIL'}); ` +
          `median TTFT ${c.engineTtftUs.toFixed(4)} vs ${c.predTtftUs.toFixed(4)} µs (|Δ| ${Math.abs(c.engineTtftUs - c.predTtftUs).toFixed(4)} ≤ ${c.ttftBoundUs}: ${c.ttftOk ? 'ok' : 'FAIL'})`,
      )
    }
  }
  if (failedConsistency) {
    console.error('fit-physics: the consistency check failed (§5.6, §9.4 stop rule 2)')
    process.exit(1)
  }
  out('')
  out(`worked examples (the table's card beside the napkin, v1 and the published value):`)
  for (const w of workedExamples(run)) {
    const sign = (x: number) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)} %`
    out(
      `  ${w.id} ${w.row} TP ${w.tp} c ${w.conc} ${w.isl}/${w.osl} ${w.metric}: napkin ${w.napkinMs.toFixed(2)} ms (${sign(w.error.napkin)}), card ${w.cardMs.toFixed(2)} ms (${sign(w.error.card)})` +
        `${w.harnessMs > 0 ? `, card + harness ${w.cardPlusHarnessMs.toFixed(2)} ms (${sign(w.error.cardPlusHarness)})` : ''}, v1 ${w.v1Ms.toFixed(0)} ms (${sign(w.error.v1)}), measured ${w.measuredMs.toFixed(2)} ms`,
    )
  }
  out('')
  for (const r of run.rows) {
    out(`verdict ${r.sel.prow.key}: ${r.ev.calibrated ? 'calibrated' : 'failed'}${r.ev.calibrated ? (r.ev.ttftEligible ? ', TTFT eligible' : ', TTFT not eligible') : ''}`)
  }
  if (write) {
    writeFileSync(TABLE_PATH, renderTable(run))
    writeFileSync(REPORT_PATH, renderReport(run))
    out(`wrote ${TABLE_PATH} and ${REPORT_PATH}`)
  }
}

if (import.meta.main) main()
