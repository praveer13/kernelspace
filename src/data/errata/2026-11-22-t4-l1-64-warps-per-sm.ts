import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t4-l1-64-warps-per-sm',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t4.l1'],
  title: 'An SM holds up to 64 resident warps, not thousands',
  before: 'The lesson said a stalled warp is swapped for a resident one because "thousands of warps per SM make this cheap", and that "thousands of warps can be resident".',
  after: 'An H100 SXM SM holds at most 64 resident warps (about 8,000 across the 132 SMs of an H100). Switching between them is still free, because their registers stay on chip.',
  why: 'The per-SM limit is 64 on Hopper. "Thousands" overstated the warp count by more than an order of magnitude and would mislead a learner sizing a kernel.',
  source: {
    url: 'https://docs.nvidia.com/cuda/hopper-tuning-guide/index.html',
    title: 'NVIDIA Hopper Tuning Guide, 1.4.1.1 Occupancy',
  },
} satisfies Erratum
