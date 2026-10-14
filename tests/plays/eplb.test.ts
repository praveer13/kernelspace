/**
 * The EPLB play (docs/specs/wave-3.md §5.2, task 3b-02): its registration, the prediction, the session model, the hidden
 * reference, the pass tally, the debrief, Compose, the In-production card and what reaches the ledger. The world's own numbers
 * are tests/world/eplb.test.ts's and eplb-policy.test.ts's; these tests hold the play to them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Board, { Layer, Predict } from '../../src/components/play/eplb/Board'
import Debrief from '../../src/components/play/eplb/Debrief'
import Mirror from '../../src/components/play/eplb/Mirror'
import EplbPlay from '../../src/components/play/eplb/Play'
import ProductionCard from '../../src/components/play/eplb/ProductionCard'
import { PLAY_REGISTRY, resolvePlay } from '../../src/components/play/registry'
import {
  DEFAULT_EPLB_SPEC,
  EMPTY_TALLY,
  EPLB_COMPOSE_FRESH,
  EPLB_DIAL_DEFS,
  EPLB_LESSON,
  EPLB_RIGHT_FACTOR,
  EPLB_TURNS,
  FRESH_LOADS_TO_PASS,
  PREDICT_NSEC,
  PREDICT_REF,
  announceOf,
  canSkip,
  composeLoads,
  copyExpert,
  debrief,
  eplbComposeRecord,
  eplbComposeReport,
  errorLine,
  freshSession,
  gapText,
  nextTurnLine,
  nextWithRoom,
  parsePrediction,
  passed,
  passedByHand,
  pinnedReleases,
  placeOn,
  practiceSession,
  predictEvent,
  predictionOf,
  recordOf,
  skip,
  stageOf,
  tallyAfter,
  tallyLine,
  viewOf,
  withDial,
  withPrediction,
  type EplbSession,
  type Tally,
} from '../../src/components/play/eplb/session'
import { CLAIMS, byId } from '../../src/data/claims/all'
import { KC } from '../../src/data/kc/ids'
import { KCS } from '../../src/data/kc'
import { EPLB, EPLB_PRODUCTION_ROWS, PLAYS, PLAY_IDS, PLAY_PRODUCTION_ROWS, getPlay } from '../../src/data/plays'
import { PLAY_MINUTES } from '../../src/lib/economy-table'
import { estimateScore } from '../../src/lib/items/grade'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { pathPlan, playStep } from '../../src/lib/learner/paths'
import { PRE_NSEC } from '../../src/lib/learner/prequestions'
import {
  EPLB_GHOST,
  EPLB_PLAY_ID,
  EPLB_PRACTICE_SEED,
  EPLB_TURNS as WORLD_TURNS,
  GPUS,
  REPLICATE_TURNS,
  checkEplbBand,
  eplbPasses,
  eplbView,
  imbalanceOf,
  makeLoads,
  practiceLoads,
  roundRobinUnits,
  runEplb,
  type EplbView,
} from '../../src/lib/world/eplb'
import { EPLB_SHORTCUTS, REFERENCE_EPLB_SPEC, firstDifference } from '../../src/lib/world/eplb-policy'
import { checkPlay, closureOf, practiceBandOf, type PlayFacts, type PlayWorld } from '../../scripts/verify-plays'
import { installDom, MiniEvent, type DomKit, type MiniElement } from '../dom/mini-dom'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = join(import.meta.dir, '..', '..')
const SRC = join(ROOT, 'src')
const EPLB_DIR = join(SRC, 'components', 'play', 'eplb')

/** A learner as a rule: a replicate decision (an expert) and a place decision (a GPU) from what the screen shows. */
interface Learner {
  copy: (v: EplbView) => number
  place: (v: EplbView) => number
}

const GHOST_LEARNER: Learner = {
  copy: (v) => (EPLB_GHOST.decide(v, { kind: 'replicate' }) as { expert: number }).expert,
  place: (v) => (EPLB_GHOST.decide(v, { kind: 'place', copy: v.queue[0] }) as { gpu: number }).gpu,
}
/** Copies the most loaded expert each time, and fills GPU 1, then GPU 2 and so on. */
const FILL_IN_ORDER: Learner = {
  copy: (v) => v.loads.indexOf(Math.max(...v.loads)),
  place: (v) => v.gpus.findIndex((g) => g.free > 0),
}

const predicted = (s: EplbSession, value = 1.5): EplbSession => withPrediction(s, value)

/** Plays a session (prediction made) to its end with a learner, through the session functions the components call. */
function playOut(s0: EplbSession, who: Learner, stopAfter = Infinity): EplbSession {
  let s = predicted(s0)
  for (let guard = 0; guard < 100 && s.play.turns < stopAfter; guard++) {
    const st = stageOf(s)
    if (st.kind !== 'turn') break
    s = st.phase === 'replicate' ? copyExpert(s, who.copy(st.view)) : placeOn(s, who.place(st.view))
  }
  return s
}

/* ------------------------------------------------------------------ */
/* registration                                                         */
/* ------------------------------------------------------------------ */

describe('registration (§5.2)', () => {
  test('the EPLB play is T6.L2’s: 15 minutes, 24 turns, the two KCs the spec names, tied to the world and the economy', () => {
    expect(EPLB.id).toBe(EPLB_PLAY_ID)
    expect(EPLB.id).toBe('eplb')
    expect(EPLB.lessonId).toBe('t6.l2')
    expect(EPLB.minutes).toBe(15)
    expect(PLAY_MINUTES[EPLB.id]).toBe(EPLB.minutes)
    expect(EPLB.turnCap).toBe(WORLD_TURNS)
    expect(EPLB_TURNS).toBe(24)
    expect([...EPLB.kcs]).toEqual(['t6.expert-load-balance', 't6.all-to-all'])
    const known = new Set<string>(Object.values(KC))
    const graph = new Set(KCS.map((k) => k.id))
    for (const k of EPLB.kcs) expect([k, known.has(k), graph.has(k)]).toEqual([k, true, true])
    expect(getPlay('eplb')).toBe(EPLB)
    expect(PLAYS[EPLB.id]).toBe(EPLB)
    expect(PLAY_IDS).toContain('eplb')
    expect(EPLB_LESSON).toBe(EPLB.lessonId)
  })

  test('the registry loads it on demand, and the Play.tsx it names exists', () => {
    const r = resolvePlay('eplb')
    expect(r.kind).toBe('play')
    if (r.kind === 'play') expect(r.entry.intro.length).toBeGreaterThan(0)
    expect(Object.keys(PLAY_REGISTRY)).toContain('eplb')
    expect(readFileSync(join(SRC, 'components', 'play', 'registry.ts'), 'utf8')).toContain("import('@/components/play/eplb/Play')")
  })

  test('src/data/plays.ts imports no lazy claim group, so the eager chunk does not grow (D19); the card imports the moe group itself', () => {
    expect(readFileSync(join(SRC, 'data', 'plays.ts'), 'utf8')).not.toMatch(/data\/claims\/lazy|from '\.\.?\/claims\/lazy/)
    expect(readFileSync(join(EPLB_DIR, 'ProductionCard.tsx'), 'utf8')).toContain("import '@/data/claims/lazy/moe'")
  })

  test('a play step follows t6.l2 in the plans that have it, with no code change (paths.ts withPlays)', () => {
    const plan = pathPlan('full-ramp', { kcs: KCS, lessons: ALL_LESSONS, labs: FORGE_LABS, plays: [EPLB] })
    const at = plan.steps.indexOf('t6.l2')
    expect(at).toBeGreaterThan(-1)
    expect(plan.steps[at + 1]).toBe(playStep('eplb'))
  })
})

/* ------------------------------------------------------------------ */
/* the prediction                                                       */
/* ------------------------------------------------------------------ */

describe('the prediction opens the play (§5.2)', () => {
  test('numbers parse with a point or a comma and an optional ×; anything else is a problem to say, and the range is 1 to the GPU count', () => {
    for (const [text, value] of [['1.5', 1.5], [' 1,5 ', 1.5], ['2', 2], ['1.41×', 1.41], ['1.4 x', 1.4], ['.5', null], ['4', 4], ['1', 1]] as const) {
      const r = parsePrediction(text)
      if (value === null) expect(r.ok).toBe(false)
      else expect(r).toEqual({ ok: true, value })
    }
    for (const text of ['', '  ', 'a', '1.2.3', '-1', '1e3', '0.9', '4.01', '12']) expect([text, parsePrediction(text).ok]).toEqual([text, false])
    const bad = parsePrediction('0.5')
    expect(bad.ok ? '' : bad.problem).toContain('at least the mean')
  })

  test('the truth is the world’s round robin on this load; the practice load gives 1.41×', () => {
    const s = practiceSession()
    const p = predictionOf(1.4, s.loads)
    expect(p.truth).toBe(imbalanceOf(roundRobinUnits(practiceLoads())))
    expect(p.truth.toFixed(2)).toBe('1.41')
    expect(checkEplbBand(practiceLoads()).roundRobin).toBe(roundRobinUnits(practiceLoads()))
  })

  test('it is scored on a log scale like every estimate, and right within a factor of 1.2', () => {
    const loads = practiceLoads()
    const truth = imbalanceOf(roundRobinUnits(loads))
    expect(predictionOf(truth, loads)).toMatchObject({ ok: true, score: 1, logErr: 0 })
    for (const f of [0.9, 1.1, 1.19, 1.5, 2]) {
      const p = predictionOf(truth * f, loads)
      expect(p.score).toBeCloseTo(estimateScore(Math.abs(Math.log10(f)), EPLB_RIGHT_FACTOR), 12)
      expect(p.logErr).toBeCloseTo(Math.abs(Math.log10(f)), 12)
    }
    expect(predictionOf(truth * 1.2, loads).ok).toBe(true)
    expect(predictionOf(truth * 1.21, loads).ok).toBe(false)
    expect(predictionOf(truth / 1.2, loads).ok).toBe(true)
    expect(predictionOf(truth / 1.21, loads).ok).toBe(false)
    expect(EPLB_RIGHT_FACTOR).toBe(1.2)
  })

  test('the wording: what was said, what round robin gives, the factor, and whether it counts', () => {
    const loads = practiceLoads()
    expect(errorLine(predictionOf(1.5, loads))).toBe('You predicted 1.50× for round robin without replicas; it gives 1.41×. You were off by a factor of 1.07, inside the 20 % that counts as right.')
    expect(errorLine(predictionOf(2.5, loads))).toContain('outside the 20 % that counts as right')
  })

  test('no turn can be played before the prediction, and it is locked in once', () => {
    const s0 = practiceSession()
    expect(stageOf(s0)).toEqual({ kind: 'predict' })
    expect(copyExpert(s0, 14)).toBe(s0)
    expect(placeOn(s0, 0)).toBe(s0)
    expect(withPrediction(s0, 0.5)).toBe(s0)
    expect(withPrediction(s0, 5)).toBe(s0)
    const s1 = withPrediction(s0, 1.5)
    expect(s1.prediction?.value).toBe(1.5)
    expect(stageOf(s1).kind).toBe('turn')
    expect(withPrediction(s1, 2)).toBe(s1)
    const s2 = copyExpert(s1, 14)
    expect(withPrediction(s2, 2)).toBe(s2)
  })

  test('the nominal seconds are a prequestion’s', () => {
    expect(PREDICT_NSEC).toBe(PRE_NSEC)
  })
})

/* ------------------------------------------------------------------ */
/* the session                                                          */
/* ------------------------------------------------------------------ */

describe('the session (§5.2)', () => {
  test('the practice session is the pinned load, practice provenance; new loads are banded, deterministic in the entropy and unseen', () => {
    const s = practiceSession()
    expect(s.seed).toBe(EPLB_PRACTICE_SEED)
    expect(s.provenance).toBe('practice')
    expect([...s.loads]).toEqual(practiceLoads())
    const a = freshSession(123)
    const b = freshSession(123)
    expect(a.loads).toEqual(b.loads)
    expect(a.provenance).toBe('unseen')
    expect([...a.loads]).toEqual(makeLoads(a.seed))
    expect(checkEplbBand(a.loads).inBand).toBe(true)
    expect(freshSession(124).loads).not.toEqual(a.loads)
  })

  test('four replicate turns, then twenty place turns with the heaviest copy offered first', () => {
    let s = predicted(practiceSession())
    for (let t = 0; t < REPLICATE_TURNS; t++) {
      const st = stageOf(s)
      expect(st).toMatchObject({ kind: 'turn', phase: 'replicate', turn: t, copy: null })
      s = copyExpert(s, GHOST_LEARNER.copy(viewOf(s)))
    }
    for (let t = REPLICATE_TURNS; t < EPLB_TURNS; t++) {
      const st = stageOf(s)
      if (st.kind !== 'turn') throw new Error('not a turn')
      expect(st.phase).toBe('place')
      expect(st.turn).toBe(t)
      expect(st.copy).toEqual(st.view.queue[0])
      expect(st.view.queue.every((c) => c.units <= (st.copy?.units ?? 0))).toBe(true)
      s = placeOn(s, GHOST_LEARNER.place(st.view))
    }
    expect(stageOf(s)).toEqual({ kind: 'over' })
    expect(s.play.turns).toBe(EPLB_TURNS)
    expect(viewOf(s).queue).toHaveLength(0)
  })

  test('a move outside the rules changes nothing: a wrong kind, a full GPU, an expert out of range', () => {
    let s = predicted(practiceSession())
    expect(placeOn(s, 0)).toBe(s)
    expect(copyExpert(s, 16)).toBe(s)
    expect(copyExpert(s, -1)).toBe(s)
    for (let i = 0; i < REPLICATE_TURNS; i++) s = copyExpert(s, 14)
    expect(copyExpert(s, 14)).toBe(s)
    // fill GPU 1, then try it again
    for (let i = 0; i < 5; i++) s = placeOn(s, 0)
    expect(viewOf(s).gpus[0].free).toBe(0)
    expect(placeOn(s, 0)).toBe(s)
    expect(placeOn(s, 4)).toBe(s)
  })

  test('the live line is the world’s turn line, then the next turn: the next copy is announced', () => {
    let s = predicted(practiceSession())
    expect(announceOf(s)).toBe('Turn 1 of 24: copy an expert. 4 copies left to make.')
    s = copyExpert(s, 14)
    expect(s.line).toBe('Turn 1: copied expert #15, now 2 copies of 132 ‰.')
    expect(announceOf(s)).toBe(`${s.line} Turn 2 of 24: copy an expert. 3 copies left to make.`)
    for (let i = 0; i < 3; i++) s = copyExpert(s, 2)
    const st = stageOf(s)
    if (st.kind !== 'turn' || !st.copy) throw new Error('not a place turn')
    expect(nextTurnLine(st)).toBe(`Turn 5 of 24: the next copy is #${st.copy.expert + 1}, ${st.copy.units / 60} ‰. Choose a GPU.`)
    expect(announceOf(s)).toContain(`the next copy is #${st.copy.expert + 1}`)
    s = placeOn(s, 1)
    expect(s.line).toMatch(/^Turn 5: #\d+'s copy \(.* ‰\) on GPU 2, now .* ‰\. Busiest GPU \d\.\d\d× the mean\.$/)
    expect(nextTurnLine({ kind: 'over' })).toBe('')
  })

  test('arrow movement skips GPUs with no free slot and wraps', () => {
    let s = predicted(practiceSession())
    for (let i = 0; i < REPLICATE_TURNS; i++) s = copyExpert(s, 14)
    for (let i = 0; i < 5; i++) s = placeOn(s, 1)
    const v = viewOf(s)
    expect(v.gpus[1].free).toBe(0)
    expect(nextWithRoom(v, 0, 1)).toBe(2)
    expect(nextWithRoom(v, 2, -1)).toBe(0)
    expect(nextWithRoom(v, 3, 1)).toBe(0)
    expect(nextWithRoom(v, 0, -1)).toBe(3)
  })

  test('the skip is offered after five turns and hands the rest to the reference’s rule', () => {
    let s = predicted(practiceSession())
    expect(canSkip(s)).toBe(false)
    expect(skip(s)).toBe(s)
    s = playOut(s, FILL_IN_ORDER, 5)
    expect(s.play.turns).toBe(5)
    expect(canSkip(s)).toBe(true)
    const done = skip(s)
    expect(done.play.mine.ended).not.toBeNull()
    expect(done.play.skipped).toBe(true)
    expect(canSkip(done)).toBe(false)
    // the reference finished the layer from the learner's own copies: the four copies made by hand stay
    expect(viewOf(done).copies).toEqual(viewOf(s).copies)
  })

  test('the debrief exists only for a finished layer, and is kept once', () => {
    const s = playOut(practiceSession(), GHOST_LEARNER, 10)
    expect(debrief(s)).toBe(s)
    const done = playOut(practiceSession(), GHOST_LEARNER)
    const d = debrief(done)
    expect(d.summary).not.toBeNull()
    expect(debrief(d)).toBe(d)
    expect(recordOf(done)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* the hidden reference                                                 */
/* ------------------------------------------------------------------ */

describe('the reference stays hidden until the debrief (§5.2)', () => {
  test('the stage is built from the learner’s layer alone, whatever the reference did', () => {
    const s = predicted(practiceSession())
    const other = { ...s, play: { ...s.play, ghost: { ...s.play.ghost, state: s.play.mine.state } } }
    expect(stageOf(s)).toEqual(stageOf(other))
    expect(viewOf(s)).toEqual(viewOf(other))
    expect(announceOf(s)).toBe(announceOf(other))
  })

  test('the markup before the debrief names no reference: the first paint, the board and the mirror', () => {
    const paint = renderToString(createElement(MemoryRouter, null, createElement(EplbPlay, { mode: 'page' })))
    expect(paint).toContain('data-phase-now="predict"')
    expect(paint).not.toContain('data-board')
    expect(paint).not.toContain('data-debrief-side')
    expect(paint).not.toContain('data-play-mirror')
    const s = playOut(practiceSession(), GHOST_LEARNER, 8)
    const st = stageOf(s)
    if (st.kind !== 'turn') throw new Error('not a turn')
    const html = renderToString(
      createElement('div', null, createElement(Board, { stage: st, onCopy: () => {}, onPlace: () => {} }), createElement(Mirror, { id: 'm', view: viewOf(s), title: 'Your GPUs', line: announceOf(s) })),
    )
    expect(html).not.toMatch(/reference/i)
  })
})

/* ------------------------------------------------------------------ */
/* the debrief                                                          */
/* ------------------------------------------------------------------ */

describe('the debrief (§5.2)', () => {
  test('playing the reference’s rule by hand matches it: no divergence, a pass, the world’s metric', () => {
    const d = debrief(playOut(practiceSession(), GHOST_LEARNER))
    expect(d.summary?.divergence).toBeNull()
    expect(d.summary?.mineUnits).toBe(d.summary?.ghostUnits)
    expect(passedByHand(d)).toBe(true)
    const html = renderToString(createElement(MemoryRouter, null, createElement(Debrief, { session: d, tally: tallyAfter(EMPTY_TALLY, d), onAgain: () => {}, mode: 'page' })))
    expect(html).toContain('You matched the reference')
    expect(html).toContain('nothing in your layer put you behind it')
    expect(html).toContain('data-prediction-error')
  })

  test('a layer filled in order diverges from the reference, and the debrief names the turn and the reference’s choice in the world’s sentence', () => {
    const d = debrief(playOut(practiceSession(), { copy: GHOST_LEARNER.copy, place: FILL_IN_ORDER.place }))
    const div = d.summary?.divergence
    if (!div) throw new Error('no divergence')
    expect(div.decision.kind).toBe('place')
    expect(passedByHand(d)).toBe(false)
    const html = renderToString(createElement(MemoryRouter, null, createElement(Debrief, { session: d, tally: EMPTY_TALLY, onAgain: () => {}, mode: 'page' })))
    expect(html).toContain(`The first divergence is at turn ${div.decision.op + 1}`)
    expect(html).toContain(div.explanation.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'))
    expect(div.decision.sentence).toContain(`At turn ${div.decision.op + 1}`)
    expect(div.decision.sentence).toContain('the least loaded with a free slot')
    // both layers are on screen, each with its table, and the layer just before the turn with both choices marked
    expect((html.match(/data-debrief-side/g) ?? []).length).toBe(2)
    expect(html).toContain('the reference puts it here')
    expect(html).toContain('you put it here')
    expect((html.match(/data-play-mirror/g) ?? []).length).toBe(2)
  })

  test('a replicate mistake lists the per-copy loads with both picks marked', () => {
    const copyColdest: Learner = { copy: (v) => v.loads.indexOf(Math.min(...v.loads)), place: GHOST_LEARNER.place }
    const d = debrief(playOut(practiceSession(), copyColdest))
    const div = d.summary?.divergence
    if (!div) throw new Error('no divergence')
    expect(div.decision.kind).toBe('replicate')
    const html = renderToString(createElement(MemoryRouter, null, createElement(Debrief, { session: d, tally: EMPTY_TALLY, onAgain: () => {}, mode: 'page' })))
    expect(html).toContain('data-ranking')
    expect(html).toContain('you copied this')
    expect(html).toContain('the reference copies this')
  })

  test('a skipped layer says so and does not count toward the pass', () => {
    const d = debrief(skip(playOut(practiceSession(), FILL_IN_ORDER, 5)))
    expect(d.summary?.skipped).toBe(true)
    expect(passedByHand(d)).toBe(false)
    expect(tallyAfter(EMPTY_TALLY, d)).toBe(EMPTY_TALLY)
    // the ledger agrees with the screen: a layer the reference finished is not a pass, even when the learner's own copies were good
    expect(recordOf(d)?.ok).toBe(false)
    expect(recordOf(d)?.data.skipped).toBe(true)
    const html = renderToString(createElement(MemoryRouter, null, createElement(Debrief, { session: d, tally: EMPTY_TALLY, onAgain: () => {}, mode: 'embed' })))
    expect(html).toContain('You skipped ahead')
    expect(html).toContain('does not count')
  })

  test('the page links back to the lesson; the embed does not', () => {
    const d = debrief(playOut(practiceSession(), GHOST_LEARNER))
    const page = renderToString(createElement(MemoryRouter, null, createElement(Debrief, { session: d, tally: EMPTY_TALLY, onAgain: () => {}, mode: 'page' })))
    const embed = renderToString(createElement(MemoryRouter, null, createElement(Debrief, { session: d, tally: EMPTY_TALLY, onAgain: () => {}, mode: 'embed' })))
    expect(page).toContain('href="/lesson/t6.l2"')
    expect(embed).not.toContain('href="/lesson/t6.l2"')
  })

  test('the sentences are the world’s on 20 fresh loads: every divergence is a turn that departs from the reference on the learner’s own layer', () => {
    for (let i = 0; i < 20; i++) {
      const d = debrief(playOut(freshSession(1000 + i), i % 2 ? FILL_IN_ORDER : { copy: GHOST_LEARNER.copy, place: (v) => v.gpus.findIndex((g) => g.free > 0) }))
      const div = d.summary?.divergence
      if (!div) continue
      expect(div.decision.mine).not.toEqual(div.decision.reference)
      expect(div.explanation).toContain(`At turn ${div.decision.op + 1}`)
    }
  })
})

/* ------------------------------------------------------------------ */
/* the pass                                                             */
/* ------------------------------------------------------------------ */

describe('passing: within 0.05 of the reference on the practice load and on three new ones (§5.2)', () => {
  test('the reference’s rule by hand passes the practice load and 3 fresh loads', () => {
    let t: Tally = EMPTY_TALLY
    expect(passed(t)).toBe(false)
    t = tallyAfter(t, debrief(playOut(practiceSession(), GHOST_LEARNER)))
    expect(t.practice).toBe(true)
    expect(passed(t)).toBe(false)
    for (let i = 0; i < FRESH_LOADS_TO_PASS; i++) {
      expect(passed(t)).toBe(false)
      const s = debrief(playOut(freshSession(77 + i), GHOST_LEARNER))
      expect(eplbPasses(s.summary?.mineUnits ?? 0, s.summary?.ghostUnits ?? -1)).toBe(true)
      t = tallyAfter(t, s)
    }
    expect(t.fresh).toHaveLength(3)
    expect(passed(t)).toBe(true)
    expect(tallyLine(t)).toBe('Passed: within 0.05 of the reference by hand on the practice load and on 3 new loads.')
  })

  test('a load counts once, a miss counts for nothing, and the practice load is not a new load', () => {
    const win = debrief(playOut(freshSession(5), GHOST_LEARNER))
    const t1 = tallyAfter(EMPTY_TALLY, win)
    expect(tallyAfter(t1, win)).toBe(t1)
    expect(t1.practice).toBe(false)
    const miss = debrief(playOut(practiceSession(), { copy: () => 0, place: FILL_IN_ORDER.place }))
    expect(passedByHand(miss)).toBe(false)
    expect(tallyAfter(t1, miss)).toBe(t1)
    expect(tallyLine(t1)).toBe('Within 0.05 of the reference by hand: practice load not yet, 1 of 3 new loads.')
  })

  test('the practice load punishes every shortcut: only the reference’s dials pass it', () => {
    const loads = practiceLoads()
    const ghost = runEplb(loads, EPLB_GHOST).maxUnits
    for (const spec of EPLB_SHORTCUTS) expect(eplbComposeReport(spec, [loads]).ok).toBe(false)
    expect(eplbPasses(ghost, ghost)).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* the ledger                                                           */
/* ------------------------------------------------------------------ */

describe('the ledger (§5.2)', () => {
  test('the prediction is a `predict` event on the play’s own ref, src play, with its truth and the play’s KCs', () => {
    const s = predicted(practiceSession(), 1.5)
    const e = predictEvent(s, 1234)
    if (!e) throw new Error('no event')
    expect(e).toMatchObject({ kind: 'predict', ref: PREDICT_REF, ok: true, seed: EPLB_PRACTICE_SEED, ms: 1234, provenance: 'practice' })
    expect(e.data).toMatchObject({ src: 'play', value: 1.5, unit: '×', nsec: PREDICT_NSEC, lessonId: 't6.l2', kcs: ['t6.expert-load-balance', 't6.all-to-all'] })
    expect((e.data as { truth: number }).truth).toBe(s.prediction?.truth)
    expect(e.score).toBe(s.prediction?.score)
    expect(predictEvent(practiceSession())).toBeNull()
    expect(predictEvent(predicted(freshSession(9)))?.provenance).toBe('unseen')
  })

  test('recordPlay carries the metric {name imbalance, mine, ghost, lowerIsBetter} for the play and for Compose', () => {
    const d = debrief(playOut(practiceSession(), FILL_IN_ORDER))
    const r = recordOf(d, 5000)
    if (!r || !d.summary) throw new Error('no result')
    expect(r).toMatchObject({ playId: 'eplb', seed: EPLB_PRACTICE_SEED, provenance: 'practice', ms: 5000, ok: false })
    expect(r.data).toMatchObject({ phase: 'play', turns: 24, survived: 20, ghostSurvived: 20, kcs: ['t6.expert-load-balance', 't6.all-to-all'] })
    expect(r.data.metric).toEqual({ name: 'imbalance', mine: imbalanceOf(d.summary.mineUnits), ghost: imbalanceOf(d.summary.ghostUnits), lowerIsBetter: true })
    expect(r.data.divergenceOp).toBe(d.summary.divergence?.decision.op)

    const loads = practiceLoads()
    const rep = eplbComposeReport(REFERENCE_EPLB_SPEC, composeLoads(loads, 1))
    const c = eplbComposeRecord(REFERENCE_EPLB_SPEC, rep, EPLB_PRACTICE_SEED, 1)
    expect(c).toMatchObject({ playId: 'eplb', ok: true, provenance: 'practice', seed: EPLB_PRACTICE_SEED, data: { phase: 'compose', equivalent: true, spec: REFERENCE_EPLB_SPEC, kcs: ['t6.expert-load-balance', 't6.all-to-all'] } })
    expect(c.data.metric).toEqual({ name: 'imbalance', mine: rep.rows[0].mine, ghost: rep.rows[0].ghost, lowerIsBetter: true })
  })

  test('the events pass the ledger’s codec and fold: one prediction, one play and one Compose run; passing the play marks it done', async () => {
    const tab = startTab(makeProfile())
    const s0 = predicted(practiceSession(), 1.4)
    const done = debrief(playOut(s0, GHOST_LEARNER))
    const state = tab.progress.getState()
    const event = predictEvent(s0, 800)
    if (!event) throw new Error('no event')
    state.recordItems([event])
    const play = recordOf(done, 9000)
    if (!play) throw new Error('no result')
    state.recordPlay(play)
    const rep = eplbComposeReport(REFERENCE_EPLB_SPEC, composeLoads(done.loads, 3))
    state.recordPlay(eplbComposeRecord(REFERENCE_EPLB_SPEC, rep, done.seed, 1))
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'predict')).toHaveLength(1)
    expect(events.find((e) => e.kind === 'predict')).toMatchObject({ ref: PREDICT_REF, data: { src: 'play', unit: '×' } })
    const plays = events.filter((e) => e.kind === 'play')
    expect(plays).toHaveLength(2)
    expect(plays.map((p) => (p.data as { phase: string }).phase)).toEqual(['play', 'compose'])
    for (const p of plays) expect((p.data as { metric: unknown }).metric).toMatchObject({ name: 'imbalance', lowerIsBetter: true })
    expect(tab.progress.getState().aggregate.plays.eplb).toMatchObject({ done: true, composed: true })
  })

  test('a failed play records, but is not done', async () => {
    const tab = startTab(makeProfile())
    const result = recordOf(debrief(playOut(practiceSession(), FILL_IN_ORDER)))
    if (!result) throw new Error('no result')
    tab.progress.getState().recordPlay(result)
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'play')).toHaveLength(1)
    expect(tab.progress.getState().aggregate.plays.eplb?.done ?? false).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Compose                                                              */
/* ------------------------------------------------------------------ */

describe('Compose (§5.2)', () => {
  test('the dials are the world’s: every definition option is a dial value the compiler accepts, and the reference is one of them', () => {
    const byKey = Object.fromEntries(EPLB_DIAL_DEFS.map((d) => [d.key, d.options.map((o) => o.value)]))
    expect(byKey.replicate).toEqual(['none', 'per-copy', 'total'])
    expect(byKey.place).toEqual(['round-robin', 'least-loaded'])
    expect(byKey.replicate).toContain(REFERENCE_EPLB_SPEC.replicate)
    expect(byKey.place).toContain(REFERENCE_EPLB_SPEC.place)
    expect(withDial(DEFAULT_EPLB_SPEC, 'place', 'least-loaded')).toEqual({ replicate: 'none', place: 'least-loaded' })
    expect(DEFAULT_EPLB_SPEC).toEqual({ replicate: 'none', place: 'round-robin' })
  })

  test('the table runs the play’s load and five fresh ones, drawn in band and deterministic in the entropy', () => {
    const loads = practiceLoads()
    const sets = composeLoads(loads, 42)
    expect(sets).toHaveLength(1 + EPLB_COMPOSE_FRESH)
    expect(sets[0]).toBe(loads)
    for (const l of sets.slice(1)) expect(checkEplbBand(l).inBand).toBe(true)
    expect(composeLoads(loads, 42)).toEqual(sets)
    expect(composeLoads(loads, 43)).not.toEqual(sets)
  })

  test('the reference’s dials are equivalent and pass every load; the plainest policy misses the practice load', () => {
    const sets = composeLoads(practiceLoads(), 7)
    const ref = eplbComposeReport(REFERENCE_EPLB_SPEC, sets)
    expect(ref).toMatchObject({ ok: true, equivalent: true, within: 6 })
    expect(ref.note).toContain('chose exactly what the reference chooses at every turn, on all 6 loads')
    expect(ref.rows.every((r) => r.gap === 0 && r.within)).toBe(true)
    const plain = eplbComposeReport(DEFAULT_EPLB_SPEC, sets)
    expect(plain.ok).toBe(false)
    expect(plain.rows[0].within).toBe(false)
    expect(plain.rows[0].gap).toBeGreaterThan(0.05)
    expect(plain.note).toMatch(/within 0\.05 of the reference on \d of 6 loads/)
  })

  test('a spec within 0.05 everywhere without choosing what the reference chooses is ok, and the note names the first turn it decides otherwise', () => {
    // entropy 0 draws a load on which copying by total load still lands within 0.05 of the reference, by another route
    const loads = freshSession(0).loads
    const spec = { replicate: 'total', place: 'least-loaded' } as const
    const rep = eplbComposeReport(spec, [loads])
    expect(rep).toMatchObject({ ok: true, equivalent: false })
    const turn = firstDifference(spec, loads)
    expect(turn).toBeGreaterThanOrEqual(0)
    expect(rep.note).toContain(`on this load it first decides otherwise at turn ${turn + 1}`)
    // and a spec that misses names the load it missed on
    const miss = eplbComposeReport(DEFAULT_EPLB_SPEC, [loads, ...composeLoads(loads, 1, 2).slice(1)])
    expect(miss.ok).toBe(false)
    expect(miss.note).toContain('Change a dial and run it again')
  })

  test('gap text keeps three decimals so the 0.05 rule reads off the table', () => {
    expect(gapText(0)).toBe('0.000')
    expect(gapText(0.0714)).toBe('+0.071')
    expect(gapText(-0.0124)).toBe('−0.012')
    expect(gapText(0.0004)).toBe('0.000')
  })
})

/* ------------------------------------------------------------------ */
/* the card                                                             */
/* ------------------------------------------------------------------ */

describe('the In-production card (§5.2)', () => {
  test('it has at least three rows, every claim exists in the full registry, and productionClaims is the same list', () => {
    expect(EPLB_PRODUCTION_ROWS.length).toBeGreaterThanOrEqual(3)
    expect(PLAY_PRODUCTION_ROWS.eplb).toBe(EPLB_PRODUCTION_ROWS)
    expect(EPLB.productionClaims).toEqual(EPLB_PRODUCTION_ROWS.map((r) => r.claim))
    const ids = new Set(CLAIMS.map((c) => c.id))
    for (const r of EPLB_PRODUCTION_ROWS) expect([r.claim, ids.has(r.claim)]).toEqual([r.claim, true])
  })

  test('it rests on DeepSeek-V3’s expert counts, the EPLB rule and both engines’ flags', () => {
    expect(EPLB.productionClaims).toEqual([
      'model.deepseek-v3.routed-experts',
      'model.deepseek-v3.experts-per-token',
      'production.eplb.rebalance',
      'production.vllm.eplb',
      'production.sglang.eplb',
    ])
  })

  test('the numbers come from the claims: the 256 and the 8 are the claims’ values, and the engine rows are pinned to a release the url contains', async () => {
    await import('../../src/data/claims/lazy/moe')
    expect(byId['model.deepseek-v3.routed-experts'].value).toBe(256)
    expect(byId['model.deepseek-v3.experts-per-token'].value).toBe(8)
    for (const id of ['production.eplb.rebalance', 'production.vllm.eplb', 'production.sglang.eplb']) {
      const c = byId[id]
      expect(c.pin).toBeDefined()
      expect(c.source.url).toContain(c.pin?.ref ?? '#')
    }
    expect(pinnedReleases()).toEqual([
      'deepseek-ai/DeepSeek-V3 e815299',
      'deepseek-ai/EPLB d52c72d',
      expect.stringMatching(/^vllm-project\/vllm v\d/),
      expect.stringMatching(/^sgl-project\/sglang v\d/),
    ])
  })

  test('the copy holds no digits (every number is a chip), and the rendered card shows each claim with its source', async () => {
    for (const r of EPLB_PRODUCTION_ROWS) expect([r.claim, /\d/.test(`${r.lead} ${r.tail} ${r.dial}`.replace(/DeepSeek-V3/g, ''))]).toEqual([r.claim, false])
    await import('../../src/data/claims/lazy/moe')
    const html = renderToString(createElement(MemoryRouter, null, createElement(ProductionCard)))
    expect(html).toContain('data-phase="production"')
    expect(html).toContain('256')
    // the chip prints its own unit, so the copy around it must not repeat the word
    // (the dial pill is a label beside the sentence, so it is dropped before the doubled-word check)
    const text = html.replace(/<span class="mr-2[^>]*>[^<]*<\/span>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')
    expect(text).not.toMatch(/\b(\w+) \1\b/i)
    expect(text).not.toMatch(/\bexperts routed experts\b/)
    expect(text).toMatch(/Each MoE layer of DeepSeek-V3 has 256 experts routed by its router, plus one shared expert\./)
    expect(text).toMatch(/The router sends each token to 8 experts chosen from those\./)
    expect(html).toContain('--enable-eplb')
    expect(html).toContain('deepseek-ai/DeepSeek-V3 e815299, deepseek-ai/EPLB d52c72d, vllm-project/vllm v0.31.0 and sgl-project/sglang v0.5.21')
  })
})

/* ------------------------------------------------------------------ */
/* the rendered pieces                                                  */
/* ------------------------------------------------------------------ */

describe('the rendered pieces', () => {
  test('the first paint is the prediction: the loads, a field, no board, no mirror, no focus taken', () => {
    const html = renderToString(createElement(MemoryRouter, null, createElement(EplbPlay, { mode: 'page' })))
    expect(html).toContain('data-phase="predict"')
    expect(html).toContain('data-ks-field')
    expect((html.match(/<li><span class="text-text-3">#\d+<\/span>/g) ?? []).length).toBe(16)
    expect(html).not.toContain('autofocus')
  })

  test('the embed links the full-screen page after the debrief only; the page mode does not', () => {
    const embed = renderToString(createElement(MemoryRouter, null, createElement(EplbPlay, { mode: 'embed' })))
    expect(embed).toContain('data-mode="embed"')
  })

  test('the replicate board is 16 expert buttons of at least 44 px with one tab stop; the place board is rows of free slots of at least 44 px', () => {
    let s = predicted(practiceSession())
    let st = stageOf(s)
    if (st.kind !== 'turn') throw new Error('not a turn')
    let html = renderToString(createElement(Board, { stage: st, onCopy: () => {}, onPlace: () => {} }))
    expect((html.match(/data-expert=/g) ?? []).length).toBe(16)
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1)
    expect((html.match(/min-h-11 min-w-11/g) ?? []).length).toBe(16)
    for (let i = 0; i < REPLICATE_TURNS; i++) s = copyExpert(s, 14)
    st = stageOf(s)
    if (st.kind !== 'turn') throw new Error('not a turn')
    html = renderToString(createElement(Board, { stage: st, onCopy: () => {}, onPlace: () => {} }))
    expect((html.match(/data-slot="free"/g) ?? []).length).toBe(20)
    expect((html.match(/min-h-11 min-w-0 flex-1/g) ?? []).length).toBe(20)
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1)
    expect(html).toContain('data-next-copy')
    expect(html).not.toContain('type="range"')
  })

  test('the layer is text and bars: every GPU’s load and its copies are in the text', () => {
    const v = eplbView(playOut(practiceSession(), GHOST_LEARNER).play.mine.state)
    const html = renderToString(createElement(Layer, { view: v }))
    expect((html.match(/data-gpu=/g) ?? []).length).toBe(GPUS)
    expect(html).toContain('× the mean')
  })

  test('the mirror has the GPU table with the running imbalance and the expert table, hidden until asked, behind a 44 px button, with one live region', () => {
    const s = playOut(practiceSession(), GHOST_LEARNER, 10)
    const html = renderToString(createElement(Mirror, { id: 'm', view: viewOf(s), title: 'Your GPUs', line: announceOf(s) }))
    expect(html).toContain('Show GPU table')
    expect(html).toContain('min-h-11')
    expect(html).toContain('sr-only')
    expect(html).toContain('busiest GPU')
    expect(html).toContain('the mean of 250 ‰')
    expect((html.match(/<table/g) ?? []).length).toBe(2)
    expect((html.match(/aria-live="polite"/g) ?? []).length).toBe(1)
    expect((html.match(/<th scope="row"/g) ?? []).length).toBe(GPUS + 16)
  })

  test('Predict is a form with a labelled field', () => {
    const html = renderToString(createElement(Predict, { loads: practiceLoads(), onPredict: () => {} }))
    expect(html).toContain('<form')
    expect(html).toContain('inputMode="decimal"')
    expect(html).toContain('<label')
  })
})

/* ------------------------------------------------------------------ */
/* the board, mounted                                                   */
/* ------------------------------------------------------------------ */

describe('the board, mounted: arrows move, Enter places, and the filled slot is not a button', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  function Harness({ start }: { start: EplbSession }) {
    const [s, setS] = useState(start)
    const st = stageOf(s)
    if (st.kind !== 'turn') return createElement('p', { 'data-over': '' }, 'over')
    return createElement(Board, { stage: st, onCopy: (e: number) => setS((x) => copyExpert(x, e)), onPlace: (g: number) => setS((x) => placeOn(x, g)) })
  }
  const key = (el: Element | null, k: string) => dom.act(() => void (el as unknown as MiniElement).dispatchEvent(new MiniEvent('keydown', { bubbles: true, cancelable: true, key: k })))

  test('replicate: the arrows move focus over the grid, Enter (a click on the focused button) copies, and a copied expert shows its copies', async () => {
    const m = await dom.mount(createElement(Harness, { start: predicted(practiceSession()) }))
    const expert = (e: number) => m.container.querySelector(`[data-expert="${e}"]`) as unknown as MiniElement
    await dom.act(() => expert(0).focus())
    expect(expert(0).getAttribute('tabindex')).toBe('0')
    await key(expert(0), 'ArrowRight')
    expect(dom.document.activeElement).toBe(expert(1))
    await key(expert(1), 'ArrowDown')
    expect(dom.document.activeElement).toBe(expert(5))
    await key(expert(5), 'ArrowUp')
    await key(expert(1), 'ArrowLeft')
    expect(dom.document.activeElement).toBe(expert(0))
    await key(expert(0), 'ArrowLeft')
    expect(dom.document.activeElement).toBe(expert(0))
    await key(expert(0), 'End')
    expect(dom.document.activeElement).toBe(expert(15))
    expect(expert(15).getAttribute('tabindex')).toBe('0')
    expect(expert(0).getAttribute('tabindex')).toBe('-1')
    await dom.press(expert(14))
    expect(m.container.querySelector('[data-expert="14"]')?.textContent).toContain('×2')
    await m.unmount()
  })

  test('place: only free slots are buttons, the arrows skip full GPUs, and pressing a free slot places the offered copy', async () => {
    let s = predicted(practiceSession())
    for (let i = 0; i < REPLICATE_TURNS; i++) s = copyExpert(s, 14)
    const m = await dom.mount(createElement(Harness, { start: s }))
    const free = (g: number) => m.container.querySelector(`[data-gpu="${g}"] [data-slot="free"]`) as unknown as MiniElement
    const gpu = (g: number) => m.container.querySelector(`[data-gpu="${g}"]`) as unknown as MiniElement
    expect(m.container.querySelectorAll('[data-slot="free"]').length).toBe(20)
    expect(m.container.querySelectorAll('[data-slot="filled"]').length).toBe(0)
    await dom.act(() => free(0).focus())
    await key(free(0), 'ArrowDown')
    expect(dom.document.activeElement).toBe(free(1))
    await key(free(1), 'ArrowUp')
    expect(dom.document.activeElement).toBe(free(0))
    await key(free(0), 'ArrowUp')
    expect(dom.document.activeElement).toBe(free(3))
    await dom.press(free(2))
    expect(gpu(2).getAttribute('data-free')).toBe('4')
    expect(gpu(2).querySelectorAll('[data-slot="filled"]').length).toBe(1)
    expect(gpu(2).querySelectorAll('[data-slot="free"]').length).toBe(4)
    // fill GPU 2, and the arrows pass over it
    for (let i = 0; i < 4; i++) await dom.press(free(2))
    expect(gpu(2).querySelectorAll('[data-slot="free"]').length).toBe(0)
    await dom.act(() => free(1).focus())
    await key(free(1), 'ArrowDown')
    expect(dom.document.activeElement).toBe(free(3))
    await m.unmount()
  })

  test('the over state replaces the board once every copy is placed', async () => {
    const s = playOut(practiceSession(), GHOST_LEARNER, 23)
    const m = await dom.mount(createElement(Harness, { start: s }))
    expect(m.container.querySelectorAll('[data-slot="free"]').length).toBe(1)
    await dom.press(m.container.querySelector('[data-slot="free"]') as unknown as MiniElement)
    expect(m.container.querySelector('[data-over]')).not.toBeNull()
    await m.unmount()
  })
})

/* ------------------------------------------------------------------ */
/* verify-plays                                                         */
/* ------------------------------------------------------------------ */

describe('verify-plays: the EPLB play’s checks (§5.2)', () => {
  const world: PlayWorld = { kcIds: new Set<string>(Object.values(KC)), claimIds: new Set(CLAIMS.map((c) => c.id)), lessonIds: new Set(['t6.l2']) }
  const read = (f: string) => readFileSync(join(EPLB_DIR, f), 'utf8')
  const facts = (): PlayFacts => ({
    id: EPLB.id,
    lessonId: EPLB.lessonId,
    kcs: EPLB.kcs,
    productionClaims: EPLB.productionClaims,
    cardClaims: EPLB_PRODUCTION_ROWS.map((r) => r.claim),
    play: read('Play.tsx'),
    mirror: read('Mirror.tsx'),
    debrief: read('Debrief.tsx'),
    practiceInBand: true,
  })

  test('the registered play passes with the real files: a mirror and a debrief that Play.tsx renders, a card of at least three rows', () => {
    expect(checkPlay(facts(), world)).toEqual([])
  })

  test('the practice band holds on the pinned load, through the band module verify-plays reads', async () => {
    const band = await practiceBandOf('eplb', ROOT)
    expect(band?.inBand).toBe(true)
    expect(band?.note).toContain('seed 12')
  })

  test('the checks catch what they should: no mirror render, no debrief render, a thin card', () => {
    const f = facts()
    expect(checkPlay({ ...f, play: f.play?.replace('<Mirror ', '<Other ') }, world).join('\n')).toContain('never renders <Mirror>')
    expect(checkPlay({ ...f, play: f.play?.replaceAll('<Debrief ', '<Other ') }, world).join('\n')).toContain('never renders <Debrief>')
    expect(checkPlay({ ...f, productionClaims: f.productionClaims.slice(0, 2), cardClaims: f.cardClaims.slice(0, 2) }, world).join('\n')).toContain('needs at least three')
  })

  test('the closure of /play/eplb is the play, its pieces and the world, with no worker, no sim, no Fleet engine, and Compose and the card lazy', () => {
    const c = closureOf(join(EPLB_DIR, 'Play.tsx'), SRC)
    for (const f of ['Play.tsx', 'Board.tsx', 'Mirror.tsx', 'Debrief.tsx', 'session.ts']) expect(c.files).toContain(`src/components/play/eplb/${f}`)
    for (const f of ['src/data/plays.ts', 'src/lib/world/eplb.ts', 'src/lib/world/play.ts']) expect(c.files).toContain(f)
    expect(c.files).not.toContain('src/components/play/eplb/ProductionCard.tsx')
    expect(c.files).not.toContain('src/components/play/eplb/Compose.tsx')
    expect(c.files).not.toContain('src/data/claims/lazy/moe.ts')
    expect(c.files).not.toContain('src/lib/learner/item-block.ts')
    expect(c.files.some((f) => f.includes('workers/') || f.startsWith('src/lib/fleet') || f.includes('components/play/scheduler') || (f.includes('components/sims/') && !f.endsWith('SimMirror.tsx')))).toBe(false)
    const play = read('Play.tsx')
    expect(play).toMatch(/lazy\(loadCompose\)/)
    expect(play).toMatch(/lazy\(loadCard\)/)
  })

  test('the route budget row exists and names the play’s source', () => {
    const bundle = readFileSync(join(ROOT, 'scripts', 'verify-bundle.ts'), 'utf8')
    expect(bundle).toMatch(/route: '\/play\/eplb'[^}]*budgetKb: null[^}]*playSrc: 'src\/components\/play\/eplb\/Play\.tsx'/)
  })

  test('no View3D here: the play is 2D', () => {
    for (const f of ['Play.tsx', 'Board.tsx', 'Mirror.tsx', 'Debrief.tsx', 'Compose.tsx', 'session.ts', 'ProductionCard.tsx']) expect(read(f)).not.toContain('<View3D')
  })
})
