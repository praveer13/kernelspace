import type { Claim } from './schema'

/** Meta's file is gated (HTTP 401), so the quotes come from a verbatim mirror of config.json. */
const LLAMA3_CONFIG = {
  url: 'https://huggingface.co/NousResearch/Meta-Llama-3-8B/raw/main/config.json',
  title: 'Meta-Llama-3-8B config.json (NousResearch mirror of the gated meta-llama file)',
}

export const MODEL_CLAIMS: Claim[] = [
  {
    id: 'model.llama3-8b.layers',
    kind: 'spec',
    value: 32,
    label: 'Llama-3-8B layers',
    source: { ...LLAMA3_CONFIG, quote: '"num_hidden_layers": 32', row: 'num_hidden_layers' },
    verifiedAt: '2026-10-04',
    ttlDays: 365,
  },
  {
    id: 'model.llama3-8b.kv-heads',
    kind: 'spec',
    value: 8,
    label: 'Llama-3-8B KV heads (GQA)',
    source: { ...LLAMA3_CONFIG, quote: '"num_key_value_heads": 8', row: 'num_key_value_heads' },
    verifiedAt: '2026-10-04',
    ttlDays: 365,
  },
  {
    id: 'model.llama3-8b.attn-heads',
    kind: 'spec',
    value: 32,
    label: 'Llama-3-8B attention (query) heads',
    source: { ...LLAMA3_CONFIG, quote: '"num_attention_heads": 32', row: 'num_attention_heads' },
    verifiedAt: '2026-10-04',
    ttlDays: 365,
  },
  {
    id: 'model.llama3-8b.hidden-size',
    kind: 'spec',
    value: 4096,
    label: 'Llama-3-8B hidden size',
    source: { ...LLAMA3_CONFIG, quote: '"hidden_size": 4096', row: 'hidden_size' },
    verifiedAt: '2026-10-04',
    ttlDays: 365,
  },
  {
    id: 'model.llama3-8b.ffn-size',
    kind: 'spec',
    value: 14336,
    label: 'Llama-3-8B FFN intermediate size',
    source: { ...LLAMA3_CONFIG, quote: '"intermediate_size": 14336', row: 'intermediate_size' },
    verifiedAt: '2026-10-04',
    ttlDays: 365,
  },
  {
    id: 'model.llama3-8b.vocab',
    kind: 'spec',
    value: 128256,
    label: 'Llama-3-8B vocabulary size',
    source: { ...LLAMA3_CONFIG, quote: '"vocab_size": 128256', row: 'vocab_size' },
    verifiedAt: '2026-10-04',
    ttlDays: 365,
    boundary: 'Embedding and output head are untied ("tie_word_embeddings": false).',
  },
  {
    id: 'model.llama3-8b.head-dim',
    kind: 'derived',
    value: 128,
    label: 'Llama-3-8B head dimension',
    verifiedAt: '2026-10-04',
    ttlDays: 365,
    derived: {
      from: ['model.llama3-8b.hidden-size', 'model.llama3-8b.attn-heads'],
      formula: 'hiddenSize / attnHeads',
    },
  },
  {
    id: 'model.llama3-8b.params',
    kind: 'derived',
    value: 8.03,
    unit: 'B params',
    label: 'Llama-3-8B parameters',
    verifiedAt: '2026-10-04',
    ttlDays: 365,
    derived: {
      from: [
        'model.llama3-8b.layers',
        'model.llama3-8b.kv-heads',
        'model.llama3-8b.hidden-size',
        'model.llama3-8b.ffn-size',
        'model.llama3-8b.vocab',
        'model.llama3-8b.head-dim',
      ],
      formula:
        '2 * vocab * hidden + layers * (2 * hidden * hidden + 2 * hidden * kvHeads * headDim + 3 * hidden * ffn + 2 * hidden) + hidden',
    },
    boundary: 'Counted from the config (untied embeddings, RMSNorm weights included); rounded to two decimals.',
  },
  {
    id: 'model.llama3-8b.kv-bytes-per-token',
    kind: 'derived',
    value: 131072,
    unit: 'bytes/token',
    label: 'Llama-3-8B KV cache per token',
    verifiedAt: '2026-10-04',
    ttlDays: 365,
    derived: {
      from: ['model.llama3-8b.layers', 'model.llama3-8b.kv-heads', 'model.llama3-8b.head-dim'],
      formula: '2 * layers * kvHeads * headDim * 2',
    },
    boundary: 'One sequence, 16-bit (BF16/FP16) K and V: 2 (K and V) x layers x KV heads x head dim x 2 bytes.',
  },
]
