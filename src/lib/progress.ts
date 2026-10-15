import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import { AGGREGATE_VERSION, EXPORT_FORMAT, MAX_ACT_RUNS, MAX_PROVE_CALLS, MAX_PROVE_IDS, MAX_QID_LENGTH, QUIZ_PASS_SCORE, RUBRIC_KEYS, SCHEMA_VERSION } from './ledger/constants'
import { browserEnv, loadDeviceId, onLedgerClientRequest } from './ledger/client'
import { emptyAggregate, fleetRunOk, fleetRunScore, foldInto, incidentOk, incidentScore, upgradeAggregate } from './ledger/fold'
import { checkSnapshot } from './ledger/guard'
import { lwwWorking } from './ledger/merge'
import { SNAPSHOT_KEY } from './ledger/names'
import { appendToOutbox, clearInOutboxes, outboxKey } from './ledger/outbox'
import { getOwn, setOwn, sha256Hex, stableStringify } from './ledger/stable'
import { refMatchesKind } from './ledger/refs'
import { dayOf } from './ledger/time'
import { toProgressData, workingMap } from './ledger/view'
import type {
  Aggregate,
  AggregateV1,
  AggregateV2,
  AggregateV3,
  AckRef,
  BootRef,
  ComponentInstall,
  EngineSlot,
  EngineSlotEntry,
  EngineSlots,
  EventKind,
  FacadeEnv,
  FleetActData,
  FleetActMeta,
  FleetRunResult,
  HelpAckData,
  IncidentResult,
  ItemResponse,
  Json,
  JsonObject,
  LabRunMeta,
  LabRunV2,
  LedgerEngine,
  LedgerEvent,
  LedgerFacadeActions,
  LedgerFacadeState,
  LedgerStatus,
  LessonRef,
  PacketRef,
  PlayResult,
  Provenance,
  ProveData,
  ProveResult,
  QuizAttempt,
  ReadOnlyReason,
  SimOutcome,
  SimRef,
  SnapshotV2,
  TicketAttempt,
  WorkingKey,
  WorkingRecord,
} from './ledger/types'
import { localDateKey } from './economy'
import { TOTAL_TRACK_LESSONS } from './tracks'

/**
 * Kernelspace progress store (design.md §10; docs/specs/ledger-v3.md §8).
 *
 * `useProgress` keeps its exact shape, but its data is now the fold of an append-only event ledger
 * (the aggregate). The store hydrates synchronously from the derived snapshot under `kernelspace:v2`,
 * folds each action's events into the aggregate synchronously, and hands them to the lazily loaded
 * engine, which commits them to IndexedDB and keeps other tabs in step. The façade never reads or
 * writes `kernelspace:v1` (Addendum A1: v3 starts fresh).
 */

/**
 * `read` = finished without passing (a click, or "continue anyway"); `done` = passed (ticket, spiral,
 * checkpoint or test-out). Percentages, badges and rings count `done` only (wave-1.md §8.3, owner answer O4).
 */
export type LessonStatus = 'unstarted' | 'reading' | 'read' | 'done'

export interface LessonProgress {
  status: LessonStatus
  quizScore?: number // 0..1
  exerciseDone?: boolean
  completedAt?: string // ISO
  lastVisitedAt: string // ISO
  scrollPct?: number // resume position
}

export interface SimProgress {
  visits: number
  tasksDone: string[]
  lastConfig?: unknown
}

export interface CapstoneMetrics {
  ttft: number
  itl: number
  throughput: number
}

export interface CapstoneProgress {
  step: number
  stepsDone: string[]
  metrics?: CapstoneMetrics
}

export interface LabProgress {
  done: boolean
  checksDone: string[]
  completedAt?: string // ISO
}

export interface FleetWeekProgress {
  actsDone: string[]
  scores: Record<string, number>
  docText?: string
  measurementEvidence?: Record<
    string,
    { analysis?: string; screenshotName?: string; screenshotBytes?: number; attempted?: string[]; credited?: string[] }
  >
}

export type CodeLang = 'python' | 'java' | 'rust' | 'c'

export interface ProgressSettings {
  reducedMotion?: boolean
  codeLang?: CodeLang
}

export interface ProgressState extends LedgerFacadeState, LedgerFacadeActions {
  version: 2
  lessons: Record<string, LessonProgress>
  sims: Record<string, SimProgress>
  labs: Record<string, LabProgress>
  fleetWeek: FleetWeekProgress
  capstone: CapstoneProgress
  xp: number
  streakDays: string[] // local YYYY-MM-DD dates with graded work
  achievements: string[]
  settings: ProgressSettings

  // actions
  markLessonStatus: (lessonId: string, status: LessonStatus) => void
  setLessonScroll: (lessonId: string, scrollPct: number) => void
  recordQuizScore: (lessonId: string, score: number) => void
  markExerciseDone: (lessonId: string) => void
  recordSimVisit: (simId: string) => void
  recordSimTask: (simId: string, taskId: string) => void
  setSimConfig: (simId: string, config: unknown) => void
  recordLabResult: (
    labId: string,
    passedCheckIds: string[],
    totalChecks: number,
    meta?: LabRunMeta,
  ) => void
  completeFleetWeekAct: (actId: string, score: number, meta?: FleetActMeta) => void
  setFleetWeekDoc: (text: string) => void
  /** Nothing writes a screenshot since 3b-05 (D14); evidence stored before then keeps its fields and still reads. */
  setFleetWeekEvidence: (actId: string, patch: { analysis?: string; attempted?: string[]; credited?: string[] }) => void
  completeCapstoneStep: (stepId: string, stepIndex: number) => void
  setCapstoneMetrics: (metrics: CapstoneMetrics) => void
  unlockAchievement: (id: string) => void
  updateSettings: (patch: Partial<ProgressSettings>) => void
  importProgress: (json: string) => boolean
  resetProgress: () => void
}

// The economy lives in economy.ts so the pure ledger core can use it without zustand.
export { XP, localDateKey } from './economy'

export const TOTAL_LESSONS = TOTAL_TRACK_LESSONS


/* ---------------- Ledger façade (spec §8) ---------------- */

export interface FacadeOptions {
  /** How the engine boot is scheduled after hydration (§8.2 step 4). Defaults to an idle callback (2 s timeout); never runs outside a browser. */
  scheduleBoot?: (run: () => void) => void
  /** Debounce for snapshot writes (§8.5 step 4). */
  snapshotDelayMs?: number
}

export interface ProgressControls {
  /** Persist everything now: deferred working writes and the snapshot, then wait for in-flight engine writes. */
  flush(): Promise<void>
  /** Boot the engine now; resolves with it once this store is subscribed to it. */
  engine(): Promise<LedgerEngine>
  /** Stop timers and listeners. The app never calls this; tests do. */
  dispose(): void
}

export type ProgressStore = UseBoundStore<StoreApi<ProgressState>> & { controls: ProgressControls }

const SNAPSHOT_DELAY_MS = 250
/** The codec rejects an item with more KCs than this (wave-1.md §3.2), and a rejected event is lost at flush. */
const MAX_KCS = 6
/** The codec rejects an incident or a run with more of these (wave-2.md §3.2), and a rejected event is lost at flush. */
const MAX_PROBES = 12
const MAX_RUN_COMPONENTS = 8
/** The codec refuses more play levels or run records than these (wave-3.md §3.2). */
const MAX_PLAY_LEVELS = 8
const MAX_RUN_RECORDS = 50
// The codec's bounds on a Prove-it v2 event and a Fleet Week act's data (MAX_QID_LENGTH, MAX_PROVE_IDS, MAX_PROVE_CALLS,
// MAX_ACT_RUNS, RUBRIC_KEYS) come from ledger/constants.ts, which the codec reads too: one source, and no codec load (D35).
/** The most characters a context packet may report (H2); the codec refuses more. */
const MAX_PACKET_CHARS = 6000
/** Scroll position is device-local and changes constantly: commit it at most this often (§5). */
const SCROLL_DELAY_MS = 2000
/** Free-text fields (Fleet Week notes) commit after typing pauses. */
const TEXT_DELAY_MS = 400

type DataKey = 'version' | 'lessons' | 'sims' | 'labs' | 'fleetWeek' | 'capstone' | 'xp' | 'streakDays' | 'achievements' | 'settings'
const DATA_KEYS: readonly DataKey[] = [
  'version',
  'lessons',
  'sims',
  'labs',
  'fleetWeek',
  'capstone',
  'xp',
  'streakDays',
  'achievements',
  'settings',
]

type Actions = Omit<ProgressState, DataKey | keyof LedgerFacadeState>

const workingDelay = (key: WorkingKey): number =>
  key.startsWith('scroll:') ? SCROLL_DELAY_MS : key === 'fw:doc' || key.startsWith('fw:evidence:') ? TEXT_DELAY_MS : 0

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isRec = (v: unknown): v is Record<string, unknown> => isObj(v) && !Array.isArray(v)

/**
 * `next` with every part that equals `prev` replaced by `prev`'s own object. Actions rebuild the whole
 * view from the aggregate, and this keeps references stable for the parts an action did not touch, so
 * selectors such as `(s) => s.lessons` re-render exactly when they did before the ledger existed.
 */
function reuse<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next) || !isObj(prev) || !isObj(next) || Array.isArray(prev) !== Array.isArray(next)) return next
  const keys = Object.keys(next)
  let same = Object.keys(prev).length === keys.length
  const out: Record<string, unknown> = Array.isArray(next) ? ([] as unknown as Record<string, unknown>) : {}
  for (const key of keys) {
    const had = Object.hasOwn(prev, key)
    const before = had ? prev[key] : undefined
    const value = reuse(before, next[key])
    setOwn(out, key, value)
    if (!had || value !== before) same = false
  }
  return (same ? prev : out) as T
}

/** A clone that survives JSON, so memory holds what a reload would give back. */
function toJson(value: unknown): Json | undefined {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? undefined : (JSON.parse(text) as Json)
  } catch {
    return undefined
  }
}

const sameValue = (a: Json | undefined, b: Json): boolean => a !== undefined && stableStringify(a) === stableStringify(b)
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
const withDefined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>

/*
 * What the codec accepts (codec.ts, validateEvent), checked before an event is shown. An event the codec refuses is
 * folded into the view now and dropped at the outbox recovery on reload, so the learner would see an attempt vanish.
 * These mirror the codec's rules instead of importing it, which would put the codec in every page's first load.
 */
const isUint32 = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff
const isSha256Hex = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)
const isRunId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}$/.test(s)
const finiteOrUndefined = (n: unknown): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? n : undefined)
const nonNegative = (n: unknown): number | undefined => {
  const f = finiteOrUndefined(n)
  return f === undefined ? undefined : Math.max(0, f)
}
/** The ref grammar of the kind (refs.ts) and no `__proto__` segment, as the codec checks. */
const sendableRef = (kind: EventKind, ref: string): boolean => refMatchesKind(kind, ref) && !ref.split(/[:/#]/).includes('__proto__')

/** A v2 answer or actual the codec stores: a finite number, or at most 12 whole ids of 0 or more (codec.ts, isProveAnswer). */
const isProveAnswer = (x: unknown): x is number | number[] =>
  (typeof x === 'number' && Number.isFinite(x)) || (Array.isArray(x) && x.length <= MAX_PROVE_IDS && x.every((v) => Number.isInteger(v) && v >= 0))
/** A copy as a reload reads it back: JSON has no -0. */
const asStored = (a: number | number[]): number | number[] => (typeof a === 'number' ? a + 0 : a.map((v) => v + 0))
const sameProveAnswer = (a: number | number[], b: number | number[] | null): boolean =>
  b !== null && (typeof a === 'number' || typeof b === 'number' ? a === b : a.length === b.length && a.every((v, i) => v === b[i]))

/**
 * ProveData the codec takes, or null when it cannot be made so without changing what the learner said. A v2 answer is the
 * learner's prediction and is never cut; an actual outside the codec's shape is an unreadable reply (null), as
 * prove2.ts grades it; KCs are cut to 6 and `calls` held to 1-12. A v1 payload is kept as it is when the codec takes it.
 */
function proveData(d: ProveData): ProveData | null {
  const x = d as unknown as Record<string, unknown>
  if (!isRec(x)) return null
  if (x.v === 2) {
    const { qid, kcs, answer, actual, calls } = x
    if (typeof qid !== 'string' || qid.length === 0 || qid.length > MAX_QID_LENGTH || !isProveAnswer(answer) || typeof calls !== 'number' || !Number.isFinite(calls)) return null
    return {
      v: 2,
      qid,
      kcs: (Array.isArray(kcs) ? kcs.filter((k): k is string => typeof k === 'string') : []).slice(0, MAX_KCS),
      answer: asStored(answer),
      actual: isProveAnswer(actual) ? asStored(actual) : null,
      calls: Math.min(MAX_PROVE_CALLS, Math.max(1, Math.round(calls))),
      ...(x.return === true ? { return: true as const } : {}),
    }
  }
  if (x.v !== 1 && x.v !== undefined) return null
  const { qids, self } = x
  const fine = Array.isArray(qids) && qids.every((q) => typeof q === 'string') && Array.isArray(self) && self.length === qids.length && self.every((n) => finiteOrUndefined(n) !== undefined)
  return fine ? d : null
}

/**
 * A Fleet Week act's data held to what the codec bounds (wave-3.md §3.2): receipt counts whole and at least 0, rubric
 * scores whole within 0-3, at most 20 receipt ids of 8 hex digits. A part that cannot be read as its shape is left
 * out, so the act is kept; every other key passes through, as the codec keeps it.
 */
function fleetActData(d: JsonObject | FleetActData | undefined): JsonObject | undefined {
  if (d === undefined) return undefined
  const json = toJson(d)
  if (!isRec(json)) return undefined
  const { receipts, rubric, runs, ...rest } = json
  const out: Record<string, Json> = rest as Record<string, Json>
  const whole = (n: unknown, max = Infinity): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : null)
  if (isRec(receipts)) {
    const [cited, verified, uncited] = [whole(receipts.cited), whole(receipts.verified), whole(receipts.uncited)]
    if (cited !== null && verified !== null && uncited !== null) out.receipts = { ...(receipts as JsonObject), cited, verified, uncited }
  }
  if (isRec(rubric)) {
    const scores = RUBRIC_KEYS.map((k) => whole(rubric[k], 3))
    if (scores.every((n) => n !== null)) out.rubric = { ...(rubric as JsonObject), ...Object.fromEntries(RUBRIC_KEYS.map((k, i) => [k, scores[i] as number])) }
  }
  if (Array.isArray(runs)) out.runs = runs.filter(isRunId).slice(0, MAX_ACT_RUNS)
  return out
}

/** The aggregates of the Wave 0b, Wave 1 and Wave 2 snapshots, which `upgradeAggregate` carries forward (wave-3.md §3.1). */
const V1_AGGREGATE = 1
const V2_AGGREGATE = 2
const V3_AGGREGATE = 3

function isAggregate(a: unknown): a is Aggregate | AggregateV3 | AggregateV2 | AggregateV1 {
  if (!isRec(a) || (a.v !== AGGREGATE_VERSION && a.v !== V3_AGGREGATE && a.v !== V2_AGGREGATE && a.v !== V1_AGGREGATE) || typeof a.events !== 'number') return false
  const maps = ['lessons', 'sims', 'labs', 'facts', 'days', 'achievements', 'acks', 'completions']
  if (a.v !== V1_AGGREGATE) maps.push('plays', 'proves', 'itemSec')
  if (a.v === AGGREGATE_VERSION || a.v === V3_AGGREGATE) maps.push('incidents', 'dailyDays', 'fleetRuns')
  if (a.v === AGGREGATE_VERSION) maps.push('proved', 'labFleetOk')
  for (const key of maps) {
    if (!isRec(a[key])) return false
  }
  if (a.v !== V1_AGGREGATE) {
    if (!Object.values(a.sims as object).every((x) => isRec(x) && isRec(x.outcomes))) return false
    if (!Object.values(a.labs as object).every((x) => isRec(x) && isRec(x.unseen))) return false
  }
  const fw = a.fleetWeek
  const cap = a.capstone
  return isRec(fw) && isRec(fw.acts) && isRec(fw.scores) && isRec(cap) && isRec(cap.steps) && typeof cap.step === 'number'
}

const isWorkingShape = (w: unknown): w is WorkingRecord =>
  isRec(w) && typeof w.key === 'string' && 'value' in w && typeof w.at === 'string' && typeof w.dev === 'string'

/**
 * §8.2 steps 1 and 3: the snapshot, or an empty ledger. A corrupt or foreign-format snapshot is ignored (§9.8).
 * A version-1, -2 or -3 aggregate (Wave 0b, Wave 1, Wave 2) is upgraded in place rather than discarded, so the first paint
 * after a deploy shows the old numbers; `upgraded` tells the store to boot the engine now (wave-2.md §3.1).
 */
function hydrate(storage: FacadeEnv['storage']): {
  aggregate: Aggregate
  working: WorkingRecord[]
  readOnly?: ReadOnlyReason
  upgraded?: boolean
} {
  const empty = { aggregate: emptyAggregate(), working: [] as WorkingRecord[] }
  let raw: string | null = null
  try {
    raw = storage ? storage.getItem(SNAPSHOT_KEY) : null
  } catch {
    // blocked storage: start empty
  }
  if (raw === null) return empty
  try {
    const snap = JSON.parse(raw) as Partial<SnapshotV2>
    const readOnly = checkSnapshot(SCHEMA_VERSION, snap) ?? undefined
    const stored: unknown = snap.aggregate
    if (!isAggregate(stored) || !Array.isArray(snap.working) || (snap.aggregateVersion as unknown) !== stored.v) {
      return readOnly ? { ...empty, readOnly } : empty
    }
    const working = snap.working.filter(isWorkingShape)
    const upgraded = stored.v !== AGGREGATE_VERSION
    const aggregate = stored.v === AGGREGATE_VERSION ? stored : upgradeAggregate(stored)
    toProgressData(aggregate, workingMap(working)) // throws on a malformed aggregate: fall through to empty
    return { aggregate, working, readOnly, upgraded }
  } catch {
    return empty
  }
}

/** Export v3 only (Addendum A1): the marker, the version and the two lists. */
function looksLikeExportV3(json: string): boolean {
  try {
    const d: unknown = JSON.parse(json)
    return isRec(d) && d.format === EXPORT_FORMAT && d.version === 3 && Array.isArray(d.events) && Array.isArray(d.working)
  } catch {
    return false
  }
}

function idleBoot(run: () => void): void {
  if (typeof window === 'undefined') return
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 2000 })
  else setTimeout(run, 0)
}

declare global {
  interface Window {
    /** Dev builds only (spec §7): runs the store conformance suite on this browser's IndexedDB. */
    __ledgerSelfTest?: () => Promise<unknown>
  }
}

export function createProgressStore(env: FacadeEnv, options: FacadeOptions = {}): ProgressStore {
  const { storage, clock, newId, tabId } = env
  const device = loadDeviceId(storage, newId)

  /* ---- hydrate (§8.2) ---- */
  const hydrated = hydrate(storage)
  let agg: Aggregate = hydrated.aggregate
  const workingRecs = new Map<WorkingKey, WorkingRecord>(hydrated.working.map((w) => [w.key, w]))
  /** Set by the schema guard (§8.7): the snapshot or the engine says a newer bundle owns the data. */
  let readOnlyReason: ReadOnlyReason | undefined = hydrated.readOnly
  let ledgerStatus: LedgerStatus = {
    ready: false,
    readOnly: readOnlyReason !== undefined,
    backend: 'snapshot-only',
    ...(readOnlyReason ? { reason: readOnlyReason } : {}),
  }

  /* ---- engine glue ---- */
  let engine: LedgerEngine | null = null
  let booting: Promise<void> | null = null
  let offAggregate: (() => void) | null = null
  /** Written locally before the engine existed; delivered to it when it loads. */
  const unconfirmed = new Map<string, LedgerEvent>()
  const unconfirmedWorking = new Map<WorkingKey, WorkingRecord>()
  const inflight = new Set<Promise<unknown>>()
  /** Scroll and typing writes whose state is applied but whose commit is still waiting (§5). */
  const deferred = new Map<WorkingKey, { rec: WorkingRecord; timer: ReturnType<typeof setTimeout> }>()

  let setState: (patch: Partial<ProgressState>) => void = () => {}
  let getState: () => ProgressState = () => {
    throw new Error('progress store is not initialised')
  }

  const track = (p: Promise<unknown>): void => {
    inflight.add(p)
    void p.catch(() => undefined).finally(() => inflight.delete(p))
  }

  /* ---- view ---- */
  const workingValues = () => workingMap(workingRecs.values())

  /** Recompute the consumer view and set only what changed, keeping untouched references stable. */
  function publish(): void {
    const working = workingValues()
    const data = toProgressData(agg, working)
    const cur = getState() as unknown as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    const consider = (key: string, value: unknown) => {
      const v = reuse(cur[key], value)
      if (v !== cur[key]) patch[key] = v
    }
    for (const key of DATA_KEYS) consider(key, data[key])
    consider('aggregate', agg)
    consider('acks', agg.acks)
    consider('completions', agg.completions)
    consider('working', working)
    consider('ledger', ledgerStatus)
    if (Object.keys(patch).length > 0) setState(patch as Partial<ProgressState>)
  }

  /* ---- snapshot (§8.5 step 4) ---- */
  let snapTimer: ReturnType<typeof setTimeout> | null = null
  let lastSnapshot = ''

  function writeSnapshot(): void {
    if (snapTimer !== null) clearTimeout(snapTimer)
    snapTimer = null
    if (!storage || readOnlyReason) return
    const working = [...workingRecs.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    const content = stableStringify({ aggregate: agg, working })
    if (content === lastSnapshot) return
    try {
      const raw = storage.getItem(SNAPSHOT_KEY)
      if (raw !== null) {
        const stored = JSON.parse(raw) as Partial<SnapshotV2>
        // I6: never overwrite a newer bundle's snapshot.
        const newer = checkSnapshot(SCHEMA_VERSION, stored)
        if (newer) {
          enterReadOnly(newer)
          return
        }
        // Another tab already wrote this exact content: skip, which also ends any storage-event echo.
        if (stableStringify({ aggregate: stored.aggregate, working: stored.working }) === content) {
          lastSnapshot = content
          return
        }
      }
      const snapshot: SnapshotV2 = {
        schemaVersion: SCHEMA_VERSION,
        aggregateVersion: AGGREGATE_VERSION,
        writtenAt: clock.nowIso(),
        tab: tabId,
        aggregate: agg,
        working,
      }
      storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
      lastSnapshot = content
    } catch {
      // quota or blocked: the next boot derives from IndexedDB instead (§9.8)
    }
  }

  function scheduleSnapshot(): void {
    if (!storage || readOnlyReason || snapTimer !== null) return
    snapTimer = setTimeout(writeSnapshot, options.snapshotDelayMs ?? SNAPSHOT_DELAY_MS)
  }

  /* ---- read-only (§8.7) ---- */
  function enterReadOnly(reason: ReadOnlyReason): void {
    readOnlyReason ??= reason
    ledgerStatus = { ...ledgerStatus, readOnly: true, reason: readOnlyReason }
    for (const [key, d] of deferred) {
      clearTimeout(d.timer)
      deferred.delete(key)
    }
    publish()
  }

  /* ---- engine ---- */
  function onEngineAggregate(next: Aggregate, working: WorkingRecord[], st: LedgerStatus): void {
    if (st.readOnly) {
      // A newer bundle owns the data: show the banner, keep what the snapshot gave us, write nothing.
      ledgerStatus = { ...st }
      enterReadOnly(st.reason ?? 'newer-schema')
      return
    }
    ledgerStatus = readOnlyReason ? { ...st, readOnly: true, reason: readOnlyReason } : { ...st }
    agg = next
    workingRecs.clear()
    for (const w of working) workingRecs.set(w.key, w)
    // Deferred writes are newer than anything the engine has seen.
    for (const { rec } of deferred.values()) {
      const prev = workingRecs.get(rec.key)
      workingRecs.set(rec.key, prev ? lwwWorking(prev, rec) : rec)
    }
    publish()
    scheduleSnapshot()
  }

  function bootEngine(): Promise<void> {
    booting ??= env
      .loadEngine()
      .then(async (eng) => {
        // Deliver what was written while it loaded, then subscribe; nothing awaits between the last check and `engine = eng`.
        for (;;) {
          const evs = [...unconfirmed.values()]
          const ws = [...unconfirmedWorking.values()]
          if (evs.length === 0 && ws.length === 0) break
          unconfirmed.clear()
          unconfirmedWorking.clear()
          await eng.append(evs, ws)
        }
        engine = eng
        offAggregate = eng.onAggregate(onEngineAggregate)
      })
      .catch(() => {
        booting = null // the engine could not load (offline chunk fetch); the next write retries, and the outbox keeps the data
      })
    return booting
  }

  function toEngine(evs: LedgerEvent[], ws: WorkingRecord[]): void {
    if (engine) {
      track(engine.append(evs, ws))
      return
    }
    for (const e of evs) unconfirmed.set(e.id, e)
    for (const w of ws) unconfirmedWorking.set(w.key, w)
    void bootEngine()
  }

  /* ---- write path (§8.5) ---- */
  function applyLocal(evs: LedgerEvent[], ws: WorkingRecord[]): void {
    if (evs.length > 0) {
      const next = structuredClone(agg)
      for (const e of evs) foldInto(next, e)
      agg = next
    }
    for (const w of ws) workingRecs.set(w.key, w)
    publish()
  }

  /** Outbox first (I9), then the synchronous fold, the snapshot timer and the engine. */
  function record(evs: LedgerEvent[], ws: WorkingRecord[]): void {
    if (readOnlyReason || (evs.length === 0 && ws.length === 0)) return
    appendToOutbox(storage, tabId, evs, ws, clock.nowIso())
    applyLocal(evs, ws)
    scheduleSnapshot()
    toEngine(evs, ws)
  }

  function flushDeferred(only?: WorkingKey): void {
    const recs: WorkingRecord[] = []
    for (const [key, d] of [...deferred]) {
      if (only !== undefined && key !== only) continue
      clearTimeout(d.timer)
      deferred.delete(key)
      recs.push(d.rec)
    }
    if (recs.length === 0 || readOnlyReason) return
    appendToOutbox(storage, tabId, [], recs, clock.nowIso())
    toEngine([], recs) // the state already shows them
  }

  function deferWrite(rec: WorkingRecord, delay: number): void {
    applyLocal([], [rec])
    scheduleSnapshot()
    const prev = deferred.get(rec.key)
    if (prev) clearTimeout(prev.timer)
    deferred.set(rec.key, { rec, timer: setTimeout(() => flushDeferred(rec.key), delay) })
  }

  /* ---- event construction ---- */
  const stamp = () => {
    const at = clock.nowIso()
    const tz = clock.tzOffsetMinutes(at)
    return { at, tz, day: dayOf(at, tz) }
  }
  type Stamp = ReturnType<typeof stamp>

  const ev = (s: Stamp, kind: EventKind, ref: string, extra: object = {}): LedgerEvent =>
    ({ id: newId(), v: 1, kind, ref, at: s.at, tz: s.tz, day: s.day, dev: device, ...extra }) as unknown as LedgerEvent

  const graded = (score: number, ok: boolean, provenance: Provenance, extra: object = {}) => ({
    score,
    ok,
    provenance,
    ...extra,
  })

  function writeWorking(entries: [WorkingKey, Json][]): void {
    if (readOnlyReason) return
    const s = stamp()
    const now: WorkingRecord[] = []
    for (const [key, value] of entries) {
      if (sameValue(workingRecs.get(key)?.value, value)) continue
      const rec: WorkingRecord = { key, value, at: s.at, dev: device }
      const delay = workingDelay(key)
      if (delay === 0) now.push(rec)
      else deferWrite(rec, delay)
    }
    record([], now)
  }

  /**
   * One visit per lesson per local day (§8.3), except that the first visit after `complete placement` is always
   * written: F3 reads the landing from the first visit after the placement, and a lesson the learner had already
   * touched that day (R.L1, say) would otherwise leave none.
   */
  function visitLesson(lessonId: string): void {
    const s = stamp()
    const lastAt = getOwn(agg.lessons, lessonId)?.lastAt
    const placedAt = workingRecs.get('placement:result')?.at
    const sinceThen = placedAt === undefined || (lastAt !== undefined && lastAt >= placedAt)
    if (lastAt !== undefined && sinceThen && dayOf(lastAt, clock.tzOffsetMinutes(lastAt)) === s.day) return
    record([ev(s, 'visit', `lesson:${lessonId}`)], [])
  }

  const currentWorking = (key: WorkingKey): Json | undefined => workingRecs.get(key)?.value

  /** The slot map as the working record holds it (a malformed value reads as empty). */
  const currentSlots = (): EngineSlots => {
    const v = currentWorking('engine:slots')
    return isRec(v) ? ({ ...v } as EngineSlots) : {}
  }

  /** One `lab-check` event: `ok` is cumulative, so a lab stays done once every check has passed in some run. */
  function writeLabRun(labId: string, passed: string[], total: number, provenance: Provenance, extra: object, data: object): void {
    const prev = getOwn(agg.labs, labId)
    const checks = new Set([...Object.keys(prev?.checks ?? {}), ...passed])
    const done = (total > 0 && checks.size >= total) || !!prev?.done
    const score = total > 0 ? clamp01(passed.length / total) : 0
    record([ev(stamp(), 'lab-check', `lab:${labId}`, { ...graded(score, done, provenance, extra), data })], [])
  }

  /* ---- actions ---- */
  const actions: Actions = {
    markLessonStatus: (lessonId, status) => {
      if (status === 'done') {
        const L = getOwn(agg.lessons, lessonId)
        if (L?.done || L?.passedAt !== undefined) return
        record([ev(stamp(), 'complete', `lesson:${lessonId}`)], []) // no `via`: reads as `read` until a pass (spec §8.7)
      } else if (status === 'read') {
        actions.completeLesson(lessonId, 'read')
      } else if (status === 'reading') {
        visitLesson(lessonId)
      } // 'unstarted': status never goes backwards
    },

    setLessonScroll: (lessonId, scrollPct) => {
      if (!getOwn(agg.lessons, lessonId)) return // as before: only a lesson that already has a record
      writeWorking([[`scroll:${lessonId}`, scrollPct]])
    },

    recordQuizScore: (lessonId, score) => {
      if (!Number.isFinite(score)) return
      const clamped = clamp01(score)
      record([ev(stamp(), 'quiz', `lesson:${lessonId}`, graded(clamped, clamped >= QUIZ_PASS_SCORE, 'practice'))], [])
    },

    markExerciseDone: (lessonId) => {
      if (getOwn(agg.lessons, lessonId)?.exercise) return
      record([ev(stamp(), 'exercise', `lesson:${lessonId}`)], [])
    },

    recordSimVisit: (simId) => record([ev(stamp(), 'visit', `sim:${simId}`)], []),

    recordSimTask: (simId, taskId) => {
      const sim = getOwn(agg.sims, simId)
      if (sim && getOwn(sim.tasks, taskId)) return
      record([ev(stamp(), 'sim-task', `sim:${simId}/${taskId}`, graded(1, true, 'practice'))], [])
    },

    setSimConfig: (simId, config) => {
      const value = toJson(config)
      if (value !== undefined) writeWorking([[`sim-config:${simId}`, value]])
    },

    recordLabResult: (labId, passedCheckIds, totalChecks, meta) => {
      const extra = withDefined({ wasmSha256: meta?.wasmSha256, seed: meta?.seed })
      writeLabRun(labId, passedCheckIds, totalChecks, meta?.provenance ?? 'lab-green', extra, { passed: [...passedCheckIds], total: totalChecks })
    },

    completeFleetWeekAct: (actId, score, meta) => {
      const ref = `fw:${actId}`
      if (!Number.isFinite(score) || !sendableRef('fleet-act', ref)) return
      const s = stamp()
      // Held to what the codec accepts, so the act is never shown and then dropped at the flush (more than 20 runs, say).
      // `ms` is the time spent on the act (wave-3.md §15.1): the codec takes a finite one of 0 or more.
      const extra = withDefined({ seed: isUint32(meta?.seed) ? meta.seed : undefined, ms: nonNegative(meta?.ms), data: fleetActData(meta?.data) })
      const provenance = meta?.provenance === 'unseen' ? 'unseen' : 'practice'
      const evs = [ev(s, 'fleet-act', ref, graded(clamp01(score), true, provenance, extra))]
      const acts = new Set([...Object.keys(agg.fleetWeek.acts), actId])
      if (acts.size >= 4 && getOwn(agg.achievements, 'fleet-week') === undefined) {
        evs.push(ev(s, 'achievement', 'ach:fleet-week'))
      }
      record(evs, [])
    },

    setFleetWeekDoc: (text) => writeWorking([['fw:doc', text]]),

    setFleetWeekEvidence: (actId, patch) => {
      const current = currentWorking(`fw:evidence:${actId}`)
      const merged = toJson({ ...(isRec(current) ? current : {}), ...patch })
      if (merged !== undefined) writeWorking([[`fw:evidence:${actId}`, merged]])
    },

    completeCapstoneStep: (stepId, stepIndex) => {
      if (getOwn(agg.capstone.steps, stepId)) return
      record(
        [ev(stamp(), 'capstone-step', `cap:${stepId}`, { ...graded(1, true, 'practice'), data: { index: stepIndex } })],
        [],
      )
    },

    setCapstoneMetrics: (metrics) => {
      const value = toJson(metrics)
      if (value !== undefined) writeWorking([['capstone:metrics', value]])
    },

    unlockAchievement: (id) => {
      if (getOwn(agg.achievements, id) !== undefined) return
      record([ev(stamp(), 'achievement', `ach:${id}`)], [])
    },

    updateSettings: (patch) => {
      const entries: [WorkingKey, Json][] = []
      for (const [field, value] of Object.entries(patch)) {
        const json = value === undefined ? undefined : toJson(value)
        if (json !== undefined) entries.push([`settings:${field}` as WorkingKey, json])
      }
      writeWorking(entries)
    },

    importProgress: (json) => {
      if (readOnlyReason) return false
      // Shape-check here so the caller gets its answer now. The engine validates every record before it
      // applies a replace with an undo checkpoint (§8.3, §10.4), which keeps the codec out of the entry chunk.
      if (!looksLikeExportV3(json)) return false
      track(bootEngine().then(() => engine?.importFile(json, 'replace')))
      return true
    },

    resetProgress: () => {
      if (readOnlyReason) return
      // Drop this tab's unsent writes first: the engine's reset clears the store, snapshot and outboxes behind them.
      for (const d of deferred.values()) clearTimeout(d.timer)
      deferred.clear()
      unconfirmed.clear()
      unconfirmedWorking.clear()
      try {
        storage?.removeItem(outboxKey(tabId))
      } catch {
        // blocked storage
      }
      agg = emptyAggregate()
      workingRecs.clear()
      publish()
      scheduleSnapshot()
      track(bootEngine().then(() => engine?.reset()))
    },

    /* additive actions (§8.4) */

    recordQuizAttempt: (attempt: QuizAttempt) => {
      const n = attempt.responses.length
      if (n === 0) return
      const s = stamp()
      const grp = newId()
      const correct = attempt.responses.filter((r) => r.ok).length
      const score = correct / n
      // Each answer says its place in the attempt (`slot` of `of`, as a ticket's do) and, on a miss, the picked lure's
      // misconception id (`miss`, as Today's quiz items carry it), which P3's confusion share reads (selectDiscrimination30).
      const evs = attempt.responses.map((r, i) =>
        ev(s, 'item', `quiz:${attempt.lessonId}#${r.qi}`, {
          ...graded(r.ok ? 1 : 0, r.ok, 'practice', withDefined({ conf: r.conf, seed: attempt.seed })),
          rev: r.rev,
          data: {
            src: 'quiz',
            pick: r.pick,
            grp,
            slot: i,
            of: n,
            lessonId: attempt.lessonId,
            ...(r.kcs ? { kcs: r.kcs.slice(0, MAX_KCS) } : {}),
            ...(!r.ok && typeof r.miss === 'string' && r.miss !== '' ? { miss: r.miss } : {}),
          },
        }),
      )
      evs.push(
        ev(s, 'quiz', `lesson:${attempt.lessonId}`, {
          ...graded(score, score >= QUIZ_PASS_SCORE, 'practice', withDefined({ seed: attempt.seed, ms: attempt.ms })),
          data: { grp, n },
        }),
      )
      record(evs, [])
    },

    recordItems: (items: ItemResponse[]) => {
      const s = stamp()
      record(
        items.map((it) =>
          ev(s, it.kind, it.ref, {
            ...graded(clamp01(it.score), it.ok, it.provenance ?? 'practice', withDefined({ conf: it.conf, seed: it.seed, ms: it.ms })),
            rev: it.rev,
            data: it.data,
          }),
        ),
        [],
      )
    },

    acknowledge: (ref: AckRef, data?: JsonObject) => {
      if (getOwn(agg.acks, ref) !== undefined) return
      record([ev(stamp(), 'ack', ref, data ? { data } : {})], [])
    },

    completeRef: (ref: BootRef, data?: JsonObject) => record([ev(stamp(), 'complete', ref, data ? { data } : {})], []),

    recordVisit: (ref: LessonRef | SimRef | BootRef) => {
      if (ref.startsWith('lesson:')) visitLesson(ref.slice('lesson:'.length))
      else record([ev(stamp(), 'visit', ref)], [])
    },

    // `fw:runs` keeps the newest 50 (wave-3.md §3.5): the oldest drop, so the codec never refuses the list at the flush.
    setWorking: (key: WorkingKey, value: Json) => writeWorking([[key, key === 'fw:runs' && Array.isArray(value) ? value.slice(-MAX_RUN_RECORDS) : value]]),

    // A delete, not a write (D50): the record goes from memory, the snapshot, every outbox and the store (the engine tells
    // other tabs). The tombstone left in this tab's outbox makes the clear durable before the store's delete commits.
    clearWorking: (key: WorkingKey) => {
      if (readOnlyReason) return
      const held = workingRecs.get(key)
      const waiting = deferred.get(key)
      if (waiting) clearTimeout(waiting.timer)
      deferred.delete(key)
      unconfirmedWorking.delete(key)
      if (!held && !waiting) return
      workingRecs.delete(key)
      // Never before the record it clears, so a clock that stepped back cannot leave the record standing.
      const now = clock.nowIso()
      clearInOutboxes(storage, tabId, key, held && held.at > now ? held.at : now)
      publish()
      scheduleSnapshot()
      track(bootEngine().then(() => engine?.deleteWorking([key])))
    },

    /* Wave 1 actions (wave-1.md §3.3) */

    recordTicket: (a: TicketAttempt) => {
      const n = a.responses.length
      if (n === 0) return
      const s = stamp()
      const grp = newId()
      const src = a.form === 'testout' ? 'testout' : 'ticket'
      const evs = a.responses.map((r, i) => {
        const kcs = r.data.kcs?.slice(0, MAX_KCS)
        return ev(s, 'item', r.ref, {
          ...graded(clamp01(r.score), r.ok, r.provenance ?? 'practice', withDefined({ conf: r.conf, seed: r.seed, ms: r.ms })),
          rev: r.rev,
          data: { slot: i, of: n, lessonId: a.lessonId, ...r.data, ...(kcs ? { kcs } : {}), src, form: a.form, grp },
        })
      })
      const kcs = [...new Set(a.responses.flatMap((r) => r.data.kcs ?? []))].sort()
      const correct = a.responses.filter((r) => r.ok).length
      evs.push(
        ev(s, 'quiz', `lesson:${a.lessonId}`, {
          ...graded(correct / n, a.ok, 'practice', withDefined({ seed: a.seed, ms: a.ms })),
          data: { grp, n, form: a.form, nonMcqOk: a.nonMcqOk, kcs },
        }),
      )
      // A pass completes the lesson (done); a miss writes only evidence, and "continue anyway" is completeLesson.
      if (a.ok) evs.push(ev(s, 'complete', `lesson:${a.lessonId}`, { data: { via: a.form === 'testout' ? 'testout' : 'ticket', grp } }))
      record(evs, [])
    },

    completeLesson: (lessonId, via) => {
      const L = getOwn(agg.lessons, lessonId)
      if (L?.read || L?.passedAt !== undefined) return
      record([ev(stamp(), 'complete', `lesson:${lessonId}`, { data: { via } })], [])
    },

    recordSimOutcome: (simId: string, o: SimOutcome) => {
      const sim = getOwn(agg.sims, simId)
      if (sim && getOwn(sim.outcomes, o.taskId)) return // an ok outcome already counts; later runs are not evidence of more
      record(
        [ev(stamp(), 'sim-task', `sim:${simId}/${o.taskId}`, { ...graded(clamp01(o.score), o.ok, 'practice', withDefined({ conf: o.conf, ms: o.ms })), data: o.data })],
        [],
      )
    },

    recordLabRun: (r: LabRunV2) => {
      const extra = withDefined({ wasmSha256: r.wasmSha256, ms: r.ms })
      const data = withDefined({ passed: [...r.passed], total: r.total, abi: r.abi, checks: r.checks, seeds: r.seeds, stage: r.stage })
      writeLabRun(r.labId, r.passed, r.total, r.provenance, extra, data)
    },

    recordPlay: (r: PlayResult) => {
      // The metric, the levels and the EPLB dials ride along in `data`; levels are clamped to what the codec accepts.
      const data = r.data.levels ? { ...r.data, levels: r.data.levels.slice(0, MAX_PLAY_LEVELS) } : r.data
      record(
        [ev(stamp(), 'play', `play:${r.playId}`, { ...graded(clamp01(r.score), r.ok, r.provenance, withDefined({ seed: r.seed, ms: r.ms })), data })],
        [],
      )
    },

    recordProve: (r: ProveResult) => {
      // Every field is held to what the codec accepts (wave-3.md §3.2), so the attempt is never shown and then dropped at the flush.
      const ref = `prove:${r.labId}`
      const data = proveData(r.data)
      if (data === null || !sendableRef('prove', ref) || (data.v !== 2 && !Number.isFinite(r.score))) return
      // A v2 event's `ok` means right, its answer equals its actual, and it scores 1 or 0 (§3.2), whatever the caller said:
      // a miss never sets proves[lab], pays the prove:<lab> fact or earns proved.
      const ok = data.v === 2 ? sameProveAnswer(data.answer, data.actual) : r.ok === true
      const score = data.v === 2 ? (ok ? 1 : 0) : clamp01(r.score)
      // A malformed hash is left out, never sent: the codec refuses a whole event for it, even on a practice one.
      const wasmSha256 = isSha256Hex(r.wasmSha256) ? r.wasmSha256 : undefined
      // `proved` is for a Prove-it v2 that came out right on a named module; anything less is practice, which the codec would otherwise refuse.
      const proved = r.provenance === 'proved' && data.v === 2 && ok && wasmSha256 !== undefined
      const extra = withDefined({ ms: nonNegative(r.ms), wasmSha256, seed: isUint32(r.seed) ? r.seed : undefined })
      record([ev(stamp(), 'prove', ref, { ...graded(score, ok, proved ? 'proved' : 'practice', extra), data })], [])
    },

    completePlacement: (result: JsonObject) => {
      const s = stamp()
      const value = toJson(result)
      record([ev(s, 'complete', 'placement')], value === undefined ? [] : [{ key: 'placement:result', value, at: s.at, dev: device }])
    },

    /* Wave 2 actions (wave-2.md §3.3) */

    recordIncident: (r: IncidentResult) => {
      const nonNeg = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0)
      // Clamped to what the codec accepts, so a play is never lost at the outbox flush.
      const data = {
        ...r.data,
        probes: r.data.probes.slice(0, MAX_PROBES),
        components: r.data.components.slice(0, MAX_RUN_COMPONENTS),
        burn: nonNeg(r.data.burn),
        expertBurn: nonNeg(r.data.expertBurn),
        streetlight: nonNeg(r.data.streetlight),
        ...(r.data.kcs ? { kcs: r.data.kcs.slice(0, MAX_KCS) } : {}),
      }
      // A drill's seed is drawn when it starts; the Daily's and a team's are public, so those count as practice.
      const provenance = r.data.src === 'drill' ? 'unseen' : 'practice'
      record([ev(stamp(), 'incident', r.ref, { ...graded(incidentScore(data), incidentOk(data), provenance, withDefined({ seed: r.seed >>> 0, ms: r.ms })), data })], [])
    },

    recordFleetRun: (r: FleetRunResult) => {
      if (r.data.components.length === 0) return // only a run with an own component is evidence of the learner's work
      const data = { ...r.data, components: r.data.components.slice(0, MAX_RUN_COMPONENTS) }
      const provenance = data.seeds === 'fresh' ? 'unseen' : 'practice'
      const seed = r.seed === undefined ? undefined : r.seed >>> 0
      record([ev(stamp(), 'fleet-run', `fleet:${data.mode}`, { ...graded(fleetRunScore(data), fleetRunOk(data), provenance, withDefined({ seed, ms: r.ms })), data })], [])
    },

    installComponent: (c: ComponentInstall) => {
      const install = async (): Promise<{ sha256: string }> => {
        if (readOnlyReason) throw new Error('the ledger is read-only')
        const bytes = c.bytes instanceof Uint8Array ? c.bytes.slice().buffer : c.bytes
        const sha256 = await sha256Hex(bytes)
        if (currentSlots()[c.slot]?.sha256 === sha256) return { sha256 }
        await bootEngine()
        if (!engine) throw new Error('the ledger engine could not load')
        const at = clock.nowIso()
        await engine.putComponent({ sha256, labId: c.labId, size: bytes.byteLength, addedAt: at, bytes, ...withDefined({ name: c.name, abi: c.abi }) })
        const entry: EngineSlotEntry = { sha256, labId: c.labId, version: Math.max(1, Math.round(c.version)), at }
        const value = toJson({ ...currentSlots(), [c.slot]: entry })
        if (value !== undefined) writeWorking([['engine:slots', value]])
        return { sha256 }
      }
      const done = install()
      track(done) // `flush` waits for the bytes and the slot record
      return done
    },

    removeComponent: (slot: EngineSlot) => {
      const slots = currentSlots()
      if (slots[slot] === undefined) return
      delete slots[slot]
      const value = toJson(slots)
      if (value !== undefined) writeWorking([['engine:slots', value]])
    },

    recordHelp: (ref: PacketRef, data: HelpAckData) => {
      const chars = Number.isFinite(data.chars) ? Math.min(MAX_PACKET_CHARS, Math.max(0, Math.round(data.chars))) : 0
      record([ev(stamp(), 'ack', ref, { data: { ...data, chars } })], [])
    },
  }

  /* ---- create the store ---- */
  const initialData = toProgressData(agg, workingValues())
  const store = create<ProgressState>()((set, get) => {
    setState = set
    getState = get
    return {
      ...initialData,
      ledger: ledgerStatus,
      aggregate: agg,
      acks: agg.acks,
      completions: agg.completions,
      working: workingValues(),
      ...actions,
    }
  })

  /* ---- lifecycle ---- */
  const onHide = () => {
    flushDeferred()
    writeSnapshot()
  }
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') onHide()
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
  }

  // §8.2 step 4: the engine starts when the browser is idle, or on the first write. A read-only snapshot needs no engine.
  // A snapshot upgraded from aggregate v1 is approximate (passed instants, new maps empty): the full derive fixes it, so do not wait for idle.
  if (!readOnlyReason) {
    if (hydrated.upgraded) void bootEngine()
    else (options.scheduleBoot ?? idleBoot)(() => void bootEngine())
  }

  const controls: ProgressControls = {
    async flush() {
      flushDeferred()
      writeSnapshot()
      if (booting) await booting
      while (inflight.size > 0) await Promise.allSettled([...inflight])
    },
    async engine() {
      await bootEngine()
      if (!engine) throw new Error('the ledger engine could not load')
      return engine
    },
    dispose() {
      if (snapTimer !== null) clearTimeout(snapTimer)
      snapTimer = null
      for (const d of deferred.values()) clearTimeout(d.timer)
      deferred.clear()
      offAggregate?.()
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onHide)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    },
  }
  return Object.assign(store, { controls })
}

export const useProgress = createProgressStore(browserEnv())
onLedgerClientRequest(() => useProgress.controls.engine())

if (import.meta.env?.DEV && typeof window !== 'undefined') {
  window.__ledgerSelfTest = () => import('./ledger/idb-store').then((m) => m.selfTestIdb())
}

/* ---------------- Derived selectors (design.md §10) ---------------- */

export const selectDoneLessons = (s: ProgressState) =>
  Object.values(s.lessons).filter((l) => l.status === 'done').length

export const selectOverallPct = (s: ProgressState) =>
  Math.round((selectDoneLessons(s) / TOTAL_LESSONS) * 100)

/** Per-track completion % — lessonIds are prefixed `${trackId}.` (e.g. `t0.l2`). */
export function selectTrackPct(trackId: string, lessonCount: number) {
  return (s: ProgressState) => {
    if (lessonCount <= 0) return 0
    const done = Object.entries(s.lessons).filter(
      ([id, l]) => id.startsWith(`${trackId}.`) && l.status === 'done',
    ).length
    return Math.round((done / lessonCount) * 100)
  }
}

export function selectTrackDone(trackId: string) {
  return (s: ProgressState) =>
    Object.entries(s.lessons).filter(([id, l]) => id.startsWith(`${trackId}.`) && l.status === 'done')
      .length
}

/** Current streak length in consecutive days ending today/yesterday. */
export function selectStreak(s: ProgressState): number {
  if (s.streakDays.length === 0) return 0
  const days = new Set(s.streakDays)
  let streak = 0
  const cursor = new Date()
  if (!days.has(localDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1) // allow streak to end yesterday
  }
  while (days.has(localDateKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** Activity heatmap data: date → lesson completions (from streakDays + completedAt). */
export function selectActivityMap(s: ProgressState): Record<string, number> {
  const map: Record<string, number> = {}
  for (const l of Object.values(s.lessons)) {
    if (l.completedAt) {
      const day = localDateKey(new Date(l.completedAt))
      map[day] = (map[day] ?? 0) + 1
    }
  }
  return map
}

/**
 * Deprecated, kept for compatibility (spec §8.1): the v2-shaped JSON of the current data. It is not an
 * export v3 file, so `importProgress` refuses it; L4 moves /progress to `getLedgerClient().exportV3()`.
 */
export function exportProgress(): string {
  const { lessons, sims, labs, fleetWeek, capstone, xp, streakDays, achievements, settings } =
    useProgress.getState()
  return JSON.stringify(
    { version: 2, lessons, sims, labs, fleetWeek, capstone, xp, streakDays, achievements, settings },
    null,
    2,
  )
}

// Convenience non-hook getter for one-off reads outside React.
export const getProgress = () => useProgress.getState()
