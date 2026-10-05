import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import { AGGREGATE_VERSION, EXPORT_FORMAT, QUIZ_PASS_SCORE, SCHEMA_VERSION } from './ledger/constants'
import { browserEnv, loadDeviceId, onLedgerClientRequest } from './ledger/client'
import { emptyAggregate, foldInto, upgradeAggregate } from './ledger/fold'
import { checkSnapshot } from './ledger/guard'
import { lwwWorking } from './ledger/merge'
import { SNAPSHOT_KEY } from './ledger/names'
import { appendToOutbox, outboxKey } from './ledger/outbox'
import { getOwn, setOwn, stableStringify } from './ledger/stable'
import { dayOf } from './ledger/time'
import { toProgressData, workingMap } from './ledger/view'
import type {
  Aggregate,
  AggregateV1,
  AckRef,
  BootRef,
  EventKind,
  FacadeEnv,
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
  PlayResult,
  Provenance,
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
  completeFleetWeekAct: (actId: string, score: number) => void
  setFleetWeekDoc: (text: string) => void
  setFleetWeekEvidence: (
    actId: string,
    patch: { analysis?: string; screenshotName?: string; screenshotBytes?: number; attempted?: string[]; credited?: string[] },
  ) => void
  completeCapstoneStep: (stepId: string, stepIndex: number) => void
  setCapstoneMetrics: (metrics: CapstoneMetrics) => void
  unlockAchievement: (id: string) => void
  updateSettings: (patch: Partial<ProgressSettings>) => void
  importProgress: (json: string) => boolean
  resetProgress: () => void
}

// The economy lives in economy.ts so the pure ledger core can use it without zustand.
export { XP, RANKS, rankForXp, nextRank, localDateKey } from './economy'
export type { Rank } from './economy'

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

/** The aggregate of the Wave 0b snapshot, which `upgradeAggregate` carries forward (spec §3.1). */
const V1_AGGREGATE = 1

function isAggregate(a: unknown): a is Aggregate | AggregateV1 {
  if (!isRec(a) || (a.v !== AGGREGATE_VERSION && a.v !== V1_AGGREGATE) || typeof a.events !== 'number') return false
  const maps = ['lessons', 'sims', 'labs', 'facts', 'days', 'achievements', 'acks', 'completions']
  if (a.v === AGGREGATE_VERSION) maps.push('plays', 'proves', 'itemSec')
  for (const key of maps) {
    if (!isRec(a[key])) return false
  }
  if (a.v === AGGREGATE_VERSION) {
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
 * A version-1 aggregate (Wave 0b) is upgraded in place rather than discarded, so the first paint after the
 * Wave 1 deploy shows the old numbers; `upgraded` tells the store to boot the engine now (wave-1.md §3.1).
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
    const upgraded = stored.v === V1_AGGREGATE
    const aggregate = stored.v === V1_AGGREGATE ? upgradeAggregate(stored) : stored
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

  /** One visit per lesson per local day (§8.3). */
  function visitLesson(lessonId: string): void {
    const s = stamp()
    const lastAt = getOwn(agg.lessons, lessonId)?.lastAt
    if (lastAt !== undefined && dayOf(lastAt, clock.tzOffsetMinutes(lastAt)) === s.day) return
    record([ev(s, 'visit', `lesson:${lessonId}`)], [])
  }

  const currentWorking = (key: WorkingKey): Json | undefined => workingRecs.get(key)?.value

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

    completeFleetWeekAct: (actId, score) => {
      if (!Number.isFinite(score)) return
      const s = stamp()
      const evs = [ev(s, 'fleet-act', `fw:${actId}`, graded(clamp01(score), true, 'practice'))]
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
      const evs = attempt.responses.map((r) =>
        ev(s, 'item', `quiz:${attempt.lessonId}#${r.qi}`, {
          ...graded(r.ok ? 1 : 0, r.ok, 'practice', withDefined({ conf: r.conf, seed: attempt.seed })),
          rev: r.rev,
          data: { src: 'quiz', pick: r.pick, grp, lessonId: attempt.lessonId, ...(r.kcs ? { kcs: r.kcs.slice(0, MAX_KCS) } : {}) },
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

    acknowledge: (ref: AckRef, data?: { via?: string }) => {
      if (getOwn(agg.acks, ref) !== undefined) return
      record([ev(stamp(), 'ack', ref, data ? { data } : {})], [])
    },

    completeRef: (ref: BootRef, data?: JsonObject) => record([ev(stamp(), 'complete', ref, data ? { data } : {})], []),

    recordVisit: (ref: LessonRef | SimRef | BootRef) => {
      if (ref.startsWith('lesson:')) visitLesson(ref.slice('lesson:'.length))
      else record([ev(stamp(), 'visit', ref)], [])
    },

    setWorking: (key: WorkingKey, value: Json) => writeWorking([[key, value]]),

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
      record(
        [ev(stamp(), 'play', `play:${r.playId}`, { ...graded(clamp01(r.score), r.ok, r.provenance, withDefined({ seed: r.seed, ms: r.ms })), data: r.data })],
        [],
      )
    },

    recordProve: (r: ProveResult) => {
      record([ev(stamp(), 'prove', `prove:${r.labId}`, { ...graded(clamp01(r.score), r.ok, 'practice', withDefined({ ms: r.ms })), data: r.data })], [])
    },

    completePlacement: (result: JsonObject) => {
      const s = stamp()
      const value = toJson(result)
      record([ev(s, 'complete', 'placement')], value === undefined ? [] : [{ key: 'placement:result', value, at: s.at, dev: device }])
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

/** First lesson in track order that is neither done nor read (resume skips read, wave-1.md §8.3) → next recommended lesson id. */
export function selectNextLesson(orderedLessonIds: string[]) {
  return (s: ProgressState) =>
    orderedLessonIds.find((id) => s.lessons[id]?.status !== 'done' && s.lessons[id]?.status !== 'read') ?? null
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
