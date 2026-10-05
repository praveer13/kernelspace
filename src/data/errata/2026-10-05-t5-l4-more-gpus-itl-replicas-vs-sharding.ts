import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t5-l4-more-gpus-itl-replicas-vs-sharding',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t5.l4'],
  title: 'Extra replicas leave ITL unchanged; sharding one model across GPUs can lower it',
  before:
    'The T5.L4 quiz said more GPUs with the same model will NOT improve per-token decode latency (ITL), treating every extra GPU alike.',
  after:
    'Independent replicas leave one request\'s ITL unchanged. Sharding one model across GPUs (tensor parallelism) cuts the weight bytes each GPU reads per step and can lower ITL until communication dominates. The quiz now says replicas.',
  why: 'The blanket claim is false for tensor parallelism, which T5.L9 teaches. Replicas buy capacity; sharding buys latency. Which one you add decides whether ITL moves.',
  source: {
    url: 'https://arxiv.org/abs/1909.08053',
    title: 'Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism (tensor-sharded layers)',
  },
  items: [
    {
      q: 'A 70B FP16 model moves from 2 GPUs to tensor parallelism across 8 GPUs. What happens to the weight bytes each GPU reads per decode step?',
      options: [
        'They stay the same as each GPU still needs the full weights for its part of each layer',
        'They fall to about a quarter as each GPU holds a smaller shard of the weights',
        'They rise as each GPU also reads the weights its neighbours hold to combine partial results',
        'They stay the same per GPU and any speedup comes from extra tensor-core FLOPs at this size',
      ],
      correct: [1],
      why: [
        'Tensor parallelism splits each weight matrix across GPUs, so a GPU reads only its shard. Replication is what keeps the full weights on every GPU.',
        'Right: 140 GB over 8 GPUs is about 17.5 GB each, against 70 GB each on 2 GPUs. Per-GPU read time falls, minus all-reduce cost.',
        'Each GPU computes on its own shard and exchanges activations, not weights, over the interconnect.',
        'Decode at small batch is bandwidth-bound, so the gain comes from reading fewer bytes per GPU, not from spare FLOPs.',
      ],
    },
  ],
} satisfies Erratum
