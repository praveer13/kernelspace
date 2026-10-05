/**
 * The `roofline` family (docs/specs/wave-1.md §5.5): ridge point, bound class, attainable throughput,
 * batch-1 decode speed, the batch that reaches the ridge, and tile arithmetic intensity.
 *
 * Hardware comes only from atlas rows that have both a bandwidth and a peak (W4). The scenario
 * numbers (a benchmark's sustained fractions, a hypothetical model's size, tile shapes, the
 * intensities a kernel might have) are synthetic and declared in SYNTHETIC, and the prompts say so.
 * A quarter of the ridge, decode and batch instances are the plain datasheet case, so the lessons'
 * worked numbers (H100 ridge 295.2, decode 208.6 tok/s, 0.34 % busy) are pinned and reproduced.
 */

import { atlasRow } from '@/data/atlas'
import { claimNumber } from '@/data/claims'
import { KC } from '@/data/kc/ids'
import { claimRef, finishInstance, resolveVariant, rngFor, type Rng } from '@/lib/items/core'
import { gradeResponse } from '@/lib/items/grade'
import type { AnswerSpec, Gen, Instance, Level, Params, PromptPart, RatioRule, SolutionStep, VariantSpec } from '@/lib/items/types'
import { BITS_PER_BYTE, DTYPE_BYTES, formatNumber, type Dtype } from '@/lib/items/units'

const SYNTHETIC = {
  /** 1 in N instances is the plain datasheet case, with no sustained fractions */
  plainOneIn: 4,
  /** 1 in N attainable instances sits right of the ridge */
  computeOneIn: 4,
  /** 1 in N decode instances is Llama-3-8B, a claim, instead of a hypothetical model */
  llamaOneIn: 5,
  /** 1 in N tiles is square */
  squareOneIn: 5,
  /** nominal seconds per variant */
  nsec: { ridge: 40, bound: 25, attainable: 45, decode: 50, batch: 60, tile: 45 },
  /** an answer within this share of the truth is right (numeric), or this factor of it (estimate) */
  relTol: 0.02,
  okFactor: 1.25,
  /** a benchmark sustains between these percentages of the datasheet figures */
  fracMin: 50,
  fracMax: 100,
  /** two significant digits m, scaled by a decade: kernel intensities and model sizes in billions */
  mMin: 10,
  mMax: 99,
  /** a kernel sits at least this many times away from the ridge, so its class is not a coin flip */
  clearance: 1.5,
  /** a model's weights take at most this share of memory */
  fit: 0.9,
  /** tile sides: every even number in a range, then the larger round ones */
  tileMin: 8,
  tileMax: 98,
  tilesBig: [100, 120, 128, 150, 160, 200, 240, 256, 320, 400, 480, 512, 640, 800, 1024],
}

/** The transfer level changes the surface: FP8 math, another dtype or a bigger tile format. */
const TRANSFER: Level = 3 // gen-literal-ok: level 3 of the staircase
const ALL_LEVELS = [0, 1, 2, TRANSFER] as const
const PER_TERA = 1000 // gen-literal-ok: giga to tera, and GB/s to TB/s
const VARIANTS: VariantSpec[] = [
  { id: 'ridge', title: 'The ridge point', kcs: [KC.ridgePoint], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.ridge },
  { id: 'bound', title: 'Bandwidth- or compute-bound', kcs: [KC.boundClassification], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.bound },
  { id: 'attainable', title: 'Attainable throughput', kcs: [KC.boundClassification], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.attainable },
  { id: 'decode-b1', title: 'Batch-1 decode speed', kcs: [KC.decodeBandwidth], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.decode },
  { id: 'batch-to-ridge', title: 'Batch that reaches the ridge', kcs: [KC.decodeBandwidth], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.batch },
  { id: 'tile-ai', title: 'Tile arithmetic intensity', kcs: [KC.tilingIntensity], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.tile },
]
const spec = (id: string): VariantSpec => VARIANTS.find((x) => x.id === id)!

/* ------------------------------ hardware ------------------------------ */

interface Chip {
  name: string
  /** GB/s */
  bw: number
  /** GFLOP/s, dense, at the 16-bit tensor rate */
  peak: number
  /** GB */
  cap: number
  /** the 16-bit format of the datasheet row (Turing has no BF16) */
  prec: string
  /** the datasheet also lists a "with sparsity" figure at twice the dense one */
  sparse: boolean
  /** has FP8 tensor cores, at twice the 16-bit rate */
  fp8: boolean
  bwClaim: string
  peakClaim: string
  capClaim: string
}

const CHIPS: Record<string, Chip> = {}
for (const [id, sparse, fp8] of [['h100', true, true], ['b200', true, true], ['a100-80', true, false], ['rtx4090', true, false], ['t4', false, false], ['tpu7x', false, true]] as const) {
  const r = atlasRow(id)
  // only the TPU row has no capacity in the atlas
  const capClaim = r.claims.hbmGb ?? 'hw.tpu7x.hbm-capacity'
  CHIPS[id] = {
    name: r.name,
    bw: r.hbmBwGBs ?? Number.NaN,
    peak: r.bf16DenseGflops ?? Number.NaN,
    cap: r.hbmGb ?? claimNumber(capClaim),
    prec: id === 't4' ? 'FP16' : 'BF16',
    sparse,
    fp8,
    bwClaim: r.claims.hbmBwGBs ?? '',
    peakClaim: r.claims.bf16DenseGflops ?? '',
    capClaim,
  }
}
const CHIP_IDS = Object.keys(CHIPS)
const FP8_IDS = CHIP_IDS.filter((id) => CHIPS[id].fp8)

/** Kernel intensities and model sizes: two significant digits over four decades. */
const POOL: number[] = []
for (let m = SYNTHETIC.mMin; m <= SYNTHETIC.mMax; m++) POOL.push(m / 10, m, m * 10, m * 100)
const TILES: number[] = []
for (let n = SYNTHETIC.tileMin; n <= SYNTHETIC.tileMax; n += 2) TILES.push(n)
TILES.push(...SYNTHETIC.tilesBig)

/* ------------------------------ the maths ------------------------------ */

const num = (p: Params, k: string): number => Number(p[k])
const chip = (p: Params): Chip => CHIPS[String(p.hw)]
const bytes = (dtype: unknown): number => DTYPE_BYTES[dtype as Dtype]
/** Tensor rate against the 16-bit one: 2 for FP8. */
const rate = (dtype: string): number => DTYPE_BYTES.bf16 / bytes(dtype)
const nameOf = (c: Chip, dtype: string): string => (dtype === 'bf16' ? c.prec : dtype.toUpperCase())

/** Sustained ceilings in GFLOP/s and GB/s: the datasheet figures times the benchmark's fractions. */
function ceilings(p: Params, dtype: string): { peak: number; bw: number } {
  const c = chip(p)
  return { peak: (c.peak * rate(dtype) * Number(p.fc ?? 100)) / 100, bw: (c.bw * Number(p.fb ?? 100)) / 100 }
}
const ridgeAt = (p: Params, dtype: string): number => {
  const k = ceilings(p, dtype)
  return k.peak / k.bw
}
/** The dtype the chip's math runs in: the item's for `ridge` and `bound`, 16-bit otherwise. */
const mathDtype = (variant: string, p: Params): string => (variant === 'ridge' || variant === 'bound' ? String(p.dtype) : 'bf16')
const ridgeOf = (variant: string, p: Params): number => ridgeAt(p, mathDtype(variant, p))

/** The truth of each numeric or estimate variant, from its params alone. */
function truthOf(variant: string, p: Params): number {
  switch (variant) {
    case 'ridge':
      return ridgeOf(variant, p)
    case 'attainable': {
      const k = ceilings(p, 'bf16')
      const got = Math.min(k.peak, k.bw * num(p, 'ai'))
      return p.ask === 'busy' ? (100 * got) / k.peak : got / PER_TERA
    }
    case 'decode-b1':
      return ceilings(p, 'bf16').bw / (num(p, 'paramsB') * bytes(p.dtype))
    case 'batch-to-ridge':
      // intensity = batch × 2 FLOP ÷ the weight's bytes, so the ridge is reached at ridge × bytes ÷ 2
      return (ridgeOf(variant, p) * bytes(p.dtype)) / DTYPE_BYTES.bf16
    default:
      // 2·Tm·Tn FLOPs per step along K over (Tm + Tn) values: T / bytes for a square tile
      return (2 * num(p, 'tm') * num(p, 'tn')) / ((num(p, 'tm') + num(p, 'tn')) * bytes(p.dtype))
  }
}

/* ------------------------------ prompt and solution text ------------------------------ */

const t = (text: string): PromptPart => ({ t: 'text', text })
const v = (value: number, unit?: string, digits?: number): PromptPart => ({ t: 'value', value, ...(unit ? { unit } : {}), ...(digits === undefined ? {} : { digits }) })
const step = (text: PromptPart[], result?: { value: number; unit?: string }): SolutionStep => ({ text, ...(result ? { result } : {}) })
const isPlain = (p: Params): boolean => Number(p.fc ?? 100) === 100 && Number(p.fb ?? 100) === 100

/** The sentence that introduces a benchmark's sustained fractions; nothing for the datasheet case. */
function sustained(p: Params): string {
  if (isPlain(p)) return ''
  const bits = [...(p.fc === undefined ? [] : [`${num(p, 'fc')} % of the peak throughput`]), ...(p.fb === undefined ? [] : [`${num(p, 'fb')} % of the bandwidth`])]
  return ` In a hypothetical benchmark the chip sustains ${bits.join(' and ')}; use the sustained figures.`
}

function givens(p: Params, dtype: string, peak: boolean): { label: string; value: PromptPart }[] {
  const c = chip(p)
  const bw = { label: 'Memory bandwidth', value: { t: 'claim', claim: c.bwClaim } as PromptPart }
  return peak ? [{ label: `Peak ${nameOf(c, dtype)}, dense${dtype === 'bf16' ? '' : ` (${rate(dtype)} × the ${c.prec} figure)`}`, value: { t: 'claim', claim: c.peakClaim, scale: rate(dtype) } }, bw] : [bw]
}

function tileSteps(p: Params, truth: number): SolutionStep[] {
  const [tm, tn, b] = [num(p, 'tm'), num(p, 'tn'), bytes(p.dtype)]
  return [
    step([t('Per step along K the tile does 2 × Tm × Tn FLOPs = '), v(2 * tm * tn, 'FLOP')]),
    step([t('and loads Tm + Tn values of '), v(b, 'B'), t(' each = '), v((tm + tn) * b, 'B')]),
    step([t('Intensity = FLOPs ÷ bytes = '), v(truth, 'FLOP/B', 2)], { value: truth, unit: 'FLOP/B' }),
  ]
}

/** A blanked step shows its lead-in and hides the answer after the last "=" or ":". */
function blanked(s: SolutionStep): SolutionStep {
  const cut = s.text.map((x) => x.t === 'text' && /[=:]\s*$/.test(x.text)).lastIndexOf(true)
  return { ...s, text: cut < 0 ? s.text : s.text.slice(0, cut + 1), blank: true }
}

function steps(variant: string, p: Params, truth: number): SolutionStep[] {
  if (variant === 'tile-ai') return tileSteps(p, truth)
  const dtype = mathDtype(variant, p)
  const k = ceilings(p, dtype)
  const ridge = k.peak / k.bw
  const ridgeStep = step([t('Ridge = peak ÷ bandwidth = '), v(k.peak, 'GFLOP/s'), t(' ÷ '), v(k.bw, 'GB/s'), t(' = '), v(ridge, 'FLOP/B', 1)], { value: ridge, unit: 'FLOP/B' })
  const ai = num(p, 'ai')
  switch (variant) {
    case 'ridge':
      return [
        step([t(`${isPlain(p) ? 'Peak' : 'Sustained peak'} in GFLOP/s = `), v(k.peak, 'GFLOP/s')], { value: k.peak, unit: 'GFLOP/s' }),
        step([t(`${isPlain(p) ? 'Bandwidth' : 'Sustained bandwidth'} in GB/s = `), v(k.bw, 'GB/s')], { value: k.bw, unit: 'GB/s' }),
        ridgeStep,
      ]
    case 'bound':
      return [ridgeStep, step([v(ai, 'FLOP/B'), t(' against the ridge: '), t(`${ai < ridge ? 'left of it, so bandwidth' : 'right of it, so compute'}-bound.`)])]
    case 'attainable': {
      const roof = (k.bw * ai) / PER_TERA
      const busy = p.ask === 'busy'
      return [
        step([t('Bandwidth roof = bandwidth × intensity = '), v(k.bw, 'GB/s'), t(' × '), v(ai, 'FLOP/B'), t(' = '), v(roof, 'TFLOP/s')], { value: roof, unit: 'TFLOP/s' }),
        step([t('Compute roof = peak = '), v(k.peak / PER_TERA, 'TFLOP/s')], { value: k.peak / PER_TERA, unit: 'TFLOP/s' }),
        step([t(busy ? 'Attainable = min of the two roofs, as a share of the peak = ' : 'Attainable = the lower roof = '), v(truth, busy ? '%' : 'TFLOP/s')], { value: truth, unit: busy ? '%' : 'TFLOP/s' }),
      ]
    }
    case 'decode-b1': {
      const wb = num(p, 'paramsB') * bytes(p.dtype)
      return [
        step([t('Every weight is streamed once per token: weight bytes = parameters × bytes each = '), v(wb, 'GB')], { value: wb, unit: 'GB' }),
        step([t('Tokens per second ≈ bandwidth ÷ weight bytes = '), v(k.bw, 'GB/s'), t(' ÷ '), v(wb, 'GB'), t(' = '), v(truth, 'tok/s', 1)], { value: truth, unit: 'tok/s' }),
      ]
    }
    default:
      return [
        ridgeStep,
        step([t(`Intensity = batch × 2 FLOP ÷ ${formatNumber(bytes(p.dtype))} B per weight, so batch = ridge × bytes ÷ 2 = `), v(truth, undefined, 1)], { value: truth, unit: 'batch' }),
      ]
  }
}

/* ------------------------------ building an instance ------------------------------ */

function boundAnswer(p: Params): AnswerSpec {
  const ai = formatNumber(num(p, 'ai'))
  const ridge = ridgeOf('bound', p)
  const left = num(p, 'ai') < ridge
  const R = formatNumber(ridge, 1)
  const side = (rightOne: boolean): string => `${ai} FLOP/B is ${rightOne ? 'left' : 'right'} of the ${R} FLOP/B ridge (peak ÷ bandwidth), so the ${rightOne ? 'bandwidth' : 'compute'} roof binds.`
  // Every pool intensity is far right of the inverted ridge (bandwidth ÷ peak, about 0.003), so a learner
  // who inverted it answers compute-bound. That is the slip only where compute-bound is wrong: left of the ridge.
  const flipped = 'You compared against bandwidth ÷ peak, the inverse of the ridge, which any kernel clears. The ridge is peak ÷ bandwidth: hundreds of FLOP/B on a modern GPU.'
  const above = `${ai} FLOP/B is above the ${R} FLOP/B ridge, so the tensor cores saturate before memory does: more bandwidth would not speed this kernel up.`
  return {
    kind: 'choice',
    options: [
      { id: 'bw', text: 'Bandwidth-bound: memory traffic is the limit, not the tensor cores', why: left ? side(true) : above, ...(left ? {} : { miss: 'roofline.bandwidth-above-ridge' }) },
      { id: 'cb', text: 'Compute-bound: the tensor cores are the limit, not memory traffic', why: left ? flipped : side(false), ...(left ? { miss: 'roofline.inverted-ridge' } : {}) },
      { id: 'nm', text: 'It cannot be told until the kernel is measured on the chip, whatever its intensity', why: 'The intensity and the ridge already say which roof binds. Measuring only shows how close the kernel gets to it.', miss: 'roofline.needs-measuring' },
    ],
    correct: [left ? 'bw' : 'cb'],
  }
}

function build(vs: VariantSpec, level: Level, seed: number, p: Params): Instance {
  const c = chip(p)
  const dtype = String(p.dtype ?? 'bf16')
  const ai = formatNumber(Number(p.ai ?? 0))
  // a tile has no chip, so it rests on no claim
  const claims = vs.id === 'tile-ai' ? [] : [c.bwClaim, ...(vs.id === 'decode-b1' ? [c.capClaim, ...(p.model === 'llama3-8b' ? ['model.llama3-8b.params'] : [])] : [c.peakClaim])]
  const truth = vs.id === 'bound' ? 0 : truthOf(vs.id, p)
  let stem: PromptPart[]
  let g: { label: string; value: PromptPart }[] | undefined
  let answer: AnswerSpec
  switch (vs.id) {
    case 'ridge':
      g = givens(p, dtype, true)
      stem = [t(`On the ${c.name}, what is the ridge point for ${nameOf(c, dtype)} math, in FLOP per byte?${sustained(p)}`)]
      answer = { kind: 'numeric', truth, unit: 'FLOP/B', tolerance: { rel: SYNTHETIC.relTol } }
      break
    case 'bound':
      g = givens(p, dtype, true)
      stem = [t(`A kernel does ${ai} FLOP per byte of memory traffic on the ${c.name}, with ${nameOf(c, dtype)} math. Is it bandwidth-bound or compute-bound?`)]
      answer = boundAnswer(p)
      break
    case 'attainable':
      g = givens(p, 'bf16', true)
      stem = [t(`A kernel does ${ai} FLOP per byte of memory traffic on the ${c.name}. By the roofline (dense ${c.prec} peak and memory bandwidth, nothing else), ${p.ask === 'busy' ? 'what share of the peak can it use?' : 'what throughput can it reach?'}`)]
      answer = { kind: 'numeric', truth, unit: p.ask === 'busy' ? '%' : 'TFLOP/s', tolerance: { rel: SYNTHETIC.relTol } }
      break
    case 'decode-b1': {
      g = givens(p, 'bf16', false)
      const llama = p.model === 'llama3-8b'
      const size: PromptPart = llama ? { t: 'claim', claim: 'model.llama3-8b.params', unit: 'B parameters' } : v(num(p, 'paramsB'), 'B parameters')
      stem = [t(llama ? 'Llama-3-8B has ' : 'A hypothetical model has '), size, t(`, stored in ${dtype.toUpperCase()}. On the ${c.name}, one user decodes at batch 1, streaming every weight once per token and ignoring the KV cache. About how many tokens per second?${sustained(p)}`)]
      answer = { kind: 'estimate', truth, unit: 'tok/s', okWithinFactor: SYNTHETIC.okFactor, interval: true }
      break
    }
    case 'batch-to-ridge':
      g = givens(p, 'bf16', true)
      stem = [t(`At batch b, decode does about b × 2 FLOP per parameter against the weight bytes it streams (KV traffic ignored). The ${c.name} runs ${c.prec} math over ${dtype.toUpperCase()} weights. At what batch does decode reach the ridge?${sustained(p)}`)]
      answer = { kind: 'estimate', truth, unit: 'batch', okWithinFactor: SYNTHETIC.okFactor, interval: false }
      break
    default:
      stem = [t(`A matmul kernel computes a ${num(p, 'tm')} × ${num(p, 'tn')} output tile of C, loading the matching tiles of A and B in ${dtype.toUpperCase()} (${formatNumber(bytes(dtype))} B per value) and counting only that traffic. What is its arithmetic intensity, in FLOP per byte?`)]
      answer = { kind: 'numeric', truth, unit: 'FLOP/B', tolerance: { rel: SYNTHETIC.relTol } }
  }
  // level 0 shows every step with the last blanked; level 1 blanks one in the middle
  const full = steps(vs.id, p, truth)
  const blankAt = level === 0 ? full.length - 1 : Math.floor((full.length - 1) / 2)
  const worked = level < 2 ? full.map((s, i) => (i === blankAt ? blanked(s) : s)) : undefined
  return finishInstance(gen, {
    variant: vs.id,
    seed,
    level,
    params: p,
    // a transfer item on the batch needs both KCs
    kcs: vs.id === 'batch-to-ridge' && level === TRANSFER ? [KC.decodeBandwidth, KC.ridgePoint] : [...vs.kcs],
    prompt: { stem, ...(g ? { givens: g } : {}), ...(worked ? { worked } : {}) },
    answer,
    claims: claims.map(claimRef),
    nsec: vs.nsec,
  })
}

/* ------------------------------ drawing params ------------------------------ */

const fractions = (r: Rng): { fc: number; fb: number } =>
  r.int(0, SYNTHETIC.plainOneIn - 1) === 0 ? { fc: 100, fb: 100 } : { fc: r.int(SYNTHETIC.fracMin, SYNTHETIC.fracMax), fb: r.int(SYNTHETIC.fracMin, SYNTHETIC.fracMax) }

/** An intensity at least `clearance` times away from the ridge, on the chosen side. */
const intensity = (r: Rng, ridge: number, left: boolean): number =>
  r.pick(POOL.filter((a) => (left ? a * SYNTHETIC.clearance <= ridge : a >= ridge * SYNTHETIC.clearance)))

function draw(variant: string, level: Level, r: Rng): Params {
  // the transfer level changes the surface: FP8 math, or another dtype
  const hw = r.pick(level === TRANSFER && (variant === 'ridge' || variant === 'bound') ? FP8_IDS : CHIP_IDS)
  switch (variant) {
    case 'ridge':
      return { hw, dtype: level === TRANSFER ? 'fp8' : 'bf16', ...fractions(r) }
    case 'bound': {
      const dtype = level === TRANSFER ? 'fp8' : 'bf16'
      return { hw, dtype, ai: intensity(r, ridgeAt({ hw }, dtype), r.int(0, 1) === 0) }
    }
    case 'attainable':
      return { hw, ai: intensity(r, ridgeAt({ hw }, 'bf16'), r.int(0, SYNTHETIC.computeOneIn - 1) !== 0), ask: level === TRANSFER ? 'busy' : 'tflops' }
    case 'decode-b1': {
      const dtype = level < 2 ? 'bf16' : r.pick(level === 2 ? ['bf16', 'fp8'] : ['fp8', 'fp4'])
      const fits = (b: number): boolean => b * bytes(dtype) <= CHIPS[hw].cap * SYNTHETIC.fit
      const llamaB = claimNumber('model.llama3-8b.params')
      const llama = level > 0 && r.int(0, SYNTHETIC.llamaOneIn - 1) === 0 && fits(llamaB)
      const paramsB = llama ? llamaB : r.pick(POOL.filter(fits))
      return { hw, dtype, model: llama ? 'llama3-8b' : 'synthetic', paramsB, fb: fractions(r).fb }
    }
    case 'batch-to-ridge':
      return { hw, dtype: level === TRANSFER ? r.pick(['int8', 'fp4']) : 'bf16', ...fractions(r) }
    default: {
      const tm = r.pick(TILES)
      return { tm, tn: r.int(0, SYNTHETIC.squareOneIn - 1) === 0 ? tm : r.pick(TILES), dtype: level === TRANSFER ? r.pick(['fp8', 'fp32']) : 'fp16' }
    }
  }
}

function make(seed: number, level: Level, variant?: string): Instance {
  const vs = resolveVariant(gen, seed, level, variant)
  return build(vs, level, seed, draw(vs.id, level, rngFor(gen.id, vs.id, level, seed)))
}

/* ------------------------------ grading ------------------------------ */

const ridgeLike = (i: Instance): boolean => i.variant === 'ridge' || i.variant === 'batch-to-ridge'
const computeBound = (i: Instance): boolean => i.variant === 'attainable' && num(i.params, 'ai') >= ridgeAt(i.params, 'bf16')
/** A bandwidth slip scales these answers: the ridge and batch as 1/bw, decode and the bandwidth roof as bw. */
const bwScaled = (i: Instance): boolean => ridgeLike(i) || i.variant === 'decode-b1' || (i.variant === 'attainable' && !computeBound(i))

const RATIO_RULES: RatioRule[] = [
  {
    id: 'roofline.inverted-ridge',
    // bandwidth ÷ peak is 1 / ridge, so the answer is truth × 1 / ridge²
    ratio: (i) => (ridgeLike(i) ? 1 / (ridgeOf(i.variant, i.params) * ridgeOf(i.variant, i.params)) : null),
    message: 'You divided bandwidth by peak. The ridge is peak FLOP/s ÷ bandwidth: hundreds of FLOP per byte on a modern GPU, not a fraction.',
  },
  {
    id: 'roofline.sparse-flops',
    ratio: (i) => {
      if (!(ridgeLike(i) || i.variant === 'attainable') || !chip(i.params).sparse) return null
      // a busy item is a share of the peak: the sparse peak halves it on the bandwidth roof, and moves no simple multiple on the compute roof
      if (i.params.ask === 'busy') return computeBound(i) ? null : 1 / 2
      return ridgeLike(i) || computeBound(i) ? 2 : null
    },
    message: 'You used the datasheet figure marked "with sparsity". It is twice the dense peak, and dense work gets the dense one.',
  },
  {
    id: 'roofline.tb-vs-gb',
    ratio: (i) => (bwScaled(i) ? (ridgeLike(i) ? PER_TERA : 1 / PER_TERA) : null),
    message: 'Your bandwidth is 1,000 times too small: a figure in TB/s was read as GB/s. 1 TB/s is 1,000 GB/s, and the datasheets mix the two.',
  },
  {
    id: 'roofline.bits-bytes',
    ratio: (i) => (i.variant === 'decode-b1' || i.variant === 'tile-ai' ? 1 / BITS_PER_BYTE : null),
    message: 'You counted bits as bytes. FP16 is 16 bits but 2 bytes, FP8 is 1 byte, and 4-bit weights are half a byte.',
  },
  {
    id: 'roofline.elements-not-bytes',
    ratio: (i) => (i.variant === 'tile-ai' && bytes(i.params.dtype) > 1 ? bytes(i.params.dtype) : null),
    message: 'You counted elements, not bytes. Divide the FLOPs by the bytes moved, and each value is more than one byte.',
  },
]

const pin = (name: string, source: string, variant: string, level: Level, p: Params, truth: number, abs: number) => ({
  name,
  source,
  make: () => build(spec(variant), level, 1, p),
  truth,
  tolerance: { abs },
})

const gen: Gen = {
  id: 'roofline',
  version: 1,
  title: 'Roofline: ridge, bound class and decode speed',
  kcs: [KC.ridgePoint, KC.boundClassification, KC.decodeBandwidth, KC.tilingIntensity],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution: (inst) => steps(inst.variant, inst.params, inst.answer.kind === 'choice' ? 0 : inst.answer.truth),
  pins: [
    pin('H100 ridge, BF16 dense over HBM3 bandwidth', 't4.l3', 'ridge', 2, { hw: 'h100', dtype: 'bf16', fc: 100, fb: 100 }, 295.2, 0.05), // gen-literal-ok: pinned lesson number
    pin('B200 ridge from the atlas', 'atlas', 'ridge', 2, { hw: 'b200', dtype: 'bf16', fc: 100, fb: 100 }, 281.25, 0.01), // gen-literal-ok: pinned atlas ridge
    pin('Llama-3-8B decode at batch 1 on an H100 (Boot)', 'boot', 'decode-b1', 2, { hw: 'h100', dtype: 'bf16', model: 'llama3-8b', paramsB: claimNumber('model.llama3-8b.params'), fb: 100 }, 208.6, 0.05), // gen-literal-ok: pinned Boot number
    pin('Decode keeps 0.34 % of an H100 math busy (Boot)', 'boot', 'attainable', TRANSFER, { hw: 'h100', ai: 1, ask: 'busy' }, 0.34, 0.005), // gen-literal-ok: pinned Boot number
    pin('A 128 x 128 FP16 tile has intensity 64 (erratum 2026-10-04)', 't4.l6', 'tile-ai', 2, { tm: 128, tn: 128, dtype: 'fp16' }, 64, 0), // gen-literal-ok: pinned erratum number
  ],
}

export default gen
