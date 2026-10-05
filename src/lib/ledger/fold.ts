import { AGGREGATE_VERSION } from './constants'
import { canonicalEvent } from './merge'
import { canonicalRef, parseQuizItemRef, parseSimTaskRef, refTail } from './refs'
import { ensureOwn, getOwn, setOwn } from './stable'
import type {
  Aggregate,
  EventKind,
  IsoInstant,
  LabAgg,
  LedgerEvent,
  LessonAgg,
  SimAgg,
} from './types'

/** Kinds that carry `score`/`ok`/`provenance` (spec §4.2). */
export const GRADED_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'item',
  'probe',
  'quiz',
  'predict',
  'sim-task',
  'lab-check',
  'fleet-act',
  'capstone-step',
  'play',
  'incident',
  'fleet-run',
  'prove',
])

export function emptyAggregate(): Aggregate {
  return {
    v: AGGREGATE_VERSION,
    events: 0,
    lessons: {},
    sims: {},
    labs: {},
    fleetWeek: { acts: {}, scores: {} },
    capstone: { steps: {}, step: 0 },
    facts: {},
    days: {},
    achievements: {},
    acks: {},
    completions: {},
  }
}

/* max / min over ISO instants (lexical order is chronological). */
const maxIso = (a: IsoInstant | undefined, b: IsoInstant): IsoInstant => (a !== undefined && a >= b ? a : b)
const minIso = (a: IsoInstant | undefined, b: IsoInstant): IsoInstant => (a !== undefined && a <= b ? a : b)

/* Every key below comes from an imported ref, so lookups and writes go through own-property helpers. */
const lessonOf = (agg: Aggregate, id: string): LessonAgg => ensureOwn(agg.lessons, id, () => ({}))
const simOf = (agg: Aggregate, id: string): SimAgg => ensureOwn(agg.sims, id, () => ({ visits: 0, tasks: {} }))
const labOf = (agg: Aggregate, id: string): LabAgg => ensureOwn(agg.labs, id, () => ({ checks: {} }))

/** The check ids a lab run passed; tolerant of a malformed `data`. */
function labPassed(e: LedgerEvent): string[] {
  const passed = ((e as { data?: { passed?: unknown } }).data ?? {}).passed
  return Array.isArray(passed) ? passed.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Apply one event to `agg` in place (spec §6.1). Every rule is a max, min, union, OR or
 * count of distinct events, so the result never depends on event order. The caller
 * guarantees each id is folded once: `derive` de-duplicates, and the engine keys its
 * in-memory ledger by id.
 */
export function foldInto(agg: Aggregate, e: LedgerEvent): Aggregate {
  const ref = canonicalRef(e.ref)
  agg.events += 1

  switch (e.kind) {
    case 'visit': {
      const lesson = refTail(ref, 'lesson:')
      if (lesson !== null) {
        const L = lessonOf(agg, lesson)
        L.lastAt = maxIso(L.lastAt, e.at)
        break
      }
      const sim = refTail(ref, 'sim:')
      if (sim !== null) simOf(agg, sim).visits += 1
      break // `visit boot` changes nothing
    }
    case 'complete': {
      const lesson = refTail(ref, 'lesson:')
      if (lesson !== null) {
        const L = lessonOf(agg, lesson)
        L.done = true
        L.completedAt = minIso(L.completedAt, e.at)
        L.lastAt = maxIso(L.lastAt, e.at)
        setOwn(agg.facts, `lesson:${lesson}`, true)
      } else {
        setOwn(agg.completions, ref, minIso(getOwn(agg.completions, ref), e.at))
      }
      break
    }
    case 'exercise': {
      const lesson = refTail(ref, 'lesson:')
      if (lesson === null) break
      const L = lessonOf(agg, lesson)
      L.exercise = true
      L.lastAt = maxIso(L.lastAt, e.at)
      setOwn(agg.facts, `exercise:${lesson}`, true)
      break
    }
    case 'quiz': {
      const lesson = refTail(ref, 'lesson:')
      if (lesson === null) break
      const L = lessonOf(agg, lesson)
      L.quizBest = Math.max(L.quizBest ?? 0, e.score)
      L.lastAt = maxIso(L.lastAt, e.at)
      if (e.ok) setOwn(agg.facts, `quiz-pass:${lesson}`, true)
      break
    }
    case 'item':
    case 'probe': {
      // Exposure only: the `quiz` summary carries the score. Boot and card items add nothing but the day.
      const item = parseQuizItemRef(ref)
      if (item) {
        const L = lessonOf(agg, item.lessonId)
        L.lastAt = maxIso(L.lastAt, e.at)
      }
      break
    }
    case 'sim-task': {
      const task = parseSimTaskRef(ref)
      if (!task) break
      setOwn(simOf(agg, task.simId).tasks, task.taskId, true)
      setOwn(agg.facts, `sim:${task.simId}/${task.taskId}`, true)
      break
    }
    case 'lab-check': {
      const lab = refTail(ref, 'lab:')
      if (lab === null) break
      const L = labOf(agg, lab)
      for (const check of labPassed(e)) setOwn(L.checks, check, true)
      const total = (e.data as { total?: unknown } | undefined)?.total
      if (typeof total === 'number') L.total = Math.max(L.total ?? 0, total)
      if (e.ok) {
        L.done = true
        L.completedAt = minIso(L.completedAt, e.at)
        setOwn(agg.facts, `lab:${lab}`, true)
      }
      break
    }
    case 'fleet-act': {
      const act = refTail(ref, 'fw:')
      if (act === null) break
      const prev = getOwn(agg.fleetWeek.scores, act)
      setOwn(agg.fleetWeek.scores, act, prev === undefined ? e.score : Math.max(prev, e.score))
      if (e.ok) {
        setOwn(agg.fleetWeek.acts, act, true)
        setOwn(agg.facts, `fw:${act}`, true)
      }
      break
    }
    case 'capstone-step': {
      const step = refTail(ref, 'cap:')
      if (step === null) break
      setOwn(agg.capstone.steps, step, true)
      const index = (e.data as { index?: unknown } | undefined)?.index
      if (typeof index === 'number') agg.capstone.step = Math.max(agg.capstone.step, index + 1)
      setOwn(agg.facts, `cap:${step}`, true)
      break
    }
    case 'achievement': {
      const id = refTail(ref, 'ach:')
      if (id !== null) setOwn(agg.achievements, id, minIso(getOwn(agg.achievements, id), e.at))
      break
    }
    case 'ack':
      setOwn(agg.acks, ref, minIso(getOwn(agg.acks, ref), e.at))
      break
    default:
      break // predict and the reserved graded kinds: streak day only
  }

  // Streak: every graded event marks its day, except a lab run that passed nothing.
  if (GRADED_KINDS.has(e.kind)) {
    const passedNothing = e.kind === 'lab-check' && labPassed(e).length === 0
    if (!passedNothing) setOwn(agg.days, e.day, true)
  }
  return agg
}

/** Pure single-event fold: a copy of `agg` with `e` applied. Same code path as `derive`, so I7 holds by construction. */
export function fold(agg: Aggregate, e: LedgerEvent): Aggregate {
  return foldInto(structuredClone(agg), e)
}

/**
 * The aggregate of a set of events. Duplicate ids collapse by the canonical rule first,
 * so the result depends only on the set (I3), never on order or repeats.
 */
export function derive(events: Iterable<LedgerEvent>): Aggregate {
  const byId = new Map<string, LedgerEvent>()
  for (const e of events) {
    const prev = byId.get(e.id)
    byId.set(e.id, prev ? canonicalEvent(prev, e) : e)
  }
  const agg = emptyAggregate()
  for (const e of byId.values()) foldInto(agg, e)
  return agg
}
