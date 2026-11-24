import type { Erratum } from './schema'

export default {
  id: '2026-11-23-t7-l3-frontier-is-downward-sloping',
  date: '2026-11-23',
  kind: 'error',
  lessons: ['t7.l3'],
  title: 'T7.L3 called the frontier concave and spliced two comparisons into one',
  before:
    'T7.L3 called the frontier "concave" and put a GB200 NVL72 "leading at 30 tok/s/user" against a B200 beating it "above 90" as one comparison.',
  after:
    'The frontier slopes downward and need not be concave. The 90 tok/s/user crossover is on TCO per million tokens; the 30 tok/s/user figure is tokens per all-in provisioned MW (GB200 NVL72 at FP4 ~8x a single-node H200 at FP8).',
  why: 'The lesson\'s own worked points fall at slopes of about -33, -40 and -10 tok/s/GPU per tok/s/user, which is not concave. The article makes the 90 and 30 statements in two different comparisons.',
  supersedes: '2026-10-05-t7-l3-inferencemax-deepseek-attribution',
  source: {
    url: 'https://newsletter.semianalysis.com/p/inferencemax-open-source-inference',
    title: 'SemiAnalysis: InferenceMAX, Open Source Inference Benchmarking (2025-10-09; DeepSeek R1 FP4 TCO per million tokens and tokens per provisioned MW)',
  },
} satisfies Erratum
