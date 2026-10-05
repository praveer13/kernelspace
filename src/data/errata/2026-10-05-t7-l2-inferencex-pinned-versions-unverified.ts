import type { Erratum } from './schema'

export default {
  id: '2026-10-05-t7-l2-inferencex-pinned-versions-unverified',
  date: '2026-10-05',
  kind: 'error',
  lessons: ['t7.l2'],
  title: 'The InferenceX "pinned versions" claim could not be verified, so it was removed',
  before:
    'T7.L2 said InferenceX\'s value is procedural: "nightly runs, pinned versions, public runs", which also listed the same property twice.',
  after:
    'SemiAnalysis states that the suite re-runs every night on hundreds of chips, and the runs are public. Version pinning is not stated in the sources checked, so the lesson no longer claims it.',
  why: 'A procedural strength is only worth teaching if the project states it. Nightly cadence and public runs are documented; pinned versions were an assumption, so the lesson keeps only what a reader can verify.',
  source: {
    url: 'https://newsletter.semianalysis.com/p/inferencemax-open-source-inference',
    title: 'SemiAnalysis: InferenceMAX, Open Source Inference Benchmarking (2025-10-09; "runs our suite of benchmarks every night")',
  },
} satisfies Erratum
