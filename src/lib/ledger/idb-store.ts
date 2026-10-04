/**
 * IdbStore: the IndexedDB `LedgerStore` (spec §3, §7).
 *
 * Rules the implementation follows:
 * - One IndexedDB transaction per `commit`, over only the stores it touches. Requests are issued
 *   from request callbacks and never after an `await`, because a transaction auto-commits when idle.
 * - Order inside a commit: clear, deletes, puts (events, working, working-if-absent, components,
 *   meta, meta-if-absent, checkpoint). MemoryStore applies the same order.
 * - No merge policy: same-id conflicts go through the injected `ConflictResolvers`. A throwing
 *   resolver aborts the transaction, so nothing is written.
 * - Default durability. The outbox covers the crash window (I9).
 */

import {
  DB_NAME,
  IDB_VERSION,
  IDX_COMPONENTS_BY_LAB,
  IDX_EVENTS_BY_AT,
  IDX_EVENTS_BY_KIND_REF,
  SELFTEST_DB_NAME,
  STORE_CHECKPOINTS,
  STORE_COMPONENTS,
  STORE_EVENTS,
  STORE_META,
  STORE_WORKING,
} from './names'
import { componentMeta } from './memory-store'
import { sameJson } from './stable'
import type {
  Checkpoint,
  CommitResult,
  ComponentRecord,
  ConflictResolvers,
  EventId,
  LedgerEvent,
  LedgerStore,
  MetaKey,
  MetaRecords,
  StoreContents,
  StoreInfo,
  StoreName,
  StoreTx,
  WorkingKey,
  WorkingRecord,
} from './types'

export interface IdbStoreOptions {
  /** Database name; `selfTestIdb` uses a throwaway one. */
  name?: string
  /** Injected for tests; defaults to `globalThis.indexedDB`. */
  factory?: IDBFactory
}

interface MetaRow {
  key: MetaKey
  value: unknown
}

function createSchema(db: IDBDatabase, oldVersion: number): void {
  // Switch on oldVersion; create whatever is missing. IDB_VERSION 1 creates everything.
  if (oldVersion < 1) {
    const events = db.createObjectStore(STORE_EVENTS, { keyPath: 'id' })
    events.createIndex(IDX_EVENTS_BY_AT, 'at')
    events.createIndex(IDX_EVENTS_BY_KIND_REF, ['kind', 'ref'])
    db.createObjectStore(STORE_WORKING, { keyPath: 'key' })
    const components = db.createObjectStore(STORE_COMPONENTS, { keyPath: 'sha256' })
    components.createIndex(IDX_COMPONENTS_BY_LAB, 'labId')
    db.createObjectStore(STORE_META, { keyPath: 'key' })
    db.createObjectStore(STORE_CHECKPOINTS, { keyPath: 'id' })
  }
}

function requestError(req: IDBRequest | IDBTransaction, fallback: string): Error {
  return req.error ?? new Error(fallback)
}

export class IdbStore implements LedgerStore {
  readonly backend = 'idb' as const
  private readonly name: string
  private readonly factory: IDBFactory | undefined
  private db: IDBDatabase | null = null
  private listeners = new Set<() => void>()

  constructor(opts: IdbStoreOptions = {}) {
    this.name = opts.name ?? DB_NAME
    this.factory = opts.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB)
  }

  open(): Promise<StoreInfo> {
    const factory = this.factory
    if (!factory) return Promise.reject(new Error('IndexedDB is not available'))
    return new Promise<StoreInfo>((resolve, reject) => {
      let req: IDBOpenDBRequest
      try {
        req = factory.open(this.name, IDB_VERSION)
      } catch (err) {
        reject(err)
        return
      }
      req.onupgradeneeded = (ev) => createSchema(req.result, ev.oldVersion)
      req.onerror = (ev) => {
        const err = req.error
        // An older bundle opening a newer database: go read-only, never fall back (spec §7).
        if (err && err.name === 'VersionError') {
          ev.preventDefault()
          resolve({ backend: 'idb', schemaVersion: null, readOnly: true, reason: 'newer-idb' })
          return
        }
        reject(err ?? new Error('IndexedDB open failed'))
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => {
          // Another context wants to upgrade: release the connection first, then tell the engine.
          db.close()
          if (this.db === db) this.db = null
          for (const cb of [...this.listeners]) cb()
        }
        db.onclose = () => {
          if (this.db === db) this.db = null
        }
        this.db = db
        this.readSchemaVersion(db).then(
          (schemaVersion) => resolve({ backend: 'idb', schemaVersion, readOnly: false }),
          (err) => {
            db.close()
            this.db = null
            reject(err)
          },
        )
      }
    })
  }

  private readSchemaVersion(db: IDBDatabase): Promise<number | null> {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_META, 'readonly').objectStore(STORE_META).get('schema')
      req.onsuccess = () => {
        const row = req.result as MetaRow | undefined
        const version = row ? (row.value as MetaRecords['schema']).version : null
        resolve(typeof version === 'number' ? version : null)
      }
      req.onerror = () => reject(requestError(req, 'meta read failed'))
    })
  }

  private need(): IDBDatabase {
    if (!this.db) throw new Error('IdbStore is not open (closed, read-only or never opened)')
    return this.db
  }

  readAll(): Promise<StoreContents> {
    return new Promise<StoreContents>((resolve, reject) => {
      let db: IDBDatabase
      try {
        db = this.need()
      } catch (err) {
        reject(err)
        return
      }
      const t = db.transaction([STORE_EVENTS, STORE_WORKING, STORE_COMPONENTS, STORE_META], 'readonly')
      const out: StoreContents = { events: [], working: [], components: [], meta: {} }
      const events = t.objectStore(STORE_EVENTS).getAll()
      events.onsuccess = () => {
        out.events = events.result as LedgerEvent[]
      }
      const working = t.objectStore(STORE_WORKING).getAll()
      working.onsuccess = () => {
        out.working = working.result as WorkingRecord[]
      }
      const components = t.objectStore(STORE_COMPONENTS).getAll()
      components.onsuccess = () => {
        out.components = (components.result as ComponentRecord[]).map(componentMeta)
      }
      const meta = t.objectStore(STORE_META).getAll()
      meta.onsuccess = () => {
        for (const row of meta.result as MetaRow[]) (out.meta as Record<string, unknown>)[row.key] = row.value
      }
      t.oncomplete = () => resolve(out)
      t.onabort = () => reject(requestError(t, 'readAll aborted'))
      t.onerror = () => reject(requestError(t, 'readAll failed'))
    })
  }

  commit(tx: StoreTx, resolve: ConflictResolvers): Promise<CommitResult> {
    return new Promise<CommitResult>((done, fail) => {
      let db: IDBDatabase
      try {
        db = this.need()
      } catch (err) {
        fail(err)
        return
      }
      const clear = tx.clear ?? []
      const touched = new Set<StoreName>(clear)
      if (tx.deleteEventIds?.length || tx.putEvents?.length) touched.add('events')
      if (tx.deleteWorkingKeys?.length || tx.putWorking?.length || tx.putWorkingIfAbsent?.length) touched.add('working')
      if (tx.putComponents?.length) touched.add('components')
      if (tx.deleteMeta?.length || Object.keys(tx.putMeta ?? {}).length || Object.keys(tx.putMetaIfAbsent ?? {}).length) {
        touched.add('meta')
      }
      if (tx.deleteCheckpoint || tx.putCheckpoint) touched.add('checkpoints')
      const result: CommitResult = { eventIds: [], workingKeys: [], metaClaimed: [] }
      if (touched.size === 0) {
        done(result)
        return
      }

      const t = db.transaction([...touched], 'readwrite')
      let failure: unknown = null
      const abort = (err: unknown) => {
        if (failure === null) failure = err
        try {
          t.abort()
        } catch {
          // already finished or aborting
        }
      }
      t.oncomplete = () => done(result)
      t.onabort = () => fail(failure ?? requestError(t, 'commit aborted'))
      t.onerror = () => {
        // The abort event follows and rejects; remember the cause.
        if (failure === null) failure = t.error
      }

      // Any throw, in a request callback or in the synchronous setup below, becomes an abort, so nothing is written.
      const guard = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
        try {
          fn(...a)
        } catch (err) {
          abort(err)
        }
      }

      try {
        // 1. clear
        for (const name of clear) t.objectStore(name).clear()
        // 2. deletes
        if (tx.deleteEventIds?.length) {
          const s = t.objectStore(STORE_EVENTS)
          for (const id of tx.deleteEventIds) s.delete(id)
        }
        if (tx.deleteWorkingKeys?.length) {
          const s = t.objectStore(STORE_WORKING)
          for (const key of tx.deleteWorkingKeys) s.delete(key)
        }
        if (tx.deleteMeta?.length) {
          const s = t.objectStore(STORE_META)
          for (const key of tx.deleteMeta) s.delete(key)
        }
        if (tx.deleteCheckpoint) t.objectStore(STORE_CHECKPOINTS).delete('undo')

        // 3. puts. Duplicate ids inside one batch are reduced first with the (commutative, associative)
        // resolver, so the concurrent get-then-put pairs below never race on one key.
        if (tx.putEvents?.length) {
          const s = t.objectStore(STORE_EVENTS)
          const batch = new Map<EventId, LedgerEvent>()
          for (const e of tx.putEvents) {
            const prior = batch.get(e.id)
            batch.set(e.id, prior ? resolve.event(prior, e) : e)
          }
          for (const incoming of batch.values()) {
            const get = s.get(incoming.id)
            get.onsuccess = guard(() => {
              const existing = get.result as LedgerEvent | undefined
              if (!existing) {
                s.put(incoming)
                result.eventIds.push(incoming.id)
                return
              }
              const winner = resolve.event(existing, incoming)
              if (!sameJson(winner, existing)) {
                s.put(winner)
                result.eventIds.push(incoming.id)
              }
            })
          }
        }
        if (tx.putWorking?.length) {
          const s = t.objectStore(STORE_WORKING)
          const batch = new Map<WorkingKey, WorkingRecord>()
          for (const w of tx.putWorking) {
            const prior = batch.get(w.key)
            batch.set(w.key, prior ? resolve.working(prior, w) : w)
          }
          for (const incoming of batch.values()) {
            const get = s.get(incoming.key)
            get.onsuccess = guard(() => {
              const existing = get.result as WorkingRecord | undefined
              if (!existing) {
                s.put(incoming)
                result.workingKeys.push(incoming.key)
                return
              }
              const winner = resolve.working(existing, incoming)
              if (!sameJson(winner, existing)) {
                s.put(winner)
                result.workingKeys.push(incoming.key)
              }
            })
          }
        }
        if (tx.putWorkingIfAbsent?.length) {
          const s = t.objectStore(STORE_WORKING)
          // A key that `putWorking` also writes counts as present (MemoryStore applies it first), and
          // its put only happens in a callback, so a get here could not see it yet.
          const seen = new Set<WorkingKey>((tx.putWorking ?? []).map((w) => w.key))
          for (const incoming of tx.putWorkingIfAbsent) {
            if (seen.has(incoming.key)) continue
            seen.add(incoming.key)
            const get = s.get(incoming.key)
            get.onsuccess = guard(() => {
              if (get.result !== undefined) return
              s.put(incoming)
              result.workingKeys.push(incoming.key)
            })
          }
        }
        if (tx.putComponents?.length) {
          const s = t.objectStore(STORE_COMPONENTS)
          for (const rec of tx.putComponents) s.put(rec)
        }
        if (touched.has('meta')) {
          const s = t.objectStore(STORE_META)
          for (const [key, value] of Object.entries(tx.putMeta ?? {})) s.put({ key, value } as MetaRow)
          for (const [key, value] of Object.entries(tx.putMetaIfAbsent ?? {})) {
            const get = s.get(key)
            get.onsuccess = guard(() => {
              if (get.result !== undefined) return
              s.put({ key, value } as MetaRow)
              result.metaClaimed.push(key as MetaKey)
            })
          }
        }
        if (tx.putCheckpoint) t.objectStore(STORE_CHECKPOINTS).put(tx.putCheckpoint)
      } catch (err) {
        abort(err)
      }
    })
  }

  readCheckpoint(): Promise<Checkpoint | undefined> {
    return this.pointRead<Checkpoint>(STORE_CHECKPOINTS, 'undo')
  }

  async readComponentBytes(sha256: string): Promise<ArrayBuffer | undefined> {
    const rec = await this.pointRead<ComponentRecord>(STORE_COMPONENTS, sha256)
    return rec?.bytes
  }

  private pointRead<T>(store: string, key: string): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      try {
        const req = this.need().transaction(store, 'readonly').objectStore(store).get(key)
        req.onsuccess = () => resolve(req.result as T | undefined)
        req.onerror = () => reject(requestError(req, `${store} read failed`))
      } catch (err) {
        reject(err)
      }
    })
  }

  onVersionChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  close(): void {
    this.db?.close()
    this.db = null
  }
}

/* ------------------------------------------------------------------ */
/* Browser self-test                                                   */
/* ------------------------------------------------------------------ */

export interface SelfTestResult {
  name: string
  ok: boolean
  error?: string
}

export interface SelfTestReport {
  ok: boolean
  passed: number
  failed: number
  results: SelfTestResult[]
}

function deleteDb(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = factory.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(requestError(req, 'deleteDatabase failed'))
    req.onblocked = () => reject(new Error('deleteDatabase blocked by an open connection'))
  })
}

function rawOpen(factory: IDBFactory, name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, version)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('x')) req.result.createObjectStore('x')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(requestError(req, 'raw open failed'))
  })
}

/**
 * Runs the shared store-conformance suite against IdbStore on the throwaway database
 * `kernelspace-selftest`, then the checks only IndexedDB can answer: data survives a reopen,
 * a newer database means `newer-idb`, and a `versionchange` closes the connection and notifies.
 *
 * In the Vite dev server: `(await import('/src/lib/ledger/idb-store.ts')).selfTestIdb()`.
 * It logs one line per case and returns the report.
 */
export async function selfTestIdb(
  log: (line: string) => void = (line) => console.log(line),
): Promise<SelfTestReport> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available here')
  const factory = indexedDB
  // The suite is only needed by this dev helper, so it stays out of the engine's chunk.
  const { STORE_CONFORMANCE_CASES, makeAssert, makeResolvers } = await import('./store-conformance')
  const results: SelfTestResult[] = []
  const opened: IdbStore[] = []
  const fresh = async (): Promise<IdbStore> => {
    for (const s of opened.splice(0)) s.close()
    await deleteDb(factory, SELFTEST_DB_NAME)
    const store = new IdbStore({ name: SELFTEST_DB_NAME, factory })
    opened.push(store)
    return store
  }
  const record = (name: string, error?: unknown) => {
    const ok = error === undefined
    const message = ok ? undefined : error instanceof Error ? error.message : String(error)
    results.push({ name, ok, error: message })
    log(ok ? `ok   ${name}` : `FAIL ${name}: ${message}`)
  }

  log(`selfTestIdb: ${typeof navigator === 'undefined' ? 'unknown agent' : navigator.userAgent}`)
  for (const c of STORE_CONFORMANCE_CASES) {
    try {
      await c.run(fresh, makeAssert())
      record(`conformance: ${c.name}`)
    } catch (err) {
      record(`conformance: ${c.name}`, err)
    }
  }

  const idbCases: { name: string; run: () => Promise<void> }[] = [
    {
      name: 'data survives close and reopen',
      run: async () => {
        const a = makeAssert()
        const store = await fresh()
        await store.open()
        await store.commit(
          {
            putMeta: { schema: { version: 3, at: '2026-10-04T00:00:00.000Z' } },
            putEvents: [
              {
                id: 'e1',
                v: 1,
                kind: 'visit',
                ref: 'lesson:t0.l1',
                at: '2026-10-04T00:00:00.000Z',
                tz: 0,
                day: '2026-10-04',
                dev: 'd1',
              },
            ],
          },
          makeResolvers(),
        )
        store.close()
        const again = new IdbStore({ name: SELFTEST_DB_NAME, factory })
        opened.push(again)
        const info = await again.open()
        a.equal(info.schemaVersion, 3, 'schemaVersion after reopen')
        a.equal((await again.readAll()).events.length, 1, 'event count after reopen')
      },
    },
    {
      name: 'a newer database opens read-only as newer-idb',
      run: async () => {
        const a = makeAssert()
        await fresh()
        const raw = await rawOpen(factory, SELFTEST_DB_NAME, IDB_VERSION + 1)
        raw.close()
        const store = new IdbStore({ name: SELFTEST_DB_NAME, factory })
        opened.push(store)
        const info = await store.open()
        a.equal(info.readOnly, true, 'readOnly')
        a.equal(info.reason, 'newer-idb', 'reason')
        let threw = false
        await store.commit({ putMeta: { persist: { checkedAt: 'x', persisted: false } } }, makeResolvers()).catch(() => {
          threw = true
        })
        a.ok(threw, 'commit on a read-only store rejects')
      },
    },
    {
      name: 'versionchange closes the connection and notifies',
      run: async () => {
        const a = makeAssert()
        const store = await fresh()
        await store.open()
        let called = 0
        store.onVersionChange(() => {
          called++
        })
        const raw = await rawOpen(factory, SELFTEST_DB_NAME, IDB_VERSION + 1)
        raw.close()
        a.equal(called, 1, 'versionchange callbacks')
        let threw = false
        await store.readAll().catch(() => {
          threw = true
        })
        a.ok(threw, 'readAll after versionchange rejects (connection closed)')
      },
    },
  ]
  for (const c of idbCases) {
    try {
      await c.run()
      record(c.name)
    } catch (err) {
      record(c.name, err)
    }
  }

  for (const s of opened.splice(0)) s.close()
  await deleteDb(factory, SELFTEST_DB_NAME).catch(() => undefined)
  const failed = results.filter((r) => !r.ok).length
  const report: SelfTestReport = { ok: failed === 0, passed: results.length - failed, failed, results }
  log(`selfTestIdb: ${report.passed} passed, ${report.failed} failed`)
  return report
}
