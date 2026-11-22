import type { Erratum } from './schema'

export default {
  id: '2026-11-22-labs-r10-checks-one-thread-and-lab01-coalescing',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t1.l3', 'r.l10'],
  title: 'Lab text: vLLM blocks do not coalesce, and R10 checks do not inspect your Ordering',
  before:
    'Lab 01 closed with "you now know why its block manager coalesces". The R10 brief said the tests "also inspect the ordering choices".',
  after:
    'A general allocator coalesces; vLLM\'s fixed-size block manager does not need to. R10 checks run on one thread and verify outcomes, plus one check that asks you to name each ordering.',
  why: 'Identical blocks leave no holes to merge. A one-thread test cannot observe which Ordering an atomic call used, so the protocol you write down is the part nothing grades.',
  source: {
    url: 'https://arxiv.org/abs/2309.06180',
    title: 'Kwon et al., Efficient Memory Management for Large Language Model Serving with PagedAttention (SOSP 2023)',
  },
} satisfies Erratum
