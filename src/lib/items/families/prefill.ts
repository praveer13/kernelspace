/**
 * The `prefill` family (docs/specs/wave-3.md §5.1; KCs t6.epd-phases, t6.kv-tiering,
 * t6.cache-timing-oracle): the prefill:decode GPU ratio of a fleet, the milliseconds a KV hand-off
 * takes, the tier bandwidth at which loading a cached prefix costs what recomputing it does, the TTFT
 * a prefix hit saves (the timing oracle's signal) and the prefill a tenant namespace costs.
 *
 * Every variant is numeric: there is no choice variant, so no cue gate applies. Real-world numbers
 * come only through claims: the KV bytes per token of Llama-3-8B and Llama-3-70B, and the input and
 * output throughput per node of SGLang's DeepSeek run. Everything else (a fleet's arrivals and prompt
 * lengths, a GPU's prefill and decode rates, a link, a tier, a tenant count) is declared in SYNTHETIC
 * and announced as hypothetical in the prompt. A claim-backed scene stores no claim-derived number in
 * its params, so a level-0 instance can show the real figures and the params stay round.
 *
 * The diagnoses are the slips of the spec: decode over prefill, token counts for rates, bits for
 * bytes, seconds for milliseconds, GB for GiB, and one tenant too many forgotten in a namespace.
 */

import { claimNumber } from '@/data/claims'
import { claimRef, finishInstance, resolveVariant, rngFor, type Rng } from '@/lib/items/core'
import { gradeResponse } from '@/lib/items/grade'
import type { Gen, Instance, Level, Params, Prompt, PromptPart, RatioRule, SolutionStep, VariantSpec } from '@/lib/items/types'
import { BITS_PER_BYTE, formatNumber, GB, GIB } from '@/lib/items/units'
import type { KcId } from '@/lib/kc/types'

const EPD_PHASES: KcId = 't6.epd-phases'
const KV_TIERING: KcId = 't6.kv-tiering'
const CACHE_TIMING_ORACLE: KcId = 't6.cache-timing-oracle'

const SYNTHETIC = {
  /** 1 in N scenes reads its rates from SGLang's DeepSeek run (claims) instead of a hypothetical GPU */
  sglangOneIn: 3,
  /** 1 in N hypothetical models is Llama-3-8B or Llama-3-70B (claims) instead of a hypothetical one */
  claimModelOneIn: 3,
  /** nominal seconds per variant */
  nsec: { 'pd-ratio': 60, 'transfer-ms': 50, 'load-or-recompute': 45, 'hit-gap': 40, 'namespace-cost': 50 },
  /** an answer within this share of the truth is right */
  relTol: 0.02,
  /** a draw is retried at most this many times to land its answer in a believable range */
  tries: 64,
  /** two significant digits m, scaled by decades */
  mMin: 10,
  mMax: 99,
  /** arrivals, requests per second (they cancel in the ratio) */
  lambdas: [2, 4, 5, 8, 10, 15, 20, 30, 40, 50, 80, 100],
  /** mean prompt and output tokens of a fleet */
  promptMin: 500,
  promptMax: 32000,
  outMin: 100,
  outMax: 2000,
  /** prefill and decode tok/s per GPU of a hypothetical GPU (decode at the TPOT SLO) */
  prefillMin: 5000,
  prefillMax: 50000,
  decodeMin: 500,
  decodeMax: 4000,
  /** the prefill:decode ratio of a scene stays in this window */
  ratioMin: 0.15,
  ratioMax: 8,
  /** GPUs per worker at the transfer level */
  workerGpus: [1, 2, 4, 8],
  /** context lengths of a hand-off: decimal and binary round numbers */
  contexts: [1024, 2048, 4096, 8192, 16384, 32768],
  contextMin: 1000,
  contextMax: 32000,
  /** hypothetical KV bytes per token */
  kvBytesMin: 30000,
  kvBytesMax: 600000,
  /** hypothetical links in GB/s (GiB/s and Gb/s at the transfer level) */
  linkMin: 10,
  linkMax: 400,
  nicGbit: [100, 200, 400, 800],
  linkGib: [25, 32, 50, 64, 100],
  /** a hand-off takes between these milliseconds */
  handoffMinMs: 2,
  handoffMaxMs: 1500,
  /** prefill tok/s of a model being recomputed from a cache tier */
  recomputeMin: 1000,
  recomputeMax: 60000,
  /** tokens of a cached prefix (the break-even bandwidth does not depend on it) */
  prefixes: [1000, 2000, 4000, 8000, 16000, 32000],
  /** tokens a prefix hit covers, and the rate it is prefilled at (hit-gap, namespace-cost) */
  hitMin: 500,
  hitMax: 32000,
  rateMin: 5000,
  rateMax: 60000,
  /** a hit saves between these milliseconds */
  gapMinMs: 5,
  gapMaxMs: 2000,
  /** a hypothetical engine caches whole blocks of this many tokens (level 3) */
  blocks: [16, 32, 64, 128],
  /** tenants sharing a system prompt, and its length in tokens */
  tenantMin: 2,
  tenantMax: 16,
  systemMin: 300,
  systemMax: 8000,
  /** the namespace costs between these GPU-seconds, and per day at the transfer level */
  nsMin: 0.1,
  nsMax: 500,
  nsDayMin: 5,
  nsDayMax: 50000,
  /** times a day the shared prompt's cache entries are rebuilt (level 3) */
  refills: [4, 6, 12, 24, 48],
  /** decimals of the GiB-per-GB factor in a step */
  factorDigits: 4,
  /** a slip within this distance of a right answer (as a ratio) is not told from it */
  slipGuard: 0.05,
}

const TRANSFER: Level = 3 // gen-literal-ok: level 3 of the staircase
const ALL_LEVELS = [0, 1, 2, TRANSFER] as const
const THOUSAND = 1000 // gen-literal-ok: milliseconds per second, and a kilo prefix
const TEN_THOUSAND = THOUSAND * 10

const VARIANTS: VariantSpec[] = [
  { id: 'pd-ratio', title: 'Prefill to decode GPU ratio', kcs: [EPD_PHASES], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['pd-ratio'] },
  { id: 'transfer-ms', title: 'Milliseconds to hand off a KV cache', kcs: [EPD_PHASES], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['transfer-ms'] },
  { id: 'load-or-recompute', title: 'Break-even bandwidth: load or recompute', kcs: [KV_TIERING], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['load-or-recompute'] },
  { id: 'hit-gap', title: 'The TTFT a prefix hit saves', kcs: [CACHE_TIMING_ORACLE], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['hit-gap'] },
  { id: 'namespace-cost', title: 'Prefill a tenant namespace costs', kcs: [CACHE_TIMING_ORACLE], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['namespace-cost'] },
]
const spec = (id: string): VariantSpec => VARIANTS.find((x) => x.id === id)!

/* ------------------------------ claims ------------------------------ */

const SGLANG_IN = 'serving.sglang-deepseek.input-tps-per-node'
const SGLANG_OUT = 'serving.sglang-deepseek.output-tps-per-node'
const SGLANG_GPUS = 'serving.sglang-deepseek.gpus-per-node'
const KV_CLAIMS: Record<string, string> = { 'llama3-8b': 'model.llama3-8b.kv-bytes-per-token', 'llama3-70b': 'zoo.llama3-70b.kv-bytes-per-token' }
const KV_NAMES: Record<string, string> = { 'llama3-8b': 'Llama-3-8B', 'llama3-70b': 'Llama-3-70B' }

/* ------------------------------ pools ------------------------------ */

/** Two significant digits over the given decades. */
const twoSig = (...scales: number[]): number[] => {
  const out: number[] = []
  for (let m = SYNTHETIC.mMin; m <= SYNTHETIC.mMax; m++) for (const s of scales) out.push(m * s)
  return out
}
const between = (xs: readonly number[], lo: number, hi: number): number[] => xs.filter((x) => x >= lo && x <= hi)
const within = (x: number, lo: number, hi: number): boolean => x >= lo && x <= hi
const range = (lo: number, hi: number): number[] => {
  const out: number[] = []
  for (let x = lo; x <= hi; x++) out.push(x)
  return out
}

const PROMPTS = between(twoSig(100, THOUSAND), SYNTHETIC.promptMin, SYNTHETIC.promptMax)
const OUTPUTS = between(twoSig(10, 100), SYNTHETIC.outMin, SYNTHETIC.outMax)
const PREFILL_RATES = between(twoSig(100, THOUSAND), SYNTHETIC.prefillMin, SYNTHETIC.prefillMax)
const DECODE_RATES = between(twoSig(10, 100), SYNTHETIC.decodeMin, SYNTHETIC.decodeMax)
const CONTEXTS = [...SYNTHETIC.contexts, ...between(twoSig(100, THOUSAND), SYNTHETIC.contextMin, SYNTHETIC.contextMax)]
const KV_BYTES = between(twoSig(THOUSAND, TEN_THOUSAND), SYNTHETIC.kvBytesMin, SYNTHETIC.kvBytesMax)
const LINKS = between(twoSig(1, 10), SYNTHETIC.linkMin, SYNTHETIC.linkMax)
const RECOMPUTE_RATES = between(twoSig(100, THOUSAND), SYNTHETIC.recomputeMin, SYNTHETIC.recomputeMax)
const HITS = between(twoSig(100, THOUSAND), SYNTHETIC.hitMin, SYNTHETIC.hitMax)
const RATES = between(twoSig(100, THOUSAND), SYNTHETIC.rateMin, SYNTHETIC.rateMax)
const TENANTS = range(SYNTHETIC.tenantMin, SYNTHETIC.tenantMax)
const SYSTEMS = between(twoSig(10, 100), SYNTHETIC.systemMin, SYNTHETIC.systemMax)

/** Draws until `ok` accepts, at most SYNTHETIC.tries times; the last draw stands if none does. */
function drawUntil<T>(draw: () => T, ok: (x: T) => boolean): T {
  let x = draw()
  for (let i = 1; i < SYNTHETIC.tries && !ok(x); i++) x = draw()
  return x
}

/* ------------------------------ the maths ------------------------------ */

const num = (p: Params, k: string): number => Number(p[k])
const sglang = (p: Params): boolean => p.dep === 'sglang'
const claimModel = (p: Params): boolean => KV_CLAIMS[String(p.model)] !== undefined
const kvBytes = (p: Params): number => (claimModel(p) ? claimNumber(KV_CLAIMS[String(p.model)]) : num(p, 'b'))

/** Tokens per second one prefill GPU processes (or one node, in SGLang's run, which the node ratio shares). */
const prefillRate = (p: Params): number => (sglang(p) ? claimNumber(SGLANG_IN) : num(p, 'p') / (p.gp === undefined ? 1 : num(p, 'gp')))
const decodeRate = (p: Params): number => (sglang(p) ? claimNumber(SGLANG_OUT) : num(p, 'd') / (p.gd === undefined ? 1 : num(p, 'gd')))
/** The prefill rate of one GPU for a namespace or a hit: the node's rate over its GPUs in SGLang's run. */
const gpuRate = (p: Params): number => (sglang(p) ? claimNumber(SGLANG_IN) / claimNumber(SGLANG_GPUS) : num(p, 'p'))
/** The prefill rate a hit saves at: one GPU's, or one node's in SGLang's run. */
const hitRate = (p: Params): number => (sglang(p) ? claimNumber(SGLANG_IN) : num(p, 'p'))

/** The link in GB/s (10⁹ bytes per second), whatever unit it was quoted in. */
function linkGBps(p: Params): number {
  if (p.lu === 'Gb/s') return num(p, 'B') / BITS_PER_BYTE
  if (p.lu === 'GiB/s') return (num(p, 'B') * GIB) / GB
  return num(p, 'B')
}

/** Tokens a hit covers: the prefix, or only its whole blocks where the engine caches blocks. */
const cachedTokens = (p: Params): number => (p.block === undefined ? num(p, 'c') : Math.floor(num(p, 'c') / num(p, 'block')) * num(p, 'block'))

const pdRatio = (p: Params, flipped = false): number => {
  const pre = (num(p, 'lam') * num(p, 'P')) / prefillRate(p)
  const dec = (num(p, 'lam') * num(p, 'O')) / decodeRate(p)
  return flipped ? dec / pre : pre / dec
}
const handoffMs = (p: Params): number => ((num(p, 'P') * kvBytes(p)) / (linkGBps(p) * GB)) * THOUSAND
const breakEvenGBps = (p: Params): number => (kvBytes(p) * num(p, 'p')) / GB
const gapMs = (p: Params): number => (cachedTokens(p) / hitRate(p)) * THOUSAND
const namespaceS = (p: Params): number => (((num(p, 'N') - 1) * num(p, 'S')) / gpuRate(p)) * (p.refills === undefined ? 1 : num(p, 'refills'))

function truthOf(variant: string, p: Params): number {
  switch (variant) {
    case 'pd-ratio':
      return pdRatio(p)
    case 'transfer-ms':
      return handoffMs(p)
    case 'load-or-recompute':
      return p.bits === true ? breakEvenGBps(p) * BITS_PER_BYTE : breakEvenGBps(p)
    case 'hit-gap':
      return gapMs(p)
    default:
      return namespaceS(p)
  }
}

function unitOf(variant: string, p: Params): string {
  switch (variant) {
    case 'pd-ratio':
      return 'prefill per decode'
    case 'transfer-ms':
    case 'hit-gap':
      return 'ms'
    case 'load-or-recompute':
      return p.bits === true ? 'Gb/s' : 'GB/s'
    default:
      return p.refills === undefined ? 'GPU-s' : 'GPU-s per day'
  }
}

/* ------------------------------ prompt and solution text ------------------------------ */

const t = (text: string): PromptPart => ({ t: 'text', text })
const v = (value: number, unit?: string, digits?: number): PromptPart => ({ t: 'value', value, ...(unit ? { unit } : {}), ...(digits === undefined ? {} : { digits }) })
const chip = (claim: string, unit?: string): PromptPart => ({ t: 'claim', claim, ...(unit ? { unit } : {}) })
const step = (text: PromptPart[], value: number, unit: string): SolutionStep => ({ text, result: { value, unit } })
const gpus = (n: number): string => `${n} GPU${n === 1 ? '' : 's'}`

/** The model whose KV a hand-off or a tier moves: Llama through its claim, or a hypothetical model. */
function modelParts(p: Params): PromptPart[] {
  if (claimModel(p)) return [t(`The model is ${KV_NAMES[String(p.model)]}, whose KV cache takes `), chip(KV_CLAIMS[String(p.model)]), t(' (BF16). ')]
  return [t('The model is hypothetical and keeps '), v(num(p, 'b'), 'bytes'), t(' of KV per token. ')]
}

/** The link of a hand-off, in the unit the level quotes it in. */
function linkParts(p: Params): PromptPart[] {
  const unit = p.lu === undefined ? 'GB/s' : String(p.lu)
  const word = p.lu === 'Gb/s' ? ' (gigabits per second)' : p.lu === 'GiB/s' ? ' (2³⁰ bytes per second)' : ''
  return [t('A hypothetical link between the two workers sustains '), v(num(p, 'B'), unit), t(`${word}. `)]
}

/** A prefill rate sentence for the hit and namespace variants: SGLang's node, or a hypothetical GPU. */
function rateParts(p: Params): PromptPart[] {
  if (sglang(p)) return [t("In SGLang's DeepSeek run a prefill node ingests "), chip(SGLANG_IN), t(', measured on '), chip(SGLANG_GPUS), t('. ')]
  return [t('A hypothetical prefill GPU processes '), v(num(p, 'p'), 'tok/s'), t(' of prompt. ')]
}

function stemFor(variant: string, p: Params): PromptPart[] {
  switch (variant) {
    case 'pd-ratio': {
      const work = [t('A hypothetical service receives '), v(num(p, 'lam'), 'requests per second'), t(', each with a mean prompt of '), v(num(p, 'P'), 'tokens'), t(' and a mean output of '), v(num(p, 'O'), 'tokens'), t('. ')]
      if (sglang(p)) {
        return [
          ...work,
          t("Size its fleet from SGLang's DeepSeek run, which measured "),
          chip(SGLANG_IN),
          t(' on a prefill node and '),
          chip(SGLANG_OUT),
          t(' on a decode node, with '),
          chip(SGLANG_GPUS),
          t(' (one operating point). Both kinds of node hold the same GPUs, so the node ratio is the GPU ratio. How many prefill nodes does it need per decode node?'),
        ]
      }
      if (p.gp !== undefined) {
        return [
          ...work,
          t(`A prefill worker spans ${gpus(num(p, 'gp'))} and processes `),
          v(num(p, 'p'), 'tok/s'),
          t(` of prompt in all; a decode worker spans ${gpus(num(p, 'gd'))} and generates `),
          v(num(p, 'd'), 'tok/s'),
          t(' in all within the TPOT SLO. How many prefill GPUs does it need per decode GPU?'),
        ]
      }
      return [...work, t('One prefill GPU processes '), v(num(p, 'p'), 'tok/s'), t(' of prompt; one decode GPU generates '), v(num(p, 'd'), 'tok/s'), t(' of output within the TPOT SLO. How many prefill GPUs does it need per decode GPU?')]
    }
    case 'transfer-ms':
      return [
        t('A hypothetical deployment prefills a '),
        v(num(p, 'P')),
        t('-token prompt on one worker and hands its KV cache to a decode worker. '),
        ...modelParts(p),
        ...linkParts(p),
        t('How many milliseconds does the hand-off take? Use the whole link rate and ignore latency.'),
      ]
    case 'load-or-recompute':
      return [
        t('A hypothetical prefix cache holds a '),
        v(num(p, 'n')),
        t('-token prefix on a slower tier. '),
        ...modelParts(p),
        t('A hypothetical GPU can recompute the prefix at '),
        v(num(p, 'p'), 'tok/s'),
        t(` of prefill, or load its KV from the tier. At what tier bandwidth do loading and recomputing take the same time, in ${p.bits === true ? 'Gb/s' : 'GB/s'}?`),
      ]
    case 'hit-gap': {
      if (p.block !== undefined) {
        return [
          t('A hypothetical engine caches whole blocks of '),
          v(num(p, 'block'), 'tokens'),
          t(' only. An attacker probes with a prompt whose first '),
          v(num(p, 'c'), 'tokens'),
          t(' match a cached prompt. '),
          ...rateParts(p),
          t('By how many milliseconds is the hit faster to first token than a miss, if prefill is the only difference?'),
        ]
      }
      return [t('An attacker probes a shared prefix cache with a prompt whose first '), v(num(p, 'c'), 'tokens'), t(' match a cached prompt (a hypothetical hit). '), ...rateParts(p), t('By how many milliseconds is the hit faster to first token than a miss, if prefill is the only difference?')]
    }
    default: {
      const day = p.refills === undefined ? [] : [t('The shared prompt is evicted and rebuilt '), v(num(p, 'refills'), 'times a day'), t('. ')]
      return [
        t('A hypothetical service has '),
        v(num(p, 'N'), 'tenants'),
        t(' sharing one '),
        v(num(p, 'S')),
        t('-token system prompt. With the tenant in the cache key, each tenant prefills it once instead of one prefill serving all. '),
        ...rateParts(p),
        ...day,
        t(p.refills === undefined ? 'How many extra prefill GPU-seconds does the namespace cost?' : 'How many extra prefill GPU-seconds per day does the namespace cost?'),
      ]
    }
  }
}

function steps(variant: string, p: Params, truth: number): SolutionStep[] {
  const unit = unitOf(variant, p)
  switch (variant) {
    case 'pd-ratio': {
      const w = sglang(p) ? 'nodes' : 'GPUs'
      const pre = prefillRate(p)
      const dec = decodeRate(p)
      const lam = num(p, 'lam')
      const out: SolutionStep[] = []
      if (p.gp !== undefined) {
        out.push(step([t('Prefill rate per GPU = worker rate ÷ GPUs per worker = '), v(num(p, 'p'), 'tok/s'), t(' ÷ '), v(num(p, 'gp'), 'GPUs')], pre, 'tok/s per GPU'))
        out.push(step([t('Decode rate per GPU = worker rate ÷ GPUs per worker = '), v(num(p, 'd'), 'tok/s'), t(' ÷ '), v(num(p, 'gd'), 'GPUs')], dec, 'tok/s per GPU'))
      }
      out.push(step([t('Prefill demand = arrivals × mean prompt = '), v(lam, 'req/s'), t(' × '), v(num(p, 'P'), 'tokens')], lam * num(p, 'P'), 'tok/s'))
      out.push(step([t(`Prefill ${w} = demand ÷ prefill rate = `), v(lam * num(p, 'P'), 'tok/s'), t(' ÷ '), v(pre, 'tok/s')], (lam * num(p, 'P')) / pre, w))
      out.push(step([t('Decode demand = arrivals × mean output = '), v(lam, 'req/s'), t(' × '), v(num(p, 'O'), 'tokens')], lam * num(p, 'O'), 'tok/s'))
      out.push(step([t(`Decode ${w} = demand ÷ decode rate = `), v(lam * num(p, 'O'), 'tok/s'), t(' ÷ '), v(dec, 'tok/s')], (lam * num(p, 'O')) / dec, w))
      out.push(step([t(`Ratio = prefill ${w} ÷ decode ${w}; the arrival rate cancels`)], truth, unit))
      return out
    }
    case 'transfer-ms': {
      const out: SolutionStep[] = []
      if (p.lu === 'Gb/s') out.push(step([t('Link in GB/s = Gb/s ÷ 8 bits per byte = '), v(num(p, 'B'), 'Gb/s'), t(' ÷ 8')], linkGBps(p), 'GB/s'))
      if (p.lu === 'GiB/s') out.push(step([t('Link in GB/s = GiB/s × 1.0737 = '), v(num(p, 'B'), 'GiB/s'), t(' × '), v(GIB / GB, undefined, SYNTHETIC.factorDigits)], linkGBps(p), 'GB/s'))
      const bytes = num(p, 'P') * kvBytes(p)
      out.push(step([t('KV of the prompt = tokens × bytes per token = '), v(num(p, 'P'), 'tokens'), t(' × '), v(kvBytes(p), 'bytes')], bytes / GB, 'GB'))
      out.push(step([t('Time = KV ÷ link rate = '), v(bytes / GB, 'GB'), t(' ÷ '), v(linkGBps(p), 'GB/s')], bytes / GB / linkGBps(p), 's'))
      out.push(step([t('In milliseconds = seconds × 1,000')], truth, unit))
      return out
    }
    case 'load-or-recompute': {
      const n = num(p, 'n')
      const bytes = n * kvBytes(p)
      const seconds = n / num(p, 'p')
      const out = [
        step([t('Time to recompute the prefix = tokens ÷ prefill rate = '), v(n, 'tokens'), t(' ÷ '), v(num(p, 'p'), 'tok/s')], seconds, 's'),
        step([t('Bytes to load = tokens × bytes per token = '), v(n, 'tokens'), t(' × '), v(kvBytes(p), 'bytes')], bytes / GB, 'GB'),
        step([t('Equal times: bandwidth = bytes ÷ recompute time (the prefix length cancels, so it is bytes per token × prefill rate)')], breakEvenGBps(p), 'GB/s'),
      ]
      if (p.bits === true) out.push(step([t('In gigabits per second = GB/s × 8 bits per byte')], truth, unit))
      return out
    }
    case 'hit-gap': {
      const cached = cachedTokens(p)
      const out: SolutionStep[] = []
      const skipped = p.block === undefined ? 'Tokens the hit skips = the matched prefix' : 'Tokens the hit skips = whole blocks of the matched prefix = ⌊matched ÷ block⌋ × block'
      out.push(step([t(skipped)], cached, 'tokens'))
      out.push(step([t('Prefill time saved = tokens ÷ prefill rate = '), v(cached, 'tokens'), t(' ÷ '), v(hitRate(p), 'tok/s')], cached / hitRate(p), 's'))
      out.push(step([t('In milliseconds = seconds × 1,000')], truth, unit))
      return out
    }
    default: {
      const total = num(p, 'N') * num(p, 'S')
      const extra = (num(p, 'N') - 1) * num(p, 'S')
      const rate = gpuRate(p)
      const out: SolutionStep[] = []
      if (sglang(p)) out.push(step([t('Prefill rate per GPU = node rate ÷ GPUs per node = '), v(claimNumber(SGLANG_IN), 'tok/s'), t(' ÷ '), v(claimNumber(SGLANG_GPUS), 'GPUs')], rate, 'tok/s per GPU'))
      out.push(step([t('Tokens prefilled with the tenant in the key = tenants × prompt = '), v(num(p, 'N'), 'tenants'), t(' × '), v(num(p, 'S'), 'tokens')], total, 'tokens'))
      out.push(step([t('Extra tokens = that minus the one prefill a shared key pays = '), v(total, 'tokens'), t(' − '), v(num(p, 'S'), 'tokens')], extra, 'tokens'))
      const each = step([t('Extra GPU-seconds = extra tokens ÷ prefill rate per GPU = '), v(extra, 'tokens'), t(' ÷ '), v(rate, 'tok/s')], extra / rate, 'GPU-s')
      if (p.refills === undefined) return [...out, { ...each, result: { value: truth, unit } }]
      return [...out, each, step([t('Per day = GPU-seconds × rebuilds = '), v(extra / rate, 'GPU-s'), t(' × '), v(num(p, 'refills'))], truth, unit)]
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
  if (claimModel(p)) out.push(KV_CLAIMS[String(p.model)])
  if (sglang(p)) out.push(SGLANG_IN, ...(variant === 'pd-ratio' ? [SGLANG_OUT, SGLANG_GPUS] : variant === 'hit-gap' || variant === 'namespace-cost' ? [SGLANG_GPUS] : []))
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

/** Whether no step before the last carries the final result, as when a count of exactly 1 repeats the other (the worked steps would give the answer away). */
function clean(variant: string, p: Params): boolean {
  const truth = truthOf(variant, p)
  return !steps(variant, p, truth).slice(0, -1).some((s) => s.result?.value === truth)
}

const sglangScene = (r: Rng): boolean => r.int(0, SYNTHETIC.sglangOneIn - 1) === 0

function drawPd(r: Rng, level: Level): Params {
  const lam = r.pick(SYNTHETIC.lambdas)
  const sg = level < TRANSFER && sglangScene(r)
  const one = (): Params => {
    const work = { lam, P: r.pick(PROMPTS), O: r.pick(OUTPUTS) }
    if (sg) return { dep: 'sglang', ...work }
    const pre = r.pick(PREFILL_RATES)
    const dec = r.pick(DECODE_RATES)
    if (level < TRANSFER) return { dep: 'synthetic', ...work, p: pre, d: dec }
    // the transfer level quotes each worker's rate in all, and its GPUs
    const gp = r.pick(SYNTHETIC.workerGpus)
    const gd = r.pick(SYNTHETIC.workerGpus)
    return { dep: 'synthetic', ...work, p: pre * gp, d: dec * gd, gp, gd }
  }
  return drawUntil(one, (q) => within(pdRatio(q), SYNTHETIC.ratioMin, SYNTHETIC.ratioMax) && clean('pd-ratio', q))
}

function drawModel(r: Rng): Params {
  if (r.int(0, SYNTHETIC.claimModelOneIn - 1) === 0) return { model: r.pick(Object.keys(KV_CLAIMS)) }
  return { model: 'custom', b: r.pick(KV_BYTES) }
}

function drawTransfer(r: Rng, level: Level): Params {
  const one = (): Params => {
    const base = { ...drawModel(r), P: r.pick(CONTEXTS) }
    if (level < TRANSFER) return { ...base, B: r.pick(LINKS) }
    return r.int(0, 1) === 0 ? { ...base, B: r.pick(SYNTHETIC.nicGbit), lu: 'Gb/s' } : { ...base, B: r.pick(SYNTHETIC.linkGib), lu: 'GiB/s' }
  }
  return drawUntil(one, (q) => within(handoffMs(q), SYNTHETIC.handoffMinMs, SYNTHETIC.handoffMaxMs) && clean('transfer-ms', q))
}

function drawLoad(r: Rng, level: Level): Params {
  const one = (): Params => ({ ...drawModel(r), n: r.pick(SYNTHETIC.prefixes), p: r.pick(RECOMPUTE_RATES), ...(level === TRANSFER ? { bits: true } : {}) })
  return drawUntil(one, (q) => clean('load-or-recompute', q))
}

function drawHit(r: Rng, level: Level): Params {
  const sg = sglangScene(r)
  const one = (): Params => {
    const base = { c: r.pick(HITS), ...(level === TRANSFER ? { block: r.pick(SYNTHETIC.blocks) } : {}) }
    return sg ? { dep: 'sglang', ...base } : { dep: 'synthetic', ...base, p: r.pick(RATES) }
  }
  return drawUntil(one, (q) => within(gapMs(q), SYNTHETIC.gapMinMs, SYNTHETIC.gapMaxMs) && clean('hit-gap', q))
}

function drawNamespace(r: Rng, level: Level): Params {
  const sg = sglangScene(r)
  const one = (): Params => {
    const base = { N: r.pick(TENANTS), S: r.pick(SYSTEMS), ...(level === TRANSFER ? { refills: r.pick(SYNTHETIC.refills) } : {}) }
    return sg ? { dep: 'sglang', ...base } : { dep: 'synthetic', ...base, p: r.pick(RATES) }
  }
  const [lo, hi] = level === TRANSFER ? [SYNTHETIC.nsDayMin, SYNTHETIC.nsDayMax] : [SYNTHETIC.nsMin, SYNTHETIC.nsMax]
  return drawUntil(one, (q) => within(namespaceS(q), lo, hi) && clean('namespace-cost', q))
}

function draw(variant: string, level: Level, r: Rng): Params {
  switch (variant) {
    case 'pd-ratio':
      return drawPd(r, level)
    case 'transfer-ms':
      return drawTransfer(r, level)
    case 'load-or-recompute':
      return drawLoad(r, level)
    case 'hit-gap':
      return drawHit(r, level)
    default:
      return drawNamespace(r, level)
  }
}

function make(seed: number, level: Level, variant?: string): Instance {
  const vs = resolveVariant(gen, seed, level, variant)
  return build(vs, level, seed, draw(vs.id, level, rngFor(gen.id, vs.id, level, seed)))
}

/* ------------------------------ grading ------------------------------ */

/** A slip ratio, or null when it is too close to 1 to tell from a right answer. */
const slip = (ratio: number): number | null => (Math.abs(ratio - 1) > SYNTHETIC.slipGuard ? ratio : null)
const truthFor = (i: Instance): number => truthOf(i.variant, i.params)
const answeredInMs = (i: Instance): boolean => i.variant === 'transfer-ms' || i.variant === 'hit-gap'

const RATIO_RULES: RatioRule[] = [
  {
    id: 'prefill.flipped',
    // decode over prefill: the reciprocal of the truth, so the ratio to the truth is its inverse square
    ratio: (i) => (i.variant === 'pd-ratio' ? slip(pdRatio(i.params, true) / truthFor(i)) : null),
    message: 'You divided the decode GPUs by the prefill GPUs. The ratio asked is prefill over decode: put the prefill demand on top.',
  },
  {
    id: 'prefill.tokens-not-rate',
    // prompt tokens over output tokens, with no rates: the truth times prefill rate over decode rate per GPU
    ratio: (i) => (i.variant === 'pd-ratio' ? slip(num(i.params, 'P') / num(i.params, 'O') / truthFor(i)) : null),
    message: 'You took the ratio of prompt tokens to output tokens. A GPU prefills and decodes at different speeds, so divide each phase\'s token demand by its own per-GPU rate before you take the ratio.',
  },
  {
    id: 'prefill.bits-bytes',
    ratio: (i) => (i.params.lu === 'Gb/s' || i.params.bits === true ? 1 / BITS_PER_BYTE : null),
    message: (i) =>
      i.variant === 'transfer-ms'
        ? 'The link is quoted in gigabits per second. A byte is 8 bits, so the link moves an eighth as many GB/s as the number says: divide by 8 before you divide the bytes by it.'
        : 'The answer is asked in gigabits per second. A byte is 8 bits, so multiply the GB/s you found by 8.',
  },
  {
    id: 'prefill.ms-s',
    ratio: (i) => (answeredInMs(i) ? 1 / THOUSAND : null),
    message: 'You stopped at seconds. The answer is asked in milliseconds, 1,000 to the second: multiply by 1,000.',
  },
  {
    id: 'prefill.gb-gib',
    ratio: (i) => (i.params.lu === 'GiB/s' ? GIB / GB : null),
    message: 'The link is quoted in GiB/s (2³⁰ bytes) and the KV is counted in GB (10⁹ bytes). One GiB/s is 1.0737 GB/s, so convert the link before you divide.',
  },
  {
    id: 'prefill.one-tenant',
    // all N tenants counted instead of the N − 1 a shared key already covers
    ratio: (i) => (i.variant === 'namespace-cost' ? slip(num(i.params, 'N') / (num(i.params, 'N') - 1)) : null),
    message: (i) =>
      i.params.N === undefined
        ? 'You counted every tenant. A shared key already pays one prefill, so the namespace costs the others.'
        : `You counted all ${formatNumber(num(i.params, 'N'))} tenants. A shared key already pays one prefill, so the namespace costs the other ${formatNumber(num(i.params, 'N') - 1)}.`,
  },
]

const pin = (name: string, source: string, variant: string, p: Params, truthValue: number, tolerance: { abs: number }) => ({
  name,
  source,
  make: () => build(spec(variant), 0, 1, p),
  truth: truthValue,
  tolerance,
})

const gen: Gen = {
  id: 'prefill',
  version: 1,
  title: 'Prefill: P:D ratio, KV hand-off, load or recompute, the timing oracle and the namespace cost',
  kcs: [EPD_PHASES, KV_TIERING, CACHE_TIMING_ORACLE],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution: (inst) => steps(inst.variant, inst.params, inst.answer.kind === 'choice' ? 0 : inst.answer.truth),
  pins: [
    // 4,096 tokens × 327,680 bytes = 1.34 GB over 50 GB/s is 26.8 ms; the lessons round it to "~25 ms" (t5.l9) and "about 1.3 GB"
    pin('Llama-3-70B, a 4k prompt over a 50 GB/s link: the lessons\' "~25 ms" hand-off (t5.l9, t6.l3)', 't6.l3', 'transfer-ms', { model: 'llama3-70b', P: 4096, B: 50 }, 25, { abs: 2 }), // gen-literal-ok: pinned lesson number, with the lesson's own rounding
    pin("SGLang's DeepSeek node rates, 2,000-token prompts and 500-token outputs: (2,000 ÷ 52,300) ÷ (500 ÷ 22,300) = 1.71 (hand check)", 't6.l3', 'pd-ratio', { dep: 'sglang', lam: 10, P: 2000, O: 500 }, 1.7055, { abs: 0.001 }), // gen-literal-ok: pinned hand computation
    pin('A hypothetical fleet: 6,000-token prompts, 300-token outputs, 20,000 and 1,500 tok/s per GPU: 3 prefill GPUs per 2 decode GPUs', 't6.l3', 'pd-ratio', { dep: 'synthetic', lam: 10, P: 6000, O: 300, p: 20000, d: 1500 }, 1.5, { abs: 0.001 }), // gen-literal-ok: pinned hand computation
    pin('Llama-3-8B (128 KiB per token) recomputed at 20,000 tok/s: loading wins only above 2.62 GB/s', 't6.l3', 'load-or-recompute', { model: 'llama3-8b', n: 8000, p: 20000 }, 2.62144, { abs: 0.0001 }), // gen-literal-ok: pinned hand computation
    pin('A hit on 3,000 cached tokens at 30,000 tok/s of prefill: 100 ms faster', 't6.l10', 'hit-gap', { dep: 'synthetic', c: 3000, p: 30000 }, 100, { abs: 0.001 }), // gen-literal-ok: pinned hand computation
    pin('10 tenants on a 2,000-token system prompt at 20,000 tok/s: 9 extra prefills of 0.1 s = 0.9 GPU-s', 't6.l10', 'namespace-cost', { dep: 'synthetic', N: 10, S: 2000, p: 20000 }, 0.9, { abs: 0.001 }), // gen-literal-ok: pinned hand computation
  ],
}

export default gen
