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
} satisfies Erratum
