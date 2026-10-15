/**
 * `clearWorking` (3c final review, 3c-05 minor 2): a radio group cannot go back to none, so /me and Boot's last step
 * delete the optional `profile:background` record. A working record has no tombstone, so a delete has to leave every place
 * that holds the record: the façade's state, the snapshot, this tab's outbox, the store and the other tabs.
 */
import { describe, expect, test } from 'bun:test'
import { SNAPSHOT_KEY } from '../../src/lib/ledger/names'
import { readOutbox } from '../../src/lib/ledger/outbox'
import { makeProfile, startTab, tick } from './env'

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
