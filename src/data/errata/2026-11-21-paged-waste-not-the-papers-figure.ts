import type { Erratum } from './schema'

export default {
  id: '2026-11-21-paged-waste-not-the-papers-figure',
  date: '2026-11-21',
  kind: 'error',
  lessons: ['t1.l3', 't1.l4', 't2.l7', 't5.l5'],
  title: '"<4% waste" was never the PagedAttention paper\'s figure',
  before:
    'The lessons called "<4%" KV waste the PagedAttention paper\'s headline number.',
  after:
    'The paper says near-zero waste and measured only 20.4% to 38.2% of KV memory holding token states in earlier systems. The tail bound (at most block_size - 1 tokens per sequence) is arithmetic.',
  why: 'A figure the paper never printed was taught as its result. The capstone line and the glossary pair now separate the paper\'s words from the course\'s arithmetic.',
  source: {
    url: 'https://arxiv.org/abs/2309.06180v1',
    title: 'Kwon et al., Efficient Memory Management for LLM Serving with PagedAttention (abstract and Section 1)',
  },
  items: [
    {
      q: 'What does the PagedAttention paper report about KV cache waste?',
      options: [
        'Near-zero waste, set against earlier systems that used 20.4% to 38.2% of KV memory',
        'Waste under 4% in every workload it tested, shown in its memory-usage breakdown',
        'About 60% of KV waste removed, taken from a profile of vLLM itself on ShareGPT',
        'No waste figure of any kind, only the throughput gains over earlier serving systems',
      ],
      correct: [0],
      why: [
        'Right: the paper words its result as near-zero waste and gives 20.4% to 38.2% as the share of memory that held token states before.',
        'The paper never prints a 4% bound. That figure came from the course\'s own tail arithmetic, not from a measurement.',
        'The profile in the paper covers the earlier systems, and it gives a used share, not a share of waste removed.',
        'The paper does give a figure: the 20.4% to 38.2% used share in earlier systems, alongside its near-zero waste claim.',
      ],
    },
  ],
} satisfies Erratum
