import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t7-l5-spiral-item-fits-the-gpu',
  date: '2026-11-23',
  kind: 'error',
  lessons: ['t7.l5'],
  title: 'A 70B model in BF16 does not fit one 80 GB GPU',
  before:
    'A T7.L5 spiral item put 70B BF16 weights (140 GB) on one GPU with 3.35 TB/s and keyed batch-1 decode at about 24 tokens per second.',
  after:
    '140 GB of BF16 weights need two 80 GB GPUs. Split by tensor parallelism, they stream at once: 6.7 TB/s ÷ 140 GB is about 48 tokens per second at best, before the all-reduce.',
  why: 'One 80 GB GPU cannot hold 140 GB of weights, so the item described a deployment that cannot run. The ceiling is the bandwidth of every GPU holding a share, divided by the weight bytes.',
  source: {
    url: 'https://www.nvidia.com/en-us/data-center/h100/',
    title: 'NVIDIA H100 Tensor Core GPU (SXM: 80 GB memory, 3.35 TB/s memory bandwidth)',
  },
} satisfies Erratum
