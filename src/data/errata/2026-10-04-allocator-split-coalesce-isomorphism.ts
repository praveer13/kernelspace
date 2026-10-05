import type { Erratum } from './schema'

export default {
  id: '2026-10-04-allocator-split-coalesce-isomorphism',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t1.l3'],
  title: 'Allocator split and coalesce do not map to KV append and COW fork',
  before: 'split + coalesce ≡ block append & COW fork: sequences append blocks as they grow; beam search forks share blocks copy-on-write.',
  after:
    'Split-on-alloc and coalesce-on-free map to growing one fixed-size block at a time and returning whole blocks to a pool. KV blocks never coalesce, because identical blocks leave no holes to merge.',
  why: 'Copy-on-write fork is a different mechanism, and pairing it with coalescing taught that KV blocks merge. They do not: one block size is what removes external fragmentation.',
  source: {
    url: 'https://arxiv.org/abs/2309.06180',
    title: 'Kwon et al., Efficient Memory Management for Large Language Model Serving with PagedAttention (SOSP 2023)',
  },
  items: [
    {
      q: 'Why does a PagedAttention-style KV cache have no coalescing step when blocks are freed?',
      options: [
        'A background thread merges freed neighbours into larger blocks',
        'Copy-on-write forks make adjacent blocks merge on their own',
        'Fixed-size blocks leave no holes behind after a block is freed',
        'Blocks stay allocated for the whole run and are not returned to the pool',
      ],
      correct: [2],
      why: [
        'KV blocks never coalesce, so no background merging exists to do it.',
        'Copy-on-write is a separate mechanism for sharing blocks. It does not merge anything.',
        'Right: one fixed block size removes external fragmentation: a freed block is reusable as is and goes back to the pool whole.',
        'Blocks are freed as sequences finish, and preempted sequences give theirs back too.',
      ],
    },
  ],
} satisfies Erratum
