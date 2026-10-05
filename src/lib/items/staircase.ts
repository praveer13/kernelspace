/**
 * The 3-up/1-down staircase (docs/specs/wave-1.md §5.3): per (KC, family), three consecutive correct
 * answers raise the level and one miss lowers it. At equilibrium the chance of three in a row equals
 * the chance of a miss first, p³ = 0.5, so the learner answers about 79 % correctly (Levitt 1971):
 * the plan's "~80 %". Pure: `levelFor` reads a ledger history and nothing else.
 */

import type { Level } from './types'

export const LEVEL_MIN: Level = 0
export const LEVEL_MAX: Level = 3
/** Consecutive correct answers that raise the level. */
export const UP_RUN = 3
/** The accuracy the rule settles at: the p with p^UP_RUN = 0.5. */
export const TARGET_ACCURACY = 0.5 ** (1 / UP_RUN)

/** First exposure after a lesson (spec §5.3). */
export const START_LEVEL: Level = 1
/** Placement and test-out measure; they do not teach. */
export const MEASURE_LEVEL: Level = 2

export interface StairState {
  level: number
  /** Correct answers in a row at this level. */
  streak: number
}

/** One answer: a miss steps down and clears the run; the third correct in a row steps up. Clamped to [0, top]. */
export function stairStep(state: StairState, ok: boolean, top: number = LEVEL_MAX): StairState {
  if (!ok) return { level: Math.max(0, state.level - 1), streak: 0 }
  const streak = state.streak + 1
  if (streak < UP_RUN) return { level: state.level, streak }
  return { level: Math.min(top, state.level + 1), streak: 0 }
}

/**
 * The ledger events the staircase reads: graded `item` or `probe` events of a generated item
 * (`ref = gen:<family>/<variant>`) tagged with the KC in `data.kcs`. `ItemEvent` and `ProbeEvent`
 * satisfy it as they are.
 */
export interface StairEvent {
  id?: string
  kind: string
  ref: string
  at: string
  ok?: boolean
  data?: { kcs?: readonly string[] } | undefined
}

export interface StairOptions {
  /** Level before any history (default `START_LEVEL`; placement and test-out pass `MEASURE_LEVEL`). */
  start?: Level
}

/** The staircase after replaying the history for (kc, family), oldest first by `at`, then `id`. */
export function stairFor(events: readonly StairEvent[], kc: string, family: string, opts: StairOptions = {}): StairState {
  const prefix = `gen:${family}/`
  const mine = events.filter(
    (e) => (e.kind === 'item' || e.kind === 'probe') && typeof e.ref === 'string' && e.ref.startsWith(prefix) && e.data?.kcs?.includes(kc),
  )
  // order-insensitive in the input: a merge may deliver events in any order
  mine.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0))
  let state: StairState = { level: opts.start ?? START_LEVEL, streak: 0 }
  for (const e of mine) state = stairStep(state, e.ok === true)
  return state
}

/** The level to serve next for (kc, family). */
export function levelFor(events: readonly StairEvent[], kc: string, family: string, opts: StairOptions = {}): Level {
  return stairFor(events, kc, family, opts).level as Level
}
