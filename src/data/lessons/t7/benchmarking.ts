import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't7.l2',
  slug: 'benchmarking',
  trackId: 't7',
  index: 2,
  title: 'Benchmarking Methodology: Measure Like You Mean It',
  minutes: 25,
  hook: 'Most published inference numbers are unusable — wrong traffic, no warmup, percentiles from five samples. The four rules that make a benchmark honest, and the public harnesses that follow them.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `You can now compute the numbers (T4–T6) and name the objective (T7.L1). The remaining skill is measuring them on real systems without fooling yourself. The public harnesses to know: **LLMPerf** (Ray's reference load generator), **GenAI-Perf** (NVIDIA's Triton analyzer), **InferenceMAX** (SemiAnalysis' open nightly benchmark across vLLM/SGLang/TRT-LLM on H100/H200/B200/GB200 and AMD), and **ArtificialAnalysis** for provider-level comparisons. The methodology below is what separates them from a blog screenshot.`,
    },
    {
      type: 'prose',
      md: `## Rule 1: The traffic is the benchmark

Results are properties of the workload, not the engine. Every number must ship with: **input/output length distributions** (fixed 1k/1k is a different universe from lognormal 4k/500), **arrival process** (Poisson for open-loop truth, closed-loop concurrency for saturation curves), **prefix sharing ratio** (agentic traffic with 90% shared prefix is a different engine — T6.L8), and **temperature/sampling** (affects output length and acceptance rates). InferenceMAX publishes DeepSeek-R1 and Llama shapes explicitly for this reason; when a vendor number lacks the shape, assume the friendliest one.

## Rule 2: Warmup and steady state, or it never happened

Engines have state: prefix caches cold, CUDA graphs uncaptured, JIT uncompiled, autoscalers asleep. A benchmark that includes the first minutes measures the cold start, not the system. Protocol: warm until TTFT p50 stabilizes (cache hit rates plateau), *then* measure a steady-state window, and report the window. Cold-start is a legitimate *separate* metric (serverless GPUs live there) — label it or lose it.

## Rule 3: Percentiles need samples, and load needs steps

A p99 computed from 20 requests is astrology. Sweep concurrency in steps (1, 2, 4, 8 … until SLO collapse), hold each step for hundreds of requests, and report the **goodput curve** (T7.L1), not a point. Between steps: the knee — where TTFT/TPOT violate SLO — *is* the capacity number. This is exactly the Fleet's scoreboard: your goodput % is the area under an implicit curve you now know how to draw.

## Rule 4: Compare stacks on identical everything

Same hardware (GPU SKU, clocks, power cap), same model artifact (weights, quantization), same traffic seed, same engine version, and both warmed. InferenceMAX's value is procedural: nightly runs, pinned versions, published configs — the difference between "SGLang beats vLLM by 12%" and "your harness differed by 12%."`,
    },
    {
      type: 'statline',
      stats: [
        { value: '4 rules', label: 'traffic, warmup, samples, identical stacks', hint: 'The whole methodology. Most published numbers break rule 1 or 4.' },
        { value: 'nightly', label: 'InferenceMAX cadence', hint: 'SemiAnalysis open benchmark: vLLM/SGLang/TRT-LLM, NVIDIA + AMD, nightly.' },
        { value: 'hundreds', label: 'requests per load step', hint: 'Below that, your p95 is a rumor.' },
        { value: '2 harnesses', label: 'LLMPerf + GenAI-Perf', hint: 'The two load generators worth knowing by name.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `This is **JMH discipline transplanted**: the JVM world learned years ago that benchmarks without warmup measure the interpreter, that percentiles need samples, and that "it worked on my machine" is a config diff. Same rules, new victim. If you've ever written a JMH harness with @Warmup and @Measurement, you're home.`,
    },
    {
      type: 'field-note',
      title: 'DistServe: Disaggregating Prefill and Decoding for Goodput-Optimized Serving',
      source: 'Zhong et al.',
      href: 'https://arxiv.org/abs/2401.09670',
      published: "OSDI '24",
      verified: '2026-08',
      md: `DistServe belongs in the benchmarking track because its objective is not raw tokens per second: it asks for the maximum arrival rate that satisfies both TTFT and TPOT constraints. Audit the evaluation as you read — workload distributions, phase-specific parallelism, KV-transfer topology, percentile targets, and the baseline's tuning budget. The paper is a worked example of goodput turning an architectural claim into a falsifiable curve.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Two engine comparisons report opposite winners. The most common cause is…',
          options: [
            'One team lied',
            'Different traffic shape, warmup, or stack config — results are properties of the workload+harness, not the engine',
            'Quantum noise',
            'Driver versions never matter',
          ],
          correct: [1],
          explanation:
            'Rules 1 and 4: different length distributions, prefix ratios, warmup states, power caps, or engine versions. Before believing any comparison, check that everything except the engine was identical.',
        },
        {
          q: 'Warmup exists in benchmarking protocol because…',
          options: [
            'GPUs are cold physically',
            'Engines have state — cold caches, uncaptured CUDA graphs, JIT — and early samples measure the cold start, not the system',
            'It increases throughput',
            'It reduces variance by magic',
          ],
          correct: [1],
          explanation:
            'Warm until TTFT stabilizes, then measure a labeled steady-state window. Cold-start is a separate legitimate metric (serverless lives on it) — the sin is mixing them unlabeled.',
        },
        {
          q: 'The capacity number of a serving system is found by…',
          options: [
            'Asking the vendor',
            'Sweeping concurrency in steps, holding each for hundreds of requests, and finding the knee where TTFT/TPOT violate SLO — the goodput curve\'s edge',
            'Running once at max batch',
            'Reading the README',
          ],
          correct: [1],
          explanation:
            'Rule 3: percentiles need samples and load needs steps. The knee is the capacity; the curve is the deliverable. A single max-batch number tells you nothing about where the cliff is.',
        },
        {
          q: 'Prefix sharing ratio must be reported because…',
          options: [
            'It is fashionable',
            'Agentic traffic with 90% shared prefixes exercises a different engine path (cache hits) than independent requests — the same binary is two different systems under those workloads',
            'It affects the tokenizer',
            'It changes GPU temperature',
          ],
          correct: [1],
          explanation:
            'Rule 1, T6.L8 edition: cache-hit-dominated traffic can be 10× cheaper per request. A benchmark run on independent traffic says nothing about agentic traffic and vice versa.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'A benchmarking report you can write today',
      md: `The format the industry respects (steal it): (1) hardware + clocks + power cap; (2) model artifact hash + quantization; (3) traffic: length distributions, arrival process, prefix ratio, seed; (4) harness + versions; (5) warmup protocol and measurement window; (6) the goodput curve — goodput vs concurrency with TTFT/TPOT p50/p95 overlays; (7) the knee, stated as the capacity number with the SLO beside it. Your Fleet runs already produce (3), (6), (7) — a real GPU box and LLMPerf adds the rest. This document is a portfolio artifact (§6 of the plan).`,
    },
  ],
}

export default lesson
