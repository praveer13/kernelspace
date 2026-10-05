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
  items: [
    {
      q: 'How does XGrammar keep grammar-constrained decoding from slowing generation, according to its paper?',
      options: [
        'It builds a GPU table of masks for each grammar state, and reports a few percent overhead',
        'It overlaps grammar computation with GPU execution and reports near-zero overhead',
        'It syncs the CPU and GPU at each token to build the mask and reports a few percent overhead',
        'It samples freely and retries rejected tokens until the output parses on the GPU',
      ],
      correct: [1],
      why: [
        'Context-dependent token checks cannot all be tabulated ahead of time. XGrammar does grammar work on the CPU and hides it behind GPU execution.',
        'Right: XGrammar overlaps grammar computation with GPU execution and keeps a persistent stack for context-dependent checks. Its paper reports near-zero end-to-end overhead.',
        'A per-token CPU to GPU sync is exactly the stall that overlap avoids. XGrammar hides the mask work behind the GPU step instead of waiting on it.',
        'Constrained decoding masks invalid tokens before sampling, so the output stays valid at every step. It does not sample freely and retry afterwards.',
      ],
    },
  ],
} satisfies Erratum
