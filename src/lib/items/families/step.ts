/**
 * The `step` family (docs/specs/s5.md §7.2-7.5). Its η-free variants (KCs t4.decode-bandwidth, t4.ridge-point,
 * t5.latency-metrics, t5.prefill-vs-decode, t6.fp4-capacity) ask a decode step's milliseconds, a prefill's, a decode
 * step's FLOP per byte, and the weight GB of a model at BF16, FP8 or NVFP4.
 *
 * Every η-free truth is the physics card at η = 1, "the datasheet bound": `stepCard(napkinSpec(chip, model), 1, load)`,
 * with no fitted term and no table (S5-D5). Every constant is an eager claim or an atlas row: the 70B byte constants are
 * derived here from `model.llama3-70b.*` and its FP8 peak is the BF16 dense figure at twice the rate (roofline's
 * convention), so these variants read no lazy claim group (S5-D61). A scene is feasible: Llama-3-8B in BF16 on the five
 * atlas chips, Llama-3-70B in FP8 on H100 and B200 (the chips with FP8 math), TP 1, weights + KV within 90 % of the
 * capacity.
 *
 * The calibrated variants (S5-14, §7.2-7.4), `prefill-ms-v2` and `tp-speedup`, work the full card with the fitted table's
 * parameters. Their code, the table and the claim groups they read (`physics`, `ix-points`, `tiling`) are in
 * `lazy/step-calibrated.ts`, which loads on demand (§8.1 and B10 keep this chunk at most 4 KB gzip): a calibrated `make`
 * before it has loaded starts the load and throws `NotReady`, and `settle` (src/lib/items/on-demand.ts) runs the work again
 * once it lands, as the compile family's groups do. Under Bun (scripts and tests) it loads at module evaluation, so `make`
 * never stops there, and `PHYSICS_CONSUMERS` is the part's, for `verify:physics` (S5-D54).
 *
 * Every variant omits level 2, so no track's form blueprint changes (S5-D51). The items grade the card's arithmetic
 * with the numbers the stem gives, at 2 %; they say nothing about what an engine measures (S5-D57).
 */

import { atlasRow } from '@/data/atlas'
import { claimNumber } from '@/data/claims'
import { KC } from '@/data/kc/ids'
import { claimRef, finishInstance, resolveVariant, rngFor, type Rng } from '@/lib/items/core'
import { gradeResponse } from '@/lib/items/grade'
import { familyPart, loadFamilyPart, PARTS_ON_DEMAND } from '@/lib/items/registry'
import type { Gen, Instance, Level, Params, PromptPart, RatioRule, SolutionStep, VariantSpec } from '@/lib/items/types'
import { BITS_PER_BYTE, DTYPE_BYTES, formatNumber, GB, type Dtype } from '@/lib/items/units'
import type { KcId } from '@/lib/kc/types'
import { napkinSpec, stepCard } from '@/lib/world/physics/card'
import type { PhysicsConsumer } from '@/lib/world/physics/consumers'
import type { ModelShape, StepCard, StepLoad } from '@/lib/world/physics/types'
import type * as Calibrated from './lazy/step-calibrated'

const LATENCY_METRICS: KcId = 't5.latency-metrics'
const PREFILL_VS_DECODE: KcId = 't5.prefill-vs-decode'
const PARALLELISM: KcId = 't6.parallelism-composition'
const NVFP4_CLAIM = 'serving.nvfp4.bits-per-weight'

const SYNTHETIC = {
  relTol: 0.02,
  /** weights + KV take at most this share of the capacity claim */
  fit: 0.9,
  /** nominal seconds per variant */
  nsec: 60,
  /** the scenes: all five atlas chips run Llama-3-8B in BF16, only the two with FP8 math run Llama-3-70B in FP8 */
  scenes: ['h100/llama3-8b', 'b200/llama3-8b', 'a100-80/llama3-8b', 'a100-40/llama3-8b', 'rtx4090/llama3-8b', 'h100/llama3-70b', 'b200/llama3-70b'],
  /**
   * Llama-3-70B on an H100 leaves 1.45 GB for KV, so every one of its answers sits within 2.1 % of the weights' time: a
   * full share of the transfer level's draws would let one constant cover that scene, so it is drawn a third as often.
   */
  thin: { scene: 'h100/llama3-70b', otherCopies: 3 },
  /** users of a decode step: small batches are common (two significant digits or powers of two) */
  users: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 100, 128],
  /** context and prompt tokens: every two-significant-digit count in these ranges */
  tokens: { min: 50, ctxMin: 512, max: 8192 },
  /** two significant digits m, scaled by decades */
  mMin: 10,
  mMax: 99,
  /** a slip within this distance of the right answer (as a ratio) is not told from it */
  slipGuard: 0.05,
}

const TRANSFER: Level = 3 // gen-literal-ok: level 3 of the staircase
/** No level 2: it would change the forms' blueprints (S5-D51). */
const LEVELS: readonly Level[] = [0, 1, TRANSFER]
/**
 * `quant-bytes` also stops at level 1: the placement walk confirms `t6.fp4-capacity` at level 3 from a random family of the
 * KC and expects `memory` (tests/learner/placement.test.ts), so a level-3 `step` item there would break it.
 */
const BELOW_TRANSFER: readonly Level[] = [0, 1]
const THOUSAND = 1000 // gen-literal-ok: seconds to milliseconds, and a kilo prefix
const TP = 1

const vspec = (id: string, title: string, kcs: KcId[], levels = LEVELS): VariantSpec => ({ id, title, kcs, levels, nsec: SYNTHETIC.nsec })

const PREFILL_V2 = 'prefill-ms-v2'
const SPEEDUP = 'tp-speedup'

const VARIANTS: VariantSpec[] = [
  vspec('decode-ms', 'Decode step, in ms', [KC.decodeBandwidth, LATENCY_METRICS]),
  vspec('prefill-ms', 'Prefill step, in ms', [PREFILL_VS_DECODE]),
  vspec('ridge-kv', 'Decode intensity with KV', [KC.ridgePoint]),
  vspec('quant-bytes', 'Weight GB by precision', [KC.fp4Capacity], BELOW_TRANSFER),
  vspec(PREFILL_V2, "Prefill step, the engine's numbers", [PREFILL_VS_DECODE]),
  vspec(SPEEDUP, 'TP speedup of a decode step', [PARALLELISM]),
]

/* ------------------------------ the calibrated part, on demand ------------------------------ */

type Part = typeof Calibrated
const CALIBRATED = 'step-calibrated'
const isCal = (vid: string): boolean => vid === PREFILL_V2 || vid === SPEEDUP
/** The part, now; otherwise its load starts and `make` stops with `NotReady` (the registry's `familyPart`). */
const calibrated = (): Part => familyPart<Part>(CALIBRATED)

/**
 * Each calibrated variant's rows and metric, which `collectConsumers()` reads from this module for `verify:physics`
 * (S5-D54). Only scripts and tests (Bun) read it, and there the part loads here, at module evaluation; the app never does.
 */
export const PHYSICS_CONSUMERS: readonly PhysicsConsumer[] = PARTS_ON_DEMAND ? [] : (await loadFamilyPart<Part>(CALIBRATED)).PHYSICS_CONSUMERS

/* ------------------------------ scenes ------------------------------ */

const MODELS = {
  'llama3-8b': { name: 'Llama-3-8B', dtype: 'bf16' },
  'llama3-70b': { name: 'Llama-3-70B', dtype: 'fp8' },
} as const satisfies Record<string, { name: string; dtype: Dtype }>
type ModelId = keyof typeof MODELS

const num = (p: Params, k: string): number => Number(p[k])
const mclaim = (model: string, key: string): string => `model.${model}.${key}`
/** Bytes per weight: NVFP4 carries its block scales (4.5 bits). */
const bytesOf = (dtype: string): number => (dtype === 'nvfp4' ? claimNumber(NVFP4_CLAIM) / BITS_PER_BYTE : DTYPE_BYTES[dtype as Dtype])

/**
 * The chip from its atlas row and the architecture from the eager claims; KV bytes per token = 2 × layers × KV heads ×
 * head dim × bytes (S5-D61), and the peak is the BF16 dense claim at twice the rate for FP8 (roofline's convention).
 */
function sceneOf(p: Params) {
  const model = p.model as ModelId
  const { dtype } = MODELS[model]
  const a = atlasRow(String(p.hw))
  const n = (key: string, scale?: number): number => claimNumber(mclaim(model, key), scale)
  const bytes = DTYPE_BYTES[dtype]
  const params = n('params', GB)
  const shape: ModelShape = { params, layers: n('layers'), hidden: n('hidden-size'), kvBytesPerToken: 2 * n('layers') * n('kv-heads') * n('head-dim') * bytes, weightBytes: params * bytes }
  const chip = { bwBps: a.hbmBwGBs! * GB, peakFlops: a.bf16DenseGflops! * GB * (DTYPE_BYTES.bf16 / bytes), hbmBytes: a.hbmGb! * GB }
  // the bandwidth, peak and capacity claims, and the KV tokens that fit beside the weights
  const claims = [a.claims.hbmBwGBs!, a.claims.bf16DenseGflops!, a.claims.hbmGb!]
  return { model, dtype, name: a.name, claims, chip, shape, room: (SYNTHETIC.fit * chip.hbmBytes - params * bytes) / shape.kvBytesPerToken }
}

/* ------------------------------ the card ------------------------------ */

function loadOf(vid: string, p: Params): StepLoad {
  if (vid === 'prefill-ms') {
    const n = num(p, 'prompt')
    return { seqs: 1, tokens: n, kvTokens: n, attnPairs: (n * (n + 1)) / 2 }
  }
  const u = num(p, 'users')
  const k = u * num(p, 'ctx')
  return { seqs: u, tokens: u, kvTokens: k, attnPairs: k }
}

function cardOf(vid: string, p: Params, over: Partial<ModelShape> = {}): StepCard {
  const s = sceneOf(p)
  return stepCard(napkinSpec(s.chip, { ...s.shape, ...over }), TP, loadOf(vid, p))
}
const metric = (vid: string, c: StepCard): number => (vid === 'ridge-kv' ? c.flops / c.memBytes : c.stepS * THOUSAND)

/** Weight GB through the card: with no KV, memBytes is the weights, whatever the chip. */
function weightGb(p: Params): number {
  const params = num(p, 'paramsB') * GB
  const m: ModelShape = { params, layers: 1, hidden: 1, kvBytesPerToken: 0, weightBytes: params * bytesOf(String(p.dtype)) }
  return stepCard(napkinSpec({ bwBps: 1, peakFlops: 1, hbmBytes: 1 }, m), TP, { seqs: 1, tokens: 1, kvTokens: 0, attnPairs: 0 }).memBytes / GB
}

const truthOf = (vid: string, p: Params): number => (vid === 'quant-bytes' ? weightGb(p) : metric(vid, cardOf(vid, p)))

/* ------------------------------ prompt and solution text ------------------------------ */

const t = (text: string): PromptPart => ({ t: 'text', text })
const v = (value: number, unit: string): PromptPart => ({ t: 'value', value, unit })
const claim = (id: string, unit?: string): PromptPart => ({ t: 'claim', claim: id, ...(unit ? { unit } : {}) })
/** A step from text and values; a value in last place is its result. */
function step(...parts: (string | PromptPart)[]): SolutionStep {
  const text = parts.map((x) => (typeof x === 'string' ? t(x) : x))
  const last = text[text.length - 1]
  return { text, ...(last.t === 'value' ? { result: { value: last.value, unit: last.unit } } : {}) }
}

const COUNT = "reads the weights once plus all users' KV bytes, and does 2 × parameters FLOP per user plus 4 × layers × hidden × all users' tokens for attention"
const BOUND = 'At the datasheet bound (η = 1: full bandwidth and peak, nothing else) it takes the longer of bytes ÷ bandwidth and FLOP ÷ peak.'

/** The model claims a scene shows: key, label and unit. */
const GIVENS: [string, string, string?][] = [['params', 'Parameters', 'B parameters'], ['layers', 'Layers'], ['hidden-size', 'Hidden size'], ['kv-heads', 'KV heads'], ['head-dim', 'Head dimension']]

function givens(p: Params): { label: string; value: PromptPart }[] {
  const s = sceneOf(p)
  const dt = s.dtype.toUpperCase()
  return [
    { label: 'Memory bandwidth', value: claim(s.claims[0]) },
    { label: `Peak ${dt}, dense${s.dtype === 'bf16' ? '' : ' (2 × BF16)'}`, value: { t: 'claim', claim: s.claims[1], scale: DTYPE_BYTES.bf16 / DTYPE_BYTES[s.dtype] } },
    ...GIVENS.map(([key, label, unit]) => ({ label, value: claim(mclaim(s.model, key), unit) })),
    { label: `KV bytes per token (${dt}) = 2 × layers × KV heads × head dim × ${DTYPE_BYTES[s.dtype]} B`, value: v(s.shape.kvBytesPerToken, 'B') },
  ]
}

function steps(vid: string, p: Params, truth: number): SolutionStep[] {
  if (vid === 'quant-bytes') {
    const b = bytesOf(String(p.dtype))
    return [
      p.dtype === 'nvfp4' ? step('Bytes per weight = bits ÷ 8 = ', v(claimNumber(NVFP4_CLAIM), 'bits'), ' ÷ ', v(BITS_PER_BYTE, 'bits per byte'), ' = ', v(b, 'B')) : step(`Bytes per weight in ${String(p.dtype).toUpperCase()} = `, v(b, 'B')),
      ...(p.dtype === 'bf16' ? [] : [step('Against BF16 the bytes shrink by ', v(DTYPE_BYTES.bf16 / b, '×'))]),
      step('Weight bytes = parameters × bytes each = ', v(num(p, 'paramsB'), 'B params'), ' × ', v(b, 'B'), ' = ', v(truth, 'GB')),
    ]
  }
  const s = sceneOf(p)
  const c = cardOf(vid, p)
  const tera = GB * THOUSAND
  const bytes = step('Bytes = weights + KV = ', v(s.shape.weightBytes / GB, 'GB'), ' + ', v(c.memBytes / GB - s.shape.weightBytes / GB, 'GB'), ' = ', v(c.memBytes / GB, 'GB'))
  const flops = step('FLOP = 2 × parameters × tokens + 4 × layers × hidden × attention pairs = ', v(c.flops / tera, 'TFLOP'))
  if (vid === 'ridge-kv') {
    return [
      bytes,
      flops,
      step(`Intensity (ridge ${formatNumber(s.chip.peakFlops / s.chip.bwBps, 1)} FLOP/B) = FLOP ÷ bytes = `, v(c.flops / GB, 'GFLOP'), ' ÷ ', v(c.memBytes / GB, 'GB'), ' = ', v(truth, 'FLOP/B')),
    ]
  }
  return [
    bytes,
    step('Memory time = bytes ÷ bandwidth = ', v(c.memBytes / GB, 'GB'), ' ÷ ', v(s.chip.bwBps / GB, 'GB/s'), ' = ', v(c.memS * THOUSAND, 'ms')),
    flops,
    step('Math time = FLOP ÷ peak = ', v(c.flops / tera, 'TFLOP'), ' ÷ ', v(s.chip.peakFlops / tera, 'TFLOP/s'), ' = ', v(c.flopS * THOUSAND, 'ms')),
    step(`Step = the longer (${c.bound === 'mem' ? 'bandwidth' : 'compute'}-bound) = `, v(truth, 'ms')),
  ]
}

/** A blanked step shows its lead-in and hides the value that ends it. */
const blanked = (s: SolutionStep): SolutionStep => ({ ...s, text: s.text.slice(0, -1), blank: true })

/* ------------------------------ building an instance ------------------------------ */

function stemOf(vid: string, p: Params): PromptPart[] {
  if (vid === 'quant-bytes') {
    const nv = p.dtype === 'nvfp4'
    return [
      t('A hypothetical model has '),
      v(num(p, 'paramsB'), 'B parameters'),
      t(`, stored in ${String(p.dtype).toUpperCase()} (`),
      ...(nv ? [claim(NVFP4_CLAIM), t(', scales included')] : [t(`${bytesOf(String(p.dtype))} B per weight`)]),
      t('). At the datasheet bound (the weights alone, no KV or activations), how many GB?'),
    ]
  }
  const s = sceneOf(p)
  const lead = `${MODELS[s.model].name} (${s.dtype.toUpperCase()} weights, TP 1) on one ${s.name}`
  const users = `${formatNumber(num(p, 'users'))} users each hold ${formatNumber(num(p, 'ctx'))} tokens of context`
  switch (vid) {
    case 'decode-ms':
      return [t(`${lead}: ${users}. A decode step ${COUNT}. ${BOUND} How long is the step, in ms?`)]
    case 'prefill-ms':
      return [t(`${lead}: one ${formatNumber(num(p, 'prompt'))}-token prompt is prefilled in one step, which reads the weights once and writes the prompt's KV bytes, and does 2 × parameters FLOP per token plus 4 × layers × hidden × P(P + 1) ÷ 2 for attention. ${BOUND} How long is the step, in ms?`)]
    default:
      return [t(`${lead}: ${users}. A decode step ${COUNT}. Counted at the datasheet bound, what is its arithmetic intensity, in FLOP per byte?`)]
  }
}

function build(vs: VariantSpec, level: Level, seed: number, p: Params): Instance {
  const truth = truthOf(vs.id, p)
  const full = steps(vs.id, p, truth)
  // level 0 shows every step with the last blanked; level 1 blanks one in the middle
  const blankAt = level === 0 ? full.length - 1 : Math.floor((full.length - 1) / 2)
  const worked = level < 2 ? full.map((s, i) => (i === blankAt ? blanked(s) : s)) : undefined
  const stem = stemOf(vs.id, p)
  const given = vs.id === 'quant-bytes' ? [] : givens(p)
  const claims = [...stem, ...given.map((g) => g.value)].flatMap((x) => (x.t === 'claim' ? [x.claim] : []))
  return finishInstance(gen, {
    variant: vs.id,
    seed,
    level,
    params: p,
    kcs: [...vs.kcs],
    prompt: { stem, ...(given.length > 0 ? { givens: given } : {}), ...(worked ? { worked } : {}) },
    answer: { kind: 'numeric', truth, unit: vs.id === 'quant-bytes' ? 'GB' : vs.id === 'ridge-kv' ? 'FLOP/B' : 'ms', tolerance: { rel: SYNTHETIC.relTol } },
    // the claims shown as chips, and the capacity that decides the scene
    claims: [...claims, ...(given.length > 0 ? [sceneOf(p).claims[2]] : [])].map(claimRef),
    nsec: vs.nsec,
  })
}

/* ------------------------------ drawing params ------------------------------ */

/** Two significant digits over five decades: a hypothetical model's billions of parameters, and token counts in range. */
const POOL: number[] = []
for (let m = SYNTHETIC.mMin; m <= SYNTHETIC.mMax; m++) POOL.push(m / 100, m / 10, m, m * 10, m * 100)
const between = (lo: number): number[] => POOL.filter((x) => x >= lo && x <= SYNTHETIC.tokens.max)
const CONTEXTS = between(SYNTHETIC.tokens.ctxMin)
const PROMPTS = between(SYNTHETIC.tokens.min)
const SCENES_8B = SYNTHETIC.scenes.filter((k) => k.endsWith('8b'))
const SCENES_ALL = SYNTHETIC.scenes.flatMap((k) => Array<string>(k === SYNTHETIC.thin.scene ? 1 : SYNTHETIC.thin.otherCopies).fill(k))

function draw(vid: string, level: Level, r: Rng): Params {
  if (vid === 'quant-bytes') return { dtype: r.pick(['bf16', 'fp8', 'nvfp4']), paramsB: r.pick(POOL) }
  // the transfer level changes the surface: Llama-3-70B in FP8, with FP8 math, joins the five 8B scenes
  const [hw, model] = r.pick(level === TRANSFER ? SCENES_ALL : SCENES_8B).split('/')
  const room = sceneOf({ hw, model }).room
  if (vid === 'prefill-ms') return { hw, model, prompt: r.pick(PROMPTS.filter((x) => x <= room)) }
  const users = r.pick(SYNTHETIC.users.filter((u) => u * CONTEXTS[0] <= room))
  return { hw, model, users, ctx: r.pick(CONTEXTS.filter((c) => users * c <= room)) }
}

function make(seed: number, level: Level, variant?: string): Instance {
  const vs = resolveVariant(gen, seed, level, variant)
  const r = rngFor(gen.id, vs.id, level, seed)
  return isCal(vs.id) ? calibrated().make(gen, vs, level, seed, r) : build(vs, level, seed, draw(vs.id, level, r))
}

/* ------------------------------ grading ------------------------------ */

const apart = (rho: number): number | null => (Math.abs(rho - 1) > SYNTHETIC.slipGuard ? rho : null)
const truthOfInst = (i: Instance): number => (i.answer.kind === 'choice' ? Number.NaN : i.answer.truth)

const RATIO_RULES: RatioRule[] = [
  {
    id: 'step.per-user',
    ratio: (i) => (i.variant === 'decode-ms' && num(i.params, 'users') > 1 ? apart(1 / num(i.params, 'users')) : null),
    message: 'You divided the step by the users. Every user waits the whole step.',
  },
  {
    id: 'step.kv-missing',
    // the card asked again, with no KV bytes
    ratio: (i) => (i.variant === 'decode-ms' || i.variant === 'ridge-kv' ? apart(metric(i.variant, cardOf(i.variant, i.params, { kvBytesPerToken: 0 })) / truthOfInst(i)) : null),
    message: "You left the KV cache out of the bytes: every user's KV is read each step.",
  },
  {
    id: 'step.wrong-limit',
    ratio: (i) => {
      const c = i.variant === 'decode-ms' || i.variant === 'prefill-ms' ? cardOf(i.variant, i.params) : null
      return c ? apart((c.bound === 'mem' ? c.flopS : c.memS) / c.stepS) : null
    },
    message: 'You timed the limit that does not bind. The step takes the longer of bytes ÷ bandwidth and FLOP ÷ peak.',
  },
]

const gen: Gen = {
  id: 'step',
  version: 3, // gen-literal-ok: the generator version
  title: 'The step card',
  kcs: [KC.decodeBandwidth, LATENCY_METRICS, PREFILL_VS_DECODE, KC.ridgePoint, KC.fp4Capacity, PARALLELISM],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  // an instance of a calibrated variant exists only once its part has loaded (its make needs it)
  solution: (inst) => (isCal(inst.variant) ? calibrated().solution(inst) : steps(inst.variant, inst.params, truthOfInst(inst))),
  // the lessons' and the spec's worked numbers are pinned in tests/items/step.test.ts, against an independent recomputation
  pins: [],
}

export default gen
