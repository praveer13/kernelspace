import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t5-l4-bandwidth-wall-fix-not-batching',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t5.l4'],
  title: 'A blown ITL is fixed by a smaller batch, fewer bytes per step or more bandwidth, not by batching',
  before: 'The bandwidth-wall callout and the exit-ticket model answer listed batching among the fixes for a blown inter-token latency.',
  after: 'A blown ITL is fixed by a smaller running batch, fewer bytes per step (quantization, a shorter cache) or more bandwidth per step (sharding). A bigger batch raises ITL.',
  why: 'T5.L3 teaches that bigger decode batches cut cost per token but slow each token. Batching serves throughput, not latency. The earlier replicas-versus-sharding erratum covers the other half of this sentence.',
  source: {
    url: 'https://dl.acm.org/doi/10.1145/1498765.1498785',
    title: 'Roofline: an insightful visual performance model for multicore architectures',
  },
} satisfies Erratum
