import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t7-l2-prefix-cache-10x-unsourced',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t7.l2'],
  title: 'The "10x cheaper per request" prefix-cache figure had no source, so it was removed',
  before:
    'The prefix-sharing quiz explanation said cache-hit-dominated traffic "can be 10× cheaper per request", with no source for the factor.',
  after:
    'Cache-hit-dominated traffic skips most prefill, so TTFT and cost per request differ sharply from independent traffic. The size of the gap depends on hit rate and workload, so no single factor is taught.',
  why: 'A round multiplier with no source reads as a measured result. The gap depends on hit rate, prompt length and engine, so the lesson states the mechanism and leaves the number to your own measurement.',
} satisfies Erratum
