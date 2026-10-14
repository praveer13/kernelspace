/**
 * Rings (wave-1.md §8.5, task B7; wave-2.md §6.4, task 2a-31): rank is the highest ring earned, never an XP
 * threshold. RING 2 needs R1–R5 and lab 01 on unseen seeds plus all 19 T0–T2 lessons *done*, at any provenance.
 * RING 1, RING 0 and ROOT read the same way from their own labs, lessons, Fleet Week runs, Dailies and cold
 * checks. Read lessons do not count (O4). A ring is never revoked: every input is monotone in the event set.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  LABS,
  RING0_LABS,
  RING0_LESSONS,
  RING1_LABS,
  RING1_LESSONS,
  RING1_R_LABS,
  RING2_LAB,
  RING2_LESSONS,
  RING2_R_LABS,
  ROOT_ACTS,
  ROOT_COLD,
  ROOT_DAILIES,
  ROOT_FLEET_RUNS,
  ROOT_LAB,
  ROOT_LESSONS,
} from '../../src/lib/economy-table'
import { RING_NAMES, ROOT_COLD_ACHIEVEMENT, selectColdChecks, selectRings, xpOf } from '../../src/lib/economy'
import { ringSections } from '../../src/pages/progress/ring-rows'
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

  test('the five rings are named, outermost first', () => {
    expect(RING_NAMES).toEqual(['RING 3', 'RING 2', 'RING 1', 'RING 0', 'ROOT'])
  })

  test('every lab in the table unseen, with only the T0–T2 lessons passed, earns nothing beyond RING 2', () => {
    const everyLab = derive([...ring2Ledger(), ...Object.keys(LABS).map((l) => unseenRun(l, LABS[l].checks)), evt('complete', 'boot', at(0))])
    expect(selectRings(everyLab).earned).toEqual(['RING 3', 'RING 2'])
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

/* ------------------------------------------------------------------ */
/* RING 1, RING 0 and ROOT (wave-2.md §6.4)                            */
/* ------------------------------------------------------------------ */

const SPIRALS = ['t3.l7', 't4.l7', 't5.l10', 't6.l10', 't7.l5']
const unseenAll = (ids: readonly string[]) => ids.map((lab) => unseenRun(lab, LABS[lab].checks))
const passAll = (ids: readonly string[]) => ids.map((id) => passLesson(id, SPIRALS.includes(id) ? 'spiral' : 'ticket'))

const ring1Ledger = () => [...unseenAll([...RING1_R_LABS, ...RING1_LABS]), ...passAll(RING1_LESSONS)]

const fleetRun = (mode: string, provenance: 'unseen' | 'practice' = 'unseen', ok = true, day = 0) =>
  evt('fleet-run', `fleet:${mode}`, at(day), { score: ok ? 1 : 0.2, ok, provenance, data: { v: 1, mode, seeds: provenance === 'unseen' ? 'fresh' : 'practice' } })
/** Lab 06's race (wave-3.md §8.3): an engine run with one component, from `labId`; ok means within 3 points of the reference. */
const labRace = (labId = 'batching-scheduler', provenance: 'unseen' | 'practice' = 'unseen', ok = true, day = 0) =>
  evt('fleet-run', 'fleet:engine', at(day), {
    score: ok ? 1 : 0.2,
    ok,
    provenance,
    data: { v: 1, mode: 'engine', components: [{ slot: 'scheduler', labId, sha256: 'ab'.repeat(32) }], seeds: provenance === 'unseen' ? 'fresh' : 'practice', goodput: 40, refGoodput: 41 },
  })
const ring0Ledger = () => [...unseenAll(RING0_LABS), labRace(), ...passAll(RING0_LESSONS)]
const fleetAct = (act: string, ok = true) => evt('fleet-act', `fw:${act}`, at(0), { score: ok ? 1 : 0.1, ok })
const daily = (date: string, ok = true) =>
  evt('incident', `inc:daily/${date}`, at(0), { score: ok ? 1 : 0, ok, provenance: 'practice', data: { v: 1, src: 'daily', date } })
const dates = (n: number) => Array.from({ length: n }, (_, i) => `2027-05-${String(i + 1).padStart(2, '0')}`)

/** A Today cold check on a KC last exposed `sinceDays` earlier (30 unless `data` says otherwise). */
const probe = (day: number, ok: boolean, extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}) =>
  evt('probe', 'gen:frag/first-fit', at(day), { score: ok ? 1 : 0, ok, provenance: 'practice', data: { src: 'today', sinceDays: 30, ...data }, ...extra })
/** `n` cold checks on consecutive days, `right` of them correct: the misses come last, or first with `missesFirst`. */
const coldChecks = (n: number, right: number, missesFirst = false) =>
  Array.from({ length: n }, (_, i) => probe(i, missesFirst ? i >= n - right : i < right))

const rootExtras = () => [
  ...unseenAll([ROOT_LAB]),
  ...ROOT_FLEET_RUNS.map((m) => fleetRun(m)),
  ...ROOT_ACTS.map((a) => fleetAct(a)),
  ...dates(ROOT_DAILIES).map((d) => daily(d)),
  ...passAll(ROOT_LESSONS),
]
const rootLedger = () => [...rootExtras(), ...coldChecks(40, 32)]
const rootRings = (events: LedgerEvent[]) => selectRings(derive(events), selectColdChecks(events))

describe('the ids the rings read', () => {
  test('RING 1 is R6–R10, labs 04–05 and the 14 T3–T4 lessons; RING 0 is labs 02, 03, 06, 07 and the 10 T5 lessons', () => {
    expect([...RING1_R_LABS]).toEqual(['rust-zero-r6', 'rust-zero-r7', 'rust-zero-r8', 'rust-zero-r9', 'rust-zero-r10'])
    expect([...RING1_LABS]).toEqual(['mpmc-queue', 'toy-executor'])
    expect(RING1_LESSONS).toHaveLength(14)
    expect([...RING0_LABS]).toEqual(['kv-block-manager', 'bpe-tokenizer', 'batching-scheduler', 'radix-cache'])
    expect(RING0_LESSONS).toHaveLength(10)
  })

  test('ROOT is lab 08, Acts I–II, the three acts, 5 Dailies, the 15 T6–T7 lessons and 40 cold checks at 80 % from 30 days', () => {
    expect(ROOT_LAB).toBe('xgrammar-lite')
    expect([...ROOT_FLEET_RUNS]).toEqual(['act1', 'act2'])
    expect([...ROOT_ACTS]).toEqual(['engine', 'fleet', 'business'])
    expect(ROOT_DAILIES).toBe(5)
    expect(ROOT_LESSONS).toHaveLength(15)
    expect(ROOT_COLD).toEqual({ days: 30, n: 40, rate: 0.8 })
  })

  test('every lab the rings name is in the economy table', () => {
    for (const id of [...RING1_R_LABS, ...RING1_LABS, ...RING0_LABS, ROOT_LAB]) expect(LABS[id]).toBeDefined()
  })
})

describe('the RING 1 fixtures', () => {
  test('R6–R10, labs 04–05 unseen and all T3–T4 lessons done: RING 1', () => {
    const r = rings(ring1Ledger())
    expect(r.ring1).toEqual({
      earned: true,
      rDrills: { done: 5, total: 5, missing: [] },
      labs: { done: 2, total: 2, missing: [] },
      tickets: { done: 14, total: 14, missing: [] },
    })
    expect(r.rank).toBe('RING 1')
  })

  test('each part is needed, and one missing required check is enough to miss', () => {
    const labs = unseenAll([...RING1_R_LABS, ...RING1_LABS])
    expect(rings([...labs.slice(1), ...passAll(RING1_LESSONS)]).ring1.rDrills.missing).toEqual(['rust-zero-r6']) // no R6
    expect(rings([...labs.slice(0, 6), ...passAll(RING1_LESSONS)]).ring1.labs.missing).toEqual(['toy-executor']) // no lab 05
    expect(rings(labs).ring1.tickets.done).toBe(0) // no tickets
    expect(rings(passAll(RING1_LESSONS)).ring1.earned).toBe(false) // no labs
    const almost = unseenRun('mpmc-queue', LABS['mpmc-queue'].checks.filter((c) => c !== 'burst_model'))
    const r = rings([...unseenAll([...RING1_R_LABS, 'toy-executor']), almost, ...passAll(RING1_LESSONS)])
    expect(r.ring1.earned).toBe(false)
    expect(r.ring1.labs).toEqual({ done: 1, total: 2, missing: ['mpmc-queue'] })
  })

  test('the lessons count when passed, not when read; a lesson from another ring does not count', () => {
    const reads = RING1_LESSONS.map((id) => evt('complete', `lesson:${id}`, at(0), { data: { via: 'read' } }))
    expect(rings([...unseenAll([...RING1_R_LABS, ...RING1_LABS]), ...reads]).ring1.tickets.done).toBe(0)
    const half = [...passAll(RING1_LESSONS.slice(0, 13)), passLesson('t5.l1')]
    expect(rings(half).ring1.tickets).toEqual({ done: 13, total: 14, missing: ['t4.l7'] })
  })

  test('unseen means seeds drawn at grade time: green runs on the visible seeds earn nothing', () => {
    const green = [...RING1_R_LABS, ...RING1_LABS].map((lab) => greenRun(lab, LABS[lab].checks))
    expect(rings([...green, ...passAll(RING1_LESSONS)]).ring1.rDrills.done).toBe(0)
  })
})

describe('the RING 0 fixtures', () => {
  test('labs 02, 03, 06, 07 unseen and all T5 lessons done: RING 0', () => {
    const r = rings(ring0Ledger())
    expect(r.ring0).toEqual({
      earned: true,
      labs: { done: 4, total: 4, missing: [] },
      race: { done: 1, total: 1, missing: [] },
      tickets: { done: 10, total: 10, missing: [] },
    })
    expect(r.rank).toBe('RING 0')
  })

  test('each of the four labs and the T5 lessons is needed', () => {
    for (const lab of RING0_LABS) {
      const r = rings([...unseenAll(RING0_LABS.filter((l) => l !== lab)), labRace(), ...passAll(RING0_LESSONS)])
      expect(r.ring0.earned).toBe(false)
      expect(r.ring0.labs.missing).toEqual([lab])
    }
    expect(rings([...unseenAll(RING0_LABS), labRace()]).ring0.earned).toBe(false)
    expect(rings([...passAll(RING0_LESSONS.slice(0, 9)), ...unseenAll(RING0_LABS), labRace()]).ring0.tickets.missing).toEqual(['t5.l10'])
  })

  test('lab 06 counts on its unseen checks; the race against the reference is its own line', () => {
    expect(rings([unseenRun('batching-scheduler', LABS['batching-scheduler'].checks)]).ring0.labs.done).toBe(1)
    // the check ids are the whole criterion today: a lower goodput score on the same checks changes nothing
    const lower = evt('lab-check', 'lab:batching-scheduler', at(0), {
      score: 0.5,
      ok: true,
      provenance: 'unseen',
      data: { passed: [...LABS['batching-scheduler'].checks], total: 6, abi: 2, seeds: 'fresh', checks: LABS['batching-scheduler'].checks.map((id) => ({ id, status: 'pass' })) },
    })
    expect(rings([lower]).ring0.labs.done).toBe(1)
  })

  test('RING 0 needs lab 06 within 3 points of the reference: with labFleetOk it is earned, without it it is not', () => {
    const without = [...unseenAll(RING0_LABS), ...passAll(RING0_LESSONS)]
    const r = rings(without)
    expect(r.ring0).toMatchObject({ earned: false, race: { done: 0, total: 1, missing: ['batching-scheduler'] } })
    expect(r.ring0.labs.missing).toEqual([])
    expect(r.rank).toBe('RING 3')
    const withRace = rings([...without, labRace()])
    expect(withRace.ring0).toMatchObject({ earned: true, race: { done: 1, total: 1, missing: [] } })
    expect(withRace.rank).toBe('RING 0')
    // the race alone earns nothing else
    expect(rings([labRace()]).ring0).toMatchObject({ earned: false, race: { done: 1 }, labs: { done: 0 }, tickets: { done: 0 } })
  })

  test('only an ok, unseen engine race from lab 06 turns the line green', () => {
    const base = [...unseenAll(RING0_LABS), ...passAll(RING0_LESSONS)]
    for (const [name, race] of [
      ['a practice race', labRace('batching-scheduler', 'practice')],
      ['a race more than 3 points behind', labRace('batching-scheduler', 'unseen', false)],
      ['a race of another lab', labRace('rust-allocator')],
    ] as const) {
      const r = rings([...base, race])
      expect(`${name}: ${r.ring0.earned}`).toBe(`${name}: false`)
      expect(r.ring0.race.missing).toEqual(['batching-scheduler'])
    }
  })

  test('a later miss does not take the race back (the fold is a set union)', () => {
    const events = [...ring0Ledger(), labRace('batching-scheduler', 'unseen', false, 9)]
    expect(rings(events).ring0.earned).toBe(true)
  })
})

describe('the ROOT fixtures', () => {
  test('lab 08, Acts I–II, the three acts, 5 Dailies, T6–T7 and 40 cold checks at 80 %: ROOT', () => {
    const r = rootRings(rootLedger())
    expect(r.root).toMatchObject({
      earned: true,
      lab08: { done: true, checks: { done: 6, total: 6 } },
      fleetRuns: { done: 2, total: 2, missing: [] },
      acts: { done: 3, total: 3, missing: [] },
      daily: { done: 5, total: 5 },
      tickets: { done: 15, total: 15, missing: [] },
      cold: { n: 40, correct: 32, met: true, needN: 40, needRate: 0.8 },
    })
    expect(r.rank).toBe('ROOT')
    expect(r.earned).toEqual(['RING 3', 'ROOT'])
  })

  test('each part is needed: dropping any one of them loses ROOT', () => {
    const drops: [string, (e: LedgerEvent) => boolean][] = [
      ['lab 08', (e) => e.ref === `lab:${ROOT_LAB}`],
      ['Act I with an own module', (e) => e.ref === 'fleet:act1'],
      ['Act II with an own module', (e) => e.ref === 'fleet:act2'],
      ['the engine act', (e) => e.ref === 'fw:engine'],
      ['the fleet act', (e) => e.ref === 'fw:fleet'],
      ['the business act', (e) => e.ref === 'fw:business'],
      ['a Daily', (e) => e.ref === 'inc:daily/2027-05-05'],
      ['the last T7 lesson', (e) => e.ref === 'lesson:t7.l5'],
      ['the first T6 lesson', (e) => e.ref === 'lesson:t6.l1'],
      ['the cold checks', (e) => e.kind === 'probe'],
    ]
    expect(rootRings(rootLedger()).root.earned).toBe(true)
    for (const [what, drop] of drops) {
      const r = rootRings(rootLedger().filter((e) => !drop(e)))
      expect([what, r.root.earned]).toEqual([what, false])
      expect(r.earned).not.toContain('ROOT')
    }
  })

  test('Fleet Week runs count when ok on unseen seeds: a practice-seed run or a failed run does not', () => {
    const base = rootExtras().filter((e) => e.kind !== 'fleet-run')
    const cold = coldChecks(40, 40)
    expect(rootRings([...base, fleetRun('act1', 'practice'), fleetRun('act2'), ...cold]).root.fleetRuns.missing).toEqual(['act1'])
    expect(rootRings([...base, fleetRun('act1', 'unseen', false), fleetRun('act2'), ...cold]).root.fleetRuns.missing).toEqual(['act1'])
    expect(rootRings([...base, fleetRun('act1'), fleetRun('act2'), ...cold]).root.earned).toBe(true)
    // an unseen pass and a practice pass of the same act, in either order
    expect(rootRings([...base, fleetRun('act1', 'practice', true, 1), fleetRun('act1', 'unseen', true, 2), fleetRun('act2'), ...cold]).root.earned).toBe(true)
    expect(rootRings([...base, fleetRun('act1', 'unseen', true, 1), fleetRun('act1', 'practice', true, 2), fleetRun('act2'), ...cold]).root.earned).toBe(true)
  })

  test('the Dailies are five distinct dates that were solved; a repeat of a date, a failed one or a drill is not another', () => {
    const base = rootExtras().filter((e) => e.kind !== 'incident')
    const cold = coldChecks(40, 40)
    const four = dates(4).map((d) => daily(d))
    expect(rootRings([...base, ...four, ...cold]).root.daily).toEqual({ done: 4, total: 5 })
    expect(rootRings([...base, ...four, daily('2027-05-04'), ...cold]).root.daily.done).toBe(4)
    expect(rootRings([...base, ...four, daily('2027-05-05', false), ...cold]).root.daily.done).toBe(4)
    expect(rootRings([...base, ...dates(6).map((d) => daily(d)), ...cold]).root.earned).toBe(true)
    const drill = evt('incident', 'inc:drill/drain-stall', at(0), { data: { v: 1, src: 'drill' } })
    expect(rootRings([...base, ...four, drill, ...cold]).root.daily.done).toBe(4)
  })

  test("without the ledger's cold checks (the snapshot-only chip) ROOT is not earned, and the other rings are unaffected", () => {
    const events = [...rootLedger(), ...ring1Ledger(), ...ring0Ledger()]
    const snapshot = selectRings(derive(events))
    expect(snapshot.root.earned).toBe(false)
    expect(snapshot.root.cold).toMatchObject({ n: 0, correct: 0, met: false })
    expect(snapshot.earned).toEqual(['RING 3', 'RING 1', 'RING 0'])
    expect(snapshot.rank).toBe('RING 0')
    const full = rootRings(events)
    expect(full.earned).toEqual(['RING 3', 'RING 1', 'RING 0', 'ROOT'])
    expect(full.rank).toBe('ROOT')
  })

  test('rings are earned on their own criteria: the rings in between do not gate', () => {
    expect(rootRings(rootLedger()).earned).toEqual(['RING 3', 'ROOT'])
    expect(rings(ring0Ledger()).earned).toEqual(['RING 3', 'RING 0'])
    expect(rings([...ring2Ledger(), ...ring1Ledger(), ...ring0Ledger()]).earned).toEqual(['RING 3', 'RING 2', 'RING 1', 'RING 0'])
  })

  test('never revoked, in any order: failed runs, misses and reads afterwards keep every ring', () => {
    const earned = [...ring2Ledger(), ...ring1Ledger(), ...ring0Ledger(), ...rootLedger()]
    const later: LedgerEvent[] = [
      unseenRun('xgrammar-lite', [], 60),
      fleetRun('act1', 'unseen', false, 60),
      fleetAct('engine', false),
      daily('2027-05-01', false),
      evt('quiz', 'lesson:t6.l1', at(60), { score: 0, ok: false, data: { form: 'ticket' } }),
      evt('complete', 'lesson:t5.l1', at(60), { data: { via: 'read' } }),
      ...Array.from({ length: 30 }, (_, i) => probe(100 + i, false)),
    ]
    const reference = rootRings(earned)
    expect(reference.earned).toEqual(['RING 3', 'RING 2', 'RING 1', 'RING 0', 'ROOT'])
    expect(rootRings([...earned, ...later]).earned).toEqual(reference.earned)
    expect(rootRings([...later, ...earned]).earned).toEqual(reference.earned)
    for (let seed = 1; seed <= 10; seed++) expect(rootRings(shuffle(splitmix32(seed), [...earned, ...later])).earned).toEqual(reference.earned)
  })

  test('adding events never lowers a count (a random superset of a partial ledger)', () => {
    const all = [...ring1Ledger(), ...ring0Ledger(), ...rootLedger()]
    for (let seed = 1; seed <= 25; seed++) {
      const rand = splitmix32(seed)
      const order = shuffle(rand, all)
      const cut = Math.floor(rand() * order.length)
      const small = rootRings(order.slice(0, cut))
      const big = rootRings(order)
      expect(big.ring1.tickets.done).toBeGreaterThanOrEqual(small.ring1.tickets.done)
      expect(big.ring1.rDrills.done).toBeGreaterThanOrEqual(small.ring1.rDrills.done)
      expect(big.ring0.labs.done).toBeGreaterThanOrEqual(small.ring0.labs.done)
      expect(big.root.tickets.done).toBeGreaterThanOrEqual(small.root.tickets.done)
      expect(big.root.daily.done).toBeGreaterThanOrEqual(small.root.daily.done)
      expect(big.root.acts.done).toBeGreaterThanOrEqual(small.root.acts.done)
      expect(big.root.fleetRuns.done).toBeGreaterThanOrEqual(small.root.fleetRuns.done)
      expect(big.root.cold.n).toBeGreaterThanOrEqual(small.root.cold.n)
      for (const ring of small.earned) expect(big.earned).toContain(ring)
    }
  })
})

describe('selectColdChecks', () => {
  test('counts Today probes whose KC was last exposed 30 days or more earlier, not assisted', () => {
    const events = [
      ...coldChecks(10, 8),
      probe(20, true, {}, { sinceDays: 29 }), // too fresh
      probe(21, true, {}, { sinceDays: 400 }),
      probe(22, true, {}, { src: 'cold' }), // a Wave 0b lesson cold check, not a Today slot
      probe(23, true, {}, { sinceDays: undefined }),
      evt('item', 'gen:frag/first-fit', at(24), { data: { src: 'today', sinceDays: 90 } }), // an item, not a probe
      probe(25, true, { provenance: 'assisted' }),
    ]
    expect(selectColdChecks(events)).toEqual({ n: 11, correct: 9, met: false })
  })

  test('40 checks at 80 % is the bar; 39, or 31 of 40, is not', () => {
    expect(selectColdChecks(coldChecks(40, 32)).met).toBe(true)
    expect(selectColdChecks(coldChecks(40, 31)).met).toBe(false)
    expect(selectColdChecks(coldChecks(39, 39)).met).toBe(false)
    expect(selectColdChecks(coldChecks(40, 40))).toEqual({ n: 40, correct: 40, met: true })
    expect(selectColdChecks(coldChecks(50, 40)).met).toBe(true)
    expect(selectColdChecks([])).toEqual({ n: 0, correct: 0, met: false })
  })

  test('a later run of misses never takes it away (never revoked), and the order of the events does not matter', () => {
    const earned = coldChecks(40, 40)
    const misses = Array.from({ length: 30 }, (_, i) => probe(100 + i, false))
    const after = selectColdChecks([...earned, ...misses])
    expect(after).toEqual({ n: 70, correct: 40, met: true })
    for (let seed = 1; seed <= 20; seed++) expect(selectColdChecks(shuffle(splitmix32(seed), [...earned, ...misses]))).toEqual(after)
    // the misses first still reach the bar once enough right answers follow
    expect(selectColdChecks(coldChecks(40, 32, true)).met).toBe(true)
  })

  test('a merge that inserts earlier misses from another device never revokes ROOT (W8): the first time the bar was met is recorded', () => {
    // device A reached the bar (40 of 40) and recorded when, as Progress does the first time it reads the met bar
    const recorded = evt('achievement', `ach:${ROOT_COLD_ACHIEVEMENT}`, at(41))
    const deviceA = [...rootLedger().slice(0, -40), ...coldChecks(40, 40), recorded]
    expect(rootRings(deviceA).earned).toContain('ROOT')
    // device B holds 30 misses from before any of A's checks; the merge puts them first in time order
    const earlierMisses = Array.from({ length: 30 }, (_, i) => probe(-60 + i, false))
    const merged = [...deviceA, ...earlierMisses]
    expect(selectColdChecks(merged)).toEqual({ n: 70, correct: 40, met: true })
    expect(rootRings(merged).earned).toContain('ROOT')
    for (let seed = 1; seed <= 10; seed++) expect(rootRings(shuffle(splitmix32(seed), merged)).earned).toEqual(rootRings(merged).earned)
    // without the record the prefix rule alone would lose it, which is why the record exists
    expect(selectColdChecks([...coldChecks(40, 40), ...earlierMisses]).met).toBe(false)
    // and the record alone is not an earned bar for a ledger that has none of the other ROOT parts
    expect(rootRings([recorded]).earned).toEqual(['RING 3'])
  })

  test('the same event twice counts once', () => {
    const one = probe(0, true)
    expect(selectColdChecks([one, one, one]).n).toBe(1)
  })
})

describe('the checklists Progress shows', () => {
  const sections = (events: LedgerEvent[], known = true) => ringSections(rootRings(events), known)
  const row = (events: LedgerEvent[], ring: string, key: string, known = true) => {
    const found = sections(events, known).find((s) => s.ring === ring)?.rows.find((r) => r.key === key)
    if (!found) throw new Error(`no row ${ring}/${key}`)
    return found
  }

  test('four rings, each with its lines, and RING 2 keeps its Wave 1 lines', () => {
    const s = sections([])
    expect(s.map((x) => x.ring)).toEqual(['RING 2', 'RING 1', 'RING 0', 'ROOT'])
    expect(s.map((x) => x.rows.length)).toEqual([3, 3, 3, 6])
    expect(s[0].rows.map((r) => r.label)).toEqual(['R drills', 'Lab 01', 'Tickets'])
    expect(s[0].rows[0]).toMatchObject({ count: '0/5', to: '/forge/rust-zero-r1', action: 'next drill', done: false })
  })

  test('every line links to the first thing still open, and to a place once it is done', () => {
    expect(row([], 'RING 1', 'r-drills')).toMatchObject({ count: '0/5', to: '/forge/rust-zero-r6' })
    expect(row([], 'RING 1', 'labs')).toMatchObject({ count: '0/2', to: '/forge/mpmc-queue' })
    expect(row([], 'RING 1', 'tickets')).toMatchObject({ count: '0/14', to: '/lesson/t3.l1' })
    expect(row([], 'RING 0', 'labs')).toMatchObject({ count: '0/4', to: '/forge/kv-block-manager' })
    expect(row([], 'RING 0', 'race')).toMatchObject({ count: '0/1', done: false, to: '/forge/batching-scheduler', action: 'race the reference' })
    expect(row([], 'RING 0', 'tickets')).toMatchObject({ count: '0/10', to: '/lesson/t5.l1' })
    expect(row([], 'ROOT', 'lab08')).toMatchObject({ to: '/forge/xgrammar-lite' })
    expect(row([], 'ROOT', 'fleet-runs')).toMatchObject({ to: '/week' })
    expect(row([], 'ROOT', 'daily')).toMatchObject({ count: '0/5', to: '/daily' })
    expect(row([], 'ROOT', 'tickets')).toMatchObject({ count: '0/15', to: '/lesson/t6.l1' })
    expect(row([], 'ROOT', 'cold')).toMatchObject({ to: '/today' })
    // the first open one moves on as lines are done
    const partway = [...unseenAll(RING1_R_LABS.slice(0, 2)), ...passAll(RING1_LESSONS.slice(0, 8))]
    expect(row(partway, 'RING 1', 'r-drills')).toMatchObject({ count: '2/5', to: '/forge/rust-zero-r8' })
    expect(row(partway, 'RING 1', 'tickets')).toMatchObject({ count: '8/14', to: '/lesson/t4.l2' })
    // a finished line still opens something
    expect(row(ring1Ledger(), 'RING 1', 'tickets')).toMatchObject({ done: true, to: '/curriculum', action: 'open' })
    expect(row(ring1Ledger(), 'RING 1', 'labs')).toMatchObject({ done: true, to: '/forge/mpmc-queue' })
  })

  test('an earned ring says so, and the cold line says counting until the ledger is read', () => {
    expect(sections(ring1Ledger()).find((s) => s.ring === 'RING 1')?.earned).toBe(true)
    expect(sections(ring1Ledger()).find((s) => s.ring === 'RING 0')?.earned).toBe(false)
    expect(row([], 'ROOT', 'cold', false).count).toBe('counting')
    expect(row(coldChecks(40, 32), 'ROOT', 'cold')).toMatchObject({ done: true, count: '32/40 right, need 40 at 80 %' })
    expect(row(coldChecks(12, 6), 'ROOT', 'cold')).toMatchObject({ done: false, count: '6/12 right, need 40 at 80 %' })
  })
})

describe('the ring chip stays snapshot-only', () => {
  const src = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

  test('the shell and the pages that show the chip call selectRings with the aggregate alone', () => {
    for (const file of ['src/components/Navbar.tsx', 'src/pages/Curriculum.tsx', 'src/pages/Home.tsx', 'src/pages/Today.tsx']) {
      const calls = [...src(file).matchAll(/selectRings\(([^)]*)\)/g)].map((m) => m[1])
      expect(calls.length).toBeGreaterThan(0)
      for (const arg of calls) expect(arg).toMatch(/^(s\.)?aggregate$/)
    }
  })

  test("only the ring panel passes the ledger's cold checks, and economy.ts reaches no engine or review model", () => {
    expect(src('src/pages/Progress.tsx')).toMatch(/selectRings\(aggregate, cold\)/)
    const imports = [...src('src/lib/economy.ts').matchAll(/^import (?:type )?[^]*? from '([^']+)'/gm)].map((m) => m[1])
    expect(imports.sort()).toEqual(['./economy-table', './ledger/types'])
  })
})

describe('amber, per ring (src/lib/learner/ring-recall.ts)', () => {
  test('the bar is 0.8: below is amber, at or above is not, and no carded KC is nothing to nudge', async () => {
    const { recallOf } = await import('../../src/lib/learner/ring-recall')
    expect(recallOf([0.79, 0.79])).toMatchObject({ amber: true, cards: 2 })
    expect(recallOf([0.8])).toMatchObject({ amber: false })
    expect(recallOf([1, 0.6, 0.9])).toMatchObject({ amber: false }) // the mean is 0.833
    expect(recallOf([])).toEqual({ mean: null, cards: 0, amber: false })
  })

  test("a ring's KCs are the graph's KCs of its lessons plus the lessons' own tags; RING 2's equal summarize's", async () => {
    const { kcsOfLessons, ringKcSets } = await import('../../src/lib/learner/ring-recall')
    const { ringKcs } = await import('../../src/lib/learner/summary')
    const { cardsContent } = await import('../../src/lib/learner/cards')
    const { KCS, BOOT_KCS } = await import('../../src/data/kc')
    const { ALL_LESSONS } = await import('../../src/data/lessons')
    const cc = cardsContent({ kcs: KCS, lessons: ALL_LESSONS, bootKcs: BOOT_KCS, resolve: () => [] })
    const sets = ringKcSets(cc)
    expect([...sets['RING 2']].sort()).toEqual([...ringKcs(cc)].sort())
    for (const ring of ['RING 2', 'RING 1', 'RING 0', 'ROOT'] as const) expect(sets[ring].size).toBeGreaterThan(0)
    const t3 = ALL_LESSONS.find((l) => l.id === 't3.l1')
    for (const kc of t3?.kcs ?? []) expect(sets['RING 1'].has(kc)).toBe(true)
    expect(kcsOfLessons(cc, ['t0.l1']).size).toBeGreaterThan(0)
  })

  test('a ring whose cards have faded is amber and one reviewed yesterday is not, from the same ledger', async () => {
    const { ringRecalls } = await import('../../src/lib/learner/ring-recall')
    const content = {
      kcs: [
        { id: 'k.old', lessons: ['t3.l1'] },
        { id: 'k.new', lessons: ['t0.l1'] },
      ],
      bootKcs: [],
      lessons: [
        { id: 't3.l1', kcs: ['k.old'] },
        { id: 't0.l1', kcs: ['k.new'] },
      ],
      resolve: () => [],
    }
    const events = [passLesson('t3.l1', 'ticket', 0), passLesson('t0.l1', 'ticket', 49)]
    const out = ringRecalls(events, content as never, {}, new Date(START_MS + 50 * DAY_MS))
    expect(out['RING 1']).toMatchObject({ cards: 1, amber: true })
    expect(out['RING 2']).toMatchObject({ cards: 1, amber: false })
    expect(out['RING 0']).toEqual({ mean: null, cards: 0, amber: false })
    expect(out.ROOT.amber).toBe(false)
    expect(out['RING 1'].mean as number).toBeLessThan(0.8)
    expect(out['RING 2'].mean as number).toBeGreaterThan(0.8)
  })

  test('amber is a nudge: selectRings takes no recall, so none can revoke or withhold a ring', () => {
    expect(selectRings.length).toBe(2) // (aggregate, cold)
    expect(selectRings(derive(ring1Ledger())).rank).toBe('RING 1')
  })
})
