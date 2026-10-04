import type { Erratum } from './schema'

export default {
  id: '2026-10-04-tiled-arithmetic-intensity',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t4.l6'],
  title: 'A tiled matmul has intensity T/2 FLOP/byte at FP16, not T',
  before:
    'Arithmetic intensity jumps from ~2 to ~T FLOP/byte (the Roofline Playground used T/8, its header T/6)',
  after:
    'A T×T tile does 2·T²·K FLOPs on 2·T·K·b bytes, so intensity is T/b: T/2 FLOP/byte at FP16. T = 128 gives 64, not 128.',
  why: 'The lesson and the sim gave three different formulas for one quantity. Counting FLOPs over bytes (2 bytes per FP16 element) fixes it, and T = 128 stays left of the H100 ridge on HBM traffic alone.',
  source: {
    url: 'https://doi.org/10.1145/1498765.1498785',
    title: 'Williams, Waterman, Patterson, Roofline: an insightful visual performance model for multicore architectures (CACM 2009)',
  },
} satisfies Erratum
