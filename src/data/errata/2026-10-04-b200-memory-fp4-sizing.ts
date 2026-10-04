import type { Erratum } from './schema'

export default {
  id: '2026-10-04-b200-memory-fp4-sizing',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t6.l5'],
  title: 'B200 ships with ~180 GB per GPU, and 671B at NVFP4 fits one 8×B200 node',
  before: 'B200 has 192 GB HBM3e. A 671B model at FP4 is ~335 GB and fits "a 2-node NVL72 pair".',
  after: 'HGX/DGX B200 ships ~180 GB per GPU (1,440 GB per 8; 192 GB is the raw stack). NVFP4 is ~4.5 bits per weight, so 671B is ~377 GB, which fits one 8×B200 node. NVL72 is a rack.',
  why: 'Capacity math uses what ships, not the raw stack. The 16-element FP8 block scales add ~0.5 bit per weight, and the old sizing mixed up a node (8 GPUs) with a rack (72).',
  source: { url: 'https://www.nvidia.com/en-us/data-center/dgx-b200/', title: 'NVIDIA DGX B200 (1,440 GB total GPU memory)' },
} satisfies Erratum
