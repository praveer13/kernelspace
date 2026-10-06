import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't0.l1',
  slug: 'why-systems',
  trackId: 't0',
  index: 1,
  title: 'Why Systems Thinking Matters for LLM Serving',
  minutes: 15,
  hook: 'The whole field re-derives 50 years of OS ideas: PagedAttention = virtual memory, Dynamo = Rust data plane, decode = bandwidth-bound.',
  exercise: 'quiz',
  blocks: [
    {
      type: 'prose',
      md: `You already know how to serve traffic. You can shard a database, tune a connection pool, read a flame graph, and argue about p99 latency at a whiteboard. What you probably cannot do yet — and what this course will teach you — is explain *why* an LLM serving stack behaves the way it does. Why does adding one more request to a batch sometimes double throughput and sometimes OOM the GPU? Why does the vLLM paper spend three pages describing what is, unmistakably, a page table? Why did NVIDIA write Dynamo's data plane in Rust instead of Python?

The answers are all systems answers. Not ML answers — **systems** answers. The teams building vLLM, SGLang, TensorRT-LLM, and NVIDIA Dynamo keep re-deriving ideas that operating systems settled between 1965 and 1995: virtual memory, paging, eviction, scheduling, admission control, zero-copy I/O. The GPU changed the hardware. It did not change the physics.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '1962', label: 'virtual memory', hint: 'The Atlas computer at Manchester introduces paging and one-level stores.' },
        { value: '2023', label: 'PagedAttention', hint: 'vLLM re-implements paging for KV caches — block tables, sharing, near-zero waste.' },
        { value: '2025', label: 'Dynamo', hint: 'NVIDIA launches (GTC, March 2025) a disaggregated serving stack with a Rust data plane.' },
        { value: '~50y', label: 'idea half-life', hint: 'The concepts outlive every framework you have ever learned.' },
      ],
    },
    {
      type: 'prose',
      md: `## The same fifty-year-old ideas

Here is the thesis of the entire course, stated once, up front: **modern LLM serving is operating systems, reincarnated on accelerators.** When the vLLM authors needed to manage the key-value cache — the per-token attention state that eats GPU memory alive — they reached for the exact machinery an OS uses to manage RAM: fixed-size blocks, a block table per sequence, copy-on-write sharing, and near-zero fragmentation. They named it PagedAttention, and said so in the title of the paper.

When serving clusters needed to move gigabytes of KV state between prefill nodes and decode nodes without stalls, engineers reached for zero-copy networking, backpressure, and message queues. NVIDIA wrote Dynamo's orchestration of those transfers in Rust (the transfer library underneath, NIXL, is C++), for the same reasons operating systems are written in C and Rust: predictable latency, no garbage collector, direct control of memory layout.

Once you see the isomorphism, the papers stop being alien. They become *familiar ideas with new variable names.*`,
    },
    {
      type: 'isomorphism',
      title: 'the through-line of this course',
      pairs: [
        {
          os: 'page table',
          osLine: 'Maps virtual pages → physical frames so processes share RAM safely.',
          llm: 'KV block table',
          llmLine: 'Maps a sequence\'s logical tokens → physical KV blocks in GPU memory.',
          breaks: 'A page table also isolates processes from each other; the block table only lets one sequence\'s tokens sit in scattered blocks, and every sequence\'s blocks live in one shared KV pool with no protection boundary between them.',
        },
        {
          os: 'swap / eviction',
          osLine: 'Cold pages move to disk under memory pressure; LRU decides who.',
          llm: 'KV preemption & offload',
          llmLine: 'When HBM fills up, vLLM V1 preempts a sequence: its blocks are freed and recomputed later (V0 could swap them to CPU RAM).',
          breaks: 'A swapped-out page keeps its contents on disk and returns on a fault; in V1 a preempted sequence loses its blocks and the engine recomputes its prefill on resume, so the price is GPU compute rather than I/O.',
        },
        {
          os: 'scheduler',
          osLine: 'Preemptive multitasking packs runnable processes onto cores.',
          llm: 'continuous batcher',
          llmLine: 'Iteration-level scheduling packs running requests onto the GPU.',
          breaks: 'The OS preempts a running thread when its time quantum expires; continuous batching has no quantum, so a sequence normally stays in the batch until it finishes and is preempted mainly when KV blocks run out.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## You are closer than you think

If you come from the JVM, you have been running a managed operating system for one process your whole career. The garbage collector is a memory manager with a free-list problem. The JIT is a profile-guided recompiler. A thread pool with a bounded queue is an admission controller. When you tuned \`-Xmx\` against GC pauses, you were trading memory footprint against collection frequency — the same trade-off a KV-cache manager makes when it decides how many tokens can stay resident on an H100.

Python engineers: the GIL is a big kernel lock. \`asyncio\` is cooperative scheduling on one OS thread. A \`list\` over-allocates with a growth strategy exactly like a \`std::vector\`. None of this is a criticism — these runtimes are systems programs, and they are excellent reference points for everything that follows.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Think of the JVM as an OS for exactly one tenant. It pages (heap regions), schedules (threads + JIT deopt), isolates (classloaders), and does IPC (JNI). Every concept you meet in T1–T2 has a JVM cousin you already understand. The course will keep translating back — that's the whole trick.`,
    },
    {
      type: 'prose',
      md: `## Why decode is bandwidth-bound — a preview

One concrete example of systems thinking paying rent immediately. Serving an LLM has two phases: **prefill** (process the prompt, in parallel, one big matrix operation) and **decode** (emit tokens one at a time, autoregressively). During decode, generating a single token requires reading *every model weight* from HBM exactly once, plus the entire KV cache. An 8-billion-parameter model in FP16 means moving ~16 GB per token. HBM3 bandwidth is about 3.35 TB/s, so the physics floor is roughly 5 ms per token — no matter how clever your kernel is, because the ALUs are idle most of the time waiting on memory.

That single fact — *decode moves bytes, prefill does math* — explains batching economics, quantization, speculative decoding, and half the design of vLLM. You will prove it yourself with the roofline model in T4. For now, file it away: **in this field, memory bandwidth is the scarce resource, and every serious optimization is a story about moving fewer bytes.**`,
    },
    {
      type: 'callout',
      variant: 'segfault',
      title: 'COMMON MISCONCEPTION',
      md: `"GPU poor" discourse frames serving as a FLOPs problem — buy more compute, serve more tokens. Wrong unit. For decode-heavy chat workloads the bottleneck is HBM bandwidth and capacity, not arithmetic. Teams that size clusters on TFLOPs discover the mistake in their first capacity review.`,
    },
    {
      type: 'prose',
      md: `## How this course works

The curriculum is a stack, read bottom to top — like an address space. **T0** (this track) gives you the five numbers and mental models that explain every performance bug you have ever had. **T1** drops to C level: stack frames, pointers, and a toy allocator — because KV-cache managers are fancy allocators. **T2** is the operating system: virtual memory, eviction, scheduling, concurrency. **T3** is just enough Rust to read production serving code without flinching. **T4** is the GPU itself: SIMT, HBM, rooflines. **T5** assembles it all into the production stack — attention math, KV-cache arithmetic, PagedAttention, continuous batching, and a guided read of how vLLM, SGLang, TensorRT-LLM, and Dynamo actually work.

Everything is unlocked. The order is the point. Each lesson is 15–35 minutes, ends with a checkpoint quiz, and most embed a simulator where you can break things safely. Let's go touch the machine.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'PagedAttention (vLLM) is best understood as a direct port of which OS idea?',
          options: [
            'Virtual memory paging, with fixed-size KV blocks and one block table for each sequence',
            'Round-robin CPU scheduling, with sequences taking fixed time slices on the GPU in turn',
            'Journaling filesystems, with KV blocks written ahead to a log for replay after a crash',
            'Interrupt-driven I/O with DMA, with the GPU copying KV state into memory on its own',
          ],
          correct: [0],
          explanation:
            'The vLLM paper frames KV-cache management explicitly as paging: logical token blocks map to physical KV blocks through a block table, sequences share prefixes copy-on-write, and fragmentation drops to near zero.',
          why: [
            'Right: the vLLM paper treats KV cache like virtual memory: fixed-size blocks, a per-sequence block table from logical to physical blocks, and copy-on-write for shared prefixes. Fragmentation drops to near zero.',
            'Mixes up memory management with scheduling. Time slicing decides who runs next; PagedAttention decides where each sequence\'s KV bytes live. Continuous batching is the scheduling side, a separate idea.',
            'Journaling protects on-disk metadata across crashes. KV cache is volatile GPU memory that is simply recomputed if lost, so there is no log to replay and no durability problem for PagedAttention to solve.',
            'DMA and interrupts are about moving bytes without the CPU. PagedAttention solves allocation and fragmentation of KV memory, not how bytes get transferred, so this describes a different layer of the system.',
          ],
        },
        {
          q: 'During single-token decode of an 8B FP16 model (~16 GB of weights), what fundamentally limits tokens/second?',
          options: [
            'Peak GPU compute throughput, with the math units setting the pace for each token',
            'HBM bandwidth, with each token streaming the full weights and KV cache out of GPU memory',
            'PCIe bandwidth, with the weights crossing the link from host RAM to the GPU for each token',
            'CPU-side tokenization, with text and token ids converted at a cost above the GPU forward pass',
          ],
          correct: [1],
          explanation:
            'Decode is memory-bound: ~16 GB moved per token against ~3.35 TB/s HBM3 gives a ~5 ms/token physics floor. Compute units sit idle waiting for bytes; that is why batching and quantization (fewer bytes) are the big levers.',
          why: [
            'Confuses compute-bound with memory-bound. 16 GFLOPs is trivial next to hundreds of TFLOPs; at small batch the math units idle waiting for weights. Compute only binds at large batch sizes.',
            'Right: decode does about 1 FLOP per byte read, so moving ~16 GB per token at ~3.35 TB/s HBM3 gives a ~5 ms floor. Batching and quantization help because they cut bytes moved per token.',
            'Weights stay resident in HBM after loading; PCIe carries prompts and sampled tokens. Streaming 16 GB per token over PCIe (roughly 64 GB/s) would be far slower than HBM at 3.35 TB/s.',
            'Tokenization is a microsecond-scale CPU step, overlapped with GPU work. It affects front-end latency, not the per-token decode floor, which is set by bytes read from HBM.',
          ],
        },
        {
          q: 'Why did NVIDIA implement Dynamo\'s data plane in Rust rather than Python?',
          options: [
            'Rust has better GPU driver support, with bindings that reach the hardware directly',
            'Rust gives predictable tail latency without GC pauses, with tight control of KV transfers',
            'Python lacks async I/O support, with each networked KV transfer blocking the whole data plane',
            'Rust compiles to CUDA natively, with the data plane and GPU kernels in one codebase',
          ],
          correct: [1],
          explanation:
            'A serving data plane coordinates gigabytes of KV-cache transfers under tight tail-latency budgets (NIXL, a C++ library, moves the bytes; Dynamo\'s Rust code orchestrates it). GC pauses and interpreter overhead are exactly what you cannot afford; Rust gives C-level control with memory safety, the same rationale as OS kernels.',
          why: [
            'Driver access is not the issue. CUDA drivers expose C APIs, and Rust and Python both call them through bindings. The GPU executes the same CUDA kernels either way.',
            'Right: a data plane that orchestrates gigabytes of KV transfers runs under tight p99 budgets. Interpreter overhead and unpredictable pauses hurt there; Rust gives C-level control with memory safety, the same rationale as OS kernels.',
            'Python has asyncio and mature async libraries. The real cost is interpreter overhead and the GIL under heavy transfer concurrency, not missing async syntax.',
            'Production GPU kernels are written in CUDA C++ or similar, not compiled from Rust. Rust in Dynamo is host-side code orchestrating transfers, so a shared-toolchain argument does not apply.',
          ],
        },
        {
          q: 'An 8B FP16 model streams ~16 GB of weights every decode step. Why can adding requests to the batch raise throughput almost for free, yet eventually cause an OOM?',
          options: [
            'Each request brings its own GPU compute units, with throughput scaling until the chip runs out of cores',
            'The batch shares one KV cache, with memory staying flat and a long prompt the sole OOM trigger',
            'The weights stream once per step for the whole batch, with each sequence adding its own KV cache',
            'Idle compute units absorb extra requests for free, with the OOM arriving past peak GPU FLOPs',
          ],
          correct: [2],
          explanation:
            'Decode is memory-bound: the weights are read once per step, so a bigger batch spreads the same ~16 GB over more tokens. But every sequence needs its own KV cache, so HBM capacity becomes the cap. That is the opening question of this lesson, answered.',
          why: [
            'A GPU has fixed compute units and extra requests bring none. The free ride comes from reusing weights already streamed, and a failed allocation is a memory event, not a core count.',
            'Each sequence owns a KV cache that grows by one entry per token, apart from shared prefixes. Memory therefore grows with batch size and context length, and that growth is the usual cause of OOM.',
            'Right: the ~16 GB of weights are read once per step whatever the batch size, so extra sequences reuse them. Each adds only its own KV cache, which grows with context and eventually fills HBM.',
            'Idle compute is real at small batch, which is why batching is cheap, but an OOM is a memory error, not a FLOPs limit. Too few FLOPs slow steps; too little HBM fails allocation.',
          ],
        },
      ],
    },
  ],
}

export default lesson
