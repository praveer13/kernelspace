import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t2-l7-no-quantum',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t2.l7'],
  title: 'vLLM schedules at step granularity, and the iteration is not a quantum',
  before: 'The PagedAttention exam called vLLM "a timesharing system: the GPU is the CPU, the iteration is the quantum, and HBM is the RAM."',
  after:
    'vLLM re-decides its batch after every decode step: the step is a scheduling boundary, not a quantum, and nothing is time-sliced. The paper preempts first-come-first-serve, latest request first, when GPU blocks run out.',
  why: 'T2.L4 now teaches that continuous batching has no quantum, and the exam contradicted it. A quantum interrupts a running job at a fixed length; a decode step ends on its own, and preemption follows free KV blocks.',
  source: {
    url: 'https://arxiv.org/abs/2309.06180',
    title: 'Kwon et al., Efficient Memory Management for Large Language Model Serving with PagedAttention (SOSP 2023), §4.5',
  },
} satisfies Erratum
