/**
 * The `cost` family (docs/specs/wave-2.md §5.3; KCs t7.cost-per-mtok, t6.ep-economics,
 * t6.agent-prefix-locality): dollars per million tokens from a GPU price and a throughput, the
 * throughput a price target needs, a node-day priced the way t6.l2 and t7.l4 price SGLang's DeepSeek
 * run, and the blended input price of a prompt cache.
 *
 * Real-world numbers come only through claims: the dated H100 and B200 median rental prices, the
 * lessons' assumed $2 per GPU-hour (a synthetic claim), SGLang's published node throughput and the
 * cache-read multipliers. Everything else (a hypothetical node's size and speed, a target price, a
 * base input price, a hit rate) is declared in SYNTHETIC and announced as hypothetical in the prompt.
 * A claim-backed scene stores no claim-derived number in its params, so a level-0 instance can show
 * the lessons' real figures and the params stay round.
 *
 * The diagnoses are the slips of the plan: one GPU's hour against a node's tokens, seconds against
 * hours, thousands against millions, every token counted instead of the ones within the SLO, hits
 * priced as misses (or no discount at all), and output tokens priced as input.
 */

import { claimNumber, getClaim } from '@/data/claims'
import { KC } from '@/data/kc/ids'
import { claimRef, finishInstance, resolveVariant, rngFor, type Rng } from '@/lib/items/core'
import { gradeResponse } from '@/lib/items/grade'
import type { Gen, Instance, Level, Params, Prompt, PromptPart, RatioRule, SolutionStep, VariantSpec } from '@/lib/items/types'
import { formatNumber } from '@/lib/items/units'

const SYNTHETIC = {
  /** 1 in N node scenes is SGLang's DeepSeek run (claims) instead of a hypothetical node */
  sglangOneIn: 3,
  /** 1 in N hypothetical prices is a dated median rental price (a claim) instead of a hypothetical one */
  claimPriceOneIn: 3,
  /** nominal seconds per variant */
  nsec: { 'per-mtok': 50, 'required-tps': 50, 'node-day': 55, 'cache-discount': 60 },
  /** an answer within this share of the truth is right */
  relTol: 0.02,
  /** hypothetical rental prices in USD per GPU-hour: tenths from 0.8 to 9.9 */
  rateMin: 8,
  rateMax: 99,
  tenth: 10,
  gpus: [2, 4, 8, 16],
  /** two significant digits m, scaled by decades: node throughputs, targets, base prices and token counts */
  mMin: 10,
  mMax: 99,
  /** the decades of each pool: node tok/s, prefixes, new tokens, output tokens */
  nodeScales: [10, 100, 1000],
  prefixScales: [100, 1000],
  tokenScales: [10, 100],
  /** decimals of a price per million tokens inside a step */
  priceDigits: 3,
  /** a hypothetical GPU sustains between these output tokens per second */
  perGpuMin: 300,
  perGpuMax: 8000,
  /** the share of output tokens that meet the SLO (percent) */
  sloMin: 50,
  sloMax: 95,
  sloStep: 5,
  /** base input prices in USD per million tokens: tenths from 0.5 to 9.9 */
  baseMin: 5,
  baseMax: 99,
  /** cache hit rates (percent) of a stated request */
  hitMin: 50,
  hitMax: 95,
  hitStep: 5,
  /** cache-read multipliers of a hypothetical provider */
  mults: [0.5, 0.3, 0.25, 0.2, 0.15],
  /** a loop's history may hit at most this share (percent) and at least this share of it is new */
  loopHitMax: 97,
  loopHitMin: 50,
  /** output tokens of a loop turn */
  outMin: 200,
  outMax: 8000,
  /** the output price is this many times the base input price */
  outMults: [3, 4, 5],
  /** a slip within this distance of a right answer (as a ratio) is not told from it */
  slipGuard: 0.05,
}

const TRANSFER: Level = 3 // gen-literal-ok: level 3 of the staircase
const ALL_LEVELS = [0, 1, 2, TRANSFER] as const
const HOUR_S = 3600 // gen-literal-ok: seconds per hour
const DAY_H = 24 // gen-literal-ok: hours per day
const DAY_S = HOUR_S * DAY_H
const MILLION = 1_000_000 // gen-literal-ok: tokens per million
const THOUSAND = 1000 // gen-literal-ok: turns per thousand, and a kilo prefix

const VARIANTS: VariantSpec[] = [
  { id: 'per-mtok', title: 'Dollars per million tokens', kcs: [KC.costPerMtok], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['per-mtok'] },
  { id: 'required-tps', title: 'Throughput a price target needs', kcs: [KC.costPerMtok], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['required-tps'] },
  { id: 'node-day', title: 'Pricing a node-day', kcs: [KC.epEconomics], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['node-day'] },
  { id: 'cache-discount', title: 'Blended input price with a prompt cache', kcs: [KC.agentPrefixLocality], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['cache-discount'] },
]
const spec = (id: string): VariantSpec => VARIANTS.find((x) => x.id === id)!

/* ------------------------------ claims ------------------------------ */

const PRICE_CLAIMS: Record<string, string> = { h100: 'price.h100.median', b200: 'price.b200.median', lessons: 'synthetic.cost.gpu-hourly' }
const PRICE_NAMES: Record<string, string> = { h100: 'H100', b200: 'B200' }
const SGLANG_GPUS = 'serving.sglang-deepseek.gpus-per-node'
const SGLANG_TPS = 'serving.sglang-deepseek.output-tps-per-node'
const MULT_CLAIMS: Record<string, string> = {
  std: 'serving.cache.anthropic-read-multiplier',
  opus: 'serving.cache.anthropic-opus-5-5-read-multiplier',
  fable: 'serving.cache.anthropic-fable-5-1-read-multiplier',
}
const MULT_NAMES: Record<string, string> = { std: "Anthropic's standard rate", opus: "Anthropic's rate for Claude Opus 5.5", fable: "Anthropic's rate for Claude Fable 5.1" }

/* ------------------------------ pools ------------------------------ */

/** Two significant digits over the given decades. */
const twoSig = (...scales: number[]): number[] => {
  const out: number[] = []
  for (let m = SYNTHETIC.mMin; m <= SYNTHETIC.mMax; m++) for (const s of scales) out.push(m * s)
  return out
}
const range = (lo: number, hi: number, step = 1): number[] => {
  const out: number[] = []
  for (let x = lo; x <= hi; x += step) out.push(x)
  return out
}
const tenths = (lo: number, hi: number): number[] => range(lo, hi).map((n) => n / SYNTHETIC.tenth)

const RATES = tenths(SYNTHETIC.rateMin, SYNTHETIC.rateMax)
const BASES = tenths(SYNTHETIC.baseMin, SYNTHETIC.baseMax)
/** node throughput candidates, and a target price in USD per million tokens: hundredths to tenths over a decade */
const NODE_TPS = twoSig(...SYNTHETIC.nodeScales)
const GPU_TPS = NODE_TPS.filter((x) => x >= SYNTHETIC.perGpuMin && x <= SYNTHETIC.perGpuMax)
const TARGETS = [...twoSig(1 / 100), ...twoSig(1 / 10)].map((x) => Math.round(x * 100) / 100)
const SLOS = range(SYNTHETIC.sloMin, SYNTHETIC.sloMax, SYNTHETIC.sloStep)
const HITS = range(SYNTHETIC.hitMin, SYNTHETIC.hitMax, SYNTHETIC.hitStep)
const PREFIXES = twoSig(...SYNTHETIC.prefixScales)
const FRESH = twoSig(...SYNTHETIC.tokenScales)
const OUTS = twoSig(...SYNTHETIC.tokenScales).filter((x) => x >= SYNTHETIC.outMin && x <= SYNTHETIC.outMax)

/* ------------------------------ the maths ------------------------------ */

const num = (p: Params, k: string): number => Number(p[k])
const sglang = (p: Params): boolean => p.dep === 'sglang'
const rateOf = (p: Params): number => (PRICE_CLAIMS[String(p.price)] ? claimNumber(PRICE_CLAIMS[String(p.price)]) : num(p, 'rate'))
const gpusOf = (p: Params): number => (sglang(p) ? claimNumber(SGLANG_GPUS) : num(p, 'gpus'))
const nodeTps = (p: Params): number => (sglang(p) ? claimNumber(SGLANG_TPS) : p.tpsGpu === undefined ? num(p, 'tps') : num(p, 'tpsGpu') * gpusOf(p))
/** The share of output tokens that count (1 unless an SLO is stated). */
const useful = (p: Params): number => (p.slo === undefined ? 1 : num(p, 'slo') / 100)
const multOf = (p: Params): number => (MULT_CLAIMS[String(p.mult)] ? claimNumber(MULT_CLAIMS[String(p.mult)]) : num(p, 'm'))
const hitOf = (p: Params): number => (p.prefix === undefined ? num(p, 'hit') / 100 : num(p, 'prefix') / (num(p, 'prefix') + num(p, 'fresh')))
const loop = (p: Params): boolean => p.prefix !== undefined

/** What a wrong answer to a cache question would be: the right one, hits and misses swapped, no discount, or output priced as input. */
type Slip = 'right' | 'swap' | 'none' | 'out-as-in'

/** The blended input price in USD per million tokens: misses at the base price, hits at the multiplier times it. */
function blendedOf(p: Params, slip: Slip): number {
  const h = slip === 'swap' ? 1 - hitOf(p) : hitOf(p)
  return num(p, 'base') * (1 - h + h * (slip === 'none' ? 1 : multOf(p)))
}

function cacheCost(p: Params, slip: Slip): number {
  const blended = blendedOf(p, slip)
  if (p.outTokens === undefined) return blended
  const input = (num(p, 'prefix') + num(p, 'fresh')) * blended
  const output = num(p, 'outTokens') * num(p, 'base') * (slip === 'out-as-in' ? 1 : num(p, 'outMult'))
  return ((input + output) * THOUSAND) / MILLION
}

function truthOf(variant: string, p: Params): number {
  switch (variant) {
    case 'per-mtok':
      return (rateOf(p) * gpusOf(p) * MILLION) / (nodeTps(p) * HOUR_S * useful(p))
    case 'required-tps':
      return (rateOf(p) * MILLION) / (num(p, 'target') * HOUR_S)
    case 'node-day':
      return (rateOf(p) * gpusOf(p) * DAY_H * MILLION) / (nodeTps(p) * DAY_S)
    default:
      return cacheCost(p, 'right')
  }
}

const unitOf = (variant: string, p: Params): string =>
  variant === 'required-tps' ? 'tok/s per GPU' : variant === 'cache-discount' && p.outTokens !== undefined ? 'USD per 1,000 turns' : 'USD/Mtok'

/* ------------------------------ prompt and solution text ------------------------------ */

const t = (text: string): PromptPart => ({ t: 'text', text })
const v = (value: number, unit?: string, digits?: number): PromptPart => ({ t: 'value', value, ...(unit ? { unit } : {}), ...(digits === undefined ? {} : { digits }) })
const chip = (claim: string, unit?: string): PromptPart => ({ t: 'claim', claim, ...(unit ? { unit } : {}) })
const step = (text: PromptPart[], value: number, unit: string): SolutionStep => ({ text, result: { value, unit } })

/** The node: SGLang's run through its claims, or a hypothetical one. */
function nodeParts(p: Params): PromptPart[] {
  if (sglang(p)) return [t("In SGLang's DeepSeek reproduction each node has "), chip(SGLANG_GPUS, 'H100 GPUs'), t(' and generates '), chip(SGLANG_TPS, 'output tokens per second'), t(' across the node. ')]
  const g = num(p, 'gpus')
  if (p.tpsGpu !== undefined) return [t(`In a hypothetical node of ${g} GPUs, each GPU generates `), v(num(p, 'tpsGpu'), 'output tokens per second'), t('. ')]
  return [t(`A hypothetical node of ${g} GPUs generates `), v(num(p, 'tps'), 'output tokens per second'), t(' across the node. ')]
}

/** The GPU-hour price: a dated median, the lessons' assumption or a hypothetical number. */
function priceParts(p: Params): PromptPart[] {
  const key = String(p.price)
  if (key === 'lessons') return [t('A GPU-hour costs '), chip(PRICE_CLAIMS[key], 'USD per GPU-hour'), t(', the price the lessons assume. ')]
  if (PRICE_CLAIMS[key]) return [t(`A GPU-hour costs the median on-demand ${PRICE_NAMES[key]} rental price, `), chip(PRICE_CLAIMS[key], 'USD per GPU-hour'), t(` (checked ${getClaim(PRICE_CLAIMS[key]).verifiedAt}). `)]
  return [t('A GPU-hour costs a hypothetical '), v(num(p, 'rate'), 'USD'), t('. ')]
}

/** The cache-read price: a published multiplier through its claim, or a hypothetical provider's. */
function multParts(p: Params): PromptPart[] {
  const key = String(p.mult)
  if (MULT_CLAIMS[key]) return [t(`Cache-read tokens are billed at `), chip(MULT_CLAIMS[key], '× the base price'), t(` (${MULT_NAMES[key]}). `)]
  return [t('A hypothetical provider bills cache-read tokens at '), v(num(p, 'm'), '× the base price'), t('. ')]
}

function stemFor(variant: string, p: Params): PromptPart[] {
  switch (variant) {
    case 'per-mtok':
      return [
        ...nodeParts(p),
        ...priceParts(p),
        t(p.slo === undefined ? 'What does it cost per million output tokens, in USD?' : `Only ${num(p, 'slo')} % of those tokens meet the latency SLO. What does it cost per million output tokens delivered within the SLO, in USD?`),
      ]
    case 'required-tps': {
      const g = num(p, 'gpus')
      const price = p.perNode === true ? [t(`The node rents for a hypothetical `), v(num(p, 'rate') * g, 'USD per hour'), t('. ')] : priceParts(p)
      return [t(`A node has ${g} GPUs, and every token counts. `), ...price, t('To reach '), v(num(p, 'target'), 'USD per million output tokens'), t(', how many output tokens per second must each GPU sustain?')]
    }
    case 'node-day':
      return [...nodeParts(p), ...priceParts(p), t('Price one full node-day (every GPU, 24 hours): what does a million output tokens cost, in USD?')]
    default: {
      const where = loop(p)
        ? [t('An agent loop re-sends a history of '), v(num(p, 'prefix'), 'tokens'), t(' every turn and adds '), v(num(p, 'fresh'), 'new tokens'), t('; the whole history hits the cache. ')]
        : [t('In one request '), v(num(p, 'hit'), '%'), t(' of the input tokens hit the cache. ')]
      const head = [t('A hypothetical model charges '), v(num(p, 'base'), 'USD'), t(' per million input tokens (the base price). '), ...multParts(p), ...where]
      if (p.outTokens === undefined) return [...head, t('What is the blended input price, in USD per million input tokens?')]
      return [...head, t('Each turn also generates '), v(num(p, 'outTokens'), 'output tokens'), t(', billed at '), v(num(p, 'outMult'), '× the base price'), t('. What do 1,000 turns cost, in USD?')]
    }
  }
}

function steps(variant: string, p: Params, truth: number): SolutionStep[] {
  const rate = rateOf(p)
  const g = gpusOf(p)
  const unit = unitOf(variant, p)
  switch (variant) {
    case 'per-mtok': {
      const tokens = nodeTps(p) * HOUR_S
      const out = [
        step([t('Node cost per hour = price × GPUs = '), v(rate, 'USD/GPU-hr'), t(' × '), v(g, 'GPUs')], rate * g, 'USD/hr'),
        step([t('Tokens per hour = tok/s × 3,600 s = '), v(nodeTps(p), 'tok/s'), t(' × 3,600')], tokens, 'tokens'),
      ]
      if (p.slo !== undefined) out.push(step([t('Tokens within the SLO per hour = tokens × '), v(num(p, 'slo'), '%')], tokens * useful(p), 'tokens'))
      out.push(step([t('Cost per million tokens = cost per hour ÷ tokens per hour × 1,000,000')], truth, unit))
      return out
    }
    case 'required-tps': {
      const perDollar = MILLION / num(p, 'target')
      const out = [
        step([t('Tokens one dollar buys = 1,000,000 ÷ target = 1,000,000 ÷ '), v(num(p, 'target'), 'USD/Mtok')], perDollar, 'tokens'),
        step([t('Tokens one GPU-hour must deliver = tokens per dollar × price = '), v(perDollar, 'tokens'), t(' × '), v(rate, 'USD/GPU-hr')], perDollar * rate, 'tokens'),
        step([t('Tokens per second = tokens per GPU-hour ÷ 3,600')], truth, unit),
      ]
      if (p.perNode === true) out.unshift(step([t('Price per GPU-hour = node price ÷ GPUs = '), v(rate * g, 'USD/hr'), t(' ÷ '), v(g, 'GPUs')], rate, 'USD/GPU-hr'))
      return out
    }
    case 'node-day': {
      const out = [
        step([t('Tokens per node-day = tok/s × 86,400 s = '), v(nodeTps(p), 'tok/s'), t(' × 86,400')], nodeTps(p) * DAY_S, 'tokens'),
        step([t('Cost per node-day = price × GPUs × 24 h = '), v(rate, 'USD/GPU-hr'), t(' × '), v(g, 'GPUs'), t(' × 24')], rate * g * DAY_H, 'USD'),
        step([t('Cost per million tokens = cost ÷ tokens × 1,000,000')], truth, unit),
      ]
      if (p.tpsGpu !== undefined) out.unshift(step([t('Node tok/s = per-GPU tok/s × GPUs = '), v(num(p, 'tpsGpu'), 'tok/s'), t(' × '), v(g, 'GPUs')], nodeTps(p), 'tok/s'))
      return out
    }
    default: {
      const h = hitOf(p)
      const base = num(p, 'base')
      const blended = blendedOf(p, 'right')
      const out: SolutionStep[] = []
      if (loop(p)) out.push(step([t('Hit rate = history ÷ (history + new) = '), v(num(p, 'prefix'), 'tokens'), t(' ÷ ('), v(num(p, 'prefix')), t(' + '), v(num(p, 'fresh')), t(')')], h * 100, '%'))
      out.push(step([t('Miss share = 100 % − hit rate = 100 − '), v(h * 100, '%', 1)], 100 - h * 100, '%'))
      out.push(step([t('Cache-read price = multiplier × base = '), v(multOf(p)), t(' × '), v(base, 'USD/Mtok')], multOf(p) * base, 'USD/Mtok'))
      out.push(step([t('Blended input price = miss share × base + hit rate × cache-read price')], blended, 'USD/Mtok'))
      if (p.outTokens === undefined) return out
      const turn = p.prefix === undefined ? 0 : num(p, 'prefix') + num(p, 'fresh')
      const input = (turn * blended * THOUSAND) / MILLION
      out.push(step([t('Input cost of 1,000 turns = tokens per turn × blended price × 1,000 ÷ 1,000,000 = '), v(turn, 'tokens'), t(' × '), v(blended, 'USD/Mtok', SYNTHETIC.priceDigits)], input, 'USD'))
      out.push(step([t('Output cost of 1,000 turns = output tokens × output price × 1,000 ÷ 1,000,000 = '), v(num(p, 'outTokens'), 'tokens'), t(' × '), v(base * num(p, 'outMult'), 'USD/Mtok', SYNTHETIC.priceDigits)], truth - input, 'USD'))
      out.push(step([t('Total for 1,000 turns = input + output')], truth, unit))
      return out
    }
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

function claimsOf(variant: string, p: Params): string[] {
  const out: string[] = []
  if (variant === 'cache-discount') {
    if (MULT_CLAIMS[String(p.mult)]) out.push(MULT_CLAIMS[String(p.mult)])
    return out
  }
  if (PRICE_CLAIMS[String(p.price)]) out.push(PRICE_CLAIMS[String(p.price)])
  if (sglang(p)) out.push(SGLANG_GPUS, SGLANG_TPS)
  return out
}

function build(vs: VariantSpec, level: Level, seed: number, p: Params): Instance {
  const truth = truthOf(vs.id, p)
  const all = steps(vs.id, p, truth)
  const worked = workedFor(level, all)
  const prompt: Prompt = { stem: stemFor(vs.id, p), ...(worked ? { worked } : {}) }
  return finishInstance(gen, {
    variant: vs.id,
    seed,
    level,
    params: p,
    kcs: [...vs.kcs],
    prompt,
    answer: { kind: 'numeric', truth, unit: unitOf(vs.id, p), tolerance: { rel: SYNTHETIC.relTol } },
    claims: claimsOf(vs.id, p).map(claimRef),
    nsec: vs.nsec,
  })
}

/* ------------------------------ drawing params ------------------------------ */

/** A dated median price (a claim) or a hypothetical one. */
const drawPrice = (r: Rng, claims: string[]): Params => (r.int(0, SYNTHETIC.claimPriceOneIn - 1) === 0 ? { price: r.pick(claims) } : { price: 'custom', rate: r.pick(RATES) })

/** SGLang's run (a claim scene with no numeric params) or a hypothetical node; the transfer level of a node-day gives per-GPU speed. */
function drawNode(r: Rng, perGpu: boolean): Params {
  if (!perGpu && r.int(0, SYNTHETIC.sglangOneIn - 1) === 0) return { dep: 'sglang', price: r.pick(['lessons', 'h100']) }
  const g = r.pick(SYNTHETIC.gpus)
  const speed: Params = perGpu ? { tpsGpu: r.pick(GPU_TPS) } : { tps: r.pick(NODE_TPS.filter((x) => x >= g * SYNTHETIC.perGpuMin && x <= g * SYNTHETIC.perGpuMax)) }
  return { dep: 'synthetic', gpus: g, ...speed, ...drawPrice(r, ['h100', 'b200']) }
}

function drawCache(r: Rng, level: Level): Params {
  const key = r.int(0, 1) === 0 ? r.pick(Object.keys(MULT_CLAIMS)) : 'custom'
  const p: Params = { base: r.pick(BASES), mult: key, ...(key === 'custom' ? { m: r.pick(SYNTHETIC.mults) } : {}) }
  if (level < 2) return { ...p, hit: r.pick(HITS) }
  // the history is at most loopHitMax % of the prompt and at least loopHitMin %
  const prefix = r.pick(PREFIXES)
  const fresh = r.pick(
    FRESH.filter((x) => {
      const hit = (100 * prefix) / (prefix + x)
      return hit >= SYNTHETIC.loopHitMin && hit <= SYNTHETIC.loopHitMax
    }),
  )
  const loopP = { ...p, prefix, fresh }
  return level < TRANSFER ? loopP : { ...loopP, outTokens: r.pick(OUTS), outMult: r.pick(SYNTHETIC.outMults) }
}

function draw(variant: string, level: Level, r: Rng): Params {
  switch (variant) {
    case 'per-mtok':
      return { ...drawNode(r, false), ...(level === TRANSFER ? { slo: r.pick(SLOS) } : {}) }
    case 'required-tps':
      return { gpus: r.pick(SYNTHETIC.gpus), target: r.pick(TARGETS), ...(level === TRANSFER ? { price: 'custom', rate: r.pick(RATES), perNode: true } : drawPrice(r, ['h100', 'b200'])) }
    case 'node-day':
      return drawNode(r, level === TRANSFER)
    default:
      return drawCache(r, level)
  }
}

function make(seed: number, level: Level, variant?: string): Instance {
  const vs = resolveVariant(gen, seed, level, variant)
  return build(vs, level, seed, draw(vs.id, level, rngFor(gen.id, vs.id, level, seed)))
}

/* ------------------------------ grading ------------------------------ */

/** A slip ratio, or null when it is too close to 1 to tell from a right answer. */
const slip = (ratio: number): number | null => (Math.abs(ratio - 1) > SYNTHETIC.slipGuard ? ratio : null)
const money = (i: Instance): boolean => i.variant !== 'cache-discount'
const truthFor = (i: Instance): number => truthOf(i.variant, i.params)

const RATIO_RULES: RatioRule[] = [
  {
    id: 'cost.per-gpu-vs-node',
    // the node's tokens against one GPU's rent shrinks the price by the GPU count; a required rate per node, or a node's speed from per-GPU figures, grows it
    ratio: (i) => (!money(i) ? null : i.variant === 'required-tps' || i.params.tpsGpu !== undefined ? gpusOf(i.params) : 1 / gpusOf(i.params)),
    message: (i) =>
      i.variant === 'required-tps' || i.params.tpsGpu !== undefined
        ? 'You mixed per-GPU and per-node figures: the node does the GPUs times the work of one GPU, and its rent is the GPUs times the price of one.'
        : "You priced one GPU's hour against the whole node's tokens. The node bills GPUs × the price every hour.",
  },
  {
    id: 'cost.seconds-hours',
    ratio: (i) => (!money(i) ? null : i.variant === 'node-day' ? DAY_H : HOUR_S),
    message: (i) =>
      i.variant === 'node-day'
        ? 'You set an hour of tokens (3,600 s) against a day of rent (24 h). A node-day holds 86,400 seconds of tokens.'
        : 'You mixed hours and seconds: a GPU-hour holds 3,600 seconds of tokens, so tokens per hour are tok/s × 3,600.',
  },
  {
    id: 'cost.k-vs-m',
    ratio: (i) => (money(i) ? 1 / THOUSAND : null),
    message: 'You priced per thousand tokens. A million is 1,000 thousands, so the price per million is 1,000 times that.',
  },
  {
    id: 'cost.all-tokens',
    ratio: (i) => (i.variant === 'per-mtok' && i.params.slo !== undefined ? slip(useful(i.params)) : null),
    message: (i) => `You divided by every token. Only ${formatNumber(useful(i.params) * 100)} % met the SLO, and only those are useful: divide by that share of the tokens.`,
  },
  {
    id: 'cost.hit-as-miss',
    ratio: (i) => (!money(i) ? slip(cacheCost(i.params, 'swap') / truthFor(i)) : null),
    message: (i) => `You swapped hits and misses: ${money(i) ? 'the hit share' : `${formatNumber(hitOf(i.params) * 100, 1)} %`} of the input hits the cache, and only the hits are billed at the cache-read price.`,
  },
  {
    id: 'cost.no-discount',
    ratio: (i) => (!money(i) ? slip(cacheCost(i.params, 'none') / truthFor(i)) : null),
    message: 'You billed every input token at the base price. The cached share costs only the cache-read multiplier times that.',
  },
  {
    id: 'cost.output-as-input',
    ratio: (i) => (i.params.outTokens === undefined ? null : slip(cacheCost(i.params, 'out-as-in') / truthFor(i))),
    message: (i) => `You billed the output tokens at the input price. Output costs ${i.params.outMult ?? 'several'} times the base price, and the cache does not discount it.`,
  },
]

const pin = (name: string, source: string, variant: string, level: Level, p: Params, truthValue: number, abs: number) => ({
  name,
  source,
  make: () => build(spec(variant), level, 1, p),
  truth: truthValue,
  tolerance: { abs },
})

const gen: Gen = {
  id: 'cost',
  version: 1,
  title: 'Cost: $/Mtok, price targets, node-days and cache discounts',
  kcs: [KC.costPerMtok, KC.epEconomics, KC.agentPrefixLocality],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution: (inst) => steps(inst.variant, inst.params, inst.answer.kind === 'choice' ? 0 : inst.answer.truth),
  pins: [
    pin("SGLang's DeepSeek node-day at $2 per GPU-hour: about $0.20 per million output tokens (t7.l4)", 't7.l4', 'node-day', 0, { dep: 'sglang', price: 'lessons' }, 0.2, 0.005), // gen-literal-ok: pinned lesson number
    pin('The same run priced per hour: 8 GPUs at $2 against 22.3k tok/s (t6.l2)', 't6.l2', 'per-mtok', 0, { dep: 'sglang', price: 'lessons' }, 0.2, 0.005), // gen-literal-ok: pinned lesson number
  ],
}

export default gen
