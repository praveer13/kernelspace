/**
 * The ledger engine (spec §2, §8.5-8.7, §9.3-9.8, §10; Addendum A1 and A4). It loads lazily, after
 * first paint, and owns everything the entry chunk must not carry: the store, the codec, the
 * channel, import/export and undo.
 *
 * Start fresh (A1): the engine never reads or writes `kernelspace:v1`. The first load starts with an
 * empty ledger, and `reset()` clears v3 state only (events, working records, the snapshot and the
 * outboxes).
 *
 * Shape:
 * - `createEngine(deps)` boots (§9.6) and resolves when the in-memory ledger is current. Everything
 *   it touches outside itself comes in through `deps`, so tests run it on a MemoryStore with a fake
 *   channel and a Map-backed storage.
 * - The in-memory ledger is a Map keyed by event id plus a Map of working records. Every change goes
 *   through the same `foldInto` the façade uses, so the optimistic and the full aggregate agree (I7).
 * - Writes (commit, import, undo, reset) run one at a time on a promise queue. `append` updates memory
 *   synchronously, then queues the commit; `pending` holds what memory has but the store may not, so a
 *   rebuild from the store never drops a local write that is still in flight.
 * - Read-only (§8.7) is a latch (`guard.ts`): once set, nothing is written and nothing is applied.
 */

import { openLedgerChannel, broadcastableWorking, watchSnapshotStorage } from './channel'
import type { ChannelLike, LedgerChannel, StorageEventTarget } from './channel'
import {
  buildExportV3,
  IMPORT_ERROR_MESSAGES,
  mergeExtras,
  parseImport,
  previewImport as previewImportText,
  validateEvent,
  validateWorkingRecord,
} from './codec'
import { SCHEMA_VERSION } from './constants'
import { derive, foldInto, GRADED_KINDS } from './fold'
import { createGuard } from './guard'
import { IdbStore } from './idb-store'
import { MemoryStore } from './memory-store'
import { canonicalEvent, compareEvents, lwwWorking } from './merge'
import { SNAPSHOT_KEY } from './names'
import { collectOutboxes, pendingFrom, removeFromOutbox, settleOutboxes } from './outbox'
import { sameJson } from './stable'
import type { Ledger } from './merge'
import type {
  Aggregate,
  Checkpoint,
  ComponentRecord,
  ConflictResolvers,
  EventFilter,
  EventId,
  ExportedComponent,
  ExportOptions,
  ExportV3,
  ImportErrorCode,
  ImportMode,
  ImportPreview,
  ImportResult,
  IsoInstant,
  KeyValueStorage,
  LedgerClock,
  LedgerEngine,
  LedgerEvent,
  LedgerStatus,
  LedgerStore,
  MetaRecords,
  StoreContents,
  StoreTx,
  WorkingKey,
  WorkingRecord,
} from './types'

/* ------------------------------------------------------------------ */
/* Dependencies                                                        */
/* ------------------------------------------------------------------ */

/** The slice of `navigator.storage` the engine uses (§9.6 step 8). */
export interface StorageManagerLike {
  persisted?(): Promise<boolean>
  persist?(): Promise<boolean>
  estimate?(): Promise<{ usage?: number; quota?: number }>
}

export interface EngineDeps {
  store: LedgerStore
  /** Used when the store cannot open or its first read/commit fails (§9.8). Defaults to a fresh MemoryStore. */
  fallbackStore?: () => LedgerStore
  /** localStorage, or a Map-backed fake; null when it throws on access. */
  storage: KeyValueStorage | null
  clock: LedgerClock
  tabId: string
  /** This browser's device id (the façade stamps the same one on events). */
  device: string
  /** This bundle's `SCHEMA_VERSION`; tests pass another to play an older or newer bundle. */
  schemaVersion?: number
  /** `undefined`: BroadcastChannel when it exists. `null`: no channel. */
  channelFactory?: ((name: string) => ChannelLike) | null
  /** `window`, for the `storage` fallback when there is no BroadcastChannel. */
  storageEvents?: StorageEventTarget | null
  durability?: StorageManagerLike | null
  /** Build id recorded in `meta.schema`. */
  build?: string
}

export interface BootedEngine extends LedgerEngine {
  close(): void
}

/** Same-id and same-key conflicts: the ledger's pure rules (§4.8, §5). */
const resolvers: ConflictResolvers = { event: canonicalEvent, working: lwwWorking }

const DAY_MS = 24 * 60 * 60 * 1000
/** Ask for persistent storage at most once per this long (§9.6 step 8). */
const PERSIST_RETRY_MS = 30 * DAY_MS
/** `storage`-event reloads are coalesced for this long. */
const STORAGE_RELOAD_DELAY_MS = 100

const NO_CHANNEL: LedgerChannel = { available: false, post() {}, subscribe: () => () => {}, close() {} }

/* ------------------------------------------------------------------ */
/* Extras: localStorage keys outside the store that exports carry      */
/* ------------------------------------------------------------------ */

const CAPSTONE_DRAFT_PREFIX = 'kernelspace:capstone:draft:'
const CAPSTONE_FLAGS_KEY = 'kernelspace:capstone:flags'
const LEADERBOARD_PERSONAL_KEY = 'kernelspace:leaderboard-personal:v1'

type Extras = ExportV3['extras']

/** Capstone drafts are keyed by their full storage key, so an import writes them back where the page reads them. */
function readExtras(storage: KeyValueStorage | null): Extras {
  const extras: Extras = { capstoneDrafts: {} }
  if (!storage) return extras
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key === null || !key.startsWith(CAPSTONE_DRAFT_PREFIX)) continue
      const value = storage.getItem(key)
      if (value !== null) extras.capstoneDrafts[key] = value
    }
    const flags = storage.getItem(CAPSTONE_FLAGS_KEY)
    if (flags !== null) {
      const parsed = JSON.parse(flags) as { hints?: unknown; optimizer?: unknown }
      extras.capstoneFlags = { hints: !!parsed.hints, optimizer: !!parsed.optimizer }
    }
    const personal = storage.getItem(LEADERBOARD_PERSONAL_KEY)
    if (personal !== null) extras.leaderboardPersonal = JSON.parse(personal)
  } catch {
    // an unreadable extra is simply left out of the export
  }
  return extras
}

/** Best effort: extras are never evidence, and only draft keys are accepted from a file. */
function writeExtras(storage: KeyValueStorage | null, extras: Extras): void {
  if (!storage) return
  try {
    for (const [key, value] of Object.entries(extras.capstoneDrafts)) {
      if (key.startsWith(CAPSTONE_DRAFT_PREFIX) && storage.getItem(key) !== value) storage.setItem(key, value)
    }
    if (extras.capstoneFlags) storage.setItem(CAPSTONE_FLAGS_KEY, JSON.stringify(extras.capstoneFlags))
    if (extras.leaderboardPersonal !== undefined) {
      storage.setItem(LEADERBOARD_PERSONAL_KEY, JSON.stringify(extras.leaderboardPersonal))
    }
  } catch {
    // quota or blocked storage: skip
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function base64ToBytes(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function toComponentRecords(components: ExportedComponent[]): ComponentRecord[] {
  return components.map((c) => {
    const { bytesB64, ...meta } = c
    const rec: ComponentRecord = meta
    if (bytesB64 !== undefined) {
      try {
        rec.bytes = base64ToBytes(bytesB64)
      } catch {
        // damaged bytes: keep the metadata only
      }
    }
    return rec
  })
}

/** A snapshot's event count, or 0 when it is missing or unreadable. */
function snapshotEvents(raw: string | null): number {
  if (raw === null) return 0
  try {
    const n = (JSON.parse(raw) as { aggregate?: { events?: unknown } }).aggregate?.events
    return typeof n === 'number' && Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export async function createEngine(deps: EngineDeps): Promise<BootedEngine> {
  const bundle = deps.schemaVersion ?? SCHEMA_VERSION
  const { storage, clock, tabId, device } = deps
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0
  const now = (): IsoInstant => clock.nowIso()
  const nowMs = (): number => Date.parse(now())

  let store = deps.store
  /** IndexedDB failed, so the outbox is the only durable copy (§9.8). */
  let fellBack = false
  let ready = false
  let closed = false

  /* ---- in-memory ledger ---- */
  let events = new Map<EventId, LedgerEvent>()
  let working = new Map<WorkingKey, WorkingRecord>()
  let agg: Aggregate = derive([])
  let meta: Partial<MetaRecords> = {}
  /** Appended in memory, not yet committed. A rebuild from the store adds these back. */
  const pendingEvents = new Map<EventId, LedgerEvent>()
  const pendingWorking = new Map<WorkingKey, WorkingRecord>()

  /* ---- status ---- */
  const base: Omit<LedgerStatus, 'readOnly' | 'reason'> = { ready: false, backend: 'memory' }
  const listeners = new Set<(a: Aggregate, w: WorkingRecord[], s: LedgerStatus) => void>()

  const status = (): LedgerStatus => {
    const s: LedgerStatus = { ...base, readOnly: guard.readOnly }
    if (guard.reason) s.reason = guard.reason
    return s
  }
  const emit = (): void => {
    if (!ready) return
    const w = [...working.values()]
    const s = status()
    for (const cb of [...listeners]) cb(agg, w, s)
  }
  const guard = createGuard(bundle, () => emit())

  /* ---- channel ---- */
  const channel: LedgerChannel =
    deps.channelFactory === null
      ? NO_CHANNEL
      : openLedgerChannel({ tabId, schemaVersion: bundle, factory: deps.channelFactory })

  /* ---- serialised writes ---- */
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }
  /**
   * A queued meta write. A task can wait here while a newer bundle's `hello` latches the guard, so each write
   * rechecks `guard.readOnly` when it runs, not only when it was queued (I6, §8.7). False: it was skipped.
   */
  const commitMeta = (tx: StoreTx): Promise<boolean> =>
    enqueue(async () => {
      if (guard.readOnly) return false
      await store.commit(tx, resolvers)
      return true
    })

  /* ---------------- memory helpers ---------------- */

  /** Add events and working records to memory. Returns whether anything changed. */
  function ingest(newEvents: LedgerEvent[], newWorking: WorkingRecord[]): boolean {
    const fresh: LedgerEvent[] = []
    let conflict = false
    for (const e of newEvents) {
      const prev = events.get(e.id)
      if (!prev) {
        events.set(e.id, e)
        fresh.push(e)
      } else {
        const winner = canonicalEvent(prev, e)
        if (winner !== prev) {
          events.set(e.id, winner)
          conflict = true
        }
      }
    }
    let workingChanged = false
    for (const w of newWorking) {
      const prev = working.get(w.key)
      const winner = prev ? lwwWorking(prev, w) : w
      if (winner !== prev) {
        working.set(w.key, winner)
        workingChanged = true
      }
    }
    if (conflict) agg = derive(events.values())
    else if (fresh.length > 0) {
      const next = structuredClone(agg)
      for (const e of fresh) foldInto(next, e)
      agg = next
    }
    return conflict || fresh.length > 0 || workingChanged
  }

  /** Replace memory with what the store holds, plus writes still in flight. */
  function setMemory(contents: Pick<StoreContents, 'events' | 'working'>): void {
    events = new Map()
    working = new Map()
    for (const e of contents.events) {
      const prev = events.get(e.id)
      events.set(e.id, prev ? canonicalEvent(prev, e) : e)
    }
    for (const w of contents.working) {
      const prev = working.get(w.key)
      working.set(w.key, prev ? lwwWorking(prev, w) : w)
    }
    for (const e of pendingEvents.values()) {
      const prev = events.get(e.id)
      events.set(e.id, prev ? canonicalEvent(prev, e) : e)
    }
    for (const w of pendingWorking.values()) {
      const prev = working.get(w.key)
      working.set(w.key, prev ? lwwWorking(prev, w) : w)
    }
    agg = derive(events.values())
  }

  const ledger = (): Ledger => ({ events: [...events.values()], working: [...working.values()] })

  async function refreshUndo(): Promise<void> {
    const cp = await store.readCheckpoint()
    if (cp) base.undo = { reason: cp.reason, at: cp.at }
    else delete base.undo
  }

  /** Re-read the store and publish (a `reload` from another tab, a `storage` fallback). */
  async function rebuildFromStore(): Promise<void> {
    if (guard.readOnly || closed) return
    setMemory(await store.readAll())
    await refreshUndo()
    emit()
  }

  /* ---------------- boot (§9.6) ---------------- */

  /** Outbox contents that pass validation: they come from storage, so they are untrusted like an import. */
  function validPending(found: ReturnType<typeof collectOutboxes>): { events: LedgerEvent[]; working: WorkingRecord[] } {
    const raw = pendingFrom(found)
    const evs: LedgerEvent[] = []
    const ws: WorkingRecord[] = []
    for (const e of raw.events) {
      const checked = validateEvent(e)
      if (checked.ok) evs.push(checked.value)
    }
    for (const w of raw.working) {
      const checked = validateWorkingRecord(w)
      if (checked.ok) ws.push(checked.value)
    }
    return { events: evs, working: ws }
  }

  const versionWatch: { off: (() => void) | null } = { off: null }

  async function openAndLoad(): Promise<{ schemaVersion: number | null; contents: StoreContents | null }> {
    const info = await store.open()
    base.backend = info.backend
    guard.storeInfo(info)
    guard.snapshotRaw(storage ? safeGet(SNAPSHOT_KEY) : null)
    versionWatch.off = store.onVersionChange(() => {
      guard.versionChange()
      emit()
    })
    // A newer bundle owns the data: read nothing, write nothing (§8.7).
    if (guard.readOnly) return { schemaVersion: info.schemaVersion, contents: null }

    // Steps 2-3: schema and device meta, and every outbox, in one commit.
    const found = collectOutboxes(storage, tabId)
    const pending = validPending(found)
    const at = now()
    const tx: StoreTx = {
      putEvents: pending.events,
      putWorking: pending.working,
      putMetaIfAbsent: { device: { id: device, createdAt: at } },
    }
    if (info.schemaVersion === null || info.schemaVersion < bundle) {
      tx.putMeta = { schema: deps.build ? { version: bundle, at, build: deps.build } : { version: bundle, at } }
    }
    await store.commit(tx, resolvers)
    // When IndexedDB is gone the outbox is the store: leave it (§8.6).
    if (!fellBack) settleOutboxes(storage, tabId, found, nowMs())
    return { schemaVersion: info.schemaVersion, contents: await store.readAll() }
  }

  function safeGet(key: string): string | null {
    try {
      return storage ? storage.getItem(key) : null
    } catch {
      return null
    }
  }

  let loaded: Awaited<ReturnType<typeof openAndLoad>>
  const early: Parameters<typeof onMessage>[0][] = []

  // Subscribe first and hold messages until the baseline is read, so nothing between the read and the subscription is lost.
  const offChannel = channel.subscribe((m) => {
    if (!ready) early.push(m)
    else onMessage(m)
  })

  try {
    loaded = await openAndLoad()
  } catch {
    // IndexedDB unavailable or failing: keep going on memory, with the outbox as the durable copy (§9.8).
    versionWatch.off?.()
    try {
      store.close()
    } catch {
      // already unusable
    }
    store = deps.fallbackStore ? deps.fallbackStore() : new MemoryStore()
    fellBack = true
    loaded = await openAndLoad()
  }

  if (loaded.contents) {
    meta = loaded.contents.meta
    setMemory(loaded.contents)
    // §9.8: IndexedDB came back fresh while the snapshot says there was progress (eviction): keep a copy of it.
    const raw = safeGet(SNAPSHOT_KEY)
    if (!fellBack && loaded.schemaVersion === null && raw !== null && snapshotEvents(raw) > agg.events) {
      const orphanKey = `kernelspace:v2:orphaned:${now().slice(0, 10)}`
      try {
        storage?.setItem(orphanKey, raw)
      } catch {
        // quota: the notice still shows
      }
      base.cleared = { at: now(), orphanKey }
    }
    await refreshUndo()
    if (meta.lastExport) base.lastExportAt = meta.lastExport.at
  }
  base.ready = true
  ready = true

  // Steps 6-7: the channel, the storage fallback, then hello.
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  const offStorage = channel.available
    ? () => {}
    : watchSnapshotStorage(deps.storageEvents ?? null, () => {
        if (reloadTimer !== null) clearTimeout(reloadTimer)
        reloadTimer = setTimeout(() => {
          reloadTimer = null
          void enqueue(rebuildFromStore).catch(() => undefined)
        }, STORAGE_RELOAD_DELAY_MS)
      })
  for (const m of early.splice(0)) onMessage(m)
  if (!guard.readOnly) channel.post({ t: 'hello' })

  // Step 8: durability. `persisted()` never prompts.
  let persistAsked = false
  const durability = deps.durability ?? null
  if (!guard.readOnly && durability?.persisted) {
    try {
      base.persisted = await durability.persisted()
    } catch {
      // unsupported: leave it unknown
    }
  }

  if (import.meta.env?.DEV) {
    console.debug(`[ledger] engine ready in ${(performance.now() - t0).toFixed(0)} ms (${events.size} events, ${base.backend})`)
  }

  /* ---------------- channel messages (§9.4) ---------------- */

  function onMessage(m: Parameters<Parameters<LedgerChannel['subscribe']>[0]>[0]): void {
    if (closed) return
    if (guard.message(m)) return // a newer bundle: latched read-only; its events may not be readable
    if (guard.readOnly) return
    if (m.t === 'append') {
      const evs: LedgerEvent[] = []
      const ws: WorkingRecord[] = []
      for (const e of m.events) {
        const checked = validateEvent(e)
        if (checked.ok) evs.push(checked.value)
      }
      for (const w of m.working) {
        const checked = validateWorkingRecord(w)
        if (checked.ok) ws.push(checked.value)
      }
      if (ingest(evs, ws)) emit()
    } else if (m.t === 'reload') {
      void enqueue(rebuildFromStore).catch(() => undefined)
    }
    // 'hello' only matters to the guard
  }

  /* ---------------- writes ---------------- */

  async function maybeRequestPersist(evs: LedgerEvent[]): Promise<void> {
    if (persistAsked || !durability?.persist || base.persisted === true) return
    if (!evs.some((e) => GRADED_KINDS.has(e.kind))) return
    persistAsked = true
    const last = meta.persist?.requestedAt
    if (last !== undefined && nowMs() - Date.parse(last) < PERSIST_RETRY_MS) return
    try {
      const granted = await durability.persist()
      const at = now()
      const rec: MetaRecords['persist'] = { checkedAt: at, persisted: granted, requestedAt: at }
      if (await commitMeta({ putMeta: { persist: rec } })) meta.persist = rec
      base.persisted = granted
      emit()
    } catch {
      // a refused or failed request is not an error
    }
  }

  /** Commit everything in `pending` (this call's writes and any earlier failures), then tidy up. */
  async function commitPending(sent: LedgerEvent[], sentWorking: WorkingRecord[]): Promise<void> {
    // Once read-only nothing is written, the outbox included (§8.7, I6). What the façade put there before the
    // latch stays for the newer bundle, which commits every outbox it finds when it boots (§8.6).
    if (guard.readOnly) return
    const evs = [...pendingEvents.values()]
    const ws = [...pendingWorking.values()]
    try {
      await store.commit({ putEvents: evs, putWorking: ws }, resolvers)
    } catch {
      return // stays in the outbox and in `pending`; the next commit or boot retries
    }
    for (const e of evs) pendingEvents.delete(e.id)
    for (const w of ws) {
      const cur = pendingWorking.get(w.key)
      if (cur && sameJson(cur, w)) pendingWorking.delete(w.key)
    }
    if (!fellBack) removeFromOutbox(storage, tabId, evs, ws, now())
    const out = broadcastableWorking(sentWorking)
    if (sent.length > 0 || out.length > 0) channel.post({ t: 'append', events: sent, working: out })
    void maybeRequestPersist(sent)
  }

  function append(evs: LedgerEvent[], ws: WorkingRecord[]): Promise<void> {
    if (guard.readOnly || closed || (evs.length === 0 && ws.length === 0)) return Promise.resolve()
    for (const e of evs) pendingEvents.set(e.id, e)
    for (const w of ws) pendingWorking.set(w.key, w)
    if (ingest(evs, ws)) emit()
    return enqueue(() => commitPending(evs, ws))
  }

  const readOnlyResult = (): { ok: false; error: ImportErrorCode; detail: string } => ({
    ok: false,
    error: 'read-only',
    detail: IMPORT_ERROR_MESSAGES['read-only'],
  })

  async function exportV3(opts?: ExportOptions): Promise<ExportV3> {
    const delta = opts?.sinceAt !== undefined
    const contents = await store.readAll()
    const components: ExportedComponent[] = []
    for (const c of delta ? [] : contents.components) {
      const out: ExportedComponent = { ...c }
      if (opts?.includeComponentBytes) {
        const bytes = await store.readComponentBytes(c.sha256)
        if (bytes) out.bytesB64 = bytesToBase64(new Uint8Array(bytes))
      }
      components.push(out)
    }
    const at = now()
    const file = buildExportV3({ ...ledger(), device, exportedAt: at, components, extras: readExtras(storage), sinceAt: opts?.sinceAt })
    if (!guard.readOnly && !delta) { // a handoff delta is not a backup, so it leaves the backup nudge alone
      const rec: MetaRecords['lastExport'] = { at, events: file.events.length }
      try {
        if (await commitMeta({ putMeta: { lastExport: rec } })) {
          meta.lastExport = rec
          base.lastExportAt = at
          emit()
        }
      } catch {
        // the file is still good; only the backup nudge misses this export
      }
    }
    return file
  }

  async function previewImport(text: string, mode: ImportMode): Promise<ImportPreview | { error: ImportErrorCode; detail?: string }> {
    if (guard.readOnly) return { error: 'read-only', detail: IMPORT_ERROR_MESSAGES['read-only'] }
    return previewImportText(text, mode, { ...ledger(), device })
  }

  function importFile(text: string, mode: ImportMode): Promise<ImportResult> {
    if (guard.readOnly) return Promise.resolve(readOnlyResult())
    const parsed = parseImport(text)
    if (!parsed.ok) return Promise.resolve({ ok: false, error: parsed.error, detail: parsed.detail })
    const { file } = parsed
    return enqueue(async (): Promise<ImportResult> => {
      if (guard.readOnly) return readOnlyResult()
      const at = now()
      const before = ledger()
      const beforeIds = new Set(before.events.map((e) => e.id))
      const fileIds = new Set(file.events.map((e) => e.id))
      const checkpoint: Checkpoint = {
        id: 'undo',
        reason: mode === 'merge' ? 'import-merge' : 'import-replace',
        at,
        events: before.events,
        working: before.working,
        fileEventIds: [...fileIds],
        fileWorkingKeys: file.working.map((w) => w.key),
      }
      // One transaction: the checkpoint is written with the clear, so a replace can always be undone (I1).
      const tx: StoreTx = {
        putCheckpoint: checkpoint,
        putEvents: file.events,
        putWorking: file.working,
        putComponents: toComponentRecords(file.components),
      }
      if (mode === 'replace') tx.clear = ['events', 'working']
      await store.commit(tx, resolvers)

      const local = readExtras(storage)
      writeExtras(
        storage,
        mode === 'merge'
          ? mergeExtras(local, file.extras)
          : {
              // Extras sit outside undo, so a replace overwrites what the file carries and keeps the rest.
              capstoneDrafts: { ...local.capstoneDrafts, ...file.extras.capstoneDrafts },
              capstoneFlags: file.extras.capstoneFlags ?? local.capstoneFlags,
              leaderboardPersonal: file.extras.leaderboardPersonal ?? local.leaderboardPersonal,
            },
      )

      setMemory(await store.readAll())
      base.undo = { reason: checkpoint.reason, at }
      emit()
      channel.post({ t: 'reload', reason: 'import' })
      return {
        ok: true,
        mode,
        added: file.events.filter((e) => !beforeIds.has(e.id)).length,
        removed: mode === 'replace' ? before.events.filter((e) => !fileIds.has(e.id)).length : 0,
        undoAvailable: true,
      }
    })
  }

  function undo(): Promise<boolean> {
    if (guard.readOnly) return Promise.resolve(false)
    return enqueue(async () => {
      if (guard.readOnly) return false
      const cp = await store.readCheckpoint()
      if (!cp) return false
      // events: checkpoint ∪ (current − file), so local work after the import survives (§10.4)
      const inFile = new Set(cp.fileEventIds)
      const restored = new Map<EventId, LedgerEvent>()
      for (const e of cp.events) restored.set(e.id, e)
      for (const e of events.values()) {
        if (inFile.has(e.id)) continue
        const prev = restored.get(e.id)
        restored.set(e.id, prev ? canonicalEvent(prev, e) : e)
      }
      // working: keep this device's newer writes, otherwise the checkpoint's record (or nothing)
      const before = new Map(cp.working.map((w) => [w.key, w]))
      const keys = new Set<WorkingKey>([...working.keys(), ...before.keys()])
      const putWorking: WorkingRecord[] = []
      for (const key of keys) {
        const cur = working.get(key)
        const keep = cur && cur.dev === device && cur.at > cp.at ? cur : before.get(key)
        if (keep) putWorking.push(keep)
      }
      await store.commit(
        { clear: ['events', 'working'], putEvents: [...restored.values()], putWorking, deleteCheckpoint: true },
        resolvers,
      )
      setMemory(await store.readAll())
      delete base.undo
      emit()
      channel.post({ t: 'reload', reason: 'undo' })
      return true
    })
  }

  function reset(): Promise<void> {
    if (guard.readOnly) return Promise.resolve()
    return enqueue(async () => {
      if (guard.readOnly) return
      const at = now()
      const before = ledger()
      const checkpoint: Checkpoint = {
        id: 'undo',
        reason: 'reset',
        at,
        events: before.events,
        working: before.working,
        fileEventIds: [],
        fileWorkingKeys: [],
      }
      // v3 state only (A1): events and working records go, components stay, and `kernelspace:v1` is never touched.
      await store.commit({ clear: ['events', 'working'], putCheckpoint: checkpoint }, resolvers)
      try {
        storage?.removeItem(SNAPSHOT_KEY)
        for (const f of collectOutboxes(storage, tabId)) storage?.removeItem(f.key)
      } catch {
        // storage blocked: nothing to remove
      }
      setMemory({ events: [], working: [] })
      base.undo = { reason: 'reset', at }
      delete base.cleared
      emit()
      channel.post({ t: 'reload', reason: 'reset' })
    })
  }

  async function eventsOf(filter?: EventFilter): Promise<LedgerEvent[]> {
    let list = [...events.values()]
    if (filter?.kinds) {
      const kinds = new Set<string>(filter.kinds)
      list = list.filter((e) => kinds.has(e.kind))
    }
    if (filter?.refPrefix !== undefined) {
      const prefix = filter.refPrefix
      list = list.filter((e) => e.ref.startsWith(prefix))
    }
    if (filter?.since !== undefined) {
      const since = filter.since
      list = list.filter((e) => e.at >= since)
    }
    return structuredClone(list.sort(compareEvents))
  }

  async function storageEstimate(): Promise<{ events: number; approxBytes: number; usage?: number; quota?: number }> {
    let approxBytes = 0
    for (const e of events.values()) approxBytes += JSON.stringify(e).length
    for (const w of working.values()) approxBytes += JSON.stringify(w).length
    const out: { events: number; approxBytes: number; usage?: number; quota?: number } = { events: events.size, approxBytes }
    try {
      const est = await durability?.estimate?.()
      if (est?.usage !== undefined) out.usage = est.usage
      if (est?.quota !== undefined) out.quota = est.quota
    } catch {
      // no estimate here
    }
    return out
  }

  return {
    exportV3,
    previewImport,
    importFile,
    undo,
    reset,
    events: eventsOf,
    storageEstimate,
    append,
    onAggregate(cb) {
      listeners.add(cb)
      // Replay the latest derive so a late subscriber starts current (the façade subscribes after boot).
      if (ready) cb(agg, [...working.values()], status())
      return () => {
        listeners.delete(cb)
      }
    },
    status,
    close() {
      closed = true
      listeners.clear()
      offChannel()
      offStorage()
      versionWatch.off?.()
      if (reloadTimer !== null) clearTimeout(reloadTimer)
      channel.close()
      store.close()
    },
  }
}

/** The browser's engine: IndexedDB, with the memory fallback of `createEngine` when it fails. */
export function createBrowserEngine(deps: Omit<EngineDeps, 'store'>): Promise<BootedEngine> {
  return createEngine({ ...deps, store: new IdbStore() })
}
