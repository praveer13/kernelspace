/**
 * The `spec` family: speculative decoding (docs/specs/wave-2.md §5.3; KCs t5.speculative-decoding,
 * t6.spec-acceptance).
 *
 * Four variants at levels 0-3, all on one model: a drafter proposes k tokens, the target accepts each
 * with probability α until the first rejection and adds one token of its own, so a round emits
 * E = (1 − α^(k+1)) / (1 − α) tokens. `expected-tokens` asks for E (over a run of verification steps,
 * or the steps a reply needs), `speedup` divides by the round's cost 1 + k·c, `best-k` picks the draft
 * length in one to six that maximises it (a choice), and `draft-tokens` reads the same quantity off a
 * log of accepted prefixes. Every number is a scenario number declared in SYNTHETIC and the prompts say
 * "hypothetical" (§5.3: all of this family's numbers are synthetic, so it uses no claims).
 *
 * Two departures from the §5.3 table, both forced by verify-generators' non-degeneracy gate (at least
 * half of the seeds need distinct truths, at every level): α runs on a 0.01 grid, not 0.05, and a count
 * that would be a single small integer carries a second scenario number instead (a run's step count; a
 * log of 20-99 rounds in place of one accept/reject pattern, whose mean is the same arithmetic).
 *
 * α^n comes from a table filled by repeated multiplication when the module loads: Math.pow differs
 * between engines in the last bit and the determinism lint forbids it in families.
 */

import { finishInstance, resolveVariant, rngFor, type Rng } from '../core'
import { gradeResponse } from '../grade'
import type { AnswerSpec, Gen, Instance, Level, Params, PromptPart, RatioRule, SolutionStep, Tolerance, VariantSpec } from '../types'
import { formatNumber } from '../units'

// The two KC ids of src/data/kc/ids.ts, written out so the chunk need not carry the whole table (tests/items/spec.test.ts pins them to it).
const KC = { speculativeDecoding: 't5.speculative-decoding', specAcceptance: 't6.spec-acceptance' }

/** Scenario numbers: no real drafter, model or benchmark, and the prompts say "hypothetical" (spec §5.3). */
const SYNTHETIC = {
  levels: [0, 1, 2, 3] as const,
  // the transfer level: steps for a reply, tokens per second, a measured table, a run's step count
  transfer: 3 as const,
  nsec: { expected: 45, speedup: 60, best: 80, log: 60 },
  // acceptance probability in hundredths, and the powers of it the table holds (k + 1 up to 9)
  alphaMin: 40,
  alphaMax: 95,
  maxPow: 9,
  // draft length per level, both ends included
  draftLength: [[2, 4], [2, 6], [1, 8], [2, 8]],
  // a run's verification steps: one step in `oneStepIn` asks about a single step (the lesson's E)
  oneStepIn: 4,
  stepsMin: 10,
  stepsMax: 99,
  // draft cost per drafted token, as a share of a target step, in thousandths: every value has two significant digits at most
  costFine: { from: 5, to: 95, step: 5 },
  costCoarse: { from: 100, to: 400, step: 10 },
  // a speedup below this is not worth asking about
  minSpeedup: 1.1,
  // plain decode speed of the user in tokens per second (level 3 of speedup)
  rateMin: 20,
  rateMax: 99,
  // tokens a reply needs (levels 3 of expected-tokens and draft-tokens): two digits, one or two decades
  replyMin: 10,
  replyMax: 99,
  replyDecades: [10, 100],
  // best-k asks among these draft lengths; the best one beats the runner-up by this share, also on the level-3 table
  bestMax: 6,
  margin: 0.005,
  // draft-tokens: rounds in the log, and the hidden per-token acceptance (percent) that produced it
  roundsMin: 20,
  roundsMax: 99,
  logAlphaMin: 40,
  logAlphaMax: 95,
  // text digits: α to hundredths, c to thousandths and results to thousandths
  alphaDigits: 2,
  costDigits: 3,
  shown: 3,
  // a rule never claims a ratio within this of 1: that is a right answer
  apart: 0.06,
  // answer windows: tokens and speedups are read to one decimal (half a tenth, with a hair for float noise), counts of steps or tok/s to the unit
  tolValue: { rel: 0.02, abs: 0.051 },
  tolCount: { rel: 0.02, abs: 0.5 },
  // the lessons' worked examples: t6.l6 (α = 0.85, k = 3, E ≈ 3.2), t5.l8 (α = 0.7, k = 4, E ≈ 2.8) and t5.l8 fig 1 (accept 3 of 4, +1 bonus)
  pin: {
    mtp: { alpha: 0.85, k: 3, e: 3.2 },
    draft: { alpha: 0.7, k: 4, e: 2.8 },
    fig1: { k: 4, rounds: 20, counts: '0,0,0,20,0', tokens: 4 },
    tol: 0.05,
  },
}

const TRANSFER: Level = SYNTHETIC.transfer
const PCT = 100 // gen-literal-ok: percent, and hundredths of a probability
const t = (text: string): PromptPart => ({ t: 'text', text })
const v = (value: number, unit?: string, digits?: number): PromptPart => ({ t: 'value', value, ...(unit ? { unit } : {}), ...(digits === undefined ? {} : { digits }) })
const f = (n: number): string => formatNumber(n)
const fx = (n: number): string => formatNumber(n, SYNTHETIC.shown)
const step = (text: PromptPart[], result?: { value: number; unit?: string }): SolutionStep => ({ text, ...(result ? { result } : {}) })
const num = (p: Params, k: string): number => Number(p[k])

const VARIANTS: VariantSpec[] = [
  { id: 'expected-tokens', title: 'Tokens per verification step', kcs: [KC.speculativeDecoding], levels: SYNTHETIC.levels, nsec: SYNTHETIC.nsec.expected },
  { id: 'speedup', title: 'Speedup from speculation', kcs: [KC.specAcceptance], levels: SYNTHETIC.levels, nsec: SYNTHETIC.nsec.speedup },
  { id: 'best-k', title: 'The draft length that pays most', kcs: [KC.specAcceptance], levels: SYNTHETIC.levels, nsec: SYNTHETIC.nsec.best },
  { id: 'draft-tokens', title: 'Tokens per round from a log', kcs: [KC.speculativeDecoding], levels: SYNTHETIC.levels, nsec: SYNTHETIC.nsec.log },
]

/* ------------------------------ the maths ------------------------------ */

/** α^n for every α on the grid, by repeated multiplication: the same bits in every engine. */
const POWERS = new Map<number, number[]>()
for (let a = SYNTHETIC.alphaMin; a <= SYNTHETIC.alphaMax; a++) {
  const alpha = a / PCT
  const row = [1]
  for (let n = 1; n <= SYNTHETIC.maxPow; n++) row.push(row[n - 1] * alpha)
  POWERS.set(a, row)
}
const power = (alpha: number, n: number): number => POWERS.get(Math.round(alpha * PCT))![n]

/** Tokens a round emits on average: the accepted prefix plus the bonus token, (1 − α^(k+1)) / (1 − α). */
const emitted = (alpha: number, k: number): number => (1 - power(alpha, k + 1)) / (1 - alpha)
/** What one round costs, in target steps: the verification step plus k draft steps of c each. */
const roundCost = (k: number, c: number): number => 1 + k * c
const speedupOf = (alpha: number, k: number, c: number): number => emitted(alpha, k) / roundCost(k, c)

/** The three ways to get E wrong: drop the bonus token, sum k terms instead of k + 1, add α once per token. */
const E_SLIPS = {
  'spec.no-bonus': (alpha: number, k: number): number => emitted(alpha, k) - 1,
  'spec.k-terms': (alpha: number, k: number): number => (1 - power(alpha, k)) / (1 - alpha),
  'spec.linear': (alpha: number, k: number): number => 1 + alpha * k,
}

/** Draft costs c in thousandths, from the fine range then the coarse one. */
const COSTS: number[] = []
for (const r of [SYNTHETIC.costFine, SYNTHETIC.costCoarse]) for (let c = r.from; c <= r.to; c += r.step) COSTS.push(c)
const MILLI = 1000 // gen-literal-ok: thousandths of a target step

const alphaOf = (p: Params): number => num(p, 'alpha')

/** The log of a draft-tokens instance: rounds by accepted drafted tokens, index = accepted. */
const countsOf = (p: Params): number[] => String(p.counts).split(',').map(Number)
const acceptedIn = (counts: readonly number[]): number => counts.reduce((a, c, n) => a + n * c, 0)
const meanTokens = (p: Params): number => (num(p, 'rounds') + acceptedIn(countsOf(p))) / num(p, 'rounds')

/** The measured tokens per step a level-3 `best-k` table shows: E to hundredths. */
const measured = (alpha: number, k: number): number => Math.round(emitted(alpha, k) * PCT) / PCT
/** E as the item gives it: exact, or the rounded table figure on the transfer level. */
const eShown = (p: Params, level: Level, k: number): number => (level === TRANSFER ? measured(alphaOf(p), k) : emitted(alphaOf(p), k))
const bestSpeedups = (p: Params, level: Level): number[] => Array.from({ length: SYNTHETIC.bestMax }, (_, i) => eShown(p, level, i + 1) / roundCost(i + 1, num(p, 'c')))
const argmax = (xs: readonly number[]): number => xs.indexOf(Math.max(...xs))
/** The index of the best speedup when it beats the runner-up by `margin`, else -1. */
function clearBest(xs: readonly number[]): number {
  const best = argmax(xs)
  const second = Math.max(...xs.filter((_, i) => i !== best))
  return xs[best] < second * (1 + SYNTHETIC.margin) ? -1 : best
}

/** The answer of a numeric variant, from its params alone. */
function truthOf(variant: string, p: Params): number {
  if (variant === 'expected-tokens') {
    const e = emitted(alphaOf(p), num(p, 'k'))
    return p.tokens === undefined ? num(p, 'steps') * e : num(p, 'tokens') / e
  }
  if (variant === 'speedup') {
    const s = speedupOf(alphaOf(p), num(p, 'k'), num(p, 'c'))
    return p.rate === undefined ? s : num(p, 'rate') * s
  }
  const m = meanTokens(p)
  return p.tokens === undefined ? m : num(p, 'tokens') / m
}

/* ------------------------------ best-k pools ------------------------------ */

/**
 * Every (α in hundredths, c in thousandths) whose best draft length is clear, by that length: it beats the
 * runner-up by `margin` on the exact curve and on the rounded table of level 3, which names the same one. The curve is flat near its top, so
 * the middle lengths have fewer pairs; drawing the length first keeps the key spread over one to six.
 */
let bestPools: [number, number][][] | undefined
function poolsOf(): [number, number][][] {
  if (bestPools) return bestPools
  const pools: [number, number][][] = Array.from({ length: SYNTHETIC.bestMax + 1 }, () => [])
  for (let a = SYNTHETIC.alphaMin; a <= SYNTHETIC.alphaMax; a++) {
    for (const cc of COSTS) {
      const p = { alpha: a / PCT, c: cc / MILLI }
      const best = clearBest(bestSpeedups(p, 0))
      if (best < 0 || clearBest(bestSpeedups(p, TRANSFER)) !== best) continue
      pools[best + 1].push([a, cc])
    }
  }
  bestPools = pools
  return pools
}

/* ------------------------------ prompt and solution text ------------------------------ */

const fa = (alpha: number): string => alpha.toFixed(SYNTHETIC.alphaDigits)
/** c with at least two decimals and no trailing zero beyond them: 0.05, 0.015, 0.10. Never a bare digit, so no option text can echo it. */
const fc = (c: number): string => {
  const s = c.toFixed(SYNTHETIC.costDigits)
  return s.endsWith('0') ? s.slice(0, -1) : s
}

interface Given {
  label: string
  value: PromptPart
}
interface Spec {
  stem: PromptPart[]
  givens: Given[]
  answer: AnswerSpec
  calc: SolutionStep[]
  /** a closing step with no result (the choice variant names the key) */
  tail?: SolutionStep
}

const RULE = 'A round ends at the first rejection, and the target always adds one token of its own (the bonus token).'
const numeric = (truth: number, unit: string, tolerance: Tolerance): AnswerSpec => ({ kind: 'numeric', truth, unit, tolerance })

/** The first three steps of E: the power, the numerator and the denominator, then E itself. */
function eSteps(p: Params, unit?: string): SolutionStep[] {
  const [alpha, k] = [alphaOf(p), num(p, 'k')]
  const e = emitted(alpha, k)
  const tail = power(alpha, k + 1)
  return [
    step([t(`α^(k+1) with α = ${fa(alpha)} and k + 1 = ${f(k + 1)}`)], { value: tail }),
    step([t('Numerator: 1 − α^(k+1)')], { value: 1 - tail }),
    step([t('Denominator: 1 − α')], { value: 1 - alpha }),
    step([t('Tokens per step E = numerator ÷ denominator: the accepted prefix plus the bonus token')], { value: e, ...(unit ? { unit } : {}) }),
  ]
}

function describeExpected(p: Params): Spec {
  const [alpha, k] = [alphaOf(p), num(p, 'k')]
  const reply = p.tokens !== undefined
  const steps = reply ? 1 : num(p, 'steps')
  const givens: Given[] = [
    { label: 'Draft length k', value: v(k, 'tokens') },
    { label: 'Acceptance probability α', value: t(fa(alpha)) },
    ...(reply ? [{ label: 'Reply length', value: v(num(p, 'tokens'), 'tokens') }] : steps > 1 ? [{ label: 'Verification steps', value: v(steps) }] : []),
  ]
  const intro = `A hypothetical drafter proposes k = ${f(k)} tokens each round, and the target model accepts each drafted token with probability α = ${fa(alpha)}, independently. ${RULE} `
  const ask = reply
    ? `On average, how many verification steps does it take to emit a ${f(num(p, 'tokens'))}-token reply?`
    : steps === 1
      ? 'On average, how many tokens does one verification step emit?'
      : `A request runs ${f(steps)} verification steps. On average, how many tokens do they emit?`
  const truth = truthOf('expected-tokens', p)
  const calc = eSteps(p, 'tokens')
  if (reply) calc.push(step([t(`Steps = ${f(num(p, 'tokens'))} tokens ÷ E`)], { value: truth, unit: 'steps' }))
  else if (steps > 1) calc.push(step([t(`Tokens in ${f(steps)} steps = ${f(steps)} × E`)], { value: truth, unit: 'tokens' }))
  return { stem: [t(intro + ask)], givens, answer: numeric(truth, reply ? 'steps' : 'tokens', reply ? SYNTHETIC.tolCount : SYNTHETIC.tolValue), calc }
}

function describeSpeedup(p: Params): Spec {
  const [alpha, k, c] = [alphaOf(p), num(p, 'k'), num(p, 'c')]
  const s = speedupOf(alpha, k, c)
  const rate = p.rate !== undefined
  const givens: Given[] = [
    { label: 'Draft length k', value: v(k, 'tokens') },
    { label: 'Acceptance probability α', value: t(fa(alpha)) },
    { label: 'Draft cost per token, c', value: t(`${fc(c)} of a target step`) },
    ...(rate ? [{ label: 'Plain decode speed', value: v(num(p, 'rate'), 'tok/s') }] : []),
  ]
  const intro = `A hypothetical drafter proposes k = ${f(k)} tokens each round, and the target model accepts each drafted token with probability α = ${fa(alpha)}, independently. ${RULE} A round costs one target step to verify plus k draft steps of c = ${fc(c)} of a target step each. Plain decoding emits one token per target step. `
  const ask = rate
    ? `A user decodes at ${f(num(p, 'rate'))} tok/s without speculation. How many tokens per second do they get with it?`
    : 'By what factor does speculation speed up decoding?'
  const calc = eSteps(p, 'tokens')
  calc.push(
    step([t(`Round cost = 1 + k × c = 1 + ${f(k)} × ${fc(c)}`)], { value: roundCost(k, c), unit: 'target steps' }),
    step([t('Speedup = E ÷ round cost')], { value: s, unit: '×' }),
  )
  if (rate) calc.push(step([t(`Tokens per second = ${f(num(p, 'rate'))} × speedup`)], { value: truthOf('speedup', p), unit: 'tok/s' }))
  const truth = truthOf('speedup', p)
  return { stem: [t(intro + ask)], givens, answer: numeric(truth, rate ? 'tok/s' : '×', rate ? SYNTHETIC.tolCount : SYNTHETIC.tolValue), calc }
}

/** The six options of a best-k item: k = 1 to 6, each with the speedup it gives and why that is or is not the most. */
function describeBestK(p: Params, level: Level): Spec {
  const [alpha, c] = [alphaOf(p), num(p, 'c')]
  const table = level === TRANSFER
  const speeds = bestSpeedups(p, level)
  const best = argmax(speeds)
  const options = speeds.map((s, i) => {
    const k = i + 1
    const key = i === best
    return {
      id: `k${k}`,
      text: `k = ${k}`,
      why: key
        ? `k = ${k} gives ${fx(s)}×, the largest of the six: ${fx(eShown(p, level, k))} tokens per step for a round costing ${fx(roundCost(k, c))} target steps.`
        : `k = ${k} gives ${fx(s)}×, less than the ${fx(speeds[best])}× of k = ${best + 1}: ${k < best + 1 ? 'a longer draft still adds more tokens per step than it adds cost' : 'the extra draft tokens cost more than the tokens they add'}.`,
      ...(key ? {} : { miss: k < best + 1 ? 'spec.stopped-early' : 'spec.ignored-cost' }),
    }
  })
  const rule = `${RULE} A round costs one target step to verify plus k draft steps of c = ${fc(c)} of a target step each, and its speedup is the tokens it emits per step divided by that cost.`
  const stem: PromptPart[] = table
    ? [
        t(`A hypothetical drafter was measured at every draft length: the table gives the tokens a round emitted on average. ${rule} Which draft length, from one to six, gives the largest speedup?`),
        {
          t: 'table',
          caption: 'Measured tokens per verification step',
          columns: ['Draft length k', 'Tokens per step'],
          rows: speeds.map((_, i) => [i + 1, eShown(p, level, i + 1)]),
        },
      ]
    : [t(`A hypothetical drafter proposes k tokens each round, and the target model accepts each drafted token with probability α = ${fa(alpha)}, independently. ${rule} Which draft length, from one to six, gives the largest speedup?`)]
  const calc = speeds.map((s, i) =>
    step([t(`k = ${i + 1}: E = ${fx(eShown(p, level, i + 1))} tokens per step, round cost ${fx(roundCost(i + 1, c))} target steps, speedup = E ÷ cost`)], { value: s, unit: '×' }),
  )
  return {
    stem,
    givens: [...(table ? [] : [{ label: 'Acceptance probability α', value: t(fa(alpha)) }]), { label: 'Draft cost per token, c', value: t(`${fc(c)} of a target step`) }],
    answer: { kind: 'choice', options, correct: [`k${best + 1}`] },
    calc,
    tail: step([t(`The largest speedup is ${fx(speeds[best])}×, at k = ${best + 1}.`)]),
  }
}

function describeLog(p: Params): Spec {
  const k = num(p, 'k')
  const rounds = num(p, 'rounds')
  const counts = countsOf(p)
  const accepted = acceptedIn(counts)
  const m = meanTokens(p)
  const reply = p.tokens !== undefined
  const intro = `A hypothetical engine drafts k = ${f(k)} tokens per round. The target checks them in one pass, accepts the longest agreeing prefix and adds one token of its own: the bonus token after a clean sweep, or the correction at the first rejection. Its log counts ${f(rounds)} rounds by how many drafted tokens were accepted.`
  const ask = reply
    ? `At this rate, how many verification steps does a ${f(num(p, 'tokens'))}-token reply take?`
    : 'On average, how many tokens does one round emit?'
  const calc = [
    step([t('Rounds in the log: add the Rounds column')], { value: rounds, unit: 'rounds' }),
    step([t('Accepted draft tokens in all: each accepted count times its rounds, added up')], { value: accepted, unit: 'tokens' }),
    step([t("Every round also emits one token of the target's own, so the total is accepted + rounds")], { value: rounds + accepted, unit: 'tokens' }),
    step([t('Tokens per round = total ÷ rounds')], { value: m, unit: 'tokens' }),
  ]
  if (reply) calc.push(step([t(`Steps = ${f(num(p, 'tokens'))} tokens ÷ tokens per round`)], { value: truthOf('draft-tokens', p), unit: 'steps' }))
  const truth = truthOf('draft-tokens', p)
  return {
    stem: [
      t(intro),
      { t: 'table', caption: 'Rounds by accepted draft tokens', columns: ['Accepted draft tokens', 'Rounds'], rows: counts.map((n, a) => [a, n]) },
      t(ask),
    ],
    givens: [{ label: 'Draft length k', value: v(k, 'tokens') }, ...(reply ? [{ label: 'Reply length', value: v(num(p, 'tokens'), 'tokens') }] : [])],
    answer: numeric(truth, reply ? 'steps' : 'tokens', reply ? SYNTHETIC.tolCount : SYNTHETIC.tolValue),
    calc,
  }
}

const DESCRIBE: Record<string, (p: Params, level: Level) => Spec> = {
  'expected-tokens': describeExpected,
  speedup: describeSpeedup,
  'best-k': describeBestK,
  'draft-tokens': describeLog,
}

/* ------------------------------ drawing params ------------------------------ */

const draftLength = (r: Rng, level: Level): number => r.int(SYNTHETIC.draftLength[level][0], SYNTHETIC.draftLength[level][1])
const acceptance = (r: Rng): number => r.int(SYNTHETIC.alphaMin, SYNTHETIC.alphaMax) / PCT
/** A reply length: two digits times a decade. */
const replyTokens = (r: Rng): number => r.int(SYNTHETIC.replyMin, SYNTHETIC.replyMax) * r.pick(SYNTHETIC.replyDecades)

const DRAW: Record<string, (r: Rng, level: Level) => Params> = {
  'expected-tokens': (r, level): Params => {
    const alpha = acceptance(r)
    const k = draftLength(r, level)
    if (level === TRANSFER) return { alpha, k, tokens: replyTokens(r) }
    return { alpha, k, steps: r.int(0, SYNTHETIC.oneStepIn - 1) === 0 ? 1 : r.int(SYNTHETIC.stepsMin, SYNTHETIC.stepsMax) }
  },
  speedup: (r, level): Params => {
    const alpha = acceptance(r)
    const k = draftLength(r, level)
    const e = emitted(alpha, k)
    // only costs that leave a speedup worth asking about; c = 0.005 always does, so the list is never empty
    const c = r.pick(COSTS.filter((cc) => e / roundCost(k, cc / MILLI) >= SYNTHETIC.minSpeedup)) / MILLI
    return level === TRANSFER ? { alpha, k, c, rate: r.int(SYNTHETIC.rateMin, SYNTHETIC.rateMax) } : { alpha, k, c }
  },
  'best-k': (r) => {
    const [a, cc] = r.pick(poolsOf()[r.int(1, SYNTHETIC.bestMax)])
    return { alpha: a / PCT, c: cc / MILLI }
  },
  'draft-tokens': (r, level) => {
    const k = draftLength(r, level)
    const rounds = r.int(SYNTHETIC.roundsMin, SYNTHETIC.roundsMax)
    const accept = r.int(SYNTHETIC.logAlphaMin, SYNTHETIC.logAlphaMax)
    // each round: tokens are accepted one by one until one is rejected or all k pass
    const counts = Array.from({ length: k + 1 }, () => 0)
    for (let i = 0; i < rounds; i++) {
      let n = 0
      while (n < k && r.int(0, PCT - 1) < accept) n++
      counts[n]++
    }
    return { k, rounds, counts: counts.join(','), ...(level === TRANSFER ? { tokens: replyTokens(r) } : {}) }
  },
}

/* ------------------------------ building and solving ------------------------------ */

function build(variant: string, level: Level, seed: number, params: Params): Instance {
  const vs = VARIANTS.find((x) => x.id === variant)!
  const d = DESCRIBE[variant](params, level)
  let worked: SolutionStep[] | undefined
  if (level < 2) {
    // level 0 shows every step but the last; level 1 also blanks one middle step, which hides its result until the answer
    worked = d.calc.slice(0, -1)
    if (level === 1) {
      const at = Math.floor(worked.length / 2)
      worked = worked.map((s, i) => (i === at ? { ...s, blank: true } : s))
    }
  }
  return finishInstance(gen, {
    variant,
    seed,
    level,
    params,
    // the tokens-per-second item needs E (t5) and the cost model (t6)
    kcs: variant === 'speedup' && level === TRANSFER ? [KC.specAcceptance, KC.speculativeDecoding] : [...vs.kcs],
    nsec: vs.nsec,
    prompt: { stem: d.stem, givens: d.givens, ...(worked && worked.length > 0 ? { worked } : {}) },
    answer: d.answer,
    claims: [],
  })
}

function make(seed: number, level: Level, variant?: string): Instance {
  const vs = resolveVariant(gen, seed, level, variant)
  return build(vs.id, level, seed, DRAW[vs.id](rngFor(gen.id, vs.id, level, seed), level))
}

function solution(inst: Instance): SolutionStep[] {
  const d = DESCRIBE[inst.variant](inst.params, inst.level)
  return d.tail ? [...d.calc, d.tail] : d.calc
}

/* ------------------------------ ratio rules ------------------------------ */

/** A ratio close to 1 is indistinguishable from a right answer, so no rule may claim it. */
const apart = (rho: number): number | null => (Number.isFinite(rho) && Math.abs(rho - 1) > SYNTHETIC.apart ? rho : null)
/** Reply-length items divide by what the slip computes, so the answer moves by the inverse of the slip's ratio. */
const inverse = (inst: Instance): boolean => inst.params.tokens !== undefined

/** The wrong E of a slip against the right one, as a ratio of the answers (E rules apply to both E variants). */
function eSlip(id: keyof typeof E_SLIPS, inst: Instance): number | null {
  if (inst.variant !== 'expected-tokens' && inst.variant !== 'speedup') return null
  const [alpha, k] = [alphaOf(inst.params), num(inst.params, 'k')]
  const rho = E_SLIPS[id](alpha, k) / emitted(alpha, k)
  return apart(inverse(inst) ? 1 / rho : rho)
}

const RATIO_RULES: RatioRule[] = [
  {
    id: 'spec.no-bonus',
    ratio: (inst) => {
      if (inst.variant !== 'draft-tokens') return eSlip('spec.no-bonus', inst)
      // the log's mean without the one token the target adds each round
      const m = meanTokens(inst.params)
      return apart(inverse(inst) ? m / (m - 1) : (m - 1) / m)
    },
    message: 'You left out the bonus token. Every round emits the accepted prefix plus one token from the target itself, so the sum starts at 1: E = 1 + α + … + α^k.',
  },
  {
    id: 'spec.k-terms',
    ratio: (inst) => eSlip('spec.k-terms', inst),
    message: 'You summed k terms. A round can emit k + 1 tokens (all k drafts plus the bonus), so the sum runs to α^k and E = (1 − α^(k+1)) / (1 − α).',
  },
  {
    id: 'spec.linear',
    ratio: (inst) => eSlip('spec.linear', inst),
    message: 'You added α once per drafted token (1 + αk). A rejection ends the round, so a token counts only if every earlier one was accepted: the terms are α, α², α³, and so on.',
  },
  {
    id: 'spec.ignored-cost',
    ratio: (inst) => (inst.variant === 'speedup' ? apart(roundCost(num(inst.params, 'k'), num(inst.params, 'c'))) : null),
    message: 'You gave tokens per step as the speedup. A round also pays for its k draft steps: divide E by 1 + k × c.',
  },
  {
    id: 'spec.unweighted-mean',
    ratio: (inst) => {
      if (inst.variant !== 'draft-tokens') return null
      const k = num(inst.params, 'k')
      const rho = (1 + k / 2) / meanTokens(inst.params)
      return apart(inverse(inst) ? 1 / rho : rho)
    },
    message: 'You averaged the accepted lengths 0 to k without weighting them. Most rounds end at some lengths and few at others: multiply each length by its rounds before adding.',
  },
]

/* ------------------------------ pins ------------------------------ */

const { pin: PIN } = SYNTHETIC
const pins = [
  {
    name: 'MTP-3 at α = 0.85 emits about 3.2 tokens per step',
    source: 't6.l6',
    make: () => build('expected-tokens', 2, 1, { alpha: PIN.mtp.alpha, k: PIN.mtp.k, steps: 1 }),
    truth: PIN.mtp.e,
    tolerance: { abs: PIN.tol },
  },
  {
    name: 'α = 0.7 and k = 4 give E ≈ 2.8',
    source: 't5.l8',
    make: () => build('expected-tokens', 2, 1, { alpha: PIN.draft.alpha, k: PIN.draft.k, steps: 1 }),
    truth: PIN.draft.e,
    tolerance: { abs: PIN.tol },
  },
  {
    name: 'accept 3 of 4 drafted tokens, plus the bonus: 4 tokens per round',
    source: 't5.l8 fig 1',
    make: () => build('draft-tokens', 2, 1, { k: PIN.fig1.k, rounds: PIN.fig1.rounds, counts: PIN.fig1.counts }),
    truth: PIN.fig1.tokens,
    tolerance: { abs: PIN.tol },
  },
] satisfies Gen['pins']

const gen: Gen = {
  id: 'spec',
  version: 1,
  title: 'Speculative decoding: tokens per step, speedup and draft length',
  kcs: [...new Set(VARIANTS.flatMap((x) => x.kcs))],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution,
  pins,
}

export default gen
