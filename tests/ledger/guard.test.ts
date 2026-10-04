import { describe, expect, test } from 'bun:test'
import {
  checkMessage,
  checkSnapshot,
  checkSnapshotRaw,
  checkStoreInfo,
  checkVersionChange,
  createGuard,
} from '../../src/lib/ledger/guard'
import {
  broadcastableWorking,
  openLedgerChannel,
  parseChannelMessage,
  watchSnapshotStorage,
  type ChannelLike,
} from '../../src/lib/ledger/channel'
import { CHANNEL_NAME, SNAPSHOT_KEY } from '../../src/lib/ledger/names'
import type { ChannelMessage, ReadOnlyReason, StoreInfo, WorkingRecord } from '../../src/lib/ledger/types'

const V = 3
const info = (over: Partial<StoreInfo> = {}): StoreInfo => ({
  backend: 'idb',
  schemaVersion: V,
  readOnly: false,
  ...over,
})

describe('guard reasons (spec §9.3)', () => {
  test('1. newer meta schema -> newer-schema', () => {
    expect(checkStoreInfo(V, info({ schemaVersion: V + 1 }))).toBe('newer-schema')
  })

  test('same or older schema, or a fresh database, is writable', () => {
    expect(checkStoreInfo(V, info({ schemaVersion: V }))).toBeNull()
    expect(checkStoreInfo(V, info({ schemaVersion: V - 1 }))).toBeNull()
    expect(checkStoreInfo(V, info({ schemaVersion: null }))).toBeNull()
  })

  test('2. a VersionError open (store reports readOnly newer-idb) -> newer-idb', () => {
    expect(checkStoreInfo(V, info({ schemaVersion: null, readOnly: true, reason: 'newer-idb' }))).toBe('newer-idb')
    // readOnly without a reason still defaults to newer-idb
    expect(checkStoreInfo(V, info({ readOnly: true }))).toBe('newer-idb')
  })

  test('3. versionchange -> versionchange', () => {
    expect(checkVersionChange()).toBe('versionchange')
  })

  test('4. a newer snapshot -> snapshot-newer', () => {
    expect(checkSnapshot(V, { schemaVersion: V + 1 })).toBe('snapshot-newer')
    expect(checkSnapshotRaw(V, JSON.stringify({ schemaVersion: V + 5, aggregate: {} }))).toBe('snapshot-newer')
  })

  test('a current, older, missing or corrupt snapshot is not a reason', () => {
    expect(checkSnapshot(V, { schemaVersion: V })).toBeNull()
    expect(checkSnapshot(V, { schemaVersion: 1 })).toBeNull()
    expect(checkSnapshot(V, {})).toBeNull()
    expect(checkSnapshot(V, null)).toBeNull()
    expect(checkSnapshot(V, 'str')).toBeNull()
    expect(checkSnapshot(V, { schemaVersion: 'x' })).toBeNull()
    expect(checkSnapshot(V, { schemaVersion: Number.NaN })).toBeNull()
    expect(checkSnapshotRaw(V, null)).toBeNull()
    expect(checkSnapshotRaw(V, '{not json')).toBeNull()
  })

  test('5. a channel message from a newer bundle -> newer-schema; hello is the spec case', () => {
    const hello: ChannelMessage = { t: 'hello', from: 'other', schemaVersion: V + 1 }
    expect(checkMessage(V, hello)).toBe('newer-schema')
    expect(checkMessage(V, { schemaVersion: V })).toBeNull()
    expect(checkMessage(V, { schemaVersion: V - 1 })).toBeNull()
    const append: ChannelMessage = { t: 'append', from: 'o', schemaVersion: V + 1, events: [], working: [] }
    expect(checkMessage(V, append)).toBe('newer-schema')
  })

  test('the bundle version is an argument: the same input flips with it', () => {
    expect(checkStoreInfo(4, info({ schemaVersion: 4 }))).toBeNull()
    expect(checkStoreInfo(3, info({ schemaVersion: 4 }))).toBe('newer-schema')
  })
})

describe('createGuard latch', () => {
  test('starts writable; the first reason sticks and onReadOnly fires once', () => {
    const seen: ReadOnlyReason[] = []
    const g = createGuard(V, (r) => seen.push(r))
    expect(g.readOnly).toBe(false)
    expect(g.reason).toBeUndefined()
    expect(g.storeInfo(info())).toBe(false)
    expect(g.snapshotRaw(null)).toBe(false)
    expect(g.message({ schemaVersion: V })).toBe(false)

    expect(g.snapshot({ schemaVersion: V + 1 })).toBe(true)
    expect(g.readOnly).toBe(true)
    expect(g.reason).toBe('snapshot-newer')

    // later reasons do not replace the first, and do not fire again
    expect(g.versionChange()).toBe(true)
    expect(g.message({ schemaVersion: V + 9 })).toBe(true)
    expect(g.reason).toBe('snapshot-newer')
    expect(seen).toEqual(['snapshot-newer'])
  })

  test('a clean check after latching does not clear it', () => {
    const g = createGuard(V)
    g.versionChange()
    expect(g.storeInfo(info())).toBe(true)
    expect(g.reason).toBe('versionchange')
  })

  test.each([
    ['newer-schema', (g: ReturnType<typeof createGuard>) => g.storeInfo(info({ schemaVersion: V + 1 }))],
    ['newer-idb', (g: ReturnType<typeof createGuard>) => g.storeInfo(info({ readOnly: true, reason: 'newer-idb' }))],
    ['versionchange', (g: ReturnType<typeof createGuard>) => g.versionChange()],
    ['snapshot-newer', (g: ReturnType<typeof createGuard>) => g.snapshotRaw('{"schemaVersion":99}')],
    ['newer-schema', (g: ReturnType<typeof createGuard>) => g.message({ schemaVersion: 99 })],
  ])('latches %#: %s', (reason, trip) => {
    const g = createGuard(V)
    expect(trip(g)).toBe(true)
    expect(g.reason).toBe(reason as ReadOnlyReason)
  })
})

/** A fake BroadcastChannel hub: every ChannelLike posts to every other one with the same name. */
function hub() {
  const members: FakeChannel[] = []
  class FakeChannel implements ChannelLike {
    listeners = new Set<(ev: { data: unknown }) => void>()
    closed = false
    constructor(readonly name: string) {
      members.push(this)
    }
    postMessage(message: unknown) {
      if (this.closed) throw new Error('closed')
      const copy = structuredClone(message)
      for (const m of members) {
        if (m !== this && m.name === this.name && !m.closed) for (const l of [...m.listeners]) l({ data: copy })
      }
    }
    addEventListener(_t: 'message', l: (ev: { data: unknown }) => void) {
      this.listeners.add(l)
    }
    removeEventListener(_t: 'message', l: (ev: { data: unknown }) => void) {
      this.listeners.delete(l)
    }
    close() {
      this.closed = true
    }
  }
  return { factory: (name: string) => new FakeChannel(name), members }
}

describe('channel (spec §9.4)', () => {
  test('stamps from and schemaVersion, delivers to other tabs and not to the sender', () => {
    const h = hub()
    const a = openLedgerChannel({ tabId: 'A', schemaVersion: V, factory: h.factory })
    const b = openLedgerChannel({ tabId: 'B', schemaVersion: V + 1, factory: h.factory })
    const gotA: ChannelMessage[] = []
    const gotB: ChannelMessage[] = []
    a.subscribe((m) => gotA.push(m))
    b.subscribe((m) => gotB.push(m))
    a.post({ t: 'hello' })
    b.post({ t: 'reload', reason: 'import' })
    expect(gotB).toEqual([{ t: 'hello', from: 'A', schemaVersion: V }])
    expect(gotA).toEqual([{ t: 'reload', reason: 'import', from: 'B', schemaVersion: V + 1 }])
    // the newer bundle's reload trips the older bundle's guard
    expect(checkMessage(V, gotA[0])).toBe('newer-schema')
  })

  test('uses the documented channel name', () => {
    const names: string[] = []
    openLedgerChannel({
      tabId: 'A',
      schemaVersion: V,
      factory: (n) => {
        names.push(n)
        return hub().factory(n)
      },
    })
    expect(names).toEqual([CHANNEL_NAME])
  })

  test('append carries events and working; unsubscribe and close stop delivery', () => {
    const h = hub()
    const a = openLedgerChannel({ tabId: 'A', schemaVersion: V, factory: h.factory })
    const b = openLedgerChannel({ tabId: 'B', schemaVersion: V, factory: h.factory })
    const got: ChannelMessage[] = []
    const off = b.subscribe((m) => got.push(m))
    a.post({ t: 'append', events: [], working: [] })
    expect(got.length).toBe(1)
    off()
    a.post({ t: 'append', events: [], working: [] })
    expect(got.length).toBe(1)
    b.close()
    a.post({ t: 'hello' }) // delivering to a closed peer is skipped
    a.close()
    a.post({ t: 'hello' }) // posting on a closed channel never throws
  })

  test('malformed messages are dropped', () => {
    const h = hub()
    const a = openLedgerChannel({ tabId: 'A', schemaVersion: V, factory: h.factory })
    const got: ChannelMessage[] = []
    a.subscribe((m) => got.push(m))
    const raw = h.factory(CHANNEL_NAME)
    for (const bad of [
      null,
      'x',
      {},
      { t: 'hello' },
      { t: 'hello', from: 'x', schemaVersion: 'no' },
      { t: 'reload', from: 'x', schemaVersion: V, reason: 'nope' },
      { t: 'append', from: 'x', schemaVersion: V, events: 'no', working: [] },
      { t: 'zzz', from: 'x', schemaVersion: V },
    ]) {
      raw.postMessage(bad)
    }
    expect(got).toEqual([])
    raw.postMessage({ t: 'hello', from: 'x', schemaVersion: V })
    expect(got.length).toBe(1)
  })

  test('parseChannelMessage accepts each valid shape', () => {
    expect(parseChannelMessage({ t: 'hello', from: 'x', schemaVersion: 3 })).not.toBeNull()
    for (const reason of ['import', 'undo', 'reset', 'migration', 'legacy-reproject']) {
      expect(parseChannelMessage({ t: 'reload', from: 'x', schemaVersion: 3, reason })).not.toBeNull()
    }
    expect(parseChannelMessage({ t: 'append', from: 'x', schemaVersion: 3, events: [], working: [] })).not.toBeNull()
  })

  test('without BroadcastChannel the wrapper is an inert no-op', () => {
    const ch = openLedgerChannel({
      tabId: 'A',
      schemaVersion: V,
      factory: () => {
        throw new Error('no BroadcastChannel')
      },
    })
    expect(ch.available).toBe(false)
    ch.post({ t: 'hello' })
    const off = ch.subscribe(() => {})
    off()
    ch.close()
  })

  test('scroll records are not broadcast', () => {
    const w = (key: WorkingRecord['key']): WorkingRecord => ({ key, value: 1, at: 'x', dev: 'd' })
    const out = broadcastableWorking([w('scroll:t0.l1'), w('settings:codeLang'), w('boot:path')])
    expect(out.map((r) => r.key)).toEqual(['settings:codeLang', 'boot:path'])
  })

  test('the storage fallback fires only for the snapshot key', () => {
    const listeners = new Set<(ev: { key: string | null }) => void>()
    const target = {
      addEventListener: (_t: 'storage', l: (ev: { key: string | null }) => void) => listeners.add(l),
      removeEventListener: (_t: 'storage', l: (ev: { key: string | null }) => void) => listeners.delete(l),
    }
    let n = 0
    const off = watchSnapshotStorage(target, () => {
      n += 1
    })
    const fire = (key: string | null) => listeners.forEach((l) => l({ key }))
    fire('other')
    fire(null)
    expect(n).toBe(0)
    fire(SNAPSHOT_KEY)
    expect(n).toBe(1)
    off()
    expect(listeners.size).toBe(0)
    expect(watchSnapshotStorage(null, () => {})).toBeInstanceOf(Function)
  })
})
