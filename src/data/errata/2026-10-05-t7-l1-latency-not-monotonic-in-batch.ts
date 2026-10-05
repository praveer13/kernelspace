import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t7-l1-latency-not-monotonic-in-batch',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t7.l1'],
  title: 'Latency also rises with batch size, and goes vertical past the knee',
  before:
    'The vendor "10,000 tok/s" quiz explanation said "Throughput is monotonic in batch size; latency is not."',
  after:
    'Throughput rises and flattens as batch size grows, while latency keeps rising and goes vertical past the knee. A bare tok/s figure is likely taken at that knee.',
  why: 'Latency is not non-monotonic in batch size. It rises with it, so the contrast was wrong. The real point is that throughput saturates while latency blows up, which is why peak tok/s misleads.',
} satisfies Erratum
