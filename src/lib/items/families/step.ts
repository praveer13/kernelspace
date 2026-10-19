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
 * The calibrated variants (S5-14, §7.2-7.4) work the full card with the fitted table's parameters, "the engine's
 * numbers", on in-box configurations of the rows `table.ts` marks calibrated and eligible for the item's metric:
 * `prefill-ms-v2` (TTFT-eligible rows) and `tp-speedup` (TPOT). Each stem carries the H4 label of its metric (S5-D58);
 * `PHYSICS_CONSUMERS` names their rows and metrics for `verify:physics` (S5-D54). Calibrated `decode-ms` and
 * `quant-speedup` are cut: their answers fail the protocol's fairness (`tests/items/step.test.ts` prints why).
 *
 * Every variant omits level 2, so no track's form blueprint changes (S5-D51). The items grade the card's arithmetic
 * with the numbers the stem gives, at 2 %; they say nothing about what an engine measures (S5-D57).
 */

import { atlasRow } from '@/data/atlas'
import { byId, claimNumber } from '@/data/claims'
import '@/data/claims/lazy/ix-points'
import '@/data/claims/lazy/physics'
import '@/data/claims/lazy/tiling'
import { KC } from '@/data/kc/ids'
import { claimRef, finishInstance, resolveVariant, rngFor, type Rng } from '@/lib/items/core'
import { gradeResponse } from '@/lib/items/grade'
import type { Gen, Instance, Level, Params, PromptPart, RatioRule, SolutionStep, VariantSpec } from '@/lib/items/types'
import { BITS_PER_BYTE, DTYPE_BYTES, formatNumber, GB, type Dtype } from '@/lib/items/units'
import type { KcId } from '@/lib/kc/types'
import { napkinSpec, stepCard } from '@/lib/world/physics/card'
import type { PhysicsConsumer } from '@/lib/world/physics/consumers'
import { PHYS_ID, PHYSICS_ROWS } from '@/lib/world/physics/table'
import type { CalibratedRow, CardSpec, ModelShape, StepCard, StepLoad } from '@/lib/world/physics/types'

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
  /** calibrated: the sweep's concurrencies (the protocol's fit subset 4, 16, 64 and held-out 8, 32) */
  concs: [4, 8, 16, 32, 64],
  /** calibrated: the shown parameters' precision, as the phys.* claims print them (η to 0.01; µs and GB/s to 0.1) */
  shown: { eta: 100, fine: 10 },
  /** `tp-speedup` draws an answer bin this wide (a ratio) uniformly, then a scene in it: flattened, as `frontier` was (O12) */
  bin: 1.04,
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

/* ------------------------------ the calibrated rows (S5-14) ------------------------------ */

const PREFILL_V2 = 'prefill-ms-v2'
const SPEEDUP = 'tp-speedup'
/** The rows a calibrated variant may draw: calibrated in `table.ts` and eligible for the metric it reads. */
const rowsFor = (metric: 'tpot' | 'ttft'): CalibratedRow[] => PHYSICS_ROWS.filter((r) => r.status === 'calibrated' && r.eligible[metric])
const TTFT_ROWS = rowsFor('ttft')
const TPOT_ROWS = rowsFor('tpot')

/** Each calibrated variant's rows and metric, read by `collectConsumers()` for `verify:physics` (S5-D54). */
export const PHYSICS_CONSUMERS: PhysicsConsumer[] = [
  { id: `step/${PREFILL_V2}`, rows: TTFT_ROWS.map((r) => r.key), metric: 'ttft' },
  { id: `step/${SPEEDUP}`, rows: TPOT_ROWS.map((r) => r.key), metric: 'tpot' },
]

const VARIANTS: VariantSpec[] = [
  vspec('decode-ms', 'Decode step, in ms', [KC.decodeBandwidth, LATENCY_METRICS]),
  vspec('prefill-ms', 'Prefill step, in ms', [PREFILL_VS_DECODE]),
  vspec('ridge-kv', 'Decode intensity with KV', [KC.ridgePoint]),
  vspec('quant-bytes', 'Weight GB by precision', [KC.fp4Capacity], BELOW_TRANSFER),
  vspec(PREFILL_V2, "Prefill step, the engine's numbers", [PREFILL_VS_DECODE]),
  vspec(SPEEDUP, 'TP speedup of a decode step', [PARALLELISM]),
]

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

/* ------------------------------ the calibrated card (S5-14) ------------------------------ */

const isCal = (vid: string): boolean => vid === PREFILL_V2 || vid === SPEEDUP
const rowOf = (p: Params): CalibratedRow => PHYSICS_ROWS.find((r) => r.key === p.row)!
/** `h100-vllm-0-10-2-fp8` → the chip's claim prefix and name, and the weight precision. */
function rowIds(r: CalibratedRow) {
  const chip = r.key.slice(0, r.key.indexOf('-'))
  const prec = r.key.slice(r.key.lastIndexOf('-') + 1)
  const hw = chip === 'h100' ? 'hw.h100-sxm' : `hw.${chip}`
  return { hw, prec, name: chip === 'h100' ? 'H100 SXM' : chip.toUpperCase(), peak: `${hw}.${prec === 'nvfp4' ? 'fp4' : prec}-dense`, weights: `model.llama3-70b.weight-bytes-${prec}` }
}

/**
 * The row's card with its parameters at the precision the stem shows them (the phys.* claims'): the items grade the
 * arithmetic of the numbers a learner is given (S5-D57); tests/items/step.test.ts pins those numbers to the table's.
 */
function shownSpec(r: CalibratedRow): CardSpec {
  const q = r.spec.params
  const at = (x: number, k: number): number => Math.round(x * k) / k
  const { eta, fine } = SYNTHETIC.shown
  return { ...r.spec, params: { etaMem: at(q.etaMem, eta), etaFlop: at(q.etaFlop, eta), layerUs: at(q.layerUs, fine), seqUs: at(q.seqUs, fine), linkGBs: q.linkGBs === null ? null : at(q.linkGBs, fine) } }
}

/** A calibrated scene's step: `users` decoding at context `ctx`, or, with a `prompt`, that prompt prefilled whole beside the other users. */
function calLoad(p: Params): StepLoad {
  const n = num(p, 'prompt') || 0
  const d = num(p, 'users') - (n ? 1 : 0)
  const k = d * num(p, 'ctx')
  return { seqs: num(p, 'users'), tokens: d + n, kvTokens: k + n, attnPairs: k + (n * (n + 1)) / 2 }
}
const calCard = (p: Params, tp = num(p, 'tp')): StepCard => stepCard(shownSpec(rowOf(p)), tp, calLoad(p))

/**
 * In the row's box (§6.3) and envelope at `tp`: the workload's users × (prompt + output) fit the KV room the protocol's
 * filter allows, and the step is no larger than any step the row's replays made.
 */
function inBox(r: CalibratedRow, tp: number, p: Params): boolean {
  const { model, chip } = r.spec
  const room = Math.floor((claimNumber('status.inferencex.harness.gpu-mem-util') * chip.hbmBytes * tp - model.weightBytes) / model.kvBytesPerToken)
  const l = calLoad(p)
  const e = r.envelope
  const decoding = l.tokens - (num(p, 'prompt') || 0)
  return num(p, 'users') * (num(p, 'isl') + num(p, 'osl')) <= room && l.tokens <= e.tokens && decoding <= e.decodeSeqs && l.kvTokens / tp <= e.kvTokensPerGpu && l.attnPairs / tp <= e.attnPairsPerGpu
}

/** The lengths a workload's prompts (to `isl`) or decoding contexts (to `isl + osl`) take: from the harness's range ratio × isl. */
const lengths = (isl: number, hi: number): number[] => POOL.filter((x) => x >= claimNumber('status.inferencex.harness.range-ratio') * isl && x <= hi)

function drawPrefill(r: Rng): Params {
  for (;;) {
    const row = r.pick(TTFT_ROWS)
    const { isl, osl } = r.pick(row.box.shapes)
    const base = { row: row.key, tp: r.pick(row.box.tp), users: r.pick(SYNTHETIC.concs.filter((c) => c <= row.box.maxNumSeqs)), isl, osl, prompt: r.pick(lengths(isl, isl)) }
    const ctxs = lengths(isl, isl + osl).filter((ctx) => inBox(row, base.tp, { ...base, ctx }))
    if (ctxs.length > 0) return { ...base, ctx: r.pick(ctxs) }
  }
}

let speedupBins: Params[][] | undefined
/** Every in-box `tp-speedup` scene, sorted by its answer and cut into bins `SYNTHETIC.bin` wide. Built once. */
function binsOfSpeedup(): Params[][] {
  if (speedupBins) return speedupBins
  const all: [number, Params][] = []
  for (const row of TPOT_ROWS) {
    for (const tp of row.box.tp) {
      for (const tpTo of row.box.tp.filter((x) => x > tp)) {
        for (const users of SYNTHETIC.concs.filter((c) => c <= row.box.maxNumSeqs)) {
          for (const { isl, osl } of row.box.shapes) {
            for (const ctx of lengths(isl, isl + osl)) {
              const p = { row: row.key, tp, tpTo, users, isl, osl, ctx }
              if (inBox(row, tp, p)) all.push([truthOf(SPEEDUP, p), p])
            }
          }
        }
      }
    }
  }
  all.sort((a, b) => a[0] - b[0])
  const bins: Params[][] = []
  let edge = 0
  for (const [x, p] of all) {
    if (x >= edge) {
      bins.push([])
      edge = x * SYNTHETIC.bin
    }
    bins[bins.length - 1].push(p)
  }
  return (speedupBins = bins)
}

function truthOf(vid: string, p: Params): number {
  if (vid === PREFILL_V2) return calCard(p).stepS * THOUSAND
  if (vid === SPEEDUP) return calCard(p).stepS / calCard(p, num(p, 'tpTo')).stepS
  return vid === 'quant-bytes' ? weightGb(p) : metric(vid, cardOf(vid, p))
}

/* ------------------------------ prompt and solution text ------------------------------ */

const t = (text: string): PromptPart => ({ t: 'text', text })
const v = (value: number, unit?: string): PromptPart => ({ t: 'value', value, ...(unit ? { unit } : {}) })
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
  if (isCal(vid)) return calSteps(vid, p, truth)
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

/* ------------------------------ calibrated text (S5-14) ------------------------------ */

const CARD =
  ' The step card, per GPU: layers × t_layer + sequences × t_seq, plus link bytes ÷ β when TP > 1, plus the longer of bytes ÷ (η_m × bandwidth) and FLOP ÷ (η_f × peak); bytes = (weights + KV bytes per token × KV tokens) ÷ TP, FLOP = (2 × parameters × tokens + 4 × layers × hidden × attention pairs) ÷ TP, link bytes = 2 × layers × tokens × hidden × 2 B × 2 × (TP − 1) ÷ TP.' +
  " A user decoding at context C adds 1 token, C KV tokens and C pairs; a prompt of P tokens adds P tokens, P KV tokens and P(P + 1) ÷ 2 pairs. The η, t and β below are the engine's numbers: this fit's split of one benchmark sweep, not hardware facts. "

/** The H4 label (§7.0, S5-D58) for the metric the answer reads; a ratio prints no "9 in 10" clause. */
function h4(r: CalibratedRow, metric: 'tpot' | 'ttft' | null): PromptPart[] {
  const { name, prec } = rowIds(r)
  const lab = (m: string, k: string, rest: string): PromptPart[] => [t(` · ${m} 9 in 10 within `), claim(`phys.${r.key}.${k}`), t(rest)]
  return [
    t(`[v2 physics · ${name} · vLLM 0.10.2 · ${prec.toUpperCase()} · fitted on ${r.label.tpot.n} InferenceX points (2025-10-29)`),
    ...(metric === 'tpot' ? lab('TPOT', 'loo-tpot-p90', ' (leave-one-out)') : metric === 'ttft' ? lab('TTFT', 'loo-ttft8k-p90', ` on the ${r.label.ttft.n} with ~8k prompts (leave-one-out, plus the harness term)`) : []),
    t(` · ${PHYS_ID}]`),
  ]
}

function calGivens(p: Params): { label: string; value: PromptPart }[] {
  const r = rowOf(p)
  const { hw, prec, peak, weights } = rowIds(r)
  const fit = (label: string, key: string, unit?: string): { label: string; value: PromptPart } => ({ label, value: { t: 'claim', claim: `phys.${r.key}.${key}`, ...(unit === undefined ? {} : { unit }) } })
  return [
    { label: 'Memory bandwidth', value: claim(`${hw}.hbm-bw`) },
    { label: `Peak ${prec.toUpperCase()}, dense`, value: claim(peak) },
    { label: `Weights (${prec.toUpperCase()})`, value: claim(weights) },
    // gen-literal-ok: parameters, layers and hidden size, the model givens the card reads (KV per token is its own claim)
    ...GIVENS.slice(0, 3).map(([key, label, unit]) => ({ label, value: claim(mclaim('llama3-70b', key), unit) })),
    { label: 'KV bytes per token (FP8)', value: claim('model.llama3-70b.kv-bytes-per-token-fp8') },
    fit('η_m, share of bandwidth', 'eta-mem', ''),
    fit('η_f, share of peak', 'eta-flop', ''),
    fit('t_layer, per layer', 'layer-us'),
    fit('t_seq, per sequence', 'seq-us'),
    ...(Math.max(num(p, 'tp'), num(p, 'tpTo') || 0) > TP ? [fit('β, effective all-reduce', 'link-gbs')] : []),
  ]
}

function calStem(vid: string, p: Params): PromptPart[] {
  const r = rowOf(p)
  const { name, prec } = rowIds(r)
  const k = (x: string): string => `~${formatNumber(num(p, x) / THOUSAND, 0)}k`
  const lead = `Llama-3.3-70B (${prec.toUpperCase()} weights, FP8 KV) on ${name}s, served by vLLM 0.10.2 as InferenceX ran it: ${formatNumber(num(p, 'users'))} users of a ${k('isl')}-prompt, ${k('osl')}-output workload`
  if (vid === SPEEDUP) {
    return [t(`${lead}, each decoding at context ${formatNumber(num(p, 'ctx'))}. How many times shorter is this decode step at TP ${num(p, 'tpTo')} than at TP ${num(p, 'tp')}?${CARD}`), ...h4(r, null)]
  }
  return [
    t(`${lead}, at TP ${num(p, 'tp')}. A new ${formatNumber(num(p, 'prompt'))}-token prompt is admitted beside ${formatNumber(num(p, 'users') - 1)} users decoding at context ${formatNumber(num(p, 'ctx'))}; it fits the step's budget of `),
    claim('status.inferencex.harness.batch-tokens'),
    t(` with them, so it prefills in this one step, and its first token comes at the step's end. How long is the step, in ms?${CARD}`),
    ...h4(r, 'ttft'),
  ]
}

/** The card worked at one TP: bytes, memory time, FLOP, math time, link time and the step. */
function cardSteps(p: Params, tp: number): SolutionStep[] {
  const { chip, model, params: q } = shownSpec(rowOf(p))
  const c = calCard(p, tp)
  const at = ` at TP ${tp}`
  const tera = GB * THOUSAND
  return [
    step(`Bytes${at} = (`, v(model.weightBytes / GB, 'GB'), ' + ', v((model.kvBytesPerToken * calLoad(p).kvTokens) / GB, 'GB'), ` KV) ÷ ${tp} = `, v(c.memBytes / GB, 'GB')),
    step(`Memory time${at} = bytes ÷ (η_m × bandwidth) = `, v(c.memBytes / GB, 'GB'), ' ÷ ', v((q.etaMem * chip.bwBps) / GB, 'GB/s'), ' = ', v(c.memS * THOUSAND, 'ms')),
    step(`FLOP${at} = `, v(c.flops / tera, 'TFLOP')),
    step(`Math time${at} = FLOP ÷ (η_f × peak) = `, v(c.flops / tera, 'TFLOP'), ' ÷ ', v((q.etaFlop * chip.peakFlops) / tera, 'TFLOP/s'), ' = ', v(c.flopS * THOUSAND, 'ms')),
    ...(c.linkS > 0 ? [step(`Link time${at} = link bytes ÷ β = `, v(c.linkBytes / GB, 'GB'), ' ÷ ', v(q.linkGBs!, 'GB/s'), ' = ', v(c.linkS * THOUSAND, 'ms'))] : []),
    step(`Step${at} = fixed + link + the longer (${c.bound === 'mem' ? 'bandwidth' : 'compute'}-bound) = `, v(c.stepS * THOUSAND, 'ms')),
  ]
}

function calSteps(vid: string, p: Params, truth: number): SolutionStep[] {
  const { model, params: q } = shownSpec(rowOf(p))
  const l = calLoad(p)
  const c = calCard(p)
  const n = num(p, 'prompt')
  const d = l.tokens - (n || 0)
  const ctx = v(num(p, 'ctx'))
  const load = [
    ...(vid === SPEEDUP
      ? [step('KV tokens = users × context = ', v(d), ' × ', ctx, ' = ', v(l.kvTokens, 'tokens'))]
      : [
          step('Tokens = decoding users + prompt = ', v(d), ' + ', v(n), ' = ', v(l.tokens, 'tokens')),
          step('KV tokens = users × context + prompt = ', v(d), ' × ', ctx, ' + ', v(n), ' = ', v(l.kvTokens, 'tokens')),
          step('Attention pairs = users × context + P(P + 1) ÷ 2 = ', v(d * num(p, 'ctx')), ' + ', v((n * (n + 1)) / 2), ' = ', v(l.attnPairs, 'pairs')),
        ]),
    step('Fixed = layers × t_layer + sequences × t_seq = ', v(model.layers), ' × ', v(q.layerUs, 'µs'), ' + ', v(l.seqs), ' × ', v(q.seqUs, 'µs'), ' = ', v(c.fixedS * THOUSAND, 'ms')),
  ]
  if (vid === PREFILL_V2) return [...load, ...cardSteps(p, num(p, 'tp'))]
  const to = calCard(p, num(p, 'tpTo'))
  return [...load, ...cardSteps(p, num(p, 'tp')), ...cardSteps(p, num(p, 'tpTo')), step('Speedup = ', v(c.stepS * THOUSAND, 'ms'), ' ÷ ', v(to.stepS * THOUSAND, 'ms'), ' = ', v(truth, '×'))]
}

/**
 * What the solution adds after the answer. `tp-speedup` shows InferenceX's measured mean TPOT at both TPs when both are
 * fit points in the box (a point claim each, S5-D18); `prefill-ms-v2` shows no measured value. No fitted term is named
 * as a cause (S5-D5).
 */
function calWhy(vid: string, p: Params): SolutionStep[] {
  if (vid === PREFILL_V2) {
    return [step("This step is the engine's time to first token for the new prompt. A published TTFT also holds what the client and the wait for a step in flight add, so none is compared here.")]
  }
  const tpTo = num(p, 'tpTo')
  const out = [step('Bytes ÷ bandwidth and FLOP ÷ peak divide by TP; the rest of the card does not, so its speedup stays below ', v(tpTo / num(p, 'tp'), '×'), ". Measured TPOT falls short of it too, on every published pair in the box; how much of that is fixed cost is this fit's split, not a hardware fact.")]
  const ids = [num(p, 'tp'), tpTo].map((tp) => `bench.ix-l70.${p.row}.tp${tp}.${p.isl}-${p.osl}.c${p.users}.tpot`)
  if (ids.every((id) => Object.hasOwn(byId, id))) {
    const ms = (id: string): PromptPart => ({ t: 'claim', claim: id, scale: THOUSAND, unit: 'ms' })
    out.push(step('InferenceX measured a mean TPOT of ', ms(ids[0]), ` at TP ${num(p, 'tp')} and `, ms(ids[1]), ` at TP ${tpTo} for this workload (`, v(claimNumber(ids[0], THOUSAND) / claimNumber(ids[1], THOUSAND), '×'), '): a mean over every step a user waits through, prefills included, not this one step.'))
  }
  return out
}

/** A blanked step shows its lead-in and hides the value that ends it. */
const blanked = (s: SolutionStep): SolutionStep => ({ ...s, text: s.text.slice(0, -1), blank: true })

/* ------------------------------ building an instance ------------------------------ */

function stemOf(vid: string, p: Params): PromptPart[] {
  if (isCal(vid)) return calStem(vid, p)
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
      return [t(`${lead}: one ${formatNumber(num(p, 'prompt'))}-token prompt is prefilled in one step, which reads the weights once plus the prompt's KV bytes and does 2 × parameters FLOP per token plus 4 × layers × hidden × P(P + 1) ÷ 2 for attention. ${BOUND} How long is the step, in ms?`)]
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
  const cal = isCal(vs.id)
  const given = vs.id === 'quant-bytes' ? [] : cal ? calGivens(p) : givens(p)
  // the claims shown as chips (the whys' measured points too), and those that decide the scene: the capacity, and for a
  // calibrated one the dataset and the harness's memory share and length range
  const shown = [...stem, ...given.map((g) => g.value), ...(cal ? calWhy(vs.id, p).flatMap((s) => s.text) : [])]
  const decide = cal
    ? [`${rowIds(rowOf(p)).hw}.hbm-capacity`, 'bench.inferencex.llama70b-2025-10-29', 'status.inferencex.harness.gpu-mem-util', 'status.inferencex.harness.range-ratio']
    : given.length > 0
      ? [sceneOf(p).claims[2]]
      : []
  const claims = shown.flatMap((x) => (x.t === 'claim' ? [x.claim] : []))
  return finishInstance(gen, {
    variant: vs.id,
    seed,
    level,
    params: p,
    kcs: [...vs.kcs],
    prompt: { stem, ...(given.length > 0 ? { givens: given } : {}), ...(worked ? { worked } : {}) },
    answer: { kind: 'numeric', truth, unit: vs.id === 'quant-bytes' ? 'GB' : vs.id === 'ridge-kv' ? 'FLOP/B' : vs.id === SPEEDUP ? '×' : 'ms', tolerance: { rel: SYNTHETIC.relTol } },
    claims: [...claims, ...decide].map(claimRef),
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
  if (vid === PREFILL_V2) return drawPrefill(r)
  if (vid === SPEEDUP) return r.pick(r.pick(binsOfSpeedup()))
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
  return build(vs, level, seed, draw(vs.id, level, rngFor(gen.id, vs.id, level, seed)))
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
  version: 2,
  title: 'The step card',
  kcs: [KC.decodeBandwidth, LATENCY_METRICS, PREFILL_VS_DECODE, KC.ridgePoint, KC.fp4Capacity, PARALLELISM],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution: (inst) => [...steps(inst.variant, inst.params, truthOfInst(inst)), ...(isCal(inst.variant) ? calWhy(inst.variant, inst.params) : [])],
  // the lessons' and the spec's worked numbers are pinned in tests/items/step.test.ts, against an independent recomputation
  pins: [],
}

export default gen
