/**
 * A small, well-formed generator family for the framework's own tests (never shipped: it lives in
 * tests/, not src/lib/items/families). It exercises every answer kind, the claim fingerprint, a
 * computed ratio rule, units, and pins, so `checkFamily` can be shown to pass a sound family and
 * to catch each defect when one is injected.
 */

import { claimRef, finishInstance, rngFor } from '../../src/lib/items/core'
import { gradeResponse } from '../../src/lib/items/grade'
import type { Gen, Instance, Level, RatioRule, SolutionStep, VariantSpec } from '../../src/lib/items/types'
import { byteUnitChoices, DTYPE_BYTES, KV_PLANES, type Dtype } from '../../src/lib/items/units'

const KCS = ['t5.kv-bytes-per-token', 't5.kv-capacity'] as const
const ALL_LEVELS = [0, 1, 2, 3] as const

const SYNTHETIC = {
  layersMin: 10,
  layersMax: 99,
  kvHeads: [1, 2, 4, 8, 16, 32, 64],
  groups: [1, 2, 4, 8],
  headDims: [32, 40, 48, 64, 80, 96, 128, 256],
  dtypes: ['bf16', 'fp8', 'fp4', 'int8'] as Dtype[],
  hbmGb: [24, 40, 48, 80, 96, 141, 192],
  tokens: [1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000],
}

const RATIO_RULES: RatioRule[] = [
  {
    id: 'demo.priced-fp16',
    ratio: (inst) => (inst.params.dtype === 'fp8' ? 2 : inst.params.dtype === 'fp4' ? 4 : null),
    message: (inst) => `You priced FP16: this cache is ${String(inst.params.dtype).toUpperCase()}, ${DTYPE_BYTES[inst.params.dtype as Dtype]} byte(s) per value.`,
  },
  { id: 'demo.forgot-k-and-v', ratio: 1 / KV_PLANES, message: 'You counted one plane: a KV cache stores K and V.' },
  {
    id: 'demo.query-heads',
    ratio: (inst) => (inst.params.attnHeads === inst.params.kvHeads ? null : Number(inst.params.attnHeads) / Number(inst.params.kvHeads)),
    message: 'You used the attention heads: only the KV heads are cached.',
  },
]

const VARIANTS: VariantSpec[] = [
  { id: 'bytes-per-token', title: 'KV bytes per token', kcs: [KCS[0]], levels: ALL_LEVELS, nsec: 45 },
  { id: 'capacity', title: 'Tokens that fit', kcs: [KCS[1]], levels: [1, 2, 3], nsec: 60 },
  { id: 'which-plane', title: 'Which plane', kcs: [KCS[0]], levels: ALL_LEVELS, nsec: 20 },
]

interface Shape {
  layers: number
  kvHeads: number
  attnHeads: number
  headDim: number
  dtype: Dtype
  hbm: number
}

function make(seed: number, level: Level, variant = 'bytes-per-token'): Instance {
  const v = VARIANTS.find((x) => x.id === variant)
  if (!v || !v.levels.includes(level)) throw new RangeError(`demo: no ${variant} at level ${level}`)
  const rng = rngFor('demo', variant, level, seed)
  const layers = rng.int(SYNTHETIC.layersMin, SYNTHETIC.layersMax)
  const kvHeads = rng.pick(SYNTHETIC.kvHeads)
  const headDim = rng.pick(SYNTHETIC.headDims)
  const dtype = rng.pick(SYNTHETIC.dtypes)
  const attnHeads = kvHeads * rng.pick(SYNTHETIC.groups)
  const hbm = rng.pick(SYNTHETIC.hbmGb)
  return build(v, level, seed, { layers, kvHeads, attnHeads, headDim, dtype, hbm })
}

function build(v: VariantSpec, level: Level, seed: number, shape: Shape): Instance {
  const { layers, kvHeads, attnHeads, headDim, dtype, hbm } = shape
  const perToken = KV_PLANES * layers * kvHeads * headDim * DTYPE_BYTES[dtype]
  const params = { layers, kvHeads, attnHeads, headDim, dtype }
  const stem = [{ t: 'text' as const, text: `A hypothetical model has ${layers} layers, ${kvHeads} KV heads and head dimension ${headDim}, cached in ${dtype}.` }]
  const common = { variant: v.id, seed, level, nsec: v.nsec, kcs: [...v.kcs], claims: [claimRef('model.llama3-8b.layers')] }

  if (v.id === 'capacity') {
    const truth = Math.floor((hbm * 1e9) / perToken)
    return finishInstance(gen, {
      ...common,
      params: { ...params, hbm },
      prompt: { stem: [...stem, { t: 'text', text: ` How many tokens fit in ${hbm} GB?` }] },
      answer: { kind: 'estimate', truth, unit: 'tokens', okWithinFactor: 2, interval: true },
    })
  }
  if (v.id === 'which-plane') {
    return finishInstance(gen, {
      ...common,
      params,
      prompt: { stem: [...stem, { t: 'text', text: ' Which planes does the cache store?' }] },
      answer: {
        kind: 'choice',
        options: [
          { id: 'kv', text: 'Both K and V', why: 'Attention reads K to score and V to mix: both are cached.' },
          { id: 'k', text: 'K only', why: 'V is needed to produce the output, so it must be kept too.', miss: 'demo.forgot-k-and-v' },
          { id: 'v', text: 'V only, and K is recomputed each step from the stored activations', why: 'K is cached as well, which is the point.', miss: 'demo.v-only' },
        ],
        correct: ['kv'],
      },
    })
  }
  return finishInstance(gen, {
    ...common,
    params,
    prompt: { stem: [...stem, { t: 'text', text: ' Bytes per token?' }] },
    answer: { kind: 'numeric', truth: perToken, unit: 'B', tolerance: { rel: 0.01 }, units: byteUnitChoices('B', ['KiB']) },
  })
}

function solution(inst: Instance): SolutionStep[] {
  const a = inst.answer
  const p = inst.params
  const perToken = KV_PLANES * Number(p.layers) * Number(p.kvHeads) * Number(p.headDim) * DTYPE_BYTES[p.dtype as Dtype]
  const steps: SolutionStep[] = [{ text: [{ t: 'text', text: '2 × layers × KV heads × head dim × bytes per value' }], result: { value: perToken, unit: 'B' } }]
  if (a.kind === 'estimate') steps.push({ text: [{ t: 'text', text: 'HBM ÷ bytes per token' }], result: { value: a.truth, unit: a.unit } })
  return steps
}

/** The lesson-style worked example: Llama-3-8B-shaped, BF16, 131,072 bytes per token. */
function pinInstance(): Instance {
  return build(VARIANTS[0], 2, 1, { layers: 32, kvHeads: 8, attnHeads: 32, headDim: 128, dtype: 'bf16', hbm: 80 })
}

const gen: Gen = {
  id: 'demo',
  version: 1,
  title: 'Demo family',
  kcs: KCS,
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution,
  pins: [{ name: 'a 32-layer, 8-head, 128-dim BF16 model', source: 'fixture', make: pinInstance, truth: 131072 }],
}

export default gen
