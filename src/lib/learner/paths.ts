/**
 * Paths and the braid (docs/specs/wave-1.md §7.3; PLAN-100X §4.D): the ordered lesson sequence each of the
 * three learning paths implies, adjusted for a placement result. Pure, with no data imports: the caller
 * passes the KC graph, the lessons (curriculum order) and the labs, so the plan is a function of static
 * content and the placement record alone (invariant W2), and tests can run it on fixtures.
 *
 * - `full-ramp` (braided): the T lessons in curriculum order, with each R lesson placed immediately before
 *   the first T lesson that needs it, read off the KC graph's pairing edges (§4.3). The R → R edges are
 *   kept too: an R lesson moves earlier when a later R lesson needs it first. R numbering is not otherwise
 *   kept, so R.L10 (compare-and-exchange, for T2.L5) comes before R.L9 (lifetimes, for T2.L6); the graph
 *   says R.L10 does not build on R.L9 (Opus decision, B22). At most two R lessons run back to back: when
 *   more are due before one T lesson, the earliest slide back past the T lesson before it. That keeps
 *   every R lesson ahead of its first dependant, where the spec's "slide after it" would put one after the
 *   lesson that needs it. Sliding forward is left only for a run due before the very first T lesson,
 *   which happens only in a placed plan (anchor missed, early tracks skipped); recommend()'s rule 5 still
 *   sends that learner to the prerequisite first.
 * - `serving-first`: t0.l1, t0.l2, t4.l3, T5, T6, T7 (755 declared minutes). R arrives as reading items
 *   only, and labs are optional, so neither is a step.
 * - `rust-systems`: R.L1-R.L5, T1 (lab 01 after t1.l3), R.L6-R.L10, T2 (lab 04 after t2.l5), T3 (lab 05
 *   after t3.l4).
 *
 * Labs follow their host lesson, or the last of their readiness lessons when that comes later. Placement
 * skips the lessons of tracks before `entryTrack` unless a missed KC of that track lives there, and turns
 * R into test-outs unless the Rust anchor was missed, so nobody placed is sent to R.L1 (the K3 metric).
 */

import type { TrackId } from '@/data/lessons/types'
import type { Kc, KcId } from '@/lib/kc/types'
import type { LearningPath } from '@/lib/ledger/types'
import type { PathPlan, PlacementResult } from './types'

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

/** What a plan reads of a lesson. `Lesson` from src/data/lessons satisfies it. */
export interface PathLesson {
  id: string
  trackId: TrackId
}

/** What a plan reads of a lab. `ForgeLab` from src/data/labs satisfies it. */
export interface PathLab {
  id: string
  /** The host lesson the lab deepens. */
  lessonId: string
  readiness?: { lessonIds: readonly string[] }
}

export interface PathGraph {
  /** The KC graph (src/data/kc `KCS`). */
  kcs: readonly Kc[]
  /** Every lesson, in curriculum order (src/data/lessons `ALL_LESSONS`). */
  lessons: readonly PathLesson[]
  labs: readonly PathLab[]
}

/** The placement fields a plan reads (`placement:result`). */
export type PathPlacement = Pick<PlacementResult, 'entryTrack' | 'missedKcs' | 'rustAnchor'>

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const PATHS: readonly LearningPath[] = ['full-ramp', 'serving-first', 'rust-systems']
export const DEFAULT_PATH: LearningPath = 'full-ramp'

/** How the why lines name a path. */
export const PATH_LABEL: Readonly<Record<LearningPath, string>> = {
  'full-ramp': 'the full ramp',
  'serving-first': 'serving-first',
  'rust-systems': 'Rust systems',
}

/** The braid's cap: never more than this many R lessons in a row. */
export const MAX_R_RUN = 2

/** Curriculum rank of each track: "before the entry track" compares these. */
const TRACK_RANK: Readonly<Record<TrackId, number>> = { r: 0, t0: 1, t1: 2, t2: 3, t3: 4, t4: 5, t5: 6, t6: 7, t7: 8 }

/** serving-first's head before T5-T7 (PLAN §4 Wei). */
const SERVING_HEAD: readonly string[] = ['t0.l1', 't0.l2', 't4.l3']
const SERVING_TRACKS: readonly TrackId[] = ['t5', 't6', 't7']

/** rust-systems: R.L1-R.L5 before T1, the rest of R before T2; labs 01, 04 and 05 only. */
const RUST_FIRST_HALF = 5
export const RUST_SYSTEMS_LABS: readonly string[] = ['rust-allocator', 'mpmc-queue', 'toy-executor']

/** Paths whose lessons include R (placement's anchor rule only applies to these). */
export const pathIncludesR = (path: LearningPath): boolean => path !== 'serving-first'

/** A `steps` entry for a lab. */
export const labStep = (labId: string): string => `lab:${labId}`

/** The lab id of a `steps` entry, or null for a lesson. */
export const labOfStep = (step: string): string | null => (step.startsWith('lab:') ? step.slice(4) : null)

/* ------------------------------------------------------------------ */
/* The braid                                                           */
/* ------------------------------------------------------------------ */

/** Why an R lesson sits where it does: the first T lesson that needs it, and through which edge. */
export interface BraidPair {
  r: string
  /** First dependant among the braided T lessons, or null when none of them needs it. */
  t: string | null
  /** The T-side KC that needs the R lesson, and the KC of the R lesson it needs. */
  via: { kc: KcId; needs: KcId } | null
  /** True when the cap moved the lesson off the slot right before `t`. */
  slid: boolean
}

export interface Braid {
  lessons: string[]
  pairs: BraidPair[]
}

/** KCs taught in a lesson (introduced there or revisited), in graph order. */
export function kcsOfLesson(kcs: readonly Kc[], lessonId: string): Kc[] {
  return kcs.filter((k) => k.lessons.includes(lessonId))
}

/** KCs a lesson introduces (its first lesson), in graph order. */
export function kcsIntroducedBy(kcs: readonly Kc[], lessonId: string): Kc[] {
  return kcs.filter((k) => k.lessons[0] === lessonId)
}

/**
 * The edge through which T lesson `t` needs R lesson `r`, or null: a KC taught in `t` that requires a KC
 * `r` introduces, or that is itself one of them (a T lesson revisiting an R KC needs its introduction).
 * The lesson's own T-track KCs are tried first, so the reported edge names the T concept.
 */
function needEdge(kcs: readonly Kc[], introduced: ReadonlySet<KcId>, t: string): BraidPair['via'] {
  const taught = kcsOfLesson(kcs, t)
  for (const k of [...taught.filter((x) => x.track !== 'r'), ...taught.filter((x) => x.track === 'r')]) {
    if (introduced.has(k.id)) return { kc: k.id, needs: k.id }
    const needs = k.requires.find((id) => introduced.has(id))
    if (needs) return { kc: k.id, needs }
  }
  return null
}

/**
 * Braid R lessons into T lessons. Each R lesson goes right before the first T lesson that needs it, or
 * earlier when a later R lesson needs it first (an R lesson never follows one that builds on it). Within a
 * slot R lessons keep their own order. The cap then slides the earliest of any run longer than
 * `MAX_R_RUN` back before the previous T lesson. Deterministic.
 */
export function braid(kcs: readonly Kc[], rLessons: readonly string[], tLessons: readonly string[]): Braid {
  const n = tLessons.length
  const introduced = rLessons.map((r) => new Set(kcsIntroducedBy(kcs, r).map((k) => k.id)))
  const firstNeed = rLessons.map((_, i) => {
    for (let s = 0; s < n; s++) {
      const via = needEdge(kcs, introduced[i], tLessons[s])
      if (via) return { slot: s, via }
    }
    return { slot: n, via: null }
  })
  // an R lesson is due no later than any R lesson that needs it; one no braided T lesson needs (its
  // dependants were skipped by placement) is due no later than the next R lesson, rather than after T7.
  // Slots only fall, so this reaches a fixed point.
  const slot = firstNeed.map((f) => f.slot)
  const needers = rLessons.map((_, i) => rLessons.flatMap((r, j) => (j !== i && needEdge(kcs, introduced[i], r) ? [j] : [])))
  rLessons.forEach((_, i) => {
    if (firstNeed[i].slot === n && i + 1 < rLessons.length) needers[i].push(i + 1)
  })
  for (let changed = true; changed; ) {
    changed = false
    needers.forEach((js, i) => {
      for (const j of js) {
        if (slot[j] < slot[i]) {
          slot[i] = slot[j]
          changed = true
        }
      }
    })
  }
  const ideal = [...slot]

  // buckets[s] = R lessons placed right before tLessons[s] (s = n: after the last T lesson), in R order
  const buckets: number[][] = Array.from({ length: n + 1 }, () => [])
  slot.forEach((s, i) => buckets[s].push(i))
  const byIndex = (a: number, b: number) => a - b
  // slide back: the earliest of a long run move before the previous T lesson
  for (let s = n; s >= 1; s--) {
    buckets[s].sort(byIndex)
    while (buckets[s].length > MAX_R_RUN) buckets[s - 1].push(buckets[s].shift() as number)
  }
  // nothing before the first T lesson: only then do the latest of a run slide forward
  for (let s = 0; s < n; s++) {
    buckets[s].sort(byIndex)
    while (buckets[s].length > MAX_R_RUN) buckets[s + 1].unshift(buckets[s].pop() as number)
  }
  buckets[n].sort(byIndex)

  const lessons: string[] = []
  const placed = new Array<number>(rLessons.length)
  for (let s = 0; s <= n; s++) {
    for (const i of buckets[s]) {
      placed[i] = s
      lessons.push(rLessons[i])
    }
    if (s < n) lessons.push(tLessons[s])
  }
  const pairs = rLessons.map((r, i) => {
    const t = firstNeed[i].slot < n ? tLessons[firstNeed[i].slot] : null
    return { r, t, via: firstNeed[i].via, slid: placed[i] !== ideal[i] }
  })
  return { lessons, pairs }
}

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

/** A plan with what placement took out, for the why lines and the curriculum's markers. */
export interface PathPlanDetail extends PathPlan {
  /** Lessons placement skipped (before the entry track, no missed KC there). */
  skipped: string[]
  /** R lessons offered as test-outs because the Rust anchor was solid (or not probed). */
  testOut: string[]
  /** The braid's pairing for the R lessons in `lessons` (full ramp only; empty otherwise). */
  pairs: BraidPair[]
}

const idsOf = (lessons: readonly PathLesson[], keep: (l: PathLesson) => boolean): string[] => lessons.filter(keep).map((l) => l.id)

/** Place each lab after its host and its readiness lessons, when its host is in the plan. */
function withLabs(lessons: readonly string[], labs: readonly PathLab[]): string[] {
  const at = new Map(lessons.map((id, i) => [id, i]))
  const after = new Map<number, string[]>()
  for (const lab of labs) {
    const host = at.get(lab.lessonId)
    if (host === undefined) continue
    // a readiness lesson outside the plan (skipped, tested out, off-path) does not hold the lab back
    const ready = (lab.readiness?.lessonIds ?? []).map((id) => at.get(id) ?? -1)
    const pos = Math.max(host, ...ready)
    after.set(pos, [...(after.get(pos) ?? []), labStep(lab.id)])
  }
  return lessons.flatMap((id, i) => [id, ...(after.get(i) ?? [])])
}

/**
 * The plan for `path`, adjusted for `placement` (null = not placed). Pure and deterministic: the same
 * content and placement give a deep-equal plan.
 */
export function pathPlan(path: LearningPath, graph: PathGraph, placement: PathPlacement | null = null): PathPlanDetail {
  const { kcs, lessons } = graph
  const missed = new Set(placement?.missedKcs ?? [])
  // a missed KC keeps the lessons of its own track that teach it; a T lesson that only revisits an R KC
  // (T1.L6 and the borrow rules) stays skipped, since a missed anchor already brings R back
  const missedLivesIn = (l: PathLesson) => kcs.some((k) => missed.has(k.id) && k.track === l.trackId && k.lessons.includes(l.id))
  const entryRank = placement ? TRACK_RANK[placement.entryTrack] ?? 0 : 0
  const keepT = (l: PathLesson) => TRACK_RANK[l.trackId] >= entryRank || missedLivesIn(l)
  // R stays a lesson sequence unless a placement found the anchor solid or never probed it
  const rAsLessons = !placement || placement.rustAnchor === 'missed'

  const rAll = idsOf(lessons, (l) => l.trackId === 'r')
  const rKept = pathIncludesR(path) && rAsLessons ? rAll : []
  const testOut = pathIncludesR(path) && !rAsLessons ? rAll : []

  let candidates: string[]
  let order: string[]
  let pairs: BraidPair[] = []
  let labs: readonly PathLab[] = graph.labs
  if (path === 'serving-first') {
    candidates = idsOf(lessons, (l) => SERVING_HEAD.includes(l.id) || SERVING_TRACKS.includes(l.trackId))
    order = candidates.filter((id) => keepT(lessons.find((l) => l.id === id) as PathLesson))
    labs = []
  } else if (path === 'rust-systems') {
    const t = (track: TrackId) => idsOf(lessons, (l) => l.trackId === track && keepT(l))
    candidates = idsOf(lessons, (l) => ['r', 't1', 't2', 't3'].includes(l.trackId))
    const r = new Set(rKept)
    const [r1, r2] = [rAll.slice(0, RUST_FIRST_HALF).filter((id) => r.has(id)), rAll.slice(RUST_FIRST_HALF).filter((id) => r.has(id))]
    order = [...r1, ...t('t1'), ...r2, ...t('t2'), ...t('t3')]
    labs = graph.labs.filter((lab) => RUST_SYSTEMS_LABS.includes(lab.id))
  } else {
    candidates = idsOf(lessons, () => true)
    const tKept = idsOf(lessons, (l) => l.trackId !== 'r' && keepT(l))
    const b = braid(kcs, rKept, tKept)
    order = b.lessons
    pairs = b.pairs
  }

  const inPlan = new Set(order)
  const skipped = candidates.filter((id) => !inPlan.has(id) && !testOut.includes(id))
  return { path, lessons: order, steps: withLabs(order, labs), skipped, testOut, pairs }
}

/**
 * Memoised `pathPlan` per graph object: Up Next runs on every render of four surfaces, and the plan only
 * changes with the path or the placement.
 */
const memo = new WeakMap<PathGraph, Map<string, PathPlanDetail>>()
export function cachedPathPlan(path: LearningPath, graph: PathGraph, placement: PathPlacement | null = null): PathPlanDetail {
  let byKey = memo.get(graph)
  if (!byKey) memo.set(graph, (byKey = new Map()))
  const key = placement ? `${path}|${placement.entryTrack}|${placement.rustAnchor}|${[...placement.missedKcs].sort().join(',')}` : path
  let plan = byKey.get(key)
  if (!plan) byKey.set(key, (plan = pathPlan(path, graph, placement)))
  return plan
}

/** `R.L4`, `T1.L4`: how lessons are named in why lines. */
export const lessonCode = (lessonId: string): string => lessonId.toUpperCase()

/** A readable path name from the `boot:path` working value; anything else is the full ramp. */
export function pathOf(value: unknown): LearningPath {
  return typeof value === 'string' && (PATHS as readonly string[]).includes(value) ? (value as LearningPath) : DEFAULT_PATH
}
