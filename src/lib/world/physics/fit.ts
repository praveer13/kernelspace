/**
 * The fit (docs/specs/s5.md §5.3 steps 4-7, §5.4, §5.5; S5-D7, S5-D35): grid + NNLS per row, leave-one-out over the fit
 * subset F, the held-out subset H, LOTPO and LOSO, and the gates G1-G5.
 *
 * Per row, five card parameters are fitted on F: η_m and η_f on the protocol's grid, and (t_layer, t_seq, 1/β) by
 * non-negative least squares on the relative TPOT error, every active set enumerated, once the η are fixed. The TPOT fit
 * starts at the protocol's η_f; then, for the protocol's number of rounds, every η_f on the grid is scored on the median
 * TTFT of every fit point with the harness term h in closed form (weighted least squares, clipped at 0), and the TPOT fit
 * runs again at the best η_f. h is a fitted TTFT residual, never physics (S5-D11).
 *
 * The expensive part of a TPOT prediction is the per-point kernel Σ_s w_s · max(memS_s, flopS_s), which depends only on
 * (η_m, η_f). It is memoised per row by its grid indices and shared by the fit and every LOO, LOTPO and LOSO refit
 * (protocol `fit.memo`), as is each request's window sum of the same max for the median TTFT. Everything else is linear:
 *   TPOT_i(θ) = kernel_i(η) + layerUs · fLayer_i + seqUs · fSeq_i + invLinkGBs · fLink_i
 * with fLayer = Σ_s w_s · layers ÷ 1e6, fSeq = Σ_s w_s · seqs_s ÷ 1e6 and fLink = Σ_s w_s · linkBytes_s ÷ 1e9, the card's
 * fixed and link terms (§3.2) summed with the TPOT weights; a TTFT window is the same with the window's steps.
 *
 * Pure and numeric-linted (§8.4): `+ − × ÷`, `Math.max`, `Math.abs`, `Math.floor` and `Math.ceil`, in a fixed order, so
 * two runs give the same bits. No constant of the protocol is written here: the grid, the rounds and the gate bounds
 * arrive as arguments (S5-D46).
 */

import { NAPKIN, stepCard } from './card'
import { medianOf } from './engine-v2'
import { loadAt, type StepLog } from './replay'
import type { CardParams, CardSpec, ChipShape, ModelShape } from './types'

const MICRO = 1e6
const GIGA = 1e9

/* ------------------------------ prepared points ------------------------------ */

/** One kept point, ready for the fit: the replay's steps priced in bytes and FLOPs, its weights, windows and features. */
export interface FitPoint {
  id: string
  tp: number
  conc: number
  isl: number
  osl: number
  /** published mean TPOT and median TTFT, seconds */
  measTpot: number
  measTtft: number
  steps: number
  /** per step, per GPU, as `stepCard` computes them */
  memBytes: Float64Array
  flops: Float64Array
  /** per step: w_s */
  weights: Float64Array
  /** the TPOT's linear features (seconds per µs of t_layer, per µs of t_seq, per s/GB of 1/β) */
  fLayer: number
  fSeq: number
  fLink: number
  /** per request: its window's first and last step, and the window's linear features */
  winStart: Int32Array
  winEnd: Int32Array
  wLayer: Float64Array
  wSeq: Float64Array
  wLink: Float64Array
}

/** Prices a replay's steps under a row's chip and model (the card's parameters are not read). */
export function preparePoint(log: StepLog, chip: ChipShape, model: ModelShape, meas: { tpot: number; ttft: number }): FitPoint {
  const spec: CardSpec = { chip, model, params: NAPKIN }
  const memBytes = new Float64Array(log.steps)
  const flops = new Float64Array(log.steps)
  const linkBytes = new Float64Array(log.steps)
  let sumW = 0
  let sumWSeq = 0
  let sumWLink = 0
  for (let s = 0; s < log.steps; s++) {
    const card = stepCard(spec, log.tp, loadAt(log, s))
    memBytes[s] = card.memBytes
    flops[s] = card.flops
    linkBytes[s] = card.linkBytes
    const w = log.weights[s]
    sumW += w
    sumWSeq += w * log.seqs[s]
    sumWLink += w * card.linkBytes
  }
  const R = log.requests
  const winStart = new Int32Array(R)
  const winEnd = new Int32Array(R)
  const wLayer = new Float64Array(R)
  const wSeq = new Float64Array(R)
  const wLink = new Float64Array(R)
  for (let r = 0; r < R; r++) {
    const a = log.admitStep[r]
    const f = log.firstStep[r]
    let seqSum = 0
    let linkSum = 0
    for (let s = a; s <= f; s++) {
      seqSum += log.seqs[s]
      linkSum += linkBytes[s]
    }
    winStart[r] = a
    winEnd[r] = f
    wLayer[r] = ((f - a + 1) * model.layers) / MICRO
    wSeq[r] = seqSum / MICRO
    wLink[r] = linkSum / GIGA
  }
  return {
    id: log.id,
    tp: log.tp,
    conc: log.conc,
    isl: log.isl,
    osl: log.osl,
    measTpot: meas.tpot,
    measTtft: meas.ttft,
    steps: log.steps,
    memBytes,
    flops,
    weights: log.weights,
    fLayer: (sumW * model.layers) / MICRO,
    fSeq: sumWSeq / MICRO,
    fLink: sumWLink / GIGA,
    winStart,
    winEnd,
    wLayer,
    wSeq,
    wLink,
  }
}

/* ------------------------------ a row and its memo ------------------------------ */

/** The protocol's grid and procedure (`fit.etaMem`, `fit.etaFlop` as values, `fit.etaFlopStart`, `fit.ttftRounds`). */
export interface FitGrid {
  etaMem: readonly number[]
  etaFlop: readonly number[]
  etaFlopStart: number
  ttftRounds: number
}

/** A row's points and the memo every refit of the row shares. */
export interface FitRow {
  chip: ChipShape
  model: ModelShape
  grid: FitGrid
  points: readonly FitPoint[]
  /** (η_m index, η_f index) → kernel per point */
  kernels: Map<number, Float64Array>
  /** (η_m index, η_f index) → per point, each request's window sum of max(memS, flopS) */
  windows: Map<number, Float64Array[]>
  /** how many kernels and window sets were computed (each once: the memo's size) */
  counts: { kernels: number; windows: number }
}

export function makeFitRow(chip: ChipShape, model: ModelShape, grid: FitGrid, points: readonly FitPoint[]): FitRow {
  if (grid.etaMem.length === 0 || grid.etaFlop.length === 0) throw new Error('fit: an empty grid')
  // indexOf rather than a negated includes: Tailwind scans src/, and the negation reads as an important `grid` utility
  if (grid.etaFlop.indexOf(grid.etaFlopStart) < 0) throw new Error(`fit: the starting η_f ${grid.etaFlopStart} is not on the grid`)
  if (!Number.isInteger(grid.ttftRounds) || grid.ttftRounds < 0) throw new Error(`fit: ttftRounds must be a whole number: ${grid.ttftRounds}`)
  return { chip, model, grid, points, kernels: new Map(), windows: new Map(), counts: { kernels: 0, windows: 0 } }
}

const memoKey = (row: FitRow, iM: number, iF: number): number => iM * row.grid.etaFlop.length + iF

/** Σ_s w_s · max(memS_s, flopS_s) for every point, at grid indices (iM, iF); memS and flopS exactly as `stepCard`. */
export function kernel(row: FitRow, iM: number, iF: number): Float64Array {
  const key = memoKey(row, iM, iF)
  const held = row.kernels.get(key)
  if (held) return held
  const dm = row.grid.etaMem[iM] * row.chip.bwBps
  const df = row.grid.etaFlop[iF] * row.chip.peakFlops
  const out = new Float64Array(row.points.length)
  row.points.forEach((p, i) => {
    let sum = 0
    for (let s = 0; s < p.steps; s++) sum += p.weights[s] * Math.max(p.memBytes[s] / dm, p.flops[s] / df)
    out[i] = sum
  })
  row.kernels.set(key, out)
  row.counts.kernels += 1
  return out
}

/** Per point, each request's Σ over its window of max(memS_s, flopS_s), at grid indices (iM, iF). */
export function windowMax(row: FitRow, iM: number, iF: number): Float64Array[] {
  const key = memoKey(row, iM, iF)
  const held = row.windows.get(key)
  if (held) return held
  const dm = row.grid.etaMem[iM] * row.chip.bwBps
  const df = row.grid.etaFlop[iF] * row.chip.peakFlops
  const out = row.points.map((p) => {
    const v = new Float64Array(p.winStart.length)
    for (let r = 0; r < v.length; r++) {
      let sum = 0
      for (let s = p.winStart[r]; s <= p.winEnd[r]; s++) sum += Math.max(p.memBytes[s] / dm, p.flops[s] / df)
      v[r] = sum
    }
    return v
  })
  row.windows.set(key, out)
  row.counts.windows += 1
  return out
}

/* ------------------------------ parameters and predictions ------------------------------ */

/** A fit's result: the grid indices and values, the linear terms and the harness term. */
export interface FitParams {
  iM: number
  iF: number
  etaMem: number
  etaFlop: number
  /** µs per layer per step */
  layerUs: number
  /** µs per running sequence per step */
  seqUs: number
  /** 1/β, s per GB; 0 means no link term */
  invLinkGBs: number
  /** the TTFT residual h, seconds (not physics; S5-D11) */
  harnessS: number
  /** the objectives at the result: TPOT's Σ (pred/meas − 1)², and the last TTFT round's (0 before any round) */
  tpotSse: number
  ttftSse: number
}

/** The card's parameters for a fit (β = 1 ÷ (1/β); no link term when 1/β is 0). */
export const cardParams = (p: FitParams): CardParams => ({
  etaMem: p.etaMem,
  etaFlop: p.etaFlop,
  layerUs: p.layerUs,
  seqUs: p.seqUs,
  linkGBs: p.invLinkGBs > 0 ? 1 / p.invLinkGBs : null,
})

/** Point i's mean TPOT under p, seconds. */
export function predTpot(row: FitRow, i: number, p: FitParams): number {
  const pt = row.points[i]
  return kernel(row, p.iM, p.iF)[i] + p.layerUs * pt.fLayer + p.seqUs * pt.fSeq + p.invLinkGBs * pt.fLink
}

/** Point i's engine median TTFT from admission under p, seconds, without the harness term. */
export function engineTtft(row: FitRow, i: number, p: Pick<FitParams, 'iM' | 'iF' | 'layerUs' | 'seqUs' | 'invLinkGBs'>): number {
  const pt = row.points[i]
  const m = windowMax(row, p.iM, p.iF)[i]
  const v: number[] = new Array(m.length)
  for (let r = 0; r < m.length; r++) v[r] = m[r] + p.layerUs * pt.wLayer[r] + p.seqUs * pt.wSeq[r] + p.invLinkGBs * pt.wLink[r]
  return medianOf(v)
}

/** Point i's median TTFT as compared with the published one: the engine's plus the harness term, seconds. */
export const predTtft = (row: FitRow, i: number, p: FitParams): number => engineTtft(row, i, p) + p.harnessS

/* ------------------------------ NNLS ------------------------------ */

export interface NnlsResult {
  x: number[]
  sse: number
}

/**
 * min Σ_i ((c_i + Σ_j x_j · F_ij) ÷ y_i − 1)² over x ≥ 0, exactly: every active set (mask 0 … 2^k − 1, in order) is
 * solved by its normal equations (Gaussian elimination with partial pivoting); a set with a negative solution, a singular
 * system or a feature that is zero on every row is skipped; the lowest objective wins, the first on a tie. The minimum of
 * a convex quadratic over the orthant is the unconstrained minimum on its own support, so one of the sets reaches it.
 */
export function nnls(F: readonly (readonly number[])[], c: readonly number[], y: readonly number[]): NnlsResult {
  const n = y.length
  const k = n > 0 ? F[0].length : 0
  const zero = Array.from({ length: k }, (_, j) => F.every((row) => row[j] === 0))
  const sseOf = (x: readonly number[]): number => {
    let sse = 0
    for (let i = 0; i < n; i++) {
      let pred = c[i]
      for (let j = 0; j < k; j++) pred += x[j] * F[i][j]
      const e = pred / y[i] - 1
      sse += e * e
    }
    return sse
  }
  let best: NnlsResult = { x: new Array(k).fill(0), sse: sseOf(new Array(k).fill(0)) }
  for (let mask = 1; mask < 1 << k; mask++) {
    const idx: number[] = []
    let skip = false
    for (let j = 0; j < k; j++) {
      if (!(mask & (1 << j))) continue
      if (zero[j]) skip = true
      idx.push(j)
    }
    if (skip) continue
    const m = idx.length
    // normal equations of the relative residual: u_ij = F_ij / y_i, target 1 − c_i / y_i
    const M: number[][] = Array.from({ length: m }, () => new Array(m + 1).fill(0))
    for (let i = 0; i < n; i++) {
      const t = 1 - c[i] / y[i]
      for (let p = 0; p < m; p++) {
        const up = F[i][idx[p]] / y[i]
        M[p][m] += up * t
        for (let q = 0; q < m; q++) M[p][q] += up * (F[i][idx[q]] / y[i])
      }
    }
    const sol = solve(M)
    if (!sol || sol.some((v) => v < 0)) continue
    const x = new Array(k).fill(0)
    idx.forEach((j, p) => {
      x[j] = sol[p]
    })
    const sse = sseOf(x)
    if (sse < best.sse) best = { x, sse }
  }
  return best
}

/** Solves an augmented m × (m + 1) system in place; null when singular. */
function solve(M: number[][]): number[] | null {
  const m = M.length
  for (let p = 0; p < m; p++) {
    let piv = p
    for (let q = p + 1; q < m; q++) if (Math.abs(M[q][p]) > Math.abs(M[piv][p])) piv = q
    if (M[piv][p] === 0) return null
    if (piv !== p) {
      const tmp = M[p]
      M[p] = M[piv]
      M[piv] = tmp
    }
    for (let q = p + 1; q < m; q++) {
      const f = M[q][p] / M[p][p]
      for (let r = p; r <= m; r++) M[q][r] -= f * M[p][r]
    }
  }
  const x = new Array(m).fill(0)
  for (let p = m - 1; p >= 0; p--) {
    let s = M[p][m]
    for (let q = p + 1; q < m; q++) s -= M[p][q] * x[q]
    x[p] = s / M[p][p]
  }
  return x
}

/* ------------------------------ the procedure ------------------------------ */

/** The TPOT fit at a fixed η_f: every η_m on the grid, NNLS for the linear terms; the lowest objective wins, the first on a tie. */
export function fitTpot(row: FitRow, use: readonly number[], iF: number): FitParams {
  const y = use.map((i) => row.points[i].measTpot)
  const F = use.map((i) => {
    const p = row.points[i]
    return [p.fLayer, p.fSeq, p.fLink]
  })
  let best: FitParams | null = null
  for (let iM = 0; iM < row.grid.etaMem.length; iM++) {
    const k = kernel(row, iM, iF)
    const r = nnls(F, use.map((i) => k[i]), y)
    if (best === null || r.sse < best.tpotSse) {
      best = {
        iM,
        iF,
        etaMem: row.grid.etaMem[iM],
        etaFlop: row.grid.etaFlop[iF],
        layerUs: r.x[0],
        seqUs: r.x[1],
        invLinkGBs: r.x[2],
        harnessS: 0,
        tpotSse: r.sse,
        ttftSse: 0,
      }
    }
  }
  if (best === null) throw new Error('fit: no η_m on the grid')
  return best
}

/**
 * The closed-form harness term: argmin over h of Σ ((e_i + h) ÷ y_i − 1)², clipped at 0 (protocol `fit.harness`).
 * Returns h and the objective at it.
 */
export function harnessTerm(engine: readonly number[], y: readonly number[]): { h: number; sse: number } {
  let num = 0
  let den = 0
  for (let i = 0; i < y.length; i++) {
    num += (1 - engine[i] / y[i]) / y[i]
    den += 1 / (y[i] * y[i])
  }
  const h = den > 0 ? Math.max(0, num / den) : 0
  let sse = 0
  for (let i = 0; i < y.length; i++) {
    const e = (engine[i] + h) / y[i] - 1
    sse += e * e
  }
  return { h, sse }
}

/** One TTFT round: every η_f on the grid at p's η_m and linear terms, h in closed form; the lowest TTFT objective wins. */
export function fitTtft(row: FitRow, use: readonly number[], p: FitParams): { iF: number; harnessS: number; sse: number } {
  const y = use.map((i) => row.points[i].measTtft)
  let best: { iF: number; harnessS: number; sse: number } | null = null
  for (let iF = 0; iF < row.grid.etaFlop.length; iF++) {
    const q = { ...p, iF }
    const eng = use.map((i) => engineTtft(row, i, q))
    const { h, sse } = harnessTerm(eng, y)
    if (best === null || sse < best.sse) best = { iF, harnessS: h, sse }
  }
  if (best === null) throw new Error('fit: no η_f on the grid')
  return best
}

/** The whole procedure on the points `use` (indices into row.points), in the protocol's order (§5.3 step 4). */
export function fit(row: FitRow, use: readonly number[]): FitParams {
  if (use.length === 0) throw new Error('fit: no points')
  let p = fitTpot(row, use, row.grid.etaFlop.indexOf(row.grid.etaFlopStart))
  for (let round = 0; round < row.grid.ttftRounds; round++) {
    const t = fitTtft(row, use, p)
    p = { ...fitTpot(row, use, t.iF), harnessS: t.harnessS, ttftSse: t.sse }
  }
  return p
}

/* ------------------------------ statistics ------------------------------ */

/** |pred ÷ meas − 1| (protocol `stats.error`). */
export const relError = (pred: number, meas: number): number => Math.abs(pred / meas - 1)

export interface ErrorStats {
  n: number
  mean: number
  p90: number
  max: number
}

/** Mean, nearest-rank p90 (`sorted[⌈0.9·n⌉ − 1]`) and max of a set of errors (protocol `stats`); zeros when empty. */
export function errorStats(errors: readonly number[]): ErrorStats {
  const n = errors.length
  if (n === 0) return { n: 0, mean: 0, p90: 0, max: 0 }
  const s = [...errors].sort((a, b) => a - b)
  let sum = 0
  for (const e of errors) sum += e
  return { n, mean: sum / n, p90: s[Math.ceil((9 * n) / 10) - 1], max: s[n - 1] }
}

/* ------------------------------ a row's evaluation ------------------------------ */

/** The protocol's gate bounds (`gates`), structurally. */
export interface GateRules {
  G1: { meanMax: number; p90Max: number }
  G2: { meanMax: number; p90Max: number }
  G3: { meanMax: number }
  G4: {
    etaMem: readonly [number, number]
    etaFlop: readonly [number, number]
    layerUsMax: number
    seqUsMax: number
    linkGBsMax: number
    harnessMsMax: number
  }
  G5: { fitPointsMin: number; tpValuesMin: number; concValuesMin: number; shapesMin: number; shapeRequired: readonly [number, number] }
}

/** How a row splits and which of its points G3 reads. */
export interface RowSplit {
  /** indices into row.points */
  fit: readonly number[]
  heldOut: readonly number[]
  /** the ISL of the prefill-dominated points G3 scores (protocol `gates.G3.population`) */
  ttftIsl: number
}

export interface PointResult {
  id: string
  subset: 'F' | 'H'
  tp: number
  conc: number
  isl: number
  osl: number
  measTpot: number
  /** the fit on all of F */
  fullTpot: number
  /** F: the leave-one-out refit's; H: the fit on all of F (held out) */
  outTpot: number
  tpotError: number
  measTtft: number
  fullTtft: number
  outTtft: number
  ttftError: number
}

export interface GroupResult {
  /** 'TP 4', '1024/8192' */
  group: string
  /** points fitted (F outside the group) and predicted (every kept point of the group) */
  fitted: number
  stats: ErrorStats
  params: FitParams
}

export interface GateCheck {
  ok: boolean
  /** what was measured, in words */
  detail: string
}

export interface RowEvaluation {
  full: FitParams
  points: PointResult[]
  /** the refit without each F point, in F order */
  loo: FitParams[]
  g1: ErrorStats
  g2: ErrorStats
  /** G3's population: leave-one-out TTFT on F's points at the TTFT ISL, harness term added */
  g3: ErrorStats
  /** printed beside G3: the full fit on H's points at the TTFT ISL */
  heldOutTtft: ErrorStats
  lotpo: { groups: GroupResult[]; all: ErrorStats }
  loso: { groups: GroupResult[]; all: ErrorStats }
  gates: { G1: GateCheck; G2: GateCheck; G3: GateCheck; G4: GateCheck; G5: GateCheck }
  /** parameters at a fit bound (a flag on the tab, not a failure) */
  boundFlags: string[]
  /** min and max of each parameter over the LOO refits */
  ranges: Record<'etaMem' | 'etaFlop' | 'layerUs' | 'seqUs' | 'linkGBs' | 'harnessMs', [number, number]>
  calibrated: boolean
  ttftEligible: boolean
}

const fmt = (x: number, digits: number): string => x.toFixed(digits)
const pct = (x: number): string => `${fmt(100 * x, 1)} %`

/** β in GB/s, Infinity when there is no link term. */
export const linkGBsOf = (p: FitParams): number => (p.invLinkGBs > 0 ? 1 / p.invLinkGBs : Infinity)

/** Leave-one-out over `fitIdx`: the whole procedure refitted on F \ {i} for each i, in order (§5.5). */
export function leaveOneOut(row: FitRow, fitIdx: readonly number[]): FitParams[] {
  return fitIdx.map((i) => fit(row, fitIdx.filter((j) => j !== i)))
}

/** Refit without one group of F, predict every kept point of the group (LOTPO, LOSO). */
function leaveGroupOut(row: FitRow, split: RowSplit, groupOf: (i: number) => string, order: readonly string[]): { groups: GroupResult[]; all: ErrorStats } {
  const all: number[] = []
  const groups: GroupResult[] = []
  const kept = [...split.fit, ...split.heldOut]
  for (const g of order) {
    const use = split.fit.filter((i) => groupOf(i) !== g)
    const target = kept.filter((i) => groupOf(i) === g).sort((a, b) => a - b)
    if (use.length === 0 || target.length === 0) continue
    const params = fit(row, use)
    const errs = target.map((i) => relError(predTpot(row, i, params), row.points[i].measTpot))
    all.push(...errs)
    groups.push({ group: g, fitted: use.length, stats: errorStats(errs), params })
  }
  return { groups, all: errorStats(all) }
}

const distinctSorted = (xs: readonly number[]): number[] => [...new Set(xs)].sort((a, b) => a - b)

/** Everything §5.3-5.5 computes for one row, and G1-G5 under `rules`. */
export function evaluateRow(row: FitRow, split: RowSplit, rules: GateRules): RowEvaluation {
  const P = row.points
  const full = fit(row, split.fit)
  const loo = leaveOneOut(row, split.fit)
  const points: PointResult[] = []
  const g1: number[] = []
  const g2: number[] = []
  const g3: number[] = []
  const h3: number[] = []
  split.fit.forEach((i, k) => {
    const pt = P[i]
    const out = loo[k]
    const outTpot = predTpot(row, i, out)
    const outTtft = predTtft(row, i, out)
    const r: PointResult = {
      id: pt.id, subset: 'F', tp: pt.tp, conc: pt.conc, isl: pt.isl, osl: pt.osl,
      measTpot: pt.measTpot, fullTpot: predTpot(row, i, full), outTpot, tpotError: relError(outTpot, pt.measTpot),
      measTtft: pt.measTtft, fullTtft: predTtft(row, i, full), outTtft, ttftError: relError(outTtft, pt.measTtft),
    }
    points.push(r)
    g1.push(r.tpotError)
    if (pt.isl === split.ttftIsl) g3.push(r.ttftError)
  })
  for (const i of split.heldOut) {
    const pt = P[i]
    const outTpot = predTpot(row, i, full)
    const outTtft = predTtft(row, i, full)
    const r: PointResult = {
      id: pt.id, subset: 'H', tp: pt.tp, conc: pt.conc, isl: pt.isl, osl: pt.osl,
      measTpot: pt.measTpot, fullTpot: outTpot, outTpot, tpotError: relError(outTpot, pt.measTpot),
      measTtft: pt.measTtft, fullTtft: outTtft, outTtft, ttftError: relError(outTtft, pt.measTtft),
    }
    points.push(r)
    g2.push(r.tpotError)
    if (pt.isl === split.ttftIsl) h3.push(r.ttftError)
  }
  const tps = distinctSorted(split.fit.map((i) => P[i].tp))
  const lotpo = leaveGroupOut(row, split, (i) => `TP ${P[i].tp}`, tps.map((t) => `TP ${t}`))
  const shapeOf = (i: number) => `${P[i].isl}/${P[i].osl}`
  const shapes = [...new Set(split.fit.map((i) => `${P[i].isl}/${P[i].osl}`))].sort((a, b) => {
    const [ai, ao] = a.split('/').map(Number)
    const [bi, bo] = b.split('/').map(Number)
    return ai - bi || ao - bo
  })
  const loso = leaveGroupOut(row, split, shapeOf, shapes)

  const s1 = errorStats(g1)
  const s2 = errorStats(g2)
  const s3 = errorStats(g3)
  const G1: GateCheck = {
    ok: s1.n > 0 && s1.mean <= rules.G1.meanMax && s1.p90 <= rules.G1.p90Max,
    detail: `TPOT LOO over F: n ${s1.n}, mean ${pct(s1.mean)} (≤ ${pct(rules.G1.meanMax)}), p90 ${pct(s1.p90)} (≤ ${pct(rules.G1.p90Max)})`,
  }
  const G2: GateCheck = {
    ok: s2.n > 0 && s2.mean <= rules.G2.meanMax && s2.p90 <= rules.G2.p90Max,
    detail: `TPOT held out (H): n ${s2.n}, mean ${pct(s2.mean)} (≤ ${pct(rules.G2.meanMax)}), p90 ${pct(s2.p90)} (≤ ${pct(rules.G2.p90Max)})`,
  }
  const G3: GateCheck = {
    ok: s3.n > 0 && s3.mean <= rules.G3.meanMax,
    detail: `median TTFT LOO over F at ISL ${split.ttftIsl}, harness term added: n ${s3.n}, mean ${pct(s3.mean)} (≤ ${pct(rules.G3.meanMax)})`,
  }
  const g4 = rules.G4
  const beta = linkGBsOf(full)
  const harnessMs = full.harnessS * 1e3
  const g4Fails: string[] = []
  if (!(full.etaMem >= g4.etaMem[0] && full.etaMem <= g4.etaMem[1])) g4Fails.push(`η_m ${full.etaMem} outside [${g4.etaMem[0]}, ${g4.etaMem[1]}]`)
  if (!(full.etaFlop >= g4.etaFlop[0] && full.etaFlop <= g4.etaFlop[1])) g4Fails.push(`η_f ${full.etaFlop} outside [${g4.etaFlop[0]}, ${g4.etaFlop[1]}]`)
  if (!(full.layerUs <= g4.layerUsMax)) g4Fails.push(`t_layer ${fmt(full.layerUs, 1)} µs > ${g4.layerUsMax}`)
  if (!(full.seqUs <= g4.seqUsMax)) g4Fails.push(`t_seq ${fmt(full.seqUs, 1)} µs > ${g4.seqUsMax}`)
  if (!(beta <= g4.linkGBsMax)) g4Fails.push(`β ${fmt(beta, 0)} GB/s > ${g4.linkGBsMax}`)
  if (!(harnessMs <= g4.harnessMsMax)) g4Fails.push(`harness ${fmt(harnessMs, 1)} ms > ${g4.harnessMsMax}`)
  const G4: GateCheck = {
    ok: g4Fails.length === 0,
    detail:
      `η_m ${fmt(full.etaMem, 2)}, η_f ${fmt(full.etaFlop, 2)}, t_layer ${fmt(full.layerUs, 1)} µs, t_seq ${fmt(full.seqUs, 1)} µs, ` +
      `β ${fmt(beta, 0)} GB/s, harness ${fmt(harnessMs, 1)} ms` + (g4Fails.length ? `; fails: ${g4Fails.join('; ')}` : ''),
  }
  const g5 = rules.G5
  const fitPts = split.fit.map((i) => P[i])
  const nShapes = new Set(fitPts.map((p) => `${p.isl}/${p.osl}`)).size
  const nTps = new Set(fitPts.map((p) => p.tp)).size
  const nConcs = new Set(fitPts.map((p) => p.conc)).size
  const hasRequired = fitPts.some((p) => p.isl === g5.shapeRequired[0] && p.osl === g5.shapeRequired[1])
  const G5: GateCheck = {
    ok: fitPts.length >= g5.fitPointsMin && nTps >= g5.tpValuesMin && nConcs >= g5.concValuesMin && nShapes >= g5.shapesMin && hasRequired,
    detail:
      `n_F ${fitPts.length} (≥ ${g5.fitPointsMin}), TPs ${nTps} (≥ ${g5.tpValuesMin}), concurrencies ${nConcs} (≥ ${g5.concValuesMin}), ` +
      `shapes ${nShapes} (≥ ${g5.shapesMin}), ${g5.shapeRequired[0]}/${g5.shapeRequired[1]} ${hasRequired ? 'present' : 'missing'}`,
  }
  const grid = row.grid
  const boundFlags: string[] = []
  if (full.iM === 0 || full.iM === grid.etaMem.length - 1) boundFlags.push(`η_m at its bound ${full.etaMem}`)
  if (full.iF === 0 || full.iF === grid.etaFlop.length - 1) boundFlags.push(`η_f at its bound ${full.etaFlop}`)
  if (full.layerUs === 0) boundFlags.push('t_layer at 0')
  if (full.seqUs === 0) boundFlags.push('t_seq at 0')
  if (full.invLinkGBs === 0) boundFlags.push('1/β at 0 (no link term)')
  if (full.harnessS === 0) boundFlags.push('harness term at 0')
  const range = (f: (p: FitParams) => number): [number, number] => {
    const v = loo.map(f)
    return v.length ? [Math.min(...v), Math.max(...v)] : [f(full), f(full)]
  }
  return {
    full,
    points,
    loo,
    g1: s1,
    g2: s2,
    g3: s3,
    heldOutTtft: errorStats(h3),
    lotpo,
    loso,
    gates: { G1, G2, G3, G4, G5 },
    boundFlags,
    ranges: {
      etaMem: range((p) => p.etaMem),
      etaFlop: range((p) => p.etaFlop),
      layerUs: range((p) => p.layerUs),
      seqUs: range((p) => p.seqUs),
      linkGBs: range(linkGBsOf),
      harnessMs: range((p) => p.harnessS * 1e3),
    },
    calibrated: G1.ok && G2.ok && G4.ok && G5.ok,
    ttftEligible: G1.ok && G2.ok && G4.ok && G5.ok && G3.ok,
  }
}
