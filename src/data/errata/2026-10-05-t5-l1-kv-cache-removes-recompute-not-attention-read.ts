import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l1-kv-cache-removes-recompute-not-attention-read',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l1'],
  title: 'The KV cache removes prefix recompute, not the attention read over all t tokens',
  before:
    'The T5.L1 quiz key said caching K/V leaves "O(1) new work per token", although the lesson itself says per-token attention cost grows with context length t.',
  after:
    'The cache removes the recompute of past tokens: each step runs one new token through projections and MLP. Attention still reads all t cached K/V entries, so its FLOPs and bytes per token still grow with t.',
  why: 'Calling a step O(1) hides the cost that makes decode bandwidth-bound and long context expensive: the cache read grows with t on every token.',
  source: {
    url: 'https://arxiv.org/abs/2211.05102',
    title: 'Pope et al., Efficiently Scaling Transformer Inference (the KV cache is loaded at every decode step, so memory time grows with context length)',
  },
  items: [
    {
      q: 'With a KV cache, what does one decode step cost as the context grows from 1k to 100k tokens?',
      options: [
        'Constant work with the cached K and V left untouched after they are written',
        'One new token through the projections plus an attention read that grows with t',
        'A forward pass over the whole prefix with attention rebuilding the hidden states of earlier tokens at each layer',
        'Work that grows with t squared as each cached token attends to the other cached tokens again',
      ],
      correct: [1],
      why: [
        'The cached entries are read at every step: attention for the new token uses all of them, so the read grows with context length.',
        'Right: only the new token is projected and sent through the MLP; attention still reads every cached K and V entry, which grows linearly with t.',
        'That is decode without a cache. With one, past K and V are reused and only the new token is computed.',
        'Past tokens do not attend again. Only the new token attends, over t cached entries, so per-step attention is linear in t.',
      ],
    },
  ],
} satisfies Erratum
