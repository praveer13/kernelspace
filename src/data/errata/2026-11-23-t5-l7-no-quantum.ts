import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t5-l7-no-quantum',
  date: '2026-11-23',
  kind: 'error',
  lessons: ['t5.l7'],
  title: 'Continuous batching has no quantum: the decode step is a scheduling boundary',
  before:
    'T5.L7 said "The batch is the timeslice; the iteration is the quantum", called a model step "The quantum of work." and gave the step\'s time as the quantum of a "timesharing system".',
  after:
    'The decode step is the scheduling boundary, not a quantum, and nothing is time-sliced; the KV block manager is the admission controller.',
  why: 'T2.L4 and T2.L7 teach that continuous batching has no quantum, and this lesson contradicted them. A quantum ends on a timer and interrupts running work; a decode step ends on its own, and the batch is re-decided after it.',
  source: {
    url: 'https://arxiv.org/html/2309.06180v1',
    title: 'Kwon et al., Efficient Memory Management for Large Language Model Serving with PagedAttention (SOSP 2023), §2.3',
  },
} satisfies Erratum
