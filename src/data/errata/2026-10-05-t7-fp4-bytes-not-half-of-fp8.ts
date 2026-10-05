import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t7-fp4-bytes-not-half-of-fp8',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t7.l3', 't7.l4'],
  title: 'In T7, NVFP4 moves about 1.8× fewer bytes than FP8, not half',
  before:
    'T7.L3 said "FP8→FP4 halves bytes", and T7.L4 listed quantization as "halve bytes → halve the denominator, FP4".',
  after:
    'NVFP4 stores a 4-bit value plus one FP8 scale per 16 values, about 4.5 bits per weight. That is ~1.8× fewer bytes than FP8, so cost per token falls by up to ~1.8× from bytes alone, not 2×.',
  why: 'The block scales cost about half a bit per weight. T6.L5 already corrected the decode arithmetic; the two T7 lessons now agree with it, so the frontier shift and the cost lever use one number.',
  source: {
    url: 'https://developer.nvidia.com/blog/introducing-nvfp4-for-efficient-and-accurate-low-precision-inference/',
    title: 'NVIDIA: Introducing NVFP4 (4.5 bits per value; ~1.8× smaller than FP8)',
  },
  items: [
    {
      q: 'A team moves a bandwidth-bound decode fleet from FP8 weights to NVFP4. By the byte reduction alone, how far can its cost per token fall?',
      options: [
        'By up to about 2×, because 4 bits is exactly half of the 8 bits that FP8 spends on every weight',
        'By up to about 4×, because FP4 also halves the activation bytes on top of halving the weights',
        'By up to about 1.1×, because the per-block scale factors cancel almost all of the saving in bytes',
        'By up to about 1.8×, because 4.5 bits per weight leaves 4.5 / 8, about 56%, of FP8\'s weight bytes',
      ],
      correct: [3],
      why: [
        'This ignores the block scales. Each group of 16 values carries an FP8 scale, adding about half a bit per weight, so the saving is a little under 2×.',
        'Weight bytes dominate bandwidth-bound decode, so activation bytes add little, and the block scales keep the weight gain under 2×. Nothing here reaches 4×.',
        'The scales add 0.5 bit to a 4-bit value, not 4 bits. They trim the saving from 2× to ~1.8× instead of cancelling it.',
        'Right: 4 + 8/16 = 4.5 bits per weight, so NVFP4 keeps 4.5 / 8, about 56%, of FP8\'s weight bytes. That is ~1.8× fewer (8 / 4.5 is about 1.78), so a bandwidth-bound fleet gains up to that much per GPU-hour.',
      ],
    },
  ],
} satisfies Erratum
