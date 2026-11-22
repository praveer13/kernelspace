import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t4-shared-memory-vs-hbm-and-l2',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t4.l2', 't4.l6'],
  title: 'Shared memory is not 20-30x HBM, and L2 is not where the KV cache lives between steps',
  before: 'Shared memory was taught as ~20-30x faster than HBM, and a ~50 MiB L2 as the KV cache\'s second home where hot weights and KV blocks stay between steps.',
  after:
    'Shared memory is about an order of magnitude faster than HBM on an A100 and about 6x in the course\'s simulator for an H100. NVIDIA publishes no per-SM figure. L2 helps within one kernel, not between decode steps.',
  why: 'The 20-30x had no source and the simulator disagreed with it. A 50 MiB cache cannot hold a 16 GB weight stream, so serving cost models built on it would be wrong.',
  source: {
    url: 'https://arxiv.org/abs/2205.14135',
    title: 'FlashAttention (Dao et al., 2022): SRAM about 19 TB/s against HBM 1.5-2.0 TB/s on an A100',
  },
} satisfies Erratum
