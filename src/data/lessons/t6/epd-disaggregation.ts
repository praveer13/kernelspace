import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l3',
  slug: 'epd-disaggregation',
  trackId: 't6',
  index: 3,
  title: 'EPD Disaggregation: The 2026 Edition',
  minutes: 30,
  hook: 'T5.L9 taught prefill/decode disaggregation as the big idea of 2024–25. In 2026 it is the default architecture, and it grew a third phase, a Rust transfer library, and a Kubernetes operator. What changed, and what the E is.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `T5.L9's rule still holds: disaggregate at scale and long context, colocate at small scale. What changed since that lesson was written is that the industry *standardized* the disaggregated shape. Three data points: **SGLang shipped EPD disaggregation** (Dec 2025) with Mooncake as the transfer backend; **NVIDIA Dynamo reached v1.3** with NIXL and the Rust KV-block manager (KVBM) as generally-available plumbing; and **llm-d** (Red Hat/Google/CoreWeave) packaged the same architecture as a Kubernetes-native project. When three independent stacks converge on one shape, the shape is the curriculum.

The new letter: **E — encode.** Multimodal models need a third worker class: the vision/audio encoder that turns pixels and waveforms into embeddings. Encode workers have their own physics (massively parallel vision transformers, zero KV), their own scaling curve, and no reason to share GPUs with prefill. EPD = encode, prefill, decode — three fleets, three hardware mixes, one transfer fabric.`,
    },
    {
      type: 'prose',
      md: `## NIXL and KVBM: the plumbing got a name

Disaggregation lives or dies on KV transfer (T5.L9's ~25 ms budget line). Two artifacts turned that from a custom project into plumbing:

**NIXL** (NVIDIA Inter-node Xfer Library): point-to-point KV-cache transfer over RDMA/InfiniBand/RoCE/UCX/NVLink/SSD. Abstract descriptor lists, one-sided RDMA reads of KV blocks between workers, GPU-direct where the fabric allows. The interface inference stacks actually call; the thing T2.L6's zero-copy lesson becomes at cluster scale.

**KVBM** (KV Block Manager): Dynamo's block manager — the lab-02 data structure, industrialized — handling **tiering**: GPU HBM ↔ CPU DRAM ↔ SSD ↔ remote object store. Written in Rust (the T3.L6 decision, shipped). Your paged block manager manages one pool; KVBM manages a *hierarchy* of pools with placement, eviction, and migration between tiers. T2.L3's swap lesson, third incarnation.`,
    },
    {
      type: 'prose',
      md: `## Mooncake grows up, llm-d packages it

Mooncake (T5.L9's KV-cache-as-distributed-store) won FAST'25 best paper and entered the PyTorch ecosystem (Jan 2026) — its transfer engine and store are now infrastructure others build on, including SGLang's EPD mode and vLLM's KV connectors. Kimi's production numbers at K2 scale: 128×H200, 224k tok/s prefill / 288k tok/s decode, with Mooncake's KVCache-centric pool underneath (75% more requests served under SLO vs colocated in their original study).

**llm-d** is the packaging answer for teams that don't want to assemble this: Kubernetes-native disaggregated serving — prefill/decode worker pools, KV-aware routing, Mooncake-style cache tiers, autoscalers that understand TTFT. If Dynamo is NVIDIA's fabric, llm-d is the cloud-native distribution. For your career: the job posts say "Kubernetes + disaggregated inference" and mean this stack.`,
    },
    {
      type: 'prose',
      md: `## The router is now a cache scheduler

Once KV is distributed, a least-loaded worker is not necessarily the cheapest worker. Dynamo and llm-d-style routers score **prefix locality**: estimate the longest cached token prefix on each eligible worker, prefer the worker that avoids the most prefill, then apply a load guard so a popular prefix cannot herd traffic onto one queue. The fallback is deliberate — when the warm owner is too busy, recomputing elsewhere can beat waiting for a nominal cache hit.

That makes routing observable in two dimensions: KV-hit rate tells you how much prefill was skipped; TTFT-SLO attainment tells you whether locality survived queueing and transfer. T5.L6 introduced the single-engine cache and the Fleet makes all three policies executable. Here the same decision spans HBM, host tiers, and remote KV ownership: the router is no longer a stateless load balancer; it is the top-level scheduler for a distributed cache.`,
    },
    {
      type: 'isomorphism',
      title: 'EPD ≡ your three-tier web architecture',
      pairs: [
        {
          os: 'media/transcode tier',
          osLine: 'CPU-heavy upload workers that normalize input and hand off.',
          llm: 'encode fleet',
          llmLine: 'Vision/audio encoders: pixels → embeddings, massively parallel, no KV.',
        },
        {
          os: 'write-heavy primary',
          osLine: 'Compute-bound ingestion, scaled on FLOPs.',
          llm: 'prefill fleet',
          llmLine: 'Compute-bound: big batches, tensor-core saturated, produces KV.',
        },
        {
          os: 'read replicas + cache tier',
          osLine: 'Bandwidth-bound reads scaled on memory, hot state tiered.',
          llm: 'decode fleet + KV tiers',
          llmLine: 'Bandwidth-bound: KV-resident batches, HBM↔DRAM↔SSD hierarchy behind it.',
        },
      ],
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The E in EPD exists because…',
          options: [
            'Prefill was renamed',
            'Multimodal encode (vision/audio → embeddings) has its own physics and scaling curve — massively parallel, zero KV — and no reason to share GPUs with prefill',
            'It stands for "evict"',
            'Decode needed two phases',
          ],
          correct: [1],
          explanation:
            'Encode workers run vision/audio transformers: parallel, stateless, no KV cache. Three worker classes with three hardware mixes beat one compromise fleet — the same logic as the P/D split, one phase earlier.',
        },
        {
          q: 'NIXL is best described as…',
          options: [
            'A new inference engine',
            'The point-to-point KV-transfer library — one-sided RDMA reads of KV blocks between workers over RDMA/UCX/NVLink/SSD',
            'A quantization format',
            'A Kubernetes operator',
          ],
          correct: [1],
          explanation:
            'NIXL is the transport plumbing disaggregated stacks call: descriptor-based, GPU-direct where possible, backend-agnostic. T2.L6\'s zero-copy at cluster scale.',
        },
        {
          q: 'KVBM adds what to the lab-02 block manager design?',
          options: [
            'CUDA kernels',
            'A tiered hierarchy — GPU HBM ↔ CPU DRAM ↔ SSD ↔ remote store, with placement/eviction/migration across tiers, in Rust',
            'A tokenizer',
            'Expert routing',
          ],
          correct: [1],
          explanation:
            'Your paged block manager manages one pool; KVBM manages a hierarchy of pools. Same block tables and refcounts, plus tier placement and migration — T2.L3\'s swap lesson industrialized.',
        },
        {
          q: 'llm-d vs Dynamo is closest to…',
          options: [
            'Postgres vs MySQL — same idea, different distribution: llm-d packages disaggregated serving Kubernetes-natively; Dynamo is NVIDIA\'s fabric + planner + transfer stack',
            'Windows vs Linux',
            'vLLM vs SGLang',
            'A compiler vs an interpreter',
          ],
          correct: [0],
          explanation:
            'Both ship the converged 2026 architecture — P/D disaggregation, KV-aware routing, cache tiers — llm-d as a cloud-native K8s project, Dynamo as NVIDIA\'s fabric + Rust data plane. Knowing one means reading the other fluently.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'When to still say no',
      md: `The 2025-26 evidence didn't repeal T5.L9's rule — it sharpened it. Disaggregation wins when: contexts are long (KV transfer amortizes), prefill/decode ratios are skewed, and the fleet is big enough to bin-pack phases (DeepSeek's 200+ nodes, Kimi's 128). It loses when: deployment is small, contexts are short, or traffic is uniform. The honest decision procedure: compute the KV-transfer budget per request (T5.L9's ~25 ms for 70B 4k over 50 GB/s), compare to the ITL isolation win, and remember that an idle prefill GPU is still a cost. Every "always disaggregate" claim is marketing; every "never disaggregate" claim is a small fleet talking.`,
    },
  ],
}

export default lesson
