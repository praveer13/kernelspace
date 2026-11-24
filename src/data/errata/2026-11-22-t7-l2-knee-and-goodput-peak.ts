import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t7-l2-knee-and-goodput-peak',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t7.l2'],
  title: 'The knee is the highest load step that meets the SLO; the Fleet exercise grades the goodput peak',
  before: 'Rule 3 called the knee the point where TTFT or TPOT violate the SLO, yet its worked example and the exercise ticket used the last passing step; the Fleet exercise "Find the knee" graded the goodput maximum.',
  after: 'The knee is the highest load step that still meets the SLO and is the capacity number. The Fleet exercise is now "Find the goodput peak", which sits at or above the knee.',
  why: 'Goodput counts each request against its own bound, so it can peak at a load where the p95 already misses the SLO. Capacity is the last step that still meets it.',
  source: {
    url: 'https://arxiv.org/abs/2401.09670',
    title: 'DistServe: Disaggregating Prefill and Decoding for Goodput-optimized Large Language Model Serving',
  },
} satisfies Erratum
