/**
 * "Set your week" calendar export (docs/specs/wave-1.md §6.5): one weekly recurring event per planned weekday,
 * as an RFC 5545 `.ics` text the browser downloads. Generated client-side; there is no server and no reminder
 * (no VALARM), so the calendar app decides whether to nudge. Pure: the instant of creation is a parameter.
 *
 * Times are floating (no zone), so the event is at the same wall-clock time wherever the learner is. UIDs are
 * stable per weekday, so importing a changed plan updates the old events in most calendars instead of doubling them.
 */

import type { IsoInstant, LocalDay, WeekPlan } from '@/lib/ledger/types'
import { addDays, weekdayOf } from './reentry'
import { isScheduled } from './planner'

/** RFC 5545 weekday codes, indexed like `WeekPlan.phoneDays` (0 = Sunday). */
export const BYDAY: readonly string[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export const ICS_FILENAME = 'kernelspace-week.ics'

export interface IcsOptions {
  plan: WeekPlan
  /** Wall-clock start, "HH:MM" (24 h), chosen by the learner. */
  time: string
  /** The first occurrence of each weekday falls on or after this day. */
  from: LocalDay
  /** When the file is made (DTSTAMP). */
  now: IsoInstant
}

export interface IcsFile {
  filename: string
  /** CRLF-separated lines, ending in CRLF. */
  text: string
  /** Weekly events in the file. */
  events: number
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** TEXT values escape backslash, semicolon, comma and newlines (RFC 5545 §3.3.11). */
export const escapeText = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Content lines are folded at 75 octets; a continuation starts with one space. Kernelspace text is ASCII. */
export function foldLine(line: string): string {
  if (line.length <= 75) return line
  const parts = [line.slice(0, 75)]
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`)
  return parts.join('\r\n')
}

const compactDay = (day: LocalDay): string => day.replace(/-/g, '')

/** `2026-10-05T18:30:00.000Z` becomes `20261005T183000Z`. */
const stamp = (at: IsoInstant): string => `${compactDay(at.slice(0, 10))}T${at.slice(11, 19).replace(/:/g, '')}Z`

/**
 * One weekly `RRULE` event per planned weekday, `SUMMARY:kernelspace: <n> min (Today + <kind>)` with `n` the day's
 * share of the weekly minutes (laptop days pair Today with a lab, phone days with a lesson). Returns null when
 * the plan has no weekday chosen (nothing to put on a calendar). Throws `RangeError` for a malformed time.
 */
export function weekIcs(opts: IcsOptions): IcsFile | null {
  const m = TIME.exec(opts.time)
  if (!m) throw new RangeError(`time "${opts.time}" is not HH:MM`)
  const { plan } = opts
  if (!isScheduled(plan)) return null
  const planned = [1, 2, 3, 4, 5, 6, 0].filter((wd) => plan.laptopDays.includes(wd) || plan.phoneDays.includes(wd))
  const minutes = Math.max(1, Math.round(plan.minutesPerWeek / planned.length))
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//kernelspace//Set your week//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  for (const wd of planned) {
    const first = addDays(opts.from, (wd - weekdayOf(opts.from) + 7) % 7)
    const kind = plan.laptopDays.includes(wd) ? 'lab' : 'lesson'
    lines.push(
      'BEGIN:VEVENT',
      `UID:ks-week-${BYDAY[wd].toLowerCase()}@kernelspace`,
      `DTSTAMP:${stamp(opts.now)}`,
      `DTSTART:${compactDay(first)}T${m[1]}${m[2]}00`,
      `DURATION:PT${minutes}M`,
      `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[wd]}`,
      `SUMMARY:${escapeText(`kernelspace: ${minutes} min (Today + ${kind})`)}`,
      `DESCRIPTION:${escapeText('Your planned kernelspace time. This calendar entry is yours alone: nothing was sent anywhere.')}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return { filename: ICS_FILENAME, text: `${lines.map(foldLine).join('\r\n')}\r\n`, events: planned.length }
}
