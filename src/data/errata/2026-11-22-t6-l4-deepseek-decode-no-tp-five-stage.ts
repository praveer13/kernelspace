import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t6-l4-deepseek-decode-no-tp-five-stage',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t6.l4'],
  title: 'DeepSeek decode replicates attention (DP144, no TP); its two micro-batches overlap in a 5-stage pipeline',
  before: 'The lesson said every GPU in these deployments sits inside a TP group, DeepSeek decode\'s included.',
  after: 'DeepSeek decode runs routed experts at EP144 and MLA plus the shared expert at DP144, so attention is replicated. Like prefill it splits the batch into two micro-batches; decode splits attention in two steps and runs a 5-stage pipeline.',
  why: 'TP groups are true of Meta\'s CP hosts, not of DeepSeek decode. Both phases overlap two micro-batches; decode pipelines them in five stages because its stage times are unbalanced.',
  source: {
    url: 'https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md',
    title: 'DeepSeek open-infra-index, Day 6: inference system overview',
  },
} satisfies Erratum
