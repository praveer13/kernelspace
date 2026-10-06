import type { Claim } from './schema'

const ANTHROPIC_CACHING = {
  url: 'https://platform.claude.com/docs/en/build-with-claude/prompt-caching',
  title: 'Anthropic docs: Prompt caching (pricing)',
}
const SGLANG_EP_BLOG = {
  url: 'https://lmsys.org/blog/2025-05-05-large-scale-ep/',
  title: 'LMSYS: Deploying DeepSeek with PD Disaggregation and Large-Scale Expert Parallelism on 96 H100 GPUs (SGLang Team, 2025-05-05)',
}
const NVFP4_BLOG = {
  url: 'https://developer.nvidia.com/blog/introducing-nvfp4-for-efficient-and-accurate-low-precision-inference/',
  title: 'NVIDIA Technical Blog: Introducing NVFP4 for Efficient and Accurate Low-Precision Inference',
}

/**
 * Constants the T6/T7 generator families read (docs/specs/wave-2.md §5.3): cache-read price multipliers for
 * `cost` / `cache-discount`, SGLang's published DeepSeek node throughput for `cost` / `node-day` (the t6.l2
 * and t7.l4 worked example), and NVFP4's effective bits per weight for `memory` / `fp4-fit`. Quotes were
 * copied from the pages opened on 2026-10-05, with runs of whitespace collapsed to one space.
 */
export const SERVING_CLAIMS: Claim[] = [
  {
    id: 'serving.cache.anthropic-read-multiplier',
    kind: 'price',
    value: 0.1,
    unit: '× base input price',
    label: 'Anthropic prompt-cache read price, standard multiplier',
    source: {
      ...ANTHROPIC_CACHING,
      quote: 'Cache read tokens are 0.1 times the base input tokens price (see the table footnote for per-model exceptions)',
      row: 'Pricing',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 90,
    boundary: 'Claude models without a footnote exception; a cache hit costs a tenth of an uncached input token. Writes cost 1.25 times (5-minute) or 2 times (1-hour) the base input price.',
  },
  {
    id: 'serving.cache.anthropic-opus-5-5-read-multiplier',
    kind: 'price',
    value: 0.05,
    unit: '× base input price',
    label: 'Anthropic prompt-cache read price on Claude Opus 5.5',
    source: {
      ...ANTHROPIC_CACHING,
      quote: 'Cache hits and refreshes on Claude Opus 5.5 are priced at 0.05x the base input price.',
      row: 'Pricing, table footnote 2',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 90,
    boundary: 'One model: the footnote lists the exceptions to the standard 0.1x multiplier.',
  },
  {
    id: 'serving.cache.anthropic-fable-5-1-read-multiplier',
    kind: 'price',
    value: 0.025,
    unit: '× base input price',
    label: 'Anthropic prompt-cache read price on Claude Fable 5.1 and Claude Mythos 5.1',
    source: {
      ...ANTHROPIC_CACHING,
      quote: 'Cache hits and refreshes on Claude Fable 5.1 and Claude Mythos 5.1 are priced at 0.025x the base input price.',
      row: 'Pricing, table footnote 1',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 90,
    boundary: 'Two models: the footnote lists the exceptions to the standard 0.1x multiplier.',
  },
  {
    id: 'serving.sglang-deepseek.output-tps-per-node',
    kind: 'benchmark',
    value: 22300,
    unit: 'output tok/s per node',
    label: 'SGLang DeepSeek on 12 nodes of 8 H100: output throughput per node',
    source: {
      ...SGLANG_EP_BLOG,
      quote: 'achieving a speed of 52.3k input tokens per second and 22.3k output tokens per second per node for 2000-token input sequences',
      row: 'Introduction',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 180,
    boundary:
      'SGLang with prefill-decode disaggregation and large-scale expert parallelism, 12 nodes of 8 H100 (96 GPUs) on Atlas Cloud, 2,000-token inputs, May 2025. One operating point, not a general rate.',
  },
  {
    id: 'serving.sglang-deepseek.input-tps-per-node',
    kind: 'benchmark',
    value: 52300,
    unit: 'input tok/s per node',
    label: 'SGLang DeepSeek on 12 nodes of 8 H100: input (prefill) throughput per node',
    source: {
      ...SGLANG_EP_BLOG,
      quote: 'achieving a speed of 52.3k input tokens per second and 22.3k output tokens per second per node for 2000-token input sequences',
      row: 'Introduction',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 180,
    boundary: 'Same run as the output figure: 2,000-token inputs, 12 nodes of 8 H100, May 2025.',
  },
  {
    id: 'serving.sglang-deepseek.gpus-per-node',
    kind: 'benchmark',
    value: 8,
    unit: 'H100 per node',
    label: 'SGLang DeepSeek reproduction: GPUs per node',
    source: {
      ...SGLANG_EP_BLOG,
      quote: 'replicated DeepSeek\'s inference system using 12 nodes, each with 8 H100 GPUs',
      row: 'Introduction',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 180,
    boundary: 'The node the per-node throughput is measured on; the run used 12 of them.',
  },
  {
    id: 'serving.sglang-deepseek.cost-per-mtok',
    kind: 'benchmark',
    value: 0.2,
    unit: 'USD/Mtok output',
    label: 'SGLang DeepSeek reproduction: its own estimate of cost per million output tokens',
    source: {
      ...SGLANG_EP_BLOG,
      quote: 'it translates to a cost of $0.20/1M output tokens, which is about one-fifth the cost of the official DeepSeek Chat API',
      row: 'Introduction',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 180,
    boundary:
      'The blog\'s estimate for deploying the implementation locally; it does not state the GPU-hour price behind it. The course recomputes it from synthetic.cost.gpu-hourly (a node-day instance), so the two agree only at that assumed price.',
  },
  {
    id: 'serving.nvfp4.bits-per-weight',
    kind: 'spec',
    value: 4.5,
    unit: 'bits per weight',
    label: 'NVFP4 effective bits per value, block scales included',
    source: {
      ...NVFP4_BLOG,
      quote: 'NVFP4 stores one 4-bit value plus minor overhead of one FP8 scale per 16 values (4.5 bits per value) and one FP32 per tensor second-level scaling factor.',
      row: 'Introduction',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 365,
    boundary: 'Per value, ignoring the one FP32 per-tensor scale. The same page gives about 3.5x less memory than FP16 and about 1.8x less than FP8.',
  },
]
