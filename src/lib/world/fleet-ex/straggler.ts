/**
 * The rollout straggler (docs/specs/wave-3.md §16.3; t6.l7, `t6.rollout-bound-rl`): a synchronous RL group decodes its
 * samples in parallel slots, all at one rate, and it is scored only when the longest sample is done. A slot sits idle
 * from the moment its sample ends. You predict the idle share of the group's slot-time, in percent, for the full group
 * of eight samples whose lengths the scene lists.
 *
 * MODEL-ONLY. The Fleet engine has no RL group (wave-3.md D7: it is a flat-tick engine of prefill chunks and decode
 * tokens, with no group to score), so this sweep runs no `Engine`: it computes the stated model below and puts its
 * values in each point's `metrics`. The point's `goodputRps` and `ttftP95` are 0 because no request is served; the
 * panel tabulates the metrics instead (`copyFor('straggler')`). The lesson says so too.
 *
 * THE MODEL. A group of k samples with output lengths l_1 … l_k tokens decodes in k slots at one rate, so sample i holds
 * its slot for l_i token-times and the group lasts max(l) token-times (nothing is scored before its longest sample is
 * done). Slot-time is k × max(l) token-slots; the busy part is the sum of the lengths, so
 *
 *   idle share = 1 − Σ l_i ÷ (k × max l) = 1 − mean(l) ÷ max(l).
 *
 * That is the `rollout` family's `long-tail` arithmetic (src/lib/items/families/rollout.ts, pinned there: 2k, 4k, 6k and
 * 8k tokens idle 37.5 % of the slot-time). This exercise adds what the item cannot: the seed draws a long-tailed set of
 * lengths, and the sweep shows the same samples run as groups of k = 2 … 8 (the first k of the eight), so the learner
 * sees the idle share move as a long sample enters the group. One long sample, or none, is not a tail; the tail is what
 * the lesson's "extreme length variance" and partial rollout are about.
 *
 * THE DRAW (`strLengths`). Eight lengths in tokens, every one a multiple of 100: a seeded count of one to three of the
 * eight are long (16,000 … 64,000 tokens, reasoning-chain lengths of the lesson's 10k to 100k band), the rest short
 * (1,000 … 8,000), the two bands chosen from three each and the long ones' positions shuffled. Nothing here is a
 * measured length: the numbers are synthetic and the scene says "hypothetical". Every draw is a splitmix32 output and
 * every step is +, −, × or ÷, so a seed gives one answer in every browser.
 *
 * THE BAND (`strBand`) and THE PASS RULE (`strPass`): the idle share of the full group is between 20 and 90 percent (the
 * longest sample is at least 1.25 times the mean, a tail), and a prediction passes within one percentage point of it,
 * so a hand sum rounded to a whole percent passes and a reading that divides by the mean, or leaves a sample out, does
 * not (tests/world/fleet-ex-more-b.test.ts measures both, and the strategies that ignore the scene).
 */

import { splitmix32u } from '@/lib/rng'
import type { FleetExerciseDef, SceneFact, SweepResult } from './index'

/** The group sizes the sweep runs: the first k of the seed's eight samples. The last is the whole group, the answer. */
export const STR_POINTS = [2, 3, 4, 5, 6, 7, 8] as const
export const STR_GROUP = 8

/** Short and long output lengths a seed draws its bands from, in tokens (multiples of `STR_STEP`). */
export const STR_STEP = 100
export const STR_SHORT_BANDS = [
  { min: 1000, max: 4000 },
  { min: 2000, max: 6000 },
  { min: 3000, max: 8000 },
] as const
export const STR_LONG_BANDS = [
  { min: 16000, max: 32000 },
  { min: 24000, max: 48000 },
  { min: 32000, max: 64000 },
] as const
/** How many of the eight samples are long: one, two or three. */
export const STR_LONG_COUNTS = [1, 2, 3] as const

/** The idle share is a fair question between these percentages (the lower is the family's 1.25 × mean tail). */
export const STR_MIN_IDLE = 20
export const STR_MAX_IDLE = 90
/** A prediction passes within this many percentage points. */
export const STR_TOLERANCE = 1
const PERCENT = 100

/** Salts the draw, so the lengths are the seed's own stream. */
const STR_SALT = 0x73747261

const inBand = (u: number, b: { min: number; max: number }): number => b.min + (u % ((b.max - b.min) / STR_STEP + 1)) * STR_STEP

/** The eight output lengths of the seed's group, in tokens, in sample order. */
export function strLengths(seed: number): number[] {
  const next = splitmix32u(seed ^ STR_SALT)
  const short = STR_SHORT_BANDS[next() % STR_SHORT_BANDS.length] as { min: number; max: number }
  const long = STR_LONG_BANDS[next() % STR_LONG_BANDS.length] as { min: number; max: number }
  const longs = STR_LONG_COUNTS[next() % STR_LONG_COUNTS.length] as number
  const lengths: number[] = []
  for (let i = 0; i < STR_GROUP; i++) lengths.push(inBand(next(), i < longs ? long : short))
  // Fisher–Yates: where the long ones sit among the eight
  for (let i = lengths.length - 1; i > 0; i--) {
    const j = next() % (i + 1)
    const t = lengths[i] as number
    lengths[i] = lengths[j] as number
    lengths[j] = t
  }
  return lengths
}

/** The idle share of a group, in percent: 1 − mean ÷ longest, which is 1 − Σ l ÷ (k × longest). */
export function strIdlePct(lengths: readonly number[]): number {
  const sum = lengths.reduce((a, b) => a + b, 0)
  return (1 - sum / (lengths.length * Math.max(...lengths))) * PERCENT
}

/** The model at every group size for this seed: a sweep with no engine behind it. */
export function strSweep(seed: number): SweepResult {
  const all = strLengths(seed)
  return {
    points: STR_POINTS.map((k) => {
      const group = all.slice(0, k)
      const sum = group.reduce((a, b) => a + b, 0)
      const longest = Math.max(...group)
      return {
        x: k,
        goodputRps: 0,
        ttftP95: 0,
        metrics: {
          samples: k,
          meanTokens: sum / k,
          longestTokens: longest,
          slotTokens: k * longest,
          idleTokens: k * longest - sum,
          idleShare: strIdlePct(group),
        },
      }
    }),
  }
}

const at = (r: SweepResult, k: number) => r.points.find((p) => p.x === k)

/** The idle share, in percent, of the full group of eight: the sweep's last point. */
export const strTruth = (r: SweepResult): number => at(r, STR_GROUP)?.metrics?.['idleShare'] ?? NaN

/** The seed is a fair question (see the file header). */
export function strBand(r: SweepResult): boolean {
  if (r.points.length !== STR_POINTS.length) return false
  const t = strTruth(r)
  return t >= STR_MIN_IDLE && t <= STR_MAX_IDLE
}

/** You pass within `STR_TOLERANCE` percentage points of the group's idle share. */
export const strPass = (prediction: number, r: SweepResult): boolean => Math.abs(prediction - strTruth(r)) <= STR_TOLERANCE

/** What the learner reads before predicting: the group and each sample's length, the inputs the arithmetic needs. */
export function strScene(seed: number): SceneFact[] {
  return [
    { label: 'Group', value: STR_GROUP, unit: 'hypothetical samples, one slot each, all decoding at the same rate; the group is scored when the longest ends' },
    ...strLengths(seed).map((value, i) => ({ label: `Sample ${i + 1}`, value, unit: 'tokens' })),
  ]
}

/** The scene's reading, which a learner makes by hand: 1 − mean ÷ longest of the eight lengths the scene lists. */
export function strRead(scene: readonly SceneFact[]): number {
  return strIdlePct(scene.filter((f) => f.label.startsWith('Sample ')).map((f) => f.value))
}

/** The seed phone mode shows: the first in-band seed from 0 (tests/world/fleet-ex-more-b.test.ts re-derives it). */
export const STR_CANONICAL_SEED = 0

let canonical: SweepResult | undefined

export const stragglerExercise: FleetExerciseDef = {
  id: 'straggler',
  title: 'The rollout straggler',
  lessonId: 't6.l7',
  kcs: ['t6.rollout-bound-rl'],
  unit: 'the percentage of slot-time a synchronous group of eight leaves idle',
  points: STR_POINTS,
  range: { min: 0, max: 100 },
  sweep: strSweep,
  truth: strTruth,
  band: strBand,
  pass: strPass,
  scene: strScene,
  productionClaims: [],
  get phone() {
    return { seed: STR_CANONICAL_SEED, canonical: (canonical ??= strSweep(STR_CANONICAL_SEED)) }
  },
}
