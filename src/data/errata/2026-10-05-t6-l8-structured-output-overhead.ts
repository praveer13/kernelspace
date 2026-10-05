import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t6-l8-structured-output-overhead',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t6.l8'],
  title: 'XGrammar overlaps grammar work with GPU execution and reports near-zero overhead, not "a few percent"',
  before:
    'The Q3 explanation said constraint engines compile an automaton and apply token masks on-GPU per step, at "a few percent overhead instead of per-token CPU–GPU sync".',
  after:
    'XGrammar keeps a persistent stack for context-dependent token checks and overlaps grammar computation with GPU execution. Its paper reports near-zero overhead end to end; the unsourced "few percent" figure is removed.',
  why: 'The mechanism is overlap of grammar work with GPU execution, not a GPU-resident mask table, and a percentage we could not source should not be taught as a measurement.',
  source: {
    url: 'https://arxiv.org/abs/2411.15100',
    title: 'XGrammar: Flexible and Efficient Structured Generation Engine for Large Language Models',
  },
} satisfies Erratum
