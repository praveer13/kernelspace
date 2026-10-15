/**
 * Speculation, push your luck (docs/specs/wave-3.md §16.3; t6.l6, `t6.spec-acceptance`): a drafter proposes γ tokens a
 * round (the lesson's k), the target accepts each with probability α, independently, until the first rejection, and then
 * adds one token of its own. You predict the draft length γ, of the sweep's eight, with the largest speedup.
 *
 * MODEL-ONLY. The Fleet engine has no speculation (wave-3.md D7: it is a flat-tick engine of prefill chunks and decode
 * tokens), so this sweep runs no `Engine`: it computes the stated model below, which the `sweep` puts in each point's
 * `metrics`. The point's `goodputRps` and `ttftP95` are 0 because no request is served; the panel plots and tabulates
 * `speedup` instead (`copyFor('push-luck')`).
 *
 * THE MODEL (Leviathan, Kalman and Matias 2023, arXiv 2211.17192; the same line as t5.l8 and t6.l6's "acceptance
 * economy" and the `spec` item family). A round emits, on average,
 *
 *   E(γ) = 1 + α + α² + … + α^γ = (1 − α^(γ+1)) ÷ (1 − α)
 *
 * tokens: the accepted prefix plus the bonus token, and the term α^j is the chance that the first j drafted tokens
 * are all accepted. A round costs one verification step of the target plus γ draft steps of c of a target step each
 * (c is the draft-to-target cost ratio), 1 + γc, and plain decoding emits one token per target step, so
 *
 *   speedup(γ) = (1 − α^(γ+1)) ÷ ((1 − α)(γc + 1)).
 *
 * Without the draft cost, E only rises with γ (each term α^j is positive), so a question about the best γ needs c. With
 * it there is a peak: a longer draft adds α^(γ+1) tokens to the round, and only if every earlier token was accepted,
 * while it adds c to the cost of every round. The powers are repeated products, never `Math.pow` or `**`, which can
 * differ in the last bit between engines (the determinism lint; tests/world/fleet-ex-more-a.test.ts re-derives each
 * speedup from the sum 1 + α + … + α^γ).
 *
 * THE DRAW (`plPair`). α is drawn in whole percents (40 … 95) and c in thousandths (5 … 95 by 5, then 100 … 400 by 10),
 * the `spec` family's grids, so every number has at most two significant digits. A pair is in band when the best draft
 * length is not the last of the eight (the optimum could lie beyond the sweep), the speedup there is at least 1.2 and it is
 * at least 0.5 % above the runner-up. The grid yields a best length of 1 … 6 and no other. The draw first picks which
 * draft length is best (each of those six equally often), then a pair of the grid that makes it best, so no one answer is
 * right on more than about a fifth of banded seeds (tests/world/fleet-ex-more-a.test.ts measures it).
 *
 * THE BAND (`plBand`) and THE PASS RULE (`plPass`): the best γ is not the sweep's last, its speedup is at least 1.2, and
 * at least 0.5 % above every other γ; the prediction is exactly that γ. The speedup is a calculation, not an estimate,
 * and a close neighbour is within a few percent of the best, so the learner reads four digits (the setup says so).
 */

import { splitmix32u } from '@/lib/rng'
import type { FleetExerciseDef, SceneFact, SweepResult } from './index'

/** The draft lengths the sweep runs. */
export const PL_POINTS = [1, 2, 3, 4, 5, 6, 7, 8] as const

/** α in whole percents, and c in thousandths, as the `spec` family draws them. */
export const PL_ALPHA_MIN = 40
export const PL_ALPHA_MAX = 95
const PL_COSTS: readonly number[] = (() => {
  const out: number[] = []
  for (let c = 5; c <= 95; c += 5) out.push(c)
  for (let c = 100; c <= 400; c += 10) out.push(c)
  return out
})()
const PERCENT = 100
const THOUSAND = 1000

/** A seed is a question when speculation pays this much at the best length, and the best beats the runner-up by this share. */
export const PL_MIN_SPEEDUP = 1.2
export const PL_MARGIN = 1.005

/** Salts the draw, so the pair's draws are the seed's own stream. */
const PL_SALT = 0x70757368

/** α^n by repeated multiplication: the same bits in every engine. */
export function plPower(alpha: number, n: number): number {
  let r = 1
  for (let i = 0; i < n; i++) r *= alpha
  return r
}

/** Tokens a round emits on average, (1 − α^(γ+1)) ÷ (1 − α). */
export const plEmitted = (alpha: number, gamma: number): number => (1 - plPower(alpha, gamma + 1)) / (1 - alpha)

/** What a round costs in target steps: the verification step plus γ draft steps of c each. */
export const plCost = (gamma: number, c: number): number => gamma * c + 1

/** Tokens emitted per target step's worth of time, against plain decoding's one. */
export const plSpeedup = (alpha: number, gamma: number, c: number): number => plEmitted(alpha, gamma) / plCost(gamma, c)

/** A pair of the grid: α in percents, c in thousandths. */
export interface PlPair {
  alphaPct: number
  costMilli: number
}

const alphaOf = (p: PlPair): number => p.alphaPct / PERCENT
const costOf = (p: PlPair): number => p.costMilli / THOUSAND

/** The index of the largest speedup in a list; the lower γ wins a tie. */
const bestOf = (v: readonly number[]): number => v.reduce((best, s, i) => (s > (v[best] as number) ? i : best), 0)

/** The speedup at every draft length of the sweep for a pair. */
export const plSpeedups = (p: PlPair): number[] => PL_POINTS.map((g) => plSpeedup(alphaOf(p), g, costOf(p)))

/** True when the speedups make a fair question: the best is not the last, pays at least 1.2, and beats every other by 0.5 %. */
function fair(v: readonly number[]): boolean {
  const best = bestOf(v)
  if (best === v.length - 1) return false
  const runnerUp = Math.max(...v.filter((_, i) => i !== best))
  return (v[best] as number) >= PL_MIN_SPEEDUP && (v[best] as number) >= PL_MARGIN * runnerUp
}

let groups: readonly (readonly PlPair[])[] | undefined

/** The grid's banded pairs grouped by the draft length that is best for them, in ascending order of that length. */
export function plPairsByBest(): readonly (readonly PlPair[])[] {
  if (groups) return groups
  const by = new Map<number, PlPair[]>()
  for (let a = PL_ALPHA_MIN; a <= PL_ALPHA_MAX; a++) {
    for (const c of PL_COSTS) {
      const pair = { alphaPct: a, costMilli: c }
      const v = plSpeedups(pair)
      if (fair(v)) by.set(bestOf(v), [...(by.get(bestOf(v)) ?? []), pair])
    }
  }
  return (groups = [...by].sort((x, y) => x[0] - y[0]).map(([, ps]) => ps))
}

/** The seed's α and c: first which draft length is best, then a pair that makes it so. */
export function plPair(seed: number): PlPair {
  const next = splitmix32u(seed ^ PL_SALT)
  const gs = plPairsByBest()
  const group = gs[next() % gs.length] as readonly PlPair[]
  return { ...(group[next() % group.length] as PlPair) }
}

/** The model at every draft length for this seed: a sweep with no engine behind it. */
export function plSweep(seed: number): SweepResult {
  const pair = plPair(seed)
  const alpha = alphaOf(pair)
  const c = costOf(pair)
  return {
    points: PL_POINTS.map((gamma) => ({
      x: gamma,
      goodputRps: 0,
      ttftP95: 0,
      metrics: {
        alpha,
        cost: c,
        tokensPerRound: plEmitted(alpha, gamma),
        roundCost: plCost(gamma, c),
        accepted: plPower(alpha, gamma + 1),
        speedup: plSpeedup(alpha, gamma, c),
      },
    })),
  }
}

const speedups = (r: SweepResult): number[] => r.points.map((p) => p.metrics?.['speedup'] ?? 0)

/** The draft length with the largest speedup. */
export const plTruth = (r: SweepResult): number => r.points[bestOf(speedups(r))]?.x ?? NaN

/** The seed is a fair question (see the file header). */
export const plBand = (r: SweepResult): boolean => r.points.length === PL_POINTS.length && fair(speedups(r))

/** You pass when you name the draft length with the largest speedup. */
export const plPass = (prediction: number, r: SweepResult): boolean => prediction === plTruth(r)

/** What the learner reads before predicting: α and c, the two numbers the formula needs. */
export function plScene(seed: number): SceneFact[] {
  const pair = plPair(seed)
  return [
    { label: 'Acceptance rate α', value: alphaOf(pair), unit: 'per drafted token, each independent of the others' },
    { label: 'Draft cost c', value: costOf(pair), unit: 'of one target step, per drafted token' },
  ]
}

/** The seed phone mode shows: the first in-band seed from 0 (tests/world/fleet-ex-more-a.test.ts re-derives it). */
export const PL_CANONICAL_SEED = 0

let canonical: SweepResult | undefined

export const pushLuckExercise: FleetExerciseDef = {
  id: 'push-luck',
  title: 'Push your luck',
  lessonId: 't6.l6',
  kcs: ['t6.spec-acceptance'],
  unit: 'the draft length γ with the largest speedup',
  points: PL_POINTS,
  sweep: plSweep,
  truth: plTruth,
  band: plBand,
  pass: plPass,
  scene: plScene,
  productionClaims: [],
  get phone() {
    return { seed: PL_CANONICAL_SEED, canonical: (canonical ??= plSweep(PL_CANONICAL_SEED)) }
  },
}
