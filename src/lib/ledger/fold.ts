import { AGGREGATE_VERSION } from './constants'
import { canonicalEvent } from './merge'
import { canonicalRef, parseHintRef, parseQuizItemRef, parseSimTaskRef, refTail } from './refs'
import { ensureOwn, getOwn, setOwn } from './stable'
import type {
  Aggregate,
  AggregateV1,
  EventKind,
  IsoInstant,
  LabAgg,
  LedgerEvent,
  LessonAgg,
  PlayAgg,
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
    plays: {},
    proves: {},
    itemSec: {},
  }
}

/* max / min over ISO instants (lexical order is chronological). */
const maxIso = (a: IsoInstant | undefined, b: IsoInstant): IsoInstant => (a !== undefined && a >= b ? a : b)
const minIso = (a: IsoInstant | undefined, b: IsoInstant): IsoInstant => (a !== undefined && a <= b ? a : b)

/* Every key below comes from an imported ref, so lookups and writes go through own-property helpers. */
const lessonOf = (agg: Aggregate, id: string): LessonAgg => ensureOwn(agg.lessons, id, () => ({}))
const simOf = (agg: Aggregate, id: string): SimAgg => ensureOwn(agg.sims, id, () => ({ visits: 0, tasks: {}, outcomes: {} }))
const labOf = (agg: Aggregate, id: string): LabAgg => ensureOwn(agg.labs, id, () => ({ checks: {}, unseen: {} }))
const playOf = (agg: Aggregate, id: string): PlayAgg => ensureOwn(agg.plays, id, () => ({ best: 0 }))

/** `e.data` as a loose record: fold reads only the fields it needs and tolerates anything else. */
const dataOf = (e: LedgerEvent): Record<string, unknown> => {
  const data = (e as { data?: unknown }).data
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
}

const FORMS: ReadonlySet<unknown> = new Set(['ticket', 'spiral', 'testout'])
const DAY_MS = 24 * 60 * 60 * 1000
/** Nominal seconds of an item with no `nsec` (spec §8.4: XP v2 sizes sessions the same way). */
const DEFAULT_NSEC = 30

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
        const via = dataOf(e).via
        if (via === undefined || via === 'read') L.read = true // a click, or "continue anyway": read, not passed (spec §8.7)
        setOwn(agg.facts, `lesson:${lesson}`, true)
      } else {
        setOwn(agg.completions, ref, minIso(getOwn(agg.completions, ref), e.at))
        if (ref === 'boot' || ref === 'placement') setOwn(agg.facts, ref, true)
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
      if (e.ok) {
        setOwn(agg.facts, `quiz-pass:${lesson}`, true)
        // Any ok quiz passes the lesson (spec §3.4). The earliest wins; on equal instants the smaller form does.
        const form = FORMS.has(dataOf(e).form) ? (dataOf(e).form as 'ticket' | 'spiral' | 'testout') : 'checkpoint'
        if (L.passedAt === undefined || e.at < L.passedAt || (e.at === L.passedAt && form < (L.passVia ?? form))) {
          L.passedAt = e.at
          L.passVia = form
        }
      }
      break
    }
    case 'item':
    case 'probe':
    case 'predict': {
      // The `quiz` summary carries the score, so an item adds its time and, on a quiz ref, the lesson's last visit.
      const nsec = dataOf(e).nsec
      const sec = Math.round(Math.min(600, Math.max(0, typeof nsec === 'number' && Number.isFinite(nsec) ? nsec : DEFAULT_NSEC)))
      setOwn(agg.itemSec, e.day, (getOwn(agg.itemSec, e.day) ?? 0) + sec) // whole seconds, so the sum is order-free
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
      const S = simOf(agg, task.simId)
      setOwn(S.tasks, task.taskId, true)
      setOwn(agg.facts, `sim:${task.simId}/${task.taskId}`, true)
      if (e.ok && dataOf(e).outcome === true) {
        setOwn(S.outcomes, task.taskId, true)
        setOwn(agg.facts, `simo:${task.simId}/${task.taskId}`, true)
      }
      break
    }
    case 'lab-check': {
      const lab = refTail(ref, 'lab:')
      if (lab === null) break
      const L = labOf(agg, lab)
      for (const check of labPassed(e)) {
        setOwn(L.checks, check, true)
        setOwn(agg.facts, `labc:${lab}/${check}`, true)
      }
      const checks = dataOf(e).checks
      if (e.provenance === 'unseen' && Array.isArray(checks)) {
        // Credit only checks drawn at grade time (spec §3.4): `fresh`, or a run that reports no seed.
        for (const c of checks as unknown[]) {
          const d = typeof c === 'object' && c !== null ? (c as Record<string, unknown>) : {}
          if (typeof d.id === 'string' && d.status === 'pass' && (d.fresh === true || d.seed === undefined)) setOwn(L.unseen, d.id, true)
        }
      }
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
    case 'play': {
      const id = refTail(ref, 'play:')
      if (id === null) break
      const P = playOf(agg, id)
      P.best = Math.max(P.best, e.score)
      if (e.ok) {
        const phase = dataOf(e).phase
        if (phase === 'compose') P.composed = true
        else if (phase === 'play') {
          P.done = true
          setOwn(agg.facts, `play:${id}`, true)
        }
      }
      break
    }
    case 'prove': {
      const lab = refTail(ref, 'prove:')
      if (lab === null || !e.ok) break
      setOwn(agg.proves, lab, minIso(getOwn(agg.proves, lab), e.at))
      setOwn(agg.facts, `prove:${lab}`, true)
      break
    }
    case 'ack': {
      setOwn(agg.acks, ref, minIso(getOwn(agg.acks, ref), e.at))
      const hint = parseHintRef(ref)
      if (hint?.rung === 'bottom') {
        // H3 bottom-out: the learner saw the answer, so runs for the next 24 h are `assisted` (spec §13.2).
        const L = labOf(agg, hint.labId)
        L.assistedUntil = maxIso(L.assistedUntil, new Date(Date.parse(e.at) + DAY_MS).toISOString())
      }
      break
    }
    default:
      break // the reserved graded kinds: streak day only
  }

  // Streak: every graded event marks its day, except a lab run that passed nothing.
  if (GRADED_KINDS.has(e.kind)) {
    const passedNothing = e.kind === 'lab-check' && labPassed(e).length === 0
    if (!passedNothing) setOwn(agg.days, e.day, true)
  }
  return agg
}

/**
 * A version-1 aggregate (Wave 0b snapshot) as a version-2 one, new fields empty (spec §3.1). Every v1 field
 * is copied unchanged, so the first Wave 1 paint shows the old numbers until the engine's full derive
 * replaces them. Two things are inferred, because v1 never stored them:
 * - every v1 `complete` had no `via`, so it is `read` (spec §8.7);
 * - a lesson with the `quiz-pass:` fact is passed; the exact instant is unknown, so `lastAt` (an upper
 *   bound) stands in until the derive.
 */
export function upgradeAggregate(v1: AggregateV1): Aggregate {
  const out = emptyAggregate()
  out.events = v1.events
  out.fleetWeek = structuredClone(v1.fleetWeek)
  out.capstone = structuredClone(v1.capstone)
  out.facts = structuredClone(v1.facts)
  out.days = structuredClone(v1.days)
  out.achievements = structuredClone(v1.achievements)
  out.acks = structuredClone(v1.acks)
  out.completions = structuredClone(v1.completions)
  for (const [id, L] of Object.entries(v1.lessons)) {
    const lesson: LessonAgg = { ...structuredClone(L) }
    if (L.done) lesson.read = true
    const at = L.lastAt ?? L.completedAt
    if (getOwn(v1.facts, `quiz-pass:${id}`) && at !== undefined) {
      lesson.passedAt = at
      lesson.passVia = 'checkpoint'
    }
    setOwn(out.lessons, id, lesson)
  }
  for (const [id, S] of Object.entries(v1.sims)) setOwn(out.sims, id, { ...structuredClone(S), outcomes: {} })
  for (const [id, L] of Object.entries(v1.labs)) setOwn(out.labs, id, { ...structuredClone(L), unseen: {} })
  return out
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
