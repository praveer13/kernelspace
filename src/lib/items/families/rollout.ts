/**
 * The `rollout` family (docs/specs/wave-3.md §5.1; KCs t6.rollout-bound-rl, t6.weight-sync): the
 * speedup of an RL step when only its rollout gets faster, the slots a synchronous group leaves idle
 * while its longest sample finishes, the tokens one step generates, and the seconds one weight sync
 * takes when each rank pulls only its slice. All four are numeric: no choice variant, so no cue gate.
 *
 * Every scenario number (a rollout share inside the lesson's 70-90 % band, a speedup, a sample's
 * length, a parameter count, a shard count, a link speed) is declared in SYNTHETIC and announced as
 * hypothetical in the prompt. The one real-world figure is checkpoint-engine's "1T in about 20 s":
 * it is a cited comparison line after the solution of `sync-seconds`, never an input and never a pin,
 * because its README states no bytes, shard count or link bandwidth.
 *
 * `sync-seconds` divides params x bytes by one seeded shard count S, the ranks the weights are split
 * over. Its slip is `rollout.unsliced` (x S); the family has no TP x EP product anywhere.
 */

import '@/data/claims/lazy/serving3'
import { claimRef, finishInstance, resolveVariant, rngFor, type Rng } from '@/lib/items/core'
import { gradeResponse } from '@/lib/items/grade'
import type { Gen, Instance, Level, Params, Prompt, PromptPart, RatioRule, SolutionStep, VariantSpec } from '@/lib/items/types'
import { BITS_PER_BYTE, DTYPE_BYTES, formatNumber } from '@/lib/items/units'

/** The two KCs, by id: neither is among the contract ids of kc/ids.ts, which this family does not own. */
const KC = { rolloutBoundRl: 't6.rollout-bound-rl', weightSync: 't6.weight-sync' } as const

const SYNTHETIC = {
  /** nominal seconds per variant */
  nsec: { 'rollout-share': 45, 'long-tail': 55, 'group-tokens': 40, 'sync-seconds': 55 },
  /** an answer within this share of the truth is right; a percentage may also be off by this many points (a whole-percent answer) */
  relTol: 0.02,
  pointTol: 0.5,
  /** the lesson's "70-90 % of wall-clock" is rollout: whole percents */
  shareMin: 70,
  shareMax: 90,
  /** decimals of a share inside a step */
  shareDigits: 4,
  /** the rollout throughput gain, in tenths: 1.5x to 8x */
  speedMin: 15,
  speedMax: 80,
  /** minutes of rollout and of training in the transfer level's step; the rollout share must stay in the band */
  rollMinutes: { min: 20, max: 99 },
  trainMinutes: { min: 5, max: 60 },
  /** two significant digits m, scaled by decades */
  mMin: 10,
  mMax: 99,
  /** samples in a group by level */
  groupSizes: [4, 4, 6, 8],
  /** a sample's output length: tokens (reasoning chains run to tens of thousands), or seconds at the transfer level */
  lenMin: 2000,
  lenMax: 64000,
  lenScales: [100, 1000],
  secScales: [1, 10],
  secMin: 20,
  secMax: 600,
  /** a group whose longest sample is not at least this many times the mean wastes too little to teach the tail */
  tailMinRatio: 1.25,
  /** attempts at drawing such a group before the last draw stands */
  drawTries: 40,
  /** tokens one step generates: prompts per step, samples per prompt, the mean output length */
  promptScales: [1, 10],
  promptMin: 32,
  promptMax: 512,
  samples: [4, 8, 16, 32],
  meanMin: 2000,
  meanMax: 32000,
  /** the transfer level mixes short and long samples: the short share (percent), and the two lengths */
  shortShares: [20, 30, 40, 50, 60, 70, 80],
  shortScales: [100],
  longScales: [1000],
  shortMin: 1000,
  shortMax: 5000,
  longMin: 10000,
  longMax: 40000,
  /** the weights: billions of parameters (two significant digits over two decades), a dtype, the shard count, the link in GB/s */
  paramScales: [1, 10],
  dtypes: ['bf16', 'fp8'],
  shards: [2, 4, 8, 16, 32, 64],
  linkMin: 10,
  linkMax: 100,
  linkStep: 5,
  /** the scene drawn when no draw fits (70 B at BF16 over 8 ranks and 50 GB/s) */
  fallback: { paramsB: 70, dtype: 'bf16', shards: 8, link: 50 },
  /** a sync worth asking about takes between these seconds */
  syncMinS: 0.5,
  syncMaxS: 120,
  /** a slip within this distance of a right answer (as a ratio) is not told from it */
  slipGuard: 0.05,
}

const TRANSFER: Level = 3 // gen-literal-ok: level 3 of the staircase
const ALL_LEVELS = [0, 1, 2, TRANSFER] as const

const VARIANTS: VariantSpec[] = [
  { id: 'rollout-share', title: 'Speedup when only the rollout gets faster', kcs: [KC.rolloutBoundRl], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['rollout-share'] },
  { id: 'long-tail', title: 'Idle slots while the longest sample finishes', kcs: [KC.rolloutBoundRl], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['long-tail'] },
  { id: 'group-tokens', title: 'Tokens one step generates', kcs: [KC.rolloutBoundRl], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['group-tokens'] },
  { id: 'sync-seconds', title: 'Seconds to sync sharded weights', kcs: [KC.weightSync], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['sync-seconds'] },
]
const spec = (id: string): VariantSpec => VARIANTS.find((x) => x.id === id)!

const CHECKPOINT_CLAIM = 'bench.checkpoint-engine.sync'

/* ------------------------------ pools ------------------------------ */

const range = (lo: number, hi: number, step = 1): number[] => {
  const out: number[] = []
  for (let x = lo; x <= hi; x += step) out.push(x)
  return out
}
/** Two significant digits over the given decades, between lo and hi. */
const twoSig = (scales: readonly number[], lo: number, hi: number): number[] => {
  const out: number[] = []
  for (let m = SYNTHETIC.mMin; m <= SYNTHETIC.mMax; m++) for (const s of scales) if (m * s >= lo && m * s <= hi) out.push(m * s)
  return out.sort((a, b) => a - b)
}

const SHARES = range(SYNTHETIC.shareMin, SYNTHETIC.shareMax)
const SPEEDS = range(SYNTHETIC.speedMin, SYNTHETIC.speedMax).map((n) => n / 10) // gen-literal-ok: tenths
const LENGTHS = twoSig(SYNTHETIC.lenScales, SYNTHETIC.lenMin, SYNTHETIC.lenMax)
const SECONDS = twoSig(SYNTHETIC.secScales, SYNTHETIC.secMin, SYNTHETIC.secMax)
const PROMPTS = twoSig(SYNTHETIC.promptScales, SYNTHETIC.promptMin, SYNTHETIC.promptMax)
const MEANS = twoSig(SYNTHETIC.lenScales, SYNTHETIC.meanMin, SYNTHETIC.meanMax)
const SHORTS = twoSig(SYNTHETIC.shortScales, SYNTHETIC.shortMin, SYNTHETIC.shortMax)
const LONGS = twoSig(SYNTHETIC.longScales, SYNTHETIC.longMin, SYNTHETIC.longMax)
const LINKS = range(SYNTHETIC.linkMin, SYNTHETIC.linkMax, SYNTHETIC.linkStep)
const PARAMS_B = twoSig(SYNTHETIC.paramScales, 0, Infinity)

/** A rollout and a training time (minutes) whose rollout share stays inside the lesson's band. */
const STEPS: { roll: number; train: number }[] = (() => {
  const out: { roll: number; train: number }[] = []
  const { rollMinutes: r, trainMinutes: t } = SYNTHETIC
  for (let roll = r.min; roll <= r.max; roll++) {
    for (let train = t.min; train <= t.max; train++) {
      const share = (100 * roll) / (roll + train)
      if (share >= SYNTHETIC.shareMin && share <= SYNTHETIC.shareMax) out.push({ roll, train })
    }
  }
  return out
})()

/* ------------------------------ the maths ------------------------------ */

const num = (p: Params, k: string): number => Number(p[k])
const bytesOf = (p: Params): number => DTYPE_BYTES[String(p.dtype) as keyof typeof DTYPE_BYTES]

/** The rollout's share of a step, 0 to 1: stated, or the minutes of rollout over the minutes of the step. */
const shareOf = (p: Params): number => (p.f !== undefined ? num(p, 'f') / 100 : num(p, 'rollMin') / (num(p, 'rollMin') + num(p, 'trainMin')))
const stepTime = (p: Params): number => 1 - shareOf(p) + shareOf(p) / num(p, 's')

const lengthsOf = (p: Params): number[] => range(1, num(p, 'k')).map((i) => num(p, `l${i}`))
const meanOf = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
const idlePct = (xs: number[]): number => (1 - meanOf(xs) / Math.max(...xs)) * 100 // gen-literal-ok: a share as a percentage; the 100 is the allow-listed one

/** The mean output length in tokens: stated, or the mix of a short and a long population. */
const meanTokens = (p: Params): number => (p.mean !== undefined ? num(p, 'mean') : (num(p, 'shortPct') * num(p, 'short') + (100 - num(p, 'shortPct')) * num(p, 'long')) / 100)

/** The link in GB/s: stated so, or in Gb/s at the transfer level. */
const linkGBps = (p: Params): number => (p.linkUnit === 'Gb/s' ? num(p, 'link') / BITS_PER_BYTE : num(p, 'link'))
const syncSeconds = (p: Params): number => (num(p, 'paramsB') * bytesOf(p)) / num(p, 'shards') / linkGBps(p)

function truthOf(variant: string, p: Params): number {
  switch (variant) {
    case 'rollout-share':
      return 1 / stepTime(p)
    case 'long-tail':
      return idlePct(lengthsOf(p))
    case 'group-tokens':
      return num(p, 'prompts') * num(p, 'samples') * meanTokens(p)
    default:
      return syncSeconds(p)
  }
}

const unitOf = (variant: string): string => (variant === 'rollout-share' ? '×' : variant === 'long-tail' ? '%' : variant === 'group-tokens' ? 'tokens' : 's')

/* ------------------------------ prompt and solution text ------------------------------ */

const t = (text: string): PromptPart => ({ t: 'text', text })
const v = (value: number, unit?: string, digits?: number): PromptPart => ({ t: 'value', value, ...(unit ? { unit } : {}), ...(digits === undefined ? {} : { digits }) })
const chip = (claim: string, unit?: string): PromptPart => ({ t: 'claim', claim, ...(unit ? { unit } : {}) })
const step = (text: PromptPart[], value: number, unit: string): SolutionStep => ({ text, result: { value, unit } })

function stemFor(variant: string, p: Params): PromptPart[] {
  switch (variant) {
    case 'rollout-share': {
      const tail = [t(' A new inference engine makes the rollout '), v(num(p, 's'), '×'), t(' faster; training and scoring are unchanged. How many times faster is the whole step?')]
      if (p.f !== undefined) return [t('In a hypothetical RL job, rollout takes '), v(num(p, 'f'), '%'), t(" of each step's wall-clock; training and scoring take the rest."), ...tail]
      return [t('In a hypothetical RL job, each step spends '), v(num(p, 'rollMin'), 'minutes'), t(' in rollout and '), v(num(p, 'trainMin'), 'minutes'), t(' in training and scoring.'), ...tail]
    }
    case 'long-tail': {
      const k = num(p, 'k')
      const seconds = p.unit === 's'
      const rows = lengthsOf(p).map((x, i) => [i + 1, x])
      return [
        t(`A hypothetical RL group decodes ${k} samples in ${k} sequence slots, all at one rate. A slot sits idle once its sample ends, and the group is scored only when the longest sample is done. `),
        t(seconds ? 'The table gives how long each sample took to decode.' : 'The table gives each sample’s output length.'),
        { t: 'table', caption: seconds ? 'Decode time of each sample (seconds)' : 'Output length of each sample (tokens)', columns: ['Sample', seconds ? 'Decode time (s)' : 'Output tokens'], rows },
        t('What share of the group’s slot-time is idle until the group ends?'),
      ]
    }
    case 'group-tokens': {
      const lead = [t('A hypothetical RL step takes '), v(num(p, 'prompts'), 'prompts'), t(' and decodes '), v(num(p, 'samples'), 'samples'), t(' for each. ')]
      if (p.mean !== undefined) return [...lead, t('Each sample runs '), v(num(p, 'mean'), 'tokens'), t(' on average. How many tokens does one step generate?')]
      return [
        ...lead,
        v(num(p, 'shortPct'), '%'),
        t(' of the samples are short, '),
        v(num(p, 'short'), 'tokens'),
        t(' each, and the rest are long, '),
        v(num(p, 'long'), 'tokens'),
        t(' each. How many tokens does one step generate?'),
      ]
    }
    default: {
      const bits = p.linkUnit === 'Gb/s'
      const bytes = bytesOf(p)
      return [
        t('A hypothetical RL job pushes new weights, '),
        v(num(p, 'paramsB'), 'billion parameters'),
        t(` at ${String(p.dtype).toUpperCase()} (${formatNumber(bytes)} ${bytes === 1 ? 'byte' : 'bytes'} per parameter), to its rollout workers. The weights are split over `),
        v(num(p, 'shards'), 'ranks'),
        t(' (a synthetic shard count), and each rank pulls only its slice over a link of '),
        v(num(p, 'link'), bits ? 'Gb/s' : 'GB/s'),
        t(`. How many seconds does one sync take${bits ? '? (A byte is 8 bits.)' : '?'}`),
      ]
    }
  }
}

function steps(variant: string, p: Params, truth: number): SolutionStep[] {
  const unit = unitOf(variant)
  switch (variant) {
    case 'rollout-share': {
      const f = shareOf(p)
      const out: SolutionStep[] = []
      if (p.f === undefined) out.push(step([t('Rollout share = rollout ÷ step = '), v(num(p, 'rollMin'), 'min'), t(' ÷ ('), v(num(p, 'rollMin')), t(' + '), v(num(p, 'trainMin')), t(')')], f * 100, '%')) // gen-literal-ok: a share as a percentage; the 100 is the allow-listed one
      out.push(
        step([t('Training and scoring keep their share: 1 − f = 1 − '), v(f, undefined, SYNTHETIC.shareDigits)], 1 - f, ''),
        step([t('Rollout now takes f ÷ s = '), v(f, undefined, SYNTHETIC.shareDigits), t(' ÷ '), v(num(p, 's'))], f / num(p, 's'), ''),
        step([t('The new step takes (1 − f) + f ÷ s of the old one')], stepTime(p), ''),
        step([t('Speedup = 1 ÷ the new step time')], truth, unit),
      )
      return out
    }
    case 'long-tail': {
      const xs = lengthsOf(p)
      const max = Math.max(...xs)
      const mean = meanOf(xs)
      const u = p.unit === 's' ? 's' : 'tokens'
      return [
        step([t('Mean = sum ÷ samples = '), v(xs.reduce((a, b) => a + b, 0), u), t(' ÷ '), v(xs.length)], mean, u),
        step([t('The group lasts as long as its longest sample: max = '), v(max, u)], max, u),
        step([t('Busy share of slot-time = mean ÷ max = '), v(mean, u, 1), t(' ÷ '), v(max, u)], (mean / max) * 100, '%'), // gen-literal-ok: a share as a percentage; the 100 is the allow-listed one
        step([t('Idle share = 1 − mean ÷ max')], truth, unit),
      ]
    }
    case 'group-tokens': {
      const mean = meanTokens(p)
      const out: SolutionStep[] = [
        p.mean === undefined
          ? step([t('Mean length = short share × short + long share × long = '), v(num(p, 'shortPct'), '%'), t(' × '), v(num(p, 'short')), t(' + the rest × '), v(num(p, 'long'))], mean, 'tokens')
          : step([t('Mean length of a sample, as given = '), v(mean, 'tokens')], mean, 'tokens'),
      ]
      out.push(
        step([t('Samples per step = prompts × samples per prompt = '), v(num(p, 'prompts')), t(' × '), v(num(p, 'samples'))], num(p, 'prompts') * num(p, 'samples'), 'samples'),
        step([t('Tokens per step = samples × mean length = '), v(num(p, 'prompts') * num(p, 'samples')), t(' × '), v(mean)], truth, unit),
      )
      return out
    }
    default: {
      const bits = p.linkUnit === 'Gb/s'
      const payload = num(p, 'paramsB') * bytesOf(p)
      const slice = payload / num(p, 'shards')
      const out: SolutionStep[] = []
      if (bits) out.push(step([t('Link in GB/s = Gb/s ÷ 8 = '), v(num(p, 'link'), 'Gb/s'), t(' ÷ 8')], linkGBps(p), 'GB/s'))
      out.push(
        step([t('Payload = parameters × bytes per parameter = '), v(num(p, 'paramsB'), 'billion'), t(' × '), v(bytesOf(p))], payload, 'GB'),
        step([t('Each rank pulls only its slice = payload ÷ ranks = '), v(payload, 'GB'), t(' ÷ '), v(num(p, 'shards'))], slice, 'GB'),
        step([t('Seconds = slice ÷ link bandwidth')], truth, unit),
      )
      return out
    }
  }
}

/** The line after a `sync-seconds` solution: the one published figure, as a comparison and nothing more. */
function comparison(): SolutionStep {
  return {
    text: [
      t('For scale only: MoonshotAI reports that checkpoint-engine updates a 1-trillion-parameter model across thousands of GPUs in about '),
      chip(CHECKPOINT_CLAIM, 'seconds'),
      t(". Its README states no byte count, shard count or link bandwidth, so this is a comparison, not a check on your number."),
    ],
  }
}

/** What a level shows before the question: nothing at levels 2 and 3; at 0 every step but the last; at 1 the same with a middle step's result left blank. */
function workedFor(level: Level, all: SolutionStep[]): SolutionStep[] | undefined {
  if (level > 1) return undefined
  const shown = all.slice(0, -1)
  if (level === 0) return shown
  const blank = Math.floor(shown.length / 2)
  return shown.map((s, i) => (i === blank ? { ...s, blank: true } : s))
}

/* ------------------------------ building an instance ------------------------------ */

function build(vs: VariantSpec, level: Level, seed: number, p: Params): Instance {
  const truth = truthOf(vs.id, p)
  const worked = workedFor(level, steps(vs.id, p, truth))
  const prompt: Prompt = { stem: stemFor(vs.id, p), ...(worked ? { worked } : {}) }
  const pct = vs.id === 'long-tail'
  return finishInstance(gen, {
    variant: vs.id,
    seed,
    level,
    params: p,
    kcs: [...vs.kcs],
    prompt,
    answer: { kind: 'numeric', truth, unit: unitOf(vs.id), tolerance: { rel: SYNTHETIC.relTol, ...(pct ? { abs: SYNTHETIC.pointTol } : {}) } },
    claims: vs.id === 'sync-seconds' ? [claimRef(CHECKPOINT_CLAIM)] : [],
    nsec: vs.nsec,
  })
}

/* ------------------------------ drawing params ------------------------------ */

/** k lengths from a pool, redrawn until the longest is clearly longer than the mean. */
function drawLengths(r: Rng, k: number, pool: readonly number[]): Params {
  let xs: number[] = []
  for (let i = 0; i < SYNTHETIC.drawTries; i++) {
    xs = range(1, k).map(() => r.pick(pool))
    if (Math.max(...xs) / meanOf(xs) >= SYNTHETIC.tailMinRatio) break
  }
  return { k, ...Object.fromEntries(xs.map((x, i) => [`l${i + 1}`, x])) }
}

/** A size, a dtype and a link, with the shard count (one of the pool) whose sync takes a believable number of seconds; redrawn if none does. */
function drawSync(r: Rng): { paramsB: number; dtype: string; shards: number; link: number } {
  for (let i = 0; i < SYNTHETIC.drawTries; i++) {
    const paramsB = r.pick(PARAMS_B)
    const dtype = r.pick(SYNTHETIC.dtypes)
    const link = r.pick(LINKS)
    const fits = SYNTHETIC.shards.filter((shards) => {
      const seconds = (paramsB * DTYPE_BYTES[dtype as keyof typeof DTYPE_BYTES]) / shards / link
      return seconds >= SYNTHETIC.syncMinS && seconds <= SYNTHETIC.syncMaxS
    })
    if (fits.length > 0) return { paramsB, dtype, link, shards: r.pick(fits) }
  }
  return { paramsB: SYNTHETIC.fallback.paramsB, dtype: SYNTHETIC.fallback.dtype, shards: SYNTHETIC.fallback.shards, link: SYNTHETIC.fallback.link }
}

function draw(variant: string, level: Level, r: Rng): Params {
  switch (variant) {
    case 'rollout-share': {
      const s = r.pick(SPEEDS)
      if (level < TRANSFER) return { f: r.pick(SHARES), s }
      const { roll, train } = r.pick(STEPS)
      return { rollMin: roll, trainMin: train, s }
    }
    case 'long-tail':
      return level < TRANSFER ? drawLengths(r, SYNTHETIC.groupSizes[level], LENGTHS) : { ...drawLengths(r, SYNTHETIC.groupSizes[level], SECONDS), unit: 's' }
    case 'group-tokens': {
      const base = { prompts: r.pick(PROMPTS), samples: r.pick(SYNTHETIC.samples) }
      return level < TRANSFER ? { ...base, mean: r.pick(MEANS) } : { ...base, shortPct: r.pick(SYNTHETIC.shortShares), short: r.pick(SHORTS), long: r.pick(LONGS) }
    }
    default: {
      const scene = drawSync(r)
      const p = { paramsB: scene.paramsB, dtype: scene.dtype, shards: scene.shards }
      // the transfer level quotes the link in gigabits per second, as a NIC datasheet does
      return level < TRANSFER ? { ...p, link: scene.link, linkUnit: 'GB/s' } : { ...p, link: scene.link * BITS_PER_BYTE, linkUnit: 'Gb/s' }
    }
  }
}

function make(seed: number, level: Level, variant?: string): Instance {
  const vs = resolveVariant(gen, seed, level, variant)
  return build(vs, level, seed, draw(vs.id, level, rngFor(gen.id, vs.id, level, seed)))
}

/* ------------------------------ grading ------------------------------ */

/** A slip ratio, or null when it is too close to 1 to tell from a right answer. */
const slip = (ratio: number): number | null => (Math.abs(ratio - 1) > SYNTHETIC.slipGuard ? ratio : null)

const RATIO_RULES: RatioRule[] = [
  {
    id: 'rollout.linear',
    // the rollout's speedup s taken as the step's: the speedup over the step's new time, s ÷ (1 ÷ time)
    ratio: (i) => (i.variant === 'rollout-share' ? slip(num(i.params, 's') * stepTime(i.params)) : null),
    message: "You gave the rollout's own speedup as the step's. Training and scoring did not get faster, so they cap the gain: the step takes (1 − f) + f ÷ s of its old time, and the speedup is 1 over that.",
  },
  {
    id: 'rollout.mean-not-max',
    // the gap divided by the mean length instead of the longest: (max − mean) ÷ mean against (max − mean) ÷ max
    ratio: (i) => {
      if (i.variant !== 'long-tail') return null
      const xs = lengthsOf(i.params)
      return slip(Math.max(...xs) / meanOf(xs))
    },
    message: 'You measured the gap against the mean length. The group lasts as long as its longest sample, so every slot is held for the max: idle share = 1 − mean ÷ max.',
  },
  {
    id: 'rollout.unsliced',
    ratio: (i) => (i.variant === 'sync-seconds' ? num(i.params, 'shards') : null),
    message: 'You moved the whole checkpoint through one link. The weights are split over S ranks and each pulls only its slice, so divide the payload by S before dividing by the link.',
  },
  {
    id: 'rollout.bits-bytes',
    ratio: (i) => (i.variant === 'sync-seconds' && i.params.linkUnit === 'Gb/s' ? 1 / BITS_PER_BYTE : null),
    message: 'You read the link’s gigabits per second as gigabytes. A byte is 8 bits, so divide the Gb/s figure by 8 before dividing the slice by it.',
  },
]

const pin = (name: string, variant: string, p: Params, truthValue: number, abs: number) => ({
  name,
  source: 't6.l7',
  make: () => build(spec(variant), 0, 1, p),
  truth: truthValue,
  tolerance: { abs },
})

const gen: Gen = {
  id: 'rollout',
  version: 1,
  title: 'Rollout: step speedup, the long tail, tokens per step and weight sync',
  kcs: [KC.rolloutBoundRl, KC.weightSync],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution: (inst) => {
    const truth = inst.answer.kind === 'choice' ? 0 : inst.answer.truth
    const out = steps(inst.variant, inst.params, truth)
    return inst.variant === 'sync-seconds' ? [...out, comparison()] : out
  },
  pins: [
    // rollout at 80 % of the step (inside t6.l7's 70-90 % band), made 2× faster: 1 ÷ (0.2 + 0.4) = 5/3
    pin('Rollout is 80 % of a step and gets 2× faster: the step is 1.67× faster, not 2× (t6.l7)', 'rollout-share', { f: 80, s: 2 }, 5 / 3, 0.005), // gen-literal-ok: pinned lesson arithmetic
    // 2k, 4k, 6k, 8k tokens: mean 5k against max 8k
    pin('A group of 2k, 4k, 6k and 8k-token samples idles 37.5 % of its slots until the 8k one ends (t6.l7)', 'long-tail', { k: 4, l1: 2000, l2: 4000, l3: 6000, l4: 8000 }, 37.5, 0.05), // gen-literal-ok: pinned lesson arithmetic
    pin('256 prompts × 16 samples × 4,000 tokens is 16.384 million tokens per step (t6.l7)', 'group-tokens', { prompts: 256, samples: 16, mean: 4000 }, 16_384_000, 1), // gen-literal-ok: pinned lesson arithmetic
    // 200 B parameters in BF16 are the 400 GB payload of t6.l7; over 8 ranks and a 50 GB/s link, 1 s
    pin('A 400 GB payload (200 B parameters in BF16) split over 8 ranks on a 50 GB/s link syncs in 1 s (t6.l7)', 'sync-seconds', { paramsB: 200, dtype: 'bf16', shards: 8, link: 50, linkUnit: 'GB/s' }, 1, 0.005), // gen-literal-ok: pinned lesson arithmetic
  ],
}

export default gen
