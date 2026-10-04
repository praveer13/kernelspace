/**
 * V2 calibration (spec §12.1, Addendum A3). Pure functions over ledger events.
 *
 * Confidence is optional and never gates anything: an answer with no `conf` is not a wrong
 * answer and not a right one, it is simply left out of every number here. Confidence is stored
 * categorically on the event; the probability mapping below is applied only when reading.
 */

import type { Confidence, IsoInstant, LedgerEvent } from '@/lib/ledger/types'

/** Mapping v1 (Addendum A3, Q4). */
export const CONFIDENCE_P: Readonly<Record<Confidence, number>> = { guess: 0.33, think: 0.67, sure: 0.95 }

/** Bins in ascending confidence. */
export const CONFIDENCE_LEVELS: readonly Confidence[] = ['guess', 'think', 'sure']

/** What the picker offers, in key order: keys 1, 2 and 3 choose these. */
export const CONFIDENCE_CHOICES: readonly { value: Confidence; label: string }[] = [
  { value: 'guess', label: 'guess' },
  { value: 'think', label: 'think so' },
  { value: 'sure', label: 'sure' },
]

/** Rated answers needed before a calibration line is worth showing. */
export const CALIBRATION_MIN_N = 20

/** z for a two-sided 95% interval. */
const Z95 = 1.959963984540054

export interface WilsonInterval {
  lo: number
  hi: number
}

/** Wilson score interval for `k` successes in `n` trials. With no trials it is the whole of [0, 1]. */
export function wilson(k: number, n: number, z = Z95): WilsonInterval {
  if (n <= 0) return { lo: 0, hi: 1 }
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) }
}

export interface CalibrationBin extends WilsonInterval {
  conf: Confidence
  /** The probability this bin stands for. */
  p: number
  n: number
  correct: number
  /** `correct / n`, or null for an empty bin. */
  accuracy: number | null
}

export interface Calibration {
  /** Rated answers counted. */
  n: number
  bins: CalibrationBin[]
  /** mean((p - ok)^2); 0 when n = 0. */
  brier: number
  /** Σ (n_k/N)(p_k − ō_k)² */
  reliability: number
  /** Σ (n_k/N)(ō_k − ō)² */
  resolution: number
  /** ō(1 − ō) */
  uncertainty: number
  /** mean(p) − mean(ok): positive is overconfident. */
  bias: number
  /** Answers rated *sure* that were wrong. */
  sureWrong: number
}

export interface CalibrationOptions {
  /** Count only events at or after this instant. */
  since?: IsoInstant
}

const RATED_KINDS: ReadonlySet<string> = new Set(['item', 'probe', 'predict'])

/** The confidence a graded event carries, or undefined when it is unrated (or not a known level). */
function ratedConf(e: LedgerEvent): Confidence | undefined {
  if (!RATED_KINDS.has(e.kind)) return undefined
  const c = (e as { conf?: unknown }).conf
  return c === 'guess' || c === 'think' || c === 'sure' ? c : undefined
}

/**
 * Calibration over the `item`, `probe` and `predict` events that carry `conf`. Unrated answers are excluded.
 * `brier = reliability − resolution + uncertainty` holds exactly, because `p` is constant within each bin.
 */
export function selectCalibration(events: Iterable<LedgerEvent>, opts: CalibrationOptions = {}): Calibration {
  const count = { guess: 0, think: 0, sure: 0 }
  const right = { guess: 0, think: 0, sure: 0 }
  for (const e of events) {
    const conf = ratedConf(e)
    if (conf === undefined) continue
    if (opts.since !== undefined && !(e.at >= opts.since)) continue
    count[conf]++
    if ((e as { ok?: boolean }).ok === true) right[conf]++
  }
  const bins: CalibrationBin[] = CONFIDENCE_LEVELS.map((conf) => ({
    conf,
    p: CONFIDENCE_P[conf],
    n: count[conf],
    correct: right[conf],
    accuracy: count[conf] > 0 ? right[conf] / count[conf] : null,
    ...wilson(right[conf], count[conf]),
  }))
  const n = bins.reduce((s, b) => s + b.n, 0)
  if (n === 0) {
    return { n, bins, brier: 0, reliability: 0, resolution: 0, uncertainty: 0, bias: 0, sureWrong: 0 }
  }
  const correct = bins.reduce((s, b) => s + b.correct, 0)
  const meanOk = correct / n
  let brier = 0
  let reliability = 0
  let resolution = 0
  let meanP = 0
  for (const b of bins) {
    if (b.n === 0) continue
    const wk = b.n / n
    const okBar = b.correct / b.n
    // squared error over this bin's answers: `correct` of them at (p − 1)², the rest at p²
    brier += (b.correct * (b.p - 1) ** 2 + (b.n - b.correct) * b.p ** 2) / n
    reliability += wk * (b.p - okBar) ** 2
    resolution += wk * (okBar - meanOk) ** 2
    meanP += wk * b.p
  }
  return {
    n,
    bins,
    brier,
    reliability,
    resolution,
    uncertainty: meanOk * (1 - meanOk),
    bias: meanP - meanOk,
    sureWrong: bins[2].n - bins[2].correct,
  }
}

/** The *sure* bin as "18/20", once enough answers are rated; null before that or with no *sure* answers. */
export function sureSummary(cal: Calibration): { correct: number; n: number } | null {
  const sure = cal.bins[2]
  if (cal.n < CALIBRATION_MIN_N || sure.n === 0) return null
  return { correct: sure.correct, n: sure.n }
}
