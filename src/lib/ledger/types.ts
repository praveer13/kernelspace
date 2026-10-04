/**
 * Evidence Ledger v3: shared types (docs/specs/ledger-v3.md; PLAN-100X §5.1 V3, §7.1).
 *
 * Types only. This module emits no runtime code, so every task can import it while
 * the behaviour lands in parallel. Runtime constants (SCHEMA_VERSION, store names,
 * XP units, the confidence mapping) live in the modules the spec assigns them to.
 */

import type { QuizQuestion } from '@/components/QuizBlock'
import type { Erratum } from '@/data/errata/schema'
import type { ProgressSettings, ProgressState } from '@/lib/progress'

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** UTC instant in `Date#toISOString()` form, e.g. `2026-10-04T14:03:22.123Z`. Sorts lexically. */
export type IsoInstant = string
/** The learner's local calendar day `YYYY-MM-DD`, computed from `at` and `tz` and frozen at write time. */
export type LocalDay = string
export type EventId = string
/** Random id per browser profile (meta `device`); unique to one device's events. */
export type DeviceId = string

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

/* ------------------------------------------------------------------ */
/* Refs: what an event is about. Typed by prefix (spec §4.3).          */
/* ------------------------------------------------------------------ */

/** `lesson:t5.l4` */
export type LessonRef = `lesson:${string}`
/** A lesson checkpoint question by authored index: `quiz:t5.l4#2`. Becomes `item:<id>` once V1 ids exist. */
export type QuizItemRef = `quiz:${string}#${number}`
/** A change-card retrieval item: `card:<erratumId>#<i>`. */
export type CardItemRef = `card:${string}#${number}`
/** `boot` (the flow) or one Boot step: `boot:decode-tps`. */
export type BootRef = 'boot' | `boot:${string}`
/** `sim:<simId>` for visits, `sim:<simId>/<taskId>` for tasks. */
export type SimRef = `sim:${string}`
/** `lab:<labId>`: one lab run. */
export type LabRef = `lab:${string}`
/** `fw:<actId>` (Fleet Week act). */
export type FleetActRef = `fw:${string}`
/** `cap:<stepId>` (Capstone Zero step). */
export type CapstoneRef = `cap:${string}`
/** `ach:<achievementId>` */
export type AchievementRef = `ach:${string}`
/** `erratum:<erratumId>` (a change card was acknowledged) or `screen:<screenId>` (a one-time screen was seen). */
export type AckRef = `erratum:${string}` | `screen:${string}`
export type ItemRef = QuizItemRef | CardItemRef | BootRef

export type Ref =
  | LessonRef
  | QuizItemRef
  | CardItemRef
  | BootRef
  | SimRef
  | LabRef
  | FleetActRef
  | CapstoneRef
  | AchievementRef
  | AckRef

/* ------------------------------------------------------------------ */
/* Provenance (V6) and confidence (V2)                                 */
/* ------------------------------------------------------------------ */

/**
 * `proved` and `unseen` credit KCs at w=1.0; `lab-green`, `practice` and `assisted` at w<=0.3;
 * `field` marks field labs. Ledger v3 starts fresh (Addendum A1), so there is no `legacy` provenance.
 */
export type Provenance = 'proved' | 'unseen' | 'lab-green' | 'practice' | 'assisted' | 'field'

/** Guess / think-so / sure, on keys 1-3. Stored categorically; mapped to a probability at read time. */
export type Confidence = 'guess' | 'think' | 'sure'

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/**
 * Fields every event carries (V3: `{id, v, at, tz, day, kind, ref, rev, ...}`).
 */
interface Envelope<K extends string, R extends Ref> {
  id: EventId
  /** Event format version. Readers ignore fields they do not know; writers never drop them. */
  v: 1
  kind: K
  ref: R
  at: IsoInstant
  /** Minutes east of UTC at `at` (`-new Date(at).getTimezoneOffset()`). */
  tz: number
  /** `dayOf(at, tz)`, frozen at write time so travel never rewrites history. */
  day: LocalDay
  dev: DeviceId
  /** Content fingerprint graded against (spec §4.5). Required on item-like events, optional elsewhere. */
  rev?: string
}

/** Present on every graded kind. */
interface Graded {
  /** In [0, 1]. */
  score: number
  ok: boolean
  provenance: Provenance
  conf?: Confidence
  /** uint32 seed of a generated item or seeded run. */
  seed?: number
  /** Time on task in milliseconds. */
  ms?: number
  /** Lowercase hex SHA-256 of the learner's wasm module. */
  wasmSha256?: string
}

export interface ItemData {
  /** Surface that served the item. */
  src: 'quiz' | 'boot' | 'card' | 'cold'
  /** Chosen option(s) by AUTHORED index (MCQ). */
  pick?: number[]
  /** Numeric answer (numeric items). */
  value?: number
  /** Attempt group: responses submitted together share it (one quiz submit, one cold-check session). */
  grp?: string
  /** Owning lesson, so grouping never parses refs. */
  lessonId?: string
  /** Probes only: whole days since the learner last met this lesson; absent when unknown. */
  sinceDays?: number
}

/** One response to one item (quiz question, Boot step, change-card item). */
export interface ItemEvent extends Envelope<'item', ItemRef>, Graded {
  rev: string
  data: ItemData
}

/** A cold check (arrives with K2/K5 in Wave 1): same shape as an item, never reviewed first. */
export interface ProbeEvent extends Envelope<'probe', ItemRef>, Graded {
  rev: string
  data: ItemData
}

/** One checkpoint submission: `score` = fraction correct, `ok` = score >= 0.8. */
export interface QuizEvent extends Envelope<'quiz', LessonRef>, Graded {
  data?: { grp?: string; n?: number }
}

/** A committed numeric prediction (Boot's guess; P1 later). */
export interface PredictEvent extends Envelope<'predict', ItemRef>, Graded {
  rev: string
  data: { value: number; unit: string; truth: number; src: 'boot' | 'lesson' }
}

export interface SimTaskEvent extends Envelope<'sim-task', SimRef>, Graded {}

/**
 * One lab run (`lab:<labId>`): `passed` = required check ids that passed in this run, `total` = required
 * checks, `ok` = the lab is done after this run (cumulative, as recordLabResult computes it today).
 */
export interface LabCheckEvent extends Envelope<'lab-check', LabRef>, Graded {
  data: { passed: string[]; total?: number }
}

export interface FleetActEvent extends Envelope<'fleet-act', FleetActRef>, Graded {}

export interface CapstoneStepEvent extends Envelope<'capstone-step', CapstoneRef>, Graded {
  data?: { index?: number }
}

/** Kinds reserved for later waves (W1 play, W3 incident, W4 fleet-run, H4 prove). No writers in Wave 0b. */
export interface ReservedGradedEvent extends Envelope<'play' | 'incident' | 'fleet-run' | 'prove', Ref>, Graded {
  data?: JsonObject
}

export type VisitEvent = Envelope<'visit', LessonRef | SimRef | BootRef>

/** A lesson marked complete (the click), or a non-lesson flow finished (`boot`). Never credit. */
export interface CompleteEvent extends Envelope<'complete', LessonRef | BootRef> {
  data?: JsonObject
}

export type ExerciseEvent = Envelope<'exercise', LessonRef>

export type AchievementEvent = Envelope<'achievement', AchievementRef>

export interface AckEvent extends Envelope<'ack', AckRef> {
  data?: { via?: string }
}

export type LedgerEvent =
  | ItemEvent
  | ProbeEvent
  | QuizEvent
  | PredictEvent
  | SimTaskEvent
  | LabCheckEvent
  | FleetActEvent
  | CapstoneStepEvent
  | ReservedGradedEvent
  | VisitEvent
  | CompleteEvent
  | ExerciseEvent
  | AchievementEvent
  | AckEvent

export type EventKind = LedgerEvent['kind']
export type GradedEvent = Extract<LedgerEvent, { score: number }>
export type GradedKind = GradedEvent['kind']
export type TraceKind = Exclude<EventKind, GradedKind>

/* ------------------------------------------------------------------ */
/* Working state: mutable, non-evidence, last-writer-wins (spec §5)    */
/* ------------------------------------------------------------------ */

export type LearningPath = 'full-ramp' | 'serving-first' | 'rust-systems'

/** K2 "Set your week", captured by Boot and consumed by Today (Wave 1). Days are 0 = Sunday … 6. */
export interface WeekPlan {
  minutesPerWeek: number
  sessionMinutes: number
  phoneDays: number[]
  laptopDays: number[]
  slo: 0.85 | 0.9
}

export type WorkingKey =
  | `scroll:${string}`
  | `sim-config:${string}`
  | 'fw:doc'
  | `fw:evidence:${string}`
  | 'capstone:metrics'
  | `settings:${keyof ProgressSettings & string}`
  | 'boot:path'
  | 'boot:week'
  | 'boot:value'
  | 'boot:install-dismissed'

export interface WorkingRecord {
  key: WorkingKey
  value: Json
  at: IsoInstant
  dev: DeviceId
}

/* ------------------------------------------------------------------ */
/* Consumer view (spec §6.2)                                           */
/* ------------------------------------------------------------------ */

/** Consumer-facing progress data: the non-action fields of today's ProgressState, unchanged. */
export type ProgressData = Pick<
  ProgressState,
  | 'version'
  | 'lessons'
  | 'sims'
  | 'labs'
  | 'fleetWeek'
  | 'capstone'
  | 'xp'
  | 'streakDays'
  | 'achievements'
  | 'settings'
>

/* ------------------------------------------------------------------ */
/* Aggregate: the order-insensitive fold of the ledger (spec §6)       */
/* ------------------------------------------------------------------ */

/** XP-bearing facts; each pays its unit once (fact-set semantics, so merges never double-pay). */
export type FactKey =
  | `lesson:${string}`
  | `quiz-pass:${string}`
  | `exercise:${string}`
  | `sim:${string}`
  | `lab:${string}`
  | `fw:${string}`
  | `cap:${string}`

export interface LessonAgg {
  /** A `complete` event exists. */
  done?: true
  /** Earliest completion. Always set when `done` is. */
  completedAt?: IsoInstant
  /** Latest known instant of any event on this lesson or its checkpoint items. */
  lastAt?: IsoInstant
  /** Best quiz score. */
  quizBest?: number
  exercise?: true
}

export interface SimAgg {
  /** Count of distinct `visit` events. */
  visits: number
  tasks: Record<string, true>
}

export interface LabAgg {
  checks: Record<string, true>
  done?: true
  completedAt?: IsoInstant
  /** Largest `total` seen on a run. */
  total?: number
}

export interface Aggregate {
  /** Aggregate format version; a mismatch means "rebuild from the ledger". */
  v: 1
  /** Number of distinct events folded. */
  events: number
  lessons: Record<string, LessonAgg>
  sims: Record<string, SimAgg>
  labs: Record<string, LabAgg>
  fleetWeek: { acts: Record<string, true>; scores: Record<string, number> }
  capstone: { steps: Record<string, true>; step: number }
  /** Each fact pays its XP unit once, however many events or devices assert it. */
  facts: Partial<Record<FactKey, true>>
  /** Graded local days (the `day` of every streak event). */
  days: Record<LocalDay, true>
  /** Earliest `achievement` per id. */
  achievements: Record<string, IsoInstant>
  /** Earliest `ack` per ref. */
  acks: Record<string, IsoInstant>
  /** Earliest `complete` per non-lesson ref (e.g. `boot`). */
  completions: Record<string, IsoInstant>
}

/** The derived snapshot under localStorage `kernelspace:v2`. Rebuildable from IndexedDB at any time. */
export interface SnapshotV2 {
  schemaVersion: number
  aggregateVersion: Aggregate['v']
  writtenAt: IsoInstant
  /** Tab that wrote it. */
  tab: string
  aggregate: Aggregate
  working: WorkingRecord[]
}

/* ------------------------------------------------------------------ */
/* IndexedDB records (spec §3)                                         */
/* ------------------------------------------------------------------ */

export type StoreName = 'events' | 'working' | 'components' | 'meta' | 'checkpoints'

export interface ComponentMeta {
  /** Primary key. Lowercase hex SHA-256 of the module bytes. */
  sha256: string
  labId: string
  name?: string
  size: number
  addedAt: IsoInstant
  /** `ks_abi_version()` once F1 ships. */
  abi?: number
}

export interface ComponentRecord extends ComponentMeta {
  bytes?: ArrayBuffer
}

export interface MetaRecords {
  schema: { version: number; at: IsoInstant; build?: string }
  device: { id: DeviceId; createdAt: IsoInstant }
  backup: { at: IsoInstant; via: 'auto' | 'manual'; bytes: number; claimedBy: string }
  lastExport: { at: IsoInstant; events: number }
  persist: { checkedAt: IsoInstant; persisted: boolean; requestedAt?: IsoInstant }
}

export type MetaKey = keyof MetaRecords

/** One-level undo for import and reset (spec §10.4). `undo(current) = events ∪ (current − fileEventIds)`. */
export interface Checkpoint {
  id: 'undo'
  reason: 'import-merge' | 'import-replace' | 'reset'
  at: IsoInstant
  events: LedgerEvent[]
  working: WorkingRecord[]
  fileEventIds: EventId[]
  fileWorkingKeys: WorkingKey[]
}

/* ------------------------------------------------------------------ */
/* Storage adapter (spec §7)                                           */
/* ------------------------------------------------------------------ */

/** Why a bundle stopped writing (spec §9.3). IndexedDB being unavailable is not read-only: see `LedgerStatus.backend`. */
export type ReadOnlyReason = 'newer-schema' | 'newer-idb' | 'versionchange' | 'snapshot-newer'

export interface StoreInfo {
  backend: 'idb' | 'memory'
  /** meta `schema.version`, or null for a fresh database. */
  schemaVersion: number | null
  readOnly: boolean
  reason?: ReadOnlyReason
}

export interface StoreContents {
  events: LedgerEvent[]
  working: WorkingRecord[]
  /** Metadata only; bytes load on demand. */
  components: ComponentMeta[]
  meta: Partial<MetaRecords>
}

/** One atomic write. Applied in this order: clear, deletes, puts. */
export interface StoreTx {
  clear?: Exclude<StoreName, 'meta'>[]
  deleteEventIds?: EventId[]
  deleteWorkingKeys?: WorkingKey[]
  deleteMeta?: MetaKey[]
  deleteCheckpoint?: boolean
  putEvents?: LedgerEvent[]
  putWorking?: WorkingRecord[]
  putComponents?: ComponentRecord[]
  putMeta?: Partial<MetaRecords>
  putCheckpoint?: Checkpoint
  /** Write each meta key only when absent (claims such as the backup nudge). */
  putMetaIfAbsent?: Partial<MetaRecords>
  /** Write each working record only when its key is absent (first claim). */
  putWorkingIfAbsent?: WorkingRecord[]
}

/** Injected so the adapters stay free of merge policy; the engine passes the ledger's pure rules. */
export interface ConflictResolvers {
  /** Same id, different content: return the canonical one (total order; spec §4.8). */
  event(existing: LedgerEvent, incoming: LedgerEvent): LedgerEvent
  /** Same key: last writer wins by (`at`, `dev`, canonical JSON). */
  working(existing: WorkingRecord, incoming: WorkingRecord): WorkingRecord
}

export interface CommitResult {
  /** Ids whose stored record was created or replaced. */
  eventIds: EventId[]
  workingKeys: WorkingKey[]
  /** Meta keys written by `putMetaIfAbsent` (absent from the result = already present). */
  metaClaimed: MetaKey[]
}

export interface LedgerStore {
  readonly backend: StoreInfo['backend']
  open(): Promise<StoreInfo>
  readAll(): Promise<StoreContents>
  commit(tx: StoreTx, resolve: ConflictResolvers): Promise<CommitResult>
  readCheckpoint(): Promise<Checkpoint | undefined>
  readComponentBytes(sha256: string): Promise<ArrayBuffer | undefined>
  /** Fires when another context upgrades the database; the engine goes read-only. */
  onVersionChange(cb: () => void): () => void
  close(): void
}

/* ------------------------------------------------------------------ */
/* Export v3 and import (spec §10)                                     */
/* ------------------------------------------------------------------ */

export interface ExportedComponent extends ComponentMeta {
  /** Base64 module bytes, only when the learner opts in. */
  bytesB64?: string
}

export interface ExportV3 {
  format: 'kernelspace-progress'
  version: 3
  schemaVersion: number
  exportedAt: IsoInstant
  device: DeviceId
  /** Sorted by (`at` ?? '', `id`). */
  events: LedgerEvent[]
  /** Sorted by key. */
  working: WorkingRecord[]
  components: ExportedComponent[]
  /** localStorage keys outside the store (audit: never exported before). */
  extras: {
    capstoneDrafts: Record<string, string>
    capstoneFlags?: { hints?: boolean; optimizer?: boolean }
    leaderboardPersonal?: Json
  }
}

export type ImportMode = 'merge' | 'replace'

/** Import accepts export v3 only (Addendum A1). */
export type ImportFormat = { kind: 'export-v3'; schemaVersion: number }

/** `older-export`: a v1/v2 export or a copied localStorage value ("this export is from an earlier version of kernelspace and can't be imported"). */
export type ImportErrorCode =
  | 'parse'
  | 'unknown-format'
  | 'older-export'
  | 'newer-schema'
  | 'too-large'
  | 'invalid'
  | 'read-only'

export interface ProgressSummary {
  lessonsDone: number
  xp: number
  activeDays: number
  labsDone: number
  events: number
}

export interface ImportPreview {
  format: ImportFormat
  mode: ImportMode
  fileEvents: number
  /** Events not already in this ledger (merge), or every file event (replace). */
  newEvents: number
  workingChanges: number
  before: ProgressSummary
  after: ProgressSummary
  warnings: string[]
}

export type ImportResult =
  | { ok: true; mode: ImportMode; added: number; removed: number; undoAvailable: true }
  | { ok: false; error: ImportErrorCode; detail?: string }

/* ------------------------------------------------------------------ */
/* Engine, façade and sync (spec §8)                                   */
/* ------------------------------------------------------------------ */

export interface LedgerClock {
  nowIso(): IsoInstant
  /** Minutes east of UTC at that instant (DST-aware in browsers). */
  tzOffsetMinutes(at: IsoInstant): number
}

export type IdFactory = () => EventId

export interface LedgerStatus {
  /** The engine has loaded IndexedDB and replaced the hydrated snapshot with a full derive. */
  ready: boolean
  readOnly: boolean
  reason?: ReadOnlyReason
  /** `snapshot-only` until the engine loads; `memory` = IndexedDB unavailable, outbox-backed (spec §9.8). */
  backend: 'idb' | 'memory' | 'snapshot-only'
  persisted?: boolean
  lastExportAt?: IsoInstant
  undo?: { reason: Checkpoint['reason']; at: IsoInstant }
  /** IndexedDB came back empty while the snapshot held events; the old snapshot was kept under `orphanKey` (spec §9.8). */
  cleared?: { at: IsoInstant; orphanKey: string }
}

/** Additive state on useProgress. Existing fields and actions keep their exact shapes. */
export interface LedgerFacadeState {
  ledger: LedgerStatus
  acks: Record<string, IsoInstant>
  completions: Record<string, IsoInstant | null>
  working: Partial<Record<WorkingKey, Json>>
}

export interface QuizResponse {
  /** Authored question index. */
  qi: number
  /** Item fingerprint (spec §4.5). */
  rev: string
  /** Chosen option(s) by authored index. */
  pick: number[]
  ok: boolean
  conf?: Confidence
}

export interface QuizAttempt {
  lessonId: string
  /** The attempt's shuffle seed (QuizBlock `seed`). */
  seed: number
  ms?: number
  responses: QuizResponse[]
}

/** Input for item-like events written outside the lesson checkpoint (Boot, change cards, cold checks). */
export interface ItemResponse {
  kind: 'item' | 'probe' | 'predict'
  ref: ItemRef
  rev: string
  score: number
  ok: boolean
  conf?: Confidence
  seed?: number
  ms?: number
  /** Defaults to `practice`. */
  provenance?: Provenance
  data: ItemData | PredictEvent['data']
}

export interface LabRunMeta {
  wasmSha256?: string
  seed?: number
  provenance?: Extract<Provenance, 'lab-green' | 'unseen' | 'proved'>
}

/** New façade actions (additive). Existing actions keep their signatures (spec §8.3). */
export interface LedgerFacadeActions {
  recordQuizAttempt(attempt: QuizAttempt): void
  recordItems(items: ItemResponse[]): void
  acknowledge(ref: AckRef, data?: { via?: string }): void
  completeRef(ref: BootRef, data?: JsonObject): void
  recordVisit(ref: LessonRef | SimRef | BootRef): void
  setWorking(key: WorkingKey, value: Json): void
}

export interface EventFilter {
  kinds?: EventKind[]
  refPrefix?: string
  since?: IsoInstant
}

/** Async API of the lazily loaded engine (src/lib/ledger/client.ts re-exports it). */
export interface LedgerClient {
  exportV3(opts?: { includeComponentBytes?: boolean }): Promise<ExportV3>
  previewImport(text: string, mode: ImportMode): Promise<ImportPreview | { error: ImportErrorCode; detail?: string }>
  importFile(text: string, mode: ImportMode): Promise<ImportResult>
  undo(): Promise<boolean>
  reset(): Promise<void>
  events(filter?: EventFilter): Promise<LedgerEvent[]>
  storageEstimate(): Promise<{ events: number; approxBytes: number; usage?: number; quota?: number }>
}

/** The engine as the façade sees it (src/lib/ledger/engine.ts). */
export interface LedgerEngine extends LedgerClient {
  /** Commit events and working records already in this tab's outbox, then broadcast. Resolves after the commit. */
  append(events: LedgerEvent[], working: WorkingRecord[]): Promise<void>
  /** Called after every full derive (boot, broadcast, import, undo, reset, re-projection). */
  onAggregate(cb: (agg: Aggregate, working: WorkingRecord[], status: LedgerStatus) => void): () => void
  status(): LedgerStatus
}

/** localStorage, or a Map-backed fake in tests. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

/** Everything the façade touches outside itself, so `createProgressStore(env)` runs under `bun test`. */
export interface FacadeEnv {
  /** null when localStorage throws on access. */
  storage: KeyValueStorage | null
  clock: LedgerClock
  newId: IdFactory
  tabId: string
  loadEngine: () => Promise<LedgerEngine>
}

/** BroadcastChannel `kernelspace:ledger` messages (spec §9.4). */
export type ChannelMessage =
  | { t: 'append'; from: string; schemaVersion: number; events: LedgerEvent[]; working: WorkingRecord[] }
  | {
      t: 'reload'
      from: string
      schemaVersion: number
      reason: 'import' | 'undo' | 'reset'
    }
  | { t: 'hello'; from: string; schemaVersion: number }

/** Per-tab outbox under `kernelspace:v2:outbox:<tabId>`: written synchronously before the async commit. */
export interface Outbox {
  tab: string
  updatedAt: IsoInstant
  events: LedgerEvent[]
  working: WorkingRecord[]
}

/* ------------------------------------------------------------------ */
/* Part-2 features (spec §12)                                          */
/* ------------------------------------------------------------------ */

/** S4: "N things you learned have changed". */
export interface ChangeCard {
  erratum: Erratum
  /** Lessons the erratum touches that the learner completed on or before its date. */
  lessonIds: string[]
  /** Earliest such completion. */
  learnedAt: IsoInstant
  acked: boolean
}

/** Retrieval items on a change card (proposed `Erratum.items`, at most 2). */
export type ChangeCardItem = QuizQuestion

/** V2: one confidence level's row in the calibration table. */
export interface CalibrationBin {
  conf: Confidence
  /** Stated probability for this level (mapping version 1). */
  p: number
  n: number
  correct: number
  accuracy: number | null
  /** Wilson 95% interval on accuracy. */
  ci95: [number, number] | null
}

/** V2: Brier score with its Murphy decomposition (exact here, since p is constant within a bin). */
export interface CalibrationReport {
  mappingVersion: 1
  n: number
  bins: CalibrationBin[]
  brier: number | null
  reliability: number | null
  resolution: number | null
  uncertainty: number | null
  /** Mean stated probability minus mean accuracy; positive = overconfident. */
  bias: number | null
  /** Count of sure-and-wrong responses (they come first in feedback). */
  sureWrong: number
}

/** K4 activation metrics, computed from Boot's events. */
export interface BootOutcome {
  completedAt: IsoInstant | null
  /** Correct graded Boot steps in the first Boot session. */
  correct: number
  graded: number
  /** From the first Boot event to the first correct graded step. */
  firstSuccessMs: number | null
  totalMs: number | null
  /** A graded event on another local day within 7 days after Boot; null until 7 days have passed. */
  returnedWithin7Days: boolean | null
}
