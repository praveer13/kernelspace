import { FAULT_IDS, FLEET_RUN_MODES } from './constants'
import { isLocalDay } from './time'
import type { EventKind, FaultId, FleetRunMode } from './types'

/**
 * Read-time ref migration (spec §4.3). Empty in Wave 0b. When V1 adds stable item ids,
 * old `quiz:<lesson>#<qi>` refs map to `item:<id>` here, so stored events are never
 * rewritten. Keys and values are full refs.
 */
const REF_MIGRATIONS: Readonly<Record<string, string>> = {}

export function canonicalRef(ref: string): string {
  return REF_MIGRATIONS[ref] ?? ref
}

/** The part of `ref` after `prefix`, or null when `ref` does not start with it (or nothing follows). */
export function refTail(ref: string, prefix: string): string | null {
  return ref.length > prefix.length && ref.startsWith(prefix) ? ref.slice(prefix.length) : null
}

/** `quiz:<lessonId>#<qi>` -> its parts. */
export function parseQuizItemRef(ref: string): { lessonId: string; qi: number } | null {
  const tail = refTail(ref, 'quiz:')
  if (tail === null) return null
  const hash = tail.lastIndexOf('#')
  if (hash <= 0) return null
  const qi = Number(tail.slice(hash + 1))
  if (!Number.isInteger(qi) || qi < 0) return null
  return { lessonId: tail.slice(0, hash), qi }
}

/** `sim:<simId>/<taskId>` -> its parts. */
export function parseSimTaskRef(ref: string): { simId: string; taskId: string } | null {
  const tail = refTail(ref, 'sim:')
  if (tail === null) return null
  const slash = tail.indexOf('/')
  if (slash <= 0 || slash === tail.length - 1) return null
  return { simId: tail.slice(0, slash), taskId: tail.slice(slash + 1) }
}

const nonEmpty = (ref: string, prefix: string) => refTail(ref, prefix) !== null

/** `<prefix><id>#<n>`: a card item, a prequestion, a diagram prediction or a constructed response. */
const isIndexedRef = (ref: string, prefix: string) => {
  const tail = refTail(ref, prefix)
  if (tail === null) return false
  const hash = tail.lastIndexOf('#')
  return hash > 0 && /^\d+$/.test(tail.slice(hash + 1))
}

/** `gen:<family>/<variant>` */
const isGenRef = (ref: string) => {
  const tail = refTail(ref, 'gen:')
  const slash = tail === null ? -1 : tail.indexOf('/')
  return tail !== null && slash > 0 && slash < tail.length - 1
}

/**
 * `hint:<labId>/<checkId>#<rung>` (H3) -> its parts. The rung is `R1`, `R2`, ... or `bottom`.
 */
export function parseHintRef(ref: string): { labId: string; checkId: string; rung: string } | null {
  const tail = refTail(ref, 'hint:')
  if (tail === null) return null
  const slash = tail.indexOf('/')
  const hash = tail.lastIndexOf('#')
  if (slash <= 0 || hash <= slash + 1 || hash === tail.length - 1) return null
  return { labId: tail.slice(0, slash), checkId: tail.slice(slash + 1, hash), rung: tail.slice(hash + 1) }
}

/** `inc:daily/<date>`, `inc:drill/<faultId>` or `inc:team/<code>/<date>` (wave-2.md §3.2) -> its parts. */
export function parseIncidentRef(
  ref: string,
): { src: 'daily'; date: string } | { src: 'drill'; fault: FaultId } | { src: 'team'; code: string; date: string } | null {
  const daily = refTail(ref, 'inc:daily/')
  if (daily !== null) return isLocalDay(daily) ? { src: 'daily', date: daily } : null
  const drill = refTail(ref, 'inc:drill/')
  if (drill !== null) return (FAULT_IDS as readonly string[]).includes(drill) ? { src: 'drill', fault: drill as FaultId } : null
  const team = refTail(ref, 'inc:team/')
  const slash = team === null ? -1 : team.indexOf('/')
  if (team === null || slash <= 0) return null
  const date = team.slice(slash + 1)
  return isLocalDay(date) ? { src: 'team', code: team.slice(0, slash), date } : null
}

/** `fleet:<mode>` -> the mode, or null. */
export function parseFleetRunRef(ref: string): FleetRunMode | null {
  const mode = refTail(ref, 'fleet:')
  return mode !== null && (FLEET_RUN_MODES as readonly string[]).includes(mode) ? (mode as FleetRunMode) : null
}

/** `packet:lab/<labId>/<checkId>`, `packet:lesson/<lessonId>` or `packet:sim/<simId>` (H2): a context packet was copied out. */
const isPacketRef = (ref: string): boolean => {
  const lab = refTail(ref, 'packet:lab/')
  if (lab !== null) {
    const slash = lab.indexOf('/')
    return slash > 0 && slash < lab.length - 1 && !lab.includes('/', slash + 1)
  }
  return ['packet:lesson/', 'packet:sim/'].some((p) => {
    const id = refTail(ref, p)
    return id !== null && !id.includes('/')
  })
}

/**
 * Item, probe and predict refs: a quiz item, a Boot step, a change-card item, and the Wave 1 shapes
 * (spec §3.2): generated, prequestion, diagram, constructed response and authored `item:<id>`.
 */
const isItemRef = (ref: string) =>
  parseQuizItemRef(ref) !== null ||
  nonEmpty(ref, 'boot:') ||
  nonEmpty(ref, 'item:') ||
  isGenRef(ref) ||
  ['card:', 'pre:', 'dia:', 'cr:'].some((p) => isIndexedRef(ref, p))

const REF_RULES: Record<EventKind, (ref: string) => boolean> = {
  item: isItemRef,
  probe: isItemRef,
  predict: isItemRef,
  quiz: (ref) => nonEmpty(ref, 'lesson:'),
  'sim-task': (ref) => parseSimTaskRef(ref) !== null,
  'lab-check': (ref) => nonEmpty(ref, 'lab:') && !ref.includes('/'),
  'fleet-act': (ref) => nonEmpty(ref, 'fw:'),
  'capstone-step': (ref) => nonEmpty(ref, 'cap:'),
  play: (ref) => nonEmpty(ref, 'play:'),
  incident: (ref) => parseIncidentRef(ref) !== null,
  'fleet-run': (ref) => parseFleetRunRef(ref) !== null,
  prove: (ref) => nonEmpty(ref, 'prove:'),
  visit: (ref) => nonEmpty(ref, 'lesson:') || (nonEmpty(ref, 'sim:') && !ref.includes('/')) || ref === 'boot',
  complete: (ref) => nonEmpty(ref, 'lesson:') || ref === 'boot' || ref === 'placement',
  exercise: (ref) => nonEmpty(ref, 'lesson:'),
  achievement: (ref) => nonEmpty(ref, 'ach:'),
  ack: (ref) => nonEmpty(ref, 'erratum:') || nonEmpty(ref, 'screen:') || parseHintRef(ref) !== null || isPacketRef(ref),
}

/** The ref grammar of each kind (spec §4.2), used by import validation. */
export function refMatchesKind(kind: EventKind, ref: string): boolean {
  return REF_RULES[kind](ref)
}

export function isKnownKind(kind: unknown): kind is EventKind {
  return typeof kind === 'string' && Object.hasOwn(REF_RULES, kind)
}
