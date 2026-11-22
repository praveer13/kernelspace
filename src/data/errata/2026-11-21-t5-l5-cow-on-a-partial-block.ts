import type { Erratum } from './schema'

export default {
  id: '2026-11-21-t5-l5-cow-on-a-partial-block',
  date: '2026-11-21',
  kind: 'error',
  lessons: ['t5.l5'],
  title: 'Copy-on-write copies a partly filled block, and the fork is the 2023 paper\'s',
  before:
    'Figure 1 showed beam search forking inside a full block and copying 16 tokens of KV; the listing was labelled as simplified vLLM V1.',
  after:
    'A full block is never written again. The copy happens when a beam appends to a partly filled shared tail block: 8 tokens of a 40-token prompt. The fork is the 2023 paper\'s design; vLLM V1 has no fork.',
  why: 'A shared full block needs no copy. Only the tail can be written, so only a partly filled tail is copied, and the copy is smaller than a block.',
  source: {
    url: 'https://github.com/vllm-project/vllm/blob/v0.34.0/docs/design/prefix_caching.md',
    title: 'vLLM v0.34.0, docs/design/prefix_caching.md ("We only cache full blocks.")',
  },
} satisfies Erratum
