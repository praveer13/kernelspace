/**
 * The shared `LedgerStore` conformance suite (spec §7, P13).
 *
 * It takes the store factory and an assert object, so it has no test-runner dependency:
 * `bun test` drives it against MemoryStore (tests/ledger/store.test.ts) and `selfTestIdb()`
 * drives it against IdbStore in a real browser.
 *
 * The suite brings its own conflict resolvers, a small copy of the canonical rules (§4.8, §5).
 * The adapters import no fold, merge or codec code (only the pure JSON helpers in `stable.ts`), and neither does this file.
 */

import { stableJson } from './stable'
import type {
  Checkpoint,
  ComponentRecord,
  ConflictResolvers,
  LedgerEvent,
  LedgerStore,
  VisitEvent,
  WorkingRecord,
} from './types'

export interface ConformanceAssert {
  ok(value: unknown, message: string): void
  equal(actual: unknown, expected: unknown, message: string): void
  /** Structural equality of JSON-like values (key order ignored). */
  deepEqual(actual: unknown, expected: unknown, message: string): void
}

export type MakeStore = () => LedgerStore | Promise<LedgerStore>

export interface ConformanceCase {
  name: string
  run(makeStore: MakeStore, assert: ConformanceAssert): Promise<void>
}

/** An assert that throws `Error(message)`; fine for the browser harness and for any runner. */
export function makeAssert(): ConformanceAssert {
  const fail = (message: string, detail?: string): never => {
    throw new Error(detail ? `${message} (${detail})` : message)
  }
  return {
    ok: (value, message) => {
      if (!value) fail(message)
    },
    equal: (actual, expected, message) => {
      if (actual !== expected) fail(message, `expected ${String(expected)}, got ${String(actual)}`)
    },
    deepEqual: (actual, expected, message) => {
      const a = stableJson(actual)
      const b = stableJson(expected)
      if (a !== b) fail(message, `expected ${b}, got ${a}`)
    },
  }
}

/** Canonical rules, as the engine would inject them: smaller stable JSON wins; working is last-writer-wins. */
export function makeResolvers(): ConflictResolvers {
  return {
    event: (existing, incoming) => (stableJson(incoming) < stableJson(existing) ? incoming : existing),
    working: (existing, incoming) => {
      if (incoming.at !== existing.at) return incoming.at > existing.at ? incoming : existing
      if (incoming.dev !== existing.dev) return incoming.dev > existing.dev ? incoming : existing
      return stableJson(incoming) > stableJson(existing) ? incoming : existing
    },
  }
}

const DAY = '2026-10-04'
const T0 = '2026-10-04T08:00:00.000Z'

function visit(id: string, over: Partial<VisitEvent> = {}): VisitEvent {
  return { id, v: 1, kind: 'visit', ref: 'lesson:t0.l1', at: T0, tz: 0, day: DAY, dev: 'dev-a', ...over }
}

function work(key: WorkingRecord['key'], value: WorkingRecord['value'], at: string, dev = 'dev-a'): WorkingRecord {
  return { key, value, at, dev }
}

function sortedIds(events: LedgerEvent[]): string[] {
  return events.map((e) => e.id).sort()
}

async function withStore(makeStore: MakeStore, fn: (store: LedgerStore) => Promise<void>): Promise<void> {
  const store = await makeStore()
  try {
    await store.open()
    await fn(store)
  } finally {
    store.close()
  }
}

async function rejects(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise
    return false
  } catch {
    return true
  }
}

const resolvers = makeResolvers()
const throwing: ConflictResolvers = {
  event: () => {
    throw new Error('resolver boom')
  },
  working: () => {
    throw new Error('resolver boom')
  },
}

export const STORE_CONFORMANCE_CASES: ConformanceCase[] = [
  {
    name: 'a fresh store reports no schema and reads empty',
    run: async (makeStore, a) => {
      const store = await makeStore()
      try {
        const info = await store.open()
        a.equal(info.backend, store.backend, 'info.backend matches store.backend')
        a.equal(info.schemaVersion, null, 'fresh schemaVersion is null')
        a.equal(info.readOnly, false, 'fresh store is writable')
        const all = await store.readAll()
        a.deepEqual(all, { events: [], working: [], components: [], meta: {} }, 'fresh contents are empty')
        a.equal(await store.readCheckpoint(), undefined, 'no checkpoint')
        a.equal(await store.readComponentBytes('nope'), undefined, 'no component bytes')
      } finally {
        store.close()
      }
    },
  },
  {
    name: 'an empty commit is a no-op',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        const r = await store.commit({}, resolvers)
        a.deepEqual(r, { eventIds: [], workingKeys: [], metaClaimed: [] }, 'empty result')
      }),
  },
  {
    name: 'putEvents is idempotent',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        const e = visit('e1')
        const first = await store.commit({ putEvents: [e] }, resolvers)
        a.deepEqual(first.eventIds, ['e1'], 'first put reports the id')
        const second = await store.commit({ putEvents: [e, structuredClone(e)] }, resolvers)
        a.deepEqual(second.eventIds, [], 'identical re-put changes nothing')
        const all = await store.readAll()
        a.deepEqual(all.events, [e], 'exactly one stored event')
      }),
  },
  {
    name: 'same-id conflicts resolve canonically, in either order',
    run: async (makeStore, a) => {
      const early = visit('x', { at: '2026-10-04T07:00:00.000Z' })
      const late = visit('x', { at: '2026-10-04T09:00:00.000Z' })
      // `at` sorts first among the keys, so the earlier instant is the canonical one.
      const winner = resolvers.event(late, early)
      a.equal(winner, early, 'test resolver prefers the earlier at')
      for (const order of [
        [early, late],
        [late, early],
      ]) {
        await withStore(makeStore, async (store) => {
          const r1 = await store.commit({ putEvents: [order[0]] }, resolvers)
          a.deepEqual(r1.eventIds, ['x'], 'first put creates')
          const r2 = await store.commit({ putEvents: [order[1]] }, resolvers)
          const replaced = order[0] === late
          a.deepEqual(r2.eventIds, replaced ? ['x'] : [], 'reports a replacement only when the stored record changed')
          const all = await store.readAll()
          a.deepEqual(all.events, [early], 'the canonical record is stored regardless of arrival order')
        })
      }
    },
  },
  {
    name: 'duplicate ids inside one batch resolve to the canonical record',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        const early = visit('x', { at: '2026-10-04T07:00:00.000Z' })
        const late = visit('x', { at: '2026-10-04T09:00:00.000Z' })
        const r = await store.commit({ putEvents: [late, early, structuredClone(late)] }, resolvers)
        a.deepEqual(r.eventIds, ['x'], 'one id reported once')
        a.deepEqual((await store.readAll()).events, [early], 'canonical record stored')
      }),
  },
  {
    name: 'working records are last-writer-wins',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        const k = 'settings:codeLang' as const
        const older = work(k, 'rust', '2026-10-04T08:00:00.000Z')
        const newer = work(k, 'zig', '2026-10-04T08:00:01.000Z')
        await store.commit({ putWorking: [newer] }, resolvers)
        const r1 = await store.commit({ putWorking: [older] }, resolvers)
        a.deepEqual(r1.workingKeys, [], 'an older write does not replace')
        a.deepEqual((await store.readAll()).working, [newer], 'newer kept')
        const r2 = await store.commit({ putWorking: [older, newer] }, resolvers)
        a.deepEqual(r2.workingKeys, [], 'a batch with the same winner changes nothing')
        const newest = work(k, 'c', '2026-10-04T08:00:02.000Z')
        const r3 = await store.commit({ putWorking: [newest] }, resolvers)
        a.deepEqual(r3.workingKeys, [k], 'a newer write replaces')
        a.deepEqual((await store.readAll()).working, [newest], 'newest kept')
        // Same instant: the device id breaks the tie, then the larger JSON.
        const tieA = work('fw:doc', 'a', T0, 'dev-a')
        const tieB = work('fw:doc', 'b', T0, 'dev-b')
        await store.commit({ putWorking: [tieB, tieA] }, resolvers)
        const doc = (await store.readAll()).working.find((w) => w.key === 'fw:doc')
        a.deepEqual(doc, tieB, 'the larger device id wins a tie on at')
      }),
  },
  {
    name: 'IfAbsent variants claim once and never overwrite',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        const first = { at: T0, via: 'auto' as const, bytes: 1, claimedBy: 'tab-1' }
        const second = { at: T0, via: 'manual' as const, bytes: 2, claimedBy: 'tab-2' }
        const r1 = await store.commit({ putMetaIfAbsent: { backup: first } }, resolvers)
        a.deepEqual(r1.metaClaimed, ['backup'], 'first claim wins')
        const r2 = await store.commit({ putMetaIfAbsent: { backup: second } }, resolvers)
        a.deepEqual(r2.metaClaimed, [], 'second claim is refused')
        a.deepEqual((await store.readAll()).meta.backup, first, 'the first claim is kept')

        const w1 = work('boot:path', 'full-ramp', T0)
        const w2 = work('boot:path', 'rust-systems', '2026-10-05T08:00:00.000Z')
        const rw1 = await store.commit({ putWorkingIfAbsent: [w1] }, resolvers)
        a.deepEqual(rw1.workingKeys, ['boot:path'], 'absent working record is written')
        const rw2 = await store.commit({ putWorkingIfAbsent: [w2] }, resolvers)
        a.deepEqual(rw2.workingKeys, [], 'present working record is not overwritten')
        a.deepEqual((await store.readAll()).working, [w1], 'first working record kept')

        // A key written by putWorking in the same commit counts as present.
        const both = await store.commit(
          { putWorking: [work('boot:week', 1, T0)], putWorkingIfAbsent: [work('boot:week', 2, T0)] },
          resolvers,
        )
        a.deepEqual(both.workingKeys, ['boot:week'], 'one write for the key')
        const week = (await store.readAll()).working.find((w) => w.key === 'boot:week')
        a.equal(week?.value, 1, 'putWorking wins over putWorkingIfAbsent in one commit')
      }),
  },
  {
    name: 'a throwing resolver leaves no partial write',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        const existing = visit('keep', { at: '2026-10-04T07:00:00.000Z' })
        const meta = { schema: { version: 3, at: T0 } }
        await store.commit({ putEvents: [existing], putMeta: meta }, resolvers)
        const before = await store.readAll()
        const conflicting = visit('keep', { at: '2026-10-04T06:00:00.000Z' })
        const tx = {
          clear: ['working' as const],
          deleteEventIds: ['other'],
          putEvents: [visit('fresh'), conflicting],
          putWorking: [work('boot:path', 'x', T0)],
          putMeta: { persist: { checkedAt: T0, persisted: true } },
          putComponents: [{ sha256: 'aa', labId: 'lab-a', size: 1, addedAt: T0 } satisfies ComponentRecord],
          putCheckpoint: {
            id: 'undo',
            reason: 'reset',
            at: T0,
            events: [],
            working: [],
            fileEventIds: [],
            fileWorkingKeys: [],
          } satisfies Checkpoint,
        }
        a.ok(await rejects(store.commit(tx, throwing)), 'commit rejects when a resolver throws')
        const after = await store.readAll()
        a.deepEqual(after, before, 'stored contents are unchanged')
        a.equal(await store.readCheckpoint(), undefined, 'no checkpoint was written')
      }),
  },
  {
    name: 'clear then put replaces a store; other stores are untouched',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        const comp: ComponentRecord = { sha256: 'bb', labId: 'lab-a', size: 3, addedAt: T0 }
        await store.commit(
          {
            putEvents: [visit('e1'), visit('e2')],
            putWorking: [work('boot:path', 'x', T0)],
            putComponents: [comp],
            putMeta: { device: { id: 'd', createdAt: T0 } },
          },
          resolvers,
        )
        const r = await store.commit({ clear: ['events', 'working'], putEvents: [visit('e3')] }, resolvers)
        a.deepEqual(r.eventIds, ['e3'], 'only the new event is reported')
        const all = await store.readAll()
        a.deepEqual(sortedIds(all.events), ['e3'], 'events were replaced')
        a.deepEqual(all.working, [], 'working was cleared')
        a.deepEqual(all.components, [comp], 'components survived')
        a.deepEqual(all.meta.device, { id: 'd', createdAt: T0 }, 'meta survived')
      }),
  },
  {
    name: 'order is clear, deletes, puts',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        await store.commit({ putEvents: [visit('a'), visit('b'), visit('c')] }, resolvers)
        await store.commit(
          { clear: ['events'], deleteEventIds: ['b'], putEvents: [visit('b'), visit('d')] },
          resolvers,
        )
        a.deepEqual(sortedIds((await store.readAll()).events), ['b', 'd'], 'put after delete after clear')
      }),
  },
  {
    name: 'deletes remove events, working records, meta and the checkpoint',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        const checkpoint: Checkpoint = {
          id: 'undo',
          reason: 'import-merge',
          at: T0,
          events: [visit('old')],
          working: [],
          fileEventIds: ['f1'],
          fileWorkingKeys: [],
        }
        await store.commit(
          {
            putEvents: [visit('a'), visit('b')],
            putWorking: [work('boot:path', 'x', T0), work('boot:week', 1, T0)],
            putMeta: { lastExport: { at: T0, events: 2 }, persist: { checkedAt: T0, persisted: false } },
            putCheckpoint: checkpoint,
          },
          resolvers,
        )
        a.deepEqual(await store.readCheckpoint(), checkpoint, 'checkpoint round-trips')
        await store.commit(
          { deleteEventIds: ['a', 'missing'], deleteWorkingKeys: ['boot:path'], deleteMeta: ['persist'], deleteCheckpoint: true },
          resolvers,
        )
        const all = await store.readAll()
        a.deepEqual(sortedIds(all.events), ['b'], 'event deleted')
        a.deepEqual(all.working.map((w) => w.key), ['boot:week'], 'working record deleted')
        a.deepEqual(Object.keys(all.meta), ['lastExport'], 'meta key deleted')
        a.equal(await store.readCheckpoint(), undefined, 'checkpoint deleted')
      }),
  },
  {
    name: 'clearing checkpoints and components works',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        await store.commit(
          {
            putComponents: [{ sha256: 'cc', labId: 'lab-a', size: 1, addedAt: T0 }],
            putCheckpoint: {
              id: 'undo',
              reason: 'reset',
              at: T0,
              events: [],
              working: [],
              fileEventIds: [],
              fileWorkingKeys: [],
            },
          },
          resolvers,
        )
        await store.commit({ clear: ['components', 'checkpoints'] }, resolvers)
        a.deepEqual((await store.readAll()).components, [], 'components cleared')
        a.equal(await store.readCheckpoint(), undefined, 'checkpoint cleared')
      }),
  },
  {
    name: 'component bytes load on demand and readAll returns metadata only',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        const bytes = new Uint8Array([1, 2, 3, 250]).buffer
        const rec: ComponentRecord = { sha256: 'dd', labId: 'lab-b', name: 'k.wasm', size: 4, addedAt: T0, bytes }
        await store.commit({ putComponents: [rec] }, resolvers)
        const all = await store.readAll()
        a.equal(all.components.length, 1, 'one component')
        a.ok(!('bytes' in all.components[0]), 'bytes are not in the metadata')
        a.equal(all.components[0].labId, 'lab-b', 'metadata kept')
        const got = await store.readComponentBytes('dd')
        a.ok(got !== undefined, 'bytes come back')
        a.deepEqual(Array.from(new Uint8Array(got as ArrayBuffer)), [1, 2, 3, 250], 'bytes are intact')
        a.equal(await store.readComponentBytes('missing'), undefined, 'unknown hash')
      }),
  },
  {
    name: 'putMeta overwrites and open reports the schema version',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        await store.commit({ putMeta: { schema: { version: 3, at: T0 } } }, resolvers)
        await store.commit({ putMeta: { schema: { version: 4, at: T0, build: 'x' } } }, resolvers)
        a.deepEqual((await store.readAll()).meta.schema, { version: 4, at: T0, build: 'x' }, 'meta replaced')
      }),
  },
  {
    name: 'stored data is isolated from caller references',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        const e = visit('iso')
        const w = work('capstone:metrics', { a: 1 }, T0)
        await store.commit({ putEvents: [e], putWorking: [w] }, resolvers)
        // Mutating what was written must not reach the store.
        e.at = '2000-01-01T00:00:00.000Z'
        ;(w.value as { a: number }).a = 99
        const first = await store.readAll()
        a.equal(first.events[0].at, T0, 'writer mutation does not leak in')
        a.deepEqual(first.working[0].value, { a: 1 }, 'writer mutation does not leak into working')
        // Mutating what was read must not reach the store either.
        first.events[0].at = '2001-01-01T00:00:00.000Z'
        ;(first.working[0].value as { a: number }).a = 7
        const second = await store.readAll()
        a.equal(second.events[0].at, T0, 'reader mutation does not leak back')
        a.deepEqual(second.working[0].value, { a: 1 }, 'reader mutation does not leak into working')
      }),
  },
  {
    name: 'many events commit in one batch',
    run: (makeStore, a) =>
      withStore(makeStore, async (store) => {
        const events = Array.from({ length: 2000 }, (_, i) => visit(`bulk-${i}`, { ref: `lesson:t0.l${i % 6}` as const }))
        const r = await store.commit({ putEvents: events }, resolvers)
        a.equal(r.eventIds.length, 2000, 'every id reported')
        const again = await store.commit({ putEvents: events }, resolvers)
        a.equal(again.eventIds.length, 0, 'second pass changes nothing')
        a.equal((await store.readAll()).events.length, 2000, 'all stored once')
      }),
  },
]

/**
 * Run every case in order. Rejects with the first failure; `onCase` sees each result first,
 * so a harness can print a line per case.
 */
export async function runStoreConformance(
  makeStore: MakeStore,
  assert: ConformanceAssert,
  onCase?: (name: string, error?: unknown) => void,
): Promise<void> {
  let first: unknown
  for (const c of STORE_CONFORMANCE_CASES) {
    try {
      await c.run(makeStore, assert)
      onCase?.(c.name)
    } catch (err) {
      onCase?.(c.name, err)
      first ??= err
    }
  }
  if (first !== undefined) throw first
}

/**
 * Browser self-test against IdbStore (spec §7). The implementation sits next to the store;
 * this wrapper keeps the documented dev-console entry point:
 * `(await import('/src/lib/ledger/store-conformance.ts')).selfTestIdb()`.
 */
export async function selfTestIdb(log?: (line: string) => void) {
  const mod = await import('./idb-store')
  return mod.selfTestIdb(log)
}
