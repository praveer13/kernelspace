import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l1-kv-512kb-needs-mha',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l1'],
  title: '512 KiB of KV per token is the no-GQA figure; Llama-3-8B needs 128 KiB',
  before:
    'The T5.L1 quiz asked for KV cache per token of "an 8B FP16 model (32 layers, d=4096)" and keyed about 512 KB, while T5.L4 gives 128 KB for Llama-3-8B.',
  after:
    '512 KiB is 2 x 32 layers x 4096 x 2 B with 32 KV heads (full multi-head attention). Llama-3-8B has 8 KV heads: 2 x 32 x 8 x 128 x 2 B = 131,072 B = 128 KiB. The question now states 32 KV heads.',
  why: 'Two lessons gave two numbers for one model name. GQA is a 4x cut here, so an unlabelled 512 KiB overstates the cache of the real model.',
  source: {
    url: 'https://huggingface.co/meta-llama/Meta-Llama-3-8B/blob/main/config.json',
    title: 'Llama-3-8B config.json (32 layers, hidden 4096, 32 attention heads, num_key_value_heads: 8)',
  },
  items: [
    {
      q: 'Llama-3-8B has 32 layers, 8 KV heads (GQA), head dimension 128 and an FP16 cache. How much KV cache does one token take?',
      options: [
        'About 512 KiB: 2 x 32 layers x 4096 x 2 B, as if all 32 heads kept their own K and V',
        'About 128 KiB: 2 x 32 layers x 8 KV heads x 128 x 2 B, because GQA shares K and V heads',
        'About 64 KiB: 2 x 32 layers x 8 KV heads x 128 x 1 B, because FP16 uses one byte per element',
        'About 256 KiB: 32 layers x 32 KV heads x 128 x 2 B, because V is rebuilt from K, not stored',
      ],
      correct: [1],
      why: [
        'That is full multi-head attention: 2 x 32 x 4096 x 2 B. Llama-3-8B has 8 KV heads, a quarter as many.',
        'Right: 2 (K and V) x 32 layers x 8 KV heads x 128 x 2 B = 131,072 B, about 128 KiB.',
        'That would be right for one-byte elements such as FP8. An FP16 cache uses two bytes per element, so this halves the true figure.',
        'V comes from its own projection and cannot be rebuilt from K, so both tensors are stored. It also counts 32 KV heads, which ignores GQA.',
      ],
    },
  ],
} satisfies Erratum
