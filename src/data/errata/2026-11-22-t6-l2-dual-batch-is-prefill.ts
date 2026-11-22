import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t6-l2-dual-batch-is-prefill',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t6.l2'],
  title: 'Two alternating micro-batches are DeepSeek\'s prefill scheme; decode uses a 5-stage pipeline',
  before: 'The lesson presented dual-batch overlap, two micro-batches pipelined against each other, as the single mechanism that hides the all-to-all in wide EP.',
  after: 'In prefill DeepSeek runs two micro-batches alternately. In decode the stage times are unbalanced, so it subdivides attention into two steps and uses a 5-stage pipeline.',
  why: 'The overlap idea is the same, but the decode schedule differs because its stages are unequal. Treating one scheme as universal hides why decode needs a different pipeline.',
  source: {
    url: 'https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md',
    title: 'DeepSeek open-infra-index, Day 6: inference system overview',
  },
} satisfies Erratum
