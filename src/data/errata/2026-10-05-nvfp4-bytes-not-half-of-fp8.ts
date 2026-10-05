import type { Erratum } from './schema'

export default {
  id: '2026-10-05-nvfp4-bytes-not-half-of-fp8',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t6.l5'],
  title: 'NVFP4 moves about 1.8× fewer weight bytes than FP8, not 2×',
  before:
    'The T6.L5 quiz taught that FP4 halves weight bytes versus FP8, so bandwidth-bound decode gains "another ~2×" on top of B200\'s bandwidth.',
  after:
    'NVFP4 stores a 4-bit value plus one FP8 scale per 16 values, about 4.5 bits per weight. Against FP8 that is ~1.8× fewer weight bytes, so the decode gain from FP4 is up to ~1.8×, not 2×.',
  why: 'The block scales cost about half a bit per weight. The lesson already used 4.5 bits for capacity sizing, so the decode arithmetic has to use it too, or the two answers disagree.',
  source: {
    url: 'https://developer.nvidia.com/blog/introducing-nvfp4-for-efficient-and-accurate-low-precision-inference/',
    title: 'NVIDIA: Introducing NVFP4 (4.5 bits per value; ~1.8× smaller than FP8)',
  },
  items: [
    {
      q: 'NVFP4 stores a 4-bit value plus one FP8 scale per 16 values. Versus FP8 weights, how much does decode gain on the bandwidth-bound path from the byte reduction alone?',
      options: [
        'About 2×, because 4 bits is exactly half of the 8 bits FP8 uses per weight',
        'About 1.8×, because 4.5 bits per weight is 8 / 4.5 of the FP8 bytes',
        'About 1.1×, because the per-block scale factors cancel most of the saving',
        'About 4×, because FP4 also halves the activation bytes on top of the weights',
      ],
      correct: [1],
      why: [
        'This ignores the block scales. Each 16 values carry an 8-bit scale, adding about 0.5 bit per weight, so the saving is a little under 2×.',
        'Right: 4 + 8/16 = 4.5 bits per weight, and 8 / 4.5 is about 1.78, so weight bytes fall ~1.8× against FP8.',
        'The scales add 0.5 bit to 4, not 4. The saving is reduced from 2× to ~1.8×, not erased.',
        'Decode weight bytes dominate the bandwidth-bound path, and activations stay wider in shipped recipes. Neither fact gives 4×.',
      ],
    },
  ],
} satisfies Erratum
