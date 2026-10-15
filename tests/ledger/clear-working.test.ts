/**
 * `clearWorking` (3c final review, 3c-05 minor 2): a radio group cannot go back to none, so /me and Boot's last step
 * delete the optional `profile:background` record. The store keeps no tombstone, so a delete has to leave every place
 * that holds the record: the façade's state, the snapshot, every outbox, the store and the other tabs. Because every page
 * load has a new tab id, the clear also leaves a tombstone in this tab's outbox, which boot applies by `at` (D50; 3c
 * review round 3, B1 and G5).
 */
import { describe, expect, test } from 'bun:test'
import type { MemoryStore } from '../../src/lib/ledger/memory-store'
import { OUTBOX_PREFIX, SNAPSHOT_KEY } from '../../src/lib/ledger/names'
import { appendToOutbox, readOutbox } from '../../src/lib/ledger/outbox'
import type { ConflictResolvers, LedgerStore, StoreTx } from '../../src/lib/ledger/types'
import { makeProfile, startTab, T0, tick } from './env'

const KEY = 'profile:background' as const
const keysIn = async (p: ReturnType<typeof makeProfile>) => (await p.store.readAll()).working.map((w) => w.key)

describe('clearWorking deletes the record everywhere it lives', () => {
  test('state, store, snapshot and a fresh tab all lose it; the other keys stay', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    tab.progress.getState().setWorking(KEY, 'sre')
    tab.progress.getState().setWorking('settings:codeLang', 'rust')
    await tab.progress.controls.flush()
    expect(await keysIn(p)).toContain(KEY)

    tab.progress.getState().clearWorking(KEY)
    expect(tab.progress.getState().working[KEY]).toBeUndefined()
    await tab.progress.controls.flush()
    expect(await keysIn(p)).toEqual(['settings:codeLang'])
    const snap = JSON.parse(p.storage.data.get(SNAPSHOT_KEY)!) as { working: { key: string }[] }
    expect(snap.working.map((w) => w.key)).toEqual(['settings:codeLang'])

    const next = startTab(p)
    await next.progress.controls.engine()
    expect(next.progress.getState().working[KEY]).toBeUndefined()
    expect(next.progress.getState().working['settings:codeLang']).toBe('rust')
    expect(JSON.stringify((await (await next.engine()).exportV3()).working)).not.toContain(KEY)
  })

  test('before the engine is up: the unsent write is dropped, the outbox holds nothing and the store never sees the key', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    tab.progress.getState().setWorking(KEY, 'ml')
    expect(readOutbox(p.storage, tab.tabId)?.working.map((w) => w.key)).toEqual([KEY])
    tab.progress.getState().clearWorking(KEY)
    await tab.progress.controls.flush()
    expect(tab.progress.getState().working[KEY]).toBeUndefined()
    expect(readOutbox(p.storage, tab.tabId)?.working.map((w) => w.key) ?? []).toEqual([])
    expect(await keysIn(p)).not.toContain(KEY)
  })

  test('another tab on the same profile drops it too', async () => {
    const p = makeProfile()
    const a = startTab(p)
    const b = startTab(p)
    await a.progress.controls.engine()
    await b.progress.controls.engine()
    a.progress.getState().setWorking(KEY, 'jvm')
    await a.progress.controls.flush()
    await tick(5)
    expect(b.progress.getState().working[KEY]).toBe('jvm')
    a.progress.getState().clearWorking(KEY)
    await a.progress.controls.flush()
    await tick(5)
    expect(b.progress.getState().working[KEY]).toBeUndefined()
  })

  test('a key that holds nothing is a no-op, and a pick after a clear is a new write that stays', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    tab.progress.getState().clearWorking(KEY)
    expect(tab.loads()).toBe(0) // nothing to delete, so nothing asked of the engine
    tab.progress.getState().setWorking(KEY, 'backend')
    await tab.progress.controls.flush()
    tab.progress.getState().clearWorking(KEY)
    await tab.progress.controls.flush()
    p.clock.advance(1)
    tab.progress.getState().setWorking(KEY, 'student')
    await tab.progress.controls.flush()
    expect((await p.store.readAll()).working.find((w) => w.key === KEY)?.value).toBe('student')
  })
})

/* ------------------------------------------------------------------ */
/* The clear is durable before the store's delete commits (B1, G5)     */
/* ------------------------------------------------------------------ */

const iso = (ms: number) => new Date(ms).toISOString()

/** The profile's store, except that a delete never commits: the page unloads before IndexedDB finishes it. */
function holdingDeletes(store: MemoryStore): LedgerStore {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'commit') {
        return (tx: StoreTx, resolve: ConflictResolvers) =>
          tx.deleteWorkingKeys?.length ? new Promise(() => {}) : target.commit(tx, resolve)
      }
      const v: unknown = Reflect.get(target, prop)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}

/** A later page load: a new tab id on the same profile, booted. */
async function reload(p: ReturnType<typeof makeProfile>) {
  p.clock.advance(1)
  const tab = startTab(p)
  await tab.progress.controls.engine()
  return tab
}

const storedValue = async (p: ReturnType<typeof makeProfile>) =>
  (await p.store.readAll()).working.find((w) => w.key === KEY)?.value ?? null

describe('a clear stays cleared across page loads', () => {
  test("an earlier page's outbox holding the key cannot bring it back at a later boot", async () => {
    const p = makeProfile()
    // A page that unloaded before its IndexedDB commit: its outbox holds the pick under a tab id no later page owns.
    appendToOutbox(p.storage, 'gone', [], [{ key: KEY, value: 'backend', at: iso(T0 - 5000), dev: p.device }], iso(T0 - 5000))
    const a = startTab(p)
    await a.progress.controls.engine()
    expect(a.progress.getState().working[KEY]).toBe('backend')
    expect(readOutbox(p.storage, 'gone')).not.toBeNull() // a foreign outbox under 24 h old outlives the boot

    a.progress.getState().clearWorking(KEY)
    await a.progress.controls.flush()
    expect(await storedValue(p)).toBeNull()
    expect(readOutbox(p.storage, 'gone')).toBeNull() // its only entry was the cleared pick

    for (let i = 0; i < 3; i++) {
      const next = await reload(p)
      expect(next.progress.getState().working[KEY]).toBeUndefined()
      expect(await storedValue(p)).toBeNull()
    }
  })

  test('a tombstone beats an earlier write in any outbox, even one that reappears after the clear', async () => {
    const p = makeProfile()
    const a = startTab(p)
    a.progress.getState().setWorking(KEY, 'jvm')
    await a.progress.controls.flush()
    a.progress.getState().clearWorking(KEY)
    await a.progress.controls.flush()
    // a live tab's read-modify-write that raced the strip puts the old pick back under its own id
    appendToOutbox(p.storage, 'racer', [], [{ key: KEY, value: 'jvm', at: iso(T0 - 1000), dev: p.device }], iso(T0))
    const next = await reload(p)
    expect(next.progress.getState().working[KEY]).toBeUndefined()
    expect(await storedValue(p)).toBeNull()
  })

  test('a reload 0 ms after the clear, before the store deletes the record, keeps it cleared', async () => {
    const p = makeProfile()
    const a = startTab(p, { store: holdingDeletes(p.store) })
    a.progress.getState().setWorking(KEY, 'sre')
    await a.progress.controls.flush()
    expect(await storedValue(p)).toBe('sre')
    a.progress.getState().clearWorking(KEY)
    expect(a.progress.getState().working[KEY]).toBeUndefined()
    // no flush: the page is gone, and the store still holds the record
    expect(await storedValue(p)).toBe('sre')

    const b = await reload(p)
    expect(b.progress.getState().working[KEY]).toBeUndefined()
    expect(await storedValue(p)).toBeNull()
    const c = await reload(p)
    expect(c.progress.getState().working[KEY]).toBeUndefined()
  })

  test('a reload 0 ms after a clear made before the engine loaded keeps it cleared too', async () => {
    const p = makeProfile({ seed: { working: [{ key: KEY, value: 'ml', at: iso(T0 - 60_000), dev: 'device-0' }] } })
    const first = await reload(p)
    expect(first.progress.getState().working[KEY]).toBe('ml')
    await first.progress.controls.flush() // writes the snapshot the next page hydrates from
    const a = startTab(p, { store: holdingDeletes(p.store) })
    expect(a.progress.getState().working[KEY]).toBe('ml') // from the snapshot: the engine has not loaded
    a.progress.getState().clearWorking(KEY)
    const b = await reload(p)
    expect(b.progress.getState().working[KEY]).toBeUndefined()
    expect(await storedValue(p)).toBeNull()
  })

  test('a write after the clear wins: in the same tab, in another tab, and in the same millisecond', async () => {
    // the same tab, after a clear whose delete never committed
    const p = makeProfile()
    const a = startTab(p, { store: holdingDeletes(p.store) })
    a.progress.getState().setWorking(KEY, 'sre')
    await a.progress.controls.flush()
    a.progress.getState().clearWorking(KEY)
    p.clock.advance(1)
    a.progress.getState().setWorking(KEY, 'student')
    expect((await reload(p)).progress.getState().working[KEY]).toBe('student')
    expect(await storedValue(p)).toBe('student')

    // another tab, while the clear's tombstone still sits in the first tab's outbox
    const q = makeProfile()
    const b = startTab(q, { store: holdingDeletes(q.store) })
    b.progress.getState().setWorking(KEY, 'backend')
    await b.progress.controls.flush()
    b.progress.getState().clearWorking(KEY)
    const c = await reload(q)
    expect(c.progress.getState().working[KEY]).toBeUndefined()
    q.clock.advance(1)
    c.progress.getState().setWorking(KEY, 'ml')
    await c.progress.controls.flush()
    expect(readOutbox(q.storage, b.tabId)?.cleared?.map((t) => t.key)).toEqual([KEY])
    expect((await reload(q)).progress.getState().working[KEY]).toBe('ml')
    expect(await storedValue(q)).toBe('ml')

    // the same millisecond: this tab's own order decides
    const r = makeProfile()
    const d = startTab(r, { store: holdingDeletes(r.store) })
    d.progress.getState().setWorking(KEY, 'jvm')
    await d.progress.controls.flush()
    d.progress.getState().clearWorking(KEY)
    d.progress.getState().setWorking(KEY, 'sre')
    expect((await reload(r)).progress.getState().working[KEY]).toBe('sre')
  })

  test('an import still brings a cleared record back, and the next boot keeps it', async () => {
    const p = makeProfile()
    const a = startTab(p)
    a.progress.getState().setWorking(KEY, 'backend')
    await a.progress.controls.flush()
    const file = await (await a.engine()).exportV3()
    a.progress.getState().clearWorking(KEY)
    await a.progress.controls.flush()
    expect(await storedValue(p)).toBeNull()
    expect(readOutbox(p.storage, a.tabId)?.cleared?.map((t) => t.key)).toEqual([KEY])

    expect(await (await a.engine()).importFile(JSON.stringify(file), 'merge')).toMatchObject({ ok: true })
    expect(await storedValue(p)).toBe('backend')
    expect(readOutbox(p.storage, a.tabId)?.cleared ?? []).toEqual([])
    expect((await reload(p)).progress.getState().working[KEY]).toBe('backend')
  })

  test('a boot that applies a tombstone tells a tab that still shows the record', async () => {
    const p = makeProfile()
    const a = startTab(p, { store: holdingDeletes(p.store) })
    const live = startTab(p)
    await live.progress.controls.engine()
    a.progress.getState().setWorking(KEY, 'jvm')
    await a.progress.controls.flush()
    await tick(5)
    expect(live.progress.getState().working[KEY]).toBe('jvm')
    a.progress.getState().clearWorking(KEY) // the page goes before the delete commits, so no reload is posted
    await reload(p)
    await tick(5)
    expect(live.progress.getState().working[KEY]).toBeUndefined()
  })

  test('reset removes the tombstones with the outboxes', async () => {
    const p = makeProfile()
    const a = startTab(p)
    a.progress.getState().setWorking(KEY, 'sre')
    await a.progress.controls.flush()
    a.progress.getState().clearWorking(KEY)
    await a.progress.controls.flush()
    expect(readOutbox(p.storage, a.tabId)?.cleared).toHaveLength(1)
    a.progress.getState().resetProgress()
    await a.progress.controls.flush()
    expect([...p.storage.data.keys()].filter((k) => k.startsWith(OUTBOX_PREFIX))).toEqual([])
  })
})
