import { describe, expect, test } from 'bun:test'
import {
  EPLB_GHOST,
  EPLB_OPS,
  EPLB_PRACTICE_SEED,
  GPUS,
  MEAN_UNITS,
  drawLoads,
  eplbModel,
  eplbPasses,
  eplbSetup,
  makeLoads,
  practiceLoads,
  roundRobinUnits,
  runEplb,
  type EplbDecision,
} from '../../src/lib/world/eplb'
import {
  EPLB_DIALS,
  EPLB_SHORTCUTS,
  REFERENCE_EPLB_SPEC,
  compileEplbPolicy,
  eplbComposeResult,
  eplbEquivalent,
  eplbSpecData,
  eplbSpecProblems,
  firstDifference,
  firstPracticeSeed,
  runEplbSpec,
  shortcutsMiss,
  type EplbPolicySpec,
} from '../../src/lib/world/eplb-policy'
import { playAll } from '../../src/lib/world/play'

/**
 * Compose for the EPLB play (docs/specs/wave-3.md §5.2, task 3a-14): the dials, and the equivalence proof that
 * {per-copy, least-loaded} is the ghost at every turn on the practice load and on 1,000 banded loads.
 */

const PRACTICE = practiceLoads()
/** 1,000 banded loads, drawn the way the play draws fresh ones. */
const BANDED = Array.from({ length: 1000 }, (_, i) => drawLoads((i * 2654435761) >>> 0))
const ALL_SPECS: EplbPolicySpec[] = EPLB_DIALS.replicate.flatMap((replicate) => EPLB_DIALS.place.map((place) => ({ replicate, place })))

describe('the equivalence proof', () => {
  test('{per-copy, least-loaded} decides as the ghost at every turn of the practice load and of 1,000 banded loads', () => {
    expect(REFERENCE_EPLB_SPEC).toEqual({ replicate: 'per-copy', place: 'least-loaded' })
    const policy = compileEplbPolicy(REFERENCE_EPLB_SPEC)
    let turns = 0
    for (const loads of [PRACTICE, ...BANDED]) {
      // Turn by turn on the ghost's own run, and then as a whole run of its own.
      expect(firstDifference(REFERENCE_EPLB_SPEC, loads)).toBe(-1)
      const setup = eplbSetup(loads, 0)
      const ps = playAll(setup, policy)
      expect(ps.mine.steps.map((s) => s.at)).toEqual(ps.ghost.steps.map((s) => s.at))
      expect(ps.mine.state).toEqual(ps.ghost.state)
      turns += ps.mine.steps.length
    }
    expect(turns).toBe(1001 * 24)
    expect(eplbEquivalent(REFERENCE_EPLB_SPEC, [PRACTICE, ...BANDED])).toBe(true)
  })

  test('every other spec departs from the ghost on the practice load, at a turn of the dial it changes', () => {
    for (const spec of ALL_SPECS) {
      const at = firstDifference(spec, PRACTICE)
      if (spec.replicate === 'per-copy' && spec.place === 'least-loaded') continue
      expect(at).toBeGreaterThanOrEqual(0)
      // A replicate dial off the reference shows at a replicate turn (1–4), a place dial only at a place turn.
      if (spec.replicate !== 'per-copy') expect(at).toBeLessThan(4)
      else expect(at).toBeGreaterThanOrEqual(4)
      expect(eplbEquivalent(spec, [PRACTICE])).toBe(false)
    }
  })

  test('{none, round-robin} is band rule 2: round robin without replicas', () => {
    for (const loads of [PRACTICE, ...BANDED.slice(0, 300), ...Array.from({ length: 300 }, (_, c) => makeLoads(c))]) {
      expect(runEplbSpec({ replicate: 'none', place: 'round-robin' }, loads).maxUnits).toBe(roundRobinUnits(loads))
    }
  })
})

describe('the dials', () => {
  test('total keeps copying the hottest expert; per-copy moves on once a copy halves it', () => {
    const total = runEplb(PRACTICE, compileEplbPolicy({ replicate: 'total', place: 'least-loaded' }))
    expect(total.copies[14]).toBe(5)
    expect(total.copies.reduce((a, b) => a + b, 0)).toBe(20)
    const perCopy = runEplb(PRACTICE, compileEplbPolicy(REFERENCE_EPLB_SPEC))
    expect(perCopy.copies.filter((c) => c > 1)).toEqual([2, 2, 3])
    const none = runEplb(PRACTICE, compileEplbPolicy({ replicate: 'none', place: 'least-loaded' }))
    expect(none.copies.every((c) => c === 1)).toBe(true)
  })

  test('round robin sends the k-th copy to GPU k mod 4', () => {
    const policy = compileEplbPolicy({ replicate: 'per-copy', place: 'round-robin' })
    const model = eplbModel(PRACTICE)
    let s = model.init()
    const gpus: number[] = []
    for (const op of EPLB_OPS) {
      const req = model.ask(s, op)!
      const d = policy.decide(model.view(s), req)
      if (d.kind === 'place') gpus.push(d.gpu)
      s = model.apply(s, op, d).state
    }
    expect(gpus).toEqual(Array.from({ length: 20 }, (_, k) => k % GPUS))
  })

  test('least-loaded takes the lower GPU on a tie, as the ghost does', () => {
    const policy = compileEplbPolicy({ replicate: 'none', place: 'least-loaded' })
    const model = eplbModel(PRACTICE)
    let s = model.init()
    for (let i = 0; i < 4; i++) s = model.apply(s, EPLB_OPS[i], policy.decide(model.view(s), { kind: 'replicate' })).state
    const req = model.ask(s, EPLB_OPS[4])!
    expect(policy.decide(model.view(s), req)).toEqual({ kind: 'place', gpu: 0 })
    expect(EPLB_GHOST.decide(model.view(s), req)).toEqual({ kind: 'place', gpu: 0 })
  })

  test('the shortcuts each miss the ghost by more than the pass margin on the practice load', () => {
    const ghost = runEplb(PRACTICE, EPLB_GHOST).maxUnits
    for (const spec of EPLB_SHORTCUTS) expect(eplbPasses(runEplbSpec(spec, PRACTICE).maxUnits, ghost)).toBe(false)
    expect(shortcutsMiss(PRACTICE)).toBe(true)
    expect(runEplbSpec(REFERENCE_EPLB_SPEC, PRACTICE).maxUnits).toBe(ghost)
  })

  test('the practice seed is the first candidate in band on which every shortcut misses', () => {
    expect(firstPracticeSeed()).toBe(EPLB_PRACTICE_SEED)
    expect(practiceLoads()).toEqual(makeLoads(EPLB_PRACTICE_SEED))
  })

  test('a spec outside the dials is refused, with the reasons', () => {
    const bad = { replicate: 'all', place: 'random' } as unknown as EplbPolicySpec
    expect(eplbSpecProblems(bad)).toEqual(['replicate all is not none, per-copy or total', 'place random is not round-robin or least-loaded'])
    expect(() => compileEplbPolicy(bad)).toThrow('replicate all is not none, per-copy or total')
    for (const spec of ALL_SPECS) expect(eplbSpecProblems(spec)).toEqual([])
  })

  test('a spec run is deterministic and reports every GPU', () => {
    for (const spec of ALL_SPECS) {
      const a = runEplbSpec(spec, PRACTICE)
      expect(runEplbSpec(spec, PRACTICE)).toEqual(a)
      expect(a.gpuUnits).toHaveLength(GPUS)
      expect(Math.max(...a.gpuUnits)).toBe(a.maxUnits)
      expect(a.imbalance).toBe(a.maxUnits / MEAN_UNITS)
      expect(a.gpuUnits.reduce((x, y) => x + y, 0)).toBe(1000 * 60)
    }
  })
})

describe('the Compose ledger result', () => {
  const run = (spec: EplbPolicySpec, loads: number[]) => ({ mineUnits: runEplbSpec(spec, loads).maxUnits, ghostUnits: runEplb(loads, EPLB_GHOST).maxUnits })

  test('ok when equivalent, or within 0.05 on every load it ran on', () => {
    const fresh = BANDED.slice(0, 5)
    const ref = eplbComposeResult(REFERENCE_EPLB_SPEC, { equivalent: true, runs: [PRACTICE, ...fresh].map((l) => run(REFERENCE_EPLB_SPEC, l)), tries: 1 }, { seed: EPLB_PRACTICE_SEED, provenance: 'practice' })
    expect(ref.ok).toBe(true)
    expect(ref.score).toBe(1)
    expect(ref.data).toMatchObject({ phase: 'compose', spec: { replicate: 'per-copy', place: 'least-loaded' }, equivalent: true, survived: 6, ghostSurvived: 6 })
    const rr: EplbPolicySpec = { replicate: 'per-copy', place: 'round-robin' }
    const miss = eplbComposeResult(rr, { equivalent: false, runs: [PRACTICE, ...fresh].map((l) => run(rr, l)), tries: 3 }, { seed: 7, provenance: 'unseen', kcs: ['t6.expert-load-balance'], ms: 900 })
    expect(miss.ok).toBe(false)
    expect(miss.data.metric?.name).toBe('imbalance')
    expect(miss.data.metric?.mine).toBe(runEplbSpec(rr, PRACTICE).imbalance)
    expect(miss.score).toBeLessThan(1)
    expect([miss.seed, miss.ms, miss.data.turns, miss.data.kcs]).toEqual([7, 900, 3, ['t6.expert-load-balance']])
    // Within the margin on every load passes without being equivalent.
    const near = eplbComposeResult(rr, { equivalent: false, runs: [{ mineUnits: 15_750, ghostUnits: 15_000 }], tries: 1 }, { seed: 1, provenance: 'practice' })
    expect(near.ok).toBe(true)
    expect(() => eplbComposeResult(rr, { equivalent: false, runs: [], tries: 1 }, { seed: 1, provenance: 'practice' })).toThrow('at least one run')
  })

  test('the spec is stored flat, as the ledger checks it', () => {
    for (const spec of ALL_SPECS) expect(eplbSpecData(spec)).toEqual(spec)
    const d: EplbDecision = { kind: 'replicate', expert: null }
    expect(compileEplbPolicy({ replicate: 'none', place: 'round-robin' }).decide(eplbModel(PRACTICE).view(eplbModel(PRACTICE).init()), { kind: 'replicate' })).toEqual(d)
  })
})
