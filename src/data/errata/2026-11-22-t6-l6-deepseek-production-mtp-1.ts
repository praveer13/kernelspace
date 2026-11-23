import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t6-l6-deepseek-production-mtp-1',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t6.l6'],
  title: 'DeepSeek ran MTP-1 in production; MTP-3 is NVIDIA\'s TensorRT-LLM setting',
  supersedes: '2026-10-04-deepseek-mtp-one-module',
  before:
    'DeepSeek-R1\'s production stack ran MTP-3, the one MTP module applied for 3 draft steps.',
  after:
    'The module is one, and MTP-3 reruns it three times. DeepSeek served with one draft token per step (MTP-1), then DSpark replaced it. MTP-3 is NVIDIA\'s TensorRT-LLM setting for single-concurrency DeepSeek-R1.',
  why: 'The earlier fix kept the word "production" on MTP-3. The DSpark paper says a static multi-token drafter lowers throughput under high concurrency; NVIDIA tuned three layers for one stream.',
  source: {
    url: 'https://arxiv.org/html/2607.05147',
    title: 'DSpark (arXiv 2607.05147), section 5.4: MTP-1 as the former production setup',
  },
  items: [
    {
      q: 'Which drafter did DeepSeek keep in production before DSpark, and where does MTP-3 come from?',
      options: [
        'MTP-1, one token per step; MTP-3 is NVIDIA\'s single-stream setting',
        'MTP-3, because three draft steps beat one at every concurrency, busy or idle',
        'MTP-3, because the DeepSeek-V3 checkpoint ships three trained MTP modules',
        'No drafter at all; speculation was left to whatever the serving engine chose',
      ],
      correct: [0],
      why: [
        'Right: a static multi-token drafter lowered aggregate throughput under high concurrency, and NVIDIA\'s min-latency recipe picked three layers for one stream.',
        'Extra draft steps add verification cost, which hurts when the batch is already busy.',
        'The checkpoint config has num_nextn_predict_layers = 1: one module.',
        'DeepSeek\'s serving ran an MTP drafter, with one token per step.',
      ],
    },
  ],
} satisfies Erratum
