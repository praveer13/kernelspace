import type { Erratum } from './schema'

export default {
  id: '2026-10-19-t7-l1-tpot-is-a-period',
  date: '2026-10-19',
  kind: 'error',
  lessons: ['t7.l1'],
  title: 'TPOT is a period of at least bytes ÷ bandwidth; bandwidth ÷ bytes is a rate',
  before:
    'T7.L1 defined "TPOT/ITL (per-token decode period): bandwidth ÷ (weight+KV bytes), divided by batch efficiency."',
  after:
    'That ratio is a rate (tokens per second). The period is at least (weight + KV bytes) ÷ bandwidth, the datasheet bound; measured periods on 4 H100s ran 2.2× and 3.1× it (InferenceX ids 41187, 41821).',
  why: 'A period is seconds per token, so the formula had its units upside down. Calling the bound the period would also promise steps two to three times faster than the measured ones.',
  source: {
    url: 'https://inferencex.semianalysis.com/api/v1/benchmarks?model=Llama-3.3-70B-Instruct-FP8&date=2025-10-29&exact=true',
    title: 'InferenceX API: Llama-3.3-70B-Instruct-FP8 benchmarks of 2025-10-29 (mean_tpot is seconds per token)',
  },
  items: [
    {
      q: 'A decode step streams B bytes from HBM, and the GPUs\' datasheet bandwidth is W bytes per second. What do W ÷ B and B ÷ W tell you about TPOT?',
      options: [
        'W ÷ B is TPOT itself, the time per output token at that bandwidth',
        'B ÷ W is a floor on TPOT, and W ÷ B is a rate in steps per second',
        'B ÷ W is TPOT exactly, as decode moves only those bytes in a step',
        'W ÷ B is a floor on TPOT, and B ÷ W is a rate in steps per second',
      ],
      correct: [1],
      why: [
        'Bandwidth over bytes has units of per second: it is a rate, steps (and each user\'s tokens) per second. TPOT is its inverse, a time per token.',
        'Right: bytes over bandwidth is the least time streaming them can take, and fixed per-step costs come on top. On 4 H100s the measured TPOT ran 2.2× and 3.1× it.',
        'Nothing reaches the datasheet rate for free, and streaming is not all a step does. On 4 H100s the measured TPOT ran 2.2× and 3.1× this figure (InferenceX ids 41187, 41821).',
        'The roles are swapped. Bandwidth over bytes is a rate, and a rate cannot bound a time; bytes over bandwidth is the time.',
      ],
    },
  ],
} satisfies Erratum
