import type { IsoInstant, LedgerClock, LocalDay } from './types'

/**
 * The UTC calendar date of `at + tz` minutes. With `tz` = minutes east of UTC at `at`
 * this equals `localDateKey` at write time, and it is frozen into the event.
 */
export function dayOf(at: IsoInstant, tz: number): LocalDay {
  return new Date(Date.parse(at) + tz * 60_000).toISOString().slice(0, 10)
}

/** The real clock. `tz` is `-getTimezoneOffset()` at that instant, so it is DST-aware. */
export const systemClock: LedgerClock = {
  nowIso: () => new Date().toISOString(),
  tzOffsetMinutes: (at) => -new Date(at).getTimezoneOffset(),
}

/** True for a canonical `Date#toISOString()` instant (the only form events may carry). */
export function isIsoInstant(value: unknown): value is IsoInstant {
  if (typeof value !== 'string' || value.length !== 24) return false
  const ms = Date.parse(value)
  return !Number.isNaN(ms) && new Date(ms).toISOString() === value
}

export function isLocalDay(value: unknown): value is LocalDay {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const ms = Date.parse(`${value}T00:00:00.000Z`)
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value
}
