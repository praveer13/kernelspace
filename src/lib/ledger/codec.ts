import { EXPORT_FORMAT, IMPORT_MAX_BYTES, SCHEMA_VERSION } from './constants'
import { derive, GRADED_KINDS } from './fold'
import {
  mergeEvents,
  mergeLedgers,
  mergeWorking,
  normalizeLedger,
  type Ledger,
} from './merge'
import { isKnownKind, refMatchesKind } from './refs'
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
const ITEM_SRCS = new Set(['quiz', 'boot', 'card', 'cold', 'today', 'ticket', 'testout', 'placement', 'pre', 'diagram', 'practice'])
const PREDICT_SRCS = new Set(['boot', 'lesson', 'pre', 'diagram', 'placement'])
const PLAY_PHASES = new Set(['play', 'compose'])
const CHECK_STATUSES = new Set(['pass', 'fail', 'trap', 'timeout'])
const MAX_KCS = 6
const MAX_NSEC = 600
const REV_REQUIRED = new Set<EventKind>(['item', 'probe', 'predict'])
const MAX_ID_LENGTH = 200
const MAX_TZ_MINUTES = 24 * 60

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isNonEmptyString = (v: unknown, max = MAX_ID_LENGTH): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max

/** `__proto__` as an id segment of a ref or key (`lesson:__proto__`, `sim:x/__proto__`). Fold and view cope with it, but nothing legitimate uses it. */
const hasProtoSegment = (s: string): boolean => s.split(/[:/#]/).includes('__proto__')

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
  return null
}

/** Kind-specific `data` shape: only what fold and the selectors read. */
function checkData(kind: EventKind, data: unknown): string | null {
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
      if (!isObject(data) || typeof data.phase !== 'string' || !PLAY_PHASES.has(data.phase)) return 'data.phase must be play or compose'
      if (!isFiniteNumber(data.turns) || !isFiniteNumber(data.survived) || !isFiniteNumber(data.ghostSurvived)) return 'data needs numeric turns, survived and ghostSurvived'
      return null
    case 'prove':
      if (!isObject(data) || !Array.isArray(data.qids) || !data.qids.every((q) => typeof q === 'string')) return 'data.qids must be a list of question ids'
      if (!Array.isArray(data.self) || !data.self.every(isFiniteNumber) || data.self.length !== data.qids.length) return 'data.self must be numbers, one per question'
      return null
    case 'capstone-step':
      if (data !== undefined && !(isObject(data) && (data.index === undefined || isFiniteNumber(data.index)))) return 'data.index must be a number'
      return null
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
  }
  const dataProblem = checkData(kind, x.data)
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
])
const WORKING_PREFIXES = ['scroll:', 'sim-config:', 'fw:evidence:', 'settings:']

export function isWorkingKey(key: unknown): key is WorkingRecord['key'] {
  if (typeof key !== 'string' || key.length > MAX_ID_LENGTH || hasProtoSegment(key)) return false
  return WORKING_EXACT.has(key) || WORKING_PREFIXES.some((p) => key.length > p.length && key.startsWith(p))
}

export function validateWorkingRecord(x: unknown): Checked<WorkingRecord> {
  if (!isObject(x)) return fail('not an object')
  if (!isWorkingKey(x.key)) return fail(`unknown working key ${JSON.stringify(x.key)}`)
  if (!('value' in x) || x.value === undefined) return fail('value is missing')
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
  /** A delta (spec §6.6): only events and working records with `at` >= this. Components and extras are left out. */
  sinceAt?: string
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
    components: since === undefined ? mergeComponents(input.components ?? [], []) : [],
    extras: since === undefined ? (input.extras ?? { capstoneDrafts: {} }) : { capstoneDrafts: {} },
  }
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
