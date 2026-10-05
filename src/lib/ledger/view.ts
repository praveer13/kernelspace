import { XP_UNITS, type XpUnitPrefix } from './constants'
import { lwwWorking } from './merge'
import { refTail } from './refs'
import { getOwn, setOwn } from './stable'
import type {
  Aggregate,
  FactKey,
  Json,
  ProgressData,
  ProgressSummary,
  WorkingKey,
  WorkingRecord,
} from './types'

/** All working values by key, last writer winning if a key repeats. */
export function workingMap(records: Iterable<WorkingRecord>): Partial<Record<WorkingKey, Json>> {
  const latest = new Map<WorkingKey, WorkingRecord>()
  for (const r of records) {
    const prev = latest.get(r.key)
    latest.set(r.key, prev ? lwwWorking(prev, r) : r)
  }
  const out: Partial<Record<WorkingKey, Json>> = {}
  for (const [key, r] of latest) out[key] = r.value
  return out
}

/** The XP a fact pays (spec §6.3). Unknown prefixes pay nothing. */
export function factXp(fact: string): number {
  const colon = fact.indexOf(':')
  const prefix = colon < 0 ? fact : fact.slice(0, colon)
  return Object.hasOwn(XP_UNITS, prefix) ? XP_UNITS[prefix as XpUnitPrefix] : 0
}

/** Each fact pays its unit once, however many events or devices assert it. */
export function xpOf(agg: Aggregate): number {
  let xp = 0
  for (const fact of Object.keys(agg.facts) as FactKey[]) xp += factXp(fact)
  return xp
}

const sortedKeys = (record: Record<string, unknown>): string[] => Object.keys(record).sort()

const isPlainObject = (v: unknown): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Today's `ProgressData` (spec §6.2) from the aggregate plus working values. Arrays built from sets
 * are sorted lexically; optional fields are absent (never `undefined`) when they carry nothing.
 */
export function toProgressData(agg: Aggregate, working: Partial<Record<WorkingKey, Json>> = {}): ProgressData {
  const lessons: ProgressData['lessons'] = {}
  for (const [id, L] of Object.entries(agg.lessons)) {
    const view: ProgressData['lessons'][string] = {
      status: L.done ? 'done' : 'reading',
      lastVisitedAt: L.lastAt ?? '',
    }
    if (L.quizBest !== undefined) view.quizScore = L.quizBest
    if (L.exercise) view.exerciseDone = true
    if (L.completedAt !== undefined) view.completedAt = L.completedAt
    const scroll = working[`scroll:${id}`]
    if (typeof scroll === 'number') view.scrollPct = scroll
    setOwn(lessons, id, view)
  }

  const sims: ProgressData['sims'] = {}
  const simIds = new Set(Object.keys(agg.sims))
  for (const key of Object.keys(working)) {
    const simId = refTail(key, 'sim-config:')
    if (simId !== null) simIds.add(simId)
  }
  for (const id of simIds) {
    const S = getOwn(agg.sims, id)
    const sim: ProgressData['sims'][string] = { visits: S?.visits ?? 0, tasksDone: S ? sortedKeys(S.tasks) : [] }
    const config = working[`sim-config:${id}`]
    if (config !== undefined) sim.lastConfig = config
    setOwn(sims, id, sim)
  }

  const labs: ProgressData['labs'] = {}
  for (const [id, L] of Object.entries(agg.labs)) {
    const lab: ProgressData['labs'][string] = { done: !!L.done, checksDone: sortedKeys(L.checks) }
    if (L.completedAt !== undefined) lab.completedAt = L.completedAt
    setOwn(labs, id, lab)
  }

  const fleetWeek: ProgressData['fleetWeek'] = {
    actsDone: sortedKeys(agg.fleetWeek.acts),
    scores: { ...agg.fleetWeek.scores },
  }
  const docText = working['fw:doc']
  if (typeof docText === 'string') fleetWeek.docText = docText
  const evidence: NonNullable<ProgressData['fleetWeek']['measurementEvidence']> = {}
  for (const key of Object.keys(working).sort()) {
    const actId = refTail(key, 'fw:evidence:')
    const value = working[key as WorkingKey]
    if (actId !== null && isPlainObject(value)) setOwn(evidence, actId, value as (typeof evidence)[string])
  }
  if (Object.keys(evidence).length > 0) fleetWeek.measurementEvidence = evidence

  const capstone: ProgressData['capstone'] = {
    step: agg.capstone.step,
    stepsDone: sortedKeys(agg.capstone.steps),
  }
  const metrics = working['capstone:metrics']
  if (isPlainObject(metrics)) capstone.metrics = metrics as unknown as NonNullable<typeof capstone.metrics>

  const settings: ProgressData['settings'] = {}
  for (const key of Object.keys(working).sort()) {
    const field = refTail(key, 'settings:')
    if (field !== null) setOwn(settings as Record<string, unknown>, field, working[key as WorkingKey])
  }

  return {
    version: 2,
    lessons,
    sims,
    labs,
    fleetWeek,
    capstone,
    xp: xpOf(agg),
    streakDays: sortedKeys(agg.days),
    achievements: sortedKeys(agg.achievements),
    settings,
  }
}

/** Headline numbers for the import preview (spec §10.5). */
export function summary(agg: Aggregate): ProgressSummary {
  return {
    lessonsDone: Object.values(agg.lessons).filter((l) => l.done).length,
    xp: xpOf(agg),
    activeDays: Object.keys(agg.days).length,
    labsDone: Object.values(agg.labs).filter((l) => l.done).length,
    events: agg.events,
  }
}
