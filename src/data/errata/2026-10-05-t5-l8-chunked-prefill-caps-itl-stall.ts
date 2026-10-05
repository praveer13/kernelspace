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
  items: [
    {
      q: 'Chunked prefill is on and a long prompt arrives while other requests are decoding. What happens to the running decodes?',
      options: [
        'They see no ITL delay as the prompt is split finely enough to interleave decode tokens',
        'They wait around one chunk of prefill per iteration and smaller chunks give better ITL',
        'They stall for the entire prefill and ITL spikes until the prompt completes',
        'They stall longer with smaller chunks and ITL worsens with each extra scheduling round',
      ],
      correct: [1],
      why: [
        'Each iteration still carries up to one chunk of prefill work, so decodes are delayed by about that much. The stall is bounded, not removed.',
        'Right: each iteration carries at most one prefill chunk, so decodes wait about one chunk. Smaller budgets give better ITL; larger budgets give better TTFT.',
        'That is prefill without chunking. With chunking, decodes run in every iteration alongside one chunk, so the stall is capped at one chunk.',
        'The direction is reversed. Smaller chunks mean fewer prefill tokens slowing each decode step, so ITL improves while TTFT gets worse.',
      ],
    },
  ],
} satisfies Erratum
