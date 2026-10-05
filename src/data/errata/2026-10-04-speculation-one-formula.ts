import type { Erratum } from './schema'

export default {
  id: '2026-10-04-speculation-one-formula',
  date: '2026-10-04',
  kind: 'changed',
  lessons: ['t5.l8', 't6.l6'],
  title: 'One formula for speculative decoding, and why k differs by setting',
  before: 'T5 taught a draft length of K ≈ 4–8 with no formula. T6 taught K = 2–4 and "1 + Σ acceptanceᵢ (geometric-ish)". The two ranges looked contradictory.',
  after: 'Both lessons use E = (1 − α^(k+1)) / (1 − α) expected tokens per verification step. k ≈ 4–8 is a cheap separate draft model; k ≈ 2–4 is MTP, where one trained module is rerun for each extra step, which adds latency and lowers α.',
  why: 'The same function now underlies both ranges, so the difference is a property of the drafter, not an inconsistency in the course.',
  source: { url: 'https://arxiv.org/abs/2211.17192', title: 'Leviathan et al., Fast Inference from Transformers via Speculative Decoding (expected tokens per step)' },
  items: [
    {
      q: 'A drafter has per-token acceptance alpha = 0.8 and drafts k = 3 tokens. With E = (1 - alpha^(k+1)) / (1 - alpha), how many tokens does one verification step yield in expectation?',
      options: [
        '3.40 tokens',
        '2.95 tokens',
        '1.95 tokens',
        '2.40 tokens',
      ],
      correct: [1],
      why: [
        'That is 1 + k * alpha. It treats each acceptance as independent, but a rejection ends the run, so the terms are alpha^i.',
        'Right. (1 - 0.8^4) / 0.2 = (1 - 0.4096) / 0.2 = 2.952, which is 1 + 0.8 + 0.64 + 0.512.',
        'That sums alpha + alpha^2 + alpha^3 and leaves out the token the target always produces, the alpha^0 term.',
        'That is k * alpha. It drops the guaranteed token and the compounding of acceptances.',
      ],
    },
  ],
} satisfies Erratum
