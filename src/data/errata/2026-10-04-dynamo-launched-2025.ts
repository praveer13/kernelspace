import type { Erratum } from './schema'

export default {
  id: '2026-10-04-dynamo-launched-2025',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t0.l1'],
  title: 'NVIDIA Dynamo launched in March 2025, not 2024',
  before: 'The T0.L1 timeline statline read "2024 · Dynamo: NVIDIA ships a disaggregated serving stack with a Rust data plane."',
  after: 'Dynamo launched at GTC in March 2025; the ai-dynamo/dynamo repository was created on 2025-03-03. The statline now reads 2025.',
  why: 'A timeline anchor that is a year early misplaces Dynamo relative to the engines it orchestrates and to the V1 vLLM rewrite it postdates.',
  source: {
    url: 'https://github.com/ai-dynamo/dynamo',
    title: 'ai-dynamo/dynamo repository (created 2025-03-03)',
  },
} satisfies Erratum
