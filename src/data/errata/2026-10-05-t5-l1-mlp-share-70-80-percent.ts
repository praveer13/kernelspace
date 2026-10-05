import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l1-mlp-share-70-80-percent',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l1'],
  title: 'The MLP holds about 70-80% of a layer, not 2/3 (72% with MHA, 81% for Llama-3-8B)',
  before:
    'T5.L1 said the MLP is "~2/3 of the layer\'s parameters and FLOPs" in the text, stat line, diagram and quiz key, and gave 67 MFLOPs for the output projection and 470 for the MLP.',
  after:
    'With SwiGLU at 3.5d the MLP holds 10.5 d^2 against 4 d^2 for MHA attention, about 72%. Llama-3-8B with GQA has about 176M of 218M layer parameters in the MLP, 81%. Output projection: 33.5 MFLOPs; MLP: 352.',
  why: 'Two thirds understates the MLP for the shapes the lesson itself uses, and the two MFLOP figures did not match d = 4096. The share matters when reasoning about where weight bytes and FLOPs go.',
  source: {
    url: 'https://huggingface.co/meta-llama/Meta-Llama-3-8B/blob/main/config.json',
    title: 'Llama-3-8B config.json (hidden 4096, intermediate 14336, 32 attention heads, num_key_value_heads: 8)',
  },
  items: [
    {
      q: 'In Llama-3-8B (hidden 4096, SwiGLU intermediate 14336, 8 KV heads), roughly what share of one layer\'s parameters sits in the MLP?',
      options: [
        'About 81%: 3 x 4096 x 14336 is about 176M of the roughly 218M parameters in a single layer',
        'About 67%: the MLP is two thirds of a layer, so attention holds the remaining third of it',
        'About 50%: the MLP and attention hold half each, since both have a similar number of matrices',
        'About 25%: attention has four projections and the MLP only a few, so most weights are in attention',
      ],
      correct: [0],
      why: [
        'Right: the three SwiGLU matrices are about 176M parameters; attention (Q, O and two narrower K, V projections) is about 42M, leaving the MLP near 81%.',
        'This is the retracted 2/3 figure. The three MLP matrices are each d x 3.5d, so the MLP is about three quarters or more of the layer.',
        'The matrix counts are close, but the sizes are not: each MLP matrix is 3.5 times wider than an attention projection, so the MLP holds far more.',
        'Attention has four projections, but each is only d x d, or narrower with GQA. The MLP matrices are 3.5d wide, so the MLP dominates.',
      ],
    },
  ],
} satisfies Erratum
