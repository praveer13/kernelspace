import type { Erratum } from './schema'

export default {
  id: '2026-11-21-paged-waste-not-the-papers-figure',
  date: '2026-11-21',
  kind: 'error',
  lessons: ['t1.l3', 't1.l4', 't2.l7', 't5.l5'],
  title: '"<4% waste" is not in the PagedAttention paper\'s text',
  before:
    'The lessons called "<4%" KV waste the PagedAttention paper\'s headline number.',
  after:
    'The paper\'s text says near-zero waste and gives 20.4% to 38.2% of KV memory holding token states in earlier systems. It never gives "<4%"; Figure 2 is not read here. The tail bound, block_size - 1 tokens, is arithmetic.',
  why: 'A figure the paper\'s text does not give was taught as its result. The capstone line and the glossary pair now separate the paper\'s words from the course\'s arithmetic.',
  source: {
    url: 'https://arxiv.org/pdf/2309.06180v1',
    title: 'Kwon et al., Efficient Memory Management for LLM Serving with PagedAttention (abstract and Section 1)',
  },
  items: [
    {
      q: 'What does the PagedAttention paper report about KV cache waste?',
      options: [
        'Near-zero waste, set against earlier systems that used 20.4% to 38.2% of KV memory',
        'A waste bound of under 4% in every workload, stated in its abstract and Section 1',
        'About 60% of KV waste removed, taken from a profile of vLLM itself on ShareGPT',
        'No waste figure of any kind, only the throughput gains over earlier serving systems',
      ],
      correct: [0],
      why: [
        'Right: the paper words its result as near-zero waste and gives 20.4% to 38.2% as the share of memory that held token states before.',
        'The abstract and Section 1 give no 4% bound; they say near-zero waste. Figure 2 is not read here, so the course states no more than the text does.',
        'The profile in the paper covers the earlier systems, and it gives a used share, not a share of waste removed.',
        'The paper does give a figure: the 20.4% to 38.2% used share in earlier systems, alongside its near-zero waste claim.',
      ],
    },
  ],
} satisfies Erratum
