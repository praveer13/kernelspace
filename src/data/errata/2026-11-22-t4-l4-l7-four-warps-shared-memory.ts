import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t4-l4-l7-four-warps-shared-memory',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t4.l4', 't4.l7'],
  title: 'Four resident warps came from shared memory, not from 128 registers per thread',
  before: 'The lessons said 128 registers per thread (with 100 KiB shared per block) fit only four warps per SM, and the review item keyed fewer registers as the fix.',
  after: '128 registers per thread allow 16 warps (65,536 / (128 x 32)). Two 100 KiB blocks of 64 threads fill the 228 KB of shared memory, giving four warps, so shared memory binds.',
  why: 'Registers cannot bring an SM to four warps; even the 255-register cap leaves eight. Trimming the wrong budget would not raise occupancy.',
  source: {
    url: 'https://docs.nvidia.com/cuda/hopper-tuning-guide/index.html',
    title: 'NVIDIA Hopper Tuning Guide, 1.4.1.1 Occupancy',
  },
} satisfies Erratum
