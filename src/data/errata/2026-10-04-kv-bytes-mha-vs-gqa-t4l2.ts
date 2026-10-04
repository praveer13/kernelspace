import type { Erratum } from './schema'

export default {
  id: '2026-10-04-kv-bytes-mha-vs-gqa-t4l2',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t4.l2'],
  title: 'A 70B model needs ~2.6 MB/token only without GQA; Llama-3-70B needs 320 KB',
  before: 'T4.L2 gave "~2.6 MB per token" for "a 70B-class model" and a quiz key that said a 4k-token KV cache adds ~10 GB, while T5.L4 and T6.L5 use 320 KB/token for Llama-3-70B.',
  after: '2.6 MB/token is a 70B with full multi-head attention (80 layers × 8192 × 2 × 2 B). Llama-3-70B uses GQA with 8 KV heads: 80 × 8 × 128 × 2 × 2 B = 327,680 B ≈ 320 KB. The lesson and quiz now name which.',
  why: 'Two lessons quoted two numbers for "a 70B" with no model named. GQA is an 8× cut, so the unlabelled figure overstated real KV cost for the most common 70B.',
  source: {
    url: 'https://huggingface.co/meta-llama/Meta-Llama-3-70B/blob/main/config.json',
    title: 'Llama-3-70B config.json (80 layers, hidden 8192, 64 heads, num_key_value_heads: 8)',
  },
} satisfies Erratum
