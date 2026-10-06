/**
 * The R.L1 guarantee (docs/specs/wave-2.md §7.1; PLAN-100X K3 "nobody placed lands on R.L1"): a placed
 * learner is never sent to R.L1, whatever the placement found, unless the Rust anchor was missed and the path
 * includes R. It is the build half of the metric; the field half is `selectPlacementLanding` (§20).
 *
 * Over 10,000 random `PlacementResult`s x the three paths x random prefixes of completed lessons, neither
 * `pathPlan`, `recommend()` nor the Curriculum's "current" marker puts `r.l1` first. Wave 1 (BF2) pinned the
 * rule for a solid anchor in `recommend.test.ts`; this grows it to every placement shape (any entry track,
 * any anchor state, any solid and missed KCs, frontier probes included) and every surface that names a
 * next lesson. A failure prints the seed, the path and the placement that broke it.
 */
import { describe, expect, test } from 'bun:test'
import { KCS } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { TrackId } from '../../src/data/lessons/types'
import { PATHS, cachedPathPlan, pathIncludesR, pathPlan } from '../../src/lib/learner/paths'
import { FRONTIER_PROBES, PROBES, currentLesson } from '../../src/lib/learner/placement'
import { recommend, type RecommendContent, type RecommendLessonState, type RecommendState } from '../../src/lib/learner/recommend'
import type { PlacementResult } from '../../src/lib/learner/types'
import type { LearningPath } from '../../src/lib/ledger/types'

const CONTENT: RecommendContent = { kcs: KCS, lessons: ALL_LESSONS, labs: FORGE_LABS }
const NOW = '2026-10-05T12:00:00.000Z'
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString()

const RESULTS = 10_000
/** Completion prefixes tried per result and path. */
const PREFIXES = 3
const TRACKS: TrackId[] = ['r', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']
const ANCHORS: PlacementResult['rustAnchor'][] = ['solid', 'missed', 'skipped']
/** KCs a placement can name: the probes, frontier included. */
const NAMED = [...PROBES, ...FRONTIER_PROBES.map((f) => f.kc)]
/**
 * The KCs a plan can turn on when missed (the plan reads missed KCs, not solid ones): the anchor, a core KC of
 * T0 and of T1, and the two frontier KCs. Drawing missed KCs from this pool keeps the plan memo small, so 10,000
 * results stay fast; `solidKcs` and a rare wide `missedKcs` range over the whole graph.
 */
const PLAN_POOL = ['r.borrow-rules', 't0.locality', 't1.external-frag', ...FRONTIER_PROBES.map((f) => f.kc)]

/** mulberry32: a small deterministic PRNG, so a failure names a seed that reproduces it. */
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

/** A placement any walk, or a damaged-but-readable record, could hold: nothing is assumed about how the KCs fall. */
function randomResult(seed: number): PlacementResult {
  const r = rng(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const solidKcs: string[] = []
  const missedKcs: string[] = []
  for (const kc of NAMED) if (r() < 0.4) solidKcs.push(kc)
  for (const kc of PLAN_POOL) if (r() < 0.4) missedKcs.push(kc)
  // any other KC of the graph too, so a solid or missed R or T KC outside the probes is covered
  for (const k of KCS) if (r() < 0.05) solidKcs.push(k.id)
  if (r() < 0.02) for (const k of KCS) if (r() < 0.05) missedKcs.push(k.id)
  return {
    v: 1,
    at: NOW,
    entryTrack: pick(TRACKS),
    solidKcs: [...new Set(solidKcs)],
    missedKcs: [...new Set(missedKcs)],
    misconceptions: [],
    rustAnchor: pick(ANCHORS),
    items: 14 + Math.floor(r() * 7),
  }
}

/** The one case that may start at R.L1 (§7.1). */
const mayStartAtR1 = (path: LearningPath, p: Pick<PlacementResult, 'rustAnchor'>) => p.rustAnchor === 'missed' && pathIncludesR(path)

const done = (at = daysAgo(1)): RecommendLessonState => ({ status: 'done', lastVisitedAt: at })

/** A random learner's lessons: the first `n` lessons of `order` done, plus a few others in other states (R.L1 reading a third of the time, so a resume could pick it). */
function completion(order: readonly string[], r: () => number): Record<string, RecommendLessonState> {
  const lessons: Record<string, RecommendLessonState> = {}
  const n = Math.floor(r() * (order.length + 1))
  for (const id of order.slice(0, n)) lessons[id] = done(daysAgo(Math.floor(r() * 30)))
  for (const l of ALL_LESSONS) {
    if (lessons[l.id] || r() >= 0.06) continue
    const x = r()
    lessons[l.id] = x < 0.4 ? { status: 'read', lastVisitedAt: daysAgo(Math.floor(r() * 30)) } : { status: 'reading', lastVisitedAt: daysAgo(Math.floor(r() * 14)), scrollPct: Math.floor(r() * 100) }
  }
  if (r() < 0.33) lessons['r.l1'] = { status: 'reading', lastVisitedAt: daysAgo(1), scrollPct: 30 }
  return lessons
}

describe('the R.L1 guarantee', () => {
  test('the walk and the plan agree on the allowed case: R.L1 leads the plan of a missed anchor on a path with R, and only there', () => {
    for (const path of PATHS) {
      for (const rustAnchor of ANCHORS) {
        const placement = { entryTrack: 't2' as TrackId, rustAnchor, missedKcs: [], solidKcs: [] }
        const plan = pathPlan(path, CONTENT, placement)
        expect(plan.lessons.includes('r.l1')).toBe(mayStartAtR1(path, placement))
        if (mayStartAtR1(path, placement)) expect(plan.lessons[0]).toBe('r.l1')
      }
    }
  })

  test(`over ${RESULTS} random placement results x ${PATHS.length} paths x random completion prefixes, r.l1 is never first unless the anchor was missed on a path with R`, () => {
    // violations are collected and compared once: 10,000 x 3 x 4 checks stay fast, and a failure names every case
    const violations: string[] = []
    let allowedPlans = 0
    let forbiddenPlans = 0
    let recommended = 0
    let r1Recommended = 0
    for (let seed = 0; seed < RESULTS; seed++) {
      const result = randomResult(seed)
      const r = rng(seed ^ 0x5eed)
      for (const path of PATHS) {
        const allowed = mayStartAtR1(path, result)
        const at = `seed ${seed} ${path} anchor ${result.rustAnchor} entry ${result.entryTrack}`

        // 1. the plan (Up Next reads the memoised one; every tenth result is also checked against a fresh build)
        const plan = cachedPathPlan(path, CONTENT, result)
        if (seed % 10 === 0 && JSON.stringify(pathPlan(path, CONTENT, result)) !== JSON.stringify(plan)) violations.push(`${at}: the memoised plan differs from a fresh one`)
        if (allowed) allowedPlans += 1
        else {
          forbiddenPlans += 1
          if (plan.lessons[0] === 'r.l1' || plan.steps[0] === 'r.l1') violations.push(`${at}: the plan starts at r.l1`)
          // stronger than "first": a placed learner who may not start at R.L1 does not have it in the plan at all
          if (plan.lessons.includes('r.l1')) violations.push(`${at}: r.l1 is in the plan`)
        }

        // 2. Up Next, for random completion prefixes of the plan (plus lessons in other states; R.L1 open a third of the time)
        for (let k = 0; k < PREFIXES; k++) {
          const lessons = completion(plan.lessons, r)
          const state: RecommendState = {
            bootDone: r() < 0.8,
            lessons,
            labs: {},
            path,
            placement: { entryTrack: result.entryTrack, missedKcs: result.missedKcs, solidKcs: result.solidKcs, rustAnchor: result.rustAnchor },
            today: null,
          }
          const day = (['phone', 'laptop', 'rest'] as const)[Math.floor(r() * 3)]
          const rec = recommend(state, CONTENT, NOW, day)
          recommended += 1
          if (rec.ref === 'r.l1') r1Recommended += 1
          if (!allowed && rec.ref === 'r.l1') violations.push(`${at} prefix ${k}: recommend() names r.l1`)

          // 3. the Curriculum's "current" marker reads the same plan
          if (!allowed && currentLesson(plan, (id) => lessons[id]?.status) === 'r.l1') violations.push(`${at} prefix ${k}: the current marker is r.l1`)
        }
      }
    }
    expect(violations.slice(0, 20)).toEqual([])
    // the property is not vacuous: both kinds of placement were drawn, and the allowed case does reach R.L1
    expect(allowedPlans).toBeGreaterThan(RESULTS / 2)
    expect(forbiddenPlans).toBeGreaterThan(RESULTS)
    expect(recommended).toBe(RESULTS * PATHS.length * PREFIXES)
    expect(r1Recommended).toBeGreaterThan(0)
  }, 60_000)

  test('the first lesson recommended to a placed learner with nothing done is never R.L1 unless the anchor was missed on a path with R', () => {
    for (const path of PATHS) {
      for (const entryTrack of TRACKS.slice(1)) {
        for (const rustAnchor of ANCHORS) {
          const state: RecommendState = { bootDone: true, lessons: {}, labs: {}, path, placement: { entryTrack, missedKcs: [], solidKcs: [], rustAnchor }, today: null }
          const rec = recommend(state, CONTENT, NOW, 'phone')
          const expected = mayStartAtR1(path, { rustAnchor })
          expect({ path, entryTrack, rustAnchor, r1: rec.ref === 'r.l1' }).toEqual({ path, entryTrack, rustAnchor, r1: expected && rec.ref === 'r.l1' })
        }
      }
    }
  })
})
