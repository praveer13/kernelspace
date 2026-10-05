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
      md: `You can now compute the numbers (T4–T6) and name the objective (T7.L1). The remaining skill is measuring them on real systems without fooling yourself. The public harnesses to know: **LLMPerf** (Ray's reference load generator), **GenAI-Perf** (NVIDIA's Triton analyzer), **InferenceX (formerly InferenceMAX)** (SemiAnalysis' open nightly benchmark across vLLM/SGLang/TRT-LLM on H100/H200/B200/GB200 and AMD), and **ArtificialAnalysis** for provider-level comparisons. The methodology below is what separates them from a blog screenshot.`,
    },
    {
      type: 'prose',
      md: `## Rule 1: The traffic is the benchmark

Results are properties of the workload, not the engine. Every number must ship with: **input/output length distributions** (fixed 1k/1k is a different universe from lognormal 4k/500), **arrival process** (Poisson for open-loop truth, closed-loop concurrency for saturation curves), **prefix sharing ratio** (agentic traffic with 90% shared prefix is a different engine — T6.L8), and **temperature/sampling** (affects output length and acceptance rates). InferenceX publishes DeepSeek-R1 and Llama shapes explicitly for this reason; when a vendor number lacks the shape, assume the friendliest one.

## Rule 2: Warmup and steady state, or it never happened

Engines have state: prefix caches cold, CUDA graphs uncaptured, JIT uncompiled, autoscalers asleep. A benchmark that includes the first minutes measures the cold start, not the system. Protocol: warm until TTFT p50 stabilizes (cache hit rates plateau), *then* measure a steady-state window, and report the window. Cold-start is a legitimate *separate* metric (serverless GPUs live there) — label it or lose it.

## Rule 3: Percentiles need samples, and load needs steps

A p99 computed from 20 requests is astrology. Sweep concurrency in steps (1, 2, 4, 8 … until SLO collapse), hold each step for hundreds of requests, and report the **goodput curve** (T7.L1), not a point. Between steps: the knee — where TTFT/TPOT violate SLO — *is* the capacity number. This is exactly the Fleet's scoreboard: your goodput % is the area under an implicit curve you now know how to draw.

## Rule 4: Compare stacks on identical everything

Same hardware (GPU SKU, clocks, power cap), same model artifact (weights, quantization), same traffic seed, same engine version, and both warmed. InferenceX's value is procedural: nightly runs, pinned versions, published configs — the difference between "SGLang beats vLLM by 12%" and "your harness differed by 12%."`,
    },
    {
      type: 'statline',
      stats: [
        { value: '4 rules', label: 'traffic, warmup, samples, identical stacks', hint: 'The whole methodology. Most published numbers break rule 1 or 4.' },
        { value: 'nightly', label: 'InferenceX cadence', hint: 'SemiAnalysis open benchmark: vLLM/SGLang/TRT-LLM, NVIDIA + AMD, nightly.' },
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
            'Run-to-run noise, so the rankings flip at random and the test should be repeated until one winner appears',
            'Unpinned builds: once both reports use the same vLLM or SGLang version and kernels, any two harnesses must agree',
            'A different traffic shape, warmup or stack configuration: results belong to the workload and harness',
            'Hardware generation, since an engine\'s ranking is fixed per GPU and the two reports must have used different chips',
          ],
          correct: [2],
          explanation:
            'Rules 1 and 4: different length distributions, prefix ratios, warmup states, power caps, or engine versions. Before believing any comparison, check that everything except the engine was identical.',
          why: [
            'Noise exists but is small beside the effects of workload shape, and repetition under different settings will keep flipping the winner. Controlled runs, not repeats, resolve the disagreement.',
            'Pinning versions and kernels helps but does not make harnesses agree. On identical builds the winner still flips with length distribution, prefix ratio, warmup or power cap, which pinning leaves free.',
            'Right: rules 1 and 4. Length distributions, arrival process, prefix ratio, warmup, power caps and engine versions all move the result. Check that everything except the engine was identical.',
            'Hardware is one axis, but rankings flip on identical chips too when traffic shape, prefix sharing or warmup differ. Pinning the GPU alone does not make two comparisons agree.',
          ],
        },
        {
          q: 'Warmup exists in benchmarking protocol because…',
          options: [
            'Cold GPUs run at reduced clocks until they heat up, so early samples understate peak performance',
            'Engines hold state: cold prefix caches, uncaptured CUDA graphs and JIT make early samples measure start-up',
            'Dropping the first samples lowers variance, which statistically stabilizes any metric whatever the cause',
            'Load generators need time to open connections, so the first requests are throttled by the client',
          ],
          correct: [1],
          explanation:
            'Warm until TTFT stabilizes, then measure a labeled steady-state window. Cold-start is a separate legitimate metric (serverless lives on it) — the sin is mixing them unlabeled.',
          why: [
            'GPUs reach boost clocks within seconds. The minutes-long transient comes from software state: caches, graph capture and compilation, which is what warmup waits out.',
            'Right: until caches fill, graphs are captured and kernels compile, early samples measure the cold start. Warm until TTFT stabilizes, then report a labeled steady-state window.',
            'Discarding samples with no identified cause is arbitrary. Warmup is justified by named engine state, and its length is set by when TTFT and hit rates plateau.',
            'Connection setup is cheap and takes milliseconds. It cannot explain a transient lasting minutes, and a well-built harness opens connections before timing starts.',
          ],
        },
        {
          q: 'The capacity number of a serving system is found by…',
          options: [
            'Running once at maximum batch size and reading the peak tokens per second that the engine sustains under load',
            'Dividing the GPU\'s peak FLOPS by the model\'s FLOPs per token, which gives the ceiling the engine can reach',
            'Taking mean latency at one moderate concurrency and extrapolating it linearly to much higher request rates',
            'Stepping concurrency up, hundreds of requests per step, and finding the knee where the SLO first breaks',
          ],
          correct: [3],
          explanation:
            'Rule 3: percentiles need samples and load needs steps. The knee is the capacity; the curve is the deliverable. A single max-batch number tells you nothing about where the cliff is.',
          why: [
            'A single max-batch run lands past the knee and reveals nothing about where the cliff is. It reports throughput at a point where users already see SLO violations.',
            'That is a roofline upper bound. It ignores queueing, scheduling, KV capacity and the latency contract, so real capacity under SLO sits far below it.',
            'Latency is flat and then goes vertical at the knee, so a linear extrapolation from one point hides the cliff. One point cannot locate a knee.',
            'Right: rule 3. Percentiles need hundreds of requests per step and load needs steps. The knee where the SLO first breaks is the capacity, and the curve is the deliverable.',
          ],
        },
        {
          q: 'Prefix sharing ratio must be reported because…',
          options: [
            'Shared prefixes are tokenized once and then reused by later requests, so the ratio sets the tokenizer\'s CPU cost',
            'A high ratio means prefix-cache hits that skip most prefill, so the same engine behaves as a different system',
            'The ratio only matters for sizing the cache memory, so it is a deployment detail rather than a benchmark variable',
            'It is a quality metric: shared prefixes reduce answer diversity, so it is disclosed beside accuracy',
          ],
          correct: [1],
          explanation:
            'Rule 1, T6.L8 edition: cache-hit-dominated traffic skips most prefill, so TTFT and cost per request differ sharply from independent traffic. A benchmark run on independent traffic says nothing about agentic traffic and vice versa.',
          why: [
            'Tokenization is small CPU work and is not what changes. The ratio matters because reused KV blocks let the engine skip prefill compute entirely.',
            'Right: with cache hits, prefill is mostly skipped, so TTFT, throughput and cost per request all shift. Agentic traffic with heavily shared prefixes exercises a different path than independent requests.',
            'Cache sizing is a real use of the ratio, but the ratio also decides how much prefill is skipped, which changes TTFT, throughput and cost. Leaving it out makes two benchmarks incomparable.',
            'It is a workload property that changes performance, not an accuracy or diversity measure. The effect shows up in prefill work avoided, not in output quality.',
          ],
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
