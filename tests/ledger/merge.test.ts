import { describe, expect, test } from 'bun:test'
import { derive } from '../../src/lib/ledger/fold'
import { canonicalEvent, lwwWorking, mergeLedgers, normalizeLedger, type Ledger } from '../../src/lib/ledger/merge'
import { stableStringify } from '../../src/lib/ledger/stable'
import { dayOf } from '../../src/lib/ledger/time'
import type { LedgerEvent, WorkingRecord } from '../../src/lib/ledger/types'
import { evt, forSeeds, ledgerKey, runOps } from './gen'

const T1 = '2026-09-01T09:00:00.000Z'
const T2 = '2026-09-02T09:00:00.000Z'

/** The same fact as `e`, recorded by a device in another timezone and a few minutes later. */
const variant = (e: LedgerEvent, tz: number, minutes = 0): LedgerEvent => {
  const at = new Date(Date.parse(e.at) + minutes * 60_000).toISOString()
  return { ...e, at, tz, day: dayOf(at, tz) } as LedgerEvent
}

describe('canonical conflict rule (spec §4.8)', () => {
  test('earliest at wins when only the times differ', () => {
    const a = evt('complete', 'lesson:t0.l1', T1)
    const b = variant(a, 0, 90)
    expect(canonicalEvent(a, b)).toBe(a)
    expect(canonicalEvent(b, a)).toBe(a)
  })

  test('smaller canonical JSON wins otherwise; commutative, associative, idempotent', () => {
    const a = evt('complete', 'lesson:t0.l1', T1)
    const b = variant(a, 330)
    const c = variant(a, -420)
    const pick = (x: LedgerEvent, y: LedgerEvent) => stableStringify(canonicalEvent(x, y))
    expect(pick(a, b)).toBe(pick(b, a))
    expect(pick(a, a)).toBe(stableStringify(a))
    expect(stableStringify(canonicalEvent(canonicalEvent(a, b), c))).toBe(stableStringify(canonicalEvent(a, canonicalEvent(b, c))))
    const smallest = [a, b, c].map(stableStringify).sort()[0]
    expect(stableStringify(canonicalEvent(canonicalEvent(b, c), a))).toBe(smallest)
  })
})

describe('working state is last-writer-wins (spec §5)', () => {
  const rec = (at: string, dev: string, value: WorkingRecord['value']): WorkingRecord => ({ key: 'fw:doc', value, at, dev })

  test('later at wins, then dev, then canonical JSON', () => {
    expect(lwwWorking(rec(T1, 'z', 'old'), rec(T2, 'a', 'new')).value).toBe('new')
    expect(lwwWorking(rec(T1, 'a', 'x'), rec(T1, 'b', 'y')).value).toBe('y')
    expect(lwwWorking(rec(T1, 'a', 'x'), rec(T1, 'a', 'y')).value).toBe('y')
  })

  test('commutative and idempotent', () => {
    const a = rec(T1, 'a', 'x')
    const b = rec(T1, 'a', 'y')
    expect(lwwWorking(a, b)).toEqual(lwwWorking(b, a))
    expect(lwwWorking(a, a)).toBe(a)
  })
})

describe('mergeLedgers', () => {
  test('unions events and working, resolving clashes canonically', () => {
    const shared = evt('complete', 'lesson:t0.l1', T1)
    const left: Ledger = {
      events: [shared, evt('visit', 'lesson:t0.l2', T1)],
      working: [{ key: 'fw:doc', value: 'left', at: T1, dev: 'a' }],
    }
    const right: Ledger = {
      events: [variant(shared, 540, 30), evt('visit', 'lesson:t0.l3', T2)],
      working: [{ key: 'fw:doc', value: 'right', at: T2, dev: 'b' }],
    }
    const merged = mergeLedgers(left, right)
    expect(merged.events.length).toBe(3)
    expect(merged.events.find((e) => e.id === shared.id)).toEqual(shared)
    expect(merged.working).toEqual([{ key: 'fw:doc', value: 'right', at: T2, dev: 'b' }])
    expect(derive(merged.events).events).toBe(3)
  })

  test('output is normalised: sorted by (at, id), no duplicates', () => {
    const e1 = evt('visit', 'lesson:t0.l1', T2)
    const e2 = evt('visit', 'lesson:t0.l2', T1)
    const merged = mergeLedgers({ events: [e1, e1], working: [] }, { events: [e2], working: [] })
    expect(merged.events.map((e) => e.id)).toEqual([e2.id, e1.id])
  })

  test('merging with an empty ledger changes nothing', () => {
    const d = { events: [evt('visit', 'lesson:t0.l1', T1)], working: [] }
    expect(mergeLedgers(d, { events: [], working: [] })).toEqual(normalizeLedger(d))
  })

  test('P5 commutativity, associativity, idempotence', () => {
    forSeeds((ctx) => {
      const base = ctx.device()
      runOps(base, 8)
      const [a, b, c] = [ctx.device(), ctx.device(), ctx.device()]
      for (const d of [a, b, c]) d.adopt(base.ledger(), base.ms)
      runOps(a, 40)
      runOps(b, 40)
      runOps(c, 40)
      // Another timezone re-records one shared fact: a canonical-rule clash.
      const shared = [...base.events.values()][0]
      if (shared) b.events.set(shared.id, variant(shared, 330, 15))
      const [A, B, C] = [a.ledger(), b.ledger(), c.ledger()]

      expect(ledgerKey(mergeLedgers(A, B))).toBe(ledgerKey(mergeLedgers(B, A)))
      expect(ledgerKey(mergeLedgers(mergeLedgers(A, B), C))).toBe(ledgerKey(mergeLedgers(A, mergeLedgers(B, C))))
      expect(ledgerKey(mergeLedgers(A, A))).toBe(ledgerKey(normalizeLedger(A)))
      expect(ledgerKey(mergeLedgers(A, mergeLedgers(A, B)))).toBe(ledgerKey(mergeLedgers(A, B)))
    })
  })

  test('merge never loses evidence: the aggregate only grows', () => {
    forSeeds((ctx) => {
      const [a, b] = [ctx.device(), ctx.device()]
      runOps(a, 30)
      runOps(b, 30)
      const merged = derive(mergeLedgers(a.ledger(), b.ledger()).events)
      const A = derive(a.events.values())
      for (const id of Object.keys(A.lessons)) expect(merged.lessons[id]).toBeDefined()
      for (const fact of Object.keys(A.facts)) expect(merged.facts[fact as keyof typeof merged.facts]).toBe(true)
      for (const day of Object.keys(A.days)) expect(merged.days[day]).toBe(true)
    })
  })
})
