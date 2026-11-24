import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the economics claims (t7 lane: load generators, Meta and MLPerf status, DeepSeek day-six benchmark, H100 and DeepSeek prices). Claims go here under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 *
 * `status.loadgen.*`: the status of the four load generators lesson t7.l2 names. Status claims live 60 days.
 *
 * `status.meta.*` and `status.mlperf.*`: Meta's two latency goals and MLPerf Inference's published TTFT and TPOT limits, read by lesson t7.l1 (K0-C27).
 *
 * `bench.deepseek-day6.*` and `price.deepseek.*`: the figures of DeepSeek's day-six page and its price lists, and
 * `price.h100.median-2026-11`: the dated H100 median lesson t7.l4 reads beside the 2026-10 one (K0-C3; owner question 12 default).
 */
const DAY6 = {
  url: 'https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/day_6_one_more_thing_deepseekV3R1_inference_system_overview.md',
  title: 'DeepSeek open-infra-index, Open-Source Week day 6: DeepSeek-V3/R1 Inference System Overview',
}
const DAY6_BOUNDARY =
  'DeepSeek\'s own totals for the 24 hours from 2025-02-27 12:00 to 2025-02-28 12:00 (UTC+8), all requests from web, app and API. The repository carries no release tag for the page, so the url is the file on its default branch as read on the verified date.'
const DEEPSEEK_PRICES = { url: 'https://api-docs.deepseek.com/quick_start/pricing', title: 'DeepSeek API Docs: Models & Pricing' }

const META_POST = {
  url: 'https://engineering.fb.com/2025/10/17/ai-research/scaling-llm-inference-innovations-tensor-parallelism-context-parallelism-expert-parallelism/',
  title: 'Meta Engineering: Scaling LLM Inference: Innovations in Tensor Parallelism, Context Parallelism, and Expert Parallelism (2025-10-17)',
}
const META_BOUNDARY =
  'A goal the post states for the user experience its inference optimizations serve, as read on the verified date. The post does not call it an SLO, does not name an app, and gives no percentile.'

const RULES_URL = 'https://github.com/mlcommons/inference_policies/blob/master/inference_rules.adoc'
const RULES_TITLE = 'MLCommons inference_policies, inference_rules.adoc (Datacenter benchmarks table, "Server latency constraint" column)'
const RULES_BOUNDARY =
  'MLPerf Inference limits per model and scenario, from the rules file on its default branch as read on the verified date (the repository gave no readable release tag for it; the file\'s own text names the 6.1 submissions, and the v6.1 results were published 2026-09-16). The limits change between rounds. MLPerf checks them at the 99th percentile under Poisson arrivals (status.mlperf.server-tail-percentile).'
const LLAMA_QUOTE = 'Conversational category: TTFT/TPOT: 2000 ms/100 ms. Interactive category: TTFT/TPOT: 500 ms/30 ms.'
const R1_QUOTE = 'Server: TTFT/TPOT: 2000 ms/80 ms. Interactive: TTFT/TPOT: 1500 ms/15 ms.'

function mlperfLimit(id: string, value: number, label: string, quote: string): Claim {
  return {
    id,
    kind: 'status',
    value,
    unit: 'ms',
    label,
    source: { url: RULES_URL, title: RULES_TITLE, quote },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary: RULES_BOUNDARY,
  }
}

const LATENCY_CLAIMS: Claim[] = [
  {
    id: 'status.meta.ttft-goal',
    kind: 'status',
    value: 350,
    unit: 'ms',
    label: 'Meta: first-token latency goal (TTFT)',
    source: {
      url: META_POST.url,
      title: META_POST.title,
      quote: 'Time-to-first-token (TTFT) for prefill: The time it takes for the first part of the response to appear, ideally under 350ms.',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary: META_BOUNDARY,
  },
  {
    id: 'status.meta.ttit-goal',
    kind: 'status',
    value: 25,
    unit: 'ms',
    label: 'Meta: gap-between-tokens goal (TTIT, time to incremental token)',
    source: {
      url: META_POST.url,
      title: META_POST.title,
      quote: 'Time-to-incremental-token (TTIT) for decoding: The latency between subsequent words, targeting less than 25ms.',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary: META_BOUNDARY,
  },
  mlperfLimit('status.mlperf.llama31-8b.conversational-ttft', 2000, 'MLPerf Inference Llama3.1-8B conversational TTFT limit', LLAMA_QUOTE),
  mlperfLimit('status.mlperf.llama31-8b.conversational-tpot', 100, 'MLPerf Inference Llama3.1-8B conversational TPOT limit', LLAMA_QUOTE),
  mlperfLimit('status.mlperf.llama31-8b.interactive-ttft', 500, 'MLPerf Inference Llama3.1-8B interactive TTFT limit', LLAMA_QUOTE),
  mlperfLimit('status.mlperf.llama31-8b.interactive-tpot', 30, 'MLPerf Inference Llama3.1-8B interactive TPOT limit', LLAMA_QUOTE),
  mlperfLimit('status.mlperf.deepseek-r1.server-ttft', 2000, 'MLPerf Inference DeepSeek-R1 server TTFT limit', R1_QUOTE),
  mlperfLimit('status.mlperf.deepseek-r1.server-tpot', 80, 'MLPerf Inference DeepSeek-R1 server TPOT limit', R1_QUOTE),
  mlperfLimit('status.mlperf.deepseek-r1.interactive-ttft', 1500, 'MLPerf Inference DeepSeek-R1 interactive TTFT limit', R1_QUOTE),
  mlperfLimit('status.mlperf.deepseek-r1.interactive-tpot', 15, 'MLPerf Inference DeepSeek-R1 interactive TPOT limit', R1_QUOTE),
  {
    id: 'status.mlperf.server-tail-percentile',
    kind: 'status',
    value: 99,
    unit: '%',
    label: 'MLPerf Inference server and interactive scenarios: tail latency percentile',
    source: {
      url: RULES_URL,
      title: 'MLCommons inference_policies, inference_rules.adoc (scenario table)',
      quote:
        '|Server/Interactive |LoadGen sends new queries to the SUT according to a Poisson distribution | 600 seconds |1 |Benchmark specific |99%*',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary:
      'From the rules file on its default branch as read on the verified date: queries arrive by a Poisson process, each run lasts at least 600 seconds, and the tail-latency percentile is 99%. The asterisk marks the theoretical lower limit for very long runs.',
  },
  {
    id: 'status.mlperf.round',
    kind: 'status',
    value: 'v6.1',
    label: 'Latest MLPerf Inference round read',
    source: {
      url: 'https://mlcommons.org/2026/09/mlperf-inference-v6-1-results/',
      title: 'MLCommons: MLPerf Inference v6.1 results (2026-09-16)',
      quote: 'MLCommons ® announced new results for its industry-standard MLPerf ® Inference v6.1 benchmark suite.',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary: 'The round whose results page was the newest read on the verified date; the page says MLPerf Endpoints will replace Inference for the datacenter, so a later round may not exist.',
  },
]

export const ECONOMICS_CLAIMS: Claim[] = [
  {
    id: 'status.loadgen.llmperf',
    kind: 'status',
    value: 'archived 2025-12-17, read-only',
    label: 'LLMPerf (Ray) repository status',
    source: {
      url: 'https://github.com/ray-project/llmperf',
      title: 'ray-project/llmperf on GitHub (repository banner)',
      quote: 'This repository was archived by the owner on Dec 17, 2025. It is now read-only.',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 60,
    boundary: 'The repository banner as read on the verified date; an archived repository takes no new changes.',
  },
  {
    id: 'status.loadgen.genai-perf',
    kind: 'status',
    value: 'being phased out; use AIPerf',
    label: 'GenAI-Perf (NVIDIA) status',
    source: {
      url: 'https://github.com/triton-inference-server/perf_analyzer/blob/main/genai-perf/README.md',
      title: 'GenAI-Perf README, triton-inference-server/perf_analyzer (line 31)',
      quote:
        'GenAI-Perf is being phased out. We are no longer actively developing new features for GenAI-Perf. For new performance benchmarking needs, please use AIPerf instead.',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 60,
    boundary: 'The README on the default branch as read on the verified date; the repository ships no release tag for this notice.',
  },
  {
    id: 'status.loadgen.guidellm',
    kind: 'status',
    value: 'live',
    label: 'GuideLLM status and traffic profiles',
    source: {
      url: 'https://github.com/vllm-project/guidellm/blob/v0.8.1/README.md',
      title: 'GuideLLM README at v0.8.1 (line 30)',
      quote:
        'Generates realistic, configurable traffic patterns across synchronous, concurrent, and rate-based modes, including reproducible sweeps to identify safe operating ranges.',
    },
    verifiedAt: '2026-11-23',
    ttlDays: 60,
    boundary:
      'The README at the tag supports "live" and the traffic profiles, nothing more. The recommendation is the vLLM docs\' (docs.vllm.ai, benchmarking CLI page, latest, read 2026-11-23): "For benchmarking production vLLM servers, we recommend GuideLLM, an established performance benchmarking framework with live progress updates and automatic report generation."',
    pin: { repo: 'vllm-project/guidellm', ref: 'v0.8.1' },
  },
  {
    id: 'status.loadgen.aiperf',
    kind: 'status',
    value: 'live',
    label: 'AIPerf status and benchmarking modes',
    source: {
      url: 'https://github.com/ai-dynamo/aiperf/blob/v0.14.0/README.md',
      title: 'AIPerf README at v0.14.0 (lines 130, 155, 229)',
      quote:
        'Multiple benchmarking modes: concurrency, request-rate, request-rate with max concurrency, trace replay',
    },
    verifiedAt: '2026-11-23',
    ttlDays: 60,
    boundary:
      'The same README lists "Arrival Patterns - Constant, Poisson, gamma traffic" and "Goodput - SLO-based throughput measurement". It does not call itself a replacement: that is the GenAI-Perf README\'s word (status.loadgen.genai-perf).',
    pin: { repo: 'ai-dynamo/aiperf', ref: 'v0.14.0' },
  },
  {
    id: 'bench.deepseek-day6.daily-cost',
    kind: 'benchmark',
    value: 87072,
    unit: 'USD/day',
    label: 'DeepSeek V3 and R1 serving cost for one day (its stated assumption)',
    source: {
      ...DAY6,
      quote: 'Assuming the leasing cost of one H800 GPU is $2 per hour, the total daily cost amounts to $87,072.',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 180,
    boundary: `${DAY6_BOUNDARY} The cost is leasing at the assumed $2 per H800-hour (price.deepseek.h800-hourly-assumption), not DeepSeek's books.`,
  },
  {
    id: 'bench.deepseek-day6.theoretical-revenue',
    kind: 'benchmark',
    value: 562027,
    unit: 'USD/day',
    label: 'DeepSeek V3 and R1 day: revenue if every token were billed at R1 list prices',
    source: {
      ...DAY6,
      quote: 'If all tokens were billed at DeepSeek-R1’s pricing (*), the total daily revenue would be $562,027, with a cost profit margin of 545%.',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 180,
    boundary: `${DAY6_BOUNDARY} A list-price theoretical figure: the page itself says actual revenue is substantially lower (V3 is priced below R1, web and app are free, off-peak discounts apply).`,
  },
  {
    id: 'bench.deepseek-day6.cost-profit-margin',
    kind: 'benchmark',
    value: 545,
    unit: '%',
    label: 'DeepSeek\'s "cost profit margin" for the day (profit over cost, at R1 list prices)',
    source: {
      ...DAY6,
      quote: 'the total daily revenue would be $562,027, with a cost profit margin of 545%.',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 180,
    boundary: `${DAY6_BOUNDARY} 545% is (revenue - cost) / cost = (562,027 - 87,072) / 87,072; the gross margin on the same totals is 1 - 87,072 / 562,027 = 84.5%. The page does not define the term; the arithmetic of its own totals does.`,
  },
  {
    id: 'bench.deepseek-day6.avg-nodes',
    kind: 'benchmark',
    value: 226.75,
    unit: 'nodes (8 H800 each)',
    label: 'DeepSeek average node occupancy over the day',
    source: {
      ...DAY6,
      quote: 'the combined peak node occupancy for V3 and R1 inference services reached 278, with an average occupancy of 226.75 nodes (each node contains 8 H800 GPUs).',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 180,
    boundary: DAY6_BOUNDARY,
  },
  {
    id: 'bench.deepseek-day6.input-tokens',
    kind: 'benchmark',
    value: 608e9,
    unit: 'tokens/day',
    label: 'DeepSeek input tokens served in the day',
    source: { ...DAY6, quote: 'Total input tokens: 608B, of which 342B tokens (56.3%) hit the on-disk KV cache.' },
    verifiedAt: '2026-11-22',
    ttlDays: 180,
    boundary: DAY6_BOUNDARY,
  },
  {
    id: 'bench.deepseek-day6.cache-hit-tokens',
    kind: 'benchmark',
    value: 342e9,
    unit: 'tokens/day',
    label: 'DeepSeek input tokens that hit the on-disk KV cache in the day',
    source: { ...DAY6, quote: 'Total input tokens: 608B, of which 342B tokens (56.3%) hit the on-disk KV cache.' },
    verifiedAt: '2026-11-22',
    ttlDays: 180,
    boundary: `${DAY6_BOUNDARY} The page gives 56.3% as the hit share; 342 / 608 is 56.25%, the rounding of its token counts.`,
  },
  {
    id: 'bench.deepseek-day6.cache-hit-rate',
    kind: 'benchmark',
    value: 56.3,
    unit: '%',
    label: 'DeepSeek KV-cache hit rate over input tokens, one day',
    source: { ...DAY6, quote: 'Total input tokens: 608B, of which 342B tokens (56.3%) hit the on-disk KV cache.' },
    verifiedAt: '2026-11-22',
    ttlDays: 180,
    boundary: DAY6_BOUNDARY,
  },
  {
    id: 'bench.deepseek-day6.output-tokens',
    kind: 'benchmark',
    value: 168e9,
    unit: 'tokens/day',
    label: 'DeepSeek output tokens served in the day',
    source: { ...DAY6, quote: 'Total output tokens: 168B.' },
    verifiedAt: '2026-11-22',
    ttlDays: 180,
    boundary: DAY6_BOUNDARY,
  },
  {
    id: 'price.deepseek.h800-hourly-assumption',
    kind: 'price',
    value: 2,
    unit: 'USD/GPU-hr',
    label: 'DeepSeek\'s assumed leasing cost of one H800 GPU (day-six cost)',
    source: {
      ...DAY6,
      quote: 'Assuming the leasing cost of one H800 GPU is $2 per hour, the total daily cost amounts to $87,072.',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 90,
    boundary: `An assumption stated by DeepSeek for its own day, not a market price. ${DAY6_BOUNDARY} The course uses the same round $2 for an H100 in synthetic.cost.gpu-hourly.`,
  },
  {
    id: 'price.deepseek.r1-input-cache-hit',
    kind: 'price',
    value: 0.14,
    unit: 'USD/Mtok',
    label: 'DeepSeek-R1 list price, input tokens that hit the cache (Feb 2025)',
    source: { ...DAY6, quote: 'R1 Pricing: $0.14/M input tokens (cache hit), $0.55/M input tokens (cache miss), $2.19/M output tokens.' },
    verifiedAt: '2026-11-22',
    ttlDays: 90,
    boundary: `${DAY6_BOUNDARY} The page's markdown escapes the dollar signs; the quote is the rendered text. These are the prices DeepSeek used for the theoretical revenue, not today's price list.`,
  },
  {
    id: 'price.deepseek.r1-input-cache-miss',
    kind: 'price',
    value: 0.55,
    unit: 'USD/Mtok',
    label: 'DeepSeek-R1 list price, input tokens that miss the cache (Feb 2025)',
    source: { ...DAY6, quote: 'R1 Pricing: $0.14/M input tokens (cache hit), $0.55/M input tokens (cache miss), $2.19/M output tokens.' },
    verifiedAt: '2026-11-22',
    ttlDays: 90,
    boundary: `${DAY6_BOUNDARY} The page's markdown escapes the dollar signs; the quote is the rendered text.`,
  },
  {
    id: 'price.deepseek.r1-output',
    kind: 'price',
    value: 2.19,
    unit: 'USD/Mtok',
    label: 'DeepSeek-R1 list price, output tokens (Feb 2025)',
    source: { ...DAY6, quote: 'R1 Pricing: $0.14/M input tokens (cache hit), $0.55/M input tokens (cache miss), $2.19/M output tokens.' },
    verifiedAt: '2026-11-22',
    ttlDays: 90,
    boundary: `${DAY6_BOUNDARY} The page's markdown escapes the dollar signs; the quote is the rendered text.`,
  },
  {
    id: 'price.deepseek.v4-pro-output-peak',
    kind: 'price',
    value: 3.96,
    unit: 'USD/Mtok',
    label: 'DeepSeek flagship (deepseek-v4-pro) list price, output tokens, peak hours',
    source: {
      ...DEEPSEEK_PRICES,
      quote: '1M OUTPUT TOKENS OFF-PEAK $0.6 $1.98 PEAK $1.2 $3.96',
      row: 'Model Details > PRICING (2) > 1M OUTPUT TOKENS (columns deepseek-flash, deepseek-v4-pro)',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 90,
    boundary:
      'The deepseek-v4-pro column (DeepSeek-V4-Pro-0813) of the price page as read on the verified date; the page text is flattened, so the two prices after each label are the deepseek-flash and deepseek-v4-pro columns in that order. Peak hours are 01:00 to 04:00 and 06:00 to 10:00 UTC, Monday to Friday, excluding Chinese public holidays; all other hours are off-peak.',
  },
  {
    id: 'price.deepseek.v4-pro-output-offpeak',
    kind: 'price',
    value: 1.98,
    unit: 'USD/Mtok',
    label: 'DeepSeek flagship (deepseek-v4-pro) list price, output tokens, off-peak hours',
    source: {
      ...DEEPSEEK_PRICES,
      quote: '1M OUTPUT TOKENS OFF-PEAK $0.6 $1.98 PEAK $1.2 $3.96',
      row: 'Model Details > PRICING (2) > 1M OUTPUT TOKENS (columns deepseek-flash, deepseek-v4-pro)',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 90,
    boundary: 'Off-peak is half the peak rate (the page\'s note 2). The deepseek-v4-pro column as read on the verified date.',
  },
  {
    id: 'price.h100.median-2026-11',
    kind: 'price',
    value: 3.98,
    unit: 'USD/GPU-hr',
    label: 'H100 on-demand median rental price, November 2026 reading',
    source: {
      url: 'https://getdeploying.com/reference/cloud-gpu/nvidia-h100',
      title: 'GetDeploying: NVIDIA H100 cloud GPU pricing',
      quote: 'the median on-demand price is $3.98 per GPU per hour across 46 providers with a priced on-demand config',
    },
    verifiedAt: '2026-11-23',
    ttlDays: 30,
    boundary:
      'Median of priced on-demand configs across 46 providers, in a sentence the page opens "As of November 23, 2026"; it says the median rose about 16% over the past 90 days. The page re-issues its figure within a dated day (this claim held another median read under the same date before), so a reading is one sample of that day. Used only by lesson t7.l4 beside the older reading; price.h100.median (2026-10-04) stays for everything pinned to it.',
  },
  ...LATENCY_CLAIMS,
]

registerClaims(ECONOMICS_CLAIMS)
