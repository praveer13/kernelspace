import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l3',
  slug: 'epd-disaggregation',
  trackId: 't6',
  index: 3,
  title: 'EPD Disaggregation: The 2026 Edition',
  minutes: 30,
  hook: 'T5.L9 taught prefill/decode disaggregation as the big idea of 2024–25. In 2026 it is the default architecture, and it grew a third phase, a standard transfer library (NIXL: C++ with Rust bindings), and a Kubernetes operator. What changed, and what the E is.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `T5.L9's rule still holds: disaggregate at scale and long context, colocate at small scale. What changed since that lesson was written is that the industry *standardized* the disaggregated shape. Three data points: **SGLang shipped EPD disaggregation** (Dec 2025) with Mooncake as the transfer backend; **NVIDIA Dynamo** (v1.3 when this lesson was written, v1.5 now) packaged NIXL transfer and a tiered KV-block manager (KVBM, since deprecated; see below) as its disaggregation plumbing; and **llm-d** (Red Hat/Google/CoreWeave) packaged the same architecture as a Kubernetes-native project. When three independent stacks converge on one shape, the shape is the curriculum.

The new letter: **E — encode.** Multimodal models need a third worker class: the vision/audio encoder that turns pixels and waveforms into embeddings. Encode workers have their own physics (massively parallel vision transformers, zero KV), their own scaling curve, and no reason to share GPUs with prefill. EPD = encode, prefill, decode — three fleets, three hardware mixes, one transfer fabric.`,
    },
    {
      type: 'prose',
      md: `## NIXL and KVBM: the plumbing got a name

Disaggregation lives or dies on KV transfer (T5.L9's ~25 ms budget line). Two artifacts turned that from a custom project into plumbing:

**NIXL** (NVIDIA Inference Xfer Library; a C++ library with Rust bindings, not a Rust one): point-to-point KV-cache transfer over RDMA/InfiniBand/RoCE/UCX/NVLink/SSD. Abstract descriptor lists, one-sided RDMA reads of KV blocks between workers, GPU-direct where the fabric allows. The interface inference stacks actually call; the thing T2.L6's zero-copy lesson becomes at cluster scale.

**KVBM** (KV Block Manager): Dynamo's block manager — the lab-02 data structure, industrialized — handling **tiering**: GPU HBM ↔ CPU DRAM ↔ SSD ↔ remote object store. Written in Rust (the T3.L6 decision, shipped). Your paged block manager manages one pool; KVBM managed a *hierarchy* of pools with placement, eviction, and migration between tiers. T2.L3's swap lesson, third incarnation.

**Status change: KVBM is deprecated.** Dynamo v1.5.0 (2026-09-21) deprecated it, with removal targeted for v1.6.0; the migration path is to use the engine's native KV offloading for host and disk tiering. llm-d made the same move (v0.10 deprecated its fs-connector for vLLM's in-tree \`OffloadingConnector\`). The durable lesson is the one KVBM taught: **tiering is a feature of whoever owns the cache**, while transport (NIXL, Mooncake's transfer engine) and routing (the endpoint picker) stay separate layers. Reading a deprecation notice as an architecture signal is a skill worth keeping.`,
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
            'Prefill was split into an early encode half and a later attention half, letting each half batch at its own size',
            'Multimodal encoders turn pixels or audio into embeddings with no cache state, letting them scale apart from prefill',
            'Evict gets its own pool, holding the cache blocks that decode pushed out under memory pressure until they are reused',
            'Decode splits into a bandwidth-bound attention stage and a compute-bound expert stage, needing two separate fleets',
          ],
          correct: [1],
          explanation:
            'Encode workers run vision/audio transformers: parallel, stateless, no KV cache. Three worker classes with three hardware mixes beat one compromise fleet — the same logic as the P/D split, one phase earlier.',
          why: [
            'Encoders are separate vision or audio models that run before prefill and produce embeddings, not KV. They are a different workload, not the first half of prefill.',
            'Right: encoders turn pixels or audio into embeddings, run massively parallel and hold no KV cache, so they get their own fleet and scaling curve instead of sharing prefill GPUs.',
            'Eviction and tiering belong to whoever owns the KV cache, such as a block manager. They are not a worker phase; the E in EPD is encode.',
            'Splitting decode into attention and expert stages is a separate design (attention-FFN disaggregation). EPD adds a stage before prefill for non-text inputs.',
          ],
        },
        {
          q: 'NIXL is best described as…',
          options: [
            'A C++ inference engine with its own scheduler, planning prefill and decode batches across the whole cluster',
            'A point-to-point transfer library using one-sided reads, moving cache blocks between workers over several backends',
            'A block-scaled low-bit number format with per-block scales, letting cache blocks travel between workers in fewer bytes',
            'A Kubernetes operator driven by custom resources, autoscaling prefill and decode pools and placing them close together',
          ],
          correct: [1],
          explanation:
            'NIXL is the transport plumbing disaggregated stacks call: descriptor-based, GPU-direct where possible, backend-agnostic. T2.L6\'s zero-copy at cluster scale.',
          why: [
            'An engine runs the model and its scheduler. NIXL runs inside engines and moves KV between them; it schedules no batches and replaces no engine.',
            'Right: NIXL is the transfer layer. Workers hand it descriptor lists and it moves KV blocks point to point, with GPU-direct paths where the fabric allows.',
            'NVFP4-style formats are quantization schemes, and even they do not halve bytes: 4-bit values plus one FP8 scale per 16 give 4.5 bits, about 1.8× fewer than FP8. NIXL moves whatever bytes the engine gives it and has no say in precision.',
            'Autoscaling and placement are done by orchestration such as Dynamo\'s planner or llm-d. NIXL is a library the workers call and it never schedules pods.',
          ],
        },
        {
          q: 'Dynamo\'s KVBM (deprecated in v1.5.0 in favor of engine-native offload) added what to the lab-02 block manager design?',
          options: [
            'Custom kernels that gather scattered blocks into one contiguous buffer, running before each attention call on Hopper',
            'A tiered hierarchy from device memory down to storage, handling placement and migration between the tiers',
            'Copy-on-write forking of blocks, letting beam search and parallel sampling share a prompt cache until they diverge',
            'Expert-aware placement across the layers, keeping blocks from hot experts on the device and demoting cold ones to storage',
          ],
          correct: [1],
          explanation:
            'Your paged block manager manages one pool; KVBM manages a hierarchy of pools. Same block tables and refcounts, plus tier placement and migration — T2.L3\'s swap lesson industrialized. The idea outlived the product: engines now ship the tiering themselves.',
          why: [
            'Block tables already let attention address scattered blocks within HBM. KVBM\'s addition was placing blocks across storage tiers, not new gather kernels.',
            'Right: same block tables and refcounts as lab-02, plus placement, eviction and migration across HBM, DRAM, SSD and remote storage. It is now deprecated for engine-native offload.',
            'Copy-on-write sharing already exists in the base paged design through refcounts. KVBM added memory tiers beneath it.',
            'KV blocks are per token and per layer, not per expert. Tiering follows recency and reuse, not which MoE expert happened to be hot.',
          ],
        },
        {
          q: 'llm-d vs Dynamo is closest to…',
          options: [
            'Postgres vs MySQL, with llm-d packaging disaggregated serving for Kubernetes and Dynamo shipping the chip vendor\'s planner and transfer stack',
            'Kubernetes vs Docker, with llm-d orchestrating the replicas and Dynamo being the container runtime that each worker runs in',
            'vLLM vs SGLang, with both competing as single-node engines that differ in scheduler design but not in how they split prefill and decode',
            'A compiler vs an interpreter, with llm-d fixing the serving topology ahead of time and Dynamo deciding placement per request',
          ],
          correct: [0],
          explanation:
            'Both ship the converged 2026 architecture — P/D disaggregation, KV-aware routing, cache tiers — llm-d as a cloud-native K8s project, Dynamo as NVIDIA\'s fabric + Rust data plane. Knowing one means reading the other fluently.',
          why: [
            'Right: both ship the converged architecture (P/D disaggregation, KV-aware routing, cache tiers) and differ in packaging: llm-d is Kubernetes-native, Dynamo is NVIDIA\'s stack.',
            'Dynamo is not a container runtime; it brings a planner, router and transfer stack. llm-d runs on Kubernetes rather than competing with it.',
            'vLLM and SGLang are engines that run inside such stacks. llm-d and Dynamo sit above the engine and handle routing, disaggregation and autoscaling.',
            'Both decide placement at runtime, with KV-aware routers and autoscalers. Neither compiles a topology ahead of time; they differ in packaging and ecosystem.',
          ],
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
