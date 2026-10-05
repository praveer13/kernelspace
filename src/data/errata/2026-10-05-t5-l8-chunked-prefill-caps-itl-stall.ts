import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l8-chunked-prefill-caps-itl-stall',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l8'],
  title: 'Chunked prefill caps the ITL stall at one chunk; it does not remove it',
  before:
    'The T5.L8 quiz key said chunked prefill works so that "no prompt stalls ITL", while its own explanation said the stall is bounded by the chunk size.',
  after:
    'Each iteration carries at most one chunk of prefill, so a long prompt delays running decodes by about one chunk, not by the whole prefill. Smaller chunk budgets give better ITL; larger ones give better TTFT.',
  why: 'Chunking turns an unbounded stall into a bounded, tunable one. Claiming zero stall hides the chunk-size trade-off that engine operators actually tune.',
  source: {
    url: 'https://docs.vllm.ai/en/latest/configuration/optimization/',
    title: 'vLLM optimization guide: chunked prefill ("smaller values achieve better ITL because there are fewer prefills slowing down decodes")',
  },
} satisfies Erratum
