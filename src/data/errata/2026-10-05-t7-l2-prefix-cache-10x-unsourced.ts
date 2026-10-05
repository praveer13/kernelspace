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
  source: { url: 'https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/', title: 'vLLM docs: Automatic Prefix Caching' },
  items: [
    {
      q: 'Traffic is dominated by prefix-cache hits. What can a lesson responsibly say about its cost per request compared with independent traffic?',
      options: [
        'It is a fixed multiple cheaper for any model and engine once cache hits dominate',
        'It is cheaper for the first few requests and then cached blocks are evicted under load',
        'It costs about the same as each request still pays for a full prefill',
        'It is cheaper by an amount that depends on hit rate, prompt length and engine',
      ],
      correct: [3],
      why: [
        'No source supports a fixed 10×. The saving depends on hit share, prompt length and the engine, so a round multiplier reads as a measured result when it is not.',
        'Cached blocks stay resident until memory pressure evicts them, and agentic traffic with shared prefixes keeps hitting them. The benefit persists across requests, not only the first few.',
        'A hit reuses stored KV blocks, so prefill compute for the shared prefix is skipped rather than repeated. Cost per request therefore falls, though by an amount that varies.',
        'Right: hits let the engine skip most of the prefill, so TTFT and cost shift sharply. How far depends on hit rate, prompt length and engine, which is why you measure it yourself.',
      ],
    },
  ],
} satisfies Erratum
