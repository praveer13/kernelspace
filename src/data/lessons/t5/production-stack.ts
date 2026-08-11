import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't5.l10',
  slug: 'production-stack',
  trackId: 't5',
  index: 10,
  title: 'The Production Stack: vLLM, SGLang, TRT-LLM, Dynamo',
  minutes: 35,
  hook: 'The guided architecture read: four production engines, their design centers, and when to choose which — the T5 capstone before the capstone.',
  exercise: 'read+quiz',
  blocks: [
    {
      type: 'prose',
      md: `You've assembled every piece: the memory hierarchy (T0), allocators and paging (T1–T2), Rust's role (T3), the GPU's physics (T4), and the serving algorithms (T5). This final lesson reads the four production stacks as *engineering arguments* — each one's design center, the trade-offs it chose, and when it wins. No marketing, no benchmarks-by-vendor; just architecture, using the vocabulary you now own.

The four: **vLLM** (the open-source reference), **SGLang** (the structured-generation specialist), **TensorRT-LLM** (NVIDIA's compiled-performance stack), and **Dynamo** (NVIDIA's distributed data plane — which is a different *kind* of thing, as you'll see).`,
    },
    {
      type: 'prose',
      md: `## vLLM: the reference implementation

**Design center:** make PagedAttention's memory efficiency available to everyone, as a library. Python-first (fast contribution loop), CUDA custom kernels underneath, HuggingFace-native model loading, OpenAI-compatible server. Its architecture is the T5 curriculum in one repo: paged KV manager + prefix cache + continuous batching scheduler (T5.L5–L7) in \`vllm/core\` and the V1 engine's cleaner scheduler; chunked prefill, speculative decoding, FP8 KV, guided decoding all landed there first or early; TP/PP/DP + disaggregation support for scale-out (T5.L9).

**Trade-offs chosen:** velocity and breadth over peak micro-efficiency. The Python scheduler's overhead drove the **V1 engine rewrite** — which shipped as the default in 2025 with a rewritten scheduler/KV-cache manager and ~2.8× throughput over V0; kernel coverage remains broad rather than maximally fused. **Choose it when:** you need the ecosystem default — every model on day one, every feature, huge community, sane operations. It is the "Postgres of LLM serving": rarely the wrong answer.`,
    },
    {
      type: 'prose',
      md: `## SGLang: structured generation as a first-class citizen

**Design center:** RadixAttention — the KV cache organized as a **radix tree over token prefixes**, so shared prefixes (system prompts, few-shot templates, multi-turn chats, agent loops) are reused *automatically* across requests with LRU eviction on the tree. If vLLM's prefix cache is a hash map of blocks, SGLang's is a trie: finer-grained sharing, better hit rates on structured workloads. On top of it: a frontend language for constrained/structured generation (regex/JSON-schema decoding at speed), first-class MoE expert parallelism, and — since Dec 2025 — **EPD disaggregation** with Mooncake as its transfer backend (T6.L3).

**Trade-offs chosen:** optimizes hardest for workloads with *repetitive structure* — agents, tool-use loops, RAG with stable templates — where cache-hit rate is the throughput multiplier. Its general-purpose features track vLLM's (it shares much of the kernel ecosystem); the community is smaller. **Choose it when:** your traffic is agentic/templated (cache hits dominate), or structured output is your product's spine.`,
    },
    {
      type: 'prose',
      md: `## TensorRT-LLM: the compiler's answer

**Design center:** squeeze the GPU with a *build-time* approach — models are **compiled** into optimized engine artifacts: kernel fusion, per-layer precision selection, FlashAttention variants, in-flight (continuous) batching, paged KV, FP8 end-to-end, all tuned per-GPU-generation by NVIDIA's kernel teams. Where vLLM interprets a scheduler loop in Python, TRT-LLM's runtime is C++ with the graph pre-planned. Peak single-node throughput and latency numbers typically belong here, especially on flagship NVIDIA hardware with FP8.

**Trade-offs chosen:** performance and NVIDIA-hardware depth over flexibility. The compile step adds friction (model support lags open-weight releases; custom architectures need plugin work), the stack is deepest exactly on NVIDIA (obviously), and debugging a compiled engine is a different sport than debugging Python. **Choose it when:** tokens/s/GPU is your margin and your model set is stable — inference as a *fixed* production workload, compiled like the binary it is.`,
    },
    {
      type: 'prose',
      md: `## Dynamo: the data plane, not the engine

**Design center:** Dynamo (T3.L6) is deliberately **not** an inference engine — it's the distributed layer *around* engines (it runs TRT-LLM, vLLM, or SGLang as workers): KV-aware request routing, prefill/decode disaggregation orchestration, NIXL/UCX-based KV transfer over RDMA/NVLink, planner-driven autoscaling, all with the Rust data plane you studied. Since T3.L6 was written it went GA (v1.3): the **KVBM** — the tiered KV block manager, GPU→CPU→SSD→remote, in Rust — shipped as its memory layer, and **llm-d** (Red Hat/Google/CoreWeave) packages the same architecture Kubernetes-natively. If the engines are databases, Dynamo is the **proxy + replication + sharding tier**.

**Trade-offs chosen:** fleet-scale efficiency (disaggregation, cache-aware routing, per-phase scaling) at the price of operational complexity — another distributed system to run, with NATS, etcd, and transfer fabric of its own. **Choose it when:** you operate a serious multi-node fleet with long contexts or skewed prefill/decode ratios (T5.L9's rule of thumb), and the fleet-level wins exceed the platform cost. Small deployments: one vLLM box with chunked prefill is still the right answer.`,
    },
    {
      type: 'prose',
      md: `## The comparison, compressed

| | vLLM | SGLang | TRT-LLM | Dynamo |
|---|---|---|---|---|
| **Kind** | engine (library+server) | engine + frontend lang | compiled engine | distributed data plane |
| **Design center** | PagedAttention for all | RadixAttention cache reuse | build-time optimization | fleet orchestration |
| **Language core** | Python + CUDA | Python + CUDA | C++ + CUDA graphs | Rust + Python planner |
| **Signature win** | ecosystem default | agentic/structured traffic | peak per-GPU perf | long-context fleet goodput |
| **Price** | scheduler overhead | smaller ecosystem | compile friction, NVIDIA-shaped | operational complexity |
| **Runs on** | any CUDA (+AMD/TPU ports) | any CUDA | NVIDIA | wraps the other three |`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Map them to the world you know: **vLLM ≈ Postgres** (the default, everything works, extensible), **SGLang ≈ Redis with a query language** (a specialist whose cache semantics *are* the product), **TRT-LLM ≈ a hand-tuned C++ storage engine** (compiled, fused, fastest on its hardware, slower to change), **Dynamo ≈ Vitess/ProxySQL** (the fleet layer that makes the engines a cluster). And notice the meta-pattern one last time: every one of these is T0–T4 ideas — paging, scheduling, allocators, zero-copy, roofline, quantization — assembled with different priorities. You didn't learn four products. You learned the one design space they all live in.`,
    },
    {
      type: 'prose',
      md: `## Where you go from here

T5 is complete — and so is the technical spine of the course: cache lines to continuous batching, exactly as promised. The **capstone (T\\*)** now hands you the wheel: you'll build a toy inference engine end to end — tokenizer, paged KV manager, continuous batcher, metrics dashboard — and watch TTFT/ITL move as you flip the levers from this track. Everything you need is already in your head; the capstone just makes you *prove* it. Then the glossary and the lab will be your reference shelf for the papers you'll read next — and you will read them differently now: as a systems engineer, at home in the machine.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'SGLang\'s RadixAttention differs from vLLM\'s prefix caching in that…',
          options: [
            'It quantizes the cache',
            'The KV cache is a radix tree over token prefixes with LRU eviction — automatic, fine-grained prefix reuse across requests, ideal for agentic/templated traffic',
            'It stores the cache on CPU',
            'It removes the block manager',
          ],
          correct: [1],
          explanation:
            'Trie-shaped sharing beats hash-map sharing when prefixes overlap partially and frequently — agents, tool loops, multi-turn chats. Cache-hit rate becomes the throughput multiplier.',
        },
        {
          q: 'TensorRT-LLM\'s defining trade is…',
          options: [
            'Python velocity for GPU breadth',
            'Build-time compilation (fusion, per-layer precision, CUDA graphs) for peak per-GPU performance — accepting compile friction and slower model onboarding',
            'Distributed routing for fault tolerance',
            'Structured generation for JSON output',
          ],
          correct: [1],
          explanation:
            'The compiler\'s answer: pre-plan the graph, fuse the kernels, tune per GPU generation. Peak steady-state performance; the cost is flexibility and debuggability of a compiled artifact.',
        },
        {
          q: 'Dynamo is best characterized as…',
          options: [
            'A faster inference engine',
            'A distributed data plane around engines (vLLM/SGLang/TRT-LLM): KV-aware routing, disaggregation orchestration, KV transfer fabric, planner autoscaling — the proxy/sharding tier',
            'A quantization toolkit',
            'A model registry',
          ],
          correct: [1],
          explanation:
            'Dynamo deliberately runs other engines as workers. Its product is fleet-level goodput: routing for cache reuse, phase disaggregation, and Rust-speed KV movement (T3.L6).',
        },
        {
          q: 'For a single-GPU deployment serving short-context chat, the sound default is…',
          options: [
            'Full Dynamo + disaggregation',
            'One vLLM (or SGLang) instance with chunked prefill — fleet layers pay off at scale and long context, not here',
            'TRT-LLM with 8-way TP',
            'A custom CUDA stack',
          ],
          correct: [1],
          explanation:
            'Operational simplicity wins when the fleet-layer wins (disaggregation, distributed cache) can\'t amortize. The T5.L9 rule: disaggregate at scale/long context; colocate at small scale.',
        },
      ],
    },
  ],
}

export default lesson
