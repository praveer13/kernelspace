import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t6-l1-mla-kv-baseline',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t6.l1'],
  title: 'MLA caches a latent per layer: 70,272 B per token, 4.7× below Llama-3-70B, ≈37× below full MHA',
  before:
    'T6.L1 said MLA stores one ~576-element latent "per token", gave "~70 KB vs 320 KB" and "~7× smaller than full MHA" with no baseline, and the quiz keyed 4.6×.',
  after:
    'The latent is cached per layer: 576 × 2 B = 1,152 B × 61 layers = 70,272 B per token. That is 4.7× below Llama-3-70B\'s 327,680 B (GQA) and ≈37× below its 2,621,440 B with full MHA.',
  why: 'A ratio means nothing without its baseline, and GQA versus full MHA changes it eightfold. Rounded KB figures also gave 4.6×; the exact byte counts give 4.66, so 4.7×.',
  source: {
    url: 'https://arxiv.org/abs/2412.19437',
    title: 'DeepSeek-V3 Technical Report (61 layers, 512-dim KV compression, 64-dim decoupled RoPE key)',
  },
  items: [
    {
      q: 'DeepSeek-V3 caches a 576-element BF16 latent per layer across 61 layers. Llama-3-70B with GQA needs 327,680 B per token. How much smaller is the MLA cache?',
      options: [
        'About 37×, with MLA measured against full multi-head attention at 2621440 B per token',
        'About 4.7×, with MLA at 61 layers × 576 × 2 B or 70272 B against 327680 B per token',
        'About 284×, with MLA storing one 1152 B latent per token across the whole model',
        'About 4.9×, with MLA caching a latent in only the 58 MoE layers at 66816 B per token',
      ],
      correct: [1],
      why: [
        'That baseline is full MHA, which Llama-3-70B does not use. Against its real GQA cache of 327,680 B the ratio is about 4.7×; 37× needs the 2,621,440 B MHA figure.',
        'Right: 61 × 1,152 B = 70,272 B per token, and 327,680 / 70,272 is about 4.66. Against full MHA the ratio would be about 37×, so name the baseline.',
        'Attention runs in every layer, so each layer keeps its own latent. Across 61 layers that is 70,272 B per token, not 1,152 B, and the ratio is about 4.7×.',
        'The 3 dense layers still run attention, and attention is what MLA caches. All 61 layers store a latent, so the total is 70,272 B, not 66,816 B.',
      ],
    },
  ],
} satisfies Erratum
