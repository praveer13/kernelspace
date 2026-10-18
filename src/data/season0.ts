/**
 * Season 0 (docs/specs/wave-3.md §16.7, task 3s-09): the Dailies of seven consecutive dates, a header on /daily that
 * says which day of the seven it is, and a card on /me that lists your own results from your own ledger. Nothing is
 * new to the Daily itself: the incident of each date is `dailyIncident(date)` as on any other day, so there is no
 * seed list here, only the dates. Seasons stay gated (PLAN §10), so there is no board and nothing is fetched: the
 * card reads `incident` events this browser wrote and recomputes each share string with the Daily's own `shareString`.
 *
 * The first date is a constant, as `DAILY_EPOCH` is. The owner answered on 2026-10-15 that the season starts on Monday
 * 2026-11-02, so it runs Monday 2026-11-02 to Sunday 2026-11-08 (tests/world/season0.test.ts holds that the start is a
 * Monday, so a move to any other weekday fails). The /me card hides itself the day after the last date
 * (`season0Over`); the Daily's header already shows only on the seven dates. Every function takes the start as an
 * argument for the test's sake.
 */

import type { IncidentData, LedgerEvent } from '@/lib/ledger/types'
import { dailyNumber, dailyRef, daysBetween, shareString } from '@/lib/world/daily'

/** Day 1 of Season 0, a Monday (local date). */
export const SEASON0_START = '2026-11-02'

/** Seven consecutive dates. */
export const SEASON0_DAYS = 7

/** `YYYY-MM-DD` `n` days after `date`, by calendar arithmetic in UTC (no local time zone, so no DST day of 23 or 25 hours). */
function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** The seven dates, in order. */
export const season0Dates = (start: string = SEASON0_START, days: number = SEASON0_DAYS): string[] => Array.from({ length: days }, (_, i) => addDays(start, i))

/** Which day of the season `date` is (1 to 7), or `null` before it, after it or for a malformed date. */
export function season0Day(date: string, start: string = SEASON0_START, days: number = SEASON0_DAYS): number | null {
  const k = daysBetween(start, date)
  return k !== null && k >= 0 && k < days ? k + 1 : null
}

/** Whether the season is over on `today`: the day after its last date and every day since (false before and during it, and for a malformed date). */
export function season0Over(today: string, start: string = SEASON0_START, days: number = SEASON0_DAYS): boolean {
  const k = daysBetween(start, today)
  return k !== null && k >= days
}

/** What the Daily's header says on a date of the season. */
export const season0Header = (day: number, days: number = SEASON0_DAYS): string => `Season 0 · day ${day} of ${days}`

/** What an attempt left in the ledger, as the card lists it. */
export interface Season0Result {
  diagnosed: boolean
  fixed: boolean
  probes: number
  /** the string the Daily's debrief offered to copy */
  share: string
}

export interface Season0Row {
  /** 1 to 7 */
  day: number
  date: string
  /** the first completed attempt on the date, or `null` when the ledger holds none */
  result: Season0Result | null
}

/** Order by `at` and then id, so the attempt `recordDaily` wrote first leads and a later device's copy never replaces it. */
const earlier = (a: LedgerEvent, b: LedgerEvent): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function resultOf(date: string, data: IncidentData): Season0Result {
  const probes = Array.isArray(data.probes) ? data.probes.length : 0
  const onMyEngine = Array.isArray(data.components) && data.components.length > 0
  return { diagnosed: data.diagnosed === true, fixed: data.fixed === true, probes, share: shareString(dailyNumber(date), probes, data.burn, onMyEngine) }
}

/** One row per date of the season: your result from the ledger's `incident` events (`events` may hold any kinds), or none. */
export function season0Rows(events: readonly LedgerEvent[], start: string = SEASON0_START, days: number = SEASON0_DAYS): Season0Row[] {
  const daily = events.filter((e) => e.kind === 'incident' && e.data.src === 'daily').sort(earlier)
  return season0Dates(start, days).map((date, i) => {
    const found = daily.find((e) => e.ref === dailyRef(date))
    return { day: i + 1, date, result: found && found.kind === 'incident' ? resultOf(date, found.data) : null }
  })
}

/** Where a date stands against `today`: played, open (today and not yet played), missed (past) or upcoming. */
export type Season0State = 'played' | 'open' | 'missed' | 'upcoming'

export const season0State = (row: Season0Row, today: string): Season0State =>
  row.result ? 'played' : row.date === today ? 'open' : row.date < today ? 'missed' : 'upcoming'

/** The result in words: whether you named the fault and whether you fixed it. */
export function season0Outcome(r: Pick<Season0Result, 'diagnosed' | 'fixed'>): string {
  if (r.fixed) return r.diagnosed ? 'Fixed, and your hypothesis named the fault.' : 'Fixed, though your hypothesis did not name the fault.'
  return r.diagnosed ? 'Your hypothesis named the fault; the fix did not land in time.' : 'Not fixed in time, and your hypothesis did not name the fault.'
}
