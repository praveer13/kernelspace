/**
 * The bestiary (docs/specs/wave-3.md §8.3, W1's Code stage): twelve named scheduler policies from the Compose dials
 * (`SchedPolicySpec`, `compileSchedPolicy`), each run on the engine and graded seed of lab 06's race, so the learner's
 * goodput can be placed among them. They are "twelve policies from the Compose dials", never "production schedulers".
 *
 * WHY TWELVE AND NOT FORTY-EIGHT. The dials give 2 × 3 × 4 × 2 = 48 settings, and on Act I's runs (a 256 × 16 pool, 16
 * running, a 32-entry intake draining 8 a tick, 240 requests) most of them are the same policy:
 *   - The guard dial's 2,000 changes nothing: guard 2000 and guard 0 return the same action at every iteration of every
 *     one of those runs (tests/world/bestiary.test.ts), because a request has to wait more than 2,000 iterations for the
 *     guard to fire and none of the 14 settings that preempt or keep headroom waits that long (the longest wait is 1,820).
 *     The two greedy settings that never preempt do leave a request waiting past 2,000 on some seed, and moving it to the
 *     front still changes no action. Under FCFS the guard is a no-op by construction as well: the aged requests are a
 *     prefix of arrival order, so putting them first changes nothing.
 *   - Preempting the newest never changed an outcome at headroom 48 or 128.
 * Counting settings that give the same goodput on every one of the test's 30 entropies as one, the 48 fall into 18
 * behaviours (19 were counted on 2b's entropies); the table keeps twelve of them, so the policies differ from each other
 * on most graded seeds. The goodput of two different policies still coincides now and then, because 240 requests make
 * goodput a multiple of 1/240 and the low-goodput policies sit within a few points of each other; the test therefore
 * asks that EACH PAIR differ on at least 80 % of the entropies, not that all twelve differ on every seed.
 */

import { schedulerGoodput, type FleetWeekSeeds } from '@/lib/fleet-week'
import { compileSchedPolicy } from './sched-policy'
import type { SchedPolicySpec } from './types'

export interface BestiaryPolicy {
  /** Stable id, `b1` to `b12` in the §8.3 table's order. */
  id: string
  name: string
  spec: SchedPolicySpec
}

const policy = (n: number, name: string, order: SchedPolicySpec['order'], guard: SchedPolicySpec['guard'], headroom: SchedPolicySpec['headroom'], preempt: SchedPolicySpec['preempt']): BestiaryPolicy => ({
  id: `b${n}`,
  name,
  spec: { order, guard, headroom, preempt },
})

/** The twelve policies, in the spec's table order; the first is the reference. */
export const BESTIARY: readonly BestiaryPolicy[] = [
  policy(1, 'the reference', 'sjf', 2000, 48, 'none'),
  policy(2, 'FCFS', 'fcfs', 0, 48, 'none'),
  policy(3, 'FCFS, greedy', 'fcfs', 0, 0, 'none'),
  policy(4, 'FCFS, greedy, preempting', 'fcfs', 0, 0, 'newest'),
  policy(5, 'FCFS, tight headroom', 'fcfs', 0, 16, 'none'),
  policy(6, 'FCFS, tight headroom, preempting', 'fcfs', 0, 16, 'newest'),
  policy(7, 'FCFS, wide headroom', 'fcfs', 0, 128, 'none'),
  policy(8, 'SJF, greedy', 'sjf', 0, 0, 'none'),
  policy(9, 'SJF, greedy, preempting', 'sjf', 0, 0, 'newest'),
  policy(10, 'SJF, tight headroom', 'sjf', 0, 16, 'none'),
  policy(11, 'SJF, wide headroom', 'sjf', 0, 128, 'none'),
  policy(12, 'SJF, short guard, greedy', 'sjf', 20, 0, 'none'),
]

/** One policy's run on a graded seed. */
export interface BestiaryRow extends BestiaryPolicy {
  /** SLO-met share of Act I's 240 requests, in percent to one decimal (as `Engine.goodput`). */
  goodput: number
}

/** The sim worker's `bestiary` result (`SimResults.bestiary`). */
export interface BestiaryResult {
  /** The graded seed the twelve ran on (null only for the fixed practice scenario). */
  seed: number | null
  /** The reference's goodput on that seed: row `b1`'s, which is the number the race compares against. */
  refGoodput: number
  rows: BestiaryRow[]
}

/** Runs the twelve on a seed's Act I trace; `onProgress` gets 0..1 after each. */
export function runBestiary(seeds: FleetWeekSeeds, onProgress?: (fraction: number) => void): BestiaryResult {
  const rows = BESTIARY.map((p, i): BestiaryRow => {
    const goodput = schedulerGoodput(seeds, compileSchedPolicy(p.spec))
    onProgress?.((i + 1) / BESTIARY.length)
    return { ...p, goodput }
  })
  return { seed: seeds.seed, refGoodput: rows[0].goodput, rows }
}

/** Where a goodput falls among the rows: how many are strictly below it, equal to it and strictly above. */
export function placement(goodput: number, rows: readonly Pick<BestiaryRow, 'goodput'>[]): { below: number; tied: number; above: number } {
  let below = 0
  let tied = 0
  for (const r of rows) {
    if (r.goodput < goodput) below++
    else if (r.goodput === goodput) tied++
  }
  return { below, tied, above: rows.length - below - tied }
}

/** How many of the goodputs are pairwise different from every other (`new Set` of one-decimal percentages). */
export const allDistinct = (rows: readonly Pick<BestiaryRow, 'goodput'>[]): boolean => new Set(rows.map((r) => r.goodput)).size === rows.length

/** The spec as the table writes it: `sjf · guard 2000 · headroom 48 · no preempt`. */
export function specLabel(spec: SchedPolicySpec): string {
  return `${spec.order} · guard ${spec.guard} · headroom ${spec.headroom} · ${spec.preempt === 'none' ? 'no preempt' : 'preempt newest'}`
}

/**
 * Across runs on different entropies, the pair of policies whose goodputs differ least often, and the share of runs on
 * which they differ: the test's "pairwise distinct" measure (every pair differs on at least 80 % of entropies).
 */
export function worstPair(runs: readonly (readonly Pick<BestiaryRow, 'id' | 'goodput'>[])[]): { a: string; b: string; rate: number } {
  let worst = { a: '', b: '', rate: 1 }
  const first = runs[0] ?? []
  for (let i = 0; i < first.length; i++) {
    for (let j = i + 1; j < first.length; j++) {
      const differ = runs.filter((r) => r[i].goodput !== r[j].goodput).length
      const rate = differ / runs.length
      if (rate < worst.rate) worst = { a: first[i].id, b: first[j].id, rate }
    }
  }
  return worst
}
