import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t2-l1-no-timeslice',
  date: '2026-11-23',
  kind: 'error',
  lessons: ['t2.l1'],
  title: 'Continuous batching has no timeslice: the decode step is a scheduling boundary',
  before: 'T2.L1 said "Waiting requests get a slot in the next GPU iteration — the batch is the timeslice."',
  after: 'Waiting requests get a slot at the next decode step; the step is a scheduling boundary, not a timeslice.',
  why: 'T2.L4 and T2.L7 teach that continuous batching has no quantum, and this row contradicted them. A timeslice ends on a timer and interrupts its thread; a decode step ends on its own and serves the whole batch.',
  source: {
    url: 'https://arxiv.org/html/2309.06180v1',
    title: 'Kwon et al., Efficient Memory Management for Large Language Model Serving with PagedAttention (SOSP 2023), §2.3',
  },
} satisfies Erratum
