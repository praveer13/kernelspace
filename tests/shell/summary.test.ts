import { describe, expect, test } from 'bun:test'
import { RING2_LESSONS } from '../../src/lib/economy-table'
import { AMBER_BELOW, placementOf, previewToday, ringKcs, summarize, todayCtaLabel } from '../../src/lib/learner/summary'
import { cardsContent } from '../../src/lib/learner/cards'
import { loadTodayContent } from '../../src/lib/learner/today'
import { addDays } from '../../src/lib/learner/reentry'
import { Journal, START } from '../learner/ledger-gen'

/**
 * The numbers Home and /progress print about Today (wave-1.md §6.9, §8.5), over the real content: the Home
 * card's item count, first-review calibration, the week, the hand-off count and the amber rule. They are
 * derived on read, so these tests build ledgers and read them back.
 */
const loaded = await loadTodayContent()
const D = (n: number) => addDays(START, n)
const at = (n: number) => new Date(`${D(n)}T12:00:00Z`)

/** T1.L4 and the KCs the graph gives it (block placement and fragmentation: generated items serve them). */
const lesson = { id: 't1.l4', kcs: loaded.kcs.filter((k) => k.lessons.includes('t1.l4')).map((k) => k.id) }
// The lessons on this branch are not tagged yet (`Lesson.kcs` lands with the tagging tasks), so tag them from the graph.
const content = {
  ...loaded,
  lessons: loaded.lessons.map((l) => ({ ...l, kcs: loaded.kcs.filter((k) => k.lessons.includes(l.id)).map((k) => k.id) })),
}

describe('todayCtaLabel', () => {
  test('says only "Today" before the session is known', () => {
    expect(todayCtaLabel(null)).toBe('Today')
  })
  test('names the items and the minutes', () => {
    expect(todayCtaLabel({ items: 9, minutes: 10, cards: 12 })).toBe('Today · 9 items · ~10 min')
    expect(todayCtaLabel({ items: 1, minutes: 1, cards: 12 })).toBe('Today · 1 item · ~1 min')
  })
  test('says caught up with cards and nothing due, and what is next with no cards', () => {
    expect(todayCtaLabel({ items: 0, minutes: 0, cards: 4 })).toBe('Today · all caught up')
    expect(todayCtaLabel({ items: 0, minutes: 0, cards: 0 })).toBe('Today · see what is next')
  })
})

describe('previewToday', () => {
  test('an empty ledger has no cards and no session', () => {
    expect(previewToday([], content, {}, at(5))).toEqual({ items: 0, minutes: 0, cards: 0 })
  })

  test('a passed ticket earns cards, and a few days later they are due as items with minutes', () => {
    const j = new Journal()
    j.passLesson(D(0), lesson.id, lesson.kcs)
    const p = previewToday(j.events, content, {}, at(8))
    expect(p.cards).toBeGreaterThan(0)
    expect(p.items).toBeGreaterThan(0)
    expect(p.minutes).toBeGreaterThanOrEqual(1)
    expect(todayCtaLabel(p)).toMatch(/^Today · \d+ items? · ~\d+ min$/)
  })

  test('the same ledger and day give the same answer', () => {
    const j = new Journal()
    j.passLesson(D(0), lesson.id, lesson.kcs)
    expect(previewToday(j.events, content, {}, at(8))).toEqual(previewToday(j.events, content, {}, at(8)))
  })

  test('a session never runs past the learner\'s session length', () => {
    const j = new Journal()
    j.passLesson(D(0), lesson.id, lesson.kcs)
    const p = previewToday(j.events, content, { prefs: { sessionMinutes: 6 } }, at(8))
    expect(p.minutes).toBeLessThanOrEqual(7)
  })
})

describe('summarize', () => {
  test('an empty ledger: no calibration, an empty week, nothing to hand off, no recall to be amber about', () => {
    const s = summarize([], content, {}, at(5))
    expect(s.calibration).toEqual({ n: 0, meanPredicted: null, observed: null, ci95: null })
    expect(s.week.doneMinutes).toBe(0)
    expect(s.week.targetMinutes).toBeGreaterThan(0)
    expect(s.pending).toBe(0)
    expect(s.recall).toEqual({ mean: null, cards: 0, amber: false })
  })

  test('the week reads the plan the learner set', () => {
    const s = summarize([], content, { week: { minutesPerWeek: 300, sessionMinutes: 25, phoneDays: [], laptopDays: [], slo: 0.9 } }, at(5))
    expect(s.week.targetMinutes).toBe(300)
    expect(s.weekPlan.minutesPerWeek).toBe(300)
  })

  test('a first spaced review is counted against what the model predicted', () => {
    const j = new Journal()
    j.passLesson(D(0), lesson.id, lesson.kcs)
    for (const kc of lesson.kcs) j.answer(D(3), kc, true)
    const s = summarize(j.events, content, {}, at(3))
    expect(s.calibration.n).toBe(lesson.kcs.length)
    expect(s.calibration.observed).toBe(1)
    expect(s.calibration.meanPredicted).toBeGreaterThan(0)
    expect(s.calibration.meanPredicted).toBeLessThanOrEqual(1)
  })

  test('pending counts events newer than the last hand-off, and a hand-off marker clears them', () => {
    const j = new Journal()
    j.passLesson(D(0), lesson.id, lesson.kcs)
    const all = summarize(j.events, content, {}, at(1)).pending
    expect(all).toBe(j.events.length)
    const marker = { at: `${D(0)}T23:59:59.000Z`, events: all }
    expect(summarize(j.events, content, { handoff: marker }, at(1)).pending).toBe(0)
    expect(summarize(j.events, content, { lastExportAt: marker.at }, at(1)).pending).toBe(0)
  })

  test('amber only when mean predicted recall over the ring\'s ideas is under 0.8', () => {
    const j = new Journal()
    j.passLesson(D(0), lesson.id, lesson.kcs)
    const fresh = summarize(j.events, content, {}, at(0))
    expect(fresh.recall.cards).toBeGreaterThan(0)
    expect(fresh.recall.mean).toBeGreaterThanOrEqual(AMBER_BELOW)
    expect(fresh.recall.amber).toBe(false)
    const stale = summarize(j.events, content, {}, at(400))
    expect(stale.recall.mean).toBeLessThan(AMBER_BELOW)
    expect(stale.recall.amber).toBe(true)
  })
})

describe('ringKcs and placementOf', () => {
  test('the ring stands on the KCs of its 19 lessons only', () => {
    const cc = cardsContent({ kcs: content.kcs, lessons: content.lessons, bootKcs: content.bootKcs, resolve: content.resolve })
    const kcs = ringKcs(cc)
    expect(kcs.size).toBeGreaterThan(0)
    for (const k of content.kcs) {
      const inRing = k.lessons.some((l) => RING2_LESSONS.includes(l))
      expect([k.id, kcs.has(k.id)]).toEqual([k.id, inRing])
    }
    // the lesson tags alone are enough too
    const tagged = ringKcs({ kcs: [], lessonKcs: new Map([['t0.l1', ['x.one']], ['t3.l1', ['x.two']]]) })
    expect([...tagged]).toEqual(['x.one'])
  })

  test('placementOf keeps solid KCs and nothing else', () => {
    expect(placementOf(undefined)).toBeNull()
    expect(placementOf([])).toBeNull()
    expect(placementOf({ solidKcs: ['a', 3, 'b'] })).toEqual({ solidKcs: ['a', 'b'] })
    expect(placementOf({ other: 1 })).toBeNull()
  })
})
