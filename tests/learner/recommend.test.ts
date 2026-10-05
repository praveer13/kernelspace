import { describe, expect, test } from 'bun:test'
import { KCS } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { TrackId } from '../../src/data/lessons/types'
import { PATHS, pathPlan } from '../../src/lib/learner/paths'
import {
  BOOT_WHY,
  EXTRA_WHY,
  RESUME_DAYS,
  WHY_MAX,
  fit,
  inline,
  labName,
  offerPlacement,
  recommend,
  type RecommendContent,
  type RecommendLessonState,
  type RecommendState,
} from '../../src/lib/learner/recommend'
import type { DayKind, PlacementResult } from '../../src/lib/learner/types'
import type { LearningPath } from '../../src/lib/ledger/types'

const CONTENT: RecommendContent = { kcs: KCS, lessons: ALL_LESSONS, labs: FORGE_LABS }
const NOW = '2026-10-05T12:00:00.000Z'
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString()
const R_LESSONS = ALL_LESSONS.filter((l) => l.trackId === 'r').map((l) => l.id)

const fresh = (over: Partial<RecommendState> = {}): RecommendState => ({
  bootDone: true,
  lessons: {},
  labs: {},
  path: 'full-ramp',
  placement: null,
  today: null,
  ...over,
})
const done = (at = daysAgo(1)): RecommendLessonState => ({ status: 'done', lastVisitedAt: at })
/** The first `n` lessons of a path's plan, done. */
function doneUpTo(path: LearningPath, n: number, placement: RecommendState['placement'] = null): Record<string, RecommendLessonState> {
  return Object.fromEntries(pathPlan(path, CONTENT, placement).lessons.slice(0, n).map((id) => [id, done()]))
}
const placed = (entryTrack: TrackId, rustAnchor: PlacementResult['rustAnchor'], missedKcs: string[] = [], solidKcs: string[] = []): RecommendState['placement'] => ({
  entryTrack,
  rustAnchor,
  missedKcs,
  solidKcs,
})

/** A small deterministic PRNG (mulberry32) for the property tests. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random but plausible learner: some lessons in each state, labs, a placement, Today's queue. */
function randomState(seed: number): { state: RecommendState; day: DayKind } {
  const r = rng(seed)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const lessons: Record<string, RecommendLessonState> = {}
  const depth = Math.floor(r() * ALL_LESSONS.length)
  for (const l of ALL_LESSONS.slice(0, depth)) {
    const x = r()
    if (x < 0.6) lessons[l.id] = done(daysAgo(Math.floor(r() * 30)))
    else if (x < 0.75) lessons[l.id] = { status: 'read', lastVisitedAt: daysAgo(Math.floor(r() * 30)) }
    else if (x < 0.85) lessons[l.id] = { status: 'reading', lastVisitedAt: daysAgo(Math.floor(r() * 30)), scrollPct: Math.floor(r() * 100) }
  }
  const labs: RecommendState['labs'] = {}
  for (const lab of FORGE_LABS) if (r() < 0.2) labs[lab.id] = { done: r() < 0.5, checksDone: lab.checks.slice(0, 2).map((c) => c.id) }
  const tracks: TrackId[] = ['t0', 't1', 't2', 't3', 't4', 't5']
  const coreKcs = ['t0.locality', 't1.external-frag', 't2.address-translation', 't2.admission-scheduling', 't4.bound-classification', 't5.kv-bytes-per-token']
  const placement = r() < 0.5 ? placed(pick(tracks), pick(['solid', 'missed', 'skipped'] as const), coreKcs.filter(() => r() < 0.3), coreKcs.filter(() => r() < 0.3)) : null
  const today = r() < 0.4 ? { due: Math.floor(r() * 40), priority: Math.floor(r() * 3), minutes: 1 + Math.floor(r() * 30), sessionDone: r() < 0.3 } : null
  return {
    state: { bootDone: r() < 0.8, lessons, labs, path: pick(PATHS), placement, today },
    day: pick(['phone', 'laptop', 'rest'] as const),
  }
}

/* ------------------------------------------------------------------ */
/* The six rules, in order                                             */
/* ------------------------------------------------------------------ */

describe('recommend(): the six rules in order', () => {
  test('1. no Boot and no lessons: Boot', () => {
    const rec = recommend(fresh({ bootDone: false }), CONTENT, NOW, 'phone')
    expect(rec).toEqual({ kind: 'boot', ref: 'boot', to: '/boot', title: 'Boot', why: BOOT_WHY, minutes: 10 })
    expect(BOOT_WHY).toBe('10 minutes: how fast is one GPU for one user?')
    // Boot outranks due cards, but not a learner who has started lessons or placed
    expect(recommend(fresh({ bootDone: false, today: { due: 3, priority: 0, minutes: 5, sessionDone: false } }), CONTENT, NOW, 'phone').kind).toBe('boot')
    expect(recommend(fresh({ bootDone: false, lessons: { 't0.l1': { status: 'reading', lastVisitedAt: daysAgo(1) } } }), CONTENT, NOW, 'phone').kind).toBe('lesson')
    expect(recommend(fresh({ bootDone: false, placement: placed('t2', 'solid') }), CONTENT, NOW, 'phone').ref).toBe('t2.l1')
  })

  test('2. due or priority cards and the session open: Today', () => {
    const today = { due: 9, priority: 0, minutes: 10, sessionDone: false }
    const reading = { 't1.l4': { status: 'reading' as const, lastVisitedAt: daysAgo(1), scrollPct: 60 } }
    const rec = recommend(fresh({ today, lessons: reading }), CONTENT, NOW, 'laptop')
    expect(rec).toEqual({ kind: 'today', ref: 'session', to: '/today', title: 'Today', why: '9 cards are near your recall SLO (~10 min)', minutes: 10 })
    expect(recommend(fresh({ today: { due: 0, priority: 1, minutes: 2, sessionDone: false } }), CONTENT, NOW, 'phone').why).toBe('1 card is near your recall SLO (~2 min)')
    // the session done, or nothing due: on to rule 3
    expect(recommend(fresh({ today: { ...today, sessionDone: true }, lessons: reading }), CONTENT, NOW, 'phone').ref).toBe('t1.l4')
    expect(recommend(fresh({ today: { ...today, due: 0 }, lessons: reading }), CONTENT, NOW, 'phone').ref).toBe('t1.l4')
  })

  test('3. a lesson being read, visited in the last 14 days: resume it', () => {
    const lessons = {
      ...doneUpTo('full-ramp', 14),
      't1.l4': { status: 'reading' as const, lastVisitedAt: daysAgo(3), scrollPct: 60 },
      't0.l6': { status: 'reading' as const, lastVisitedAt: daysAgo(5), scrollPct: 20 },
    }
    const rec = recommend(fresh({ lessons }), CONTENT, NOW, 'laptop')
    expect(rec).toMatchObject({ kind: 'lesson', ref: 't1.l4', to: '/lesson/t1.l4', why: 'You were 60 % through T1.L4', minutes: 8 })
    // without a scroll position
    const noPct = recommend(fresh({ lessons: { 't0.l2': { status: 'reading', lastVisitedAt: daysAgo(1) } } }), CONTENT, NOW, 'phone')
    expect(noPct.why).toBe('Pick up T0.L2 where you left off')
    // older than 14 days: the path takes over
    const stale = recommend(fresh({ lessons: { 't0.l2': { status: 'reading', lastVisitedAt: daysAgo(RESUME_DAYS + 1), scrollPct: 50 } } }), CONTENT, NOW, 'phone')
    expect(stale.ref).toBe('t0.l1')
  })

  test('4. a laptop day and an open lab whose host lesson is done: the lab', () => {
    const lessons = doneUpTo('full-ramp', 1 + pathPlan('full-ramp', CONTENT).lessons.indexOf('t1.l3'))
    const labs = Object.fromEntries(FORGE_LABS.filter((l) => l.trackId === 'r').map((l) => [l.id, { done: true, checksDone: [] }]))
    const rec = recommend(fresh({ lessons, labs }), CONTENT, NOW, 'laptop')
    expect(rec).toMatchObject({ kind: 'lab', ref: 'rust-allocator', to: '/forge/rust-allocator', minutes: 90 })
    expect(rec.title).toStartWith('Lab 01 · ')
    // a phone day goes on with the path
    expect(recommend(fresh({ lessons, labs }), CONTENT, NOW, 'phone')).toMatchObject({ kind: 'lesson', ref: 't1.l4' })
    // a finished lab is not offered again
    expect(recommend(fresh({ lessons, labs: { ...labs, 'rust-allocator': { done: true, checksDone: [] } } }), CONTENT, NOW, 'laptop').kind).toBe('lesson')
    // with the R labs untouched, the freshest open lab still wins; a lab already started wins over it
    expect(recommend(fresh({ lessons }), CONTENT, NOW, 'laptop').ref).toBe('rust-allocator')
    const started = recommend(fresh({ lessons, labs: { 'rust-zero-r2': { done: false, checksDone: ['x'] } } }), CONTENT, NOW, 'laptop')
    expect(started).toMatchObject({ ref: 'rust-zero-r2', title: 'Lab R2 · Functions & Control Flow', why: 'Lab R2 builds on R.L2, which you passed: a laptop day suits it' })
    // a lab waits for its readiness lessons
    const notReady = { ...lessons }
    delete notReady['r.l5']
    expect(recommend(fresh({ lessons: notReady, labs }), CONTENT, NOW, 'laptop').ref).not.toBe('rust-allocator')
  })

  test('4. a staged lab names its next open stage and its minutes', () => {
    const lab = { ...FORGE_LABS.find((l) => l.id === 'rust-allocator')!, stageMinutes: { 1: 2, 2: 15 } }
    lab.checks = lab.checks.map((c, i) => ({ ...c, stage: i < 2 ? 1 : 2 }))
    const content: RecommendContent = { ...CONTENT, labs: [lab] }
    const lessons = doneUpTo('full-ramp', 1 + pathPlan('full-ramp', CONTENT).lessons.indexOf('t1.l3'))
    const rec = recommend(fresh({ lessons }), content, NOW, 'laptop')
    expect(rec).toMatchObject({ kind: 'lab', title: 'Lab 01 · stage 1', why: 'Lab 01 stage 1 is a 2-minute win', minutes: 2 })
    const stage2 = recommend(fresh({ lessons, labs: { 'rust-allocator': { checksDone: lab.checks.slice(0, 2).map((c) => c.id) } } }), content, NOW, 'laptop')
    expect(stage2).toMatchObject({ title: 'Lab 01 · stage 2', why: 'Lab 01 stage 2 is a 15-minute win' })
  })

  test('5. the next lesson of the plan, with the braid pair as the why', () => {
    expect(recommend(fresh(), CONTENT, NOW, 'phone')).toMatchObject({ kind: 'lesson', ref: 't0.l1', why: 'Next on the full ramp: lesson 1 of 68' })
    const r1 = recommend(fresh({ lessons: doneUpTo('full-ramp', 1) }), CONTENT, NOW, 'phone')
    expect(r1).toMatchObject({ ref: 'r.l1', why: 'R.L1 first: T0.L2 builds on bindings, shadowing and block values' })
    const t2 = recommend(fresh({ lessons: doneUpTo('full-ramp', 2) }), CONTENT, NOW, 'phone')
    expect(t2).toMatchObject({ ref: 't0.l2', why: 'T0.L2 builds on bindings, shadowing and block values from R.L1' })
  })

  test('5. unmet requires: the prerequisite instead ("T1.L4 needs split and coalesce from T1.L3 first")', () => {
    const plan = pathPlan('full-ramp', CONTENT).lessons
    const lessons: Record<string, RecommendLessonState> = doneUpTo('full-ramp', plan.indexOf('t1.l3'))
    lessons['t1.l3'] = { status: 'read', lastVisitedAt: daysAgo(1) }
    const rec = recommend(fresh({ lessons }), CONTENT, NOW, 'phone')
    // a lesson only read is not evidence (W1): T1.L4 is next, but T1.L3 was not passed
    expect(rec).toMatchObject({ kind: 'lesson', ref: 't1.l3', why: 'T1.L4 needs split and coalesce from T1.L3: pass its check first' })
    // a prerequisite never opened reads the spec's line
    delete lessons['t1.l3']
    lessons['t1.l4'] = { status: 'read', lastVisitedAt: daysAgo(1) }
    expect(recommend(fresh({ lessons }), CONTENT, NOW, 'phone').ref).toBe('t1.l3')
    const skippedAhead = { ...lessons, 't1.l3': { status: 'unstarted' as const, lastVisitedAt: daysAgo(1) }, 't1.l4': done(), 't1.l5': done() }
    expect(recommend(fresh({ lessons: skippedAhead }), CONTENT, NOW, 'phone')).toMatchObject({ ref: 't1.l3' })
  })

  test('5. a KC placement found solid meets the prerequisite', () => {
    const plan = pathPlan('full-ramp', CONTENT).lessons
    const lessons: Record<string, RecommendLessonState> = doneUpTo('full-ramp', plan.indexOf('t1.l3'))
    lessons['t1.l3'] = { status: 'read', lastVisitedAt: daysAgo(1) }
    const rec = recommend(fresh({ lessons, placement: placed('t0', 'missed', [], ['t1.split-coalesce', 't1.allocator-contract']) }), CONTENT, NOW, 'phone')
    expect(rec.ref).toBe('t1.l4')
  })

  test('5. a placed learner starts at the entry track, or at the missed KC', () => {
    expect(recommend(fresh({ placement: placed('t2', 'solid') }), CONTENT, NOW, 'phone')).toMatchObject({ ref: 't2.l1', why: 'Your placement starts you at T2.L1' })
    const gap = recommend(fresh({ placement: placed('t2', 'solid', ['t0.locality']) }), CONTENT, NOW, 'phone')
    expect(gap).toMatchObject({ ref: 't0.l2', why: 'Placement found a gap in locality: start here' })
  })

  test('5. a placed run of R lessons the cap slid past its dependant is still taken first', () => {
    // entry T2 with the anchor missed: R.L3-R.L6 are due before T2.L1, the cap lets two through
    const placement = placed('t2', 'missed', ['r.borrow-rules'])
    const lessons = { 'r.l1': done(), 'r.l2': done() }
    expect(pathPlan('full-ramp', CONTENT, placement).lessons.slice(0, 3)).toEqual(['r.l1', 'r.l2', 't2.l1'])
    expect(recommend(fresh({ lessons, placement }), CONTENT, NOW, 'phone')).toMatchObject({ ref: 'r.l3', why: 'R.L6 needs ownership and moves from R.L3 first' })
  })

  test('6. everything done: extra practice', () => {
    for (const path of PATHS) {
      const lessons = doneUpTo(path, ALL_LESSONS.length)
      const rec = recommend(fresh({ path, lessons }), CONTENT, NOW, 'phone')
      expect(rec).toEqual({ kind: 'today', ref: 'extra', to: '/today', title: 'Extra practice', why: EXTRA_WHY, minutes: 5 })
    }
    expect(EXTRA_WHY).toBe('Keep your cache warm')
  })

  test('each path walks its own plan, one lesson at a time, to the end', () => {
    for (const path of PATHS) {
      const plan = pathPlan(path, CONTENT).lessons
      for (let n = 0; n < plan.length; n++) {
        expect({ path, n, ref: recommend(fresh({ path, lessons: doneUpTo(path, n) }), CONTENT, NOW, 'phone').ref }).toEqual({ path, n, ref: plan[n] })
      }
    }
  })
})

/* ------------------------------------------------------------------ */
/* Properties                                                          */
/* ------------------------------------------------------------------ */

describe('recommend(): properties', () => {
  const SEEDS = 2000

  test('the why line is at most 90 characters, never empty, and every result is well formed', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { state, day } = randomState(seed)
      const rec = recommend(state, CONTENT, NOW, day)
      expect(rec.why.length).toBeGreaterThan(0)
      expect({ seed, ok: rec.why.length <= WHY_MAX }).toEqual({ seed, ok: true })
      expect(rec.minutes).toBeGreaterThanOrEqual(1)
      expect(rec.to.startsWith('/')).toBe(true)
    }
  })

  test('placed learners are never sent to R.L1 unless the anchor was missed on a path with R', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { state, day } = randomState(seed)
      if (!state.placement) continue
      // R.L1 open and unfinished, which a resume or the path could pick
      const lessons = { ...state.lessons, 'r.l1': { status: 'reading' as const, lastVisitedAt: daysAgo(1), scrollPct: 30 } }
      const rec = recommend({ ...state, lessons, today: null }, CONTENT, NOW, day)
      const allowed = state.placement.rustAnchor === 'missed' && state.path !== 'serving-first'
      if (!allowed) expect({ seed, ref: rec.ref }).not.toEqual({ seed, ref: 'r.l1' })
    }
    // the allowed case does happen
    expect(recommend(fresh({ placement: placed('t2', 'missed', ['r.borrow-rules']) }), CONTENT, NOW, 'phone').ref).toBe('r.l1')
    for (const anchor of ['solid', 'skipped'] as const) {
      for (const track of ['t0', 't1', 't2', 't5'] as const) {
        expect(recommend(fresh({ placement: placed(track, anchor) }), CONTENT, NOW, 'phone').ref).not.toStartWith('r.')
      }
    }
  })

  test('deterministic: the same arguments give a deep-equal result', () => {
    for (let seed = 0; seed < 300; seed++) {
      const a = randomState(seed)
      const b = randomState(seed)
      expect(recommend(a.state, CONTENT, NOW, a.day)).toEqual(recommend(b.state, CONTENT, NOW, b.day))
    }
  })

  test('every lesson and lab title is reachable within the why budget, even with long titles', () => {
    const long = ALL_LESSONS.map((l) => ({ ...l, title: `${l.title} ${'and a much longer subtitle '.repeat(4)}` }))
    const kcs = KCS.map((k) => ({ ...k, title: `${k.title} with a long qualifying phrase attached` }))
    const content: RecommendContent = { kcs, lessons: long, labs: FORGE_LABS }
    for (let seed = 0; seed < 500; seed++) {
      const { state, day } = randomState(seed)
      expect(recommend(state, content, NOW, day).why.length).toBeLessThanOrEqual(WHY_MAX)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Copy helpers                                                        */
/* ------------------------------------------------------------------ */

describe('copy helpers', () => {
  test('fit takes the first candidate that fits, else cuts the last at a word', () => {
    expect(fit('short')).toBe('short')
    expect(fit('x'.repeat(91), 'fallback')).toBe('fallback')
    const cut = fit(`${'word '.repeat(30)}end`)
    expect(cut.length).toBeLessThanOrEqual(WHY_MAX)
    expect(cut.endsWith('…')).toBe(true)
    expect(fit('y'.repeat(200)).length).toBe(WHY_MAX)
  })

  test('inline lowercases a sentence-case title but keeps acronyms, names and types', () => {
    expect(inline('Split and coalesce')).toBe('split and coalesce')
    expect(inline('The allocator contract')).toBe('the allocator contract')
    expect(inline('TLB reach')).toBe('TLB reach')
    expect(inline('PagedAttention as paging')).toBe('PagedAttention as paging')
    expect(inline('Box, Rc, Arc and Weak')).toBe('Box, Rc, Arc and Weak')
    expect(inline('Copy, Clone and Drop')).toBe('Copy, Clone and Drop')
    expect(inline('AoS versus SoA')).toBe('AoS versus SoA')
  })

  test('labs are named "Lab 01" and "Lab R3"', () => {
    expect(labName({ index: 1, trackId: 't1' })).toBe('Lab 01')
    expect(labName({ index: 3, trackId: 'r' })).toBe('Lab R3')
  })

  test('the placement walk is offered until the learner places or passes a lesson', () => {
    expect(offerPlacement({ placement: null, lessons: {} })).toBe(true)
    expect(offerPlacement({ placement: null, lessons: { 't0.l1': { status: 'read', lastVisitedAt: NOW } } })).toBe(true)
    expect(offerPlacement({ placement: null, lessons: { 't0.l1': done() } })).toBe(false)
    expect(offerPlacement({ placement: placed('t1', 'solid'), lessons: {} })).toBe(false)
  })
})

test('R lessons tested out by placement are offered as test-outs, never resumed', () => {
  const lessons = { 'r.l3': { status: 'reading' as const, lastVisitedAt: daysAgo(1), scrollPct: 40 } }
  const rec = recommend(fresh({ lessons, placement: placed('t0', 'solid') }), CONTENT, NOW, 'phone')
  expect(R_LESSONS).toContain('r.l3')
  expect(rec.ref).toBe('t0.l1')
})
