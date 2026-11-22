import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t5-l8-medusa-removed-from-vllm',
  date: '2026-11-22',
  kind: 'changed',
  lessons: ['t5.l8'],
  title: 'Medusa was removed from vLLM in v0.33.0',
  before: 'The variants list named "Medusa/EAGLE" as drafting with extra heads on the target model, as methods one can use in the wild.',
  after: 'The lesson names EAGLE and MTP, says Medusa was removed from vLLM in v0.33.0, and lists the methods vLLM documents at v0.34.0.',
  why: 'The v0.33.0 series release notes list "Medusa and the MLP speculator were removed (#61701)" under breaking changes. A learner who tries Medusa on current vLLM finds it gone.',
  source: {
    url: 'https://github.com/vllm-project/vllm/releases/tag/v0.33.0rc3',
    title: 'vLLM v0.33.0rc3 release notes',
  },
} satisfies Erratum
