/**
 * Act IV's incidents must agree with their own simulation (spec §19.1, task 2a-09).
 *
 * The Wave 1a review found intake-stall's briefing ("scheduler waiting list near zero, workers half-empty")
 * contradicted by its telemetry (waiting list 45-59, free blocks 2-11 of 256), and the keyed fix raised queue
 * p95. A learner who read the telemetry correctly was marked wrong. Each test below runs one incident's scenario
 * on 32 graded seeds (`drawGradedSeeds`) and asserts every observable claim its briefing makes, then runs the
 * counterfactual each keyed option and each distractor's why describes. A claim that fails names its seed.
 *
 * Thresholds are stated next to each assertion. They sit outside the range seen on these 32 seeds, so a change
 * to the scenario or to the engine that breaks a claim fails here, while a harmless tick of noise does not.
 *
 * Briefing wording that is narrative rather than telemetry ("nothing was deployed today", "the traffic got
 * longer-context this week", launch day) makes no claim a test can check; the phrase tests below pin the
 * checkable wording so an edit to a briefing has to come back here.
 *
 * Retired together with `loadIncident` by 2b-17, when incidents become `FaultSpec` v2 worlds.
 */
import { describe, expect, test } from 'bun:test'
import { makeRefScheduler, type TickSample } from '../../src/lib/fleet-model'
import {
  HEALTHY_DRAIN_PER_TICK,
  INCIDENTS,
  INCIDENT_SCENARIOS,
  loadIncident,
  runIncident,
  seedLabel,
  type FleetWeekSeeds,
  type IncidentRun,
} from '../../src/lib/fleet-week'
import { drawGradedSeeds } from '../../src/lib/graded-seed'
import { splitmix32u } from '../../src/lib/rng'

const GRADED_SEEDS = 32
/** Fixed entropy: the same 32 graded scenarios on every run and in every browser. */
const ENTROPY = 0x1a09_5eed
const SLOW = 600_000

const next = splitmix32u(ENTROPY)
const SEEDS: FleetWeekSeeds[] = Array.from({ length: GRADED_SEEDS }, () => drawGradedSeeds(next()).seeds)

const memo = new Map<string, IncidentRun>()
/** One simulation per (incident, seed, counterfactual), shared by every assertion that needs it. */
function run(id: string, i: number, tag = '', change: Parameters<typeof runIncident>[2] = {}): IncidentRun {
  const key = `${id}/${i}/${tag}`
  let r = memo.get(key)
  if (!r) {
    r = runIncident(id, SEEDS[i], change)
    memo.set(key, r)
  }
  return r
}

/** The q-quantile (nearest rank, as the engine's own p95) of a telemetry column. */
function quantile(series: TickSample[], key: keyof TickSample, q: number): number {
  const xs = series.map((s) => s[key]).sort((a, b) => a - b)
  return xs[Math.max(0, Math.ceil(xs.length * q) - 1)]
}

const last = <T>(xs: T[]): T => xs[xs.length - 1]

/** Every seed where `claim` is false, named by its graded seed and the numbers that broke it. */
function breaks(claim: (i: number) => string | null): string[] {
  const out: string[] = []
  for (let i = 0; i < SEEDS.length; i++) {
    const why = claim(i)
    if (why) out.push(`${seedLabel(SEEDS[i].seed)}: ${why}`)
  }
  return out
}

const fmt = (n: number) => Math.round(n * 100) / 100

const incident = (id: string) => {
  const def = INCIDENTS.find((d) => d.id === id)
  if (!def) throw new Error(`no incident ${id}`)
  return def
}

const keyed = (id: string) => ({
  cause: incident(id).causes.filter((o) => o.correct).map((o) => o.id),
  mitigation: incident(id).mitigations.filter((o) => o.correct).map((o) => o.id),
})

describe('graded seeds', () => {
  test('are 32 distinct in-band scenarios', () => {
    expect(SEEDS.length).toBe(32)
    expect(new Set(SEEDS.map((s) => s.seed)).size).toBe(32)
  })
})

describe('intake-stall: a slow drain in front of an idle node', () => {
  const id = 'intake-stall'
  const pool = INCIDENT_SCENARIOS[id].cfg.numBlocks
  const slots = INCIDENT_SCENARIOS[id].cfg.maxRunning

  test('the keys name the drain and fixing it', () => {
    expect(keyed(id)).toEqual({ cause: ['drain'], mitigation: ['fix-drain'] })
    expect(INCIDENT_SCENARIOS[id].drainPerTick).toBeLessThan(HEALTHY_DRAIN_PER_TICK)
  })

  test('briefing: the scheduler waiting list is empty (waiting p95 <= 2)', () => {
    const bad = breaks((i) => {
      const w = quantile(run(id, i).series, 'waiting', 0.95)
      return w <= 2 ? null : `waiting p95 ${w}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('briefing: free blocks are plentiful (free p50 >= 40% of the pool)', () => {
    const bad = breaks((i) => {
      const f = quantile(run(id, i).series, 'freeBlocks', 0.5) / pool
      return f >= 0.4 ? null : `free p50 ${fmt(f * 100)}% of ${pool}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('briefing: workers sit mostly empty (running p50 <= 50% of max_running)', () => {
    const bad = breaks((i) => {
      const r = quantile(run(id, i).series, 'running', 0.5) / slots
      return r <= 0.5 ? null : `running p50 ${fmt(r * 100)}% of ${slots}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('briefing: nothing is preempted and TPOT is normal (0 auto-preempts, TPOT p95 <= 1.1 ticks/token)', () => {
    const bad = breaks((i) => {
      const r = run(id, i)
      if (r.stats.autoPreempts !== 0) return `${r.stats.autoPreempts} auto-preempts`
      return r.tpotP95 <= 1.1 ? null : `tpot p95 ${fmt(r.tpotP95)}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('briefing: shed jumps at every traffic burst (3 stepped samples, 30+ shed) and queue p95 is high (>= 20 ticks)', () => {
    const bad = breaks((i) => {
      const s = run(id, i).series
      const steps = s.filter((x, k) => k > 0 && x.shed > s[k - 1].shed).length
      if (steps !== 3) return `shed stepped in ${steps} samples, not the 3 flash crowds`
      if (last(s).shed < 30) return `final shed ${last(s).shed}`
      return last(s).queueP95 >= 20 ? null : `final queue p95 ${last(s).queueP95}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('key: raising the drain to 8 per tick cuts shed by >= 50% and lowers queue p95 (and goodput rises >= 5 points)', () => {
    const bad = breaks((i) => {
      const a = run(id, i)
      const b = run(id, i, 'drain8', { drainPerTick: HEALTHY_DRAIN_PER_TICK })
      const cut = 1 - b.stats.shed / a.stats.shed
      if (cut < 0.5) return `shed ${a.stats.shed} -> ${b.stats.shed} (cut ${fmt(cut * 100)}%)`
      if (b.queueP95 >= a.queueP95) return `queue p95 ${a.queueP95} -> ${b.queueP95}`
      return b.goodput - a.goodput >= 5 ? null : `goodput ${a.goodput} -> ${b.goodput}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('distractor: doubling the pool changes goodput by <= 1 point and sheds the same', () => {
    const bad = breaks((i) => {
      const a = run(id, i)
      const b = run(id, i, 'pool-x2', { cfg: { numBlocks: pool * 2 } })
      if (Math.abs(b.goodput - a.goodput) > 1) return `goodput ${a.goodput} -> ${b.goodput}`
      return b.stats.shed === a.stats.shed ? null : `shed ${a.stats.shed} -> ${b.stats.shed}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('distractor: a bigger intake queue stops the shedding but queue p95 rises >= 5 ticks and goodput gains no more than the fix (+0.5)', () => {
    const bad = breaks((i) => {
      const a = run(id, i)
      const fixed = run(id, i, 'drain8', { drainPerTick: HEALTHY_DRAIN_PER_TICK })
      const big = run(id, i, 'queue-x2', { intakeCapacity: INCIDENT_SCENARIOS[id].intakeCapacity * 2 })
      if (big.stats.shed >= a.stats.shed) return `shed ${a.stats.shed} -> ${big.stats.shed}`
      if (big.queueP95 < a.queueP95 + 5) return `queue p95 ${a.queueP95} -> ${big.queueP95}`
      return big.goodput <= fixed.goodput + 0.5 ? null : `goodput ${big.goodput} beats the fix's ${fixed.goodput}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('phrases: the briefing still says what is asserted above', () => {
    const b = incident(id).briefing
    for (const phrase of [
      'queue-delay p95 is high',
      'shed count jumps at every traffic burst',
      'workers sit mostly empty',
      'running is low',
      'free blocks are plentiful',
      'waiting list is empty',
      'Nothing is preempted',
      'TPOT is normal',
    ]) {
      expect(b).toContain(phrase)
    }
  })

  test('loadIncident serves the telemetry this test measures', () => {
    const loaded = loadIncident(id, SEEDS[0])
    expect(loaded?.seed).toBe(SEEDS[0].seed)
    expect(loaded?.telemetry).toEqual(run(id, 0).series)
  })
})

describe('kv-thrash: a pool too small for the new contexts', () => {
  const id = 'kv-thrash'
  const pool = INCIDENT_SCENARIOS[id].cfg.numBlocks

  test('the keys name the pool and growing it', () => {
    expect(keyed(id)).toEqual({ cause: ['pool-small'], mitigation: ['bigger-pool'] })
  })

  test('briefing: free blocks hover near zero (free p50 <= 12% of the pool on every seed, <= 5% on the median seed)', () => {
    const fractions = SEEDS.map((_, i) => quantile(run(id, i).series, 'freeBlocks', 0.5) / pool).sort((a, b) => a - b)
    expect(fractions[Math.floor(fractions.length / 2)]).toBeLessThanOrEqual(0.05)
    const bad = breaks((i) => {
      const f = quantile(run(id, i).series, 'freeBlocks', 0.5) / pool
      return f <= 0.12 ? null : `free p50 ${fmt(f * 100)}% of ${pool}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('briefing: auto-preempts are nonzero and rising (>= 100 in all, more at the end than halfway)', () => {
    const bad = breaks((i) => {
      const s = run(id, i).series
      const mid = s[Math.floor(s.length / 2)].autoPreempts
      if (last(s).autoPreempts < 100) return `${last(s).autoPreempts} auto-preempts`
      return last(s).autoPreempts > mid ? null : `auto-preempts flat at ${mid}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('briefing: TTFT p95 climbs (>= 10x the SLO at the end, not lower than halfway) while TPOT stays flat (p95 <= 1.1)', () => {
    const bad = breaks((i) => {
      const r = run(id, i)
      const s = r.series
      const slo = INCIDENT_SCENARIOS[id].cfg.sloTtft
      if (last(s).ttftP95 < 10 * slo) return `final ttft p95 ${last(s).ttftP95}`
      if (last(s).ttftP95 < s[Math.floor(s.length / 2)].ttftP95) return 'ttft p95 fell in the second half'
      return r.tpotP95 <= 1.1 ? null : `tpot p95 ${fmt(r.tpotP95)}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('key: doubling the pool cuts TTFT p95 by >= 40% and lifts goodput >= 5 points; quadrupling cuts auto-preempts by >= 90%', () => {
    const bad = breaks((i) => {
      const a = run(id, i)
      const x2 = run(id, i, 'pool-x2', { cfg: { numBlocks: pool * 2 } })
      const x4 = run(id, i, 'pool-x4', { cfg: { numBlocks: pool * 4 } })
      if (x2.ttftP95 > a.ttftP95 * 0.6) return `ttft p95 ${a.ttftP95} -> ${x2.ttftP95} at x2`
      if (x2.goodput - a.goodput < 5) return `goodput ${a.goodput} -> ${x2.goodput} at x2`
      return x4.stats.autoPreempts <= a.stats.autoPreempts * 0.1 ? null : `auto-preempts ${a.stats.autoPreempts} -> ${x4.stats.autoPreempts} at x4`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('distractors: halving max_running or shrinking the prefill chunk leaves goodput below the doubled pool, and neither reliably cuts preempts', () => {
    const bad = breaks((i) => {
      const x2 = run(id, i, 'pool-x2', { cfg: { numBlocks: pool * 2 } })
      const batch = run(id, i, 'running-8', { cfg: { maxRunning: INCIDENT_SCENARIOS[id].cfg.maxRunning / 2 } })
      const chunk = run(id, i, 'chunk-64', { cfg: { prefillChunk: INCIDENT_SCENARIOS[id].cfg.prefillChunk / 2 } })
      if (batch.goodput >= x2.goodput) return `max_running goodput ${batch.goodput} vs pool x2 ${x2.goodput}`
      if (chunk.goodput >= x2.goodput) return `chunk goodput ${chunk.goodput} vs pool x2 ${x2.goodput}`
      const a = run(id, i)
      return chunk.stats.autoPreempts > a.stats.autoPreempts * 0.1 ? null : `chunking cut auto-preempts to ${chunk.stats.autoPreempts}`
    })
    expect(bad).toEqual([])
    // "not reliably": on at least one seed the smaller batch did not even halve the preempts
    const notCut = SEEDS.filter((_, i) => run(id, i, 'running-8').stats.autoPreempts > run(id, i).stats.autoPreempts * 0.5)
    expect(notCut.length).toBeGreaterThan(0)
  }, SLOW)

  test('phrases: the briefing still says what is asserted above', () => {
    const b = incident(id).briefing
    for (const phrase of ['p95 has been climbing', 'TPOT stays comparatively flat', 'Auto-preempts are nonzero and rising', 'free blocks hover near zero']) {
      expect(b).toContain(phrase)
    }
  })
})

describe('no-admission: a scheduler that admits everything', () => {
  const id = 'no-admission'
  const pool = INCIDENT_SCENARIOS[id].cfg.numBlocks
  const slots = INCIDENT_SCENARIOS[id].cfg.maxRunning
  const gate = { sched: makeRefScheduler() }

  test('the keys name the missing gate and adding one', () => {
    expect(keyed(id)).toEqual({ cause: ['no-admission'], mitigation: ['admission'] })
  })

  test('briefing: more is in flight than the pool holds (>= 10,000 failed allocations, >= 300 auto-preempts) and the batch stays full (running p95 >= 85% of max_running)', () => {
    const bad = breaks((i) => {
      const r = run(id, i)
      if (r.stats.capacityMisses < 10_000) return `${r.stats.capacityMisses} failed allocations`
      if (r.stats.autoPreempts < 300) return `${r.stats.autoPreempts} auto-preempts`
      const full = quantile(r.series, 'running', 0.95) / slots
      return full >= 0.85 ? null : `running p95 ${fmt(full * 100)}% of ${slots}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('briefing: goodput collapses (<= 25%, >= 15 points under the gated engine) and TTFT p95 explodes (>= 1.5x the gated engine)', () => {
    const bad = breaks((i) => {
      const a = run(id, i)
      const g = run(id, i, 'gated', gate)
      if (a.goodput > 25) return `goodput ${a.goodput}`
      if (g.goodput - a.goodput < 15) return `goodput ${a.goodput} vs gated ${g.goodput}`
      return a.ttftP95 >= g.ttftP95 * 1.5 ? null : `ttft p95 ${a.ttftP95} vs gated ${g.ttftP95}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('briefing: completions crawl (the run takes >= 1.3x as long as the gated one) while TPOT is stable (p95 <= 1.1)', () => {
    const bad = breaks((i) => {
      const a = run(id, i)
      const g = run(id, i, 'gated', gate)
      if (a.ticks < g.ticks * 1.3) return `${a.ticks} ticks vs gated ${g.ticks}`
      return a.tpotP95 <= 1.1 ? null : `tpot p95 ${fmt(a.tpotP95)}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('key: a headroom-aware gate never overcommits (0 failed allocations, <= 2 auto-preempts) and TTFT p95 falls', () => {
    const bad = breaks((i) => {
      const a = run(id, i)
      const g = run(id, i, 'gated', gate)
      if (g.stats.capacityMisses !== 0) return `${g.stats.capacityMisses} failed allocations`
      if (g.stats.autoPreempts > 2) return `${g.stats.autoPreempts} auto-preempts`
      return g.ttftP95 < a.ttftP95 ? null : `ttft p95 ${a.ttftP95} -> ${g.ttftP95}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('distractors: admit-everything on a pool twice and four times the size earns <= 0.5 points more goodput than the gate (and trails it by >= 5 on the median seed)', () => {
    const gaps: number[] = []
    const bad = breaks((i) => {
      const g = run(id, i, 'gated', gate)
      const x2 = run(id, i, 'pool-x2', { cfg: { numBlocks: pool * 2 } })
      const x4 = run(id, i, 'pool-x4', { cfg: { numBlocks: pool * 4 } })
      gaps.push(g.goodput - x2.goodput)
      if (x2.goodput > g.goodput + 0.5) return `pool x2 goodput ${x2.goodput} beats the gate's ${g.goodput}`
      return x4.goodput <= g.goodput + 0.5 ? null : `pool x4 goodput ${x4.goodput} beats the gate's ${g.goodput}`
    })
    expect(bad).toEqual([])
    gaps.sort((a, b) => a - b)
    expect(gaps[Math.floor(gaps.length / 2)]).toBeGreaterThanOrEqual(5)
  }, SLOW)

  test('phrases: the briefing still says what is asserted above', () => {
    const b = incident(id).briefing
    for (const phrase of [
      'more requests are in flight than the pool can hold',
      'Goodput collapses',
      'TTFT p95 explodes',
      'TPOT for requests that already started is comparatively stable',
      'batch stays full',
      'completions crawl',
    ]) {
      expect(b.toLowerCase()).toContain(phrase.toLowerCase())
    }
  })
})
