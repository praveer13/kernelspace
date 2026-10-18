import { beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { KCS } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import { SYSTEMS_FORGE_LABS } from '../../src/data/labs'
import { correctResponse, gradeResponse } from '../../src/lib/items/grade'
import { resultFor } from '../../src/lib/items/play'
import { loadAllFamilies } from '../../src/lib/items/registry'
import type { Gen, PlayableItem } from '../../src/lib/items/types'
import { wilson } from '../../src/lib/learner/calibration'
import { deriveCards, selectFirstReviewCalibration } from '../../src/lib/learner/cards'
import {
  BOOTSTRAP_RESAMPLES,
  bootstrapDraws,
  buildFieldReport,
  buildOutcomeReport,
  buildWave3Report,
  CADENCE,
  DAILY_MARGIN,
  DAILY_MIN_LEARNERS,
  discriminationLures,
  DISCRIMINATION_KCS,
  firstReviewsOf,
  formatFieldReport,
  formatOutcomeReport,
  formatWave3Report,
  G1_MIN_PARTNERS,
  G2_MAX_GAP,
  G2_MIN_N,
  G3_MIN_N,
  G7_MAX_MINUTES,
  HINT_MARGIN,
  HINT_MIN_LEARNERS,
  hintVerdict,
  isPreregSigned,
  isTodayProbe,
  loopSpec,
  LOOP_STEPS,
  percentile,
  PLANNED_WEEKLY_MINUTES,
  selectBootToFirstT,
  selectCubeError30,
  selectDailyStats,
  selectDailyVsOther,
  selectDiscrimination30,
  selectFirstReviewGate,
  selectFormsGain,
  selectHintArms,
  selectLoopCompletion,
  selectPlacementConfirm7,
  selectPlacementLanding,
  selectProbeAccuracy,
  selectProvedInUse,
  selectProveRate,
  selectProveV2,
  proveV2Verdict,
  PROVE_MIN_RATE,
  SURFACE_FOOTNOTE,
  selectReceiptStats,
  selectRetention30,
  selectSurfaceMinutes,
  selectTicketStats,
  selectTodayDuration,
  selectTodaySessions,
  selectTodayStats,
  selectVrk30Spread,
  stripFreeText,
  SURFACES,
  PRACTICE_TEAM_CODE,
  REDACTED_TEAM_CODE,
  surfaceOf,
  tallyLoopCompletion,
} from '../../src/lib/learner/outcomes'
import { formItemResponse, formsFor, type FormId } from '../../src/lib/learner/forms'
import { ledgerOfDonation, redactForPartner } from '../../src/lib/learner/redact'
import { addDays } from '../../src/lib/learner/reentry'
import { sessionSpanMs } from '../../src/lib/learner/today'
import { buildExportV3, parseImport, serializeExport } from '../../src/lib/ledger/codec'
import { actMeta, drillFor, drillResult, fleetRunFor, type ActResult } from '../../src/lib/fleet-week'
import { dailyIncident, dailyResult, type FinishedIncident } from '../../src/lib/world/daily'
import { SHIFT_LENGTH, recordShift, shiftIncidents, shiftRef, type ShiftIncident } from '../../src/lib/world/shift'
import { interviewRef, roundIncident, roundPlan } from '../../src/lib/mentor/interview'
import { parseIncidentRef } from '../../src/lib/ledger/refs'
import type { ItemResponse, LedgerEvent, LocalDay, WorkingRecord } from '../../src/lib/ledger/types'
import { hash32 } from '../../src/lib/rng'
import { makeProfile, startTab } from '../ledger/env'
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
  const learners = (seeds: number[], accuracy: number, days = 90) => seeds.map((s) => ({ events: simulate(s, { days, pActive: 0.9, pLesson: 0.8, accuracy }).events }))

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

    // four learners over sixty days: 163 and 278 first reviews, so both populations clear the 100 floor, and the gaps
    // (0.48 and 0.016) sit far from the 0.1 threshold. Twelve over ninety days took about 2.4 s for the same verdicts.
    const seeds = Array.from({ length: 4 }, (_, i) => 60 + i)
    // a learner population that forgets most of what the model expects them to remember: the gap is wide
    const forgetful = selectFirstReviewGate(learners(seeds, 0.3, 60), CONTENT)
    expect(forgetful.n).toBeGreaterThanOrEqual(G2_MIN_N)
    expect(forgetful.gap as number).toBeGreaterThan(G2_MAX_GAP)
    expect(forgetful.status).toBe('fail')
    // one that remembers about what the model expects: the gap is narrow
    const steady = selectFirstReviewGate(learners(seeds, 0.9, 60), CONTENT)
    expect(steady.n).toBeGreaterThanOrEqual(G2_MIN_N)
    expect(steady.gap as number).toBeLessThanOrEqual(G2_MAX_GAP)
    expect(steady.status).toBe('pass')
  }, 15_000) // about 0.4 s quiet, 2.2 s with 35 busy loops on 20 cores; bun's 5 s default left too little for a loaded CI box
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

describe('scripts/partner-report.ts --wave2: the Wave 2 field gates', () => {
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
      const a = run('--wave2', ...donations)
      const b = run('--wave2', ...fulls)
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
      const j = run('--json', '--wave2', ...donations)
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

/* ================================================================== */
/* Wave 3 field gates (docs/specs/wave-3.md §15, §18.2; task 3c-03)    */
/* ================================================================== */

/** n fresh Journals, one per partner. */
const partners = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i))

/** A graded answer that is `unseen`, as Today writes a generated item on a fresh seed. */
const unseen = (j: Journal, kind: 'item' | 'probe', ref: string, day: LocalDay, ok: boolean, data: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  j.add(kind, ref, day, { score: ok ? 1 : 0, ok, rev: 'r', provenance: 'unseen', data, ...extra })

type Facade = ReturnType<ReturnType<typeof startTab>['progress']['getState']>

/** The events the façade (progress.ts) writes: `write` runs on a fresh tab whose clock reads noon of Journal day `day`, and the ledger is read back. */
async function written(day: number, write: (s: Facade) => void): Promise<LedgerEvent[]> {
  const tab = startTab(makeProfile({ ms: Date.parse(`${d(day)}T12:00:00.000Z`) }))
  write(tab.progress.getState())
  await tab.progress.controls.flush()
  return (await (await tab.engine()).events()) as LedgerEvent[]
}

/** A lesson QuizBlock attempt of `ms`, as `recordQuizAttempt` writes it: two `quiz` items with no `ms`, and the time on the `quiz` summary alone. */
const quizBlock = (day: number, ms: number, kcs: string[] = [FRAG_KC]) =>
  written(day, (s) => s.recordQuizAttempt({ lessonId: 't1.l3', seed: 1, ms, responses: [{ qi: 0, rev: 'r0', pick: [0], ok: true, kcs }, { qi: 1, rev: 'r1', pick: [1], ok: false, kcs }] }))

/** An exit ticket, as `recordTicket` writes it: each item with its own `ms`, and the summary with the attempt's whole time `ms`. */
const ticket = (day: number, itemMs: readonly number[], ms: number) =>
  written(day, (s) =>
    s.recordTicket({
      lessonId: 't1.l3',
      form: 'ticket',
      seed: 1,
      ms,
      ok: true,
      nonMcqOk: true,
      responses: itemMs.map((m, i) => ({ ref: `gen:frag/v${i}` as const, rev: `r${i}`, score: 1, ok: true, ms: m, provenance: 'unseen' as const, data: { src: 'ticket' as const, kcs: [FRAG_KC], nsec: 40 } })),
    }),
  )

/** What a finished incident reports (the fleet protocol's `IncidentFinish`, as `dailyResult` and `drillResult` read it). */
const FINISHED: FinishedIncident = { fault: 'pool-shrink', severity: 2, hypothesis: 'pool-shrink', probes: ['kv'], diagnosed: true, fixed: true, burn: 6, expertBurn: 4, streetlight: 0 }
/** An Act I run on one of your components, as the act reports it. */
const ACT_RUN: ActResult = { pass: true, score: 1, headline: '', detail: '', metrics: [], seed: 99, run: { goodput: 10, refGoodput: 11 } }
const DAILY_AND_FLEET_MS = { daily: 90_000, run: 10_000, drill: 10_000, act: 10_000 }

/**
 * The Daily and Fleet Week as the pages record them since EF1: the Daily's `incident` (`dailyResult`), an Act I
 * `fleet-run` (`fleetRunFor`), an Act IV drill's `incident` (`drillResult`) and the act (`completeFleetWeekAct` with
 * `actMeta`), each with the time the page measured. `ms` null gives the same events with no time, as they were before.
 */
const dailyAndFleet = (day: number, ms: typeof DAILY_AND_FLEET_MS | null) =>
  written(day, (s) => {
    const drill = drillFor(5)
    s.recordIncident(dailyResult(d(day), dailyIncident(d(day)), FINISHED, [], ms?.daily))
    const run = fleetRunFor('act1', ACT_RUN, [{ slot: 'scheduler', labId: 'batching-scheduler', sha256: 'a'.repeat(64) }], ms?.run)
    if (run) s.recordFleetRun(run)
    s.recordIncident(drillResult(drill, { ...FINISHED, fault: drill.spec.fault, hypothesis: drill.spec.fault }, [], ms?.drill))
    s.completeFleetWeekAct('engine', 0.8, actMeta(ACT_RUN, { runId: '0a1b2c3d', checks: [], uncited: [] }, undefined, ms?.act))
  })

describe('the module graph', () => {
  test('outcomes.ts reads vrk.ts and forms.ts, and neither imports it back: what they share is in proportion.ts', () => {
    const src = (f: string) => readFileSync(path.resolve(import.meta.dir, '../../src/lib/learner', f), 'utf8')
    expect(src('outcomes.ts')).toMatch(/from '\.\/vrk'/)
    expect(src('outcomes.ts')).toMatch(/from '\.\/forms'/)
    for (const f of ['vrk.ts', 'forms.ts', 'proportion.ts']) expect(src(f), f).not.toMatch(/from '\.\/outcomes'/)
    for (const f of ['vrk.ts', 'forms.ts', 'outcomes.ts']) expect(src(f), f).toMatch(/from '\.\/proportion'/)
  })
})

describe('the bootstrap', () => {
  test('percentile interpolates; draws are sorted, seeded and as many as asked', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(percentile([1, 2, 3, 4], 0)).toBe(1)
    expect(percentile([1, 2, 3, 4], 1)).toBe(4)
    expect(percentile([], 0.5)).toBeNull()
    const mean = (s: readonly number[]) => s.reduce((a, b) => a + b, 0) / s.length
    const a = bootstrapDraws([1, 2, 3, 4, 10], mean, 7, 500)
    expect(a).toHaveLength(500)
    expect([...a].sort((x, y) => x - y)).toEqual(a)
    expect(bootstrapDraws([1, 2, 3, 4, 10], mean, 7, 500)).toEqual(a)
    expect(bootstrapDraws([1, 2, 3, 4, 10], mean, 8, 500)).not.toEqual(a)
    expect(bootstrapDraws([], mean, 7, 10)).toEqual([])
    expect(bootstrapDraws([5, 5, 5], mean, 1, 50).every((x) => x === 5)).toBe(true)
    expect(BOOTSTRAP_RESAMPLES).toBe(10_000)
  })

  test('a resample whose statistic cannot be computed is left out', () => {
    expect(bootstrapDraws([1, 2], () => null, 1, 20)).toEqual([])
  })
})

describe('isPreregSigned', () => {
  test('a Signed line needs a name and an ISO date; a table needs the owner and the date', () => {
    expect(isPreregSigned('Signed: (pending owner)')).toBe(false)
    expect(isPreregSigned('Signed: P. Owner')).toBe(false)
    expect(isPreregSigned('text\nSigned: P. Owner 2026-10-14\nmore')).toBe(true)
    expect(isPreregSigned('| Owner | |\n| Date signed | |')).toBe(false)
    expect(isPreregSigned('| Owner | P. Owner |\n| Date signed | |')).toBe(false)
    expect(isPreregSigned('| Owner | P. Owner |\n| Date signed | 2026-10-14 |')).toBe(true)
    expect(isPreregSigned('say `Signed: P. Owner 2026-10-14` here')).toBe(false)
  })

  test('the three pre-registrations of the repo are read by it, whichever way they are signed', () => {
    const read = (f: string) => readFileSync(path.resolve(import.meta.dir, `../../docs/prereg/${f}`), 'utf8')
    for (const f of ['fleet-daily.md', 'watcher.md']) {
      const pending = read(f).replace(/^Signed:.*$/m, 'Signed: (pending owner)')
      expect(pending).toContain('Signed: (pending owner)')
      expect(isPreregSigned(pending)).toBe(false)
      expect(isPreregSigned(pending.replace('Signed: (pending owner)', 'Signed: P. Owner 2026-10-14'))).toBe(true)
    }
    const hint = read('hint-ladders.md').replace(/^\|\s*Owner\s*\|.*$/m, '| Owner | |').replace(/^\|\s*Date signed\s*\|.*$/m, '| Date signed | |')
    expect(isPreregSigned(hint)).toBe(false)
    expect(isPreregSigned(hint.replace('| Owner | |', '| Owner | P. Owner |').replace('| Date signed | |', '| Date signed | 2026-10-14 |'))).toBe(true)
  })
})

describe('docs/prereg/fleet-daily.md', () => {
  const text = readFileSync(path.resolve(import.meta.dir, '../../docs/prereg/fleet-daily.md'), 'utf8')

  test('states the rule, the minimum n, the comparison and the underpowered default PLAN §9 asks for', () => {
    expect(text).toMatch(/Fleet Daily: Daily KCs' 30-day diagnosis accuracy on unseen seeds ≥ non-Daily KCs'/)
    expect(text).toContain('Default if underpowered')
    expect(text).toContain('weekly, and the On-Call shift is not built on it')
    expect(text).toContain('one-sided 97.5 %')
    expect(text).toContain(`**${DAILY_MIN_LEARNERS}**`)
    expect(text).toContain(`${DAILY_MARGIN * 100} percentage points`)
    expect(text).toContain('before `selectDailyVsOther` is read')
  })

  test('its minimum n is the power calculation it states, and the ladder file\'s is the same recipe', () => {
    const z = 1.959964 + 0.841621
    expect(DAILY_MIN_LEARNERS).toBe(Math.ceil(((z * 25) / (DAILY_MARGIN * 100)) ** 2))
    expect(HINT_MIN_LEARNERS).toBe(Math.ceil(((z * 20) / (HINT_MARGIN * 100)) ** 2))
  })
})

describe('surfaceOf', () => {
  const at = iso(1)
  const of = (kind: string, ref: string, src?: string) => surfaceOf(ev(kind, ref, at, src === undefined ? {} : { data: { src } }))

  test('every kind of event goes to one of the seven surfaces, or to none', () => {
    expect(of('item', 'gen:frag/v', 'today')).toBe('today')
    expect(of('probe', 'gen:frag/v', 'today')).toBe('today')
    expect(of('item', 'gen:frag/v', 'practice')).toBe('today')
    expect(of('item', 'item:field.decode-kv.tps', 'practice')).toBeNull()
    expect(of('item', 'quiz:t1.l3#0', 'quiz')).toBe('lessons')
    expect(of('quiz', 'lesson:t1.l3')).toBe('lessons')
    expect(of('item', 'cr:t1.l3#0', 'ticket')).toBe('lessons')
    expect(of('item', 'item:t2.l2.iso.1', 'lesson')).toBe('lessons')
    expect(of('predict', 'dia:t1.l1#0', 'diagram')).toBe('lessons')
    expect(of('sim-task', 'sim:alloc/frag-pct')).toBe('lessons')
    expect(of('exercise', 'lesson:t1.l1')).toBe('lessons')
    expect(of('item', 'gen:sig/name-fault', 'daily')).toBe('daily')
    expect(of('incident', 'inc:daily/2026-09-01')).toBe('daily')
    expect(of('incident', 'inc:team/blue/2026-09-01')).toBe('daily')
    expect(of('incident', 'inc:drill/pool-shrink')).toBe('fleet-week')
    expect(of('item', 'gen:tiling/raster-ai', 'form')).toBe('me')
    expect(of('item', 'gen:tiling/raster-ai', 'play')).toBe('plays')
    expect(of('play', 'play:eplb')).toBe('plays')
    expect(of('lab-check', 'lab:rust-allocator')).toBe('labs')
    expect(of('prove', 'prove:rust-allocator')).toBe('labs')
    expect(of('fleet-run', 'fleet:engine')).toBe('fleet-week')
    expect(of('fleet-act', 'fw:engine')).toBe('fleet-week')
  })

  test('Boot, the placement walk, visits and acks are not surfaces', () => {
    expect(of('item', 'boot:value', 'boot')).toBeNull()
    expect(of('item', 'gen:frag/v', 'placement')).toBeNull()
    expect(of('visit', 'lesson:t1.l1')).toBeNull()
    expect(of('ack', 'hint:lab/x#R1')).toBeNull()
    expect(of('capstone-step', 'cap:a')).toBeNull()
  })

  /** One practice incident written as the page writes it: `recordShift` on the progress store, the façade's own event out. */
  const recorded = async (day: number, incident: ShiftIncident, ms: number): Promise<LedgerEvent[]> => {
    const tab = startTab(makeProfile({ ms: Date.parse(`${d(day)}T12:00:00.000Z`) }))
    expect(recordShift(tab.progress, d(day), incident, FINISHED, ms)).toBe(true)
    await tab.progress.controls.flush()
    return ((await (await tab.engine()).events()) as LedgerEvent[]).filter((e) => e.kind === 'incident')
  }

  test('the On-Call shift’s and Interview mode’s practice incidents are not Daily minutes, as written and as donated (G8)', async () => {
    const shift = (await Promise.all(shiftIncidents(d(0)).map((inc) => recorded(0, inc, 60_000)))).flat()
    const interview = await recorded(0, roundIncident(roundPlan(d(0), 0)), 90_000)
    expect(shift.map((e) => e.ref)).toEqual([1, 2, 3].map((k) => `inc:team/shift-${k}/${d(0)}`))
    expect(interview.map((e) => e.ref)).toEqual([`inc:team/interview/${d(0)}`])
    const donated = (events: LedgerEvent[]) => ledgerOfDonation(redactForPartner({ events, working: [] })).events
    for (const events of [shift, interview]) {
      for (const e of events) {
        expect((e as { ms?: number }).ms).toBeGreaterThan(0)
        expect(surfaceOf(e)).toBeNull()
      }
      // a donation drops the team code, and the dropped code is practice too
      for (const e of donated(events)) {
        expect(e.ref).toMatch(/^inc:team\/-\/d0$/)
        expect(surfaceOf(e)).toBeNull()
      }
      expect(selectSurfaceMinutes([events]).partners).toBe(0)
      expect(selectSurfaceMinutes([donated(events)]).partners).toBe(0)
    }
    // beside the Daily of the same day, only the Daily's 90 s count, as written and as donated
    const daily = await dailyAndFleet(0, DAILY_AND_FLEET_MS)
    for (const events of [[...daily, ...shift, ...interview], donated([...daily, ...shift, ...interview])]) {
      expect(selectSurfaceMinutes([events]).surfaces.daily.median).toBeCloseTo(1.5, 9)
    }
  })

  test('the practice team codes are reserved: every team code the app writes is one, and any other is a team Daily', () => {
    for (const code of ['shift-1', 'shift-2', 'shift-3', 'interview']) expect(PRACTICE_TEAM_CODE.test(code)).toBe(true)
    for (const code of ['blue', 'shift', 'shift-0', 'interviews', 'team-interview', '-']) expect(PRACTICE_TEAM_CODE.test(code)).toBe(false)
    expect(of('incident', 'inc:team/blue/2026-09-01')).toBe('daily')
    expect(of('incident', 'inc:team/shift-2/2026-09-01')).toBeNull()
    expect(of('incident', 'inc:team/interview/2026-09-01')).toBeNull()
    expect(of('incident', `inc:team/${REDACTED_TEAM_CODE}/d4`)).toBeNull()
    for (let k = 0; k < SHIFT_LENGTH; k++) expect(parseIncidentRef(shiftRef('2026-09-01', k))).toMatchObject({ src: 'team', code: `shift-${k + 1}` })
    expect(parseIncidentRef(interviewRef('2026-09-01'))).toMatchObject({ src: 'team', code: 'interview' })
    // every team ref a source file builds names a reserved code (a placeholder `${…}` read as 1), or the donation's `-`:
    // a writer of a new team code, such as a team Daily, fails here until surfaceOf is told which it is
    const root = path.resolve(import.meta.dir, '../../src')
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f))
    const codes = new Map<string, string>()
    for (const f of files) {
      const code = readFileSync(path.join(root, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      for (const m of code.matchAll(/`inc:team\/((?:[^/`$]|\$\{[^}]*\})*)\//g)) {
        // `inc:team/${string}/${string}` is the ref type (ledger/types.ts), which writes nothing
        if (m[1] !== '${string}') codes.set(`${f}: ${m[1]}`, (m[1] as string).replace(/\$\{[^}]*\}/g, '1'))
      }
    }
    console.log(`team codes the app writes: ${[...codes.keys()].join('; ')}`)
    expect([...codes.values()].sort()).toEqual(['-', 'interview', 'shift-1'])
    for (const [where, c] of codes) expect(PRACTICE_TEAM_CODE.test(c) || c === REDACTED_TEAM_CODE, where).toBe(true)
  })
})

describe('selectSurfaceMinutes', () => {
  /**
   * One partner: every surface once in the first calendar week (START is a Tuesday), 7.0833 minutes in all. The lesson time is
   * a QuizBlock attempt of 30 s and a ticket whose items took 10 s and 20 s (its summary says 77 s), both as the façade writes them.
   * The Daily (90 s) and Fleet Week (an Act I run, an Act IV drill and an act of 10 s each) are the façade's events from the
   * app's own builders (`dailyAndFleet`), not hand-written `ms` (EF1).
   */
  const firstWeek = async (day: number): Promise<LedgerEvent[]> => {
    const j = new Journal()
    graded(j, 'item', 'gen:frag/a', d(day), { ms: 1000, data: { src: 'today', grp: `s${day}`, slot: 0, of: 3, kcs: [FRAG_KC] } })
    graded(j, 'item', 'gen:frag/b', d(day), { ms: 1000, data: { src: 'today', grp: `s${day}`, slot: 1, of: 3, kcs: [FRAG_KC] } })
    graded(j, 'item', 'gen:frag/c', d(day), { ms: 10_000, data: { src: 'today', grp: `s${day}`, slot: 2, of: 3, kcs: [FRAG_KC] } })
    graded(j, 'play', 'play:eplb', d(day), { ms: 60_000, data: { phase: 'play' } })
    graded(j, 'lab-check', 'lab:rust-allocator', d(day), { ms: 120_000, data: { passed: [], total: 6 } })
    graded(j, 'item', 'gen:tiling/raster-ai', d(day), { ms: 15_000, data: { src: 'form', formId: 'A', formSlot: 0, formSet: 0, kcs: ['t4.x'] } })
    graded(j, 'item', 'boot:value', d(day), { ms: 99_000, data: { src: 'boot' } })
    return [...j.events, ...(await quizBlock(day, 30_000)), ...(await ticket(day, [10_000, 20_000], 77_000)), ...(await dailyAndFleet(day, DAILY_AND_FLEET_MS))]
  }
  const partner = () => firstWeek(0)
  const crew = (n: number) => Promise.all(partners(n, partner))

  test('a lesson quiz\'s time is on its summary and counts; a ticket\'s is on its items and counts once', async () => {
    // the façade's own events: a QuizBlock's items carry no ms, so only the summary holds the attempt's 45 s
    const quiz = await quizBlock(0, 45_000)
    expect(quiz.filter((e) => e.kind === 'item').map((e) => (e as { ms?: number }).ms)).toEqual([undefined, undefined])
    expect(quiz.filter((e) => e.kind === 'quiz').map((e) => (e as { ms?: number }).ms)).toEqual([45_000])
    expect(selectSurfaceMinutes([quiz]).surfaces.lessons.median).toBeCloseTo(0.75, 9)
    // a ticket's items carry 10 s and 20 s and its summary 77 s: the items count, the summary does not add itself again
    const t = await ticket(0, [10_000, 20_000], 77_000)
    expect(t.filter((e) => e.kind === 'quiz').map((e) => (e as { ms?: number }).ms)).toEqual([77_000])
    expect(selectSurfaceMinutes([t]).surfaces.lessons.median).toBeCloseTo(0.5, 9)
    // a ticket whose items were not timed falls back to its summary
    const untimed = await written(0, (s) =>
      s.recordTicket({ lessonId: 't1.l3', form: 'ticket', seed: 1, ms: 60_000, ok: false, nonMcqOk: true, responses: [{ ref: 'gen:frag/v0', rev: 'r0', score: 0, ok: false, data: { src: 'ticket', kcs: [FRAG_KC] } }] }),
    )
    expect(selectSurfaceMinutes([untimed]).surfaces.lessons.median).toBeCloseTo(1, 9)
    // and from a donation, whose attempt groups are renumbered, the same
    const donated = (events: LedgerEvent[]) => ledgerOfDonation(redactForPartner({ events, working: [] })).events
    expect(selectSurfaceMinutes([donated(quiz)]).surfaces.lessons.median).toBeCloseTo(0.75, 9)
    expect(selectSurfaceMinutes([donated(t)]).surfaces.lessons.median).toBeCloseTo(0.5, 9)
  })

  test('a Today session is its span by the C19 rule, the other surfaces the sum of their ms, and what is not a surface is left out', async () => {
    const r = selectSurfaceMinutes(await crew(5))
    expect(r.partners).toBe(5)
    // the three Today items are 20 s apart in the Journal: 40 s + the last item's 10 s
    expect(r.surfaces.today.median).toBeCloseTo(50 / 60, 9)
    // the QuizBlock's 30 s and the ticket items' 10 + 20 s; Boot's 99 s is not a surface
    expect(r.surfaces.lessons.median).toBeCloseTo(1, 9)
    expect(r.surfaces.plays.median).toBeCloseTo(1, 9)
    expect(r.surfaces.labs.median).toBeCloseTo(2, 9)
    expect(r.surfaces.daily.median).toBeCloseTo(1.5, 9)
    expect(r.surfaces['fleet-week'].median).toBeCloseTo(0.5, 9)
    expect(r.surfaces.me.median).toBeCloseTo(0.25, 9)
    expect(r.total.median).toBeCloseTo(50 / 60 + 1 + 1 + 2 + 1.5 + 0.5 + 0.25, 9)
    expect(r.plannedWeeklyMinutes).toBe(PLANNED_WEEKLY_MINUTES)
    expect(r.surfaces.today.partners).toBe(5)
  })

  test('the Daily and Fleet Week read the time their recorders write, own and donated (EF1)', async () => {
    const timed = await dailyAndFleet(0, DAILY_AND_FLEET_MS)
    expect(timed.filter((e) => e.kind === 'incident' || e.kind === 'fleet-run' || e.kind === 'fleet-act').map((e) => [e.kind, e.ref.replace(/\d{4}-\d{2}-\d{2}/, 'date'), e.ms])).toEqual([
      ['incident', 'inc:daily/date', 90_000],
      ['fleet-run', 'fleet:act1', 10_000],
      ['incident', `inc:drill/${drillFor(5).spec.fault}`, 10_000],
      ['fleet-act', 'fw:engine', 10_000],
    ])
    const donated = (events: LedgerEvent[]) => ledgerOfDonation(redactForPartner({ events, working: [] })).events
    for (const ledger of [timed, donated(timed)]) {
      const r = selectSurfaceMinutes([ledger])
      expect(r.surfaces.daily.median).toBeCloseTo(1.5, 9)
      expect(r.surfaces['fleet-week'].median).toBeCloseTo(0.5, 9)
    }
    // the same events as they were written before EF1, with no time: 0 minutes on both surfaces, which is what F1 read
    const before = await dailyAndFleet(0, null)
    expect(before.some((e) => e.ms !== undefined)).toBe(false)
    expect(selectSurfaceMinutes([[...before, ...(await quizBlock(0, 30_000))]]).surfaces).toMatchObject({ daily: { median: 0 }, 'fleet-week': { median: 0 } })
  })

  test('minutes per week average over the weeks with recorded time, and a quiet week is not one of them', async () => {
    // the next calendar week is empty; the one after it holds a 30 s lesson quiz only
    const r = selectSurfaceMinutes([[...(await firstWeek(0)), ...(await quizBlock(14, 30_000))]])
    expect(r.surfaces.lessons.median).toBeCloseTo((1 + 0.5) / 2, 9)
    expect(r.surfaces.labs.median).toBeCloseTo(2 / 2, 9)
  })

  test('a partner who never opened a surface counts 0 there, and an empty ledger is no partner', async () => {
    const lessonsOnly = (n: number) => quizBlock(0, n * 60_000)
    const r = selectSurfaceMinutes([await lessonsOnly(1), await lessonsOnly(2), await lessonsOnly(9), await partner(), []])
    expect(r.partners).toBe(4)
    expect(r.surfaces.labs.median).toBe(0)
    expect(r.surfaces.labs.partners).toBe(1)
    // lessons 1, 2, 9 and the partner's 1: the median of four is 1.5
    expect(r.surfaces.lessons.median).toBeCloseTo(1.5, 9)
  })

  test('each stage row reads the partners\' own journey weeks, not the calendar', async () => {
    // journey week 1, then a 1-minute lesson quiz in week 2 and a 3-minute one in week 3
    const events = [...(await firstWeek(0)), ...(await quizBlock(7, 60_000)), ...(await quizBlock(14, 180_000))]
    const r = selectSurfaceMinutes(partners(5, () => events))
    const row = (first: number) => r.stages.find((s) => s.row.weeks[0] === first)!
    expect(row(1).partners).toBe(5)
    expect(row(1).medians?.lessons).toBeCloseTo(1, 9)
    expect(row(1).medians?.labs).toBeCloseTo(2, 9)
    // weeks 2 and 3 are one row: (1 + 3) / 2 minutes of lessons a week
    expect(row(2).medians?.lessons).toBeCloseTo(2, 9)
    expect(row(2).medians?.labs).toBe(0)
    expect(row(4).partners).toBe(0)
    expect(row(4).medians).toBeNull()
    expect(r.stages.map((s) => s.row.weeks)).toEqual(CADENCE.map((c) => c.weeks))
  })

  test('PLAN §4.D\'s cadence is whole: nine rows covering weeks 1 to 26 once, each naming real surfaces', () => {
    expect(CADENCE).toHaveLength(9)
    expect(CADENCE[0].weeks[0]).toBe(1)
    expect(CADENCE[CADENCE.length - 1].weeks[1]).toBe(26)
    CADENCE.forEach((row, i) => {
      if (i > 0) expect(row.weeks[0]).toBe(CADENCE[i - 1].weeks[1] + 1)
      expect(row.surfaces.length).toBeGreaterThan(0)
      for (const s of row.surfaces) expect(SURFACES).toContain(s)
    })
  })

  test('a donation reads like its export for every surface but Today\'s session spans', async () => {
    const events = await partner()
    const own = selectSurfaceMinutes([events])
    const donated = selectSurfaceMinutes([ledgerOfDonation(redactForPartner({ events, working: [] })).events])
    for (const s of SURFACES.filter((x) => x !== 'today')) expect(donated.surfaces[s].median).toBeCloseTo(own.surfaces[s].median as number, 9)
  })
})

describe('selectHintArms', () => {
  // only rust-allocator's `fragmentation` check has a generator-covered KC; these tests cover every KC so that a learner can hold two checks
  const COVERED = KCS.map((k) => ({ ...k, gen: k.gen ?? ['frag'] }))
  const options = { kcs: COVERED }
  const CHECK_A = { id: 'align', kc: 't1.alignment' }
  const CHECK_B = { id: 'coalesce', kc: 't1.split-coalesce' }

  /** A learner who got help on `align` under `armA` and on `coalesce` under `armB`, with a cold check 30 days after the lab's first green. */
  const learner = (o: { armA: string; armB: string; okA: boolean; okB: boolean; gap?: number }) => {
    const j = new Journal()
    j.add('lab-check', 'lab:rust-allocator', d(0), {
      ok: true,
      provenance: 'unseen',
      data: { passed: [CHECK_A.id, CHECK_B.id], total: 6, checks: [CHECK_A, CHECK_B].map((c) => ({ id: c.id, status: 'pass' })) },
    })
    j.add('ack', `hint:rust-allocator/${CHECK_A.id}#R1`, d(0), { data: { arm: o.armA } })
    j.add('ack', `packet:lab/rust-allocator/${CHECK_B.id}`, d(0), { data: { arm: o.armB, via: 'copy' } })
    const gap = o.gap ?? 30
    unseen(j, 'probe', 'gen:frag/first-fit', d(gap), o.okA, { src: 'today', reason: 'probe', kcs: [CHECK_A.kc] })
    unseen(j, 'probe', 'gen:frag/first-fit', d(gap + 1), o.okB, { src: 'today', reason: 'probe', kcs: [CHECK_B.kc] })
    return { events: j.events }
  }
  const crew = (n: number, f: (i: number) => Parameters<typeof learner>[0]) => partners(n, (i) => learner(f(i)))

  test('the learner-level difference ladder − packet, its one-sided bounds and the checks behind it', () => {
    // the ladder check is always right; the packet check is right for 4 of 5 learners: d is 0 or +1, mean +0.2
    const r = selectHintArms(crew(130, (i) => ({ armA: 'ladder', armB: 'packet', okA: true, okB: i % 5 !== 0 })), CONTENT, options)
    expect(r.learners).toBe(130)
    expect(r.partners).toBe(130)
    expect(r.checks).toEqual({ ladder: 130, packet: 130 })
    expect(r.diff.mean).toBeCloseTo(0.2, 9)
    expect(r.diff.lower as number).toBeGreaterThan(0.1)
    expect(r.diff.upper as number).toBeLessThan(0.3)
    expect(r.verdict).toBe('keep')
    expect(r.required).toBe(HINT_MIN_LEARNERS)
  })

  test('the arm is the recorded one, not a recomputed one: the packet arm\'s check can be the first', () => {
    const swapped = crew(130, (i) => ({ armA: 'packet', armB: 'ladder', okA: i % 5 !== 0, okB: true }))
    const r = selectHintArms(swapped, CONTENT, options)
    expect(r.diff.mean).toBeCloseTo(0.2, 9)
    expect(r.verdict).toBe('keep')
  })

  test('a ladder clearly worse than the packet is cut, and a lower bound just inside the margin is kept', () => {
    const worse = selectHintArms(crew(130, () => ({ armA: 'ladder', armB: 'packet', okA: false, okB: true })), CONTENT, options)
    expect(worse.diff.mean).toBe(-1)
    expect(worse).toMatchObject({ verdict: 'cut', because: 'margin' })
    // no difference at all: every d is 0, so the bound is 0, above −5 points
    const same = selectHintArms(crew(130, () => ({ armA: 'ladder', armB: 'packet', okA: true, okB: true })), CONTENT, options)
    expect(same.diff.lower).toBe(0)
    expect(same.verdict).toBe('keep')
    // a mean of −10 points over a large spread has a lower bound below −5 points
    const wide = selectHintArms(crew(130, (i) => ({ armA: 'ladder', armB: 'packet', okA: i % 10 !== 0, okB: true })), CONTENT, options)
    expect(wide.diff.mean).toBeCloseTo(-0.1, 9)
    expect(wide.verdict).toBe('cut')
  })

  test('a packet arm clearly better cuts the ladder even with the margin met (prereg §4): a powered d of −3 points', () => {
    // 18 of 600 learners got the ladder check wrong and the packet one right, the rest both right: d = −18/600 = −3 points
    const r = selectHintArms(crew(600, (i) => ({ armA: 'ladder', armB: 'packet', okA: i % 100 >= 3, okB: true })), CONTENT, options)
    expect(r.learners).toBe(600)
    expect(r.diff.mean).toBeCloseTo(-0.03, 9)
    // the margin alone would keep it: the lower bound, −26/600 = −4.3 points, is above −5 points
    expect(r.diff.lower as number).toBeGreaterThan(-HINT_MARGIN)
    expect(r.diff.lower as number).toBeCloseTo(-26 / 600, 9)
    // but the upper bound, −10/600 = −1.7 points, is below 0, so the packet arm is clearly better
    expect(r.diff.upper as number).toBeLessThan(0)
    expect(r.diff.upper as number).toBeCloseTo(-10 / 600, 9)
    expect(r).toMatchObject({ verdict: 'cut', because: 'packet-better' })
  })

  test('hintVerdict is the pre-registration\'s rule whole: the margin on the lower bound, and 0 on the upper', () => {
    const diff = (lower: number, upper: number, n = HINT_MIN_LEARNERS) => ({ n, mean: (lower + upper) / 2, lower, upper, ci95: [lower, upper] as [number, number] })
    expect(hintVerdict(diff(-0.04, 0.01))).toEqual({ verdict: 'keep', because: null })
    expect(hintVerdict(diff(-0.04, 0))).toEqual({ verdict: 'keep', because: null })
    expect(hintVerdict(diff(-0.044, -0.016))).toEqual({ verdict: 'cut', because: 'packet-better' })
    expect(hintVerdict(diff(-HINT_MARGIN, 0.02))).toEqual({ verdict: 'cut', because: 'margin' })
    expect(hintVerdict(diff(-0.2, -0.1))).toEqual({ verdict: 'cut', because: 'margin' })
    expect(hintVerdict(diff(-0.044, -0.016, HINT_MIN_LEARNERS - 1))).toEqual({ verdict: 'underpowered', because: null })
  })

  test('fewer learners than the pre-registration\'s power calculation is underpowered, at 125 and at 126', () => {
    const f = () => ({ armA: 'ladder', armB: 'packet', okA: true, okB: true })
    expect(selectHintArms(crew(HINT_MIN_LEARNERS - 1, f), CONTENT, options).verdict).toBe('underpowered')
    expect(selectHintArms(crew(HINT_MIN_LEARNERS, f), CONTENT, options).verdict).toBe('keep')
    expect(selectHintArms([], CONTENT, options)).toMatchObject({ learners: 0, verdict: 'underpowered', diff: { mean: null, lower: null } })
  })

  test('a check with both arms recorded is dropped, one helped without an arm is excluded, and neither is counted', () => {
    const both = new Journal()
    both.add('lab-check', 'lab:rust-allocator', d(0), { ok: true, provenance: 'unseen', data: { checks: [{ id: CHECK_A.id, status: 'pass' }] } })
    both.add('ack', `hint:rust-allocator/${CHECK_A.id}#R1`, d(0), { data: { arm: 'ladder' } })
    both.add('ack', `packet:lab/rust-allocator/${CHECK_A.id}`, d(0), { data: { arm: 'packet', via: 'copy' } })
    unseen(both, 'probe', 'gen:frag/v', d(30), true, { src: 'today', kcs: [CHECK_A.kc] })
    const noArm = new Journal()
    noArm.add('lab-check', 'lab:rust-allocator', d(0), { ok: true, provenance: 'unseen', data: { checks: [{ id: CHECK_A.id, status: 'pass' }] } })
    noArm.add('ack', `hint:rust-allocator/${CHECK_A.id}#R1`, d(0), { data: { arm: 'ladder' } })
    noArm.add('ack', `hint:rust-allocator/${CHECK_A.id}#R2`, d(0), {})
    unseen(noArm, 'probe', 'gen:frag/v', d(30), true, { src: 'today', kcs: [CHECK_A.kc] })
    const r = selectHintArms([{ events: both.events }, { events: noArm.events }], CONTENT, options)
    expect(r.both).toBe(1)
    expect(r.unarmed).toBe(1)
    expect(r.checks).toEqual({ ladder: 0, packet: 0 })
    expect(r.partners).toBe(0)
  })

  test('only a generated cold check 25 to 45 days after the lab\'s first all-green run counts, and an assisted one never does', () => {
    const at = (gap: number, extra: Partial<Parameters<typeof learner>[0]> = {}) => selectHintArms([learner({ armA: 'ladder', armB: 'packet', okA: true, okB: false, gap, ...extra })], CONTENT, options)
    // the packet check's probe is a day after the ladder check's
    expect(at(24).checks).toEqual({ ladder: 0, packet: 1 })
    expect(at(25).checks.ladder).toBe(1)
    expect(at(44).checks.ladder).toBe(1)
    expect(at(45)).toMatchObject({ checks: { ladder: 1, packet: 0 } })
    expect(at(46).checks).toEqual({ ladder: 0, packet: 0 })
    const j = new Journal()
    j.add('lab-check', 'lab:rust-allocator', d(0), { ok: true, provenance: 'unseen', data: { checks: [{ id: CHECK_A.id, status: 'pass' }] } })
    j.add('ack', `hint:rust-allocator/${CHECK_A.id}#R1`, d(0), { data: { arm: 'ladder' } })
    j.add('probe', 'gen:frag/v', d(30), { ok: true, score: 1, rev: 'r', provenance: 'assisted', data: { src: 'today', kcs: [CHECK_A.kc] } })
    j.add('probe', 'quiz:t1.l3#0', d(30), { ok: true, score: 1, rev: 'r', provenance: 'practice', data: { src: 'cold', kcs: [CHECK_A.kc] } })
    expect(selectHintArms([{ events: j.events }], CONTENT, options).checks).toEqual({ ladder: 0, packet: 0 })
  })

  test('the first cold check is the outcome, and a KC with no generator has none', () => {
    // the ladder check is missed first and right a day later; the packet check is right: d is 0 − 1, not 1 − 1
    const l = learner({ armA: 'ladder', armB: 'packet', okA: false, okB: true })
    const later = Journal.from(l.events)
    unseen(later, 'probe', 'gen:frag/first-fit', d(32), true, { src: 'today', reason: 'probe', kcs: [CHECK_A.kc] })
    const r = selectHintArms([{ events: later.events }], CONTENT, options)
    expect(r.checks).toEqual({ ladder: 1, packet: 1 })
    expect(r.diff.mean).toBe(-1)
    // the same learner against the real graph: neither check's KC has a generator family
    expect(selectHintArms([{ events: later.events }], CONTENT).checks).toEqual({ ladder: 0, packet: 0 })
  })

  test('the window follows the lab\'s first all-green run, not a check\'s own first pass, in a ledger with per-check detail', () => {
    // owner decision (docs/prereg/hint-ladders.md §3 and §7): the lab's first `lab-check` with `ok` anchors every ledger
    const helped = (j: Journal) => j.add('ack', `hint:rust-allocator/${CHECK_A.id}#R1`, d(0), { data: { arm: 'ladder' } })
    const probeAt = (j: Journal, day: number) => unseen(j, 'probe', 'gen:frag/first-fit', d(day), true, { src: 'today', reason: 'probe', kcs: [CHECK_A.kc] })
    const run = (j: Journal, day: number, ok: boolean, a: string) =>
      j.add('lab-check', 'lab:rust-allocator', d(day), { ok, provenance: 'unseen', data: { checks: [{ id: CHECK_A.id, status: a }, { id: CHECK_B.id, status: 'pass' }] } })
    // the lab went all-green on day 0 (`ok` is cumulative) while this run's detail had `align` failing; `align`'s own first
    // pass is day 10. A cold check on day 30 is 30 days after the lab and 20 after the check: the lab's run decides, so it counts
    const later = new Journal()
    run(later, 0, true, 'fail')
    helped(later)
    run(later, 10, true, 'pass')
    probeAt(later, 30)
    expect(selectHintArms([{ events: later.events }], CONTENT, options).checks).toEqual({ ladder: 1, packet: 0 })
    // and the mirror case: `align` passed in a red run on day 0 and the lab went all-green on day 20. A cold check on day 50
    // is 30 days after the lab and 50 after the check: it counts, and one on day 30, 10 days after the lab, does not
    const earlier = new Journal()
    run(earlier, 0, false, 'pass')
    helped(earlier)
    run(earlier, 20, true, 'pass')
    probeAt(earlier, 30)
    expect(selectHintArms([{ events: earlier.events }], CONTENT, options).checks).toEqual({ ladder: 0, packet: 0 })
    probeAt(earlier, 50)
    expect(selectHintArms([{ events: earlier.events }], CONTENT, options).checks).toEqual({ ladder: 1, packet: 0 })
    // a lab that never went all-green has no window at all, however many of its checks passed
    const red = new Journal()
    run(red, 0, false, 'pass')
    helped(red)
    probeAt(red, 30)
    expect(selectHintArms([{ events: red.events }], CONTENT, options).checks).toEqual({ ladder: 0, packet: 0 })
  })

  test('a donation, which keeps no per-check detail, reads the same as its export: both start at the lab\'s first all-green run', () => {
    const own = crew(4, (i) => ({ armA: 'ladder', armB: 'packet', okA: true, okB: i % 2 === 0 }))
    const donated = own.map((l) => ledgerOfDonation(redactForPartner({ events: l.events, working: [] })))
    const a = selectHintArms(own, CONTENT, options)
    const b = selectHintArms(donated, CONTENT, options)
    expect(b.checks).toEqual(a.checks)
    expect(b.diff.mean).toBe(a.diff.mean)
  })
})

describe('selectDailyVsOther', () => {
  const KV = 't5.kv-capacity'
  const ADMIT = 't2.admission-scheduling'
  const KV_LESSON = LESSONS.find((l) => l.kcs.includes(KV)) as (typeof LESSONS)[number]
  const ADMIT_LESSON = LESSONS.find((l) => l.kcs.includes(ADMIT)) as (typeof LESSONS)[number]

  /** A learner with both cards on day 0 and a Daily on `dailyDay` that trained `KV`; then `sig` answers on day 60. */
  const learner = (o: { daily?: number; kv: boolean; admit: boolean; provenance?: string; gap?: number; extra?: Record<string, unknown> }) => {
    const j = new Journal()
    j.passLesson(d(0), KV_LESSON.id, KV_LESSON.kcs)
    j.passLesson(d(0), ADMIT_LESSON.id, ADMIT_LESSON.kcs)
    const day = o.gap ?? 60
    if (o.daily !== undefined) j.add('incident', `inc:daily/${d(o.daily)}`, d(o.daily), { score: 1, ok: true, provenance: 'practice', data: { src: 'daily', fixed: true, diagnosed: true, kcs: ['t7.incident-diagnosis', KV] } })
    const sig = (kc: string, ok: boolean) => j.add('item', 'gen:sig/name-fault', d(day), { score: ok ? 1 : 0, ok, rev: 'r', provenance: o.provenance ?? 'unseen', data: { src: 'today', kcs: [kc], ...o.extra } })
    sig(KV, o.kv)
    sig(ADMIT, o.admit)
    return { events: j.events }
  }
  const crew = (n: number, f: (i: number) => Parameters<typeof learner>[0]) => partners(n, (i) => learner(f(i)))

  test('Daily KCs against the others, within learner: the groups, their n and the mean difference', () => {
    const r = selectDailyVsOther(crew(4, (i) => ({ daily: 1, kv: true, admit: i % 2 === 0 })), CONTENT)
    expect(r.daily).toMatchObject({ n: 4, correct: 4 })
    expect(r.other).toMatchObject({ n: 4, correct: 2 })
    expect(r.learners).toBe(4)
    expect(r.diff.mean).toBeCloseTo(0.5, 9)
    expect(r.verdict).toBe('underpowered')
  })

  test('the groups are as of the answer: a Daily played after it does not make the KC a Daily KC', () => {
    const r = selectDailyVsOther([learner({ daily: 90, kv: true, admit: true })], CONTENT)
    expect(r.daily.n).toBe(0)
    expect(r.other.n).toBe(2)
    expect(r.learners).toBe(0)
  })

  test('a learner who never played a Daily has only other checks, and is in no difference', () => {
    const r = selectDailyVsOther([learner({ kv: true, admit: false })], CONTENT)
    expect([r.daily.n, r.other.n, r.learners, r.partners]).toEqual([0, 2, 0, 1])
    expect(r.diff.mean).toBeNull()
  })

  test('only unseen, 30-day-old answers to sig items count, and the diagnosis skill is no contrast', () => {
    expect(selectDailyVsOther([learner({ daily: 1, kv: true, admit: true, provenance: 'practice' })], CONTENT).partners).toBe(0)
    expect(selectDailyVsOther([learner({ daily: 1, kv: true, admit: true, gap: 20 })], CONTENT).partners).toBe(0)
    // 30 days after the card: the card is created on day 0 at the earliest, so day 40 is far enough and day 5 is not
    expect(selectDailyVsOther([learner({ daily: 1, kv: true, admit: true, gap: 40 })], CONTENT).partners).toBe(1)
    const j = new Journal()
    j.passLesson(d(0), KV_LESSON.id, KV_LESSON.kcs)
    j.add('incident', `inc:daily/${d(1)}`, d(1), { data: { src: 'daily', kcs: ['t7.incident-diagnosis', KV] } })
    unseen(j, 'item', 'gen:kv/capacity', d(60), true, { src: 'today', kcs: [KV] })
    unseen(j, 'item', 'gen:sig/name-fault', d(60), true, { src: 'today', kcs: ['t7.incident-diagnosis'] })
    expect(selectDailyVsOther([{ events: j.events }], CONTENT)).toMatchObject({ partners: 0, daily: { n: 0 }, other: { n: 0 } })
  })

  test('197 learners are needed, and the one-sided bound against −5 points decides keep or kill', () => {
    const keep = selectDailyVsOther(crew(DAILY_MIN_LEARNERS, (i) => ({ daily: 1, kv: true, admit: i % 5 !== 0 })), CONTENT)
    expect(keep.learners).toBe(DAILY_MIN_LEARNERS)
    expect(keep.verdict).toBe('keep')
    expect(keep.diff.mean as number).toBeGreaterThan(0)
    const kill = selectDailyVsOther(crew(DAILY_MIN_LEARNERS, () => ({ daily: 1, kv: false, admit: true })), CONTENT)
    expect(kill.diff.mean).toBe(-1)
    expect(kill.verdict).toBe('kill')
    expect(selectDailyVsOther(crew(DAILY_MIN_LEARNERS - 1, () => ({ daily: 1, kv: true, admit: true })), CONTENT).verdict).toBe('underpowered')
  })

  test('a donation reads like its export', () => {
    const own = crew(6, (i) => ({ daily: 1, kv: i % 3 !== 0, admit: i % 2 === 0 }))
    const donated = own.map((l) => ledgerOfDonation(redactForPartner({ events: l.events, working: [] })))
    const a = selectDailyVsOther(own, CONTENT)
    const b = selectDailyVsOther(donated, CONTENT)
    expect([b.daily.n, b.daily.correct, b.other.n, b.other.correct]).toEqual([a.daily.n, a.daily.correct, a.other.n, a.other.correct])
  })
})

describe('selectProveV2 and selectProvedInUse', () => {
  const V2 = new Set(['kv-block-manager', 'mpmc-queue'])
  const green = (j: Journal, lab: string, day: number, provenance = 'unseen') => j.add('lab-check', `lab:${lab}`, d(day), { ok: true, score: 1, provenance, data: { passed: [] } })
  const attempt = (j: Journal, lab: string, day: number, o: { ok?: boolean; provenance?: string; v1?: boolean } = {}) =>
    j.add('prove', `prove:${lab}`, d(day), {
      ok: o.ok ?? true,
      score: o.ok === false ? 0 : 1,
      provenance: o.provenance ?? 'proved',
      data: o.v1 ? { v: 1, qids: ['a'], self: [1] } : { v: 2, qid: 'free-after', kcs: [], answer: 1, actual: 1, calls: 3 },
    })

  test('the share of unseen greens on v2 labs followed by a v2 attempt, and the share of first attempts proved', () => {
    const a = new Journal()
    green(a, 'kv-block-manager', 0)
    attempt(a, 'kv-block-manager', 1)
    attempt(a, 'kv-block-manager', 2, { ok: false, provenance: 'practice' }) // a retry: counted as an attempt, not as a first
    green(a, 'mpmc-queue', 3) // green, no attempt
    const b = new Journal()
    green(b, 'kv-block-manager', 0)
    attempt(b, 'kv-block-manager', 1, { ok: false, provenance: 'practice' })
    const r = selectProveV2([a.events, b.events], V2)
    expect(r.attempted).toMatchObject({ n: 3, correct: 2, partners: 2 })
    expect(r.attempted.rate).toBeCloseTo(2 / 3, 9)
    expect(r.attempted.ci95).not.toBeNull()
    expect(r.proved).toMatchObject({ n: 2, correct: 1 })
    expect(r.attempts).toBe(3)
  })

  test('a lab with no v2 bundle, a green on seen seeds, a v1 attempt and an attempt before the green count for nothing', () => {
    const j = new Journal()
    attempt(j, 'kv-block-manager', 0) // before the green
    green(j, 'kv-block-manager', 1)
    green(j, 'mpmc-queue', 1, 'lab-green') // not an unseen-seed green
    green(j, 'rust-allocator', 1) // no v2 bundle
    attempt(j, 'rust-allocator', 2)
    attempt(j, 'mpmc-queue', 2, { v1: true })
    const r = selectProveV2([j.events], V2)
    expect(r.attempted).toMatchObject({ n: 1, correct: 0 })
    expect(r.attempts).toBe(0)
    expect(r.proved).toMatchObject({ n: 0, rate: null })
  })

  test('a donation, which keeps qid and not v, still reads a v2 attempt', () => {
    const j = new Journal()
    green(j, 'kv-block-manager', 0)
    attempt(j, 'kv-block-manager', 1)
    const donated = ledgerOfDonation(redactForPartner({ events: j.events, working: [] }))
    expect(selectProveV2([donated.events], V2).proved).toMatchObject({ n: 1, correct: 1 })
  })

  test('F5 keeps Prove-it v2 only on the Wilson lower bound: a share of 0.70 at n = 10 is not kept, at n = 200 it is', () => {
    const at = (correct: number, n: number, partners = 5) => ({ n, correct, rate: correct / n, ci95: [wilson(correct, n).lo, wilson(correct, n).hi] as [number, number], partners })
    // 7 of 10: the share clears 60 % but the lower bound, 39.7 %, does not
    expect(at(7, 10).ci95[0]).toBeCloseTo(0.3968, 4)
    expect(proveV2Verdict(at(7, 10))).toBe('underpowered')
    // 140 of 200: the lower bound, 63.3 %, clears it
    expect(at(140, 200).ci95[0]).toBeCloseTo(0.6332, 4)
    expect(proveV2Verdict(at(140, 200))).toBe('keep')
    // a lower bound just under the bar is not kept (130 of 200: 58.2 %); five of five is not either (56.6 %)
    expect(proveV2Verdict(at(130, 200))).toBe('underpowered')
    expect(proveV2Verdict(at(5, 5))).toBe('underpowered')
    // below five partners nothing is kept, however many greens
    expect(proveV2Verdict(at(140, 200, 4))).toBe('underpowered')
    expect(proveV2Verdict({ n: 0, correct: 0, rate: null, ci95: null, partners: 0 })).toBe('underpowered')
    expect(PROVE_MIN_RATE).toBe(0.6)
  })

  test('the share of partners with at least one proved lab, and how many labs that is', () => {
    const a = new Journal()
    attempt(a, 'kv-block-manager', 1)
    attempt(a, 'mpmc-queue', 1)
    const b = new Journal()
    attempt(b, 'kv-block-manager', 1, { ok: false, provenance: 'practice' })
    const r = selectProvedInUse([a.events, b.events, []])
    expect(r).toMatchObject({ n: 2, correct: 1, labs: 2 })
    expect(r.rate).toBe(0.5)
  })
})

describe('selectDiscrimination30 and discriminationLures', () => {
  const [AT, BT, PK] = DISCRIMINATION_KCS
  const lessonOf = (kc: string) => LESSONS.find((l) => l.kcs.includes(kc)) as (typeof LESSONS)[number]
  const LURES = { [AT]: 2, [BT]: 2, [PK]: 2 }

  /**
   * A learner with the three cards on day 0 and `answers` on `day`, served on Today as Today serves a lesson's question
   * (`itemResponseOf` records the picked lure's id); `miss` is the ledger's `data.miss` for a miss.
   */
  const learner = (answers: { kc: string; ok: boolean; miss?: string; ref?: string }[], day = 60) => {
    const j = new Journal()
    for (const kc of DISCRIMINATION_KCS) j.passLesson(d(0), lessonOf(kc).id, lessonOf(kc).kcs)
    answers.forEach((a, i) => j.answer(d(day), a.kc, a.ok, { ref: a.ref ?? `quiz:${lessonOf(a.kc).id}#${i}`, extra: { src: 'today', ...(a.miss ? { miss: a.miss } : {}) } }))
    return { events: j.events }
  }
  /** Per learner: 1 right, 2 confusions (a lure naming one of the other two), 1 miss naming itself, 1 miss with a Wave 1 id. */
  const mixed = () =>
    learner([
      { kc: AT, ok: true },
      { kc: AT, ok: false, miss: `confuse.${BT}` },
      { kc: BT, ok: false, miss: `confuse.${AT}` },
      { kc: PK, ok: false, miss: `confuse.${PK}` },
      { kc: PK, ok: false, miss: 'kv.priced-fp16' },
    ])

  test('accuracy over the three KCs, and the confusion share: misses whose id names one of the other two KCs', () => {
    const r = selectDiscrimination30(partners(6, mixed), CONTENT, { lures: LURES })
    expect(r.accuracy).toMatchObject({ n: 30, correct: 6 })
    expect(r.partners).toBe(6)
    expect(r.misses).toBe(24)
    expect(r.confusion).toMatchObject({ n: 24, correct: 12 })
    expect(r.confusion.rate).toBe(0.5)
    expect(r.confusion.ci95).not.toBeNull()
    expect(r.confusionStatus).toBe('ok')
    expect(r.lures).toBe(6)
  })

  test('with no tagged lure in the content the share is "not enough data", never 0', () => {
    const r = selectDiscrimination30(partners(6, mixed), CONTENT)
    expect(r.confusionStatus).toBe('no-lures')
    expect(r.confusion.rate).toBeNull()
    expect(r.confusion.ci95).toBeNull()
    expect(r.misses).toBe(24)
    expect(selectDiscrimination30(partners(6, mixed), CONTENT, { lures: { [AT]: 0, [BT]: 0, [PK]: 0 } }).confusionStatus).toBe('no-lures')
    // accuracy is still read
    expect(r.accuracy.rate).toBeCloseTo(6 / 30, 9)
  })

  test('below the misses a share needs it is "not enough data" too', () => {
    const r = selectDiscrimination30([mixed()], CONTENT, { lures: LURES })
    expect(r.misses).toBe(4)
    expect(r.confusionStatus).toBe('few-misses')
    expect(r.confusion.rate).toBeNull()
  })

  test('a miss that names its own KC, a miss with another id and a lure outside the three are not confusions', () => {
    const l = learner([
      { kc: AT, ok: false, miss: `confuse.${AT}` },
      { kc: AT, ok: false, miss: 'confuse.t1.alignment' },
      { kc: AT, ok: false, miss: 'confuse.' },
      { kc: AT, ok: false },
      { kc: AT, ok: false, miss: `confuse.${PK}` },
    ])
    const r = selectDiscrimination30([l], CONTENT, { lures: LURES })
    expect(r.misses).toBe(5)
    expect(r.unattributed).toBe(0)
    expect(r.confusion.n).toBe(0)
    const ten = selectDiscrimination30([l, l], CONTENT, { lures: LURES })
    expect(ten.confusion).toMatchObject({ n: 10, correct: 2 })
  })

  test('only answers 30 or more days after the card was created, not assisted, count', () => {
    const early = learner([{ kc: AT, ok: false, miss: `confuse.${BT}` }], 10)
    expect(selectDiscrimination30([early], CONTENT, { lures: LURES }).accuracy.n).toBe(0)
    const j = Journal.from(learner([]).events)
    j.add('item', `quiz:t2.l2#9`, d(60), { score: 1, ok: true, rev: 'r', provenance: 'assisted', data: { src: 'quiz', kcs: [AT] } })
    j.add('item', `gen:frag/v`, d(60), { score: 1, ok: true, rev: 'r', provenance: 'unseen', data: { src: 'today', kcs: ['t1.external-frag'] } })
    expect(selectDiscrimination30([{ events: j.events }], CONTENT, { lures: LURES }).accuracy.n).toBe(0)
  })

  test('a donation reads like its export (the confuse ids survive it, the other ids do not)', () => {
    const own = partners(6, mixed)
    const donated = own.map((l) => ledgerOfDonation(redactForPartner({ events: l.events, working: [] })))
    const a = selectDiscrimination30(own, CONTENT, { lures: LURES })
    const b = selectDiscrimination30(donated, CONTENT, { lures: LURES })
    expect([b.accuracy.n, b.accuracy.correct, b.misses, b.confusion.correct]).toEqual([a.accuracy.n, a.accuracy.correct, a.misses, a.confusion.correct])
  })

  /**
   * Lesson QuizBlock retakes through the façade (`recordQuizAttempt`, G4). Since EF1 a miss carries the picked lure's id
   * and its place in the attempt (`slot` of `of`); before, it carried neither, which `beforeEf1` reproduces by taking them
   * off the façade's own event.
   */
  const quizRetake = (lessonId: string, qi: number, pick: number, day = 60) => {
    const q = ALL_LESSONS.find((l) => l.id === lessonId)!.blocks.flatMap((b) => (b.type === 'quiz' ? b.questions : []))[qi]
    const ok = q.correct.includes(pick)
    const miss = ok ? undefined : q.miss?.[pick] || undefined
    return written(day, (s) => s.recordQuizAttempt({ lessonId, seed: 1, ms: 20_000, responses: [{ qi, rev: 'r', pick: [pick], ok, kcs: q.kcs, ...(miss ? { miss } : {}) }] }))
  }
  const beforeEf1 = (events: LedgerEvent[]): LedgerEvent[] =>
    events.map((e) => {
      if (e.kind !== 'item') return e
      const data = { ...(e.data as Record<string, unknown>) }
      delete data.slot
      delete data.of
      delete data.miss
      return { ...e, data } as LedgerEvent
    })
  const withCards = async (retakes: Promise<LedgerEvent[]>[], before = false): Promise<{ events: LedgerEvent[] }> => {
    const events = (await Promise.all(retakes)).flat()
    return { events: [...learner([]).events, ...(before ? beforeEf1(events) : events)] }
  }
  const donate = (l: { events: LedgerEvent[] }) => ledgerOfDonation(redactForPartner({ events: l.events, working: [] }))

  test('a QuizBlock miss now records the picked lure\'s id and its place, so it reads as a confusion or as not one, own and donated', async () => {
    // t2.l2 q4 assesses address translation: lure 0 is confuse.t5.block-tables, lure 3 a Wave 1 id; t5.l5 q3's lure 2 names no slip
    const l = await withCards([quizRetake('t2.l2', 4, 0), quizRetake('t2.l2', 4, 3), quizRetake('t5.l5', 3, 2), quizRetake('t2.l2', 4, 2)])
    const items = l.events.filter((e) => e.kind === 'item' && (e.data as { src?: string }).src === 'quiz')
    expect(items.map((e) => [e.ref, (e.data as { miss?: string }).miss, (e.data as { slot?: number }).slot, (e.data as { of?: number }).of])).toEqual([
      ['quiz:t2.l2#4', 'confuse.t5.block-tables', 0, 1],
      ['quiz:t2.l2#4', 't2.translation-is-a-search', 0, 1],
      ['quiz:t5.l5#3', undefined, 0, 1],
      ['quiz:t2.l2#4', undefined, 0, 1],
    ])
    for (const ledger of [l, donate(l)]) {
      const r = selectDiscrimination30([ledger, ledger, ledger, ledger], CONTENT, { lures: LURES })
      expect(r.accuracy).toMatchObject({ n: 16, correct: 4 })
      // all twelve misses are read: four confusions, and eight on lures that are not one (one named, one with no slip)
      expect([r.misses, r.unattributed, r.confusion.n, r.confusion.correct]).toEqual([12, 0, 12, 4])
    }
  })

  test('a QuizBlock miss written before EF1 counts in the accuracy but is left out of the share, own and donated', async () => {
    const l = await withCards([quizRetake('t2.l2', 4, 0), quizRetake('t2.l2', 4, 3), quizRetake('t2.l2', 4, 2)], true)
    for (const ledger of [l, donate(l)]) {
      const r = selectDiscrimination30([ledger, ledger], CONTENT, { lures: LURES })
      expect(r.accuracy).toMatchObject({ n: 6, correct: 2 })
      expect([r.misses, r.unattributed, r.confusionStatus]).toEqual([0, 4, 'few-misses'])
    }
    // beside Today's misses, they no longer pull the share down: Today's two confusions of four stay a half
    const today = learner([
      { kc: AT, ok: false, miss: `confuse.${BT}` },
      { kc: BT, ok: false, miss: `confuse.${AT}` },
      { kc: PK, ok: false, miss: 'kv.priced-fp16' },
      { kc: PK, ok: false },
    ])
    const mixed = { events: [...today.events, ...l.events.filter((e) => e.kind === 'item' && (e.data as { src?: string }).src === 'quiz' && e.ref === 'quiz:t2.l2#4')] }
    const r = selectDiscrimination30(partners(3, () => mixed), CONTENT, { lures: LURES })
    expect([r.misses, r.unattributed, r.confusion.correct]).toEqual([12, 6, 6])
    expect(r.confusion.rate).toBe(0.5)
  })

  test('each of the three KCs has at least two confuse lures in the lesson content (3b-16, 3b-17)', () => {
    const lures = discriminationLures(ALL_LESSONS)
    for (const kc of DISCRIMINATION_KCS) expect(lures[kc]).toBeGreaterThanOrEqual(2)
    // the lures are on the lessons the spec names: t2.l2 and t2.l7, t5.l5 and t5.l6
    const lessons = ['t2.l2', 't2.l7', 't5.l5', 't5.l6']
    const only = discriminationLures(ALL_LESSONS.filter((l) => lessons.includes(l.id)))
    for (const kc of DISCRIMINATION_KCS) expect(only[kc]).toBeGreaterThanOrEqual(2)
  })

  test('discriminationLures counts a lure on the item of the KC that is taken for another, and only between the three', () => {
    const lesson = (questions: { kcs?: string[]; miss?: string[] }[]) => ({ blocks: [{ type: 'prose' }, { type: 'quiz', questions }] })
    const r = discriminationLures([
      lesson([
        { kcs: [AT], miss: [`confuse.${BT}`, '', `confuse.${PK}`] },
        { kcs: [AT, BT], miss: [`confuse.${AT}`] },
        { kcs: [AT], miss: [`confuse.${AT}`, 'confuse.t1.alignment', 'kv.priced-fp16'] },
        { kcs: ['t1.alignment'], miss: [`confuse.${AT}`] },
        {},
      ]),
    ])
    expect(r).toEqual({ [AT]: 2, [BT]: 1, [PK]: 0 })
    expect(discriminationLures([])).toEqual({ [AT]: 0, [BT]: 0, [PK]: 0 })
  })
})

describe('selectCubeError30', () => {
  const cube = (j: Journal, day: number) => j.add('play', 'play:tiling-cube', d(day), { ok: true, score: 1, provenance: 'practice', data: { phase: 'play' } })
  const answer = (j: Journal, ref: string, day: number, value: number, truth: number, o: { src?: string; provenance?: string } = {}) =>
    j.add('item', ref, d(day), { ok: true, score: 1, rev: 'r', provenance: o.provenance ?? 'unseen', data: { src: o.src ?? 'today', kcs: ['t4.tiling-intensity'], value, truth } })

  test('the median |log10(answer ÷ truth)| over answers 30 days or more after the first cube play', () => {
    const mine = (factor: number) => {
      const j = new Journal()
      cube(j, 0)
      cube(j, 5) // the first play is the one that counts
      answer(j, 'gen:tiling/raster-ai', 30, 100 * factor, 100)
      answer(j, 'gen:roofline/tile-ai', 31, 100 / factor, 100)
      answer(j, 'gen:tiling/ctas-per-sm', 40, 100, 100)
      return j.events
    }
    const r = selectCubeError30([mine(2), mine(2), mine(10)])
    expect(r.n).toBe(9)
    expect(r.partners).toBe(3)
    // errors: log10(2) x4, log10(10) x2, 0 x3: the median of nine is the fifth, log10(2)
    expect(r.median).toBeCloseTo(Math.log10(2), 9)
    expect(r.ci95).not.toBeNull()
  })

  test('answers before day 30, outside the cube\'s families, inside a play, on seen seeds or without a log are left out', () => {
    const j = new Journal()
    cube(j, 0)
    answer(j, 'gen:tiling/raster-ai', 29, 200, 100) // too soon
    answer(j, 'gen:roofline/decode-b1', 40, 200, 100) // another variant of another family
    answer(j, 'gen:tiling/raster-ai', 40, 200, 100, { src: 'play' })
    answer(j, 'gen:tiling/raster-ai', 40, 200, 100, { provenance: 'practice' })
    answer(j, 'gen:tiling/qblock-ai', 40, 200, 100) // byte units, which a donation cannot bring to the truth's
    answer(j, 'gen:tiling/raster-ai', 40, 0, 100)
    answer(j, 'gen:tiling/raster-ai', 40, 5, 0)
    j.add('item', 'gen:tiling/raster-ai', d(41), { ok: true, score: 1, rev: 'r', provenance: 'unseen', data: { src: 'today', kcs: ['t4.tiling-intensity'] } })
    expect(selectCubeError30([j.events])).toMatchObject({ n: 0, partners: 0, median: null, ci95: null })
  })

  test('a learner who never played the cube contributes nothing', () => {
    const j = new Journal()
    answer(j, 'gen:tiling/raster-ai', 40, 200, 100)
    expect(selectCubeError30([j.events]).n).toBe(0)
  })

  test('a donation reads like its export, and a field item is in neither', () => {
    const j = new Journal()
    cube(j, 0)
    answer(j, 'gen:tiling/raster-ai', 35, 130, 100)
    answer(j, 'gen:roofline/tile-ai', 36, 80, 100, { provenance: 'field' })
    const donated = ledgerOfDonation(redactForPartner({ events: j.events, working: [] }))
    expect(selectCubeError30([j.events]).n).toBe(1)
    expect(selectCubeError30([donated.events])).toMatchObject({ n: 1, partners: 1 })
    expect(selectCubeError30([donated.events]).median).toBeCloseTo(Math.log10(1.3), 9)
  })
})

describe('selectFormsGain', () => {
  /** A learner's forms on `track`: the right counts of A, B and C (a missing form is not taken), 12 slots each. */
  const forms = (track: string, right: Partial<Record<'A' | 'B' | 'C', number>>, o: { kcs?: string[]; slots?: number; recorded?: boolean } = {}) => {
    const j = new Journal()
    for (const id of ['A', 'B', 'C'] as const) {
      const k = right[id]
      if (k === undefined) continue
      for (let slot = 0; slot < (o.slots ?? 12); slot++) {
        const ok = slot < k
        j.add('item', `gen:kv/capacity`, d(slot), {
          ok,
          score: ok ? 1 : 0,
          rev: 'r',
          provenance: 'unseen',
          data: { src: 'form', formId: id, formSet: 0, formSlot: slot, ...(o.recorded === false ? {} : { track }), kcs: o.kcs ?? [`${track}.kv-capacity`] },
        })
      }
    }
    return j.events
  }

  test('B − A and C ÷ B per track, with bootstrap intervals over learners', () => {
    const r = selectFormsGain(partners(6, () => forms('t5', { A: 6, B: 9, C: 9 })))
    expect(r.tracks).toHaveLength(1)
    const t = r.tracks[0]
    expect(t.track).toBe('t5')
    expect(t.forms.A).toMatchObject({ n: 72, correct: 36 })
    expect(t.forms.B).toMatchObject({ n: 72, correct: 54 })
    expect(t.bMinusA.n).toBe(6)
    expect(t.bMinusA.mean).toBeCloseTo(0.25, 9)
    expect(t.bMinusA.ci95).toEqual([0.25, 0.25])
    expect(t.cOverB).toMatchObject({ n: 6, ratio: 1, ci95: [1, 1] })
    expect(t.status).toBe('pass')
    expect(r.partners).toBe(6)
  })

  test('the recorded track decides, an event without one falls back to the majority of its kcs, and a donation reads the same', () => {
    const own = [
      // recorded as T5's form although every kcs names t7 first: the track it was recorded with wins
      ...partners(5, () => forms('t5', { A: 6, B: 10, C: 6 }, { kcs: ['t7.incident-diagnosis', 't5.prefill-decode-interference'] })), // C ÷ B = 0.6
      // no track (the codec requires one, but a donation drops a track outside the graph's): t4 is the kcs' majority
      ...partners(5, () => forms('t4', { A: 6, B: 8, C: 8 }, { kcs: ['t4.tiling-intensity', 't4.occupancy', 't2.x'], recorded: false })),
    ]
    const donated = own.map((events) => ledgerOfDonation(redactForPartner({ events, working: [] })).events)
    for (const ledgers of [own, donated]) {
      const r = selectFormsGain(ledgers)
      expect(r.tracks.map((t) => t.track)).toEqual(['t4', 't5'])
      const t5 = r.tracks.find((t) => t.track === 't5')!
      expect(t5.cOverB.ratio).toBeCloseTo(0.6, 9)
      expect(t5.status).toBe('fail')
      expect(r.tracks.find((t) => t.track === 't4')!.status).toBe('pass')
    }
  })

  test('the interval decides: one that holds 0.8 is reported, not a pass or a fail; fewer than five learners is insufficient', () => {
    const mixed = partners(10, (i) => forms('t5', { A: 6, B: 10, C: i % 2 === 0 ? 12 : 4 }))
    const t = selectFormsGain(mixed).tracks[0]
    expect(t.cOverB.ratio).toBeCloseTo(0.8, 9)
    expect(t.cOverB.ci95![0]).toBeLessThan(0.8)
    expect(t.cOverB.ci95![1]).toBeGreaterThan(0.8)
    expect(t.status).toBe('reported')
    expect(selectFormsGain(partners(4, () => forms('t5', { A: 6, B: 9, C: 9 }))).tracks[0].status).toBe('insufficient')
  })

  test('only a complete form has an accuracy; a repeated slot counts once; an item with no track or slot is skipped', () => {
    const r = selectFormsGain([forms('t5', { A: 6, B: 9, C: 9 }, { slots: 11 })])
    expect(r.tracks).toEqual([])
    expect(r.partners).toBe(1)
    const twice = forms('t5', { A: 6, B: 9 })
    const again = Journal.from(twice)
    again.add('item', 'gen:kv/capacity', d(40), { ok: false, score: 0, rev: 'r', provenance: 'unseen', data: { src: 'form', formId: 'A', formSet: 0, formSlot: 0, track: 't5', kcs: ['t5.kv-capacity'] } })
    again.add('item', 'gen:kv/capacity', d(41), { ok: true, score: 1, rev: 'r', provenance: 'unseen', data: { src: 'form', formId: 'A', formSet: 0, formSlot: 3, kcs: [] } })
    expect(selectFormsGain([again.events]).tracks[0].forms.A).toMatchObject({ n: 12, correct: 6 })
    expect(selectFormsGain([]).tracks).toEqual([])
  })

  describe('on real forms: a slot counts under the track whose form it is (B2)', () => {
    let gens: ReadonlyMap<string, Gen>
    beforeAll(async () => {
      gens = new Map((await loadAllFamilies()).map((g) => [g.id, g] as const))
    })
    /** Right answers per form: a learner gets the first `right[id]` slots of form `id` right. */
    const RIGHT: Record<'t5' | 't7', Record<FormId, number>> = { t5: { A: 6, B: 9, C: 9 }, t7: { A: 3, B: 6, C: 12 } }

    /** One learner takes T5's forms A, B and C and then T7's, drawn by `formsFor` and written by the façade as /me writes them. */
    const learner = async (expSeed: number): Promise<LedgerEvent[]> => {
      const responses: ItemResponse[] = []
      for (const track of ['t5', 't7'] as const) {
        const forms = (await formsFor(track, { gens, kcs: KCS, expSeed }))!
        for (const id of ['A', 'B', 'C'] as const) {
          forms.forms[id].slots.forEach((slot, i) => {
            const item: PlayableItem = { source: 'gen', inst: slot.inst }
            const result = resultFor(item, correctResponse(slot.inst), gradeResponse(slot.inst, correctResponse(slot.inst)), { seed: slot.inst.seed, ms: 2000 })
            const r = formItemResponse(result, item, { track, formId: id, formSlot: i, formSet: forms.forms[id].set }, new Set())
            responses.push(i < RIGHT[track][id] ? r : { ...r, ok: false, score: 0 })
          })
        }
      }
      return written(0, (s) => s.recordItems(responses))
    }

    test('T5\'s sig slots carry a t7 majority of kcs, yet every T5 slot lands in T5 and T7\'s slots are untouched', async () => {
      const ledgers = await Promise.all([1, 2, 3, 4, 5].map((i) => learner(hash32(`forms-gain:${i}`))))
      // the case B2 found: 3 of each T5 form's 12 slots are sig items whose kcs name t7 first, which the kcs rule gave to T7
      for (const events of ledgers) {
        const t5 = events.filter((e) => (e as { data?: { track?: string } }).data?.track === 't5')
        expect(t5).toHaveLength(36)
        const sig = t5.filter((e) => e.ref.startsWith('gen:sig/'))
        expect(sig).toHaveLength(9)
        for (const e of sig) expect((e as { data: { kcs: string[] } }).data.kcs).toEqual(['t7.incident-diagnosis', 't5.prefill-decode-interference'])
      }
      for (const own of [ledgers, ledgers.map((events) => ledgerOfDonation(redactForPartner({ events, working: [] })).events)]) {
        const r = selectFormsGain(own)
        expect(r.tracks.map((t) => t.track)).toEqual(['t5', 't7'])
        for (const track of ['t5', 't7'] as const) {
          const t = r.tracks.find((x) => x.track === track)!
          // five learners, each form complete with its 12 slots and exactly its own right answers
          for (const id of ['A', 'B', 'C'] as const) expect(t.forms[id]).toMatchObject({ n: 60, correct: 5 * RIGHT[track][id] })
          expect(t.cOverB.n).toBe(5)
          expect(t.cOverB.ratio).toBeCloseTo(RIGHT[track].C / RIGHT[track].B, 9)
        }
      }
    })
  })

  test('B − A has no interval without a learner with both forms, and C ÷ B none without B', () => {
    const r = selectFormsGain(partners(5, () => forms('t5', { C: 9 })))
    expect(r.tracks[0].bMinusA).toMatchObject({ n: 0, mean: null, ci95: null })
    expect(r.tracks[0].cOverB).toMatchObject({ n: 0, ratio: null })
  })
})

describe('selectVrk30Spread', () => {
  const lesson = LESSONS.find((l) => l.kcs.length >= 5) as (typeof LESSONS)[number]

  /** A learner whose card for each of the lesson's KCs is 30+ days old; the first `right` KCs are answered right on a fresh seed on day 60, and the next one wrong. */
  const learner = (right: number) => {
    const j = new Journal()
    j.passLesson(d(0), lesson.id, lesson.kcs)
    lesson.kcs.forEach((kc, i) => unseen(j, 'item', `gen:frag/v${i}`, d(60), i < right, { src: 'today', kcs: [kc] }))
    return { events: j.events }
  }

  test('retained KCs per partner: the spread, the checked share and n', () => {
    const r = selectVrk30Spread([0, 1, 2, 3, 5].map(learner), CONTENT)
    expect(r.partners).toBe(5)
    expect(r.checked).toBe(5)
    expect(r.retained).toEqual({ min: 0, q1: 1, median: 2, q3: 3, max: 5 })
    expect(r.share?.median).toBeCloseTo(2 / 5, 9)
  })

  test('the median carries a seeded 95 % bootstrap interval over partners, the same on every run', () => {
    const ledgers = [0, 1, 2, 3, 5].map(learner)
    const r = selectVrk30Spread(ledgers, CONTENT)
    // the median of a resample of five is one of the five values, so the bounds are partners' own counts around the median 2
    const [lo, hi] = r.medianCi95.retained!
    expect([0, 1, 2, 3, 5]).toContain(lo)
    expect([0, 1, 2, 3, 5]).toContain(hi)
    expect(lo).toBeLessThanOrEqual(2)
    expect(hi).toBeGreaterThanOrEqual(2)
    expect(lo).toBeLessThan(hi)
    const draws = bootstrapDraws([0, 1, 2, 3, 5], (xs) => percentile([...xs].sort((a, b) => a - b), 0.5), hash32('vrk30:retained'))
    expect(r.medianCi95.retained).toEqual([percentile(draws, 0.025)!, percentile(draws, 0.975)!])
    expect(selectVrk30Spread(ledgers, CONTENT).medianCi95).toEqual(r.medianCi95)
    expect(r.medianCi95.share).not.toBeNull()
    // the report prints it beside the spread
    const f9 = buildWave3Report(ledgers, { cards: CONTENT }).gates.find((g) => g.id === 'F9')!
    expect(f9.detail).toContain(`retained KCs 0 / 2 / 5 (min / median / max), the median's 95 % bootstrap interval ${lo} to ${hi}`)
    expect(f9.detail).toContain('a reading, never a pass')
  })

  test('a partner with no checked KC is in n and has 0 retained; an empty ledger is no partner', () => {
    const r = selectVrk30Spread([learner(2), { events: [] }, { events: new Journal().events }], CONTENT)
    expect(r.partners).toBe(1)
    expect(selectVrk30Spread([], CONTENT)).toMatchObject({ partners: 0, checked: 0, retained: null, perMonth: null, share: null, medianCi95: { retained: null, perMonth: null, share: null } })
    const none = new Journal()
    none.add('visit', 'lesson:t1.l1', d(0))
    expect(selectVrk30Spread([{ events: none.events }], CONTENT)).toMatchObject({ partners: 1, checked: 0, retained: { median: 0 }, share: null })
  })

  test('a donation reads like its export', () => {
    const own = [0, 1, 2, 3, 5].map(learner)
    const donated = own.map((l) => ledgerOfDonation(redactForPartner({ events: l.events, working: [] })))
    const a = selectVrk30Spread(own, CONTENT)
    const b = selectVrk30Spread(donated, CONTENT)
    expect(b.retained).toEqual(a.retained)
    expect(b.checked).toBe(a.checked)
  })
})

describe('selectReceiptStats', () => {
  const act = (j: Journal, act: string, day: number, data: Record<string, unknown>) => j.add('fleet-act', `fw:${act}`, d(day), { score: 1, ok: true, provenance: 'unseen', data })
  const rubric = (capacity: number, slo: number, cost: number, failure: number) => ({ capacity, slo, cost, failure })

  test('receipts cited and verified per act, uncited figures and the rubric distribution; the latest event on an act counts', () => {
    const a = new Journal()
    act(a, 'engine', 0, { receipts: { cited: 9, verified: 1, uncited: 9 }, rubric: rubric(0, 0, 0, 0) }) // replaced by the next
    act(a, 'engine', 1, { receipts: { cited: 4, verified: 3, uncited: 1 }, rubric: rubric(3, 2, 1, 0) })
    act(a, 'business', 2, { receipts: { cited: 5, verified: 5, uncited: 0 }, rubric: rubric(3, 3, 3, 3) })
    const b = new Journal()
    act(b, 'engine', 0, { receipts: { cited: 2, verified: 0, uncited: 4 } })
    act(b, 'fleet', 1, { rubric: rubric(1, 1, 1, 1) })
    const r = selectReceiptStats([a.events, b.events, []])
    expect(r.partners).toBe(2)
    expect(r.acts.engine).toEqual({ acts: 2, cited: 6, verified: 3, uncited: 5 })
    expect(r.acts.business).toEqual({ acts: 1, cited: 5, verified: 5, uncited: 0 })
    expect(r.acts.fleet).toEqual({ acts: 0, cited: 0, verified: 0, uncited: 0 })
    expect(r.verified).toMatchObject({ n: 11, correct: 8 })
    expect(r.rubricActs).toBe(3)
    expect(r.rubric.capacity).toEqual([0, 1, 0, 2])
    expect(r.rubric.failure).toEqual([1, 1, 0, 1])
  })

  test('a malformed receipt or rubric is not read, and an act with neither counts nothing', () => {
    const j = new Journal()
    act(j, 'engine', 0, { receipts: { cited: -1, verified: 0, uncited: 0 }, rubric: rubric(4, 0, 0, 0) })
    act(j, 'fleet', 0, { receipts: { cited: 1.5, verified: 0, uncited: 0 } })
    act(j, 'business', 0, {})
    j.add('fleet-act', 'fw:other', d(0), { data: { receipts: { cited: 1, verified: 1, uncited: 0 } } })
    expect(selectReceiptStats([j.events])).toMatchObject({ partners: 0, rubricActs: 0, verified: { n: 0, rate: null } })
  })

  test('a donation reads like its export', () => {
    const j = new Journal()
    act(j, 'business', 0, { receipts: { cited: 5, verified: 4, uncited: 2 }, rubric: rubric(3, 2, 1, 0), runs: ['abcd1234'] })
    const donated = ledgerOfDonation(redactForPartner({ events: j.events, working: [] }))
    expect(selectReceiptStats([donated.events])).toEqual(selectReceiptStats([j.events]))
  })
})

describe('buildWave3Report and formatWave3Report', () => {
  const IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']
  const status = (r: ReturnType<typeof buildWave3Report>, id: string) => r.gates.find((g) => g.id === id)?.status

  test('with nothing, F1 to F12 are listed, every measured gate says there is not enough data, and none passes', () => {
    const r = buildWave3Report([], { cards: CONTENT })
    expect(r.gates.map((g) => g.id)).toEqual(IDS)
    expect(IDS.filter((id) => status(r, id) === 'insufficient')).toEqual(['F1', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'])
    expect(IDS.filter((id) => status(r, id) === 'owner')).toEqual(['F2', 'F3', 'F4', 'F11', 'F12'])
    const text = formatWave3Report(r)
    expect(text).not.toContain('PASS')
    expect(text).toContain('not enough data (n = 0')
    expect(text).toContain('Wave 3 field gates over 0 exports')
    expect(text).toContain('F6  P3: 30-day discrimination')
    expect(text).toContain('the lesson content holds no tagged lure')
    expect(text).toContain('the journey re-cut (F1)')
    expect(text).toContain('not enough data (n = 0 partners with recorded time; needs 5)')
    expect(text).toContain('Fleet Week receipts: not enough data (n = 0 acts with receipts)')
  })

  test('F2 and F3 are not read while their pre-registrations are unsigned, and say so', () => {
    const r = buildWave3Report([], { cards: CONTENT })
    expect(r.hint).toBeNull()
    expect(r.daily).toBeNull()
    expect(r.gates.find((g) => g.id === 'F2')?.detail).toContain('docs/prereg/hint-ladders.md is not signed')
    expect(r.gates.find((g) => g.id === 'F3')?.detail).toContain('docs/prereg/fleet-daily.md is not signed')
    expect(r.keepOrKill.map((k) => [k.id, k.verdict])).toEqual([['F2', 'unsigned'], ['F3', 'unsigned'], ['F5', 'underpowered']])
    const text = formatWave3Report(r)
    expect(text).toContain('hint ladders: NOT READ, the pre-registration is unsigned; default: R0 to R2 only')
    expect(text).toContain('Fleet Daily: NOT READ, the pre-registration is unsigned; default: weekly, no On-Call')
    expect(text).toContain('Prove-it v2: UNDERPOWERED, default: 1 question')
  })

  test('once signed they are read, and below their minimum they print "not enough data" with the minimum', () => {
    const r = buildWave3Report([], { cards: CONTENT, signed: { hintLadders: true, fleetDaily: true } })
    expect(r.hint?.verdict).toBe('underpowered')
    expect(r.daily?.verdict).toBe('underpowered')
    expect(status(r, 'F2')).toBe('insufficient')
    expect(status(r, 'F3')).toBe('insufficient')
    const text = formatWave3Report(r)
    expect(text).toContain(`not enough data (n = 0 of ${HINT_MIN_LEARNERS} learners`)
    expect(text).toContain(`not enough data (n = 0 of ${DAILY_MIN_LEARNERS} learners`)
    expect(text).toContain('hint ladders: UNDERPOWERED, default: R0 to R2 only')
  })

  test('F4 follows §14: unsigned or unrated is not decided, and a report decides it', () => {
    for (const watcher of ['unsigned', 'unrated'] as const) {
      const g = buildWave3Report([], { cards: CONTENT, watcher }).gates.find((x) => x.id === 'F4')!
      expect(g.status).toBe('owner')
      expect(g.detail).toContain('not decided')
      expect(g.detail).toContain('the manual scan stays')
    }
    expect(status(buildWave3Report([], { cards: CONTENT, watcher: 'keep' }), 'F4')).toBe('pass')
    expect(status(buildWave3Report([], { cards: CONTENT, watcher: 'drop' }), 'F4')).toBe('fail')
    expect(status(buildWave3Report([], { cards: CONTENT, watcher: 'underpowered' }), 'F4')).toBe('insufficient')
    expect(buildWave3Report([], { cards: CONTENT, watcher: 'underpowered' }).gates.find((x) => x.id === 'F4')!.detail).toContain('second 8-week window')
  })

  test('the owner gates F11 and F12 are listed and never decided', () => {
    const r = buildWave3Report([], { cards: CONTENT })
    for (const id of ['F11', 'F12']) expect(status(r, id)).toBe('owner')
    expect(formatWave3Report(r)).toContain('F12  accessibility: VoiceOver and NVDA passes')
  })

  /** A partner who has a bit of everything the gates read; the lesson quiz is the façade's own events. */
  const partner = async (i: number) => {
    const j = new Journal()
    j.passLesson(d(0), 't1.l3', ['t1.split-coalesce'])
    graded(j, 'item', 'gen:frag/a', d(1), { ms: 60_000, data: { src: 'today', grp: 'g', slot: 0, of: 1, kcs: [FRAG_KC] } })
    j.add('lab-check', 'lab:kv-block-manager', d(3), { ok: true, score: 1, provenance: 'unseen', data: { passed: [] } })
    j.add('prove', 'prove:kv-block-manager', d(4), { ok: true, score: 1, provenance: 'proved', data: { v: 2, qid: 'free-after', kcs: [], answer: 1, actual: 1, calls: 2 } })
    j.add('fleet-act', 'fw:engine', d(5), { score: 1, ok: true, provenance: 'unseen', data: { receipts: { cited: 3, verified: 3, uncited: 0 }, rubric: { capacity: 2, slo: 2, cost: 2, failure: 2 } } })
    return { events: [...j.events, ...(await quizBlock(2, 60_000 * (i + 1), ['t1.split-coalesce']))] }
  }
  const crew = (n: number) => Promise.all(partners(n, partner))

  test('five partners: F1 is reported with the journey table, F5 is read but 5 of 5 is not kept, F10 is reported, the rest stay short', async () => {
    const r = buildWave3Report(await crew(5), { cards: CONTENT, v2Labs: new Set(['kv-block-manager']) })
    expect(status(r, 'F1')).toBe('reported')
    // 5 of 5 attempted, but the Wilson lower bound, 56.6 %, is under 60 %: the underpowered default, 1 question
    expect(status(r, 'F5')).toBe('fail')
    expect(status(r, 'F10')).toBe('reported')
    expect(status(r, 'F7')).toBe('insufficient')
    expect(r.keepOrKill.find((k) => k.id === 'F5')?.verdict).toBe('underpowered')
    const text = formatWave3Report(r)
    expect(text).toContain('F5  Prove-it v2 keep-or-kill → NOT MET')
    expect(text).toContain('5 of 5 unseen-seed greens followed by a v2 attempt = 100.0 %, Wilson 95 % interval 56.6 % to 100.0 %; kept only if the lower bound is at least 60 %: not kept')
    expect(text).toContain('Prove-it v2: UNDERPOWERED, default: 1 question')
    expect(text).toContain('95 % interval')
    expect(text).toContain('5 of 5 partners = 100.0 %')
    expect(text).toContain('F1  the journey re-cut: minutes per surface per week → REPORTED')
    expect(text).toContain('against PLAN §4.D\'s about 240')
    expect(text).toContain('  weeks 1 ')
    expect(text).toContain('planned: Boot → Today; R.L1 ⇄ T0.L1 [today, lessons]')
    expect(text).toContain('Fleet Week receipts (5 partners): engine 15 of 15 verified, 0 uncited (5 acts)')
    expect(text).toContain('over 5 acts: capacity 0 / 0 / 5 / 0')
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  /** `partnerCount` partners, each green on an unseen seed on every one of `labs` v2 labs; the first `attempted` greens, in partner order, get a v2 attempt. */
  const proveCrew = (partnerCount: number, labs: number, attempted: number) => {
    const ids = Array.from({ length: labs }, (_, k) => `v2-lab-${k}`)
    let left = attempted
    const ledgers = partners(partnerCount, () => {
      const j = new Journal()
      ids.forEach((lab, k) => {
        j.add('lab-check', `lab:${lab}`, d(k), { ok: true, score: 1, provenance: 'unseen', data: { passed: [] } })
        if (left-- > 0) j.add('prove', `prove:${lab}`, d(k + 1), { ok: true, score: 1, provenance: 'proved', data: { v: 2, qid: 'free-after', kcs: [], answer: 1, actual: 1, calls: 2 } })
      })
      return { events: j.events }
    })
    return { ledgers, inputs: { cards: CONTENT, v2Labs: new Set(ids) } }
  }

  test('F5 on its Wilson lower bound: 7 of 10 greens attempted is the underpowered default, 140 of 200 is kept, and both print n, the share and both bounds', () => {
    const small = proveCrew(5, 2, 7)
    const r10 = buildWave3Report(small.ledgers, small.inputs)
    expect(r10.proveV2.attempted).toMatchObject({ n: 10, correct: 7, partners: 5 })
    expect(status(r10, 'F5')).toBe('fail')
    expect(r10.keepOrKill.find((k) => k.id === 'F5')).toMatchObject({ verdict: 'underpowered', fallback: '1 question' })
    const t10 = formatWave3Report(r10)
    expect(t10).toContain('F5  Prove-it v2 keep-or-kill → NOT MET')
    expect(t10).toContain('n = 10, 5 partners: 7 of 10 unseen-seed greens followed by a v2 attempt = 70.0 %, Wilson 95 % interval 39.7 % to 89.2 %; kept only if the lower bound is at least 60 %: not kept, so the underpowered default, 1 question (PLAN §9)')
    expect(t10).toContain('Prove-it v2: UNDERPOWERED, default: 1 question')
    expect(t10).not.toContain('Prove-it v2: KILL')

    const large = proveCrew(20, 10, 140)
    const r200 = buildWave3Report(large.ledgers, large.inputs)
    expect(r200.proveV2.attempted).toMatchObject({ n: 200, correct: 140, partners: 20 })
    expect(status(r200, 'F5')).toBe('pass')
    expect(r200.keepOrKill.find((k) => k.id === 'F5')?.verdict).toBe('keep')
    const t200 = formatWave3Report(r200)
    expect(t200).toContain('F5  Prove-it v2 keep-or-kill → PASS')
    expect(t200).toContain('n = 200, 20 partners: 140 of 200 unseen-seed greens followed by a v2 attempt = 70.0 %, Wilson 95 % interval 63.3 % to 75.9 %; kept only if the lower bound is at least 60 %: kept;')
    expect(t200).toContain('Prove-it v2: KEEP')
  })

  test('F5 below five partners still prints n, the share and both bounds beside "not enough data"', () => {
    const few = proveCrew(4, 2, 6)
    const r = buildWave3Report(few.ledgers, few.inputs)
    expect(status(r, 'F5')).toBe('insufficient')
    expect(r.keepOrKill.find((k) => k.id === 'F5')?.verdict).toBe('underpowered')
    expect(formatWave3Report(r)).toContain('not enough data (n = 8, 4 partners; needs 5 partners); 6 of 8 unseen-seed greens followed by a v2 attempt = 75.0 %, Wilson 95 % interval')
  })

  test('the journey footnote says what the minutes are since EF1, and that overlapping work on /week counts twice', () => {
    const text = formatWave3Report(buildWave3Report([], { cards: CONTENT }))
    for (const line of SURFACE_FOOTNOTE) expect(text).toContain(line)
    const note = SURFACE_FOOTNOTE.map((l) => l.trim()).join(' ')
    expect(note).not.toContain('recorded answer and run times')
    expect(note).toContain('Daily and Act IV drills from the alert to the debrief')
    expect(note).toContain('a Fleet Week act the page\'s visible time up to its pass')
    expect(note).toContain('only while the page is visible, capped per event')
    expect(note).toContain('Overlapping work on /week counts twice (an Act I or II run started during a drill is in both)')
    expect(note).toContain('A donation rounds each to a second')
    // the footnote sits under the journey table, before the receipts
    expect(text.indexOf(SURFACE_FOOTNOTE[0])).toBeGreaterThan(text.indexOf('the journey re-cut (F1)'))
    expect(text.indexOf(SURFACE_FOOTNOTE[0])).toBeLessThan(text.indexOf('Fleet Week receipts'))
  })

  test('under five partners no gate is read as a pass', async () => {
    const r = buildWave3Report(await crew(4), { cards: CONTENT, v2Labs: new Set(['kv-block-manager']) })
    for (const id of ['F1', 'F5', 'F9', 'F10']) expect(status(r, id)).toBe('insufficient')
    expect(formatWave3Report(r)).not.toContain('PASS')
  })

  test('the report is deterministic, and the JSON of it carries every gate', async () => {
    const ledgers = await crew(5)
    const a = JSON.stringify(buildWave3Report(ledgers, { cards: CONTENT, v2Labs: new Set(['kv-block-manager']) }))
    expect(JSON.stringify(buildWave3Report(ledgers, { cards: CONTENT, v2Labs: new Set(['kv-block-manager']) }))).toBe(a)
    expect(JSON.parse(a).gates).toHaveLength(12)
  })

  test('a donation gives the same table as the export it came from, for the gates both can compute', async () => {
    const own = await crew(5)
    const donated = own.map((l) => ledgerOfDonation(redactForPartner({ events: l.events, working: [] })))
    const inputs = { cards: CONTENT, v2Labs: new Set(['kv-block-manager']) }
    const a = buildWave3Report(own, inputs)
    const b = buildWave3Report(donated, inputs)
    const line = (r: ReturnType<typeof buildWave3Report>, id: string) => formatWave3Report(r).split('\n').find((l) => l.startsWith(`${id}  `))
    for (const id of ['F5', 'F6', 'F7', 'F8', 'F10', 'F11', 'F12']) expect(line(b, id)).toBe(line(a, id))
    expect(b.receipts).toEqual(a.receipts)
  })
})

describe('scripts/partner-report.ts: the Wave 3 field gates', () => {
  const script = path.resolve(import.meta.dir, '../../scripts/partner-report.ts')
  const run = (...args: string[]) => spawnSync('bun', [script, ...args], { encoding: 'utf8' })

  /** A partner who boots, gets lab 02 green on an unseen seed and makes a Prove-it v2 attempt, and spends a little time on a lesson quiz (the façade's own events). */
  const partnerEvents = async (i: number): Promise<LedgerEvent[]> => {
    const j = new Journal()
    j.add('complete', 'boot', d(0))
    j.add('lab-check', 'lab:kv-block-manager', d(2), { ok: true, score: 1, provenance: 'unseen', data: { passed: [] } })
    j.add('prove', 'prove:kv-block-manager', d(3), { ok: true, score: 1, provenance: 'proved', wasmSha256: 'a'.repeat(64), data: { v: 2, qid: 'free-after', kcs: [], answer: 1, actual: 1, calls: 2 } })
    return [...j.events, ...(await quizBlock(1, 60_000 * (i + 1), ['t1.split-coalesce']))]
  }
  const donationFile = (dir: string, name: string, events: LedgerEvent[]): string => {
    const p = path.join(dir, name)
    writeFileSync(p, JSON.stringify(redactForPartner({ events, working: [] })))
    return p
  }

  test('prints F1 to F12 from five donations, with the journey table, and reads no unsigned pre-registration', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'partner-report-w3-'))
    try {
      const files = await Promise.all([0, 1, 2, 3, 4].map(async (i) => donationFile(dir, `donation-${i}.json`, await partnerEvents(i))))
      const r = run(...files)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('Wave 3 field gates over 5 exports')
      for (let n = 1; n <= 12; n++) expect(r.stdout).toContain(`F${n}  `)
      expect(r.stdout).toContain('F1  the journey re-cut: minutes per surface per week → REPORTED')
      expect(r.stdout).toContain('the journey re-cut (F1): active minutes per week')
      expect(r.stdout).toContain('planned: Boot → Today; R.L1 ⇄ T0.L1')
      // lab 02 ships a Prove-it v2 bundle, so the script finds it among the labs and F5 reads the five attempts; 5 of 5 has
      // a Wilson lower bound of 56.6 %, under the 60 % bar, so Prove-it v2 takes the underpowered default
      expect(r.stdout).toContain('F5  Prove-it v2 keep-or-kill → NOT MET')
      expect(r.stdout).toContain('5 of 5 unseen-seed greens followed by a v2 attempt = 100.0 %, Wilson 95 % interval 56.6 % to 100.0 %')
      expect(r.stdout).toContain('Prove-it v2: UNDERPOWERED, default: 1 question')
      expect(r.stdout).toContain('F4  the watcher')
      expect(r.stdout).toContain('the manual scan stays')
      expect(r.stdout).toContain('5 of 5 files are redacted donations')
      expect(r.stdout).not.toMatch(/\d{4}-\d{2}-\d{2}/)
      expect(r.stdout + r.stderr).not.toContain('donation-0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('--json carries the twelve gates, and --wave1 with --wave2 is a usage error', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'partner-report-w3-'))
    try {
      const file = donationFile(dir, 'a.json', await partnerEvents(0))
      const j = run('--json', file)
      expect(j.status).toBe(0)
      const report = JSON.parse(j.stdout)
      expect(report.gates.map((g: { id: string }) => g.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'])
      expect(report.gates.find((g: { id: string }) => g.id === 'F1').status).toBe('insufficient')
      const both = run('--wave1', '--wave2', file)
      expect(both.status).toBe(2)
      expect(both.stderr).toContain('usage')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('mixes a full export and a donation, and says what a donation cannot carry', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'partner-report-w3-'))
    try {
      const full = path.join(dir, 'export.json')
      writeFileSync(full, serializeExport(buildExportV3({ events: await partnerEvents(0), working: [], device: 'dev-w3', exportedAt: '2026-10-07T12:00:00.000Z' })))
      const r = run(full, donationFile(dir, 'don.json', await partnerEvents(1)))
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('over 2 exports')
      expect(r.stdout).toContain('1 of 2 files is a redacted donation')
      expect(r.stdout).toContain("F2 reads every ledger from the lab's first all-green run, so a donation and its export agree there")
      expect(r.stdout).not.toContain('per-check')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
