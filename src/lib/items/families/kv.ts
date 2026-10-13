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
 *
 * Version 2 (docs/specs/wave-2.md §11.5) adds three variants for the Attention Zoo, each assessing a KC
 * the family already had: `mla-bytes` (the latent cache, kv.mla-as-gqa), `swa-capacity` (the context
 * that fits when window layers stop growing, kv.window-ignored) and `linear-state` (a recurrent state
 * that does not depend on the context, kv.state-grows). Their claim-backed scenes read the zoo.* claims
 * and their pins are checked against the kv-zoo presets. The first four variants' instances are the same
 * as in version 1; only the version field (and so the fingerprint) changed.
 */

import { claimNumber } from '@/data/claims'
import { KC } from '@/data/kc/ids'
import { zooBytes, zooPresetById, type ZooModel } from '@/lib/kv-zoo'
import { claimRef, finishInstance, resolveVariant, rngFor, type Rng } from '../core'
import { gradeResponse } from '../grade'
import type { AnswerSpec, Gen, Instance, Level, ParamValue, Prompt, PromptPart, RatioRule, SolutionStep, VariantSpec } from '../types'
import { BYTE_UNITS, byteUnitChoices, DTYPE_BYTES, formatNumber, GB, GIB, KV_PLANES, MB, type Dtype } from '../units'

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
  /** mla-bytes: the latent and decoupled-key widths of a hypothetical MLA layer */
  latentDims: [64, 96, 128, 160, 240, 256, 320, 480, 512, 640],
  ropeDims: [16, 32, 48, 64, 80],
  /** swa-capacity: the window, the sink tokens kept for good, and the layer pattern (k window layers per full layer, `fullLayers` full ones) */
  windows: [128, 256, 512, 1024, 4096],
  sinks: [0, 4],
  windowsPerFull: [1, 2, 3, 5],
  fullLayers: [4, 6, 8, 10, 12],
  swaKvHeads: [2, 4, 8],
  /** GB left for one sequence's KV cache; a draw keeps those where the cache grows well past the window */
  kvGb: [1, 2, 4, 8, 16, 24, 32, 40, 48],
  minWindows: 8,
  /** linear-state: heads and state widths of a hypothetical linear-attention layer, and the contexts it is asked about */
  stateHeads: [8, 12, 16, 24, 32, 48, 64],
  stateDims: [64, 80, 96, 128, 160, 256],
  stateContexts: [4096, 32768, 131072, 1048576],
}

const L3: Level = 3 // gen-literal-ok: the transfer level index
const ALL_LEVELS: readonly Level[] = [0, 1, 2, L3]
const NSEC = { bytes: 45, seq: 60, tokens: 75, chats: 90, mla: 60, swa: 90, state: 60 } // gen-literal-ok: nominal seconds per variant
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

/* ------------------------------ the zoo variants (version 2) ------------------------------ */

type ZooVariant = 'mla-bytes' | 'swa-capacity' | 'linear-state'
const ZOO_VARIANTS: readonly string[] = ['mla-bytes', 'swa-capacity', 'linear-state']
const isZoo = (variant: string): boolean => ZOO_VARIANTS.includes(variant)

/** The claim-backed models of each variant: the id suffix of every field it reads, under `zoo.<slug>.`. */
const MLA_MODELS = {
  'deepseek-v3': { name: 'DeepSeek-V3', layers: 'layers', note: '' },
  'kimi-linear': { name: 'Kimi Linear', layers: 'mla-layers', note: " The model's linear layers keep a fixed-size state instead and are left out." },
} as const
type MlaKey = keyof typeof MLA_MODELS
const MLA_KEYS = Object.keys(MLA_MODELS) as MlaKey[]

const SWA_MODEL = 'gpt-oss-120b'

const LINEAR_MODELS = {
  'qwen3-5-397b': { name: 'Qwen3.5-397B', layers: 'linear-layers', heads: 'linear-value-heads', keyDim: 'linear-key-head-dim', valueDim: 'linear-value-head-dim', kind: 'gated DeltaNet' },
  'kimi-linear': { name: 'Kimi Linear', layers: 'kda-layers', heads: 'kda-heads', keyDim: 'kda-head-dim', valueDim: 'kda-head-dim', kind: 'KDA' },
} as const
type LinearKey = keyof typeof LINEAR_MODELS
const LINEAR_KEYS = Object.keys(LINEAR_MODELS) as LinearKey[]

const zooClaim = (model: string, field: string): string => `zoo.${model}.${field}`

interface ZooScene {
  /** a zoo preset's slug, or `synthetic` */
  model: string
  dtype: Dtype
  /** mla-bytes: MLA layers; linear-state: linear layers */
  layers: number
  latentDim: number
  ropeDim: number
  /** swa-capacity: sliding-window and full-attention layers, the window, the sink tokens, KV heads and head dimension */
  swaLayers: number
  fullLayers: number
  window: number
  sinks: number
  kvHeads: number
  headDim: number
  /** swa-capacity: GB left for the KV cache of one sequence */
  kvGb: number
  /** linear-state: heads, key and value widths, and the context the question names */
  heads: number
  keyDim: number
  valueDim: number
  tokens: number
}

const BLANK_ZOO: ZooScene = {
  model: 'synthetic', dtype: 'bf16', layers: 0, latentDim: 0, ropeDim: 0, swaLayers: 0, fullLayers: 0, window: 0, sinks: 0, kvHeads: 0, headDim: 0, kvGb: 0, heads: 0, keyDim: 0, valueDim: 0, tokens: 0,
}

/** MLA and window answers are priced against a 2-byte cache: a narrower one would make "priced FP16" and the variant's own slip the same ratio. */
const wideDtypes = (level: Level): Dtype[] => SYNTHETIC.dtypes[level].filter((d) => DTYPE_BYTES[d] >= 2)

/** KV bytes one token adds in one MLA layer, per layer: the latent plus the decoupled key, shared by every head. */
const mlaPerToken = (z: ZooScene): number => z.layers * (z.latentDim + z.ropeDim) * DTYPE_BYTES[z.dtype]

/** KV bytes one token adds in one layer of a window or full model: K and V for every KV head. */
const swaLayerToken = (z: ZooScene): number => KV_PLANES * z.kvHeads * z.headDim * DTYPE_BYTES[z.dtype]
/** The tokens a window layer keeps once the context passes the window: the window and the sinks. */
const swaKept = (z: ZooScene): number => z.window + z.sinks
const swaBudget = (z: ZooScene): number => z.kvGb * GB
/** The context at which the cache fills the budget: the window layers hold a fixed share, the full layers grow with the context. */
const swaContext = (z: ZooScene): number => (swaBudget(z) / swaLayerToken(z) - z.swaLayers * swaKept(z)) / z.fullLayers

/** The context a learner who gave every layer the full cache would find: the budget over all the layers' bytes per token. */
const swaUniform = (z: ZooScene): number => swaBudget(z) / swaLayerToken(z) / (z.swaLayers + z.fullLayers)

/** Bytes of recurrent state in all of the linear layers: heads · d_k · d_v per layer, whatever the context. */
const linearState = (z: ZooScene): number => z.layers * z.heads * z.keyDim * z.valueDim * DTYPE_BYTES[z.dtype]

function realMla(key: MlaKey, dtype: Dtype): ZooScene {
  const f = (s: string): number => claimNumber(zooClaim(key, s))
  return { ...BLANK_ZOO, model: key, dtype, layers: f(MLA_MODELS[key].layers), latentDim: f('kv-lora-rank'), ropeDim: f('rope-head-dim') }
}

function realSwa(kvGb: number): ZooScene {
  const f = (s: string): number => claimNumber(zooClaim(SWA_MODEL, s))
  return {
    ...BLANK_ZOO,
    model: SWA_MODEL,
    swaLayers: f('swa-layers'),
    fullLayers: f('full-layers'),
    window: f('window'),
    sinks: f('sink-kv-tokens'),
    kvHeads: f('kv-heads'),
    headDim: f('head-dim'),
    kvGb,
  }
}

function realLinear(key: LinearKey, dtype: Dtype, tokens: number): ZooScene {
  const m = LINEAR_MODELS[key]
  const f = (s: string): number => claimNumber(zooClaim(key, s))
  return { ...BLANK_ZOO, model: key, dtype, tokens, layers: f(m.layers), heads: f(m.heads), keyDim: f(m.keyDim), valueDim: f(m.valueDim) }
}

/** The claims a scene read, in the order its builder read them. */
function zooClaimIds(variant: string, z: ZooScene): string[] {
  if (z.model === 'synthetic') return []
  if (variant === 'mla-bytes') return [MLA_MODELS[z.model as MlaKey].layers, 'kv-lora-rank', 'rope-head-dim'].map((s) => zooClaim(z.model, s))
  if (variant === 'swa-capacity') return ['swa-layers', 'full-layers', 'window', 'sink-kv-tokens', 'kv-heads', 'head-dim'].map((s) => zooClaim(z.model, s))
  const m = LINEAR_MODELS[z.model as LinearKey]
  return [m.layers, m.heads, m.keyDim, m.valueDim].map((s) => zooClaim(z.model, s))
}

function drawZoo(rng: Rng, variant: ZooVariant, level: Level): ZooScene {
  const real = rng.int(1, 100) <= SYNTHETIC.realPct[level]
  if (variant === 'mla-bytes') {
    const dtype = rng.pick(wideDtypes(level))
    if (real) return realMla(rng.pick(MLA_KEYS), dtype)
    return { ...BLANK_ZOO, dtype, layers: rng.int(SYNTHETIC.layersMin, SYNTHETIC.layersMax), latentDim: rng.pick(SYNTHETIC.latentDims), ropeDim: rng.pick(SYNTHETIC.ropeDims) }
  }
  if (variant === 'swa-capacity') {
    const dtype = rng.pick(wideDtypes(level))
    let z: ZooScene
    if (real) {
      z = { ...realSwa(0), dtype }
    } else {
      const full = rng.pick(SYNTHETIC.fullLayers)
      z = {
        ...BLANK_ZOO,
        dtype,
        fullLayers: full,
        swaLayers: full * rng.pick(SYNTHETIC.windowsPerFull),
        window: rng.pick(SYNTHETIC.windows),
        sinks: rng.pick(SYNTHETIC.sinks),
        kvHeads: rng.pick(SYNTHETIC.swaKvHeads),
        headDim: rng.pick(SYNTHETIC.headDims),
      }
    }
    // keep the budgets at which the cache grows well past the window, so ignoring the window is a real slip
    const fits = SYNTHETIC.kvGb.filter((gb) => swaContext({ ...z, kvGb: gb }) >= SYNTHETIC.minWindows * swaKept(z))
    return { ...z, kvGb: fits.length > 0 ? rng.pick(fits) : SYNTHETIC.kvGb[SYNTHETIC.kvGb.length - 1] }
  }
  const dtype = rng.pick(SYNTHETIC.dtypes[level])
  if (real) return realLinear(rng.pick(LINEAR_KEYS), dtype, rng.pick(SYNTHETIC.stateContexts))
  return {
    ...BLANK_ZOO,
    dtype,
    layers: rng.int(SYNTHETIC.layersMin, SYNTHETIC.layersMax),
    heads: rng.pick(SYNTHETIC.stateHeads),
    keyDim: rng.pick(SYNTHETIC.stateDims),
    valueDim: rng.pick(SYNTHETIC.stateDims),
    tokens: rng.pick(SYNTHETIC.stateContexts),
  }
}

/** The unit a zoo size is answered in: bytes for one token's MLA cache, MB or GB (MiB or GiB at the transfer level) for a state. */
const zooUnit = (variant: string, level: Level, bytes: number): string => (variant === 'mla-bytes' ? (level === L3 ? 'KiB' : 'B') : sizeUnit('seq-bytes', level, bytes))

/** A prompt number: a claim chip for a real model, a plain number for a hypothetical one. The zoo claims carry units ("layers", "dims") that the sentence around the chip already says, so a chip shows its unit only when asked. */
const zooNum = (z: ZooScene, field: string, value: number, unit?: string): PromptPart => (z.model === 'synthetic' ? val(value, unit) : { t: 'claim', claim: zooClaim(z.model, field), unit: unit ?? '' })

const zooName = (z: ZooScene, variant: string): string =>
  z.model === 'synthetic' ? 'A hypothetical model' : variant === 'mla-bytes' ? MLA_MODELS[z.model as MlaKey].name : variant === 'swa-capacity' ? 'gpt-oss-120b' : LINEAR_MODELS[z.model as LinearKey].name

function zooStem(variant: string, level: Level, z: ZooScene, unit: string): PromptPart[] {
  if (variant === 'mla-bytes') {
    const note = z.model === 'synthetic' ? '' : MLA_MODELS[z.model as MlaKey].note
    return [
      text(`${zooName(z, variant)} has `),
      zooNum(z, MLA_MODELS[(z.model === 'synthetic' ? 'deepseek-v3' : z.model) as MlaKey].layers, z.layers),
      text(' MLA (multi-head latent attention) layers. Each layer caches, for every token, one latent vector of '),
      zooNum(z, 'kv-lora-rank', z.latentDim),
      text(' values plus a decoupled RoPE key of '),
      zooNum(z, 'rope-head-dim', z.ropeDim),
      text(` values, shared by all of its attention heads.${note} The cache is stored in ${LABEL[z.dtype]}. How much KV cache does one token need, summed over these layers? Answer in ${unitName(unit)}.`),
    ]
  }
  if (variant === 'swa-capacity') {
    const sinks: PromptPart[] = z.sinks > 0 ? [text(' plus '), zooNum(z, 'sink-kv-tokens', z.sinks), text(' sink tokens kept for good')] : []
    const pattern: PromptPart[] =
      level === L3
        ? [
            text(`${zooName(z, variant)} has `),
            val(z.swaLayers + z.fullLayers),
            text(' layers in a repeating pattern: '),
            ...(z.swaLayers === z.fullLayers ? [text('one')] : [val(z.swaLayers / z.fullLayers)]),
            text(` sliding-window ${z.swaLayers === z.fullLayers ? 'layer' : 'layers'}, then one full-attention layer. `),
          ]
        : [text(`${zooName(z, variant)} has `), zooNum(z, 'swa-layers', z.swaLayers), text(' sliding-window layers and '), zooNum(z, 'full-layers', z.fullLayers), text(' full-attention layers. ')]
    return [
      ...pattern,
      text('Every layer has '),
      zooNum(z, 'kv-heads', z.kvHeads),
      text(' KV heads of head dimension '),
      zooNum(z, 'head-dim', z.headDim),
      text(`. A sliding-window layer keeps K and V for only the last `),
      zooNum(z, 'window', z.window, 'tokens'),
      ...sinks,
      text(`; a full-attention layer keeps every token. The cache is stored in ${LABEL[z.dtype]}. `),
      text('The KV cache of one sequence may use '),
      val(z.kvGb, 'GB'),
      text(' of HBM. What is the longest context, in tokens, that fits?'),
    ]
  }
  const m = z.model === 'synthetic' ? undefined : LINEAR_MODELS[z.model as LinearKey]
  return [
    text(`${zooName(z, variant)} has `),
    zooNum(z, m?.layers ?? 'layers', z.layers),
    text(` linear-attention${m ? ` (${m.kind})` : ''} layers. Each layer keeps a recurrent state of one `),
    zooNum(z, m?.keyDim ?? 'key', z.keyDim),
    text(' × '),
    zooNum(z, m?.valueDim ?? 'value', z.valueDim),
    text(' matrix for each of its '),
    zooNum(z, m?.heads ?? 'heads', z.heads),
    text(` heads, stored in ${LABEL[z.dtype]}, and folds every new token into it. After a context of `),
    val(z.tokens, 'tokens'),
    text(`, how much state do these layers hold in total? Answer in ${unit}.`),
  ]
}

function zooSteps(variant: string, level: Level, z: ZooScene, unit: string): SolutionStep[] {
  const b = DTYPE_BYTES[z.dtype]
  const steps: SolutionStep[] = []
  if (variant === 'mla-bytes') {
    const values = z.latentDim + z.ropeDim
    steps.push({ text: [text('Cached values per layer per token = latent + decoupled key = '), val(z.latentDim), text(' + '), val(z.ropeDim)], result: { value: values, unit: 'values' } })
    steps.push({ text: [text('Bytes per layer per token = '), val(values), text(` × ${bytesText(b)} (${LABEL[z.dtype]}); one latent serves both K and V, so there is no factor 2`)], result: { value: values * b, unit: 'B' } })
    steps.push({ text: [text('Bytes per token = '), val(values * b, 'B'), text(' × '), val(z.layers), text(' layers')], result: { value: mlaPerToken(z), unit: 'B' } })
    if (unit !== 'B') steps.push({ text: [text(`In ${unit} = bytes ÷ `), val(BYTE_UNITS[unit], 'B')], result: { value: mlaPerToken(z) / BYTE_UNITS[unit], unit } })
    return steps
  }
  if (variant === 'swa-capacity') {
    const layer = swaLayerToken(z)
    const kept = swaKept(z)
    const flat = z.swaLayers * layer * kept
    if (level === L3) {
      steps.push({ text: [text('Full-attention layers = layers ÷ (window layers per full layer + 1) = '), val(z.swaLayers + z.fullLayers), text(' ÷ '), val(z.swaLayers / z.fullLayers + 1)], result: { value: z.fullLayers, unit: 'layers' } })
      steps.push({ text: [text('Sliding-window layers = '), val(z.swaLayers + z.fullLayers), text(' − '), val(z.fullLayers)], result: { value: z.swaLayers, unit: 'layers' } })
    }
    steps.push({ text: [text('KV bytes per token per layer = 2 (K and V) × '), val(z.kvHeads), text(' KV heads × '), val(z.headDim), text(` head dim × ${bytesText(b)} (${LABEL[z.dtype]})`)], result: { value: layer, unit: 'B' } })
    steps.push({ text: [text(`Once the context passes the window, a sliding-window layer holds ${z.sinks > 0 ? 'the window plus the sinks' : 'the window'} = `), val(z.window), ...(z.sinks > 0 ? [text(' + '), val(z.sinks)] : []), text(' tokens, whatever the context')], result: { value: kept, unit: 'tokens' } })
    steps.push({ text: [text('Bytes the window layers hold = '), val(z.swaLayers), text(' layers × '), val(layer, 'B'), text(' × '), val(kept, 'tokens')], result: { value: flat, unit: 'B' } })
    steps.push({ text: [text('Left for the full-attention layers = '), val(swaBudget(z), 'B'), text(' − '), val(flat, 'B')], result: { value: swaBudget(z) - flat, unit: 'B' } })
    steps.push({ text: [text('Context that fits = left ÷ (full layers × bytes per token per layer) = '), val(swaBudget(z) - flat, 'B'), text(' ÷ ('), val(z.fullLayers), text(' × '), val(layer, 'B'), text(')')], result: { value: swaContext(z), unit: 'tokens' } })
    return steps
  }
  const perHead = z.keyDim * z.valueDim
  const perLayer = z.heads * perHead
  steps.push({ text: [text('State values per head = d_k × d_v = '), val(z.keyDim), text(' × '), val(z.valueDim)], result: { value: perHead, unit: 'values' } })
  steps.push({ text: [text('State values per layer = '), val(z.heads), text(' heads × '), val(perHead)], result: { value: perLayer, unit: 'values' } })
  steps.push({ text: [text('Bytes per layer = '), val(perLayer), text(` × ${bytesText(b)} (${LABEL[z.dtype]})`)], result: { value: perLayer * b, unit: 'B' } })
  steps.push({ text: [text('The state is a fixed size, so the context of '), val(z.tokens, 'tokens'), text(' does not enter: each new token is folded into the same matrices')] })
  steps.push({ text: [text('Bytes for all layers = '), val(perLayer * b, 'B'), text(' × '), val(z.layers), text(' layers')], result: { value: linearState(z), unit: 'B' } })
  steps.push({ text: [text(`In ${unit} = bytes ÷ `), val(BYTE_UNITS[unit], 'B')], result: { value: linearState(z) / BYTE_UNITS[unit], unit } })
  return steps
}

function buildZoo(v: VariantSpec, level: Level, seed: number, z: ZooScene): Instance {
  const params: Record<string, ParamValue> = { model: z.model, dtype: z.dtype }
  let answer: AnswerSpec
  let unit = ''
  if (v.id === 'mla-bytes') {
    Object.assign(params, { layers: z.layers, latentDim: z.latentDim, ropeDim: z.ropeDim })
    unit = zooUnit(v.id, level, mlaPerToken(z))
    answer = { kind: 'numeric', truth: mlaPerToken(z) / BYTE_UNITS[unit], unit, tolerance: { rel: REL_TOL }, units: byteUnitChoices(unit, ['B', 'KB', 'KiB']) }
  } else if (v.id === 'swa-capacity') {
    Object.assign(params, { layers: z.swaLayers + z.fullLayers, swaLayers: z.swaLayers, fullLayers: z.fullLayers, window: z.window, sinks: z.sinks, kvHeads: z.kvHeads, headDim: z.headDim, kvGb: z.kvGb })
    answer = { kind: 'estimate', truth: swaContext(z), unit: 'tokens', okWithinFactor: OK_WITHIN, interval: true }
  } else {
    Object.assign(params, { layers: z.layers, heads: z.heads, keyDim: z.keyDim, valueDim: z.valueDim, tokens: z.tokens })
    unit = zooUnit(v.id, level, linearState(z))
    answer = { kind: 'numeric', truth: linearState(z) / BYTE_UNITS[unit], unit, tolerance: { rel: REL_TOL }, units: byteUnitChoices(unit, ['MB', 'GB', 'MiB', 'GiB']) }
  }
  const steps = zooSteps(v.id, level, z, unit)
  const worked = workedFor(level, steps)
  const prompt: Prompt = { stem: zooStem(v.id, level, z, unit), ...(worked ? { worked } : {}) }
  return finishInstance(gen, { variant: v.id, seed, level, nsec: v.nsec, kcs: kcsFor(v, level), params, prompt, claims: zooClaimIds(v.id, z).map(claimRef), answer })
}

/** The ZooScene back out of an instance's params, for `solution`. */
function zooSceneOf(inst: Instance): ZooScene {
  const p = inst.params
  const n = (k: string): number => (typeof p[k] === 'number' ? p[k] : 0)
  return {
    model: String(p.model),
    dtype: p.dtype as Dtype,
    layers: n('layers'),
    latentDim: n('latentDim'),
    ropeDim: n('ropeDim'),
    swaLayers: n('swaLayers'),
    fullLayers: n('fullLayers'),
    window: n('window'),
    sinks: n('sinks'),
    kvHeads: n('kvHeads'),
    headDim: n('headDim'),
    kvGb: n('kvGb'),
    heads: n('heads'),
    keyDim: n('keyDim'),
    valueDim: n('valueDim'),
    tokens: n('tokens'),
  }
}

/* ------------------------------ the instance ------------------------------ */

const VARIANTS: readonly VariantSpec[] = [
  { id: 'bytes-per-token', title: 'KV bytes per token', kcs: [KC.kvBytesPerToken, KC.gqaKvHeads], levels: ALL_LEVELS, nsec: NSEC.bytes },
  { id: 'seq-bytes', title: 'KV bytes of one sequence', kcs: [KC.kvBytesPerToken, KC.gqaKvHeads], levels: ALL_LEVELS, nsec: NSEC.seq },
  { id: 'capacity-tokens', title: 'Tokens that fit in HBM', kcs: [KC.kvCapacity, KC.gqaKvHeads], levels: ALL_LEVELS, nsec: NSEC.tokens },
  { id: 'capacity-chats', title: 'Chats that fit in HBM', kcs: [KC.kvCapacity, KC.gqaKvHeads], levels: ALL_LEVELS, nsec: NSEC.chats },
  { id: 'mla-bytes', title: 'KV bytes per token of an MLA model', kcs: [KC.kvBytesPerToken], levels: ALL_LEVELS, nsec: NSEC.mla },
  { id: 'swa-capacity', title: 'Context that fits with window layers', kcs: [KC.kvCapacity], levels: ALL_LEVELS, nsec: NSEC.swa },
  { id: 'linear-state', title: 'State bytes of linear-attention layers', kcs: [KC.kvBytesPerToken], levels: ALL_LEVELS, nsec: NSEC.state },
]

const variantOf = (id: string): VariantSpec => VARIANTS.find((v) => v.id === id) as VariantSpec

/** Every level assesses the variant's first KC; the transfer level adds the GQA KC, because the model is given as a group size (the zoo variants have one KC, so it adds nothing). */
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
  const rng = rngFor(gen.id, v.id, level, seed)
  return isZoo(v.id) ? buildZoo(v, level, seed, drawZoo(rng, v.id as ZooVariant, level)) : build(v, level, seed, drawScene(rng, v.id, level))
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
  if (isZoo(inst.variant)) return zooSteps(inst.variant, inst.level, zooSceneOf(inst), a.kind === 'numeric' ? a.unit : '')
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

/**
 * The first four rules were written for the K-and-V variants. The zoo variants keep only the ones that
 * are exact for them: an MLA cache has one latent, not K and V planes or KV heads; the window answer is
 * not proportional to the per-token cost, so only its own slip applies.
 */
const RATIO_RULES: readonly RatioRule[] = [
  {
    id: 'kv.priced-fp16',
    // FP8 and INT8 take half of FP16's 2 bytes, FP4 a quarter: pricing 2 bytes overshoots by 2 or 4
    ratio: (inst) => (bytesOf(inst) < 2 && inst.variant !== 'swa-capacity' ? slip(inst, 2 / bytesOf(inst)) : null),
    message: (inst) => `You priced FP16: this cache is ${LABEL[inst.params.dtype as Dtype]}, ${bytesText(bytesOf(inst))} per value.`,
  },
  { id: 'kv.forgot-k-and-v', ratio: (inst) => (isZoo(inst.variant) ? null : slip(inst, 1 / KV_PLANES)), message: 'You counted one plane: the cache stores both K and V, so it is twice that.' },
  {
    id: 'kv.query-heads',
    ratio: (inst) => (isZoo(inst.variant) || num(inst, 'attnHeads') === num(inst, 'kvHeads') ? null : slip(inst, num(inst, 'attnHeads') / num(inst, 'kvHeads'))),
    message: (inst) => (isZoo(inst.variant) ? 'You used the query heads.' : `You used the ${num(inst, 'attnHeads')} attention heads: only the ${num(inst, 'kvHeads')} KV heads are cached, because the query heads share them.`),
  },
  {
    id: 'kv.one-layer',
    ratio: (inst) => (inst.variant === 'swa-capacity' ? null : slip(inst, 1 / num(inst, 'layers'))),
    message: (inst) => `You counted one layer: every one of the ${num(inst, 'layers')} layers keeps its own ${inst.variant === 'linear-state' ? 'state' : inst.variant === 'mla-bytes' ? 'latent' : 'K and V'}.`,
  },
  {
    id: 'kv.mla-as-gqa',
    // GQA stores K and V for every token; an MLA layer stores one latent that serves both, so pricing it like GQA doubles it
    ratio: (inst) => (inst.variant === 'mla-bytes' ? KV_PLANES : null),
    message: 'You priced it as GQA, with separate K and V planes. An MLA layer caches one shared latent per token (plus the small decoupled key), so the cache is half that.',
  },
  {
    id: 'kv.window-ignored',
    // pricing every layer as full attention fills the budget at the context where all the layers grow, not just the full ones
    ratio: (inst) => (inst.variant === 'swa-capacity' ? swaUniform(zooSceneOf(inst)) / swaContext(zooSceneOf(inst)) : null),
    // every rule's message is rendered for every instance (the generator gate checks the text), so it reads its params only for the variant it is about
    message: (inst) =>
      inst.variant === 'swa-capacity'
        ? `You let every layer grow with the context. A sliding-window layer stops at its ${num(inst, 'window')}-token window${num(inst, 'sinks') > 0 ? ` plus ${num(inst, 'sinks')} sinks` : ''}, so only the ${num(inst, 'fullLayers')} full-attention layers keep growing and the context that fits is longer.`
        : 'You let every layer grow with the context.',
  },
  {
    id: 'kv.state-grows',
    // a linear layer's state is one fixed matrix per head; scaling it with the context treats it like a cache that gains a row per token
    ratio: (inst) => (inst.variant === 'linear-state' ? num(inst, 'tokens') : null),
    message: (inst) =>
      inst.variant === 'linear-state'
        ? `You scaled the state with the context. A linear layer folds each of the ${formatNumber(num(inst, 'tokens'))} tokens into the same fixed-size matrices, so its state does not grow.`
        : 'You scaled the state with the context.',
  },
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

/* The zoo pins read the numbers off kv-zoo's presets, which are built from the same claims by other code: the two must agree. */
const preset = (id: string): ZooModel => {
  const m = zooPresetById(id)
  if (!m) throw new RangeError(`kv: no kv-zoo preset ${id}`)
  return m
}
/** What the groups of one layer kind store at context t, summed: kv-zoo's own arithmetic. */
const zooKindBytes = (id: string, kind: string, t: number): number => {
  const m = preset(id)
  return zooBytes(m, t).groups.reduce((sum, g, i) => (m.groups[i].layer.kind === kind ? sum + g.stored : sum), 0)
}
const pinMla = (key: MlaKey): Instance => buildZoo(variantOf('mla-bytes'), 2, 1, realMla(key, 'bf16'))
const pinState = (key: LinearKey, tokens: number): Instance => buildZoo(variantOf('linear-state'), 2, 1, realLinear(key, 'bf16', tokens))
/** A gpt-oss budget of exactly the bytes kv-zoo says its cache takes at `tokens`. */
const pinWindow = (tokens: number): Instance => buildZoo(variantOf('swa-capacity'), 2, 1, realSwa(zooBytes(preset(SWA_MODEL), tokens).stored / GB))

const zooPins: Gen['pins'] = [
  { name: 'DeepSeek-V3 MLA KV bytes per token, as kv-zoo has it', source: 'kv-zoo', make: () => pinMla('deepseek-v3'), truth: zooBytes(preset('deepseek-v3'), 1).stored },
  { name: 'Kimi Linear MLA layers KV bytes per token, as kv-zoo has them', source: 'kv-zoo', make: () => pinMla('kimi-linear'), truth: zooKindBytes('kimi-linear', 'mla', 1) },
  // the state is constant, so the same figure holds at every context; the stem names 1M tokens
  { name: 'Qwen3.5 gated-DeltaNet state at 1M tokens, in MB', source: 'kv-zoo', make: () => pinState('qwen3-5-397b', 1048576), truth: zooKindBytes('qwen3-5-397b', 'linear', 1048576) / MB, tolerance: { rel: 1e-9 } }, // gen-literal-ok: the zoo's longest context, 2^20 tokens
  { name: 'Kimi Linear KDA state at 1k tokens, in MB', source: 'kv-zoo', make: () => pinState('kimi-linear', 1024), truth: zooKindBytes('kimi-linear', 'linear', 1024) / MB, tolerance: { rel: 1e-9 } }, // gen-literal-ok: the zoo's shortest context, 2^10 tokens
  // gen-literal-ok: the zoo's 128k context (131,072 tokens)
  { name: 'gpt-oss-120b: the context that fills what its 128k-token cache stores', source: 'kv-zoo', make: () => pinWindow(131072), truth: 131072, tolerance: { abs: 0.5 } },
  // gen-literal-ok: the zoo's 1M context (1,048,576 tokens)
  { name: 'gpt-oss-120b: the context that fills what its 1M-token cache stores', source: 'kv-zoo', make: () => pinWindow(1048576), truth: 1048576, tolerance: { abs: 0.5 } },
]

const gen: Gen = {
  id: 'kv',
  version: 2,
  title: 'KV bytes and capacity',
  kcs: [KC.kvBytesPerToken, KC.kvCapacity, KC.gqaKvHeads],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution,
  pins: [...pins, ...zooPins],
}

export default gen
