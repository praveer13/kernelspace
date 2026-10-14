/**
 * `memory`: where the weights go (docs/specs/wave-2.md §5.3; KCs t4.quantized-bytes, t6.moe-active-params,
 * t6.parallel-memory, t6.fp4-capacity, t6.lora-adapter-bytes).
 *
 * Five numeric variants: the bytes of a quantized checkpoint, NVFP4's weights and the GPUs they fill,
 * an MoE's bytes read per decode step against its resident bytes, the weights one GPU holds under
 * TP x PP x EP, and a LoRA adapter's bytes and how many fit. Each draws either a claim-backed scene (a
 * model's parameter, layer and width claims, and B200's HBM, all through `claimNumber`) or a hypothetical
 * model whose numbers are declared in SYNTHETIC and announced as hypothetical in the prompt (W4).
 * A claim-backed scene stores only the model's name in its params, never a claim's value, so a claim
 * update changes the fingerprint through `claims` and level 0 keeps round params.
 *
 * Every answer is numeric. The slips are the ones the lessons warn about: bits where bytes belong, NVFP4
 * without its scales, total parameters for active ones, a dense weight left unsharded, and GB for GiB.
 */

import { claimNumber } from '@/data/claims'
import { KC } from '@/data/kc/ids'
import { claimRef, finishInstance, resolveVariant, rngFor, type Rng } from '../core'
import { gradeResponse } from '../grade'
import type { AnswerSpec, Gen, Instance, Level, ParamValue, Prompt, PromptPart, RatioRule, SolutionStep, VariantSpec } from '../types'
import { BITS_PER_BYTE, BYTE_UNITS, byteUnitChoices, DTYPE_BYTES, formatNumber, GB, GIB, type Dtype } from '../units'

/** Scenario numbers: nothing here is a real model, GPU or price, and the prompt says "hypothetical". */
const SYNTHETIC = {
  /** two significant digits m, scaled by a decade: model sizes in billions of parameters */
  mMin: 10,
  mMax: 99,
  /** decades of a size: -1 divides by ten, 1 multiplies by ten */
  sizeDecades: [-1, 0, 1],
  bigDecades: [0, 1],
  smallDecades: [-1, 0],
  /** an NVFP4 model is a frontier one: hundreds of billions of parameters, so its weights fill more than one GPU */
  fp4Decades: [1],
  /** routed experts of a hypothetical MoE and the experts a token visits; a token visits at most 1/expertShare of them */
  experts: [8, 16, 32, 64, 128, 256],
  topk: [1, 2, 4, 8],
  expertShare: 4,
  /** decimals of the GiB-per-GB factor in a prompt */
  gibDigits: 4,
  dtypes: ['bf16', 'fp8', 'int4'] as Dtype[],
  /** adapters are stored in 16 or 32 bits */
  loraDtypes: [['bf16'], ['bf16', 'fp32'], ['bf16', 'fp32'], ['bf16', 'fp32']] as Dtype[][],
  copies: [1, 2, 3, 4, 5, 6, 7, 8],
  hbm: [24, 32, 40, 48, 64, 80, 96, 128, 160, 180, 200],
  /** percent of each GPU's HBM kept free for KV cache */
  reserve: [20, 25, 30, 40, 50],
  tp: [2, 4, 8],
  /** pipeline stages */
  pp: [1, 2, 3, 4, 5, 6, 8],
  ep: [2, 4, 8, 16, 32, 64],
  /** percent of shard draws that are a mixture of experts, per level */
  moePct: [0, 0, 75, 75],
  ranks: [4, 8, 16, 32, 64, 128],
  /** square d x d matrices an adapter is attached to, per layer */
  targets: [1, 2, 3, 4, 6, 8],
  layersMin: 12,
  layersMax: 96,
  /** level 0 hidden sizes are two significant digits times this; later levels take multiples of `hiddenStep` */
  hiddenRound: 100,
  hiddenStep: 128,
  hiddenMin: 8,
  hiddenMax: 128,
  /** GiB of HBM an adapter-count item offers, and the fewest adapters it may hold */
  fitGib: [1, 2, 4, 8, 16, 24, 40, 80],
  minFit: 4,
  /** percent of draws that use a claim-backed scene; a dense shard has one model to draw, so it takes fewer */
  realPct: 25,
  shardRealPct: 10,
  /** percent of claim-backed fp4-fit items that ask the weights, not the GPUs (a hypothetical model always asks the GPUs); of lora items that ask the count */
  weightsPct: 50,
  fitPct: 40,
  /** percent of active-bytes items that ask the bytes a step reads rather than the resident bytes */
  readPct: 50,
  /** a slip counts as one only when it is at least this far from a right answer, relatively */
  apart: 0.05,
  /** nominal seconds per variant */
  nsec: { weight: 40, fp4: 70, active: 55, shard: 75, lora: 80 },
}

const L3: Level = 3 // gen-literal-ok: the transfer level index
const ALL_LEVELS: readonly Level[] = [0, 1, 2, L3]
/** Grading windows: a numeric answer is right within 1 %, tighter than the 7 % between GB and GiB. */
const REL_TOL = 0.01 // gen-literal-ok: grading window of the numeric answers

/* ------------------------------ claim-backed scenes ------------------------------ */

interface ModelInfo {
  name: string
  /** total parameters, in billions (a dense model's only count) */
  total: string
  active?: string
  layers?: string
  hidden?: string
}

const MODELS = {
  'llama3-8b': { name: 'Llama-3-8B', total: 'model.llama3-8b.params', layers: 'model.llama3-8b.layers', hidden: 'model.llama3-8b.hidden-size' },
  'llama3-70b': { name: 'Llama-3-70B', total: 'model.llama3-70b.params', layers: 'model.llama3-70b.layers', hidden: 'model.llama3-70b.hidden-size' },
  'mixtral-8x7b': {
    name: 'Mixtral-8x7B',
    total: 'model.mixtral-8x7b.params',
    active: 'model.mixtral-8x7b.active-params',
    layers: 'model.mixtral-8x7b.layers',
    hidden: 'model.mixtral-8x7b.hidden-size',
  },
  'deepseek-v3': { name: 'DeepSeek-V3', total: 'model.deepseek-v3.total-params', active: 'model.deepseek-v3.active-params' },
  'deepseek-r1': { name: 'DeepSeek-R1', total: 'model.deepseek-r1.total-params', active: 'model.deepseek-r1.active-params' },
} as const satisfies Record<string, ModelInfo>
type ModelKey = keyof typeof MODELS
const info = (key: ModelKey): ModelInfo => MODELS[key]

/** The models each variant may draw: all four with a parameter count price weights; only the big ones fill GPUs. */
const WEIGHT_MODELS: readonly ModelKey[] = ['llama3-8b', 'llama3-70b', 'mixtral-8x7b', 'deepseek-v3']
const FP4_WEIGHT_MODELS: readonly ModelKey[] = ['llama3-70b', 'mixtral-8x7b', 'deepseek-v3', 'deepseek-r1']
const FP4_GPU_MODELS: readonly ModelKey[] = ['deepseek-v3', 'deepseek-r1']
const ACTIVE_MODELS: readonly ModelKey[] = ['mixtral-8x7b', 'deepseek-v3', 'deepseek-r1']
const LORA_MODELS: readonly ModelKey[] = ['llama3-8b', 'llama3-70b', 'mixtral-8x7b']
/** The dense scene of shard: Llama-3-70B, whose attention and FFN are all dense. */
const DENSE_MODEL: ModelKey = 'llama3-70b'

const NVFP4_CLAIM = 'serving.nvfp4.bits-per-weight'
const B200 = { name: 'B200', claim: 'hw.b200.hbm-capacity' } as const

/** Binary and decimal spellings of the same size, for the GB/GiB slip. */
const BINARY_OF: Readonly<Record<string, string>> = { GB: 'GiB', MB: 'MiB' }
const DECIMAL_OF: Readonly<Record<string, string>> = { GiB: 'GB', MiB: 'MB' }

const LABEL: Record<Dtype, string> = { fp32: 'FP32', bf16: 'BF16', fp16: 'FP16', fp8: 'FP8', int8: 'INT8', fp4: 'FP4', int4: 'INT4' }

/** "1 byte", "half a byte", "2 bytes": how a prompt says bytes per value. */
function bytesText(b: number): string {
  return b === 1 ? '1 byte' : b < 1 ? 'half a byte' : `${formatNumber(b)} bytes`
}

const bitsOf = (d: Dtype): number => DTYPE_BYTES[d] * BITS_PER_BYTE

/* ------------------------------ scenes ------------------------------ */

interface Scene {
  /** a MODELS key, or `synthetic` */
  model: ModelKey | 'synthetic'
  dtype: Dtype
  /** fp4-fit: weights | gpus. active-bytes: read | resident. lora: bytes | fit. */
  ask: string
  /** total parameters in billions; the dense parameters of a shard scene */
  paramsB: number
  activeB: number
  /** a hypothetical MoE of active-bytes: shared parameters, one expert's, how many experts, how many a token visits */
  shared: number
  expert: number
  experts: number
  topk: number
  expertB: number
  copies: number
  /** fp4-fit on a claim-backed GPU row, else '' */
  gpu: '' | 'b200'
  /** HBM as the prompt states it, in `hbmUnit` */
  hbm: number
  hbmUnit: 'GB' | 'GiB'
  /** percent of HBM kept free for KV cache */
  reserve: number
  tp: number
  pp: number
  ep: number
  rank: number
  targets: number
  layers: number
  hidden: number
  fitGib: number
}

const BLANK: Scene = {
  model: 'synthetic',
  dtype: 'bf16',
  ask: '',
  paramsB: 0,
  activeB: 0,
  shared: 0,
  expert: 0,
  experts: 0,
  topk: 0,
  expertB: 0,
  copies: 1,
  gpu: '',
  hbm: 0,
  hbmUnit: 'GB',
  reserve: 0,
  tp: 1,
  pp: 1,
  ep: 1,
  rank: 0,
  targets: 0,
  layers: 0,
  hidden: 0,
  fitGib: 0,
}

/** A claim-backed scene: the model's counts come from its claims, never from params. */
function realScene(key: ModelKey, extra: Partial<Scene> = {}): Scene {
  const m = info(key)
  return {
    ...BLANK,
    ...extra,
    model: key,
    paramsB: claimNumber(m.total),
    activeB: m.active ? claimNumber(m.active) : 0,
    layers: m.layers ? claimNumber(m.layers) : 0,
    hidden: m.hidden ? claimNumber(m.hidden) : 0,
  }
}

const b200Hbm = (): number => claimNumber(B200.claim)

/** Every size m x decade, in billions of parameters: m has two significant digits, so level 0 stays round. */
function grid(decades: readonly number[], min: number = SYNTHETIC.mMin): number[] {
  const out: number[] = []
  for (let m = min; m <= SYNTHETIC.mMax; m++) for (const e of decades) out.push(e < 0 ? m / 10 : e === 0 ? m : m * 10)
  return out
}
const GRIDS = {
  weights: grid(SYNTHETIC.sizeDecades),
  big: grid(SYNTHETIC.bigDecades),
  small: grid(SYNTHETIC.smallDecades),
  fp4: grid(SYNTHETIC.fp4Decades),
  /** a mixture of experts: dense layers of 10-99 billion, experts of 100-990 billion */
  moeDense: grid([0]),
  experts: grid([1]),
  /** one expert's parameters, in billions: tenths */
  expertSize: grid([-1]),
  /** hidden sizes of level 0: two significant digits times 100 */
  hidden: Array.from({ length: SYNTHETIC.mMax - SYNTHETIC.mMin + 1 }, (_, i) => (SYNTHETIC.mMin + i) * SYNTHETIC.hiddenRound),
}

const bytesPerWeight = (d: Dtype): number => bitsOf(d) / BITS_PER_BYTE

/** A size answered in `unit`: the bytes over the unit's bytes. */
const inUnit = (bytes: number, unit: string): number => bytes / BYTE_UNITS[unit]

/** Adapter bytes: a rank-r pair of matrices (r x d_in and d_out x r) on each of `targets` square matrices in every layer. */
const loraBytes = (s: Pick<Scene, 'rank' | 'hidden' | 'targets' | 'layers' | 'dtype'>): number => s.rank * (s.hidden + s.hidden) * s.targets * s.layers * DTYPE_BYTES[s.dtype]

/** A hypothetical MoE's counts: the shared parameters plus every expert, or plus the experts a token visits. */
function moeCounts(sc: Scene): Scene {
  return { ...sc, paramsB: sc.shared + sc.experts * sc.expert, activeB: sc.shared + sc.topk * sc.expert }
}

function draw(v: string, level: Level, rng: Rng): Scene {
  const real = rng.int(1, 100) <= SYNTHETIC.realPct
  if (v === 'weight-bytes') {
    const base: Scene = { ...BLANK, dtype: rng.pick(SYNTHETIC.dtypes), copies: rng.pick(SYNTHETIC.copies) }
    return real ? realScene(rng.pick(WEIGHT_MODELS), base) : { ...base, paramsB: rng.pick(GRIDS.weights) }
  }
  if (v === 'fp4-fit') {
    const reserve = rng.pick(SYNTHETIC.reserve)
    if (real) {
      const ask = rng.int(1, 100) <= SYNTHETIC.weightsPct ? 'weights' : 'gpus'
      const model = rng.pick(ask === 'weights' ? FP4_WEIGHT_MODELS : FP4_GPU_MODELS)
      return realScene(model, { ask, reserve, gpu: 'b200', hbm: b200Hbm() })
    }
    return { ...BLANK, ask: 'gpus', reserve, paramsB: rng.pick(GRIDS.fp4), hbm: rng.pick(SYNTHETIC.hbm), hbmUnit: level === L3 ? 'GiB' : 'GB' }
  }
  if (v === 'active-bytes') {
    const base: Scene = { ...BLANK, dtype: rng.pick(SYNTHETIC.dtypes), ask: rng.int(1, 100) <= SYNTHETIC.readPct ? 'read' : 'resident' }
    if (real) return realScene(rng.pick(ACTIVE_MODELS), base)
    const shared = rng.pick(GRIDS.moeDense)
    const expert = rng.pick(GRIDS.expertSize)
    const experts = rng.pick(SYNTHETIC.experts)
    const topk = rng.pick(SYNTHETIC.topk.filter((k) => k * SYNTHETIC.expertShare <= experts))
    return moeCounts({ ...base, shared, expert, experts, topk })
  }
  if (v === 'shard') {
    const base: Scene = { ...BLANK, dtype: rng.pick(SYNTHETIC.dtypes), tp: rng.pick(SYNTHETIC.tp), pp: rng.pick(SYNTHETIC.pp) }
    if (rng.int(1, 100) <= SYNTHETIC.moePct[level]) {
      return { ...base, paramsB: rng.pick(GRIDS.moeDense), expertB: rng.pick(GRIDS.experts), ep: rng.pick(SYNTHETIC.ep) }
    }
    return rng.int(1, 100) <= SYNTHETIC.shardRealPct ? realScene(DENSE_MODEL, base) : { ...base, paramsB: rng.pick(GRIDS.big) }
  }
  // lora
  const dtype = rng.pick(SYNTHETIC.loraDtypes[level])
  const rank = rng.pick(SYNTHETIC.ranks)
  let sc: Scene
  if (real) {
    // q_proj and o_proj are hidden x hidden in every one of these models; k_proj and v_proj are narrower under GQA
    sc = realScene(rng.pick(LORA_MODELS), { dtype, rank, targets: rng.int(1, 2) })
  } else {
    const layers = rng.int(SYNTHETIC.layersMin, SYNTHETIC.layersMax)
    const hidden = level === 0 ? rng.pick(GRIDS.hidden) : SYNTHETIC.hiddenStep * rng.int(SYNTHETIC.hiddenMin, SYNTHETIC.hiddenMax)
    sc = { ...BLANK, dtype, rank, layers, hidden, targets: rng.pick(SYNTHETIC.targets) }
  }
  const ask = rng.int(1, 100) <= SYNTHETIC.fitPct ? 'fit' : 'bytes'
  if (ask === 'bytes') return { ...sc, ask }
  const bytes = loraBytes(sc)
  const fits = SYNTHETIC.fitGib.filter((g) => (g * GIB) / bytes >= SYNTHETIC.minFit)
  return fits.length === 0 ? { ...sc, ask: 'bytes' } : { ...sc, ask, fitGib: rng.pick(fits) }
}

/* ------------------------------ prompts and solutions ------------------------------ */

const text = (t: string): PromptPart => ({ t: 'text', text: t })
const val = (value: number, unit?: string, digits?: number): PromptPart => ({ t: 'value', value, ...(unit ? { unit } : {}), ...(digits === undefined ? {} : { digits }) })
const step = (parts: PromptPart[], value: number, unit: string): SolutionStep => ({ text: parts, result: { value, unit } })

const BILLION = 'billion parameters'

/** The parameter count: a claim chip for a real model, a plain number for a hypothetical one. */
const countPart = (sc: Scene, field: 'total' | 'active', value: number): PromptPart => {
  if (sc.model === 'synthetic') return val(value, BILLION)
  return { t: 'claim', claim: field === 'total' ? info(sc.model).total : (info(sc.model).active as string), unit: BILLION }
}

const subject = (sc: Scene): string => (sc.model === 'synthetic' ? 'A hypothetical model' : info(sc.model).name)

/** The unit a lora size is answered in: MB or GB, and MiB or GiB at the transfer level. */
function loraUnit(level: Level, bytes: number): string {
  const binary = level === L3
  return bytes >= (binary ? GIB : GB) ? (binary ? 'GiB' : 'GB') : binary ? 'MiB' : 'MB'
}

interface Calc {
  steps: SolutionStep[]
  truth: number
  unit: string
}

/** The steps, the truth and the answer's unit of one scene; the last step carries the answer. */
function calc(v: string, level: Level, sc: Scene): Calc {
  const binary = level === L3
  const sizeUnit = binary ? 'GiB' : 'GB'
  const steps: SolutionStep[] = []
  const toBinary = (gb: number): void => {
    steps.push(step([text('In GiB = GB ÷ '), val(GIB / GB, undefined, SYNTHETIC.gibDigits)], inUnit(gb * GB, 'GiB'), 'GiB'))
  }
  if (v === 'weight-bytes') {
    const bits = bitsOf(sc.dtype)
    const bpw = bytesPerWeight(sc.dtype)
    const one = sc.paramsB * bpw
    const all = one * sc.copies
    steps.push(step([text(`Bits per weight in ${LABEL[sc.dtype]} = `), val(bits)], bits, 'bits'))
    steps.push(step([text('Bytes per weight = bits ÷ '), val(BITS_PER_BYTE)], bpw, 'B'))
    steps.push(step([text('One copy = '), countPart(sc, 'total', sc.paramsB), text(' × '), val(bpw, 'B per weight')], one, 'GB'))
    if (sc.copies > 1) steps.push(step([text('All copies = '), val(one, 'GB'), text(' × '), val(sc.copies, 'copies')], all, 'GB'))
    if (binary) toBinary(all)
    return { steps, truth: binary ? inUnit(all * GB, 'GiB') : all, unit: sizeUnit }
  }
  if (v === 'fp4-fit') {
    const bits = claimNumber(NVFP4_CLAIM)
    const bpw = bits / BITS_PER_BYTE
    const weights = sc.paramsB * bpw
    steps.push(step([text('Bits per weight in NVFP4, scales included = '), { t: 'claim', claim: NVFP4_CLAIM, unit: 'bits' }], bits, 'bits'))
    steps.push(step([text('Bytes per weight = bits ÷ '), val(BITS_PER_BYTE)], bpw, 'B'))
    steps.push(step([text('Weights = '), countPart(sc, 'total', sc.paramsB), text(' × '), val(bpw, 'B per weight')], weights, 'GB'))
    if (sc.ask === 'weights') {
      if (binary) toBinary(weights)
      return { steps, truth: binary ? inUnit(weights * GB, 'GiB') : weights, unit: sizeUnit }
    }
    const hbmGb = sc.hbmUnit === 'GiB' ? (sc.hbm * GIB) / GB : sc.hbm
    if (sc.hbmUnit === 'GiB') steps.push(step([text('HBM in GB = '), val(sc.hbm, 'GiB'), text(' × '), val(GIB / GB, undefined, SYNTHETIC.gibDigits)], hbmGb, 'GB'))
    const usable = hbmGb * (1 - sc.reserve / 100)
    steps.push(step([text('Usable HBM per GPU = HBM × (1 − '), val(sc.reserve / 100, undefined, 2), text(')')], usable, 'GB'))
    steps.push(step([text('GPUs = weights ÷ usable HBM per GPU = '), val(weights, 'GB'), text(' ÷ '), val(usable, 'GB')], weights / usable, 'GPUs'))
    return { steps, truth: weights / usable, unit: 'GPUs' }
  }
  if (v === 'active-bytes') {
    const bpw = bytesPerWeight(sc.dtype)
    const read = sc.ask === 'read'
    const n = read ? sc.activeB : sc.paramsB
    steps.push(step([text(`Bytes per weight in ${LABEL[sc.dtype]} = `), val(bitsOf(sc.dtype)), text(' bits ÷ '), val(BITS_PER_BYTE)], bpw, 'B'))
    if (sc.model === 'synthetic') {
      steps.push(
        step(
          read
            ? [text('A decode step reads the shared parameters and the experts a token visits: '), val(sc.shared), text(' + '), val(sc.topk), text(' × '), val(sc.expert)]
            : [text('Every expert must be resident, so count them all: '), val(sc.shared), text(' + '), val(sc.experts), text(' × '), val(sc.expert)],
          n,
          BILLION,
        ),
      )
    } else {
      steps.push(
        step(
          [text(read ? 'A decode step reads only the active parameters: ' : 'Every expert must be resident, so count the total: '), countPart(sc, read ? 'active' : 'total', n)],
          n,
          BILLION,
        ),
      )
    }
    steps.push(step([text('Weights = '), val(n, BILLION), text(' × '), val(bpw, 'B per weight')], n * bpw, 'GB'))
    if (binary) toBinary(n * bpw)
    return { steps, truth: binary ? inUnit(n * bpw * GB, 'GiB') : n * bpw, unit: sizeUnit }
  }
  if (v === 'shard') {
    const bpw = bytesPerWeight(sc.dtype)
    const dense = (sc.paramsB * bpw) / (sc.tp * sc.pp)
    const experts = sc.expertB > 0 ? (sc.expertB * bpw) / (sc.ep * sc.pp) : 0
    steps.push(step([text(`Bytes per weight in ${LABEL[sc.dtype]} = `), val(bitsOf(sc.dtype)), text(' bits ÷ '), val(BITS_PER_BYTE)], bpw, 'B'))
    steps.push(step([text('Dense weights per GPU = '), val(sc.paramsB, 'billion'), text(' × '), val(bpw, 'B'), text(' ÷ (TP '), val(sc.tp), text(' × PP '), val(sc.pp), text(')')], dense, 'GB'))
    if (sc.expertB > 0) {
      steps.push(step([text('Expert weights per GPU = '), val(sc.expertB, 'billion'), text(' × '), val(bpw, 'B'), text(' ÷ (EP '), val(sc.ep), text(' × PP '), val(sc.pp), text(')')], experts, 'GB'))
      steps.push(step([text('Weights per GPU = '), val(dense, 'GB'), text(' + '), val(experts, 'GB')], dense + experts, 'GB'))
    }
    if (binary) toBinary(dense + experts)
    return { steps, truth: binary ? inUnit((dense + experts) * GB, 'GiB') : dense + experts, unit: sizeUnit }
  }
  // lora
  const bytesPerValue = DTYPE_BYTES[sc.dtype]
  const perMatrix = sc.rank * (sc.hidden + sc.hidden)
  const perLayer = perMatrix * sc.targets
  const values = perLayer * sc.layers
  const bytes = values * bytesPerValue
  const dim = (field: 'layers' | 'hidden'): PromptPart => (sc.model === 'synthetic' ? val(sc[field]) : { t: 'claim', claim: info(sc.model)[field] as string })
  steps.push(step([text('Values per adapted matrix = rank × (d_in + d_out) = '), val(sc.rank), text(' × ('), dim('hidden'), text(' + '), dim('hidden'), text(')')], perMatrix, 'values'))
  steps.push(step([text('Values per layer = '), val(perMatrix), text(' × '), val(sc.targets, sc.targets === 1 ? 'matrix' : 'matrices')], perLayer, 'values'))
  steps.push(step([text('Values per adapter = '), val(perLayer), text(' × '), dim('layers'), text(' layers')], values, 'values'))
  steps.push(step([text('Bytes per adapter = '), val(values), text(` values × ${bytesText(bytesPerValue)} (${LABEL[sc.dtype]})`)], bytes, 'B'))
  if (sc.ask === 'fit') {
    const fit = Math.floor((sc.fitGib * GIB) / bytes)
    steps.push(step([text('Adapters that fit = ⌊ '), val(sc.fitGib, 'GiB'), text(' in bytes ÷ '), val(bytes, 'B'), text(' ⌋')], fit, 'adapters'))
    return { steps, truth: fit, unit: 'adapters' }
  }
  const unit = loraUnit(level, bytes)
  if (unit !== 'B') steps.push(step([text(`In ${unit} = bytes ÷ `), val(BYTE_UNITS[unit], 'B')], inUnit(bytes, unit), unit))
  return { steps, truth: inUnit(bytes, unit), unit }
}

function stemFor(v: string, sc: Scene, unit: string): PromptPart[] {
  const stored = (d: Dtype): PromptPart => text(`stored in ${LABEL[d]} (${bytesText(DTYPE_BYTES[d])} per weight). `)
  if (v === 'weight-bytes') {
    const copies = sc.copies > 1 ? [text(`A node keeps ${sc.copies} full copies of the weights, one per replica. `)] : []
    return [text(`${subject(sc)} has `), countPart(sc, 'total', sc.paramsB), text(', '), stored(sc.dtype), ...copies, text(`How many ${unit} do the weights take${sc.copies > 1 ? ' in all' : ''}? Answer in ${unit}.`)]
  }
  if (v === 'fp4-fit') {
    const head: PromptPart[] = [
      text(`${subject(sc)} has `),
      countPart(sc, 'total', sc.paramsB),
      text('. Its weights are stored in NVFP4: 4-bit values plus one FP8 scale for every 16 values, '),
      { t: 'claim', claim: NVFP4_CLAIM, unit: 'bits per weight' },
      text(' in all. '),
    ]
    if (sc.ask === 'weights') return [...head, text(`How many ${unit} do the weights take? Answer in ${unit}.`)]
    const where: PromptPart[] = sc.gpu
      ? [text(`They run on ${B200.name} GPUs, each with `), { t: 'claim', claim: B200.claim }, text(' of HBM. ')]
      : [text('They run on a hypothetical accelerator with '), val(sc.hbm, sc.hbmUnit), text(' of HBM per GPU. ')]
    return [
      ...head,
      ...where,
      val(sc.reserve, '%'),
      text(" of each GPU's HBM must stay free for KV cache. How many GPUs' worth of usable HBM do the weights fill? Answer with a fraction: 2.6 means buying 3 GPUs."),
    ]
  }
  if (v === 'active-bytes') {
    const ask =
      sc.ask === 'read'
        ? `How many ${unit} of weights does one decode step read? Count only what the step needs and ignore the KV cache. Answer in ${unit}.`
        : `How many ${unit} of HBM must the weights occupy so that any token can be served? Answer in ${unit}.`
    const model: PromptPart[] =
      sc.model === 'synthetic'
        ? [
            text(`A hypothetical mixture-of-experts model has ${sc.experts} routed experts of `),
            val(sc.expert, BILLION),
            text(' each plus '),
            val(sc.shared, BILLION),
            text(` of shared attention and dense layers; every token visits ${sc.topk} expert${sc.topk === 1 ? '' : 's'}. `),
          ]
        : [text(`${info(sc.model).name} is a mixture of experts with `), countPart(sc, 'total', sc.paramsB), text(' in all, '), countPart(sc, 'active', sc.activeB), text(' of them active for each token. ')]
    return [...model, text('Its weights are '), stored(sc.dtype), text(ask)]
  }
  if (v === 'shard') {
    const moe = sc.expertB > 0
    const model: PromptPart[] = moe
      ? [text('A hypothetical mixture-of-experts model has '), val(sc.paramsB, 'billion'), text(' dense parameters (attention and shared layers) and '), val(sc.expertB, 'billion'), text(' routed-expert parameters, ')]
      : [text(`${subject(sc)} is dense, with `), countPart(sc, 'total', sc.paramsB), text(', ')]
    const split = moe
      ? `The dense weights are split evenly over the TP × PP GPUs of a replica and every EP rank keeps its own copy of them. Each pipeline stage holds only its own layers, and so only those layers' experts: ${sc.pp > 1 ? `the experts are split across the ${sc.pp} stages and then across the ${sc.ep} EP ranks of each stage` : `the experts are split across the ${sc.ep} EP ranks`}, each expert on one rank. `
      : 'The weights are split evenly over the TP × PP GPUs of a replica. '
    return [
      ...model,
      stored(sc.dtype),
      text(`It is served with tensor parallelism ${sc.tp}, pipeline parallelism ${sc.pp}${moe ? ` and expert parallelism ${sc.ep}` : ''}. ${split}How many ${unit} of weights does one GPU hold? Answer in ${unit}.`),
    ]
  }
  // lora
  const dim = (field: 'layers' | 'hidden'): PromptPart => (sc.model === 'synthetic' ? val(sc[field]) : { t: 'claim', claim: info(sc.model)[field] as string })
  const on =
    sc.model === 'synthetic'
      ? `${sc.targets === 1 ? 'one square matrix' : `${sc.targets} square matrices`} (each hidden × hidden)`
      : sc.targets === 1
        ? 'the query projection (hidden × hidden)'
        : 'the query and output projections (each hidden × hidden)'
  const ask = sc.ask === 'fit' ? `How many whole adapters fit in ${sc.fitGib} GiB of HBM? Ignore everything else.` : `How much memory does one adapter take? Answer in ${unit}.`
  return [
    text(`${subject(sc)} has `),
    dim('layers'),
    text(' layers and hidden size '),
    dim('hidden'),
    text(`. A LoRA adapter of rank ${sc.rank} is attached to ${on} in every layer: for each adapted matrix it stores A (rank × d_in) and B (d_out × rank), in ${LABEL[sc.dtype]} (${bytesText(DTYPE_BYTES[sc.dtype])} per value). ${ask}`),
  ]
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
  { id: 'weight-bytes', title: 'Weight bytes at a precision', kcs: [KC.quantizedBytes], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.weight },
  { id: 'fp4-fit', title: 'NVFP4 weights and the GPUs they fill', kcs: [KC.fp4Capacity, KC.quantizedBytes], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.fp4 },
  { id: 'active-bytes', title: 'Bytes read per step against bytes resident', kcs: [KC.moeActiveParams, KC.quantizedBytes], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.active },
  { id: 'shard', title: 'Weights per GPU under TP, PP and EP', kcs: [KC.parallelMemory, KC.quantizedBytes], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.shard },
  { id: 'lora', title: 'LoRA adapter bytes and how many fit', kcs: [KC.loraAdapterBytes], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.lora },
]

const variantOf = (id: string): VariantSpec => VARIANTS.find((v) => v.id === id) as VariantSpec

/** Every level assesses the variant's first KC; the transfer level adds the rest (bytes per weight sit under every variant). */
const kcsFor = (v: VariantSpec, level: Level): string[] => (level === L3 ? [...v.kcs] : [v.kcs[0]])

/** The params of a scene: a claim-backed one names its model and stores no claim's value. */
function paramsOf(v: string, sc: Scene): Record<string, ParamValue> {
  const p: Record<string, ParamValue> = { model: sc.model }
  const synthetic = sc.model === 'synthetic'
  if (v !== 'fp4-fit' && v !== 'lora') p.dtype = sc.dtype
  if (v === 'weight-bytes') {
    p.copies = sc.copies
    if (synthetic) p.paramsB = sc.paramsB
  } else if (v === 'fp4-fit') {
    p.ask = sc.ask
    if (synthetic) p.paramsB = sc.paramsB
    if (sc.ask === 'gpus') {
      p.reserve = sc.reserve
      if (sc.gpu) p.gpu = sc.gpu
      else {
        p.hbm = sc.hbm
        p.hbmUnit = sc.hbmUnit
      }
    }
  } else if (v === 'active-bytes') {
    p.ask = sc.ask
    if (synthetic) {
      p.shared = sc.shared
      p.expert = sc.expert
      p.experts = sc.experts
      p.topk = sc.topk
    }
  } else if (v === 'shard') {
    p.tp = sc.tp
    p.pp = sc.pp
    if (synthetic) p.paramsB = sc.paramsB
    if (sc.expertB > 0) {
      p.expertB = sc.expertB
      p.ep = sc.ep
    }
  } else {
    p.dtype = sc.dtype
    p.ask = sc.ask
    p.rank = sc.rank
    p.targets = sc.targets
    if (synthetic) {
      p.layers = sc.layers
      p.hidden = sc.hidden
    }
    if (sc.ask === 'fit') p.fitGib = sc.fitGib
  }
  return p
}

/** The claims a scene reads. */
function claimsOf(v: string, sc: Scene): string[] {
  const out: string[] = []
  if (v === 'fp4-fit') out.push(NVFP4_CLAIM)
  if (sc.model === 'synthetic') return out
  const m = info(sc.model)
  if (v === 'lora') out.push(m.layers as string, m.hidden as string)
  else out.push(m.total)
  if (v === 'active-bytes') out.push(m.active as string)
  if (v === 'fp4-fit' && sc.ask === 'gpus' && sc.gpu) out.push(B200.claim)
  return out
}

function build(v: VariantSpec, level: Level, seed: number, sc: Scene): Instance {
  const { steps, truth, unit } = calc(v.id, level, sc)
  const worked = workedFor(level, steps)
  const prompt: Prompt = { stem: stemFor(v.id, sc, unit), ...(worked ? { worked } : {}) }
  const sized = unit in BYTE_UNITS
  const answer: AnswerSpec = {
    kind: 'numeric',
    truth,
    unit,
    // a whole-adapter count may be off by one: the learner may leave the fraction on
    tolerance: unit === 'adapters' ? { rel: REL_TOL, abs: 1 } : { rel: REL_TOL },
    ...(sized ? { units: byteUnitChoices(unit, ['MB', 'GB', 'TB', 'MiB', 'GiB']) } : {}),
  }
  return finishInstance(gen, { variant: v.id, seed, level, nsec: v.nsec, kcs: kcsFor(v, level), params: paramsOf(v.id, sc), prompt, answer, claims: claimsOf(v.id, sc).map(claimRef) })
}

function make(seed: number, level: Level, variant?: string): Instance {
  const v = resolveVariant(gen, seed, level, variant)
  return build(v, level, seed, draw(v.id, level, rngFor(gen.id, v.id, level, seed)))
}

/** The Scene back out of an instance's params (and its claims), for `solution` and the ratio rules. */
function sceneOf(inst: Instance): Scene {
  const p = inst.params
  const n = (k: string, or = 0): number => (typeof p[k] === 'number' ? p[k] : or)
  const model = p.model as Scene['model']
  const base: Scene = {
    ...BLANK,
    dtype: (p.dtype as Dtype | undefined) ?? 'bf16',
    ask: typeof p.ask === 'string' ? p.ask : '',
    copies: n('copies', 1),
    reserve: n('reserve'),
    tp: n('tp', 1),
    pp: n('pp', 1),
    ep: n('ep', 1),
    expertB: n('expertB'),
    rank: n('rank'),
    targets: n('targets'),
    fitGib: n('fitGib'),
    hbmUnit: (p.hbmUnit as Scene['hbmUnit'] | undefined) ?? 'GB',
  }
  if (model === 'synthetic') {
    const sc = { ...base, paramsB: n('paramsB'), shared: n('shared'), expert: n('expert'), experts: n('experts'), topk: n('topk'), hbm: n('hbm'), layers: n('layers'), hidden: n('hidden') }
    return inst.variant === 'active-bytes' ? moeCounts(sc) : sc
  }
  const gpu = p.gpu === 'b200' ? 'b200' : ''
  return realScene(model, { ...base, gpu, hbm: gpu ? b200Hbm() : 0 })
}

function solution(inst: Instance): SolutionStep[] {
  return calc(inst.variant, inst.level, sceneOf(inst)).steps
}

/* ------------------------------ diagnoses ------------------------------ */

/** A numeric param, 0 when the instance has none: a rule's message is rendered for every instance, applicable or not. */
const num = (inst: Instance, k: string): number => (typeof inst.params[k] === 'number' ? inst.params[k] : 0)
const unitOf = (inst: Instance): string => (inst.answer.kind === 'numeric' ? inst.answer.unit : '')
/** A lora count divides by the adapter's bytes, so every slip there lands on the inverse ratio. */
const slip = (inst: Instance, rho: number): number => (unitOf(inst) === 'adapters' ? 1 / rho : rho)
/** A ratio a learner could land on only when it is clear of a right answer. */
const apart = (rho: number): number | null => (Number.isFinite(rho) && Math.abs(rho - 1) > SYNTHETIC.apart ? rho : null)

/** Weights per GPU of a shard scene: [dense, experts] in GB. */
function shardParts(sc: Scene): [number, number] {
  const bpw = bytesPerWeight(sc.dtype)
  return [(sc.paramsB * bpw) / (sc.tp * sc.pp), sc.expertB > 0 ? (sc.expertB * bpw) / (sc.ep * sc.pp) : 0]
}

const RATIO_RULES: readonly RatioRule[] = [
  {
    id: 'memory.bits-as-bytes',
    // the dtype name stands for bits; a byte is 8 of them: bits per weight stood in for bytes
    ratio: (inst) => slip(inst, BITS_PER_BYTE),
    message: 'You used bits where bytes belong: divide the bits per value by 8, because a byte is 8 bits.',
  },
  {
    id: 'memory.fp4-no-scales',
    ratio: (inst) => (inst.variant === 'fp4-fit' ? (DTYPE_BYTES.fp4 * BITS_PER_BYTE) / claimNumber(NVFP4_CLAIM) : null),
    message: 'You counted 4 bits per weight: NVFP4 also stores an FP8 scale for every 16 values, 4.5 bits in all.',
  },
  {
    id: 'memory.no-kv-reserve',
    ratio: (inst) => (inst.variant === 'fp4-fit' && inst.params.ask === 'gpus' ? apart(1 - num(inst, 'reserve') / 100) : null),
    message: (inst) => `You used all of each GPU's HBM: ${formatNumber(num(inst, 'reserve'))} % of it has to stay free for KV cache.`,
  },
  {
    id: 'memory.total-for-active',
    ratio: (inst) => {
      if (inst.variant !== 'active-bytes' || inst.params.ask !== 'read') return null
      const sc = sceneOf(inst)
      return apart(sc.paramsB / sc.activeB)
    },
    message: (inst) => `You counted every parameter: a decode step reads only the ${formatNumber(sceneOf(inst).activeB)} billion active ones (all of them must be resident, but they are not all read).`,
  },
  {
    id: 'memory.active-for-total',
    ratio: (inst) => {
      if (inst.variant !== 'active-bytes' || inst.params.ask !== 'resident') return null
      const sc = sceneOf(inst)
      return apart(sc.activeB / sc.paramsB)
    },
    message: (inst) => `You counted only the active parameters: any token may route to any expert, so memory must hold all ${formatNumber(sceneOf(inst).paramsB)} billion.`,
  },
  {
    id: 'memory.unsharded',
    // the dense weights left whole instead of split TP x PP ways
    ratio: (inst) => {
      if (inst.variant !== 'shard') return null
      const sc = sceneOf(inst)
      const [dense, experts] = shardParts(sc)
      return apart((dense * sc.tp * sc.pp + experts) / (dense + experts))
    },
    message: (inst) => {
      const sc = sceneOf(inst)
      return `You left the dense weights unsharded: TP ${sc.tp} × PP ${sc.pp} splits them ${sc.tp * sc.pp} ways.`
    },
  },
  {
    id: 'memory.experts-unsharded',
    ratio: (inst) => {
      if (inst.variant !== 'shard') return null
      const sc = sceneOf(inst)
      const [dense, experts] = shardParts(sc)
      return experts > 0 ? apart((dense + experts * sc.ep * sc.pp) / (dense + experts)) : null
    },
    message: (inst) => `You kept every expert on each GPU: EP ${sceneOf(inst).ep} spreads them across ${sceneOf(inst).ep} ranks, and each pipeline stage holds only its own layers' experts.`,
  },
  {
    id: 'memory.experts-ignore-pp',
    // the experts split by EP alone: the old key, which forgot that a pipeline stage holds only its own layers' experts
    ratio: (inst) => {
      if (inst.variant !== 'shard') return null
      const sc = sceneOf(inst)
      const [dense, experts] = shardParts(sc)
      return experts > 0 ? apart((dense + experts * sc.pp) / (dense + experts)) : null
    },
    message: (inst) => `You divided the experts by EP alone: each of the ${sceneOf(inst).pp} pipeline stages holds only its own layers, so a GPU holds only its stage's experts, split ${sceneOf(inst).ep} ways.`,
  },
  {
    id: 'memory.lora-one-target',
    ratio: (inst) => (inst.variant === 'lora' ? apart(slip(inst, 1 / num(inst, 'targets'))) : null),
    message: (inst) => `You counted one matrix per layer: the adapter sits on all ${formatNumber(num(inst, 'targets'))} of them.`,
  },
  {
    id: 'memory.lora-one-layer',
    ratio: (inst) => (inst.variant === 'lora' ? apart(slip(inst, 1 / sceneOf(inst).layers)) : null),
    message: (inst) => `You counted one layer: every one of the ${formatNumber(sceneOf(inst).layers)} layers carries its own adapter matrices.`,
  },
  {
    id: 'memory.lora-full-matrix',
    // d x d values instead of rank x (d + d)
    ratio: (inst) => {
      if (inst.variant !== 'lora') return null
      const sc = sceneOf(inst)
      return apart(slip(inst, sc.hidden / (sc.rank * 2)))
    },
    message: 'You priced a full d × d matrix: an adapter stores two thin ones, A (rank × d_in) and B (d_out × rank).',
  },
  {
    id: 'memory.gb-gib',
    ratio: (inst) => {
      const u = unitOf(inst)
      const dec = DECIMAL_OF[u]
      const bin = BINARY_OF[u]
      // the answer's own unit says which prefix counts: a number in the other prefix is off by 1,024^n over 1,000^n
      if (dec) return apart(BYTE_UNITS[u] / BYTE_UNITS[dec])
      if (bin) return apart(BYTE_UNITS[u] / BYTE_UNITS[bin])
      // HBM stated in GiB and read as GB
      if (inst.variant === 'fp4-fit' && inst.params.hbmUnit === 'GiB' && inst.params.ask === 'gpus') return apart(GIB / GB)
      if (inst.variant === 'lora' && u === 'adapters') return apart(GB / GIB)
      return null
    },
    message: 'GB and GiB differ by 7 %: 1 GB is 10^9 bytes and 1 GiB is 2^30. Check which one this item uses.',
  },
]

/* ------------------------------ pins ------------------------------ */

const pinBuild = (variant: string, level: Level, sc: Scene): Instance => build(variantOf(variant), level, 1, sc)

const pins: Gen['pins'] = [
  // gen-literal-ok: t6.l5's own figure, 671 B x 4.5 bits / 8 = 377.4 GB (the lesson says ~377; erratum #5)
  { name: 'DeepSeek-V3 in NVFP4: weights in GB', source: 't6.l5', make: () => pinBuild('fp4-fit', 2, realScene('deepseek-v3', { ask: 'weights' })), truth: 377, tolerance: { abs: 0.5 } },
  // gen-literal-ok: t4.l7 and t6.l5 round Llama-3-70B at BF16 to 140 GB (the claim is 70.55 B parameters, 141.1 GB)
  { name: 'Llama-3-70B at BF16, in GB', source: 't4.l7', make: () => pinBuild('weight-bytes', 2, realScene('llama3-70b', { dtype: 'bf16' })), truth: 140, tolerance: { rel: 0.01 } },
  // gen-literal-ok: t4.l7's "140 GB -> ~35 GB" for a 70B model at INT4
  { name: 'Llama-3-70B at INT4, in GB', source: 't4.l7', make: () => pinBuild('weight-bytes', 2, realScene('llama3-70b', { dtype: 'int4' })), truth: 35, tolerance: { rel: 0.01 } },
  // gen-literal-ok: t6.l5's "at FP8 the same model is ~671 GB", all experts resident
  { name: 'DeepSeek-V3 at FP8: resident weights in GB', source: 't6.l5', make: () => pinBuild('active-bytes', 2, realScene('deepseek-v3', { dtype: 'fp8', ask: 'resident' })), truth: 671, tolerance: { abs: 0.5 } },
  // gen-literal-ok: t6.l1's 37 B active parameters, one byte each at FP8
  { name: 'DeepSeek-V3 at FP8: weights one decode step reads, in GB', source: 't6.l1', make: () => pinBuild('active-bytes', 2, realScene('deepseek-v3', { dtype: 'fp8', ask: 'read' })), truth: 37, tolerance: { abs: 0.5 } },
  // gen-literal-ok: 16 x (4,096 + 4,096) x 2 matrices x 32 layers x 2 B = 16 MiB exactly
  { name: 'Llama-3-8B rank-16 q/o adapter at BF16, in MiB', source: 't6.l9', make: () => pinBuild('lora', L3, realScene('llama3-8b', { dtype: 'bf16', ask: 'bytes', rank: 16, targets: 2 })), truth: 16 },
]

const gen: Gen = {
  id: 'memory',
  version: 1,
  title: 'Where the weights go',
  kcs: [KC.quantizedBytes, KC.fp4Capacity, KC.moeActiveParams, KC.parallelMemory, KC.loraAdapterBytes],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution,
  pins,
}

export default gen
