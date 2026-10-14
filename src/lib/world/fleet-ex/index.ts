/**
 * Fleet exercises (docs/specs/wave-3.md §5.3): a seeded sweep of the Fleet engine at several points, and the one
 * number a learner predicts from it. 3a-03 created the contract, 3b-03 adds `knee` and `pd-split`. The fleet worker's
 * `exercise` job dispatches by id (`FLEET_EXERCISES[id].sweep(seed)`), so a later exercise adds a module and a table
 * entry here and never edits the protocol, the host or the session.
 */

import type { KcId } from '@/lib/kc/types'
import { kneeExercise } from './knee'
import { pdSplitExercise } from './pd-split'

export interface SweepPoint {
  /** The swept value: a load multiplier, a prefill-worker count. */
  x: number
  /** SLO-met requests ÷ the trace's arrival window in seconds (50 ms per tick); never `Engine.goodput()`'s percentage. */
  goodputRps: number
  ttftP95: number
  tpotP95?: number
  /** Anything else an exercise reads (speedup, idle share, hit rate). */
  metrics?: Record<string, number>
}

export interface SweepResult {
  points: SweepPoint[]
}

export interface FleetExerciseDef {
  /** `knee` | `pd-split` (stretch adds four, §16.3). */
  id: string
  title: string
  lessonId: string
  kcs: KcId[]
  /** What the learner predicts. */
  unit: string
  /** The sweep, e.g. load multipliers or prefill-worker counts. */
  points: readonly number[]
  /** Pure and deterministic: runs the Fleet engine classes at each point, or a stated model the engine cannot express (labelled so). */
  sweep(seed: number): SweepResult
  /** The right answer for this seed's run. */
  truth(results: SweepResult): number
  /** The seed is a fair question. */
  band(results: SweepResult): boolean
  /** The pass rule: this prediction is right for this seed's run. */
  pass(prediction: number, results: SweepResult): boolean
  /** Rows of the In-production card. */
  productionClaims: string[]
  /** Phone mode's outcome. */
  phone: { canonical: SweepResult }
}

/** The hands-on test counts a fleet block whose exercise is listed here; a later exercise adds an entry. */
export const FLEET_EXERCISES: Readonly<Record<string, FleetExerciseDef>> = {
  [kneeExercise.id]: kneeExercise,
  [pdSplitExercise.id]: pdSplitExercise,
}
