/**
 * `kv`: KV bytes and capacity (docs/specs/wave-1.md §5.5; KCs t5.kv-bytes-per-token, t5.kv-capacity,
 * t5.gqa-kv-heads).
 *
 * Four variants: the bytes one token costs, the bytes one sequence costs, and how many tokens or
 * chats fit in the HBM left after the weights. Each draws either a claim-backed scene (a model's
 * config and, for capacity, a GPU row, all through `claimNumber`) or a hypothetical model whose
 * numbers are declared in SYNTHETIC and announced as hypothetical in the prompt (W4).
 *
 * The diagnoses are the slips of PLAN §4.A: you priced FP16, forgot K and V, used the query heads
 * (the GQA mistake), or counted one layer. A capacity answer divides by the per-token cost, so every
 * slip there lands on the inverse ratio. The shared unit rules catch KB against KiB.
 */

import { claimNumber } from '@/data/claims'
import { KC } from '@/data/kc/ids'
import { claimRef, finishInstance, resolveVariant, rngFor, type Rng } from '../core'
import { gradeResponse } from '../grade'
import type { Gen, Instance, Level, ParamValue, Prompt, PromptPart, RatioRule, SolutionStep, VariantSpec } from '../types'
import { BYTE_UNITS, byteUnitChoices, DTYPE_BYTES, formatNumber, GB, GIB, KV_PLANES, type Dtype } from '../units'

/** Scenario numbers: nothing here is a real model, GPU or price, and the prompt says "hypothetical". */
const SYNTHETIC = {
  layersMin: 12,
  layersMax: 96,
  attnHeads: [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 96, 128],
  /** query heads per KV head; 1 is plain multi-head attention */
  groups: [1, 2, 4, 8],
  headDims: [32, 40, 48, 64, 80, 96, 128, 160, 256],
  /** the cache dtypes each level may draw: later levels add the narrow ones */
  dtypes: [
    ['bf16', 'fp8'],
    ['bf16', 'fp16', 'fp8'],
    ['bf16', 'fp16', 'fp8', 'int8', 'fp4'],
    ['fp16', 'fp8', 'int8', 'fp4'],
  ] as Dtype[][],
  seqTokens: [4096, 8192, 16384, 32768, 65536, 131072],
  hbmGb: [24, 40, 48, 80, 96, 160],
  weightsGb: [4, 8, 10, 12, 16, 20, 24, 32, 40, 60],
  chatTokens: [512, 1024, 2048, 4096, 8192, 16384, 32768],
  /** a chat variant keeps only chat sizes with at least this many chats in the cache */
  minChats: 4,
  /** percent of draws that use a claim-backed scene, per level */
  realPct: [20, 20, 20, 20],
  /** bytes per parameter of the weights on a claim-backed GPU, per level */
  weightBytes: [[2], [2], [2, 1], [2, 1]],
}

const L3: Level = 3 // gen-literal-ok: the transfer level index
const ALL_LEVELS: readonly Level[] = [0, 1, 2, L3]
const NSEC = { bytes: 45, seq: 60, tokens: 75, chats: 90 } // gen-literal-ok: nominal seconds per variant
/** Grading windows: a capacity estimate is ok within 25 %; a numeric answer within 0.5 %, tighter than the 2.4 % between KB and KiB. */
const OK_WITHIN = 1.25 // gen-literal-ok: grading window of the capacity estimates
const REL_TOL = 0.005 // gen-literal-ok: grading window of the numeric answers

/* ------------------------------ claim-backed scenes ------------------------------ */

const MODELS = {
  'llama3-8b': { name: 'Llama-3-8B', claim: 'model.llama3-8b' },
  'llama3-70b': { name: 'Llama-3-70B', claim: 'model.llama3-70b' },
  'qwen3-0-6b': { name: 'Qwen3-0.6B', claim: 'model.qwen3-0-6b' },
  'mixtral-8x7b': { name: 'Mixtral-8x7B', claim: 'model.mixtral-8x7b' },
} as const
type ModelKey = keyof typeof MODELS
const MODEL_KEYS = Object.keys(MODELS) as ModelKey[]
type ShapeField = 'layers' | 'kv-heads' | 'attn-heads' | 'head-dim'
const SHAPE_FIELDS: readonly ShapeField[] = ['layers', 'kv-heads', 'attn-heads', 'head-dim']
const modelClaim = (key: ModelKey, field: ShapeField): string => `${MODELS[key].claim}.${field}`

/** The only model with a parameter count in the claims, so the only one a capacity scene can price. */
const CAPACITY_MODEL: ModelKey = 'llama3-8b'
const PARAMS_CLAIM = 'model.llama3-8b.params'

/** The GPU rows with a published HBM capacity in GB. */
const GPUS = {
  h100: { name: 'H100 SXM', claim: 'hw.h100-sxm.hbm-capacity' },
  'a100-80': { name: 'A100 80GB SXM', claim: 'hw.a100-80-sxm.hbm-capacity' },
  'a100-40': { name: 'A100 40GB', claim: 'hw.a100-40.hbm-capacity' },
  b200: { name: 'B200', claim: 'hw.b200.hbm-capacity' },
} as const
type GpuKey = keyof typeof GPUS
/** Per level: level 0 is Boot's own GPU; later levels change the row (the transfer surface). */
const GPU_POOL: readonly (readonly GpuKey[])[] = [['h100'], ['h100', 'a100-80', 'a100-40'], ['h100', 'a100-80', 'a100-40', 'b200'], ['a100-80', 'a100-40', 'b200']]

const LABEL: Record<Dtype, string> = { fp32: 'FP32', bf16: 'BF16', fp16: 'FP16', fp8: 'FP8', int8: 'INT8', fp4: 'FP4', int4: 'INT4' }

/** "1 byte", "half a byte", "2 bytes": how a prompt or a message says bytes per value. */
function bytesText(b: number): string {
  return b === 1 ? '1 byte' : b < 1 ? 'half a byte' : `${formatNumber(b)} bytes`
}

/* ------------------------------ scenes ------------------------------ */

interface Scene {
  /** a MODELS key, or `synthetic` */
  model: ModelKey | 'synthetic'
  layers: number
  attnHeads: number
  kvHeads: number
  headDim: number
  dtype: Dtype
  /** seq-bytes: tokens in the sequence */
  tokens: number
  /** capacity: HBM in GB */
  hbmGb: number
  /** capacity on a claim-backed GPU row, else '' */
  gpu: GpuKey | ''
  /** capacity, claim-backed: bytes per weight; synthetic scenes state `weightsGb` instead */
  weightBytes: number
  weightsGb: number
  /** capacity-chats: tokens per chat */
  chatTokens: number
}

const BLANK: Scene = { model: 'synthetic', layers: 0, attnHeads: 0, kvHeads: 0, headDim: 0, dtype: 'bf16', tokens: 0, hbmGb: 0, gpu: '', weightBytes: 0, weightsGb: 0, chatTokens: 0 }

const perToken = (s: Pick<Scene, 'layers' | 'kvHeads' | 'headDim' | 'dtype'>): number => KV_PLANES * s.layers * s.kvHeads * s.headDim * DTYPE_BYTES[s.dtype]

/** Weights in GB: a claim-backed scene prices the parameter claim at `weightBytes` each (Boot's step), a synthetic one states them. */
const weightsGbOf = (s: Pick<Scene, 'gpu' | 'weightBytes' | 'weightsGb'>): number => (s.gpu ? claimNumber(PARAMS_CLAIM) * s.weightBytes : s.weightsGb)

const freeBytes = (s: Scene): number => (s.hbmGb - weightsGbOf(s)) * GB
const freeTokens = (s: Scene): number => freeBytes(s) / perToken(s)

/** A claim-backed scene built from explicit choices: the pins and the draws share it. */
function realScene(key: ModelKey, dtype: Dtype, extra: Partial<Scene> = {}): Scene {
  const field = (f: ShapeField): number => claimNumber(modelClaim(key, f))
  return { ...BLANK, model: key, layers: field('layers'), kvHeads: field('kv-heads'), attnHeads: field('attn-heads'), headDim: field('head-dim'), dtype, ...extra }
}

const isCapacity = (variant: string): boolean => variant.startsWith('capacity-')

function drawScene(rng: Rng, variant: string, level: Level): Scene {
  const real = rng.int(1, 100) <= SYNTHETIC.realPct[level]
  const dtype = rng.pick(SYNTHETIC.dtypes[level])
  const cap = isCapacity(variant)
  let sc: Scene
  if (real) {
    sc = realScene(cap ? CAPACITY_MODEL : rng.pick(MODEL_KEYS), dtype)
  } else {
    const attnHeads = rng.pick(SYNTHETIC.attnHeads)
    // the transfer level gives a group size instead of the KV heads, so it needs a real group
    const group = rng.pick(level === L3 ? SYNTHETIC.groups.slice(1) : SYNTHETIC.groups)
    sc = {
      ...BLANK,
      layers: rng.int(SYNTHETIC.layersMin, SYNTHETIC.layersMax),
      attnHeads,
      kvHeads: attnHeads / group,
      headDim: rng.pick(SYNTHETIC.headDims),
      dtype,
    }
  }
  if (variant === 'seq-bytes') sc.tokens = rng.pick(SYNTHETIC.seqTokens)
  if (cap) {
    if (real) {
      const gpu = rng.pick(GPU_POOL[level])
      sc = { ...sc, gpu, hbmGb: claimNumber(GPUS[gpu].claim), weightBytes: rng.pick(SYNTHETIC.weightBytes[level]) }
    } else {
      const hbmGb = rng.pick(SYNTHETIC.hbmGb)
      sc = { ...sc, hbmGb, weightsGb: rng.pick(SYNTHETIC.weightsGb.filter((w) => w * 2 <= hbmGb)) }
    }
    if (variant === 'capacity-chats') {
      const fits = SYNTHETIC.chatTokens.filter((t) => t * SYNTHETIC.minChats <= freeTokens(sc))
      sc.chatTokens = rng.pick(fits.length > 0 ? fits : SYNTHETIC.chatTokens.slice(0, 1))
    }
  }
  return sc
}

/* ------------------------------ answers ------------------------------ */

/** The unit a size is answered in: bytes for one token; MB or GB for a sequence, and MiB or GiB at the transfer level. */
function sizeUnit(variant: string, level: Level, bytes: number): string {
  if (variant === 'bytes-per-token') return level === L3 ? 'KiB' : 'B'
  const binary = level === L3
  return bytes >= (binary ? GIB : GB) ? (binary ? 'GiB' : 'GB') : binary ? 'MiB' : 'MB'
}

const unitName = (unit: string): string => (unit === 'B' ? 'bytes' : unit)

/* ------------------------------ prompts and solutions ------------------------------ */

const text = (t: string): PromptPart => ({ t: 'text', text: t })
const val = (value: number, unit?: string): PromptPart => ({ t: 'value', value, ...(unit ? { unit } : {}) })

/** The model: claim chips for a real one, plain numbers for a hypothetical one. At the transfer level the KV heads are not given, only the group size. */
function shapeParts(sc: Scene, level: Level): PromptPart[] {
  const key = sc.model === 'synthetic' ? undefined : sc.model
  const num = (field: ShapeField, value: number): PromptPart => (key ? { t: 'claim', claim: modelClaim(key, field) } : val(value))
  const heads: PromptPart[] =
    level === L3
      ? [text(', every '), val(sc.attnHeads / sc.kvHeads), text(' of which share one K and V head')]
      : sc.kvHeads === sc.attnHeads
        ? [text(', each with its own K and V head')]
        : [text(', which share '), num('kv-heads', sc.kvHeads), text(' KV heads')]
  return [
    text(key ? `${MODELS[key].name} has ` : 'A hypothetical model has '),
    num('layers', sc.layers),
    text(' layers and '),
    num('attn-heads', sc.attnHeads),
    text(' attention heads'),
    ...heads,
    text(', with head dimension '),
    num('head-dim', sc.headDim),
    text(`. Its KV cache is stored in ${LABEL[sc.dtype]}. `),
  ]
}

function stemFor(variant: string, level: Level, sc: Scene, unit: string): PromptPart[] {
  const shape = shapeParts(sc, level)
  if (variant === 'bytes-per-token') return [...shape, text(`How much KV cache does one token need, summed over all layers? Answer in ${unitName(unit)}.`)]
  if (variant === 'seq-bytes') return [...shape, text('How much KV cache does one sequence of '), val(sc.tokens, 'tokens'), text(` take? Answer in ${unit}.`)]
  const where: PromptPart[] = sc.gpu
    ? [
        text(`It runs on one ${GPUS[sc.gpu].name} with `),
        { t: 'claim', claim: GPUS[sc.gpu].claim },
        text(' of HBM; its '),
        { t: 'claim', claim: PARAMS_CLAIM, unit: 'billion parameters' },
        text(` are stored in ${sc.weightBytes === 1 ? LABEL.fp8 : LABEL.bf16} (${bytesText(sc.weightBytes)} each). `),
      ]
    : [text('Its weights take '), val(sc.weightsGb, 'GB'), text(" of the GPU's "), val(sc.hbmGb, 'GB'), text(' of HBM. ')]
  const rest = text('All the HBM left after the weights holds KV cache (ignore activations and fragmentation). ')
  const ask = variant === 'capacity-tokens' ? [text('How many tokens of KV cache fit?')] : [text('How many chats of '), val(sc.chatTokens, 'tokens'), text(' each fit?')]
  return [...shape, ...where, rest, ...ask]
}

/** The worked steps of an instance; the last step carries the answer. */
function stepsFor(variant: string, level: Level, sc: Scene, unit: string): SolutionStep[] {
  const steps: SolutionStep[] = []
  const bytesPerValue = DTYPE_BYTES[sc.dtype]
  const perLayerValues = KV_PLANES * sc.kvHeads * sc.headDim
  const bytes = perToken(sc)
  if (level === L3) {
    steps.push({ text: [text('KV heads = attention heads ÷ group size = '), val(sc.attnHeads), text(' ÷ '), val(sc.attnHeads / sc.kvHeads)], result: { value: sc.kvHeads, unit: 'KV heads' } })
  }
  if (isCapacity(variant)) {
    const weights = weightsGbOf(sc)
    steps.push({
      text: [text('KV bytes per token = 2 (K and V) × '), val(sc.layers), text(' layers × '), val(sc.kvHeads), text(' KV heads × '), val(sc.headDim), text(` head dim × ${bytesText(bytesPerValue)} (${LABEL[sc.dtype]})`)],
      result: { value: bytes, unit: 'B' },
    })
    steps.push(
      sc.gpu
        ? { text: [text('Weights = '), { t: 'claim', claim: PARAMS_CLAIM, unit: 'billion parameters' }, text(` × ${bytesText(sc.weightBytes)} per parameter`)], result: { value: weights, unit: 'GB' } }
        : { text: [text('Weights, as given')], result: { value: weights, unit: 'GB' } },
    )
    steps.push({ text: [text('Free HBM = '), val(sc.hbmGb, 'GB'), text(' − '), val(weights, 'GB')], result: { value: sc.hbmGb - weights, unit: 'GB' } })
    const tokens = freeTokens(sc)
    steps.push({ text: [text('Tokens that fit = free HBM ÷ KV bytes per token = '), val(freeBytes(sc), 'B'), text(' ÷ '), val(bytes, 'B')], result: { value: tokens, unit: 'tokens' } })
    if (variant === 'capacity-chats') steps.push({ text: [text('Chats = tokens ÷ '), val(sc.chatTokens, 'tokens per chat')], result: { value: tokens / sc.chatTokens, unit: 'chats' } })
    return steps
  }
  steps.push({ text: [text('Values per layer per token = 2 (K and V) × '), val(sc.kvHeads), text(' KV heads × '), val(sc.headDim), text(' head dim')], result: { value: perLayerValues, unit: 'values' } })
  steps.push({ text: [text('Bytes per layer per token = '), val(perLayerValues), text(` × ${bytesText(bytesPerValue)} (${LABEL[sc.dtype]})`)], result: { value: perLayerValues * bytesPerValue, unit: 'B' } })
  steps.push({ text: [text('Bytes per token = '), val(perLayerValues * bytesPerValue, 'B'), text(' × '), val(sc.layers), text(' layers')], result: { value: bytes, unit: 'B' } })
  const per = BYTE_UNITS[unit]
  if (variant === 'bytes-per-token') {
    if (unit !== 'B') steps.push({ text: [text(`In ${unit} = bytes ÷ `), val(per, 'B')], result: { value: bytes / per, unit } })
    return steps
  }
  steps.push({ text: [text('Bytes for the sequence = '), val(bytes, 'B'), text(' × '), val(sc.tokens, 'tokens')], result: { value: bytes * sc.tokens, unit: 'B' } })
  steps.push({ text: [text(`In ${unit} = bytes ÷ `), val(per, 'B')], result: { value: (bytes * sc.tokens) / per, unit } })
  return steps
}

/** What a level shows before the question: nothing at levels 2 and 3; at 0 every step but the last; at 1 the same with a middle step left blank. */
function workedFor(level: Level, steps: SolutionStep[]): SolutionStep[] | undefined {
  if (level > 1) return undefined
  const shown = steps.slice(0, -1)
  if (level === 0) return shown
  const blank = Math.floor(shown.length / 2)
  return shown.map((s, i) => (i === blank ? { text: s.text, blank: true } : s))
}

/* ------------------------------ the instance ------------------------------ */

const VARIANTS: readonly VariantSpec[] = [
  { id: 'bytes-per-token', title: 'KV bytes per token', kcs: [KC.kvBytesPerToken, KC.gqaKvHeads], levels: ALL_LEVELS, nsec: NSEC.bytes },
  { id: 'seq-bytes', title: 'KV bytes of one sequence', kcs: [KC.kvBytesPerToken, KC.gqaKvHeads], levels: ALL_LEVELS, nsec: NSEC.seq },
  { id: 'capacity-tokens', title: 'Tokens that fit in HBM', kcs: [KC.kvCapacity, KC.gqaKvHeads], levels: ALL_LEVELS, nsec: NSEC.tokens },
  { id: 'capacity-chats', title: 'Chats that fit in HBM', kcs: [KC.kvCapacity, KC.gqaKvHeads], levels: ALL_LEVELS, nsec: NSEC.chats },
]

const variantOf = (id: string): VariantSpec => VARIANTS.find((v) => v.id === id) as VariantSpec

/** Every level assesses the variant's first KC; the transfer level adds the GQA KC, because the model is given as a group size. */
const kcsFor = (v: VariantSpec, level: Level): string[] => (level === L3 ? [...v.kcs] : [v.kcs[0]])

function build(v: VariantSpec, level: Level, seed: number, sc: Scene): Instance {
  const cap = isCapacity(v.id)
  const seq = v.id === 'seq-bytes'
  const bytes = perToken(sc)
  const params: Record<string, ParamValue> = { model: sc.model, layers: sc.layers, attnHeads: sc.attnHeads, kvHeads: sc.kvHeads, headDim: sc.headDim, dtype: sc.dtype }
  const claims: string[] = sc.model === 'synthetic' ? [] : SHAPE_FIELDS.map((f) => modelClaim(sc.model as ModelKey, f))
  if (seq) params.tokens = sc.tokens
  if (cap) {
    params.hbmGb = sc.hbmGb
    if (sc.gpu) {
      params.gpu = sc.gpu
      params.weightBytes = sc.weightBytes
      claims.push(GPUS[sc.gpu].claim, PARAMS_CLAIM)
    } else {
      params.weightsGb = sc.weightsGb
    }
    if (v.id === 'capacity-chats') params.chatTokens = sc.chatTokens
  }

  const total = seq ? bytes * sc.tokens : bytes
  const unit = cap ? '' : sizeUnit(v.id, level, total)
  const steps = stepsFor(v.id, level, sc, unit)
  const worked = workedFor(level, steps)
  const prompt: Prompt = { stem: stemFor(v.id, level, sc, unit), ...(worked ? { worked } : {}) }
  const common = { variant: v.id, seed, level, nsec: v.nsec, kcs: kcsFor(v, level), params, prompt, claims: claims.map(claimRef) }

  if (cap) {
    const tokens = freeTokens(sc)
    const chats = v.id === 'capacity-chats'
    return finishInstance(gen, { ...common, answer: { kind: 'estimate', truth: chats ? tokens / sc.chatTokens : tokens, unit: chats ? 'chats' : 'tokens', okWithinFactor: OK_WITHIN, interval: true } })
  }
  return finishInstance(gen, {
    ...common,
    answer: { kind: 'numeric', truth: total / BYTE_UNITS[unit], unit, tolerance: { rel: REL_TOL }, units: byteUnitChoices(unit, seq ? ['MB', 'GB', 'MiB', 'GiB'] : ['B', 'KB', 'KiB']) },
  })
}

function make(seed: number, level: Level, variant?: string): Instance {
  const v = resolveVariant(gen, seed, level, variant)
  return build(v, level, seed, drawScene(rngFor(gen.id, v.id, level, seed), v.id, level))
}

/** The Scene back out of an instance's params, for `solution`. */
function sceneOf(inst: Instance): Scene {
  const p = inst.params
  const n = (k: string): number => (typeof p[k] === 'number' ? p[k] : 0)
  return {
    model: p.model as Scene['model'],
    layers: n('layers'),
    attnHeads: n('attnHeads'),
    kvHeads: n('kvHeads'),
    headDim: n('headDim'),
    dtype: p.dtype as Dtype,
    tokens: n('tokens'),
    hbmGb: n('hbmGb'),
    gpu: (p.gpu as GpuKey | undefined) ?? '',
    weightBytes: n('weightBytes'),
    weightsGb: n('weightsGb'),
    chatTokens: n('chatTokens'),
  }
}

function solution(inst: Instance): SolutionStep[] {
  const a = inst.answer
  return stepsFor(inst.variant, inst.level, sceneOf(inst), a.kind === 'numeric' ? a.unit : '')
}

/* ------------------------------ diagnoses ------------------------------ */

const num = (inst: Instance, k: string): number => Number(inst.params[k])
const bytesOf = (inst: Instance): number => DTYPE_BYTES[inst.params.dtype as Dtype]

/**
 * A slip multiplies the per-token cost by ρ. A size answer carries ρ itself; a capacity answer
 * divides by the per-token cost, so it carries 1/ρ.
 */
const slip = (inst: Instance, rho: number): number => (isCapacity(inst.variant) ? 1 / rho : rho)

const RATIO_RULES: readonly RatioRule[] = [
  {
    id: 'kv.priced-fp16',
    // FP8 and INT8 take half of FP16's 2 bytes, FP4 a quarter: pricing 2 bytes overshoots by 2 or 4
    ratio: (inst) => (bytesOf(inst) < 2 ? slip(inst, 2 / bytesOf(inst)) : null),
    message: (inst) => `You priced FP16: this cache is ${LABEL[inst.params.dtype as Dtype]}, ${bytesText(bytesOf(inst))} per value.`,
  },
  { id: 'kv.forgot-k-and-v', ratio: (inst) => slip(inst, 1 / KV_PLANES), message: 'You counted one plane: the cache stores both K and V, so it is twice that.' },
  {
    id: 'kv.query-heads',
    ratio: (inst) => (num(inst, 'attnHeads') === num(inst, 'kvHeads') ? null : slip(inst, num(inst, 'attnHeads') / num(inst, 'kvHeads'))),
    message: (inst) => `You used the ${num(inst, 'attnHeads')} attention heads: only the ${num(inst, 'kvHeads')} KV heads are cached, because the query heads share them.`,
  },
  { id: 'kv.one-layer', ratio: (inst) => slip(inst, 1 / num(inst, 'layers')), message: (inst) => `You counted one layer: every one of the ${num(inst, 'layers')} layers keeps its own K and V.` },
]

/* ------------------------------ pins ------------------------------ */

const pinBytes = (key: ModelKey): Instance => build(variantOf('bytes-per-token'), 2, 1, realScene(key, 'bf16'))
const pinSeq = (key: ModelKey, tokens: number): Instance => build(variantOf('seq-bytes'), L3, 1, realScene(key, 'bf16', { tokens }))
const bootScene = (chatTokens: number): Scene => realScene(CAPACITY_MODEL, 'bf16', { gpu: 'h100', hbmGb: claimNumber(GPUS.h100.claim), weightBytes: 2, chatTokens })

const pins: Gen['pins'] = [
  { name: 'Llama-3-8B BF16 KV bytes per token', source: 't5.l4', make: () => pinBytes('llama3-8b'), truth: claimNumber('model.llama3-8b.kv-bytes-per-token') },
  // gen-literal-ok: the lesson's own figure, 2 × 80 × 1,024 × 2 B = 327,680 B (320 KiB)
  { name: 'Llama-3-70B BF16 KV bytes per token', source: 't5.l4', make: () => pinBytes('llama3-70b'), truth: 327680 },
  // gen-literal-ok: the lesson's own figure, 128 KiB per token × 4,096 tokens = 512 MiB (0.5 GiB)
  { name: 'Llama-3-8B, a 4k conversation, in MiB', source: 't5.l4', make: () => pinSeq('llama3-8b', 4096), truth: 512 },
  // gen-literal-ok: the lesson's own figure, 128 KiB per token × 131,072 tokens = 16 GiB
  { name: 'Llama-3-8B, a 128k context, in GiB', source: 't5.l4', make: () => pinSeq('llama3-8b', 131072), truth: 16 },
  // gen-literal-ok: Boot's 487,823 tokens (src/lib/boot/model.ts computes 487,823.49)
  { name: 'Boot: tokens of KV cache on an H100', source: 'boot', make: () => build(variantOf('capacity-tokens'), 2, 1, bootScene(0)), truth: 487823, tolerance: { abs: 1 } },
  // gen-literal-ok: Boot's 119.1 chats of 4,096 tokens (119.098 before the page rounds it)
  { name: 'Boot: chats of 4,096 tokens on an H100', source: 'boot', make: () => build(variantOf('capacity-chats'), 2, 1, bootScene(4096)), truth: 119.1, tolerance: { abs: 0.05 } },
]

const gen: Gen = {
  id: 'kv',
  version: 1,
  title: 'KV bytes and capacity',
  kcs: [KC.kvBytesPerToken, KC.kvCapacity, KC.gqaKvHeads],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution,
  pins,
}

export default gen
