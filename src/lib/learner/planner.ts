/**
 * The planner (docs/specs/wave-1.md §6.5): the week plan, per-day targets and "did I meet my week", and
 * Today's one-line plan. Pure over the ledger and the clock-as-a-parameter; nothing here is stored (the plan
 * itself is the working record `boot:week`, which Boot and the week sheet both edit).
 *
 * `doneMinutes` is a day's XP, the nominal graded minutes of economy v2 (§8.4), so the planner and the
 * XP counter can never disagree. That feeds the persistence lever: "own weekly target met in ≥ 8 of 12 weeks".
 */

import { xpOf } from '@/lib/economy'
import { emptyAggregate, foldInto } from '@/lib/ledger/fold'
import type { Json, LedgerEvent, LocalDay, WeekPlan } from '@/lib/ledger/types'
import { addDays, dayNumber, weekdayOf } from './reentry'
import type { DayKind, PlannerDay, Recommendation, WeekStatus } from './types'

/** What a learner who never set a week gets (the same defaults Boot's "You" step starts from). */
export const DEFAULT_WEEK: WeekPlan = { minutesPerWeek: 180, sessionMinutes: 25, phoneDays: [], laptopDays: [], slo: 0.9 }

/** Below this viewport width a day with no plan reads as a phone day. */
export const PHONE_MAX_WIDTH = 640

export const WEEK_MINUTES_MIN = 30
export const WEEK_MINUTES_MAX = 1200
export const WEEKS_FOR_PERSISTENCE = 12

const clampInt = (x: unknown, lo: number, hi: number, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : fallback

const weekdays = (x: unknown): number[] =>
  Array.isArray(x)
    ? [...new Set(x.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : []

/**
 * A usable plan from the working record's value (any JSON, possibly from a newer or older build): every
 * field is clamped or defaulted, and a weekday in both lists counts as a laptop day.
 */
export function normalizeWeekPlan(raw: Json | undefined | null): WeekPlan {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_WEEK }
  const r = raw as Record<string, Json>
  const laptopDays = weekdays(r.laptopDays)
  return {
    minutesPerWeek: clampInt(r.minutesPerWeek, WEEK_MINUTES_MIN, WEEK_MINUTES_MAX, DEFAULT_WEEK.minutesPerWeek),
    sessionMinutes: clampInt(r.sessionMinutes, 5, 120, DEFAULT_WEEK.sessionMinutes),
    laptopDays,
    phoneDays: weekdays(r.phoneDays).filter((d) => !laptopDays.includes(d)),
    slo: r.slo === 0.85 ? 0.85 : 0.9,
  }
}

/** The Monday of `day`'s week (weeks run Monday to Sunday). */
export const weekStartOf = (day: LocalDay): LocalDay => addDays(day, -((weekdayOf(day) + 6) % 7))

/** A plan with no weekday chosen is "unscheduled": every day counts, and each infers its kind from the viewport. */
export const isScheduled = (plan: WeekPlan): boolean => plan.laptopDays.length + plan.phoneDays.length > 0

/** What kind of day `day` is under `plan`; a day with no plan infers from the viewport (< 640 px is phone). */
export function dayKindOf(plan: WeekPlan, day: LocalDay, viewportWidth?: number): DayKind {
  const inferred: DayKind = viewportWidth !== undefined && viewportWidth < PHONE_MAX_WIDTH ? 'phone' : 'laptop'
  if (!isScheduled(plan)) return inferred
  const wd = weekdayOf(day)
  if (plan.laptopDays.includes(wd)) return 'laptop'
  if (plan.phoneDays.includes(wd)) return 'phone'
  return 'rest'
}

/**
 * The XP minutes of every local day with graded work, by the same fold and the same price table that
 * produce the XP total, so the days add up to it exactly. A fact pays on its first day, items pay under the
 * 30-minute daily cap. Duplicate ids count once.
 */
export function dayMinutes(events: Iterable<LedgerEvent>): Map<LocalDay, number> {
  const byId = new Map<string, LedgerEvent>()
  for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e)
  const sorted = [...byId.values()].sort((a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
  const agg = emptyAggregate()
  const out = new Map<LocalDay, number>()
  let paid = 0
  for (let i = 0; i < sorted.length; i++) {
    foldInto(agg, sorted[i])
    if (i + 1 < sorted.length && sorted[i + 1].day === sorted[i].day) continue
    const total = xpOf(agg)
    if (total > paid) out.set(sorted[i].day, total - paid)
    paid = total
  }
  return out
}

export interface WeekOptions {
  /** Viewport width, for days with no plan (< 640 px is phone). */
  viewportWidth?: number
  /** Report the week containing this day instead of `now`'s week (a week that has ended gets `met`). */
  weekOf?: LocalDay
  /** Precomputed `dayMinutes(events)`, when several weeks are asked of one ledger. */
  minutes?: ReadonlyMap<LocalDay, number>
}

/**
 * The week of `now` (or `opts.weekOf`) against the plan: a target for every planned day of
 * `minutesPerWeek / plannedDays`, what was done, and, once the week has ended, whether the whole target was met.
 */
export function weekStatus(events: Iterable<LedgerEvent>, plan: WeekPlan, now: LocalDay, opts: WeekOptions = {}): WeekStatus {
  const minutes = opts.minutes ?? dayMinutes(events)
  const weekStart = weekStartOf(opts.weekOf ?? now)
  const list = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const kinds = list.map((d) => dayKindOf(plan, d, opts.viewportWidth))
  const planned = kinds.filter((k) => k !== 'rest').length
  const days: PlannerDay[] = list.map((day, i) => ({
    day,
    kind: kinds[i],
    targetMinutes: kinds[i] === 'rest' ? 0 : plan.minutesPerWeek / planned,
    doneMinutes: minutes.get(day) ?? 0,
  }))
  const doneMinutes = days.reduce((s, d) => s + d.doneMinutes, 0)
  const ended = dayNumber(now) >= dayNumber(weekStart) + 7
  return { weekStart, targetMinutes: plan.minutesPerWeek, doneMinutes, days, met: ended ? doneMinutes >= plan.minutesPerWeek : null }
}

/**
 * The persistence lever: of the last `weeks` finished weeks, how many met the learner's own target. The
 * plan in force now is used for every week (a plan's history is not kept), and weeks before the learner's
 * first graded day do not count.
 */
export function weeksMet(
  events: Iterable<LedgerEvent>,
  plan: WeekPlan,
  now: LocalDay,
  weeks: number = WEEKS_FOR_PERSISTENCE,
): { met: number; of: number } {
  const minutes = dayMinutes(events)
  const first = [...minutes.keys()].sort()[0]
  if (first === undefined) return { met: 0, of: 0 }
  let met = 0
  let of = 0
  for (let w = 1; w <= weeks; w++) {
    const weekOf = addDays(weekStartOf(now), -7 * w)
    if (addDays(weekOf, 6) < first) break
    of += 1
    if (weekStatus([], plan, now, { weekOf, minutes }).met === true) met += 1
  }
  return { met, of }
}

/* ------------------------------------------------------------------ */
/* Today's plan line                                                   */
/* ------------------------------------------------------------------ */

/** The second half of the day: on a laptop day a lab or a play when there is one, on a phone day not a lab. */
export function pickContinue(kind: DayKind, candidates: readonly Recommendation[]): Recommendation | null {
  const handsOn = (r: Recommendation) => r.kind === 'lab' || r.kind === 'play'
  const preferred = kind === 'laptop' ? candidates.find(handsOn) : candidates.find((r) => !handsOn(r))
  return preferred ?? candidates[0] ?? null
}

const VERB: Partial<Record<Recommendation['kind'], string>> = { lesson: 'continue', lab: 'lab', play: 'play' }

/** "10 min review + continue T1.L4 (20 min)". Either half may be missing. */
export function planLine(reviewMinutes: number, next: Pick<Recommendation, 'kind' | 'title' | 'minutes'> | null): string {
  const review = reviewMinutes > 0 ? `${Math.round(reviewMinutes)} min review` : ''
  const verb = next ? VERB[next.kind] : undefined
  const second = next ? `${verb ? `${verb} ` : ''}${next.title} (${Math.round(next.minutes)} min)` : ''
  if (review && second) return `${review} + ${second}`
  if (second) return second.charAt(0).toUpperCase() + second.slice(1)
  return review || 'Nothing planned yet'
}
