import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t5-l8-speculative-output-distribution',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t5.l8'],
  title: 'Speculative decoding preserves the output distribution; it is not bit-identical',
  before: 'Speculative decoding gives 1.5 to 2.5 times faster decode "with bit-identical output", and the guess-validate-rollback pattern was "bit-identical either way".',
  after: 'The guarantee is on the output distribution, up to floating-point rounding. vLLM also ships an opt-in verifier, FLy, that relaxes the check and is not distribution preserving.',
  why: 'Leviathan et al. promise acceleration "without changing the distribution", and vLLM calls its sampler lossless only "up to the precision limits of hardware numerics". A sampled run can differ token by token.',
  source: {
    url: 'https://arxiv.org/abs/2211.17192',
    title: 'Leviathan, Kalman and Matias: Fast Inference from Transformers via Speculative Decoding',
  },
} satisfies Erratum
