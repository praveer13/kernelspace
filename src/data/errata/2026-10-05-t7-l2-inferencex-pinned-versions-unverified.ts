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
  items: [
    {
      q: 'T7.L2 calls InferenceX\'s value procedural. Which procedural strength can the lesson state, given what the project documents?',
      options: [
        'It re-runs its suite nightly with framework versions pinned and results differing by the engine under test',
        'It re-runs its suite nightly and publishes the runs openly for fresh public checks',
        'It runs once per release and shares results with vendors on one frozen set of numbers',
        'It publishes the numbers vendors submit after tuning with no independent re-run',
      ],
      correct: [1],
      why: [
        'Version pinning is not stated in the sources checked, so the lesson no longer claims it. Nightly cadence is documented; the pinning detail was an assumption added to it.',
        'Right: SemiAnalysis states that the suite re-runs every night and that the runs are public. Those two documented properties are what the lesson can credit, with nothing added.',
        'The cadence is nightly, not per release, and the runs are public rather than vendor-only. A frozen snapshot is the opposite of what a nightly public suite offers.',
        'Results come from public GitHub Actions runs of the suite, not from figures vendors submit after tuning. Treating every chart as an unchecked vendor claim misdescribes how the project works.',
      ],
    },
  ],
} satisfies Erratum
