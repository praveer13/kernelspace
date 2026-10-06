/**
 * The KV-cache calculator's pure model (P2, docs/specs/wave-1.md §10.2–10.4; extracted by C8).
 *
 *   KV bytes = 2 × layers × KV heads × head dim × bytes × context × batch
 *
 * KvCacheSim renders this, the five `kv.*` outcome tasks read it (the sim's Run button turns the current
 * setup into an `Observation`), and phone mode draws the canonical outcome from `PHONE_MODELS` without a sim.
 * Every real-world number comes from a claim (W4): model shapes from `model.*`, GPUs from the atlas, the
 * vLLM block size from `production.vllm.block-size`. The scenario constants are `synthetic.kv.*`.
 * No React, no DOM, no clock: it runs under `bun test`.
 */

import { atlasRow } from '@/data/atlas'
import { claimNumber } from '@/data/claims'
import type { CanonicalOutcome } from '@/lib/sims/host'

/* ------------------------------------------------------------------ */
/* Data: presets, precisions, GPUs                                     */
/* ------------------------------------------------------------------ */

export type PresetId = 'llama3-8b' | 'llama3-70b' | 'mixtral-8x7b' | 'custom'
export type Dtype = 'fp16' | 'fp8' | 'int4'

export interface ModelPreset {
  id: Exclude<PresetId, 'custom'>
  name: string
  layers: number
  kvHeads: number
  /** Query heads: a model with `kvHeads === attnHeads` is plain multi-head attention. */
  attnHeads: number
  headDim: number
  /** Every parameter that must sit in HBM, in billions. */
  paramsB: number
  note: string
}

const preset = (id: ModelPreset['id'], name: string, claim: string, paramsClaim: string, note: string): ModelPreset => ({
  id,
  name,
  layers: claimNumber(`model.${claim}.layers`),
  kvHeads: claimNumber(`model.${claim}.kv-heads`),
  attnHeads: claimNumber(`model.${claim}.attn-heads`),
  headDim: claimNumber(`model.${claim}.head-dim`),
  paramsB: claimNumber(paramsClaim),
  note,
})

const mixtralActiveB = claimNumber('model.mixtral-8x7b.active-params')
const gqaNote = (claim: string): string => `GQA, ${claimNumber(`model.${claim}.kv-heads`)} KV heads`

export const PRESETS: readonly ModelPreset[] = [
  preset('llama3-8b', 'Llama-3-8B', 'llama3-8b', 'model.llama3-8b.params', gqaNote('llama3-8b')),
  preset('llama3-70b', 'Llama-3-70B', 'llama3-70b', 'model.llama3-70b.params', gqaNote('llama3-70b')),
  preset(
    'mixtral-8x7b',
    'Mixtral-8x7B',
    'mixtral-8x7b',
    'model.mixtral-8x7b.params',
    `MoE, ${mixtralActiveB}B active, every expert resident`,
  ),
]

export const presetById = (id: PresetId): ModelPreset | undefined => PRESETS.find((p) => p.id === id)

/** Bytes per element. Plain arithmetic, not a measurement. */
export const DTYPES: readonly { id: Dtype; label: string; bytes: number }[] = [
  { id: 'fp16', label: 'FP16', bytes: 2 },
  { id: 'fp8', label: 'FP8', bytes: 1 },
  { id: 'int4', label: 'INT4', bytes: 0.5 },
]

export const dtypeBytes = (id: Dtype): number => DTYPES.find((d) => d.id === id)?.bytes ?? 2

export interface GpuCard {
  id: string
  name: string
  gb: number
  bandwidthGbps: number
}

// Every card comes from the hardware atlas (sourced claims).
function atlasGpu(id: string): GpuCard {
  const row = atlasRow(id)
  return { id: row.id, name: row.name, gb: row.hbmGb ?? 0, bandwidthGbps: row.hbmBwGBs ?? 0 }
}

export const GPUS: readonly GpuCard[] = ['h100', 'b200', 'a100-80', 'a100-40', 'rtx4090', 't4'].map(atlasGpu)

export const gpuById = (id: string): GpuCard => GPUS.find((g) => g.id === id) ?? GPUS[0]

/** Slider stops (control ranges, not model numbers). */
export const CTX_STEPS: readonly number[] = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 200000, 262144, 524288, 1048576]
export const BATCH_STEPS: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128, 256]
export const GPU_COUNT_PRESETS: readonly number[] = [1, 2, 4, 8]

/** vLLM's default tokens per KV block. */
export const BLOCK_SIZE = claimNumber('production.vllm.block-size')
/** Memory lost to block rounding under PagedAttention, in percent (a scenario figure: `synthetic.kv.paged-waste`). */
export const PAGED_WASTE_PCT = claimNumber('synthetic.kv.paged-waste')
/** Share of a statically reserved KV cache that holds real token states, in percent (the paper's measured range, mid-point). */
export const STATIC_UTILIZATION_PCT = claimNumber('model.kv.static-utilization')
/** Share of a statically reserved KV cache that is waste, in percent. */
export const STATIC_WASTE_PCT = Math.round(100 - STATIC_UTILIZATION_PCT)
/** Runtime scratch: a fixed reserve in GB (`synthetic.kv.runtime-base`) plus a share of the weight bytes (`synthetic.kv.runtime-overhead`). */
export const OVERHEAD_BASE_GB = claimNumber('synthetic.kv.runtime-base')
export const OVERHEAD_FRACTION = claimNumber('synthetic.kv.runtime-overhead') / 100
/** The inter-token latency target the bandwidth wall is drawn against (`synthetic.kv.itl-slo`). */
export const ITL_SLO_MS = claimNumber('synthetic.kv.itl-slo')

/** How many times the KV you use a static reservation must hold. */
export const STATIC_RESERVE_FACTOR = 100 / STATIC_UTILIZATION_PCT

/* ------------------------------------------------------------------ */
/* The model                                                           */
/* ------------------------------------------------------------------ */

/** Everything the sim lets a learner set. */
export interface KvState {
  presetId: PresetId
  layers: number
  kvHeads: number
  headDim: number
  kvDtype: Dtype
  weightDtype: Dtype
  ctx: number
  batch: number
  gpuId: string
  gpuCount: number
  /** Percent of the prompt shared across the batch (radix cache). */
  prefixShare: number
  paged: boolean
}

export const stateOfPreset = (id: ModelPreset['id']): Pick<KvState, 'presetId' | 'layers' | 'kvHeads' | 'headDim'> => {
  const p = presetById(id) as ModelPreset
  return { presetId: p.id, layers: p.layers, kvHeads: p.kvHeads, headDim: p.headDim }
}

/** What the sim starts from: Llama-3-8B, FP16 everywhere, 8k context, batch 4, one H100. */
export const DEFAULT_STATE: KvState = {
  ...stateOfPreset('llama3-8b'),
  kvDtype: 'fp16',
  weightDtype: 'fp16',
  ctx: CTX_STEPS[3],
  batch: BATCH_STEPS[2],
  gpuId: 'h100',
  gpuCount: 1,
  prefixShare: 0,
  paged: true,
}

/** Custom has no parameter count of its own; the sim gives it a stand-in size (`synthetic.kv.custom-params`). */
export const CUSTOM_PARAMS_B = claimNumber('synthetic.kv.custom-params')

export const paramsOf = (s: Pick<KvState, 'presetId'>): number =>
  s.presetId === 'custom' ? CUSTOM_PARAMS_B : (presetById(s.presetId)?.paramsB ?? CUSTOM_PARAMS_B)

export interface KvResult {
  /** Bytes per token per sequence. */
  kvPerToken: number
  /** GB of KV actually holding tokens (after prefix sharing). */
  kvUsed: number
  /** GB reserved: `kvUsed` plus paging waste, or a static reservation. */
  kvReserved: number
  weights: number
  overhead: number
  total: number
  oom: boolean
  totalHbmGb: number
  totalBandwidthGbps: number
  /** Most sequences of this context that fit in HBM. */
  maxBatch: number
  /** Most sequences of this context that meet the ITL target. */
  bandwidthBatch: number
  /** Longest context, in tokens, that fits at this batch size (0 when the weights alone do not fit). */
  maxCtx: number
  limitingWall: 'capacity' | 'bandwidth'
  /** Lower bound on one decode step: (weights + live KV) / aggregate bandwidth. */
  itlMs: number
  shareFactor: number
  paFactor: number
  wastePct: number
  /** GB of KV one sequence needs at this context, with no waste and no sharing. */
  oneSequenceGb: number
}

const GB = 1e9

export function kvModel(s: KvState): KvResult {
  const gpu = gpuById(s.gpuId)
  const totalHbmGb = gpu.gb * s.gpuCount
  const totalBandwidthGbps = gpu.bandwidthGbps * s.gpuCount
  const kvBytes = dtypeBytes(s.kvDtype)
  const kvPerToken = 2 * s.layers * s.kvHeads * s.headDim * kvBytes // bytes / token / sequence
  const p = s.prefixShare / 100
  const shareFactor = s.batch > 1 ? 1 - p * ((s.batch - 1) / s.batch) : 1
  const kvUsed = (kvPerToken * s.ctx * s.batch * shareFactor) / GB
  const paFactor = s.paged ? 1 + PAGED_WASTE_PCT / 100 : STATIC_RESERVE_FACTOR
  const kvReserved = kvUsed * paFactor
  const weights = paramsOf(s) * dtypeBytes(s.weightDtype)
  const overhead = OVERHEAD_BASE_GB + OVERHEAD_FRACTION * weights
  const total = weights + kvReserved + overhead
  const perSeqGb = (kvPerToken * s.ctx * paFactor) / GB
  const availableKvGb = Math.max(0, totalHbmGb - weights - overhead)
  const sharedPrefixGb = perSeqGb * p
  const unsharedGb = perSeqGb - sharedPrefixGb
  const maxBatch =
    availableKvGb < sharedPrefixGb ? 0 : Math.max(0, Math.floor((availableKvGb - sharedPrefixGb) / Math.max(unsharedGb, 1e-9)))
  // KV for `b` sequences is perSeq × (b(1 − p) + p), so the longest context at batch b divides what is free by that.
  const seqEquivalents = s.batch * (1 - p) + p
  const maxCtx = Math.floor((availableKvGb * GB) / (kvPerToken * paFactor * seqEquivalents))
  const itlMs = ((weights + kvUsed) / totalBandwidthGbps) * 1000
  const bandwidthKvBudgetGb = Math.max(0, (totalBandwidthGbps * ITL_SLO_MS) / 1000 - weights)
  const bandwidthPerSeqGb = (kvPerToken * s.ctx) / GB
  const bandwidthSharedPrefixGb = bandwidthPerSeqGb * p
  const bandwidthUnsharedGb = bandwidthPerSeqGb - bandwidthSharedPrefixGb
  const bandwidthBatch =
    bandwidthKvBudgetGb < bandwidthSharedPrefixGb
      ? 0
      : Math.max(0, Math.floor((bandwidthKvBudgetGb - bandwidthSharedPrefixGb) / Math.max(bandwidthUnsharedGb, 1e-9)))
  return {
    kvPerToken,
    kvUsed,
    kvReserved,
    weights,
    overhead,
    total,
    oom: total > totalHbmGb,
    totalHbmGb,
    totalBandwidthGbps,
    maxBatch,
    bandwidthBatch,
    maxCtx,
    limitingWall: maxBatch <= bandwidthBatch ? 'capacity' : 'bandwidth',
    itlMs,
    shareFactor,
    paFactor,
    wastePct: s.paged ? PAGED_WASTE_PCT : STATIC_WASTE_PCT,
    oneSequenceGb: (kvPerToken * s.ctx) / GB,
  }
}

/* ------------------------------------------------------------------ */
/* The outcome tasks' readings                                         */
/* ------------------------------------------------------------------ */

/**
 * What each `kv.*` task measures: the `Observation` key, its unit, and the value read off a model run. The
 * learner presses Run in the sim and the value of every key whose setup is in place goes to the task panel.
 */
export interface KvReading {
  key: string
  unit: string
  read(r: KvResult): number
}

const round = (x: number, digits: number): number => Math.round(x * 10 ** digits) / 10 ** digits

export const READINGS: readonly KvReading[] = [
  { key: 'kv.bytes-per-token', unit: 'KiB/token', read: (r) => r.kvPerToken / 1024 },
  { key: 'kv.oom-context', unit: 'tokens', read: (r) => r.maxCtx },
  { key: 'kv.fp8-rescue', unit: 'sequences', read: (r) => r.maxBatch },
  { key: 'kv.gqa', unit: 'GB', read: (r) => round(r.oneSequenceGb, 2) },
  { key: 'kv.max-batch', unit: 'sequences', read: (r) => r.maxBatch },
]

/** A setup pins only the controls its reading depends on; every other control is free. */
export type KvSetup = Partial<Omit<KvState, 'presetId'>> & { presetId: PresetId }

/** `kv.gqa`'s architecture: Llama-3-8B's layers and head size, with a KV head for every query head. */
const MHA_8B = {
  layers: claimNumber('model.llama3-8b.layers'),
  kvHeads: claimNumber('model.llama3-8b.attn-heads'),
  headDim: claimNumber('model.llama3-8b.head-dim'),
}

/** The setups of the five outcome tasks (the single source for the sim's Run check, the task text and phone mode). */
export const SETUPS: Readonly<Record<string, KvSetup>> = {
  // Llama-3-70B at FP16 KV. Its shape sets the answer; nothing else does.
  'kv.bytes-per-token': { presetId: 'llama3-70b', kvDtype: 'fp16' },
  // Llama-3-70B with FP8 weights on one H100, one request at a time: whatever HBM the weights leave is all context.
  'kv.oom-context': {
    presetId: 'llama3-70b',
    weightDtype: 'fp8',
    kvDtype: 'fp16',
    gpuId: 'h100',
    gpuCount: 1,
    batch: 1,
    prefixShare: 0,
    paged: true,
  },
  // Llama-3-70B at FP8 on four H100s, 32k requests, FP8 KV.
  'kv.fp8-rescue': {
    presetId: 'llama3-70b',
    weightDtype: 'fp8',
    kvDtype: 'fp8',
    gpuId: 'h100',
    gpuCount: 4,
    ctx: 32768,
    prefixShare: 0,
    paged: true,
  },
  // What Llama-3-8B would cost with one KV head per query head, for one 128k request.
  'kv.gqa': { presetId: 'custom', ...MHA_8B, kvDtype: 'fp16', ctx: 131072 },
  // Llama-3-8B on two H100s at 32k.
  'kv.max-batch': {
    presetId: 'llama3-8b',
    weightDtype: 'fp16',
    kvDtype: 'fp16',
    gpuId: 'h100',
    gpuCount: 2,
    ctx: 32768,
    prefixShare: 0,
    paged: true,
  },
}

/** The full state a setup describes: free controls take the defaults, a preset fills in its shape. */
export function stateFromSetup(setup: KvSetup): KvState {
  const base: KvState = { ...DEFAULT_STATE, ...setup }
  const p = setup.presetId === 'custom' ? undefined : presetById(setup.presetId)
  return p === undefined ? base : { ...base, ...stateOfPreset(p.id), ...setup, presetId: p.id }
}

const CONTROL_LABEL: Readonly<Record<keyof KvState, string>> = {
  presetId: 'model',
  layers: 'layers',
  kvHeads: 'KV heads',
  headDim: 'head dim',
  kvDtype: 'KV precision',
  weightDtype: 'weight precision',
  ctx: 'context',
  batch: 'batch',
  gpuId: 'GPU',
  gpuCount: 'GPU count',
  prefixShare: 'prefix sharing',
  paged: 'PagedAttention',
}

function describeValue(key: keyof KvState, v: unknown): string {
  switch (key) {
    case 'presetId':
      return v === 'custom' ? 'custom' : (presetById(v as PresetId)?.name ?? String(v))
    case 'kvDtype':
    case 'weightDtype':
      return DTYPES.find((d) => d.id === v)?.label ?? String(v)
    case 'gpuId':
      return gpuById(String(v)).name
    case 'ctx':
      return fmtCtx(Number(v))
    case 'prefixShare':
      return `${v}%`
    case 'paged':
      return v === true ? 'on' : 'off'
    default:
      return String(v)
  }
}

/** The controls that differ from a setup, as "KV precision: FP8" (what the learner must change before Run reads that task). */
export function setupMismatches(state: KvState, setup: KvSetup): string[] {
  const out: string[] = []
  // A preset fixes the shape, so only a custom setup compares layers, KV heads and head dim.
  const shape = setup.presetId === 'custom'
  for (const key of Object.keys(setup) as (keyof KvState)[]) {
    if (!shape && (key === 'layers' || key === 'kvHeads' || key === 'headDim')) continue
    if (state[key] !== setup[key]) out.push(`${CONTROL_LABEL[key]}: ${describeValue(key, setup[key])}`)
  }
  return out
}

/** The key's value for a state, or null for an unknown key. */
export function readKey(key: string, state: KvState): { value: number; unit: string } | null {
  const reading = READINGS.find((r) => r.key === key)
  return reading === undefined ? null : { value: reading.read(kvModel(state)), unit: reading.unit }
}

/* ------------------------------------------------------------------ */
/* Config from a lesson block or a link                                */
/* ------------------------------------------------------------------ */

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const nearestIndex = (steps: readonly number[], v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? steps.reduce((best, step, i) => (Math.abs(step - v) < Math.abs(steps[best] - v) ? i : best), 0)
    : null
const inRange = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null

/**
 * A lesson block's `config` (or a `?cfg=` in lab mode) as a state. Anything that is not a known control value is
 * ignored, so a stale or hand-edited link still opens: ctx and batch snap to the nearest slider stop, and a preset
 * fills in its shape.
 */
export function normalizeConfig(cfg: unknown): KvState {
  if (!isRec(cfg)) return DEFAULT_STATE
  const out: KvState = { ...DEFAULT_STATE }
  const preset = typeof cfg.presetId === 'string' ? cfg.presetId : undefined
  if (preset === 'custom') {
    out.presetId = 'custom'
    out.layers = inRange(cfg.layers, 8, 128) ?? out.layers
    out.kvHeads = inRange(cfg.kvHeads, 1, 32) ?? out.kvHeads
    out.headDim = inRange(cfg.headDim, 64, 256) ?? out.headDim
  } else if (preset !== undefined && presetById(preset as PresetId) !== undefined) {
    Object.assign(out, stateOfPreset(preset as ModelPreset['id']))
  }
  const dtype = (v: unknown): Dtype | null => DTYPES.find((d) => d.id === v)?.id ?? null
  out.kvDtype = dtype(cfg.kvDtype) ?? out.kvDtype
  out.weightDtype = dtype(cfg.weightDtype) ?? out.weightDtype
  const ci = nearestIndex(CTX_STEPS, cfg.ctx)
  if (ci !== null) out.ctx = CTX_STEPS[ci]
  const bi = nearestIndex(BATCH_STEPS, cfg.batch)
  if (bi !== null) out.batch = BATCH_STEPS[bi]
  if (typeof cfg.gpuId === 'string' && GPUS.some((g) => g.id === cfg.gpuId)) out.gpuId = cfg.gpuId
  out.gpuCount = inRange(cfg.gpuCount, 1, 64) ?? out.gpuCount
  out.prefixShare = inRange(cfg.prefixShare, 0, 90) ?? out.prefixShare
  if (typeof cfg.paged === 'boolean') out.paged = cfg.paged
  return out
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function fmtGb(gb: number): string {
  return gb >= 100 ? gb.toFixed(1) : gb.toFixed(2)
}

/** A context in tokens, in the units lessons use: 32768 is "32k" and 1048576 is "1M" (powers of two), 200000 is "200k". */
export function fmtCtx(c: number): string {
  if (c >= 1048576 && c % 1048576 === 0) return `${c / 1048576}M`
  if (c >= 1024 && c % 1024 === 0) return `${c / 1024}k`
  return c >= 1000 ? `${(c / 1000).toFixed(c % 1000 === 0 ? 0 : 1)}k` : String(c)
}

/* ------------------------------------------------------------------ */
/* Phone mode: the canonical outcome per task                          */
/* ------------------------------------------------------------------ */

const fmtInt = (n: number): string => n.toLocaleString('en-US')
const sized = (s: KvSetup): KvState => stateFromSetup(s)

function bytesPerToken(): CanonicalOutcome {
  const setup = SETUPS['kv.bytes-per-token']
  const rows = PRESETS.map((p) => ({
    p,
    kib: kvModel({ ...DEFAULT_STATE, ...stateOfPreset(p.id), kvDtype: 'fp16' }).kvPerToken / 1024,
  }))
  const mark = rows.findIndex((r) => r.p.id === setup.presetId)
  const actual = rows[mark].kib
  return {
    actual,
    unit: 'KiB/token',
    summary: `${rows[mark].p.name} at FP16 stores ${fmtInt(actual)} KiB for every token of every sequence.`,
    chart: {
      kind: 'bars',
      xLabel: 'model (FP16 KV)',
      yLabel: 'KiB per token',
      points: rows.map((r) => ({ x: r.p.id, y: r.kib, label: r.p.name.replace('Llama-3-', '').replace('Mixtral-', 'Mix ') })),
      mark,
    },
    table: {
      caption: 'KV cache per token at FP16',
      columns: ['Model', 'Layers', 'KV heads', 'Head dim', 'KiB/token'],
      rows: rows.map((r) => [r.p.name, r.p.layers, r.p.kvHeads, r.p.headDim, r.kib]),
    },
  }
}

function oomContext(): CanonicalOutcome {
  const state = sized(SETUPS['kv.oom-context'])
  const r = kvModel(state)
  const ctxs = [4096, 8192, 16384, 32768, 65536, 131072]
  const rows = ctxs.map((ctx) => {
    const m = kvModel({ ...state, ctx })
    return { ctx, total: m.total, fits: !m.oom }
  })
  const mark = rows.reduce((best, row, i) => (row.fits ? i : best), -1)
  return {
    actual: r.maxCtx,
    unit: 'tokens',
    summary: `${presetById(state.presetId as Exclude<PresetId, 'custom'>)?.name} with FP8 weights leaves ${fmtGb(r.totalHbmGb - r.weights - r.overhead)} GB of ${r.totalHbmGb} GB for KV: one request can reach ${fmtInt(r.maxCtx)} tokens.`,
    chart: {
      kind: 'line',
      xLabel: 'context (tokens)',
      yLabel: `GB needed (of ${r.totalHbmGb})`,
      points: rows.map((row) => ({ x: row.ctx, y: row.total, label: fmtCtx(row.ctx) })),
      mark: mark < 0 ? undefined : mark,
      logX: true,
    },
    table: {
      caption: `Memory needed at one request, ${r.totalHbmGb} GB of HBM`,
      columns: ['Context', 'GB needed', 'Fits'],
      rows: rows.map((row) => [fmtCtx(row.ctx), round(row.total, 1), row.fits ? 'yes' : 'OOM']),
    },
  }
}

function fp8Rescue(): CanonicalOutcome {
  const state = sized(SETUPS['kv.fp8-rescue'])
  const rows = DTYPES.map((d) => ({ d, n: kvModel({ ...state, kvDtype: d.id }).maxBatch }))
  const mark = rows.findIndex((row) => row.d.id === state.kvDtype)
  const actual = rows[mark].n
  const r = kvModel(state)
  return {
    actual,
    unit: 'sequences',
    summary: `${state.gpuCount}× ${gpuById(state.gpuId).name} hold ${fmtGb(r.totalHbmGb)} GB; after the weights, ${actual} requests of ${fmtCtx(state.ctx)} tokens fit with FP8 KV.`,
    chart: {
      kind: 'bars',
      xLabel: 'KV precision',
      yLabel: `sequences at ${fmtCtx(state.ctx)}`,
      points: rows.map((row) => ({ x: row.d.id, y: row.n, label: row.d.label })),
      mark,
    },
    table: {
      caption: `Concurrent ${fmtCtx(state.ctx)}-token sequences, weights at ${DTYPES.find((d) => d.id === state.weightDtype)?.label}`,
      columns: ['KV precision', 'Bytes per element', 'Sequences'],
      rows: rows.map((row) => [row.d.label, row.d.bytes, row.n]),
    },
  }
}

function gqa(): CanonicalOutcome {
  const state = sized(SETUPS['kv.gqa'])
  const mhaHeads = state.kvHeads
  const heads = [mhaHeads, mhaHeads / 2, mhaHeads / 4, mhaHeads / 8, 1].filter((h, i, a) => Number.isInteger(h) && h >= 1 && a.indexOf(h) === i)
  const rows = heads.map((h) => ({ h, gb: kvModel({ ...state, kvHeads: h }).oneSequenceGb }))
  const mark = rows.findIndex((row) => row.h === mhaHeads)
  const actual = round(rows[mark].gb, 2)
  const gqaRow = rows.find((row) => row.h === claimNumber('model.llama3-8b.kv-heads'))
  return {
    actual,
    unit: 'GB',
    summary: `With ${mhaHeads} KV heads one ${fmtCtx(state.ctx)}-token request holds ${fmtGb(actual)} GB of KV${
      gqaRow === undefined ? '' : `; with the real ${gqaRow.h} it holds ${fmtGb(gqaRow.gb)} GB`
    }.`,
    chart: {
      kind: 'bars',
      xLabel: 'KV heads',
      yLabel: 'GB for one request',
      points: rows.map((row) => ({ x: row.h, y: row.gb, label: String(row.h) })),
      mark,
    },
    table: {
      caption: `KV for one ${fmtCtx(state.ctx)}-token request, ${state.layers} layers, head dim ${state.headDim}, FP16`,
      columns: ['KV heads', 'GB'],
      rows: rows.map((row) => [row.h, round(row.gb, 2)]),
    },
  }
}

function maxBatch(): CanonicalOutcome {
  const state = sized(SETUPS['kv.max-batch'])
  const ctxs = [4096, 8192, 16384, 32768, 65536, 131072]
  const rows = ctxs.map((ctx) => {
    const m = kvModel({ ...state, ctx })
    return { ctx, n: m.maxBatch, wall: m.limitingWall }
  })
  const mark = rows.findIndex((row) => row.ctx === state.ctx)
  const r = kvModel(state)
  return {
    actual: rows[mark].n,
    unit: 'sequences',
    summary: `${state.gpuCount}× ${gpuById(state.gpuId).name} fit ${rows[mark].n} requests of ${fmtCtx(state.ctx)} tokens; the ${r.limitingWall} wall arrives first.`,
    chart: {
      kind: 'bars',
      xLabel: 'context per request',
      yLabel: 'sequences that fit',
      points: rows.map((row) => ({ x: row.ctx, y: row.n, label: fmtCtx(row.ctx) })),
      mark,
    },
    table: {
      caption: `Concurrent sequences, ${presetById(state.presetId as Exclude<PresetId, 'custom'>)?.name} on ${state.gpuCount}× ${gpuById(state.gpuId).name}`,
      columns: ['Context', 'Sequences', 'Wall first'],
      rows: rows.map((row) => [fmtCtx(row.ctx), row.n, row.wall]),
    },
  }
}

/** `phone.canonical` is `kv.<name>`. */
export const PHONE_MODELS: Readonly<Record<string, () => CanonicalOutcome>> = {
  'bytes-per-token': bytesPerToken,
  'oom-context': oomContext,
  'fp8-rescue': fp8Rescue,
  gqa,
  'max-batch': maxBatch,
}
