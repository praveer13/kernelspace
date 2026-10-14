/**
 * The bestiary: twelve policies from the Compose dials, run on lab 06's race seed (docs/specs/wave-3.md §8.3, task 3b-09).
 *
 * The 30 entropies are 1 to 30, each drawn through `drawGradedSeeds`, so every one is a banded Act I seed (the reference
 * baselines land in the difficulty band). They are the first thirty, not a selection: the figures in the comments were
 * measured on them, and tests/world/bestiary.test.ts is the place to re-measure.
 *
 * "Pairwise distinct" is measured per pair: every pair of the twelve differs in goodput on at least 80 % of the entropies.
 * That is the bar the spec's 86.7 % is a rate of. Asking all twelve to differ on the same seed is a different, much
 * stricter statement (it held on 11 of these 30): goodput is a multiple of 1/240 and four low-goodput policies sit within
 * a point or two of each other, so two of them coincide on some seed now and then.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Engine, makeRefManager, makeRefQueue, referenceScheduler, type SchedAction, type SchedView } from '../../src/lib/fleet-model'
import { referenceGoodput, schedulerGoodput, traceFor, type FleetWeekSeeds } from '../../src/lib/fleet-week'
import { SEED_BAND, drawGradedSeeds } from '../../src/lib/graded-seed'
import { BESTIARY, allDistinct, placement, runBestiary, specLabel, worstPair, type BestiaryResult } from '../../src/lib/world/bestiary'
import { REFERENCE_SCHED_SPEC, SCHED_DIALS, compileSchedPolicy, schedSpecProblems } from '../../src/lib/world/sched-policy'
import type { SchedPolicySpec } from '../../src/lib/world/types'

const SLOW = 180_000
const ENTROPIES = Array.from({ length: 30 }, (_, i) => i + 1)

const graded: FleetWeekSeeds[] = ENTROPIES.map((e) => drawGradedSeeds(e).seeds)
const runs: BestiaryResult[] = graded.map((s) => runBestiary(s))

describe('the twelve policies', () => {
  test('b1 to b12, each a valid setting of the four dials, no two the same spec', () => {
    expect(BESTIARY.map((p) => p.id)).toEqual(Array.from({ length: 12 }, (_, i) => `b${i + 1}`))
    for (const p of BESTIARY) expect(schedSpecProblems(p.spec)).toEqual([])
    expect(new Set(BESTIARY.map((p) => JSON.stringify(p.spec))).size).toBe(12)
    expect(new Set(BESTIARY.map((p) => p.name)).size).toBe(12)
  })

  test('the first is the reference, and it IS the reference: its goodput is the race’s refGoodput on every entropy', () => {
    expect(BESTIARY[0].name).toBe('the reference')
    expect(BESTIARY[0].spec).toEqual(REFERENCE_SCHED_SPEC)
    graded.forEach((seeds, i) => {
      expect(runs[i].rows[0].goodput).toBe(referenceGoodput(seeds))
      expect(runs[i].refGoodput).toBe(referenceGoodput(seeds))
      expect(runs[i].seed).toBe(seeds.seed)
    })
  }, SLOW)

  test('the entropies are banded: the reference lands in the difficulty band on all 30', () => {
    for (const r of runs) {
      expect(r.refGoodput).toBeGreaterThanOrEqual(SEED_BAND.refGoodput.min)
      expect(r.refGoodput).toBeLessThan(SEED_BAND.refGoodput.max)
    }
  })

  test('the spec’s table: FCFS is far behind the size-aware policies, and the reference is among the best', () => {
    const mean = (id: string) => runs.reduce((a, r) => a + r.rows.find((x) => x.id === id)!.goodput, 0) / runs.length
    // the means of §8.3 were measured on 2b's 30 entropies (44.6, 18.8, 12.0, 14.1, 21.2, 20.1, 13.9, 41.8, 44.8, 46.9, 37.5, 13.5);
    // these are this module's on entropies 1 to 30. They agree within a point and a half, which is the same table.
    const spec = [44.6, 18.8, 12.0, 14.1, 21.2, 20.1, 13.9, 41.8, 44.8, 46.9, 37.5, 13.5]
    BESTIARY.forEach((p, i) => expect(Math.abs(mean(p.id) - spec[i])).toBeLessThan(1.5))
    for (const id of ['b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b12']) expect(mean(id)).toBeLessThan(mean('b1') - 20)
  })

  test('the twelve are twelve different behaviours: no two have the same goodput on all 30 entropies', () => {
    const vectors = BESTIARY.map((_, j) => runs.map((r) => r.rows[j].goodput).join(','))
    expect(new Set(vectors).size).toBe(12)
  })
})

describe('pairwise distinct', () => {
  test('every pair of policies differs on at least 80 % of the 30 banded entropies (90 % measured here, 86.7 % on 2b)', () => {
    const worst = worstPair(runs.map((r) => r.rows))
    expect(worst.rate).toBeGreaterThanOrEqual(0.8)
    expect(worst.rate).toBeCloseTo(0.9, 5)
    expect(worst.a).not.toBe(worst.b)
  })

  test('worstPair finds the pair that coincides most often', () => {
    const rows = (a: number, b: number, c: number) => [
      { id: 'x', goodput: a },
      { id: 'y', goodput: b },
      { id: 'z', goodput: c },
    ]
    const w = worstPair([rows(1, 1, 3), rows(1, 1, 4), rows(1, 2, 5), rows(2, 2, 2)])
    expect(w).toEqual({ a: 'x', b: 'y', rate: 0.25 })
    expect(worstPair([])).toEqual({ a: '', b: '', rate: 1 })
  })

  test('all twelve differing on one seed is far stricter, and is not what the bar says', () => {
    const all = runs.filter((r) => allDistinct(r.rows)).length
    expect(all).toBeGreaterThan(0)
    expect(all).toBeLessThan(runs.length)
  })
})

describe('guard 2000 never fires within Act I', () => {
  /** Runs `a` on Act I's engine while `b` is shown every view too; counts the iterations where they disagree. */
  function lockstep(seeds: FleetWeekSeeds, a: SchedPolicySpec, b: SchedPolicySpec) {
    const da = compileSchedPolicy(a)
    const db = compileSchedPolicy(b)
    let differ = 0
    let maxWait = 0
    const same = (x: SchedAction, y: SchedAction) => JSON.stringify(x) === JSON.stringify(y)
    const driver = {
      name: 'lockstep',
      schedule(v: SchedView): SchedAction {
        const act = da.schedule(v)
        if (!same(act, db.schedule(v))) differ++
        for (const w of v.waiting) maxWait = Math.max(maxWait, v.iter - w.arrival)
        return act
      },
    }
    const goodput = schedulerGoodput(seeds, driver)
    return { differ, maxWait, goodput }
  }

  test('guard 2000 and guard 0 return the same action at every iteration of every Act I run, for all 16 other dial settings', () => {
    // the longest any request waits, per setting: the guard needs `iter - arrival > 2000` to fire at all
    const longest = new Map<string, number>()
    for (const order of SCHED_DIALS.order) {
      for (const headroom of SCHED_DIALS.headroom) {
        for (const preempt of SCHED_DIALS.preempt) {
          let maxWait = 0
          for (const seeds of graded) {
            const r = lockstep(seeds, { order, guard: 2000, headroom, preempt }, { order, guard: 0, headroom, preempt })
            expect(r.differ).toBe(0)
            maxWait = Math.max(maxWait, r.maxWait)
          }
          longest.set(`${order}/${headroom}/${preempt}`, maxWait)
        }
      }
    }
    // For 14 of the 16 settings no request waits 2,000 iterations on any of the 30 runs (the longest is 1,820), so the guard
    // cannot fire. The two greedy settings that never preempt (headroom 0) do leave a request waiting past 2,000 (2,220 and
    // 2,286) on some seed, and even there the aged request moves to the front of a list whose actions are the same.
    const past = [...longest].filter(([, w]) => w > 2000).map(([k]) => k).sort()
    expect(past).toEqual(['fcfs/0/none', 'sjf/0/none'])
    expect(Math.max(...[...longest].filter(([k]) => !past.includes(k)).map(([, w]) => w))).toBeLessThan(2000)
    // and the reference's own setting is among the 14
    expect(longest.get('sjf/48/none')).toBeLessThan(2000)
  }, SLOW)

  test('so the reference (guard 2000) and the same policy at guard 0 have the same goodput, and so do the bestiary’s own pairs', () => {
    const zero: SchedPolicySpec = { ...REFERENCE_SCHED_SPEC, guard: 0 }
    graded.forEach((seeds, i) => expect(schedulerGoodput(seeds, compileSchedPolicy(zero))).toBe(runs[i].rows[0].goodput))
    // guard 2000 is the reference's own: the bestiary’s FCFS rows are the guard-0 ones the spec table lists
    expect(BESTIARY.filter((p) => p.spec.guard === 2000).map((p) => p.id)).toEqual(['b1'])
  }, SLOW)

  test('the reference scheduler itself ignores its guard on these runs: referenceScheduler matches the guard-0 policy at every iteration', () => {
    const zero = compileSchedPolicy({ ...REFERENCE_SCHED_SPEC, guard: 0 })
    let differ = 0
    const driver = {
      name: 'lockstep',
      schedule(v: SchedView): SchedAction {
        const ref = referenceScheduler(v)
        if (JSON.stringify(zero.schedule(v)) !== JSON.stringify(ref)) differ++
        return ref
      },
    }
    for (const seeds of graded.slice(0, 10)) schedulerGoodput(seeds, driver)
    expect(differ).toBe(0)
  }, SLOW)
})

describe('the engine the policies run on is Act I’s', () => {
  test('schedulerGoodput with the reference is referenceGoodput, and the trace is the 240-request Act I trace', () => {
    for (const seeds of graded.slice(0, 5)) {
      expect(schedulerGoodput(seeds, { name: 'reference', schedule: referenceScheduler })).toBe(referenceGoodput(seeds))
      expect(traceFor(seeds)).toHaveLength(240)
    }
  })

  test('Act I’s own engine, built by hand, gives the same goodput for the reference policy', () => {
    const seeds = graded[0]
    const cfg = { numBlocks: 256, blockSize: 16, maxRunning: 16, sloTtft: 40, prefillChunk: 128 }
    const e = new Engine(cfg, traceFor(seeds), compileSchedPolicy(REFERENCE_SCHED_SPEC), makeRefManager(256, 16), { intake: makeRefQueue(32), drainPerTick: 8 })
    let guard = 0
    while (!e.done && guard++ < 20000) e.step()
    expect(e.goodput(240)).toBe(runs[0].rows[0].goodput)
  })

  test('runBestiary reports progress after each of the twelve, ending at 1', () => {
    const seen: number[] = []
    runBestiary(graded[0], (f) => seen.push(f))
    expect(seen).toHaveLength(12)
    expect(seen.at(-1)).toBe(1)
    expect(seen.every((x, i) => i === 0 || x > seen[i - 1])).toBe(true)
  })

  test('runs are deterministic: the same seeds give the same twelve numbers', () => {
    expect(runBestiary(graded[3]).rows.map((r) => r.goodput)).toEqual(runs[3].rows.map((r) => r.goodput))
  })
})

describe('placement and labels', () => {
  const rows = [{ goodput: 10 }, { goodput: 20 }, { goodput: 20 }, { goodput: 30 }]
  test('placement counts the policies below, level with and above a goodput', () => {
    expect(placement(5, rows)).toEqual({ below: 0, tied: 0, above: 4 })
    expect(placement(20, rows)).toEqual({ below: 1, tied: 2, above: 1 })
    expect(placement(31, rows)).toEqual({ below: 4, tied: 0, above: 0 })
  })

  test('a spec reads as its dials', () => {
    expect(specLabel(REFERENCE_SCHED_SPEC)).toBe('sjf · guard 2000 · headroom 48 · no preempt')
    expect(specLabel({ order: 'fcfs', guard: 0, headroom: 0, preempt: 'newest' })).toBe('fcfs · guard 0 · headroom 0 · preempt newest')
  })

  test('the module says what the twelve are, and what they are not', () => {
    const text = readFileSync(new URL('../../src/lib/world/bestiary.ts', import.meta.url), 'utf8')
    expect(text).toContain('twelve policies from the Compose dials')
    expect(text).toContain('never "production schedulers"')
  })
})
