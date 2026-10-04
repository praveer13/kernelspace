import type { Erratum } from './schema'

export default {
  id: '2026-10-04-speculation-one-formula',
  date: '2026-10-04',
  kind: 'changed',
  lessons: ['t5.l8', 't6.l6'],
  title: 'One formula for speculative decoding, and why k differs by setting',
  before: 'T5 taught a draft length of K ≈ 4–8 with no formula. T6 taught K = 2–4 and "1 + Σ acceptanceᵢ (geometric-ish)". The two ranges looked contradictory.',
  after: 'Both lessons use E = (1 − α^(k+1)) / (1 − α) expected tokens per verification step. k ≈ 4–8 is a cheap separate draft model; k ≈ 2–4 is MTP, where each extra depth costs a layer and α falls with depth.',
  why: 'The same function now underlies both ranges, so the difference is a property of the drafter, not an inconsistency in the course.',
  source: { url: 'https://arxiv.org/abs/2211.17192', title: 'Leviathan et al., Fast Inference from Transformers via Speculative Decoding (expected tokens per step)' },
} satisfies Erratum
