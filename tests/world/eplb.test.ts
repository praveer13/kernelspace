import { describe, expect, test } from 'bun:test'
import { validateEvent } from '../../src/lib/ledger/codec'
import { splitmix32u } from '../../src/lib/rng'
import { ACCEPTANCE_CANDIDATES, band, eplbAcceptancePermille, eplbBandResult } from '../../src/lib/world/bands/eplb'
import {
  EPLB_GHOST,
  EPLB_OPS,
  EPLB_PLAY_ID,
  EPLB_PRACTICE_SEED,
  EPLB_TURNS,
  EXPERTS,
  GPUS,
  MEAN_UNITS,
  PASS_MARGIN_UNITS,
  SKIP_AFTER_TURNS,
  SLOTS_PER_GPU,
  canSkipEplb,
  checkEplbBand,
  decisionSentence,
  drawEplb,
  drawLoads,
  eplbDecisionProblems,
  eplbDivergence,
  eplbModel,
  eplbPasses,
  eplbPlayResult,
  eplbSetup,
  eplbTurnLine,
  eplbView,
  makeLoads,
  outcomeSentence,
  permille,
  practiceLoads,
  recoveryMargin,
  roundRobinUnits,
  runEplb,
  summarizeEplb,
  type EplbDecision,
  type EplbReq,
  type EplbSetup,
  type EplbState,
  type EplbView,
} from '../../src/lib/world/eplb'
import { compileEplbPolicy } from '../../src/lib/world/eplb-policy'
import { pendingAsk, playAll, playTurn, skipToDebrief, startPlay, type Decider } from '../../src/lib/world/play'
import { evt } from '../ledger/gen'

/**
 * The EPLB world (docs/specs/wave-3.md §5.2, task 3a-14). Every check of the ghost and the debrief below recomputes
 * its facts from the learner's layer with its own arithmetic (cross-multiplied loads per copy, summed GPU loads), so a
 * sentence is tested against the world, never against the spec's example sentences.
 */

/** The Opus check prints its table and sample debriefs only when asked: EPLB_REPORT=1 bun test tests/world/eplb.test.ts */
const REPORT = Boolean(process.env.EPLB_REPORT)

/** 50 banded loads, drawn the way the play draws fresh ones. */
const BANDED = Array.from({ length: 50 }, (_, i) => ({ seed: (i + 1) * 7919, loads: drawLoads((i + 1) * 7919) }))
const PRACTICE = practiceLoads()

type Learner = Decider<EplbView, EplbReq, EplbDecision>

/* ------------------------------------------------------------------ */
/* An oracle of its own                                                 */
/* ------------------------------------------------------------------ */

const unitsPerCopy = (s: EplbState, e: number) => (s.loads[e] * 60) / s.copies[e]
const gpuUnits = (s: EplbState, g: number) => s.gpus[g].reduce((a, e) => a + unitsPerCopy(s, e), 0)
/** Expert a carries more per copy than b: loads[a]/copies[a] > loads[b]/copies[b], cross-multiplied. */
const heavier = (s: EplbState, a: number, b: number) => s.loads[a] * s.copies[b] > s.loads[b] * s.copies[a]

function oracleCopy(s: EplbState): number {
  let best = 0
  for (let e = 1; e < EXPERTS; e++) if (heavier(s, e, best)) best = e
  return best
}

function oracleGpu(s: EplbState): number {
  let best = -1
  for (let g = 0; g < GPUS; g++) if (s.gpus[g].length < SLOTS_PER_GPU && (best < 0 || gpuUnits(s, g) < gpuUnits(s, best))) best = g
  return best
}

/** The heaviest copy not yet placed (ties to the lower expert), or -1. */
function oracleNext(s: EplbState): number {
  let best = -1
  for (let e = 0; e < EXPERTS; e++) if (s.placed[e] < s.copies[e] && (best < 0 || heavier(s, e, best))) best = e
  return best
}

const maxUnits = (s: EplbState) => Math.max(...Array.from({ length: GPUS }, (_, g) => gpuUnits(s, g)))

/** The oracle's rule finishing a layer from op `from`. */
function oracleFinish(setup: EplbSetup, state: EplbState, from: number): EplbState {
  let s = state
  for (let i = from; i < EPLB_OPS.length; i++) {
    const op = EPLB_OPS[i]
    const d: EplbDecision | null =
      op.kind === 'replicate' ? { kind: 'replicate', expert: oracleCopy(s) } : oracleNext(s) < 0 ? null : { kind: 'place', gpu: oracleGpu(s) }
    s = setup.model.apply(s, op, d).state
  }
  return s
}

/* ------------------------------------------------------------------ */
/* Simulated learners (the Opus check's panel)                          */
/* ------------------------------------------------------------------ */

const reference = compileEplbPolicy({ replicate: 'per-copy', place: 'least-loaded' })

/** Six learners, one per kind of mistake: placement by turn, copying by total, filling GPUs in order, cold copies, one slip, random. */
function learners(seed: number): Learner[] {
  const rnd = splitmix32u(seed)
  const slipAt = 4 + (rnd() % 20)
  return [
    { ...compileEplbPolicy({ replicate: 'per-copy', place: 'round-robin' }), name: 'round-robin' },
    { ...compileEplbPolicy({ replicate: 'total', place: 'least-loaded' }), name: 'total' },
    { name: 'fill-in-order', decide: (v, r) => (r.kind === 'replicate' ? reference.decide(v, r) : { kind: 'place', gpu: v.gpus.findIndex((g) => g.free > 0) }) },
    {
      name: 'cold-copies',
      decide(v, r) {
        if (r.kind === 'place') return reference.decide(v, r)
        let best = 0
        for (let e = 1; e < EXPERTS; e++) if (v.perCopy[e] < v.perCopy[best]) best = e
        return { kind: 'replicate', expert: best }
      },
    },
    {
      name: 'one-slip',
      decide(v, r) {
        const d = reference.decide(v, r)
        if (r.kind !== 'place' || v.turn !== slipAt) return d
        const free = v.gpus.flatMap((g, i) => (g.free > 0 ? [{ i, units: g.units }] : [])).sort((a, b) => a.units - b.units || a.i - b.i)
        return { kind: 'place', gpu: (free[1] ?? free[0]).i }
      },
    },
    {
      name: 'random',
      decide(v, r) {
        if (r.kind === 'replicate') return { kind: 'replicate', expert: rnd() % EXPERTS }
        const free = v.gpus.flatMap((g, i) => (g.free > 0 ? [i] : []))
        return { kind: 'place', gpu: free[rnd() % free.length] }
      },
    },
  ]
}

const ghostLearner: Learner = { name: 'ghost', decide: (v, r) => EPLB_GHOST.decide(v, r) }

/* ------------------------------------------------------------------ */
/* Loads and the band                                                   */
/* ------------------------------------------------------------------ */

describe('loads and the band', () => {
  test('drawLoads gives 16 whole per-mille loads summing to 1,000, in band, the same every time', () => {
    for (const seed of [...Array.from({ length: 200 }, (_, i) => i), ...BANDED.map((b) => b.seed), 0xffffffff]) {
      const loads = drawLoads(seed)
      expect(loads).toHaveLength(EXPERTS)
      for (const l of loads) {
        expect(Number.isInteger(l)).toBe(true)
        expect(l).toBeGreaterThanOrEqual(1)
      }
      expect(loads.reduce((a, b) => a + b, 0)).toBe(1000)
      expect(checkEplbBand(loads).inBand).toBe(true)
      expect(drawLoads(seed)).toEqual(loads)
    }
  })

  test('a draw keeps the entropy itself when it is in band, and otherwise its first in-band splitmix32 output', () => {
    for (let seed = 0; seed < 100; seed++) {
      const d = drawEplb(seed)
      expect(d.loads).toEqual(makeLoads(d.candidate))
      if (checkEplbBand(makeLoads(seed)).inBand) expect([d.candidate, d.draws]).toEqual([seed, 1])
      else {
        const more = splitmix32u(seed)
        const tried = Array.from({ length: d.draws - 1 }, () => more())
        expect(tried[tried.length - 1]).toBe(d.candidate)
        for (const c of tried.slice(0, -1)) expect(checkEplbBand(makeLoads(c)).inBand).toBe(false)
      }
    }
  })

  test('the hottest expert is drawn inside rule 1, and the tail is skewed', () => {
    let skewed = 0
    for (let c = 0; c < 1000; c++) {
      const loads = makeLoads(c)
      expect(loads.reduce((a, b) => a + b, 0)).toBe(1000)
      expect(Math.min(...loads)).toBeGreaterThanOrEqual(1)
      expect(loads.some((l) => l >= 150 && l <= 300)).toBe(true)
      const sorted = [...loads].sort((a, b) => b - a)
      // Skewed: the four hottest carry more than half the layer, against a quarter for uniform loads.
      if (sorted.slice(0, 4).reduce((a, b) => a + b, 0) > 500) skewed++
    }
    expect(skewed).toBeGreaterThan(900)
  })

  test('acceptance is at least 20 % (printed), and stays where it was measured', () => {
    let k = 0
    for (let c = 0; c < 2000; c++) if (checkEplbBand(makeLoads(c)).inBand) k++
    const pct = (k * 100) / 2000
    console.log(`EPLB band acceptance: ${pct.toFixed(1)} % of candidates 0–1,999 (band module: ${(eplbAcceptancePermille() / 10).toFixed(1)} % of 0–${ACCEPTANCE_CANDIDATES - 1})`)
    expect(pct).toBeGreaterThanOrEqual(20)
    expect(pct).toBeGreaterThan(50)
    expect(pct).toBeLessThan(65)
  })

  test('the three rules, checked exactly', () => {
    // Rule 1 and rule 2: near-uniform loads have no hot expert, and round robin is already balanced.
    const flat = [...new Array<number>(8).fill(62), ...new Array<number>(8).fill(63)]
    const f = checkEplbBand(flat)
    expect(f.inBand).toBe(false)
    expect(f.violations.join(' ')).toContain('the hottest expert carries 63 ‰')
    expect(f.violations.join(' ')).toContain('round robin without replicas reaches only 1.00×')
    // Every candidate's verdict is the three comparisons, in units.
    for (let c = 0; c < 2000; c++) {
      const b = checkEplbBand(makeLoads(c))
      const ok = b.hottest >= 150 && b.hottest <= 300 && b.roundRobin * 100 >= 140 * MEAN_UNITS && b.ghost * 100 <= 110 * MEAN_UNITS
      expect(b.inBand).toBe(ok)
      expect(b.violations.length === 0).toBe(ok)
      expect(b.ghost).toBe(runEplb(makeLoads(c), EPLB_GHOST).maxUnits)
    }
  })

  test('round robin without replicas puts the k-th heaviest expert on GPU k mod 4', () => {
    // The practice load, heaviest first: 264, 235, 149, 95, 49, 37, 35, 28, 25, 17, 15, 15, 14, 12, 8, 2.
    // GPU 1 takes 264 + 49 + 25 + 14 = 352 ‰, the busiest: 1.408×.
    expect(roundRobinUnits(PRACTICE)).toBe(352 * 60)
    expect(checkEplbBand(PRACTICE).roundRobin).toBe(352 * 60)
  })

  test('the practice load is pinned, in band, and the ghost balances it to 1.01×', () => {
    expect(EPLB_PRACTICE_SEED).toBe(12)
    expect(PRACTICE).toEqual([15, 15, 235, 149, 35, 95, 17, 28, 37, 8, 14, 25, 2, 49, 264, 12])
    const b = checkEplbBand(PRACTICE)
    expect(b.inBand).toBe(true)
    expect(b.hottest).toBe(264)
    const ghost = runEplb(PRACTICE, EPLB_GHOST)
    expect(ghost.copies).toEqual([1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 1])
    expect(ghost.gpus.map((g) => g.units / 60)).toEqual([250, 247, 251, 252])
    expect(ghost.maxUnits).toBe(252 * 60)
  })

  test('the band module: the practice load in band and acceptance printed, with no file read', async () => {
    const r = await band()
    expect(r.ok).toBe(true)
    expect(r.detail).toContain(`practice load (seed ${EPLB_PRACTICE_SEED}) is in band: hottest expert 264 ‰, round robin without replicas 1.41×, the reference 1.01×`)
    expect(r.detail).toMatch(/acceptance \d+\.\d % of candidates 0–999$/)
  })

  test('the band module fails on an out-of-band practice load, or on acceptance under 20 %', () => {
    const inBand = checkEplbBand(PRACTICE)
    expect(eplbBandResult(inBand, 200).ok).toBe(true)
    const low = eplbBandResult(inBand, 199)
    expect(low.ok).toBe(false)
    expect(low.detail).toContain('acceptance 19.9 % of candidates 0–999, below 20 %')
    const out = eplbBandResult({ ...inBand, inBand: false, violations: ['rule 2 fails'] }, 600)
    expect(out.ok).toBe(false)
    expect(out.detail).toContain('is outside the band (rule 2 fails)')
  })
})

/* ------------------------------------------------------------------ */
/* The turn rule                                                        */
/* ------------------------------------------------------------------ */

describe('the turn rule: 4 replicate turns, then 20 place turns, heaviest copy first', () => {
  test('every learner is asked to replicate 4 times, then to place 20 copies, each the heaviest unplaced one', () => {
    for (const [i, { seed, loads }] of [{ seed: EPLB_PRACTICE_SEED, loads: PRACTICE }, ...BANDED.slice(0, 20)].entries()) {
      for (const l of [ghostLearner, ...learners(i + 1)]) {
        const setup = eplbSetup(loads, seed)
        let ps = startPlay(setup)
        const kinds: string[] = []
        let last = Number.POSITIVE_INFINITY
        while (!ps.mine.ended) {
          const ask = pendingAsk(setup, ps)
          expect(ask).not.toBeNull()
          kinds.push(ask!.req.kind)
          if (ask!.req.kind === 'place') {
            const s = ps.mine.state
            const e = oracleNext(s)
            expect(ask!.req.copy).toEqual({ expert: e, units: unitsPerCopy(s, e) })
            expect(ask!.req.copy.units).toBeLessThanOrEqual(last)
            last = ask!.req.copy.units
          }
          ps = playTurn(setup, ps, l.decide(ask!.view, ask!.req))
        }
        expect(kinds).toEqual([...new Array<string>(4).fill('replicate'), ...new Array<string>(20).fill('place')])
        expect(ps.turns).toBe(EPLB_TURNS)
        const end = ps.mine.state
        expect(end.gpus.map((g) => g.length)).toEqual([5, 5, 5, 5])
        expect(end.placed).toEqual(end.copies)
        expect(end.copies.reduce((a, b) => a + b, 0)).toBe(20)
        expect(eplbView(end).phase).toBe('done')
        // All of the layer's load is placed, so the GPUs sum to 1,000 ‰ and the mean is 250 ‰.
        expect(eplbView(end).gpus.reduce((a, g) => a + g.units, 0)).toBe(1000 * 60)
      }
    }
  })

  test("a copy splits its expert's load evenly over its copies", () => {
    const m = eplbModel(PRACTICE)
    let s = m.init()
    for (let i = 0; i < 2; i++) s = m.apply(s, EPLB_OPS[i], { kind: 'replicate', expert: 14 }).state
    const v = m.view(s)
    expect(v.copies[14]).toBe(3)
    expect(v.perCopy[14]).toBe(88 * 60)
    s = m.apply(s, EPLB_OPS[2], { kind: 'replicate', expert: 3 }).state
    expect(m.view(s).perCopy[3]).toBe(74.5 * 60)
    expect(permille(m.view(s).perCopy[3])).toBe('74.5 ‰')
    expect(m.view(s).phase).toBe('replicate')
  })

  test('illegal moves throw, and the problems say why', () => {
    const m = eplbModel(PRACTICE)
    let s = m.init()
    expect(() => m.apply(s, EPLB_OPS[0], { kind: 'place', gpu: 0 })).toThrow('turn 1 is a replicate turn')
    expect(() => m.apply(s, EPLB_OPS[0], { kind: 'replicate', expert: 16 })).toThrow('expert 16 is not 0–15')
    expect(() => m.apply(s, EPLB_OPS[0], { kind: 'replicate', expert: 1.5 })).toThrow('expert 1.5 is not 0–15')
    expect(() => m.apply(s, EPLB_OPS[1], { kind: 'replicate', expert: 1 })).toThrow('turn 2 is not the next turn (1)')
    for (let i = 0; i < 4; i++) s = m.apply(s, EPLB_OPS[i], { kind: 'replicate', expert: 14 }).state
    expect(() => m.apply(s, EPLB_OPS[4], null)).toThrow('turn 5 needs a decision')
    for (let i = 4; i < 9; i++) s = m.apply(s, EPLB_OPS[i], { kind: 'place', gpu: 2 }).state
    expect(eplbDecisionProblems(s, EPLB_OPS[9], { kind: 'place', gpu: 2 })).toEqual(['GPU 3 has no free slot'])
    expect(() => m.apply(s, EPLB_OPS[9], { kind: 'place', gpu: 2 })).toThrow('GPU 3 has no free slot')
    expect(() => m.apply(s, EPLB_OPS[9], { kind: 'place', gpu: 4 })).toThrow('GPU 4 is not 0–3')
    expect(eplbDecisionProblems(s, EPLB_OPS[9], { kind: 'place', gpu: 0 })).toEqual([])
    expect(() => eplbModel(PRACTICE.slice(1))).toThrow('16 experts')
    expect(() => eplbModel([...PRACTICE.slice(1), 13])).toThrow('summing to 1000')
  })

  test('a turn that copies nothing leaves 4 slots empty, and the place turns with nothing left apply by themselves', () => {
    const none = compileEplbPolicy({ replicate: 'none', place: 'least-loaded' })
    const setup = eplbSetup(PRACTICE, EPLB_PRACTICE_SEED)
    const ps = playAll(setup, none)
    expect(ps.mine.ended).toBe('trace-end')
    expect(ps.mine.steps.slice(20).map((s) => s.at)).toEqual([undefined, undefined, undefined, undefined])
    const v = eplbView(ps.mine.state)
    expect(v.copies.every((c) => c === 1)).toBe(true)
    expect(v.gpus.reduce((a, g) => a + g.experts.length, 0)).toBe(16)
    expect(v.gpus.reduce((a, g) => a + g.free, 0)).toBe(4)
    expect(v.phase).toBe('done')
  })

  test("after 5 turns the skip lets the ghost's rule finish the learner's own layer", () => {
    for (const { seed, loads } of BANDED.slice(0, 10)) {
      const setup = eplbSetup(loads, seed)
      const fill = learners(seed)[2]
      let ps = startPlay(setup)
      for (let t = 0; t < SKIP_AFTER_TURNS; t++) {
        expect(canSkipEplb(ps)).toBe(false)
        const ask = pendingAsk(setup, ps)!
        ps = playTurn(setup, ps, fill.decide(ask.view, ask.req))
      }
      expect(canSkipEplb(ps)).toBe(true)
      const at = ps.mine.state
      const skipped = skipToDebrief(setup, ps)
      expect(skipped.skipped).toBe(true)
      expect(skipped.mine.ended).toBe('trace-end')
      expect(skipped.turns).toBe(SKIP_AFTER_TURNS)
      expect(skipped.mine.state).toEqual(oracleFinish(setup, at, SKIP_AFTER_TURNS))
      expect(canSkipEplb(skipped)).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ */
/* The ghost                                                            */
/* ------------------------------------------------------------------ */

describe('the ghost: DeepSeek EPLB', () => {
  test('it copies the expert with the most load per copy, then puts each copy on the least-loaded GPU with a free slot', () => {
    let ties = 0
    for (const { seed, loads } of [{ seed: EPLB_PRACTICE_SEED, loads: PRACTICE }, ...BANDED]) {
      const ps = startPlay(eplbSetup(loads, seed))
      expect(ps.ghost.steps).toHaveLength(EPLB_TURNS)
      for (const [i, step] of ps.ghost.steps.entries()) {
        const s = ps.ghost.before[i]
        if (i < 4) expect(step.at).toBe(oracleCopy(s))
        else {
          expect(step.at).toBe(oracleGpu(s))
          const loadsNow = Array.from({ length: GPUS }, (_, g) => gpuUnits(s, g))
          if (new Set(loadsNow).size < GPUS) ties++
        }
      }
      expect(eplbView(ps.ghost.state).maxUnits).toBe(maxUnits(oracleFinish(eplbSetup(loads, seed), eplbModel(loads).init(), 0)))
    }
    // Ties do occur (the first place turn finds four empty GPUs), and they go to the lower GPU.
    expect(ties).toBeGreaterThan(50)
  })

  test('the ghost reaches the band on every banded load, and plays the same run every time', () => {
    for (const { seed, loads } of BANDED) {
      const a = startPlay(eplbSetup(loads, seed)).ghost
      const b = startPlay(eplbSetup(loads, seed)).ghost
      expect(a.state).toEqual(b.state)
      expect(eplbView(a.state).maxUnits * 100).toBeLessThanOrEqual(110 * MEAN_UNITS)
    }
  })
})

/* ------------------------------------------------------------------ */
/* The debrief                                                          */
/* ------------------------------------------------------------------ */

/** The decision sentence's consequence: "From your layer after that turn, even the reference's rule ends at 1.12×; on its own it reaches 1.06×." */
const CONSEQUENCE = / From your layer after that turn, even the reference's rule ends at (\d+\.\d+)×; on its own it reaches (\d+\.\d+)×\.$/
const OUTCOME = /^Your busiest GPU carries (\d+\.\d+)× the mean, so this layer's expert phase waits (\d+ %|under 1 %) longer than a balanced one\. The reference's busiest carries (\d+\.\d+)×\.$/

/** A printed multiplier stands for the value it rounds from. */
function expectPrinted(printed: string, units: number) {
  const decimals = printed.split('.')[1].length
  expect(Math.abs(Number(printed) - units / MEAN_UNITS)).toBeLessThanOrEqual(0.5 / 10 ** decimals + 1e-12)
}

describe('the debrief: the first recoverable divergence', () => {
  test('no debrief for a learner at or below the ghost', () => {
    for (const { seed, loads } of BANDED.slice(0, 10)) {
      const setup = eplbSetup(loads, seed)
      expect(eplbDivergence(setup, playAll(setup, ghostLearner))).toBeNull()
    }
    // No replicas sometimes beats the ghost's packing outright: still no debrief.
    const beat = BANDED.find(({ loads }) => runEplb(loads, compileEplbPolicy({ replicate: 'none', place: 'least-loaded' })).maxUnits < runEplb(loads, EPLB_GHOST).maxUnits)
    expect(beat).toBeDefined()
    const setup = eplbSetup(beat!.loads, beat!.seed)
    expect(eplbDivergence(setup, playAll(setup, compileEplbPolicy({ replicate: 'none', place: 'least-loaded' })))).toBeNull()
  })

  test('the debrief needs a finished play', () => {
    const setup = eplbSetup(PRACTICE, EPLB_PRACTICE_SEED)
    expect(() => eplbDivergence(setup, startPlay(setup))).toThrow('finished play')
  })

  test('each sentence is generated from the world: the turn named is where even the reference stops recovering', () => {
    let checked = 0
    for (const [i, { seed, loads }] of [{ seed: EPLB_PRACTICE_SEED, loads: PRACTICE }, ...BANDED].entries()) {
      for (const l of learners(i + 1)) {
        const setup = eplbSetup(loads, seed)
        const ps = playAll(setup, l)
        const mine = maxUnits(ps.mine.state)
        const ghost = maxUnits(ps.ghost.state)
        const d = eplbDivergence(setup, ps)
        if (mine <= ghost) {
          expect(d).toBeNull()
          continue
        }
        checked++
        expect(d).not.toBeNull()
        const dec = d!.decision
        // R(d) holds and R(d + 1) fails, against the pass margin for a learner who missed the pass.
        const bound = ghost + (mine <= ghost + PASS_MARGIN_UNITS ? 0 : PASS_MARGIN_UNITS)
        expect(bound).toBe(ghost + recoveryMargin(mine, ghost))
        const s = ps.mine.before[dec.op]
        const after = ps.mine.before[dec.op + 1] ?? ps.mine.state
        expect(maxUnits(oracleFinish(setup, s, dec.op))).toBeLessThanOrEqual(bound)
        expect(maxUnits(oracleFinish(setup, after, dec.op + 1))).toBeGreaterThan(bound)
        // and no later turn of the learner's is recoverable.
        for (let j = dec.op + 1; j < EPLB_TURNS; j++) expect(maxUnits(oracleFinish(setup, ps.mine.before[j], j))).toBeGreaterThan(bound)
        expect(dec.handoverBefore).toBe(maxUnits(oracleFinish(setup, s, dec.op)))
        expect(dec.handoverAfter).toBe(maxUnits(oracleFinish(setup, after, dec.op + 1)))
        // The sentence's head, rebuilt from the learner's layer with the oracle's own arithmetic.
        const turn = dec.op + 1
        let head: string
        if (dec.kind === 'replicate') {
          const ref = oracleCopy(s)
          expect(dec.reference).toEqual({ kind: 'replicate', expert: ref })
          const m = ps.mine.steps[dec.op].at as number
          expect(dec.mine).toEqual({ kind: 'replicate', expert: m })
          expect(m).not.toBe(ref)
          expect(turn).toBeLessThanOrEqual(4)
          const tie = unitsPerCopy(s, m) === unitsPerCopy(s, ref)
          head = tie
            ? `At turn ${turn} you copied expert #${m + 1} (${permille(unitsPerCopy(s, m))} per copy). The reference copies #${ref + 1}, which ties at ${permille(unitsPerCopy(s, ref))} per copy and comes first.`
            : `At turn ${turn} you copied expert #${m + 1} (${permille(unitsPerCopy(s, m))} per copy). The reference copies #${ref + 1}: ${permille(unitsPerCopy(s, ref))} per copy is the heaviest.`
        } else {
          // The "least loaded with a free slot" GPU is the one the ghost picks in that state.
          const ref = oracleGpu(s)
          const req = setup.model.ask(s, EPLB_OPS[dec.op])!
          expect(EPLB_GHOST.decide(eplbView(s), req)).toEqual({ kind: 'place', gpu: ref })
          expect(dec.reference).toEqual({ kind: 'place', gpu: ref })
          const m = ps.mine.steps[dec.op].at as number
          expect(dec.mine).toEqual({ kind: 'place', gpu: m })
          expect(m).not.toBe(ref)
          expect(turn).toBeGreaterThanOrEqual(5)
          const c = oracleNext(s)
          const copy = `At turn ${turn} you put #${c + 1}'s copy (${permille(unitsPerCopy(s, c))}) on GPU ${m + 1}`
          head =
            gpuUnits(s, m) === gpuUnits(s, ref)
              ? `${copy}, at ${permille(gpuUnits(s, m))}. The reference puts it on GPU ${ref + 1}, also at ${permille(gpuUnits(s, ref))}: of the least loaded with a free slot, it takes the lowest number.`
              : `${copy}, already at ${permille(gpuUnits(s, m))}. The reference puts it on GPU ${ref + 1}, the least loaded with a free slot (${permille(gpuUnits(s, ref))}).`
          if (gpuUnits(s, m) !== gpuUnits(s, ref)) expect(gpuUnits(s, m)).toBeGreaterThan(gpuUnits(s, ref))
        }
        expect(dec.sentence.startsWith(head)).toBe(true)
        const cons = dec.sentence.slice(head.length).match(CONSEQUENCE)
        expect(cons).not.toBeNull()
        expectPrinted(cons![1], dec.handoverAfter)
        expectPrinted(cons![2], ghost)
        expect(cons![1]).not.toBe(cons![2])
        // The outcome: the learner's imbalance as the layer's expert phase waiting, and the ghost's.
        const out = d!.outcome.match(OUTCOME)
        expect(out).not.toBeNull()
        expectPrinted(out![1], mine)
        expectPrinted(out![3], ghost)
        expect(out![1]).not.toBe(out![3])
        const pct = Math.round((mine * 100) / MEAN_UNITS) - 100
        expect(out![2]).toBe(pct >= 1 ? `${pct} %` : 'under 1 %')
        expect(d!.explanation).toBe(`${d!.outcome} ${dec.sentence}`)
        expect(d!.mineUnits).toBe(mine)
        expect(d!.ghostUnits).toBe(ghost)
      }
    }
    expect(checked).toBeGreaterThan(150)
  })

  test('a skipped play is debriefed on a hand turn: the ghost never departs from its own rule', () => {
    let debriefs = 0
    for (const [i, { seed, loads }] of BANDED.entries()) {
      for (const l of learners(i + 1)) {
        const setup = eplbSetup(loads, seed)
        let ps = startPlay(setup)
        for (let t = 0; t < 8; t++) {
          const ask = pendingAsk(setup, ps)!
          ps = playTurn(setup, ps, l.decide(ask.view, ask.req))
        }
        ps = skipToDebrief(setup, ps)
        const d = eplbDivergence(setup, ps)
        if (!d) continue
        debriefs++
        expect(d.decision.op).toBeLessThan(8)
      }
    }
    expect(debriefs).toBeGreaterThan(50)
  })

  test('a tie is worded as a tie: the reference takes the lower number', () => {
    const m = eplbModel(PRACTICE)
    let s = m.init()
    for (let i = 0; i < 4; i++) s = m.apply(s, EPLB_OPS[i], EPLB_GHOST.decide(m.view(s), { kind: 'replicate' })).state
    // Turn 5: four empty GPUs. Putting #3's first copy (235 ‰ over 2) on GPU 3 ties with GPU 1, which the reference takes.
    const v = m.view(s)
    const place = decisionSentence(4, v, { kind: 'place', gpu: 2 }, { kind: 'place', gpu: 0 }, { handoverAfter: 15_300, ghostUnits: 15_120 })
    expect(place).toBe(
      "At turn 5 you put #3's copy (117.5 ‰) on GPU 3, at 0 ‰. The reference puts it on GPU 1, also at 0 ‰: of the least loaded with a free slot, it takes the lowest number. " +
        "From your layer after that turn, even the reference's rule ends at 1.02×; on its own it reaches 1.01×.",
    )
    // Two experts at 15 ‰ per copy (#1 and #2): copying #2 ties with #1, which comes first.
    const v0 = m.view(m.init())
    const rep = decisionSentence(0, { ...v0, perCopy: v0.perCopy.map((u, e) => (e === 14 || e === 2 || e === 3 || e === 5 ? 0 : u)) }, { kind: 'replicate', expert: 1 }, { kind: 'replicate', expert: 0 }, { handoverAfter: 15_120, ghostUnits: 15_120 + 1 })
    expect(rep).toContain('At turn 1 you copied expert #2 (15 ‰ per copy). The reference copies #1, which ties at 15 ‰ per copy and comes first.')
    // Two values that read the same at two decimals print with more.
    expect(rep).toContain("ends at 1.0080×; on its own it reaches 1.0081×.")
    const none = decisionSentence(0, v0, { kind: 'replicate', expert: null }, { kind: 'replicate', expert: 14 }, { handoverAfter: 16_000, ghostUnits: 15_120 })
    expect(none).toContain('At turn 1 you made no copy. The reference copies #15: 264 ‰ per copy is the heaviest.')
  })

  test('the outcome sentence speaks of the layer’s expert phase, and of a sub-percent wait honestly', () => {
    expect(outcomeSentence(20_700, 15_150)).toBe(
      "Your busiest GPU carries 1.38× the mean, so this layer's expert phase waits 38 % longer than a balanced one. The reference's busiest carries 1.01×.",
    )
    expect(outcomeSentence(15_060, 15_000)).toBe(
      "Your busiest GPU carries 1.004× the mean, so this layer's expert phase waits under 1 % longer than a balanced one. The reference's busiest carries 1.000×.",
    )
  })
})

/* ------------------------------------------------------------------ */
/* The Opus check                                                       */
/* ------------------------------------------------------------------ */

describe('Opus check: the turn rule, the band and the sentences on 50 banded loads, six simulated learners', () => {
  test('every play above the ghost gets a decision of its own kind, and both kinds appear', () => {
    const rows: Record<string, { none: number; replicate: number; place: number; tie: number; passed: number }> = {}
    const samples: string[] = []
    let plays = 0
    let debriefs = 0
    for (const [i, { seed, loads }] of BANDED.entries()) {
      for (const l of learners(i + 1)) {
        plays++
        const setup = eplbSetup(loads, seed)
        const ps = playAll(setup, l)
        const d = eplbDivergence(setup, ps)
        const row = (rows[l.name] ??= { none: 0, replicate: 0, place: 0, tie: 0, passed: 0 })
        if (!d) {
          row.none++
          continue
        }
        debriefs++
        row[d.decision.kind]++
        if (/ties at|also at/.test(d.decision.sentence)) row.tie++
        if (eplbPasses(d.mineUnits, d.ghostUnits)) row.passed++
        if (i < 2) samples.push(`[${l.name}, seed ${seed}] ${d.explanation}`)
      }
    }
    if (REPORT) {
      console.table(rows)
      for (const s of samples) console.log(s)
    }
    expect(plays).toBe(300)
    expect(debriefs).toBe(229)
    expect(rows).toEqual({
      'round-robin': { none: 0, replicate: 0, place: 50, tie: 0, passed: 0 },
      total: { none: 22, replicate: 28, place: 0, tie: 0, passed: 28 },
      'fill-in-order': { none: 0, replicate: 0, place: 50, tie: 0, passed: 0 },
      'cold-copies': { none: 14, replicate: 36, place: 0, tie: 0, passed: 17 },
      'one-slip': { none: 35, replicate: 0, place: 15, tie: 0, passed: 14 },
      random: { none: 0, replicate: 25, place: 25, tie: 0, passed: 0 },
    })
  })
})

/* ------------------------------------------------------------------ */
/* Lines, summary and the ledger                                        */
/* ------------------------------------------------------------------ */

describe('lines, the summary and the ledger', () => {
  test('the aria-live line for a replicate turn and a place turn', () => {
    const m = eplbModel(PRACTICE)
    const s0 = m.init()
    const d0: EplbDecision = { kind: 'replicate', expert: 14 }
    const s1 = m.apply(s0, EPLB_OPS[0], d0).state
    expect(eplbTurnLine(m.view(s0), d0, m.view(s1))).toBe('Turn 1: copied expert #15, now 2 copies of 132 ‰.')
    let s = s1
    for (let i = 1; i < 4; i++) s = m.apply(s, EPLB_OPS[i], { kind: 'replicate', expert: 2 }).state
    const d4: EplbDecision = { kind: 'place', gpu: 1 }
    const s5 = m.apply(s, EPLB_OPS[4], d4).state
    expect(eplbTurnLine(m.view(s), d4, m.view(s5))).toBe("Turn 5: #4's copy (149 ‰) on GPU 2, now 149 ‰. Busiest GPU 0.60× the mean.")
    expect(eplbTurnLine(m.view(s0), { kind: 'replicate', expert: null }, m.view(s0))).toBe('Turn 1: no copy.')
  })

  test('the summary and the play result: score min(1, ghost ÷ mine), ok within 0.05 of the ghost', () => {
    const setup = eplbSetup(PRACTICE, EPLB_PRACTICE_SEED)
    const ps = playAll(setup, learners(1)[0])
    const sum = summarizeEplb(setup, ps)
    expect(sum).toMatchObject({ playId: EPLB_PLAY_ID, seed: EPLB_PRACTICE_SEED, turns: 24, skipped: false, placed: 20, ghostPlaced: 20, ghostUnits: 252 * 60 })
    expect(sum.divergence).not.toBeNull()
    const r = eplbPlayResult(sum, { provenance: 'practice', kcs: ['t6.expert-load-balance'] })
    expect(r.playId).toBe('eplb')
    expect(r.score).toBeCloseTo(sum.ghostUnits / sum.mineUnits, 12)
    expect(r.ok).toBe(false)
    expect(r.data.metric).toEqual({ name: 'imbalance', mine: sum.mineUnits / MEAN_UNITS, ghost: 252 / 250, lowerIsBetter: true })
    expect(r.data.divergenceOp).toBe(sum.divergence!.decision.op)
    expect(r.data.kcs).toEqual(['t6.expert-load-balance'])
    const mine = playAll(setup, ghostLearner)
    const ok = eplbPlayResult(summarizeEplb(setup, mine), { provenance: 'unseen', ms: 1200 })
    expect([ok.score, ok.ok, ok.ms, ok.data.divergenceOp]).toEqual([1, true, 1200, undefined])
    // Both results pass the ledger's codec as play:eplb events.
    for (const res of [r, ok]) {
      const e = evt('play', `play:${res.playId}`, '2026-10-14T09:00:00.000Z', { score: res.score, ok: res.ok, provenance: res.provenance, data: res.data })
      expect(validateEvent(e)).toMatchObject({ ok: true })
    }
    // The margin is exact: 0.05 of the mean is 750 units.
    expect(PASS_MARGIN_UNITS).toBe(750)
    expect(eplbPasses(15_000 + 750, 15_000)).toBe(true)
    expect(eplbPasses(15_000 + 751, 15_000)).toBe(false)
  })

  test('deterministic: the same seed gives the same summary, sentences included', () => {
    for (const { seed } of BANDED.slice(0, 5)) {
      const run = () => {
        const setup = eplbSetup(drawLoads(seed), seed)
        return JSON.stringify(summarizeEplb(setup, playAll(setup, learners(seed)[5])))
      }
      expect(run()).toBe(run())
    }
  })
})
