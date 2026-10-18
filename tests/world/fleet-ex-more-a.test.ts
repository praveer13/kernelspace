/**
 * More W5 exercises, part A (docs/specs/wave-3.md §16.3, task 3s-04): the broken benchmark (`broken-bench`, t7.l2) and
 * speculation push-your-luck (`push-luck`, t6.l6). Both are one fleet-ex module each, registered in `FLEET_EXERCISES`
 * and placed as fleet blocks; the exercise job dispatches by id, so no worker, host or session file names them.
 *
 * What is measured here, and printed so the review can read it:
 *   - the model: push-luck's speedup against the sum 1 + α + … + α^γ it stands for, and the engine facts the
 *     broken benchmark's header and copy state (a request that waits for no one has a TTFT of ⌈prompt ÷ 128⌉ − 1
 *     ticks; closed-loop clients finish at the engine's Little's-law capacity);
 *   - fairness: every flaw appears, the benchmark's own number never passes, the right answers are spread;
 *   - BF8 (a generated exercise must not let a strategy that ignores the scene pass): the best constant, the best
 *     constant for each flaw (a partial reading, said so), and the scene's reading, each judged by the panel's own
 *     done rule (`runOf`);
 *   - the panel's pure session on the two new exercises (free number in a range, own verdict and table, a full round).
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { kcById } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { FleetExerciseBlock } from '../../src/data/lessons/types'
import {
  PASSES_NEEDED,
  accepts,
  canSave,
  copyFor,
  entryText,
  explainReady,
  freshRound,
  itemEvent,
  parsePrediction,
  predictEvent,
  readExercise,
  reduceRound,
  runOf,
  sweepTable,
  verdictText,
  type Played,
} from '../../src/components/fleet-ex/session'
import { Engine, HEADROOM_TOKENS, SIM_TICK_SECONDS, makeRefManager, makeRefScheduler } from '../../src/lib/fleet-model'
import { FLEET_JOB_BUDGET_MS } from '../../src/workers/fleet-protocol'
import { splitmix32u } from '../../src/lib/rng'
import { FLEET_EXERCISES, type FleetExerciseDef, type SceneFact, type SweepResult } from '../../src/lib/world/fleet-ex'
import {
  BB_CANONICAL_SEED,
  BB_CAPPED_LOAD,
  BB_COLD_PER_PREFILL,
  BB_ENGINE,
  BB_FLAWS,
  BB_LOAD_LIGHT,
  BB_LOAD_MAX,
  BB_LOAD_MIN,
  BB_MIN_QUEUE_TICKS,
  BB_PREFILL_MAX_TICKS,
  BB_PREFILL_MIN_TICKS,
  BB_PROMPT_WIDTH,
  BB_QUEUE_GRID,
  BB_TOLERANCE,
  BB_TRIES,
  BB_WINDOWS,
  bbBand,
  bbCapacity,
  bbCase,
  bbCaseDraws,
  bbHold,
  bbKeeps,
  bbLightest,
  bbLoadFor,
  bbPass,
  bbPoint,
  bbPrefillTicks,
  bbPromptFor,
  bbQueue,
  bbRead,
  bbReported,
  bbScene,
  bbSweep,
  bbTruth,
  bbWindowsFor,
} from '../../src/lib/world/fleet-ex/broken-bench'
import {
  PL_ALPHA_MAX,
  PL_ALPHA_MIN,
  PL_CANONICAL_SEED,
  PL_POINTS,
  plBand,
  plEmitted,
  plPair,
  plPairsByBest,
  plPass,
  plPower,
  plScene,
  plSpeedup,
  plSpeedups,
  plSweep,
  plTruth,
} from '../../src/lib/world/fleet-ex/push-luck'

const bb = FLEET_EXERCISES['broken-bench'] as FleetExerciseDef
const pl = FLEET_EXERCISES['push-luck'] as FleetExerciseDef
const knee = FLEET_EXERCISES['knee'] as FleetExerciseDef

const pct = (x: number) => `${(100 * x).toFixed(1)} %`

/* ------------------------------ surveys, shared ------------------------------ */

// 480, not 240: each flaw's best constant is fit to its own seeds, and on about 60 a flaw that fit overstates its share
const BB_SEEDS = 480
const PL_SEEDS = 400

interface BbRow {
  seed: number
  flaw: string
  truth: number
  reported: number
  read: number
  banded: boolean
  /** The seed's sweep, kept so no test sweeps it again. */
  sweep: SweepResult
}

let bbRows: BbRow[] | undefined
/** The slowest of those sweeps, in ms. */
let bbWorstMs = 0
/** The broken benchmark's 0 … 479, swept once. */
function bbSurvey(): BbRow[] {
  if (bbRows) return bbRows
  const rows: BbRow[] = []
  for (let seed = 0; seed < BB_SEEDS; seed++) {
    const t0 = performance.now()
    const r = bbSweep(seed)
    bbWorstMs = Math.max(bbWorstMs, performance.now() - t0)
    rows.push({ seed, flaw: bbCase(seed).flaw, truth: bbTruth(r), reported: bbReported(r), read: bbRead(bbScene(seed)), banded: bbBand(r), sweep: r })
  }
  return (bbRows = rows)
}
const bbBanded = () => bbSurvey().filter((r) => r.banded)
// swept at collection, so no test carries the twelve seconds the 480 sweeps take
bbSurvey()

/** The panel's rule on a list of rounds: P(done within `rounds`) for a player whose guess is `guess(row)`, Monte Carlo over the rows. */
function doneWithin(rows: readonly BbRow[], guess: (r: BbRow) => number, rounds: number, trials = 4000): number {
  const rnd = splitmix32u(0xd0e5)
  let done = 0
  for (let i = 0; i < trials; i++) {
    const played: Played[] = []
    for (let t = 0; t < rounds; t++) {
      const r = rows[rnd() % rows.length] as BbRow
      const g = guess(r)
      played.push({ seed: t, ok: Math.abs(g - r.truth) <= BB_TOLERANCE * r.truth, value: g, truth: r.truth })
    }
    if (runOf(played, PASSES_NEEDED).done) done++
  }
  return done / trials
}

/** The constant that passes on the most rows, and the share it passes on. */
function bestConstant(rows: readonly BbRow[]): { value: number; share: number } {
  let best = { value: 0, share: 0 }
  for (let c = 100; c < 100000; c *= 1.01) {
    const share = rows.filter((r) => Math.abs(c - r.truth) <= BB_TOLERANCE * r.truth).length / rows.length
    if (share > best.share) best = { value: c, share }
  }
  return best
}

/* ------------------------------ registration and placement ------------------------------ */

describe('registered and placed', () => {
  test('each exercise is one fleet-ex module, registered by id after the knee and the P:D split', () => {
    expect(Object.keys(FLEET_EXERCISES).slice(0, 4)).toEqual(['knee', 'pd-split', 'broken-bench', 'push-luck'])
    expect(bb.id).toBe('broken-bench')
    expect(pl.id).toBe('push-luck')
    expect([bb.lessonId, pl.lessonId]).toEqual(['t7.l2', 't6.l6'])
  })

  test('each names its lesson’s real KCs, holds its lesson’s one fleet block for it, and names no claim', () => {
    for (const def of [bb, pl]) {
      const lesson = ALL_LESSONS.find((l) => l.id === def.lessonId)
      expect(lesson).toBeDefined()
      for (const kc of def.kcs) {
        expect(kcById(kc)).toBeDefined()
        expect(lesson?.kcs).toContain(kc)
      }
      const blocks = (lesson?.blocks ?? []).filter((b): b is FleetExerciseBlock => b.type === 'exercise' && 'fleet' in b && b.fleet === def.id)
      expect(blocks).toHaveLength(1)
      expect(blocks[0]?.title).toBe(def.title)
      // no pinned claim exists for either dial, and §16.3 lists no production row for them
      expect(def.productionClaims).toEqual([])
    }
    // t7.l2 keeps the knee beside the broken benchmark
    const t7 = ALL_LESSONS.find((l) => l.id === 't7.l2')
    expect((t7?.blocks ?? []).filter((b) => b.type === 'exercise' && 'fleet' in b).map((b) => (b as FleetExerciseBlock).fleet)).toEqual(['knee', 'broken-bench'])
  })

  test('no worker, host, protocol or session file names either exercise: the job dispatches by id', () => {
    for (const file of ['src/workers/fleet-protocol.ts', 'src/lib/fleet-host.ts', 'src/lib/fleet-session.ts', 'src/workers/fleet.worker.ts']) {
      const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
      for (const id of ['broken-bench', 'push-luck']) expect(text).not.toMatch(new RegExp(`['"\`]${id}['"\`]`))
    }
  })

  test('the exported markdown lists each as a fleet block (public/lessons-md is regenerated by scripts/export-lessons-md.ts)', () => {
    for (const [lesson, title] of [['t7.l2', 'The broken benchmark'], ['t6.l6', 'Push your luck']] as const) {
      const file = new URL(`../../public/lessons-md/${lesson}.md`, import.meta.url)
      expect(existsSync(file)).toBe(true)
      expect(readFileSync(file, 'utf8')).toContain(`**Exercise: ${title}**`)
    }
  })
})

/* ------------------------------ push-luck ------------------------------ */

describe('push-luck: the model', () => {
  test('the speedup is the sum 1 + α + … + α^γ over the round’s cost, and powers are repeated products', () => {
    for (let a = PL_ALPHA_MIN; a <= PL_ALPHA_MAX; a += 5) {
      const alpha = a / 100
      for (const c of [0.005, 0.05, 0.2, 0.4]) {
        for (const g of PL_POINTS) {
          let sum = 0
          let term = 1
          for (let j = 0; j <= g; j++) {
            sum += term
            term *= alpha
          }
          expect(plEmitted(alpha, g)).toBeCloseTo(sum, 10)
          expect(plSpeedup(alpha, g, c)).toBeCloseTo(sum / (g * c + 1), 10)
        }
      }
    }
    expect(plPower(0.5, 10)).toBe(2 ** -10)
    expect(plPower(0.85, 0)).toBe(1)
    // the lesson’s own worked figure: α = 0.85, k = 3 gives E ≈ 3.2 (t6.l6), and the ticket’s α = 0.8, k = 3 gives 2.952
    expect(plEmitted(0.85, 3)).toBeCloseTo(3.1866, 3)
    expect(plEmitted(0.8, 3)).toBeCloseTo(2.952, 9)
  })

  test('without a draft cost the expected tokens only rise with γ, so the question needs c', () => {
    for (let a = PL_ALPHA_MIN; a <= PL_ALPHA_MAX; a++) {
      const alpha = a / 100
      for (let g = 1; g < 24; g++) expect(plEmitted(alpha, g + 1)).toBeGreaterThan(plEmitted(alpha, g))
    }
  })

  test('the lesson’s note states the speedups of α = 0.77, c = 0.07 to two decimals, the peak at 6', () => {
    const v = plSpeedups({ alphaPct: 77, costMilli: 70 })
    const text = v.map((x) => x.toFixed(2)).join(', ')
    expect(text).toBe('1.65, 2.07, 2.33, 2.48, 2.55, 2.57, 2.56, 2.52')
    expect(v.indexOf(Math.max(...v)) + 1).toBe(6)
    const lesson = ALL_LESSONS.find((l) => l.id === 't6.l6')
    const note = (lesson?.blocks.find((b) => b.type === 'exercise' && 'fleet' in b) as FleetExerciseBlock).note ?? ''
    expect(note).toContain('For α = 0.77 and c = 0.07 it reads 1.65, 2.07, 2.33, 2.48, 2.55 and 2.57 at γ = 1 … 6, then 2.56 and 2.52 at γ = 7 and 8: the peak is at 6')
  })

  test('the sweep is model-only: eight draft lengths, no request served, the model in each point’s metrics', () => {
    const r = plSweep(3)
    expect(r.points.map((p) => p.x)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(pl.points).toEqual([...PL_POINTS])
    const pair = plPair(3)
    for (const p of r.points) {
      expect(p.goodputRps).toBe(0)
      expect(p.ttftP95).toBe(0)
      expect(p.metrics?.['alpha']).toBe(pair.alphaPct / 100)
      expect(p.metrics?.['cost']).toBe(pair.costMilli / 1000)
      expect(p.metrics?.['speedup']).toBe(plSpeedup(pair.alphaPct / 100, p.x, pair.costMilli / 1000))
      expect(p.metrics?.['tokensPerRound']).toBe(plEmitted(pair.alphaPct / 100, p.x))
    }
  })
})

describe('push-luck: fairness, determinism, the scene’s reading', () => {
  const rows = Array.from({ length: PL_SEEDS }, (_, seed) => {
    const r = plSweep(seed)
    return { seed, r, banded: plBand(r), truth: plTruth(r) }
  })

  test('sweeps are pure and deterministic, in any order', () => {
    const a = plSweep(11)
    plSweep(12)
    expect(plSweep(11)).toEqual(a)
    expect(plScene(11)).toEqual(plScene(11))
    expect(pl.sweep(11)).toEqual(a)
  })

  test('every seed is a fair question: an interior best, 1.2× or more, 0.5 % over every other length', () => {
    const banded = rows.filter((r) => r.banded)
    console.log(`push-luck: ${banded.length} of ${rows.length} seeds in 0 … ${PL_SEEDS - 1} are in band`)
    expect(banded.length).toBe(rows.length)
    for (const { r, truth } of rows) {
      const s = r.points.map((p) => p.metrics?.['speedup'] as number)
      const best = s[truth - 1] as number
      expect(truth).toBeLessThan(PL_POINTS[PL_POINTS.length - 1] as number)
      expect(best).toBeGreaterThanOrEqual(1.2)
      expect(best).toBeGreaterThanOrEqual(1.005 * Math.max(...s.filter((_, i) => i !== truth - 1)))
    }
  })

  test('the draw spreads the right answers over 1 … 6: none is right on more than a fifth of seeds', () => {
    const shares = new Map<number, number>()
    for (const r of rows) shares.set(r.truth, (shares.get(r.truth) ?? 0) + 1 / rows.length)
    console.log(`push-luck right answers: ${[...shares].sort((a, b) => a[0] - b[0]).map(([x, s]) => `γ = ${x}: ${pct(s)}`).join(', ')}`)
    expect([...shares.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6])
    // the grid offers a banded pair for each of those six best lengths, and for no other
    const best = (v: number[]) => v.indexOf(Math.max(...v)) + 1
    expect(plPairsByBest().map((g) => best(plSpeedups(g[0] as { alphaPct: number; costMilli: number })))).toEqual([1, 2, 3, 4, 5, 6])
    for (const s of shares.values()) expect(s).toBeLessThan(0.22)
  })

  test('the scene gives α and c and nothing else, and the argmax of the formula on them is the right answer on every seed', () => {
    for (const { seed, truth } of rows) {
      const [alpha, cost] = plScene(seed) as [SceneFact, SceneFact]
      expect(plScene(seed)).toHaveLength(2)
      expect(alpha.label).toContain('α')
      expect(cost.label).toContain('c')
      // the reading: repeated products, the formula, the largest of the eight
      let best = 1
      let bestS = 0
      for (const g of PL_POINTS) {
        let pow = 1
        for (let i = 0; i < g + 1; i++) pow *= alpha.value
        const s = (1 - pow) / ((1 - alpha.value) * (g * cost.value + 1))
        if (s > bestS) {
          best = g
          bestS = s
        }
      }
      expect(best).toBe(truth)
    }
  })

  test('a guess that ignores the scene never finishes: the right answers it gets are all one value', () => {
    for (const g of PL_POINTS) {
      const hit = rows.filter((r) => r.truth === g).length / rows.length
      expect(hit).toBeLessThan(0.22)
      const played: Played[] = Array.from({ length: 50 }, (_, i) => ({ seed: i, ok: true, value: g, truth: g }))
      expect(runOf(played, PASSES_NEEDED).done).toBe(false)
    }
  })

  test('the pass rule is exact, the lowest γ wins a tie, and the phone seed is the first in band', () => {
    const r = plSweep(0)
    expect(plPass(plTruth(r), r)).toBe(true)
    for (const g of PL_POINTS) expect(plPass(g, r)).toBe(g === plTruth(r))
    expect(PL_CANONICAL_SEED).toBe(rows.find((x) => x.banded)?.seed)
    expect(pl.phone.seed).toBe(PL_CANONICAL_SEED)
    expect(pl.phone.canonical).toEqual(plSweep(PL_CANONICAL_SEED))
  })
})

/* ------------------------------ broken-bench: the engine facts ------------------------------ */

describe('broken-bench: what the header and copy say about the engine', () => {
  test('a request that waits for no one has a TTFT of ⌈prompt ÷ 128⌉ − 1 ticks, and holds its slot that many ticks plus one per output token', () => {
    for (const prompt of [100, 128, 129, 1000, 4096, 9000]) {
      const e = new Engine(BB_ENGINE, [{ id: 1, arrival: 0, prompt, output: 10 }], makeRefScheduler(), makeRefManager(BB_ENGINE.numBlocks, BB_ENGINE.blockSize))
      let finished = -1
      e.onFinish = (f) => {
        finished = f.tick
      }
      while (!e.done) e.step()
      expect(e.stats().ttfts).toEqual([Math.ceil(prompt / BB_ENGINE.prefillChunk) - 1])
      // the slot is freed on the tick the last token lands: prefill ticks + (output − 1) decode ticks, counted from 0
      expect(finished).toBe(Math.ceil(prompt / BB_ENGINE.prefillChunk) + 10 - 2)
    }
  })

  test('a closed loop of one client per slot finishes at Little’s-law capacity and never queues', () => {
    const seed = bbSurvey().find((r) => r.flaw === 'closed-loop' && r.banded)!.seed
    expect(bbPoint(seed, 0)).toEqual(bbSurvey()[seed]!.sweep.points[0]!)
    const ratios: number[] = []
    for (const r of bbBanded().filter((r) => r.flaw === 'closed-loop')) {
      const c = bbCase(r.seed)
      const run = r.sweep.points[0]!
      // each client's last request is sent inside the window and finishes after it, so the window holds all but 64
      const rate = ((run.metrics?.['completed'] as number) - BB_ENGINE.maxRunning) / c.window
      ratios.push(rate / bbCapacity(c))
      // no queue: its p95 TTFT is a prefill, at most the longest prompt’s
      expect(run.ttftP95).toBeLessThanOrEqual(Math.ceil(c.prompt.max / BB_ENGINE.prefillChunk) - 1)
    }
    // a short window holds only a few holds per client, so the count is coarse there (a client whose second request
    // ends just past the window has finished one); the median is capacity, and no closed loop ever exceeds it
    ratios.sort((a, b) => a - b)
    const median = ratios[Math.floor(ratios.length / 2)] as number
    console.log(`closed loops: finished within the window at ${pct(ratios[0]!)} … ${pct(ratios[ratios.length - 1]!)} of Little’s-law capacity, median ${pct(median)}, over ${ratios.length} seeds`)
    expect(median).toBeGreaterThan(0.9)
    expect(median).toBeLessThan(1.05)
    for (const x of ratios) expect(x).toBeLessThan(1.1)
  })

  test('every flaw is expressed on the Engine: none is left out', () => {
    expect([...BB_FLAWS]).toEqual(['closed-loop', 'capped-output', 'warm-cache', 'warm-up'])
    const seen = new Set(bbSurvey().map((r) => r.flaw))
    expect([...seen].sort()).toEqual([...BB_FLAWS].sort())
  })
})

/* ------------------------------ broken-bench: the draw ------------------------------ */

describe('broken-bench: the draw picks the answer, then traffic that gives it', () => {
  const CASES = 4000
  const cases = Array.from({ length: CASES }, (_, seed) => ({ seed, c: bbCase(seed) }))
  const isOver = (f: string) => f === 'closed-loop' || f === 'capped-output'
  const p95Ticks = (c: { prompt: { min: number; max: number } }) => Math.ceil((c.prompt.min + 0.95 * (c.prompt.max - c.prompt.min)) / BB_ENGINE.prefillChunk) - 1

  test('over capacity: the wait is on a geometric grid from 100 ticks, and the load that gives it is 1.15 … 4', () => {
    expect(BB_QUEUE_GRID.length).toBe(67)
    expect(BB_QUEUE_GRID[0]).toBe(BB_MIN_QUEUE_TICKS)
    for (let i = 1; i < BB_QUEUE_GRID.length; i++) expect(BB_QUEUE_GRID[i]).toBeCloseTo((BB_QUEUE_GRID[i - 1] as number) * 1.05, 9)
    expect(Math.round(BB_QUEUE_GRID[BB_QUEUE_GRID.length - 1] as number)).toBe(2503)
    // the comment in bbCase: the shortest wait fits the shortest window and the longest the longest
    expect(bbLoadFor(BB_MIN_QUEUE_TICKS, 400)).toBe(1.27)
    expect(bbLoadFor(BB_QUEUE_GRID[BB_QUEUE_GRID.length - 1] as number, 1000)).toBe(3.64)
    for (const { c } of cases.filter(({ c }) => isOver(c.flaw))) {
      expect(c.load).toBeGreaterThanOrEqual(BB_LOAD_MIN)
      expect(c.load).toBeLessThanOrEqual(BB_LOAD_MAX)
      // rounding the load up keeps the wait at least the grid's, so never under 100 ticks
      expect(bbQueue(c.load, c.window)).toBeGreaterThanOrEqual(BB_MIN_QUEUE_TICKS)
      expect(BB_QUEUE_GRID.some((q) => Math.abs(bbLoadFor(q, c.window) - c.load) < 1e-9)).toBe(true)
    }
  })

  test('under capacity: the answer is 5 … 150 prefill ticks weighted 1 ÷ ticks, and the prompt range gives exactly it', () => {
    expect(bbPrefillTicks(0)).toBe(BB_PREFILL_MIN_TICKS)
    expect(bbPrefillTicks(2 ** 32 - 1)).toBe(BB_PREFILL_MAX_TICKS)
    for (let t = BB_PREFILL_MIN_TICKS; t <= BB_PREFILL_MAX_TICKS; t++) {
      for (const w of BB_PROMPT_WIDTH) {
        const p = bbPromptFor(t, w)
        expect(p.max).toBe(p.min * w - 1)
        expect(p.min % 16).toBe(0)
        expect(p95Ticks({ prompt: p })).toBe(t)
      }
    }
    // weighted 1 ÷ ticks, 5 … 10 and 50 … 100 are about equally likely (each about ln 2 of the weight)
    const light = cases.filter(({ c }) => !isOver(c.flaw))
    const ticks = light.map(({ c }) => p95Ticks(c))
    const low = ticks.filter((t) => t <= 10).length / ticks.length
    const high = ticks.filter((t) => t >= 50 && t <= 100).length / ticks.length
    console.log(`broken-bench light-load answers over ${ticks.length} cases: 5 … 10 ticks ${pct(low)}, 50 … 100 ticks ${pct(high)}`)
    expect(Math.abs(low - high)).toBeLessThan(0.05)
    for (const { seed, c } of light) {
      expect(bbRead(bbScene(seed))).toBe(p95Ticks(c) * 50)
      expect(BB_LOAD_LIGHT as readonly number[]).toContain(c.load)
    }
  })

  test('every case keeps its own rules: 120 requests or more, a capped run under 0.8 of its engine, a cold start of 3 × the prefill or more', () => {
    let most = 0
    for (const { seed, c } of cases) {
      most = Math.max(most, bbCaseDraws(seed))
      expect(bbKeeps(c)).toBe(true)
      expect(c.load * bbCapacity(c) * c.window).toBeGreaterThanOrEqual(120)
      if (c.flaw === 'capped-output') expect((c.load * bbHold(c, c.cap)) / bbHold(c)).toBeLessThanOrEqual(BB_CAPPED_LOAD)
      if (c.flaw === 'warm-up') {
        expect(c.cold as number).toBeGreaterThanOrEqual(BB_COLD_PER_PREFILL * p95Ticks(c))
        expect(c.cold as number).toBeGreaterThanOrEqual(100)
      }
    }
    // the traffic is drawn again when it breaks a rule, and never runs out of draws here
    console.log(`broken-bench draws: the most any of seeds 0 … ${CASES - 1} needs is ${most} of ${BB_TRIES + 1}`)
    expect(most).toBeLessThanOrEqual(BB_TRIES)
    // the lightest traffic a seed would fall back on keeps every rule, for every answer the grids can draw
    for (const q of BB_QUEUE_GRID) {
      expect(bbWindowsFor(q).length).toBeGreaterThan(0)
      for (const f of ['closed-loop', 'capped-output'] as const) expect(bbKeeps(bbLightest(f, q))).toBe(true)
    }
    for (let t = BB_PREFILL_MIN_TICKS; t <= BB_PREFILL_MAX_TICKS; t++) {
      for (const w of BB_PROMPT_WIDTH) for (const f of ['warm-cache', 'warm-up'] as const) expect(bbKeeps(bbLightest(f, 0, bbPromptFor(t, w)))).toBe(true)
    }
  })

  test('KV never binds: 64 of the longest prompt with the longest reply and the headroom fit the engine', () => {
    let worst = 0
    for (const { c } of cases) worst = Math.max(worst, BB_ENGINE.maxRunning * (c.prompt.max + c.output.max + HEADROOM_TOKENS))
    // the longest prompt any draw can make: 150 ticks on a range three times as wide, or 3,072 three times as wide
    const longest = Math.max(bbPromptFor(BB_PREFILL_MAX_TICKS, 3).max, 3072 * 3 - 1)
    const bound = BB_ENGINE.maxRunning * (longest + (128 * 2 - 1) + HEADROOM_TOKENS)
    console.log(`broken-bench KV: the most any of ${CASES} cases needs is ${worst} tokens, the most any draw can is ${bound}, the engine holds ${BB_ENGINE.numBlocks * BB_ENGINE.blockSize}`)
    expect(worst).toBeLessThanOrEqual(bound)
    expect(bound).toBeLessThanOrEqual(BB_ENGINE.numBlocks * BB_ENGINE.blockSize)
  })

  test('a sweep stays inside its job budget: the slowest of the survey’s takes under a fifth of it', () => {
    console.log(`broken-bench slowest sweep over seeds 0 … ${BB_SEEDS - 1}: ${bbWorstMs.toFixed(0)} ms (job budget ${FLEET_JOB_BUDGET_MS} ms)`)
    expect(bbWorstMs).toBeLessThan(FLEET_JOB_BUDGET_MS / 5)
  })
})

/* ------------------------------ broken-bench: fairness ------------------------------ */

describe('broken-bench: a fair question, deterministic, and the flaw goes the way it should', () => {
  test('sweeps are pure and deterministic, in any order, and two points: as run, then corrected', () => {
    const a = bbSweep(5)
    bbSweep(6)
    expect(bbSweep(5)).toEqual(a)
    expect(bb.sweep(5)).toEqual(a)
    expect(a.points.map((p) => p.x)).toEqual([0, 1])
    expect(bb.points).toEqual([0, 1])
    expect(bb.range).toEqual({ min: 1, max: 600000 })
    expect(bbScene(5)).toEqual(bbScene(5))
  })

  test('the seeds in band: all four flaws appear, 90 % or more of seeds are questions, and every run completes', () => {
    const rows = bbSurvey()
    const banded = bbBanded()
    const byFlaw = new Map<string, number>()
    for (const r of rows) byFlaw.set(r.flaw, (byFlaw.get(r.flaw) ?? 0) + 1)
    console.log(`broken-bench: ${banded.length} of ${rows.length} seeds in 0 … ${rows.length - 1} are in band; flaws drawn: ${[...byFlaw].map(([f, n]) => `${f} ${n}`).join(', ')}`)
    expect(banded.length / rows.length).toBeGreaterThan(0.9)
    for (const f of BB_FLAWS) expect((byFlaw.get(f) ?? 0) / rows.length).toBeGreaterThan(0.18)
    for (const r of banded) {
      const sweep = r.sweep
      for (const p of sweep.points) {
        expect(p.metrics?.['completed']).toBe(p.metrics?.['requests'])
        expect(p.metrics?.['shed']).toBe(0)
      }
      expect(sweep.points[1]?.metrics?.['requests'] as number).toBeGreaterThanOrEqual(100)
    }
  })

  test('closed loops, short replies and a warm cache report a TTFT 1.5× too low or more, and counting the cold start one 1.5× too high', () => {
    for (const r of bbBanded()) {
      if (r.flaw === 'warm-up') expect(r.reported).toBeGreaterThanOrEqual(1.5 * r.truth)
      else expect(r.truth).toBeGreaterThanOrEqual(1.5 * Math.max(r.reported, 50))
    }
  })

  test('the number the benchmark reported never passes, so the flaw has to be corrected', () => {
    for (const r of bbBanded()) {
      expect(bbPass(r.reported, r.sweep)).toBe(false)
    }
  })

  test('the pass rule is 30 % either side of the corrected p95', () => {
    const seed = bbBanded()[0]!.seed
    const r = bbSweep(seed)
    const t = bbTruth(r)
    expect(bbPass(t, r)).toBe(true)
    expect(bbPass(t * 1.29, r)).toBe(true)
    expect(bbPass(t * 0.71, r)).toBe(true)
    expect(bbPass(t * 1.31, r)).toBe(false)
    expect(bbPass(t * 0.69, r)).toBe(false)
    expect(bb.truth(r)).toBe(t)
    expect(t).toBeGreaterThanOrEqual(bb.range!.min)
    expect(t).toBeLessThanOrEqual(bb.range!.max)
  })

  test('the phone seed is the first in band, and its outcome is that seed’s sweep', () => {
    expect(BB_CANONICAL_SEED).toBe(bbSurvey().find((r) => r.banded)?.seed)
    expect(bb.phone.seed).toBe(BB_CANONICAL_SEED)
    expect(bb.phone.canonical).toEqual(bbSweep(BB_CANONICAL_SEED))
  })

  test('the scene shows what the benchmark did and what production offers, never either run’s p95', () => {
    for (const r of bbSurvey().slice(0, 60)) {
      const facts = bbScene(r.seed)
      expect(facts.length).toBe(5)
      expect(facts.map((f) => f.label).slice(0, 4)).toEqual(['Prompts', 'Outputs', 'Window', 'Production arrivals'])
      for (const f of facts) {
        expect(Number.isFinite(f.value)).toBe(true)
        expect(f.label.toLowerCase()).not.toContain('ttft')
      }
      expect(BB_WINDOWS.map((w) => w * SIM_TICK_SECONDS)).toContain(facts[2]!.value)
    }
  })
})

/* ------------------------------ broken-bench: strategies against the rule (BF8) ------------------------------ */

describe('broken-bench: a strategy that ignores the scene does not finish', () => {
  test('the scene’s reading passes on nearly every seed, and by flaw', () => {
    const rows = bbBanded()
    const right = (r: BbRow) => Math.abs(r.read - r.truth) <= BB_TOLERANCE * r.truth
    const share = rows.filter(right).length / rows.length
    const by = BB_FLAWS.map((f) => {
      const rs = rows.filter((r) => r.flaw === f)
      return [f, rs.filter(right).length / rs.length] as const
    })
    const errs = rows.filter((r) => r.flaw === 'closed-loop' || r.flaw === 'capped-output').map((r) => r.read / r.truth - 1).sort((a, b) => a - b)
    console.log(`broken-bench scene reading: passes on ${pct(share)} of banded seeds (${by.map(([f, s]) => `${f} ${pct(s)}`).join(', ')}); a growing queue reads ${pct(errs[Math.floor(errs.length / 2)] as number)} high at the median`)
    expect(share).toBeGreaterThanOrEqual(0.95)
    for (const [, s] of by) expect(s).toBeGreaterThanOrEqual(0.9)
  })

  test('the best constant passes on at most a quarter of banded seeds and finishes within 10 rounds about 6 % of the time (30 rounds: under a third)', () => {
    const rows = bbBanded()
    const best = bestConstant(rows)
    const d10 = doneWithin(rows, () => best.value, 10)
    const d30 = doneWithin(rows, () => best.value, 30)
    console.log(`broken-bench best constant ${Math.round(best.value)} ms: passes on ${pct(best.share)} of banded seeds; done within 10 rounds ${pct(d10)}, within 30 ${pct(d30)}`)
    expect(best.share).toBeLessThan(0.25)
    expect(d10).toBeLessThan(0.12)
    expect(d30).toBeLessThan(0.33)
  })

  test('naming only the flaw’s own constant is a partial reading, and no better than the scene-blind bound D39 sets for the knee', () => {
    // G1 of the 3s review: on fixed prompt and load grids the flaw label alone passed 35.6 % of rounds and finished
    // within 10 rounds 23.5 % of the time (60.2 % within 30). The draw now picks each flaw's answer first, uniform in log,
    // so the label names a spread of answers. D39: the knee's best scene-ignoring guess finishes within 10 rounds 14 %
    // of the time and within 30 rounds 40 %, its answers none right on more than about 29 % of seeds.
    const rows = bbBanded()
    const by = new Map(BB_FLAWS.map((f) => [f, bestConstant(rows.filter((r) => r.flaw === f))] as const))
    const guess = (r: BbRow) => by.get(r.flaw as (typeof BB_FLAWS)[number])!.value
    const share = rows.filter((r) => Math.abs(guess(r) - r.truth) <= BB_TOLERANCE * r.truth).length / rows.length
    const d10 = doneWithin(rows, guess, 10)
    const d30 = doneWithin(rows, guess, 30)
    console.log(`broken-bench flaw-only constants (${[...by].map(([f, b]) => `${f} ${Math.round(b.value)} ms ${pct(b.share)}`).join(', ')}): pass on ${pct(share)} of banded seeds; done within 10 rounds ${pct(d10)}, within 30 ${pct(d30)}`)
    for (const [, b] of by) expect(b.share).toBeLessThan(0.32)
    expect(share).toBeLessThan(0.29)
    expect(d10).toBeLessThan(0.14)
    expect(d30).toBeLessThan(0.4)
  })

  test('the draw picks the answer first: each flaw’s answers spread over a wide range, so no one flaw names a number', () => {
    const rows = bbBanded()
    for (const f of BB_FLAWS) {
      const t = rows.filter((r) => r.flaw === f).map((r) => r.truth).sort((a, b) => a - b)
      const q = (p: number) => t[Math.floor(p * (t.length - 1))] as number
      console.log(`broken-bench ${f}: corrected p95 from ${t[0]} to ${t[t.length - 1]} ms, quartiles ${q(0.25)}, ${q(0.5)}, ${q(0.75)}`)
      // the middle half of the answers spans more than one pass window (1.3 ÷ 0.7 = 1.86×), so no constant holds it
      expect(q(0.75) / q(0.25)).toBeGreaterThan((1 + BB_TOLERANCE) / (1 - BB_TOLERANCE))
    }
  })

  test('a learner who applies the scene’s reading finishes within 10 rounds', () => {
    const d10 = doneWithin(bbBanded(), (r) => r.read, 10)
    console.log(`broken-bench scene reading: done within 10 rounds ${pct(d10)}`)
    expect(d10).toBeGreaterThan(0.9)
  })
})

/* ------------------------------ the panel’s pure session ------------------------------ */

describe('the panel session on the new exercises', () => {
  test('a free number in the range is a prediction for broken-bench, and only one of the points is for the others', () => {
    expect(accepts(bb, 1250)).toBe(true)
    expect(accepts(bb, 0)).toBe(false)
    expect(accepts(bb, 600001)).toBe(false)
    expect(accepts(bb, NaN)).toBe(false)
    expect(parsePrediction(bb, '1,250')).toBe(1250)
    expect(parsePrediction(bb, '850.5')).toBe(850.5)
    expect(parsePrediction(bb, 'soon')).toBeNull()
    expect(parsePrediction(bb, '0')).toBeNull()
    expect(parsePrediction(pl, '4')).toBe(4)
    expect(parsePrediction(pl, '9')).toBeNull()
    expect(parsePrediction(pl, '2.5')).toBeNull()
    expect(parsePrediction(knee, '1.25')).toBe(1.25)
    expect(parsePrediction(knee, '1.3')).toBeNull()
  })

  test('the entry rule: the broken benchmark asks for milliseconds, the others keep “one of” their points', () => {
    expect(entryText(bb, copyFor('broken-bench')!)).toEqual({ hint: 'a number of milliseconds', error: 'Enter the p95 time to first token as a number of milliseconds, such as 1250.' })
    expect(entryText(pl, copyFor('push-luck')!)).toEqual({ hint: 'one of 1, 2, 3, 4, 5, 6, 7, 8', error: 'Enter one of the points the sweep runs: 1, 2, 3, 4, 5, 6, 7, 8.' })
    expect(entryText(knee, copyFor('knee')!).hint).toBe('one of 0.5, 0.75, 1, 1.25, 1.5, 2')
  })

  test('each has copy: a setup that states its own constants, three ideas, a model answer, and a label for every point', () => {
    for (const def of [bb, pl]) {
      const c = copyFor(def.id)!
      expect(c).not.toBeNull()
      expect(c.ideas).toHaveLength(3)
      expect(c.model.length).toBeGreaterThan(200)
      expect(c.explainPrompt).toMatch(/\?|\.$/)
      for (const p of def.points) {
        expect(c.tickLabel(p)).not.toBe('')
        expect(c.pointLabel(p)).not.toBe('')
      }
      expect(c.view).toBeDefined()
    }
    const b = copyFor('broken-bench')!
    for (const part of ['64 sequences', '50 ms', '128 tokens', '⌈prompt ÷ 128⌉', 'one tick in 4', '20 to 50 s', '64 ÷ (H × 0.05 s)', '⌈prompt ÷ 128⌉ − 1 ticks']) expect(b.setup).toContain(part)
    const p = copyFor('push-luck')!
    for (const part of ['(1 − α^(γ+1)) ÷ ((1 − α)(γc + 1))', 'γ = 1 … 8', 'repeated products', '0.5%', 'not a Fleet run']) expect(p.setup).toContain(part)
    expect(b.view?.plot).toBeNull()
    expect(p.view?.plot?.mark).toBe('best')
    expect(entryText(bb, b).hint).not.toContain('one of')
  })

  test('the broken benchmark’s verdict and table name the corrected p95, the reported one and the window that counts as right', () => {
    const seed = bbBanded()[0]!.seed
    const r = bbSweep(seed)
    const c = copyFor('broken-bench')!
    const truth = bbTruth(r)
    const right = verdictText(bb, c, truth, r)
    expect(right.ok).toBe(true)
    expect(right.detail).toContain("The corrected run's p95 TTFT is")
    const off = verdictText(bb, c, bbReported(r), r)
    expect(off.ok).toBe(false)
    expect(off.headline).toBe('Your prediction was off.')
    expect(off.detail).toContain('within 30% is right')
    const table = sweepTable(bb, c, r, truth)
    expect(table.columns).toEqual(['Run', 'p95 TTFT (ms)', 'Goodput (req/s)', 'SLO met'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]?.[0]).toBe('The benchmark as run')
    expect(table.rows[1]?.[0]).toBe('The corrected run (the answer)')
    expect(Number(String(table.rows[1]?.[1]).replace(/,/g, ''))).toBe(truth)
  })

  test('push your luck’s verdict, table and plot read the speedup, with the best marked', () => {
    const r = plSweep(3)
    const c = copyFor('push-luck')!
    const truth = plTruth(r)
    expect(verdictText(pl, c, truth, r)).toMatchObject({ ok: true, headline: 'Your prediction held.' })
    const wrong = truth === 1 ? 2 : 1
    const off = verdictText(pl, c, wrong, r)
    expect(off.ok).toBe(false)
    expect(off.detail).toContain(`You said γ = ${wrong}`)
    expect(off.detail).toContain(`It peaks at γ = ${truth}`)
    const table = sweepTable(pl, c, r, wrong)
    expect(table.columns).toEqual(['Draft length γ', 'Tokens per round', 'Round cost (target steps)', 'Speedup'])
    expect(table.rows).toHaveLength(PL_POINTS.length)
    expect(table.rows[truth - 1]?.[0]).toBe(`γ = ${truth} (best)`)
    expect(table.rows[wrong - 1]?.[0]).toBe(`γ = ${wrong} (your pick)`)
    expect(c.view?.plot?.of(r.points[truth - 1]!)).toBe(r.points[truth - 1]?.metrics?.['speedup'])
  })

  test.each([
    ['broken-bench', bb],
    ['push-luck', pl],
  ] as const)('%s: a round runs draw → predict → explain → saved, writes numeric events, and counts as a pass', (_id, def) => {
    const seed = def.id === 'push-luck' ? 3 : (bbBanded()[0] as BbRow).seed
    const r: SweepResult = def.sweep(seed)
    expect(def.band(r)).toBe(true)
    let round = reduceRound(def, freshRound(0), { type: 'draw' })
    round = reduceRound(def, round, { type: 'swept', seed, result: r, at: 1 })
    expect(round.phase).toBe('predict')
    // a value the exercise does not take is refused
    expect(reduceRound(def, round, { type: 'commit', prediction: def.id === 'push-luck' ? 99 : -5, at: 2 }).phase).toBe('predict')
    const answer = def.truth(r)
    round = reduceRound(def, round, { type: 'commit', prediction: answer, conf: 'sure', at: 2 })
    expect(round.phase).toBe('explain')
    expect(round.ok).toBe(true)
    expect(round.truth).toBe(answer)
    round = reduceRound(def, round, { type: 'explain', text: 'the slower thing sets the rate and the rest follows from it' })
    expect(explainReady(round.explain)).toBe(true)
    for (const index of [0, 1, 2]) round = reduceRound(def, round, { type: 'idea', index })
    expect(canSave(round)).toBe(true)
    round = reduceRound(def, round, { type: 'save', at: 3 })
    expect(round.phase).toBe('saved')
    const ctx = { lessonId: def.lessonId, index: 7 }
    const item = itemEvent(def, ctx, round)
    const predict = predictEvent(def, ctx, round)
    for (const e of [item, predict]) {
      expect(e.ref).toBe(`item:fleet.${def.id}`)
      expect(e.ok).toBe(true)
      expect(e.provenance).toBe('unseen')
      expect(e.data).toMatchObject({ src: 'lesson', value: answer, truth: answer, unit: def.unit, lessonId: def.lessonId, grp: `${def.lessonId}#7` })
    }
    const state = readExercise([{ kind: 'item', ref: item.ref, at: '2026-01-01T00:00:00Z', ok: true, seed, data: item.data }], { id: def.id, lessonId: def.lessonId, index: 7, needs: PASSES_NEEDED })
    expect(state.passes).toBe(1)
  })

  test('the broken benchmark takes a close number, not only the exact one: a prediction 20 % high is a pass, the reported one is a miss', () => {
    const seed = bbBanded()[0]!.seed
    const r = bbSweep(seed)
    let round = reduceRound(bb, reduceRound(bb, freshRound(0), { type: 'draw' }), { type: 'swept', seed, result: r, at: 1 })
    round = reduceRound(bb, round, { type: 'commit', prediction: Math.round(bbTruth(r) * 1.2), at: 2 })
    expect(round.ok).toBe(true)
    let miss = reduceRound(bb, reduceRound(bb, freshRound(0), { type: 'draw' }), { type: 'swept', seed, result: r, at: 1 })
    miss = reduceRound(bb, miss, { type: 'commit', prediction: bbReported(r), at: 2 })
    expect(miss.ok).toBe(false)
  })
})
