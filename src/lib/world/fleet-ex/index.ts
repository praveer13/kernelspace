/**
 * Fleet exercises (docs/specs/wave-3.md §5.3): a seeded sweep of the Fleet engine at several points, and the one
 * number a learner predicts from it. 3a-03 created the contract, 3b-03 adds `knee` and `pd-split`, 3s-04 `broken-bench` and
 * `push-luck` (§16.3; the second is model-only). The fleet worker's
 * `exercise` job dispatches by id (`FLEET_EXERCISES[id].sweep(seed)`), so a later exercise adds a module and a table
 * entry here and never edits the protocol, the host or the session.
 */

import type { KcId } from '@/lib/kc/types'
import { brokenBenchExercise } from './broken-bench'
import { kneeExercise } from './knee'
import { pdSplitExercise } from './pd-split'
import { pushLuckExercise } from './push-luck'

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

/**
 * One input of a seed's run that the learner reads before predicting: something the seed drew, never a number the
 * sweep measures. The answer follows from these by reasoning (Little's law, the slower stage), not by reading it off.
 */
export interface SceneFact {
  label: string
  value: number
  /** The top of a range (prompts 1,792 … 2,815), when the fact is one. */
  to?: number
  unit: string
}

export interface FleetExerciseDef {
  /** `knee` | `pd-split` | `broken-bench` | `push-luck` (stretch adds two more, §16.3). */
  id: string
  title: string
  lessonId: string
  kcs: KcId[]
  /** What the learner predicts. */
  unit: string
  /** The sweep, e.g. load multipliers or prefill-worker counts. */
  points: readonly number[]
  /**
   * Absent: the prediction is one of `points`. Present (the broken benchmark, §16.3): a free number in this range, in
   * the unit above, and `pass` decides by its tolerance; `points` then only name the sweep's rows.
   */
  range?: { min: number; max: number }
  /** Pure and deterministic: runs the Fleet engine classes at each point, or a stated model the engine cannot express (labelled so). */
  sweep(seed: number): SweepResult
  /** The right answer for this seed's run. */
  truth(results: SweepResult): number
  /** The seed is a fair question. */
  band(results: SweepResult): boolean
  /** The pass rule: this prediction is right for this seed's run. */
  pass(prediction: number, results: SweepResult): boolean
  /** What this seed's run is given (its load, its lengths), shown before the prediction: a pure function of the seed. */
  scene(seed: number): SceneFact[]
  /** Rows of the In-production card. */
  productionClaims: string[]
  /** Phone mode's seed and its outcome. */
  phone: { seed: number; canonical: SweepResult }
}

/** The hands-on test counts a fleet block whose exercise is listed here; a later exercise adds an entry. */
export const FLEET_EXERCISES: Readonly<Record<string, FleetExerciseDef>> = {
  [kneeExercise.id]: kneeExercise,
  [pdSplitExercise.id]: pdSplitExercise,
  [brokenBenchExercise.id]: brokenBenchExercise,
  [pushLuckExercise.id]: pushLuckExercise,
}
