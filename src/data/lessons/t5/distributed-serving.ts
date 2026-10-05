import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't5.l9',
  slug: 'distributed-serving',
  trackId: 't5',
  index: 9,
  title: 'Distributed & Disaggregated Serving',
  minutes: 30,
  hook: 'TP/PP/DP parallelism, NVLink vs RDMA, prefill/decode disaggregation, KV transfer, and Mooncake\'s distributed cache — serving beyond one GPU.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `One GPU is never enough — for capacity (T5.L4's 70B arithmetic), for throughput, or for latency isolation. The moment serving spans devices, you inherit a full distributed-systems problem: how to split the model, how to move the bytes, and how to keep tail latency alive across a network. This lesson is the map: the three parallelism axes, the interconnect hierarchy that prices them, **disaggregation** (the idea that became the default architecture of 2025–26), and Mooncake-style distributed KV caches. T3.L6's Dynamo case study slots in as the production implementation. (The 2026 state of the art on this exact topic — EPD, NIXL, llm-d, and the deprecation of Dynamo's KVBM — is T6.L3.)`,
    },
    {
      type: 'prose',
      md: `## The three axes of parallelism

- **Tensor parallelism (TP):** split each layer's *matrices* across GPUs — every GPU computes a shard of every matmul, then **all-reduce/all-gather** to combine. Latency-friendly (all GPUs work every step) but brutally communication-hungry: two collective ops per layer, per step. TP belongs *inside* a node, on NVLink (900 GB/s GPU-to-GPU on NVL72-class fabric) — over Ethernet it starves.
- **Pipeline parallelism (PP):** split *layers* across GPUs — GPU 0 runs layers 1–20, GPU 1 runs 21–40, activations flow forward. Communication is tiny (one activation tensor per boundary), but the pipeline *bubbles*: to keep all stages busy you need many micro-batches in flight, which complicates latency for single requests. PP tolerates slower interconnects; TP does not.
- **Data parallelism (DP):** whole model replicas on different GPUs, requests load-balanced across them. Zero communication within requests, linear capacity scaling — the obvious choice *until* one replica can't hold the model+KV. DP scales requests; TP/PP scale the model.

Production serving mixes all three: TP within the node, PP across a few nodes for very large models, DP across the fleet for capacity. The mix is priced by the interconnect, which is why the hardware table matters.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '3.35 TB/s', label: 'HBM (intra-GPU)', hint: 'The reference speed everything else is measured against.' },
        { value: '900 GB/s', label: 'NVLink (GPU↔GPU)', hint: 'NVL72-class: makes tensor parallelism inside a node practical.' },
        { value: '~64 GB/s', label: 'PCIe gen5 x16', hint: 'The CPU-attach tier — the old vLLM V0 swap path crossed it; V1 recomputes instead.' },
        { value: '25–100 GB/s', label: 'RDMA (node↔node)', hint: 'RoCE/InfiniBand: the disaggregation highway for KV transfer.' },
      ],
    },
    {
      type: 'prose',
      md: `## Disaggregation: prefill and decode break up

The clean idea from Splitwise/DistServe/Mooncake (2024): prefill and decode have *opposite* roofline regimes (T4.L3) and *opposite* hardware and batching preferences — so why force them onto the same GPUs? **Disaggregate**: dedicated **prefill workers** (big batches of prompts, compute-saturated) and dedicated **decode workers** (huge KV-resident batches, bandwidth-saturated). When prefill finishes a prompt, its KV cache is **transferred** to a decode worker over RDMA (NVLink within a node), and the decode worker admits it into its continuous batch.

The wins: each phase gets its own hardware mix (compute-heavy vs memory-heavy SKUs), its own batching policy, and its own scaling curve — and ITL is finally isolated from prompt-length spikes (no more 100k-token prefill convoying everyone's decode, even with chunking). The cost: the **KV transfer** — a 4k-context KV for our 70B (T5.L4: ~1.3 GB) moved over a 50 GB/s RDMA link adds ~25 ms to TTFT. The entire engineering game of Dynamo/Mooncake is hiding that transfer: schedule it early, overlap it with prefill of later chunks, route around it with prefix-cache-aware placement.`,
    },
    {
      type: 'isomorphism',
      title: 'disaggregation ≡ your microservice instincts',
      pairs: [
        {
          os: 'monolith batch job',
          osLine: 'One process alternates CPU-bound and IO-bound phases; each starves the other\'s tuning.',
          llm: 'colocated engine',
          llmLine: 'One GPU alternates compute-bound prefill and bandwidth-bound decode — compromise everywhere.',
        },
        {
          os: 'separate services + queue',
          osLine: 'Split by workload profile; scale independently; pay a network hop between stages.',
          llm: 'disaggregated serving',
          llmLine: 'Prefill fleet + decode fleet + KV transfer fabric; TTFT pays the hop, ITL gains the isolation.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## Mooncake: the KV cache becomes a distributed store

Moonshot AI's Mooncake (2024, production at Kimi scale) pushes the idea one level further: the KV cache is not per-worker state — it's a **distributed object store** spanning the cluster's GPU HBM *and* CPU DRAM. A central scheduler places requests to maximize **prefix-cache reuse across the whole cluster** (route to whoever holds the most of your prefix — KV-aware routing, T3.L6), prefill fills blocks into the shared pool, decode workers *pull* blocks over RDMA as needed. The design is explicitly a storage system: cache tiers (HBM hot, DRAM warm), transfer scheduling, eviction — T2's memory hierarchy running across a datacenter.

This is the end-state of the course's thesis: the KV cache is the payload (T5.L4), so the mature architecture is a **database cluster for KV blocks** — placement, replication, eviction, transfer scheduling — with GPU workers as its query engines. The 50-year-old ideas, reincarnated one final time: page tables (T5.L5), swap (T2.L3), schedulers (T5.L7), now distributed storage and caching. The stack is complete.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You have built this shape: **disaggregation is your read/write split** (writes to the primary, reads scaled on replicas — different tuning per role), **KV transfer is replication lag** (the follower can't serve until the bytes arrive — budgeted, pipelined, monitored), and **Mooncake's pool is your Redis cluster / CDN tiering** (hot in HBM, warm in DRAM, placement for reuse). The capacity math is even the same formula: bytes × objects vs tier capacity. New payload, old profession.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Disaggregation is not free architecture. It pays off when: contexts are long (KV transfer amortizes), prefill/decode ratios are skewed (chat ≠ batch summarization), and the fleet is big enough to bin-pack phases. For small deployments or short contexts, colocation with chunked prefill is simpler and often faster end-to-end — the network hop dominates. The 2025 rule of thumb: disaggregate at scale and long context; colocate at small scale. Anyone claiming one answer for all sizes is selling something.`,
    },
    {
      type: 'prose',
      md: `## Checkpoint

You should now be able to whiteboard a full deployment: model size → TP/PP split (priced by NVLink vs RDMA), traffic shape → disaggregation decision, KV pool sizing (T5.L4) → fleet count, transfer budget → TTFT impact. The final lesson of T5 puts it all together: the four production stacks, compared.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Tensor parallelism must stay on NVLink-class interconnects because…',
          options: [
            'It keeps a full copy of the key-value cache on each device, and the copies need hardware coherence that fast links provide',
            'It shards each matmul and needs two collective reductions per layer per step, and the intra-node bandwidth hides that traffic',
            'It hands whole activations to the next device after each layer, and Ethernet latency is too high for such hand-offs between nodes',
            'It must synchronize gradients at each step, and the strict synchronous reduction that needs is supported by fast links alone',
          ],
          correct: [1],
          explanation:
            'Communication per step is proportional to layers; over RDMA/Ethernet the collectives starve the compute. PP\'s boundary-only activations tolerate slow links; TP\'s per-layer all-reduces do not.',
          why: [
            'Each GPU holds a shard of the attention heads and their KV, not a full copy. The constraint is collective bandwidth and latency, not cache coherence.',
            'Right: collective traffic scales with layer count on every step. NVLink-class bandwidth hides it, while Ethernet or RDMA-class links leave the GPUs waiting on all-reduce.',
            'That describes pipeline parallelism: one activation tensor handed across a stage boundary. TP instead combines partial results with collectives inside every layer, which is why it is link-hungry.',
            'Inference has no gradients. TP exchanges partial activations through all-reduce in each layer; the limit is bandwidth and latency, not training-style synchronization semantics.',
          ],
        },
        {
          q: 'Pipeline parallelism\'s main weakness is…',
          options: [
            'Each stage boundary ships the layer\'s full cache to the next device, and inter-stage traffic grows with context length',
            'Pipeline bubbles, where keeping the stages busy needs many micro-batches in flight and hurts the latency of a request',
            'Each layer needs two collective reductions per step, and the scheme is as link-hungry as tensor parallelism',
            'Each stage must hold a full copy of the model weights for its micro-batch, and memory use multiplies by the stage count',
          ],
          correct: [1],
          explanation:
            'The stage boundary is cheap (one activation tensor), but latency of one request through N stages with idle stages is the bubble. PP trades latency-friendliness for communication-lightness.',
          why: [
            'Only the activation tensor crosses a stage boundary, and each stage keeps the KV for its own layers. Inter-stage traffic is small, which is why PP tolerates slower links.',
            'Right: stage boundaries are cheap, but a lone request traverses N stages while others idle. Filling the pipeline needs micro-batches, trading single-request latency for light communication.',
            'That is tensor parallelism. PP has no per-layer collectives; it passes one activation per boundary and is the option that tolerates slower interconnects and node boundaries.',
            'Each stage holds only its own slice of the layers, so total weight memory stays about one model\'s worth. Copying everything to every stage would be data parallelism.',
          ],
        },
        {
          q: 'Prefill/decode disaggregation pays off primarily because…',
          options: [
            'Splitting the work across two fleets halves the weights each device stores, and that frees memory for a larger cache',
            'Opposite roofline regimes let separate fleets tune and scale independently and isolate latency, at the cost of a transfer',
            'Prefill workers send just the final token and its logits to decode workers, and no cache transfer is needed',
            'Cross-node links are faster than device memory, and moving the cache to a dedicated decode device beats reading it locally',
          ],
          correct: [1],
          explanation:
            'Compute-bound vs bandwidth-bound workloads tune differently; colocating them forces compromise. The KV transfer (budgeted into TTFT, pipelined under later chunks) is the price of isolation.',
          why: [
            'Disaggregation does not shard the model; each worker still holds a full copy (or its own TP group). Splitting weights across GPUs is tensor or pipeline parallelism.',
            'Right: compute-bound prefill and bandwidth-bound decode tune differently, and isolation stops long prompts from spiking ITL. The KV transfer is the cost, budgeted into TTFT and pipelined.',
            'Decode needs the whole prompt\'s K/V for every attention step. The KV transfer is the central cost, so the engineering game is hiding it, not eliminating it.',
            'HBM runs at multiple TB/s while RDMA links run at tens of GB/s. Remote K/V is always slower than local, which is why the transfer adds to TTFT and must be hidden.',
          ],
        },
        {
          q: 'Mooncake\'s architecture is best described as…',
          options: [
            'A parallelism library that shards each layer\'s attention heads across nodes, and a request\'s cache stays where it is',
            'A distributed cache store for attention keys and values across the memory tiers, with cache-aware request routing between workers',
            'A quantization framework that compresses stored blocks to a low bit width, and more prefixes fit in each device\'s memory',
            'A load balancer that spreads requests by utilization, and each worker keeps its cache strictly local with per-engine prefix caching',
          ],
          correct: [1],
          explanation:
            'Placement, tiering (HBM/DRAM), eviction, transfer scheduling, prefix-reuse routing — storage engineering for the cache, with GPU workers as query engines. The course thesis, end-state.',
          why: [
            'That describes tensor parallelism. Mooncake is not a model-sharding library; it treats KV blocks as stored objects that move between workers.',
            'Right: placement, tiering, eviction, transfer scheduling and prefix-reuse routing make it storage engineering for KV, with GPU workers acting as query engines.',
            'Quantization is orthogonal and does not define Mooncake. Its idea is a shared cluster-wide cache with routing for reuse, not a smaller encoding of each block.',
            'That is the opposite design. Mooncake pools KV across the cluster and routes toward the most reusable prefix; local-only caches with utilization-only balancing lose cross-worker reuse.',
          ],
        },
      ],
    },
  ],
}

export default lesson
