import type { Erratum } from './schema'

export default {
  id: '2026-10-04-vllm-v1-swap-in-t5-l7-l9',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t5.l7', 't5.l9'],
  title: 'vLLM V1 preempts by recompute; swap-to-CPU is the old V0 path',
  before:
    'Continuous batching "swaps preempted sequences out and back" to CPU RAM; the quiz key said preemption means swap or recompute, and PCIe was "vLLM\'s swap path".',
  after:
    'In vLLM V1 a preempted sequence loses its blocks and is recomputed on resume. Swapping KV to CPU RAM was the V0 option and survives here as history and as the trade-off it taught.',
  why: 'T5.L5 and T5.L10 already teach V1 recompute; T5.L7 and T5.L9 contradicted them. Recompute spends compute where swap spent PCIe bandwidth, which changes how you read a preemption storm.',
  source: {
    url: 'https://docs.vllm.ai/en/latest/configuration/optimization/',
    title: 'vLLM docs: Optimization and Tuning (preemption mode is RECOMPUTE in V1)',
  },
} satisfies Erratum
