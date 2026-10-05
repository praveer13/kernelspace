import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { KCS } from '../../src/data/kc'
import { SYSTEMS_FORGE_LABS } from '../../src/data/labs'
import { wilson } from '../../src/lib/learner/calibration'
import { selectFirstReviewCalibration } from '../../src/lib/learner/cards'
import {
  buildOutcomeReport,
  firstReviewsOf,
  formatOutcomeReport,
  G1_MIN_PARTNERS,
  G2_MAX_GAP,
  G2_MIN_N,
  G3_MIN_N,
  G7_MAX_MINUTES,
  isTodayProbe,
  loopSpec,
  LOOP_STEPS,
  selectFirstReviewGate,
  selectLoopCompletion,
  selectProbeAccuracy,
  selectTodayDuration,
  selectTodaySessions,
  stripFreeText,
  tallyLoopCompletion,
} from '../../src/lib/learner/outcomes'
import { sessionSpanMs } from '../../src/lib/learner/today'
import { buildExportV3, parseImport, serializeExport } from '../../src/lib/ledger/codec'
import type { LedgerEvent, WorkingRecord } from '../../src/lib/ledger/types'
import { CONTENT, shuffled, simulate } from './ledger-gen'

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
  })
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

  test('is the median over completed sessions, pooled over ledgers: 9, 11 and 20 minutes give 11', () => {
    const minutes = (m: number) => 2 * m + 1 // items 30 s apart: n items span (n - 1) * 30 s
    const a = session('a', 1, '09:00', minutes(9), { of: minutes(9) })
    const b = session('b', 2, '09:00', minutes(11), { of: minutes(11) })
    const c = session('c', 3, '09:00', minutes(20), { of: minutes(20) })
    const r = selectTodayDuration([a, b, c])
    expect(r.sessions).toBe(3)
    expect(r.completed).toBe(3)
    expect(r.medianMinutes).toBeCloseTo(11, 9)
    expect(r.status).toBe('pass')
    expect(selectTodayDuration([a, [...b, ...c]]).medianMinutes).toBeCloseTo(11, 9)
  })

  test('an even count takes the mean of the middle two', () => {
    const one = (grp: string, m: number) => session(grp, 1, '09:00', 2, { of: 2, gapSec: m * 60 })
    expect(selectTodayDuration([one('a', 8), one('b', 12)]).medianMinutes).toBeCloseTo(10, 9)
  })

  test('abandoned sessions do not pull the median down, and are still reported', () => {
    const long = (grp: string, day: number) => session(grp, day, '09:00', 2, { of: 2, gapSec: 14 * 60 })
    const quit = (grp: string, day: number) => session(grp, day, '09:00', 2, { of: 9, gapSec: 20 })
    const r = selectTodayDuration([[...long('a', 1), ...long('b', 2), ...quit('c', 3), ...quit('d', 4), ...quit('e', 5)]])
    expect(r.sessions).toBe(5)
    expect(r.completed).toBe(2)
    expect(r.medianMinutes).toBeCloseTo(14, 9)
    expect(r.medianAllMinutes as number).toBeLessThan(1)
    expect(r.status).toBe('fail')
  })

  test('the bar is 12 minutes, inclusive', () => {
    expect(G7_MAX_MINUTES).toBe(12)
    const at = (m: number) => selectTodayDuration([session('a', 1, '09:00', 2, { of: 2, gapSec: m * 60 })])
    expect(at(12).status).toBe('pass')
    expect(at(12.5).status).toBe('fail')
  })

  test('no completed session is insufficient, not a pass', () => {
    expect(selectTodayDuration([])).toEqual({ sessions: 0, completed: 0, medianMinutes: null, medianAllMinutes: null, status: 'insufficient' })
    expect(selectTodayDuration([session('a', 1, '09:00', 2, { of: 9 })]).status).toBe('insufficient')
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

  test('an empty set of ledgers still reports, with nothing to claim', () => {
    const text = formatOutcomeReport(buildOutcomeReport([], CONTENT))
    expect(text).toContain('0 exports')
    expect(text).toContain('INSUFFICIENT')
    expect(text).toContain('n/a')
  })
})

describe('scripts/partner-report.ts on exported ledger files', () => {
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

      const r = run(pa, pb)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Wave 1 exit report over 2 exports')
      expect(r.stdout).toContain('G1  loop completion   1 of 5 needed')
      expect(r.stdout).toContain('reached: prequestion 2 → play 2 → stage 1 → unseen 1 → today 1')
      expect(r.stdout).toContain('week of 2026-10-05')
      for (const secret of [SECRET_EXPLAIN, SECRET_BOOT, SECRET_CR, 'a.json', 'b.json']) expect(r.stdout + r.stderr).not.toContain(secret)

      const j = run('--json', pa, pb)
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
