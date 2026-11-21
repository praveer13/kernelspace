import type { Erratum } from './schema'

export default {
  id: '2026-11-21-paged-waste-not-the-papers-figure',
  date: '2026-11-21',
  kind: 'error',
  lessons: ['t1.l3', 't1.l4', 't2.l7', 't5.l5'],
  title: 'The "<4% waste" figure is not in the PagedAttention paper\'s text',
  before:
    'The lessons called "<4%" KV waste the PagedAttention paper\'s headline number.',
  after:
    'The paper\'s text says near-zero waste; earlier systems held token states in 20.4% to 38.2% of KV memory. It never prints "<4%". Figure 2 labels vLLM 96.3% token states (about 3.7% left, one experiment). The tail bound is arithmetic.',
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
        'The abstract and the text of Section 1 print no 4% bound; they say near-zero waste. Figure 2 labels vLLM 96.3% token states for one experiment, so under 4% is the course\'s rounding of one average, not a bound in every workload.',
        'The profile in the paper (Figure 2) covers the earlier systems and vLLM, and gives each its used share, not a share of waste removed.',
        'The paper does give a figure: the 20.4% to 38.2% used share in earlier systems, alongside its near-zero waste claim.',
      ],
    },
  ],
} satisfies Erratum
