/**
 * What "done" certifies (docs/specs/wave-3.md §5.3; tasks 3b-03, 3b-20, fix BF8): the learner read the scene.
 *
 * Before BF8 the prediction came before the seed was drawn, so there was nothing of the seed's to read, and the answers
 * were concentrated (1.25 right on 94 of 163 banded knee seeds, 3 on 96 of 192 P:D ones), so "3 right on distinct
 * seeds" was met by naming one value every round. Now each seed's scene (its load, its lengths) is shown before the
 * prediction, the generators spread their right answers so that none is right on more than a third of banded seeds,
 * and done needs 3 right in a row whose answers are not all the same. This file measures all three: the spread, that
 * the scene's reading finds the answer, and how often each strategy that ignores the scene reaches done (exactly, by
 * dynamic programming over `runOf`, the panel's own rule) against a scene reader (Monte Carlo over the banded seeds).
 */
import { describe, expect, test } from 'bun:test'
import { ANSWERS_NEEDED, PASSES_NEEDED, progressText, runOf, type Played } from '../../src/components/fleet-ex/session'
import { SIM_TICK_SECONDS } from '../../src/lib/fleet-model'
import { splitmix32u } from '../../src/lib/rng'
import { getFleetTrafficProfile } from '../../src/lib/traces'
import { FLEET_EXERCISES, type FleetExerciseDef, type SceneFact } from '../../src/lib/world/fleet-ex'
import { KNEE_CAPACITY_MARGIN, KNEE_TARGETS, kneeTarget, kneeTrace } from '../../src/lib/world/fleet-ex/knee'
import { PD_POINTS, PD_WORKERS, pdEstimateSplit, pdWorkload, pdWorkloadsBySplit } from '../../src/lib/world/fleet-ex/pd-split'

const knee = FLEET_EXERCISES.knee as FleetExerciseDef
const pd = FLEET_EXERCISES['pd-split'] as FleetExerciseDef
const SLOTS = getFleetTrafficProfile('burstgpt').config.maxRunning

/* ------------------------------ the scene's reading ------------------------------ */

/** The knee from the scene: Little's-law capacity is slots ÷ (ticks held × 50 ms); the knee is the highest multiplier whose offered rate stays at or below it. */
function readKnee(scene: SceneFact[]): number {
  const [offered, held] = scene as [SceneFact, SceneFact]
  const capacity = SLOTS / (held.value * SIM_TICK_SECONDS)
  const below = knee.points.filter((m) => m * offered.value <= capacity)
  return below.length > 0 ? (below[below.length - 1] as number) : (knee.points[0] as number)
}

/** The split from the scene: a prompt holds a prefill slot ⌈mean ÷ 128⌉ ticks, an output a decode slot one tick per token; give each stage its share of the 8 workers. */
function readSplit(scene: SceneFact[]): number {
  const [prompts, outputs] = scene as [SceneFact, SceneFact]
  const p = Math.ceil(((prompts.value + (prompts.to as number)) / 2) / 128)
  const d = ((outputs.value + (outputs.to as number)) / 2)
  return Math.min(PD_POINTS[PD_POINTS.length - 1] as number, Math.max(PD_POINTS[0] as number, Math.round((PD_WORKERS * p) / (p + d))))
}

interface Banded {
  seed: number
  truth: number
  read: number
}

/** The banded seeds in 0 … n − 1: each one's right answer and the scene's reading. */
function survey(def: FleetExerciseDef, n: number, read: (s: SceneFact[]) => number): Banded[] {
  const out: Banded[] = []
  for (let seed = 0; seed < n; seed++) {
    const r = def.sweep(seed)
    if (def.band(r)) out.push({ seed, truth: def.truth(r), read: read(def.scene(seed)) })
  }
  return out
}

const KNEE_SEEDS = 200
const PD_SEEDS = 80
let kneeRows: Banded[] | undefined
let pdRows: Banded[] | undefined
const kneeBanded = () => (kneeRows ??= survey(knee, KNEE_SEEDS, readKnee))
const pdBanded = () => (pdRows ??= survey(pd, PD_SEEDS, readSplit))

/** Each right answer's share of the banded seeds. */
function shares(rows: readonly Banded[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const r of rows) m.set(r.truth, (m.get(r.truth) ?? 0) + 1)
  return new Map([...m].sort((a, b) => a[0] - b[0]).map(([x, k]) => [x, k / rows.length]))
}

const pct = (x: number) => `${(100 * x).toFixed(1)} %`
const fmtShares = (m: Map<number, number>) => [...m].map(([x, s]) => `${x}: ${pct(s)}`).join(', ')

/* ------------------------------ strategies against the rule ------------------------------ */

/** The truths of the run's last right rounds, at most `PASSES_NEEDED − 1` of them: all the rule needs to remember. */
type Trail = readonly number[]

/** One more round on a fresh seed, judged by the panel's own rule (`runOf`). */
function next(trail: Trail, guess: number, right: boolean): { trail: Trail; done: boolean } {
  const played: Played[] = trail.map((t, i) => ({ seed: i, ok: true, value: t, truth: t }))
  played.push({ seed: trail.length, ok: right, value: guess, truth: right ? guess : NaN })
  return { trail: right ? [...trail, guess].slice(-(PASSES_NEEDED - 1)) : [], done: runOf(played, PASSES_NEEDED).done }
}

/**
 * P(done within `rounds`) for a guess that ignores the scene: `policy(round)` names the guess, or, without one, the
 * best guess given everything seen so far (the trail is all that matters to the rule; the seeds are independent).
 */
function ignoring(p: Map<number, number>, rounds: number, policy?: (round: number) => number): number {
  const memo = new Map<string, number>()
  const f = (t: number, trail: Trail): number => {
    if (t === rounds) return 0
    const key = `${t}|${trail.join(',')}`
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    let best = 0
    for (const g of policy ? [policy(t)] : [...p.keys()]) {
      const pg = p.get(g) ?? 0
      const right = next(trail, g, true)
      const wrong = next(trail, g, false)
      const v = pg * (right.done ? 1 : f(t + 1, right.trail)) + (1 - pg) * (wrong.done ? 1 : f(t + 1, wrong.trail))
      best = Math.max(best, v)
    }
    memo.set(key, best)
    return best
  }
  return f(0, [])
}

/** P(done within `rounds`) for a learner who answers with the scene's reading, by Monte Carlo over the banded seeds. */
function reading(rows: readonly Banded[], rounds: number, trials = 20000): number {
  const rnd = splitmix32u(0x5ce7e)
  let hits = 0
  for (let i = 0; i < trials; i++) {
    let trail: Trail = []
    for (let t = 0; t < rounds; t++) {
      const r = rows[rnd() % rows.length] as Banded
      const step = next(trail, r.read, r.read === r.truth)
      if (step.done) {
        hits++
        break
      }
      trail = step.trail
    }
  }
  return hits / trials
}

/* ------------------------------ the rule ------------------------------ */

const round = (seed: number, truth: number, ok = true): Played => ({ seed, ok, value: ok ? truth : -1, truth })

describe('the done rule: three right in a row, not all one answer', () => {
  test('naming one value never finishes it, however long the run', () => {
    const played = Array.from({ length: 12 }, (_, i) => round(i, 1.25))
    expect(runOf(played, PASSES_NEEDED)).toEqual({ run: 12, runAnswers: 1, done: false })
  })

  test('three right in a row on two answers finish it, and it stays done', () => {
    expect(runOf([round(1, 1), round(2, 1.25), round(3, 1)], 3).done).toBe(true)
    expect(runOf([round(1, 1), round(2, 1), round(3, 1.5)], 3).done).toBe(true)
    expect(runOf([round(1, 1), round(2, 1.25), round(3, 1), round(4, 2, false), round(5, 1, false)], 3)).toEqual({ run: 0, runAnswers: 0, done: true })
  })

  test('a miss starts the run again, and a round on a seed already played neither extends nor breaks it', () => {
    expect(runOf([round(1, 1), round(2, 1.25), round(3, 1, false), round(4, 1.5)], 3)).toEqual({ run: 1, runAnswers: 1, done: false })
    expect(runOf([round(1, 1), round(1, 1.25), round(2, 1)], 3)).toEqual({ run: 2, runAnswers: 1, done: false })
    expect(runOf([round(1, 1), round(2, 1.25), round(2, 1.5, false), round(3, 1.5)], 3).done).toBe(true)
  })

  test('the progress line says the rule: right in a row, and how many different answers', () => {
    expect(ANSWERS_NEEDED).toBe(2)
    expect(progressText({ run: 0, runAnswers: 0, done: false }, 3)).toBe('0/3 right in a row · 0/2 different answers')
    expect(progressText({ run: 2, runAnswers: 1, done: false }, 3)).toBe('2/3 right in a row · 1/2 different answers')
    expect(progressText({ run: 5, runAnswers: 1, done: false }, 3)).toBe('3/3 right in a row · 1/2 different answers')
    expect(progressText({ run: 3, runAnswers: 2, done: true }, 3)).toBe('3/3 · done')
  })
})

/* ------------------------------ the generators ------------------------------ */

describe('the right answers are spread: none is right on more than a third of banded seeds', () => {
  test('the knee (seeds 0 … 199, printed)', () => {
    const s = shares(kneeBanded())
    console.log(`knee right answers over ${kneeBanded().length} banded seeds in 0–${KNEE_SEEDS - 1}: ${fmtShares(s)}`)
    expect([...s.keys()]).toEqual([...KNEE_TARGETS])
    expect(Math.max(...s.values())).toBeLessThanOrEqual(1 / 3)
  }, 120_000)

  test('the P:D split (seeds 0 … 79, printed)', () => {
    const s = shares(pdBanded())
    console.log(`P:D right answers over ${pdBanded().length} banded seeds in 0–${PD_SEEDS - 1}: ${fmtShares(s)}`)
    expect([...s.keys()]).toEqual([2, 3, 4, 5])
    expect(Math.max(...s.values())).toBeLessThanOrEqual(1 / 3)
  }, 120_000)

  test('the knee draws each target equally often and sets capacity 1.1 times the offered rate there', () => {
    const counts = new Map<number, number>()
    for (let seed = 0; seed < 4000; seed++) counts.set(kneeTarget(seed), (counts.get(kneeTarget(seed)) ?? 0) + 1)
    for (const t of KNEE_TARGETS) expect(Math.abs((counts.get(t) ?? 0) / 4000 - 0.25)).toBeLessThan(0.03)
    // set on the base window, so the 1× trace's own ratio is near, not at, 1.1 × the target (0.80 … 1.21 over seeds 0 … 999)
    const ratios: number[] = []
    for (let seed = 0; seed < 200; seed++) {
      const [offered, held] = knee.scene(seed) as [SceneFact, SceneFact]
      ratios.push(SLOTS / (held.value * SIM_TICK_SECONDS) / offered.value / (KNEE_CAPACITY_MARGIN * kneeTarget(seed)))
    }
    ratios.sort((a, b) => a - b)
    expect(ratios[0]).toBeGreaterThan(0.75)
    expect(ratios[ratios.length - 1]).toBeLessThan(1.25)
    expect(Math.abs((ratios[100] as number) - 1)).toBeLessThan(0.05)
  })

  test('the P:D split draws the split the estimate names, then a grid workload that names it', () => {
    const groups = pdWorkloadsBySplit()
    expect(groups.map((g) => pdEstimateSplit(g[0]!))).toEqual([2, 3, 4, 5])
    expect(groups.map((g) => g.length)).toEqual([5, 19, 9, 2])
    for (const g of groups) for (const w of g) expect(pdEstimateSplit(w)).toBe(pdEstimateSplit(g[0]!))
    const counts = new Map<number, number>()
    for (let seed = 0; seed < 4000; seed++) {
      const e = pdEstimateSplit(pdWorkload(seed))
      counts.set(e, (counts.get(e) ?? 0) + 1)
    }
    for (const e of [2, 3, 4, 5]) expect(Math.abs((counts.get(e) ?? 0) / 4000 - 0.25)).toBeLessThan(0.03)
  })
})

/* ------------------------------ the scene ------------------------------ */

describe('the scene: what the seed gives the engine, shown before the prediction', () => {
  test('is a pure function of the seed, made of inputs: the 1× trace (knee) and the workload (P:D)', () => {
    for (const seed of [0, 7, 123456789]) {
      expect(knee.scene(seed)).toEqual(knee.scene(seed))
      const t = kneeTrace(seed, 1)
      const [offered, held] = knee.scene(seed) as [SceneFact, SceneFact]
      expect(offered.value).toBe(t.length / 40)
      expect(held.value).toBeCloseTo(t.reduce((a, r) => a + Math.ceil(r.prompt / 128) + r.output, 0) / t.length, 12)
      const w = pdWorkload(seed)
      expect(pd.scene(seed)).toEqual([
        { label: 'Prompts', value: w.prompt.min, to: w.prompt.max, unit: 'tokens' },
        { label: 'Outputs', value: w.output.min, to: w.output.max, unit: 'tokens' },
      ])
    }
  })

  test('reading it finds the answer on most banded seeds (printed)', () => {
    const k = kneeBanded()
    const p = pdBanded()
    const kRight = k.filter((r) => r.read === r.truth).length
    const pRight = p.filter((r) => r.read === r.truth).length
    console.log(`the scene's reading is right on ${kRight} of ${k.length} banded knee seeds and ${pRight} of ${p.length} banded P:D seeds`)
    expect(kRight / k.length).toBeGreaterThan(0.75)
    expect(pRight / p.length).toBeGreaterThan(0.8)
  }, 120_000)
})

/* ------------------------------ strategies ------------------------------ */

describe('a guess that ignores the scene rarely reaches done; reading it does (printed)', () => {
  for (const [name, rows] of [['knee', kneeBanded], ['P:D split', pdBanded]] as const) {
    test(`${name}: a constant never, the best guesser seldom, a reader almost always`, () => {
      const s = shares(rows())
      const order = [...s.keys()].sort((a, b) => (s.get(b) as number) - (s.get(a) as number))
      const lines: string[] = []
      const both = (label: string, f: (n: number) => number) => {
        const [ten, thirty] = [f(10), f(30)]
        lines.push(`  ${label}: ${pct(ten)} within 10 rounds, ${pct(thirty)} within 30`)
        return [ten, thirty] as const
      }
      const constant = both(`naming ${order[0]} every round`, (n) => ignoring(s, n, () => order[0] as number))
      for (let k = 2; k <= order.length; k++) both(`cycling ${order.slice(0, k).join(', ')}`, (n) => ignoring(s, n, (t) => order[t % k] as number))
      const guesser = both('the best guess that ignores the scene', (n) => ignoring(s, n))
      const reader = both('reading the scene', (n) => reading(rows(), n))
      console.log(`${name}, done = ${PASSES_NEEDED} right in a row on ${ANSWERS_NEEDED}+ answers (right-answer shares ${fmtShares(s)}):\n${lines.join('\n')}`)
      expect(constant).toEqual([0, 0])
      expect(guesser[0]).toBeLessThan(0.2)
      expect(guesser[1]).toBeLessThan(0.5)
      expect(reader[0]).toBeGreaterThan(0.9)
    }, 120_000)
  }
})
