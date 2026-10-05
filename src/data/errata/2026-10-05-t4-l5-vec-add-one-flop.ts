import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t4-l5-vec-add-one-flop',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t4.l5'],
  title: 'vec_add does one FLOP per 12 bytes (about 0.08 FLOP/byte), not two',
  before: 'The vec_add comment and a quiz stem said "AI = 2 FLOP / 12 B ≈ 0.17", counting two FLOPs for one add per element.',
  after: 'out[i] = a[i] + b[i] is one add and moves 12 bytes (two 4-byte reads, one 4-byte write): 1 / 12 ≈ 0.08 FLOP/byte. It is still far left of any ridge, so the conclusion stands.',
  why: 'Arithmetic intensity divides the FLOPs the kernel actually executes by the bytes it moves. The kernel executes one add per element, so the numerator is 1.',
  source: {
    url: 'https://dl.acm.org/doi/10.1145/1498765.1498785',
    title: 'Williams, Waterman, Patterson, Roofline: an insightful visual performance model for multicore architectures (CACM 2009)',
  },
  items: [
    {
      q: 'A kernel computes out[i] = a[i] + b[i] on FP32 arrays. What is its arithmetic intensity on DRAM traffic?',
      options: [
        'About 0.17 FLOP per byte',
        'About 0.08 FLOP per byte',
        'About 0.13 FLOP per byte',
        'About 0.25 FLOP per byte',
      ],
      correct: [1],
      why: [
        'That counts two FLOPs per element. The kernel does one add, so the numerator is 1.',
        'Right. One add per element over 12 bytes (two reads and one write of 4 bytes) is 1 / 12, about 0.08.',
        'That leaves out the output write: one add over just the two 4-byte reads is 1 / 8. The store adds 4 more bytes.',
        'That counts only one 4-byte operand. Both inputs and the output cross the memory bus.',
      ],
    },
  ],
} satisfies Erratum
