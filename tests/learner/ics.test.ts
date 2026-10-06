import { describe, expect, test } from 'bun:test'
import { BYDAY, ICS_FILENAME, escapeText, foldLine, weekIcs, type IcsOptions } from '../../src/lib/learner/ics'
import { dayNumber, weekdayOf } from '../../src/lib/learner/reentry'
import type { WeekPlan } from '../../src/lib/ledger/types'

const plan = (over: Partial<WeekPlan> = {}): WeekPlan => ({ minutesPerWeek: 180, sessionMinutes: 25, phoneDays: [], laptopDays: [], slo: 0.9, ...over })
const opts = (over: Partial<IcsOptions> = {}): IcsOptions => ({
  plan: plan({ laptopDays: [1, 3], phoneDays: [6] }),
  time: '19:30',
  from: '2026-10-07', // a Wednesday
  now: '2026-10-05T18:30:15.250Z',
  ...over,
})

interface Vevent {
  [prop: string]: string
}
/** A small RFC 5545 reader: unfolds, checks the envelope and returns each VEVENT's properties. */
function parse(text: string): Vevent[] {
  expect(text.endsWith('\r\n')).toBe(true)
  expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/) // CRLF everywhere, no bare line breaks
  const lines = text.slice(0, -2).replace(/\r\n /g, '').split('\r\n')
  expect(lines[0]).toBe('BEGIN:VCALENDAR')
  expect(lines[lines.length - 1]).toBe('END:VCALENDAR')
  const out: Vevent[] = []
  let cur: Vevent | null = null
  for (const line of lines.slice(1, -1)) {
    if (line === 'BEGIN:VEVENT') cur = {}
    else if (line === 'END:VEVENT') {
      out.push(cur as Vevent)
      cur = null
    } else if (cur) {
      const i = line.indexOf(':')
      cur[line.slice(0, i)] = line.slice(i + 1)
    }
  }
  expect(cur).toBeNull()
  return out
}
const dayOfStart = (dtstart: string) => `${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}`

describe('weekIcs (spec §6.5)', () => {
  test('one weekly RRULE event per planned weekday, Monday first', () => {
    const f = weekIcs(opts())
    expect(f).not.toBeNull()
    expect(f?.filename).toBe(ICS_FILENAME)
    const events = parse(f?.text as string)
    expect(f?.events).toBe(3)
    expect(events.map((e) => e.RRULE)).toEqual(['FREQ=WEEKLY;BYDAY=MO', 'FREQ=WEEKLY;BYDAY=WE', 'FREQ=WEEKLY;BYDAY=SA'])
  })

  test('the summary is "kernelspace: <n> min (Today + <kind>)" with the day\'s share of the week', () => {
    const events = parse(weekIcs(opts())?.text as string)
    expect(events.map((e) => e.SUMMARY)).toEqual(['kernelspace: 60 min (Today + lab)', 'kernelspace: 60 min (Today + lab)', 'kernelspace: 60 min (Today + lesson)'])
    expect(events.every((e) => e.DURATION === 'PT60M')).toBe(true)
    const four = parse(weekIcs(opts({ plan: plan({ minutesPerWeek: 100, laptopDays: [2, 4], phoneDays: [0, 5] }) }))?.text as string)
    expect(four[0].SUMMARY).toBe('kernelspace: 25 min (Today + lab)')
  })

  test('each first occurrence is on its weekday, on or after the start day, at the chosen time', () => {
    const events = parse(weekIcs(opts())?.text as string)
    for (const e of events) {
      const day = dayOfStart(e.DTSTART)
      expect(BYDAY[weekdayOf(day)]).toBe(/BYDAY=(\w\w)/.exec(e.RRULE)?.[1])
      expect(dayNumber(day)).toBeGreaterThanOrEqual(dayNumber('2026-10-07'))
      expect(dayNumber(day)).toBeLessThan(dayNumber('2026-10-07') + 7)
      expect(e.DTSTART).toMatch(/^\d{8}T193000$/) // floating time: no Z, no zone
    }
    expect(events.map((e) => dayOfStart(e.DTSTART))).toEqual(['2026-10-12', '2026-10-07', '2026-10-10'])
  })

  test('a start day that is itself a planned weekday starts that day', () => {
    const events = parse(weekIcs(opts({ from: '2026-10-05' }))?.text as string)
    expect(dayOfStart(events[0].DTSTART)).toBe('2026-10-05')
  })

  test('every weekday of the plan appears once, with a stable unique UID', () => {
    const all = weekIcs(opts({ plan: plan({ laptopDays: [0, 1, 2, 3, 4], phoneDays: [5, 6] }) }))
    const events = parse(all?.text as string)
    expect(events).toHaveLength(7)
    expect(new Set(events.map((e) => e.UID)).size).toBe(7)
    expect(new Set(events.map((e) => /BYDAY=(\w\w)/.exec(e.RRULE)?.[1])).size).toBe(7)
    // the same plan on another day or at another time keeps the same ids, so a calendar updates rather than doubles
    const later = parse(weekIcs(opts({ plan: plan({ laptopDays: [0, 1, 2, 3, 4], phoneDays: [5, 6] }), time: '07:15', now: '2027-01-01T00:00:00.000Z' }))?.text as string)
    expect(later.map((e) => e.UID)).toEqual(events.map((e) => e.UID))
  })

  test('DTSTAMP is the creation instant in UTC', () => {
    expect(parse(weekIcs(opts())?.text as string)[0].DTSTAMP).toBe('20261005T183015Z')
  })

  test('nothing is sent: no alarms, no attendees, no organizer', () => {
    const text = weekIcs(opts())?.text as string
    expect(text).not.toMatch(/VALARM|ATTENDEE|ORGANIZER|URL:|TRIGGER/)
    expect(text).toContain('PRODID:-//kernelspace//Set your week//EN')
    expect(text).toContain('VERSION:2.0')
  })

  test('no weekday chosen is nothing to export', () => {
    expect(weekIcs(opts({ plan: plan() }))).toBeNull()
  })

  test('a malformed time is refused', () => {
    for (const bad of ['', '7:30', '24:00', '19:60', '19:3', '1930', 'noon', '19:30:00']) expect(() => weekIcs(opts({ time: bad }))).toThrow(RangeError)
    expect(weekIcs(opts({ time: '00:00' }))?.events).toBe(3)
    expect(weekIcs(opts({ time: '23:59' }))?.events).toBe(3)
  })

  test('is deterministic', () => {
    expect(weekIcs(opts())).toEqual(weekIcs(opts()))
  })

  test('no line is longer than 75 octets', () => {
    const text = weekIcs(opts({ plan: plan({ laptopDays: [0, 1, 2, 3, 4, 5, 6] }) }))?.text as string
    for (const line of text.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75)
    expect(text).toContain('\r\n ') // the long DESCRIPTION is folded
  })
})

describe('text helpers', () => {
  test('TEXT escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf')
    expect(escapeText('kernelspace: 45 min (Today + lab)')).toBe('kernelspace: 45 min (Today + lab)')
  })
  test('folding is reversible and respects the limit', () => {
    for (const n of [0, 74, 75, 76, 148, 149, 150, 400]) {
      const line = `X:${'a'.repeat(n)}`
      const folded = foldLine(line)
      expect(folded.replace(/\r\n /g, '')).toBe(line)
      for (const part of folded.split('\r\n')) expect(part.length).toBeLessThanOrEqual(75)
    }
  })
})
