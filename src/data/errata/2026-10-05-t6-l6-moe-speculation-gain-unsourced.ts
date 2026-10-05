import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t6-l6-moe-speculation-gain-unsourced',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t6.l6', 't7.l3'],
  title: 'Speculation on MoE: 2–3× is a DeepSeek-R1 result, with no sourced dense comparison',
  before:
    'T6.L6 said speculative decoding gains "2–3× on MoE vs ~1.5–2× on dense, per NVIDIA\'s and SemiAnalysis\' published numbers", and that a MoE verify pass has low marginal cost.',
  after:
    'The sources report MTP on DeepSeek-R1 only: up to 2–3× at some iso-interactivity points (SemiAnalysis) and 2.16× at batch 1 on 8 B200 (NVIDIA). None gives a dense figure, and k drafted tokens can touch more experts than one step.',
  why: 'No cited source gave a 1.5–2× dense figure. MoE can gain more at medium batch sizes because experts stay memory-bound longer, but verifying k tokens can read more expert weights than a single decode step.',
  source: {
    url: 'https://newsletter.semianalysis.com/p/inferencemax-open-source-inference',
    title: 'SemiAnalysis: InferenceMAX, open-source inference benchmarking (DeepSeek R1 MTP on and off)',
  },
  items: [
    {
      q: 'Which statement about speculative decoding on MoE models do the T6.L6 sources support?',
      options: [
        'MTP gains of up to 2–3× were reported on DeepSeek-R1 only',
        'MoE models gain 2–3× from MTP while dense models gain 1.5–2×, so a MoE always benefits more',
        'Verifying k drafted tokens reads the same expert weights as one ordinary decode step',
        'Speculation helps a MoE most at saturated batch sizes, where no compute is left idle',
      ],
      correct: [0],
      why: [
        'Right: SemiAnalysis measured up to 2–3× for DeepSeek-R1 MTP at some iso-interactivity points, and NVIDIA 2.16× at batch 1. Neither source reports a dense-model figure.',
        'No source gave the dense 1.5–2× figure, so the ratio is unsupported. MoE can gain more at medium batch sizes, but "always" is not established.',
        'Drafted tokens can route to different experts, so verification can read more expert weights than a single step. Only at larger batches do the reads overlap.',
        'Speculation spends idle compute, and a saturated batch has none. The gain is at small and medium batches, where decode is still bandwidth-bound.',
      ],
    },
  ],
} satisfies Erratum
