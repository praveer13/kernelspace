import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t2-l7-one-kv-manager-and-kernel-cost',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t2.l7'],
  title: 'The paper has one shared KV cache manager, and its block-table kernel costs 20-26%',
  before:
    'The lesson called the distributed design shared-nothing, a page table per process, and said the paper keeps the block-table cost near zero, so extra index loads are "noise".',
  after:
    'The paper has a single KV cache manager within the centralized scheduler, shared by every GPU worker with one logical-to-physical mapping. Its kernel measures 20-26% higher attention latency than FasterTransformer, small only end to end.',
  why: 'Shared-nothing is the opposite of the paper\'s design, and "noise" hid a measured cost. This does not supersede the T5.L5 erratum on the same 20-26%, which covers another lesson.',
  source: {
    url: 'https://arxiv.org/abs/2309.06180',
    title: 'Kwon et al., Efficient Memory Management for Large Language Model Serving with PagedAttention (SOSP 2023)',
  },
} satisfies Erratum
