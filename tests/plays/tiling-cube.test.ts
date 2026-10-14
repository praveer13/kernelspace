/**
 * The Tiling Cube in 2D (docs/specs/wave-3.md §6.3-6.4, task 3b-01): its registration, the session model, the controls
 * and their limits, the three face views and the DOM table, the debriefs, the In-production card and what reaches the
 * ledger. The model's own numbers are tests/world/tiling.test.ts's; these tests hold the play to them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Debrief from '../../src/components/play/tiling-cube/Debrief'
import Level, { ViewsFailed } from '../../src/components/play/tiling-cube/Level'
import Mirror from '../../src/components/play/tiling-cube/Mirror'
import Mirror2D from '../../src/components/play/tiling-cube/Mirror2D'
import Views from '../../src/components/play/tiling-cube/Views'
import TilingCubePlay, { DebriefFailed, DebriefLoading } from '../../src/components/play/tiling-cube/Play'
import ProductionCard from '../../src/components/play/tiling-cube/ProductionCard'
import { PLAY_REGISTRY, resolvePlay } from '../../src/components/play/registry'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { KCS } from '../../src/data/kc'
import { pathPlan, playStep } from '../../src/lib/learner/paths'
import { recommend, type RecommendContent, type RecommendState } from '../../src/lib/learner/recommend'
import {
  CUBE_KCS,
  CUBE_PLAY_ID,
  DTYPES,
  LADDERS,
  LEVEL_COUNT,
  PREDICT_NSEC,
  RIGHT_FACTOR,
  checkEvent,
  choose,
  chooseControl,
  closingHeadline,
  controlsFor,
  errorLine,
  exploreFor,
  fixed,
  freshSession,
  genOf,
  layoutFaces,
  layoutWave,
  levelOf,
  levelsRight,
  nextLevel,
  normalize,
  nudge,
  openViews,
  practiceSession,
  predictChecker,
  predictEvent,
  predictedInstance,
  predictedOf,
  readout,
  recordOf,
  ridgeOf,
  stepControl,
  stepOn,
  tableOf,
  toCheck,
  toDebrief,
  wavesOf,
  withChecked,
  withPrediction,
  type ControlId,
  type CubeSession,
  type Explore,
  type NumberControl,
} from '../../src/components/play/tiling-cube/session'
import { CLAIMS, byId } from '../../src/data/claims/all'
import { KC } from '../../src/data/kc/ids'
import { PLAYS, PLAY_IDS, PLAY_PRODUCTION_ROWS, TILING_CUBE, TILING_CUBE_PRODUCTION_ROWS, getPlay } from '../../src/data/plays'
import { PLAY_MINUTES } from '../../src/lib/economy-table'
import { PREDICT_FACTOR, lessonItemResponse, predictGen, predictInstance, predictResponse } from '../../src/lib/learner/item-block'
import { PRE_NSEC } from '../../src/lib/learner/prequestions'
import { gradeItem, resultFor, type ItemResult } from '../../src/lib/items/play'
import type { Instance, PlayableItem } from '../../src/lib/items/types'
import { checkCubeBand } from '../../src/lib/world/bands/tiling-cube'
import { BASE, CUBE_LEVELS, CUBE_PRACTICE_SEED, H100, ctasPerSm, ridge, type CubeLevel } from '../../src/lib/world/tiling'
import { checkPlay, closureOf, practiceBandOf, type PlayFacts, type PlayWorld } from '../../scripts/verify-plays'
import { installDom, type DomKit } from '../dom/mini-dom'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = join(import.meta.dir, '..', '..')
const SRC = join(ROOT, 'src')
const CUBE_DIR = join(SRC, 'components', 'play', 'tiling-cube')

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

/** What the item card hands back for a numeric answer: the estimate or the exact response, graded by the family. */
function answerItem(s: CubeSession, n: number, value: number, as: 'predict' | 'check'): ItemResult {
  const level = CUBE_LEVELS[n]
  const inst: Instance = s.runs[n].inst
  const gen = genOf(level)
  if (as === 'predict') {
    const a = inst.answer
    if (a.kind === 'choice') throw new Error('the cube asks numbers')
    const asked: Instance = { ...inst, answer: { kind: 'estimate', truth: a.truth, unit: a.unit, okWithinFactor: RIGHT_FACTOR, interval: true } }
    const item: PlayableItem = { source: 'gen', inst: asked }
    const response = { kind: 'estimate' as const, value }
    return resultFor(item, response, gradeItem(item, response, gen), { seed: inst.seed, ms: 1000 })
  }
  const item: PlayableItem = { source: 'gen', inst }
  const unit = inst.answer.kind === 'choice' ? undefined : inst.answer.unit
  const response = { kind: 'numeric' as const, value, ...(unit ? { unit } : {}) }
  return resultFor(item, response, gradeItem(item, response, gen), { seed: inst.seed, ms: 1000 })
}

const truthOfRun = (s: CubeSession, n: number): number => {
  const a = s.runs[n].inst.answer
  if (a.kind === 'choice') throw new Error('the cube asks numbers')
  return a.truth
}

/** Plays a session to the closing debrief, predicting `truth × factor(n)` and checking with the truth. */
function playOut(s0: CubeSession, factor: (n: number) => number = () => 1): CubeSession {
  let s = s0
  for (let n = 0; n < LEVEL_COUNT; n++) {
    const truth = truthOfRun(s, n)
    s = withPrediction(s, predictedOf(answerItem(s, n, truth * factor(n), 'predict'), s.runs[n].inst))
    s = openViews(s)
    s = toCheck(s)
    s = withChecked(s, answerItem(s, n, truth, 'check').ok)
    s = toDebrief(s)
    s = nextLevel(s)
  }
  return s
}

const NUMBER_CONTROLS: NumberControl[] = ['tm', 'tn', 'k', 'stages', 'm', 'n', 'group', 'seq', 'd', 'br']

/* ------------------------------------------------------------------ */
/* registration                                                         */
/* ------------------------------------------------------------------ */

describe('registration (§6.3)', () => {
  test('the cube is T4.L6’s play: 25 minutes, the six KCs of the levels, tied to the world and the economy', () => {
    expect(TILING_CUBE.id).toBe(CUBE_PLAY_ID)
    expect(TILING_CUBE.id).toBe('tiling-cube')
    expect(TILING_CUBE.lessonId).toBe('t4.l6')
    expect(TILING_CUBE.minutes).toBe(25)
    expect(PLAY_MINUTES[TILING_CUBE.id]).toBe(TILING_CUBE.minutes)
    expect(TILING_CUBE.turnCap).toBe(LEVEL_COUNT)
    expect([...TILING_CUBE.kcs]).toEqual(CUBE_LEVELS.map((l) => l.kc))
    expect([...TILING_CUBE.kcs]).toEqual([...CUBE_KCS])
    const known = new Set<string>(Object.values(KC))
    for (const k of TILING_CUBE.kcs) expect([k, known.has(k)]).toEqual([k, true])
    expect(getPlay('tiling-cube')).toBe(TILING_CUBE)
    expect(PLAY_IDS.slice(0, 3)).toEqual(['block-placement', 'scheduler', 'tiling-cube'])
    expect(PLAYS[TILING_CUBE.id]).toBe(TILING_CUBE)
  })

  test('the registry loads it on demand, and the Play.tsx it names exists', () => {
    const r = resolvePlay('tiling-cube')
    expect(r.kind).toBe('play')
    if (r.kind === 'play') expect(r.entry.intro.length).toBeGreaterThan(0)
    expect(Object.keys(PLAY_REGISTRY)).toContain('tiling-cube')
    expect(readFileSync(join(SRC, 'components', 'play', 'registry.ts'), 'utf8')).toContain("import('@/components/play/tiling-cube/Play')")
  })

  test('src/data/plays.ts imports no lazy claim group, so the eager chunk does not grow (D19)', () => {
    const text = readFileSync(join(SRC, 'data', 'plays.ts'), 'utf8')
    expect(text).not.toMatch(/from '@\/data\/claims\/lazy|from '\.\.?\/claims\/lazy|data\/claims\/lazy/)
  })

  test('the lesson and the economy see it: a play step follows t4.l6 (paths), rule 5 offers it there, and the play pays its price', () => {
    const content: RecommendContent = { kcs: KCS, lessons: ALL_LESSONS, labs: FORGE_LABS, plays: [TILING_CUBE] }
    // paths: the step right after the host lesson, on the full ramp (the one path that has t4.l6)
    const { steps, lessons } = pathPlan('full-ramp', content)
    const at = steps.indexOf('t4.l6')
    expect(at).toBeGreaterThan(-1)
    expect(steps[at + 1]).toBe(playStep('tiling-cube'))
    expect(pathPlan('full-ramp', { ...content, plays: [] }).steps).not.toContain(playStep('tiling-cube'))
    // rule 5: the lesson passed and the play not debriefed offers it; debriefed, or before the host, it does not
    const state = (done: number, plays: RecommendState['plays'] = {}): RecommendState => ({
      bootDone: true,
      lessons: Object.fromEntries(lessons.slice(0, done).map((id) => [id, { status: 'done' as const, lastVisitedAt: '2026-10-04T12:00:00.000Z' }])),
      labs: {},
      path: 'full-ramp',
      placement: null,
      today: null,
      plays,
    })
    const now = '2026-10-05T12:00:00.000Z'
    const host = lessons.indexOf('t4.l6') + 1
    expect(recommend(state(host), content, now, 'phone')).toMatchObject({ kind: 'play', ref: 'tiling-cube', to: '/play/tiling-cube', minutes: TILING_CUBE.minutes })
    expect(recommend(state(host, { 'tiling-cube': { done: true } }), content, now, 'phone').kind).toBe('lesson')
    expect(recommend(state(host - 1), content, now, 'phone').kind).toBe('lesson')
    // the economy: its price is the registration's 25 minutes, paid once for the `play:tiling-cube` fact
    expect(PLAY_MINUTES['tiling-cube']).toBe(25)
  })
})

/* ------------------------------------------------------------------ */
/* the session                                                          */
/* ------------------------------------------------------------------ */

describe('the session (§6.3)', () => {
  test('the practice session is six items on the pinned seed: level 1 from roofline/tile-ai, levels 2-6 from the tiling family', () => {
    const s = practiceSession()
    expect(s.seed).toBe(CUBE_PRACTICE_SEED)
    expect(s.provenance).toBe('practice')
    expect(s.step).toBe('predict')
    expect(s.at).toBe(0)
    expect(s.runs).toHaveLength(LEVEL_COUNT)
    expect(s.runs.map((r) => `${r.inst.family}/${r.inst.variant}`)).toEqual(['roofline/tile-ai', 'tiling/smem-fit', 'tiling/ctas-per-sm', 'tiling/raster-ai', 'tiling/fp8-ridge', 'tiling/qblock-ai'])
    expect(s.runs.map((r) => r.inst.seed)).toEqual(new Array(LEVEL_COUNT).fill(CUBE_PRACTICE_SEED))
    for (const r of s.runs) expect(r.inst.answer.kind).not.toBe('choice')
    expect(CUBE_LEVELS.map((l) => l.family)).toEqual(['roofline', 'tiling', 'tiling', 'tiling', 'tiling', 'tiling'])
  })

  test('new numbers draw a seed that is in the cube’s band, deterministic in the entropy, and unseen', () => {
    for (const entropy of [1, 2, 3, 99991, 0xdeadbeef]) {
      const s = freshSession(entropy)
      expect(checkCubeBand(s.seed).inBand).toBe(true)
      expect(s.provenance).toBe(s.seed === CUBE_PRACTICE_SEED ? 'practice' : 'unseen')
      expect(freshSession(entropy).seed).toBe(s.seed)
    }
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((e) => freshSession(e).seed))
    expect(seeds.size).toBeGreaterThan(1)
    expect([...seeds].filter((x) => x !== CUBE_PRACTICE_SEED).length).toBeGreaterThan(0)
  })

  test('the cube’s band rejects most seeds, which is why the practice walk and the e2e stand on the pinned one', () => {
    const inBand = Array.from({ length: 60 }, (_, i) => checkCubeBand(i * 7 + 3).inBand).filter(Boolean).length
    expect(inBand).toBeLessThan(60)
    expect(checkCubeBand(CUBE_PRACTICE_SEED).inBand).toBe(true)
  })

  test('the steps go in order: predict, then the views, then the check, then the debrief, then the next level', () => {
    let s = practiceSession()
    // nothing opens before its predecessor
    expect(openViews(s)).toBe(s)
    expect(toCheck(s)).toBe(s)
    expect(toDebrief(s)).toBe(s)
    expect(nextLevel(s)).toBe(s)
    expect(nudge(s, 'tm', 1)).toBe(s)
    expect(choose(s, 'dtype', 'fp8')).toBe(s)
    s = withPrediction(s, predictedOf(answerItem(s, 0, 64, 'predict'), s.runs[0].inst))
    expect(s.step).toBe('predict')
    expect(withPrediction(s, { value: 1, truth: 1, unit: 'x', ok: true })).toBe(s) // a second prediction is ignored
    s = openViews(s)
    expect(s.step).toBe('explore')
    expect(toDebrief(s)).toBe(s)
    s = toCheck(s)
    expect(s.step).toBe('check')
    expect(toDebrief(s)).toBe(s) // not before the check is answered
    s = withChecked(s, true)
    expect(withChecked(s, false)).toBe(s)
    s = toDebrief(s)
    expect(s.step).toBe('debrief')
    s = nextLevel(s)
    expect(s).toMatchObject({ at: 1, step: 'predict' })
    expect(levelOf(s).n).toBe(2)
  })

  test('six levels end in the closing debrief, which is where the play is recorded', () => {
    expect(recordOf(practiceSession())).toBeNull()
    const s = playOut(practiceSession())
    expect(s).toMatchObject({ at: LEVEL_COUNT, step: 'closing' })
    expect(nextLevel(s)).toBe(s)
    expect(levelsRight(s)).toBe(LEVEL_COUNT)
  })

  test('each level opens its scene on the item’s own numbers', () => {
    const s = practiceSession()
    const scenes = CUBE_LEVELS.map((l, i) => exploreFor(l, s.runs[i].inst))
    const p = s.runs[0].inst.params
    expect(scenes[0]).toMatchObject({ tm: Number(p.tm), tn: Number(p.tn) })
    const q = s.runs[5].inst.params
    expect(scenes[5]).toMatchObject({ seq: Number(q.seq) || 32768, d: Number(q.d) || 128, br: Number(q.br) || 128 })
    // a scene is always one the model prices
    for (const e of scenes) expect(() => tableOf(CUBE_LEVELS[0], e)).not.toThrow()
  })

  test('the wording of the prediction’s error: the value, the model’s, the factor, and whether it is inside the factor of 2', () => {
    const s = practiceSession()
    const level1 = answerItem(s, 0, truthOfRun(s, 0) * 3, 'predict')
    const p = predictedOf(level1, s.runs[0].inst)
    expect(p.ok).toBe(false)
    expect(p.logErr).toBeCloseTo(Math.log10(3), 6)
    expect(errorLine(p)).toContain('You predicted')
    expect(errorLine(p)).toContain('off by a factor of 3.00')
    expect(errorLine(p)).toContain('outside the factor of 2 that counts as right')
    const near = predictedOf(answerItem(s, 0, truthOfRun(s, 0) * 1.5, 'predict'), s.runs[0].inst)
    expect(near.ok).toBe(true)
    expect(errorLine(near)).toContain('inside the factor of 2 that counts as right')
    expect(errorLine({ value: 0, truth: 64, unit: 'FLOP/B', ok: false })).toContain('cannot compare')
  })
})

/* ------------------------------------------------------------------ */
/* the ledger                                                           */
/* ------------------------------------------------------------------ */

describe('the ledger (§6.3)', () => {
  test('a prediction is a `predict` event and a check an `item` event, both src play, on the level’s own ref', () => {
    const s = practiceSession()
    for (let n = 0; n < LEVEL_COUNT; n++) {
      const inst = s.runs[n].inst
      const truth = truthOfRun(s, n)
      const p = predictEvent(s, n, answerItem(s, n, truth * 1.2, 'predict'))
      expect(p).toMatchObject({ kind: 'predict', ref: `gen:${inst.family}/${inst.variant}`, data: { src: 'play', truth, value: truth * 1.2, grp: `play:tiling-cube#${n}`, lessonId: 't4.l6' } })
      const c = checkEvent(s, n, answerItem(s, n, truth, 'check'))
      expect(c).toMatchObject({ kind: 'item', ref: `gen:${inst.family}/${inst.variant}`, ok: true, provenance: 'practice', data: { src: 'play', grp: `play:tiling-cube#${n}`, truth } })
      expect(c.data).not.toHaveProperty('slot')
      expect(c.data).not.toHaveProperty('reason')
    }
  })

  test('the events are the lesson block’s writes with the play as their source: the same fields, the same values (the copy keeps item-block out of the chunk)', () => {
    expect(RIGHT_FACTOR).toBe(PREDICT_FACTOR)
    expect(PREDICT_NSEC).toBe(PRE_NSEC)
    const s = practiceSession()
    for (let n = 0; n < LEVEL_COUNT; n++) {
      const inst = s.runs[n].inst
      expect(predictedInstance(inst)).toEqual(predictInstance(inst))
      const gen = genOf(CUBE_LEVELS[n])
      const asked = predictedInstance(inst)
      const a = predictGen(gen)
      const b = predictChecker(gen)
      for (const f of [0.4, 1, 1.7, 5]) {
        const response = { kind: 'estimate' as const, value: truthOfRun(s, n) * f, lo: truthOfRun(s, n) * f * 0.5, hi: truthOfRun(s, n) * f * 2 }
        expect(b.grade(asked, response)).toEqual(a.grade(asked, response))
      }
      expect(b.solution(asked)).toEqual([])
      const pr = answerItem(s, n, truthOfRun(s, n) * 1.7, 'predict')
      const lessonP = predictResponse(predictInstance(inst), pr, { lessonId: 't4.l6', blockIndex: n })
      expect(predictEvent(s, n, pr)).toEqual({ ...lessonP, data: { ...lessonP.data, src: 'play', grp: `play:tiling-cube#${n}` } })
      for (const f of [1, 0.3]) {
        const cr = answerItem(s, n, truthOfRun(s, n) * f, 'check')
        const lessonC = lessonItemResponse(cr, { source: 'gen', inst }, { lessonId: 't4.l6', blockIndex: n }, new Set<string>())
        expect(checkEvent(s, n, cr)).toEqual({ ...lessonC, provenance: 'practice', data: { ...lessonC.data, src: 'play', grp: `play:tiling-cube#${n}` } })
      }
    }
  })

  test('a session on new numbers writes unseen items; the practice session writes practice ones', () => {
    const s = freshSession(7)
    if (s.provenance === 'unseen') {
      expect(checkEvent(s, 0, answerItem(s, 0, truthOfRun(s, 0), 'check')).provenance).toBe('unseen')
    }
    const practice = practiceSession()
    expect(checkEvent(practice, 0, answerItem(practice, 0, 1, 'check')).provenance).toBe('practice')
  })

  test('recordPlay: phase play, turns 6, survived = predictions inside a factor of 2, ghostSurvived 6, one entry per level', () => {
    // levels 1, 3 and 5 are predicted 4× high, the rest are exact
    const s = playOut(practiceSession(), (n) => (n % 2 === 0 ? 4 : 1))
    const r = recordOf(s, 4200)
    if (!r) throw new Error('no result')
    expect(r).toMatchObject({ playId: 'tiling-cube', ok: true, seed: CUBE_PRACTICE_SEED, provenance: 'practice', ms: 4200 })
    expect(r.score).toBeCloseTo(3 / 6, 10)
    expect(r.data).toMatchObject({ phase: 'play', turns: 6, survived: 3, ghostSurvived: 6, kcs: [...CUBE_KCS] })
    expect(r.data.levels?.map((l) => l.id)).toEqual(['count', 'smem', 'occupancy', 'raster', 'fp8', 'flash'])
    expect(r.data.levels?.map((l) => l.ok)).toEqual([false, true, false, true, false, true])
    for (const l of r.data.levels ?? []) expect(l.logErr).toBeCloseTo(l.ok ? 0 : Math.log10(4), 3)
  })

  test('the events pass the ledger’s codec and fold: six predictions, six items and one play that marks the cube done', async () => {
    const tab = startTab(makeProfile())
    const s0 = practiceSession()
    let s = s0
    for (let n = 0; n < LEVEL_COUNT; n++) {
      const truth = truthOfRun(s, n)
      const pr = answerItem(s, n, truth * 1.3, 'predict')
      tab.progress.getState().recordItems([predictEvent(s, n, pr)])
      s = withPrediction(s, predictedOf(pr, s.runs[n].inst))
      s = toCheck(openViews(s))
      const cr = answerItem(s, n, truth, 'check')
      tab.progress.getState().recordItems([checkEvent(s, n, cr)])
      s = nextLevel(toDebrief(withChecked(s, cr.ok)))
    }
    const result = recordOf(s, 1000)
    if (!result) throw new Error('no result')
    tab.progress.getState().recordPlay(result)
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'predict')).toHaveLength(LEVEL_COUNT)
    expect(events.filter((e) => e.kind === 'item')).toHaveLength(LEVEL_COUNT)
    const plays = events.filter((e) => e.kind === 'play')
    expect(plays).toHaveLength(1)
    expect(plays[0]).toMatchObject({ ref: 'play:tiling-cube', ok: true, provenance: 'practice', seed: CUBE_PRACTICE_SEED, score: 1, data: { phase: 'play', turns: 6, survived: 6, ghostSurvived: 6 } })
    expect((plays[0].data as { levels: unknown[] }).levels).toHaveLength(6)
    for (const e of events.filter((x) => x.kind === 'predict' || x.kind === 'item')) expect((e.data as { src: string }).src).toBe('play')
    expect(tab.progress.getState().aggregate.plays['tiling-cube']).toMatchObject({ done: true })
  })
})

/* ------------------------------------------------------------------ */
/* the controls                                                         */
/* ------------------------------------------------------------------ */

describe('the controls and their limits (WCAG 2.5.7, AF3)', () => {
  test('a ladder step goes to the next whole number on it, from a value that is not on the ladder, and stops at the ends', () => {
    const ladder = [8, 16, 32]
    expect(stepOn(ladder, 16, 1)).toBe(32)
    expect(stepOn(ladder, 16, -1)).toBe(8)
    expect(stepOn(ladder, 10, 1)).toBe(16)
    expect(stepOn(ladder, 10, -1)).toBe(8)
    expect(stepOn(ladder, 32, 1)).toBe(32)
    expect(stepOn(ladder, 8, -1)).toBe(8)
    expect(stepOn(ladder, 8, 1, 4)).toBe(32)
    expect(stepOn(ladder, 32, -1, 4)).toBe(8)
  })

  test('every ladder is ascending whole numbers; group heights start at 1 and tile sides reach 448 and 256', () => {
    for (const id of NUMBER_CONTROLS) {
      const l = LADDERS[id]
      expect(l.every((x) => Number.isInteger(x) && x >= 1)).toBe(true)
      expect(l.every((x, i) => i === 0 || x > l[i - 1])).toBe(true)
    }
    expect(LADDERS.group[0]).toBe(1)
    expect(LADDERS.tm).toContain(448)
    expect(LADDERS.tm).toContain(256)
    expect(LADDERS.tn).toContain(448)
  })

  test('every control of every level, driven to both ends and back, never throws, and the scene stays one the model prices', () => {
    for (const level of CUBE_LEVELS) {
      for (const raster of ['row', 'grouped'] as const) {
        let e: Explore = normalize({ ...exploreFor(level, practiceSession().runs[level.n - 1].inst), raster })
        const check = () => {
          expect(Number.isInteger(e.group) && e.group >= 1).toBe(true)
          expect(e.m).toBeGreaterThanOrEqual(e.tm)
          expect(e.n).toBeGreaterThanOrEqual(e.tn)
          expect(() => wavesOf(e)).not.toThrow()
          expect(() => tableOf(level, e)).not.toThrow()
          expect(() => readout(e)).not.toThrow()
          const f = layoutFaces(e, level.id === 'flash')
          for (const r of [f.a, f.b, f.c]) expect(r.w > 0 && r.h > 0 && Number.isFinite(r.w + r.h)).toBe(true)
          expect(f.width).toBeLessThanOrEqual(306.01)
          expect(f.height).toBeLessThanOrEqual(306.01)
          expect(() => layoutWave(wavesOf(e).chosen)).not.toThrow()
        }
        check()
        for (const def of controlsFor(level, e)) {
          if (def.id === 'dtype' || def.id === 'raster') continue
          const id = def.id as NumberControl
          for (let i = 0; i < 60; i++) {
            e = stepControl(e, id, 1, i % 2 === 0)
            check()
          }
          const top = e[id]
          expect(top).toBe(LADDERS[id][LADDERS[id].length - 1])
          expect(stepControl(e, id, 1)[id]).toBe(top) // the end of the ladder holds
          for (let i = 0; i < 60; i++) {
            e = stepControl(e, id, -1, i % 3 === 0)
            check()
          }
          expect(e[id]).toBe(LADDERS[id][0])
        }
        for (const d of DTYPES) {
          e = chooseControl(e, 'dtype', d)
          expect(e.dtype).toBe(d)
          check()
        }
        for (const r of ['row', 'grouped']) {
          e = chooseControl(e, 'raster', r)
          check()
        }
      }
    }
  })

  test('every control at once: a long seeded walk over all ten number controls and both choices throws nothing', () => {
    let x = 12345
    const next = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0)
    for (const level of CUBE_LEVELS) {
      let e = exploreFor(level, practiceSession().runs[level.n - 1].inst)
      for (let i = 0; i < 1500; i++) {
        const k = next() % 14
        if (k < 10) e = stepControl(e, NUMBER_CONTROLS[k], next() % 2 === 0 ? 1 : -1, next() % 5 === 0)
        else if (k === 10) e = chooseControl(e, 'raster', next() % 2 === 0 ? 'row' : 'grouped')
        else e = chooseControl(e, 'dtype', DTYPES[next() % DTYPES.length])
        expect(() => tableOf(level, e)).not.toThrow()
        expect(() => wavesOf(e)).not.toThrow()
      }
    }
  })

  test('a GEMM never shrinks below one tile, and a group height never reaches 0 or a fraction', () => {
    let e = normalize({ ...exploreFor(CUBE_LEVELS[3], practiceSession().runs[3].inst), raster: 'grouped' })
    for (let i = 0; i < 40; i++) e = stepControl(e, 'tm', 1)
    expect(e.tm).toBe(1024)
    expect(e.m).toBeGreaterThanOrEqual(1024)
    for (let i = 0; i < 40; i++) e = stepControl(e, 'm', -1)
    expect(e.m).toBeGreaterThanOrEqual(e.tm)
    expect(() => wavesOf(e)).not.toThrow()
    for (let i = 0; i < 40; i++) e = stepControl(e, 'group', -1)
    expect(e.group).toBe(1)
    expect(normalize({ ...e, group: 0 }).group).toBe(1)
    expect(normalize({ ...e, group: 2.7 }).group).toBe(2)
    expect(() => wavesOf(normalize({ ...e, group: 0.4 }))).not.toThrow()
    // a choice that is not an option leaves the scene alone
    expect(chooseControl(e, 'dtype', 'int3')).toBe(e)
    expect(chooseControl(e, 'raster', 'diagonal')).toBe(e)
  })

  test('the element type offers FP8 and FP16 only: FP32 would need a TF32 rate that no registered claim carries (F14)', () => {
    expect([...DTYPES]).toEqual(['fp8', 'fp16'])
    for (const level of CUBE_LEVELS) {
      const e = exploreFor(level, practiceSession().runs[level.n - 1].inst)
      expect(chooseControl(e, 'dtype', 'fp32')).toBe(e)
      // each offered type is priced at a rate a claim carries: FP8 at 2 × BF16 dense, FP16 at BF16 dense
      expect(ridgeOf({ ...e, chip: undefined, dtype: 'fp8' })).toEqual({ value: ridge('fp8'), rate: 'FP8' })
      expect(ridgeOf({ ...e, chip: undefined, dtype: 'fp16' })).toEqual({ value: ridge('fp16'), rate: 'BF16' })
    }
    expect(ridge('fp8')).toBeCloseTo(2 * ridge('fp16'), 9)
    // no scene opens on FP32, whatever the item carries
    const inst = practiceSession().runs[0].inst
    expect(exploreFor(CUBE_LEVELS[0], { ...inst, params: { ...inst.params, dtype: 'fp32' } }).dtype).toBe('fp16')
  })

  test('the group height is offered only to the grouped raster, and no level offers a control it cannot step', () => {
    const level = CUBE_LEVELS[3]
    const e = exploreFor(level, practiceSession().runs[3].inst)
    expect(controlsFor(level, { ...e, raster: 'grouped' }).map((d) => d.id)).toContain('group')
    expect(controlsFor(level, { ...e, raster: 'row' }).map((d) => d.id)).not.toContain('group')
    for (const l of CUBE_LEVELS) {
      const scene = exploreFor(l, practiceSession().runs[l.n - 1].inst)
      for (const def of controlsFor(l, { ...scene, raster: 'grouped' })) {
        const id: ControlId = def.id
        expect(['dtype', 'raster', ...NUMBER_CONTROLS]).toContain(id)
      }
    }
  })
})

/* ------------------------------------------------------------------ */
/* the DOM table and the three faces                                    */
/* ------------------------------------------------------------------ */

const rowsOf = (level: CubeLevel, e: Explore): Record<string, string> => Object.fromEntries(tableOf(level, e).rows)

describe('the DOM table says what the faces draw (§6.3, §6.4)', () => {
  const scene = (level: CubeLevel, over: Partial<Explore> = {}): Explore => ({ ...exploreFor(level, practiceSession().runs[level.n - 1].inst), ...over })

  test('level 1: a 128 × 128 FP16 tile is 64 FLOP/B from 2·Tm·Tn FLOPs over (Tm + Tn)·b bytes, and C is not in the count', () => {
    const base: Explore = { ...scene(CUBE_LEVELS[0]), tm: 128, tn: 128, dtype: 'fp16' }
    const rows = rowsOf(CUBE_LEVELS[0], base)
    expect(rows['FLOPs per step of K']).toBe('2·Tm·Tn = 32,768')
    expect(rows['Bytes per step of K']).toBe('(Tm + Tn)·b = 512 B')
    expect(rows.Intensity).toBe('64.0 FLOP/B')
    expect(rows.Ridge).toBe('295.2 FLOP/B (BF16 rate)')
  })

  test('level 2: 448 fits shared memory and holds no CTA, 256 runs; the budget row reads the question’s own when it has one', () => {
    const at448: Explore = { ...scene(CUBE_LEVELS[1]), tm: 448, tn: 448, k: 64, stages: 2, dtype: 'fp16', budgetKib: undefined }
    const rows = rowsOf(CUBE_LEVELS[1], at448)
    expect(rows['Shared memory per block']).toBe('227 KiB: slabs fit')
    expect(rows['Accumulators in registers']).toBe('784 KiB of 256 KiB')
    expect(rows['CTAs per SM']).toBe('0 (shared memory allows 1, registers 0)')
    expect(readout(at448).occ.ctas).toBe(0)
    expect(readout({ ...at448, tm: 480, tn: 480 }).fits).toBe(false)
    expect(readout({ ...at448, tm: 256, tn: 256 }).occ.ctas).toBe(1)
    const hypo = rowsOf(CUBE_LEVELS[1], { ...at448, budgetKib: 100 })
    expect(Object.keys(hypo)).toContain('This question’s budget')
    expect(hypo['This question’s budget']).toBe('100 KiB: slabs do not fit')
  })

  test('level 3: 128 × 128, two 64-deep FP16 stages is 3 CTAs per SM, shared memory binding', () => {
    const rows = rowsOf(CUBE_LEVELS[2], { ...scene(CUBE_LEVELS[2]), ...BASE })
    expect(rows['CTAs per SM']).toBe('3 (shared memory allows 3, registers 4)')
    expect(rows['Slabs in shared memory']).toBe('64 KiB: 2 stages of k = 64')
    expect(readout({ ...scene(CUBE_LEVELS[2]), ...BASE, tm: 64, tn: 64 }).occ.ctas).toBe(7)
    expect(readout({ ...scene(CUBE_LEVELS[2]), ...BASE, tm: 256, tn: 256 }).occ.ctas).toBe(1)
  })

  test('level 4: the row-major wave is 130.0 FLOP/B, the grouped 11 × 12 wave 734.6, 5.7× from raster order alone', () => {
    const rows = rowsOf(CUBE_LEVELS[3], { ...scene(CUBE_LEVELS[3]), ...BASE, m: 16384, n: 16384, group: 11 })
    expect(rows['Row-major wave']).toBe('132 tiles touch 2 tile rows and 128 columns: 130.0 FLOP/B')
    expect(rows['Grouped wave (groups of 11)']).toBe('132 tiles touch 11 tile rows and 12 columns: 734.6 FLOP/B')
    expect(rows['Raster order alone']).toBe('5.7×')
    const w = wavesOf({ ...scene(CUBE_LEVELS[3]), ...BASE, m: 16384, n: 16384, group: 11 })
    expect([w.row.rows, w.row.cols, w.grouped.rows, w.grouped.cols]).toEqual([2, 128, 11, 12])
    expect(w.grouped.ai / w.row.ai).toBeGreaterThanOrEqual(3)
  })

  test('level 5: the FP8 ridge is 590.4, and the square tile that reaches it is 591, past the register file', () => {
    const rows = rowsOf(CUBE_LEVELS[4], { ...scene(CUBE_LEVELS[4]), chip: undefined, dtype: 'fp8' })
    expect(rows.Ridge).toBe('590.4 FLOP/B (FP8 rate)')
    expect(rows['Square tile that reaches the ridge']).toContain('T ≥ 591')
    expect(rows['Square tile that reaches the ridge']).toContain('past')
    // a hypothetical chip carries its own ridge: 2 × 400 TFLOP/s over 2 TB/s
    expect(rowsOf(CUBE_LEVELS[4], { ...scene(CUBE_LEVELS[4]), dtype: 'fp8', chip: { bf16Tflops: 400, hbmTBs: 2, fcPct: 100, fbPct: 100 } }).Ridge).toBe('400.0 FLOP/B (FP8 rate)')
  })

  test('level 6: a 128-row query block at N = 32,768 is 127.5 FLOP/B, and the score matrix it never writes is 2 GiB', () => {
    const rows = rowsOf(CUBE_LEVELS[5], { ...scene(CUBE_LEVELS[5]), seq: 32768, d: 128, br: 128, dtype: 'fp16' })
    expect(rows.Intensity).toBe('127.5 FLOP/B')
    expect(rows['Score matrix S, one head']).toBe('2.00 GiB, never written')
  })

  test('the table has a caption, two columns, an announcement and no empty cell', () => {
    for (const level of CUBE_LEVELS) {
      const t = tableOf(level, scene(level))
      expect(t.caption.length).toBeGreaterThan(8)
      expect(t.columns).toEqual(['Quantity', 'Value'])
      expect(t.announce.length).toBeGreaterThan(8)
      expect(t.rows.length).toBeGreaterThanOrEqual(5)
      for (const [a, b] of t.rows) expect(a.length > 0 && b.length > 0).toBe(true)
    }
  })

  test('the faces share their edges: A and C share Tm, B and C share Tn, and A’s columns are B’s rows', () => {
    const f = layoutFaces({ ...scene(CUBE_LEVELS[0]), tm: 128, tn: 256, k: 64 }, false)
    expect(f.a.h).toBeCloseTo(f.c.h, 6)
    expect(f.b.w).toBeCloseTo(f.c.w, 6)
    expect(f.a.w).toBeCloseTo(f.b.h, 6)
    expect(f.c.w / f.c.h).toBeCloseTo(2, 6)
    expect(f.dims).toEqual({ a: [128, 64], b: [64, 256], c: [128, 256] })
    // log-scaled for attention: still ordered, and never past the frame
    const g = layoutFaces({ ...scene(CUBE_LEVELS[5]), seq: 131072, d: 64, br: 16 }, true)
    expect(g.c.w).toBeGreaterThan(g.a.w)
    expect(g.width).toBeLessThanOrEqual(306.01)
  })

  test('a wave’s map lights its tiles and counts the rows and columns it reads', () => {
    const e = { ...scene(CUBE_LEVELS[3]), ...BASE, m: 16384, n: 16384, group: 11 }
    const row = layoutWave(wavesOf({ ...e, raster: 'row' }).chosen)
    const grouped = layoutWave(wavesOf({ ...e, raster: 'grouped' }).chosen)
    expect(row.lit).toHaveLength(132)
    expect(grouped.lit).toHaveLength(132)
    expect([row.litRows.length, row.litCols.length]).toEqual([2, 128])
    expect([grouped.litRows.length, grouped.litCols.length]).toEqual([11, 12])
  })
})

describe('the steppers say when a press would change nothing (3b-01 m3)', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  const views = (explore: Explore, onNudge: (id: NumberControl, dir: 1 | -1, coarse: boolean) => void = () => {}) =>
    createElement(Views, { level: CUBE_LEVELS[3], explore, step: 'explore', mirrorId: 'm', mirror: null, onNudge, onChoose: () => {}, onToCheck: () => {} })

  test('aria-disabled follows stepControl: the ladder end, and the floor normalize holds under M and N', async () => {
    const base = exploreFor(CUBE_LEVELS[3], practiceSession().runs[3].inst)
    // The shipped tile ladder tops out at 1,024, the GEMM ladder's first rung, so a lifted floor never sits above it today.
    // A 2,048 tile (off the ladder, but a scene the model prices) lifts M and N to 2,048: the rung below is 1,536, normalize
    // puts the value back, and "−" changes nothing although `value <= ladder[0]` is false.
    const lifted = normalize({ ...base, tm: 2048, tn: 2048, m: 2048, n: 2048 })
    expect([lifted.m, lifted.n]).toEqual([2048, 2048])
    expect(LADDERS.m[0]).toBe(1024)
    expect(stepControl(lifted, 'm', -1).m).toBe(2048)
    const scenes: Explore[] = [lifted, base, { ...base, m: 4096 }, { ...base, tm: 64, tn: 64, m: 1024, n: 32768 }, { ...base, m: 32768 }]
    for (const e of scenes) {
      const m = await dom.mount(views(e))
      for (const id of ['m', 'n', 'tm', 'tn', 'k', 'group'] as const) {
        for (const dir of [-1, 1] as const) {
          const btn = m.container.querySelector(`[data-control="${id}"] [data-step="${dir > 0 ? 'up' : 'down'}"]`)
          if (!btn) continue
          const changes = stepControl(e, id, dir)[id] !== e[id]
          expect([id, dir, btn.getAttribute('aria-disabled') === 'true']).toEqual([id, dir, !changes])
        }
      }
      await m.unmount()
    }
  })

  test('the dead button ignores the press and the live one steps', async () => {
    const base = exploreFor(CUBE_LEVELS[3], practiceSession().runs[3].inst)
    const lifted = normalize({ ...base, tm: 2048, tn: 2048, m: 2048, n: 2048 })
    const seen: string[] = []
    const m = await dom.mount(views(lifted, (id, dir, coarse) => seen.push(`${id}${dir > 0 ? '+' : '-'}${coarse ? 'c' : ''}`)))
    const press = (dir: 'up' | 'down') => dom.press(m.container.querySelector(`[data-control="m"] [data-step="${dir}"]`) as never)
    await press('down')
    await press('up')
    expect(seen).toEqual(['m+'])
    await m.unmount()
  })
})

describe('the rendered pieces', () => {
  const e = (level: CubeLevel) => exploreFor(level, practiceSession().runs[level.n - 1].inst)

  test('the faces are images named for their sizes, described by the table, with a letter on each; level 4 adds the wave map', () => {
    for (const level of CUBE_LEVELS) {
      const html = renderToString(createElement(Mirror2D, { level, explore: e(level), describedBy: 'cube-mirror' }))
      expect(html).toContain('role="img"')
      expect(html).toContain('aria-describedby="cube-mirror"')
      for (const letter of ['A', 'B', 'C']) expect(html).toContain(`data-face="${letter}"`)
      expect(html.includes('data-wave-caption')).toBe(level.id === 'raster')
      expect(html).not.toContain('<canvas')
      expect(html).not.toContain('animate')
    }
  })

  test('the table is hidden until asked, in the accessibility tree, behind a button that says so, with one live region', () => {
    const level = CUBE_LEVELS[2]
    const html = renderToString(createElement(Mirror, { id: 'cube-mirror', level, explore: e(level) }))
    expect(html).toContain('Show data table')
    expect(html).toContain('id="cube-mirror"')
    expect(html).toContain('sr-only')
    expect(html).toContain('<table')
    expect(html).toContain('CTAs per SM')
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1)
  })

  test('the controls are buttons and radios of at least 44 px, none of them a slider or a drag', () => {
    const s = practiceSession()
    const html = renderToString(createElement(Views, { level: levelOf(s), explore: s.explore, step: 'explore', mirrorId: 'm', mirror: null, onNudge: () => {}, onChoose: () => {}, onToCheck: () => {} }))
    expect(html).not.toContain('type="range"')
    expect(html).not.toContain('draggable')
    expect(html).not.toMatch(/onPointer|onMouseMove|onDrag/)
    for (const label of ['Decrease Tm', 'Increase Tm', 'Decrease Tn', 'Increase Tn', 'Decrease k', 'Increase k']) expect(html).toContain(`aria-label="${label}"`)
    expect(html.match(/h-11 w-11/g)?.length).toBe(6)
    expect(html).toContain('type="radio"')
    expect(html.match(/type="radio"[^>]*value="(\w+)"/g)).toHaveLength(2) // FP8 and FP16: no FP32 radio
    expect(html).not.toContain('value="fp32"')
    expect(html).toContain('Page Up and Page Down')
    expect(html).toContain('What this model leaves out')
    expect(html).toContain('Answer it now')
  })

  test('a mid-play load failure says what a reload keeps: the ledger has the answers, the play starts again', () => {
    // The session lives in React state, so a reload restarts at level 1; the copy must not promise a resume.
    for (const [fallback, kept] of [[ViewsFailed, 'Your prediction is recorded'], [DebriefFailed, 'Your answers are recorded']] as const) {
      const html = renderToString(createElement(fallback))
      expect(html).toContain('role="status"')
      expect(html).toContain(kept)
      expect(html).toContain('a reload starts the play again from level 1')
      expect(html).not.toContain('saved; reload')
    }
  })
})

/* ------------------------------------------------------------------ */
/* the debriefs                                                         */
/* ------------------------------------------------------------------ */

const text = (html: string): string => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('the debriefs (§6.3)', () => {
  const at = (s: CubeSession, n: number): CubeSession => ({ ...s, at: n, step: 'debrief' })
  const render = (s: CubeSession, kind: 'level' | 'closing') =>
    renderToString(createElement(MemoryRouter, null, createElement(Debrief, { session: s, kind, onNext: () => {}, onAgain: () => {}, mode: 'page' })))

  test('each level’s debrief shows the prediction’s error, the model’s reference choice and a line of principle', () => {
    let s = practiceSession()
    for (let n = 0; n < LEVEL_COUNT; n++) {
      s = withPrediction({ ...s, at: n, step: 'predict' }, predictedOf(answerItem(s, n, truthOfRun(s, n) * 3, 'predict'), s.runs[n].inst))
    }
    for (let n = 0; n < LEVEL_COUNT; n++) {
      const body = text(render(at(s, n), 'level'))
      expect(body).toContain(`level ${n + 1} of 6`)
      expect(body).toContain('You predicted')
      expect(body).toContain('off by a factor of 3.00')
      expect(body).toContain(CUBE_LEVELS[n].principle)
      expect(body).toContain(CUBE_LEVELS[n].debrief.slice(0, 40))
      for (const r of CUBE_LEVELS[n].reference) expect(body).toContain(r.label)
    }
  })

  test('level 2 names the register cap: 448 fits shared memory but not the register file', () => {
    const s = practiceSession()
    const body = text(render(at(s, 1), 'level'))
    expect(body).toContain('448 × 448')
    expect(body).toMatch(/Shared memory allows it, but the register cap forbids it/)
    expect(body).toContain('784 KiB')
    expect(body).toContain('256 KiB register file')
    expect(body).toContain('no CTA can hold it')
  })

  test('level 5 says no lone tile reaches the FP8 ridge', () => {
    const body = text(render(at(practiceSession(), 4), 'level'))
    expect(body).toContain('no single CTA tile reaches either ridge on H100')
    expect(body).toContain('590.4')
    expect(body).toContain('T ≥ 591')
  })

  test('level 4 gives both rasters and the factor, and level 6 the score matrix it never writes', () => {
    expect(text(render(at(practiceSession(), 3), 'level'))).toMatch(/130\.0 FLOP\/B.*734\.6 FLOP\/B, 5\.7× from raster order alone/)
    const six = text(render(at(practiceSession(), 5), 'level'))
    expect(six).toContain('127.5 FLOP/B')
    expect(six).toContain('2 GiB')
  })

  test('every tile a debrief names as a reference choice holds a CTA, or the debrief names the register cap', () => {
    for (const level of CUBE_LEVELS) {
      for (const r of level.reference) {
        const runs = ctasPerSm(r) >= 1
        expect([level.id, r.label, runs || /register/i.test(level.debrief)]).toEqual([level.id, r.label, true])
      }
    }
  })

  test('every level’s debrief rests on claims that exist, and each shows as a chip with a source', () => {
    for (const level of CUBE_LEVELS) {
      const html = render(at(practiceSession(), level.n - 1), 'level')
      const chips = html.match(/Show source/g) ?? []
      expect(chips.length).toBeGreaterThan(0)
    }
    expect(Object.keys(byId)).toContain('hw.h100-sxm.fp8-dense')
  })

  test('the closing debrief lists the six errors and the six principles, with the headline', () => {
    const s = playOut(practiceSession(), (n) => [1, 3, 1.5, 0.5, 1, 4][n])
    expect(s.step).toBe('closing')
    const body = text(render(s, 'closing'))
    expect(body).toContain('predictions inside a factor of 2')
    expect(body).toContain('Intensity is volume ÷ lit surface; raster order alone moved this wave 5.7×.')
    expect(closingHeadline()).toContain('5.7×')
    for (const level of CUBE_LEVELS) {
      expect(body).toContain(`${level.n}. ${level.title}`)
      expect(body).toContain(level.principle)
    }
    expect(body).toContain('3.00× from the model')
    expect(body).toContain('Play again with new numbers')
    expect(body).toContain('Back to lesson t4.l6')
    expect(text(renderToString(createElement(Debrief, { session: s, kind: 'closing', onNext: () => {}, onAgain: () => {}, mode: 'embed' })))).not.toContain('Back to lesson')
  })

  test('the closing headline’s factor is the model’s: grouped over row-major', () => {
    expect(fixed(734.6 / 130.0, 1)).toBe('5.7')
  })
})

/* ------------------------------------------------------------------ */
/* the card                                                             */
/* ------------------------------------------------------------------ */

describe('the In-production card (§6.3)', () => {
  const rows = TILING_CUBE_PRODUCTION_ROWS

  test('it has at least three rows, all pinned claims that exist, and productionClaims is the same list', () => {
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(TILING_CUBE.productionClaims).toEqual(rows.map((r) => r.claim))
    expect(PLAY_PRODUCTION_ROWS['tiling-cube']).toBe(rows)
    const ids = new Set(CLAIMS.map((c) => c.id))
    for (const r of rows) expect([r.claim, ids.has(r.claim)]).toEqual([r.claim, true])
    // the spec's rows: H100 SMEM per SM and per block, SM count, L2, and Triton's group size
    for (const id of ['hw.h100-sxm.smem-per-sm', 'hw.h100-sxm.smem-per-block', 'hw.h100-sxm.sm-count', 'hw.h100-sxm.l2', 'production.triton.group-size-m']) expect(TILING_CUBE.productionClaims).toContain(id)
  })

  test('every claim is a spec or a status pinned to a release the source url contains', () => {
    for (const r of rows) {
      const c = byId[r.claim]
      expect(['spec', 'status', 'derived']).toContain(c.kind)
      if (c.kind === 'status') {
        expect(c.pin).toBeDefined()
        expect(c.source?.url).toContain(c.pin?.ref ?? '#')
      }
    }
  })

  test('every number is a chip; the copy holds no digits; the card names the Triton release it read', () => {
    const html = renderToString(createElement(ProductionCard))
    expect(html.match(/Show source/g)).toHaveLength(rows.length)
    for (const r of rows) expect(html).toContain(r.dial)
    // the chip's number is the only one: level numbers and the names H100, SXM5, L2 and FP32 are not figures
    for (const r of rows) expect(`${r.lead} ${r.tail}`.replace(/\b(H100|SXM5|L2|FP32)\b/g, '').replace(/\blevel \d\b/gi, '')).not.toMatch(/\d/)
    expect(text(html)).toContain('Read at triton-lang/triton v3.8.0')
    expect(html).toContain('data-phase="production"')
  })

  test('the card’s numbers are the model’s: the same claims the cube priced', () => {
    expect(H100.smemPerSm).toBe(byId['hw.h100-sxm.smem-per-sm'].value === 228 ? 228 * 1024 : -1)
    expect(H100.smemPerBlock).toBe(227 * 1024)
    expect(H100.smCount).toBe(Number(byId['hw.h100-sxm.sm-count'].value))
  })
})

/* ------------------------------------------------------------------ */
/* the whole play                                                       */
/* ------------------------------------------------------------------ */

describe('the play as the page renders it', () => {
  test('the first paint is the first level’s prediction: no views, no table, no debrief, no focus taken', () => {
    const html = renderToString(createElement(MemoryRouter, null, createElement(TilingCubePlay, { mode: 'page' })))
    expect(html).toContain('data-play="tiling-cube"')
    expect(html).toContain('data-phase-now="play"')
    expect(html).toContain('data-phase="predict"')
    expect(html).toContain('Level 1 of 6')
    expect(html).toContain('Count the cube')
    expect(html).toContain('the shared practice numbers')
    expect(text(html)).toContain('About 25 minutes')
    expect(html).not.toContain('data-views')
    expect(html).not.toContain('data-play-mirror')
    expect(html).not.toContain('data-phase="debrief"')
    expect(html).not.toContain('data-phase="production"')
    expect(html).not.toContain('autofocus')
  })

  test('the embed links the full-screen page', () => {
    const html = renderToString(createElement(MemoryRouter, null, createElement(TilingCubePlay, { mode: 'embed' })))
    expect(html).toContain('href="/play/tiling-cube"')
    expect(html).toContain('data-mode="embed"')
  })

  test('a level whose views have not loaded shows a status that holds their room, and a debrief the same', () => {
    let s = practiceSession()
    s = openViews(withPrediction(s, predictedOf(answerItem(s, 0, 64, 'predict'), s.runs[0].inst)))
    const level = renderToString(
      createElement(Level, {
        session: s,
        level: levelOf(s),
        mirrorId: 'm',
        mirror: null,
        focus: false,
        onPredicted: () => {},
        onOpenViews: () => {},
        onNudge: () => {},
        onChoose: () => {},
        onToCheck: () => {},
        onChecked: () => {},
        onToDebrief: () => {},
      }),
    )
    expect(level).toContain('Loading the views')
    expect(level).toContain('min-h-[70rem]')
    expect(level).not.toContain('data-phase="explore"')
    expect(renderToString(createElement(DebriefLoading))).toContain('min-h-[37rem]')
  })
})

describe('the play, mounted: the steppers move the faces and the table', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  /** Level 4 on its own state, as Play.tsx holds it, so the steppers can be pressed without answering the items. */
  function Harness({ start }: { start: CubeSession }) {
    const [s, setS] = useState(start)
    return createElement(Level, {
      session: s,
      level: levelOf(s),
      mirrorId: 'm',
      mirror: createElement(Mirror, { id: 'm', level: levelOf(s), explore: s.explore }),
      focus: false,
      onPredicted: () => {},
      onOpenViews: () => {},
      onNudge: (id, dir, coarse) => setS((x) => nudge(x, id, dir, coarse)),
      onChoose: (id, v) => setS((x) => choose(x, id, v)),
      onToCheck: () => setS(toCheck),
      onChecked: () => {},
      onToDebrief: () => {},
    })
  }

  const exploring = (n: number): CubeSession => {
    let s = practiceSession()
    for (let i = 0; i < n; i++) s = { ...s, runs: s.runs, at: i }
    s = { ...s, at: n, step: 'explore', explore: exploreFor(CUBE_LEVELS[n], s.runs[n].inst) }
    return s
  }

  test('pressing a button steps its control, the table follows, and a button at the end of its ladder ignores the press and keeps focus', async () => {
    const m = await dom.mount(createElement(Harness, { start: { ...exploring(2), explore: { ...exploring(2).explore, tm: 128, tn: 128, k: 64, stages: 2, dtype: 'fp16' } } }))
    const value = (id: string) => m.container.querySelector(`[data-control="${id}"] [data-value]`)?.textContent
    const button = (id: string, dir: 'up' | 'down') => m.container.querySelector(`[data-control="${id}"] [data-step="${dir}"]`)
    expect(value('tm')).toBe('128')
    await dom.press(button('tm', 'up') as never)
    expect(value('tm')).toBe('144')
    await dom.press(button('tm', 'down') as never)
    await dom.press(button('tm', 'down') as never)
    expect(value('tm')).toBe('112')
    // every stepper to its top and bottom by presses alone
    for (const id of ['tm', 'tn', 'k', 'stages']) {
      const ladder = LADDERS[id as NumberControl]
      for (let i = 0; i < ladder.length + 2; i++) await dom.press(button(id, 'up') as never)
      expect(value(id)).toBe(fixed(ladder[ladder.length - 1]))
      expect(button(id, 'up')?.getAttribute('aria-disabled')).toBe('true')
      for (let i = 0; i < ladder.length + 2; i++) await dom.press(button(id, 'down') as never)
      expect(value(id)).toBe(fixed(ladder[0]))
    }
    expect(m.container.textContent).toContain('CTAs per SM')
    await m.unmount()
  })

  test('level 4: the raster radio switches the wave, and the group height appears only for the grouped raster', async () => {
    const m = await dom.mount(createElement(Harness, { start: { ...exploring(3), explore: { ...exploring(3).explore, ...BASE, m: 16384, n: 16384, group: 11, raster: 'row' } } }))
    expect(m.container.querySelector('[data-control="group"]')).toBeNull()
    expect(m.container.querySelector('[data-wave-caption]')?.textContent).toContain('row-major')
    const grouped = m.container.querySelectorAll('[data-control="raster"] input')[1]
    if (!grouped) throw new Error('no grouped radio')
    await dom.press(grouped as never)
    expect(m.container.querySelector('[data-control="group"]')).not.toBeNull()
    expect(m.container.querySelector('[data-wave-caption]')?.textContent).toContain('grouped by 11')
    expect(m.container.querySelector('[data-wave-caption]')?.textContent).toContain('11 A row panels')
    await m.unmount()
  })
})

/* ------------------------------------------------------------------ */
/* verify-plays                                                         */
/* ------------------------------------------------------------------ */

describe('verify-plays: the cube’s checks (§6.3)', () => {
  const world: PlayWorld = { kcIds: new Set<string>(Object.values(KC)), claimIds: new Set(CLAIMS.map((c) => c.id)), lessonIds: new Set(['t4.l6']) }
  const read = (f: string) => readFileSync(join(CUBE_DIR, f), 'utf8')
  const facts = (): PlayFacts => ({
    id: TILING_CUBE.id,
    lessonId: TILING_CUBE.lessonId,
    kcs: TILING_CUBE.kcs,
    productionClaims: TILING_CUBE.productionClaims,
    cardClaims: TILING_CUBE_PRODUCTION_ROWS.map((r) => r.claim),
    play: read('Play.tsx'),
    mirror: read('Mirror.tsx'),
    debrief: read('Debrief.tsx'),
    practiceInBand: true,
  })

  test('the registered cube passes with the real files: a mirror and a debrief that Play.tsx renders, a card of at least three rows', () => {
    expect(checkPlay(facts(), world)).toEqual([])
  })

  test('the practice band holds on the pinned seed, through the band module verify-plays reads', async () => {
    const band = await practiceBandOf('tiling-cube', ROOT)
    expect(band).not.toBeNull()
    expect(band?.inBand).toBe(true)
  })

  test('the checks catch what they should: no mirror render, no debrief render, a thin card, an out-of-band practice seed', () => {
    const f = facts()
    expect(checkPlay({ ...f, play: f.play?.replace('<Mirror ', '<Other ') }, world).join('\n')).toContain('never renders <Mirror>')
    expect(checkPlay({ ...f, play: f.play?.replaceAll('<Debrief ', '<Other ') }, world).join('\n')).toContain('never renders <Debrief>')
    expect(checkPlay({ ...f, productionClaims: f.productionClaims.slice(0, 2), cardClaims: f.cardClaims.slice(0, 2) }, world).join('\n')).toContain('needs at least three')
    expect(checkPlay({ ...f, practiceInBand: false }, world).join('\n')).toContain('practice trace is outside the band')
  })

  test('the closure of /play/tiling-cube is the first screen: the play, its level, the session and the model, with the views, the table, the debriefs and the card lazy (BF3)', () => {
    const c = closureOf(join(CUBE_DIR, 'Play.tsx'), SRC)
    for (const f of ['Play.tsx', 'Level.tsx', 'session.ts']) expect(c.files).toContain(`src/components/play/tiling-cube/${f}`)
    for (const f of ['src/data/plays.ts', 'src/lib/world/tiling.ts', 'src/lib/items/families/tiling.ts', 'src/lib/items/families/roofline.ts', 'src/components/items/ItemCard.tsx']) expect(c.files).toContain(f)
    // the first screen is a prediction: the steppers and faces, the table, the debriefs and their claim chips, and the card come on demand
    for (const f of ['Views.tsx', 'Mirror2D.tsx', 'Mirror.tsx', 'Debrief.tsx', 'ProductionCard.tsx']) expect(c.files).not.toContain(`src/components/play/tiling-cube/${f}`)
    expect(c.files).not.toContain('src/components/sims/SimMirror.tsx')
    const level = read('Level.tsx')
    expect(level).toContain("import('./Views')")
    expect(level).toMatch(/<Suspense fallback={<ViewsLoading \/>}>/)
    const playSrc = read('Play.tsx')
    for (const lazyImport of ["import('./Views')", "import('./Mirror')", "import('./Debrief')"]) expect(playSrc).toContain(lazyImport)
    expect(playSrc.match(/<Suspense fallback={<DebriefLoading \/>}>/g)).toHaveLength(2)
    // the first prediction starts fetching all four, so they are there when the learner reaches them
    expect(playSrc).toContain('[loadViews, loadMirror, loadDebrief, loadCard]')
    // the lesson block's module drags Today's session behind it: the play keeps its own copy of the two writes
    expect(c.files).not.toContain('src/lib/learner/item-block.ts')
    expect(c.files).not.toContain('src/lib/learner/today.ts')
    expect(c.files.some((f) => f.includes('workers/') || f.startsWith('src/lib/fleet') || f.includes('components/play/scheduler') || (f.includes('components/sims/') && !f.endsWith('SimMirror.tsx')))).toBe(false)
    const play = read('Play.tsx')
    expect(play).toMatch(/lazy\(loadCard\)/)
    expect(play).toContain("import('./ProductionCard')")
  })

  test('the route budget row exists and names the play’s source', () => {
    const bundle = readFileSync(join(ROOT, 'scripts', 'verify-bundle.ts'), 'utf8')
    expect(bundle).toMatch(/route: '\/play\/tiling-cube'[^}]*budgetKb: null[^}]*playSrc: 'src\/components\/play\/tiling-cube\/Play\.tsx'/)
  })

  test('no View3D here: the 2D cube ships, the 3D one is stretch (D9)', () => {
    for (const f of ['Play.tsx', 'Level.tsx', 'Mirror2D.tsx', 'Mirror.tsx', 'Debrief.tsx', 'session.ts', 'ProductionCard.tsx']) expect(read(f)).not.toContain('<View3D')
  })
})
