import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the economics claims (t7 lane: load generators, Meta and MLPerf status, DeepSeek day-six benchmark, H100 and DeepSeek prices). Claims go here under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 *
 * `status.loadgen.*`: the status of the four load generators lesson t7.l2 names. Status claims live 60 days.
 */
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
    value: 'live; recommended by the vLLM docs for production servers',
    label: 'GuideLLM status and traffic profiles',
    source: {
      url: 'https://github.com/vllm-project/guidellm/blob/v0.8.1/README.md',
      title: 'GuideLLM README at v0.8.1 (line 30)',
      quote:
        'Generates realistic, configurable traffic patterns across synchronous, concurrent, and rate-based modes, including reproducible sweeps to identify safe operating ranges.',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 60,
    boundary:
      'The vLLM docs (docs.vllm.ai, benchmarking CLI page, read 2026-11-21) say: "For benchmarking production vLLM servers, we recommend GuideLLM, an established performance benchmarking framework with live progress updates and automatic report generation."',
    pin: { repo: 'vllm-project/guidellm', ref: 'v0.8.1' },
  },
  {
    id: 'status.loadgen.aiperf',
    kind: 'status',
    value: 'live; NVIDIA\'s replacement for GenAI-Perf',
    label: 'AIPerf status and benchmarking modes',
    source: {
      url: 'https://github.com/ai-dynamo/aiperf/blob/v0.14.0/README.md',
      title: 'AIPerf README at v0.14.0 (lines 130, 155, 229)',
      quote:
        'Multiple benchmarking modes: concurrency, request-rate, request-rate with max concurrency, trace replay',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 60,
    boundary:
      'The same README lists "Arrival Patterns - Constant, Poisson, gamma traffic" and "Goodput - SLO-based throughput measurement". GenAI-Perf points here as its replacement.',
    pin: { repo: 'ai-dynamo/aiperf', ref: 'v0.14.0' },
  },
]

registerClaims(ECONOMICS_CLAIMS)
