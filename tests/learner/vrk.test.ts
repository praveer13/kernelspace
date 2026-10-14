import { describe, expect, test } from 'bun:test'
import type { Kc } from '../../src/lib/kc/types'
import { wilson } from '../../src/lib/learner/calibration'
import { cardsContent, deriveCards } from '../../src/lib/learner/cards'
import { FULL_CREDIT, PARTIAL_CREDIT, creditOf, creditOfEvent, isCredited } from '../../src/lib/learner/provenance'
import { addDays } from '../../src/lib/learner/reentry'
import { ACTIVE_MONTH_MIN_DAYS, VRK_MIN_DAYS, activeStudyMonths, proportionOf, selectVrk30 } from '../../src/lib/learner/vrk'
import type { LedgerEvent, LocalDay } from '../../src/lib/ledger/types'
import { CONTENT, Journal, resolveTag, shuffled, simulate, START } from './ledger-gen'

const D = (n: number) => addDays(START, n)

/** `n` plain KCs `x.k0 … x.k<n-1>`, all introduced by lesson `x.l1`. */
function fake(n: number) {
  const kcs: Kc[] = Array.from({ length: n }, (_, i) => ({
    id: `x.k${i}`,
    title: `K${i}`,
    can: `You can do k${i}.`,
    track: 't0',
    kind: 'concept',
    lessons: ['x.l1'],
    requires: [],
    since: '2026-10-05',
  }))
  return cardsContent({ kcs, lessons: [{ id: 'x.l1', kcs: kcs.map((k) => k.id) }], bootKcs: [], resolve: resolveTag })
}

interface CheckOpts {
  kind?: 'item' | 'probe' | 'prove'
  provenance?: string
  src?: string
  ref?: string
  seed?: number
  kcs?: string[]
}

let seedN = 1000
/** One graded answer on `kc`, by default a fresh generated item on Today (provenance `unseen`). */
function check(j: Journal, day: LocalDay, kc: string, ok: boolean, o: CheckOpts = {}): LedgerEvent {
  const kind = o.kind ?? 'item'
  const kcs = o.kcs ?? [kc]
  const data = kind === 'prove' ? { v: 2, qid: 'free-after', kcs, answer: 3, actual: ok ? 3 : 4, calls: 4 } : { src: o.src ?? 'today', kcs }
  return j.add(kind, o.ref ?? (kind === 'prove' ? 'prove:kv-block-manager' : 'gen:frag/v'), day, {
    score: ok ? 1 : 0,
    ok,
    rev: 'r',
    provenance: o.provenance ?? 'unseen',
    seed: o.seed ?? seedN++,
    ...(kind === 'prove' ? { wasmSha256: 'a'.repeat(64) } : {}),
    data,
  })
}

/** A ledger whose lesson pass on day 0 creates cards for `x.k0 … x.k2` that same day. */
function learned(n = 3) {
  const content = fake(n)
  const j = new Journal()
  j.passLesson(D(0), 'x.l1', content.kcs.map((k) => k.id))
  return { content, j }
}

describe('provenance weights (§12.1)', () => {
  test('proved and unseen are 1.0; lab-green, practice and assisted 0.3; field and anything else 0', () => {
    expect(creditOf('proved')).toBe(1)
    expect(creditOf('unseen')).toBe(1)
    expect(creditOf('lab-green')).toBe(0.3)
    expect(creditOf('practice')).toBe(0.3)
    expect(creditOf('assisted')).toBe(0.3)
    expect(creditOf('field')).toBe(0)
    for (const other of ['legacy', '', 'PROVED', 'toString', '__proto__', undefined, null, 1]) expect(creditOf(other)).toBe(0)
    expect([FULL_CREDIT, PARTIAL_CREDIT]).toEqual([1, 0.3])
  })

  test('read off the event at read time: the event is not changed and carries no weight', () => {
    const j = new Journal()
    const e = check(j, D(0), 'x.k0', true, { provenance: 'practice' })
    const before = JSON.stringify(e)
    expect(creditOfEvent(e)).toBe(0.3)
    expect(isCredited(e)).toBe(false)
    expect(JSON.stringify(e)).toBe(before)
    expect('credit' in e || 'weight' in e).toBe(false)
    expect(isCredited(check(j, D(0), 'x.k0', true))).toBe(true)
    expect(creditOfEvent(j.add('visit', 'lesson:x.l1', D(0)))).toBe(0)
  })
})

describe('VRK30 (§12.2): the definition on fixture ledgers', () => {
  test('a right credited check 30 days after the card was created retains the KC; 29 days is no check', () => {
    const { content, j } = learned()
    check(j, D(VRK_MIN_DAYS - 1), 'x.k0', true)
    expect(selectVrk30(j.events, content, D(29)).checked).toEqual([])
    check(j, D(VRK_MIN_DAYS), 'x.k0', true)
    const v = selectVrk30(j.events, content, D(30))
    expect(v.checked).toEqual(['x.k0'])
    expect(v.retained).toEqual(['x.k0'])
    expect(v.latest).toEqual([{ kc: 'x.k0', created: D(0), day: D(30), ref: 'gen:frag/v', ok: true }])
  })

  test('the latest check decides: a miss after a right answer loses the KC, a right answer after a miss wins it back', () => {
    const { content, j } = learned()
    check(j, D(31), 'x.k0', true)
    check(j, D(35), 'x.k0', false)
    expect(selectVrk30(j.events, content, D(35))).toMatchObject({ checked: ['x.k0'], retained: [] })
    check(j, D(40), 'x.k0', true)
    expect(selectVrk30(j.events, content, D(40))).toMatchObject({ checked: ['x.k0'], retained: ['x.k0'] })
  })

  test('an assisted miss is no check: the right answer before it still stands', () => {
    const { content, j } = learned()
    check(j, D(31), 'x.k0', true)
    check(j, D(36), 'x.k0', false, { provenance: 'assisted' })
    expect(selectVrk30(j.events, content, D(36))).toMatchObject({ checked: ['x.k0'], retained: ['x.k0'] })
    // and an assisted right answer alone checks nothing
    check(j, D(36), 'x.k1', true, { provenance: 'assisted' })
    expect(selectVrk30(j.events, content, D(36)).checked).toEqual(['x.k0'])
  })

  test('a practice-only KC is never checked: authored items, seen seeds and lab greens are 0.3', () => {
    const { content, j } = learned()
    check(j, D(40), 'x.k1', true, { provenance: 'practice', ref: 'quiz:x.l1#0' })
    check(j, D(41), 'x.k1', true, { provenance: 'practice' })
    check(j, D(42), 'x.k1', true, { provenance: 'lab-green' })
    check(j, D(43), 'x.k1', true, { kind: 'prove', provenance: 'practice' })
    check(j, D(44), 'x.k1', true, { provenance: 'field' })
    expect(selectVrk30(j.events, content, D(44))).toMatchObject({ checked: [], retained: [] })
    // a practice miss after a credited right answer changes nothing either
    check(j, D(45), 'x.k1', true)
    check(j, D(46), 'x.k1', false, { provenance: 'practice' })
    expect(selectVrk30(j.events, content, D(46))).toMatchObject({ checked: ['x.k1'], retained: ['x.k1'] })
  })

  test('a card created late counts from its creation, not from the lesson that earned it', () => {
    const content = fake(10)
    const j = new Journal()
    j.passLesson(D(0), 'x.l1', content.kcs.map((k) => k.id))
    // the creation cap releases 3 KCs on day 0, then 1.2 a day: x.k4 waits until day 2
    expect(deriveCards(j.events, content, D(40)).cards['x.k4'].createdDay).toBe(D(2))
    check(j, D(31), 'x.k4', true)
    expect(selectVrk30(j.events, content, D(31)).checked).toEqual([])
    check(j, D(32), 'x.k4', true)
    expect(selectVrk30(j.events, content, D(32))).toMatchObject({ checked: ['x.k4'], latest: [{ created: D(2), day: D(32) }] })
  })

  test('a KC with no card was never learned, so it is never checked', () => {
    const { content, j } = learned(3)
    check(j, D(40), 'x.k9', true)
    check(j, D(40), 't5.kv-bytes', true)
    expect(selectVrk30(j.events, content, D(40)).checked).toEqual([])
  })

  test('a form item is measurement, not a check (W18)', () => {
    const { content, j } = learned()
    check(j, D(40), 'x.k0', true, { src: 'form' })
    expect(selectVrk30(j.events, content, D(40)).checked).toEqual([])
    check(j, D(41), 'x.k0', true)
    check(j, D(42), 'x.k0', false, { src: 'form' })
    expect(selectVrk30(j.events, content, D(42)).retained).toEqual(['x.k0'])
  })

  test('probes and proved prove events are checks; a multi-KC item checks every KC it carries', () => {
    const { content, j } = learned()
    check(j, D(30), 'x.k0', true, { kind: 'probe' })
    check(j, D(31), 'x.k1', true, { kind: 'prove', provenance: 'proved' })
    check(j, D(32), 'x.k2', false, { kcs: ['x.k2', 'x.k0'] })
    const v = selectVrk30(j.events, content, D(32))
    expect(v.checked).toEqual(['x.k0', 'x.k1', 'x.k2'])
    expect(v.retained).toEqual(['x.k1'])
  })

  test('the quiz summary, sim tasks and other graded kinds are not checks', () => {
    const { content, j } = learned()
    j.add('quiz', 'lesson:x.l1', D(40), { score: 1, ok: true, provenance: 'unseen', data: { kcs: ['x.k0'] } })
    j.add('predict', 'gen:frag/v', D(40), { score: 1, ok: true, provenance: 'unseen', data: { kcs: ['x.k0'], src: 'lesson', value: 1, unit: '', truth: 1 } })
    j.add('play', 'play:sched', D(40), { score: 1, ok: true, provenance: 'unseen', data: { kcs: ['x.k0'] } })
    expect(selectVrk30(j.events, content, D(40)).checked).toEqual([])
  })

  test('as of now: a check dated after now counts once its day comes', () => {
    const { content, j } = learned()
    check(j, D(40), 'x.k0', true)
    expect(selectVrk30(j.events, content, D(39)).checked).toEqual([])
    expect(selectVrk30(j.events, content, D(40)).checked).toEqual(['x.k0'])
  })

  test('the share is retained of checked with its Wilson interval', () => {
    const { content, j } = learned(6)
    const oks = [true, true, true, false, true, false]
    oks.forEach((ok, i) => check(j, D(40), `x.k${i}`, ok))
    const v = selectVrk30(j.events, content, D(60))
    const w = wilson(4, 6)
    expect(v.share).toEqual({ n: 6, correct: 4, rate: 4 / 6, ci95: [w.lo, w.hi] })
    expect(selectVrk30([], content, D(0)).share).toEqual({ n: 0, correct: 0, rate: null, ci95: null })
    expect(proportionOf(0, 0).ci95).toBeNull()
  })
})

describe('active study-months and the rate (§12.2)', () => {
  test('a calendar month counts with graded work on 4 days or more', () => {
    const j = new Journal()
    // September: graded work on 4 days (two on the 2nd); October: 3 days; November: 4 days of reading only
    for (const d of ['2026-09-01', '2026-09-02', '2026-09-02', '2026-09-15', '2026-09-30']) check(j, d, 'x.k0', true, { provenance: 'practice' })
    for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) check(j, d, 'x.k0', true, { provenance: 'practice' })
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']) j.add('visit', 'lesson:x.l1', d)
    expect(ACTIVE_MONTH_MIN_DAYS).toBe(4)
    expect(activeStudyMonths(j.events, '2026-12-01')).toEqual(['2026-09'])
    check(j, '2026-10-20', 'x.k0', false, { provenance: 'assisted' })
    expect(activeStudyMonths(j.events, '2026-12-01')).toEqual(['2026-09', '2026-10'])
    // as of an earlier day the later work has not happened yet
    expect(activeStudyMonths(j.events, '2026-10-19')).toEqual(['2026-09'])
  })

  test('per active month is the retained count over those months; null before the first', () => {
    const { content, j } = learned(4)
    expect(selectVrk30(j.events, content, D(1))).toMatchObject({ activeMonths: 0, perActiveMonth: null })
    // the ticket is one day of graded work in September; days 1-3 make it four
    for (const n of [1, 2, 3]) check(j, D(n), 'x.k3', true, { provenance: 'practice' })
    for (const kc of ['x.k0', 'x.k1', 'x.k2']) check(j, D(40), kc, true)
    const v = selectVrk30(j.events, content, D(40))
    expect(v.activeMonths).toBe(1)
    expect(v.perActiveMonth).toBe(3)
    // four days in October make a second active month
    for (const n of [41, 42, 43]) check(j, D(n), 'x.k3', true, { provenance: 'practice' })
    expect(selectVrk30(j.events, content, D(43))).toMatchObject({ activeMonths: 2, perActiveMonth: 1.5 })
  })
})

describe('VRK30 properties', () => {
  test('deterministic: the same ledger in any order, with repeats, gives the same result', () => {
    for (const seed of [1, 2, 3]) {
      const { events, end } = simulate(seed, { days: 90 })
      // Today wrote practice provenance throughout; mark generated answers fresh, as a real ledger would
      const fresh = events.map((e) => (e.ref.startsWith('gen:') && (e.kind === 'item' || e.kind === 'probe') ? ({ ...e, provenance: 'unseen' } as LedgerEvent) : e))
      const want = selectVrk30(fresh, CONTENT, end)
      expect(want.checked.length).toBeGreaterThan(0)
      expect(selectVrk30(shuffled([...fresh, ...fresh.slice(0, 40)], seed), CONTENT, end)).toEqual(want)
      expect(want.retained.every((kc) => want.checked.includes(kc))).toBe(true)
      expect(want.share.n).toBe(want.checked.length)
    }
  })
})
