import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t6-l1-moe-18x-is-batch-1-and-round-trips',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t6.l1'],
  title: 'The ~18x is the whole model at batch 1, the latency floor is one dispatch and one combine per MoE layer, and not every open frontier model is an MoE',
  before: 'MoE divides decode bytes by ~18 for the FFN part; latency floor = round-trip x 2 x layers; every frontier open model of 2025-2026 is an MoE.',
  after: 'At batch 1, 671B/37B is ~18x for the whole model and the expert path is ~28x (9 of 257 experts). The floor is one dispatch and one combine in each of 58 MoE layers. Some open models are dense.',
  why: 'The 18 divides whole-model totals, not the FFN path. A round trip already holds both all-to-alls, so doubling it counted twice. The list was a dated snapshot.',
  source: {
    url: 'https://huggingface.co/deepseek-ai/DeepSeek-V3/raw/e815299b0bcbac849fa540c768ef21845365c9eb/config.json',
    title: 'DeepSeek-V3 config.json at a pinned revision (DeepSeek, Hugging Face)',
  },
} satisfies Erratum
