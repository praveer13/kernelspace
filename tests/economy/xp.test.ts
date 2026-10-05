/**
 * XP v2 (wave-1.md §8.4, task B7): 1 XP = 1 nominal minute of graded work, each fact paid once, graded
 * items capped at 30 minutes per local day. XP is a function of the event set, never of its order.
 * The last test prints a synthetic year's XP split by source.
 */
import { describe, expect, test } from 'bun:test'
import { LABS } from '../../src/lib/economy-table'
import { XP, XP_SOURCES, factMinutes, xpBySource, xpOf, type XpSource } from '../../src/lib/economy'
import { derive } from '../../src/lib/ledger/fold'
import { factXp, toProgressData, xpOf as viewXpOf } from '../../src/lib/ledger/view'
import { LESSONS_BY_TRACK } from '../../src/data/lessons'
import type { LedgerEvent } from '../../src/lib/ledger/types'
import { evt, shuffle, START_MS } from '../ledger/gen'
import { splitmix32 } from '../../src/lib/rng'

const DAY_MS = 24 * 60 * 60 * 1000
const at = (day: number, minute = 0) => new Date(START_MS + day * DAY_MS + minute * 60_000).toISOString()

/** A graded item (a generator item, say) that took `nsec` seconds. */
const item = (day: number, nsec: number, ref = 'gen:frag/first-fit') =>
  evt('item', ref, at(day), { rev: 'r', data: { src: 'today', nsec } })

const labRun = (lab: string, passed: string[], day = 0) =>
  evt('lab-check', `lab:${lab}`, at(day), {
    score: passed.length / 6,
    ok: passed.length === 6,
    provenance: 'lab-green',
    data: { passed, total: 6 },
  })

describe('the price of a fact (§8.4)', () => {
  test('flat prices', () => {
    expect(factMinutes('quiz-pass:t0.l1')).toBe(3)
    expect(factMinutes('quiz-pass:t4.l2')).toBe(3) // a checkpoint pass pays like a ticket
    expect(factMinutes('quiz-pass:t2.l7')).toBe(8) // the spiral checkpoint
    expect(factMinutes('simo:sim-kv/a')).toBe(3)
    expect(factMinutes('prove:rust-allocator')).toBe(5)
    expect(factMinutes('boot')).toBe(10)
    expect(factMinutes('placement')).toBe(10)
  })

  test('table prices: a required check pays lab minutes ÷ required checks', () => {
    expect(factMinutes('labc:rust-allocator/coalesce')).toBe(15)
    expect(factMinutes('labc:rust-zero-r3/option_take')).toBeCloseTo(28 / 6, 12)
    expect(factMinutes('labc:radix-cache/exact_match')).toBe(25)
    expect(factMinutes('fw:engine')).toBe(30)
    expect(factMinutes('fw:fleet')).toBe(30)
    expect(factMinutes('fw:business')).toBe(30)
    expect(factMinutes('fw:incident')).toBe(20)
    expect(factMinutes('cap:tokenize')).toBe(30)
    expect(factMinutes('cap:forward')).toBe(45)
    expect(factMinutes('play:block-placement')).toBe(15)
  })

  test('clicks, toggles and the legacy sim fact pay nothing; so do unknown facts', () => {
    for (const fact of ['lesson:t0.l1', 'exercise:t0.l1', 'sim:sim-kv/a', 'lab:rust-allocator', 'weird:thing', 'weird', '', 'boot:x', 'placement:x']) {
      expect(factMinutes(fact)).toBe(0)
    }
  })

  test('an optional check, an unknown lab or check, and a malformed fact pay nothing', () => {
    expect(factMinutes('labc:kv-block-manager/adapter_unified_paging')).toBe(0) // optional
    expect(factMinutes('labc:rust-allocator/not-a-check')).toBe(0)
    expect(factMinutes('labc:no-such-lab/boot')).toBe(0)
    expect(factMinutes('labc:rust-allocator')).toBe(0)
    expect(factMinutes('labc:__proto__/x')).toBe(0)
    expect(factMinutes('fw:__proto__')).toBe(0)
    expect(factMinutes('cap:constructor')).toBe(0)
    expect(factMinutes('play:toString')).toBe(0)
  })

  test('every lab pays exactly its minutes across its required checks', () => {
    for (const [id, lab] of Object.entries(LABS)) {
      const passed = lab.checks
      const agg = derive([evt('lab-check', `lab:${id}`, at(0), { score: 1, ok: true, data: { passed, total: passed.length } })])
      expect(xpOf(agg)).toBe(lab.minutes)
    }
  })

  test('the view re-exports the same prices', () => {
    expect(factXp('labc:rust-allocator/boot')).toBe(15)
    expect(viewXpOf(derive([evt('complete', 'boot', at(0))]))).toBe(10)
  })
})

describe('XP of a ledger', () => {
  test('each fact pays once, however many events assert it', () => {
    const one = derive([evt('quiz', 'lesson:t0.l1', at(0), { score: 1, ok: true })])
    const many = derive([
      evt('quiz', 'lesson:t0.l1', at(0), { score: 1, ok: true }),
      evt('quiz', 'lesson:t0.l1', at(1), { score: 1, ok: true }),
      evt('quiz', 'lesson:t0.l1', at(2), { score: 0.9, ok: true }),
    ])
    expect(xpOf(one)).toBe(3)
    expect(xpOf(many)).toBe(3)
    expect(xpOf(derive([labRun('rust-allocator', ['boot', 'align']), labRun('rust-allocator', ['boot', 'align', 'reuse'], 1)]))).toBe(45)
  })

  test('clicking through every T0–T2 lesson pays nothing; passing pays 3 each and 8 for the spiral', () => {
    const lessons = (['t0', 't1', 't2'] as const).flatMap((t) => LESSONS_BY_TRACK[t].map((l) => l.id))
    expect(xpOf(derive(lessons.map((id, i) => evt('complete', `lesson:${id}`, at(i)))))).toBe(0)
    const passes = lessons.map((id, i) => evt('quiz', `lesson:${id}`, at(i), { score: 1, ok: true, data: { form: id === 't2.l7' ? 'spiral' : 'ticket' } }))
    expect(xpOf(derive(passes))).toBe(18 * 3 + 8)
  })

  test('a failed quiz, a failed lab run and a missed sim outcome pay nothing', () => {
    const agg = derive([
      evt('quiz', 'lesson:t0.l1', at(0), { score: 0.4, ok: false }),
      labRun('rust-allocator', []),
      evt('sim-task', 'sim:sim-kv/a', at(0), { ok: false, data: { v: 2, outcome: true } }),
    ])
    expect(xpOf(agg)).toBe(0)
  })

  test('a sim-task pays only with an outcome', () => {
    expect(xpOf(derive([evt('sim-task', 'sim:sim-kv/a', at(0))]))).toBe(0)
    expect(xpOf(derive([evt('sim-task', 'sim:sim-kv/a', at(0), { data: { v: 2, outcome: true } })]))).toBe(3)
  })

  test('play, prove, boot, placement, Fleet Week and Capstone', () => {
    const agg = derive([
      evt('play', 'play:block-placement', at(0), { data: { phase: 'play', turns: 9, survived: 9, ghostSurvived: 9 } }),
      evt('prove', 'prove:rust-allocator', at(0), { data: { qids: ['q'], self: [1] } }),
      evt('complete', 'boot', at(0)),
      evt('complete', 'placement', at(0)),
      evt('fleet-act', 'fw:incident', at(0), { score: 1, ok: true }),
      evt('capstone-step', 'cap:embed', at(0), { data: { index: 1 } }),
    ])
    expect(xpOf(agg)).toBe(15 + 5 + 10 + 10 + 20 + 25)
    // a compose-phase result is not a debrief: it adds no fact
    expect(xpOf(derive([evt('play', 'play:block-placement', at(0), { data: { phase: 'compose', turns: 9, survived: 9, ghostSurvived: 9 } })]))).toBe(0)
  })

  test('toProgressData.xp is the economy v2 number', () => {
    const agg = derive([evt('quiz', 'lesson:t0.l1', at(0), { score: 1, ok: true }), item(0, 60)])
    expect(toProgressData(agg).xp).toBe(xpOf(agg))
    expect(xpOf(agg)).toBe(3 + 1)
  })
})

describe('graded items and the daily cap', () => {
  test('items pay their nominal minutes: Σ nsec ÷ 60', () => {
    expect(xpOf(derive([item(0, 600), item(0, 600), item(0, 300)]))).toBe(25)
    expect(xpOf(derive([item(0, 30)]))).toBe(1) // 0.5 min rounds up
    expect(xpOf(derive([evt('predict', 'pre:t1.l4#0', at(0), { rev: 'r', data: { value: 1, unit: 'x', truth: 1, src: 'pre', nsec: 120 } })]))).toBe(2)
    expect(xpOf(derive([evt('probe', 'gen:kv/bytes-per-token', at(0), { rev: 'r', data: { src: 'practice', nsec: 90 } })]))).toBe(2)
  })

  test('an item with no nsec counts 30 s, and one longer than 600 s counts 600', () => {
    expect(xpOf(derive(Array.from({ length: 20 }, () => item(0, Number.NaN))))).toBe(10)
    expect(xpOf(derive([evt('item', 'gen:frag/x', at(0), { rev: 'r', data: { src: 'today' } }), evt('item', 'gen:frag/y', at(0), { rev: 'r', data: { src: 'today', nsec: 9999 } })]))).toBe(11)
  })

  test('item minutes stop at 30 per local day', () => {
    const forty = Array.from({ length: 4 }, () => item(0, 600)) // 40 minutes on one day
    expect(xpOf(derive(forty))).toBe(30)
    expect(xpOf(derive([...forty, item(0, 600)]))).toBe(30)
  })

  test('the cap is per day: the same 40 minutes over two days pays 40', () => {
    const split = [item(0, 600), item(0, 600), item(1, 600), item(1, 600)]
    expect(xpOf(derive(split))).toBe(40)
    const uneven = [item(0, 600), item(0, 600), item(0, 600), item(0, 600), item(1, 300)] // 30 (capped from 40) + 5
    expect(xpOf(derive(uneven))).toBe(35)
  })

  test('the cap does not touch other facts: a capped day still pays tickets and labs', () => {
    const agg = derive([...Array.from({ length: 6 }, () => item(0, 600)), evt('quiz', 'lesson:t0.l1', at(0), { score: 1, ok: true }), labRun('rust-allocator', ['boot'])])
    expect(xpOf(agg)).toBe(30 + 3 + 15)
  })

  test('the day is the learner\'s local day, as the ledger recorded it', () => {
    // 23:30 and 00:30 UTC are one day for UTC+0 but two days for a learner at UTC-1 (tz is minutes west)
    const events = [
      evt('item', 'gen:frag/a', '2026-09-01T23:30:00.000Z', { rev: 'r', data: { nsec: 600 } }, 60),
      evt('item', 'gen:frag/b', '2026-09-02T00:30:00.000Z', { rev: 'r', data: { nsec: 600 } }, 60),
    ]
    expect(xpOf(derive(events))).toBe(20)
  })
})

describe('order-insensitivity', () => {
  /** One ledger touching every price: facts, fractional lab prices, several item days. */
  function mixed(): LedgerEvent[] {
    const events: LedgerEvent[] = [
      evt('complete', 'boot', at(0)),
      evt('complete', 'placement', at(0)),
      evt('quiz', 'lesson:t2.l7', at(1), { score: 1, ok: true, data: { form: 'spiral' } }),
      evt('quiz', 'lesson:t0.l1', at(1), { score: 1, ok: true }),
      evt('play', 'play:block-placement', at(2), { data: { phase: 'play', turns: 1, survived: 1, ghostSurvived: 1 } }),
      evt('sim-task', 'sim:sim-kv/a', at(2), { data: { v: 2, outcome: true } }),
      evt('prove', 'prove:rust-allocator', at(3), { data: { qids: ['q'], self: [1] } }),
      evt('fleet-act', 'fw:incident', at(3), { score: 1, ok: true }),
      evt('capstone-step', 'cap:decode', at(3), { data: { index: 3 } }),
    ]
    for (const [i, id] of Object.keys(LABS).entries()) {
      // every lab, one check per run, so the fractional prices (28 ÷ 6, 32 ÷ 6, …) are added in many orders
      LABS[id].checks.forEach((check, j) => events.push(labRun(id, [check], 4 + ((i + j) % 5))))
    }
    for (let d = 0; d < 12; d++) for (let k = 0; k < 7; k++) events.push(item(10 + d, 17 * k + d + 1))
    return events
  }

  test('any permutation of the events, and any repeat, gives the same XP and the same split', () => {
    const events = mixed()
    const reference = xpBySource(derive(events))
    const total = xpOf(derive(events))
    expect(total).toBeGreaterThan(1300)
    for (let seed = 1; seed <= 25; seed++) {
      const shuffled = shuffle(splitmix32(seed), events)
      expect(xpBySource(derive(shuffled))).toEqual(reference)
      expect(xpOf(derive(shuffled))).toBe(total)
      expect(xpOf(derive([...shuffled, ...events.slice(0, 20)]))).toBe(total)
    }
  })

  test('summing facts in any key order gives the same XP', () => {
    const agg = derive(mixed())
    const keys = Object.keys(agg.facts)
    for (let seed = 1; seed <= 25; seed++) {
      const facts = Object.fromEntries(shuffle(splitmix32(seed), keys).map((k) => [k, true as const]))
      expect(xpOf({ facts, itemSec: agg.itemSec })).toBe(xpOf(agg))
    }
  })

  test('the split adds up to the total', () => {
    const agg = derive(mixed())
    const by = xpBySource(agg)
    expect(Object.keys(by).sort()).toEqual([...XP_SOURCES].sort())
    expect(XP_SOURCES.reduce((sum, s) => sum + by[s], 0)).toBe(xpOf(agg))
    expect(by.labs).toBe(1310) // the 18 labs, every required check passed
    expect(by.tickets).toBe(8 + 3)
    expect(by.onboarding).toBe(20)
    expect(by.fleet).toBe(20)
    expect(by.capstone).toBe(35)
  })
})

describe('XP and the facade constants', () => {
  test('the XP export keeps its keys with v2 values', () => {
    expect(XP).toEqual({ lesson: 0, quiz: 3, exercise: 0, capstoneStep: 20, lab: 90, fleetWeekAct: 30 })
  })
})

/* ------------------------------------------------------------------ */
/* A synthetic year                                                     */
/* ------------------------------------------------------------------ */

/**
 * A learner who finishes everything: all 18 labs, a pass on every lesson (a ticket in T0–T2, a checkpoint
 * after), the 4 acts, the 7 Capstone steps, boot, placement, the play, Prove-it on lab 01 and some sim
 * outcomes, plus `practiceHours` of graded items spread over 250 days of at most 30 minutes.
 */
function syntheticYear(practiceHours: number): LedgerEvent[] {
  const events: LedgerEvent[] = [evt('complete', 'boot', at(0)), evt('complete', 'placement', at(1))]
  let day = 2
  for (const id of Object.keys(LABS)) {
    events.push(evt('lab-check', `lab:${id}`, at(day), { score: 1, ok: true, provenance: 'lab-green', data: { passed: LABS[id].checks, total: LABS[id].checks.length } }))
    day += 7
  }
  for (const track of Object.values(LESSONS_BY_TRACK)) {
    for (const lesson of track) {
      const form = lesson.exam ? 'spiral' : /^t[012]\./.test(lesson.id) ? 'ticket' : undefined
      events.push(evt('quiz', `lesson:${lesson.id}`, at(day++ % 300), { score: 1, ok: true, ...(form ? { data: { form } } : {}) }))
    }
  }
  for (const act of ['engine', 'fleet', 'business', 'incident']) events.push(evt('fleet-act', `fw:${act}`, at(200), { score: 1, ok: true }))
  for (const [i, step] of ['tokenize', 'embed', 'forward', 'decode', 'kv-cache', 'batch', 'measure'].entries()) events.push(evt('capstone-step', `cap:${step}`, at(210 + i), { data: { index: i } }))
  events.push(evt('play', 'play:block-placement', at(20), { data: { phase: 'play', turns: 30, survived: 30, ghostSurvived: 30 } }))
  events.push(evt('prove', 'prove:rust-allocator', at(30), { data: { qids: ['q'], self: [1] } }))
  for (let t = 0; t < 40; t++) events.push(evt('sim-task', `sim:sim-kv/t${t}`, at(40 + t), { data: { v: 2, outcome: true } }))
  const items = Math.round((practiceHours * 60 * 2) / 1) // 30 s each
  for (let i = 0; i < items; i++) events.push(item(i % 250, 30, `gen:frag/v${i % 7}`))
  return events
}

describe('a synthetic year', () => {
  test('labs and practice carry at least 70% of XP, from 12 to 50 hours of practice', () => {
    const rows: string[] = []
    const header = ['practice h', 'XP', ...XP_SOURCES.map((s) => s.padStart(10)), 'labs+practice'].join(' | ')
    rows.push(header)
    for (const hours of [12, 25, 50]) {
      const agg = derive(syntheticYear(hours))
      const by = xpBySource(agg)
      const total = xpOf(agg)
      const share = (by.labs + by.practice) / total
      rows.push(
        [String(hours).padStart(10), String(total).padStart(2), ...XP_SOURCES.map((s: XpSource) => `${by[s]} (${Math.round((100 * by[s]) / total)}%)`.padStart(10)), `${Math.round(100 * share)}%`].join(' | '),
      )
      expect(by.labs).toBe(1310)
      expect(by.practice).toBe(15 + 5 + 40 * 3 + hours * 60) // play + prove + sim outcomes + the items
      expect(by.tickets).toBe(68 * 3 + 5) // 67 passes at 3 and the spiral at 8
      expect(by.onboarding).toBe(20)
      expect(by.fleet).toBe(110)
      expect(by.capstone).toBe(245)
      expect(share).toBeGreaterThanOrEqual(0.7)
    }
    console.log(`\nSynthetic year: XP split by source (nominal minutes)\n${rows.join('\n')}\n`)
  })

  test('without the daily cap a few long days could not buy a year: 100 h in 10 days pays 5 h', () => {
    const cram = Array.from({ length: 600 }, (_, i) => item(i % 10, 600)) // 100 h of items on 10 days
    expect(xpOf(derive(cram))).toBe(10 * 30)
  })
})
