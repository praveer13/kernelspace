import { describe, expect, test } from 'bun:test'
import { xpOf } from '../../src/lib/economy'
import {
  DEFAULT_WEEK,
  PHONE_MAX_WIDTH,
  dayKindOf,
  dayMinutes,
  isScheduled,
  normalizeWeekPlan,
  pickContinue,
  planLine,
  weekStartOf,
  weekStatus,
  weeksMet,
} from '../../src/lib/learner/planner'
import { addDays, daysBetween, weekdayOf } from '../../src/lib/learner/reentry'
import type { Recommendation } from '../../src/lib/learner/types'
import { derive } from '../../src/lib/ledger/fold'
import type { Json, WeekPlan } from '../../src/lib/ledger/types'
import { syntheticYear } from '../ledger/gen'
import { Journal, simulate } from './ledger-gen'

// 2026-10-05 is a Monday
const MON = '2026-10-05'
const D = (n: number) => addDays(MON, n)
const plan = (over: Partial<WeekPlan> = {}): WeekPlan => ({ minutesPerWeek: 150, sessionMinutes: 25, phoneDays: [], laptopDays: [], slo: 0.9, ...over })
/** `minutes` of graded item time on `day`: 10-minute items, so the 30-minute daily cap shows. */
function work(j: Journal, day: string, minutes: number) {
  for (let m = 0; m < minutes; m += 10) j.answer(day, 'x.k0', true, { nsec: Math.min(600, (minutes - m) * 60), ref: `quiz:x.l1#${m}` })
}

describe('the week plan', () => {
  test('defaults to 180 minutes a week, 25-minute sessions and SLO 0.90', () => {
    expect(DEFAULT_WEEK).toEqual({ minutesPerWeek: 180, sessionMinutes: 25, phoneDays: [], laptopDays: [], slo: 0.9 })
    expect(isScheduled(DEFAULT_WEEK)).toBe(false)
  })

  test('a working record becomes a usable plan, whatever it holds', () => {
    expect(normalizeWeekPlan(undefined)).toEqual(DEFAULT_WEEK)
    expect(normalizeWeekPlan(null)).toEqual(DEFAULT_WEEK)
    expect(normalizeWeekPlan('x')).toEqual(DEFAULT_WEEK)
    expect(normalizeWeekPlan([1, 2])).toEqual(DEFAULT_WEEK)
    expect(normalizeWeekPlan({ minutesPerWeek: 5, sessionMinutes: 9000, laptopDays: [1, 1, 9, 'x', 3], phoneDays: [3, 5, -1], slo: 0.5 } as Json)).toEqual({
      minutesPerWeek: 30,
      sessionMinutes: 120,
      laptopDays: [1, 3],
      phoneDays: [5], // a weekday in both lists is a laptop day
      slo: 0.9,
    })
    expect(normalizeWeekPlan({ ...plan({ slo: 0.85, minutesPerWeek: 1500 }) } as Json)).toMatchObject({ slo: 0.85, minutesPerWeek: 1200 })
  })

  test('weeks run Monday to Sunday', () => {
    expect(weekStartOf('2026-10-05')).toBe('2026-10-05')
    expect(weekStartOf('2026-10-07')).toBe('2026-10-05')
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05') // Sunday
    expect(weekStartOf('2026-10-12')).toBe('2026-10-12')
    for (let i = 0; i < 400; i++) expect(weekdayOf(weekStartOf(D(i)))).toBe(1)
  })

  test('a day with no plan infers from the viewport; a scheduled week names its days', () => {
    expect(dayKindOf(plan(), D(0), PHONE_MAX_WIDTH - 1)).toBe('phone')
    expect(dayKindOf(plan(), D(0), PHONE_MAX_WIDTH)).toBe('laptop')
    expect(dayKindOf(plan(), D(0))).toBe('laptop')
    const p = plan({ laptopDays: [1, 3], phoneDays: [5] })
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => dayKindOf(p, D(i), 300))).toEqual(['laptop', 'rest', 'laptop', 'rest', 'phone', 'rest', 'rest'])
  })
})

describe('minutes per day are XP minutes', () => {
  test('graded items pay their nominal time, a fact pays once on its first day', () => {
    const j = new Journal()
    j.add('complete', 'boot', D(1))
    j.add('complete', 'boot', D(3))
    work(j, D(2), 20)
    const m = dayMinutes(j.events)
    expect(m.get(D(1))).toBe(10) // Boot
    expect(m.get(D(2))).toBe(20)
    expect(m.has(D(3))).toBe(false) // the same fact again pays nothing
  })

  test('items stop paying at 30 minutes a day', () => {
    const j = new Journal()
    work(j, D(0), 60)
    expect(dayMinutes(j.events).get(D(0))).toBe(30)
  })

  test('adds up to the XP total of the ledger, in any order, with duplicates', () => {
    const ledgers = [syntheticYear(5, 'light').events, syntheticYear(6, 'heavy').events.slice(0, 4000), simulate(8, { days: 80 }).events]
    for (const events of ledgers) {
      const total = xpOf(derive(events))
      const sum = (es: typeof events) => [...dayMinutes(es).values()].reduce((a, b) => a + b, 0)
      expect(sum(events)).toBe(total)
      expect(sum([...events].reverse().concat(events.slice(0, 20)))).toBe(total)
      for (const v of dayMinutes(events).values()) expect(v).toBeGreaterThan(0)
    }
  })
})

describe('weekStatus (spec §6.5)', () => {
  const p = plan({ minutesPerWeek: 150, laptopDays: [1, 3], phoneDays: [5] }) // Mon, Wed, Fri: 50 a day

  test('a target of minutesPerWeek ÷ plannedDays on each planned day', () => {
    const j = new Journal()
    work(j, D(0), 30)
    work(j, D(2), 10)
    const s = weekStatus(j.events, p, D(2))
    expect(s.weekStart).toBe(MON)
    expect(s.days.map((d) => d.day)).toEqual([0, 1, 2, 3, 4, 5, 6].map(D))
    expect(s.days.map((d) => d.kind)).toEqual(['laptop', 'rest', 'laptop', 'rest', 'phone', 'rest', 'rest'])
    expect(s.days.map((d) => d.targetMinutes)).toEqual([50, 0, 50, 0, 50, 0, 0])
    expect(s.days.map((d) => d.doneMinutes)).toEqual([30, 0, 10, 0, 0, 0, 0])
    expect(s.targetMinutes).toBe(150)
    expect(s.doneMinutes).toBe(40)
    expect(s.met).toBeNull() // the week is still running, even when the target is already passed
  })

  test('a finished week says whether the learner met their own target', () => {
    const j = new Journal()
    for (const d of [0, 1, 2, 3, 4]) work(j, D(d), 30) // 150
    for (const d of [7, 8, 9]) work(j, D(d), 30) // the next week: 90
    const next = D(14)
    expect(weekStatus(j.events, p, next, { weekOf: D(2) })).toMatchObject({ weekStart: MON, doneMinutes: 150, met: true })
    expect(weekStatus(j.events, p, next, { weekOf: D(9) })).toMatchObject({ weekStart: D(7), doneMinutes: 90, met: false })
    // on the last day of the week it is not over yet
    expect(weekStatus(j.events, p, D(6)).met).toBeNull()
    expect(weekStatus(j.events, p, D(7), { weekOf: D(0) }).met).toBe(true)
  })

  test('with no weekday chosen all seven days share the target and take their kind from the viewport', () => {
    const s = weekStatus([], plan({ minutesPerWeek: 210 }), D(3), { viewportWidth: 390 })
    expect(s.days.every((d) => d.kind === 'phone' && d.targetMinutes === 30)).toBe(true)
    expect(weekStatus([], plan(), D(3), { viewportWidth: 1280 }).days[0].kind).toBe('laptop')
  })

  test('the planned targets add up to the weekly target', () => {
    for (const [laptop, phone] of [[[1], []], [[1, 2, 3], [4, 5]], [[0, 1, 2, 3, 4, 5, 6], []], [[], [6]]] as const) {
      const s = weekStatus([], plan({ minutesPerWeek: 200, laptopDays: [...laptop], phoneDays: [...phone] }), D(0))
      expect(s.days.reduce((t, d) => t + d.targetMinutes, 0)).toBeCloseTo(200, 9)
    }
  })

  test('is deterministic and ignores event order', () => {
    const r = simulate(9, { days: 40 })
    const a = weekStatus(r.events, p, D(20))
    expect(weekStatus([...r.events].reverse(), p, D(20))).toEqual(a)
  })
})

describe('weeksMet: the persistence lever', () => {
  const p = plan({ minutesPerWeek: 60, laptopDays: [1, 3] })
  /** One week of `minutes` (30 a day cap, Monday then Wednesday). */
  function week(j: Journal, w: number, minutes: number) {
    work(j, D(7 * w), Math.min(30, minutes))
    if (minutes > 30) work(j, D(7 * w + 2), minutes - 30)
  }

  test('counts finished weeks that met the learner\'s own target, over the last twelve', () => {
    const j = new Journal()
    const met = [true, false, true, true, false, true, true, true, false, true, true, true, true, false]
    met.forEach((m, w) => week(j, w, m ? 60 : 40))
    const now = D(7 * met.length) // the week after the last one
    // the last 12 finished weeks are weeks 2 … 13
    const last12 = met.slice(2)
    expect(weeksMet(j.events, p, now)).toEqual({ met: last12.filter(Boolean).length, of: 12 })
  })

  test('weeks before the first graded day do not count against the learner', () => {
    const j = new Journal()
    week(j, 0, 60)
    week(j, 1, 20)
    expect(weeksMet(j.events, p, D(7 * 2))).toEqual({ met: 1, of: 2 })
    expect(weeksMet(j.events, p, D(7 * 3))).toEqual({ met: 1, of: 3 }) // an empty week after the first graded day is a missed one
    expect(weeksMet([], p, D(70))).toEqual({ met: 0, of: 0 })
  })

  test('the running week is not counted', () => {
    const j = new Journal()
    week(j, 0, 60)
    expect(weeksMet(j.events, p, D(3))).toEqual({ met: 0, of: 0 })
  })
})

describe("Today's plan line", () => {
  const rec = (kind: Recommendation['kind'], title: string, minutes = 20): Recommendation => ({ kind, ref: '', to: '/', title, why: '', minutes })

  test('review minutes plus the second half', () => {
    expect(planLine(10, rec('lesson', 'T1.L4'))).toBe('10 min review + continue T1.L4 (20 min)')
    expect(planLine(9.6, rec('lab', 'Lab 01', 45))).toBe('10 min review + lab Lab 01 (45 min)')
    expect(planLine(6, rec('play', 'Block placement', 15))).toBe('6 min review + play Block placement (15 min)')
    expect(planLine(10, rec('boot', 'Boot', 10))).toBe('10 min review + Boot (10 min)')
  })
  test('either half may be missing', () => {
    expect(planLine(0, rec('lesson', 'T1.L4'))).toBe('Continue T1.L4 (20 min)')
    expect(planLine(12, null)).toBe('12 min review')
    expect(planLine(0, null)).toBe('Nothing planned yet')
  })
  test('laptop days prefer a lab or a play, phone days anything else', () => {
    const list = [rec('lesson', 'T1.L4'), rec('lab', 'Lab 01'), rec('play', 'Block placement')]
    expect(pickContinue('laptop', list)?.kind).toBe('lab')
    expect(pickContinue('phone', list)?.kind).toBe('lesson')
    expect(pickContinue('laptop', [list[0]])?.kind).toBe('lesson')
    expect(pickContinue('phone', [list[1]])?.kind).toBe('lab')
    expect(pickContinue('rest', [])).toBeNull()
    expect(daysBetween(MON, D(3))).toBe(3)
  })
})
