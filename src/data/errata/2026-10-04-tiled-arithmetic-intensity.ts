import type { Erratum } from './schema'

export default {
  id: '2026-10-04-tiled-arithmetic-intensity',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t4.l6'],
  title: 'A tiled matmul has intensity T/2 FLOP/byte at FP16, not T',
  before:
    'Intensity jumps from ~2 to ~T FLOP/byte (the Roofline Playground used T/8, its header T/6); naive matmul was ~2 FLOP/byte, which counted elements, not bytes',
  after:
    'A T×T tile does 2·T²·K FLOPs on 2·T·K·b bytes: T/b, so T/2 FLOP/byte at FP16. T = 128 gives 64, not 128. Naive is the T = 1 case, 0.5 FLOP/byte, not ~2.',
  why: 'The lesson and the sim gave three different formulas for one quantity. Counting FLOPs over bytes (2 per FP16 element) fixes it, and T = 128 stays left of the H100 ridge on HBM traffic alone.',
  source: {
    url: 'https://docs.nvidia.com/deeplearning/performance/dl-performance-matrix-multiplication/index.html',
    title: "NVIDIA, Matrix Multiplication Background User's Guide (GEMM arithmetic intensity and thread-block tile operand reuse)",
  },
  items: [
    {
      q: 'A tiled FP16 matmul uses T x T tiles with T = 128. What is its arithmetic intensity on operand traffic?',
      options: [
        '128 FLOP per byte',
        '64 FLOP per byte',
        '16 FLOP per byte',
        '32 FLOP per byte',
      ],
      correct: [1],
      why: [
        'That counts elements, not bytes. FP16 elements are 2 bytes, so the figure halves.',
        'Right. A tile does 2 T^2 K FLOPs on 2 T K b bytes, which is T / b. With b = 2 that is 128 / 2 = 64.',
        'That is T / 8, an earlier formula in the Roofline Playground that did not match the lesson.',
        'That is T / 4, which would be the FP32 figure, not FP16.',
      ],
    },
  ],
} satisfies Erratum
