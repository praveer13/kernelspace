/**
 * Debt mode and re-entry (docs/specs/wave-1.md §6.4), plus the local-day arithmetic the whole learner
 * model shares. Pure: no Date, no storage, no clock (the day arrives as a parameter).
 *
 * - Debt mode: when due items need more than two sessions, new-card creation pauses.
 * - Re-entry: after a gap of 7 or more local days the next session is a welcome-back set, and every other
 *   overdue card gets a virtual due day spread over the next 14 days, so a returning learner meets a short
 *   queue instead of a wall. Nothing here is stored: the gap and the spread follow from the ledger.
 *
 * This module never counts what is overdue for a learner to read. `planReentry` returns the welcome-back
 * ids and the new due days, and the copy below carries no number (a test holds that line).
 */

import type { KcId } from '@/lib/kc/types'
import type { LocalDay } from '@/lib/ledger/types'

/* ------------------------------------------------------------------ */
/* Local days                                                          */
/* ------------------------------------------------------------------ */

/** Days since 1970-01-01 of a proleptic Gregorian date (Hinnant's `days_from_civil`), integer arithmetic only. */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function civilFromDays(n: number): [number, number, number] {
  const z = n + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d]
}

/** The day as a count of days since 1970-01-01. A malformed day gives NaN, which compares false everywhere. */
export function dayNumber(day: LocalDay): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return m ? daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3])) : Number.NaN
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0')

export function dayFromNumber(n: number): LocalDay {
  const [y, m, d] = civilFromDays(n)
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`
}

/** `day` moved by `n` whole days (negative goes back). */
export const addDays = (day: LocalDay, n: number): LocalDay => dayFromNumber(dayNumber(day) + n)

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: LocalDay, to: LocalDay): number => dayNumber(to) - dayNumber(from)

/** 0 = Sunday … 6 = Saturday, the numbering `WeekPlan.phoneDays` and `laptopDays` use. */
export function weekdayOf(day: LocalDay): number {
  return (((dayNumber(day) + 4) % 7) + 7) % 7 // 1970-01-01 was a Thursday
}

/* ------------------------------------------------------------------ */
/* Sessions and debt                                                   */
/* ------------------------------------------------------------------ */

/** The most nominal item time one session holds (spec §6.3). */
export const SESSION_MAX_MINUTES = 12
/**
 * Nominal seconds of one review, for sizing a queue before any item exists (the plan's 30-60 s per item).
 * A built session sums the real `nsec` of its items instead.
 */
export const NOMINAL_REVIEW_SEC = 45
/** Due work beyond this many sessions pauses card creation (debt mode). */
export const DEBT_SESSIONS = 2
/** A gap of this many local days without graded work makes the next session a welcome-back. */
export const GAP_DAYS = 7
/** Overdue cards are spread over this many days after the return. */
export const SPREAD_DAYS = 14

/** One session's budget in minutes: the learner's session length, at most 12. */
export function sessionMinutesOf(minutes?: number): number {
  const m = minutes !== undefined && Number.isFinite(minutes) ? minutes : SESSION_MAX_MINUTES
  return Math.max(1, Math.min(SESSION_MAX_MINUTES, m))
}

/** Reviews one session holds at the nominal review time. */
export const sessionCapacity = (sessionMinutes: number): number => Math.max(1, Math.floor((sessionMinutes * 60) / NOMINAL_REVIEW_SEC))

/** Debt mode: the due queue needs more than two sessions. */
export function isDebt(dueCards: number, sessionMinutes: number): boolean {
  return dueCards * NOMINAL_REVIEW_SEC > DEBT_SESSIONS * sessionMinutes * 60
}

/* ------------------------------------------------------------------ */
/* Re-entry                                                            */
/* ------------------------------------------------------------------ */

/** True when the last graded event is a gap or more old: the next session is the welcome-back set. */
export function isGapReturn(lastGradedDay: LocalDay | null, day: LocalDay): boolean {
  return lastGradedDay !== null && daysBetween(lastGradedDay, day) >= GAP_DAYS
}

/** What re-entry needs to know about one overdue card. */
export interface AtRisk {
  kc: KcId
  /** sure-and-wrong since the last success */
  priority: boolean
  threshold: boolean
  /** Predicted recall on the return day. */
  retrievability: number
  stability: number
}

export interface ReentryPlan {
  /** The cards of the welcome-back set, in the order they are served. */
  welcomeBack: KcId[]
  /** Every other overdue card's virtual due day, `anchor + 1 … anchor + 14`. */
  spread: Map<KcId, LocalDay>
}

const byKc = (a: AtRisk, b: AtRisk): number => (a.kc < b.kc ? -1 : a.kc > b.kc ? 1 : 0)
const flag = (b: boolean): number => (b ? 0 : 1)

/** The welcome-back order: priority, threshold, then the sturdiest cards that have slipped furthest. */
function welcomeOrder(a: AtRisk, b: AtRisk): number {
  return (
    flag(a.priority) - flag(b.priority) ||
    flag(a.threshold) - flag(b.threshold) ||
    b.stability - a.stability ||
    a.retrievability - b.retrievability ||
    byKc(a, b)
  )
}

/** The spread order of spec §6.4: (priority, threshold, R, KC id), most urgent first. */
function spreadOrder(a: AtRisk, b: AtRisk): number {
  return flag(a.priority) - flag(b.priority) || flag(a.threshold) - flag(b.threshold) || a.retrievability - b.retrievability || byKc(a, b)
}

/**
 * The welcome-back set and the spread. `overdue` is every card due on `anchor` (the return day, which is the
 * gap's first post-gap event: the same answer whenever it is derived), `capacity` the cards one 12-minute
 * session holds. Card `i` of the remaining `m` gets day `anchor + 1 + floor(i * 14 / m)`, so no day holds
 * more than ceil(m / 14) of them. Deterministic, and the order of `overdue` does not matter.
 */
export function planReentry(overdue: readonly AtRisk[], capacity: number, anchor: LocalDay): ReentryPlan {
  const first = [...overdue].sort(welcomeOrder)
  const take = Math.max(0, Math.floor(capacity))
  const welcome = first.slice(0, take)
  const rest = first.slice(take).sort(spreadOrder)
  const spread = new Map<KcId, LocalDay>()
  rest.forEach((c, i) => spread.set(c.kc, addDays(anchor, 1 + Math.floor((i * SPREAD_DAYS) / rest.length))))
  return { welcomeBack: welcome.map((c) => c.kc), spread }
}

/** Copy for the two modes. Neither carries a number: the learner is never shown what is overdue. */
export const WELCOME_BACK_COPY = 'Welcome back. A short set of the ideas most worth keeping, and the rest will come back gradually.'
export const CATCH_UP_COPY = 'Catch-up mode: new topics wait until your queue is back under two sessions.'
