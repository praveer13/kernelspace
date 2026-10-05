import type { Erratum } from './schema'

export default {
  id: '2026-10-04-b200-memory-fp4-sizing',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t6.l5'],
  title: 'B200 ships with ~180 GB per GPU, and 671B at NVFP4 fits one 8×B200 node',
  before: 'B200 has 192 GB HBM3e. A 671B model at FP4 is ~335 GB and fits "a 2-node NVL72 pair".',
  after: 'HGX/DGX B200 ships ~180 GB per GPU (1,440 GB per 8; many sources cite 192 GB, which the shipped spec does not list). NVFP4 is ~4.5 bits per weight, so 671B is ~377 GB, which fits one 8×B200 node. NVL72 is a rack.',
  why: 'Capacity math uses what the shipped spec lists, not a figure that sources repeat. The 16-element FP8 block scales add ~0.5 bit per weight, and the old sizing mixed up a node (8 GPUs) with a rack (72).',
  source: { url: 'https://www.nvidia.com/en-us/data-center/dgx-b200/', title: 'NVIDIA DGX B200 (1,440 GB total GPU memory)' },
  items: [
    {
      q: 'NVFP4 stores about 4.5 bits per weight. How much memory do the weights of a 671B model need, and where do they fit?',
      options: [
        'About 335 GB, held across a 2-node NVL72 pair with spare capacity',
        'About 377 GB, needing a full 72-GPU NVL72 rack of nodes to hold them',
        'About 671 GB, held across two 8xB200 nodes with a split model',
        'About 377 GB, held on a single 8xB200 node with room to spare',
      ],
      correct: [3],
      why: [
        '335 GB is the 4-bit figure and ignores the block scales. NVL72 is a rack, not a pair of nodes, and one node is already enough.',
        'One 8xB200 node ships about 1,440 GB (about 180 GB per GPU), far more than the 377 GB of weights.',
        '671 GB is the FP8 figure, and even that fits in one 1,440 GB node.',
        'Right: 671e9 x 4.5 / 8 is about 377 GB, which fits one node with room left for KV cache.',
      ],
    },
  ],
} satisfies Erratum
