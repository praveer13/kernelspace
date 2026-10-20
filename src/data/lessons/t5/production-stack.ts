import type { AuthoredItem } from '@/lib/items/types'
import type { Lesson } from '../types'

/**
 * Spiral items (wave-2.md §6.2): authored questions on earlier KCs of T3, T4 and T5, drawn by the T5 checkpoint beside
 * the generated items. Refs are `item:<id>`; each option's `miss` names the slip it encodes.
 */
const SPIRAL: AuthoredItem[] = [
  {
    id: 't5.spiral.batch-weight-read',
    kcs: ['t4.decode-bandwidth'],
    q: {
      q: 'Doubling the decode batch from 8 to 16 sequences on one GPU barely changes the step time because…',
      options: [
        'Each sequence in the batch reads its own copy of the weights, and the copies overlap in time',
        'The weights are read from HBM once per step and shared, and the extra sequences ride on the same bytes',
        'The attention kernel skips half of the cached keys in a larger batch, and the saved reads offset the new work',
        'Larger batches switch the GPU to a faster clock, and that absorbs the additional arithmetic of the new sequences',
      ],
      correct: [1],
      explanation:
        'Decode is bandwidth-bound: the step time is mostly the weight read, which happens once however many sequences share it. More sequences raise arithmetic intensity, so tokens per second rise until compute or KV memory runs out.',
      why: [
        'Weights are not copied per sequence. If each sequence read its own copy, step time would grow with the batch and batching would not raise throughput.',
        'Right: one weight read per step is shared by every sequence in the batch. The extra sequences use compute that was idle, so tokens per step double for little extra time.',
        'Attention reads the whole cached prefix of every sequence, so a larger batch reads more KV, not less. That growing KV read is what eventually limits batch size.',
        'Clock speed does not change with batch size. The step stays about the same because the weight read dominates it, and the added arithmetic fits in idle compute.',
      ],
      miss: ['t4.weights-copied-per-sequence', '', 't4.attention-skips-keys', 't4.batch-raises-clock'],
    },
  },
  {
    id: 't5.spiral.slow-first-token',
    kcs: ['t5.prefill-vs-decode'],
    q: {
      q: 'A chat user waits four seconds for the first token, and then the reply streams quickly. Which phase explains the wait?',
      options: [
        'Decode, since each token has to read the full weights from memory before it can be shown',
        'Prefill, since the engine runs the whole prompt through the model before it can sample the first',
        'Sampling, since choosing the first token from the output distribution takes far longer than any later one',
        'Detokenization, since turning the first token id back into text needs a full pass over the vocabulary',
      ],
      correct: [1],
      explanation:
        'TTFT is prefill: every prompt token is processed (compute-bound) before the first token is sampled. ITL is decode: one weight read per step (bandwidth-bound).',
      why: [
        'Decode sets the gap between tokens, not the wait for the first one. A fast stream after the first token says decode is working at its normal speed.',
        'Right: prefill processes the whole prompt before the first output token exists, and it is compute-bound, so a long prompt means a long TTFT while later tokens stream at decode speed.',
        'Sampling is a small step after the forward pass and costs about the same for every token. It cannot explain a multi-second wait on the first token alone.',
        'Detokenization is a table lookup per token and costs the same for the first token as for the rest. It does not take a pass over the model or the vocabulary.',
      ],
      miss: ['t5.ttft-is-decode', '', 't5.ttft-is-sampling', 't5.ttft-is-detokenization'],
    },
  },
  {
    id: 't5.spiral.gqa-shrink',
    kcs: ['t5.gqa-kv-heads'],
    q: {
      q: 'A model has 64 query heads and 8 KV heads. Next to full multi-head attention with 64 heads, its KV cache per token is…',
      options: [
        'The same size, since each of the 64 query heads still needs its own keys and values to attend with',
        'Eight times smaller, since the cache keeps keys and values per KV head and there are far fewer of them',
        'Half the size, since grouping merges the K and V tensors into a single tensor per head',
        'Eight times larger, since each of the 8 KV heads must also store the keys of the query heads it serves',
      ],
      correct: [1],
      explanation: 'KV bytes per token scale with KV heads, not query heads: 8 of 64 is an eighth of the cache full multi-head attention would need.',
      why: [
        'Query heads share KV heads in groups, so they do not need private copies. Storing one K/V pair per group is exactly what shrinks the cache.',
        'Right: the cache holds K and V for each KV head, so 8 heads instead of 64 is one eighth of the bytes per token. Sizing by query heads is the common slip.',
        'GQA does not merge keys with values. K and V stay separate, and the saving comes from having fewer KV heads, not from combining the two tensors.',
        'A KV head stores only its own keys and values. The query heads that share it read from it and add nothing to the cache.',
      ],
      miss: ['t5.gqa-no-saving', '', 't5.gqa-merges-kv', 't5.gqa-grows-cache'],
    },
  },
  {
    id: 't5.spiral.shared-tail',
    kcs: ['t5.kv-copy-on-write'],
    q: {
      q: 'Two sequences share a block that holds their common prefix tail, so its refcount is 2. One of them appends a token that lands in that block. What does the block manager do?',
      options: [
        'It writes the token into the shared block, and both sequences then see the new token in their prefix',
        'It copies the block, points the writer at the copy and drops the refcount of the original by one',
        'It frees the block for both sequences, and the writer recomputes the whole prefix',
        'It holds the append until the other sequence finishes, and then the writer owns the block outright',
      ],
      correct: [1],
      explanation:
        'An append into a shared tail copies that one block (copy-on-write): the writer keeps the copy, the other owner keeps the original, and refcounts record who holds what.',
      why: [
        'A shared block is read-only. Writing into it would change the context of the other sequence, so the token cannot go there.',
        'Right: copy-on-write. The writer gets a private copy of the block with the new token, and the original keeps its other owner, with its refcount down to 1.',
        'Freeing a block that another sequence still uses would corrupt that sequence. Refcounts exist so a shared block returns only when its last owner drops it.',
        'Nothing makes the writer wait. Copying the one block is cheap, and waiting for the other sequence to finish could stall it for the whole generation.',
      ],
      miss: ['t5.cow-writes-shared-block', '', 't5.cow-frees-shared-block', 't5.cow-waits-for-owner'],
    },
  },
  {
    id: 't5.spiral.guard-age',
    kcs: ['t5.sched-order'],
    q: {
      q: 'A shortest-prompt-first scheduler moves any request that has waited past a fixed age to the front of the queue. What does that rule protect?',
      options: [
        'Short prompts from queueing behind a very long one, since the oldest request now goes first',
        'Long requests from waiting without end, since shorter ones keep arriving and going ahead of them',
        'The KV cache from running out of blocks, since old requests are the ones that hold the most memory',
        'The GPU from idling between iterations, since an aged request is ready to be admitted at once',
      ],
      correct: [1],
      explanation: 'Shortest-first cuts the average wait but can starve long prompts. A guard that promotes requests past an age bounds the wait of every request.',
      why: [
        'The guard does the opposite for the aged request: it jumps ahead of short ones. Short prompts already go first, and they are not what the rule protects.',
        'Right: without the guard a long prompt can starve, because shorter prompts keep jumping the queue. The age cap bounds how long any request waits.',
        'The guard is about order, not memory. An aged request still needs enough free blocks to be admitted, and promoting it adds no capacity.',
        'Idle iterations come from having too little admitted work, which headroom and capacity decide. Promoting an old request changes the order, not how much work there is.',
      ],
      miss: ['t5.guard-protects-short', '', 't5.guard-protects-memory', 't5.guard-protects-utilization'],
    },
  },
  {
    id: 't5.spiral.full-channel',
    kcs: ['t3.backpressure'],
    q: {
      q: 'A bounded channel between the tokenizer thread and the scheduler is full. What should a well-behaved producer do?',
      options: [
        'Wait for space, so the slowdown moves upstream and the queue stays at its own fixed bound',
        'Silently drop the new request, so the producer does not have to wait on the consumer',
        'Grow the channel until the request fits, so no producer is ever made to wait on a consumer',
        'Spin on the channel in a tight loop, so the send goes through the instant a slot opens',
      ],
      correct: [0],
      explanation: 'A bounded channel turns overload into waiting: the producer blocks (or awaits) until there is space, so pressure reaches the source and memory stays bounded.',
      why: [
        'Right: waiting for a slot is backpressure. The producer slows to the consumer\'s pace, the pressure travels upstream and memory stays bounded.',
        'Dropping silently loses work with no signal to the caller. Shedding load is sometimes right, but it should be a visible, deliberate reject, not a side effect of a full queue.',
        'A queue that grows without limit turns overload into memory exhaustion and long latency. The bound is the point: it forces the pressure back to the source.',
        'Spinning burns a core while it waits and still blocks the thread. An await or a blocking send parks the producer without wasting CPU.',
      ],
      miss: ['', 't3.full-drops-silently', 't3.full-grows-the-queue', 't3.full-spins'],
    },
  },
]

const lesson: Lesson = {
  id: 't5.l10',
  slug: 'production-stack',
  trackId: 't5',
  index: 10,
  title: 'The Production Stack: vLLM, SGLang, TRT-LLM, Dynamo',
  minutes: 35,
  hook: 'The guided architecture read: four production engines, their design centers, and when to choose which — the T5 capstone before the capstone.',
  exercise: 'read+quiz',
  verifiedAt: '2026-10',
  kcs: ['t5.engine-design-centers', 't5.radix-eviction', 't5.pd-disaggregation'],
  ticket: {
    form: 'spiral',
    cr: [
      {
        prompt: 'Compare vLLM\'s hashed-block prefix cache with SGLang\'s radix tree, and say which workload favours each.',
        model:
          'vLLM hashes full token blocks, chaining each hash to its parent, so a request reuses whole matching blocks. SGLang keeps a radix tree over token prefixes, so sharing is finer-grained, branches share their ancestors, and eviction is LRU on leaves. Both reuse K/V. The tree earns most on agent loops, stable templates and multi-turn chat.',
        ideas: [
          'vLLM hashes full blocks, each chained to its parent, and reuses whole matching blocks',
          'SGLang keeps a radix tree over prefixes, with finer sharing and LRU eviction of leaves',
          'The tree pays most on agent loops, stable templates and multi-turn chat',
        ],
        kcs: ['t5.radix-eviction', 't5.engine-design-centers'],
      },
      {
        prompt: 'Why is Dynamo not a competitor to vLLM, SGLang and TensorRT-LLM, and when is it worth running?',
        model:
          'Dynamo is a data plane around engines: it runs them as workers and adds KV-aware routing, prefill-decode disaggregation, KV transfer and autoscaling. It is worth its extra systems only for a multi-node fleet with long contexts or skewed prefill and decode load. A small deployment is better served by one engine with chunked prefill.',
        ideas: [
          'Dynamo wraps engines as workers rather than replacing them',
          'It adds routing, disaggregation, KV transfer and autoscaling at fleet level',
          'It pays only for multi-node fleets with long context or skewed load',
        ],
        kcs: ['t5.engine-design-centers', 't5.pd-disaggregation'],
      },
    ],
    spiral: SPIRAL,
  },
  blocks: [
    {
      type: 'predict',
      items: [
        {
          kind: 'choice',
          q: 'Which of vLLM, SGLang, TensorRT-LLM and Dynamo does not run the model itself?',
          options: [
            'vLLM, which loads the weights and runs its own scheduler and KV manager',
            'SGLang, which runs a radix-tree cache and a frontend language over its own kernels',
            'TensorRT-LLM, which runs the model on NVIDIA kernels with its own executor',
            'Dynamo, which routes requests and moves KV between engines that run the model',
          ],
          correct: [3],
          why: [
            'vLLM is an engine: its scheduler, KV manager and kernels run the model on the GPU. It is the reference implementation of the T5 loop.',
            'SGLang is an engine. It runs the model with its own scheduler and kernels, and adds a radix-tree cache and a frontend language on top.',
            'TensorRT-LLM is an engine too. Its executor owns the scheduler, KV manager and sampler, and runs NVIDIA\'s kernels.',
            'Right: Dynamo is the data plane around engines. It runs vLLM, SGLang or TensorRT-LLM as workers and handles routing, disaggregation and autoscaling.',
          ],
          revealAt: 'Dynamo: the data plane, not the engine',
          kcs: ['t5.engine-design-centers'],
        },
        {
          kind: 'choice',
          q: 'An agent product sends the same 3,000-token tool and system preamble with every call. Which engine feature does most for its cost?',
          options: [
            'Reuse of the cached K/V for that shared prefix, since each call then prefills only its new tokens',
            'Speculative decoding, since a fixed preamble makes every later token easy for a draft model to guess',
            'Pipeline parallelism, since a 3,000-token prompt is too long for the layers to fit on a single GPU',
            'Quantized weights, since a long prompt makes every decode step read far more bytes of weights',
          ],
          correct: [0],
          why: [
            'Right: with a shared preamble, prefix caching removes almost all prefill work on each call. Cache hit rate becomes the cost lever for agent and tool-use traffic.',
            'The preamble is input, so it does not make the output easier to guess. Speculation helps with predictable output, and it is a separate lever from the repeated prompt.',
            'A 3,000-token prompt is small for a model\'s context window and its KV fits easily. Splitting layers across GPUs solves a model-size problem, not a repeated-prompt one.',
            'Prompt length does not change how many weight bytes a decode step reads. Quantization shrinks weight reads, but it does nothing about repeated prefill.',
          ],
          revealAt: 'SGLang: structured generation as a first-class citizen',
          kcs: ['t5.engine-design-centers'],
        },
      ],
    },
    {
      type: 'prose',
      md: `You've assembled every piece: the memory hierarchy (T0), allocators and paging (T1–T2), Rust's role (T3), the GPU's physics (T4), and the serving algorithms (T5). This final lesson reads the four production stacks as *engineering arguments* — each one's design center, the trade-offs it chose, and when it wins. No marketing, no benchmarks-by-vendor; just architecture, using the vocabulary you now own.

The four: **vLLM** (the open-source reference), **SGLang** (the structured-generation specialist), **TensorRT-LLM** (NVIDIA's kernel-tuned performance stack), and **Dynamo** (NVIDIA's distributed data plane — which is a different *kind* of thing, as you'll see).`,
    },
    {
      type: 'prose',
      md: `## vLLM: the reference implementation

**Design center:** make PagedAttention's memory efficiency available to everyone, as a library. Python-first (fast contribution loop), CUDA custom kernels underneath, HuggingFace-native model loading, OpenAI-compatible server. Its architecture is the T5 curriculum in one repo: paged KV manager + prefix cache + continuous batching scheduler (T5.L5–L7) in \`vllm/v1/core\`, the V1 engine's cleaner scheduler and KV-cache manager (preemption is recompute-only, and freed blocks stay prefix-cached until evicted); chunked prefill, speculative decoding, FP8 KV, guided decoding all landed there first or early; TP/PP/DP + disaggregation support for scale-out (T5.L9).

**Trade-offs chosen:** velocity and breadth over peak micro-efficiency. The Python scheduler's overhead drove the **V1 engine rewrite** — which shipped as the default in 2025 with a rewritten scheduler/KV-cache manager and, in vLLM's own announcement, up to 1.7× the throughput of V0 (without multi-step scheduling); kernel coverage remains broad rather than maximally fused. **Choose it when:** you need the ecosystem default — every model on day one, every feature, huge community, sane operations. It is the "Postgres of LLM serving": rarely the wrong answer.`,
    },
    {
      type: 'prose',
      md: `## SGLang: structured generation as a first-class citizen

**Design center:** RadixAttention — the KV cache organized as a **radix tree over token prefixes**, so shared prefixes (system prompts, few-shot templates, multi-turn chats, agent loops) are reused *automatically* across requests with LRU eviction on the tree. If vLLM's prefix cache is a hash map of blocks, SGLang's is a trie: finer-grained sharing, better hit rates on structured workloads. On top of it: a frontend language for constrained/structured generation (regex/JSON-schema decoding at speed), first-class MoE expert parallelism, and — since Dec 2025 — **EPD disaggregation** with Mooncake as its transfer backend (T6.L3).

**Trade-offs chosen:** optimizes hardest for workloads with *repetitive structure* — agents, tool-use loops, RAG with stable templates — where cache-hit rate is the throughput multiplier. Its general-purpose features track vLLM's (it shares much of the kernel ecosystem); the community is smaller. **Choose it when:** your traffic is agentic/templated (cache hits dominate), or structured output is your product's spine.`,
    },
    {
      type: 'prose',
      md: `## TensorRT-LLM: NVIDIA's own kernels

**Design center:** squeeze the GPU with NVIDIA's own kernels and runtime. TRT-LLM began as a *build-time* compiler (models became pre-built TensorRT engines), but in the 1.x line the PyTorch backend is the default: the stack is architected on PyTorch, with a Python \`LLM\` API over a \`PyExecutor\` that owns the scheduler, the KV-cache manager and the sampler. The speed comes from custom kernels for attention, GEMMs and MoE, CUDA graphs, an overlap scheduler, FP8/FP4 paths, speculative decoding, wide expert parallelism and P/D disaggregation, all tuned per GPU generation by NVIDIA's kernel teams. Peak single-node throughput and latency numbers typically belong here, especially on flagship NVIDIA hardware with FP8 or FP4.

**Trade-offs chosen:** performance and NVIDIA-hardware depth over breadth. The stack is deepest exactly on NVIDIA (obviously), the best-tuned paths follow NVIDIA's newest hardware and recipes, and engine versions move fast: Dynamo v1.5.0 pins TRT-LLM 1.3.0rc25, a release candidate, so name versions when you compare. **Choose it when:** tokens/s/GPU is your margin and your model set is stable — inference as a *fixed* production workload tuned like the binary it is.`,
    },
    {
      type: 'prose',
      md: `## Dynamo: the data plane, not the engine

**Design center:** Dynamo (T3.L6) is deliberately **not** an inference engine — it's the distributed layer *around* engines (it runs TRT-LLM, vLLM, or SGLang as workers): KV-aware request routing, prefill/decode disaggregation orchestration, NIXL/UCX-based KV transfer over RDMA/NVLink, planner-driven autoscaling, all with the Rust data plane you studied. Since T3.L6 was written it went GA (v1.3) and kept moving: its **KVBM** — the tiered KV block manager, GPU→CPU→SSD→remote, in Rust — shipped as its memory layer, then was **deprecated in v1.5.0** (2026-09-21, removal targeted for v1.6.0) in favor of each engine's native KV offload, and **llm-d** (Red Hat/Google/CoreWeave) packages the same architecture Kubernetes-natively. If the engines are databases, Dynamo is the **proxy + replication + sharding tier**.

**Trade-offs chosen:** fleet-scale efficiency (disaggregation, cache-aware routing, per-phase scaling) at the price of operational complexity — another distributed system to run, with NATS, etcd, and transfer fabric of its own. **Choose it when:** you operate a serious multi-node fleet with long contexts or skewed prefill/decode ratios (T5.L9's rule of thumb), and the fleet-level wins exceed the platform cost. Small deployments: one vLLM box with chunked prefill is still the right answer.`,
    },
    {
      type: 'prose',
      md: `## The comparison, compressed

| | vLLM | SGLang | TRT-LLM | Dynamo |
|---|---|---|---|---|
| **Kind** | engine (library+server) | engine + frontend lang | engine (PyTorch-native, NVIDIA kernels) | distributed data plane |
| **Design center** | PagedAttention for all | RadixAttention cache reuse | NVIDIA-tuned kernels and runtime | fleet orchestration |
| **Language core** | Python + CUDA | Python + CUDA | Python runtime + C++/CUDA kernels | Rust + Python planner |
| **Signature win** | ecosystem default | agentic/structured traffic | peak per-GPU perf | long-context fleet goodput |
| **Price** | scheduler overhead | smaller ecosystem | NVIDIA-only depth | operational complexity |
| **Runs on** | any CUDA (+AMD/TPU ports) | any CUDA | NVIDIA | wraps the other three |`,
    },
    {
      type: 'reading',
      title: 'Read it in Rust: the data plane',
      lead: 'The table lists Dynamo\'s core as Rust. A data plane hands shared state to worker threads, and its types say what may cross: an `Arc` handle may, an `Rc` may not, and `Arc::clone` copies a handle, never the data behind it.',
      variants: ['verdict.smart-pointers', 'fix.smart-pointers'],
      count: 2,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Map them to the world you know: **vLLM ≈ Postgres** (the default, everything works, extensible), **SGLang ≈ Redis with a query language** (a specialist whose cache semantics *are* the product), **TRT-LLM ≈ a hand-tuned C++ storage engine** (vendor-tuned kernels, fastest on its hardware, NVIDIA-shaped), **Dynamo ≈ Vitess/ProxySQL** (the fleet layer that makes the engines a cluster). And notice the meta-pattern one last time: every one of these is T0–T4 ideas — paging, scheduling, allocators, zero-copy, roofline, quantization — assembled with different priorities. You didn't learn four products. You learned the one design space they all live in.`,
    },
    {
      type: 'prose',
      md: `## Where you go from here

T5 is complete — and so is the technical spine of the course: cache lines to continuous batching, exactly as promised. The **capstone (T\\*)** now hands you the wheel: you'll build a toy inference engine end to end — tokenizer, paged KV manager, continuous batcher, metrics dashboard — and watch TTFT/ITL move as you flip the levers from this track. Everything you need is already in your head; the capstone just makes you *prove* it. Then the glossary and the lab will be your reference shelf for the papers you'll read next — and you will read them differently now: as a systems engineer, at home in the machine.

First, the T5 spiral checkpoint: eight items, four on this lesson and four that revisit earlier lessons from T3 to T5, with one written or computed answer among them. Six right passes, and a miss only tells you what to revisit.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'SGLang\'s RadixAttention differs from vLLM\'s prefix caching in that…',
          options: [
            'It stores prefix tensors at lower numeric precision than vLLM does, and many more cached tokens fit on each device',
            'The cache is a radix tree over token prefixes with least-recently-used eviction, and reuse is automatic and fine-grained',
            'It keeps the cache in host memory instead of device memory, and the cache can grow far larger than device memory allows',
            'It drops the block manager and gives each request one contiguous buffer, and a shared prefix needs no pointer indirection',
          ],
          correct: [1],
          explanation:
            'Trie-shaped sharing beats hash-map sharing when prefixes overlap partially and frequently — agents, tool loops, multi-turn chats. Cache-hit rate becomes the throughput multiplier.',
          why: [
            'Radix caching is about how prefixes are indexed, not numeric precision. Both engines can run FP8 KV; neither design gets its reuse from quantization.',
            'Right: trie-shaped sharing handles prefixes that overlap partially and often, such as agents, tool loops and multi-turn chats, so cache hit rate becomes the throughput multiplier.',
            'RadixAttention keeps hot prefix KV on the GPU; host tiers come from separate offload features. The differentiator is the tree structure, not where the bytes live.',
            'SGLang still allocates KV from a pool that tree nodes point into. Contiguous per-request buffers would make sharing a prefix across requests impossible.',
          ],
          kcs: ['t5.radix-eviction', 't5.engine-design-centers'],
          miss: ['t5.radix-is-quantized', '', 't5.radix-is-host-cache', 't5.radix-drops-block-manager'],
        },
        {
          q: 'TensorRT-LLM\'s defining trade is…',
          options: [
            'Python-level development velocity and the broadest model coverage, at the cost of scheduler overhead and peak efficiency',
            'Vendor-tuned kernels with graph capture and an overlap scheduler for peak per-device speed, at the cost of tying the stack to one vendor\'s hardware',
            'A distributed routing and autoscaling layer for fleet fault tolerance, at the cost of a second system to operate',
            'Constrained decoding and a frontend language for structured output, at the cost of some general-purpose engine throughput',
          ],
          correct: [1],
          explanation:
            'TRT-LLM 1.x runs on a PyTorch-based runtime by default, not a pre-built engine. NVIDIA\'s custom kernels, CUDA graphs and overlap scheduling buy peak steady-state speed; the cost is NVIDIA-only depth.',
          why: [
            'That is vLLM\'s trade: Python-first velocity and breadth over peak micro-efficiency. TRT-LLM trades breadth for NVIDIA-tuned kernels and runtime, so its edge is peak per-GPU speed, not the widest model coverage.',
            'Right: TRT-LLM 1.x defaults to a PyTorch-based runtime with NVIDIA\'s custom kernels, CUDA graphs and overlap scheduling for peak steady-state throughput; the price is NVIDIA-only depth.',
            'That is Dynamo\'s role. TRT-LLM is an engine that serves a model on its GPUs; fleet routing and autoscaling sit in a layer around engines.',
            'That is SGLang\'s design center. TRT-LLM targets per-GPU speed on a stable model set, not a structured-output frontend language.',
          ],
          kcs: ['t5.engine-design-centers'],
          miss: ['t5.trt-is-vllm-trade', '', 't5.trt-is-fleet-layer', 't5.trt-is-structured-output'],
        },
        {
          q: 'Dynamo is best characterized as…',
          options: [
            'A faster inference engine that rewrites the scheduler and kernels of vLLM, and keeps the same serving loop and interface',
            'A data plane around existing engines that handles cache-aware routing, disaggregation and autoscaling for the fleet',
            'A quantization toolkit of low-precision recipes, so a converted checkpoint serves from fewer devices and less memory',
            'A model registry and artifact store for images and checkpoints, so weights are pushed to replicas on each deploy',
          ],
          correct: [1],
          explanation:
            'Dynamo deliberately runs other engines as workers. Its product is fleet-level goodput: routing for cache reuse, phase disaggregation, and a Rust data plane that orchestrates KV transfers, with NIXL (C++) moving the bytes (T3.L6).',
          why: [
            'Dynamo is not an engine. It runs vLLM, SGLang or TRT-LLM as workers; Rust covers its data plane (routing, transfer orchestration; NIXL moves the bytes), not the model execution loop.',
            'Right: Dynamo\'s product is fleet-level goodput. Routing for cache reuse, phase disaggregation and orchestrated KV transfers make it the proxy and sharding tier that turns engines into a cluster.',
            'Quantization belongs to engine tooling and model-optimization libraries. Dynamo\'s concern is how requests and KV move across engines, not the numeric format of the weights.',
            'Registries manage artifacts, not live traffic. Dynamo works at serving time: routing requests, moving KV between workers and scaling prefill and decode pools.',
          ],
          kcs: ['t5.engine-design-centers', 't5.pd-disaggregation'],
          miss: ['t5.dynamo-is-engine', '', 't5.dynamo-is-quantizer', 't5.dynamo-is-registry'],
        },
        {
          q: 'For a single-GPU deployment serving short-context chat, the sound default is…',
          options: [
            'Dynamo with disaggregation into prefill and decode pools, as its routing and cache reuse improve goodput even on one device',
            'One vLLM or SGLang instance with chunked prefill, as fleet layers pay off at scale and long context and not on one device',
            'A vendor-tuned engine built per model with plugins, as fused kernels beat a general scheduler at any deployment size',
            'A custom kernel stack with hand-written kernels and a lean loop, as short-context chat has no use for an engine\'s generality',
          ],
          correct: [1],
          explanation:
            'Operational simplicity wins when the fleet-layer wins (disaggregation, distributed cache) can\'t amortize. The T5.L9 rule: disaggregate at scale/long context; colocate at small scale.',
          why: [
            'Dynamo adds NATS, etcd and a transfer fabric. One GPU has no second worker to route to or disaggregate onto, so the platform cost buys nothing.',
            'Right: operational simplicity wins when fleet-level gains cannot amortize. Colocate with chunked prefill at small scale and short context; disaggregate at scale and long context.',
            'Vendor-tuned kernels pay off for a stable, fixed workload where tokens/s/GPU is the margin. As a default on one GPU they add NVIDIA-only lock-in and tuning effort for no fleet-level benefit.',
            'A custom stack rebuilds paging, continuous batching and kernel coverage that engines already ship. Short context removes the need for fleet layers, not for a proper KV manager and scheduler.',
          ],
          kcs: ['t5.engine-design-centers', 't5.pd-disaggregation'],
          miss: ['t5.small-needs-dynamo', '', 't5.small-needs-tuned-engine', 't5.small-needs-custom-stack'],
        },
      ],
    },
  ],
}

export default lesson
