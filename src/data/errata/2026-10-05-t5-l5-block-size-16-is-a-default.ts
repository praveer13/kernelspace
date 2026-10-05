import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l5-block-size-16-is-a-default',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l5'],
  title: 'Block size 16 is vLLM\'s default balance, not a measured optimum the T1 simulator predicted',
  before:
    'The T5.L5 quiz explanation said "16 is the measured sweet spot — and the T1.L4 simulator predicted it".',
  after:
    'In the paper\'s block-size sweep, 16 to 128 performed best on ShareGPT and 16 or 32 on Alpaca. 16 is the default because it is large enough to use the GPU well and small enough to limit internal fragmentation.',
  why: 'The sweep found a range, not a single optimum, and the T1 simulator prices waste against metadata in bytes; it shows the trade-off but cannot predict a token count.',
  source: {
    url: 'https://arxiv.org/abs/2309.06180',
    title: 'Kwon et al., Efficient Memory Management for LLM Serving with PagedAttention (Section 7.2, impact of block size)',
  },
  items: [
    {
      q: 'In vLLM\'s block-size ablation, what did the PagedAttention paper find?',
      options: [
        'Block size 16 was the single best setting on every workload, and every larger size was slower on both datasets',
        'On ShareGPT, sizes 16 to 128 performed best, while on short-sequence Alpaca the larger sizes did noticeably worse',
        'Block size made no measurable difference on either dataset, so 16 was chosen as an arbitrary power of two',
        'Larger blocks always won, because fewer table entries beat the extra tail waste, so 128 was best on both datasets',
      ],
      correct: [1],
      why: [
        'ShareGPT performed best across 16 to 128, so 16 was not uniquely best. Block size mattered, and the sweep found a range of good values.',
        'Right: on ShareGPT, 16 to 128 performed best; on Alpaca, 16 and 32 worked well and larger blocks degraded performance because sequences were shorter than the blocks.',
        'Block size did change results, notably on Alpaca. The default of 16 was chosen as large enough for the GPU and small enough to limit fragmentation.',
        'On Alpaca, larger blocks degraded performance because sequences became shorter than the block, so tail waste outweighed the savings. 128 was not best on both.',
      ],
    },
  ],
} satisfies Erratum
