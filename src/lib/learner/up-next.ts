/**
 * The one Up Next on the surfaces that are not the lesson footer (docs/specs/wave-1.md §7.3, wave-2.md §7.2):
 * Today's empty state, done card and plan line, Home's Resume, Curriculum's "current" marker, Boot's last
 * step and Progress's Up Next. All of them call `recommend()` over the same inputs the lesson footer uses
 * (`loadUpNext` is the footer's loader too), so no page can name a different next lesson than the path does.
 *
 * The recommender, the KC graph, the labs, the lessons and the planner load on demand, so a page that only
 * links to Up Next pays for none of them before it paints; until they land `useUpNext` says `loading`, and if
 * they cannot load it says `error`, because a link must never depend on a chunk. Today's own due cards are
 * Today's and Home's Today card to point at, so this passes no summary and rule 2 does not fire.
 */

import { useEffect, useMemo, useState } from 'react'
import { localDateKey } from '@/lib/economy'
import type { Json, LocalDay } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import type { RecommendContent, RecommendState } from './recommend'
import type { Recommendation } from './types'

export interface UpNextContent {
  recommend: typeof import('./recommend').recommend
  currentLessonFor: typeof import('./recommend').currentLessonFor
  offerPlacement: typeof import('./recommend').offerPlacement
  /** Lessons, labs and the registered plays (`PLAYS` is the registry's twin, so a play in it is registered). */
  content: RecommendContent
  firstLessons: typeof import('./paths').firstLessons
  cachedPathPlan: typeof import('./paths').cachedPathPlan
  readPlacement: typeof import('./placement').readPlacement
  pathOf: typeof import('./paths').pathOf
  dayKindOf: typeof import('./planner').dayKindOf
  normalizeWeekPlan: typeof import('./planner').normalizeWeekPlan
}

let loading: Promise<UpNextContent> | null = null

/** Fetch everything `recommend()` needs, once per page load. A failed load is tried again on the next call. */
export function loadUpNext(): Promise<UpNextContent> {
  loading ??= Promise.all([
    import('@/data/kc'),
    import('@/data/labs'),
    import('@/data/lessons'),
    import('@/data/plays'),
    import('./recommend'),
    import('./placement'),
    import('./paths'),
    import('./planner'),
  ])
    .then(([kc, labs, lessons, plays, rec, placement, paths, planner]) => ({
      recommend: rec.recommend,
      currentLessonFor: rec.currentLessonFor,
      offerPlacement: rec.offerPlacement,
      content: { kcs: kc.KCS, lessons: lessons.ALL_LESSONS, labs: labs.FORGE_LABS, plays: Object.values(plays.PLAYS) },
      firstLessons: paths.firstLessons,
      cachedPathPlan: paths.cachedPathPlan,
      readPlacement: placement.readPlacement,
      pathOf: paths.pathOf,
      dayKindOf: planner.dayKindOf,
      normalizeWeekPlan: planner.normalizeWeekPlan,
    }))
    .catch((err) => {
      loading = null
      throw err
    })
  return loading
}

/**
 * Home's first visit: nothing done, nothing graded and no placement. A learner who placed (the walk writes
 * no graded event) and skipped Boot has chosen where to start, so Home does not send them to Boot.
 */
export function isFirstVisit(s: { bootDone: boolean; hasLessonRecords: boolean; graded: boolean; placed: boolean }): boolean {
  return !s.bootDone && !s.hasLessonRecords && !s.graded && !s.placed
}

export type UpNextState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; rec: Recommendation; offerPlacement: boolean }

/** What `recommend()` reads of the learner, as the store holds it (the working records are raw JSON). */
export interface UpNextInput {
  bootDone: boolean
  lessons: RecommendState['lessons']
  labs: RecommendState['labs']
  /** `aggregate.plays`; omitted where plays are not offered. */
  plays?: RecommendState['plays']
  /** `working['boot:path']`. */
  path: Json | undefined
  /** `working['placement:result']`. */
  placement: Json | undefined
  /** `working['boot:week']`. */
  week: Json | undefined
}

function stateOf(loaded: UpNextContent, input: UpNextInput): RecommendState {
  return {
    bootDone: input.bootDone,
    lessons: input.lessons,
    labs: input.labs,
    path: loaded.pathOf(input.path),
    placement: loaded.readPlacement(input.placement),
    today: null,
    ...(input.plays ? { plays: input.plays } : {}),
  }
}

/** The lesson Up Next stands on (Curriculum's "current" marker), or null when the plan is finished. */
export function currentLessonNow(loaded: UpNextContent, input: UpNextInput, now: Date): string | null {
  return loaded.currentLessonFor(stateOf(loaded, input), loaded.content, now.toISOString())
}

/** A lesson as a sentence names it: "T1.L4", and its title. */
export interface NamedLesson {
  id: string
  code: string
  title: string
}

/**
 * Where a path begins (Boot's last step, wave-2.md §7.3): its first T lesson, and the R lessons the plan runs
 * before it (none on the full ramp, whose braid opens with T0.L1; the Rust half on rust-systems). The same
 * plan rule 5 walks, so Today's empty state names the first of these.
 */
export function firstLessonsNow(
  loaded: UpNextContent,
  path: Json | undefined,
  placement: Json | undefined,
): { t: NamedLesson | null; r: NamedLesson[] } {
  const plan = loaded.cachedPathPlan(loaded.pathOf(path), loaded.content, loaded.readPlacement(placement))
  const first = loaded.firstLessons(plan, loaded.content.lessons)
  const titles = new Map(loaded.content.lessons.map((l) => [l.id, l.title]))
  const named = (id: string): NamedLesson => ({ id, code: id.toUpperCase(), title: titles.get(id) ?? id })
  return { t: first.t ? named(first.t) : null, r: first.r.map(named) }
}

/** The one recommendation for a learner now: the lesson footer's computation, for every other surface. */
export function recommendNow(
  loaded: UpNextContent,
  input: UpNextInput,
  now: Date,
  viewportWidth?: number,
): { rec: Recommendation; offerPlacement: boolean } {
  const state = stateOf(loaded, input)
  const day = loaded.dayKindOf(loaded.normalizeWeekPlan(input.week), localDateKey(now) as LocalDay, viewportWidth)
  return { rec: loaded.recommend(state, loaded.content, now.toISOString(), day), offerPlacement: loaded.offerPlacement(state) }
}

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; loaded: UpNextContent }

/** The recommender's content, loaded on demand; `loading` until it lands and `error` if it cannot. */
export function useLoadedUpNext(): Loaded {
  const [load, setLoad] = useState<Loaded>({ status: 'loading' })
  useEffect(() => {
    let live = true
    loadUpNext()
      .then((loaded) => live && setLoad({ status: 'ready', loaded }))
      .catch(() => live && setLoad({ status: 'error' }))
    return () => {
      live = false
    }
  }, [])
  return load
}

/** What `recommend()` reads of the learner, subscribed from the store. */
function useUpNextInput(): UpNextInput {
  const lessons = useProgress((s) => s.lessons)
  const labs = useProgress((s) => s.labs)
  const plays = useProgress((s) => s.aggregate.plays)
  const bootDone = useProgress((s) => s.completions.boot !== undefined)
  const path = useProgress((s) => s.working['boot:path'])
  const placement = useProgress((s) => s.working['placement:result'])
  const week = useProgress((s) => s.working['boot:week'])
  return useMemo(() => ({ bootDone, lessons, labs, plays, path, placement, week }), [bootDone, lessons, labs, plays, path, placement, week])
}

/** `recommend()` over the learner's lessons, labs, plays, path and placement, and the week plan's kind of day. */
export function useUpNext(): UpNextState {
  const load = useLoadedUpNext()
  const input = useUpNextInput()
  return useMemo<UpNextState>(() => {
    if (load.status !== 'ready') return { status: load.status }
    try {
      return { status: 'ready', ...recommendNow(load.loaded, input, new Date(), window.innerWidth) }
    } catch {
      return { status: 'error' }
    }
  }, [load, input])
}

/** The lesson Up Next stands on, for Curriculum's "current" marker; `loading` and `error` leave the caller its fallback. */
export function useCurrentLesson(): { status: 'loading' | 'error' } | { status: 'ready'; id: string | null } {
  const load = useLoadedUpNext()
  const input = useUpNextInput()
  return useMemo(() => {
    if (load.status !== 'ready') return { status: load.status }
    try {
      return { status: 'ready' as const, id: currentLessonNow(load.loaded, input, new Date()) }
    } catch {
      return { status: 'error' as const }
    }
  }, [load, input])
}
