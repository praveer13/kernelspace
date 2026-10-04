import { describe, expect, test } from 'bun:test'
import {
  OUTBOX_STALE_MS,
  appendToOutbox,
  collectOutboxes,
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
