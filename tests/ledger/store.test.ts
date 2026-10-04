import { describe, expect, test } from 'bun:test'
import { MemoryStore } from '../../src/lib/ledger/memory-store'
import {
  STORE_CONFORMANCE_CASES,
  makeAssert,
  makeResolvers,
  runStoreConformance,
} from '../../src/lib/ledger/store-conformance'
import type { StoreTx, VisitEvent } from '../../src/lib/ledger/types'

// P13: the shared suite against the reference store. Each case is its own test.
describe('MemoryStore conforms to LedgerStore (P13)', () => {
  for (const c of STORE_CONFORMANCE_CASES) {
    test(c.name, async () => {
      await c.run(() => new MemoryStore(), makeAssert())
    })
  }

  test('runStoreConformance runs every case and reports each', async () => {
    const seen: string[] = []
    await runStoreConformance(() => new MemoryStore(), makeAssert(), (name, err) => {
      expect(err).toBeUndefined()
      seen.push(name)
    })
    expect(seen).toEqual(STORE_CONFORMANCE_CASES.map((c) => c.name))
  })

  test('the suite detects a store that ignores the injected resolvers', async () => {
    class Overwriting extends MemoryStore {
      override async commit(tx: StoreTx) {
        return super.commit(tx, { event: (_e, i) => i, working: (_w, i) => i })
      }
    }
    await expect(runStoreConformance(() => new Overwriting(), makeAssert())).rejects.toThrow()
  })
})

describe('MemoryStore specifics', () => {
  const visit = (id: string): VisitEvent => ({
    id,
    v: 1,
    kind: 'visit',
    ref: 'lesson:t0.l1',
    at: '2026-10-04T08:00:00.000Z',
    tz: 0,
    day: '2026-10-04',
    dev: 'd',
  })

  test('open reports the seeded schema version', async () => {
    const store = new MemoryStore({ meta: { schema: { version: 7, at: '2026-10-04T08:00:00.000Z' } } })
    const info = await store.open()
    expect(info).toEqual({ backend: 'memory', schemaVersion: 7, readOnly: false })
  })

  test('seed data is cloned', async () => {
    const e = visit('a')
    const store = new MemoryStore({ events: [e] })
    e.at = 'changed'
    expect((await store.readAll()).events[0].at).toBe('2026-10-04T08:00:00.000Z')
  })

  test('simulateVersionChange closes the store and notifies once; unsubscribe works', async () => {
    const store = new MemoryStore()
    await store.open()
    let n = 0
    store.onVersionChange(() => {
      n += 1
    })
    const off = store.onVersionChange(() => {
      n += 10
    })
    off()
    store.simulateVersionChange()
    expect(n).toBe(1)
    await expect(store.commit({ putEvents: [visit('a')] }, makeResolvers())).rejects.toThrow()
    await store.open()
    await store.commit({ putEvents: [visit('a')] }, makeResolvers())
  })
})
