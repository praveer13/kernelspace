/**
 * A proportion with its Wilson 95 % interval: what /me (vrk.ts, forms.ts, cold-checks.ts) and the partner report
 * (outcomes.ts) both show. It lives here so that outcomes.ts, which reads VRK30 and the forms, and the modules it reads
 * share it without importing each other.
 *
 * Pure: no clock, no randomness.
 */

import { wilson } from './calibration'

export interface Proportion {
  n: number
  correct: number
  rate: number | null
  /** Wilson 95 % interval; null with no trial. */
  ci95: [number, number] | null
}

/** `correct` of `n` with its Wilson 95 % interval; a null rate and interval with no trial. */
export function proportionOf(correct: number, n: number): Proportion {
  if (n === 0) return { n, correct, rate: null, ci95: null }
  const w = wilson(correct, n)
  return { n, correct, rate: correct / n, ci95: [w.lo, w.hi] }
}
