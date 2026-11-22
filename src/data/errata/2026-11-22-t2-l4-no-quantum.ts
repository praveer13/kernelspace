import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t2-l4-no-quantum',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t2.l4'],
  title: 'Continuous batching has no quantum, a decode step is not "~50 ms", and Little\'s Law does not say queues grow',
  before:
    'T2.L4 said the batch is the timeslice and the iteration is the quantum, after a decode step of "~50 ms", and that queues grow without bound (Little\'s Law).',
  after:
    'Continuous batching re-decides the batch every step and time-slices nothing; the step is a boundary, not a quantum. InferenceX measured a mean 11.8 ms per token. Little\'s Law, L = λW, holds for stable queues; overload grows them.',
  why: 'The lesson contradicted its own item that continuous batching has no quantum. The 50 ms had no source (see 2026-10-19-t5-l7-iteration-statline). Little\'s Law relates averages; overload, not the law, grows queues.',
  source: {
    url: 'https://inferencex.semianalysis.com/api/v1/benchmarks?model=Llama-3.3-70B-Instruct-FP8&date=2025-10-29&exact=true',
    title: 'InferenceX API: Llama-3.3-70B-Instruct-FP8 benchmarks of 2025-10-29 (mean_tpot of id 41187)',
  },
} satisfies Erratum
