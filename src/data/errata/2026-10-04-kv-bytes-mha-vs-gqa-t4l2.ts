import type { Erratum } from './schema'

export default {
  id: '2026-10-04-kv-bytes-mha-vs-gqa-t4l2',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t4.l2'],
  title: 'A 70B model needs ~2.5 MiB/token only without GQA; Llama-3-70B needs 320 KiB',
  before: 'T4.L2 gave "~2.6 MB per token" for "a 70B-class model" and a quiz key that said a 4k-token KV cache adds ~10 GB, while T5.L4 and T6.L5 use 320 KB/token for Llama-3-70B.',
  after: '2.5 MiB/token (2,621,440 B) is a 70B with full multi-head attention (80 layers × 8192 × 2 × 2 B). Llama-3-70B uses GQA with 8 KV heads: 80 × 8 × 128 × 2 × 2 B = 327,680 B = 320 KiB. The lesson and quiz now name which.',
  why: 'Two lessons quoted two numbers for "a 70B" with no model named. GQA is an 8× cut, so the unlabelled figure overstated real KV cost for the most common 70B.',
  source: {
    url: 'https://huggingface.co/meta-llama/Meta-Llama-3-70B/blob/main/config.json',
    title: 'Llama-3-70B config.json (80 layers, hidden 8192, 64 heads, num_key_value_heads: 8)',
  },
  items: [
    {
      q: 'Llama-3-70B has 80 layers, 8 KV heads (GQA), head dimension 128 and FP16 KV. How much KV cache does one token take?',
      options: [
        'About 2.5 MiB',
        'About 160 KiB',
        'About 640 KiB',
        'About 320 KiB',
      ],
      correct: [3],
      why: [
        'That is full multi-head attention: 80 x 8192 x 2 x 2 B, i.e. 64 KV heads where Llama-3-70B has 8.',
        'That drops one of the two tensors. Both K and V are stored, so there is a factor of 2.',
        'That uses 4 bytes per element. FP16 is 2 bytes.',
        'Right: 80 layers x 8 KV heads x 128 x 2 (K and V) x 2 B = 327,680 B, about 320 KiB.',
      ],
    },
  ],
} satisfies Erratum
