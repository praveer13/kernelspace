import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t6-l4-deepseek-decode-no-tp-five-stage',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t6.l4'],
  title: 'DeepSeek decode replicates attention (DP144, no TP) and overlaps with a 5-stage pipeline',
  before: 'The lesson said every GPU in these deployments sits inside a TP group, and gave dual-batch overlap as DeepSeek decode\'s overlap scheme.',
  after: 'DeepSeek decode runs routed experts at EP144 and MLA plus the shared expert at DP144, so attention is replicated. Dual-batch overlap is its prefill scheme; decode splits attention in two steps and uses a 5-stage pipeline.',
  why: 'TP groups are true of Meta\'s CP hosts, not of DeepSeek decode. The overlap scheme differs by phase because decode stage times are unbalanced.',
  source: {
    url: 'https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md',
    title: 'DeepSeek open-infra-index, Day 6: inference system overview',
  },
} satisfies Erratum
