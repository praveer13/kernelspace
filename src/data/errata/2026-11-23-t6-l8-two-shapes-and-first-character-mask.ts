import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t6-l8-two-shapes-and-first-character-mask',
  date: '2026-11-23',
  kind: 'error',
  lessons: ['t6.l8'],
  title: 'T6.L8 said "three shapes" over two, and gave a first-character mask both failure modes',
  before:
    'T6.L8 said "Three shapes define 2026 products" and described two. It said a first-character mask admits impossible suffixes and rejects legal tokens that cross states. It gave 85-95% shared prefix without a source.',
  after:
    'Two shapes follow. A first-character mask can only over-admit; rejecting boundary-crossing tokens is a different naive design (match the token against one terminal). The 85-95% is the course\'s estimate.',
  why: 'A token whose first byte is legal always passes a first-byte check, so that check never rejects a legal token. No source gives the 85-95% shared-prefix range.',
  source: {
    url: 'https://arxiv.org/abs/2411.15100',
    title: 'XGrammar: Flexible and Efficient Structured Generation Engine for Large Language Models (token masks over byte-level grammar states)',
  },
} satisfies Erratum
