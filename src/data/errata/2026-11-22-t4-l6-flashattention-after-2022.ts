import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t4-l6-flashattention-after-2022',
  date: '2026-11-22',
  kind: 'changed',
  lessons: ['t4.l6'],
  title: 'FlashAttention is more than the 2022 paper',
  before: 'The lesson presented the 2022 FlashAttention paper as the whole story of tiled attention.',
  after:
    'FlashAttention-3 targets Hopper; FlashAttention-4 targets Blackwell, where tensor-core throughput doubles while shared-memory bandwidth and exponential units scale more slowly. It still rests on the same blocking.',
  why: 'Attention kernels kept changing with each GPU generation; the bottleneck moved from HBM traffic toward shared memory and exponentials.',
  source: {
    url: 'https://arxiv.org/abs/2603.05451',
    title: 'FlashAttention-4 (arXiv 2603.05451, submitted 5 Mar 2026); FlashAttention-3 is arXiv 2407.08608',
  },
} satisfies Erratum
