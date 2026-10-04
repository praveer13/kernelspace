import { XP } from '../economy'

/** Logical data-model version (spec §3). Bump when event semantics or required fields change. */
export const SCHEMA_VERSION = 3

/** Aggregate format version; a mismatch means "rebuild from the ledger". */
export const AGGREGATE_VERSION = 1

/** Export file marker (spec §10.1). */
export const EXPORT_FORMAT = 'kernelspace-progress'

/** Import refuses anything larger (spec §10.2). */
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024

/** `ok` threshold of a checkpoint submission. */
export const QUIZ_PASS_SCORE = 0.8

/** XP paid once per fact, keyed by the fact's prefix (spec §6.3). */
export const XP_UNITS = {
  lesson: XP.lesson,
  'quiz-pass': XP.quiz,
  exercise: XP.exercise,
  sim: XP.exercise,
  lab: XP.lab,
  fw: XP.fleetWeekAct,
  cap: XP.capstoneStep,
} as const satisfies Record<string, number>

export type XpUnitPrefix = keyof typeof XP_UNITS
