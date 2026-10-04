/**
 * graded-seed — Fleet Week's seed hygiene (PLAN-100X §5.2 S3).
 *
 * A graded run draws a fresh seed at grade time (freshSeed in rng.ts), derives
 * its trace, flash-crowd stream and node death from it with splitmix32, and keeps
 * it only if the reference baselines on THAT seed land in the difficulty band
 * below. Because the baselines are re-simulated on the same seed, a pass bar
 * measures the learner against a machine that saw the same traffic.
 *
 * The practice views keep PRACTICE_SEED (fleet-model.ts) and the frozen makeRng.
 * Leaderboard seeds from an Actions secret are out of scope: the leaderboard has
 * 0 entries today, so there is nothing to protect yet.
 *
 * THE BAND, and how it was calibrated
 * -----------------------------------
 * Today's scenario (seed 0x5eed, worker 0 dying at t400) measures, on the
 * reference stack:
 *   - Act I reference goodput           46.3 %   (also Act III's 8x H100 option)
 *   - Act III 4x B200 goodput           74.6 %
 *   - Act II, 4 workers, JSQ            96.9 % completed, 59.8 % goodput  (passes 92/40)
 *   - Act II, 2 workers, JSQ            89.3 % completed, 39.5 % goodput  (misses 92/40)
 * Those four numbers are the lessons: the H100 misses the 50 % SLO, the B200
 * clears it, redundancy is what saves Act II, and two workers fall just short.
 * A seed is in band iff every lesson still holds with margin (see SEED_BAND).
 * The thresholds were set around those numbers from the spread of 1,500
 * unbanded splitmix32 draws (deaths uniform on t300..t500): Act I reference
 * goodput spans 35..54 (median 43.8), 4-worker completion 88..100 (median 97.9),
 * 2-worker completion 81..91 (median 87.6), B200 57..80 (median 70). Death
 * ticks after t450 collide with the t450 burst and are where most rejections
 * come from. About 78 % of draws are accepted (79 % of the 1,500, 78.0 % of the 10,000
 * `bun run verify:seeds` scan), so a draw costs about 1.3 candidates.
 * That script re-checks the band, and the degenerate-seed rules, on
 * 10,000 draws.
 */

import {
  ACT2_BAR,
  referenceFleet,
  referenceGoodput,
  type FleetBaseline,
  type FleetWeekSeeds,
} from '@/lib/fleet-week'
import { splitmix32u } from '@/lib/rng'

/** The node death lands somewhere in this window (today's fixed t400 is the middle). */
export const DEATH_TICKS = { min: 300, max: 500 }

/** Reference-baseline outcomes a graded seed must produce (all percentages are of the run's requests). */
export const SEED_BAND = {
  /** Act I reference goodput; stays under 50 so the H100 option keeps missing Act III's SLO, as authored. */
  refGoodput: { min: 40, max: 50 },
  /** Act III's B200 must clear the 50 % SLO with room to spare. */
  b200Goodput: { min: 55 },
  /** Act II with enough redundancy: passes the bar with margin. */
  fleet4: { completedPct: 94, goodput: 50 },
  /** Act II one node short: a near miss, so redundancy is the lesson and the bar is not hopeless. */
  fleet2: { completedPct: 80, goodput: 25 },
}

const B200_CFG = { numBlocks: 512, blockSize: 16, maxRunning: 32, sloTtft: 40, prefillChunk: 256 }

export interface BandOutcome {
  refGoodput: number
  b200Goodput: number
  fleet4: FleetBaseline
  fleet2: FleetBaseline
}

/** Everything a graded run needs, derived from `seed`: same seed, same scenario, in every browser. */
export function deriveSeeds(seed: number): FleetWeekSeeds {
  const next = splitmix32u(seed)
  return {
    seed: seed >>> 0,
    trace: next(),
    faults: next(),
    deathPick: next(),
    deathTick: DEATH_TICKS.min + (next() % (DEATH_TICKS.max - DEATH_TICKS.min + 1)),
  }
}

const refViolations = (g: number) =>
  g >= SEED_BAND.refGoodput.min && g < SEED_BAND.refGoodput.max
    ? []
    : [`reference goodput ${g} outside [${SEED_BAND.refGoodput.min}, ${SEED_BAND.refGoodput.max})`]

const b200Violations = (g: number) =>
  g >= SEED_BAND.b200Goodput.min ? [] : [`B200 goodput ${g} under ${SEED_BAND.b200Goodput.min}`]

const fleet4Violations = (f: FleetBaseline) =>
  f.completedPct >= SEED_BAND.fleet4.completedPct && f.goodput >= SEED_BAND.fleet4.goodput
    ? []
    : [`4-worker fleet ${f.completedPct}% completed / ${f.goodput}% goodput under its margin`]

const fleet2Violations = (f: FleetBaseline) => {
  const missesBar = f.completedPct < ACT2_BAR.completedPct || f.goodput < ACT2_BAR.goodput
  const hopeless = f.completedPct < SEED_BAND.fleet2.completedPct || f.goodput < SEED_BAND.fleet2.goodput
  return missesBar && !hopeless
    ? []
    : [`2-worker fleet ${f.completedPct}% completed / ${f.goodput}% goodput is ${missesBar ? 'hopeless' : 'passing'}`]
}

/** Every band rule an outcome breaks (empty = in band). */
export function bandViolations(o: BandOutcome): string[] {
  return [
    ...refViolations(o.refGoodput),
    ...b200Violations(o.b200Goodput),
    ...fleet4Violations(o.fleet4),
    ...fleet2Violations(o.fleet2),
  ]
}

/**
 * Simulate the reference baselines on this seed, cheapest rule first, and stop at the
 * first violation: `outcome` is null when rejected early, whole when in band.
 */
export function checkBand(seeds: FleetWeekSeeds): { violations: string[]; outcome: BandOutcome | null } {
  const refG = referenceGoodput(seeds)
  let violations = refViolations(refG)
  if (violations.length) return { violations, outcome: null }
  const b200Goodput = referenceGoodput(seeds, B200_CFG)
  violations = b200Violations(b200Goodput)
  if (violations.length) return { violations, outcome: null }
  const fleet4 = referenceFleet(seeds, 4)
  violations = fleet4Violations(fleet4)
  if (violations.length) return { violations, outcome: null }
  const fleet2 = referenceFleet(seeds, 2)
  violations = fleet2Violations(fleet2)
  if (violations.length) return { violations, outcome: null }
  return { violations: [], outcome: { refGoodput: refG, b200Goodput, fleet4, fleet2 } }
}

/** Give up after this many rejected candidates (at 79 % acceptance, even 8 in a row is a 1-in-300,000 event). */
export const MAX_DRAWS = 256

export interface GradedDraw {
  seeds: FleetWeekSeeds
  outcome: BandOutcome
  /** candidates simulated, rejected ones included */
  draws: number
}

/**
 * Turn fresh entropy into an in-band graded seed. The first candidate is the entropy
 * itself; each rejection moves to the next splitmix32 output of it, so one entropy
 * value always lands on the same accepted seed.
 */
export function drawGradedSeeds(entropy: number): GradedDraw {
  const more = splitmix32u(entropy)
  let candidate = entropy >>> 0
  for (let draws = 1; draws <= MAX_DRAWS; draws++) {
    const seeds = deriveSeeds(candidate)
    const { outcome } = checkBand(seeds)
    if (outcome) return { seeds, outcome, draws }
    candidate = more()
  }
  throw new Error(`no in-band graded seed in ${MAX_DRAWS} draws: the difficulty band no longer matches the scenario`)
}
