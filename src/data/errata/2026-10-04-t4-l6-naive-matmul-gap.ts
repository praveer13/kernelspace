import type { Erratum } from './schema'

export default {
  id: '2026-10-04-t4-l6-naive-matmul-gap',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t4.l6'],
  title: 'Naive matmul leaves the H100 about 590× short of its compute roof, not 100×',
  before:
    'At 0.5 FLOP/byte, the tensor cores "could do this 100× faster than its memory can feed it".',
  after:
    'The H100 FP16 ridge is ~295 FLOP/byte, so at 0.5 FLOP/byte the gap is 295 / 0.5 = ~590×: HBM feeds ~1.7 TFLOP/s of ~989.',
  why: 'The lesson\'s own numbers (989 TFLOP/s dense, 3.35 TB/s) give the ridge; the ratio of ridge to arithmetic intensity is the bandwidth-bound gap. Quoting 100× understated how much tiling has to recover.',
} satisfies Erratum
