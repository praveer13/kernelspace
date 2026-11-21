import type { Erratum } from './schema'

export default {
  id: '2026-11-21-vllm-default-block-size-64',
  date: '2026-11-21',
  kind: 'changed',
  lessons: ['t1.l3', 't1.l4', 't2.l7', 't5.l5', 't5.l6'],
  title: 'vLLM\'s default KV block is 64 tokens since v0.34.0; 16 was the 2023 paper\'s',
  before:
    'The lessons said vLLM uses a default of 16 tokens per block, and the block-table simulator task asked learners to locate why 16 is the default.',
  after:
    'vLLM v0.34.0 (2026-11-16) made 64 the default on CUDA; ROCm paged attention keeps 16 and an explicit --block-size wins. 16 was the paper\'s. The lessons now read the default from the claims registry.',
  why: 'Bigger blocks cut bookkeeping per token but leave longer unshared tails and coarser prefix hits. One claim now feeds every place that states the default.',
  supersedes: '2026-10-05-t5-l5-block-size-16-is-a-default',
  source: {
    url: 'https://github.com/vllm-project/vllm/releases/tag/v0.34.0',
    title: 'vLLM v0.34.0 release notes (Default --block-size is 64 instead of 16, #63231)',
  },
  items: [
    {
      q: 'vLLM v0.34.0 raised its default KV block from 16 to 64 tokens. What does a larger block trade?',
      options: [
        'Fewer blocks to track, which means a longer tail and coarser prefix-cache hits',
        'Faster attention at no cost at all, because a larger block never wastes any memory',
        'More fragmentation between blocks, because each block must now be contiguous with the next',
        'Nothing, because the allocator rounds every sequence up to a multiple of 64 either way',
      ],
      correct: [0],
      why: [
        'Right: fewer blocks mean smaller block tables and fewer prefix hashes, while each sequence can strand up to 63 tokens in its tail and only full blocks are shared.',
        'A larger block does waste more: the tail can hold up to 63 unused slots per sequence. Nothing about the change is free.',
        'Blocks need not be contiguous with each other; that is the point of paging. Fragmentation between blocks does not appear, the tail grows.',
        'Rounding happens inside the last block only, so block size changes how much is stranded. The cost differs between 16 and 64.',
      ],
    },
  ],
} satisfies Erratum
