/**
 * The Fleet exercise panel (docs/specs/wave-3.md §5.3, task 3b-20): the pure session (the round's transitions, the
 * fair-seed draw, the events and their restoring, the copy and the In-production rows) and the panel mounted in a small
 * DOM (tests/dom/mini-dom.ts) against the real sweeps, with the worker, the ledger and the clock injected. The mounted
 * tests assert on the DOM, focus, `aria-live` regions and the events written, never on source text. What a browser
 * alone answers (axe, reflow at 360 and 320 px, the real worker) is the a11y harness's and Playwright's, run for the
 * routes that carry a fleet block in 3c-06.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import FleetExercise, { type FleetExerciseEnv, type FleetExerciseProps } from '../../src/components/fleet-ex/FleetExercise'
import {
  IDEA_COUNT,
  MAX_DRAWS,
  NoFairSeed,
  PASSES_NEEDED,
  PREDICT_NSEC,
  PRODUCTION_ROWS,
  ROUND_NSEC,
  canSave,
  copyFor,
  drawFairSweep,
  exerciseEventOf,
  exerciseGrp,
  exerciseRef,
  exerciseRev,
  freshRound,
  itemEvent,
  parsePrediction,
  pinnedReleases,
  predictEvent,
  progressText,
  readExercise,
  reduceRound,
  sweepTable,
  verdictText,
  type ExerciseEvent,
  type Round,
} from '../../src/components/fleet-ex/session'
import { byId, getClaim } from '../../src/data/claims'
import '../../src/data/claims/lazy/serving3'
import type { FleetExerciseBlock } from '../../src/data/lessons/types'
import { validateEvent } from '../../src/lib/ledger/codec'
import type { ItemResponse, LedgerEvent } from '../../src/lib/ledger/types'
import { blockGrp } from '../../src/lib/learner/item-block'
import { formatNumber } from '../../src/lib/sims/host'
import { PRE_NSEC } from '../../src/lib/learner/prequestions'
import { FLEET_EXERCISES, type FleetExerciseDef, type SweepResult } from '../../src/lib/world/fleet-ex'
import { installDom, MiniEvent, type DomKit, type MiniElement, type Mounted } from '../dom/mini-dom'

const knee = FLEET_EXERCISES.knee
const pd = FLEET_EXERCISES['pd-split']
const LESSON = 't7.l2'
const BLOCK = 4
const CTX = { lessonId: LESSON, index: BLOCK }
const AT = { id: 'knee', lessonId: LESSON, index: BLOCK, needs: PASSES_NEEDED }

const sweeps = new Map<string, SweepResult>()
/** The exercise's sweep on a seed, computed once per test file (a P:D sweep takes about 0.1 s). */
function sweepOf(def: FleetExerciseDef, seed: number): SweepResult {
  const key = `${def.id}:${seed}`
  let r = sweeps.get(key)
  if (r === undefined) sweeps.set(key, (r = def.sweep(seed)))
  return r
}

/** The first `n` seeds from `from` whose sweep is (or, with `inBand` false, is not) a fair question. */
function seedsWhere(def: FleetExerciseDef, n: number, inBand: boolean, from = 100): number[] {
  const out: number[] = []
  for (let s = from; out.length < n; s++) if (def.band(sweepOf(def, s)) === inBand) out.push(s)
  return out
}

/** A point of the sweep that is not the answer. */
const wrongOn = (def: FleetExerciseDef, seed: number): number => def.points.find((p) => p !== def.truth(sweepOf(def, seed)))!

const LINE = 'goodput falls because the queue grows and late requests miss the SLO'
const T0 = Date.UTC(2026, 9, 14, 9, 0, 0)

/** What the façade stamps around an `ItemResponse`, so the codec can judge it. */
function stamp(r: ItemResponse, n: number): LedgerEvent {
  const at = new Date(T0 + n * 1000).toISOString()
  return { id: `e${n}`, v: 1, at, tz: 0, day: at.slice(0, 10), dev: 'd', ...r } as unknown as LedgerEvent
}

/** A round driven through the reducer to its saved state: the prediction on the seed, the line, the ticks. */
function savedRound(def: FleetExerciseDef, seed: number, prediction: number, conf?: 'guess' | 'think' | 'sure'): Round {
  let r = freshRound(T0)
  r = reduceRound(def, r, { type: 'commit', prediction, conf, at: T0 + 4000 })
  r = reduceRound(def, r, { type: 'swept', seed, result: sweepOf(def, seed) })
  r = reduceRound(def, r, { type: 'explain', text: LINE })
  for (let i = 0; i < IDEA_COUNT; i++) r = reduceRound(def, r, { type: 'idea', index: i })
  return reduceRound(def, r, { type: 'save', at: T0 + 30000 })
}

describe('the round', () => {
  const seed = seedsWhere(knee, 1, true)[0]
  const result = sweepOf(knee, seed)
  const truth = knee.truth(result)

  test('a number first: only one of the sweep’s points commits, and an out-of-phase action does nothing', () => {
    const r0 = freshRound(T0)
    for (const bad of [0.3, 1.1, 3, NaN]) expect(reduceRound(knee, r0, { type: 'commit', prediction: bad, at: 1 })).toBe(r0)
    expect(reduceRound(knee, r0, { type: 'swept', seed, result })).toBe(r0)
    expect(reduceRound(knee, r0, { type: 'explain', text: LINE })).toBe(r0)
    expect(reduceRound(knee, r0, { type: 'idea', index: 0 })).toBe(r0)
    expect(reduceRound(knee, r0, { type: 'save', at: 1 })).toBe(r0)
    const locked = reduceRound(knee, r0, { type: 'commit', prediction: 1, conf: 'think', at: T0 + 5 })
    expect(locked).toMatchObject({ phase: 'run', prediction: 1, conf: 'think', committedAt: T0 + 5 })
    // locked: a second commit changes nothing
    expect(reduceRound(knee, locked, { type: 'commit', prediction: 2, at: 9 })).toBe(locked)
  })

  test('parsePrediction reads a typed number and accepts only the exercise’s points', () => {
    expect(parsePrediction(knee, '1.25')).toBe(1.25)
    expect(parsePrediction(knee, ' 0.5 ')).toBe(0.5)
    expect(parsePrediction(knee, '1.3')).toBeNull()
    expect(parsePrediction(knee, 'about 1')).toBeNull()
    expect(parsePrediction(knee, '')).toBeNull()
    expect(parsePrediction(pd, '4')).toBe(4)
    expect(parsePrediction(pd, '8')).toBeNull()
    expect(parsePrediction(pd, '0')).toBeNull()
  })

  test('a sweep that is not a fair question never reaches the learner, even if it is handed over', () => {
    const [unfair] = seedsWhere(knee, 1, false)
    const locked = reduceRound(knee, freshRound(T0), { type: 'commit', prediction: 1, at: 1 })
    expect(reduceRound(knee, locked, { type: 'swept', seed: unfair, result: sweepOf(knee, unfair) })).toBe(locked)
  })

  test('the sweep grades the pick with the exercise’s own pass rule', () => {
    const locked = (p: number) => reduceRound(knee, freshRound(T0), { type: 'commit', prediction: p, at: 1 })
    const right = reduceRound(knee, locked(truth), { type: 'swept', seed, result })
    expect(right).toMatchObject({ phase: 'explain', seed, truth, ok: true })
    const off = reduceRound(knee, locked(wrongOn(knee, seed)), { type: 'swept', seed, result })
    expect(off).toMatchObject({ phase: 'explain', seed, truth, ok: false })
  })

  test('the line must reach 8 words before an idea can be ticked, and all three ticks before the round saves', () => {
    let r = reduceRound(knee, freshRound(T0), { type: 'commit', prediction: truth, at: 1 })
    r = reduceRound(knee, r, { type: 'swept', seed, result })
    r = reduceRound(knee, r, { type: 'explain', text: 'one two three four five six seven' })
    expect(reduceRound(knee, r, { type: 'idea', index: 0 })).toBe(r)
    r = reduceRound(knee, r, { type: 'explain', text: 'one two three four five six seven eight' })
    for (const i of [0, 1]) r = reduceRound(knee, r, { type: 'idea', index: i })
    expect(r.ideas).toEqual([0, 1])
    expect(canSave(r)).toBe(false)
    expect(reduceRound(knee, r, { type: 'save', at: 2 })).toBe(r)
    // an index outside the three is ignored, and a second press unticks
    expect(reduceRound(knee, r, { type: 'idea', index: 3 })).toBe(r)
    expect(reduceRound(knee, reduceRound(knee, r, { type: 'idea', index: 1 }), { type: 'idea', index: 1 }).ideas).toEqual([0, 1])
    r = reduceRound(knee, r, { type: 'idea', index: 2 })
    expect(r.ideas).toEqual([0, 1, 2])
    expect(canSave(r)).toBe(true)
    // shortening the line afterwards withdraws the right to save
    expect(canSave({ ...r, explain: 'too short now' })).toBe(false)
    const saved = reduceRound(knee, r, { type: 'save', at: 3 })
    expect(saved.phase).toBe('saved')
    expect(reduceRound(knee, saved, { type: 'save', at: 4 })).toBe(saved)
    // another seed starts from nothing
    expect(reduceRound(knee, saved, { type: 'next', at: 9 })).toEqual(freshRound(9))
    expect(reduceRound(knee, r, { type: 'next', at: 9 })).toBe(r)
  })

  test('the typed line is cut at 280 characters', () => {
    let r = reduceRound(knee, freshRound(T0), { type: 'commit', prediction: truth, at: 1 })
    r = reduceRound(knee, r, { type: 'swept', seed, result })
    expect(reduceRound(knee, r, { type: 'explain', text: 'x '.repeat(300) }).explain).toHaveLength(280)
  })
})

describe('drawFairSweep', () => {
  test('keeps a fresh seed whose sweep is in band, and skips a seed already played without running it', async () => {
    const [a, b] = seedsWhere(knee, 2, true)
    const ran: number[] = []
    const draws = [a, b]
    const got = await drawFairSweep(knee, { used: new Set([a]), draw: () => draws.shift()!, run: async (id, s) => (ran.push(s), sweepOf(knee, s)) })
    expect(got).toMatchObject({ seed: b, draws: 2 })
    expect(ran).toEqual([b])
    expect(got.result).toEqual(sweepOf(knee, b))
  })

  test('drops an out-of-band sweep and draws another seed', async () => {
    const [unfair] = seedsWhere(knee, 1, false)
    const [fair] = seedsWhere(knee, 1, true)
    const draws = [unfair, fair]
    const ran: number[] = []
    const got = await drawFairSweep(knee, { used: new Set(), draw: () => draws.shift()!, run: async (id, s) => (ran.push(s), sweepOf(knee, s)) })
    expect(ran).toEqual([unfair, fair])
    expect(got.seed).toBe(fair)
    expect(knee.band(got.result)).toBe(true)
  })

  test('gives up with NoFairSeed after MAX_DRAWS draws, and passes the worker’s own failure through', async () => {
    const [unfair] = seedsWhere(knee, 1, false)
    let n = 0
    await expect(drawFairSweep(knee, { used: new Set(), draw: () => unfair + n++, run: async () => sweepOf(knee, unfair) })).rejects.toBeInstanceOf(NoFairSeed)
    expect(n).toBe(MAX_DRAWS)
    await expect(drawFairSweep(knee, { used: new Set(), draw: () => 1, run: async () => Promise.reject(new Error('worker stopped')) })).rejects.toThrow('worker stopped')
  })

  test('the draw lands within a few seeds on both exercises (the bands accept 20 % or more)', () => {
    for (const def of [knee, pd]) {
      const n = 20
      const inBand = Array.from({ length: n }, (_, i) => def.band(sweepOf(def, 200 + i))).filter(Boolean).length
      console.log(`${def.id}: ${inBand} of ${n} seeds in 200–${199 + n} are fair questions, so ${MAX_DRAWS} draws miss with probability ${((1 - inBand / n) ** MAX_DRAWS).toExponential(1)}`)
      expect(inBand / n).toBeGreaterThanOrEqual(0.2)
    }
  }, 30000)
})

describe('the events', () => {
  const seed = seedsWhere(knee, 1, true)[0]
  const truth = knee.truth(sweepOf(knee, seed))

  test('the item event: src lesson, the block’s grp, the seed, provenance unseen, the ticks and never the line', () => {
    const round = savedRound(knee, seed, truth, 'sure')
    const ev = itemEvent(knee, CTX, round)
    expect(ev).toMatchObject({
      kind: 'item',
      ref: 'item:fleet.knee',
      rev: exerciseRev(knee),
      ok: true,
      score: 1,
      conf: 'sure',
      seed,
      ms: 26000,
      provenance: 'unseen',
      data: { src: 'lesson', value: truth, truth, unit: knee.unit, ideas: [0, 1, 2], kcs: knee.kcs, nsec: ROUND_NSEC, grp: `${LESSON}#${BLOCK}`, lessonId: LESSON },
    })
    expect(JSON.stringify(ev)).not.toContain('queue')
    expect(JSON.stringify(ev)).not.toContain(LINE)
    expect(validateEvent(stamp(ev, 1)).ok).toBe(true)
  })

  test('the predict event: the locked pick against the sweep’s answer, with the time to the lock', () => {
    const round = savedRound(knee, seed, wrongOn(knee, seed))
    const ev = predictEvent(knee, CTX, round)
    expect(ev).toMatchObject({
      kind: 'predict',
      ref: 'item:fleet.knee',
      ok: false,
      score: 0,
      seed,
      ms: 4000,
      provenance: 'unseen',
      data: { src: 'lesson', value: wrongOn(knee, seed), truth, unit: knee.unit, kcs: knee.kcs, nsec: PREDICT_NSEC, grp: `${LESSON}#${BLOCK}`, lessonId: LESSON },
    })
    expect(ev).not.toHaveProperty('conf')
    expect(validateEvent(stamp(ev, 2)).ok).toBe(true)
  })

  test('a round that has not been swept writes nothing', () => {
    const locked = reduceRound(knee, freshRound(T0), { type: 'commit', prediction: 1, at: T0 + 1 })
    expect(() => itemEvent(knee, CTX, locked)).toThrow('after its sweep')
    expect(() => predictEvent(knee, CTX, locked)).toThrow('after its sweep')
  })

  test('both exercises’ events pass the ledger codec, and the grp and the nominal seconds are the item block’s', () => {
    for (const def of [knee, pd]) {
      const s = seedsWhere(def, 1, true)[0]
      const round = savedRound(def, s, def.truth(sweepOf(def, s)))
      expect(validateEvent(stamp(itemEvent(def, { lessonId: def.lessonId, index: 2 }, round), 3)).ok).toBe(true)
      expect(validateEvent(stamp(predictEvent(def, { lessonId: def.lessonId, index: 2 }, round), 4)).ok).toBe(true)
      expect(exerciseRef(def.id)).toBe(`item:fleet.${def.id}`)
    }
    expect(exerciseGrp('t6.l3', 9)).toBe(blockGrp('t6.l3', 9))
    expect(PREDICT_NSEC).toBe(PRE_NSEC)
  })

  test('the fingerprint changes with what is asked and with the points that can be answered', () => {
    expect(exerciseRev(knee)).not.toBe(exerciseRev(pd))
    expect(exerciseRev(knee)).toBe(exerciseRev({ ...knee }))
    expect(exerciseRev(knee)).not.toBe(exerciseRev({ ...knee, points: [...knee.points, 3] }))
  })
})

describe('readExercise: restored from events', () => {
  const [s1, s2, s3, s4] = seedsWhere(knee, 4, true)
  /** The two events a saved round writes, stamped as the ledger holds them. */
  const events = (round: Round, n: number, withPredict: boolean): ExerciseEvent[] => {
    const rs = [...(withPredict ? [predictEvent(knee, CTX, round)] : []), itemEvent(knee, CTX, round)]
    return rs.map((r, i) => exerciseEventOf(r, new Date(T0 + (n + i) * 1000).toISOString(), `e${n + i}`))
  }
  const right = (s: number) => savedRound(knee, s, knee.truth(sweepOf(knee, s)))

  test('nothing yet: not predicted, no rounds, not done', () => {
    expect(readExercise([], AT)).toMatchObject({ predicted: false, played: [], passes: 0, done: false })
    expect(progressText(0, 3)).toBe('0/3')
  })

  test('three right predictions on distinct seeds finish it; a miss and a repeat of a seed do not count', () => {
    const miss = savedRound(knee, s1, wrongOn(knee, s1))
    const evs = [...events(miss, 1, true), ...events(right(s2), 3, false), ...events(right(s2), 5, false)]
    const mid = readExercise(evs, AT)
    expect(mid).toMatchObject({ predicted: true, passes: 1, done: false })
    expect(mid.played.map((p) => [p.seed, p.ok])).toEqual([[s1, false], [s2, true], [s2, true]])
    const done = readExercise([...evs, ...events(right(s3), 7, false)], AT)
    expect(done).toMatchObject({ passes: 2, done: false })
    const all = readExercise([...evs, ...events(right(s3), 7, false), ...events(right(s4), 9, false)], AT)
    expect(all).toMatchObject({ passes: 3, done: true })
    expect([...all.seeds].sort()).toEqual([s1, s2, s3, s4].sort())
    expect(progressText(all.passes, 3)).toBe('3/3 · done')
  })

  test('another block, another exercise, another surface and a seedless event are not this block’s', () => {
    const mine = events(right(s1), 1, true)
    const other = (patch: Partial<ExerciseEvent> & { data?: Record<string, unknown> }): ExerciseEvent[] =>
      mine.map((e) => ({ ...e, ...patch, data: { ...(e.data as object), ...(patch.data ?? {}) } }))
    expect(readExercise(other({ data: { grp: `${LESSON}#${BLOCK + 1}` } }), AT)).toMatchObject({ predicted: false, passes: 0 })
    expect(readExercise(other({ ref: 'item:fleet.pd-split' }), AT).passes).toBe(0)
    expect(readExercise(other({ data: { src: 'practice' } }), AT).passes).toBe(0)
    expect(readExercise(other({ seed: undefined }), AT).passes).toBe(0)
    expect(readExercise(mine, AT).passes).toBe(1)
  })

  test('the order events come back in does not matter', () => {
    const evs = [...events(right(s1), 1, true), ...events(right(s2), 3, false), ...events(right(s3), 5, false)]
    expect(readExercise([...evs].reverse(), AT)).toEqual(readExercise(evs, AT))
  })
})

describe('what the sweep says', () => {
  const seed = seedsWhere(knee, 1, true)[0]
  const result = sweepOf(knee, seed)
  const truth = knee.truth(result)
  const copy = copyFor('knee')!
  const goodput = (x: number) => result.points.find((p) => p.x === x)!.goodputRps

  test('a right pick says where goodput peaks and how much it is', () => {
    const v = verdictText(knee, copy, truth, result)
    expect(v.ok).toBe(true)
    expect(v.detail).toContain(`${truth}× load`)
    expect(v.detail).toContain(`${formatNumber(goodput(truth))} req/s`)
  })

  test('a wrong pick says what it was worth: its goodput and the percentage below the peak', () => {
    const pick = wrongOn(knee, seed)
    const v = verdictText(knee, copy, pick, result)
    expect(v.ok).toBe(false)
    expect(v.detail).toContain(`You said ${pick}× load`)
    expect(v.detail).toContain(`${Math.round((1 - goodput(pick) / goodput(truth)) * 100)}% below the peak`)
    expect(v.detail).toContain(`It peaks at ${truth}× load`)
  })

  test('the table has a row per point, names the peak and the pick, and reads TTFT in milliseconds (a tick is 50 ms)', () => {
    const pick = wrongOn(knee, seed)
    const table = sweepTable(knee, copy, result, pick)
    expect(table.columns).toEqual(['Load', 'Goodput (req/s)', 'TTFT p95 (ms)', 'SLO met'])
    expect(table.rows).toHaveLength(knee.points.length)
    const peakRow = table.rows.find((r) => String(r[0]).includes('peak'))!
    expect(peakRow[0]).toContain(`${truth}× load`)
    expect(String(table.rows.find((r) => String(r[0]).includes('your pick'))![0])).toContain(`${pick}× load`)
    const p = result.points[0]
    expect(table.rows[0][2]).toBe(String(p.ttftP95 * 50))
    expect(table.rows[0][3]).toBe(`${p.metrics!.sloMet} of ${p.metrics!.requests}`)
  })

  test('P:D split adds TPOT p95 and reads its points as prefill and decode workers', () => {
    const [s] = seedsWhere(pd, 1, true)
    const r = sweepOf(pd, s)
    const c = copyFor('pd-split')!
    const table = sweepTable(pd, c, r, 3)
    expect(table.columns).toContain('TPOT p95 (ms)')
    expect(String(table.rows[2][0])).toContain('3 prefill, 5 decode')
    expect(c.tickLabel(2)).toBe('2:6')
    expect(verdictText(pd, c, pd.truth(r), r).detail).toContain(`${pd.truth(r)} prefill, ${8 - pd.truth(r)} decode`)
  })
})

describe('the copy and the In-production rows', () => {
  test('every listed exercise has copy: a setup that reads its own constants, three ideas and a model answer', () => {
    for (const def of Object.values(FLEET_EXERCISES)) {
      const c = copyFor(def.id)
      expect(c).not.toBeNull()
      expect(c!.ideas).toHaveLength(IDEA_COUNT)
      expect(c!.model.length).toBeGreaterThan(80)
      expect(c!.explainPrompt).toMatch(/\?|\.$/)
      for (const p of def.points) expect(c!.tickLabel(p)).not.toBe('')
    }
    expect(copyFor('no-such-exercise')).toBeNull()
    expect(copyFor('constructor')).toBeNull()
  })

  test('the knee setup states the engine it sweeps: 8 slots, a 40-tick (2 s) TTFT SLO, a 40 s window, six multipliers', () => {
    const s = copyFor('knee')!.setup
    expect(s).toContain('8 sequences')
    expect(s).toContain('40 ticks (2 s)')
    expect(s).toContain('40 s window')
    expect(s).toContain('6 load multipliers, 0.5× to 2×')
    expect(s).toContain('50 ms')
  })

  test('the P:D setup states its workers, SLOs and transfer rate: 8 workers, 12 slots, 80 ticks (4 s), 2 ticks, 256 tokens a tick, 1.2×', () => {
    const s = copyFor('pd-split')!.setup
    for (const part of ['8 identical workers', '12-sequence engine', '256 tokens per tick', '80 ticks (4 s)', '2 ticks', '20 s', '1.2×']) expect(s).toContain(part)
  })

  test('every claim an exercise names has a row, resolves, and is pinned to a release (a row never states a number of its own)', () => {
    for (const def of Object.values(FLEET_EXERCISES)) {
      for (const id of def.productionClaims) {
        expect(getClaim(id).id).toBe(id)
        expect(PRODUCTION_ROWS[id]).toBeDefined()
        expect(byId[id].pin).toBeDefined()
        expect(`${PRODUCTION_ROWS[id].lead} ${PRODUCTION_ROWS[id].tail}`).not.toMatch(/(^|[^A-Za-z0-9])\d/) // H100 and H200 are names, not figures
      }
    }
    expect(pinnedReleases(knee.productionClaims)).toEqual(['vllm-project/vllm v0.31.0', 'sgl-project/sglang v0.5.21'])
    expect(pinnedReleases(pd.productionClaims)).toEqual(['vllm-project/vllm v0.31.0', 'sgl-project/sglang v0.5.21'])
  })
})

/* ------------------------------------------------------------------ */
/* Mounted                                                              */
/* ------------------------------------------------------------------ */

describe('the panel, mounted', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  interface Rig {
    env: FleetExerciseEnv
    recorded: ItemResponse[]
    runs: number[]
    clock: { t: number }
    history: ExerciseEvent[]
  }

  /** Fake worker (the real sweep, no worker), ledger and clock. `seeds` are what freshSeed() will hand out, in order. */
  function rig(seeds: number[], over: Partial<FleetExerciseEnv> = {}, history: ExerciseEvent[] = []): Rig {
    const recorded: ItemResponse[] = []
    const runs: number[] = []
    const clock = { t: T0 }
    const queue = [...seeds]
    const env: FleetExerciseEnv = {
      run: async (id, seed) => {
        runs.push(seed)
        return sweepOf(FLEET_EXERCISES[id], seed)
      },
      seed: () => queue.shift() ?? 0,
      now: () => (clock.t += 1000),
      history: async () => history,
      record: (items) => void recorded.push(...items),
      mode: 'embed',
      ...over,
    }
    return { env, recorded, runs, clock, history }
  }

  const block = (fleet = 'knee'): FleetExerciseBlock => ({ type: 'exercise', fleet, title: 'Find the knee' })
  const props = (r: Rig, over: Partial<FleetExerciseProps> = {}): FleetExerciseProps => ({ block: block(), lessonId: LESSON, index: BLOCK, env: r.env, ...over })
  const open = async (r: Rig, over: Partial<FleetExerciseProps> = {}): Promise<Mounted> => {
    const page = await dom.mount(createElement(FleetExercise, props(r, over)))
    await dom.until(() => page.container.querySelector('[data-fleet-predict]') !== null)
    return page
  }
  const q = (page: Mounted, sel: string) => page.container.querySelector(sel) as MiniElement
  const type = async (el: MiniElement, value: string) =>
    dom.act(() => {
      el.value = value
      el.dispatchEvent(new MiniEvent('input', { bubbles: true }))
    })
  const progress = (page: Mounted) => q(page, '[data-fleet-progress]').textContent

  /** Predicts `value`, locks, waits for the verdict. */
  async function predict(page: Mounted, value: number | string): Promise<void> {
    await type(q(page, '[data-fleet-predict]'), String(value))
    await dom.press(q(page, '[data-fleet-lock]'))
    await dom.until(() => q(page, '[data-verdict]') !== null)
  }
  /** Writes the line, opens the model answer, ticks the ideas and saves. */
  async function explainAndSave(page: Mounted): Promise<void> {
    await type(q(page, '[data-fleet-explain]'), LINE)
    await dom.press(q(page, '[data-fleet-reveal]'))
    for (let i = 0; i < IDEA_COUNT; i++) await dom.press(q(page, `[data-fleet-idea="${i}"]`))
    await dom.press(q(page, '[data-fleet-save]'))
    await dom.until(() => q(page, '[data-saved]') !== null)
  }

  test('a number comes first: the field is labelled, nothing has run, and the sweep waits for the lock', async () => {
    const [a] = seedsWhere(knee, 1, true)
    const r = rig([a])
    const page = await open(r)
    const input = q(page, '[data-fleet-predict]')
    expect(page.container.querySelector(`label[for="${input.getAttribute('id')}"]`) ?? input.getAttribute('aria-label')).toBeTruthy()
    expect(input.getAttribute('aria-label')).toContain(knee.unit)
    expect(q(page, '[data-sweep-chart]')).toBeNull()
    expect(q(page, '[data-fleet-explain]')).toBeNull()
    expect(r.runs).toHaveLength(0)
    expect(r.recorded).toHaveLength(0)
    expect(page.container.textContent).toContain('one of 0.5, 0.75, 1, 1.25, 1.5, 2')
    expect(progress(page)).toBe('0/3')
    await page.unmount()
  })

  test('something that is not one of the points gets a message (role alert), keeps the input, and runs nothing', async () => {
    const r = rig([seedsWhere(knee, 1, true)[0]])
    const page = await open(r)
    const input = q(page, '[data-fleet-predict]')
    await type(input, '1.3')
    await dom.press(q(page, '[data-fleet-lock]'))
    const alert = page.container.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('Enter one of the points the sweep runs: 0.5, 0.75, 1, 1.25, 1.5, 2')
    expect(input.value).toBe('1.3')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain(alert.getAttribute('id') ?? '?')
    expect(r.runs).toHaveLength(0)
    expect(q(page, '[data-sweep-chart]')).toBeNull()
    // the Enter key locks too
    await type(input, '1')
    await dom.act(() => input.dispatchEvent(new MiniEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })))
    await dom.until(() => q(page, '[data-verdict]') !== null)
    expect(r.runs).toHaveLength(1)
    await page.unmount()
  })

  test('the lock runs the sweep on the drawn seed, then shows the verdict, an SVG chart described by its table, and the seed', async () => {
    const [a] = seedsWhere(knee, 1, true)
    const r = rig([a])
    const page = await open(r)
    const truth = knee.truth(sweepOf(knee, a))
    await predict(page, truth)
    expect(r.runs).toEqual([a])
    expect(q(page, '[data-verdict]').getAttribute('data-verdict')).toBe('right')
    expect(q(page, '[data-verdict]').textContent).toContain(`Goodput peaks at ${truth}× load`)
    const svg = q(page, '[data-sweep-chart] svg')
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toContain('Goodput in requests per second')
    const mirror = page.container.querySelector(`[id="${svg.getAttribute('aria-describedby')}"]`)!
    expect(mirror).not.toBeNull()
    expect(mirror.querySelectorAll('tbody tr')).toHaveLength(knee.points.length)
    expect(mirror.textContent).toContain(`${truth}× load (peak, your pick)`)
    expect(page.container.querySelector('[data-sim-mirror] button')!.textContent).toBe('Show data table')
    expect(q(page, '[data-seed]').textContent).toContain(`Seed ${a}`)
    // the verdict is also spoken: a status region that was mounted before it had anything to say
    const live = Array.from(page.container.querySelectorAll('[role="status"]')).find((e) => e.textContent.includes('Your prediction held'))
    expect(live?.getAttribute('aria-live')).toBe('polite')
    // the prediction is locked
    expect(q(page, '[data-fleet-predict]').value).toBe(String(truth))
    expect(q(page, 'fieldset').getAttribute('disabled')).not.toBeNull()
    // focus follows the step to the line to write
    expect(dom.document.activeElement).toBe(q(page, '[data-fleet-explain]'))
    await page.unmount()
  })

  test('the first sweep writes the block’s one predict event, before anything is explained', async () => {
    const [a] = seedsWhere(knee, 1, true)
    const r = rig([a])
    const page = await open(r)
    await predict(page, wrongOn(knee, a))
    expect(r.recorded).toHaveLength(1)
    expect(r.recorded[0]).toMatchObject({ kind: 'predict', ref: 'item:fleet.knee', ok: false, seed: a, provenance: 'unseen', data: { src: 'lesson', grp: `${LESSON}#${BLOCK}` } })
    await page.unmount()
  })

  test('the model answer opens at 8 words, the save waits for all three ideas, and the line is never recorded', async () => {
    const [a] = seedsWhere(knee, 1, true)
    const r = rig([a])
    const page = await open(r)
    await predict(page, knee.truth(sweepOf(knee, a)))
    const reveal = q(page, '[data-fleet-reveal]')
    expect(reveal.disabled).toBe(true)
    await type(q(page, '[data-fleet-explain]'), 'one two three four five six seven')
    expect(reveal.disabled).toBe(true)
    expect(page.container.textContent).toContain('7/8 words')
    await type(q(page, '[data-fleet-explain]'), LINE)
    expect(page.container.textContent).toContain('· ready')
    expect(reveal.disabled).toBe(false)
    await dom.press(reveal)
    expect(page.container.textContent).toContain('Model answer.')
    expect(page.container.textContent).toContain(copyFor('knee')!.model)
    expect(dom.document.activeElement).toBe(q(page, '[data-fleet-idea="0"]'))
    const save = q(page, '[data-fleet-save]')
    expect(save.disabled).toBe(true)
    for (const i of [0, 1]) await dom.press(q(page, `[data-fleet-idea="${i}"]`))
    expect(save.disabled).toBe(true)
    await dom.press(q(page, '[data-fleet-idea="2"]'))
    expect(save.disabled).toBe(false)
    await dom.press(save)
    await dom.until(() => q(page, '[data-saved]') !== null)
    expect(r.recorded.map((e) => e.kind)).toEqual(['predict', 'item'])
    expect(r.recorded[1]).toMatchObject({ ok: true, seed: a, provenance: 'unseen', data: { src: 'lesson', ideas: [0, 1, 2], grp: `${LESSON}#${BLOCK}` } })
    expect(JSON.stringify(r.recorded)).not.toContain('requests miss the SLO')
    expect(JSON.stringify(r.recorded)).not.toContain('queue grows')
    // saved: the count moves and focus lands on the saved line
    expect(progress(page)).toBe('1/3')
    expect(q(page, '[data-saved]').textContent).toContain('Saved. A right prediction on a new seed: 1/3.')
    expect(dom.document.activeElement).toBe(q(page, '[data-saved]'))
    await page.unmount()
  })

  test('a wrong prediction saves as a miss that does not count, and the next round writes an item but no second predict', async () => {
    const [a, b] = seedsWhere(knee, 2, true)
    const r = rig([a, b])
    const page = await open(r)
    await predict(page, wrongOn(knee, a))
    expect(q(page, '[data-verdict]').getAttribute('data-verdict')).toBe('off')
    expect(q(page, '[data-verdict]').textContent).toContain('% below the peak')
    expect(page.container.textContent).toContain('your pick')
    await explainAndSave(page)
    expect(q(page, '[data-saved]').textContent).toContain('Not a pass')
    expect(progress(page)).toBe('0/3')
    expect(r.recorded.map((e) => [e.kind, e.ok])).toEqual([['predict', false], ['item', false]])
    // another seed: a fresh prediction field, focused, and the earlier round listed
    await dom.press(q(page, '[data-fleet-another]'))
    expect(q(page, '[data-fleet-predict]').value).toBe('')
    expect(dom.document.activeElement).toBe(q(page, '[data-fleet-predict]'))
    expect(page.container.querySelector('[data-fleet-played]')!.textContent).toContain('1. you said')
    await predict(page, knee.truth(sweepOf(knee, b)))
    await explainAndSave(page)
    expect(r.recorded.map((e) => e.kind)).toEqual(['predict', 'item', 'item'])
    expect(r.recorded.map((e) => e.seed)).toEqual([a, a, b])
    expect(progress(page)).toBe('1/3')
    await page.unmount()
  })

  test('done after three right predictions on distinct fresh seeds, and a seed already played is never drawn again', async () => {
    const [a, b, c] = seedsWhere(knee, 3, true)
    // freshSeed() hands out `b` twice: the second draw is a seed already played, so the panel skips it without a run
    const r = rig([a, b, b, c])
    const page = await open(r)
    for (const s of [a, b, c]) {
      await predict(page, knee.truth(sweepOf(knee, s)))
      await explainAndSave(page)
      if (s !== c) await dom.press(q(page, '[data-fleet-another]'))
    }
    expect(r.runs).toEqual([a, b, c])
    expect(progress(page)).toBe('3/3 · done')
    expect(r.recorded.filter((e) => e.kind === 'item').map((e) => e.seed)).toEqual([a, b, c])
    expect(r.recorded.filter((e) => e.kind === 'predict')).toHaveLength(1)
    await dom.press(q(page, '[data-fleet-another]'))
    expect(page.container.textContent).toContain('3 right predictions on new seeds. Done. There are always more seeds.')
    // nothing locks: the field is there for another seed
    expect(q(page, '[data-fleet-predict]')).not.toBeNull()
    await page.unmount()
  })

  test('a sweep that is not a fair question is dropped and another seed drawn, so the learner sees only the fair one', async () => {
    const [unfair] = seedsWhere(knee, 1, false)
    const [fair] = seedsWhere(knee, 1, true)
    const r = rig([unfair, fair])
    const page = await open(r)
    await predict(page, 1)
    expect(r.runs).toEqual([unfair, fair])
    expect(q(page, '[data-seed]').textContent).toContain(`Seed ${fair}`)
    await page.unmount()
  })

  test('after a reload the count comes from the ledger: 3/3 · done, the earlier rounds listed, nothing asked or run', async () => {
    const [a, b, c, d] = seedsWhere(knee, 4, true)
    const history: ExerciseEvent[] = [a, b, c].flatMap((s, i) => {
      const round = savedRound(knee, s, knee.truth(sweepOf(knee, s)))
      return [...(i === 0 ? [predictEvent(knee, CTX, round)] : []), itemEvent(knee, CTX, round)].map((e, j) =>
        exerciseEventOf(e, new Date(T0 + (i * 2 + j) * 1000).toISOString(), `h${i}${j}`),
      )
    })
    const r = rig([a, d], {}, history)
    const page = await open(r)
    expect(progress(page)).toBe('3/3 · done')
    expect(page.container.textContent).toContain('3 right predictions on new seeds. Done.')
    expect(page.container.querySelectorAll('[data-fleet-played] li')).toHaveLength(3)
    // the one prediction is already on the ledger: a new round writes an item only
    await predict(page, knee.truth(sweepOf(knee, d)))
    expect(r.runs).toEqual([d]) // `a` was played, so it was skipped without a run
    expect(r.recorded.map((e) => e.kind)).toEqual([])
    await explainAndSave(page)
    expect(r.recorded.map((e) => e.kind)).toEqual(['item'])
    await page.unmount()
  })

  test('another block’s events do not count here', async () => {
    const [a] = seedsWhere(knee, 1, true)
    const round = savedRound(knee, a, knee.truth(sweepOf(knee, a)))
    const history = [exerciseEventOf(itemEvent(knee, { lessonId: LESSON, index: BLOCK + 3 }, round), new Date(T0).toISOString(), 'x')]
    const page = await open(rig([a], {}, history))
    expect(progress(page)).toBe('0/3')
    expect(q(page, '[data-fleet-played]')).toBeNull()
    await page.unmount()
  })

  test('a worker failure is said in words in an alert, the prediction stays locked, and running it again works', async () => {
    const [a] = seedsWhere(knee, 1, true)
    let fail = true
    const r = rig([a, a], {
      run: async (id, seed) => {
        if (fail) throw Object.assign(new Error('boom'), { name: 'FleetTimeoutError' })
        return sweepOf(FLEET_EXERCISES[id], seed)
      },
    })
    const page = await open(r)
    await type(q(page, '[data-fleet-predict]'), '1')
    await dom.press(q(page, '[data-fleet-lock]'))
    await dom.until(() => page.container.querySelector('[role="alert"]') !== null)
    expect(page.container.querySelector('[role="alert"]')!.textContent).toContain('The sweep took too long')
    expect(q(page, '[data-fleet-predict]').value).toBe('1')
    expect(r.recorded).toHaveLength(0)
    fail = false
    await dom.press(q(page, '[data-fleet-retry]'))
    await dom.until(() => q(page, '[data-verdict]') !== null)
    expect(page.container.querySelector('[role="alert"]')).toBeNull()
    await page.unmount()
  })

  test('a ledger that will not load says so and offers to try again', async () => {
    let ok = false
    const r = rig([], {
      history: async () => {
        if (!ok) throw new Error('no ledger')
        return []
      },
    })
    const page = await dom.mount(createElement(FleetExercise, props(r)))
    await dom.until(() => page.container.querySelector('[role="alert"]') !== null)
    expect(page.container.querySelector('[role="alert"]')!.textContent).toContain('Could not load your earlier rounds')
    expect(q(page, '[data-fleet-predict]')).toBeNull()
    ok = true
    await dom.press(page.container.querySelector('[role="alert"] button') as MiniElement)
    await dom.until(() => q(page, '[data-fleet-predict]') !== null)
    await page.unmount()
  })

  test('the In-production rows show the pinned claims as chips with the release they were read at', async () => {
    const page = await open(rig([]))
    const rows = page.container.querySelectorAll('[data-production] li')
    expect(rows.map((li) => li.getAttribute('data-claim'))).toEqual(knee.productionClaims)
    expect(page.container.querySelector('[data-production]')!.textContent).toContain('vllm-project/vllm v0.31.0')
    expect(rows[0].textContent).toContain('1,024 sequences')
    expect(rows[1].textContent).toContain('2,048 to 4,096, sized from KV capacity')
    await page.unmount()
  })

  test('the P:D split mounts with its own copy and its disaggregation rows, and predicts a worker count', async () => {
    const [a] = seedsWhere(pd, 1, true)
    const r = rig([a])
    const page = await open(r, { block: block('pd-split'), lessonId: 't6.l3', index: 2 })
    expect(page.container.textContent).toContain('8 identical workers')
    expect(page.container.textContent).toContain('one of 1, 2, 3, 4, 5, 6, 7')
    const rows = page.container.querySelectorAll('[data-production] li')
    expect(rows.map((li) => li.getAttribute('data-claim'))).toEqual(pd.productionClaims)
    expect(rows[1].textContent).toContain('--disaggregation-mode prefill|decode')
    await predict(page, pd.truth(sweepOf(pd, a)))
    expect(q(page, '[data-verdict]').textContent).toContain('prefill')
    expect(page.container.textContent).toContain('TPOT p95 (ms)')
    await explainAndSave(page)
    expect(r.recorded.map((e) => e.ref)).toEqual(['item:fleet.pd-split', 'item:fleet.pd-split'])
    expect(r.recorded[1].data).toMatchObject({ grp: 't6.l3#2', lessonId: 't6.l3' })
    await page.unmount()
  })

  test('phone mode asks for the number first, then shows the canonical outcome with its table open, and writes and runs nothing', async () => {
    const r = rig([])
    const page = await open(r, { env: { ...r.env, mode: 'phone' } })
    expect(q(page, '[data-phone]')).not.toBeNull()
    await type(q(page, '[data-fleet-predict]'), '1.3')
    await dom.press(q(page, '[data-fleet-lock]'))
    expect(page.container.querySelector('[role="alert"]')!.textContent).toContain('Enter one of the points')
    expect(q(page, '[data-sweep-chart]')).toBeNull()
    const canonical = knee.phone.canonical
    const truth = knee.truth(canonical)
    await type(q(page, '[data-fleet-predict]'), String(truth))
    await dom.press(q(page, '[data-fleet-lock]'))
    expect(q(page, '[data-verdict]').getAttribute('data-verdict')).toBe('right')
    expect(q(page, '[data-sweep-chart] svg')).not.toBeNull()
    // the table is open beside the chart, not behind a button
    expect(page.container.querySelector('[data-sim-mirror]')).toBeNull()
    expect(page.container.querySelectorAll('[data-sweep-chart] tbody tr')).toHaveLength(knee.points.length)
    // the open table scrolls inside its own region, which takes the keyboard
    const region = q(page, '[data-sweep-chart] [role="region"]')
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.getAttribute('aria-label')).toContain('goodput by load')
    expect(page.container.textContent).toContain('it earns nothing')
    expect(r.runs).toHaveLength(0)
    expect(r.recorded).toHaveLength(0)
    await page.unmount()
  })

  test('phone mode names a wrong pick and still earns nothing', async () => {
    const r = rig([])
    const page = await open(r, { env: { ...r.env, mode: 'phone' } })
    await type(q(page, '[data-fleet-predict]'), String(wrongOn(knee, 0)))
    await dom.press(q(page, '[data-fleet-lock]'))
    expect(q(page, '[data-verdict]').getAttribute('data-verdict')).toBe('off')
    expect(r.recorded).toHaveLength(0)
    await page.unmount()
  })

  test('an exercise id nothing registers draws nothing', async () => {
    const r = rig([])
    const page = await dom.mount(createElement(FleetExercise, props(r, { block: block('no-such-exercise') })))
    await dom.act(() => new Promise((res) => setTimeout(res, 20)))
    expect(page.container.innerHTML).toBe('')
    await page.unmount()
  })
})
