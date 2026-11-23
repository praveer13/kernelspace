import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t7-l4-napkin-margin-relation',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t7.l4'],
  title: 'The napkin line named markup as margin, and the SGLang $0.20 per million is one decode node at a stated latency limit',
  before: 'Revenue/token = price x (1 + margin target); the $0.20/M worked example was counted "within SLO".',
  after: 'Price = cost x (1 + markup) = cost / (1 - gross margin). SGLang\'s $0.20/M is one decode node at TTFT 2-5 s and ITL about 100 ms, a throughput-first point, not a tight SLO.',
  why: 'Price is revenue per token, so the (1 + margin) form mixed the two definitions. The blog states its own latency limit, so the node-day cost is not a cost per token inside a tight SLO.',
  source: {
    url: 'https://lmsys.org/blog/2025-05-05-large-scale-ep/',
    title: 'LMSYS: Deploying DeepSeek with PD Disaggregation and Large-Scale Expert Parallelism on 96 H100 GPUs',
  },
} satisfies Erratum
