import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l10-vllm-v1-throughput-up-to-1-7x',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l10'],
  title: 'vLLM V1 reports up to 1.7× the throughput of V0, not ~2.8×',
  before:
    'T5.L10 said the V1 engine rewrite shipped "with a rewritten scheduler/KV-cache manager and ~2.8× throughput over V0", without a source.',
  after:
    'vLLM\'s own V1 announcement reports "up to 1.7x higher throughput compared to V0 (without multi-step scheduling)". The lesson now quotes that best case and its baseline.',
  why: 'An unsourced multiplier invites repetition. The announcement gives a best case, up to 1.7x, against V0 without multi-step scheduling, so the lesson should say exactly that and claim no more.',
  source: {
    url: 'https://vllm.ai/blog/2025-01-27-v1-alpha-release',
    title: 'vLLM Team, "vLLM V1: A Major Upgrade to vLLM\'s Core Architecture" (January 2025): "up to 1.7x higher throughput compared to V0 (without multi-step scheduling)"',
  },
  items: [
    {
      q: 'What throughput gain over V0 does vLLM\'s own V1 announcement report?',
      options: [
        'About 2.8x higher, against V0 with multi-step scheduling enabled',
        'Up to 24x higher, against Hugging Face Transformers at the 2023 launch',
        'About 2 to 4x higher, against FasterTransformer and Orca in 2023',
        'Up to 1.7x higher, against V0 without multi-step scheduling',
      ],
      correct: [3],
      why: [
        'That is the old lesson figure, which had no source. The announcement reports up to 1.7x, and its baseline was V0 without multi-step scheduling, not with it.',
        'That is the 2023 vLLM launch claim against Hugging Face Transformers, a naive baseline. V1 is compared with V0, and its best case is far smaller.',
        'That is the 2023 PagedAttention paper\'s gain over FasterTransformer and Orca. It measures paging and batching, not the V1 rewrite against V0.',
        'Right: the announcement says "up to 1.7x higher throughput compared to V0 (without multi-step scheduling)". It is a best case from the project itself, not a typical gain.',
      ],
    },
  ],
} satisfies Erratum
