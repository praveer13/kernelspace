import { describe, expect, test } from 'bun:test'
import {
  OUTBOX_STALE_MS,
  appendToOutbox,
  clearInOutboxes,
  collectOutboxes,
  dropCleared,
  outboxKey,
  parseOutbox,
  pendingFrom,
  readOutbox,
  removeFromOutbox,
  settleOutboxes,
} from '../../src/lib/ledger/outbox'
import { OUTBOX_PREFIX } from '../../src/lib/ledger/names'
import type { KeyValueStorage, LedgerEvent, Outbox, WorkingRecord } from '../../src/lib/ledger/types'

class FakeStorage implements KeyValueStorage {
  data = new Map<string, string>()
  failWrites = false
  get length() {
    return this.data.size
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error('QuotaExceededError')
    this.data.set(k, v)
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
}

const NOW = Date.parse('2026-10-04T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

const ev = (id: string): LedgerEvent => ({
  id,
  v: 1,
  kind: 'visit',
  ref: 'lesson:t0.l1',
  at: iso(NOW),
  tz: 0,
  day: '2026-10-04',
  dev: 'd',
})
const wr = (key: WorkingRecord['key'], value: WorkingRecord['value'], at = iso(NOW)): WorkingRecord => ({
  key,
  value,
  at,
  dev: 'd',
})

function seedForeign(s: FakeStorage, tab: string, updatedAt: string, events: LedgerEvent[] = [ev(`${tab}-e`)]) {
  const o: Outbox = { tab, updatedAt, events, working: [] }
  s.data.set(outboxKey(tab), JSON.stringify(o))
}

describe('outbox: append and remove', () => {
  test('append writes synchronously under the tab key', () => {
    const s = new FakeStorage()
    expect(appendToOutbox(s, 'tab1', [ev('a')], [wr('boot:path', 'x')], iso(NOW))).toBe(true)
    expect(outboxKey('tab1')).toBe(OUTBOX_PREFIX + 'tab1')
    const o = readOutbox(s, 'tab1')
    expect(o?.tab).toBe('tab1')
    expect(o?.updatedAt).toBe(iso(NOW))
    expect(o?.events.map((e) => e.id)).toEqual(['a'])
    expect(o?.working.map((w) => w.key)).toEqual(['boot:path'])
  })

  test('append accumulates, dedupes events by id and replaces working by key', () => {
    const s = new FakeStorage()
    appendToOutbox(s, 't', [ev('a')], [wr('boot:path', 'x')], iso(NOW))
    appendToOutbox(s, 't', [ev('a'), ev('b')], [wr('boot:path', 'y'), wr('boot:week', 1)], iso(NOW + 1))
    const o = readOutbox(s, 't')!
    expect(o.events.map((e) => e.id)).toEqual(['a', 'b'])
    expect(Object.fromEntries(o.working.map((w) => [w.key, w.value]))).toEqual({ 'boot:path': 'y', 'boot:week': 1 })
    expect(o.updatedAt).toBe(iso(NOW + 1))
  })

  test('an empty append writes nothing', () => {
    const s = new FakeStorage()
    expect(appendToOutbox(s, 't', [], [], iso(NOW))).toBe(true)
    expect(s.data.size).toBe(0)
  })

  test('quota errors are swallowed and reported', () => {
    const s = new FakeStorage()
    s.failWrites = true
    expect(appendToOutbox(s, 't', [ev('a')], [], iso(NOW))).toBe(false)
    expect(readOutbox(s, 't')).toBeNull()
  })

  test('a null storage (localStorage blocked) is a quiet no-op', () => {
    expect(appendToOutbox(null, 't', [ev('a')], [], iso(NOW))).toBe(false)
    expect(readOutbox(null, 't')).toBeNull()
    expect(collectOutboxes(null, 't')).toEqual([])
    expect(settleOutboxes(null, 't', [], NOW)).toEqual([])
    removeFromOutbox(null, 't', [], [])
  })

  test('a storage whose getItem throws reads as empty', () => {
    const s = new FakeStorage()
    s.getItem = () => {
      throw new Error('blocked')
    }
    expect(readOutbox(s, 't')).toBeNull()
  })

  test('remove drops committed entries and deletes the key when empty', () => {
    const s = new FakeStorage()
    appendToOutbox(s, 't', [ev('a'), ev('b')], [wr('boot:path', 'x')], iso(NOW))
    removeFromOutbox(s, 't', [ev('a')], [])
    expect(readOutbox(s, 't')?.events.map((e) => e.id)).toEqual(['b'])
    removeFromOutbox(s, 't', [ev('b')], [wr('boot:path', 'x')])
    expect(s.data.has(outboxKey('t'))).toBe(false)
  })

  test('a working record changed during the commit stays queued', () => {
    const s = new FakeStorage()
    appendToOutbox(s, 't', [], [wr('boot:path', 'old')], iso(NOW))
    appendToOutbox(s, 't', [], [wr('boot:path', 'new', iso(NOW + 5))], iso(NOW + 5))
    removeFromOutbox(s, 't', [], [wr('boot:path', 'old')])
    expect(readOutbox(s, 't')?.working[0].value).toBe('new')
  })

  test('parseOutbox rejects malformed values', () => {
    expect(parseOutbox(null)).toBeNull()
    expect(parseOutbox('not json')).toBeNull()
    expect(parseOutbox('{}')).toBeNull()
    expect(parseOutbox(JSON.stringify({ tab: 't', updatedAt: 'x', events: [{}], working: [] }))).toBeNull()
    expect(parseOutbox(JSON.stringify({ tab: 't', updatedAt: 'x', events: [], working: [] }))).not.toBeNull()
  })
})

describe('outbox: boot flush and the foreign-key rule (spec §8.6)', () => {
  test('collect finds every outbox key (and only those), sorted', () => {
    const s = new FakeStorage()
    s.data.set('kernelspace:v2', '{}')
    s.data.set('other', 'x')
    appendToOutbox(s, 'me', [ev('mine')], [], iso(NOW))
    seedForeign(s, 'zzz', iso(NOW))
    seedForeign(s, 'aaa', iso(NOW))
    const found = collectOutboxes(s, 'me')
    expect(found.map((f) => f.key)).toEqual([outboxKey('aaa'), outboxKey('me'), outboxKey('zzz')])
    expect(found.map((f) => f.own)).toEqual([false, true, false])
  })

  test('pendingFrom unions every readable outbox and skips malformed ones', () => {
    const s = new FakeStorage()
    appendToOutbox(s, 'me', [ev('mine')], [wr('boot:path', 'x')], iso(NOW))
    seedForeign(s, 'other', iso(NOW), [ev('theirs')])
    s.data.set(OUTBOX_PREFIX + 'bad', '{{')
    const { events, working } = pendingFrom(collectOutboxes(s, 'me'))
    expect(events.map((e) => e.id).sort()).toEqual(['mine', 'theirs'])
    expect(working.map((w) => w.key)).toEqual(['boot:path'])
  })

  test('own committed entries are removed after the commit', () => {
    const s = new FakeStorage()
    appendToOutbox(s, 'me', [ev('mine')], [], iso(NOW))
    const found = collectOutboxes(s, 'me')
    const deleted = settleOutboxes(s, 'me', found, NOW)
    expect(deleted).toEqual([outboxKey('me')])
    expect(s.data.size).toBe(0)
  })

  test('own entries added after collection survive the settle', () => {
    const s = new FakeStorage()
    appendToOutbox(s, 'me', [ev('first')], [], iso(NOW))
    const found = collectOutboxes(s, 'me')
    appendToOutbox(s, 'me', [ev('second')], [], iso(NOW + 1))
    settleOutboxes(s, 'me', found, NOW)
    expect(readOutbox(s, 'me')?.events.map((e) => e.id)).toEqual(['second'])
  })

  test('a fresh foreign key is kept (its tab may be live)', () => {
    const s = new FakeStorage()
    seedForeign(s, 'live', iso(NOW - 60_000))
    const deleted = settleOutboxes(s, 'me', collectOutboxes(s, 'me'), NOW)
    expect(deleted).toEqual([])
    expect(s.data.has(outboxKey('live'))).toBe(true)
  })

  test('a foreign key at exactly 24 h is kept, one millisecond over is deleted', () => {
    const s = new FakeStorage()
    seedForeign(s, 'edge', iso(NOW - OUTBOX_STALE_MS))
    seedForeign(s, 'old', iso(NOW - OUTBOX_STALE_MS - 1))
    const deleted = settleOutboxes(s, 'me', collectOutboxes(s, 'me'), NOW)
    expect(deleted).toEqual([outboxKey('old')])
    expect(s.data.has(outboxKey('edge'))).toBe(true)
  })

  test('foreign keys are committed even when they are kept', () => {
    const s = new FakeStorage()
    seedForeign(s, 'live', iso(NOW), [ev('x')])
    expect(pendingFrom(collectOutboxes(s, 'me')).events.map((e) => e.id)).toEqual(['x'])
  })

  test('malformed keys are deleted, own or foreign; an unreadable updatedAt counts as stale', () => {
    const s = new FakeStorage()
    s.data.set(outboxKey('me'), 'garbage')
    s.data.set(outboxKey('theirs'), '[]')
    seedForeign(s, 'nan', 'not a date')
    const deleted = settleOutboxes(s, 'me', collectOutboxes(s, 'me'), NOW)
    expect(deleted.sort()).toEqual([outboxKey('me'), outboxKey('nan'), outboxKey('theirs')].sort())
    expect(s.data.size).toBe(0)
  })

  test('if the commit failed the caller skips settle and nothing is lost', () => {
    const s = new FakeStorage()
    appendToOutbox(s, 'me', [ev('a')], [], iso(NOW))
    seedForeign(s, 'old', iso(NOW - 2 * OUTBOX_STALE_MS))
    collectOutboxes(s, 'me') // boot read it; the commit threw; no settle
    expect(s.data.size).toBe(2)
  })

  test('with IndexedDB unavailable the outbox keeps growing', () => {
    const s = new FakeStorage()
    for (let i = 0; i < 50; i++) appendToOutbox(s, 'me', [ev(`e${i}`)], [], iso(NOW + i))
    expect(readOutbox(s, 'me')?.events.length).toBe(50)
  })
})

describe('outbox: tombstones for a cleared working record (D50)', () => {
  const BG = 'profile:background' as const

  test('a clear strips the key at or before it from every outbox and leaves the tombstone in its own', () => {
    const s = new FakeStorage()
    appendToOutbox(s, 'me', [ev('mine')], [wr(BG, 'sre', iso(NOW - 10)), wr('boot:path', 'x')], iso(NOW - 10))
    appendToOutbox(s, 'gone', [], [wr(BG, 'backend', iso(NOW - 5000))], iso(NOW - 5000))
    appendToOutbox(s, 'mixed', [ev('theirs')], [wr(BG, 'jvm', iso(NOW))], iso(NOW - 3000))
    appendToOutbox(s, 'later', [], [wr(BG, 'ml', iso(NOW + 1))], iso(NOW + 1))
    expect(clearInOutboxes(s, 'me', BG, iso(NOW))).toBe(true)

    const me = readOutbox(s, 'me')!
    expect(me.events.map((e) => e.id)).toEqual(['mine'])
    expect(me.working.map((w) => w.key)).toEqual(['boot:path'])
    expect(me.cleared).toEqual([{ key: BG, at: iso(NOW) }])
    expect(readOutbox(s, 'gone')).toBeNull() // emptied, so removed
    const mixed = readOutbox(s, 'mixed')!
    expect(mixed.working).toEqual([]) // at the same instant as the clear: cleared
    expect(mixed.events.map((e) => e.id)).toEqual(['theirs'])
    expect(mixed.updatedAt).toBe(iso(NOW - 3000)) // the 24 h rule still counts from its own last write
    expect(readOutbox(s, 'later')?.working.map((w) => w.value)).toEqual(['ml']) // written after the clear: kept
  })

  test('boot drops what the latest tombstone clears, from any outbox, and keeps later writes', () => {
    const s = new FakeStorage()
    clearInOutboxes(s, 'a', BG, iso(NOW))
    clearInOutboxes(s, 'b', BG, iso(NOW - 60_000))
    s.data.set(outboxKey('old'), JSON.stringify({ tab: 'old', updatedAt: iso(NOW), events: [], working: [wr(BG, 'jvm', iso(NOW - 1000))] }))
    s.data.set(outboxKey('new'), JSON.stringify({ tab: 'new', updatedAt: iso(NOW), events: [], working: [wr(BG, 'ml', iso(NOW + 1000))] }))
    const { working, cleared } = pendingFrom(collectOutboxes(s, 'z'))
    expect(working.map((w) => w.value)).toEqual(['ml'])
    expect([...cleared]).toEqual([[BG, iso(NOW)]])
  })

  test("a later write in this tab drops this tab's tombstone for the key, even in the same millisecond", () => {
    const s = new FakeStorage()
    clearInOutboxes(s, 'me', BG, iso(NOW))
    appendToOutbox(s, 'me', [], [wr('boot:path', 'x')], iso(NOW))
    expect(readOutbox(s, 'me')?.cleared).toHaveLength(1) // another key leaves it alone
    appendToOutbox(s, 'me', [], [wr(BG, 'student', iso(NOW))], iso(NOW))
    expect(readOutbox(s, 'me')?.cleared).toBeUndefined()
    expect(pendingFrom(collectOutboxes(s, 'me')).working.map((w) => w.value)).toEqual(['x', 'student'])
  })

  test('commits and the boot settle keep tombstones; dropCleared removes them and empties the key', () => {
    const s = new FakeStorage()
    appendToOutbox(s, 'me', [ev('a')], [], iso(NOW))
    clearInOutboxes(s, 'me', BG, iso(NOW))
    removeFromOutbox(s, 'me', [ev('a')], [])
    expect(readOutbox(s, 'me')).toMatchObject({ events: [], working: [], cleared: [{ key: BG, at: iso(NOW) }] })
    expect(settleOutboxes(s, 'me', collectOutboxes(s, 'me'), NOW)).toEqual([])
    expect(readOutbox(s, 'me')?.cleared).toHaveLength(1)
    clearInOutboxes(s, 'other', BG, iso(NOW + 1))
    dropCleared(s, 'me', [BG])
    expect(s.data.size).toBe(0)
  })

  test('a malformed tombstone is dropped, never the events beside it; older readers ignore the field', () => {
    const raw = { tab: 't', updatedAt: iso(NOW), events: [ev('a')], working: [], cleared: [{ key: BG, at: 'yesterday' }, 7, { key: BG, at: iso(NOW) }] }
    expect(parseOutbox(JSON.stringify(raw))?.cleared).toEqual([{ key: BG, at: iso(NOW) }])
    expect(parseOutbox(JSON.stringify({ ...raw, cleared: 'nope' }))).toMatchObject({ events: [ev('a')] })
    expect(parseOutbox(JSON.stringify({ ...raw, cleared: 'nope' }))?.cleared).toBeUndefined()
  })

  test('a clear without storage, or over quota, reports false', () => {
    expect(clearInOutboxes(null, 'me', BG, iso(NOW))).toBe(false)
    const s = new FakeStorage()
    s.failWrites = true
    expect(clearInOutboxes(s, 'me', BG, iso(NOW))).toBe(false)
  })
})
