import type { Erratum } from './schema'

export default {
  id: '2026-10-04-inferencemax-renamed-inferencex',
  date: '2026-10-04',
  kind: 'changed',
  lessons: ['t6.l5', 't6.l6', 't7.l2', 't7.l3', 't7.l4'],
  title: 'SemiAnalysis InferenceMAX is now InferenceX',
  before: 'Five lessons called the open nightly benchmark "InferenceMAX".',
  after:
    'The benchmark is InferenceX (formerly InferenceMAX), in the SemiAnalysisAI/InferenceX repository. Each lesson names it "InferenceX (formerly InferenceMAX)" once, then "InferenceX".',
  why: 'The project now goes by InferenceX in its repository and releases (v2 is dated 2026-02), so a learner following a lesson to the source should meet the name that is there.',
  source: { url: 'https://github.com/SemiAnalysisAI/InferenceX', title: 'SemiAnalysisAI/InferenceX (formerly InferenceMAX)' },
} satisfies Erratum
