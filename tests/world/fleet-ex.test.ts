/**
 * The Fleet exercises (docs/specs/wave-3.md §5.3; task 3b-03): the load knee and the P:D split. Each sweep is pure and
 * deterministic; truth, band and pass rule are pure functions of a SweepResult; every point's goodputRps is SLO-met
 * requests over the trace's arrival window at 50 ms per tick, never Engine.goodput()'s percentage; each band accepts at
 * least 20 % of candidate seeds (printed); and the numbers each module's header states are re-measured here.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { getClaim } from '../../src/data/claims/all'
import { ALL_LESSONS } from '../../src/data/lessons'
import { kcById } from '../../src/data/kc'
import { Engine, makeRefManager, makeRefQueue, makeRefScheduler, SIM_TICK_SECONDS } from '../../src/lib/fleet-model'
import { getFleetTrafficProfile } from '../../src/lib/traces'
import { FLEET_EXERCISES, type FleetExerciseDef, type SweepResult } from '../../src/lib/world/fleet-ex'
import {
  fifoScheduler,
  goodputRps,
  KNEE_CANONICAL_SEED,
  KNEE_POINTS,
  KNEE_WINDOW_TICKS,
  kneeBand,
  kneePass,
  kneePoint,
  kneeProcess,
  kneeTrace,
  kneeTruth,
} from '../../src/lib/world/fleet-ex/knee'
import {
  PD_CANONICAL_SEED,
  PD_ENGINE,
  PD_POINTS,
  PD_WINDOW_TICKS,
  PD_WORKERS,
  pdBand,
  pdEstimateSplit,
  pdPass,
  pdPoint,
  pdTrace,
  pdTruth,
  pdWorkload,
} from '../../src/lib/world/fleet-ex/pd-split'
import { FLEET_JOB_BUDGET_MS } from '../../src/workers/fleet-protocol'

const knee = FLEET_EXERCISES['knee'] as FleetExerciseDef
const pd = FLEET_EXERCISES['pd-split'] as FleetExerciseDef

/** A SweepResult with these goodputs at the exercise's points. */
const result = (def: FleetExerciseDef, goodputs: number[]): SweepResult => ({
  points: def.points.map((x, i) => ({ x, goodputRps: goodputs[i] as number, ttftP95: 0 })),
})

/** Sweeps are pure, so the tests that survey the same seeds share them. */
const swept = new Map<string, SweepResult>()
const sweepOf = (def: FleetExerciseDef, seed: number): SweepResult => {
  const key = `${def.id}:${seed}`
  let r = swept.get(key)
  if (!r) swept.set(key, (r = def.sweep(seed)))
  return r
}

const pct = (k: number, n: number) => `${((100 * k) / n).toFixed(1)} %`

/** Seeds in band, and how often each answer is right, over seeds 0 … n − 1. */
function survey(def: FleetExerciseDef, n: number) {
  const truths = new Map<number, number>()
  let inBand = 0
  for (let seed = 0; seed < n; seed++) {
    const r = sweepOf(def, seed)
    if (!def.band(r)) continue
    inBand++
    truths.set(def.truth(r), (truths.get(def.truth(r)) ?? 0) + 1)
  }
  return { inBand, truths: [...truths].sort((a, b) => a[0] - b[0]) }
}

describe('the table', () => {
  test('FLEET_EXERCISES lists the knee, the P:D split, the broken benchmark and push your luck, keyed by their ids', () => {
    expect(Object.keys(FLEET_EXERCISES)).toEqual(['knee', 'pd-split', 'broken-bench', 'push-luck'])
    for (const [key, def] of Object.entries(FLEET_EXERCISES)) expect(def.id).toBe(key)
  })

  test('each exercise names a real lesson, its real KCs and claims that resolve', () => {
    for (const def of [knee, pd]) {
      const lesson = ALL_LESSONS.find((l) => l.id === def.lessonId)
      expect(lesson).toBeDefined()
      expect(def.title.length).toBeGreaterThan(0)
      expect(def.unit.length).toBeGreaterThan(0)
      for (const kc of def.kcs) {
        expect(kcById(kc)).toBeDefined()
        expect(lesson?.kcs).toContain(kc)
      }
      expect(def.productionClaims.length).toBeGreaterThan(0)
      for (const id of def.productionClaims) expect(getClaim(id).id).toBe(id)
    }
    expect([knee.lessonId, pd.lessonId]).toEqual(['t7.l2', 't6.l3'])
  })

  test('knee sweeps six load multipliers and the P:D split sweeps 1:7 … 7:1 on 8 workers', () => {
    expect(knee.points).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2])
    expect(pd.points).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(PD_WORKERS).toBe(8)
    expect(knee.sweep(0).points.map((p) => p.x)).toEqual([...knee.points])
    expect(pd.sweep(1).points.map((p) => p.x)).toEqual([...pd.points])
  })
})

describe('purity', () => {
  test('a sweep is deterministic and carries only plain data', () => {
    for (const [def, seed] of [[knee, 7], [pd, 7]] as const) {
      const a = def.sweep(seed)
      const b = def.sweep(seed)
      expect(b).toEqual(a)
      expect(JSON.parse(JSON.stringify(a))).toEqual(a)
      expect(structuredClone(a)).toEqual(a)
      expect(def.sweep(seed + 1)).not.toEqual(a)
    }
  })

  test('truth, band and pass are pure functions of the result', () => {
    for (const [def, seed] of [[knee, 3], [pd, 3]] as const) {
      const r = def.sweep(seed)
      const copy = structuredClone(r)
      expect(def.truth(r)).toBe(def.truth(copy))
      expect(def.band(r)).toBe(def.band(copy))
      expect(def.pass(def.truth(r), r)).toBe(true)
      expect(r).toEqual(copy)
    }
  })

  test('the traces are pure in the seed', () => {
    expect(kneeTrace(5, 1.25)).toEqual(kneeTrace(5, 1.25))
    expect(pdTrace(5)).toEqual(pdTrace(5))
    expect(kneeTrace(5)).not.toEqual(kneeTrace(6))
    expect(pdTrace(5)).not.toEqual(pdTrace(6))
  })
})

describe('goodputRps is SLO-met requests over the arrival window, never a percentage', () => {
  test('the formula', () => {
    expect(goodputRps(40, 800)).toBe(1)
    expect(goodputRps(0, 800)).toBe(0)
    expect(goodputRps(100, 400)).toBe(5)
    expect(SIM_TICK_SECONDS).toBe(0.05)
  })

  test('a knee point is the Engine run by hand: sloMet ÷ (800 ticks × 0.05 s)', () => {
    const profile = getFleetTrafficProfile('burstgpt')
    for (const load of [0.75, 1.5]) {
      const stream = kneeTrace(11, load)
      const e = new Engine(profile.config, stream, { name: 'fifo', schedule: fifoScheduler }, makeRefManager(256, 16), {
        intake: makeRefQueue(profile.intakeCap),
        drainPerTick: profile.drainPerTick,
      })
      while (!e.done) e.step()
      const point = kneePoint(11, load)
      const sloMet = e.stats().sloMet
      expect(point.metrics?.['sloMet']).toBe(sloMet)
      expect(point.goodputRps).toBe(sloMet / (KNEE_WINDOW_TICKS * SIM_TICK_SECONDS))
      expect(point.goodputRps).toBe(sloMet / 40)
      // not the engine's percentage of requests
      expect(point.goodputRps).not.toBe(e.goodput(stream.length))
      expect(point.metrics?.['requests']).toBe(stream.length)
    }
  })

  test('every point of both sweeps is an integer count of requests per 40 s (knee) or 20 s (split)', () => {
    for (const seed of [0, 1, 2]) {
      for (const p of knee.sweep(seed).points) expect(p.goodputRps * 40).toBeCloseTo(p.metrics?.['sloMet'] as number, 9)
      for (const p of pd.sweep(seed).points) {
        expect(p.goodputRps * PD_WINDOW_TICKS * SIM_TICK_SECONDS).toBeCloseTo(p.metrics?.['sloMet'] as number, 9)
        expect(p.goodputRps).toBeLessThanOrEqual((p.metrics?.['requests'] as number) / (PD_WINDOW_TICKS * SIM_TICK_SECONDS))
      }
    }
  })

  test('the split reports TPOT p95 (the knee does not), and no request is lost', () => {
    for (const p of pd.sweep(1).points) {
      expect(p.tpotP95).toBeGreaterThanOrEqual(1)
      expect((p.metrics?.['completed'] as number) + (p.metrics?.['shed'] as number)).toBe(p.metrics?.['requests'] as number)
    }
    for (const p of knee.sweep(0).points) {
      expect(p.tpotP95).toBeUndefined()
      expect((p.metrics?.['completed'] as number) + (p.metrics?.['shed'] as number)).toBe(p.metrics?.['requests'] as number)
    }
  })
})

describe('the knee trace', () => {
  const artifact = async () =>
    (await Bun.file(join(import.meta.dir, '..', '..', 'public', 'traces', 'burstgpt-v2-busiest-hour.json')).json()) as {
      requests: { t: number; p: number; o: number }[]
    }

  test('its quantile knots are the committed BurstGPT hour\'s', async () => {
    const rows = (await artifact()).requests
    const q = (key: 'p' | 'o', u: number) => rows.map((r) => r[key]).sort((a, b) => a - b)[Math.floor(u * (rows.length - 1))]
    // the knots in knee.ts: u → tokens
    expect([0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99].map((u) => q('p', u))).toEqual([62, 66, 90, 178, 358, 1107, 3046])
    expect([0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99].map((u) => q('o', u))).toEqual([3, 3, 3, 6, 37, 67, 189])
  })

  test('drawn lengths follow them (median and 90th percentile within 15 %), clamped to 1,024 and 128', () => {
    const prompts: number[] = []
    const outputs: number[] = []
    for (let seed = 0; seed < 40; seed++) {
      for (const r of kneeTrace(seed)) {
        prompts.push(r.prompt)
        outputs.push(r.output)
      }
    }
    const at = (xs: number[], u: number) => [...xs].sort((a, b) => a - b)[Math.floor(u * (xs.length - 1))] as number
    expect(Math.abs(at(prompts, 0.5) / 90 - 1)).toBeLessThan(0.15)
    expect(Math.abs(at(prompts, 0.9) / 358 - 1)).toBeLessThan(0.15)
    expect(Math.max(...prompts)).toBeLessThanOrEqual(1024)
    expect(Math.min(...prompts)).toBeGreaterThanOrEqual(8)
    expect(Math.abs(at(outputs, 0.5) / 3 - 1)).toBeLessThan(0.34)
    expect(Math.abs(at(outputs, 0.9) / 37 - 1)).toBeLessThan(0.15)
    expect(Math.max(...outputs)).toBeLessThanOrEqual(128)
    expect(Math.min(...outputs)).toBeGreaterThanOrEqual(1)
    console.log(
      `knee trace lengths over seeds 0–39: prompt median ${at(prompts, 0.5)} p90 ${at(prompts, 0.9)} (artifact 90, 358); output median ${at(outputs, 0.5)} p90 ${at(outputs, 0.9)} (artifact 3, 37)`,
    )
  })

  test('arrivals clump: gaps average 2.6 ticks with a coefficient of variation near 1.33, against the hour\'s own 0.33', async () => {
    const gaps: number[] = []
    for (let seed = 0; seed < 40; seed++) {
      const at = kneeProcess(seed).at
      for (let i = 1; i < at.length; i++) gaps.push(at[i]! - at[i - 1]!)
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const cv = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length) / mean
    expect(Math.abs(mean / 2.6 - 1)).toBeLessThan(0.05)
    expect(Math.abs(cv / (4 / 3) - 1)).toBeLessThan(0.1)
    const rows = (await artifact()).requests
    const own = rows.slice(1).map((r, i) => r.t - (rows[i] as { t: number }).t)
    const ownMean = own.reduce((a, b) => a + b, 0) / own.length
    const ownCv = Math.sqrt(own.reduce((a, g) => a + (g - ownMean) ** 2, 0) / own.length) / ownMean
    expect(ownCv).toBeLessThan(0.4)
    console.log(`knee arrivals over seeds 0–39: mean gap ${mean.toFixed(2)} ticks, CV ${cv.toFixed(2)} (the committed hour: CV ${ownCv.toFixed(2)})`)
  })

  test('a multiplier speeds up the same requests and cuts them at the 800-tick window', () => {
    const base = kneeTrace(4, 1)
    const fast = kneeTrace(4, 2)
    expect(fast.length).toBeGreaterThan(base.length)
    // the same requests in the same order: a prefix of the faster trace is the slower one's lengths
    for (let i = 0; i < base.length; i++) {
      expect(fast[i]?.prompt).toBe(base[i]?.prompt)
      expect(fast[i]?.output).toBe(base[i]?.output)
    }
    for (const load of KNEE_POINTS) {
      const t = kneeTrace(4, load)
      expect(t[0]?.arrival).toBeGreaterThanOrEqual(0)
      expect(Math.max(...t.map((r) => r.arrival))).toBeLessThan(KNEE_WINDOW_TICKS)
      expect(t.every((r, i) => i === 0 || r.arrival >= (t[i - 1] as { arrival: number }).arrival)).toBe(true)
    }
    // the offered rate grows with the multiplier, about linearly
    const n = KNEE_POINTS.map((m) => kneeTrace(4, m).length)
    expect(n).toEqual([...n].sort((a, b) => a - b))
    expect(Math.abs(n[5]! / n[2]! / 2 - 1)).toBeLessThan(0.15)
  })

  test('every request fits the 4,096-token pool with room to grow', () => {
    for (const r of kneeTrace(9, 2)) expect(r.prompt + r.output + 48).toBeLessThan(256 * 16)
  })
})

describe('the knee', () => {
  test('first come, first served shows the knee that the reference scheduler hides (seeds 0 … 11)', () => {
    let banded = 0
    let hidden = 0
    for (let seed = 0; seed < 12; seed++) {
      if (!kneeBand(sweepOf(knee, seed))) continue
      banded++
      // smallest prompt first keeps goodput climbing past the point where first come, first served collapses
      const ref = { points: KNEE_POINTS.map((m) => kneePoint(seed, m, makeRefScheduler())) }
      if (!kneeBand(ref)) hidden++
    }
    console.log(`the reference scheduler hides the knee on ${hidden} of ${banded} seeds in 0–11 that first come, first served bands`)
    expect(banded).toBeGreaterThanOrEqual(8)
    expect(hidden).toBeGreaterThanOrEqual(banded - 1)
  })

  test('on a banded seed TTFT p95 rises with load and crosses the 40-tick SLO past the peak', () => {
    let n = 0
    let rising = 0
    for (let seed = 0; seed < 60; seed++) {
      const r = sweepOf(knee, seed)
      if (!knee.band(r)) continue
      n++
      const t = r.points.map((p) => p.ttftP95)
      if (t.every((v, i) => i === 0 || v >= (t[i - 1] as number))) rising++
      expect(t[0]).toBeLessThanOrEqual(40)
      expect(t[5]).toBeGreaterThan(40)
    }
    expect(rising / n).toBeGreaterThan(0.95)
    console.log(`knee TTFT p95 rises monotonically with load on ${rising} of ${n} banded seeds in 0–59`)
  })

  test('goodput peaks a little below Little\'s-law capacity: offered rate at the peak is 0.5 … 1.2 of it', () => {
    const ratios: number[] = []
    for (let seed = 0; seed < 60; seed++) {
      const r = sweepOf(knee, seed)
      if (!knee.band(r)) continue
      const peak = r.points[r.points.findIndex((p) => p.x === knee.truth(r))] as SweepResult['points'][number]
      ratios.push((peak.metrics?.['offeredRps'] as number) / (peak.metrics?.['capacityRps'] as number))
    }
    ratios.sort((a, b) => a - b)
    expect(ratios[0]).toBeGreaterThan(0.5)
    expect(ratios[ratios.length - 1]).toBeLessThan(1.2)
    console.log(`knee: offered ÷ capacity at the peak over ${ratios.length} banded seeds: min ${ratios[0]?.toFixed(2)}, median ${ratios[ratios.length >> 1]?.toFixed(2)}, max ${ratios[ratios.length - 1]?.toFixed(2)}`)
  })

  test('truth is the multiplier of the highest goodput; the lower one wins a tie', () => {
    expect(kneeTruth(result(knee, [4, 6, 8, 9, 5, 3]))).toBe(1.25)
    expect(kneeTruth(result(knee, [4, 6, 9, 9, 5, 3]))).toBe(1)
    expect(knee.truth(result(knee, [9, 8, 7, 6, 5, 4]))).toBe(0.5)
  })

  test('band: an interior peak, 10 % above both ends and 5 % above the best other point', () => {
    expect(kneeBand(result(knee, [4, 6, 8, 9, 5, 3]))).toBe(true)
    // the peak is at an end
    expect(kneeBand(result(knee, [9, 6, 8, 7, 5, 3]))).toBe(false)
    expect(kneeBand(result(knee, [3, 6, 8, 7, 5, 9]))).toBe(false)
    // an end is within 10 % of the peak
    expect(kneeBand(result(knee, [8.2, 6, 8, 9, 5, 3]))).toBe(false)
    expect(kneeBand(result(knee, [4, 6, 8, 9, 5, 8.3]))).toBe(false)
    expect(kneeBand(result(knee, [4, 6, 8, 9, 5, 8.1]))).toBe(true)
    // a neighbour within 5 % makes the answer a coin flip
    expect(kneeBand(result(knee, [4, 6, 8.7, 9, 5, 3]))).toBe(false)
    expect(kneeBand(result(knee, [4, 6, 8.5, 9, 5, 3]))).toBe(true)
  })

  test('pass: exactly the multiplier where goodput peaks', () => {
    const r = result(knee, [4, 6, 8, 9, 5, 3])
    expect(kneePass(1.25, r)).toBe(true)
    expect(knee.pass(1.25, r)).toBe(true)
    for (const wrong of [0.5, 0.75, 1, 1.5, 2, 1.26, NaN]) expect(kneePass(wrong, r)).toBe(false)
  })

  test('the band accepts at least 20 % of candidate seeds (printed), and the answers vary', () => {
    const n = 200
    const { inBand, truths } = survey(knee, n)
    console.log(`knee band acceptance: ${pct(inBand, n)} of seeds 0–${n - 1}; right answers (multiplier: count) ${truths.map(([x, k]) => `${x}: ${k}`).join(', ')}`)
    expect(inBand / n).toBeGreaterThanOrEqual(0.2)
    // not one answer: a learner cannot pass three seeds by naming a constant
    expect(truths.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...truths.map(([, k]) => k)) / inBand).toBeLessThan(0.7)
  })

  test('phone mode shows the first in-band seed\'s sweep', () => {
    let first = 0
    while (!knee.band(sweepOf(knee, first))) first++
    expect(KNEE_CANONICAL_SEED).toBe(first)
    expect(knee.phone.canonical).toEqual(knee.sweep(first))
    expect(knee.phone.canonical).toBe(knee.phone.canonical)
    expect(knee.band(knee.phone.canonical)).toBe(true)
  })
})

describe('the P:D split', () => {
  test('the workload is drawn from the seed, within the stated grid', () => {
    const prompts = new Set<number>()
    const outputs = new Set<number>()
    for (let seed = 0; seed < 200; seed++) {
      const w = pdWorkload(seed)
      expect(w.prompt.max - w.prompt.min).toBe(1023)
      expect(w.output.max - w.output.min).toBe(23)
      expect([1536, 1792, 2048, 2304, 2560]).toContain(w.prompt.min)
      expect([4, 10, 16, 22, 28, 34, 40]).toContain(w.output.min)
      prompts.add(w.prompt.min)
      outputs.add(w.output.min)
    }
    expect(prompts.size).toBe(5)
    expect(outputs.size).toBe(7)
  })

  test('the trace keeps to its workload and its window, and offers about 1.2 times the estimated capacity', () => {
    for (let seed = 0; seed < 20; seed++) {
      const w = pdWorkload(seed)
      const t = pdTrace(seed)
      for (const r of t) {
        expect(r.prompt).toBeGreaterThanOrEqual(w.prompt.min)
        expect(r.prompt).toBeLessThanOrEqual(w.prompt.max)
        expect(r.output).toBeGreaterThanOrEqual(w.output.min)
        expect(r.output).toBeLessThanOrEqual(w.output.max)
        expect(r.arrival).toBeLessThan(PD_WINDOW_TICKS)
      }
      expect(t.every((r, i) => i === 0 || r.arrival >= (t[i - 1] as { arrival: number }).arrival)).toBe(true)
    }
  })

  test('too few prefill workers starve TTFT in the prefill queue, too few decode workers stall the transfers', () => {
    let n = 0
    for (let seed = 0; seed < 30; seed++) {
      const r = sweepOf(pd, seed)
      if (!pd.band(r)) continue
      n++
      const best = r.points[r.points.findIndex((p) => p.x === pd.truth(r))] as SweepResult['points'][number]
      const first = r.points[0] as SweepResult['points'][number]
      const last = r.points[r.points.length - 1] as SweepResult['points'][number]
      expect(first.ttftP95).toBeGreaterThan(best.ttftP95)
      expect(first.goodputRps).toBeLessThan(best.goodputRps)
      expect(last.metrics?.['transferDelay'] as number).toBeGreaterThan(best.metrics?.['transferDelay'] as number)
      expect(last.goodputRps).toBeLessThan(best.goodputRps)
    }
    expect(n).toBeGreaterThan(20)
  })

  test('Little\'s-law estimate names the sweep\'s best split on most banded seeds and is within one on all (printed)', () => {
    let n = 0
    let exact = 0
    let near = 0
    for (let seed = 0; seed < 80; seed++) {
      const r = sweepOf(pd, seed)
      if (!pd.band(r)) continue
      n++
      const gap = Math.abs(pdEstimateSplit(pdWorkload(seed)) - pd.truth(r))
      if (gap === 0) exact++
      if (gap <= 1) near++
    }
    console.log(`P:D split: the Little's-law split is the sweep's best on ${exact} of ${n} banded seeds in 0–79, within one on ${near}`)
    expect(near).toBe(n)
    expect(exact / n).toBeGreaterThan(0.85)
  }, 60_000)

  test('truth is the prefill-worker count of the highest goodput; the lower count wins a tie', () => {
    expect(pdTruth(result(pd, [2, 5, 8, 9, 6, 3, 1]))).toBe(4)
    expect(pdTruth(result(pd, [2, 5, 9, 9, 6, 3, 1]))).toBe(3)
    expect(pd.truth(result(pd, [9, 5, 4, 3, 2, 1, 0]))).toBe(1)
  })

  test('band: interior (2 … 6), 10 % above both ends, 5 % above every other split', () => {
    expect(pdBand(result(pd, [2, 5, 8, 9, 6, 3, 1]))).toBe(true)
    expect(pdBand(result(pd, [9, 5, 8, 7, 6, 3, 1]))).toBe(false)
    expect(pdBand(result(pd, [2, 5, 8, 7, 6, 3, 9]))).toBe(false)
    expect(pdBand(result(pd, [8.3, 5, 8, 9, 6, 3, 1]))).toBe(false)
    expect(pdBand(result(pd, [8.1, 5, 8, 9, 6, 3, 1]))).toBe(true)
    expect(pdBand(result(pd, [2, 5, 8.7, 9, 6, 3, 1]))).toBe(false)
    expect(pdBand(result(pd, [2, 5, 8.5, 9, 6, 3, 1]))).toBe(true)
  })

  test('pass: exactly the count with the highest goodput', () => {
    const r = result(pd, [2, 5, 8, 9, 6, 3, 1])
    expect(pdPass(4, r)).toBe(true)
    expect(pd.pass(4, r)).toBe(true)
    for (const wrong of [1, 2, 3, 5, 6, 7, 4.5, NaN]) expect(pdPass(wrong, r)).toBe(false)
  })

  test('a point is the EpdCluster run by hand with equal workers', () => {
    expect(PD_ENGINE.numBlocks * PD_ENGINE.blockSize).toBe(16384)
    const p = pdPoint(1, 4)
    expect(p.x).toBe(4)
    expect(p.goodputRps).toBe((p.metrics?.['sloMet'] as number) / (PD_WINDOW_TICKS * SIM_TICK_SECONDS))
    expect(p.metrics?.['requests']).toBe(pdTrace(1).length)
  })

  test('the band accepts at least 20 % of candidate seeds (printed), and the answers vary', () => {
    const n = 80
    const { inBand, truths } = survey(pd, n)
    console.log(`P:D split band acceptance: ${pct(inBand, n)} of seeds 0–${n - 1}; right answers (prefill workers: count) ${truths.map(([x, k]) => `${x}: ${k}`).join(', ')}`)
    expect(inBand / n).toBeGreaterThanOrEqual(0.2)
    expect(truths.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...truths.map(([, k]) => k)) / inBand).toBeLessThan(0.7)
  }, 60_000)

  test('phone mode shows the first in-band seed\'s sweep', () => {
    let first = 0
    while (!pd.band(sweepOf(pd, first))) first++
    expect(PD_CANONICAL_SEED).toBe(first)
    expect(pd.phone.canonical).toEqual(pd.sweep(first))
    expect(pd.phone.canonical).toBe(pd.phone.canonical)
    expect(pd.band(pd.phone.canonical)).toBe(true)
  })
})

describe('the job budget', () => {
  test('a sweep takes under a fifth of the 10 s job budget (seeds 0 … 19, worst printed)', () => {
    let worst = 0
    for (const def of [knee, pd]) {
      for (let seed = 0; seed < 20; seed++) {
        const t0 = performance.now()
        def.sweep(seed)
        worst = Math.max(worst, performance.now() - t0)
      }
    }
    console.log(`slowest sweep over seeds 0–19 of both exercises: ${worst.toFixed(0)} ms (job budget ${FLEET_JOB_BUDGET_MS} ms)`)
    expect(worst).toBeLessThan(FLEET_JOB_BUDGET_MS / 5)
  })

  test('the pd-split sweep finishes every point (the drain limit is never the stop)', () => {
    for (let seed = 0; seed < 10; seed++) {
      for (const p of pd.sweep(seed).points) expect((p.metrics?.['completed'] as number) + (p.metrics?.['shed'] as number)).toBe(p.metrics?.['requests'] as number)
    }
    for (const x of PD_POINTS) expect(pdPoint(2, x).x).toBe(x)
  })
})
