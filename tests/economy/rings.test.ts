/**
 * Rings (wave-1.md §8.5, task B7): rank is the highest ring earned, never an XP threshold. RING 2 needs
 * R1–R5 and lab 01 on unseen seeds plus all 19 T0–T2 lessons *done*, at any provenance. Read lessons do not
 * count (O4). A ring is never revoked: every input is monotone in the event set.
 */
import { describe, expect, test } from 'bun:test'
import { LABS, RING2_LAB, RING2_LESSONS, RING2_R_LABS } from '../../src/lib/economy-table'
import { RING_NAMES, RINGS_PENDING, selectRings, xpOf } from '../../src/lib/economy'
import { derive, upgradeAggregate } from '../../src/lib/ledger/fold'
import type { Aggregate, LedgerEvent } from '../../src/lib/ledger/types'
import { evt, shuffle, START_MS } from '../ledger/gen'
import { splitmix32 } from '../../src/lib/rng'

const DAY_MS = 24 * 60 * 60 * 1000
const at = (day: number) => new Date(START_MS + day * DAY_MS).toISOString()

/** A lab run on seeds drawn at grade time that passed `checks` (a v2 run: `abi`, `seeds: fresh`). */
const unseenRun = (lab: string, checks: readonly string[], day = 0) =>
  evt('lab-check', `lab:${lab}`, at(day), {
    score: checks.length / LABS[lab].checks.length,
    ok: checks.length === LABS[lab].checks.length,
    provenance: 'unseen',
    data: {
      passed: [...checks],
      total: LABS[lab].checks.length,
      abi: 2,
      seeds: 'fresh',
      checks: checks.map((id) => ({ id, status: 'pass' })),
    },
  })

/** The same checks passed on the default (visible) seeds: lab-green, no unseen credit. */
const greenRun = (lab: string, checks: readonly string[], day = 0) =>
  evt('lab-check', `lab:${lab}`, at(day), {
    score: 1,
    ok: checks.length === LABS[lab].checks.length,
    provenance: 'lab-green',
    data: { passed: [...checks], total: LABS[lab].checks.length, abi: 2, seeds: 'default', checks: checks.map((id) => ({ id, status: 'pass', seed: 1 })) },
  })

const passLesson = (id: string, form: 'ticket' | 'spiral' | 'testout' | 'checkpoint' = 'ticket', day = 0) =>
  evt('quiz', `lesson:${id}`, at(day), { score: 1, ok: true, ...(form === 'checkpoint' ? {} : { data: { form } }) })

const allUnseen = () => [...RING2_R_LABS, RING2_LAB].map((lab) => unseenRun(lab, LABS[lab].checks))
const allTickets = () => RING2_LESSONS.map((id) => passLesson(id, id === 't2.l7' ? 'spiral' : 'ticket'))
const ring2Ledger = () => [...allUnseen(), ...allTickets()]

const rings = (events: LedgerEvent[]) => selectRings(derive(events))

describe('the RING 2 fixtures', () => {
  test('R1–R5 and lab 01 unseen, and 19 T0–T2 lessons done: RING 2', () => {
    const r = rings(ring2Ledger())
    expect(r.rank).toBe('RING 2')
    expect(r.earned).toEqual(['RING 3', 'RING 2'])
    expect(r.ring2).toEqual({
      earned: true,
      rDrills: { done: 5, total: 5, missing: [] },
      lab01: { done: true, checks: { done: 6, total: 6 } },
      tickets: { done: 19, total: 19, missing: [] },
    })
  })

  test('an empty ledger is RING 3 with nothing done', () => {
    const r = rings([])
    expect(r.rank).toBe('RING 3')
    expect(r.earned).toEqual(['RING 3'])
    expect(r.ring2).toEqual({
      earned: false,
      rDrills: { done: 0, total: 5, missing: [...RING2_R_LABS] },
      lab01: { done: false, checks: { done: 0, total: 6 } },
      tickets: { done: 0, total: 19, missing: [...RING2_LESSONS] },
    })
  })

  test('each part is needed: leave out R drills, lab 01 or the tickets and the ring is not earned', () => {
    expect(rings([...allUnseen().slice(0, 5), ...allTickets()]).rank).toBe('RING 3') // no lab 01
    expect(rings([...allUnseen().slice(1), ...allTickets()]).rank).toBe('RING 3') // no R1
    expect(rings(allUnseen()).rank).toBe('RING 3') // no tickets
    expect(rings(allTickets()).rank).toBe('RING 3') // no labs
  })

  test('one missing required check on an R drill, or on lab 01, is enough to miss', () => {
    const rest = RING2_R_LABS.filter((l) => l !== 'rust-zero-r3').map((l) => unseenRun(l, LABS[l].checks))
    const almost = unseenRun('rust-zero-r3', LABS['rust-zero-r3'].checks.filter((c) => c !== 'option_take'))
    const r = rings([...rest, almost, unseenRun(RING2_LAB, LABS[RING2_LAB].checks), ...allTickets()])
    expect(r.rank).toBe('RING 3')
    expect(r.ring2.rDrills).toEqual({ done: 4, total: 5, missing: ['rust-zero-r3'] })
    expect(r.ring2.lab01.done).toBe(true)

    const lab01 = rings([...allUnseen().slice(0, 5), unseenRun(RING2_LAB, LABS[RING2_LAB].checks.filter((c) => c !== 'coalesce')), ...allTickets()])
    expect(lab01.rank).toBe('RING 3')
    expect(lab01.ring2.lab01).toEqual({ done: false, checks: { done: 5, total: 6 } })
  })

  test('checks unseen on different runs add up', () => {
    const [first, ...rest] = LABS[RING2_LAB].checks
    const split = [unseenRun(RING2_LAB, [first], 1), unseenRun(RING2_LAB, rest, 2)]
    expect(rings([...allUnseen().slice(0, 5), ...split, ...allTickets()]).rank).toBe('RING 2')
  })
})

describe('what counts as unseen', () => {
  test('passing on the visible seeds (lab-green) is not enough, however many times', () => {
    const green = [...RING2_R_LABS, RING2_LAB].flatMap((lab) => [greenRun(lab, LABS[lab].checks, 1), greenRun(lab, LABS[lab].checks, 2)])
    const r = rings([...green, ...allTickets()])
    expect(r.rank).toBe('RING 3')
    expect(r.ring2.rDrills.done).toBe(0)
    expect(r.ring2.lab01.done).toBe(false)
  })

  test('a Wave 0b lab run (no abi, no checks array) earns no unseen credit', () => {
    const v1 = [...RING2_R_LABS, RING2_LAB].map((lab) =>
      evt('lab-check', `lab:${lab}`, at(0), { score: 1, ok: true, provenance: 'lab-green', data: { passed: LABS[lab].checks, total: LABS[lab].checks.length } }),
    )
    expect(rings([...v1, ...allTickets()]).rank).toBe('RING 3')
  })

  test('a failed check on an unseen run does not count; a trap or timeout does not either', () => {
    const lab = 'rust-zero-r1'
    const events = [
      evt('lab-check', `lab:${lab}`, at(0), {
        score: 0,
        ok: false,
        provenance: 'unseen',
        data: { passed: [], total: 6, abi: 2, seeds: 'fresh', checks: LABS[lab].checks.map((id, i) => ({ id, status: ['fail', 'trap', 'timeout'][i % 3] })) },
      }),
    ]
    expect(rings(events).ring2.rDrills.done).toBe(0)
  })

  test('only the required checks of the table count; optional checks are not needed', () => {
    // kv-block-manager has an optional seventh check, which is not in the table; lab 01 has none.
    expect(LABS['kv-block-manager'].checks).toHaveLength(6)
    expect(rings(ring2Ledger()).ring2.lab01.checks.total).toBe(6)
  })
})

describe('what counts as a done ticket', () => {
  test('a pass at any provenance counts: ticket, spiral, test-out or a plain checkpoint', () => {
    const forms = ['ticket', 'testout', 'checkpoint', 'spiral'] as const
    const passes = RING2_LESSONS.map((id, i) => passLesson(id, forms[i % forms.length], i))
    expect(rings([...allUnseen(), ...passes]).rank).toBe('RING 2')
  })

  test('read, not passed, does not count (O4): a click-through, and "continue anyway"', () => {
    const clicked = RING2_LESSONS.map((id) => evt('complete', `lesson:${id}`, at(0))) // Wave 0b: no via
    const continued = RING2_LESSONS.map((id) => evt('complete', `lesson:${id}`, at(0), { data: { via: 'read' } }))
    for (const reads of [clicked, continued]) {
      const r = rings([...allUnseen(), ...reads])
      expect(r.rank).toBe('RING 3')
      expect(r.ring2.tickets.done).toBe(0)
    }
    // ...until the ticket is passed
    const half = [...allUnseen(), ...allTickets().slice(0, 18), evt('complete', 'lesson:t2.l7', at(0))]
    expect(rings(half).ring2.tickets).toEqual({ done: 18, total: 19, missing: ['t2.l7'] })
  })

  test('a failed ticket is not a pass', () => {
    const miss = evt('quiz', 'lesson:t0.l1', at(0), { score: 0.33, ok: false, data: { form: 'ticket' } })
    expect(rings([miss]).ring2.tickets.done).toBe(0)
  })

  test('lessons outside T0–T2 do not count toward RING 2', () => {
    const others = ['r.l1', 't3.l1', 't5.l1', 't7.l1'].map((id) => passLesson(id))
    expect(rings(others).ring2.tickets.done).toBe(0)
  })

  test('the checklist reads "R drills 3/5 · lab 01 · tickets 11/19"', () => {
    const events = [
      ...RING2_R_LABS.slice(0, 3).map((l) => unseenRun(l, LABS[l].checks)),
      ...RING2_LESSONS.slice(0, 11).map((id) => passLesson(id)),
    ]
    const { ring2 } = rings(events)
    expect(`R drills ${ring2.rDrills.done}/${ring2.rDrills.total} · lab 01 ${ring2.lab01.done ? 'done' : 'open'} · tickets ${ring2.tickets.done}/${ring2.tickets.total}`).toBe(
      'R drills 3/5 · lab 01 open · tickets 11/19',
    )
    expect(ring2.rDrills.missing).toEqual(['rust-zero-r4', 'rust-zero-r5'])
    expect(ring2.tickets.missing).toEqual(RING2_LESSONS.slice(11))
  })
})

describe('ranks are rings, not XP', () => {
  test('a learner with thousands of XP and no ring is still RING 3', () => {
    const grind = Array.from({ length: 200 }, (_, d) => Array.from({ length: 60 }, () => evt('item', 'gen:frag/first-fit', at(d), { rev: 'r', data: { src: 'today', nsec: 30 } }))).flat()
    const agg = derive(grind)
    expect(xpOf(agg)).toBeGreaterThan(5000)
    expect(selectRings(agg).rank).toBe('RING 3')
  })

  test('RING 2 does not need any XP at all', () => {
    const agg = derive(ring2Ledger())
    expect(xpOf(agg)).toBeGreaterThan(0)
    // the same facts, with the item time stripped: still RING 2
    expect(selectRings({ ...agg, itemSec: {} }).rank).toBe('RING 2')
  })

  test('RING 1, RING 0 and ROOT are named but never earned yet', () => {
    expect(RING_NAMES).toEqual(['RING 3', 'RING 2', 'RING 1', 'RING 0', 'ROOT'])
    expect(RINGS_PENDING).toEqual(['RING 1', 'RING 0', 'ROOT'])
    const everything = derive([...ring2Ledger(), ...Object.keys(LABS).map((l) => unseenRun(l, LABS[l].checks)), evt('complete', 'boot', at(0))])
    expect(selectRings(everything).earned).toEqual(['RING 3', 'RING 2'])
  })
})

describe('never revoked, never order-dependent', () => {
  test('any order of the events gives the same rings', () => {
    const events = ring2Ledger()
    const reference = rings(events)
    for (let seed = 1; seed <= 20; seed++) expect(rings(shuffle(splitmix32(seed), events))).toEqual(reference)
  })

  test('anything the learner does afterwards keeps the ring: failed runs, failed tickets, reads, other labs', () => {
    const earned = ring2Ledger()
    const later: LedgerEvent[] = [
      evt('quiz', 'lesson:t0.l1', at(50), { score: 0, ok: false, data: { form: 'ticket' } }),
      evt('complete', 'lesson:t0.l2', at(50), { data: { via: 'read' } }),
      unseenRun('rust-zero-r1', [], 50),
      greenRun(RING2_LAB, [], 50),
      evt('lab-check', `lab:${RING2_LAB}`, at(50), {
        score: 0,
        ok: false,
        provenance: 'unseen',
        data: { passed: [], total: 6, abi: 2, seeds: 'fresh', checks: LABS[RING2_LAB].checks.map((id) => ({ id, status: 'fail' })) },
      }),
      evt('ack', `hint:${RING2_LAB}/coalesce#bottom`, at(50)), // seeing the answer assists later runs; it revokes nothing
    ]
    expect(rings([...earned, ...later]).rank).toBe('RING 2')
    expect(rings([...later, ...earned]).rank).toBe('RING 2')
  })

  test('adding events never lowers a count (a random superset of a partial ledger)', () => {
    const all = ring2Ledger()
    for (let seed = 1; seed <= 25; seed++) {
      const rand = splitmix32(seed)
      const order = shuffle(rand, all)
      const cut = Math.floor(rand() * order.length)
      const small = rings(order.slice(0, cut))
      const big = rings(order)
      expect(big.ring2.tickets.done).toBeGreaterThanOrEqual(small.ring2.tickets.done)
      expect(big.ring2.rDrills.done).toBeGreaterThanOrEqual(small.ring2.rDrills.done)
      expect(big.ring2.lab01.checks.done).toBeGreaterThanOrEqual(small.ring2.lab01.checks.done)
      if (small.ring2.earned) expect(big.ring2.earned).toBe(true)
    }
  })

  test('a Wave 0b snapshot upgraded in place still reads: a quiz pass is done, the rest is empty', () => {
    const v2 = derive([passLesson('t0.l1', 'checkpoint'), evt('complete', 'lesson:t0.l2', at(0))])
    const v1 = {
      ...structuredClone(v2),
      v: 1,
      lessons: Object.fromEntries(Object.entries(v2.lessons).map(([k, L]) => [k, { done: L.done, completedAt: L.completedAt, lastAt: L.lastAt, quizBest: L.quizBest }])),
      sims: {},
      labs: {},
    }
    // `upgradeAggregate` infers `passedAt` from the quiz-pass fact, so the ticket count survives the upgrade
    const upgraded = upgradeAggregate(v1 as unknown as Parameters<typeof upgradeAggregate>[0]) as Aggregate
    expect(selectRings(upgraded).ring2.tickets.done).toBe(1)
  })
})
