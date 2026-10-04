import type { Erratum } from './schema'

export default {
  id: '2026-10-04-vllm-v1-preemption-and-cached-blocks',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t5.l5', 't5.l10'],
  title: 'vLLM V1 preempts by recompute, and refcount-0 blocks stay cached',
  before:
    'When a block\'s refcount hit zero it was erased from the prefix cache and returned to the free list; preemption swapped blocks to CPU RAM or dropped them for recompute.',
  after:
    'In vLLM V1, refcount-0 blocks join the free queue but stay hashed: evictable, reusable on a prefix hit until reallocated. Preemption is recompute-only; V1 dropped CPU swap.',
  why: 'The old code sample deleted cache entries at refcount 0, which contradicts automatic prefix caching. A freed system prompt should still hit the cache a moment later.',
  source: {
    url: 'https://docs.vllm.ai/en/latest/design/prefix_caching/',
    title: 'vLLM design: Automatic Prefix Caching',
  },
  items: [
    {
      q: 'In vLLM V1 a cached KV block drops to refcount 0. What happens to it?',
      options: [
        'It is erased from the prefix cache and put back on the free list',
        'It is swapped to CPU RAM so that a later prefix hit can reload it from there',
        'It joins the free queue yet stays hashed, so a prefix hit can reuse it',
        'It stays pinned on the GPU, unavailable to the allocator, until the engine stops',
      ],
      correct: [2],
      why: [
        'That is what the old code sample did, and it defeats automatic prefix caching: a freed system prompt should still hit a moment later.',
        'V1 dropped CPU swap. A free block stays in GPU memory, hashed, until something reuses the slot.',
        'Right. The block is evictable, and a request with the same prefix can reuse it until the allocator hands the slot to someone else.',
        'Pinned blocks could never be reclaimed. A refcount-0 block is on the free queue and can be reallocated.',
      ],
    },
  ],
} satisfies Erratum
