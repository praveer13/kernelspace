/**
 * `recommend()`: one Up Next with a why (docs/specs/wave-1.md §7.3; PLAN-100X K3). Pure: the learner's
 * state, static content, the clock and the kind of day go in, one `Recommendation` comes out, and nothing
 * is stored (invariant W2). The first rule that applies wins:
 *
 *   1. no Boot and no lessons                        → Boot
 *   2. Today has due or priority cards, session open → Today
 *   3. a lesson being read, visited in the last 14 days → resume it
 *   4. a laptop day and a lab whose host lesson is done and whose next stage is open → that stage
 *      (a lab already started first, then the freshest); any lab whose checks carry `stage`s is staged,
 *      so labs 02 and 03 need no code when their checks gain stages
 *   5. the next lesson of the path plan that is neither done nor read (placement already applied);
 *      if a KC it builds on comes from a plan lesson that is not done (an earlier one, or an R lesson
 *      the braid's cap slid later), that lesson instead; a registered play whose host lesson is done and
 *      that is not yet debriefed comes first, while it is still the step right before the next lesson
 *   6. everything done                               → Today's extra practice
 *
 * Every why line is at most 90 characters (`WHY_MAX`): `fit` takes the first candidate that fits.
 * Evidence, not clicks (W1): a lesson only *read* does not meet a prerequisite; only *done* does.
 */

import type { Kc, KcId } from '@/lib/kc/types'
import type { IsoInstant, LearningPath } from '@/lib/ledger/types'
import {
  cachedPathPlan,
  kcsIntroducedBy,
  kcsOfLesson,
  labOfStep,
  lessonCode,
  PATH_LABEL,
  playOfStep,
  type PathGraph,
  type PathLab,
  type PathLesson,
  type PathPlanDetail,
  type PathPlay,
} from './paths'
import type { DayKind, PlacementResult, Recommendation } from './types'

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export type RecommendLessonStatus = 'unstarted' | 'reading' | 'read' | 'done'

/** What Up Next reads of a lesson's progress (`ProgressState.lessons[id]` satisfies it). */
export interface RecommendLessonState {
  status: RecommendLessonStatus
  lastVisitedAt?: string
  /** 0-100, the resume position. */
  scrollPct?: number
}

/** What Up Next reads of a lab's progress (`ProgressState.labs[id]` satisfies it). */
export interface RecommendLabState {
  done?: boolean
  checksDone?: readonly string[]
}

/** Today's queue as the composer sees it (B18 passes it; null before cards exist). */
export interface TodaySummary {
  /** Cards due today, priority cards included. */
  due: number
  /** Sure-and-wrong cards since their last success. */
  priority: number
  /** The session's nominal minutes. */
  minutes: number
  /** Today's session has been finished. */
  sessionDone: boolean
}

/** What Up Next reads of a play's progress (`aggregate.plays[id]` satisfies it). */
export interface RecommendPlayState {
  /** The debrief was reached (an `ok` result on phase `play`). */
  done?: boolean
}

export interface RecommendState {
  /** Boot has been completed (`completions.boot`). */
  bootDone: boolean
  lessons: Readonly<Record<string, RecommendLessonState>>
  labs: Readonly<Record<string, RecommendLabState>>
  /** `boot:path`; the full ramp when unset. */
  path: LearningPath
  /** `placement:result`, or null when the learner has not placed. */
  placement: Pick<PlacementResult, 'entryTrack' | 'missedKcs' | 'solidKcs' | 'rustAnchor'> | null
  today: TodaySummary | null
  /** Plays debriefed, by play id; a surface that does not offer plays leaves it out. */
  plays?: Readonly<Record<string, RecommendPlayState>>
}

export interface RecommendLesson extends PathLesson {
  title: string
  minutes: number
}

export interface RecommendLab extends PathLab {
  /** `index` and `trackId` name the lab: R labs read "Lab R3", systems labs "Lab 01". */
  index: number
  trackId: string
  title: string
  minutes: number
  checks: readonly { id: string; stage?: number; optional?: boolean }[]
  /** Declared minutes per stage (F2, lab 01 first); a stage without one is named without minutes. */
  stageMinutes?: Readonly<Record<number, number>>
}

/** A registered play: `PlayDef` satisfies it. A play that is only pending (no component yet) is not passed. */
export interface RecommendPlay extends PathPlay {
  title: string
  /** Nominal minutes. */
  minutes: number
}

/** Static content for Up Next: `Lesson`, `ForgeLab` and `PlayDef` satisfy the lesson, lab and play shapes. */
export interface RecommendContent extends PathGraph {
  lessons: readonly RecommendLesson[]
  labs: readonly RecommendLab[]
  plays?: readonly RecommendPlay[]
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const WHY_MAX = 90
export const BOOT_MINUTES = 10
/** Rule 6's extra set: five generated items. */
export const EXTRA_MINUTES = 5

export const BOOT_WHY = '10 minutes: how fast is one GPU for one user?'
export const EXTRA_WHY = 'Keep your cache warm'
/** Where the placement walk opens (§7.1). */
export const PLACEMENT_ROUTE = '/curriculum?placement=1'

/* ------------------------------------------------------------------ */
/* Copy helpers                                                        */
/* ------------------------------------------------------------------ */

/** The first candidate of at most `WHY_MAX` characters; a word-boundary cut of the last one otherwise. */
export function fit(...candidates: string[]): string {
  for (const c of candidates) if (c.length <= WHY_MAX) return c
  const last = candidates[candidates.length - 1] ?? ''
  const cut = last.slice(0, WHY_MAX - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > WHY_MAX / 2 ? cut.slice(0, space) : cut}…`
}

/** Title-case words that name a type or trait and keep their capital mid-sentence. */
const KEEP_CAPITAL = new Set(['Box', 'Copy', 'Clone', 'Drop', 'Option', 'Result', 'Rust', 'Linux'])

/** A KC title mid-sentence: "Split and coalesce" → "split and coalesce"; "TLB", "PagedAttention", "Box" keep theirs. */
export function inline(title: string): string {
  const first = title.split(/[\s,]/, 1)[0]
  if (!/^[A-Z][a-z-]+$/.test(first) || KEEP_CAPITAL.has(first)) return title
  return title.charAt(0).toLowerCase() + title.slice(1)
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** "Lab 01", "Lab R3". */
export function labName(lab: Pick<RecommendLab, 'index' | 'trackId'>): string {
  return lab.trackId === 'r' ? `Lab R${lab.index}` : `Lab ${String(lab.index).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

const statusOf = (state: RecommendState, id: string): RecommendLessonStatus => state.lessons[id]?.status ?? 'unstarted'
const isDone = (state: RecommendState, id: string) => statusOf(state, id) === 'done'
const hasLessons = (state: RecommendState) => Object.values(state.lessons).some((l) => l.status !== 'unstarted')

/** The placement walk is worth offering beside Up Next: no placement yet and no lesson passed (§7.1). */
export function offerPlacement(state: Pick<RecommendState, 'placement' | 'lessons'>): boolean {
  return !state.placement && !Object.values(state.lessons).some((l) => l.status === 'done')
}

function lessonRec(lesson: RecommendLesson, why: string, minutes = lesson.minutes): Recommendation {
  return {
    kind: 'lesson',
    ref: lesson.id,
    to: `/lesson/${lesson.id}`,
    title: `${lessonCode(lesson.id)} · ${lesson.title}`,
    why,
    minutes: Math.max(1, Math.round(minutes)),
  }
}

/** Rule 2. */
function todayRule(today: TodaySummary | null): Recommendation | null {
  if (!today || today.sessionDone || today.due + today.priority <= 0) return null
  const n = Math.max(today.due, today.priority)
  const min = Math.max(1, Math.round(today.minutes))
  const why = fit(
    `${n} ${plural(n, 'card is', 'cards are')} near your recall SLO (~${min} min)`,
    `${n} cards near your recall SLO`,
  )
  return { kind: 'today', ref: 'session', to: '/today', title: 'Today', why, minutes: min }
}

/**
 * The path lesson as a recommendation. A lesson opened off the path never takes Up Next (a curious click on
 * T6.L8 used to pin it for two weeks); when the path's own next lesson is the one being read, the why says
 * how far in the learner is and the minutes count what is left.
 */
function pathLessonRec(lesson: RecommendLesson, state: RecommendState, why: string): Recommendation {
  const l = state.lessons[lesson.id]
  if (l?.status !== 'reading') return lessonRec(lesson, why)
  const pct = l.scrollPct !== undefined && Number.isFinite(l.scrollPct) ? Math.round(Math.min(99, Math.max(0, l.scrollPct))) : 0
  const code = lessonCode(lesson.id)
  return pct >= 1 ? lessonRec(lesson, fit(`You were ${pct} % through ${code}`), lesson.minutes * (1 - pct / 100)) : lessonRec(lesson, why)
}

/** The lowest stage with a required check not yet passed, or null when the lab is unstaged or finished. */
function nextStage(lab: RecommendLab, done: ReadonlySet<string>): number | null {
  let next: number | null = null
  for (const c of lab.checks) {
    if (c.stage === undefined || c.optional || done.has(c.id)) continue
    if (next === null || c.stage < next) next = c.stage
  }
  return next
}

/**
 * A registered play to offer before the next lesson: its host lesson is done, it has not been debriefed,
 * and it sits in the plan right before the first lesson that is neither done nor read. A learner who went on past the play (a later plan lesson is done or read) is not nagged,
 * and a play is never a gate (W8).
 */
function pendingPlay(state: RecommendState, content: RecommendContent, plan: PathPlanDetail): RecommendPlay | null {
  if (!content.plays?.length) return null
  const plays = new Map(content.plays.map((p) => [p.id, p]))
  let offer: RecommendPlay | null = null
  for (const step of plan.steps) {
    const id = playOfStep(step)
    const play = id ? plays.get(id) : undefined
    if (play) {
      if (isDone(state, play.lessonId) && !state.plays?.[play.id]?.done) offer ??= play
      continue
    }
    if (labOfStep(step)) continue
    const s = statusOf(state, step)
    if (s !== 'done' && s !== 'read') break
    offer = null
  }
  return offer
}

/** The play of rule 5 as a recommendation. */
function playRule(state: RecommendState, content: RecommendContent, plan: PathPlanDetail): Recommendation | null {
  const offer = pendingPlay(state, content, plan)
  if (!offer) return null
  const code = lessonCode(offer.lessonId)
  return {
    kind: 'play',
    ref: offer.id,
    to: `/play/${offer.id}`,
    title: `Play: ${offer.title}`,
    why: fit(`You passed ${code}: now try it by hand (~${offer.minutes} min)`, `You passed ${code}: now try it by hand`),
    minutes: Math.max(1, Math.round(offer.minutes)),
  }
}

/**
 * Rule 4: on a laptop day, an open lab that is not finished: one already started first, then the one
 * whose host lesson is latest in the plan (the freshest), so a lab skipped long ago does not hold every
 * laptop day. While a play is on offer (rule 5), only a lab already started competes with it: the play is the
 * freshest step ("Play, then Build this": the scheduler play comes before lab 06, and before an older lab).
 */
function labRule(
  state: RecommendState,
  content: RecommendContent,
  plan: PathPlanDetail,
  day: DayKind,
): Recommendation | null {
  if (day !== 'laptop') return null
  const inPlan = new Set(plan.lessons)
  const labs = new Map(content.labs.map((l) => [l.id, l]))
  const playOnOffer = pendingPlay(state, content, plan) !== null
  const open = plan.steps.flatMap((step) => {
    const id = labOfStep(step)
    const lab = id ? labs.get(id) : undefined
    if (!lab || state.labs[lab.id]?.done || !isDone(state, lab.lessonId)) return []
    if (playOnOffer && (state.labs[lab.id]?.checksDone?.length ?? 0) === 0) return []
    // a readiness lesson outside the plan (skipped by placement, tested out) does not hold the lab back
    if ((lab.readiness?.lessonIds ?? []).some((r) => inPlan.has(r) && !isDone(state, r))) return []
    return [lab]
  })
  const started = open.filter((l) => (state.labs[l.id]?.checksDone?.length ?? 0) > 0)
  const lab = started.length > 0 ? started[started.length - 1] : open[open.length - 1]
  if (!lab) return null
  const name = labName(lab)
  const host = lessonCode(lab.lessonId)
  const stage = nextStage(lab, new Set(state.labs[lab.id]?.checksDone ?? []))
  if (stage !== null) {
    const min = lab.stageMinutes?.[stage]
    return {
      kind: 'lab',
      ref: lab.id,
      to: `/forge/${lab.id}`,
      title: `${name} · stage ${stage}`,
      why: min !== undefined
        ? fit(`${name} stage ${stage} is a ${min}-minute win`)
        : fit(`${name} stage ${stage} is next: ${lab.title}`, `${name} stage ${stage} is next`),
      minutes: min ?? lab.minutes,
    }
  }
  return {
    kind: 'lab',
    ref: lab.id,
    to: `/forge/${lab.id}`,
    title: `${name} · ${lab.title}`,
    why: fit(`${name} builds on ${host}, which you passed: a laptop day suits it`, `${name} builds on ${host}, which you passed`),
    minutes: lab.minutes,
  }
}

/**
 * A prerequisite of `lessonId` not yet met: a KC its own KCs require, introduced by a plan lesson that is
 * not done and that placement did not find solid. A lesson outside the plan (skipped by placement, tested
 * out, off the path) counts as met. The prerequisite lesson must sit earlier in the plan, except an R
 * lesson: the braid's cap can slide one past its dependant (a placed learner whose R run has no T lesson
 * to split it), and rule 5 still sends the learner there first. (A T lesson that revisits a KC introduced
 * later in the curriculum, such as T4.L2 with KV capacity, is not sent forward.) The earliest such lesson
 * wins; within it, the KC latest in graph order (the most specific: split and coalesce before the
 * allocator contract).
 */
function unmetPrerequisite(
  lessonId: string,
  plan: PathPlanDetail,
  kcs: readonly Kc[],
  index: ReadonlyMap<KcId, Kc>,
  met: (kc: Kc) => boolean,
): { lesson: string; kc: Kc } | null {
  const at = new Map(plan.lessons.map((id, i) => [id, i]))
  const here = at.get(lessonId) ?? Infinity
  const own = kcsIntroducedBy(kcs, lessonId)
  const needs = (own.length > 0 ? own : kcsOfLesson(kcs, lessonId)).flatMap((k) => k.requires)
  let best: { lesson: string; kc: Kc; pos: number; order: number } | null = null
  const order = new Map(kcs.map((k, i) => [k.id, i]))
  for (const id of needs) {
    const kc = index.get(id)
    const from = kc?.lessons[0]
    if (!kc || !from || from === lessonId || met(kc)) continue
    const pos = at.get(from)
    if (pos === undefined || (pos >= here && kc.track !== 'r')) continue
    const o = order.get(kc.id) ?? 0
    if (!best || pos < best.pos || (pos === best.pos && o > best.order)) best = { lesson: from, kc, pos, order: o }
  }
  return best ? { lesson: best.lesson, kc: best.kc } : null
}

/** Rule 5's why for the lesson itself (its prerequisites are met). */
function nextWhy(
  lesson: RecommendLesson,
  state: RecommendState,
  content: RecommendContent,
  plan: PathPlanDetail,
  index: ReadonlyMap<KcId, Kc>,
): string {
  const code = lessonCode(lesson.id)
  const pair = plan.pairs.find((p) => p.r === lesson.id)
  if (pair?.t && pair.via) {
    const needs = index.get(pair.via.needs)
    const t = lessonCode(pair.t)
    if (needs) return fit(`${code} first: ${t} builds on ${inline(needs.title)}`, `${code} first: ${t} builds on it`)
  }
  const placement = state.placement
  if (placement) {
    const missed = kcsOfLesson(content.kcs, lesson.id).find((k) => placement.missedKcs.includes(k.id))
    if (missed) return fit(`Placement found a gap in ${inline(missed.title)}: start here`, `Placement found a gap here: start at ${code}`)
    if (!plan.lessons.some((id) => isDone(state, id))) return fit(`Your placement starts you at ${code}`)
  }
  // the latest done plan lesson whose KC this one builds on
  const at = new Map(plan.lessons.map((id, i) => [id, i]))
  let from: { lesson: string; kc: Kc; pos: number } | null = null
  for (const k of kcsIntroducedBy(content.kcs, lesson.id)) {
    for (const id of k.requires) {
      const req = index.get(id)
      const intro = req?.lessons[0]
      if (!req || !intro || intro === lesson.id || !isDone(state, intro)) continue
      const pos = at.get(intro) ?? -1
      if (!from || pos > from.pos) from = { lesson: intro, kc: req, pos }
    }
  }
  if (from) return fit(`${code} builds on ${inline(from.kc.title)} from ${lessonCode(from.lesson)}`, `${code} builds on ${lessonCode(from.lesson)}`)
  const n = plan.lessons.indexOf(lesson.id) + 1
  return n > 0 ? fit(`Next on ${PATH_LABEL[state.path]}: lesson ${n} of ${plan.lessons.length}`) : fit(`Next on ${PATH_LABEL[state.path]}`)
}

/** Rule 5's lesson: the next lesson of the plan, or the prerequisite it needs first. */
function pathLesson(state: RecommendState, content: RecommendContent, plan: PathPlanDetail): Recommendation | null {
  const next = plan.lessons.find((id) => {
    const s = statusOf(state, id)
    return s !== 'done' && s !== 'read'
  })
  if (!next) return null
  const lessons = new Map(content.lessons.map((l) => [l.id, l]))
  const index = new Map(content.kcs.map((k) => [k.id, k]))
  const solid = new Set(state.placement?.solidKcs ?? [])
  const met = (kc: Kc) => solid.has(kc.id) || isDone(state, kc.lessons[0])

  // walk back while the prerequisite itself rests on an unmet one; a lesson-level cycle stops the walk
  let target = next
  let reason: { lesson: string; kc: Kc } | null = null
  const seen = new Set([target])
  for (;;) {
    const gap = unmetPrerequisite(target, plan, content.kcs, index, met)
    if (!gap || seen.has(gap.lesson)) break
    reason = { lesson: target, kc: gap.kc }
    target = gap.lesson
    seen.add(target)
  }
  const lesson = lessons.get(target)
  if (!lesson) return null
  if (reason) {
    const needer = lessonCode(reason.lesson)
    const code = lessonCode(target)
    const kc = inline(reason.kc.title)
    // a prerequisite only read (finished, not passed) is not evidence (W1): say what would meet it
    const why = statusOf(state, target) === 'read'
      ? fit(`${needer} needs ${kc} from ${code}: pass its check first`, `${needer} needs ${code} passed first`)
      : fit(`${needer} needs ${kc} from ${code} first`, `${needer} needs ${code} first`)
    return lessonRec(lesson, why)
  }
  return pathLessonRec(lesson, state, nextWhy(lesson, state, content, plan, index))
}

/** Rule 5. */
const pathRule = (state: RecommendState, content: RecommendContent, plan: PathPlanDetail): Recommendation | null =>
  playRule(state, content, plan) ?? pathLesson(state, content, plan)

/**
 * The lesson Up Next stands on, for Curriculum's "current" marker: the next one of the plan, prerequisite
 * first (rule 5). Due cards, labs and plays are not lessons, so they
 * never move the marker. Null when the plan is finished.
 */
export function currentLessonFor(state: RecommendState, content: RecommendContent): string | null {
  const plan = cachedPathPlan(state.path, content, state.placement)
  return pathLesson(state, content, plan)?.ref ?? null
}

/**
 * The one Up Next. `day` is the planner's kind of day (`dayKindOf`); only a laptop day reaches for a lab.
 * Deterministic: the same arguments always give a deep-equal result.
 */
export function recommend(state: RecommendState, content: RecommendContent, _now: IsoInstant, day: DayKind): Recommendation {
  // 1. a first visit: Boot
  if (!state.bootDone && !hasLessons(state) && !state.placement) {
    return { kind: 'boot', ref: 'boot', to: '/boot', title: 'Boot', why: BOOT_WHY, minutes: BOOT_MINUTES }
  }
  // 2. due cards before anything new
  const today = todayRule(state.today)
  if (today) return today
  // 3. (retired: a lesson opened off the path no longer takes Up Next; the path's own lesson keeps its % why)
  const plan = cachedPathPlan(state.path, content, state.placement)
  // 4. a laptop day suits a lab
  const lab = labRule(state, content, plan, day)
  if (lab) return lab
  // 5. the path, prerequisites first
  const next = pathRule(state, content, plan)
  if (next) return next
  // 6. everything done
  return { kind: 'today', ref: 'extra', to: '/today', title: 'Extra practice', why: EXTRA_WHY, minutes: EXTRA_MINUTES }
}
