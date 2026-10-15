/**
 * The Fleet exercise panel (docs/specs/wave-3.md §5.3, task 3b-20; fix BF8: the scene before the prediction, and the
 * done rule): the pure session (the round's transitions, the fair-seed draw, the events and their restoring, the copy
 * and the In-production rows) and the panel mounted in a small
 * DOM (tests/dom/mini-dom.ts) against the real sweeps, with the worker, the ledger and the clock injected. The mounted
 * tests assert on the DOM, focus, `aria-live` regions and the events written, never on source text. What a browser
 * alone answers (axe, reflow at 360 and 320 px, the real worker) is the a11y harness's and Playwright's, run for the
 * routes that carry a fleet block in 3c-06.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import FleetExercise, { type FleetExerciseEnv, type FleetExerciseProps } from '../../src/components/fleet-ex/FleetExercise'
import {
  ANSWERS_NEEDED,
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
  sceneLine,
  sweepTable,
  verdictText,
  type ExerciseEvent,
  type Round,
} from '../../src/components/fleet-ex/session'
import { byId, getClaim } from '../../src/data/claims'
import '../../src/data/claims/lazy/serving3'
import { lessonById } from '../../src/data/lessons'
import type { FleetExerciseBlock } from '../../src/data/lessons/types'
import { validateEvent } from '../../src/lib/ledger/codec'
import type { ItemResponse, LedgerEvent } from '../../src/lib/ledger/types'
import { blockGrp } from '../../src/lib/learner/item-block'
import { formatNumber } from '../../src/lib/sims/host'
import { PRE_NSEC } from '../../src/lib/learner/prequestions'
import { FLEET_EXERCISES, type FleetExerciseDef, type SweepResult } from '../../src/lib/world/fleet-ex'
import { KNEE_TARGETS } from '../../src/lib/world/fleet-ex/knee'
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

/** The first seed from `from` that is a fair question whose answer is `x`. */
function seedWithTruth(def: FleetExerciseDef, x: number, from = 300): number {
  for (let s = from; ; s++) if (def.band(sweepOf(def, s)) && def.truth(sweepOf(def, s)) === x) return s
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

/** A round on the seed, drawn and shown at T0, waiting for its prediction. */
function shownRound(def: FleetExerciseDef, seed: number): Round {
  const r = reduceRound(def, freshRound(T0 - 9000), { type: 'draw' })
  return reduceRound(def, r, { type: 'swept', seed, result: sweepOf(def, seed), at: T0 })
}

/** A round driven through the reducer to its saved state: the prediction on the seed, the line, the ticks. */
function savedRound(def: FleetExerciseDef, seed: number, prediction: number, conf?: 'guess' | 'think' | 'sure'): Round {
  let r = shownRound(def, seed)
  r = reduceRound(def, r, { type: 'commit', prediction, conf, at: T0 + 4000 })
  r = reduceRound(def, r, { type: 'explain', text: LINE })
  for (let i = 0; i < IDEA_COUNT; i++) r = reduceRound(def, r, { type: 'idea', index: i })
  return reduceRound(def, r, { type: 'save', at: T0 + 30000 })
}

describe('the round', () => {
  const seed = seedsWhere(knee, 1, true)[0]
  const result = sweepOf(knee, seed)
  const truth = knee.truth(result)

  test('a fair seed first, then a number: nothing commits before the scene, only the sweep’s points commit, and an out-of-phase action does nothing', () => {
    const r0 = freshRound(T0)
    expect(r0.phase).toBe('start')
    for (const a of [
      { type: 'commit', prediction: 1, at: 1 },
      { type: 'swept', seed, result, at: 1 },
      { type: 'explain', text: LINE },
      { type: 'idea', index: 0 },
      { type: 'save', at: 1 },
      { type: 'next', at: 1 },
    ] as const) expect(reduceRound(knee, r0, a)).toBe(r0)
    const drawing = reduceRound(knee, r0, { type: 'draw' })
    expect(drawing.phase).toBe('draw')
    expect(reduceRound(knee, drawing, { type: 'commit', prediction: 1, at: 1 })).toBe(drawing)
    const shown = reduceRound(knee, drawing, { type: 'swept', seed, result, at: T0 + 2 })
    // the scene is up and the outcome is held, ungraded
    expect(shown).toMatchObject({ phase: 'predict', seed, result, startedAt: T0 + 2 })
    expect(shown.truth).toBeUndefined()
    expect(shown.ok).toBeUndefined()
    for (const bad of [0.3, 1.1, 3, NaN]) expect(reduceRound(knee, shown, { type: 'commit', prediction: bad, at: 1 })).toBe(shown)
    const locked = reduceRound(knee, shown, { type: 'commit', prediction: 1, conf: 'think', at: T0 + 5 })
    expect(locked).toMatchObject({ phase: 'explain', prediction: 1, conf: 'think', committedAt: T0 + 5, truth, ok: truth === 1 })
    // locked: a second commit or another sweep changes nothing
    expect(reduceRound(knee, locked, { type: 'commit', prediction: 2, at: 9 })).toBe(locked)
    expect(reduceRound(knee, locked, { type: 'swept', seed: seed + 1, result, at: 9 })).toBe(locked)
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
    const drawing = reduceRound(knee, freshRound(T0), { type: 'draw' })
    expect(reduceRound(knee, drawing, { type: 'swept', seed: unfair, result: sweepOf(knee, unfair), at: 1 })).toBe(drawing)
  })

  test('the lock grades the pick against the held sweep with the exercise’s own pass rule', () => {
    const locked = (p: number) => reduceRound(knee, shownRound(knee, seed), { type: 'commit', prediction: p, at: 1 })
    expect(locked(truth)).toMatchObject({ phase: 'explain', seed, truth, ok: true })
    expect(locked(wrongOn(knee, seed))).toMatchObject({ phase: 'explain', seed, truth, ok: false })
  })

  test('the line must reach 8 words before an idea can be ticked, and all three ticks before the round saves', () => {
    let r = reduceRound(knee, shownRound(knee, seed), { type: 'commit', prediction: truth, at: 1 })
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
    // another seed starts from nothing, drawing at once
    expect(reduceRound(knee, saved, { type: 'next', at: 9 })).toEqual(freshRound(9, 'draw'))
    expect(reduceRound(knee, r, { type: 'next', at: 9 })).toBe(r)
  })

  test('the typed line is cut at 280 characters', () => {
    const r = reduceRound(knee, shownRound(knee, seed), { type: 'commit', prediction: truth, at: 1 })
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

  test('the predict event: the locked pick against the sweep’s answer, with the time from the scene to the lock', () => {
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

  test('a later round’s predict is only the record of its lock: no confidence and no seconds, so its item is not counted twice', () => {
    const round = savedRound(knee, seed, truth, 'sure')
    const first = predictEvent(knee, CTX, round)
    const later = predictEvent(knee, CTX, round, false)
    expect(first).toMatchObject({ conf: 'sure', data: { nsec: PREDICT_NSEC } })
    expect(later).not.toHaveProperty('conf')
    expect(later).toMatchObject({ kind: 'predict', ok: true, seed, data: { nsec: 0, value: truth, truth, grp: `${LESSON}#${BLOCK}` } })
    expect(validateEvent(stamp(later, 5)).ok).toBe(true)
    // the item carries the round's confidence
    expect(itemEvent(knee, CTX, round)).toMatchObject({ conf: 'sure' })
  })

  test('a round whose prediction is not locked writes nothing', () => {
    const shown = shownRound(knee, seed)
    expect(() => itemEvent(knee, CTX, shown)).toThrow('after its lock')
    expect(() => predictEvent(knee, CTX, shown)).toThrow('after its lock')
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
    const st = readExercise([], AT)
    expect(st).toMatchObject({ predicted: false, played: [], passes: 0, run: 0, runAnswers: 0, done: false })
    expect(progressText(st, 3)).toBe('0/3 right in a row · 0/2 different answers')
  })

  test('three right in a row on two different answers finish it; a miss restarts the run, a repeated seed does not count', () => {
    const [x, y] = [seedWithTruth(knee, 1), seedWithTruth(knee, 1.25)]
    const miss = savedRound(knee, s1, wrongOn(knee, s1))
    const evs = [...events(miss, 1, true), ...events(right(x), 3, false), ...events(right(x), 5, false)]
    const mid = readExercise(evs, AT)
    expect(mid).toMatchObject({ predicted: true, passes: 1, run: 1, runAnswers: 1, done: false })
    expect(mid.played.map((p) => [p.seed, p.ok])).toEqual([[s1, false], [x, true], [x, true]])
    const two = readExercise([...evs, ...events(right(y), 7, false)], AT)
    expect(two).toMatchObject({ passes: 2, run: 2, runAnswers: 2, done: false })
    expect(progressText(two, 3)).toBe('2/3 right in a row · 2/2 different answers')
    const all = readExercise([...evs, ...events(right(y), 7, false), ...events(right(s4), 9, false)], AT)
    expect(all).toMatchObject({ passes: 3, run: 3, done: true })
    expect([...all.seeds].sort()).toEqual([s1, x, y, s4].sort())
    expect(progressText(all, 3)).toBe('3/3 · done')
    // a miss between the rights starts the run again
    const broken = readExercise([...evs, ...events(savedRound(knee, s2, wrongOn(knee, s2)), 7, false), ...events(right(y), 9, false), ...events(right(s4), 11, false)], AT)
    expect(broken).toMatchObject({ passes: 3, run: 2, done: false })
  })

  test('naming the one answer that keeps being right never finishes it', () => {
    const same = seedsWhere(knee, 40, true).filter((s) => knee.truth(sweepOf(knee, s)) === 1.5).slice(0, 4)
    expect(same).toHaveLength(4)
    const st = readExercise(same.flatMap((s, i) => events(right(s), 1 + 2 * i, i === 0)), AT)
    expect(st).toMatchObject({ passes: 4, run: 4, runAnswers: 1, done: false })
    expect(progressText(st, 3)).toBe('3/3 right in a row · 1/2 different answers')
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

  /** What the lock alone leaves: the round's predict event and no item. */
  const locked = (round: Round, n: number): ExerciseEvent[] => [exerciseEventOf(predictEvent(knee, CTX, round, n !== 1), new Date(T0 + n * 1000).toISOString(), `e${n}`)]

  test('a round locked and never saved is a miss: it breaks the run of rights, right or wrong at the lock', () => {
    const [x, y] = [seedWithTruth(knee, 1), seedWithTruth(knee, 1.25)]
    const rights = [...events(right(x), 1, true), ...events(right(y), 3, false)]
    expect(readExercise(rights, AT)).toMatchObject({ run: 2, runAnswers: 2, done: false })
    // locked on a right answer and left: still not a pass, and the two rights before it no longer stand
    const leftRight = readExercise([...rights, ...locked(right(s3), 5)], AT)
    expect(leftRight).toMatchObject({ predicted: true, passes: 2, run: 0, done: false })
    expect(leftRight.played[2]).toEqual({ seed: s3, ok: false, value: knee.truth(sweepOf(knee, s3)), truth: knee.truth(sweepOf(knee, s3)), unsaved: true })
    expect(progressText(leftRight, 3)).toBe('0/3 right in a row · 0/2 different answers')
    // locked on a wrong answer and left: the same
    expect(readExercise([...rights, ...locked(savedRound(knee, s3, wrongOn(knee, s3)), 5)], AT)).toMatchObject({ run: 0, done: false })
    // the seed is on the record, so the next draw skips it
    expect(leftRight.seeds.has(s3)).toBe(true)
  })

  test('the unsaved miss does not undo a finished exercise, and a save after it starts the run again', () => {
    const [x, y] = [seedWithTruth(knee, 1), seedWithTruth(knee, 1.25)]
    const done = [...events(right(x), 1, true), ...events(right(y), 3, false), ...events(right(s3), 5, false)]
    expect(readExercise(done, AT).done).toBe(true)
    expect(readExercise([...done, ...locked(right(s4), 7)], AT)).toMatchObject({ done: true, run: 0 })
    const after = readExercise([...events(right(x), 1, true), ...locked(right(s3), 3), ...events(right(y), 5, false)], AT)
    expect(after).toMatchObject({ passes: 2, run: 1 })
  })

  test('a predict whose item was saved counts once, as the item; two predicts of one seed count once', () => {
    const r1 = right(s1)
    const both = readExercise([...locked(r1, 1), ...events(r1, 2, false)], AT)
    expect(both.played).toHaveLength(1)
    expect(both.played[0]).not.toHaveProperty('unsaved')
    expect(both).toMatchObject({ passes: 1, run: 1 })
    expect(readExercise([...locked(r1, 1), ...locked(r1, 2)], AT).played).toHaveLength(1)
  })

  test('the round still open in this tab is not a miss yet, and a predict without a graded value is ignored', () => {
    const open = readExercise([...events(right(s1), 1, true), ...locked(right(s2), 3)], AT, s2)
    expect(open).toMatchObject({ predicted: true, passes: 1, run: 1 })
    expect(open.played).toHaveLength(1)
    const bare = locked(right(s2), 3).map((e) => ({ ...e, data: { src: 'lesson', grp: `${LESSON}#${BLOCK}` } }))
    expect(readExercise([...events(right(s1), 1, true), ...bare], AT)).toMatchObject({ passes: 1, run: 1 })
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

describe('the lesson blocks (3c-06)', () => {
  /** The exercise's block in its own lesson, with its index among the lesson's blocks. */
  function blockOf(def: FleetExerciseDef): { lesson: NonNullable<ReturnType<typeof lessonById>>; index: number; block: FleetExerciseBlock } {
    const lesson = lessonById(def.lessonId)!
    const found = lesson.blocks.flatMap((b, index) => (b.type === 'exercise' && 'fleet' in b && b.fleet === def.id ? [{ lesson, index, block: b }] : []))
    expect(found).toHaveLength(1)
    return found[0]
  }

  test('each exercise sits once in the lesson it names, with its own title, before that lesson’s quiz and after its item block', () => {
    for (const def of [knee, pd]) {
      const { lesson, index, block } = blockOf(def)
      expect(lesson.id).toBe(def.lessonId)
      expect(block.title).toBe(def.title)
      const quiz = lesson.blocks.findIndex((b) => b.type === 'quiz')
      expect(index).toBeLessThan(quiz)
      // only another Fleet exercise (the broken benchmark follows the knee, 3s-04) may sit between it and the quiz
      expect(lesson.blocks.slice(index + 1).find((b) => !(b.type === 'exercise' && 'fleet' in b))?.type).toBe('quiz')
      expect(lesson.blocks.findIndex((b) => b.type === 'item')).toBeLessThan(index)
      // the exercise assesses KCs its lesson teaches
      for (const kc of def.kcs) expect(lesson.kcs).toContain(kc)
    }
  })

  test('each block carries a note that says what happened, in terms of the model the panel runs', () => {
    for (const def of [knee, pd]) {
      const note = blockOf(def).block.note ?? ''
      expect(note.split(/\s+/).length).toBeGreaterThan(60)
      expect(note).toContain('flat-tick')
    }
    expect(blockOf(knee).block.note).toContain('Little')
    expect(blockOf(pd).block.note).toContain('prefill')
  })

  test('each note says what its lesson and its generator do: the knee names the loads seeds set it at, the split points at the lesson\'s ratio items', () => {
    // the knee's seeds share four targets (kneeTarget), so the note names them and says the answer repeats across seeds
    const kneeNote = blockOf(knee).block.note ?? ''
    for (const t of KNEE_TARGETS) expect(kneeNote).toContain(`${String(t)}×`)
    expect(kneeNote).toContain(`one of ${['zero', 'one', 'two', 'three', 'four', 'five'][KNEE_TARGETS.length]} loads`)
    expect(kneeNote).not.toContain('a different load')
    // the split is sized by the lesson's pd-ratio items, which sit in the item block above the exercise; whether to
    // disaggregate at all is the deep dive's, from the KV-transfer budget
    const { lesson, index, block } = blockOf(pd)
    const above = lesson.blocks[index - 1]
    expect(above.type === 'item' && above.variants.includes('pd-ratio')).toBe(true)
    expect(block.note).toContain('prefill-to-decode ratio items above')
    const deep = lesson.blocks.find((b) => b.type === 'deepdive')
    expect(deep?.type === 'deepdive' && deep.title).toBe('When to still say no')
    expect(deep?.type === 'deepdive' && deep.md).toContain('KV-transfer budget')
    expect(block.note).toContain('*When to still say no*')
    expect(block.note).toContain('KV-transfer budget')
    expect(block.note).not.toContain('decision procedure starts from the traffic')
  })
})

describe('the copy and the In-production rows', () => {
  test('a scene fact reads as a line: a value or a range, then its unit', () => {
    expect(sceneLine({ label: 'Prompts', value: 1792, to: 2815, unit: 'tokens' })).toBe('Prompts: 1,792–2,815 tokens')
    expect(sceneLine({ label: 'Offered at 1×', value: 7.125, unit: 'requests per second' })).toBe('Offered at 1×: 7.125 requests per second')
  })

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
    expect(s).toContain('6 load multipliers of that rate, 0.5× to 2×')
    expect(s).toContain('8 ÷ (H × 0.05 s) requests a second (Little\'s law)')
    expect(s).toContain('50 ms')
  })

  test('the P:D setup states its workers, SLOs and transfer rate: 8 workers, 12 slots, 80 ticks (4 s), 2 ticks, 256 tokens a tick, 1.2×', () => {
    const s = copyFor('pd-split')!.setup
    for (const part of ['8 identical workers', '12-sequence engine', '256 tokens per tick', '80 ticks (4 s)', '2 ticks', '20 s', '1.2×', '⌈tokens ÷ 128⌉ ticks']) expect(s).toContain(part)
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
    await dom.until(() => page.container.querySelector('[data-fleet-draw]') !== null || page.container.querySelector('[data-phone]') !== null)
    return page
  }
  const q = (page: Mounted, sel: string) => page.container.querySelector(sel) as MiniElement
  const type = async (el: MiniElement, value: string) =>
    dom.act(() => {
      el.value = value
      el.dispatchEvent(new MiniEvent('input', { bubbles: true }))
    })
  const progress = (page: Mounted) => q(page, '[data-fleet-progress]').textContent
  const START = '0/3 right in a row · 0/2 different answers'

  /** Asks for the first seed and waits for its scene and the field. */
  async function draw(page: Mounted): Promise<void> {
    await dom.press(q(page, '[data-fleet-draw]'))
    await dom.until(() => q(page, '[data-fleet-predict]') !== null)
  }
  /** Predicts `value`, locks, waits for the verdict. */
  async function predict(page: Mounted, value: number | string): Promise<void> {
    await dom.until(() => q(page, '[data-fleet-predict]') !== null && q(page, '[data-fleet-lock]') !== null)
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
  /** "Try a new seed": the next round draws at once, and its scene and field follow. */
  async function another(page: Mounted): Promise<void> {
    await dom.press(q(page, '[data-fleet-another]'))
    await dom.until(() => q(page, '[data-fleet-lock]') !== null)
  }

  test('nothing runs until the learner asks for a seed, and the rule is said before the first round', async () => {
    const [a] = seedsWhere(knee, 1, true)
    const r = rig([a])
    const page = await open(r)
    expect(r.runs).toHaveLength(0)
    expect(q(page, '[data-fleet-predict]')).toBeNull()
    expect(q(page, '[data-fleet-scene]')).toBeNull()
    expect(progress(page)).toBe(START)
    expect(page.container.textContent).toContain(`Three right in a row, on at least ${ANSWERS_NEEDED} different answers, finishes the exercise.`)
    await page.unmount()
  })

  test('the scene comes first: the seed and what it gives the engine, then a labelled field described by it, and no outcome until the lock', async () => {
    const [a] = seedsWhere(knee, 1, true)
    const r = rig([a])
    const page = await open(r)
    await draw(page)
    expect(r.runs).toEqual([a])
    const scene = q(page, '[data-fleet-scene]')
    expect(scene.textContent).toContain(`Seed ${a}, drawn fresh`)
    for (const f of knee.scene(a)) expect(scene.textContent).toContain(sceneLine(f))
    const input = q(page, '[data-fleet-predict]')
    expect(input.getAttribute('aria-label')).toContain(knee.unit)
    expect(input.getAttribute('aria-describedby')!.split(' ')).toContain(scene.getAttribute('id'))
    expect(dom.document.activeElement).toBe(input)
    // the sweep ran but nothing of its outcome is on the page
    expect(q(page, '[data-sweep-chart]')).toBeNull()
    expect(q(page, '[data-verdict]')).toBeNull()
    expect(page.container.textContent).not.toContain('req/s')
    expect(r.recorded).toHaveLength(0)
    expect(page.container.textContent).toContain('one of 0.5, 0.75, 1, 1.25, 1.5, 2')
    await page.unmount()
  })

  test('something that is not one of the points gets a message (role alert), keeps the input, and shows nothing', async () => {
    const r = rig([seedsWhere(knee, 1, true)[0]])
    const page = await open(r)
    await draw(page)
    const input = q(page, '[data-fleet-predict]')
    await type(input, '1.3')
    await dom.press(q(page, '[data-fleet-lock]'))
    const alert = page.container.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('Enter one of the points the sweep runs: 0.5, 0.75, 1, 1.25, 1.5, 2')
    expect(input.value).toBe('1.3')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain(alert.getAttribute('id') ?? '?')
    expect(q(page, '[data-sweep-chart]')).toBeNull()
    // the Enter key locks too, and the sweep is not run again
    await type(input, '1')
    await dom.act(() => input.dispatchEvent(new MiniEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })))
    await dom.until(() => q(page, '[data-verdict]') !== null)
    expect(r.runs).toHaveLength(1)
    await page.unmount()
  })

  test('the lock shows the verdict, an SVG chart described by its table, and keeps the seed', async () => {
    const [a] = seedsWhere(knee, 1, true)
    const r = rig([a])
    const page = await open(r)
    await draw(page)
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

  test('the first lock writes the block’s one predict event, before anything is explained', async () => {
    const [a] = seedsWhere(knee, 1, true)
    const r = rig([a])
    const page = await open(r)
    await draw(page)
    await predict(page, wrongOn(knee, a))
    expect(r.recorded).toHaveLength(1)
    expect(r.recorded[0]).toMatchObject({ kind: 'predict', ref: 'item:fleet.knee', ok: false, seed: a, provenance: 'unseen', data: { src: 'lesson', grp: `${LESSON}#${BLOCK}` } })
    // the time on task runs from the scene to the lock: the clock ticks a second per read
    expect(r.recorded[0].ms).toBeGreaterThan(0)
    await page.unmount()
  })

  test('the model answer opens at 8 words, the save waits for all three ideas, and the line is never recorded', async () => {
    const [a] = seedsWhere(knee, 1, true)
    const r = rig([a])
    const page = await open(r)
    await draw(page)
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
    expect(progress(page)).toBe('1/3 right in a row · 1/2 different answers')
    expect(q(page, '[data-saved]').textContent).toContain('Saved. A right prediction on a new seed: 1/3 right in a row · 1/2 different answers.')
    expect(dom.document.activeElement).toBe(q(page, '[data-saved]'))
    await page.unmount()
  })

  test('a wrong prediction saves as a miss that starts the run again, and the next round writes its own predict at its lock and an item at its save', async () => {
    const [a, b] = seedsWhere(knee, 2, true)
    const r = rig([a, b])
    const page = await open(r)
    await draw(page)
    await predict(page, wrongOn(knee, a))
    expect(q(page, '[data-verdict]').getAttribute('data-verdict')).toBe('off')
    expect(q(page, '[data-verdict]').textContent).toContain('% below the peak')
    expect(page.container.textContent).toContain('your pick')
    await explainAndSave(page)
    expect(q(page, '[data-saved]').textContent).toContain('A miss starts the run again')
    expect(progress(page)).toBe(START)
    expect(r.recorded.map((e) => [e.kind, e.ok])).toEqual([['predict', false], ['item', false]])
    // another seed: drawn at once, a fresh prediction field, focused, and the earlier round listed
    await another(page)
    expect(r.runs).toEqual([a, b])
    expect(q(page, '[data-seed]').textContent).toContain(`Seed ${b}`)
    expect(q(page, '[data-fleet-predict]').value).toBe('')
    expect(dom.document.activeElement).toBe(q(page, '[data-fleet-predict]'))
    expect(page.container.querySelector('[data-fleet-played]')!.textContent).toContain('1. you said')
    await predict(page, knee.truth(sweepOf(knee, b)))
    // the lock writes the round's predict before anything is explained
    expect(r.recorded.map((e) => e.kind)).toEqual(['predict', 'item', 'predict'])
    await explainAndSave(page)
    expect(r.recorded.map((e) => e.kind)).toEqual(['predict', 'item', 'predict', 'item'])
    expect(r.recorded.map((e) => e.seed)).toEqual([a, a, b, b])
    expect(progress(page)).toBe('1/3 right in a row · 1/2 different answers')
    await page.unmount()
  })

  test('done after three right in a row on two different answers, and a seed already played is never drawn again', async () => {
    const [a, b, c] = [seedWithTruth(knee, 1), seedWithTruth(knee, 1.25), seedsWhere(knee, 1, true)[0]]
    // freshSeed() hands out `b` twice: the second draw is a seed already played, so the panel skips it without a run
    const r = rig([a, b, b, c])
    const page = await open(r)
    await draw(page)
    for (const s of [a, b, c]) {
      await predict(page, knee.truth(sweepOf(knee, s)))
      await explainAndSave(page)
      if (s !== c) await another(page)
    }
    expect(r.runs).toEqual([a, b, c])
    expect(progress(page)).toBe('3/3 · done')
    expect(r.recorded.filter((e) => e.kind === 'item').map((e) => e.seed)).toEqual([a, b, c])
    expect(r.recorded.filter((e) => e.kind === 'predict').map((e) => e.seed)).toEqual([a, b, c])
    // nothing locks: another seed is drawn and asked
    await another(page)
    expect(page.container.textContent).toContain('3 right predictions in a row on new seeds, on at least 2 different answers. Done. There are always more seeds.')
    expect(q(page, '[data-fleet-predict]')).not.toBeNull()
    await page.unmount()
  })

  test('three right that all name the same answer are not done, and the progress line says why', async () => {
    const same = seedsWhere(knee, 40, true).filter((s) => knee.truth(sweepOf(knee, s)) === 0.75).slice(0, 3)
    const r = rig(same)
    const page = await open(r)
    await draw(page)
    for (const s of same) {
      await predict(page, 0.75)
      await explainAndSave(page)
      if (s !== same[2]) await another(page)
    }
    expect(progress(page)).toBe('3/3 right in a row · 1/2 different answers')
    expect(q(page, '[data-fleet-done]')).toBeNull()
    await page.unmount()
  })

  test('a sweep that is not a fair question is dropped and another seed drawn, so the learner sees only the fair one', async () => {
    const [unfair] = seedsWhere(knee, 1, false)
    const [fair] = seedsWhere(knee, 1, true)
    const r = rig([unfair, fair])
    const page = await open(r)
    await draw(page)
    expect(r.runs).toEqual([unfair, fair])
    expect(q(page, '[data-seed]').textContent).toContain(`Seed ${fair}`)
    await page.unmount()
  })

  test('after a reload the count comes from the ledger: 3/3 · done, the earlier rounds listed, nothing asked or run', async () => {
    const [a, b, c] = [seedWithTruth(knee, 1), seedWithTruth(knee, 1.5), seedsWhere(knee, 1, true)[0]]
    const [d] = seedsWhere(knee, 2, true).filter((s) => s !== c)
    const history: ExerciseEvent[] = [a, b, c].flatMap((s, i) => {
      const round = savedRound(knee, s, knee.truth(sweepOf(knee, s)))
      return [...(i === 0 ? [predictEvent(knee, CTX, round)] : []), itemEvent(knee, CTX, round)].map((e, j) =>
        exerciseEventOf(e, new Date(T0 + (i * 2 + j) * 1000).toISOString(), `h${i}${j}`),
      )
    })
    const r = rig([a, d], {}, history)
    const page = await open(r)
    expect(progress(page)).toBe('3/3 · done')
    expect(page.container.textContent).toContain('3 right predictions in a row on new seeds, on at least 2 different answers. Done.')
    expect(page.container.querySelectorAll('[data-fleet-played] li')).toHaveLength(3)
    expect(r.runs).toHaveLength(0)
    // the block's first prediction is already on the ledger: a new round's lock writes a marker without a confidence, and its save an item
    await draw(page)
    expect(r.runs).toEqual([d]) // `a` was played, so it was skipped without a run
    await predict(page, knee.truth(sweepOf(knee, d)))
    expect(r.recorded.map((e) => e.kind)).toEqual(['predict'])
    expect(r.recorded[0]).not.toHaveProperty('conf')
    expect(r.recorded[0].data).toMatchObject({ nsec: 0 })
    await explainAndSave(page)
    expect(r.recorded.map((e) => e.kind)).toEqual(['predict', 'item'])
    await page.unmount()
  })

  /** The ledger as a later mount reads it: what an earlier one recorded, stamped after `before`. */
  const ledgerOf = (before: ExerciseEvent[], recorded: ItemResponse[]): ExerciseEvent[] => [
    ...before,
    ...recorded.map((e, i) => exerciseEventOf(e, new Date(T0 + 100000 + i * 1000).toISOString(), `n${i}`)),
  ]
  /** Two saved right rounds on different answers (the first with the block's one confidence-carrying predict): a run of 2. */
  function tworights(): { history: ExerciseEvent[]; seeds: number[] } {
    const [a, b] = [seedWithTruth(knee, 1), seedWithTruth(knee, 1.25)]
    const history = [a, b].flatMap((s, i) => {
      const round = savedRound(knee, s, knee.truth(sweepOf(knee, s)))
      return [predictEvent(knee, CTX, round, i === 0), itemEvent(knee, CTX, round)].map((e, j) => exerciseEventOf(e, new Date(T0 + (i * 2 + j) * 1000).toISOString(), `h${i}${j}`))
    })
    return { history, seeds: [a, b] }
  }
  const RUN_OF_TWO = '2/3 right in a row · 2/2 different answers'

  test('navigating away after a wrong verdict cannot erase the miss: the lock was recorded, so the run starts again when the panel returns', async () => {
    const { history, seeds } = tworights()
    const [c, d] = seedsWhere(knee, 3, true).filter((s) => !seeds.includes(s))
    const r = rig([c, d], {}, history)
    const page = await open(r)
    expect(progress(page)).toBe(RUN_OF_TWO)
    await draw(page)
    await predict(page, wrongOn(knee, c))
    // the round is open in this tab: its miss is not on the count yet, and the lock is already on the ledger
    expect(progress(page)).toBe(RUN_OF_TWO)
    expect(r.recorded.map((e) => [e.kind, e.ok, e.seed])).toEqual([['predict', false, c]])
    await page.unmount() // the learner follows a link out of the lesson, with the explain step unsaved

    const back = rig([c, d], {}, ledgerOf(history, r.recorded))
    const again = await open(back)
    expect(progress(again)).toBe(START)
    const played = again.container.querySelectorAll('[data-fleet-played] li')
    expect(played).toHaveLength(3)
    expect(played[2].textContent).toContain('left before saving, counts as off')
    expect(q(again, '[data-fleet-done]')).toBeNull()
    // the abandoned seed is not asked again
    await draw(again)
    expect(back.runs).toEqual([d])
    await again.unmount()
  })

  test('a reload after a right lock that was never saved is a miss too, and three more rights still finish it', async () => {
    const { history, seeds } = tworights()
    const [c, d, e, f] = seedsWhere(knee, 6, true).filter((s) => !seeds.includes(s))
    const r = rig([c], {}, history)
    const page = await open(r)
    await draw(page)
    await predict(page, knee.truth(sweepOf(knee, c))) // right at the lock; the page is reloaded before the save
    expect(q(page, '[data-verdict]').getAttribute('data-verdict')).toBe('right')
    await page.unmount()

    const reloaded = rig([d, e, f], {}, ledgerOf(history, r.recorded))
    const again = await open(reloaded)
    expect(progress(again)).toBe(START) // a right that was never saved is not a pass
    expect(again.container.querySelectorAll('[data-fleet-played] li')).toHaveLength(3)
    await draw(again)
    for (const s of [d, e, f]) {
      await predict(again, knee.truth(sweepOf(knee, s)))
      await explainAndSave(again)
      if (s !== f) await another(again)
    }
    // d, e, f are three rights in a row on fresh seeds; whether they are two different answers is the done rule's, not this test's
    expect(reloaded.runs).toEqual([d, e, f])
    expect(readExercise(ledgerOf(ledgerOf(history, r.recorded), reloaded.recorded), AT).passes).toBe(5)
    await again.unmount()
  })

  test('a round saved after its lock is one round: the count moves once and nothing is listed as left', async () => {
    const { history, seeds } = tworights()
    const [c] = seedsWhere(knee, 3, true).filter((s) => !seeds.includes(s))
    const r = rig([c], {}, history)
    const page = await open(r)
    await draw(page)
    await predict(page, wrongOn(knee, c))
    await explainAndSave(page)
    expect(progress(page)).toBe(START)
    expect(page.container.textContent).not.toContain('left before saving')
    await page.unmount()
    const again = await open(rig([], {}, ledgerOf(history, r.recorded)))
    expect(progress(again)).toBe(START)
    expect(again.container.textContent).not.toContain('left before saving')
    expect(again.container.querySelectorAll('[data-fleet-played] li')).toHaveLength(3)
    await again.unmount()
  })

  test('the lesson’s own block shows its note once the exercise is done, and not before', async () => {
    const real = lessonById(LESSON)!.blocks.find((b): b is FleetExerciseBlock => b.type === 'exercise' && 'fleet' in b)!
    const [a, b, c] = [seedWithTruth(knee, 1), seedWithTruth(knee, 1.5), seedsWhere(knee, 1, true)[0]]
    const history: ExerciseEvent[] = [a, b, c].flatMap((s, i) => {
      const round = savedRound(knee, s, knee.truth(sweepOf(knee, s)))
      return [itemEvent(knee, CTX, round)].map((e) => exerciseEventOf(e, new Date(T0 + i * 1000).toISOString(), `h${i}`))
    })
    const early = await open(rig([]), { block: real })
    expect(q(early, '[data-fleet-note]')).toBeNull()
    await early.unmount()
    const done = await open(rig([], {}, history), { block: real })
    expect(progress(done)).toBe('3/3 · done')
    const note = q(done, '[data-fleet-note]')
    expect(note.textContent).toContain('What just happened')
    expect(note.textContent).toContain('Each seed puts its knee at one of four loads')
    expect(note.textContent).toContain("Little's law")
    await done.unmount()
  })

  // The note states the answer rule ("peaks near the load that reaches it, usually a little below"), so it must not show
  // before a prediction: in embed mode it waits for done, in phone mode for the lock on the canonical seed (F1).
  const realBlock = (lessonId: string) => lessonById(lessonId)!.blocks.find((b): b is FleetExerciseBlock => b.type === 'exercise' && 'fleet' in b)!
  const realIndex = (lessonId: string) => lessonById(lessonId)!.blocks.findIndex((b) => b.type === 'exercise' && 'fleet' in b)
  const RULE: Record<string, string> = { knee: 'usually a little below', 'pd-split': 'about balanced' }
  const buttonNamed = (page: Mounted, name: string) => page.container.querySelectorAll('button').find((b) => (b.textContent ?? '').trim() === name) as MiniElement

  test.each([
    ['knee', 't7.l2'],
    ['pd-split', 't6.l3'],
  ] as const)('phone mode (%s): the note is hidden before the lock, a refused answer does not open it, the lock does', async (id, lessonId) => {
    const def = FLEET_EXERCISES[id]
    const real = realBlock(lessonId)
    const index = realIndex(lessonId)
    expect(real.fleet).toBe(id)
    expect(real.note).toContain(RULE[id])
    const r = rig([])
    const page = await open(r, { block: real, lessonId, index, env: { ...r.env, mode: 'phone' } })
    expect(q(page, '[data-phone]')).not.toBeNull()
    expect(q(page, '[data-fleet-note]')).toBeNull()
    expect(page.container.textContent).not.toContain(RULE[id])
    // a value that is not a point of the sweep is refused, and nothing is shown
    await type(q(page, '[data-fleet-predict]'), '99')
    await dom.press(q(page, '[data-fleet-lock]'))
    expect(page.container.querySelector('[role="alert"]')!.textContent).toContain('Enter one of the points')
    expect(q(page, '[data-fleet-note]')).toBeNull()
    // the lock shows the canonical outcome, and the note with it
    await type(q(page, '[data-fleet-predict]'), String(wrongOn(def, def.phone.seed)))
    await dom.press(q(page, '[data-fleet-lock]'))
    expect(q(page, '[data-verdict]')).not.toBeNull()
    const note = q(page, '[data-fleet-note]')
    expect(note.textContent).toContain('What just happened')
    expect(note.textContent).toContain(RULE[id])
    // the outcome took focus from the lock button, which is gone
    expect(dom.document.activeElement).toBe(q(page, '[data-verdict]'))
    // a forced mode stays phone, so "run it here" is e2e/fleet-exercise.spec.ts's, which finds the note gone in embed mode
    expect(buttonNamed(page, 'Run it on a fresh seed here instead')).toBeDefined()
    expect(r.recorded).toHaveLength(0)
    await page.unmount()
  })

  test('embed mode: the note is hidden before the lock, after the lock and after a save that does not finish the exercise', async () => {
    const real = realBlock(LESSON)
    const [a] = seedsWhere(knee, 1, true)
    const r = rig([a])
    const page = await open(r, { block: real })
    expect(q(page, '[data-fleet-note]')).toBeNull()
    await draw(page)
    expect(q(page, '[data-fleet-note]')).toBeNull()
    await predict(page, knee.truth(sweepOf(knee, a)))
    expect(q(page, '[data-verdict]').getAttribute('data-verdict')).toBe('right')
    expect(q(page, '[data-fleet-note]')).toBeNull()
    await explainAndSave(page)
    expect(progress(page)).toBe('1/3 right in a row · 1/2 different answers')
    expect(q(page, '[data-fleet-note]')).toBeNull()
    expect(page.container.textContent).not.toContain(RULE.knee)
    await page.unmount()
  })

  test('another block’s events do not count here', async () => {
    const [a] = seedsWhere(knee, 1, true)
    const round = savedRound(knee, a, knee.truth(sweepOf(knee, a)))
    const history = [exerciseEventOf(itemEvent(knee, { lessonId: LESSON, index: BLOCK + 3 }, round), new Date(T0).toISOString(), 'x')]
    const page = await open(rig([a], {}, history))
    expect(progress(page)).toBe(START)
    expect(q(page, '[data-fleet-played]')).toBeNull()
    await page.unmount()
  })

  test('a worker failure is said in words in an alert, nothing is asked yet, and running it again works', async () => {
    const [a] = seedsWhere(knee, 1, true)
    let fail = true
    const r = rig([a, a], {
      run: async (id, seed) => {
        if (fail) throw Object.assign(new Error('boom'), { name: 'FleetTimeoutError' })
        return sweepOf(FLEET_EXERCISES[id], seed)
      },
    })
    const page = await open(r)
    await dom.press(q(page, '[data-fleet-draw]'))
    await dom.until(() => page.container.querySelector('[role="alert"]') !== null)
    expect(page.container.querySelector('[role="alert"]')!.textContent).toContain('The sweep took too long')
    expect(q(page, '[data-fleet-predict]')).toBeNull()
    expect(r.recorded).toHaveLength(0)
    fail = false
    await dom.press(q(page, '[data-fleet-retry]'))
    await dom.until(() => q(page, '[data-fleet-predict]') !== null)
    expect(page.container.querySelector('[role="alert"]')).toBeNull()
    expect(q(page, '[data-seed]').textContent).toContain(`Seed ${a}`)
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
    expect(q(page, '[data-fleet-draw]')).toBeNull()
    ok = true
    await dom.press(page.container.querySelector('[role="alert"] button') as MiniElement)
    await dom.until(() => q(page, '[data-fleet-draw]') !== null)
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

  test('the P:D split mounts with its own copy and its disaggregation rows, shows its lengths, and predicts a worker count', async () => {
    const [a] = seedsWhere(pd, 1, true)
    const r = rig([a])
    const page = await open(r, { block: block('pd-split'), lessonId: 't6.l3', index: 2 })
    expect(page.container.textContent).toContain('8 identical workers')
    const rows = page.container.querySelectorAll('[data-production] li')
    expect(rows.map((li) => li.getAttribute('data-claim'))).toEqual(pd.productionClaims)
    expect(rows[1].textContent).toContain('--disaggregation-mode prefill|decode')
    await draw(page)
    expect(page.container.textContent).toContain('one of 1, 2, 3, 4, 5, 6, 7')
    for (const f of pd.scene(a)) expect(q(page, '[data-fleet-scene]').textContent).toContain(sceneLine(f))
    await predict(page, pd.truth(sweepOf(pd, a)))
    expect(q(page, '[data-verdict]').textContent).toContain('prefill')
    expect(page.container.textContent).toContain('TPOT p95 (ms)')
    await explainAndSave(page)
    expect(r.recorded.map((e) => e.ref)).toEqual(['item:fleet.pd-split', 'item:fleet.pd-split'])
    expect(r.recorded[1].data).toMatchObject({ grp: 't6.l3#2', lessonId: 't6.l3' })
    await page.unmount()
  })

  test('phone mode shows the canonical seed’s scene, asks for the number, then shows its outcome with the table open, and writes and runs nothing', async () => {
    const r = rig([])
    const page = await open(r, { env: { ...r.env, mode: 'phone' } })
    expect(q(page, '[data-phone]')).not.toBeNull()
    const scene = q(page, '[data-fleet-scene]')
    expect(scene.textContent).toContain(`Seed ${knee.phone.seed}, the same on every phone`)
    for (const f of knee.scene(knee.phone.seed)) expect(scene.textContent).toContain(sceneLine(f))
    expect(q(page, '[data-fleet-predict]').getAttribute('aria-describedby')!.split(' ')).toContain(scene.getAttribute('id'))
    await type(q(page, '[data-fleet-predict]'), '1.3')
    await dom.press(q(page, '[data-fleet-lock]'))
    expect(page.container.querySelector('[role="alert"]')!.textContent).toContain('Enter one of the points')
    expect(q(page, '[data-sweep-chart]')).toBeNull()
    const canonical = knee.phone.canonical
    expect(canonical).toEqual(sweepOf(knee, knee.phone.seed))
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
    await type(q(page, '[data-fleet-predict]'), String(wrongOn(knee, knee.phone.seed)))
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
