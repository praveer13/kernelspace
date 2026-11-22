import type { Erratum } from './schema'

export default {
  id: '2026-11-21-paged-waste-not-the-papers-figure',
  date: '2026-11-21',
  kind: 'error',
  lessons: ['t1.l3', 't1.l4', 't2.l7', 't5.l5'],
  title: 'Under 4% KV waste is the course\'s estimate, not a figure from the PagedAttention paper',
  before:
    'The lessons called "<4%" KV waste the PagedAttention paper\'s headline number.',
  after:
    'The paper\'s words are near-zero waste. Its Figure 2 shows vLLM\'s KV memory almost all holding token states: an average over one experiment, not a bound. Under 4% is the course\'s estimate, true where blocks are small next to the sequences.',
  why: 'A bound the paper never prints was taught as its result. The lessons now give the paper\'s words and its Figure 2, and call under 4% the course\'s estimate.',
  source: {
    url: 'https://arxiv.org/pdf/2309.06180v1',
    title: 'Kwon et al., Efficient Memory Management for LLM Serving with PagedAttention (abstract, Section 1 and its Figure 2)',
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
        'The paper prints no 4% bound; its words are near-zero waste. Figure 2 is an average over one experiment, not a bound for every workload, and under 4% is the course\'s estimate, not the paper\'s.',
        'The profile in the paper (Figure 2) covers the earlier systems and vLLM, and gives each its used share, not a share of waste removed.',
        'The paper does give a figure: the 20.4% to 38.2% used share in earlier systems, alongside its near-zero waste claim.',
      ],
    },
  ],
} satisfies Erratum
