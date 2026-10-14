import type { Claim } from './schema'

/**
 * The Attention Zoo's model configs (docs/specs/wave-2.md §11.2). Each preset's numbers are read from the model's
 * Hugging Face `config.json` at a pinned revision: `pin.ref` is the commit sha, `source.url` is that revision's
 * raw file, and `source.quote` is the JSON line (or the few adjacent lines, whitespace collapsed to one space)
 * the value comes from, so a reader can search the file for it. `scripts/verify-claims.ts` checks the pin and the
 * url offline, parses each quote against its value, and with `--online` re-reads every file and finds the quote
 * in it exactly once. Revisions were read on 2026-10-05; the second reader (2b-06) records their sha256.
 *
 * Presets and where they stand (§11.2, Q14):
 * - Llama-3-70B, DeepSeek-V3, gpt-oss-120b, Kimi Linear and DeepSeek-V3.2 are as listed.
 * - Qwen3.5 is the hybrid preset, not Qwen3-Next: its config is public (Qwen3.5-397B-A17B, nested under
 *   `text_config`). The 3:1 linear:full pattern is counted from its `layer_types` list.
 * - DeepSeek-V4 ships: the Pro config is public at a pinned revision, with `compress_ratios` per layer.
 * Bytes: every tensor is priced at the dtype its config gives (kv-zoo.ts header). KV entries and indexer keys are
 * BF16, the torch_dtype of every pinned config, so that size is not a claim; the one other dtype a config pins is
 * Qwen3.5's recurrent state (`state-dtype`, float32). Any sink-token count is a claim only where a config has one
 * (see `sink-kv-tokens`).
 */
const SHA = /^[0-9a-f]{40}$/

interface ConfigPin {
  repo: string
  ref: string
}

/** One config field: [id suffix, value, unit, label, row (the JSON key, `parent.key` when nested), quote, boundary]. */
type Field = readonly [string, number, string, string, string, string, string?]

/** The claims of one model's config.json, all sharing one pin and one source. */
function configClaims(pin: ConfigPin, title: string, fields: ReadonlyArray<Field>, slug: string): Claim[] {
  if (!SHA.test(pin.ref)) throw new Error(`${slug}: pin.ref must be a full commit sha, got ${pin.ref}`)
  return fields.map(([suffix, value, unit, label, row, quote, boundary]) => ({
    id: `zoo.${slug}.${suffix}`,
    kind: 'spec',
    value,
    unit,
    label,
    source: { url: `https://huggingface.co/${pin.repo}/raw/${pin.ref}/config.json`, title, quote, row },
    pin,
    verifiedAt: '2026-10-05',
    ttlDays: 365,
    ...(boundary ? { boundary } : {}),
  }))
}

/** Meta's file is gated (HTTP 401), so the quotes come from a verbatim mirror of config.json, as for the 8B and 70B claims in models.ts. */
const LLAMA3_70B_PIN: ConfigPin = { repo: 'NousResearch/Meta-Llama-3-70B', ref: 'fdbf133d993d2b8157e518bfc8bc4570b2d31c45' }
const DEEPSEEK_V3_PIN: ConfigPin = { repo: 'deepseek-ai/DeepSeek-V3', ref: 'e815299b0bcbac849fa540c768ef21845365c9eb' }
const DEEPSEEK_V32_PIN: ConfigPin = { repo: 'deepseek-ai/DeepSeek-V3.2', ref: 'a7e62ac04ecb2c0a54d736dc46601c5606cf10a6' }
const DEEPSEEK_V4_PIN: ConfigPin = { repo: 'deepseek-ai/DeepSeek-V4-Pro', ref: 'b5968e9190ef611bbf34a7229255be88a0e937c1' }
const GPT_OSS_PIN: ConfigPin = { repo: 'openai/gpt-oss-120b', ref: 'b5c939de8f754692c1647ca79fbf85e8c1e70f8a' }
const QWEN35_PIN: ConfigPin = { repo: 'Qwen/Qwen3.5-397B-A17B', ref: '8472618112abcbd45acbcdc58436aff4233c23f7' }
const KIMI_LINEAR_PIN: ConfigPin = { repo: 'moonshotai/Kimi-Linear-48B-A3B-Instruct', ref: 'e1df551a447157d4658b573f9a695d57658590e9' }

const MLA_NOTE =
  'MLA caches one latent per token per layer: kv_lora_rank + qk_rope_head_dim elements, shared by every attention head (the per-head num_key_value_heads in this file does not enter the cache size). The config counts the 61 transformer layers; the extra multi-token-prediction layer (num_nextn_predict_layers) is not one of them.'

const LLAMA3_70B: Claim[] = [
  ...configClaims(
    LLAMA3_70B_PIN,
    'Meta-Llama-3-70B config.json at a pinned revision (NousResearch mirror of the gated meta-llama file)',
    [
      ['layers', 80, 'layers', 'Llama-3-70B transformer layers', 'num_hidden_layers', '"num_hidden_layers": 80,'],
      ['kv-heads', 8, 'KV heads', 'Llama-3-70B key/value heads (GQA)', 'num_key_value_heads', '"num_key_value_heads": 8,'],
      ['attn-heads', 64, 'heads', 'Llama-3-70B attention (query) heads', 'num_attention_heads', '"num_attention_heads": 64,'],
      ['hidden-size', 8192, 'dims', 'Llama-3-70B hidden size', 'hidden_size', '"hidden_size": 8192,'],
    ],
    'llama3-70b',
  ),
  {
    id: 'zoo.llama3-70b.head-dim',
    kind: 'derived',
    value: 128,
    unit: 'dims',
    label: 'Llama-3-70B head dimension',
    derived: { from: ['zoo.llama3-70b.hidden-size', 'zoo.llama3-70b.attn-heads'], formula: 'hidden_size / num_attention_heads' },
    verifiedAt: '2026-10-05',
    ttlDays: 365,
    boundary: 'The config has no head_dim field; Llama attention splits the hidden size evenly across its heads.',
  },
  {
    id: 'zoo.llama3-70b.kv-bytes-per-token',
    kind: 'derived',
    value: 327680,
    unit: 'bytes/token',
    label: 'Llama-3-70B KV cache per token (BF16)',
    derived: {
      from: ['zoo.llama3-70b.layers', 'zoo.llama3-70b.kv-heads', 'zoo.llama3-70b.head-dim'],
      formula: '2 (K and V) * layers * kv_heads * head_dim * 2 bytes (BF16)',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 365,
    boundary: 'BF16 KV, no paging overhead: 320 KiB/token, the baseline the zoo and t5.l4 compare every other kind against.',
  },
]

const DEEPSEEK_V3: Claim[] = configClaims(
  DEEPSEEK_V3_PIN,
  'DeepSeek-V3 config.json at a pinned revision (DeepSeek, Hugging Face)',
  [
    ['layers', 61, 'layers', 'DeepSeek-V3 transformer layers', 'num_hidden_layers', '"num_hidden_layers": 61,', MLA_NOTE],
    ['kv-lora-rank', 512, 'dims', 'DeepSeek-V3 MLA latent width (d_c)', 'kv_lora_rank', '"kv_lora_rank": 512,'],
    ['rope-head-dim', 64, 'dims', 'DeepSeek-V3 MLA decoupled RoPE key width (d_rope)', 'qk_rope_head_dim', '"qk_rope_head_dim": 64,'],
  ],
  'deepseek-v3',
)

const DEEPSEEK_V32: Claim[] = configClaims(
  DEEPSEEK_V32_PIN,
  'DeepSeek-V3.2 config.json at a pinned revision (DeepSeek, Hugging Face)',
  [
    ['layers', 61, 'layers', 'DeepSeek-V3.2 transformer layers', 'num_hidden_layers', '"num_hidden_layers": 61,', MLA_NOTE],
    ['kv-lora-rank', 512, 'dims', 'DeepSeek-V3.2 MLA latent width (d_c)', 'kv_lora_rank', '"kv_lora_rank": 512,'],
    ['rope-head-dim', 64, 'dims', 'DeepSeek-V3.2 MLA decoupled RoPE key width (d_rope)', 'qk_rope_head_dim', '"qk_rope_head_dim": 64,'],
    [
      'index-topk',
      2048,
      'tokens',
      'DeepSeek-V3.2 DSA top-k: tokens each query reads',
      'index_topk',
      '"index_topk": 2048,',
      'The lightning indexer scores every cached token, then the main attention reads only this many of them. All latents stay stored, so capacity is unchanged and reads per step stop growing past top-k.',
    ],
    ['index-head-dim', 128, 'dims', 'DeepSeek-V3.2 DSA indexer key width', 'index_head_dim', '"index_head_dim": 128,'],
    ['index-n-heads', 64, 'heads', 'DeepSeek-V3.2 DSA indexer heads', 'index_n_heads', '"index_n_heads": 64,'],
  ],
  'deepseek-v3-2',
)

const GPT_OSS_LAYER_TYPES =
  '"layer_types": [ "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention", "sliding_attention", "full_attention" ],'

const GPT_OSS: Claim[] = [
  ...configClaims(
    GPT_OSS_PIN,
    'gpt-oss-120b config.json at a pinned revision (OpenAI, Hugging Face)',
    [
      ['layers', 36, 'layers', 'gpt-oss-120b transformer layers', 'num_hidden_layers', '"num_hidden_layers": 36,'],
      [
        'swa-layers',
        18,
        'layers',
        'gpt-oss-120b sliding-window layers',
        'layer_types (count of "sliding_attention")',
        GPT_OSS_LAYER_TYPES,
        'The list alternates, sliding first, so layers 0, 2, 4 ... slide and 1, 3, 5 ... attend to everything.',
      ],
      ['full-layers', 18, 'layers', 'gpt-oss-120b full-attention layers', 'layer_types (count of "full_attention")', GPT_OSS_LAYER_TYPES],
      ['window', 128, 'tokens', 'gpt-oss-120b sliding window W', 'sliding_window', '"sliding_window": 128,', 'A sliding layer keeps the last 128 tokens, so its KV stops growing at context 128 (plus sinks, which store nothing here).'],
      ['kv-heads', 8, 'KV heads', 'gpt-oss-120b key/value heads (GQA), both layer kinds', 'num_key_value_heads', '"num_key_value_heads": 8,'],
      ['head-dim', 64, 'dims', 'gpt-oss-120b head dimension', 'head_dim', '"head_dim": 64,'],
    ],
    'gpt-oss-120b',
  ),
  {
    id: 'zoo.gpt-oss-120b.sink-kv-tokens',
    kind: 'spec',
    value: 0,
    unit: 'tokens',
    label: 'gpt-oss-120b KV tokens stored for attention sinks',
    source: {
      url: 'https://arxiv.org/pdf/2508.10925',
      title: 'gpt-oss-120b and gpt-oss-20b Model Card (OpenAI, arXiv 2508.10925)',
      quote:
        'Each attention head has a learned bias in the denominator of the softmax, similar to off-by-one attention and attention sinks',
      row: 'section 2.2, Architecture',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 365,
    boundary:
      "config.json has no sink field. gpt-oss's sinks are one learned logit per head, added to the softmax denominator, not cached tokens, so a sliding layer stores min(t, W) tokens and nothing more. A StreamingLLM-style model that does keep sink tokens would set this from its own config.",
  },
]

const QWEN35_LAYER_TYPES =
  '"layer_types": [ "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention", "linear_attention", "linear_attention", "linear_attention", "full_attention" ],'

const QWEN35: Claim[] = configClaims(
  QWEN35_PIN,
  'Qwen3.5-397B-A17B config.json at a pinned revision (Qwen organisation, Hugging Face)',
  [
    ['layers', 60, 'layers', 'Qwen3.5-397B transformer layers', 'text_config.num_hidden_layers', '"num_hidden_layers": 60,', 'The text model is nested under text_config; the vision tower beside it is not part of the KV cache.'],
    [
      'linear-layers',
      45,
      'layers',
      'Qwen3.5-397B gated-DeltaNet (linear) layers',
      'text_config.layer_types (count of "linear_attention")',
      QWEN35_LAYER_TYPES,
      'Three linear layers then one full-attention layer, repeating (full_attention_interval is 4 in the same file): 45 linear to 15 full, the 3:1 hybrid.',
    ],
    ['full-layers', 15, 'layers', 'Qwen3.5-397B full-attention layers', 'text_config.layer_types (count of "full_attention")', QWEN35_LAYER_TYPES],
    ['kv-heads', 2, 'KV heads', 'Qwen3.5-397B key/value heads in a full-attention layer (GQA)', 'text_config.num_key_value_heads', '"num_key_value_heads": 2,'],
    ['head-dim', 256, 'dims', 'Qwen3.5-397B full-attention head dimension', 'text_config.head_dim', '"head_dim": 256,'],
    [
      'linear-value-heads',
      64,
      'heads',
      'Qwen3.5-397B linear-attention value heads',
      'text_config.linear_num_value_heads',
      '"linear_num_value_heads": 64,',
      'A gated-DeltaNet layer keeps one d_k x d_v state per value head: heads * d_k * d_v elements per layer, constant in context. The short convolution state (linear_conv_kernel_dim) is a few elements per channel and not counted.',
    ],
    ['linear-key-head-dim', 128, 'dims', 'Qwen3.5-397B linear-attention key head dimension (d_k)', 'text_config.linear_key_head_dim', '"linear_key_head_dim": 128,'],
    ['linear-value-head-dim', 128, 'dims', 'Qwen3.5-397B linear-attention value head dimension (d_v)', 'text_config.linear_value_head_dim', '"linear_value_head_dim": 128,'],
  ],
  'qwen3-5-397b',
)
// The one claim whose value is a dtype name, not a count: the config pins the recurrent state's dtype, and the zoo
// prices that state at it (4 bytes), not at the BF16 it uses for KV entries. Quoted as the file has it, so
// verify-claims checks the string and `--online` finds it once.
QWEN35.push({
  id: 'zoo.qwen3-5-397b.state-dtype',
  kind: 'spec',
  value: 'float32',
  label: 'Qwen3.5-397B gated-DeltaNet state dtype (mamba_ssm_dtype)',
  source: {
    url: `https://huggingface.co/${QWEN35_PIN.repo}/raw/${QWEN35_PIN.ref}/config.json`,
    title: 'Qwen3.5-397B-A17B config.json at a pinned revision (Qwen organisation, Hugging Face)',
    quote: '"mamba_ssm_dtype": "float32",',
    row: 'text_config.mamba_ssm_dtype',
  },
  pin: QWEN35_PIN,
  verifiedAt: '2026-10-13',
  ttlDays: 365,
  boundary:
    'Four bytes per element: each of the 45 linear layers holds 64 * 128 * 128 * 4 B = 4 MiB, twice the 2 MiB a BF16 state would take. The same file sets dtype bfloat16 for the model, which prices the full-attention KV entries.',
})

const KIMI_LINEAR: Claim[] = configClaims(
  KIMI_LINEAR_PIN,
  'Kimi-Linear-48B-A3B-Instruct config.json at a pinned revision (Moonshot AI, Hugging Face)',
  [
    ['layers', 27, 'layers', 'Kimi Linear transformer layers', 'num_hidden_layers', '"num_hidden_layers": 27,'],
    [
      'mla-layers',
      7,
      'layers',
      'Kimi Linear MLA (full-attention) layers',
      'linear_attn_config.full_attn_layers (length)',
      '"full_attn_layers": [ 4, 8, 12, 16, 20, 24, 27 ],',
      'Layer numbers are 1-based (27 is the last layer). Seven MLA layers beside 20 KDA layers is 2.9:1, close to but not exactly the 3:1 the dossier rounds to.',
    ],
    [
      'kda-layers',
      20,
      'layers',
      'Kimi Linear KDA (linear) layers',
      'linear_attn_config.kda_layers (length)',
      '"kda_layers": [ 1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19, 21, 22, 23, 25, 26 ],',
    ],
    [
      'kv-lora-rank',
      512,
      'dims',
      'Kimi Linear MLA latent width (d_c)',
      'kv_lora_rank',
      '"kv_lora_rank": 512,',
      'The MLA layers cache kv_lora_rank + qk_rope_head_dim elements per token (modeling_kimi.py at this revision projects to exactly that width); in the reference code the rope-width slice is carried unrotated (mla_use_nope), not dropped from the cache.',
    ],
    ['rope-head-dim', 64, 'dims', 'Kimi Linear MLA decoupled key width (d_rope)', 'qk_rope_head_dim', '"qk_rope_head_dim": 64,'],
    [
      'kda-heads',
      32,
      'heads',
      'Kimi Linear KDA heads',
      'linear_attn_config.num_heads',
      '"num_heads": 32,',
      'A KDA layer keeps one d_k x d_v state per head: heads * head_dim * head_dim elements, constant in context. The short convolution (short_conv_kernel_size) is not counted.',
    ],
    ['kda-head-dim', 128, 'dims', 'Kimi Linear KDA head dimension (d_k = d_v)', 'linear_attn_config.head_dim', '"head_dim": 128,', 'The top-level head_dim (72) belongs to the MLA layers; the KDA layers use this one.'],
  ],
  'kimi-linear',
)

const DEEPSEEK_V4_RATIOS =
  '"compress_ratios": [128, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 128, 4, 0]'

const DEEPSEEK_V4_NOTE =
  'compress_ratios has 62 entries: one per layer (the first two are 128, then 4 and 128 alternate) and a final 0 for the multi-token-prediction layer. The config does not name the kinds; the technical report (arXiv 2606.19348, section 2.3) does: ratio 4 is Compressed Sparse Attention (every 4 tokens become one entry, then the indexer selects top-k of them) and ratio 128 is Heavily Compressed Attention (every 128 become one, no selection). Both add a sliding window of uncompressed recent entries.'

const DEEPSEEK_V4: Claim[] = configClaims(
  DEEPSEEK_V4_PIN,
  'DeepSeek-V4-Pro config.json at a pinned revision (DeepSeek, Hugging Face)',
  [
    ['layers', 61, 'layers', 'DeepSeek-V4-Pro transformer layers', 'num_hidden_layers', '"num_hidden_layers": 61,'],
    ['csa-layers', 30, 'layers', 'DeepSeek-V4-Pro CSA layers (compress ratio 4)', 'compress_ratios (count of 4)', DEEPSEEK_V4_RATIOS, DEEPSEEK_V4_NOTE],
    ['hca-layers', 31, 'layers', 'DeepSeek-V4-Pro HCA layers (compress ratio 128)', 'compress_ratios (count of 128)', DEEPSEEK_V4_RATIOS],
    ['csa-ratio', 4, 'tokens/entry', 'DeepSeek-V4-Pro CSA compression ratio m', 'compress_ratios (member)', DEEPSEEK_V4_RATIOS],
    ['hca-ratio', 128, 'tokens/entry', "DeepSeek-V4-Pro HCA compression ratio m'", 'compress_ratios (member)', DEEPSEEK_V4_RATIOS],
    [
      'window',
      128,
      'tokens',
      'DeepSeek-V4-Pro sliding window of uncompressed entries',
      'sliding_window',
      '"sliding_window": 128,',
      'Every CSA and HCA layer also keeps this many recent uncompressed entries, so a layer stores ceil(t / m) + window entries.',
    ],
    [
      'kv-heads',
      1,
      'KV heads',
      'DeepSeek-V4-Pro key/value heads',
      'num_key_value_heads',
      '"num_key_value_heads": 1,',
      'One shared key-value entry per token (multi-query), head_dim wide.',
    ],
    ['head-dim', 512, 'dims', 'DeepSeek-V4-Pro KV entry width (head_dim)', 'head_dim', '"head_dim": 512,'],
    ['rope-head-dim', 64, 'dims', 'DeepSeek-V4-Pro rotary part of the KV entry', 'qk_rope_head_dim', '"qk_rope_head_dim": 64,', 'Part of head_dim, not an addition to it, per the technical report (partial rotary).'],
    ['index-topk', 1024, 'entries', 'DeepSeek-V4-Pro CSA top-k: compressed entries each query reads', 'index_topk', '"index_topk": 1024,'],
    ['index-head-dim', 128, 'dims', 'DeepSeek-V4-Pro CSA indexer key width', 'index_head_dim', '"index_head_dim": 128,'],
    ['index-n-heads', 64, 'heads', 'DeepSeek-V4-Pro CSA indexer heads', 'index_n_heads', '"index_n_heads": 64,'],
  ],
  'deepseek-v4-pro',
)

export const ZOO_CLAIMS: Claim[] = [...LLAMA3_70B, ...DEEPSEEK_V3, ...GPT_OSS, ...QWEN35, ...KIMI_LINEAR, ...DEEPSEEK_V32, ...DEEPSEEK_V4]
