import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t6-l3-kimi-benchmark-and-mooncake-date',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t6.l3'],
  title: 'The Kimi K2 numbers are a Mooncake-team benchmark, not Moonshot production',
  before: "Kimi's production numbers at K2 scale: 128xH200, 224k tok/s prefill / 288k tok/s decode, with Mooncake's pool underneath. Mooncake entered the PyTorch ecosystem (Jan 2026).",
  after: "Mooncake joined the PyTorch ecosystem. The Mooncake team's post on Kimi K2 with SGLang is a benchmark, not Moonshot's production: one cluster, one fixed input and output length. The FAST'25 paper's production claim is a different one.",
  why: 'A benchmark at one fixed input and output length says what a tuned cluster does on that workload, not what a production service sustains. The lesson links the post and leaves its figures to it.',
  source: {
    url: 'https://lmsys.org/blog/2025-07-20-k2-large-scale-ep/',
    title: 'Deploying Kimi K2 with PD Disaggregation and Large-Scale Expert Parallelism on 128 H200 GPUs (The Mooncake Team, July 20, 2025)',
  },
  items: [
    {
      q: 'A post reports 224k tokens/sec prefill and 288k decode for Kimi K2 on 128 H200 GPUs at 2,000 tokens in and 100 out. What does it show?',
      options: [
        'What one tuned cluster reached on that fixed workload, and longer outputs would give different numbers',
        'What Moonshot AI sustains across its live production traffic, whatever the request lengths turn out to be',
        'A per-node rate that any 8-GPU server reaches once it runs the same software and the same flags',
        'A latency guarantee that holds at every context length that the model supports in service',
      ],
      correct: [0],
      why: [
        'Right: the post calls it a benchmark with a stated workload, and says longer outputs for agentic scenarios are future work.',
        'The post is a benchmark by the Mooncake and SGLang teams, with a fixed 2,000-in, 100-out workload, not a production traffic report.',
        'The totals are cluster-level: 224k comes from four prefill nodes and 288k from twelve decode nodes, not from one node.',
        'It is a throughput figure at one input and output length. It makes no latency promise at other context lengths.',
      ],
    },
  ],
} satisfies Erratum
