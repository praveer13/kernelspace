import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t7-l2-knee-and-step-32',
  date: '2026-11-23',
  kind: 'error',
  lessons: ['t7.l2'],
  title: 'T7.L2: a p95 grows with run length only past capacity, and step 32 of the worked sweep serves fewer tokens per second',
  before:
    'The broken-benchmark note said a p95 taken past the knee depends on how long the run lasted, and Rule 3\'s worked sweep said step 32 "may still add tokens per second".',
  after:
    'A p95 taken past capacity depends on run length; between the knee and capacity the queue stays bounded. Step 32 serves fewer tokens per second than 16: 32 ÷ 240 ms is less than 16 ÷ 96 ms.',
  why: 'The knee is at or below the goodput peak, which usually sits a little below Little\'s-law capacity, so a load past the knee can still offer less than capacity. Tokens per second is streams over TPOT.',
  source: {
    url: 'https://www.usenix.org/conference/nsdi-06/open-versus-closed-cautionary-tale',
    title: 'Schroeder, Wierman and Harchol-Balter: Open Versus Closed: A Cautionary Tale (NSDI 2006)',
  },
} satisfies Erratum
