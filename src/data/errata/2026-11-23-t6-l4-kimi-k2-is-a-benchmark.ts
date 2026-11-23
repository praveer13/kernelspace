import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t6-l4-kimi-k2-is-a-benchmark',
  date: '2026-11-23',
  kind: 'error',
  lessons: ['t6.l4'],
  title: 'The reference card\'s Kimi K2 entry is a Mooncake-team benchmark, not a production config',
  before: 'Three production configs to recite: … Kimi K2 — 128×H200, P/D disaggregation + large-scale EP, 224k/288k tok/s prefill/decode (lmsys.org, Jul 2025).',
  after: 'Three published configs to recite (one production service, two reported runs): … Kimi K2 benchmark — P/D disaggregation + large-scale EP on SGLang at one fixed input and output length (the Mooncake team\'s post), not Moonshot\'s production.',
  why: 'The post benchmarks one cluster at one fixed input and output length, as T6.L3 says. Meta\'s post reports measured runs. Only DeepSeek\'s page describes a production service.',
  source: {
    url: 'https://lmsys.org/blog/2025-07-20-k2-large-scale-ep/',
    title: 'Deploying Kimi K2 with PD Disaggregation and Large-Scale Expert Parallelism on 128 H200 GPUs (The Mooncake Team, July 20, 2025)',
  },
} satisfies Erratum
