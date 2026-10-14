/**
 * The Attention Zoo's second reader (docs/specs/wave-2.md §11.3): an independent reading of model configs.
 *
 * This file imports nothing from the app's own source tree and is handed only a list of (repo, revision sha)
 * pairs. For each pair it downloads config.json at that revision, records the file's sha256, and works out the
 * KV cache bytes per token and the bytes read per decode step at 1k, 32k, 128k and 1M tokens, with arithmetic
 * written out by hand for each model family (no shared model engine, so a mistake in one reading cannot be
 * copied into another). The app's own model is then compared with the committed fixture, exactly.
 *
 *   bun scripts/zoo/second-reader.ts owner/name@sha [owner/name@sha ...] [--out file]   read and print or write
 *   bun scripts/zoo/second-reader.ts --check [file]                                      re-read the fixture's own list
 *
 * Conventions every number follows (they are also written into the fixture, and kv-zoo.ts follows the same two):
 *   - every tensor is priced at the dtype the pinned config gives it. KV entries and indexer keys use the
 *     config's own dtype field (bfloat16 = 2); gpt-oss has none, so its attention (which its quantization config
 *     leaves out of mxfp4) is read as bf16. A recurrent state uses the dtype the config names for it:
 *     Qwen3.5's mamba_ssm_dtype is float32, so that state is 4 bytes per element.
 *   - a sparse-attention indexer's keys are stored: they sit in HBM beside the cache, so "stored" counts them
 *     (DSA one key per token, CSA one per compressed entry) and a step never reads more than is stored.
 *   - contexts are powers of two: 1024, 32768, 131072, 1048576.
 *   - "stored" is the cache a request holds at context t; "readMain" is what one decode step reads from the
 *     KV entries; "readIndexer" is what a sparse-attention indexer reads to pick its tokens. A step's whole
 *     read is readTotal = readMain + readIndexer.
 *   - only the layers counted by num_hidden_layers are read. Multi-token-prediction modules are left out.
 *   - conv states of linear layers and the compressor scratch buffers of DeepSeek-V4 are left out, as the
 *     spec's formulas leave them out.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

export const CONTEXTS: readonly number[] = [1024, 32768, 131072, 1048576]
export const FIXTURE_PATH = 'tests/fixtures/zoo/second-reader.json'

export type Source = { repo: string; revision: string }

/** One kind of layer in a model, with the arithmetic that sizes it at context t. */
type Group = {
  kind: string
  layers: number
  /** The growth of one layer's stored bytes per token once every window has filled. */
  slope: number
  /** One layer's stored bytes that do not depend on t once every window has filled. */
  constant: number
  formula: string
  stored: (t: number) => number
  readMain: (t: number) => number
  readIndexer: (t: number) => number
}

type Reading = {
  modelType: string
  bytesPerElement: number
  dtypeSource: string
  /** The counts and sizes the arithmetic used, copied from the config. */
  fields: Record<string, number | string>
  groups: Group[]
}

type Cfg = Record<string, unknown>

const ceilDiv = (a: number, b: number): number => Math.floor((a + b - 1) / b)

function num(c: Cfg, key: string): number {
  const v = c[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`config has no numeric field ${key}`)
  return v
}

function list(c: Cfg, key: string): unknown[] {
  const v = c[key]
  if (!Array.isArray(v)) throw new Error(`config has no list field ${key}`)
  return v
}

function obj(c: Cfg, key: string): Cfg {
  const v = c[key]
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`config has no object field ${key}`)
  return v as Cfg
}

const BYTES: Record<string, number> = { bfloat16: 2, float16: 2, float32: 4 }

function dtypeBytes(name: string, where: string): { bytes: number; source: string } {
  const bytes = BYTES[name]
  if (bytes === undefined) throw new Error(`unknown dtype ${name} in ${where}`)
  return { bytes, source: `${where} = ${name}` }
}

/** The dtype field the config carries, or null when it has none. */
function configDtype(c: Cfg): { bytes: number; source: string } | null {
  for (const key of ['torch_dtype', 'dtype']) {
    const v = c[key]
    if (typeof v === 'string') return dtypeBytes(v, key)
  }
  return null
}

function sameCount(layerTypes: unknown[], name: string): number {
  return layerTypes.filter((x) => x === name).length
}

// Llama-3 and every plain GQA/MHA model: 2 · kvHeads · headDim · b per layer per token, all of it read each step.
function readLlama(c: Cfg): Reading {
  const dt = configDtype(c)
  if (dt === null) throw new Error('llama config has no dtype field')
  const layers = num(c, 'num_hidden_layers')
  const kvHeads = num(c, 'num_key_value_heads')
  // This config has no head_dim field: the head width is hidden_size / num_attention_heads.
  const headDim = typeof c.head_dim === 'number' ? c.head_dim : num(c, 'hidden_size') / num(c, 'num_attention_heads')
  const entry = 2 * kvHeads * headDim * dt.bytes
  return {
    modelType: String(c.model_type),
    bytesPerElement: dt.bytes,
    dtypeSource: dt.source,
    fields: { num_hidden_layers: layers, num_key_value_heads: kvHeads, head_dim: headDim, entryBytesPerLayerToken: entry },
    groups: [
      {
        kind: 'full',
        layers,
        slope: entry,
        constant: 0,
        formula: '2 * kvHeads * headDim * b * t',
        stored: (t) => entry * t,
        readMain: (t) => entry * t,
        readIndexer: () => 0,
      },
    ],
  }
}

// DeepSeek-V3: every layer is MLA. One latent per token: (kv_lora_rank + qk_rope_head_dim) * b.
// DeepSeek-V3.2 is the same cache with a sparse indexer in front of it: the latents and the indexer's keys are
// all stored, the main attention reads the top-k latents and the indexer reads every key.
function readDeepseekMla(c: Cfg, sparse: boolean): Reading {
  const dt = configDtype(c)
  if (dt === null) throw new Error('deepseek config has no dtype field')
  const layers = num(c, 'num_hidden_layers')
  const latent = num(c, 'kv_lora_rank')
  const rope = num(c, 'qk_rope_head_dim')
  const entry = (latent + rope) * dt.bytes
  const fields: Reading['fields'] = {
    num_hidden_layers: layers,
    kv_lora_rank: latent,
    qk_rope_head_dim: rope,
    entryBytesPerLayerToken: entry,
  }
  if (!sparse) {
    return {
      modelType: String(c.model_type),
      bytesPerElement: dt.bytes,
      dtypeSource: dt.source,
      fields,
      groups: [
        {
          kind: 'mla',
          layers,
          slope: entry,
          constant: 0,
          formula: '(kv_lora_rank + qk_rope_head_dim) * b * t',
          stored: (t) => entry * t,
          readMain: (t) => entry * t,
          readIndexer: () => 0,
        },
      ],
    }
  }
  const topK = num(c, 'index_topk')
  const indexEntry = num(c, 'index_head_dim') * dt.bytes
  fields.index_topk = topK
  fields.index_head_dim = num(c, 'index_head_dim')
  fields.indexEntryBytesPerLayerToken = indexEntry
  return {
    modelType: String(c.model_type),
    bytesPerElement: dt.bytes,
    dtypeSource: dt.source,
    fields,
    groups: [
      {
        kind: 'dsa-mla',
        layers,
        slope: entry + indexEntry,
        constant: 0,
        formula: 'stored (kv_lora_rank + qk_rope_head_dim + index_head_dim) * b * t; read entry * min(t, index_topk) plus the indexer, index_head_dim * b * t',
        stored: (t) => (entry + indexEntry) * t,
        readMain: (t) => entry * Math.min(t, topK),
        readIndexer: (t) => indexEntry * t,
      },
    ],
  }
}

// gpt-oss: layer_types alternates sliding_attention and full_attention. The sliding layers keep the last
// sliding_window tokens (so they stop growing); the attention sinks are one learned logit per head, no config
// field and no stored tokens, so they add nothing.
function readGptOss(c: Cfg): Reading {
  const dt = configDtype(c) ?? { bytes: 2, source: 'no dtype field in the config; attention is outside mxfp4 (modules_to_not_convert), read as bfloat16' }
  const types = list(c, 'layer_types')
  const total = num(c, 'num_hidden_layers')
  const sliding = sameCount(types, 'sliding_attention')
  const full = sameCount(types, 'full_attention')
  if (sliding + full !== total || types.length !== total) throw new Error('gpt-oss layer_types does not cover num_hidden_layers')
  const kvHeads = num(c, 'num_key_value_heads')
  const headDim = num(c, 'head_dim')
  const window = num(c, 'sliding_window')
  const entry = 2 * kvHeads * headDim * dt.bytes
  return {
    modelType: String(c.model_type),
    bytesPerElement: dt.bytes,
    dtypeSource: dt.source,
    fields: {
      num_hidden_layers: total,
      sliding_layers: sliding,
      full_layers: full,
      num_key_value_heads: kvHeads,
      head_dim: headDim,
      sliding_window: window,
      sinkTokensStored: 0,
      entryBytesPerLayerToken: entry,
    },
    groups: [
      {
        kind: 'full',
        layers: full,
        slope: entry,
        constant: 0,
        formula: '2 * kvHeads * headDim * b * t',
        stored: (t) => entry * t,
        readMain: (t) => entry * t,
        readIndexer: () => 0,
      },
      {
        kind: 'swa',
        layers: sliding,
        slope: 0,
        constant: entry * window,
        formula: '2 * kvHeads * headDim * b * min(t, sliding_window)',
        stored: (t) => entry * Math.min(t, window),
        readMain: (t) => entry * Math.min(t, window),
        readIndexer: () => 0,
      },
    ],
  }
}

// Qwen3.5: text_config.layer_types mixes linear_attention (gated delta net) with full_attention, 3 : 1.
// A full layer stores K and V for its kv heads. A linear layer keeps one d_k x d_v matrix per value head,
// whatever t is, in the dtype the config names for the state (mamba_ssm_dtype).
function readQwen35(c: Cfg): Reading {
  const tc = obj(c, 'text_config')
  const dt = configDtype(tc)
  if (dt === null) throw new Error('qwen3.5 text_config has no dtype field')
  const state = typeof tc.mamba_ssm_dtype === 'string' ? dtypeBytes(tc.mamba_ssm_dtype, 'text_config.mamba_ssm_dtype') : dt
  const types = list(tc, 'layer_types')
  const total = num(tc, 'num_hidden_layers')
  const linear = sameCount(types, 'linear_attention')
  const full = sameCount(types, 'full_attention')
  if (linear + full !== total || types.length !== total) throw new Error('qwen3.5 layer_types does not cover num_hidden_layers')
  const kvHeads = num(tc, 'num_key_value_heads')
  const headDim = num(tc, 'head_dim')
  const entry = 2 * kvHeads * headDim * dt.bytes
  const vHeads = num(tc, 'linear_num_value_heads')
  const dk = num(tc, 'linear_key_head_dim')
  const dv = num(tc, 'linear_value_head_dim')
  const stateBytes = vHeads * dk * dv * state.bytes
  return {
    modelType: String(tc.model_type),
    bytesPerElement: dt.bytes,
    dtypeSource: `${dt.source}; linear state: ${state.source}`,
    fields: {
      num_hidden_layers: total,
      full_layers: full,
      linear_layers: linear,
      num_key_value_heads: kvHeads,
      head_dim: headDim,
      linear_num_value_heads: vHeads,
      linear_key_head_dim: dk,
      linear_value_head_dim: dv,
      stateBytesPerElement: state.bytes,
      entryBytesPerLayerToken: entry,
      stateBytesPerLinearLayer: stateBytes,
    },
    groups: [
      {
        kind: 'full',
        layers: full,
        slope: entry,
        constant: 0,
        formula: '2 * kvHeads * headDim * b * t',
        stored: (t) => entry * t,
        readMain: (t) => entry * t,
        readIndexer: () => 0,
      },
      {
        kind: 'linear',
        layers: linear,
        slope: 0,
        constant: stateBytes,
        formula: 'linear_num_value_heads * linear_key_head_dim * linear_value_head_dim * stateBytes (constant in t)',
        stored: () => stateBytes,
        readMain: () => stateBytes,
        readIndexer: () => 0,
      },
    ],
  }
}

// Kimi Linear: linear_attn_config lists the layers (numbered from 1) that are full attention, and those are MLA;
// the rest are KDA, a recurrent state of num_heads matrices of head_dim x head_dim.
function readKimiLinear(c: Cfg): Reading {
  const dt = configDtype(c)
  if (dt === null) throw new Error('kimi linear config has no dtype field')
  const total = num(c, 'num_hidden_layers')
  const lac = obj(c, 'linear_attn_config')
  const fullIdx = list(lac, 'full_attn_layers')
  const kdaIdx = list(lac, 'kda_layers')
  const seen = new Set<unknown>([...fullIdx, ...kdaIdx])
  if (fullIdx.length + kdaIdx.length !== total || seen.size !== total) throw new Error('kimi layer lists do not partition num_hidden_layers')
  const latent = num(c, 'kv_lora_rank')
  const rope = num(c, 'qk_rope_head_dim')
  const entry = (latent + rope) * dt.bytes
  const heads = num(lac, 'num_heads')
  const hd = num(lac, 'head_dim')
  const stateBytes = heads * hd * hd * dt.bytes
  return {
    modelType: String(c.model_type),
    bytesPerElement: dt.bytes,
    dtypeSource: dt.source,
    fields: {
      num_hidden_layers: total,
      mla_layers: fullIdx.length,
      kda_layers: kdaIdx.length,
      kv_lora_rank: latent,
      qk_rope_head_dim: rope,
      kda_num_heads: heads,
      kda_head_dim: hd,
      entryBytesPerLayerToken: entry,
      stateBytesPerKdaLayer: stateBytes,
    },
    groups: [
      {
        kind: 'mla',
        layers: fullIdx.length,
        slope: entry,
        constant: 0,
        formula: '(kv_lora_rank + qk_rope_head_dim) * b * t',
        stored: (t) => entry * t,
        readMain: (t) => entry * t,
        readIndexer: () => 0,
      },
      {
        kind: 'kda',
        layers: kdaIdx.length,
        slope: 0,
        constant: stateBytes,
        formula: 'num_heads * head_dim * head_dim * b (constant in t)',
        stored: () => stateBytes,
        readMain: () => stateBytes,
        readIndexer: () => 0,
      },
    ],
  }
}

// DeepSeek-V4: one key-value head of head_dim whose vector is both key and value, so an entry is
// head_dim * num_key_value_heads * b. compress_ratios gives each layer's m: 4 is CSA (compressed entries,
// the indexer picks index_topk of them), 128 is HCA (all compressed entries are read). Both also keep the last
// sliding_window uncompressed tokens. CSA also stores one indexer key (index_head_dim * b) per compressed entry. The list runs one past num_hidden_layers (the extra slot is the
// multi-token-prediction module), and that slot is not counted.
function readDeepseekV4(c: Cfg): Reading {
  const dt = configDtype(c)
  if (dt === null) throw new Error('deepseek v4 config has no dtype field')
  const total = num(c, 'num_hidden_layers')
  const ratios = list(c, 'compress_ratios').slice(0, total)
  if (ratios.length !== total) throw new Error('deepseek v4 compress_ratios is shorter than num_hidden_layers')
  const csa = ratios.filter((m) => m === 4).length
  const hca = ratios.filter((m) => m === 128).length
  if (csa + hca !== total) throw new Error(`deepseek v4 has a compress ratio the second reader cannot read: ${[...new Set(ratios)].join(', ')}`)
  const entry = num(c, 'head_dim') * num(c, 'num_key_value_heads') * dt.bytes
  const window = num(c, 'sliding_window')
  const topK = num(c, 'index_topk')
  const indexEntry = num(c, 'index_head_dim') * dt.bytes
  return {
    modelType: String(c.model_type),
    bytesPerElement: dt.bytes,
    dtypeSource: dt.source,
    fields: {
      num_hidden_layers: total,
      csa_layers: csa,
      hca_layers: hca,
      csa_ratio: 4,
      hca_ratio: 128,
      head_dim: num(c, 'head_dim'),
      num_key_value_heads: num(c, 'num_key_value_heads'),
      sliding_window: window,
      index_topk: topK,
      index_head_dim: num(c, 'index_head_dim'),
      entryBytesPerLayerToken: entry,
      indexEntryBytesPerLayerToken: indexEntry,
    },
    groups: [
      {
        kind: 'csa',
        layers: csa,
        slope: (entry + indexEntry) / 4,
        constant: entry * window,
        formula: '(entry + index_head_dim * b) * ceil(t / 4) + entry * sliding_window; read entry * min(ceil(t / 4), index_topk) + entry * sliding_window; indexer reads index_head_dim * b * ceil(t / 4)',
        stored: (t) => (entry + indexEntry) * ceilDiv(t, 4) + entry * window,
        readMain: (t) => entry * Math.min(ceilDiv(t, 4), topK) + entry * window,
        readIndexer: (t) => indexEntry * ceilDiv(t, 4),
      },
      {
        kind: 'hca',
        layers: hca,
        slope: entry / 128,
        constant: entry * window,
        formula: 'entry * ceil(t / 128) + entry * sliding_window; every stored entry is read',
        stored: (t) => entry * ceilDiv(t, 128) + entry * window,
        readMain: (t) => entry * ceilDiv(t, 128) + entry * window,
        readIndexer: () => 0,
      },
    ],
  }
}

/** The hand-written reading for a config, chosen by its model_type. An unknown type is a named error. */
export function readConfig(c: Cfg): Reading {
  const text = typeof c.text_config === 'object' && c.text_config !== null ? (c.text_config as Cfg) : c
  const type = String(text.model_type)
  switch (type) {
    case 'llama':
      return readLlama(c)
    case 'deepseek_v3':
      return readDeepseekMla(c, false)
    case 'deepseek_v32':
      return readDeepseekMla(c, true)
    case 'gpt_oss':
      return readGptOss(c)
    case 'qwen3_5_moe_text':
      return readQwen35(c)
    case 'kimi_linear':
      return readKimiLinear(c)
    case 'deepseek_v4':
      return readDeepseekV4(c)
    default:
      throw new Error(`this config has a model type the second reader cannot read yet: ${type}`)
  }
}

type AtContext = {
  stored: number
  readMain: number
  readIndexer: number
  readTotal: number
  byKind: Record<string, { layers: number; stored: number; readMain: number; readIndexer: number }>
}

function atContext(r: Reading, t: number): AtContext {
  const out: AtContext = { stored: 0, readMain: 0, readIndexer: 0, readTotal: 0, byKind: {} }
  for (const g of r.groups) {
    const stored = g.layers * g.stored(t)
    const readMain = g.layers * g.readMain(t)
    const readIndexer = g.layers * g.readIndexer(t)
    out.byKind[g.kind] = { layers: g.layers, stored, readMain, readIndexer }
    out.stored += stored
    out.readMain += readMain
    out.readIndexer += readIndexer
  }
  out.readTotal = out.readMain + out.readIndexer
  return out
}

export type ModelRecord = {
  repo: string
  revision: string
  configUrl: string
  configSha256: string
  modelType: string
  bytesPerElement: number
  dtypeSource: string
  fields: Record<string, number | string>
  kinds: { kind: string; layers: number; slopeBytesPerLayerToken: number; constantBytesPerLayer: number; formula: string }[]
  /** Stored bytes added by one more token once every window has filled, summed over layers. */
  bytesPerToken: number
  /** Stored bytes that do not depend on t once every window has filled, summed over layers. */
  constantBytes: number
  contexts: Record<string, AtContext>
}

export function deriveModel(source: Source, bytes: Uint8Array): ModelRecord {
  const sha = createHash('sha256').update(bytes).digest('hex')
  const cfg = JSON.parse(new TextDecoder().decode(bytes)) as Cfg
  const r = readConfig(cfg)
  const bytesPerToken = r.groups.reduce((s, g) => s + g.layers * g.slope, 0)
  const constantBytes = r.groups.reduce((s, g) => s + g.layers * g.constant, 0)
  const contexts: Record<string, AtContext> = {}
  for (const t of CONTEXTS) contexts[String(t)] = atContext(r, t)
  // The slope and constant are written out by hand above; the curve must agree with them where windows are full.
  const lo = contexts[String(CONTEXTS[CONTEXTS.length - 2])].stored
  const hi = contexts[String(CONTEXTS[CONTEXTS.length - 1])].stored
  const span = CONTEXTS[CONTEXTS.length - 1] - CONTEXTS[CONTEXTS.length - 2]
  if ((hi - lo) / span !== bytesPerToken) throw new Error(`${source.repo}: stored curve grows ${(hi - lo) / span} B/token, hand slope says ${bytesPerToken}`)
  if (hi - bytesPerToken * CONTEXTS[CONTEXTS.length - 1] !== constantBytes) throw new Error(`${source.repo}: stored curve constant disagrees with the hand constant`)
  return {
    repo: source.repo,
    revision: source.revision,
    configUrl: configUrl(source),
    configSha256: sha,
    modelType: r.modelType,
    bytesPerElement: r.bytesPerElement,
    dtypeSource: r.dtypeSource,
    fields: r.fields,
    kinds: r.groups.map((g) => ({
      kind: g.kind,
      layers: g.layers,
      slopeBytesPerLayerToken: g.slope,
      constantBytesPerLayer: g.constant,
      formula: g.formula,
    })),
    bytesPerToken,
    constantBytes,
    contexts,
  }
}

const SHA = /^[0-9a-f]{40}$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function parseSource(s: string): Source {
  const at = s.lastIndexOf('@')
  const repo = at < 0 ? s : s.slice(0, at)
  const revision = at < 0 ? '' : s.slice(at + 1)
  if (!REPO.test(repo)) throw new Error(`not an owner/name repo: ${s}`)
  if (!SHA.test(revision)) throw new Error(`${repo} needs a full 40-character revision sha, not "${revision}"`)
  return { repo, revision }
}

export function configUrl(s: Source): string {
  return `https://huggingface.co/${s.repo}/raw/${s.revision}/config.json`
}

async function download(s: Source): Promise<Uint8Array> {
  const res = await fetch(configUrl(s))
  if (!res.ok) throw new Error(`${configUrl(s)} answered ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

export const CONVENTIONS: string[] = [
  'every tensor is priced at the dtype the pinned config gives it: KV entries and indexer keys at the config dtype field in bytes (bfloat16 = 2; gpt-oss has no dtype field and its attention stays outside mxfp4, so it is read as bfloat16), a recurrent state at the dtype the config names for it',
  'indexer keys are stored: they are kept in HBM for the indexer, so stored counts one key per token for DSA and one per compressed entry for CSA, and readTotal never exceeds stored',
  'contexts are 1024, 32768, 131072 and 1048576 tokens',
  'stored is the cache one request holds at context t; readMain is what one decode step reads from the KV entries; readIndexer is what a sparse indexer reads to choose tokens; readTotal is readMain + readIndexer, a step\'s whole read',
  'only num_hidden_layers layers are counted; multi-token-prediction modules are left out',
  'conv states of linear layers and the DeepSeek-V4 compressor scratch buffers are left out, as the spec formulas leave them out',
  'a linear layer keeps its state at the dtype the config names for it (Qwen3.5 mamba_ssm_dtype float32 = 4 bytes); Kimi Linear names none, so its state follows the config dtype',
  'gpt-oss attention sinks are one learned logit per head with no config field, so they store no tokens',
]

export type Fixture = {
  spec: string
  generatedBy: string
  contexts: number[]
  conventions: string[]
  models: ModelRecord[]
}

export async function readSources(sources: Source[]): Promise<Fixture> {
  const models: ModelRecord[] = []
  for (const s of sources) models.push(deriveModel(s, await download(s)))
  return {
    spec: 'docs/specs/wave-2.md section 11.3',
    generatedBy: 'scripts/zoo/second-reader.ts',
    contexts: [...CONTEXTS],
    conventions: CONVENTIONS,
    models,
  }
}

const stringify = (f: Fixture): string => `${JSON.stringify(f, null, 2)}\n`

async function main(argv: string[]): Promise<number> {
  const check = argv.indexOf('--check')
  if (check >= 0) {
    const path = argv[check + 1] ?? FIXTURE_PATH
    const committed = JSON.parse(readFileSync(path, 'utf8')) as Fixture
    const fresh = await readSources(committed.models.map((m) => ({ repo: m.repo, revision: m.revision })))
    if (stringify(fresh) === stringify(committed)) {
      console.log(`second reader: ${path} matches a fresh reading of ${fresh.models.length} configs`)
      return 0
    }
    for (const m of fresh.models) {
      const old = committed.models.find((x) => x.repo === m.repo)
      if (JSON.stringify(old) !== JSON.stringify(m)) console.error(`second reader: ${m.repo} differs from ${path}`)
    }
    return 1
  }
  const out = argv.indexOf('--out')
  const outPath = out >= 0 ? argv[out + 1] : null
  const sources = argv.filter((a, i) => !a.startsWith('--') && (out < 0 || (i !== out + 1))).map(parseSource)
  if (sources.length === 0) throw new Error('hand it at least one owner/name@sha')
  const fixture = await readSources(sources)
  if (outPath) {
    writeFileSync(outPath, stringify(fixture))
    console.log(`second reader: wrote ${fixture.models.length} models to ${outPath}`)
  } else {
    process.stdout.write(stringify(fixture))
  }
  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`second reader: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    },
  )
}
