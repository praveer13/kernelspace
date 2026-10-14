import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { KCS } from '../../src/data/kc'
import { SYSTEMS_FORGE_LABS } from '../../src/data/labs'
import { wilson } from '../../src/lib/learner/calibration'
import { deriveCards, selectFirstReviewCalibration } from '../../src/lib/learner/cards'
import {
  buildFieldReport,
  buildOutcomeReport,
  firstReviewsOf,
  formatFieldReport,
  formatOutcomeReport,
  G1_MIN_PARTNERS,
  G2_MAX_GAP,
  G2_MIN_N,
  G3_MIN_N,
  G7_MAX_MINUTES,
  isTodayProbe,
  loopSpec,
  LOOP_STEPS,
  selectBootToFirstT,
  selectDailyStats,
  selectFirstReviewGate,
  selectLoopCompletion,
  selectPlacementConfirm7,
  selectPlacementLanding,
  selectProbeAccuracy,
  selectProveRate,
  selectRetention30,
  selectTicketStats,
  selectTodayDuration,
  selectTodaySessions,
  selectTodayStats,
  stripFreeText,
  tallyLoopCompletion,
} from '../../src/lib/learner/outcomes'
import { ledgerOfDonation, redactForPartner } from '../../src/lib/learner/redact'
import { addDays } from '../../src/lib/learner/reentry'
import { sessionSpanMs } from '../../src/lib/learner/today'
import { buildExportV3, parseImport, serializeExport } from '../../src/lib/ledger/codec'
import type { LedgerEvent, LocalDay, WorkingRecord } from '../../src/lib/ledger/types'
import { CONTENT, Journal, LESSONS, shuffled, simulate, START } from './ledger-gen'

/* ------------------------------------------------------------------ */
/* Fixture events                                                      */
/* ------------------------------------------------------------------ */

const CHECKS = ['boot', 'align', 'no_overlap', 'coalesce', 'reuse', 'fragmentation']
const FRAG_KC = 't1.external-frag'

let counter = 0
const iso = (day: number, hhmmss = '10:00:00', ms = 0): string => `2026-09-${String(day).padStart(2, '0')}T${hhmmss}.${String(ms).padStart(3, '0')}Z`

/** One valid event (the codec accepts every one of these); `extra` overrides any field. */
function ev(kind: string, ref: string, at: string, extra: Record<string, unknown> = {}): LedgerEvent {
  const graded = ['item', 'probe', 'quiz', 'predict', 'sim-task', 'lab-check', 'play', 'prove'].includes(kind)
  return {
    id: `e${String(counter++).padStart(6, '0')}`,
    v: 1,
    kind,
    ref,
    at,
    tz: 0,
    day: at.slice(0, 10),
    dev: 'dev-1',
    ...(graded ? { score: 1, ok: true, provenance: 'practice' } : {}),
    ...extra,
  } as unknown as LedgerEvent
}

const pre = (at: string) => ev('item', 'pre:t1.l4#0', at, { rev: 'r', data: { src: 'pre', lessonId: 't1.l4' } })
const play = (at: string, o: { ok?: boolean; phase?: 'play' | 'compose' } = {}) =>
  ev('play', 'play:block-placement', at, { ok: o.ok ?? true, data: { phase: o.phase ?? 'play', turns: 6, survived: 5, ghostSurvived: 8 } })

interface RunOpts {
  stage?: number
  /** Check ids that pass; the rest fail. */
  pass?: string[]
  fresh?: boolean
  seeded?: boolean
  provenance?: 'unseen' | 'lab-green'
}
const labRun = (at: string, o: RunOpts = {}) => {
  const pass = o.pass ?? CHECKS
  return ev('lab-check', 'lab:rust-allocator', at, {
    ok: pass.length === CHECKS.length,
    provenance: o.provenance ?? 'unseen',
    data: {
      passed: pass,
      total: CHECKS.length,
      abi: 2,
      seeds: o.fresh === false ? 'default' : 'fresh',
      ...(o.stage === undefined ? (pass.length === CHECKS.length ? { stage: 4 } : {}) : { stage: o.stage }),
      checks: CHECKS.map((id) => ({
        id,
        status: pass.includes(id) ? 'pass' : 'fail',
        ...(o.fresh === false ? {} : { fresh: true }),
        ...(o.seeded ? { seed: 7 } : {}),
      })),
    },
  })
}

interface ItemOpts {
  ref?: string
  kcs?: string[]
  reason?: string
  src?: string
  grp?: string
  slot?: number
  of?: number
  ms?: number
  ok?: boolean
  sinceDays?: number
  kind?: 'item' | 'probe'
}
const todayItem = (at: string, o: ItemOpts = {}) =>
  ev(o.kind ?? (o.reason === 'probe' ? 'probe' : 'item'), o.ref ?? 'gen:frag/first-fit', at, {
    rev: 'r',
    ok: o.ok ?? true,
    score: o.ok === false ? 0 : 1,
    ...(o.ms === undefined ? {} : { ms: o.ms }),
    data: {
      src: o.src ?? 'today',
      grp: o.grp ?? 'g1',
      slot: o.slot ?? 0,
      of: o.of ?? 3,
      reason: o.reason ?? 'due',
      kcs: o.kcs ?? [FRAG_KC],
      nsec: 40,
      ...(o.sinceDays === undefined ? {} : { sinceDays: o.sinceDays }),
    },
  })

/** The whole loop on consecutive days. */
const fullLoop = (): LedgerEvent[] => [
  pre(iso(1)),
  play(iso(1, '10:30:00')),
  labRun(iso(2), { pass: ['boot', 'align'], stage: 2, provenance: 'lab-green', fresh: false }),
  labRun(iso(3)),
  todayItem(iso(10)),
]

/* ------------------------------------------------------------------ */
/* G1                                                                  */
/* ------------------------------------------------------------------ */

describe('the loop spec is read from shipped content', () => {
  test('lab 01 required checks are the six checks of labs.ts, and the frag family is the KCs that name it', () => {
    const spec = loopSpec()
    expect(spec.requiredChecks).toEqual(CHECKS)
    expect(spec.requiredChecks).toEqual(SYSTEMS_FORGE_LABS.find((l) => l.id === 'rust-allocator')?.checks.map((c) => c.id))
    expect(spec.fragKcs.has(FRAG_KC)).toBe(true)
    expect(spec.fragKcs.has('t1.internal-frag')).toBe(true)
    expect(spec.fragKcs.size).toBeGreaterThanOrEqual(4)
    for (const id of spec.fragKcs) expect(KCS.find((k) => k.id === id)?.gen).toContain('frag')
  })

  test('an optional check is not required', () => {
    const labs = [{ ...SYSTEMS_FORGE_LABS[0], checks: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b', optional: true }] }]
    expect(loopSpec(KCS, labs).requiredChecks).toEqual(['a'])
    expect(() => loopSpec(KCS, [])).toThrow()
  })
})

describe('G1: selectLoopCompletion', () => {
  test('prequestion, play, stage 4, unseen pass, Today: complete, with the instant of each link', () => {
    const r = selectLoopCompletion(fullLoop())
    expect(r.complete).toBe(true)
    expect(r.reached).toBe(5)
    expect(r.at).toEqual({ prequestion: iso(1), play: iso(1, '10:30:00'), stage: iso(3), unseen: iso(3), today: iso(10) })
  })

  test('the order of the array does not matter, the ledger order (at, id) does', () => {
    for (let seed = 1; seed <= 5; seed++) expect(selectLoopCompletion(shuffled(fullLoop(), seed)).complete).toBe(true)
  })

  test('an empty ledger reaches nothing', () => {
    const r = selectLoopCompletion([])
    expect(r).toEqual({ complete: false, reached: 0, at: { prequestion: null, play: null, stage: null, unseen: null, today: null } })
  })

  test('each missing link stops the loop exactly there', () => {
    const loop = fullLoop()
    // [pre, play, stage-2 run, stage-4 run, today]
    expect(selectLoopCompletion(loop.slice(1)).reached).toBe(0)
    expect(selectLoopCompletion([loop[0], loop[2], loop[3], loop[4]]).reached).toBe(1)
    expect(selectLoopCompletion([loop[0], loop[1], loop[2], loop[4]]).reached).toBe(2)
    expect(selectLoopCompletion(loop.slice(0, 4)).reached).toBe(4)
    expect(selectLoopCompletion(loop.slice(0, 4)).complete).toBe(false)
  })

  test('a link that happened before the one it follows does not count', () => {
    const [p, pl, , stage, today] = fullLoop()
    // the play came before any prequestion
    expect(selectLoopCompletion([play(iso(1, '09:00:00')), pre(iso(1, '10:00:00')), stage, today]).reached).toBe(1)
    // the stage-4 run came before the play
    expect(selectLoopCompletion([p, labRun(iso(1, '10:10:00')), pl, today]).reached).toBe(2)
    // the Today item came before the unseen pass
    expect(selectLoopCompletion([p, pl, todayItem(iso(2)), stage]).reached).toBe(4)
  })

  test('a play must be ok and of phase play: a failed or composed one is not the play', () => {
    const [p, , , stage, today] = fullLoop()
    expect(selectLoopCompletion([p, play(iso(1, '10:30:00'), { ok: false }), stage, today]).reached).toBe(1)
    expect(selectLoopCompletion([p, play(iso(1, '10:30:00'), { phase: 'compose' }), stage, today]).reached).toBe(1)
    expect(selectLoopCompletion([p, play(iso(1, '10:20:00'), { ok: false }), play(iso(1, '10:30:00')), stage, today]).complete).toBe(true)
  })

  test('stage 4 is read from the run, not inferred from a green lab', () => {
    const [p, pl, , , today] = fullLoop()
    const stage3 = labRun(iso(3), { stage: 3, pass: ['boot', 'align', 'no_overlap', 'reuse'] })
    expect(selectLoopCompletion([p, pl, stage3, today]).reached).toBe(2)
    expect(selectLoopCompletion([p, pl, labRun(iso(3), { stage: 5 }), today]).reached).toBe(5)
  })

  test('the unseen link needs every required check on seeds drawn at grade time', () => {
    const [p, pl, , , today] = fullLoop()
    // all six green but graded on the default seeds: provenance is not unseen
    expect(selectLoopCompletion([p, pl, labRun(iso(3), { provenance: 'lab-green', fresh: false }), today]).reached).toBe(3)
    // unseen provenance, but each check carries a seed and is not `fresh`: the aggregate does not credit it
    expect(selectLoopCompletion([p, pl, labRun(iso(3), { fresh: false, seeded: true, stage: 4 }), today]).reached).toBe(3)
    // a fresh check with a seed is credited; a check with neither flag nor seed is too (the aggregate's rule)
    expect(selectLoopCompletion([p, pl, labRun(iso(3), { seeded: true }), today]).complete).toBe(true)
    expect(selectLoopCompletion([p, pl, labRun(iso(3), { fresh: false }), today]).complete).toBe(true)
    // one required check missing
    const five = CHECKS.filter((c) => c !== 'coalesce')
    expect(selectLoopCompletion([p, pl, labRun(iso(3), { stage: 4, pass: five }), today]).reached).toBe(3)
  })

  test('unseen passes add up across runs after stage 4, and one run may do both', () => {
    const [p, pl, , , today] = fullLoop()
    const stage = labRun(iso(3), { stage: 4, provenance: 'lab-green', fresh: false })
    const a = labRun(iso(4), { stage: 1, pass: ['boot', 'align', 'no_overlap'] })
    const b = labRun(iso(5), { stage: 1, pass: ['coalesce', 'reuse', 'fragmentation'] })
    const r = selectLoopCompletion([p, pl, stage, a, b, today])
    expect(r.complete).toBe(true)
    expect(r.at.stage).toBe(iso(3))
    expect(r.at.unseen).toBe(iso(5))
    expect(selectLoopCompletion([p, pl, stage, a, today]).reached).toBe(3)
  })

  test('unseen passes from before stage 4 are not carried forward', () => {
    const [p, pl, , , today] = fullLoop()
    const early = labRun(iso(2), { stage: 1, pass: ['boot', 'align', 'no_overlap'] })
    const stage = labRun(iso(3), { stage: 4, provenance: 'lab-green', fresh: false })
    const late = labRun(iso(4), { stage: 1, pass: ['coalesce', 'reuse', 'fragmentation'] })
    expect(selectLoopCompletion([p, pl, early, stage, late, today]).reached).toBe(3)
  })

  test('Today must serve a frag-family KC in a composed session, as a Today answer', () => {
    const [p, pl, , stage] = fullLoop()
    const run = (item: LedgerEvent) => selectLoopCompletion([p, pl, stage, item]).complete
    expect(run(todayItem(iso(10)))).toBe(true)
    expect(run(todayItem(iso(10), { kcs: ['t1.internal-frag'] }))).toBe(true)
    expect(run(todayItem(iso(10), { kind: 'probe', reason: 'probe', sinceDays: 8 }))).toBe(true)
    // the family ref alone is enough, an untagged event of another family is not
    expect(run(todayItem(iso(10), { kcs: [] }))).toBe(true)
    expect(run(todayItem(iso(10), { kcs: ['t5.kv-capacity'], ref: 'gen:kv/bytes-per-token' }))).toBe(false)
    expect(run(todayItem(iso(10), { kcs: ['t0.locality'], ref: 'quiz:t0.l1#0' }))).toBe(false)
    // "keep going" practice and answers outside Today are not a Today session
    expect(run(todayItem(iso(10), { reason: 'extra' }))).toBe(false)
    expect(run(todayItem(iso(10), { src: 'practice' }))).toBe(false)
    expect(run(todayItem(iso(10), { src: 'quiz' }))).toBe(false)
  })

  test('a prequestion may be a predict event', () => {
    const [, pl, , stage, today] = fullLoop()
    const predict = ev('predict', 'pre:t1.l4#1', iso(1), { rev: 'r', data: { value: 4, unit: 'x', truth: 4, src: 'pre' } })
    expect(selectLoopCompletion([predict, pl, stage, today]).complete).toBe(true)
    expect(selectLoopCompletion([ev('item', 'pre:t0.l4#0', iso(1), { rev: 'r', data: { src: 'pre' } }), pl, stage, today]).reached).toBe(0)
  })

  test('another lab or play does not stand in for the loop', () => {
    const [p, pl, , stage, today] = fullLoop()
    const otherPlay = ev('play', 'play:other', iso(1, '10:30:00'), { data: { phase: 'play', turns: 1, survived: 1, ghostSurvived: 1 } })
    expect(selectLoopCompletion([p, otherPlay, stage, today]).reached).toBe(1)
    const otherLab = { ...stage, ref: 'lab:kv-block-manager' } as LedgerEvent
    expect(selectLoopCompletion([p, pl, otherLab, today]).reached).toBe(2)
  })
})

describe('G1: tallyLoopCompletion', () => {
  test('counts partners per link and the ones who finished, against the bar of five', () => {
    const loop = fullLoop()
    const ledgers = [
      loop, // complete
      loop,
      loop,
      loop,
      loop.slice(0, 4), // stopped before Today
      loop.slice(0, 2), // stopped after the play
      [], // never started
    ]
    const t = tallyLoopCompletion(ledgers)
    expect(t.partners).toBe(7)
    expect(t.complete).toBe(4)
    expect(t.funnel).toEqual([6, 6, 5, 5, 4])
    expect(t.funnel).toHaveLength(LOOP_STEPS.length)
    expect(t.status).toBe('short')
    expect(tallyLoopCompletion([...ledgers, loop]).status).toBe('pass')
    expect(G1_MIN_PARTNERS).toBe(5)
  })
})

/* ------------------------------------------------------------------ */
/* G2                                                                  */
/* ------------------------------------------------------------------ */

describe('G2: the pooled first-review gate', () => {
  const learners = (seeds: number[], accuracy: number) => seeds.map((s) => ({ events: simulate(s, { days: 90, pActive: 0.9, pLesson: 0.8, accuracy }).events }))

  test('pools the first reviews of every ledger, each replayed on its own', () => {
    const ledgers = learners([21, 22, 23], 0.7)
    const gate = selectFirstReviewGate(ledgers, CONTENT)
    const each = ledgers.map((l) => firstReviewsOf(l, CONTENT))
    const all = each.flat()
    expect(gate.ledgers).toBe(3)
    expect(gate.n).toBe(all.length)
    expect(gate.n).toBeGreaterThan(30)
    expect(gate.meanPredicted).toBeCloseTo(all.reduce((s, r) => s + r.predicted, 0) / all.length, 12)
    expect(gate.observed).toBeCloseTo(all.filter((r) => r.ok).length / all.length, 12)
    const w = wilson(all.filter((r) => r.ok).length, all.length)
    expect(gate.ci95).toEqual([w.lo, w.hi])
    expect(gate.gap).toBeCloseTo(Math.abs((gate.meanPredicted as number) - (gate.observed as number)), 12)
  })

  test('one ledger pooled alone is the existing per-learner calibration', () => {
    const r = simulate(31, { days: 90, pActive: 0.9, pLesson: 0.8, accuracy: 0.7 })
    const gate = selectFirstReviewGate([{ events: r.events }], CONTENT)
    const solo = selectFirstReviewCalibration(r.events, CONTENT, r.events.reduce((m, e) => (e.day > m ? e.day : m), ''))
    expect(gate.n).toBe(solo.n)
    expect(gate.meanPredicted).toBe(solo.meanPredicted)
    expect(gate.observed).toBe(solo.observed)
    expect(gate.ci95).toEqual(solo.ci95)
  })

  test('pooling does not depend on the order of the ledgers or of their events', () => {
    const ledgers = learners([41, 42, 43, 44], 0.75)
    const a = selectFirstReviewGate(ledgers, CONTENT)
    const b = selectFirstReviewGate(
      [...ledgers].reverse().map((l, i) => ({ events: shuffled(l.events, i + 1) })),
      CONTENT,
    )
    expect(b.n).toBe(a.n)
    expect(b.observed).toBe(a.observed)
    expect(b.meanPredicted).toBeCloseTo(a.meanPredicted as number, 12)
  })

  test('no ledger, or one with no spaced review, is insufficient and says nothing about the gap', () => {
    for (const ledgers of [[], [{ events: [] }]]) {
      expect(selectFirstReviewGate(ledgers, CONTENT)).toEqual({
        n: 0,
        meanPredicted: null,
        observed: null,
        ci95: null,
        ledgers: ledgers.length,
        gap: null,
        status: 'insufficient',
      })
    }
  })

  test('below 100 first reviews it is insufficient however close the gap; from 100 the gap decides', () => {
    expect(G2_MIN_N).toBe(100)
    expect(G2_MAX_GAP).toBe(0.1)
    const small = selectFirstReviewGate(learners([51], 0.7), CONTENT)
    expect(small.n).toBeLessThan(G2_MIN_N)
    expect(small.status).toBe('insufficient')

    const seeds = Array.from({ length: 12 }, (_, i) => 60 + i)
    // a learner population that forgets most of what the model expects them to remember: the gap is wide
    const forgetful = selectFirstReviewGate(learners(seeds, 0.3), CONTENT)
    expect(forgetful.n).toBeGreaterThanOrEqual(G2_MIN_N)
    expect(forgetful.gap as number).toBeGreaterThan(G2_MAX_GAP)
    expect(forgetful.status).toBe('fail')
    // one that remembers about what the model expects: the gap is narrow
    const steady = selectFirstReviewGate(learners(seeds, 0.9), CONTENT)
    expect(steady.n).toBeGreaterThanOrEqual(G2_MIN_N)
    expect(steady.gap as number).toBeLessThanOrEqual(G2_MAX_GAP)
    expect(steady.status).toBe('pass')
  }, 30_000) // three 12-learner simulations: about 4 s on a quiet machine, over bun's 5 s default on a busy one
})

/* ------------------------------------------------------------------ */
/* G3                                                                  */
/* ------------------------------------------------------------------ */

describe('G3: the 7-day cold check', () => {
  const probe = (day: number, o: ItemOpts = {}) => todayItem(iso(day), { kind: 'probe', reason: 'probe', sinceDays: 9, ...o })

  test('counts Today probe slots met at least 7 days ago', () => {
    expect(isTodayProbe(probe(1))).toBe(true)
    expect(isTodayProbe(probe(1, { sinceDays: 7 }))).toBe(true)
    expect(isTodayProbe(probe(1, { sinceDays: 6 }))).toBe(false)
    expect(isTodayProbe(probe(1, { sinceDays: 0 }))).toBe(false)
    const unknown = probe(1)
    delete (unknown as { data: { sinceDays?: number } }).data.sinceDays
    expect(isTodayProbe(unknown)).toBe(false)
  })

  test('leaves out lesson cold checks, ordinary items and practice outside Today', () => {
    expect(isTodayProbe(probe(1, { src: 'cold' }))).toBe(false)
    expect(isTodayProbe(probe(1, { src: 'practice' }))).toBe(false)
    expect(isTodayProbe(todayItem(iso(1), { sinceDays: 12 }))).toBe(false) // an item, not a probe
    const r = selectProbeAccuracy([[probe(1, { src: 'cold' }), probe(2, { sinceDays: 3 }), todayItem(iso(3))]])
    expect(r.n).toBe(0)
    expect(r).toEqual({ n: 0, correct: 0, accuracy: null, ci95: null, status: 'insufficient' })
  })

  test('pools accuracy over ledgers (ids may repeat across them) with a Wilson interval', () => {
    counter = 0
    const a = [probe(1), probe(2, { ok: false }), probe(3)]
    counter = 0
    const b = [probe(1, { ok: false }), probe(2), probe(3), probe(4)]
    expect(new Set([...a, ...b].map((e) => e.id)).size).toBeLessThan(7) // ids collide across the two ledgers
    const r = selectProbeAccuracy([a, b])
    expect(r.n).toBe(7)
    expect(r.correct).toBe(5)
    expect(r.accuracy).toBeCloseTo(5 / 7, 12)
    const w = wilson(5, 7)
    expect(r.ci95).toEqual([w.lo, w.hi])
    expect(r.status).toBe('insufficient')
  })

  test('is reported from 50 probes', () => {
    expect(G3_MIN_N).toBe(50)
    const make = (n: number) => Array.from({ length: n }, (_, i) => probe(1 + (i % 28), { ok: i % 4 !== 0 }))
    expect(selectProbeAccuracy([make(49)]).status).toBe('insufficient')
    const r = selectProbeAccuracy([make(25), make(25)])
    expect(r.n).toBe(50)
    expect(r.status).toBe('reported')
  })

  test('a different minimum age is honoured', () => {
    expect(selectProbeAccuracy([[probe(1, { sinceDays: 14 }), probe(2, { sinceDays: 9 })]], 14).n).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* G7                                                                  */
/* ------------------------------------------------------------------ */

describe('G7: Today duration', () => {
  /** One session: `n` items 30 s apart from `start`, the last taking `lastMs`. */
  const session = (grp: string, day: number, start: string, n: number, o: { of?: number; lastMs?: number; reason?: string; src?: string; gapSec?: number } = {}) => {
    const [hh, mm] = start.split(':').map(Number)
    const base = hh * 3600 + mm * 60
    return Array.from({ length: n }, (_, i) => {
      const s = base + i * (o.gapSec ?? 30)
      const hms = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
      return todayItem(iso(day, hms), { grp, slot: i, of: o.of ?? n, ...(o.reason ? { reason: o.reason } : {}), ...(o.src ? { src: o.src } : {}), ...(i === n - 1 && o.lastMs !== undefined ? { ms: o.lastMs } : {}) })
    })
  }

  test('a session lasts from its first answer to its last, plus the last answer time', () => {
    const [s] = selectTodaySessions(session('a', 1, '09:00', 10, { lastMs: 45_000 }))
    expect(s.items).toBe(10)
    expect(s.spanMs).toBe(9 * 30_000 + 45_000)
    expect(s.completed).toBe(true)
    expect(s.of).toBe(10)
  })

  test('agrees with sessionSpanMs, the span the ledger writes', () => {
    const events = [...session('a', 1, '09:00', 7, { lastMs: 12_000 }), ...session('b', 2, '18:20', 4)]
    for (const s of selectTodaySessions(events)) expect(s.spanMs).toBe(sessionSpanMs(events, s.grp) as number)
  })

  test('is exact to the millisecond, in ledger order', () => {
    const a = todayItem(iso(1, '09:00:00', 250), { grp: 'x', slot: 0, of: 2 })
    const b = todayItem(iso(1, '09:01:00', 100), { grp: 'x', slot: 1, of: 2, ms: 900 })
    expect(selectTodaySessions([b, a])[0].spanMs).toBe(60_000 - 150 + 900)
  })

  test('a session that stopped before its last slot is not completed', () => {
    const [s] = selectTodaySessions(session('a', 1, '09:00', 4, { of: 9 }))
    expect(s.completed).toBe(false)
    expect(s.of).toBe(9)
  })

  test('keep-going sets and answers outside Today are not sessions', () => {
    expect(selectTodaySessions(session('x', 1, '09:00', 5, { reason: 'extra' }))).toEqual([])
    expect(selectTodaySessions(session('x', 1, '09:00', 5, { src: 'practice' }))).toEqual([])
    // an item with no session id cannot be placed in one
    const loose = todayItem(iso(1))
    delete (loose as { data: { grp?: string } }).data.grp
    expect(selectTodaySessions([loose])).toEqual([])
    // a session that has one extra among composed items is still a session
    const mixed = [...session('m', 1, '09:00', 3), todayItem(iso(1, '09:05:00'), { grp: 'm', slot: 3, of: 3, reason: 'extra' })]
    expect(selectTodaySessions(mixed)).toHaveLength(1)
  })

  test('keeps sessions of different ids apart', () => {
    const r = selectTodaySessions([...session('a', 1, '09:00', 3), ...session('b', 1, '09:00', 5)])
    expect(r.map((s) => [s.grp, s.items]).sort()).toEqual([['a', 3], ['b', 5]])
  })

  test('is the median over every session, pooled over ledgers: 9, 11 and 20 minutes give 11', () => {
    const minutes = (m: number) => 2 * m + 1 // items 30 s apart: n items span (n - 1) * 30 s
    const a = session('a', 1, '09:00', minutes(9), { of: minutes(9) })
    const b = session('b', 2, '09:00', minutes(11), { of: minutes(11) })
    const c = session('c', 3, '09:00', minutes(20), { of: minutes(20) })
    const r = selectTodayDuration([a, b, c])
    expect(r.sessions).toBe(3)
    expect(r.completed).toBe(3)
    expect(r.medianAllMinutes).toBeCloseTo(11, 9)
    expect(r.medianMinutes).toBeCloseTo(11, 9)
    expect(r.status).toBe('pass')
    expect(selectTodayDuration([a, [...b, ...c]]).medianAllMinutes).toBeCloseTo(11, 9)
  })

  test('an even count takes the mean of the middle two', () => {
    const one = (grp: string, m: number) => session(grp, 1, '09:00', 2, { of: 2, gapSec: m * 60 })
    const r = selectTodayDuration([one('a', 8), one('b', 12)])
    expect(r.medianAllMinutes).toBeCloseTo(10, 9)
    expect(r.medianMinutes).toBeCloseTo(10, 9)
  })

  test('the gate follows §17: the median over all sessions, with the completed-only median beside it', () => {
    const long = (grp: string, day: number) => session(grp, day, '09:00', 2, { of: 2, gapSec: 14 * 60 })
    const quit = (grp: string, day: number) => session(grp, day, '09:00', 2, { of: 9, gapSec: 20 })
    // two finished 14 min sessions and three abandoned 20 s ones: the median session is short, so the gate passes
    const r = selectTodayDuration([[...long('a', 1), ...long('b', 2), ...quit('c', 3), ...quit('d', 4), ...quit('e', 5)]])
    expect(r.sessions).toBe(5)
    expect(r.completed).toBe(2)
    expect(r.medianAllMinutes as number).toBeLessThan(1)
    expect(r.medianMinutes).toBeCloseTo(14, 9)
    expect(r.status).toBe('pass')
    // the other way round: mostly long sessions, one quick quit, so the gate fails even though completed ones are fine
    const slow = selectTodayDuration([[...long('a', 1), ...long('b', 2), ...long('c', 3), ...quit('d', 4)]])
    expect(slow.medianAllMinutes).toBeCloseTo(14, 9)
    expect(slow.status).toBe('fail')
  })

  test('the bar is 12 minutes, inclusive', () => {
    expect(G7_MAX_MINUTES).toBe(12)
    const at = (m: number) => selectTodayDuration([session('a', 1, '09:00', 2, { of: 2, gapSec: m * 60 })])
    expect(at(12).status).toBe('pass')
    expect(at(12.5).status).toBe('fail')
  })

  test('no session is insufficient, not a pass', () => {
    expect(selectTodayDuration([])).toEqual({ sessions: 0, completed: 0, medianMinutes: null, medianAllMinutes: null, status: 'insufficient' })
  })

  test('only abandoned sessions still have a median, with no completed-only median beside it', () => {
    const r = selectTodayDuration([session('a', 1, '09:00', 2, { of: 9 })])
    expect(r.medianMinutes).toBeNull()
    expect(r.medianAllMinutes as number).toBeLessThan(1)
    expect(r.status).toBe('pass')
  })
})

/* ------------------------------------------------------------------ */
/* Stripping, and the report                                           */
/* ------------------------------------------------------------------ */

const SECRET_EXPLAIN = 'because my cat walked on the keyboard'
const SECRET_BOOT = 'I want to leave my job at Acme'
const SECRET_CR = 'a free list threads the holes'

const withText = (): { events: LedgerEvent[]; working: WorkingRecord[] } => {
  const events = [
    ...fullLoop(),
    ev('sim-task', 'sim:alloc/frag-pct', iso(4), { data: { v: 2, outcome: true, predict: { value: 5 }, actual: 7, explain: SECRET_EXPLAIN, kcs: [FRAG_KC] } }),
    ev('item', 'cr:t1.l3#0', iso(4, '11:00:00'), { rev: 'r', data: { src: 'ticket', form: 'ticket', lessonId: 't1.l3', ideas: [0, 2], text: SECRET_CR, kcs: [FRAG_KC] } }),
  ]
  const working: WorkingRecord[] = [
    { key: 'boot:value', value: { variant: 'job', text: SECRET_BOOT }, at: iso(1), dev: 'dev-1' },
    { key: 'boot:week', value: { minutesPerWeek: 180, sessionMinutes: 25, phoneDays: [], laptopDays: [1], slo: 0.9 }, at: iso(1), dev: 'dev-1' },
    { key: 'fw:doc', value: SECRET_BOOT, at: iso(1), dev: 'dev-1' },
    { key: 'placement:result', value: { v: 1, solidKcs: [FRAG_KC] }, at: iso(1), dev: 'dev-1' },
  ]
  return { events, working }
}

describe('stripFreeText', () => {
  test('removes explain, boot:value and constructed-response text, and says how much', () => {
    const input = withText()
    const out = stripFreeText(input)
    const text = JSON.stringify(out)
    for (const secret of [SECRET_EXPLAIN, SECRET_BOOT, SECRET_CR]) expect(text).not.toContain(secret)
    expect(out.removed).toEqual({ explain: 1, bootValue: 1, crText: 1, otherWorking: 1 })
    expect(out.working.map((r) => r.key)).toEqual(['boot:week', 'placement:result'])
  })

  test('keeps the structure around what it removes', () => {
    const out = stripFreeText(withText())
    const sim = out.events.find((e) => e.kind === 'sim-task') as unknown as { data: Record<string, unknown> }
    expect(sim.data).toMatchObject({ v: 2, outcome: true, actual: 7, kcs: [FRAG_KC] })
    expect('explain' in sim.data).toBe(false)
    const cr = out.events.find((e) => e.ref.startsWith('cr:')) as unknown as { data: Record<string, unknown> }
    expect(cr.data).toEqual({ src: 'ticket', form: 'ticket', lessonId: 't1.l3', ideas: [0, 2], kcs: [FRAG_KC] })
    expect(out.events).toHaveLength(withText().events.length)
  })

  test('does not modify its input', () => {
    const input = withText()
    const before = JSON.stringify(input)
    stripFreeText(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  test('a ledger with no free text comes back unchanged', () => {
    const events = fullLoop()
    const out = stripFreeText({ events })
    expect(out.events).toEqual(events)
    expect(out.removed).toEqual({ explain: 0, bootValue: 0, crText: 0, otherWorking: 0 })
  })

  test('every selector gives the same answer before and after stripping', () => {
    const { events, working } = withText()
    const stripped = stripFreeText({ events, working }).events
    expect(selectLoopCompletion(stripped)).toEqual(selectLoopCompletion(events))
    expect(selectTodayDuration([stripped])).toEqual(selectTodayDuration([events]))
    expect(selectProbeAccuracy([stripped])).toEqual(selectProbeAccuracy([events]))
  })
})

describe('the report', () => {
  const donated = (events: LedgerEvent[], exportedAt = '2026-10-07T12:00:00.000Z') => ({ events, exportedAt })

  test('puts the four gates and a row per export together, with week-level dates only', () => {
    const report = buildOutcomeReport([donated(fullLoop()), donated(fullLoop().slice(0, 2), '2026-10-12T08:00:00.000Z')], CONTENT)
    expect(report.g1.complete).toBe(1)
    expect(report.g1.partners).toBe(2)
    expect(report.rows.map((r) => [r.label, r.week, r.loop.reached])).toEqual([
      ['#1', '2026-10-05', 5],
      ['#2', '2026-10-12', 2],
    ])
    const text = formatOutcomeReport(report)
    for (const gate of ['G1', 'G2', 'G3', 'G7']) expect(text).toContain(gate)
    expect(text).toContain('1 of 5 needed')
    expect(text).toContain('week of 2026-10-05')
    expect(text).not.toContain('2026-10-07')
    expect(text).not.toContain('T12:00')
  })

  test('the week is the learner\'s local day, not the UTC date of exportedAt', () => {
    // 2026-10-05 is a Monday. 01:30 UTC on Monday is still Sunday 2026-10-04 evening at UTC-5, so week of 2026-09-28.
    const west = fullLoop().map((e) => ({ ...e, tz: -300 }) as LedgerEvent)
    const east = fullLoop().map((e) => ({ ...e, tz: 600 }) as LedgerEvent)
    const report = buildOutcomeReport(
      [
        donated(west, '2026-10-05T01:30:00.000Z'),
        // 22:00 UTC on Sunday is already Monday 08:00 at UTC+10, so week of 2026-10-05
        donated(east, '2026-10-04T22:00:00.000Z'),
        // no event, so no offset to read: the UTC date
        donated([], '2026-10-05T01:30:00.000Z'),
      ],
      CONTENT,
    )
    expect(report.rows.map((r) => r.week)).toEqual(['2026-09-28', '2026-10-05', '2026-10-05'])
    expect(formatOutcomeReport(report)).toContain('week of 2026-09-28')
  })

  test('G7 reports the all-session median as the gate and the completed-only median beside it', () => {
    const text = formatOutcomeReport(buildOutcomeReport([], CONTENT))
    expect(text).toContain('over all 0 sessions')
    expect(text).toContain('completed only')
  })

  test('an empty set of ledgers still reports, with nothing to claim', () => {
    const text = formatOutcomeReport(buildOutcomeReport([], CONTENT))
    expect(text).toContain('0 exports')
    expect(text).toContain('INSUFFICIENT')
    expect(text).toContain('n/a')
  })
})

describe('scripts/partner-report.ts --wave1 on exported ledger files', () => {
  const script = path.resolve(import.meta.dir, '../../scripts/partner-report.ts')
  const run = (...args: string[]) => spawnSync('bun', [script, ...args], { encoding: 'utf8' })

  const exportFile = (dir: string, name: string, events: LedgerEvent[], working: WorkingRecord[], device: string): string => {
    const file = buildExportV3({ events, working, device, exportedAt: '2026-10-07T12:00:00.000Z' })
    const p = path.join(dir, name)
    writeFileSync(p, serializeExport(file))
    return p
  }

  test('counts the loop, never prints donated text, and exits cleanly', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'partner-report-'))
    try {
      counter = 1000
      const a = withText()
      const b = { events: fullLoop().slice(0, 3), working: [] as WorkingRecord[] }
      const pa = exportFile(dir, 'a.json', a.events, a.working, 'dev-a')
      const pb = exportFile(dir, 'b.json', b.events, b.working, 'dev-b')
      expect(parseImport(serializeExport(buildExportV3({ events: a.events, working: a.working, device: 'x', exportedAt: '2026-10-07T12:00:00.000Z' }))).ok).toBe(true)

      const r = run('--wave1', pa, pb)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Wave 1 exit report over 2 exports')
      expect(r.stdout).toContain('G1  loop completion   1 of 5 needed')
      expect(r.stdout).toContain('reached: prequestion 2 → play 2 → stage 1 → unseen 1 → today 1')
      expect(r.stdout).toContain('week of 2026-10-05')
      for (const secret of [SECRET_EXPLAIN, SECRET_BOOT, SECRET_CR, 'a.json', 'b.json']) expect(r.stdout + r.stderr).not.toContain(secret)

      const j = run('--wave1', '--json', pa, pb)
      expect(j.status).toBe(0)
      const parsed = JSON.parse(j.stdout)
      expect(parsed.g1).toMatchObject({ partners: 2, complete: 1, funnel: [2, 2, 1, 1, 1] })
      expect(Object.keys(parsed)).toEqual(['g1', 'g2', 'g3', 'g7', 'rows'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('warns when two files come from one device', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'partner-report-'))
    try {
      const p1 = exportFile(dir, 'a.json', fullLoop(), [], 'same')
      const p2 = exportFile(dir, 'b.json', fullLoop(), [], 'same')
      const r = run(p1, p2)
      expect(r.status).toBe(0)
      expect(r.stderr).toContain('one export per partner')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses what the importer refuses, a missing file and no arguments, with exit code 2', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'partner-report-'))
    try {
      const bad = path.join(dir, 'bad.json')
      writeFileSync(bad, '{"not":"an export"}')
      const r = run(bad)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('unknown-format')
      expect(run(path.join(dir, 'missing.json')).status).toBe(2)
      expect(run().status).toBe(2)
      expect(run('--bogus', bad).status).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/* ================================================================== */
/* Wave 2 field gates (task 2a-21)                                     */
/* ================================================================== */

/** A day in the Journal's calendar: START plus `n` days. */
const d = (n: number) => addDays(START, n)

/** One valid graded event on a local day, through the ledger-gen Journal. */
const graded = (j: Journal, kind: string, ref: string, day: LocalDay, extra: Record<string, unknown> = {}) =>
  j.add(kind, ref, day, { score: 1, ok: true, provenance: 'practice', rev: 'r', ...extra })

describe('selectRetention30', () => {
  const lesson = LESSONS[0]
  const kc = lesson.kcs[0]

  /** A ledger whose card for `kc` is created on day 0: the lesson's ticket passes, then answers follow. */
  const ledger = () => {
    const j = new Journal()
    j.passLesson(d(0), lesson.id, lesson.kcs)
    return j
  }
  const today = (j: Journal, day: LocalDay, ok: boolean, o: { ref?: string; seed?: number; level?: number; reason?: string; src?: string; provenance?: string; kcs?: string[] } = {}) =>
    graded(j, 'item', o.ref ?? 'gen:frag/v', day, {
      ok,
      score: ok ? 1 : 0,
      provenance: o.provenance ?? 'unseen',
      ...(o.seed === undefined ? {} : { seed: o.seed }),
      data: { src: o.src ?? 'today', grp: `g${day}`, kcs: o.kcs ?? [kc], reason: o.reason ?? 'due', ...(o.level === undefined ? {} : { level: o.level }) },
    })
  const content = CONTENT
  const run = (j: Journal, plan: { slo: 0.85 | 0.9 } | null = null, opts = {}) => selectRetention30([{ events: j.events, plan }], content, opts)

  test('the card of the fixture is created on day 0', () => {
    const j = ledger()
    expect(deriveCards(j.events, CONTENT, d(1)).cards[kc]?.createdDay).toBe(d(0))
  })

  test('counts Today answers 30 or more local days after the card was created, with a Wilson interval and the SLO of the plan', () => {
    const j = ledger()
    today(j, d(29), true) // too early
    today(j, d(30), true)
    today(j, d(45), false)
    today(j, d(60), true)
    const r = run(j, { slo: 0.85 })
    expect([r.n, r.correct]).toEqual([3, 2])
    expect(r.rate).toBeCloseTo(2 / 3, 10)
    const w = wilson(2, 3)
    expect(r.ci95).toEqual([w.lo, w.hi])
    expect(r.meanSlo).toBe(0.85)
    expect(r.partners).toBe(1)
  })

  test('the SLO defaults to 0.9 and the pooled mean weights each plan by its learner\'s checks', () => {
    const a = ledger()
    today(a, d(31), true)
    const b = ledger()
    for (const day of [31, 32, 33]) today(b, d(day), true)
    expect(run(a).meanSlo).toBe(0.9)
    const pooled = selectRetention30(
      [
        { events: a.events, plan: { slo: 0.85 } },
        { events: b.events, plan: { slo: 0.9 } },
      ],
      content,
    )
    expect(pooled.n).toBe(4)
    expect(pooled.meanSlo).toBeCloseTo((0.85 * 1 + 0.9 * 3) / 4, 10)
    expect(pooled.perLearner.map((p) => p.n)).toEqual([1, 3])
    expect(pooled.spread).toEqual({ min: 1, median: 1, max: 1 })
  })

  test('leaves out assisted answers, keep-going items, other sources, other KCs and answers with no card', () => {
    const j = ledger()
    today(j, d(31), true, { provenance: 'assisted' })
    today(j, d(31), true, { reason: 'extra' })
    today(j, d(31), true, { src: 'practice' })
    today(j, d(31), true, { src: 'ticket' })
    today(j, d(31), true, { kcs: ['no-such-kc'] })
    graded(j, 'quiz', `lesson:${lesson.id}`, d(31), { data: { form: 'ticket', kcs: [kc] } })
    expect(run(j).n).toBe(0)
    today(j, d(31), true)
    expect(run(j).n).toBe(1)
  })

  test('a probe counts like an item', () => {
    const j = ledger()
    graded(j, 'probe', 'gen:frag/v', d(40), { data: { src: 'today', kcs: [kc], reason: 'probe', sinceDays: 40 } })
    expect(run(j).n).toBe(1)
  })

  test('a generated item counts on a fresh seed only: a seed met before is not a clean check', () => {
    const j = ledger()
    today(j, d(5), true, { seed: 11, level: 1 }) // met in week one (any source)
    today(j, d(31), true, { seed: 11, level: 1 }) // same instance again
    today(j, d(32), true, { seed: 12, level: 1 }) // fresh
    today(j, d(33), true, { seed: 11, level: 2 }) // another level is another instance
    today(j, d(34), true, { ref: 'item:authored-1' }) // authored: no seed to compare
    const r = run(j)
    expect(r.n).toBe(3)
  })

  test('a donation (no seeds) counts every generated answer', () => {
    const j = ledger()
    today(j, d(31), true, { seed: 11 })
    today(j, d(32), true, { seed: 11 })
    const stripped = j.events.map((e) => ({ ...e, seed: undefined }) as unknown as LedgerEvent)
    expect(selectRetention30([{ events: stripped }], content).n).toBe(2)
    expect(run(j).n).toBe(1) // the full ledger knows the second is the same instance again
  })

  test('minSpanDays leaves out short ledgers and says how many', () => {
    const j = ledger()
    today(j, d(31), true)
    const r = selectRetention30([{ events: j.events }], content, { minSpanDays: 35 })
    expect([r.n, r.excluded, r.perLearner.length, r.partners]).toEqual([0, 1, 0, 0])
    today(j, d(36), true)
    expect(selectRetention30([{ events: j.events }], content, { minSpanDays: 35 }).n).toBe(2)
  })

  test('pools ledgers each on its own cards; no ledger is no data', () => {
    const empty = selectRetention30([], content)
    expect(empty).toMatchObject({ n: 0, rate: null, ci95: null, meanSlo: null, spread: null })
    expect(selectRetention30([{ events: [] }], content).n).toBe(0)
  })

  test('the day-count of "30" is configurable and exact', () => {
    const j = ledger()
    today(j, d(7), true)
    expect(run(j, null, { minDays: 7 }).n).toBe(1)
    expect(run(j, null, { minDays: 8 }).n).toBe(0)
  })
})

describe('selectBootToFirstT', () => {
  const boot = (j: Journal, day: number) => j.add('complete', 'boot', d(day))
  const visit = (j: Journal, ref: string, day: number) => j.add('visit', ref, d(day))

  test('whole local days from complete boot to the first t* lesson visit, with the distribution', () => {
    const a = new Journal()
    boot(a, 0)
    visit(a, 'lesson:t0.l1', 2)
    visit(a, 'lesson:t1.l1', 3)
    const b = new Journal()
    boot(b, 5)
    visit(b, 'lesson:r.l1', 5) // R is not T
    visit(b, 'sim:alloc', 6)
    visit(b, 'lesson:t2.l3', 5)
    const c = new Journal()
    visit(c, 'lesson:t1.l1', 0) // before Boot: not after it
    boot(c, 1)
    visit(c, 'lesson:t1.l2', 7)
    const waiting = new Journal()
    boot(waiting, 0)
    visit(waiting, 'lesson:r.l2', 1)
    const r = selectBootToFirstT([a.events, b.events, c.events, waiting.events, new Journal().events])
    expect(r.booted).toBe(4)
    expect(r.n).toBe(3)
    expect(r.days).toEqual([0, 2, 6])
    expect(r.median).toBe(2)
    expect(r.distribution).toEqual([
      { days: 0, count: 1 },
      { days: 2, count: 1 },
      { days: 6, count: 1 },
    ])
  })

  test('no ledger, no median', () => {
    expect(selectBootToFirstT([])).toEqual({ booted: 0, n: 0, days: [], median: null, distribution: [] })
  })
})

describe('selectPlacementLanding', () => {
  test('the first lesson visited after each placement, and how many landed on R.L1', () => {
    const a = new Journal()
    a.add('complete', 'placement', d(0))
    a.add('visit', 'sim:alloc', d(0))
    a.add('visit', 'lesson:t2.l3', d(0))
    a.add('visit', 'lesson:r.l1', d(1)) // later visits do not count
    const b = new Journal()
    b.add('complete', 'placement', d(0))
    b.add('visit', 'lesson:r.l1', d(0))
    b.add('complete', 'placement', d(3))
    b.add('visit', 'lesson:t1.l1', d(3))
    const c = new Journal()
    c.add('complete', 'placement', d(0)) // no visit yet
    const none = new Journal()
    none.add('visit', 'lesson:r.l1', d(0)) // no placement
    const r = selectPlacementLanding([a.events, b.events, c.events, none.events])
    expect(r).toEqual({ placements: 4, n: 3, onR1: 1, partners: 2, partnersOnR1: 1, lessons: ['t2.l3', 'r.l1', 't1.l1'] })
  })

  test('a landing on R.L1 is found when the learner had already touched R.L1 that day and wrote no new visit', () => {
    const j = new Journal()
    j.add('visit', 'lesson:r.l1', d(0))
    j.add('complete', 'placement', d(0))
    j.add('complete', 'lesson:r.l1', d(0)) // the first event after the placement, on a lesson ref
    const k = new Journal()
    k.add('complete', 'placement', d(0))
    k.add('visit', 'sim:alloc', d(0))
    k.add('complete', 'lesson:t2.l3', d(0))
    k.add('visit', 'lesson:r.l1', d(0))
    const r = selectPlacementLanding([j.events, k.events])
    expect(r).toMatchObject({ placements: 2, n: 2, onR1: 1, partners: 2, partnersOnR1: 1, lessons: ['r.l1', 't2.l3'] })
  })

  test('a visit before the placement is not its landing', () => {
    const j = new Journal()
    j.add('visit', 'lesson:r.l1', d(0))
    j.add('complete', 'placement', d(1))
    expect(selectPlacementLanding([j.events]).n).toBe(0)
  })
})

describe('selectPlacementConfirm7', () => {
  const confirm = (j: Journal, kc: string, ok: boolean, o: { reason?: string; src?: string; kind?: 'item' | 'probe' } = {}) =>
    graded(j, o.kind ?? 'item', 'gen:frag/v', d(8), { ok, score: ok ? 1 : 0, data: { src: o.src ?? 'today', reason: o.reason ?? 'confirm', kcs: [kc], grp: 'g' } })

  test('the share of solid placement KCs right at their first day-7 confirmation', () => {
    const j = new Journal()
    j.add('complete', 'placement', d(0))
    confirm(j, 'a', true)
    confirm(j, 'a', false) // a second confirmation of a KC is not the first
    confirm(j, 'b', false)
    confirm(j, 'c', true, { kind: 'probe' })
    confirm(j, 'x', true) // not a solid placement KC
    confirm(j, 'd', true, { reason: 'due' }) // not a confirmation
    confirm(j, 'd', true, { src: 'practice' })
    const r = selectPlacementConfirm7([{ events: j.events, placement: { solidKcs: ['a', 'b', 'c', 'd', 'e'] } }])
    expect([r.n, r.correct, r.solid, r.partners]).toEqual([3, 2, 5, 1])
    expect(r.rate).toBeCloseTo(2 / 3, 10)
    const w = wilson(2, 3)
    expect(r.ci95).toEqual([w.lo, w.hi])
  })

  test('a ledger with no placement confirms nothing', () => {
    const j = new Journal()
    confirm(j, 'a', true)
    expect(selectPlacementConfirm7([{ events: j.events }])).toMatchObject({ n: 0, solid: 0, partners: 0, rate: null })
  })
})

describe('selectTicketStats', () => {
  const attempt = (j: Journal, lesson: string, day: number, ok: boolean, ms?: number, grp = `${lesson}@${day}@${ok}`) =>
    graded(j, 'quiz', `lesson:${lesson}`, d(day), { ok, score: ok ? 1 : 0, ...(ms === undefined ? {} : { ms }), data: { form: 'ticket', grp, n: 3, kcs: [] } })

  test('median minutes per attempt, and the share of settled tickets passed within two tries', () => {
    const j = new Journal()
    attempt(j, 'A', 0, false, 120_000)
    attempt(j, 'A', 1, true, 180_000) // passed on the second try
    attempt(j, 'B', 0, false, 240_000)
    attempt(j, 'B', 1, false, 300_000) // two tries, not passed: settled and failed
    attempt(j, 'C', 0, false, 60_000) // one failure: still open
    attempt(j, 'D', 0, true, 150_000) // first try
    attempt(j, 'E', 0, false)
    attempt(j, 'E', 1, false)
    attempt(j, 'E', 2, true) // third try: not within two
    graded(j, 'quiz', 'lesson:F', d(0), { data: { form: 'spiral', n: 8 } }) // not a ticket
    const r = selectTicketStats([j.events])
    expect([r.attempts, r.tickets, r.settled, r.correct, r.partners]).toEqual([9, 5, 4, 2, 1])
    expect(r.rate).toBe(0.5)
    expect(r.ci95).toEqual([wilson(2, 4).lo, wilson(2, 4).hi])
    // 2, 3, 4, 5, 1 and 2.5 minutes (E's three attempts carry no time): the median of six is 2.75
    expect(r.medianMinutes).toBe(2.75)
  })

  test('without the summary\'s own time, the answer times of the attempt\'s items stand in', () => {
    const j = new Journal()
    for (const [i, ms] of [30_000, 40_000, 50_000].entries()) {
      graded(j, 'item', `quiz:A#${i}`, d(0), { ms, data: { src: 'ticket', form: 'ticket', grp: 'g1', slot: i, of: 3, kcs: [] } })
    }
    attempt(j, 'A', 0, true, undefined, 'g1')
    expect(selectTicketStats([j.events]).medianMinutes).toBe(2)
  })

  test('no ticket, no numbers', () => {
    expect(selectTicketStats([])).toMatchObject({ attempts: 0, medianMinutes: null, tickets: 0, settled: 0, rate: null, ci95: null, partners: 0 })
  })
})

describe('selectTodayStats', () => {
  const session = (j: Journal, day: number, grp: string, ms: number[], of = ms.length) => {
    ms.forEach((m, i) => graded(j, 'item', 'gen:frag/v', d(day), { ms: m, data: { src: 'today', grp, slot: i, of, kcs: ['k'], reason: 'due' } }))
  }

  test('the median session minutes by C19\'s span rule, over every partner, and how many partners had one', () => {
    const a = new Journal()
    session(a, 0, 's1', [60_000, 60_000]) // 20 s apart (Journal) + 60 s = 80 s
    session(a, 1, 's2', [60_000], 2) // unfinished
    const b = new Journal()
    session(b, 0, 's1', [600_000])
    const none = new Journal()
    const r = selectTodayStats([a.events, b.events, none.events])
    expect(r.sessions).toBe(3)
    expect(r.completed).toBe(2)
    expect(r.partners).toBe(2)
    const spans = selectTodaySessions(a.events).concat(selectTodaySessions(b.events)).map((s) => s.spanMs / 60_000)
    expect(r.medianMinutes).toBe([...spans].sort((x, y) => x - y)[1])
    expect(r.medianCompletedMinutes).toBe((80_000 / 60_000 + 10) / 2)
  })

  test('no session, no median', () => {
    expect(selectTodayStats([])).toEqual({ sessions: 0, completed: 0, medianMinutes: null, medianCompletedMinutes: null, partners: 0 })
  })
})

describe('selectProveRate', () => {
  test('lab greens followed by a Prove-it attempt', () => {
    const a = new Journal()
    graded(a, 'lab-check', 'lab:one', d(0), { ok: false, score: 0 })
    graded(a, 'lab-check', 'lab:one', d(1))
    graded(a, 'lab-check', 'lab:one', d(2)) // a second green run is the same green
    graded(a, 'prove', 'prove:one', d(3))
    graded(a, 'lab-check', 'lab:two', d(4))
    graded(a, 'prove', 'prove:three', d(5)) // no green for it
    const b = new Journal()
    graded(b, 'prove', 'prove:one', d(0)) // an attempt before the green does not follow it
    graded(b, 'lab-check', 'lab:one', d(1))
    const r = selectProveRate([a.events, b.events, new Journal().events])
    expect([r.n, r.correct, r.partners]).toEqual([3, 1, 2])
    expect(r.rate).toBeCloseTo(1 / 3, 10)
    expect(r.ci95).toEqual([wilson(1, 3).lo, wilson(1, 3).hi])
  })

  test('no green, no rate', () => {
    expect(selectProveRate([])).toMatchObject({ n: 0, rate: null, ci95: null })
  })
})

describe('selectDailyStats', () => {
  const daily = (j: Journal, day: number, o: { fixed: boolean; burn: number; expert: number; probes: number | string[]; light: number; ref?: string }) =>
    graded(j, 'incident', o.ref ?? `inc:daily/${d(day)}`, d(day), {
      ok: o.fixed,
      data: { v: 1, src: 'daily', fault: 'pool-shrink', severity: 1, probes: o.probes, diagnosed: o.fixed, fixed: o.fixed, burn: o.burn, expertBurn: o.expert, streetlight: o.light, components: [] },
    })

  test('completed Dailies, the median of burn ÷ expert burn and the Streetlight rate', () => {
    const j = new Journal()
    daily(j, 0, { fixed: true, burn: 12, expert: 6, probes: ['a', 'b', 'c', 'd'], light: 1 })
    daily(j, 1, { fixed: true, burn: 5, expert: 5, probes: 4, light: 0 }) // a donation holds the count
    daily(j, 2, { fixed: false, burn: 30, expert: 6, probes: 4, light: 3 })
    daily(j, 2, { fixed: true, burn: 6, expert: 6, probes: 4, light: 0 }) // a rerun on the same date: not another Daily
    daily(j, 3, { fixed: true, burn: 0, expert: 0, probes: 0, light: 0 }) // no expert burn: no ratio
    j.add('incident', 'inc:drill/drain-stall', d(4), { score: 1, ok: true, provenance: 'unseen', data: { v: 1, src: 'drill', fault: 'drain-stall', severity: 1, probes: [], diagnosed: true, fixed: true, burn: 1, expertBurn: 1, streetlight: 0, components: [] } })
    const r = selectDailyStats([j.events, new Journal().events])
    expect([r.played, r.completed, r.partners]).toEqual([4, 3, 1])
    expect(r.medianBurnRatio).toBe(1.5) // ratios 2 and 1
    expect([r.streetlight.n, r.streetlight.correct]).toEqual([12, 4])
    expect(r.streetlight.rate).toBeCloseTo(1 / 3, 10)
    expect(r.streetlight.ci95).toEqual([wilson(4, 12).lo, wilson(4, 12).hi])
  })

  test('no Daily, no numbers', () => {
    expect(selectDailyStats([])).toMatchObject({ played: 0, completed: 0, medianBurnRatio: null, partners: 0 })
  })
})

describe('buildFieldReport and formatFieldReport', () => {
  const IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9']

  /** A partner who boots, lands on `landing` after `bootDays`, and does a little of everything else. */
  const partner = (o: { bootDays: number; landing?: string }) => {
    const j = new Journal()
    j.add('complete', 'boot', d(0))
    j.add('complete', 'placement', d(0))
    j.add('visit', `lesson:${o.landing ?? 'r.l2'}`, d(0))
    j.add('visit', 'lesson:t1.l1', d(o.bootDays))
    graded(j, 'lab-check', 'lab:one', d(1))
    graded(j, 'prove', 'prove:one', d(2))
    graded(j, 'quiz', 'lesson:t1.l1', d(2), { ms: 90_000, data: { form: 'ticket', grp: 'g', n: 3 } })
    return j.events
  }

  test('with nothing, every measured gate says there is not enough data and none passes', () => {
    const r = buildFieldReport([], CONTENT)
    expect(r.gates.map((g) => g.id)).toEqual(IDS)
    for (const g of r.gates) expect(['insufficient', 'owner']).toContain(g.status)
    expect(r.gates.filter((g) => g.status === 'insufficient').map((g) => g.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'])
    expect(r.keepOrKill.map((k) => k.verdict)).toEqual(['underpowered', 'underpowered', 'underpowered'])
    const text = formatFieldReport(r)
    expect(text).toContain('not enough data (n = 0')
    expect(text).not.toContain('PASS')
    expect(text).toContain('UNDERPOWERED, default: fewer new cards, SLO 0.85')
    expect(text).toContain('Fleet Daily: not enough data (n = 0 Dailies)')
  })

  test('under five partners no gate passes however good the numbers are', () => {
    const r = buildFieldReport([1, 2, 3, 4].map(() => ({ events: partner({ bootDays: 1 }) })), CONTENT)
    for (const id of ['F2', 'F3', 'F5', 'F6']) expect(r.gates.find((g) => g.id === id)?.status).toBe('insufficient')
    expect(formatFieldReport(r)).toContain('n = 4 partners with a first T lesson')
  })

  test('five partners pass F2, F3, F5 and F6, with n and Wilson intervals in the table', () => {
    const r = buildFieldReport([1, 1, 2, 3, 1].map((bootDays) => ({ events: partner({ bootDays }) })), CONTENT)
    const status = (id: string) => r.gates.find((g) => g.id === id)?.status
    expect([status('F2'), status('F3'), status('F5'), status('F6')]).toEqual(['pass', 'pass', 'pass', 'pass'])
    expect(r.boot.median).toBe(1)
    const text = formatFieldReport(r)
    expect(text).toContain('F2  Boot to first T lesson in at most 3 days → PASS')
    expect(text).toContain('median 1 days (bar 3); distribution 1d × 3, 2d × 1, 3d × 1')
    expect(text).toContain('0 of 5 placements landed on r.l1')
    expect(text).toContain('95 % interval')
    expect(text).toContain('5 of 5 lab greens followed by a Prove-it attempt = 100.0 %')
    expect(text).toContain('Today: UNDERPOWERED')
  })

  test('one landing on R.L1 fails F3 at any n; a slow Boot fails F2', () => {
    const r = buildFieldReport([{ events: partner({ bootDays: 1, landing: 'r.l1' }) }], CONTENT)
    expect(r.gates.find((g) => g.id === 'F3')?.status).toBe('fail')
    expect(formatFieldReport(r)).toContain('1 of 1 placements landed on r.l1')
    const slow = buildFieldReport([9, 9, 9, 9, 9].map((bootDays) => ({ events: partner({ bootDays }) })), CONTENT)
    expect(slow.gates.find((g) => g.id === 'F2')?.status).toBe('fail')
  })

  test('F1 needs 140 checks from five partners, each at least 35 days long, and the interval must hold the mean SLO', () => {
    const lesson = LESSONS[0]
    const kc = lesson.kcs[0]
    /** One partner: card on day 0, `n` Today answers from day 30 on, `right` of them right, a last event on day 40. */
    const learner = (n: number, right: number) => {
      const j = new Journal()
      j.passLesson(d(0), lesson.id, lesson.kcs)
      for (let i = 0; i < n; i++) {
        const ok = i < right
        graded(j, 'item', `gen:frag/v${i}`, d(30 + (i % 10)), { ok, score: ok ? 1 : 0, provenance: 'unseen', seed: i, data: { src: 'today', grp: `g${i}`, kcs: [kc], reason: 'due' } })
      }
      return { events: j.events, plan: { slo: 0.9 as const } }
    }
    const status = (ledgers: ReturnType<typeof learner>[]) => buildFieldReport(ledgers, CONTENT).gates[0]
    // 5 learners x 30 checks = 150, 135 right = 90 %: the interval holds 0.90
    const good = status([1, 2, 3, 4, 5].map(() => learner(30, 27)))
    expect(good.status).toBe('pass')
    expect(good.n).toBe(150)
    expect(good.partners).toBe(5)
    expect(good.detail).toContain('recall 90.0 %')
    expect(good.detail).toContain('mean SLO 90.0 %')
    // too few checks, too few partners
    expect(status([1, 2, 3, 4, 5].map(() => learner(20, 18))).status).toBe('insufficient')
    expect(status([1, 2, 3, 4].map(() => learner(40, 36))).status).toBe('insufficient')
    expect(status([1, 2, 3, 4].map(() => learner(40, 36))).detail).toContain('4 of 5 partners')
    // recall far below the SLO
    const bad = status([1, 2, 3, 4, 5].map(() => learner(30, 15)))
    expect(bad.status).toBe('fail')
    expect(bad.detail).toContain('interval below the SLO')
    // recall far above it
    expect(status([1, 2, 3, 4, 5].map(() => learner(30, 30))).detail).toContain('interval above the SLO')
  })

  test('the owner gates are listed and never decided', () => {
    const r = buildFieldReport([], CONTENT)
    for (const id of ['F8', 'F9']) expect(r.gates.find((g) => g.id === id)?.status).toBe('owner')
    expect(formatFieldReport(r)).toContain('F8  queue gating')
  })
})

describe('a donation reads like its export', () => {
  /**
   * A simulated learner with a ticket, a placement, a Daily and a Prove-it added, as a full ledger and as the
   * donation of it. Generated items get distinct top-level seeds (a donation has none, so the freshness test
   * could only tell them apart in the full ledger). `easy: false` rates "sure" answers "think", because a
   * donation has no `nsec` and so never replays an Easy rating (see the last test).
   */
  const fixture = (easy: boolean) => {
    const { events } = simulate(11, { days: 120, plan: { slo: 0.9 } })
    const seeded = events.map((e, i) => {
      const r = e as unknown as Record<string, unknown>
      const conf = !easy && r.conf === 'sure' ? 'think' : r.conf
      return { ...r, ...(conf === undefined ? {} : { conf }), ...(String(r.ref).startsWith('gen:') ? { seed: i } : {}) } as unknown as LedgerEvent
    })
    const j = Journal.from(seeded)
    j.add('complete', 'boot', d(130))
    j.add('visit', 'lesson:t1.l1', d(132))
    j.add('complete', 'placement', d(133))
    j.add('visit', 'lesson:t2.l1', d(133))
    graded(j, 'quiz', 'lesson:t2.l1', d(134), { ms: 120_000, data: { form: 'ticket', grp: 'tk', n: 3, kcs: [] } })
    graded(j, 'lab-check', 'lab:one', d(135))
    graded(j, 'prove', 'prove:one', d(136))
    graded(j, 'incident', `inc:daily/${d(137)}`, d(137), { data: { v: 1, src: 'daily', fault: 'pool-shrink', severity: 1, probes: ['a', 'b'], diagnosed: true, fixed: true, burn: 9, expertBurn: 6, streetlight: 1, components: [] } })
    const solid = [LESSONS[0].kcs[0]]
    const working: WorkingRecord[] = [
      { key: 'placement:result', value: { v: 1, solidKcs: solid }, at: '2026-12-01T00:00:00.000Z', dev: 'dev-1' },
      { key: 'boot:week', value: { slo: 0.9 }, at: '2026-12-01T00:00:00.000Z', dev: 'dev-1' },
    ]
    return {
      full: { events: j.events, plan: { slo: 0.9 as const }, placement: { solidKcs: solid } },
      donated: ledgerOfDonation(redactForPartner({ events: j.events, working })),
    }
  }

  test('every field selector gives the same answer', () => {
    const { full, donated } = fixture(false)
    const a = selectRetention30([full], CONTENT)
    const b = selectRetention30([donated], CONTENT)
    expect(a.n).toBeGreaterThan(20)
    expect([b.n, b.correct, b.meanSlo, b.spread]).toEqual([a.n, a.correct, a.meanSlo, a.spread])
    expect(selectBootToFirstT([donated.events])).toEqual(selectBootToFirstT([full.events]))
    expect(selectPlacementLanding([donated.events])).toEqual(selectPlacementLanding([full.events]))
    expect(selectPlacementConfirm7([donated])).toEqual(selectPlacementConfirm7([full]))
    expect(selectTicketStats([donated.events])).toEqual(selectTicketStats([full.events]))
    expect(selectProveRate([donated.events])).toEqual(selectProveRate([full.events]))
    expect(selectDailyStats([donated.events])).toEqual(selectDailyStats([full.events]))
  })

  test('Today sessions: the same sessions, timed by answer time alone', () => {
    const j = new Journal()
    // two sessions; the Journal puts 20 s between events, the learner paused longer than that in the second
    const slot = (grp: string, i: number, day: number, ms: number, of = 3) =>
      graded(j, 'item', 'gen:frag/v', d(day), { ms, data: { src: 'today', grp, slot: i, of, kcs: ['k'], reason: 'due' } })
    for (let i = 0; i < 3; i++) slot('s1', i, 0, 30_000)
    for (let i = 0; i < 3; i++) slot('s2', i, 1, 30_000)
    const full = selectTodaySessions(j.events)
    const donated = selectTodaySessions(ledgerOfDonation(redactForPartner({ events: j.events, working: [] })).events)
    expect(donated.map((s) => [s.items, s.of, s.completed])).toEqual(full.map((s) => [s.items, s.of, s.completed]))
    // full: 20 s + 20 s between first and last + 30 s = 70 s; donated: 30 + 30 + 30 s = 90 s of answer time
    expect(full.map((s) => s.spanMs)).toEqual([70_000, 70_000])
    expect(donated.map((s) => s.spanMs)).toEqual([90_000, 90_000])
  })

  test('card replay without nsec never rates Easy, so retention from a donation differs only a little', () => {
    const { full, donated } = fixture(true)
    const a = selectRetention30([full], CONTENT).n
    const b = selectRetention30([donated], CONTENT).n
    expect(a).toBeGreaterThan(100)
    expect(Math.abs(a - b) / a).toBeLessThan(0.05)
  })
})

describe('scripts/partner-report.ts: the Wave 2 field gates', () => {
  const script = path.resolve(import.meta.dir, '../../scripts/partner-report.ts')
  const run = (...args: string[]) => spawnSync('bun', [script, ...args], { encoding: 'utf8' })

  const partnerEvents = (bootDays: number): LedgerEvent[] => {
    const j = new Journal()
    j.add('complete', 'boot', d(0))
    j.add('visit', 'lesson:t1.l1', d(bootDays))
    graded(j, 'lab-check', 'lab:one', d(1), { data: { passed: [] } })
    graded(j, 'prove', 'prove:one', d(2), { data: { v: 1, qids: [], self: [] } })
    j.add('complete', 'placement', d(3))
    j.add('visit', 'lesson:t2.l1', d(3))
    return j.events
  }
  const fullFile = (dir: string, name: string, events: LedgerEvent[], device: string): string => {
    const p = path.join(dir, name)
    writeFileSync(p, serializeExport(buildExportV3({ events, working: [], device, exportedAt: '2026-10-07T12:00:00.000Z' })))
    return p
  }
  const donationFile = (dir: string, name: string, events: LedgerEvent[]): string => {
    const p = path.join(dir, name)
    writeFileSync(p, JSON.stringify(redactForPartner({ events, working: [] })))
    return p
  }

  test('prints the field-gate table from redacted donations, and the same table from full exports', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'partner-report-'))
    try {
      const days = [1, 1, 2, 3, 1]
      const donations = days.map((n, i) => donationFile(dir, `donation-${i}.json`, partnerEvents(n)))
      const fulls = days.map((n, i) => fullFile(dir, `export-${i}.json`, partnerEvents(n), `dev-${i}`))
      const a = run(...donations)
      const b = run(...fulls)
      expect(a.status).toBe(0)
      expect(b.status).toBe(0)
      expect(a.stdout).toContain('Wave 2 field gates over 5 exports')
      for (const id of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9']) expect(a.stdout).toContain(`${id}  `)
      expect(a.stdout).toContain('F2  Boot to first T lesson in at most 3 days → PASS')
      expect(a.stdout).toContain('F1  30-day recall within the SLO interval → NOT ENOUGH DATA')
      expect(a.stdout).toContain('95 % interval')
      // the gates the two readings can both compute agree
      const line = (out: string, id: string) => out.split('\n').find((l) => l.startsWith(`${id}  `))
      for (const id of ['F1', 'F2', 'F3', 'F6']) expect(line(a.stdout, id)).toBe(line(b.stdout, id))
      expect(a.stdout + b.stdout).not.toMatch(/\d{4}-\d{2}-\d{2}/)
      const j = run('--json', ...donations)
      expect(j.status).toBe(0)
      expect(JSON.parse(j.stdout).gates).toHaveLength(9)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('mixes a donation and a full export, and never prints a file name', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'partner-report-'))
    try {
      const r = run(donationFile(dir, 'secret-name-a.json', partnerEvents(1)), fullFile(dir, 'secret-name-b.json', partnerEvents(2), 'dev-b'))
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('over 2 exports')
      expect(r.stdout + r.stderr).not.toContain('secret-name')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses a damaged donation, and --wave1 on a donation, with exit code 2', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'partner-report-'))
    try {
      const bad = path.join(dir, 'bad.json')
      writeFileSync(bad, JSON.stringify({ format: 'kernelspace-donation', version: 1, events: [{ kind: 'item' }] }))
      const r = run(bad)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('damaged')
      const ok = donationFile(dir, 'ok.json', partnerEvents(1))
      const w = run('--wave1', ok)
      expect(w.status).toBe(2)
      expect(w.stderr).toContain('full export')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
