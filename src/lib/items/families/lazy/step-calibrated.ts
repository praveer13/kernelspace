/**
 * The `step` family's calibrated variants (S5-14; docs/specs/s5.md §7.2-7.4), loaded on demand (§8.1, B10).
 *
 * They work the full card with the fitted table's parameters, "the engine's numbers", on in-box configurations of the rows
 * `table.ts` marks calibrated and eligible for the item's metric: `prefill-ms-v2` (TTFT-eligible rows) and `tp-speedup`
 * (TPOT). Each stem carries the H4 label of its metric (S5-D58); `PHYSICS_CONSUMERS` names their rows and metrics for
 * `verify:physics` (S5-D54), and `step.ts` re-exports it, since `collectConsumers()` reads the family's own module.
 * Calibrated `decode-ms` and `quant-speedup` are cut: their answers fail the protocol's fairness (`tests/items/step.test.ts`
 * prints why).
 *
 * This module holds everything those two variants read: the table, the `physics` and `ix-points` claim groups and the
 * `tiling` one (the FP8 peaks). `step.ts` imports it only when a calibrated variant is drawn, so the η-free variants
 * never download any of it: their `make` stays synchronous, and a calibrated `make` before this module has loaded starts
 * the load and stops with `NotReady`, which `settle` (src/lib/items/on-demand.ts) turns into a second run. It does not
 * import `step.ts` (that module awaits this one under Bun), so the few helpers both use are written here again; the
 * family object comes in as `make`'s first argument.
 */

import { byId, claimNumber } from '@/data/claims'
import '@/data/claims/lazy/ix-points'
import '@/data/claims/lazy/physics'
import '@/data/claims/lazy/tiling'
import { claimRef, finishInstance, type Rng } from '@/lib/items/core'
import type { Gen, Instance, Level, Params, PromptPart, SolutionStep, VariantSpec } from '@/lib/items/types'
import { formatNumber, GB } from '@/lib/items/units'
import { stepCard } from '@/lib/world/physics/card'
import type { PhysicsConsumer } from '@/lib/world/physics/consumers'
import { PHYS_ID, PHYSICS_ROWS } from '@/lib/world/physics/table'
import type { CalibratedRow, CardSpec, StepCard, StepLoad } from '@/lib/world/physics/types'

const SYNTHETIC = {
  relTol: 0.02,
  /** two significant digits m, scaled by decades (step.ts's pool, which the token lengths are drawn from) */
  mMin: 10,
  mMax: 99,
  /** the sweep's concurrencies (the protocol's fit subset 4, 16, 64 and held-out 8, 32) */
  concs: [4, 8, 16, 32, 64],
  /** the shown parameters' precision, as the phys.* claims print them (η to 0.01; µs and GB/s to 0.1) */
  shown: { eta: 100, fine: 10 },
  /** `tp-speedup` draws an answer bin this wide (a ratio) uniformly, then a scene in it: flattened, as `frontier` was (O12) */
  bin: 1.04,
}

const THOUSAND = 1000 // gen-literal-ok: seconds to milliseconds, and a kilo prefix
const TP = 1
const PREFILL_V2 = 'prefill-ms-v2'
const SPEEDUP = 'tp-speedup'

/** Two significant digits over five decades, as step.ts draws them. */
const POOL: number[] = []
for (let m = SYNTHETIC.mMin; m <= SYNTHETIC.mMax; m++) POOL.push(m / 100, m / 10, m, m * 10, m * 100)

const num = (p: Params, k: string): number => Number(p[k])

/* ------------------------------ the calibrated rows ------------------------------ */

/** The rows a calibrated variant may draw: calibrated in `table.ts` and eligible for the metric it reads. */
const rowsFor = (metric: 'tpot' | 'ttft'): CalibratedRow[] => PHYSICS_ROWS.filter((r) => r.status === 'calibrated' && r.eligible[metric])
const TTFT_ROWS = rowsFor('ttft')
const TPOT_ROWS = rowsFor('tpot')

/** Each calibrated variant's rows and metric, read by `collectConsumers()` for `verify:physics` (S5-D54). */
export const PHYSICS_CONSUMERS: PhysicsConsumer[] = [
  { id: `step/${PREFILL_V2}`, rows: TTFT_ROWS.map((r) => r.key), metric: 'ttft' },
  { id: `step/${SPEEDUP}`, rows: TPOT_ROWS.map((r) => r.key), metric: 'tpot' },
]

/* ------------------------------ the calibrated card ------------------------------ */

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
  return vid === SPEEDUP ? calCard(p).stepS / calCard(p, num(p, 'tpTo')).stepS : calCard(p).stepS * THOUSAND
}

/* ------------------------------ text ------------------------------ */

const t = (text: string): PromptPart => ({ t: 'text', text })
const v = (value: number, unit?: string): PromptPart => ({ t: 'value', value, ...(unit ? { unit } : {}) })
const claim = (id: string, unit?: string): PromptPart => ({ t: 'claim', claim: id, ...(unit ? { unit } : {}) })
/** A step from text and values; a value in last place is its result. */
function step(...parts: (string | PromptPart)[]): SolutionStep {
  const text = parts.map((x) => (typeof x === 'string' ? t(x) : x))
  const last = text[text.length - 1]
  return { text, ...(last.t === 'value' ? { result: { value: last.value, unit: last.unit } } : {}) }
}

/** The model claims a calibrated scene shows (KV per token is its own claim): key, label and unit. */
const GIVENS: [string, string, string?][] = [['params', 'Parameters', 'B parameters'], ['layers', 'Layers'], ['hidden-size', 'Hidden size']]

const CARD =
  ' The step card, per GPU: layers × t_layer + sequences × t_seq, plus link bytes ÷ β when TP > 1, plus the longer of bytes ÷ (η_m × bandwidth) and FLOP ÷ (η_f × peak); bytes = (weights + KV bytes per token × KV tokens) ÷ TP, FLOP = (2 × parameters × tokens + 4 × layers × hidden × attention pairs) ÷ TP, link bytes = 2 × layers × tokens × hidden × 2 B × 2 × (TP − 1) ÷ TP.' +
  " A user decoding at context C adds 1 token, C KV tokens and C pairs; a prompt of P tokens adds P tokens, P KV tokens and P(P + 1) ÷ 2 pairs. The η, t and β below are the engine's numbers: this fit's split of one benchmark sweep, not hardware facts. "

/**
 * The H4 label (§7.0, S5-D58) for the metric the answer reads; a ratio prints no "9 in 10" clause. "Fitted on" is the fit
 * set's size, n_F (TPOT's population, as the tab's "fit points"), for every metric: the fit read all of them, so a TTFT
 * label gives its own n, the ~8k-prompt points its p90 is over, in its clause instead.
 */
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
    ...GIVENS.map(([key, label, unit]) => ({ label, value: claim(`model.llama3-70b.${key}`, unit) })),
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

/* ------------------------------ the instance ------------------------------ */

/** A calibrated instance of `vs`, drawn from `r` (step.ts's seeded stream for the variant and level) and built for `gen`. */
export function make(gen: Gen, vs: VariantSpec, level: Level, seed: number, r: Rng): Instance {
  const p = vs.id === PREFILL_V2 ? drawPrefill(r) : r.pick(r.pick(binsOfSpeedup()))
  const truth = truthOf(vs.id, p)
  const full = calSteps(vs.id, p, truth)
  // level 0 shows every step with the last blanked; level 1 blanks one in the middle
  const blankAt = level === 0 ? full.length - 1 : Math.floor((full.length - 1) / 2)
  const worked = level < 2 ? full.map((s, i) => (i === blankAt ? blanked(s) : s)) : undefined
  const stem = calStem(vs.id, p)
  const given = calGivens(p)
  // the claims shown as chips (the whys' measured points too), and those that decide the scene: the capacity, the dataset
  // and the harness's memory share and length range
  const shown = [...stem, ...given.map((g) => g.value), ...calWhy(vs.id, p).flatMap((s) => s.text)]
  const decide = [`${rowIds(rowOf(p)).hw}.hbm-capacity`, 'bench.inferencex.llama70b-2025-10-29', 'status.inferencex.harness.gpu-mem-util', 'status.inferencex.harness.range-ratio']
  const claims = shown.flatMap((x) => (x.t === 'claim' ? [x.claim] : []))
  return finishInstance(gen, {
    variant: vs.id,
    seed,
    level,
    params: p,
    kcs: [...vs.kcs],
    prompt: { stem, givens: given, ...(worked ? { worked } : {}) },
    answer: { kind: 'numeric', truth, unit: vs.id === SPEEDUP ? '×' : 'ms', tolerance: { rel: SYNTHETIC.relTol } },
    claims: [...claims, ...decide].map(claimRef),
    nsec: vs.nsec,
  })
}

/** A calibrated instance's worked card, then its why. */
export function solution(inst: Instance): SolutionStep[] {
  const truth = inst.answer.kind === 'numeric' ? inst.answer.truth : Number.NaN
  return [...calSteps(inst.variant, inst.params, truth), ...calWhy(inst.variant, inst.params)]
}
