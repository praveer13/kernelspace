import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t7-l1-slo-attribution-and-percentile',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t7.l1'],
  title: 'Meta published goals, not SLOs; contracts and sizing sit on p95 or p99, not p50',
  before: 'The lesson called Meta\'s 350 ms and 25 ms "SLOs" of its app, gave "typical chat SLOs" with no source, and said "p50 for design, p95/p99 for contracts".',
  after: 'Meta\'s post states them as goals ("ideally under 350ms", "targeting less than 25ms"). MLPerf publishes sourced TTFT and TPOT limits at the 99th percentile. Report p50, but size and contract on p95 or p99.',
  why: 'The post does not call its numbers SLOs, and the course itself sizes capacity on p95, so designing at the median contradicted its own worked sizing.',
  source: {
    url: 'https://engineering.fb.com/2025/10/17/ai-research/scaling-llm-inference-innovations-tensor-parallelism-context-parallelism-expert-parallelism/',
    title: 'Meta Engineering: Scaling LLM Inference (2025-10-17)',
  },
} satisfies Erratum
