/**
 * The ledger engine (spec §9.3-9.8, §10): boot, outbox flush, the schema guard, cross-tab messages,
 * export and import (merge or replace), undo, reset, and the end-to-end properties P3 (double import),
 * P5 (two-device merge) and P9 (undo) run through real engines on MemoryStore (Addendum A1, A4).
 */
import { describe, expect, test } from 'bun:test'
import { buildExportV3, serializeExport } from '../../src/lib/ledger/codec'
import { SCHEMA_VERSION } from '../../src/lib/ledger/constants'
import { createEngine, type BootedEngine } from '../../src/lib/ledger/engine'
import { derive } from '../../src/lib/ledger/fold'
import { MemoryStore } from '../../src/lib/ledger/memory-store'
import { mergeLedgers, type Ledger } from '../../src/lib/ledger/merge'
import { OUTBOX_PREFIX, SNAPSHOT_KEY } from '../../src/lib/ledger/names'
import { appendToOutbox, outboxKey, readOutbox } from '../../src/lib/ledger/outbox'
import { stableStringify } from '../../src/lib/ledger/stable'
import type { ChannelMessage, LedgerEvent, StoreTx, VisitEvent, WorkingRecord } from '../../src/lib/ledger/types'
import { forSeeds, ledgerKey, OPS, runOps, evt, SEEDS } from './gen'
import { makeProfile, startTab, tick, T0, type Profile } from './env'

const iso = (ms: number) => new Date(ms).toISOString()

/** An engine on a bare profile (no façade). */
function engineOn(p: Profile, opts: { tabId?: string; schemaVersion?: number; durability?: Parameters<typeof createEngine>[0]['durability']; channel?: boolean } = {}) {
  return createEngine({
    store: p.store,
    storage: p.storage,
    clock: p.clock,
    tabId: opts.tabId ?? 'tab-x',
    device: p.device,
    channelFactory: opts.channel === false ? null : p.bus.factory(),
    schemaVersion: opts.schemaVersion,
    durability: opts.durability ?? null,
  })
}

const visit = (id: string, at = iso(T0), dev = 'device-0'): VisitEvent => ({
  id,
  v: 1,
  kind: 'visit',
  ref: 'lesson:t0.l1',
  at,
  tz: 0,
  day: at.slice(0, 10),
  dev,
})

const working = (key: WorkingRecord['key'], value: WorkingRecord['value'], at = iso(T0), dev = 'device-0'): WorkingRecord => ({ key, value, at, dev })

/** An engine seeded with a ledger, as if that device had used the app. */
async function engineWith(ledger: Ledger, opts: { device?: string; prefix?: string } = {}) {
  const p = makeProfile({ seed: { events: ledger.events, working: ledger.working }, devicePrefix: opts.prefix })
  if (opts.device) p.device = opts.device
  return { p, engine: await engineOn(p, { tabId: `tab-${opts.prefix ?? 'x'}` }) }
}

const ledgerOf = async (e: BootedEngine): Promise<Ledger> => {
  const f = await e.exportV3()
  return { events: f.events, working: f.working }
}

describe('boot (§9.6)', () => {
  test('a fresh database gets its schema and device meta, an empty ledger and a ready status', async () => {
    const p = makeProfile()
    const engine = await engineOn(p)
    const { meta, events } = await p.store.readAll()
    expect(meta.schema).toMatchObject({ version: SCHEMA_VERSION })
    expect(meta.device).toMatchObject({ id: p.device })
    expect(events).toEqual([])
    expect(engine.status()).toEqual({ ready: true, readOnly: false, backend: 'memory' })
    expect(p.storage.touched('kernelspace:v1')).toBe(false)
  })

  test('an existing database keeps its device id, and an older schema is upgraded', async () => {
    const p = makeProfile({ seed: { meta: { schema: { version: 1, at: iso(T0) }, device: { id: 'first-device', createdAt: iso(T0) } } } })
    await engineOn(p)
    const { meta } = await p.store.readAll()
    expect(meta.device?.id).toBe('first-device')
    expect(meta.schema?.version).toBe(SCHEMA_VERSION)
  })

  test('onAggregate replays the latest derive to a late subscriber, then follows every change', async () => {
    const p = makeProfile({ seed: { events: [visit('a')] } })
    const engine = await engineOn(p)
    const seen: number[] = []
    const off = engine.onAggregate((agg) => seen.push(agg.events))
    expect(seen).toEqual([1])
    await engine.append([visit('b')], [])
    expect(seen).toEqual([1, 2])
    off()
    await engine.append([visit('c')], [])
    expect(seen).toEqual([1, 2])
  })

  test('outboxes are flushed at boot: own and a dead tab (>24 h) are removed, a live tab keeps its key', async () => {
    const p = makeProfile()
    const now = iso(T0)
    appendToOutbox(p.storage, 'tab-x', [visit('own')], [working('boot:path', 'full-ramp')], now)
    appendToOutbox(p.storage, 'live', [visit('live')], [], iso(T0 - 60_000))
    appendToOutbox(p.storage, 'dead', [visit('dead')], [], iso(T0 - 25 * 3600_000))
    p.storage.data.set(OUTBOX_PREFIX + 'junk', '{not json')
    const engine = await engineOn(p)
    const ids = (await engine.events()).map((e) => e.id).sort()
    expect(ids).toEqual(['dead', 'live', 'own'])
    expect((await ledgerOf(engine)).working.map((w) => w.key)).toEqual(['boot:path'])
    expect(p.storage.data.has(outboxKey('tab-x'))).toBe(false)
    expect(p.storage.data.has(outboxKey('dead'))).toBe(false)
    expect(p.storage.data.has(OUTBOX_PREFIX + 'junk')).toBe(false)
    expect(readOutbox(p.storage, 'live')?.events).toHaveLength(1)
  })

  test('outbox records are validated like an import: bad ones are dropped, good ones kept', async () => {
    const p = makeProfile()
    const bad = { ...visit('bad'), kind: 'nonsense' } as unknown as LedgerEvent
    const worse = { ...visit('worse'), tz: 9999 } as LedgerEvent
    appendToOutbox(p.storage, 'old-tab', [visit('good'), bad, worse], [], iso(T0))
    const engine = await engineOn(p)
    expect((await engine.events()).map((e) => e.id)).toEqual(['good'])
  })

  test('IndexedDB failing to open falls back to memory, and does not settle the outbox', async () => {
    const p = makeProfile()
    appendToOutbox(p.storage, 'tab-x', [visit('kept')], [], iso(T0))
    class Broken extends MemoryStore {
      override async open(): Promise<never> {
        throw new Error('blocked')
      }
    }
    const engine = await createEngine({
      store: new Broken(),
      fallbackStore: () => new MemoryStore(),
      storage: p.storage,
      clock: p.clock,
      tabId: 'tab-x',
      device: p.device,
      channelFactory: null,
    })
    expect(engine.status()).toMatchObject({ ready: true, readOnly: false, backend: 'memory' })
    expect((await engine.events()).map((e) => e.id)).toEqual(['kept'])
    appendToOutbox(p.storage, 'tab-x', [visit('later')], [], iso(T0)) // the façade writes the outbox before it calls the engine
    await engine.append([visit('later')], [])
    // the outbox is the only durable copy while IndexedDB is gone (§8.6, §9.8)
    expect(readOutbox(p.storage, 'tab-x')?.events.map((e) => e.id).sort()).toEqual(['kept', 'later'])
  })

  test('a commit failing at boot also falls back to memory', async () => {
    const p = makeProfile()
    class FailingCommit extends MemoryStore {
      override async commit(): Promise<never> {
        throw new Error('QuotaExceededError')
      }
    }
    const engine = await createEngine({
      store: new FailingCommit(),
      storage: p.storage,
      clock: p.clock,
      tabId: 't',
      device: p.device,
      channelFactory: null,
    })
    expect(engine.status().backend).toBe('memory')
    expect(engine.status().readOnly).toBe(false)
  })

  test('an append whose commit fails stays pending and in the outbox, and the next commit retries it', async () => {
    const p = makeProfile()
    const engine = await engineOn(p)
    let fail = true
    const commit = p.store.commit.bind(p.store)
    p.store.commit = (tx: StoreTx, r) => (fail ? Promise.reject(new Error('transient')) : commit(tx, r))
    appendToOutbox(p.storage, 'tab-x', [visit('a')], [], iso(T0))
    await engine.append([visit('a')], [])
    expect((await p.store.readAll()).events).toHaveLength(0)
    expect(readOutbox(p.storage, 'tab-x')?.events).toHaveLength(1)
    expect(await engine.events()).toHaveLength(1) // still in memory
    fail = false
    appendToOutbox(p.storage, 'tab-x', [visit('b')], [], iso(T0))
    await engine.append([visit('b')], [])
    expect((await p.store.readAll()).events.map((e) => e.id).sort()).toEqual(['a', 'b'])
    expect(p.storage.data.has(outboxKey('tab-x'))).toBe(false)
  })

  test('durability: persisted() is read at boot (never prompting); persist() is asked once, after the first graded event, at most every 30 days', async () => {
    const calls: string[] = []
    let granted = false
    const durability = {
      persisted: async () => {
        calls.push('persisted')
        return false
      },
      persist: async () => {
        calls.push('persist')
        return granted
      },
    }
    const p = makeProfile()
    const engine = await engineOn(p, { durability })
    expect(calls).toEqual(['persisted'])
    expect(engine.status().persisted).toBe(false)

    await engine.append([visit('v')], []) // a trace event: no request
    expect(calls).toEqual(['persisted'])
    const graded = evt('sim-task', 'sim:sim-kv/a', iso(T0), { provenance: 'practice' }) as LedgerEvent
    await engine.append([graded], [])
    await tick(5)
    expect(calls).toEqual(['persisted', 'persist'])
    expect((await p.store.readAll()).meta.persist).toMatchObject({ persisted: false, requestedAt: iso(T0) })
    await engine.append([evt('sim-task', 'sim:sim-kv/b', iso(T0))], [])
    await tick(5)
    expect(calls.filter((c) => c === 'persist')).toHaveLength(1)

    // a later load within 30 days does not ask again; after 30 days it does
    granted = true
    const soon = await engineOn(p, { durability, tabId: 'tab-2' })
    await soon.append([evt('sim-task', 'sim:sim-kv/c', iso(T0))], [])
    await tick(5)
    expect(calls.filter((c) => c === 'persist')).toHaveLength(1)
    p.clock.advance(31 * 24 * 60)
    const later = await engineOn(p, { durability, tabId: 'tab-3' })
    await later.append([evt('sim-task', 'sim:sim-kv/d', iso(p.clock.ms))], [])
    await tick(5)
    expect(calls.filter((c) => c === 'persist')).toHaveLength(2)
    expect(later.status().persisted).toBe(true)
  })

  test('orphaned snapshot: a notice, the old snapshot copied under a dated key, and no false alarm on a first session', async () => {
    const p = makeProfile()
    const snapshot = { schemaVersion: SCHEMA_VERSION, aggregateVersion: 1, writtenAt: iso(T0), tab: 'old', aggregate: { ...derive([visit('a'), visit('b')]) }, working: [] }
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify(snapshot))
    const engine = await engineOn(p)
    expect(engine.status().cleared).toEqual({ at: iso(T0), orphanKey: 'kernelspace:v2:orphaned:2026-10-04' })
    expect(p.storage.data.get('kernelspace:v2:orphaned:2026-10-04')).toBe(JSON.stringify(snapshot))

    // The snapshot counts events the outbox still holds: nothing was lost, so no notice.
    const q = makeProfile()
    q.storage.data.set(SNAPSHOT_KEY, JSON.stringify(snapshot))
    appendToOutbox(q.storage, 'old-tab', [visit('a'), visit('b')], [], iso(T0))
    expect((await engineOn(q)).status().cleared).toBeUndefined()
    // And a populated database is never "cleared".
    const r = makeProfile({ seed: { events: [visit('a'), visit('b')], meta: { schema: { version: SCHEMA_VERSION, at: iso(T0) } } } })
    r.storage.data.set(SNAPSHOT_KEY, JSON.stringify(snapshot))
    expect((await engineOn(r)).status().cleared).toBeUndefined()
  })
})

describe('schema guard (§9.3, P10)', () => {
  test('a database from a newer schema: read-only, nothing read or written, every call refused', async () => {
    const p = makeProfile({
      seed: { events: [visit('a')], meta: { schema: { version: SCHEMA_VERSION + 1, at: iso(T0) } } },
    })
    let commits = 0
    const commit = p.store.commit.bind(p.store)
    p.store.commit = (tx, r) => {
      commits += 1
      return commit(tx, r)
    }
    appendToOutbox(p.storage, 'tab-x', [visit('queued')], [], iso(T0))
    p.storage.log = []
    const engine = await engineOn(p)
    expect(engine.status()).toMatchObject({ readOnly: true, reason: 'newer-schema', ready: true })

    await engine.append([visit('b')], [working('boot:path', 'x')])
    expect(await engine.reset()).toBeUndefined()
    expect(await engine.undo()).toBe(false)
    expect(await engine.importFile('{}', 'merge')).toMatchObject({ ok: false, error: 'read-only' })
    expect(await engine.previewImport('{}', 'merge')).toMatchObject({ error: 'read-only' })
    expect(commits).toBe(0)
    expect(p.storage.writes()).toEqual([])
    expect(readOutbox(p.storage, 'tab-x')?.events.map((e) => e.id)).toEqual(['queued']) // left for the newer bundle
    expect(p.bus.sent).toEqual([]) // not even a hello
  })

  test('a snapshot from a newer schema also latches the engine', async () => {
    const p = makeProfile()
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }))
    expect((await engineOn(p)).status()).toMatchObject({ readOnly: true, reason: 'snapshot-newer' })
  })

  test('a hello from a newer bundle, and a versionchange, latch it mid-session; older hellos do not', async () => {
    const p = makeProfile()
    const engine = await engineOn(p, { tabId: 'a' })
    const statuses: boolean[] = []
    engine.onAggregate((_a, _w, s) => statuses.push(s.readOnly))
    const older = await engineOn(p, { tabId: 'b', schemaVersion: SCHEMA_VERSION - 1 })
    await tick(5)
    expect(engine.status().readOnly).toBe(false)
    await engineOn(p, { tabId: 'c', schemaVersion: SCHEMA_VERSION + 1 })
    await tick(5)
    expect(engine.status()).toMatchObject({ readOnly: true, reason: 'newer-schema' })
    expect(statuses.at(-1)).toBe(true)
    expect(older.status().readOnly).toBe(true) // it too hears the newer bundle

    const q = makeProfile()
    const e2 = await engineOn(q)
    q.store.simulateVersionChange()
    expect(e2.status()).toMatchObject({ readOnly: true, reason: 'versionchange' })
    const before = (await q.store.readAll()).events.length
    await e2.append([visit('x')], [])
    expect((await q.store.readAll()).events).toHaveLength(before)
  })
})

describe('cross-tab messages (§9.4)', () => {
  test('an append from another tab is folded in; messages that arrive during boot are not lost', async () => {
    const p = makeProfile()
    const a = await engineOn(p, { tabId: 'a' })
    const b = await engineOn(p, { tabId: 'b' })
    await a.append([visit('one')], [working('boot:path', 'serving-first')])
    await tick(5)
    expect((await b.events()).map((e) => e.id)).toEqual(['one'])
    expect((await ledgerOf(b)).working.map((w) => w.value)).toEqual(['serving-first'])

    // A third engine boots while a posts: the append is either in its read or in its queue, never neither.
    const booting = engineOn(p, { tabId: 'c' })
    await a.append([visit('two')], [])
    const c = await booting
    await tick(5)
    expect((await c.events()).map((e) => e.id).sort()).toEqual(['one', 'two'])
  })

  test('invalid events in a message are ignored; a reload re-reads the store', async () => {
    const p = makeProfile()
    const a = await engineOn(p, { tabId: 'a' })
    const raw = p.bus.factory()('x')
    raw.postMessage({ t: 'append', from: 'evil', schemaVersion: SCHEMA_VERSION, events: [{ id: 'bad' }, visit('ok')], working: [{ key: 'nope', value: 1 }] } satisfies Partial<ChannelMessage>)
    await tick(5)
    expect((await a.events()).map((e) => e.id)).toEqual(['ok'])

    await p.store.commit({ putEvents: [visit('from-store')] }, { event: (x) => x, working: (x) => x })
    raw.postMessage({ t: 'reload', from: 'evil', schemaVersion: SCHEMA_VERSION, reason: 'import' })
    await tick(5)
    expect((await a.events()).map((e) => e.id).sort()).toEqual(['from-store'])
  })

  test('without BroadcastChannel the snapshot-key storage event triggers a reload', async () => {
    const p = makeProfile()
    const listeners = new Set<(ev: { key: string | null }) => void>()
    const target = {
      addEventListener: (_t: 'storage', l: (ev: { key: string | null }) => void) => listeners.add(l),
      removeEventListener: (_t: 'storage', l: (ev: { key: string | null }) => void) => listeners.delete(l),
    }
    const engine = await createEngine({
      store: p.store,
      storage: p.storage,
      clock: p.clock,
      tabId: 't',
      device: p.device,
      channelFactory: null,
      storageEvents: target,
    })
    await p.store.commit({ putEvents: [visit('elsewhere')] }, { event: (x) => x, working: (x) => x })
    listeners.forEach((l) => l({ key: 'something-else' }))
    await tick(150)
    expect(await engine.events()).toHaveLength(0)
    listeners.forEach((l) => l({ key: SNAPSHOT_KEY }))
    listeners.forEach((l) => l({ key: SNAPSHOT_KEY })) // coalesced
    await tick(150)
    expect((await engine.events()).map((e) => e.id)).toEqual(['elsewhere'])
    engine.close()
    expect(listeners.size).toBe(0)
  })

  test('append broadcasts everything except scroll positions', async () => {
    const p = makeProfile()
    const engine = await engineOn(p)
    p.bus.sent.length = 0
    await engine.append([], [working('scroll:t0.l1', 40)])
    expect(p.bus.sent.filter((m) => (m as ChannelMessage).t === 'append')).toHaveLength(0)
    await engine.append([visit('v')], [working('scroll:t0.l1', 50), working('settings:codeLang', 'c')])
    const sent = p.bus.sent.filter((m) => (m as ChannelMessage).t === 'append') as Extract<ChannelMessage, { t: 'append' }>[]
    expect(sent).toHaveLength(1)
    expect(sent[0].working.map((w) => w.key)).toEqual(['settings:codeLang'])
  })
})

describe('append', () => {
  test('is idempotent by id, folds once, and resolves conflicts canonically', async () => {
    const p = makeProfile()
    const engine = await engineOn(p)
    const seen: number[] = []
    engine.onAggregate((agg) => seen.push(agg.events))
    await engine.append([visit('a')], [])
    await engine.append([visit('a')], [])
    expect(seen.at(-1)).toBe(1)
    const earlier = visit('a', iso(T0 - 3600_000))
    await engine.append([earlier], [])
    expect((await engine.events())[0].at).toBe(iso(T0 - 3600_000)) // the earlier `at` sorts first, so it wins (§4.8)
    expect((await p.store.readAll()).events[0].at).toBe(iso(T0 - 3600_000))
  })

  test('working records are last-writer-wins', async () => {
    const p = makeProfile()
    const engine = await engineOn(p)
    await engine.append([], [working('boot:path', 'new', iso(T0 + 1000))])
    await engine.append([], [working('boot:path', 'old', iso(T0))])
    expect((await ledgerOf(engine)).working.map((w) => w.value)).toEqual(['new'])
  })

  test('events() filters by kind, ref prefix and time', async () => {
    const p = makeProfile()
    const engine = await engineOn(p)
    await engine.append(
      [
        visit('v1', iso(T0)),
        evt('sim-task', 'sim:sim-kv/a', iso(T0 + 1000)) as LedgerEvent,
        evt('complete', 'lesson:t0.l2', iso(T0 + 2000)) as LedgerEvent,
      ],
      [],
    )
    expect((await engine.events({ kinds: ['visit', 'complete'] })).map((e) => e.id).length).toBe(2)
    expect((await engine.events({ refPrefix: 'lesson:' })).length).toBe(2)
    expect((await engine.events({ since: iso(T0 + 1500) })).map((e) => e.kind)).toEqual(['complete'])
    const all = await engine.events()
    all[0].ref = 'lesson:mutated' as never // a copy: the engine's memory is untouched
    expect((await engine.events())[0].ref).toBe('lesson:t0.l1')
    expect(await engine.storageEstimate()).toMatchObject({ events: 3 })
  })
})

/* ------------------------------------------------------------------ */
/* Export, import, undo, reset                                          */
/* ------------------------------------------------------------------ */

describe('export v3 (§10.1)', () => {
  test('carries events, working, components, extras and records lastExport', async () => {
    const p = makeProfile({
      seed: {
        events: [visit('a')],
        working: [working('boot:path', 'full-ramp')],
        components: [{ sha256: 'ab'.repeat(32), labId: 'lab-a', size: 3, addedAt: iso(T0), bytes: new Uint8Array([1, 2, 3]).buffer }],
      },
    })
    p.storage.data.set('kernelspace:capstone:draft:s2', 'draft text')
    p.storage.data.set('kernelspace:capstone:flags', JSON.stringify({ hints: true, optimizer: false }))
    p.storage.data.set('kernelspace:leaderboard-personal:v1', JSON.stringify({ benchmarkVersion: 'v1', overallGoodput: 5 }))
    p.storage.data.set('kernelspace:v1', 'old')
    const engine = await engineOn(p)
    const file = await engine.exportV3()
    expect(file).toMatchObject({ format: 'kernelspace-progress', version: 3, schemaVersion: SCHEMA_VERSION, device: p.device, exportedAt: iso(T0) })
    expect(file.events.map((e) => e.id)).toEqual(['a'])
    expect(file.components.map((c) => c.sha256)).toEqual(['ab'.repeat(32)])
    expect(file.components[0].bytesB64).toBeUndefined()
    expect(file.extras).toEqual({
      capstoneDrafts: { 'kernelspace:capstone:draft:s2': 'draft text' },
      capstoneFlags: { hints: true, optimizer: false },
      leaderboardPersonal: { benchmarkVersion: 'v1', overallGoodput: 5 },
    })
    expect((await engine.exportV3({ includeComponentBytes: true })).components[0].bytesB64).toBe('AQID')
    expect((await p.store.readAll()).meta.lastExport).toMatchObject({ events: 1, at: iso(T0) })
    expect(engine.status().lastExportAt).toBe(iso(T0))
    expect(JSON.stringify(file)).not.toContain('"old"') // kernelspace:v1 is never exported
  })
})

describe('import (§10.3) and preview (§10.5)', () => {
  test('refuses an older export with the Addendum A1 message, and other bad input', async () => {
    const engine = await engineOn(makeProfile())
    expect(await engine.importFile(JSON.stringify({ version: 2, lessons: {}, xp: 0 }), 'merge')).toMatchObject({
      ok: false,
      error: 'older-export',
      detail: "this export is from an earlier version of kernelspace and can't be imported",
    })
    expect(await engine.importFile('{', 'merge')).toMatchObject({ ok: false, error: 'parse' })
    expect(await engine.importFile(JSON.stringify({ format: 'kernelspace-progress', version: 3, schemaVersion: SCHEMA_VERSION + 1 }), 'merge')).toMatchObject({ ok: false, error: 'newer-schema' })
    expect(await engine.previewImport(JSON.stringify({ version: 1, lessons: {}, xp: 0 }), 'merge')).toMatchObject({ error: 'older-export' })
  })

  test('preview describes what merge and replace would do, without writing', async () => {
    const theirs = await engineWith({ events: [visit('shared'), visit('only-theirs', iso(T0 + 1000), 'dev-b')], working: [working('boot:path', 'theirs', iso(T0 + 5000), 'dev-b')] }, { prefix: 'b-' })
    const file = JSON.stringify(await theirs.engine.exportV3())
    const mine = await engineWith({ events: [visit('shared'), visit('only-mine', iso(T0 + 2000), 'a-0')], working: [working('boot:path', 'mine', iso(T0))] }, { prefix: 'a-' })
    const before = JSON.stringify(await ledgerOf(mine.engine))

    const merge = await mine.engine.previewImport(file, 'merge')
    expect(merge).toMatchObject({ mode: 'merge', fileEvents: 2, newEvents: 1, workingChanges: 1, format: { kind: 'export-v3' } })
    const replace = await mine.engine.previewImport(file, 'replace')
    expect(replace).toMatchObject({ mode: 'replace', newEvents: 2 })
    expect((replace as { warnings: string[] }).warnings.join(' ')).toMatch(/drops 1 events/)
    expect(JSON.stringify(await ledgerOf(mine.engine))).toBe(before)
    expect(mine.engine.status().undo).toBeUndefined()
  })

  test('merge unions events, working is last-writer-wins, components union, and an undo checkpoint is written', async () => {
    const theirs = await engineWith({ events: [visit('shared'), visit('only-theirs', iso(T0 + 1000), 'dev-b')], working: [working('boot:path', 'theirs', iso(T0 + 5000), 'dev-b')] }, { prefix: 'b-' })
    const file = JSON.stringify(await theirs.engine.exportV3())
    const mine = await engineWith({ events: [visit('shared'), visit('only-mine', iso(T0 + 2000))], working: [working('boot:path', 'mine', iso(T0))] }, { prefix: 'a-' })
    const result = await mine.engine.importFile(file, 'merge')
    expect(result).toEqual({ ok: true, mode: 'merge', added: 1, removed: 0, undoAvailable: true })
    const l = await ledgerOf(mine.engine)
    expect(l.events.map((e) => e.id).sort()).toEqual(['only-mine', 'only-theirs', 'shared'])
    expect(l.working.map((w) => w.value)).toEqual(['theirs'])
    expect(mine.engine.status().undo).toMatchObject({ reason: 'import-merge' })
    expect((await mine.p.store.readCheckpoint())?.events.map((e) => e.id).sort()).toEqual(['only-mine', 'shared'])
  })

  test('replace makes the ledger exactly the file, and keeps components', async () => {
    const theirs = await engineWith({ events: [visit('t1', iso(T0), 'dev-b')], working: [working('boot:week', { w: 1 }, iso(T0), 'dev-b')] }, { prefix: 'b-' })
    const file = JSON.stringify(await theirs.engine.exportV3())
    const mine = await engineWith({ events: [visit('m1'), visit('m2')], working: [working('boot:path', 'mine')] }, { prefix: 'a-' })
    await mine.p.store.commit({ putComponents: [{ sha256: 'cd'.repeat(32), labId: 'lab-a', size: 1, addedAt: iso(T0) }] }, { event: (x) => x, working: (x) => x })
    expect(await mine.engine.importFile(file, 'replace')).toEqual({ ok: true, mode: 'replace', added: 1, removed: 2, undoAvailable: true })
    const l = await ledgerOf(mine.engine)
    expect(l.events.map((e) => e.id)).toEqual(['t1'])
    expect(l.working.map((w) => w.key)).toEqual(['boot:week'])
    expect((await mine.p.store.readAll()).components.map((c) => c.sha256)).toEqual(['cd'.repeat(32)])
  })

  test('extras: merge fills missing drafts and ORs flags; replace overwrites what the file carries; foreign keys are never written', async () => {
    const src = makeProfile({ devicePrefix: 'b-' })
    src.storage.data.set('kernelspace:capstone:draft:s1', 'theirs-1')
    src.storage.data.set('kernelspace:capstone:draft:s2', 'theirs-2')
    src.storage.data.set('kernelspace:capstone:flags', JSON.stringify({ hints: false, optimizer: true }))
    src.storage.data.set('kernelspace:leaderboard-personal:v1', JSON.stringify({ benchmarkVersion: 'v1', overallGoodput: 9 }))
    const file = await (await engineOn(src)).exportV3()
    file.extras.capstoneDrafts['kernelspace:v1'] = 'smuggled'
    const text = serializeExport(file)

    const dst = makeProfile({ devicePrefix: 'a-' })
    dst.storage.data.set('kernelspace:capstone:draft:s1', 'mine-1')
    dst.storage.data.set('kernelspace:capstone:flags', JSON.stringify({ hints: true, optimizer: false }))
    dst.storage.data.set('kernelspace:leaderboard-personal:v1', JSON.stringify({ benchmarkVersion: 'v1', overallGoodput: 3 }))
    const engine = await engineOn(dst)
    await engine.importFile(text, 'merge')
    expect(dst.storage.data.get('kernelspace:capstone:draft:s1')).toBe('mine-1')
    expect(dst.storage.data.get('kernelspace:capstone:draft:s2')).toBe('theirs-2')
    expect(JSON.parse(dst.storage.data.get('kernelspace:capstone:flags')!)).toEqual({ hints: true, optimizer: true })
    expect(JSON.parse(dst.storage.data.get('kernelspace:leaderboard-personal:v1')!).overallGoodput).toBe(9)
    expect(dst.storage.data.has('kernelspace:v1')).toBe(false)

    await engine.importFile(text, 'replace')
    expect(dst.storage.data.get('kernelspace:capstone:draft:s1')).toBe('theirs-1')
    expect(JSON.parse(dst.storage.data.get('kernelspace:capstone:flags')!)).toEqual({ hints: false, optimizer: true })
    expect(dst.storage.touched('kernelspace:v1')).toBe(false)
  })

  test('an importing tab tells the others to reload; the other tab then matches', async () => {
    const theirs = await engineWith({ events: [visit('t1', iso(T0), 'dev-b')], working: [] }, { prefix: 'b-' })
    const file = JSON.stringify(await theirs.engine.exportV3())
    const p = makeProfile()
    const a = await engineOn(p, { tabId: 'a' })
    const b = await engineOn(p, { tabId: 'b' })
    await a.append([visit('mine')], [])
    await tick(5)
    await a.importFile(file, 'replace')
    await tick(5)
    expect((await b.events()).map((e) => e.id)).toEqual(['t1'])
    expect(b.status().undo).toMatchObject({ reason: 'import-replace' })
  })
})

describe('undo (§10.4, P9)', () => {
  test('merge import, local work, undo: checkpoint ∪ local-after-import; the file is gone', async () => {
    const theirs = await engineWith({ events: [visit('f1', iso(T0), 'dev-b'), visit('shared')], working: [working('settings:codeLang', 'rust', iso(T0 + 9000), 'dev-b')] }, { prefix: 'b-' })
    const file = JSON.stringify(await theirs.engine.exportV3())
    const mine = await engineWith({ events: [visit('shared'), visit('m1', iso(T0 + 100))], working: [working('settings:codeLang', 'c', iso(T0))] }, { prefix: 'a-' })
    await mine.engine.importFile(file, 'merge')
    p_clock(mine.p).advance(10)
    await mine.engine.append([visit('local-after', iso(mine.p.clock.ms))], [{ key: 'boot:path', value: 'mine', at: iso(mine.p.clock.ms), dev: mine.p.device }])
    expect(await mine.engine.undo()).toBe(true)
    const l = await ledgerOf(mine.engine)
    expect(l.events.map((e) => e.id).sort()).toEqual(['local-after', 'm1', 'shared'])
    // working: the checkpoint's record comes back; this device's newer write is kept
    expect(Object.fromEntries(l.working.map((w) => [w.key, w.value]))).toEqual({ 'settings:codeLang': 'c', 'boot:path': 'mine' })
    expect(mine.engine.status().undo).toBeUndefined()
    expect(await mine.engine.undo()).toBe(false) // one level
    expect(await mine.p.store.readCheckpoint()).toBeUndefined()
  })

  test('replace import then undo restores the previous ledger plus work done since', async () => {
    const theirs = await engineWith({ events: [visit('f1', iso(T0), 'dev-b')], working: [] }, { prefix: 'b-' })
    const file = JSON.stringify(await theirs.engine.exportV3())
    const mine = await engineWith({ events: [visit('m1'), visit('m2')], working: [working('boot:path', 'mine')] }, { prefix: 'a-' })
    await mine.engine.importFile(file, 'replace')
    p_clock(mine.p).advance(10)
    await mine.engine.append([visit('local', iso(mine.p.clock.ms))], [])
    await mine.engine.undo()
    expect((await mine.engine.events()).map((e) => e.id).sort()).toEqual(['local', 'm1', 'm2'])
    expect((await ledgerOf(mine.engine)).working.map((w) => w.key)).toEqual(['boot:path'])
  })

  test('reset then undo restores everything; the checkpoint survives a reload', async () => {
    const mine = await engineWith({ events: [visit('m1'), visit('m2')], working: [working('boot:path', 'mine')] }, { prefix: 'a-' })
    await mine.engine.reset()
    expect(await mine.engine.events()).toEqual([])
    expect(mine.engine.status().undo).toMatchObject({ reason: 'reset' })
    mine.engine.close()
    const reloaded = await engineOn(mine.p, { tabId: 'tab-2' })
    expect(reloaded.status().undo).toMatchObject({ reason: 'reset' })
    expect(await reloaded.undo()).toBe(true)
    expect((await reloaded.events()).map((e) => e.id).sort()).toEqual(['m1', 'm2'])
    expect((await ledgerOf(reloaded)).working).toHaveLength(1)
  })

  test('a second import replaces the checkpoint (one level only)', async () => {
    const f1 = await engineWith({ events: [visit('f1', iso(T0), 'dev-b')], working: [] }, { prefix: 'b-' })
    const f2 = await engineWith({ events: [visit('f2', iso(T0), 'dev-c')], working: [] }, { prefix: 'c-' })
    const mine = await engineWith({ events: [visit('m1')], working: [] }, { prefix: 'a-' })
    await mine.engine.importFile(JSON.stringify(await f1.engine.exportV3()), 'merge')
    await mine.engine.importFile(JSON.stringify(await f2.engine.exportV3()), 'merge')
    await mine.engine.undo()
    expect((await mine.engine.events()).map((e) => e.id).sort()).toEqual(['f1', 'm1'])
  })

  test('reset leaves components, never touches kernelspace:v1, and removes the snapshot and every outbox', async () => {
    const p = makeProfile({ seed: { events: [visit('a')], components: [{ sha256: 'ab'.repeat(32), labId: 'l', size: 1, addedAt: iso(T0) }] } })
    p.storage.data.set('kernelspace:v1', 'legacy-value')
    p.storage.data.set(SNAPSHOT_KEY, '{}')
    appendToOutbox(p.storage, 'other-tab', [visit('queued')], [], iso(T0))
    const engine = await engineOn(p)
    p.storage.log = []
    await engine.reset()
    expect(p.storage.data.has(SNAPSHOT_KEY)).toBe(false)
    expect([...p.storage.data.keys()].filter((k) => k.startsWith(OUTBOX_PREFIX))).toEqual([])
    expect(p.storage.touched('kernelspace:v1')).toBe(false)
    expect(p.storage.data.get('kernelspace:v1')).toBe('legacy-value')
    expect((await p.store.readAll()).components).toHaveLength(1)
  })
})

const p_clock = (p: Profile) => p.clock

/* ------------------------------------------------------------------ */
/* End-to-end properties through the engine (P3, P5, P9)                */
/* ------------------------------------------------------------------ */

function exportText(l: Ledger, device: string): string {
  return serializeExport(buildExportV3({ ...l, device, exportedAt: '2026-10-04T12:00:00.000Z' }))
}

describe('P3 double import, through the engine', () => {
  test('merge twice is merge once; replace twice is replace once', async () => {
    const seeds = SEEDS
    const runs: Promise<void>[] = []
    forSeeds((ctx) => {
      const local = ctx.device()
      const remote = ctx.device()
      runOps(local, 15)
      runOps(remote, OPS)
      runs.push(
        (async () => {
          const text = exportText(remote.ledger(), 'remote')
          const merged = await engineWith(local.ledger(), { prefix: 'm-' })
          const first = await merged.engine.importFile(text, 'merge')
          const afterFirst = ledgerKey(await ledgerOf(merged.engine))
          const second = await merged.engine.importFile(text, 'merge')
          if (!first.ok || !second.ok) throw new Error('import failed')
          expect(second.added).toBe(0)
          expect(ledgerKey(await ledgerOf(merged.engine))).toBe(afterFirst)
          expect(afterFirst).toBe(ledgerKey(mergeLedgers(local.ledger(), remote.ledger())))

          const replaced = await engineWith(local.ledger(), { prefix: 'r-' })
          await replaced.engine.importFile(text, 'replace')
          const once = ledgerKey(await ledgerOf(replaced.engine))
          await replaced.engine.importFile(text, 'replace')
          expect(ledgerKey(await ledgerOf(replaced.engine))).toBe(once)
          expect(once).toBe(ledgerKey(remote.ledger()))
        })(),
      )
    }, seeds)
    await Promise.all(runs)
  })
})

describe('P5 two-device merge, through the engine', () => {
  test('exchanging exports in both directions converges, in any order, with three devices too', async () => {
    const seeds = SEEDS
    const runs: Promise<void>[] = []
    forSeeds((ctx) => {
      const base = ctx.device()
      runOps(base, 10)
      const [a, b, c] = [ctx.device(), ctx.device(), ctx.device()]
      for (const d of [a, b, c]) d.adopt(base.ledger(), base.ms)
      runOps(a, OPS)
      runOps(b, OPS)
      runOps(c, 10)
      runs.push(
        (async () => {
          const ea = await engineWith(a.ledger(), { prefix: 'a-' })
          const eb = await engineWith(b.ledger(), { prefix: 'b-' })
          const ec = await engineWith(c.ledger(), { prefix: 'c-' })
          const fileA = JSON.stringify(await ea.engine.exportV3())
          const fileB = JSON.stringify(await eb.engine.exportV3())
          await ea.engine.importFile(JSON.stringify(await eb.engine.exportV3()), 'merge')
          await eb.engine.importFile(fileA, 'merge')
          expect(ledgerKey(await ledgerOf(ea.engine))).toBe(ledgerKey(await ledgerOf(eb.engine)))
          expect(ledgerKey(await ledgerOf(ea.engine))).toBe(ledgerKey(mergeLedgers(a.ledger(), b.ledger())))
          // the third device joins in a different order and still lands on the same ledger
          await ec.engine.importFile(fileB, 'merge')
          await ec.engine.importFile(JSON.stringify(await ea.engine.exportV3()), 'merge')
          await ea.engine.importFile(JSON.stringify(await ec.engine.exportV3()), 'merge')
          await eb.engine.importFile(JSON.stringify(await ec.engine.exportV3()), 'merge')
          const key = ledgerKey(await ledgerOf(ea.engine))
          expect(ledgerKey(await ledgerOf(eb.engine))).toBe(key)
          expect(ledgerKey(await ledgerOf(ec.engine))).toBe(key)
          // the derived numbers are those of the pure merge
          expect(stableStringify(derive((await ledgerOf(ea.engine)).events))).toBe(stableStringify(derive(mergeLedgers(mergeLedgers(a.ledger(), b.ledger()), c.ledger()).events)))
        })(),
      )
    }, seeds)
    await Promise.all(runs)
  })

  test('two façades on two devices converge after exchanging exports (the real write path)', async () => {
    const deviceA = makeProfile({ devicePrefix: 'a-' })
    const deviceB = makeProfile({ devicePrefix: 'b-', tz: 330 })
    const a = startTab(deviceA)
    const b = startTab(deviceB)
    for (const t of [a, b]) t.progress.getState().markLessonStatus('t0.l1', 'done')
    a.progress.getState().recordQuizScore('t0.l1', 1)
    a.progress.getState().recordSimTask('sim-kv', 'a')
    b.progress.getState().recordSimTask('sim-kv', 'b')
    b.progress.getState().recordLabResult('lab-a', ['c1', 'c2', 'c3', 'c4'], 4)
    a.progress.getState().updateSettings({ codeLang: 'java' })
    deviceB.clock.advance(5)
    b.progress.getState().updateSettings({ codeLang: 'rust' })
    await a.progress.controls.flush()
    await b.progress.controls.flush()
    const ea = await a.progress.controls.engine()
    const eb = await b.progress.controls.engine()
    const fileA = JSON.stringify(await ea.exportV3())
    const fileB = JSON.stringify(await eb.exportV3())
    await ea.importFile(fileB, 'merge')
    await eb.importFile(fileA, 'merge')
    const sa = a.progress.getState()
    const sb = b.progress.getState()
    expect(sa.lessons['t0.l1']?.status).toBe('done') // both completed it: one fact, one 100 XP
    expect(sa.xp).toBe(100 + 40 + 60 + 60 + 200)
    expect(JSON.stringify({ ...sa, ledger: 0, acks: 0 }, replacer)).toBe(JSON.stringify({ ...sb, ledger: 0, acks: 0 }, replacer))
    expect(sa.settings.codeLang).toBe('rust') // last writer wins
    expect(ledgerKey(await ledgerOf(ea))).toBe(ledgerKey(await ledgerOf(eb)))
  })
})

const replacer = (_k: string, v: unknown) => (typeof v === 'function' ? undefined : v)
