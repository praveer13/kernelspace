/**
 * Season 0's calendar (docs/specs/wave-3.md §16.7, task 3s-09): the first date, which day of the seven a local date is,
 * and what the Daily's header says on it. This is all /daily reads. The /me card's rows, outcomes and states sit in
 * `data/season0-rows`, which only the card imports: both pages import statically, so a module they share is one chunk
 * that /daily downloads whole, and every ordinary /daily visit paid for the card's code (about 0.9 KB gzip, 3s-09 m1,
 * fixed in TF3). This file keeps its name so the chunk's name in the entry's preload map does not grow.
 *
 * The first date is a constant, as `DAILY_EPOCH` is. The owner answered on 2026-10-15 that the season starts on Monday
 * 2026-11-02, so it runs Monday 2026-11-02 to Sunday 2026-11-08 (tests/world/season0.test.ts holds that the start is a
 * Monday, so a move to any other weekday fails). Every function takes the start as an argument for the test's sake.
 */

import { daysBetween } from '@/lib/world/daily'

/** Day 1 of Season 0, a Monday (local date). */
export const SEASON0_START = '2026-11-02'

/** Seven consecutive dates. */
export const SEASON0_DAYS = 7

/** Which day of the season `date` is (1 to 7), or `null` before it, after it or for a malformed date. */
export function season0Day(date: string, start: string = SEASON0_START, days: number = SEASON0_DAYS): number | null {
  const k = daysBetween(start, date)
  return k !== null && k >= 0 && k < days ? k + 1 : null
}

/** What the Daily's header says on a date of the season. */
export const season0Header = (day: number, days: number = SEASON0_DAYS): string => `Season 0 · day ${day} of ${days}`
