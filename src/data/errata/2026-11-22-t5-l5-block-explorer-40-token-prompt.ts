import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t5-l5-block-explorer-40-token-prompt',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t5.l5'],
  title: 'The block-table explorer shares a 40-token prompt: copy-on-write copies 8 tokens and a 64-token block wastes 24',
  before:
    'The explorer shared a 48-token prompt, so its last block was full. Its copy-on-write task graded 16 tokens, and its block-size task graded 16 unused slots at 64-token blocks.',
  after:
    'The prompt is 40 tokens: two full blocks and one holding 8. Copy-on-write copies those 8 tokens (a full block is never written), and a 64-token block leaves 24 slots unused.',
  why: 'A shared full block needs no copy; only a partly filled tail is written. Sizes, ids and credit already earned are unchanged: an earlier 16 stays graded as it was and a new run is graded against the new answer.',
} satisfies Erratum
