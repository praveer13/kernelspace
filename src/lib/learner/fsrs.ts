/**
 * FSRS-6 memory model, in-house (spec §6.1, ADR-2). Pure and deterministic.
 *
 * One card per KC, whole local days, no learning steps, no fuzz: only the memory model of
 * ts-fsrs 5.4.2 is here. The formulas and the `roundTo(x, 8)` points transcribe its
 * `FSRSAlgorithm.next_state` (short-term stability on, long-term scheduling), and
 * tests/fixtures/fsrs/reference-vectors.json holds what ts-fsrs produced, generated once by
 * scripts/gen-fsrs-vectors.ts. Do not "simplify" an operand order or a rounding point: the
 * tests compare to 1e-8 across 12-step replays.
 */

import type { MemoryState, Rating } from '@/lib/learner/types'

/** The 21 FSRS-6 default weights. w[20] is the forgetting-curve decay. */
export const W: readonly number[] = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]

/** Retention the interval is scheduled for when the caller gives none. */
export const DEFAULT_RETENTION = 0.9

const S_MIN = 0.001
const S_MAX = 36500
/** Longest interval in days (ts-fsrs `maximum_interval`). */
export const MAX_INTERVAL = 36500

const DECAY = -W[20]
/** F in R(t, S) = (1 + F·t/S)^(−w20), chosen so that R(S, S) = 0.9. */
const FACTOR = roundTo(Math.exp((1 / DECAY) * Math.log(0.9)) - 1, 8)

function roundTo(x: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(x * f) / f
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi)

/** Probability of recall `t` whole days after a review that left stability `s`. */
export function retrievability(t: number, s: number): number {
  return roundTo(Math.pow(1 + (FACTOR * Math.max(0, t)) / s, DECAY), 8)
}

/** D0(G), unclamped (the mean-reversion target is D0(Easy) as computed). */
function initDifficulty(g: Rating): number {
  return roundTo(W[4] - Math.exp((g - 1) * W[5]) + 1, 8)
}

function nextDifficulty(d: number, g: Rating): number {
  const delta = -W[6] * (g - 3)
  const damped = d + roundTo((delta * (10 - d)) / 9, 8)
  return clamp(roundTo(W[7] * initDifficulty(4) + (1 - W[7]) * damped, 8), 1, 10)
}

function recallStability(d: number, s: number, r: number, g: Rating): number {
  const hard = g === 2 ? W[15] : 1
  const easy = g === 4 ? W[16] : 1
  const grown =
    s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * hard * easy)
  return roundTo(clamp(grown, S_MIN, S_MAX), 8)
}

function lapseStability(d: number, s: number, r: number): number {
  const lapsed = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14])
  const afterLapse = roundTo(clamp(lapsed, S_MIN, S_MAX), 8)
  // A lapse never leaves the card more stable than a same-day Again would.
  return clamp(roundTo(s / Math.exp(W[17] * W[18]), 8), S_MIN, afterLapse)
}

function sameDayStability(s: number, g: Rating): number {
  const sinc = Math.pow(s, -W[19]) * Math.exp(W[17] * (g - 3 + W[18]))
  return roundTo(clamp(s * (g >= 2 ? Math.max(sinc, 1) : sinc), S_MIN, S_MAX), 8)
}

/**
 * The memory after a review graded `g`, `t` whole local days after the previous one (0 = same
 * day, the short-term formula). `prev` is null for a card's first review. A negative `t`
 * (clock or timezone skew in a replayed ledger) is treated as 0.
 */
export function nextMemory(prev: MemoryState | null, t: number, g: Rating): MemoryState {
  if (!prev) {
    return { stability: Math.max(W[g - 1], 0.1), difficulty: clamp(initDifficulty(g), 1, 10) }
  }
  const { stability: s, difficulty: d } = prev
  const days = Math.max(0, t)
  const r = retrievability(days, s)
  const stability =
    days === 0 ? sameDayStability(s, g) : g === 1 ? lapseStability(d, s, r) : recallStability(d, s, r, g)
  return { stability, difficulty: nextDifficulty(d, g) }
}

/**
 * Whole days until predicted recall falls to `retention`: S·(ρ^(−1/w20) − 1)/F, rounded, in
 * [1, MAX_INTERVAL]. `retention` must be in (0, 1].
 */
export function intervalDays(stability: number, retention: number = DEFAULT_RETENTION): number {
  if (!(retention > 0 && retention <= 1)) throw new RangeError(`retention ${retention} is outside (0, 1]`)
  const modifier = roundTo((Math.pow(retention, 1 / DECAY) - 1) / FACTOR, 8)
  return Math.min(Math.max(1, Math.round(stability * modifier)), MAX_INTERVAL)
}
