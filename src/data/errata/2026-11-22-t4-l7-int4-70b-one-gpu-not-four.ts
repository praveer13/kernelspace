import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t4-l7-int4-70b-one-gpu-not-four',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t4.l7'],
  title: 'A 70B model at INT4 fits one 80 GB GPU instead of two, not instead of four',
  before: 'The INT4 capacity card said a 70B model goes from 140 GB to about 35 GB, "one GPU instead of four".',
  after: 'At FP16, 140 GB needs two 80 GB GPUs; at INT4, about 35 GB of weights fits one. The saving is two GPUs to one, though the weight bytes shrink fourfold.',
  why: '140 GB over 80 GB per H100 rounds up to two GPUs, which is what the memory lesson says. Four GPUs would have overstated the saving twofold.',
  source: {
    url: 'https://www.nvidia.com/en-us/data-center/h100/',
    title: 'NVIDIA H100 Tensor Core GPU',
  },
} satisfies Erratum
