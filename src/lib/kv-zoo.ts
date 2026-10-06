/**
 * The Attention Zoo's pure model (W6, docs/specs/wave-2.md §11.1–11.2, task 2b-05).
 *
 * A model is a layer pattern: how many layers of each kind, and each kind's parameters. For every kind the
 * model gives two numbers at context t, summed over layers: the bytes the cache **stores** (capacity) and the
 * bytes one decode step **reads** (bandwidth). `b` is bytes per element at the stored dtype; the configs do not
 * carry it (it is a serving choice), so it is a parameter, BF16 (2) by default.
 *
 *   kind     stored at context t                               read per decode step
 *   full     2·kvHeads·headDim·b·t                             = stored
 *   mla      (d_c + d_rope)·b·t                                = stored
 *   swa      2·kvHeads·headDim·b·min(t, W + sinks)             = stored
 *   dsa      (base + indexKey)·b·t                             (base·min(t, topK) + indexKey·t)·b
 *   csa      (entry·(⌈t/m⌉ + min(t, W)) + indexKey·⌈t/m⌉)·b    (entry·(min(⌈t/m⌉, topK) + min(t, W)) + indexKey·⌈t/m⌉)·b
 *   hca      entry·(⌈t/m′⌉ + min(t, W))·b                      = stored
 *   linear   heads·d_k·d_v·b, constant in t                    = stored
 *
 * These are the serving dossier's per-layer forms (serving-landscape.md:261–267), with one decision of this task
 * made explicit: a lightning indexer scores every cached unit at every step, so its keys are stored and read in
 * full. DSA's indexer keeps one index key per token; CSA's keeps one per compressed entry. The keys are counted
 * in both curves, which is why DSA's reads still grow with t, only with a much smaller slope than its capacity.
 * Nothing is counted at t = 0: no request, no cache.
 *
 * The framing for the UI is the evidence's: "KV is an append-only log with random reads; a recurrent state is a
 * checkpoint you can resume from, but not from the middle" (serving-landscape.md:94, 269).
 *
 * Presets are built only from the `zoo.*` claims (2a-05), read from each model's config.json at a pinned
 * revision (W13). Pasted configs go through `parseConfig`, the same reader the presets' quotes pass in the tests.
 *
 * Inside the determinism lint's numeric scope (wave-2.md §22.3): integer products and sums, no Math.pow, no log.
 * No React, no DOM, no clock.
 */

import { claimNumber } from '@/data/claims'

/* ------------------------------------------------------------------ */
/* Layer kinds                                                         */
/* ------------------------------------------------------------------ */

export type LayerKind = 'full' | 'mla' | 'swa' | 'dsa' | 'csa' | 'hca' | 'linear'

/** MHA or GQA: K and V, `kvHeads` of each, `headDim` wide, for every token. */
export interface FullLayer {
  kind: 'full'
  kvHeads: number
  headDim: number
}

/** Multi-head latent attention: one latent (d_c) plus a decoupled RoPE key (d_rope) per token, shared by every head. */
export interface MlaLayer {
  kind: 'mla'
  latentDim: number
  ropeDim: number
}

/** Sliding-window attention: K and V for the last `window` tokens, plus any sink tokens kept for good. */
export interface SwaLayer {
  kind: 'swa'
  kvHeads: number
  headDim: number
  window: number
  /** Tokens kept outside the window (StreamingLLM-style sinks). gpt-oss's sinks are softmax logits, not tokens: 0. */
  sinks: number
}

/** DeepSeek sparse attention: its base kind stores every token; the main attention reads only the indexer's top-k. */
export interface DsaLayer {
  kind: 'dsa'
  base: FullLayer | MlaLayer
  topK: number
  /** The indexer's key width: one key per cached token, read in full every step. */
  indexKeyDim: number
}

/** Compressed sparse attention: every `ratio` tokens become one entry, the indexer picks top-k entries, plus a window. */
export interface CsaLayer {
  kind: 'csa'
  /** Elements in one entry (V4 shares K and V in one entry: kvHeads · headDim). */
  entryDim: number
  ratio: number
  window: number
  topK: number
  /** The indexer's key width: one key per compressed entry. */
  indexKeyDim: number
}

/** Heavily compressed attention: every `ratio` tokens become one entry, all read, plus a window. */
export interface HcaLayer {
  kind: 'hca'
  entryDim: number
  ratio: number
  window: number
}

/** Linear attention (gated DeltaNet, KDA): one d_k × d_v state per head, whatever the context. */
export interface LinearLayer {
  kind: 'linear'
  heads: number
  keyDim: number
  valueDim: number
}

export type ZooLayer = FullLayer | MlaLayer | SwaLayer | DsaLayer | CsaLayer | HcaLayer | LinearLayer

/** `count` identical layers. */
export interface LayerGroup {
  count: number
  layer: ZooLayer
  /** e.g. "full (GQA)", "linear (KDA)". */
  label: string
}

export interface ZooModel {
  id: string
  name: string
  /** In the order the config's first layer of each kind appears (DeepSeek-V4's first two layers are HCA). */
  groups: readonly LayerGroup[]
  /** One line on why the model is in the zoo. */
  note: string
  /** The claims the numbers come from (presets only; a pasted config has none). */
  claimIds: readonly string[]
}

export interface ByteCount {
  stored: number
  read: number
}

/** Bytes per element: BF16. The configs do not carry the KV dtype; the zoo prices every kind at the same one. */
export const DEFAULT_ELEMENT_BYTES = 2

/** The four contexts every preset is pinned at: 1k, 32k, 128k and 1M tokens, powers of two as in KvCacheSim. */
export const ZOO_CONTEXTS: readonly number[] = [1024, 32768, 131072, 1048576]

const lesser = (a: number, b: number): number => (a < b ? a : b)

/** ⌈t / m⌉ by integer arithmetic, exact for any safe integer. */
const ceilDiv = (t: number, m: number): number => {
  const rest = t % m
  return (t - rest) / m + (rest > 0 ? 1 : 0)
}

/** Elements one token adds to a full or MLA cache, per layer. */
function perTokenElements(layer: FullLayer | MlaLayer): number {
  return layer.kind === 'full' ? 2 * layer.kvHeads * layer.headDim : layer.latentDim + layer.ropeDim
}

function checkContext(t: number): void {
  if (!Number.isSafeInteger(t) || t < 0) throw new RangeError(`context must be a whole number of tokens, got ${t}`)
}

/** Stored and read elements of one layer at context t (t a whole number of tokens). */
function layerElements(layer: ZooLayer, t: number): ByteCount {
  if (t === 0) return { stored: 0, read: 0 }
  switch (layer.kind) {
    case 'full':
    case 'mla': {
      const stored = perTokenElements(layer) * t
      return { stored, read: stored }
    }
    case 'swa': {
      const stored = 2 * layer.kvHeads * layer.headDim * lesser(t, layer.window + layer.sinks)
      return { stored, read: stored }
    }
    case 'dsa': {
      const base = perTokenElements(layer.base)
      return {
        stored: (base + layer.indexKeyDim) * t,
        read: base * lesser(t, layer.topK) + layer.indexKeyDim * t,
      }
    }
    case 'csa': {
      const entries = ceilDiv(t, layer.ratio)
      const window = lesser(t, layer.window)
      const index = layer.indexKeyDim * entries
      return {
        stored: layer.entryDim * (entries + window) + index,
        read: layer.entryDim * (lesser(entries, layer.topK) + window) + index,
      }
    }
    case 'hca': {
      const stored = layer.entryDim * (ceilDiv(t, layer.ratio) + lesser(t, layer.window))
      return { stored, read: stored }
    }
    case 'linear': {
      const stored = layer.heads * layer.keyDim * layer.valueDim
      return { stored, read: stored }
    }
  }
}

/** One layer's stored and read bytes at context t. */
export function layerBytes(layer: ZooLayer, t: number, b: number = DEFAULT_ELEMENT_BYTES): ByteCount {
  checkContext(t)
  const e = layerElements(layer, t)
  return { stored: e.stored * b, read: e.read * b }
}

export interface ZooBytes extends ByteCount {
  /** Per group, in `model.groups` order: what all `count` layers of that group store and read. */
  groups: ByteCount[]
}

/** A model's stored and read bytes at context t, summed over its layers, with each group's share. */
export function zooBytes(model: ZooModel, t: number, b: number = DEFAULT_ELEMENT_BYTES): ZooBytes {
  checkContext(t)
  let stored = 0
  let read = 0
  const groups = model.groups.map(({ count, layer }) => {
    const e = layerElements(layer, t)
    const g = { stored: count * e.stored * b, read: count * e.read * b }
    stored += g.stored
    read += g.read
    return g
  })
  return { stored, read, groups }
}

export interface ZooCurves {
  contexts: number[]
  /** Capacity: bytes stored at each context. */
  stored: number[]
  /** Bandwidth: bytes read by one decode step at each context. */
  read: number[]
}

/** Both curves over the given contexts, for the chart and its table mirror. */
export function zooCurves(model: ZooModel, contexts: readonly number[], b: number = DEFAULT_ELEMENT_BYTES): ZooCurves {
  const points = contexts.map((t) => zooBytes(model, t, b))
  return { contexts: [...contexts], stored: points.map((p) => p.stored), read: points.map((p) => p.read) }
}

/** Total layers in a model. */
export const layerCount = (model: ZooModel): number => model.groups.reduce((n, g) => n + g.count, 0)

/* ------------------------------------------------------------------ */
/* Presets, from the zoo.* claims only                                  */
/* ------------------------------------------------------------------ */

/** Reads `zoo.<slug>.<suffix>` and records the id, so each preset lists exactly the claims it was built from. */
function reader(slug: string): { n: (suffix: string) => number; ids: string[] } {
  const ids: string[] = []
  return {
    ids,
    n: (suffix) => {
      const id = `zoo.${slug}.${suffix}`
      ids.push(id)
      return claimNumber(id)
    },
  }
}

function llama3_70b(): ZooModel {
  const { n, ids } = reader('llama3-70b')
  const layer: FullLayer = { kind: 'full', kvHeads: n('kv-heads'), headDim: n('head-dim') }
  return {
    id: 'llama3-70b',
    name: 'Llama-3-70B',
    groups: [{ count: n('layers'), layer, label: 'full (GQA)' }],
    note: 'The baseline: every layer keeps K and V for every token.',
    claimIds: ids,
  }
}

function deepseekV3(): ZooModel {
  const { n, ids } = reader('deepseek-v3')
  const layer: MlaLayer = { kind: 'mla', latentDim: n('kv-lora-rank'), ropeDim: n('rope-head-dim') }
  return {
    id: 'deepseek-v3',
    name: 'DeepSeek-V3',
    groups: [{ count: n('layers'), layer, label: 'MLA' }],
    note: 'Latent KV: one compressed vector per token, shared by every head.',
    claimIds: ids,
  }
}

function gptOss120b(): ZooModel {
  const { n, ids } = reader('gpt-oss-120b')
  const kvHeads = n('kv-heads')
  const headDim = n('head-dim')
  const swa: SwaLayer = { kind: 'swa', kvHeads, headDim, window: n('window'), sinks: n('sink-kv-tokens') }
  return {
    id: 'gpt-oss-120b',
    name: 'gpt-oss-120b',
    groups: [
      { count: n('swa-layers'), layer: swa, label: 'sliding window' },
      { count: n('full-layers'), layer: { kind: 'full', kvHeads, headDim }, label: 'full (GQA)' },
    ],
    note: 'Sliding-window layers alternate with full ones; the window layers stop growing at 128 tokens.',
    claimIds: ids,
  }
}

function qwen35(): ZooModel {
  const { n, ids } = reader('qwen3-5-397b')
  const linear: LinearLayer = {
    kind: 'linear',
    heads: n('linear-value-heads'),
    keyDim: n('linear-key-head-dim'),
    valueDim: n('linear-value-head-dim'),
  }
  return {
    id: 'qwen3-5-397b',
    name: 'Qwen3.5-397B',
    groups: [
      { count: n('linear-layers'), layer: linear, label: 'linear (GDN)' },
      { count: n('full-layers'), layer: { kind: 'full', kvHeads: n('kv-heads'), headDim: n('head-dim') }, label: 'full (GQA)' },
    ],
    note: 'A hybrid: three gated-DeltaNet layers with a constant state to every full-attention layer.',
    claimIds: ids,
  }
}

function kimiLinear(): ZooModel {
  const { n, ids } = reader('kimi-linear')
  const headDim = n('kda-head-dim')
  return {
    id: 'kimi-linear',
    name: 'Kimi Linear',
    groups: [
      { count: n('kda-layers'), layer: { kind: 'linear', heads: n('kda-heads'), keyDim: headDim, valueDim: headDim }, label: 'linear (KDA)' },
      { count: n('mla-layers'), layer: { kind: 'mla', latentDim: n('kv-lora-rank'), ropeDim: n('rope-head-dim') }, label: 'MLA' },
    ],
    note: 'A hybrid with latent attention: KDA layers hold a constant state, the MLA layers hold the log.',
    claimIds: ids,
  }
}

function deepseekV32(): ZooModel {
  const { n, ids } = reader('deepseek-v3-2')
  const layer: DsaLayer = {
    kind: 'dsa',
    base: { kind: 'mla', latentDim: n('kv-lora-rank'), ropeDim: n('rope-head-dim') },
    topK: n('index-topk'),
    indexKeyDim: n('index-head-dim'),
  }
  return {
    id: 'deepseek-v3-2',
    name: 'DeepSeek-V3.2',
    groups: [{ count: n('layers'), layer, label: 'DSA on MLA' }],
    note: 'Sparse attention: every latent is stored, but a step reads only the top-k the indexer picks.',
    claimIds: ids,
  }
}

function deepseekV4Pro(): ZooModel {
  const { n, ids } = reader('deepseek-v4-pro')
  const entryDim = n('kv-heads') * n('head-dim')
  const window = n('window')
  const csa: CsaLayer = { kind: 'csa', entryDim, ratio: n('csa-ratio'), window, topK: n('index-topk'), indexKeyDim: n('index-head-dim') }
  const hca: HcaLayer = { kind: 'hca', entryDim, ratio: n('hca-ratio'), window }
  return {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek-V4-Pro',
    groups: [
      { count: n('hca-layers'), layer: hca, label: 'HCA' },
      { count: n('csa-layers'), layer: csa, label: 'CSA' },
    ],
    note: 'Compressed attention: every 4 or every 128 tokens become one entry, plus a window of recent ones.',
    claimIds: ids,
  }
}

/** The zoo's presets (wave-2.md §11.2), in the order the picker shows them. */
export const ZOO_PRESETS: readonly ZooModel[] = [
  llama3_70b(),
  deepseekV3(),
  gptOss120b(),
  qwen35(),
  kimiLinear(),
  deepseekV32(),
  deepseekV4Pro(),
]

export const zooPresetById = (id: string): ZooModel | undefined => ZOO_PRESETS.find((p) => p.id === id)

/* ------------------------------------------------------------------ */
/* config.json reader                                                  */
/* ------------------------------------------------------------------ */

export type ZooConfigErrorKind = 'not-json' | 'not-object' | 'missing-field' | 'bad-field' | 'layer-count' | 'unknown-layer-type'

export interface ZooConfigError {
  kind: ZooConfigErrorKind
  /** The field (dotted when nested) or layer type the error is about. */
  field?: string
  message: string
}

export type ZooParse = { ok: true; model: ZooModel } | { ok: false; error: ZooConfigError }

class ConfigProblem extends Error {
  readonly problem: ZooConfigError
  constructor(problem: ZooConfigError) {
    super(problem.message)
    this.problem = problem
  }
}

const fail = (kind: ZooConfigErrorKind, field: string, message: string): never => {
  throw new ConfigProblem({ kind, field, message })
}

const unknownType = (type: string): never =>
  fail('unknown-layer-type', type, `this config has a layer type the zoo cannot read yet: ${type}`)

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A config object with the dotted path its fields are reported under. */
interface Scope {
  obj: Json
  at: string
}

const fieldName = (s: Scope, key: string): string => (s.at ? `${s.at}.${key}` : key)

/** A positive whole number. */
function int(s: Scope, key: string): number {
  const v = s.obj[key]
  const name = fieldName(s, key)
  if (v === undefined || v === null) return fail('missing-field', name, `this config has no ${name}, which the zoo needs`)
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) return fail('bad-field', name, `${name} must be a positive whole number, got ${JSON.stringify(v)}`)
  return v
}

const has = (s: Scope, key: string): boolean => s.obj[key] !== undefined && s.obj[key] !== null

function list(s: Scope, key: string): unknown[] {
  const v = s.obj[key]
  if (!Array.isArray(v)) return fail('bad-field', fieldName(s, key), `${fieldName(s, key)} must be a list`)
  return v
}

/** MHA/GQA from the usual fields: head_dim, or hidden_size split evenly over the attention heads (Llama). */
function fullLayer(s: Scope): FullLayer {
  const kvHeads = has(s, 'num_key_value_heads') ? int(s, 'num_key_value_heads') : int(s, 'num_attention_heads')
  if (has(s, 'head_dim')) return { kind: 'full', kvHeads, headDim: int(s, 'head_dim') }
  const hidden = int(s, 'hidden_size')
  const heads = int(s, 'num_attention_heads')
  if (hidden % heads !== 0) fail('bad-field', fieldName(s, 'hidden_size'), `hidden_size ${hidden} does not split evenly over ${heads} heads; add head_dim`)
  return { kind: 'full', kvHeads, headDim: (hidden - (hidden % heads)) / heads }
}

const mlaLayer = (s: Scope): MlaLayer => ({ kind: 'mla', latentDim: int(s, 'kv_lora_rank'), ropeDim: int(s, 'qk_rope_head_dim') })

/** Full attention as this config builds it: latent when it has kv_lora_rank, MHA/GQA otherwise. */
const attentionLayer = (s: Scope): FullLayer | MlaLayer => (has(s, 'kv_lora_rank') ? mlaLayer(s) : fullLayer(s))

const labelOf = (layer: ZooLayer): string => {
  switch (layer.kind) {
    case 'full':
      return 'full (GQA)'
    case 'mla':
      return 'MLA'
    case 'swa':
      return 'sliding window'
    case 'dsa':
      return layer.base.kind === 'mla' ? 'DSA on MLA' : 'DSA'
    case 'csa':
      return 'CSA'
    case 'hca':
      return 'HCA'
    case 'linear':
      return 'linear'
  }
}

const sameLayer = (a: ZooLayer, b: ZooLayer): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Collapses a per-layer list into groups of identical layers, in first-seen order. */
function group(layers: readonly ZooLayer[]): LayerGroup[] {
  const groups: LayerGroup[] = []
  for (const layer of layers) {
    const g = groups.find((x) => sameLayer(x.layer, layer))
    if (g) g.count += 1
    else groups.push({ count: 1, layer, label: labelOf(layer) })
  }
  return groups
}

/** DeepSeek-V4 style: one compress ratio per layer. The smaller nonzero ratio is CSA (indexed), the larger HCA. */
function compressedLayers(s: Scope, layers: number): ZooLayer[] {
  const ratios = list(s, 'compress_ratios')
  if (ratios.length < layers) {
    fail('layer-count', fieldName(s, 'compress_ratios'), `compress_ratios has ${ratios.length} entries for ${layers} layers`)
  }
  // Entries past num_hidden_layers belong to multi-token-prediction layers, which serving does not cache.
  const own = ratios.slice(0, layers)
  for (const r of own) {
    if (typeof r !== 'number' || !Number.isSafeInteger(r) || r <= 0) unknownType(`compress ratio ${JSON.stringify(r)}`)
  }
  const distinct = [...new Set(own as number[])].sort((a, b) => a - b)
  if (distinct.length > 2) unknownType(`a third compress ratio (${distinct.join(', ')})`)
  const entryDim = int(s, 'num_key_value_heads') * int(s, 'head_dim')
  const window = int(s, 'sliding_window')
  // One ratio is CSA only when an indexer selects among its entries; otherwise every layer reads all of them.
  const csaRatio = distinct.length === 2 || has(s, 'index_topk') ? distinct[0] : 0
  const csa = (ratio: number): CsaLayer => ({ kind: 'csa', entryDim, ratio, window, topK: int(s, 'index_topk'), indexKeyDim: int(s, 'index_head_dim') })
  const hca = (ratio: number): HcaLayer => ({ kind: 'hca', entryDim, ratio, window })
  return (own as number[]).map((r) => (r === csaRatio ? csa(r) : hca(r)))
}

/** Kimi Linear style: linear_attn_config lists which (1-based) layers are KDA and which are full attention. */
function kimiLayers(s: Scope, layers: number): ZooLayer[] {
  const cfg = s.obj.linear_attn_config
  if (!isObject(cfg)) return fail('bad-field', fieldName(s, 'linear_attn_config'), 'linear_attn_config must be an object')
  const ls: Scope = { obj: cfg, at: fieldName(s, 'linear_attn_config') }
  const kda = list(ls, 'kda_layers')
  const full = list(ls, 'full_attn_layers')
  if (kda.length + full.length !== layers) {
    fail('layer-count', fieldName(ls, 'kda_layers'), `kda_layers and full_attn_layers list ${kda.length + full.length} layers, the config has ${layers}`)
  }
  const head = int(ls, 'head_dim')
  const linear: LinearLayer = { kind: 'linear', heads: int(ls, 'num_heads'), keyDim: head, valueDim: head }
  const attention = attentionLayer(s)
  return [...kda.map(() => linear), ...full.map(() => attention)]
}

/** Hugging Face `layer_types`: one name per layer. */
function typedLayers(s: Scope, layers: number): ZooLayer[] {
  const types = list(s, 'layer_types')
  if (types.length !== layers) fail('layer-count', fieldName(s, 'layer_types'), `layer_types lists ${types.length} layers, the config has ${layers}`)
  const memo = new Map<string, ZooLayer>()
  const build = (type: string): ZooLayer => {
    switch (type) {
      case 'full_attention':
        return attentionLayer(s)
      case 'sliding_attention': {
        const full = fullLayer(s)
        return { kind: 'swa', kvHeads: full.kvHeads, headDim: full.headDim, window: int(s, 'sliding_window'), sinks: 0 }
      }
      case 'linear_attention':
        return {
          kind: 'linear',
          heads: int(s, 'linear_num_value_heads'),
          keyDim: int(s, 'linear_key_head_dim'),
          valueDim: int(s, 'linear_value_head_dim'),
        }
      default:
        return unknownType(type)
    }
  }
  return types.map((t) => {
    const type = typeof t === 'string' ? t : JSON.stringify(t)
    let layer = memo.get(type)
    if (!layer) {
      layer = build(type)
      memo.set(type, layer)
    }
    return layer
  })
}

/** Families whose layers the zoo has no formula for (state-space and RWKV-style blocks). */
const UNREAD_MODEL_TYPES = /mamba|rwkv|jamba|zamba|falcon_h|nemotron_h|hybrid/

/**
 * Fields that mark layers of another kind without a `layer_types` list: state-space patterns, MiniMax's
 * attention-type list, Gemma's interleaved window and Llama 4's chunked attention. Reading such a config as
 * uniform would misprice it, so each is a named error.
 */
const UNREAD_FIELDS = ['hybrid_override_pattern', 'layers_block_type', 'attn_type_list', 'sliding_window_pattern', 'attention_chunk_size']

/** Every layer the same kind: MHA/GQA, sliding window (Mistral-style), MLA, or DSA on either. */
function uniformLayers(s: Scope, layers: number): ZooLayer[] {
  const modelType = typeof s.obj.model_type === 'string' ? s.obj.model_type : ''
  if (UNREAD_MODEL_TYPES.test(modelType)) unknownType(modelType)
  for (const key of UNREAD_FIELDS) {
    if (has(s, key)) unknownType(`${key} (${JSON.stringify(s.obj[key]).slice(0, 60)})`)
  }
  if (s.obj.cache_implementation === 'hybrid') unknownType('a hybrid cache (sliding and full layers interleaved, with no layer_types list)')
  let layer: ZooLayer
  if (has(s, 'index_topk')) {
    layer = { kind: 'dsa', base: attentionLayer(s), topK: int(s, 'index_topk'), indexKeyDim: int(s, 'index_head_dim') }
  } else if (has(s, 'kv_lora_rank')) {
    layer = mlaLayer(s)
  } else if (has(s, 'sliding_window') && s.obj.use_sliding_window !== false) {
    const full = fullLayer(s)
    layer = { kind: 'swa', kvHeads: full.kvHeads, headDim: full.headDim, window: int(s, 'sliding_window'), sinks: 0 }
  } else {
    layer = fullLayer(s)
  }
  return Array.from({ length: layers }, () => layer)
}

/**
 * Reads a pasted (or downloaded) config.json into a zoo model. The fields it reads are the ones the presets'
 * claims quote: num_hidden_layers; num_key_value_heads, num_attention_heads, head_dim or hidden_size;
 * kv_lora_rank and qk_rope_head_dim (MLA); index_topk and index_head_dim (DSA, CSA); sliding_window;
 * layer_types with linear_num_value_heads, linear_key_head_dim and linear_value_head_dim; linear_attn_config
 * (Kimi); compress_ratios (DeepSeek-V4). A multimodal config is read from its text_config. Sinks are 0: no
 * config field stores sink tokens (see the `zoo.gpt-oss-120b.sink-kv-tokens` claim). Anything the zoo has no
 * formula for is a named error, never a guess.
 */
export function parseConfig(input: string | unknown, name = 'Pasted config'): ZooParse {
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch {
      return { ok: false, error: { kind: 'not-json', message: 'this is not JSON: paste the whole config.json' } }
    }
  }
  if (!isObject(raw)) return { ok: false, error: { kind: 'not-object', message: 'a config.json is one JSON object' } }
  const s: Scope = isObject(raw.text_config) ? { obj: raw.text_config, at: 'text_config' } : { obj: raw, at: '' }
  try {
    const layers = int(s, 'num_hidden_layers')
    const perLayer = has(s, 'compress_ratios')
      ? compressedLayers(s, layers)
      : has(s, 'linear_attn_config')
        ? kimiLayers(s, layers)
        : has(s, 'layer_types')
          ? typedLayers(s, layers)
          : uniformLayers(s, layers)
    return { ok: true, model: { id: 'custom', name, groups: group(perLayer), note: 'Read from a pasted config.json.', claimIds: [] } }
  } catch (e) {
    if (e instanceof ConfigProblem) return { ok: false, error: e.problem }
    throw e
  }
}
