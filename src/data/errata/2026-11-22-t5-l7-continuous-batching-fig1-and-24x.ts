import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t5-l7-continuous-batching-fig1-and-24x',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t5.l7'],
  title: 'The batching figure matches its trace, the 24x is the launch post\'s, and vLLM evicts the newest request',
  before: 'The figure freed A, B and C at step 9, though they finish at 8, 12 and 20. "Up to ~24x vs naive" was credited to the paper. Evicting the youngest request was said to starve long requests.',
  after: 'Only A leaves at step 9; B leaves at 12 and C at 20. The 24x is the 2023 launch post against Hugging Face Transformers. vLLM evicts the newest request, which protects long ones; evicting the oldest discards the most work.',
  why: 'The figure now follows the 8/12/20/40 trace. The paper reports 2-4x over FasterTransformer and Orca, not 24x. The scheduler\'s victim line is running[-1], the last admitted request.',
  source: {
    url: 'https://github.com/vllm-project/vllm/blob/v0.34.0/vllm/v1/core/sched/scheduler.py',
    title: 'vLLM v0.34.0, vllm/v1/core/sched/scheduler.py',
  },
} satisfies Erratum
