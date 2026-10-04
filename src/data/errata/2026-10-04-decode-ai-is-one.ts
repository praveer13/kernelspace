import type { Erratum } from './schema'

export default {
  id: '2026-10-04-decode-ai-is-one',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t4.l3'],
  title: 'Batch-1 decode arithmetic intensity is about 1 FLOP/byte, not 2',
  before: 'The T4.L3 statline said decode at batch 1 has "~2 FLOP/B", while its own hint and prose gave 2 FLOPs per parameter over 2 bytes per FP16 weight.',
  after: '2 FLOPs per parameter per token divided by 2 bytes per FP16 weight is 1 FLOP/byte. The statline now reads ≈1 FLOP/B, matching the prose.',
  why: 'The ridge-point comparison (about 295 FLOP/B on H100) holds either way, but a statline that contradicts its own hint teaches the wrong division. FP8 weights would double it to about 2.',
  items: [
    {
      q: 'A model with FP8 weights decodes at batch 1. Counting only weight reads and 2 FLOPs per parameter, what is its arithmetic intensity?',
      options: [
        'About 1 FLOP per byte',
        'About 2 FLOP per byte',
        'About 0.5 FLOP per byte',
        'About 4 FLOP per byte',
      ],
      correct: [1],
      why: [
        'That is the FP16 figure: 2 FLOPs over 2 bytes per weight.',
        'Right. 2 FLOPs per parameter over 1 byte per FP8 weight is 2 FLOP/B. FP16 weights give 1.',
        'That would need 4 bytes per weight, which is FP32.',
        'That would need half a byte per weight, which is 4-bit weights.',
      ],
    },
  ],
} satisfies Erratum
