/**
 * The one Up Next on the surfaces that are not the lesson footer (docs/specs/wave-1.md §7.3): Today's empty
 * state, done card and plan line, Home's Resume and Progress's Up Next. All of them call `recommend()` over
 * the same inputs the lesson footer uses, so no page can name a different next lesson than the path does.
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
  offerPlacement: typeof import('./recommend').offerPlacement
  content: RecommendContent
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
    import('./recommend'),
    import('./placement'),
    import('./paths'),
    import('./planner'),
  ])
    .then(([kc, labs, lessons, rec, placement, paths, planner]) => ({
      recommend: rec.recommend,
      offerPlacement: rec.offerPlacement,
      content: { kcs: kc.KCS, lessons: lessons.ALL_LESSONS, labs: labs.FORGE_LABS },
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
  /** `working['boot:path']`. */
  path: Json | undefined
  /** `working['placement:result']`. */
  placement: Json | undefined
  /** `working['boot:week']`. */
  week: Json | undefined
}

/** The one recommendation for a learner now: the lesson footer's computation, for every other surface. */
export function recommendNow(
  loaded: UpNextContent,
  input: UpNextInput,
  now: Date,
  viewportWidth?: number,
): { rec: Recommendation; offerPlacement: boolean } {
  const state: RecommendState = {
    bootDone: input.bootDone,
    lessons: input.lessons,
    labs: input.labs,
    path: loaded.pathOf(input.path),
    placement: loaded.readPlacement(input.placement),
    today: null,
  }
  const day = loaded.dayKindOf(loaded.normalizeWeekPlan(input.week), localDateKey(now) as LocalDay, viewportWidth)
  return { rec: loaded.recommend(state, loaded.content, now.toISOString(), day), offerPlacement: loaded.offerPlacement(state) }
}

/** `recommend()` over the learner's lessons, labs, path and placement, and the week plan's kind of day. */
export function useUpNext(): UpNextState {
  const lessons = useProgress((s) => s.lessons)
  const labs = useProgress((s) => s.labs)
  const bootDone = useProgress((s) => s.completions.boot !== undefined)
  const path = useProgress((s) => s.working['boot:path'])
  const placement = useProgress((s) => s.working['placement:result'])
  const week = useProgress((s) => s.working['boot:week'])
  const [load, setLoad] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; loaded: UpNextContent }>({ status: 'loading' })

  useEffect(() => {
    let live = true
    loadUpNext()
      .then((loaded) => live && setLoad({ status: 'ready', loaded }))
      .catch(() => live && setLoad({ status: 'error' }))
    return () => {
      live = false
    }
  }, [])

  return useMemo<UpNextState>(() => {
    if (load.status !== 'ready') return { status: load.status }
    try {
      return { status: 'ready', ...recommendNow(load.loaded, { bootDone, lessons, labs, path, placement, week }, new Date(), window.innerWidth) }
    } catch {
      return { status: 'error' }
    }
  }, [load, bootDone, lessons, labs, path, placement, week])
}
