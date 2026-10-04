import type { Erratum } from './schema'

export default {
  id: '2026-10-04-vllm-v1-swap-in-sims',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t5.l5', 't5.l7', 't2.l3'],
  title: 'Sims showed KV swap as vLLM preemption; V1 recomputes, swap is V0',
  before:
    'The batching sim logged "KV swapped out ≡ OS swap" on preemption, the block-table sim offered swap-to-CPU beside recompute unlabelled, and the Glossary called preemption "swap a sequence\'s KV out".',
  after:
    'Swap-to-CPU is the V0 / PagedAttention-paper (SOSP\'23 §4) option, now labelled as such. vLLM V1 frees the victim\'s blocks and recomputes it later; prefix-cache hits or KV offload can shorten that.',
  why: 'The lessons already teach V1 recompute; the interactive sims and Glossary contradicted them. Recompute spends compute where swap spent PCIe bandwidth, so the label decides how you read a preemption storm.',
  source: {
    url: 'https://docs.vllm.ai/en/latest/configuration/optimization/',
    title: 'vLLM docs: Optimization and Tuning (preemption mode is RECOMPUTE in V1)',
  },
} satisfies Erratum
