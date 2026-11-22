import type { Erratum } from './schema'

export default {
  id: '2026-11-21-t7-l2-load-generators',
  date: '2026-11-21',
  kind: 'error',
  lessons: ['t7.l2'],
  title: 'The benchmarking lesson recommended an archived and a phasing-out load generator',
  before: 'The lesson named LLMPerf and GenAI-Perf as the two load generators worth knowing.',
  after:
    'LLMPerf was archived and made read-only in December 2025, and GenAI-Perf is being phased out for AIPerf. The lesson now names GuideLLM and AIPerf, and says what became of the first two.',
  why: 'A recommendation pointed learners at tools that no longer get new features. Older posts still cite them, so the lesson says so beside the live tools.',
  source: {
    url: 'https://github.com/triton-inference-server/perf_analyzer/blob/main/genai-perf/README.md',
    title: 'GenAI-Perf README: "GenAI-Perf is being phased out ... please use AIPerf instead"',
  },
} satisfies Erratum
