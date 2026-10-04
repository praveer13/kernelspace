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
} satisfies Erratum
