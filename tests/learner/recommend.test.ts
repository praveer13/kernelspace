import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KCS } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { TrackId } from '../../src/data/lessons/types'
import { PLAYS } from '../../src/data/plays'
import { PATHS, firstLessons, pathPlan, playStep } from '../../src/lib/learner/paths'
import {
  BOOT_WHY,
  EXTRA_WHY,
  currentLessonFor,
  RESUME_DAYS,
  WHY_MAX,
  fit,
  inline,
  labName,
  offerPlacement,
  recommend,
  type RecommendContent,
  type RecommendLessonState,
  type RecommendPlay,
  type RecommendState,
} from '../../src/lib/learner/recommend'
import type { DayKind, PlacementResult } from '../../src/lib/learner/types'
import { currentLessonNow, firstLessonsNow, isFirstVisit, loadUpNext, recommendNow, type UpNextInput } from '../../src/lib/learner/up-next'
import { bootLine } from '../../src/pages/boot/firstLine'
import type { Json, LearningPath } from '../../src/lib/ledger/types'

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

  test('4. every lab with staged checks is offered stage by stage: labs 02 and 03 on a fixture, lab 01 as shipped', () => {
    // labs 02-03 gain stages when 2c-03 lands; the rule reads whatever `stage`s the checks carry, so a fixture proves it now
    const staged = (id: string, stages: number[]) => {
      const lab = FORGE_LABS.find((l) => l.id === id)!
      return { ...lab, checks: lab.checks.map((c, i) => ({ ...c, stage: stages[i] })), stageMinutes: { 1: 3, 2: 20 } }
    }
    for (const [id, host, name] of [['kv-block-manager', 't5.l5', 'Lab 02'], ['bpe-tokenizer', 't5.l2', 'Lab 03']] as const) {
      const lab = staged(id, [1, 1, 1, 2, 2, 2])
      const content: RecommendContent = { ...CONTENT, labs: [lab] }
      const lessons = doneUpTo('full-ramp', 1 + pathPlan('full-ramp', CONTENT).lessons.indexOf(host))
      expect(recommend(fresh({ lessons }), content, NOW, 'laptop')).toMatchObject({ kind: 'lab', ref: id, title: `${name} · stage 1`, minutes: 3 })
      const stage1 = lab.checks.filter((c) => c.stage === 1).map((c) => c.id)
      expect(recommend(fresh({ lessons, labs: { [id]: { checksDone: stage1 } } }), content, NOW, 'laptop')).toMatchObject({ title: `${name} · stage 2`, minutes: 20 })
      // an optional check never holds a stage open
      const optional = { ...lab, checks: lab.checks.map((c) => (c.stage === 2 ? { ...c, optional: true } : c)) }
      const finished = recommend(fresh({ lessons, labs: { [id]: { checksDone: stage1 } } }), { ...CONTENT, labs: [optional] }, NOW, 'laptop')
      expect(finished.title).toBe(`${name} · ${lab.title}`)
    }
    // lab 01 as shipped carries stages 1-4 in labs.ts, so its first open stage is named
    const lessons = doneUpTo('full-ramp', 1 + pathPlan('full-ramp', CONTENT).lessons.indexOf('t1.l3'))
    expect(recommend(fresh({ lessons }), CONTENT, NOW, 'laptop')).toMatchObject({ ref: 'rust-allocator', title: 'Lab 01 · stage 1' })
    const first = FORGE_LABS.find((l) => l.id === 'rust-allocator')!.checks.filter((c) => c.stage === 1).map((c) => c.id)
    expect(recommend(fresh({ lessons, labs: { 'rust-allocator': { checksDone: first } } }), CONTENT, NOW, 'laptop').title).toBe('Lab 01 · stage 2')
  })

  test('5. the next lesson of the plan, with the braid pair as the why', () => {
    expect(recommend(fresh(), CONTENT, NOW, 'phone')).toMatchObject({ kind: 'lesson', ref: 't0.l1', why: 'Next on the full ramp: lesson 1 of 69' })
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
/* Rule 5: plays                                                       */
/* ------------------------------------------------------------------ */

/** A fixture registry: the scheduler play in T5.L7, as 2b-11 will register it. */
const SCHEDULER: RecommendPlay = { id: 'scheduler', lessonId: 't5.l7', title: 'I was the scheduler', minutes: 20 }
const WITH_PLAY: RecommendContent = { ...CONTENT, plays: [SCHEDULER] }

describe('rule 5 proposes a registered, undebriefed play after its host lesson', () => {
  const upTo = (path: LearningPath, lesson: string) => doneUpTo(path, 1 + pathPlan(path, CONTENT).lessons.indexOf(lesson))

  test('the play is a plan step right after its host lesson, on every path that has the host', () => {
    for (const path of ['full-ramp', 'serving-first'] as const) {
      const { steps } = pathPlan(path, WITH_PLAY)
      const after = steps.slice(steps.indexOf('t5.l7') + 1, steps.indexOf('t5.l8'))
      // serving-first has no labs; the full ramp's lab 06 (Build this) follows the play
      expect(after).toEqual(path === 'full-ramp' ? [playStep('scheduler'), 'lab:batching-scheduler'] : [playStep('scheduler')])
    }
    expect(pathPlan('rust-systems', WITH_PLAY).steps.filter((s) => s.startsWith('play:'))).toEqual([])
    // without a registry, the plan is the one Wave 1 shipped
    expect(pathPlan('full-ramp', CONTENT).steps.some((s) => s.startsWith('play:'))).toBe(false)
  })

  test('after t5.l7 the scheduler play comes before t5.l8, on a phone day and a laptop day', () => {
    for (const path of ['full-ramp', 'serving-first'] as const) {
      for (const day of ['phone', 'laptop'] as const) {
        const rec = recommend(fresh({ path, lessons: upTo(path, 't5.l7') }), WITH_PLAY, NOW, day)
        expect({ path, day, rec }).toEqual({
          path,
          day,
          rec: { kind: 'play', ref: 'scheduler', to: '/play/scheduler', title: 'Play: I was the scheduler', why: 'You passed T5.L7: now try it by hand (~20 min)', minutes: 20 },
        })
      }
    }
  })

  test('the play comes before lab 06 on a laptop day ("Play, then Build this"); a lab already started is not held back', () => {
    const lessons = upTo('full-ramp', 't5.l7')
    expect(recommend(fresh({ lessons }), CONTENT, NOW, 'laptop')).toMatchObject({ kind: 'lab', ref: 'batching-scheduler' })
    expect(recommend(fresh({ lessons }), WITH_PLAY, NOW, 'laptop').kind).toBe('play')
    expect(recommend(fresh({ lessons, plays: { scheduler: { done: true } } }), WITH_PLAY, NOW, 'laptop')).toMatchObject({ kind: 'lab', ref: 'batching-scheduler' })
    const started = { 'batching-scheduler': { done: false, checksDone: [FORGE_LABS.find((l) => l.id === 'batching-scheduler')!.checks[0].id] } }
    expect(recommend(fresh({ lessons, labs: started }), WITH_PLAY, NOW, 'laptop')).toMatchObject({ kind: 'lab', ref: 'batching-scheduler' })
  })

  test('a debriefed play is not offered again; a play that is not registered is never offered', () => {
    const lessons = upTo('full-ramp', 't5.l7')
    expect(recommend(fresh({ lessons, plays: { scheduler: { done: true } } }), WITH_PLAY, NOW, 'phone')).toMatchObject({ kind: 'lesson', ref: 't5.l8' })
    expect(recommend(fresh({ lessons, plays: { scheduler: {} } }), WITH_PLAY, NOW, 'phone').kind).toBe('play')
    // pending: the content carries no registry entry, so the lesson goes on
    expect(recommend(fresh({ lessons }), CONTENT, NOW, 'phone')).toMatchObject({ kind: 'lesson', ref: 't5.l8' })
    expect(recommend(fresh({ lessons }), { ...CONTENT, plays: [] }, NOW, 'phone').kind).toBe('lesson')
  })

  test('the host lesson must be passed: a lesson only read, or the lesson before it, does not offer the play', () => {
    const lessons = upTo('full-ramp', 't5.l6')
    expect(recommend(fresh({ lessons }), WITH_PLAY, NOW, 'phone')).toMatchObject({ kind: 'lesson', ref: 't5.l7' })
    const read = { ...lessons, 't5.l7': { status: 'read' as const, lastVisitedAt: daysAgo(40) } }
    expect(recommend(fresh({ lessons: read }), WITH_PLAY, NOW, 'phone').kind).toBe('lesson')
  })

  test('a learner who went on past the play is not nagged, and a lesson being read outranks it', () => {
    const past = { ...upTo('full-ramp', 't5.l7'), 't5.l8': done() }
    expect(recommend(fresh({ lessons: past }), WITH_PLAY, NOW, 'phone')).toMatchObject({ kind: 'lesson', ref: 't5.l9' })
    const reading = { ...upTo('full-ramp', 't5.l7'), 't5.l8': { status: 'reading' as const, lastVisitedAt: daysAgo(1), scrollPct: 30 } }
    expect(recommend(fresh({ lessons: reading }), WITH_PLAY, NOW, 'phone')).toMatchObject({ kind: 'lesson', ref: 't5.l8' })
    // due cards still come first
    const due = { due: 4, priority: 0, minutes: 5, sessionDone: false }
    expect(recommend(fresh({ lessons: upTo('full-ramp', 't5.l7'), today: due }), WITH_PLAY, NOW, 'phone').kind).toBe('today')
  })

  test('a lab on the same lesson follows the play, and the first of two plays on one lesson comes first', () => {
    const lab = FORGE_LABS.find((l) => l.id === 'kv-block-manager')!
    const two: RecommendContent = { ...CONTENT, plays: [{ ...SCHEDULER, id: 'a', lessonId: lab.lessonId }, { ...SCHEDULER, id: 'b', lessonId: lab.lessonId }] }
    const { steps } = pathPlan('full-ramp', two)
    expect(steps.slice(steps.indexOf(lab.lessonId), steps.indexOf(lab.lessonId) + 4)).toEqual([lab.lessonId, 'play:a', 'play:b', `lab:${lab.id}`])
    const lessons = upTo('full-ramp', lab.lessonId)
    expect(recommend(fresh({ lessons }), two, NOW, 'phone').ref).toBe('a')
    expect(recommend(fresh({ lessons, plays: { a: { done: true } } }), two, NOW, 'phone').ref).toBe('b')
  })

  test('the shipped registry offers block placement after t1.l4, and only once', () => {
    const real: RecommendContent = { ...CONTENT, plays: Object.values(PLAYS) }
    const lessons = upTo('full-ramp', 't1.l4')
    expect(recommend(fresh({ lessons }), real, NOW, 'phone')).toMatchObject({ kind: 'play', ref: 'block-placement', to: '/play/block-placement' })
    expect(recommend(fresh({ lessons, plays: { 'block-placement': { done: true } } }), real, NOW, 'phone')).toMatchObject({ kind: 'lesson', ref: 't1.l5' })
  })

  test('every why stays within 90 characters with plays in the content', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { state, day } = randomState(seed)
      const plays = Object.fromEntries(ALL_LESSONS.slice(0, 3).map((l) => [l.id, { done: seed % 2 === 0 }]))
      const rec = recommend({ ...state, plays }, { ...CONTENT, plays: [SCHEDULER, ...Object.values(PLAYS)] }, NOW, day)
      expect(rec.why.length).toBeLessThanOrEqual(WHY_MAX)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Curriculum's current marker, Boot's first lesson                    */
/* ------------------------------------------------------------------ */

describe('currentLessonFor: the lesson Up Next stands on', () => {
  test('it is the plan lesson of rule 5, the lesson being read of rule 3, and never a lab, a play or Today', () => {
    expect(currentLessonFor(fresh(), CONTENT, NOW)).toBe('t0.l1')
    expect(currentLessonFor(fresh({ lessons: doneUpTo('full-ramp', 1) }), CONTENT, NOW)).toBe('r.l1')
    const reading = { 't0.l3': { status: 'reading' as const, lastVisitedAt: daysAgo(1), scrollPct: 10 } }
    expect(currentLessonFor(fresh({ lessons: reading }), CONTENT, NOW)).toBe('t0.l3')
    const lessons = doneUpTo('full-ramp', 1 + pathPlan('full-ramp', CONTENT).lessons.indexOf('t1.l3'))
    expect(recommend(fresh({ lessons }), CONTENT, NOW, 'laptop').kind).toBe('lab')
    expect(currentLessonFor(fresh({ lessons }), CONTENT, NOW)).toBe('t1.l4')
    const t5 = doneUpTo('full-ramp', 1 + pathPlan('full-ramp', CONTENT).lessons.indexOf('t5.l7'))
    expect(currentLessonFor(fresh({ lessons: t5 }), WITH_PLAY, NOW)).toBe('t5.l8')
    const due = { due: 9, priority: 1, minutes: 8, sessionDone: false }
    expect(currentLessonFor(fresh({ lessons: t5, today: due }), WITH_PLAY, NOW)).toBe('t5.l8')
  })

  test('it goes to the prerequisite first, as the lesson footer does, and is null when the plan is done', () => {
    const lessons = doneUpTo('full-ramp', 3)
    delete lessons[pathPlan('full-ramp', CONTENT).lessons[1]]
    for (const path of PATHS) {
      expect(currentLessonFor(fresh({ path, lessons }), CONTENT, NOW)).toBe(recommend(fresh({ path, lessons }), CONTENT, NOW, 'phone').ref)
    }
    const all = Object.fromEntries(ALL_LESSONS.map((l) => [l.id, done()]))
    expect(currentLessonFor(fresh({ lessons: all }), CONTENT, NOW)).toBeNull()
  })

  test('over the real content, a placed learner is never put on an R lesson off the plan', async () => {
    const loaded = await loadUpNext()
    const raw = { v: 1, at: daysAgo(1), entryTrack: 't2', solidKcs: [], missedKcs: [], misconceptions: [], rustAnchor: 'solid', items: 12 } as Json
    const input: UpNextInput = { bootDone: true, lessons: {}, labs: {}, path: undefined, placement: raw, week: undefined }
    expect(currentLessonNow(loaded, input, new Date(NOW))).toBe('t2.l1')
  })
})

describe('Boot and Today name where the path begins', () => {
  test('the full ramp opens with T0.L1 and no R lesson before it; rust-systems opens with R.L1 and reaches T1.L1 after five', () => {
    const lessons = ALL_LESSONS
    expect(firstLessons(pathPlan('full-ramp', CONTENT), lessons)).toEqual({ t: 't0.l1', r: [] })
    expect(firstLessons(pathPlan('serving-first', CONTENT), lessons)).toEqual({ t: 't0.l1', r: [] })
    expect(firstLessons(pathPlan('rust-systems', CONTENT), lessons)).toEqual({ t: 't1.l1', r: ['r.l1', 'r.l2', 'r.l3', 'r.l4', 'r.l5'] })
    expect(firstLessons({ lessons: [] }, lessons)).toEqual({ t: null, r: [] })
  })

  test('a placed full-ramp learner whose braid opens with an R lesson gets that lesson as the partner', () => {
    const plan = pathPlan('full-ramp', CONTENT, { entryTrack: 't2', rustAnchor: 'missed', missedKcs: ['r.borrow-rules'] })
    const first = firstLessons(plan, ALL_LESSONS)
    expect(first.t).not.toBeNull()
    expect(first.r.length).toBeGreaterThan(0)
    expect(first.r.length).toBeLessThanOrEqual(2)
    expect(plan.lessons.slice(0, first.r.length)).toEqual(first.r)
  })

  test("Today's empty state, rule 5, opens with the same lesson Boot names (the R partner when the path starts with R, else the first T lesson)", async () => {
    const loaded = await loadUpNext()
    for (const path of PATHS) {
      const { t, r } = firstLessonsNow(loaded, path, undefined)
      const { rec } = recommendNow(loaded, { bootDone: true, lessons: {}, labs: {}, path, placement: undefined, week: undefined }, new Date(NOW), 1280)
      expect({ path, ref: rec.ref }).toEqual({ path, ref: r[0]?.id ?? t?.id })
      expect(t?.title.length).toBeGreaterThan(0)
    }
    expect(firstLessonsNow(loaded, 'rust-systems', undefined).r.map((l) => l.code)).toEqual(['R.L1', 'R.L2', 'R.L3', 'R.L4', 'R.L5'])
    expect(firstLessonsNow(loaded, undefined, undefined).t?.code).toBe('T0.L1')
  })

  // Boot's line for a path and a raw placement record, computed as You.tsx computes it
  const lineOf = (loaded: Awaited<ReturnType<typeof loadUpNext>>, path: LearningPath | undefined, placement: Json | undefined) =>
    bootLine(firstLessonsNow(loaded, path, placement), loaded.cachedPathPlan(loaded.pathOf(path), loaded.content, loaded.readPlacement(placement)), loaded.content.lessons)

  test('each path blurb says what its unplaced plan does, and Boot says where Rust starts', async () => {
    const loaded = await loadUpNext()
    const trackOf = new Map(ALL_LESSONS.map((l) => [l.id, l.trackId]))
    const runs = (path: LearningPath) => pathPlan(path, CONTENT).lessons.map((id) => trackOf.get(id)).filter((t, i, a) => t !== a[i - 1])
    const title = (id: string) => ALL_LESSONS.find((l) => l.id === id)?.title
    // the full ramp holds every track, opens with a T lesson and reaches R.L1 second (a learner once read "Rust Zero,
    // then Track 0" there and was surprised to land in T0.L1); Boot names both
    expect([...new Set(runs('full-ramp'))].sort()).toEqual(['r', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
    expect(pathPlan('full-ramp', CONTENT).lessons.slice(0, 2)).toEqual(['t0.l1', 'r.l1'])
    expect(lineOf(loaded, 'full-ramp', undefined)).toEqual({
      line: `Your first lesson is T0.L1 · ${title('t0.l1')}. Rust starts right after it, with R.L1 · ${title('r.l1')}.`,
      skips: false,
    })
    // a learner who skips the choice is on the full ramp, and Boot says the same
    expect(lineOf(loaded, undefined, undefined)).toEqual(lineOf(loaded, 'full-ramp', undefined))
    // rust-systems: half of R, T1, the other half, T2, T3, and nothing after
    expect(runs('rust-systems')).toEqual(['r', 't1', 'r', 't2', 't3'])
    expect(lineOf(loaded, 'rust-systems', undefined).line).toBe(`Your path starts with R.L1 · ${title('r.l1')} and reaches T1.L1 · ${title('t1.l1')} after 5 Rust lessons.`)
    // serving-first: two T0 lessons and the roofline, then T5 to T7, and no R lesson at all
    expect(pathPlan('serving-first', CONTENT).lessons.slice(0, 4)).toEqual(['t0.l1', 't0.l2', 't4.l3', 't5.l1'])
    expect(runs('serving-first')).toEqual(['t0', 't4', 't5', 't6', 't7'])
    expect(lineOf(loaded, 'serving-first', undefined).line).toBe(`Your first lesson is T0.L1 · ${title('t0.l1')}.`)
    const you = readFileSync(join(import.meta.dir, '../../src/pages/boot/You.tsx'), 'utf8')
    for (const gone of ['Rust Zero, then Track 0', 'serving later', 'Rust arrives as short reading items']) expect(you).not.toContain(gone)
    for (const said of ['each Rust Zero lesson woven in', 'Rust Zero is not on this path', 'Serving (Tracks 4 to 7) is not on this path', 'Systems Forge labs 01, 04 and 05']) {
      expect(you).toContain(said)
    }
  })

  test("a placement moves where Rust starts, and Boot's line follows the placed plan, never the blurb", async () => {
    const loaded = await loadUpNext()
    const placed = (entryTrack: TrackId, rustAnchor: 'solid' | 'missed' | 'skipped', missedKcs: string[] = []): Json =>
      ({ v: 1, at: NOW, entryTrack, solidKcs: [], missedKcs, misconceptions: [], rustAnchor, items: 12 }) as Json
    const gapOf = (p: Json, t: string) => {
      const lessons = loaded.cachedPathPlan('full-ramp', loaded.content, loaded.readPlacement(p)).lessons
      return lessons.indexOf('r.l1') - lessons.indexOf(t) - 1
    }
    // entered at T4 with the Rust anchor missed: R.L1 comes after the T4 lessons, so "right after it" would be false
    const t4 = placed('t4', 'missed', ['t4.bound-classification', 'r.borrow-rules'])
    expect(gapOf(t4, 't4.l1')).toBe(5)
    const at4 = lineOf(loaded, 'full-ramp', t4)
    expect(at4.line).toMatch(/^Your first lesson is T4\.L1 · .+\. After it come 5 more lessons, then Rust starts with R\.L1 · /)
    expect(at4.skips).toBe(true)
    // one lesson between them reads in the singular
    const one = placed('t7', 'missed', ['t0.flame-graphs'])
    expect(gapOf(one, 't0.l6')).toBe(1)
    expect(lineOf(loaded, 'full-ramp', one).line).toMatch(/^Your first lesson is T0\.L6 · .+\. After it comes 1 more lesson, then Rust starts with R\.L1 · /)
    // a solid anchor turns R into test-outs: no R lesson in the plan, so the line names none
    expect(lineOf(loaded, 'full-ramp', placed('t1', 'solid'))).toMatchObject({ line: expect.stringMatching(/^Your first lesson is T1\.L1 · [^.]+\.$/), skips: true })
    // rust-systems entered at T5: nothing left with a solid anchor, only R with a missed one
    expect(lineOf(loaded, 'rust-systems', placed('t5', 'solid')).line).toBe('Your placement already covers this path, so Today offers practice; another path still has lessons for you.')
    expect(lineOf(loaded, 'rust-systems', placed('t5', 'missed', ['r.borrow-rules'])).line).toMatch(/^Your path is 10 Rust lessons, starting with R\.L1 · /)
    // the legend's placement clause needs a placement that moved something: not a refused record, not a no-op one
    expect(lineOf(loaded, 'full-ramp', { v: 2, at: NOW } as Json).skips).toBe(false)
    expect(lineOf(loaded, 'serving-first', placed('t0', 'missed', ['r.borrow-rules'])).skips).toBe(false)
  })

  test("Boot's last step shows the line, and the surfaces read the one recommender", () => {
    const src = (f: string) => readFileSync(join(import.meta.dir, '../../src', f), 'utf8')
    expect(src('pages/boot/You.tsx')).toContain('firstLessonsNow')
    expect(src('pages/boot/You.tsx')).toContain('data-boot-first-lesson')
    expect(src('pages/Curriculum.tsx')).toContain('useCurrentLesson')
    for (const f of ['pages/today/DoneCard.tsx', 'pages/today/EmptyState.tsx', 'pages/Lesson.tsx']) expect(src(f)).toContain('UpNextCard')
    expect(src('pages/today/DoneCard.tsx')).not.toContain('export function UpNext')
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

/**
 * The surfaces that are not the lesson footer (Today's empty state, done card and plan line, Home's Resume,
 * Progress's Up Next) all call `recommendNow`, which turns the store's raw working records into one
 * `recommend()`. These run it the way they do: raw `placement:result` JSON, no Boot, no lessons.
 */
describe('Up Next on Today, Home and Progress', () => {
  const rawPlacement = (entryTrack: TrackId, rustAnchor: PlacementResult['rustAnchor'], missedKcs: string[] = []): Json => ({
    v: 1,
    at: daysAgo(1),
    entryTrack,
    solidKcs: [],
    missedKcs,
    misconceptions: [],
    rustAnchor,
    items: 12,
  })
  const input = (over: Partial<UpNextInput> = {}): UpNextInput => ({
    bootDone: false,
    lessons: {},
    labs: {},
    path: undefined,
    placement: undefined,
    week: undefined,
    ...over,
  })
  const NOW_DATE = new Date(NOW)

  test('a placed learner whose Rust anchor was solid never gets r.l1, and one who missed it does', async () => {
    const loaded = await loadUpNext()
    for (const track of ['t0', 't1', 't2', 't5'] as const) {
      for (const anchor of ['solid', 'skipped'] as const) {
        const { rec } = recommendNow(loaded, input({ placement: rawPlacement(track, anchor) }), NOW_DATE, 1280)
        expect({ track, anchor, kind: rec.kind }).toEqual({ track, anchor, kind: 'lesson' })
        expect(rec.ref).not.toStartWith('r.')
        expect(rec.title).not.toStartWith('R.L1')
      }
    }
    const missed = recommendNow(loaded, input({ placement: rawPlacement('t2', 'missed', ['r.borrow-rules']) }), NOW_DATE, 1280)
    expect(missed.rec.ref).toBe('r.l1')
  })

  test('a placed learner who skipped Boot is sent to their entry track, not to Boot', async () => {
    const loaded = await loadUpNext()
    const { rec, offerPlacement: offer } = recommendNow(loaded, input({ placement: rawPlacement('t1', 'solid') }), NOW_DATE, 1280)
    expect(rec).toMatchObject({ kind: 'lesson', ref: 't1.l1', to: '/lesson/t1.l1' })
    expect(offer).toBe(false)
  })

  test('with no Boot, no lesson and no placement: Boot, and the placement walk is offered beside it', async () => {
    const loaded = await loadUpNext()
    const { rec, offerPlacement: offer } = recommendNow(loaded, input(), NOW_DATE, 1280)
    expect(rec).toMatchObject({ kind: 'boot', to: '/boot', why: BOOT_WHY })
    expect(offer).toBe(true)
  })

  test("a lesson only read is behind the learner, and the minutes are the next lesson's own", async () => {
    const loaded = await loadUpNext()
    const first = pathPlan('full-ramp', CONTENT, null).lessons
    const lessons = { [first[0]]: { status: 'read' as const, lastVisitedAt: daysAgo(30) } }
    const { rec } = recommendNow(loaded, input({ bootDone: true, lessons }), NOW_DATE, 1280)
    const lesson = ALL_LESSONS.find((l) => l.id === rec.ref)
    expect(rec.ref).not.toBe(first[0])
    expect(rec.kind).toBe('lesson')
    expect(rec.minutes).toBe(lesson?.minutes)
  })

  test('a first visit is a learner with no Boot, no lesson record, no graded event and no placement', () => {
    const base = { bootDone: false, hasLessonRecords: false, graded: false, placed: false }
    expect(isFirstVisit(base)).toBe(true)
    for (const key of Object.keys(base) as (keyof typeof base)[]) expect(isFirstVisit({ ...base, [key]: true })).toBe(false)
  })

  test('no surface keeps a stand-in: all three take Up Next from recommend()', () => {
    const src = (f: string) => readFileSync(join(import.meta.dir, '../../src', f), 'utf8')
    // Progress is /me's Journey section since 3b-06 (wave-3.md §12.5)
    for (const page of ['pages/Today.tsx', 'pages/Home.tsx', 'pages/me/Journey.tsx']) expect(src(page)).toContain('useUpNext')
    expect(src('pages/me/Journey.tsx')).not.toContain('~12min')
    for (const f of ['pages/Today.tsx', 'pages/Home.tsx', 'pages/Me.tsx', 'pages/me/Journey.tsx', 'lib/learner/today.ts', 'lib/progress.ts']) {
      expect(src(f)).not.toMatch(/upNextFor|selectNextLesson/)
    }
    expect(src('pages/me/Journey.tsx')).not.toMatch(/ORDERED_LESSON_IDS\.find/)
  })
})
