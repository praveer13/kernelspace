import { BACKGROUNDS, ENGINE_SLOTS, EXPORT_FORMAT, FAULT_IDS, FLEET_RUN_MODES, IMPORT_MAX_BYTES, SCHEMA_VERSION } from './constants'
import { derive, GRADED_KINDS } from './fold'
import {
  mergeEvents,
  mergeLedgers,
  mergeWorking,
  normalizeLedger,
  type Ledger,
} from './merge'
import { isKnownKind, parseFleetRunRef, parseIncidentRef, refMatchesKind } from './refs'
import { stableStringify } from './stable'
import { dayOf, isIsoInstant, isLocalDay } from './time'
import { summary } from './view'
import type {
  DeviceId,
  EventKind,
  ExportV3,
  ExportedComponent,
  ImportErrorCode,
  ImportFormat,
  ImportMode,
  ImportPreview,
  Json,
  LedgerEvent,
  WorkingRecord,
} from './types'

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

/** Addendum A1: shown for a v1/v2 export or a copied localStorage value. */
export const OLDER_EXPORT_MESSAGE = "this export is from an earlier version of kernelspace and can't be imported"

export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  parse: "this file isn't valid JSON",
  'unknown-format': "this file isn't a kernelspace progress export",
  'older-export': OLDER_EXPORT_MESSAGE,
  'newer-schema': 'this export was made by a newer version of kernelspace; reload to update, then try again',
  'too-large': `this file is over ${IMPORT_MAX_BYTES / (1024 * 1024)} MiB`,
  invalid: 'this export is damaged or edited and failed validation',
  'read-only': 'a newer version of kernelspace is open in another tab; reload to keep saving',
}

/* ------------------------------------------------------------------ */
/* Validation (spec §4.9)                                              */
/* ------------------------------------------------------------------ */

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string }

const PROVENANCES = new Set(['proved', 'unseen', 'lab-green', 'practice', 'assisted', 'field'])
const CONFIDENCES = new Set(['guess', 'think', 'sure'])
const ITEM_SRCS = new Set(['quiz', 'boot', 'card', 'cold', 'today', 'ticket', 'testout', 'placement', 'pre', 'diagram', 'practice', 'lesson', 'daily', 'form', 'play'])
const PREDICT_SRCS = new Set(['boot', 'lesson', 'pre', 'diagram', 'placement', 'play', 'practice'])
const PLAY_PHASES = new Set(['play', 'compose'])
const CHECK_STATUSES = new Set(['pass', 'fail', 'trap', 'timeout'])
const MAX_KCS = 6
const INCIDENT_SRCS = new Set(['daily', 'drill', 'team'])
const FAULTS: ReadonlySet<unknown> = new Set(FAULT_IDS)
const HYPOTHESES: ReadonlySet<unknown> = new Set([...FAULT_IDS, 'unsure'])
const FLEET_MODES: ReadonlySet<unknown> = new Set(FLEET_RUN_MODES)
const SLOTS: ReadonlySet<unknown> = new Set(ENGINE_SLOTS)
const HELP_VIAS = new Set(['claude', 'chatgpt', 'copy'])
const MAX_PROBES = 12
const MAX_RUN_COMPONENTS = 8
const MAX_PACKET_CHARS = 6000
const MAX_ZOO_CONFIG = 20_000
const MAX_NSEC = 600
const REV_REQUIRED = new Set<EventKind>(['item', 'probe', 'predict'])
const MAX_ID_LENGTH = 200
const FORM_IDS = new Set(['A', 'B', 'C'])
const MAX_FORM_SLOT = 11
const MAX_QID_LENGTH = 40
const MAX_PROVE_CALLS = 12
const MAX_PLAY_LEVELS = 8
const PLAY_VIEWS = new Set(['2d', '3d'])
const PLAY_METRICS = new Set(['imbalance'])
const EPLB_REPLICATE = new Set(['none', 'per-copy', 'total'])
const EPLB_PLACE = new Set(['round-robin', 'least-loaded'])
const RUN_ACTS = new Set(['engine', 'fleet', 'business'])
const RUBRIC_KEYS = ['capacity', 'slo', 'cost', 'failure'] as const
const MAX_ACT_RUNS = 20
const MAX_RUN_RECORDS = 50
const MAX_RUN_VALUES = 40
const MAX_RUN_JOB_BYTES = 4096
const BACKGROUND_SET: ReadonlySet<unknown> = new Set(BACKGROUNDS)
const MAX_TZ_MINUTES = 24 * 60

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNonEmptyString = (v: unknown, max = MAX_ID_LENGTH): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max

/** `__proto__` as an id segment of a ref or key (`lesson:__proto__`, `sim:x/__proto__`). Fold and view cope with it, but nothing legitimate uses it. */
const hasProtoSegment = (s: string): boolean => s.split(/[:/#]/).includes('__proto__')

const isSha256 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

/**
 * The Wave 1 item fields the codec checks (spec §3.2): `kcs`, `nsec` and the interval. Every other new
 * field is optional and kept unvalidated, so a newer writer's extras survive (spec §4.9).
 */
function checkItemExtras(data: Record<string, unknown>): string | null {
  const { kcs, nsec, lo, hi } = data
  if (kcs !== undefined && !(Array.isArray(kcs) && kcs.length <= MAX_KCS && kcs.every((k) => typeof k === 'string'))) return `data.kcs must be at most ${MAX_KCS} strings`
  if (nsec !== undefined && !(isFiniteNumber(nsec) && nsec >= 0 && nsec <= MAX_NSEC)) return `data.nsec must be within [0, ${MAX_NSEC}]`
  if (isFiniteNumber(lo) && isFiniteNumber(hi) && lo > hi) return 'data.lo must not exceed data.hi'
  if (data.return !== undefined && data.return !== true) return 'data.return must be true when present'
  if (data.src === 'form') return checkFormKeys(data)
  return null
}

/**
 * Form items (src `form`, wave-3.md §3.2): their own keys, and never `form` or `slot`, which the ticket and Today
 * readers already read as the ticket form and the position.
 */
function checkFormKeys(data: Record<string, unknown>): string | null {
  if (data.form !== undefined || data.slot !== undefined) return 'a form item uses formId and formSlot, never data.form or data.slot'
  if (typeof data.formId !== 'string' || !FORM_IDS.has(data.formId)) return 'data.formId must be A, B or C'
  if (!isNonEmptyString(data.track)) return 'data.track must be a track id'
  if (!(Number.isInteger(data.formSlot) && (data.formSlot as number) >= 0 && (data.formSlot as number) <= MAX_FORM_SLOT)) return `data.formSlot must be a whole number within [0, ${MAX_FORM_SLOT}]`
  if (data.formSet !== 0 && data.formSet !== 1 && data.formSet !== 2) return 'data.formSet must be 0, 1 or 2'
  return null
}

/** A Prove-it answer: a finite number, or an ordered list of at most 12 non-negative whole numbers (ids). */
const isProveAnswer = (v: unknown): boolean =>
  isFiniteNumber(v) || (Array.isArray(v) && v.length <= MAX_PROVE_CALLS && v.every((n) => Number.isInteger(n) && (n as number) >= 0))

/** `prove` data: v1 (self-graded) as before, now with `v` checked, or v2 (wave-3.md §3.2). */
function checkProve(data: unknown): string | null {
  if (!isObject(data)) return 'data must be an object'
  if (data.v === 2) {
    if (!isNonEmptyString(data.qid, MAX_QID_LENGTH)) return `data.qid must be 1-${MAX_QID_LENGTH} characters`
    if (!(Array.isArray(data.kcs) && data.kcs.length <= MAX_KCS && data.kcs.every((k) => typeof k === 'string'))) return `data.kcs must be at most ${MAX_KCS} strings`
    if (!isProveAnswer(data.answer)) return 'data.answer must be a number or a list of at most 12 ids'
    if (data.actual !== null && !isProveAnswer(data.actual)) return 'data.actual must be a number, a list of at most 12 ids or null'
    if (!(Number.isInteger(data.calls) && (data.calls as number) >= 1 && (data.calls as number) <= MAX_PROVE_CALLS)) return `data.calls must be a whole number within [1, ${MAX_PROVE_CALLS}]`
    if (data.return !== undefined && data.return !== true) return 'data.return must be true when present'
    return null
  }
  if (data.v !== 1 && data.v !== undefined) return 'data.v must be 1 or 2' // an absent `v` is a v1 written before the field was checked
  if (!Array.isArray(data.qids) || !data.qids.every((q) => typeof q === 'string')) return 'data.qids must be a list of question ids'
  if (!Array.isArray(data.self) || !data.self.every(isFiniteNumber) || data.self.length !== data.qids.length) return 'data.self must be numbers, one per question'
  return null
}

/** `play` data: the Wave 1 fields as before, then the Wave 3 `metric`, `levels` and the EPLB dials (wave-3.md §3.2). */
function checkPlay(data: unknown): string | null {
  if (!isObject(data) || typeof data.phase !== 'string' || !PLAY_PHASES.has(data.phase)) return 'data.phase must be play or compose'
  if (!isFiniteNumber(data.turns) || !isFiniteNumber(data.survived) || !isFiniteNumber(data.ghostSurvived)) return 'data needs numeric turns, survived and ghostSurvived'
  const { metric, levels, spec } = data
  if (metric !== undefined) {
    if (!isObject(metric) || typeof metric.name !== 'string' || !PLAY_METRICS.has(metric.name)) return 'data.metric needs a known name'
    if (!(isFiniteNumber(metric.mine) && metric.mine >= 0 && isFiniteNumber(metric.ghost) && metric.ghost >= 0)) return 'data.metric needs finite mine and ghost of at least 0'
    if (metric.lowerIsBetter !== undefined && metric.lowerIsBetter !== true) return 'data.metric.lowerIsBetter must be true'
  }
  if (levels !== undefined) {
    const good = (l: unknown) =>
      isObject(l) &&
      isNonEmptyString(l.id) &&
      typeof l.ok === 'boolean' &&
      (l.logErr === undefined || (isFiniteNumber(l.logErr) && l.logErr >= 0)) &&
      (l.view === undefined || (typeof l.view === 'string' && PLAY_VIEWS.has(l.view)))
    if (!(Array.isArray(levels) && levels.length <= MAX_PLAY_LEVELS && levels.every(good))) return `data.levels must be at most ${MAX_PLAY_LEVELS} {id, ok, logErr?, view?}`
  }
  if (isObject(spec) && (spec.replicate !== undefined || spec.place !== undefined)) {
    if (typeof spec.replicate !== 'string' || !EPLB_REPLICATE.has(spec.replicate) || typeof spec.place !== 'string' || !EPLB_PLACE.has(spec.place)) return 'data.spec needs a known replicate and place'
  }
  return null
}

const isCount = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0
const isRunId = (v: unknown): boolean => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v)

/** `fleet-act` data: free-form as before, but the Wave 3 keys are held to their shape (wave-3.md §3.2). */
function checkFleetAct(data: unknown): string | null {
  if (data === undefined) return null
  if (!isObject(data)) return 'data must be an object'
  const { receipts, rubric, runs } = data
  if (receipts !== undefined && !(isObject(receipts) && isCount(receipts.cited) && isCount(receipts.verified) && isCount(receipts.uncited))) return 'data.receipts needs whole numbers cited, verified and uncited'
  if (rubric !== undefined && !(isObject(rubric) && RUBRIC_KEYS.every((k) => Number.isInteger(rubric[k]) && (rubric[k] as number) >= 0 && (rubric[k] as number) <= 3))) return 'data.rubric needs capacity, slo, cost and failure as whole numbers 0 to 3'
  if (runs !== undefined && !(Array.isArray(runs) && runs.length <= MAX_ACT_RUNS && runs.every(isRunId))) return `data.runs must be at most ${MAX_ACT_RUNS} ids of 8 hex digits`
  return null
}

/** One `RunRecord` of `fw:runs` (wave-3.md §3.2). */
function checkRunRecord(r: unknown): string | null {
  if (!isObject(r)) return 'a run record must be an object'
  if (!isRunId(r.id)) return 'a run record id must be 8 lowercase hex digits'
  if (typeof r.act !== 'string' || !RUN_ACTS.has(r.act)) return 'a run record act must be engine, fleet or business'
  if (!isObject(r.job) || new TextEncoder().encode(stableStringify(r.job)).byteLength > MAX_RUN_JOB_BYTES) return `a run record job must be an object of at most ${MAX_RUN_JOB_BYTES} bytes`
  if (!(Number.isInteger(r.entropy) && (r.entropy as number) >= 0 && (r.entropy as number) <= 0xffffffff)) return 'a run record entropy must be a uint32'
  if (!isObject(r.values)) return 'a run record needs values'
  const values = Object.values(r.values)
  if (values.length > MAX_RUN_VALUES || !values.every(isFiniteNumber)) return `a run record holds at most ${MAX_RUN_VALUES} finite values`
  if (!isIsoInstant(r.at)) return 'a run record at must be an ISO instant'
  return null
}

/** `incident` data (wave-2.md §3.2). `ref` was already matched to the kind's grammar, so it parses. */
function checkIncident(ref: string, data: unknown): string | null {
  if (!isObject(data)) return 'data must be an object'
  const parsed = parseIncidentRef(ref)
  if (typeof data.src !== 'string' || !INCIDENT_SRCS.has(data.src) || data.src !== parsed?.src) return 'data.src must be daily, drill or team and match the ref'
  if (!FAULTS.has(data.fault)) return 'data.fault is not a known fault'
  if (data.severity !== 1 && data.severity !== 2 && data.severity !== 3) return 'data.severity must be 1, 2 or 3'
  for (const key of ['firstHypothesis', 'hypothesis'] as const) {
    if (data[key] !== undefined && !HYPOTHESES.has(data[key])) return `data.${key} must be a fault id or unsure`
  }
  if (!(Array.isArray(data.probes) && data.probes.length <= MAX_PROBES && data.probes.every((p) => typeof p === 'string'))) return `data.probes must be at most ${MAX_PROBES} strings`
  if (data.fix !== undefined && typeof data.fix !== 'string') return 'data.fix must be a string'
  for (const key of ['burn', 'expertBurn', 'streetlight'] as const) {
    if (!(isFiniteNumber(data[key]) && data[key] >= 0)) return `data.${key} must be a finite number of at least 0`
  }
  if (typeof data.diagnosed !== 'boolean' || typeof data.fixed !== 'boolean') return 'data.diagnosed and data.fixed must be booleans'
  if (!(Array.isArray(data.components) && data.components.length <= MAX_RUN_COMPONENTS && data.components.every(isSha256))) return `data.components must be at most ${MAX_RUN_COMPONENTS} sha-256 hashes`
  if (parsed?.src === 'drill') {
    if (data.date !== undefined && typeof data.date !== 'string') return 'data.date must be a string'
  } else if (data.date !== (parsed as { date: string }).date) return 'data.date must equal the date of the ref'
  if (data.act4 !== undefined && typeof data.act4 !== 'boolean') return 'data.act4 must be a boolean'
  if (data.kcs !== undefined && !(Array.isArray(data.kcs) && data.kcs.length <= MAX_KCS && data.kcs.every((k) => typeof k === 'string'))) return `data.kcs must be at most ${MAX_KCS} strings`
  return null
}

/** `fleet-run` data (wave-2.md §3.2). */
function checkFleetRun(ref: string, data: unknown): string | null {
  if (!isObject(data)) return 'data must be an object'
  if (typeof data.mode !== 'string' || !FLEET_MODES.has(data.mode) || data.mode !== parseFleetRunRef(ref)) return 'data.mode must be a known mode and equal the ref'
  const parts = data.components
  const good = (c: unknown) => isObject(c) && SLOTS.has(c.slot) && isNonEmptyString(c.labId) && isSha256(c.sha256)
  if (!(Array.isArray(parts) && parts.length >= 1 && parts.length <= MAX_RUN_COMPONENTS && parts.every(good))) return `data.components must list 1 to ${MAX_RUN_COMPONENTS} {slot, labId, sha256}`
  if (data.seeds !== 'fresh' && data.seeds !== 'practice') return 'data.seeds must be fresh or practice'
  if (!isFiniteNumber(data.goodput) || !isFiniteNumber(data.refGoodput)) return 'data needs finite goodput and refGoodput'
  if (data.ttftP95 !== undefined && !isFiniteNumber(data.ttftP95)) return 'data.ttftP95 must be a number'
  return null
}

/** Help acks (`packet:` refs, wave-2.md §3.2): how the packet left and how long it was. Hint and erratum acks carry nothing checked. */
function checkAck(ref: string, data: unknown): string | null {
  if (data !== undefined && !isObject(data)) return 'data must be an object'
  if (!ref.startsWith('packet:')) return null
  if (!isObject(data) || typeof data.via !== 'string' || !HELP_VIAS.has(data.via)) return 'data.via must be claude, chatgpt or copy'
  if (!(Number.isInteger(data.chars) && (data.chars as number) >= 0 && (data.chars as number) <= MAX_PACKET_CHARS)) return `data.chars must be a whole number within [0, ${MAX_PACKET_CHARS}]`
  if (data.arm !== undefined && data.arm !== 'ladder' && data.arm !== 'packet') return 'data.arm must be ladder or packet'
  return null
}

/** Kind-specific `data` shape: only what fold and the selectors read. */
function checkData(kind: EventKind, ref: string, data: unknown): string | null {
  switch (kind) {
    case 'item':
    case 'probe':
      if (!isObject(data) || typeof data.src !== 'string' || !ITEM_SRCS.has(data.src)) return 'data.src is missing or unknown'
      if (data.pick !== undefined && !(Array.isArray(data.pick) && data.pick.every(isFiniteNumber))) return 'data.pick must be numbers'
      return checkItemExtras(data)
    case 'predict':
      if (!isObject(data) || !isFiniteNumber(data.value) || !isFiniteNumber(data.truth) || typeof data.unit !== 'string') {
        return 'data needs numeric value and truth and a unit'
      }
      if (data.src !== undefined && !(typeof data.src === 'string' && PREDICT_SRCS.has(data.src))) return 'data.src is unknown'
      return checkItemExtras(data)
    case 'lab-check': {
      if (!isObject(data) || !Array.isArray(data.passed) || !data.passed.every((x) => typeof x === 'string')) return 'data.passed must be a list of check ids'
      if (data.total !== undefined && !isFiniteNumber(data.total)) return 'data.total must be a number'
      if (data.abi !== undefined && data.abi !== 1 && data.abi !== 2) return 'data.abi must be 1 or 2'
      if (data.seeds !== undefined && data.seeds !== 'fresh' && data.seeds !== 'default') return 'data.seeds must be fresh or default'
      const checks = data.checks
      if (checks !== undefined) {
        const good = (c: unknown) => isObject(c) && isNonEmptyString(c.id) && typeof c.status === 'string' && CHECK_STATUSES.has(c.status)
        if (!(Array.isArray(checks) && checks.every(good))) return 'data.checks must list {id, status}'
      }
      return null
    }
    case 'play':
      return checkPlay(data)
    case 'prove':
      return checkProve(data)
    case 'fleet-act':
      return checkFleetAct(data)
    case 'capstone-step':
      if (data !== undefined && !(isObject(data) && (data.index === undefined || isFiniteNumber(data.index)))) return 'data.index must be a number'
      return null
    case 'incident':
      return checkIncident(ref, data)
    case 'fleet-run':
      return checkFleetRun(ref, data)
    case 'ack':
      return checkAck(ref, data)
    default:
      return data === undefined || isObject(data) ? null : 'data must be an object'
  }
}

/**
 * Validate one event that enters from outside (an import or an outbox). Checks the id, the kind and its
 * ref grammar, the time fields (`day` must equal `dayOf(at, tz)`), the graded fields, and the `data`
 * shape fold relies on. Unknown extra fields are kept, so the same object comes back.
 */
export function validateEvent(x: unknown): Checked<LedgerEvent> {
  if (!isObject(x)) return fail('not an object')
  if (!isNonEmptyString(x.id)) return fail(`id must be 1-${MAX_ID_LENGTH} characters`)
  if (x.v !== 1) return fail(`unknown event version ${JSON.stringify(x.v)}`)
  if (!isKnownKind(x.kind)) return fail(`unknown kind ${JSON.stringify(x.kind)}`)
  const kind = x.kind
  if (typeof x.ref !== 'string' || !refMatchesKind(kind, x.ref) || hasProtoSegment(x.ref)) {
    return fail(`ref ${JSON.stringify(x.ref)} does not fit kind ${kind}`)
  }
  if (!isIsoInstant(x.at)) return fail('at must be an ISO instant')
  if (!Number.isInteger(x.tz) || Math.abs(x.tz as number) > MAX_TZ_MINUTES) return fail('tz must be whole minutes within a day')
  if (!isLocalDay(x.day) || x.day !== dayOf(x.at, x.tz as number)) return fail('day does not match at and tz')
  if (!isNonEmptyString(x.dev)) return fail('dev must be a non-empty string')
  if (x.rev !== undefined && typeof x.rev !== 'string') return fail('rev must be a string')
  if (REV_REQUIRED.has(kind) && !isNonEmptyString(x.rev)) return fail(`${kind} needs a rev`)

  if (GRADED_KINDS.has(kind)) {
    if (!isFiniteNumber(x.score) || x.score < 0 || x.score > 1) return fail('score must be within [0, 1]')
    if (typeof x.ok !== 'boolean') return fail('ok must be a boolean')
    if (typeof x.provenance !== 'string' || !PROVENANCES.has(x.provenance)) return fail('provenance is missing or unknown')
    if (x.conf !== undefined && !(typeof x.conf === 'string' && CONFIDENCES.has(x.conf))) return fail('conf is unknown')
    if (x.seed !== undefined && !(Number.isInteger(x.seed) && (x.seed as number) >= 0 && (x.seed as number) <= 0xffffffff)) return fail('seed must be a uint32')
    if (x.ms !== undefined && !(isFiniteNumber(x.ms) && x.ms >= 0)) return fail('ms must be a non-negative number')
    if (x.wasmSha256 !== undefined && !(typeof x.wasmSha256 === 'string' && /^[0-9a-f]{64}$/.test(x.wasmSha256))) return fail('wasmSha256 must be lowercase hex SHA-256')
    // Provenance `proved` is the strongest credit: only a Prove-it v2 that came out right, on a named module (wave-3.md §3.2).
    if (kind === 'prove' && x.provenance === 'proved' && !(isObject(x.data) && x.data.v === 2 && x.ok === true && isSha256(x.wasmSha256))) {
      return fail('provenance proved needs a Prove-it v2 that is ok, with a wasmSha256')
    }
  }
  const dataProblem = checkData(kind, x.ref, x.data)
  if (dataProblem) return fail(dataProblem)
  return { ok: true, value: x as unknown as LedgerEvent }
}

const WORKING_EXACT = new Set([
  'fw:doc',
  'capstone:metrics',
  'boot:path',
  'boot:week',
  'boot:value',
  'boot:install-dismissed',
  // Wave 1 (spec §3.5)
  'placement:result',
  'queue:laptop',
  'handoff:last',
  'today:prefs',
  // Wave 2 (wave-2.md §3.5)
  'engine:slots',
  'exp:seed',
  'zoo:config',
  'daily:team',
  // Wave 3 (wave-3.md §3.5)
  'fw:runs',
  'profile:background',
])
const WORKING_PREFIXES = ['scroll:', 'sim-config:', 'fw:evidence:', 'settings:']

export function isWorkingKey(key: unknown): key is WorkingRecord['key'] {
  if (typeof key !== 'string' || key.length > MAX_ID_LENGTH || hasProtoSegment(key)) return false
  return WORKING_EXACT.has(key) || WORKING_PREFIXES.some((p) => key.length > p.length && key.startsWith(p))
}

/** The values the codec holds to a shape: only the Wave 2 keys that other code trusts (the slot map, the seed, the pasted config, the team code). */
function checkWorkingValue(key: string, value: unknown): string | null {
  switch (key) {
    case 'engine:slots': {
      if (!isObject(value)) return 'engine:slots must map slots to components'
      for (const [slot, entry] of Object.entries(value)) {
        if (!SLOTS.has(slot)) return `engine:slots has an unknown slot ${JSON.stringify(slot)}`
        if (!isObject(entry) || !isSha256(entry.sha256) || !Number.isInteger(entry.version) || (entry.version as number) < 1 || !isIsoInstant(entry.at) || !isNonEmptyString(entry.labId)) {
          return `engine:slots.${slot} needs a sha256, a labId, an integer version of at least 1 and an ISO at`
        }
      }
      return null
    }
    case 'exp:seed':
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff ? null : 'exp:seed must be a uint32'
    case 'zoo:config':
      return typeof value === 'string' && value.length <= MAX_ZOO_CONFIG ? null : `zoo:config must be a string of at most ${MAX_ZOO_CONFIG} characters`
    case 'daily:team':
      return isNonEmptyString(value) ? null : 'daily:team must be a non-empty string'
    case 'fw:runs': {
      if (!(Array.isArray(value) && value.length <= MAX_RUN_RECORDS)) return `fw:runs must be a list of at most ${MAX_RUN_RECORDS} run records`
      for (const r of value) {
        const problem = checkRunRecord(r)
        if (problem) return `fw:runs: ${problem}`
      }
      return null
    }
    case 'profile:background':
      return BACKGROUND_SET.has(value) ? null : 'profile:background must be a known background'
    default:
      return null
  }
}

export function validateWorkingRecord(x: unknown): Checked<WorkingRecord> {
  if (!isObject(x)) return fail('not an object')
  if (!isWorkingKey(x.key)) return fail(`unknown working key ${JSON.stringify(x.key)}`)
  if (!('value' in x) || x.value === undefined) return fail('value is missing')
  const valueProblem = checkWorkingValue(x.key, x.value)
  if (valueProblem) return fail(valueProblem)
  if (!isIsoInstant(x.at)) return fail('at must be an ISO instant')
  if (!isNonEmptyString(x.dev)) return fail('dev must be a non-empty string')
  return { ok: true, value: x as unknown as WorkingRecord }
}

function validateComponent(x: unknown): Checked<ExportedComponent> {
  if (!isObject(x)) return fail('not an object')
  if (typeof x.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(x.sha256)) return fail('sha256 must be lowercase hex')
  if (!isNonEmptyString(x.labId)) return fail('labId must be a non-empty string')
  if (!isFiniteNumber(x.size) || x.size < 0) return fail('size must be a non-negative number')
  if (!isIsoInstant(x.addedAt)) return fail('addedAt must be an ISO instant')
  if (x.bytesB64 !== undefined && typeof x.bytesB64 !== 'string') return fail('bytesB64 must be a string')
  return { ok: true, value: x as unknown as ExportedComponent }
}

type Extras = ExportV3['extras']

function validateExtras(x: unknown): Checked<Extras> {
  if (x === undefined) return { ok: true, value: { capstoneDrafts: {} } }
  if (!isObject(x)) return fail('not an object')
  const drafts = x.capstoneDrafts ?? {}
  if (!isObject(drafts) || !Object.values(drafts).every((v) => typeof v === 'string')) return fail('capstoneDrafts must map keys to strings')
  const out: Extras = { capstoneDrafts: drafts as Record<string, string> }
  if (x.capstoneFlags !== undefined) {
    const flags = x.capstoneFlags
    if (!isObject(flags) || (flags.hints !== undefined && typeof flags.hints !== 'boolean') || (flags.optimizer !== undefined && typeof flags.optimizer !== 'boolean')) {
      return fail('capstoneFlags must be booleans')
    }
    out.capstoneFlags = flags as Extras['capstoneFlags']
  }
  if (x.leaderboardPersonal !== undefined) out.leaderboardPersonal = x.leaderboardPersonal as Json
  return { ok: true, value: out }
}

/* ------------------------------------------------------------------ */
/* Export (spec §10.1)                                                 */
/* ------------------------------------------------------------------ */

export interface ExportInput extends Ledger {
  device: DeviceId
  exportedAt: string
  components?: ExportedComponent[]
  extras?: Extras
  /** A delta (spec §6.6): only events and working records with `at` >= this, and the components of slots changed since. Extras are left out. */
  sinceAt?: string
}

/** The hashes `engine:slots` names, restricted to slots filled at or after `since` when it is given. */
export function slotHashes(working: readonly WorkingRecord[], since?: string): Set<string> {
  const out = new Set<string>()
  const slots = working.find((r) => r.key === 'engine:slots')?.value
  if (!isObject(slots)) return out
  for (const entry of Object.values(slots)) {
    if (isObject(entry) && isSha256(entry.sha256) && (since === undefined || (typeof entry.at === 'string' && entry.at >= since))) out.add(entry.sha256)
  }
  return out
}

/**
 * Build the export: events sorted by (`at`, `id`), working by key, components by hash. With `sinceAt` it is a
 * delta for a device handoff: still a complete export v3 file, so the other device imports it with merge.
 * The bound is inclusive, because a duplicate is harmless to merge and a missed event is not.
 */
export function buildExportV3(input: ExportInput): ExportV3 {
  const since = input.sinceAt
  const events = since === undefined ? input.events : input.events.filter((e) => e.at >= since)
  const working = since === undefined ? input.working : input.working.filter((r) => r.at >= since)
  return {
    format: EXPORT_FORMAT,
    version: 3,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: input.exportedAt,
    device: input.device,
    events: mergeEvents(events),
    working: mergeWorking(working),
    components: mergeComponents(since === undefined ? (input.components ?? []) : deltaComponents(input, since), []),
    extras: since === undefined ? (input.extras ?? { capstoneDrafts: {} }) : { capstoneDrafts: {} },
  }
}

/** The components a delta carries: those in slots changed since the marker. */
function deltaComponents(input: ExportInput, since: string): ExportedComponent[] {
  const changed = slotHashes(input.working, since)
  return (input.components ?? []).filter((c) => changed.has(c.sha256))
}

/** Deterministic text (sorted keys): the same ledger always exports to the same bytes. */
export function serializeExport(file: ExportV3): string {
  return stableStringify(file)
}

/** The file name a download should use. */
export function exportFileName(exportedAt: string): string {
  return `kernelspace-progress-${exportedAt.slice(0, 10)}.json`
}

/* ------------------------------------------------------------------ */
/* Detection and parsing (spec §10.2, Addendum A1: export v3 only)     */
/* ------------------------------------------------------------------ */

export type ParsedImport =
  | { ok: true; format: ImportFormat; file: ExportV3 }
  | { ok: false; error: ImportErrorCode; detail: string }

const refuse = (error: ImportErrorCode, detail = IMPORT_ERROR_MESSAGES[error]): { ok: false; error: ImportErrorCode; detail: string } => ({
  ok: false,
  error,
  detail,
})

/** Size, JSON, format and schema checks, then every record is validated; one bad record refuses the file. */
export function parseImport(text: string): ParsedImport {
  if (new TextEncoder().encode(text).byteLength > IMPORT_MAX_BYTES) return refuse('too-large')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return refuse('parse')
  }
  if (!isObject(data)) return refuse('unknown-format')

  const version = data.version
  if (data.format !== EXPORT_FORMAT) {
    // A v1/v2 export (`{version, lessons, xp}`) or a copied localStorage value (`{state, version}`).
    const v1v2 = typeof version === 'number' && isObject(data.lessons)
    const envelope = typeof version === 'number' && isObject(data.state)
    return v1v2 || envelope ? refuse('older-export') : refuse('unknown-format')
  }
  if (typeof version !== 'number') return refuse('unknown-format')
  if (version < 3) return refuse('older-export')
  const schemaVersion = data.schemaVersion
  if (version > 3 || (typeof schemaVersion === 'number' && schemaVersion > SCHEMA_VERSION)) return refuse('newer-schema')
  if (!Number.isInteger(schemaVersion) || (schemaVersion as number) < 1) return refuse('invalid', 'schemaVersion must be a positive integer')
  if (!Array.isArray(data.events) || !Array.isArray(data.working)) return refuse('invalid', 'events and working must be lists')
  if (!isNonEmptyString(data.device)) return refuse('invalid', 'device must be a non-empty string')
  if (!isIsoInstant(data.exportedAt)) return refuse('invalid', 'exportedAt must be an ISO instant')

  const events: LedgerEvent[] = []
  for (const [i, raw] of data.events.entries()) {
    const checked = validateEvent(raw)
    if (!checked.ok) return refuse('invalid', `events[${i}]: ${checked.reason}`)
    events.push(checked.value)
  }
  const working: WorkingRecord[] = []
  for (const [i, raw] of data.working.entries()) {
    const checked = validateWorkingRecord(raw)
    if (!checked.ok) return refuse('invalid', `working[${i}]: ${checked.reason}`)
    working.push(checked.value)
  }
  const components: ExportedComponent[] = []
  const rawComponents = data.components ?? []
  if (!Array.isArray(rawComponents)) return refuse('invalid', 'components must be a list')
  for (const [i, raw] of rawComponents.entries()) {
    const checked = validateComponent(raw)
    if (!checked.ok) return refuse('invalid', `components[${i}]: ${checked.reason}`)
    components.push(checked.value)
  }
  const extras = validateExtras(data.extras)
  if (!extras.ok) return refuse('invalid', `extras: ${extras.reason}`)

  const file: ExportV3 = {
    format: EXPORT_FORMAT,
    version: 3,
    schemaVersion: schemaVersion as number,
    exportedAt: data.exportedAt,
    device: data.device,
    events: mergeEvents(events),
    working: mergeWorking(working),
    components: mergeComponents(components, []),
    extras: extras.value,
  }
  return { ok: true, format: { kind: 'export-v3', schemaVersion: file.schemaVersion }, file }
}

/* ------------------------------------------------------------------ */
/* Merge or replace (spec §10.3)                                       */
/* ------------------------------------------------------------------ */

/** Component metadata union by hash; the canonical rule settles two different records for one hash. */
export function mergeComponents(a: readonly ExportedComponent[], b: readonly ExportedComponent[]): ExportedComponent[] {
  const bySha = new Map<string, ExportedComponent>()
  for (const c of [...a, ...b]) {
    const prev = bySha.get(c.sha256)
    bySha.set(c.sha256, prev && stableStringify(prev) <= stableStringify(c) ? prev : c)
  }
  return [...bySha.values()].sort((x, y) => (x.sha256 < y.sha256 ? -1 : x.sha256 > y.sha256 ? 1 : 0))
}

const personalBest = (v: Json | undefined): { version: string; goodput: number } | null =>
  isObject(v) && typeof v.benchmarkVersion === 'string' && isFiniteNumber(v.overallGoodput)
    ? { version: v.benchmarkVersion, goodput: v.overallGoodput }
    : null

/**
 * Merge the localStorage extras of a file into the local ones: Capstone drafts fill only missing
 * steps, flags are OR-ed, and the leaderboard personal best keeps the higher `overallGoodput`
 * when `benchmarkVersion` matches (otherwise the local one stays).
 */
export function mergeExtras(local: Extras, file: Extras): Extras {
  const out: Extras = { capstoneDrafts: { ...file.capstoneDrafts, ...local.capstoneDrafts } }
  if (local.capstoneFlags || file.capstoneFlags) {
    const flags: NonNullable<Extras['capstoneFlags']> = {}
    const hints = local.capstoneFlags?.hints || file.capstoneFlags?.hints
    const optimizer = local.capstoneFlags?.optimizer || file.capstoneFlags?.optimizer
    if (hints !== undefined) flags.hints = hints
    if (optimizer !== undefined) flags.optimizer = optimizer
    out.capstoneFlags = flags
  }
  const mine = personalBest(local.leaderboardPersonal)
  const theirs = personalBest(file.leaderboardPersonal)
  if (local.leaderboardPersonal === undefined) {
    if (file.leaderboardPersonal !== undefined) out.leaderboardPersonal = file.leaderboardPersonal
  } else if (mine && theirs && mine.version === theirs.version && theirs.goodput > mine.goodput) {
    out.leaderboardPersonal = file.leaderboardPersonal
  } else {
    out.leaderboardPersonal = local.leaderboardPersonal
  }
  return out
}

/**
 * The ledger an import leaves behind: merge = union (canonical rule on id clashes, last writer wins
 * on working keys); replace = exactly the file's events and working records.
 */
export function applyImport(current: Ledger, file: Pick<ExportV3, 'events' | 'working'>, mode: ImportMode): Ledger {
  const incoming: Ledger = { events: file.events, working: file.working }
  return mode === 'merge' ? mergeLedgers(current, incoming) : normalizeLedger(incoming)
}

/* ------------------------------------------------------------------ */
/* Preview (spec §10.5)                                                */
/* ------------------------------------------------------------------ */

export interface PreviewContext extends Ledger {
  /** This device's id, so replace can say how many local events it would drop. */
  device?: DeviceId
}

const latestAt = (events: readonly LedgerEvent[]): string | null =>
  events.reduce<string | null>((max, e) => (max === null || e.at > max ? e.at : max), null)

/** Derive in memory, never write: what the import would add, change and drop. */
export function previewImport(
  text: string,
  mode: ImportMode,
  current: PreviewContext,
): ImportPreview | { error: ImportErrorCode; detail?: string } {
  const parsed = parseImport(text)
  if (!parsed.ok) return { error: parsed.error, detail: parsed.detail }
  const { file } = parsed

  const result = applyImport(current, file, mode)
  const currentIds = new Set(current.events.map((e) => e.id))
  const fileIds = new Set(file.events.map((e) => e.id))
  const newEvents = mode === 'merge' ? file.events.filter((e) => !currentIds.has(e.id)).length : file.events.length

  const before = new Map(current.working.map((r) => [r.key, stableStringify(r)]))
  const after = new Map(result.working.map((r) => [r.key, stableStringify(r)]))
  let workingChanges = 0
  for (const [key, json] of after) if (before.get(key) !== json) workingChanges += 1
  for (const key of before.keys()) if (!after.has(key)) workingChanges += 1

  const warnings: string[] = []
  if (file.events.length === 0) warnings.push('the file has no events')
  const localLatest = latestAt(current.events)
  const fileLatest = latestAt(file.events)
  if (localLatest !== null && fileLatest !== null && fileLatest <= localLatest) {
    warnings.push(`file has no events newer than ${localLatest.slice(0, 10)}`)
  }
  if (mode === 'replace') {
    const dropped = current.events.filter((e) => !fileIds.has(e.id) && (current.device === undefined || e.dev === current.device)).length
    if (dropped > 0) {
      warnings.push(
        current.device === undefined
          ? `replace drops ${dropped} events that are not in the file`
          : `replace drops ${dropped} events made on this device`,
      )
    }
  }

  return {
    format: parsed.format,
    mode,
    fileEvents: file.events.length,
    newEvents,
    workingChanges,
    before: summary(derive(current.events)),
    after: summary(derive(result.events)),
    warnings,
  }
}
