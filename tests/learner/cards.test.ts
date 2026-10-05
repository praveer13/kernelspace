import { describe, expect, test } from 'bun:test'
import { BOOT_KCS, KCS } from '../../src/data/kc'
import { buildKcContent, kcsOfEvent } from '../../src/lib/kc/resolve'
import type { Kc } from '../../src/lib/kc/types'
import {
  CREATE_WINDOW_DAYS,
  CREATE_WINDOW_MAX,
  OFFSET_DEFAULT,
  OFFSET_MAX,
  PRIOR,
  cardRetrievability,
  cardsContent,
  deriveCards,
  deriveCardsDetailed,
  isConfirmPending,
  isDue,
  isReviewEvent,
  learnOffset,
  ratingOf,
  recentReviewRefs,
  selectFirstReviewCalibration,
  targetOf,
} from '../../src/lib/learner/cards'
import { wilson } from '../../src/lib/learner/calibration'
import { intervalDays, nextMemory, retrievability } from '../../src/lib/learner/fsrs'
import { addDays, daysBetween } from '../../src/lib/learner/reentry'
import { GRADED_KINDS } from '../../src/lib/ledger/fold'
import type { LedgerEvent } from '../../src/lib/ledger/types'
import { CONTENT, Journal, LESSONS, resolveTag, shuffled, simulate, START } from './ledger-gen'

const D = (n: number) => addDays(START, n)

/** A graph of `n` plain KCs `x.k0 … x.k<n-1>` in one lesson `x.l1`, with the KCs in `threshold` marked core. */
function fake(n: number, threshold: number[] = [], lessons = 1) {
  const kcs: Kc[] = Array.from({ length: n }, (_, i) => ({
    id: `x.k${i}`,
    title: `K${i}`,
    can: 'You can',
    track: 't0',
    kind: 'concept',
    lessons: [`x.l${(i % lessons) + 1}`],
    requires: [],
    since: '2026-10-05',
    ...(threshold.includes(i) ? { threshold: 'core' as const } : {}),
  }))
  const byLesson = new Map<string, string[]>()
  for (const k of kcs) byLesson.set(k.lessons[0], [...(byLesson.get(k.lessons[0]) ?? []), k.id])
  const content = cardsContent({
    kcs,
    lessons: [...byLesson].map(([id, ids]) => ({ id, kcs: ids })),
    bootKcs: [],
    resolve: resolveTag,
  })
  return { kcs, content, ids: kcs.map((k) => k.id) }
}

const ev = (kind: string, extra: Record<string, unknown> = {}) =>
  ({ id: 'a', v: 1, kind, ref: 'quiz:t0.l1#0', at: '2026-09-01T08:00:00.000Z', tz: 0, day: START, dev: 'd', ...extra }) as unknown as LedgerEvent

describe('ratings (V2, spec §6.2)', () => {
  const graded = (ok: boolean, extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}) =>
    ev('item', { ok, score: ok ? 1 : 0, provenance: 'practice', data: { src: 'today', ...data }, ...extra })

  test('wrong is Again, with or without confidence', () => {
    expect(ratingOf(graded(false))).toBe(1)
    expect(ratingOf(graded(false, { conf: 'sure' }))).toBe(1)
    expect(ratingOf(graded(false, { conf: 'guess' }))).toBe(1)
  })
  test('right and guess is Hard; right and think or unrated is Good', () => {
    expect(ratingOf(graded(true, { conf: 'guess' }))).toBe(2)
    expect(ratingOf(graded(true, { conf: 'think' }))).toBe(3)
    expect(ratingOf(graded(true))).toBe(3)
  })
  test('right, sure and within the nominal time is Easy', () => {
    expect(ratingOf(graded(true, { conf: 'sure', ms: 30_000 }, { nsec: 40 }))).toBe(4)
    expect(ratingOf(graded(true, { conf: 'sure', ms: 40_000 }, { nsec: 40 }))).toBe(4)
  })
  test('sure but slow, or with no time to judge by, is Good', () => {
    expect(ratingOf(graded(true, { conf: 'sure', ms: 40_001 }, { nsec: 40 }))).toBe(3)
    expect(ratingOf(graded(true, { conf: 'sure' }, { nsec: 40 }))).toBe(3)
    expect(ratingOf(graded(true, { conf: 'sure', ms: 5_000 }))).toBe(3)
  })
  test('a self-checked response never rates Easy', () => {
    expect(ratingOf(graded(true, { conf: 'sure', ms: 1_000, ref: 'cr:t0.l4#0' }, { nsec: 90 }))).toBe(3)
    expect(ratingOf(ev('prove', { ref: 'prove:rust-allocator', ok: true, conf: 'sure', ms: 1, data: { nsec: 60 } }))).toBe(3)
  })
})

describe('what is a review', () => {
  test('graded events are, except the quiz summary and an assisted answer', () => {
    expect(isReviewEvent(ev('item', { ok: true, provenance: 'practice' }))).toBe(true)
    expect(isReviewEvent(ev('probe', { ok: true, provenance: 'unseen' }))).toBe(true)
    expect(isReviewEvent(ev('predict', { ok: true, provenance: 'practice' }))).toBe(true)
    expect(isReviewEvent(ev('quiz', { ok: true, provenance: 'practice' }))).toBe(false)
    expect(isReviewEvent(ev('item', { ok: true, provenance: 'assisted' }))).toBe(false)
    expect(isReviewEvent(ev('visit'))).toBe(false)
    expect(isReviewEvent(ev('complete'))).toBe(false)
  })
  test('the graded kinds match the ledger fold', () => {
    const graded = ['item', 'probe', 'quiz', 'predict', 'sim-task', 'lab-check', 'fleet-act', 'capstone-step', 'play', 'prove', 'incident', 'fleet-run']
    expect([...GRADED_KINDS].sort()).toEqual([...graded].sort())
  })
})

describe('creation (spec §6.2)', () => {
  test('a lesson pass earns the lesson KCs, an unpassed or unlisted lesson earns nothing', () => {
    const { content, ids } = fake(3)
    const j = new Journal()
    j.add('quiz', 'lesson:x.l1', D(0), { score: 0.5, ok: false, data: { form: 'ticket' } })
    j.add('quiz', 'lesson:x.l9', D(0), { score: 1, ok: true, data: { form: 'ticket' } })
    expect(Object.keys(deriveCards(j.events, content, D(0)).cards)).toEqual([])
    j.add('quiz', 'lesson:x.l1', D(0), { score: 1, ok: true, data: { form: 'ticket' } })
    const set = deriveCards(j.events, content, D(0))
    expect(Object.keys(set.cards).sort()).toEqual(ids)
    for (const c of Object.values(set.cards)) {
      expect(c).toMatchObject({ origin: 'ticket', createdDay: D(0), memory: null, lastReviewDay: null, reps: 0, lapses: 0, priority: false })
      expect(c.confirmDay).toBeUndefined()
    }
  })

  test('a checkpoint pass with no form earns cards too (an R lesson has no ticket)', () => {
    const { content } = fake(2)
    const j = new Journal()
    j.add('quiz', 'lesson:x.l1', D(0), { score: 0.9, ok: true })
    expect(Object.keys(deriveCards(j.events, content, D(0)).cards)).toHaveLength(2)
  })

  test('a new card is due after the interval of a first Good review at the target', () => {
    const { content } = fake(1)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0'])
    const c = deriveCards(j.events, content, D(0)).cards['x.k0']
    expect(c.dueDay).toBe(addDays(D(0), intervalDays(PRIOR.stability, targetOf(0.9, OFFSET_DEFAULT))))
    expect(isDue(c, D(0))).toBe(false)
    expect(isDue(c, c.dueDay)).toBe(true)
  })

  test('test-out and placement cards get a day-7 confirmation; Boot and tickets do not', () => {
    const { content } = fake(2)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0', 'x.k1'], 'testout')
    const set = deriveCards(j.events, content, D(1))
    for (const c of Object.values(set.cards)) {
      expect(c.origin).toBe('testout')
      expect(c.confirmDay).toBe(D(7))
    }
    const k = new Journal()
    k.add('complete', 'placement', D(2))
    const placed = deriveCards(k.events, content, D(2), null, { placement: { solidKcs: ['x.k1'] } })
    expect(placed.cards['x.k1']).toMatchObject({ origin: 'placement', confirmDay: D(9) })
    expect(placed.cards['x.k0']).toBeUndefined()
  })

  test('placement cards come from the latest walk only, and need the result', () => {
    const { content } = fake(3)
    const j = new Journal()
    j.add('complete', 'placement', D(0))
    j.add('complete', 'placement', D(4))
    const set = deriveCards(j.events, content, D(5), null, { placement: { solidKcs: ['x.k2'] } })
    expect(set.cards['x.k2'].createdDay).toBe(D(4))
    expect(Object.keys(deriveCards(j.events, content, D(5)).cards)).toEqual([])
  })

  test('completing Boot earns its four KCs, three now and one when the bucket refills', () => {
    const j = new Journal()
    j.add('complete', 'boot', D(0))
    const set = deriveCards(j.events, CONTENT, D(0))
    expect(Object.values(set.cards).map((c) => c.origin)).toEqual(['boot', 'boot', 'boot'])
    expect(set.pending).toHaveLength(1)
    const later = deriveCards(j.events, CONTENT, D(1))
    expect(Object.keys(later.cards).sort()).toEqual([...BOOT_KCS].sort())
    expect(later.pending).toEqual([])
  })

  test('threshold KCs are released first, then the full-ramp order', () => {
    const { content } = fake(10, [7])
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', content.kcs.map((k) => k.id))
    const set = deriveCards(j.events, content, D(0))
    expect(Object.keys(set.cards).sort()).toEqual(['x.k0', 'x.k1', 'x.k7'])
    expect(set.pending).toEqual(['x.k2', 'x.k3', 'x.k4', 'x.k5', 'x.k6', 'x.k8', 'x.k9'])
  })

  test('the bucket is 3 at once, then 1.2 a day', () => {
    const { content } = fake(10)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', content.kcs.map((k) => k.id))
    const counts = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => Object.keys(deriveCards(j.events, content, D(k)).cards).length)
    expect(counts).toEqual([3, 4, 5, 6, 7, 9, 10, 10])
  })

  test('never more than 36 cards in any 30 days, even from a full bucket', () => {
    const { content } = fake(100)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', content.kcs.map((k) => k.id))
    const at = (n: number) => Object.keys(deriveCards(j.events, content, D(n)).cards).length
    expect(at(29)).toBe(CREATE_WINDOW_MAX)
    expect(CREATE_WINDOW_MAX).toBe(36)
    // once the first day leaves the window the bucket (3 + 1.2 a day) is the limit again
    expect(at(30)).toBeGreaterThan(CREATE_WINDOW_MAX)
  })

  test('creation order does not depend on event order or duplicates', () => {
    const { content } = fake(10, [4])
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', content.kcs.map((k) => k.id))
    const a = deriveCards(j.events, content, D(3))
    const b = deriveCards([...shuffled(j.events, 5), ...j.events.slice(0, 4)], content, D(3))
    expect(b).toEqual(a)
  })
})

describe('reviews', () => {
  test('a graded event on a carded KC after its creation reviews it with the FSRS formulas', () => {
    const { content } = fake(1)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0'])
    j.answer(D(2), 'x.k0', true, { conf: 'think' })
    j.answer(D(7), 'x.k0', true, { conf: 'think' })
    const c = deriveCards(j.events, content, D(7)).cards['x.k0']
    const m1 = nextMemory(null, 2, 3)
    const m2 = nextMemory(m1, 5, 3)
    expect(c.memory).toEqual(m2)
    expect(c).toMatchObject({ reps: 2, lapses: 0, lastReviewDay: D(7) })
    expect(c.dueDay).toBe(addDays(D(7), intervalDays(m2.stability, targetOf(0.9, OFFSET_DEFAULT))))
  })

  test('the ticket that earned a card is not a review of it, and neither is its quiz summary', () => {
    const { content } = fake(2)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0', 'x.k1'])
    const set = deriveCards(j.events, content, D(0))
    expect(set.cards['x.k0'].reps).toBe(0)
    expect(set.cards['x.k0'].memory).toBeNull()
  })

  test('a same-day answer after creation uses the short-term formula', () => {
    const { content } = fake(1)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0'])
    j.answer(D(0), 'x.k0', true, { conf: 'think' })
    j.answer(D(0), 'x.k0', false)
    const c = deriveCards(j.events, content, D(0)).cards['x.k0']
    expect(c.memory).toEqual(nextMemory(nextMemory(null, 0, 3), 0, 1))
    expect(c.reps).toBe(2)
  })

  test('a multi-KC item rates every KC it carries, and a KC with no card is skipped', () => {
    const { content } = fake(2)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0', 'x.k1'])
    const e = j.answer(D(2), 'x.k0', true, { conf: 'guess' })
    ;(e as unknown as { data: { kcs: string[] } }).data.kcs = ['x.k0', 'x.k1', 'x.nope']
    const set = deriveCards(j.events, content, D(2))
    expect(set.cards['x.k0'].memory).toEqual(nextMemory(null, 2, 2))
    expect(set.cards['x.k1'].memory).toEqual(nextMemory(null, 2, 2))
    expect(Object.keys(set.cards)).toHaveLength(2)
  })

  test('a wrong answer lapses; sure-and-wrong sets priority, and the next success clears it', () => {
    const { content } = fake(1)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0'])
    j.answer(D(2), 'x.k0', false, { conf: 'think' })
    expect(deriveCards(j.events, content, D(2)).cards['x.k0']).toMatchObject({ priority: false, lapses: 1 })
    j.answer(D(3), 'x.k0', false, { conf: 'sure' })
    expect(deriveCards(j.events, content, D(3)).cards['x.k0']).toMatchObject({ priority: true, lapses: 2 })
    j.answer(D(3), 'x.k0', false, { conf: 'guess' })
    expect(deriveCards(j.events, content, D(3)).cards['x.k0'].priority).toBe(true)
    j.answer(D(4), 'x.k0', true)
    expect(deriveCards(j.events, content, D(4)).cards['x.k0'].priority).toBe(false)
  })

  test('a lapse brings the card back the next day', () => {
    const { content } = fake(1)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0'])
    j.answer(D(2), 'x.k0', true)
    j.answer(D(9), 'x.k0', false)
    expect(deriveCards(j.events, content, D(9)).cards['x.k0'].dueDay).toBe(D(10))
  })

  test('events with no KC, and assisted answers, change no card', () => {
    const { content } = fake(1)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0'])
    j.add('item', 'quiz:z.l1#0', D(2), { ok: true, score: 1, rev: 'r', data: { src: 'quiz' } })
    j.add('item', 'quiz:x.l1#0', D(2), { ok: true, score: 1, rev: 'r', provenance: 'assisted', data: { src: 'today', kcs: ['x.k0'] } })
    j.add('visit', 'lesson:x.l1', D(2))
    expect(deriveCards(j.events, content, D(2)).cards['x.k0'].reps).toBe(0)
  })

  test('a day that steps backwards (a timezone change) never gives a negative interval', () => {
    const { content } = fake(1)
    const j = new Journal()
    j.passLesson(D(5), 'x.l1', ['x.k0'])
    j.answer(D(8), 'x.k0', true)
    j.answer(D(7), 'x.k0', true)
    const c = deriveCards(j.events, content, D(9)).cards['x.k0']
    expect(c.lastReviewDay).toBe(D(8))
    expect(c.dueDay >= D(8)).toBe(true)
  })

  test('retrievability falls with the days since the last review and uses the prior before one', () => {
    const { content } = fake(1)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0'])
    const fresh = deriveCards(j.events, content, D(3)).cards['x.k0']
    expect(cardRetrievability(fresh, D(3))).toBe(retrievability(3, PRIOR.stability))
    j.answer(D(3), 'x.k0', true)
    const c = deriveCards(j.events, content, D(3)).cards['x.k0']
    expect(cardRetrievability(c, D(3))).toBe(1)
    expect(cardRetrievability(c, D(13))).toBeLessThan(cardRetrievability(c, D(5)))
  })

  test('recentReviewRefs keeps the last n refs per KC, newest first', () => {
    const j = new Journal()
    for (let i = 0; i < 5; i++) j.answer(D(i), 'x.k0', true, { ref: `quiz:x.l1#${i}` })
    j.answer(D(1), 'x.k1', true, { ref: 'quiz:x.l1#9' })
    const r = recentReviewRefs(j.events, { resolve: resolveTag })
    expect(r.get('x.k0')).toEqual(['quiz:x.l1#4', 'quiz:x.l1#3', 'quiz:x.l1#2'])
    expect(r.get('x.k1')).toEqual(['quiz:x.l1#9'])
  })
})

describe('day-7 confirmation', () => {
  test('is pending from the day and cleared only by a review on or after it', () => {
    const { content } = fake(1)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0'], 'testout')
    j.answer(D(5), 'x.k0', true)
    const at = (d: number) => deriveCards(j.events, content, D(d)).cards['x.k0']
    expect(isConfirmPending(at(6), D(6))).toBe(false)
    expect(isConfirmPending(at(7), D(7))).toBe(true)
    expect(isDue(at(7), D(7))).toBe(true) // even if the schedule says later
    j.answer(D(8), 'x.k0', true)
    expect(isConfirmPending(at(9), D(9))).toBe(false)
  })
})

describe('the optimism offset (spec §6.2)', () => {
  const pairs = (n: number, predicted: number, okShare: number) =>
    Array.from({ length: n }, (_, i) => ({ predicted, ok: i < Math.round(n * okShare) }))

  test('is 0.02 before 20 first reviews', () => {
    expect(learnOffset([])).toBe(OFFSET_DEFAULT)
    expect(learnOffset(pairs(19, 0.9, 0))).toBe(OFFSET_DEFAULT)
  })
  test('is the shortfall of observed recall against predicted, clamped to [0, 0.08]', () => {
    expect(learnOffset(pairs(20, 0.9, 0.85))).toBeCloseTo(0.05, 12)
    expect(learnOffset(pairs(40, 0.9, 0.5))).toBe(OFFSET_MAX)
    expect(learnOffset(pairs(20, 0.9, 1))).toBe(0)
    expect(learnOffset(pairs(20, 0.8, 0.9))).toBe(0)
  })
  test('the target adds it to the SLO and never reaches 1', () => {
    expect(targetOf(0.9, 0.05)).toBeCloseTo(0.95, 12)
    expect(targetOf(0.9, 0.5)).toBe(0.99)
  })
  test('a higher target schedules sooner', () => {
    expect(intervalDays(20, targetOf(0.9, OFFSET_MAX))).toBeLessThan(intervalDays(20, targetOf(0.9, 0)))
  })

  test('is learned from the learner: a learner who forgets gets the maximum, one who remembers everything gets none', () => {
    const lose = deriveCards(simulate(3, { days: 150, pActive: 1, pLesson: 1, accuracy: 0.3 }).events, CONTENT, D(150))
    expect(lose.offset).toBe(OFFSET_MAX)
    const win = simulate(3, { days: 150, pActive: 1, pLesson: 1, accuracy: 1 })
    expect(deriveCards(win.events, CONTENT, win.end).offset).toBe(0)
  })

  test('fewer than 20 first reviews leave the default', () => {
    const r = simulate(4, { days: 6, pActive: 1, pLesson: 1 })
    expect(deriveCardsDetailed(r.events, CONTENT, r.end).firstReviews.length).toBeLessThan(20)
    expect(deriveCards(r.events, CONTENT, r.end).offset).toBe(OFFSET_DEFAULT)
  })
})

describe('first-review calibration', () => {
  test('is empty before any spaced review', () => {
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0'])
    expect(selectFirstReviewCalibration(j.events, fake(1).content, D(1))).toEqual({ n: 0, meanPredicted: null, observed: null, ci95: null })
  })

  test('one first review: the prior at that gap, and what happened', () => {
    const { content } = fake(1)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0'])
    j.answer(D(2), 'x.k0', true)
    j.answer(D(9), 'x.k0', false) // a second spaced review is not a first review
    const cal = selectFirstReviewCalibration(j.events, content, D(9))
    expect(cal.n).toBe(1)
    expect(cal.meanPredicted).toBe(retrievability(2, PRIOR.stability))
    expect(cal.observed).toBe(1)
    const w = wilson(1, 1)
    expect(cal.ci95).toEqual([w.lo, w.hi])
  })

  test('a same-day answer is not a spaced review, the next day is', () => {
    const { content } = fake(1)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', ['x.k0'])
    j.answer(D(0), 'x.k0', true)
    expect(selectFirstReviewCalibration(j.events, content, D(0)).n).toBe(0)
    j.answer(D(1), 'x.k0', false)
    const cal = selectFirstReviewCalibration(j.events, content, D(1))
    expect(cal.n).toBe(1)
    expect(cal.observed).toBe(0)
  })

  test('over a simulated learner it is one sample per KC, with a Wilson interval around the observed share', () => {
    const r = simulate(11, { days: 90, pActive: 0.9, pLesson: 0.8, accuracy: 0.7 })
    const cal = selectFirstReviewCalibration(r.events, CONTENT, r.end)
    const set = deriveCards(r.events, CONTENT, r.end)
    expect(cal.n).toBeGreaterThan(10)
    expect(cal.n).toBeLessThanOrEqual(Object.keys(set.cards).length)
    expect(cal.meanPredicted).toBeGreaterThan(0)
    expect(cal.meanPredicted).toBeLessThanOrEqual(1)
    const w = wilson(Math.round((cal.observed as number) * cal.n), cal.n)
    expect(cal.ci95?.[0]).toBeCloseTo(w.lo, 12)
    expect(cal.ci95?.[1]).toBeCloseTo(w.hi, 12)
    expect(cal.ci95?.[0]).toBeLessThanOrEqual(cal.observed as number)
    expect(cal.ci95?.[1]).toBeGreaterThanOrEqual(cal.observed as number)
  })
})

describe('debt mode (spec §6.4)', () => {
  /** One new KC a day passes its ticket and nothing is ever reviewed: the queue only grows. */
  function neglect(days: number) {
    const { content, ids } = fake(100, [], 100)
    const j = new Journal()
    for (let d = 0; d < days; d++) j.passLesson(D(d), `x.l${(d % 100) + 1}`, [ids[d]])
    return { content, j, ids }
  }
  // the ledger as it stood on day d
  const count = (events: LedgerEvent[], content: ReturnType<typeof fake>['content'], d: number) =>
    deriveCards(events.filter((e) => e.day <= D(d)), content, D(d))

  test('due work over two sessions pauses creation, and the earned KCs wait', () => {
    const { content, j } = neglect(60)
    const early = count(j.events, content, 20)
    expect(early.paused).toBe(false)
    const a = count(j.events, content, 50)
    const b = count(j.events, content, 59)
    expect(a.paused).toBe(true)
    expect(b.paused).toBe(true)
    expect(Object.keys(b.cards).length).toBe(Object.keys(a.cards).length) // nothing new after the pause
    expect(b.pending.length).toBeGreaterThan(a.pending.length)
    expect(Object.keys(b.cards).length).toBeLessThan(60)
  })

  test('answering the queue ends it and pending KCs resume, threshold first', () => {
    const { content, j } = neglect(60)
    const before = count(j.events, content, 59)
    expect(before.paused).toBe(true)
    for (const kc of Object.keys(before.cards)) j.answer(D(60), kc, true)
    j.passLesson(D(60), 'x.l61', ['x.k99'])
    const after = count(j.events, content, 61)
    expect(after.paused).toBe(false)
    expect(Object.keys(after.cards).length).toBeGreaterThan(Object.keys(before.cards).length)
  })

  test('the plan counts a session as 12 minutes at most', () => {
    const { content, j } = neglect(60)
    // a longer session is no bigger budget: min(12, sessionMinutes) keeps the threshold the same
    const upTo = (d: number) => j.events.filter((e) => e.day <= D(d))
    expect(deriveCards(upTo(59), content, D(59), { sessionMinutes: 60 }).paused).toBe(true)
    expect(deriveCards(upTo(25), content, D(25), { sessionMinutes: 60 }).paused).toBe(false)
    // a two-minute session is a smaller budget: debt comes sooner
    expect(deriveCards(upTo(25), content, D(25), { sessionMinutes: 2 }).paused).toBe(true)
  })
})

describe('properties over generated ledgers', () => {
  const SEEDS = Array.from({ length: 10 }, (_, i) => 100 + i)

  test('creation never exceeds 3 in a day or 1.2 a day averaged over any 30-day window', () => {
    for (const seed of SEEDS) {
      const r = simulate(seed, { days: 120, pActive: 0.9, pLesson: 1, accuracy: 0.8 })
      const set = deriveCards(r.events, CONTENT, r.end)
      const per = new Map<string, number>()
      for (const c of Object.values(set.cards)) per.set(c.createdDay, (per.get(c.createdDay) ?? 0) + 1)
      for (const n of per.values()) expect(n).toBeLessThanOrEqual(3)
      for (let s = 0; s < 120; s++) {
        let n = 0
        for (let k = 0; k < CREATE_WINDOW_DAYS; k++) n += per.get(addDays(START, s + k)) ?? 0
        expect(n).toBeLessThanOrEqual(CREATE_WINDOW_MAX)
        expect(n / CREATE_WINDOW_DAYS).toBeLessThanOrEqual(1.2)
      }
    }
  })

  test('deterministic: the same ledger in any order, with repeats, gives the same cards', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const r = simulate(seed, { days: 60 })
      const a = deriveCardsDetailed(r.events, CONTENT, r.end)
      const b = deriveCardsDetailed([...shuffled(r.events, seed), ...r.events.slice(0, 7)], CONTENT, r.end)
      expect(b).toEqual(a)
      expect(deriveCardsDetailed(r.events, CONTENT, r.end)).toEqual(a)
    }
  })

  test('every card is a card of a KC in the graph with sane memory and a due day on or after its last exposure', () => {
    const ids = new Set(KCS.map((k) => k.id))
    for (const seed of SEEDS.slice(0, 4)) {
      const r = simulate(seed, { days: 90 })
      for (const c of Object.values(deriveCards(r.events, CONTENT, r.end).cards)) {
        expect(ids.has(c.kc)).toBe(true)
        if (c.memory) {
          expect(c.memory.stability).toBeGreaterThan(0)
          expect(c.memory.difficulty).toBeGreaterThanOrEqual(1)
          expect(c.memory.difficulty).toBeLessThanOrEqual(10)
          expect(c.lastReviewDay).not.toBeNull()
        }
        expect(daysBetween(c.lastReviewDay ?? c.createdDay, c.dueDay)).toBeGreaterThanOrEqual(1)
        expect(c.reps).toBeGreaterThanOrEqual(c.lapses)
      }
    }
  })

  test('lesson passes are the only way in: with no ticket, no cards', () => {
    const j = new Journal()
    for (const l of LESSONS.slice(0, 3)) for (const kc of l.kcs) j.answer(D(0), kc, true)
    expect(Object.keys(deriveCards(j.events, CONTENT, D(5)).cards)).toEqual([])
  })
})

describe('with the real resolver (src/lib/kc/resolve.ts, injected)', () => {
  test("Boot's graded steps review Boot's cards through the ref map", () => {
    const kc = buildKcContent({ lessons: [] })
    const content = cardsContent({ kcs: KCS, lessons: [], bootKcs: BOOT_KCS, resolve: (e) => kcsOfEvent(e, kc) })
    const j = new Journal()
    j.add('complete', 'boot', D(0))
    j.add('item', 'boot:ridge', D(2), { ok: true, score: 1, rev: 'r', data: { src: 'boot' } })
    const set = deriveCards(j.events, content, D(2))
    expect(set.cards['t4.ridge-point']).toMatchObject({ reps: 1, origin: 'boot' })
    expect(set.cards['t4.decode-bandwidth'].reps).toBe(0)
  })
})
