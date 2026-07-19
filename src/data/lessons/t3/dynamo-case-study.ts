import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't3.l6',
  slug: 'dynamo-case-study',
  trackId: 't3',
  index: 6,
  title: "Why NVIDIA Dynamo's Data Plane Is Rust",
  minutes: 25,
  hook: 'NATS messaging, backpressure, KV-aware routing — a case study in choosing Rust for the hottest path in AI infrastructure.',
  exercise: 'read+quiz',
  blocks: [
    {
      type: 'prose',
      md: `In March 2025 NVIDIA open-sourced **Dynamo**, its distributed inference serving stack — the layer meant to sit beneath/around engines like TensorRT-LLM, vLLM, and SGLang and coordinate fleets of prefill and decode workers. Buried in the architecture docs is a decision that made systems people sit up: the performance-critical **data plane is written in Rust**, while the orchestration plane stays in Python. Not C++. Not Go. Rust.

This lesson is a case study in *why* — using everything you've learned in T0–T3. By the end you should be able to make (and defend) the same call for your own infrastructure. T5.L9 returns to Dynamo's full architecture; today is about the language decision and the machinery it enables.`,
    },
    {
      type: 'prose',
      md: `## What the data plane actually does

Disaggregated serving (T5.L8 gives the full treatment) splits the cluster: **prefill workers** compute the prompt's KV cache; **decode workers** generate tokens. The data plane is the connective tissue between them, and its job description reads like a greatest-hits of this course:

- **Move KV blocks** between workers — gigabytes per request, over RDMA/NVLink, with tail-latency budgets measured in single-digit milliseconds (a decode worker stalls without its KV).
- **Route requests KV-aware-ly**: send each new request to the worker that already holds the most of its prefix cache (locality-aware scheduling — T2.L4 with cache state as the priority).
- **Apply backpressure** when decode workers saturate: queue, shed, or reroute instead of letting latency explode (admission control, T2.L3–L4).
- **Stream events** — token streams, worker health, cache announcements — on a message bus (NATS) at high fan-out.

Every bullet is a memory-management and concurrency problem where a 10 ms GC pause or a use-after-free is an incident. Python orchestrates (planner logic, K8s integration); the bytes flow through Rust.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '~GB/s', label: 'KV transfer', hint: 'Per-worker KV movement between prefill and decode nodes over RDMA/NVLink.' },
        { value: 'ms-scale', label: 'TTFT budget', hint: 'Time-to-first-token targets leave no room for stop-the-world anything.' },
        { value: '0', label: 'GC pauses', hint: 'The entire point of Rust on this path: reclamation is deterministic and free-threaded.' },
        { value: '70%', label: 'C/C++ CVEs', hint: 'Microsoft/Google: share of serious vulns that are memory-safety — the C++ bill Dynamo declined.' },
      ],
    },
    {
      type: 'prose',
      md: `## Why Rust and not the alternatives — argued properly

**Why not Python for the data plane?** T0.L5 answered: the GIL serializes bytecode, objects are pointer soup, and pauses are unbudgetable. Python remains excellent for the *planner* — decisions per second: hundreds. The data plane needs decisions per second: millions, while moving GB/s. Different physics, different language. (Notice the honest engineering: they didn't rewrite everything — they drew the boundary at the hot path.)

**Why not C++?** C++ has the speed and the control — it's what the CUDA kernels are written in. What it doesn't have is a safety net for a codebase moving this fast, maintained by a large team, handling untrusted network input. The 70%-of-CVEs statistic is the business case: at infrastructure scale, memory bugs are the dominant failure *and* exploit class. Rust offers the same zero-cost abstractions, RAII, and layout control with the borrow checker as a full-time reviewer.

**Why not Go?** Go was the other serious candidate for systems like this (and plenty of control planes use it). The blockers for *this* path: the GC (sub-millisecond pauses usually — but "usually" under GB/s pressure is a tail-latency gamble), less control over layout (T0.L4's cache-line games matter on this path), and cgo's cost at the CUDA/RDMA boundary. Rust's C ABI interop (T1.L5) is free: call libcuda, libibverbs, NIXL/UCX directly.

**What Rust uniquely enabled:** tokio's async executor for 100k-connection fan-out (T3.L4), zero-copy buffer handling end-to-end (T3.L2's \`Bytes\` discipline), Send/Sync making the concurrency auditable (T3.L3), and fearless refactoring — the underrated one. Infrastructure this young changes weekly; a compiler that catches your invariants lets you move fast *and* sleep.`,
    },
    {
      type: 'isomorphism',
      title: 'Dynamo components ≡ course concepts',
      pairs: [
        {
          os: 'KV-aware router',
          osLine: 'Locality scheduling: run the job where its pages already live.',
          llm: 'prefix-cache routing',
          llmLine: 'Route requests to workers holding the most matching KV blocks — cache affinity as policy.',
        },
        {
          os: 'backpressure / admission control',
          osLine: 'Bounded queues, load shedding, OOM as last resort.',
          llm: 'planner + worker queues',
          llmLine: 'Queue depth signals scale/reject decisions before TTFT/ITL degrade.',
        },
        {
          os: 'zero-copy I/O (splice/io_uring)',
          osLine: 'Move bytes without user-space copies.',
          llm: 'NIXL/UCX KV transfer',
          llmLine: 'RDMA reads of KV blocks between workers, orchestrated from Rust.',
        },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `This architecture should look familiar: it's the **Netty/JVM split** (Java API over a native epoll transport), the **CPython split** (Python over C extension hot loops — numpy, torch), and the **Postgres split** (SQL planner over C executor) — every mature system eventually draws the line at "ergonomics above, bytes below." Dynamo just drew it with Rust for the first time at this scale in AI infra. T5.L9 will show the same pattern in SGLang (Python scheduler + RadixAttention core) and TensorRT-LLM (Python API over C++ runtime).`,
    },
    {
      type: 'prose',
      md: `## The takeaway for your own architecture reviews

The Dynamo decision is a template, not a religion. The reasoning chain you should steal: (1) **find the hot path** — measure where bytes and tail latency actually live; (2) **price the failure modes** — pauses, memory bugs, concurrency accidents, each with a dollar/incident cost; (3) **price the ergonomics** — team velocity, hiring, library ecosystem; (4) **draw the boundary** so each language does what it's for. Notice that nothing in that chain is "Rust is fast" or "Python is slow" — the entire argument is *where* each property matters.

You've now finished T3. T4 goes underneath all of this, to the machine the models actually run on: the GPU.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Dynamo keeps Python for the orchestration plane but Rust for the data plane primarily because…',
          options: [
            'Python cannot call CUDA',
            'The data plane moves GB/s of KV under ms tail-latency budgets — GC pauses and the GIL are unbudgetable there, while orchestration decisions are infrequent',
            'Rust has better Kubernetes APIs',
            'NVIDIA mandates Rust company-wide',
          ],
          correct: [1],
          explanation:
            'The boundary is drawn at physics: millions of small decisions + bulk bytes per second vs hundreds of planning decisions. Language properties (GC, GIL) are priced per plane — the mature "ergonomics above, bytes below" split.',
        },
        {
          q: 'The strongest argument against C++ for Dynamo\'s data plane was…',
          options: [
            'C++ is too slow for RDMA',
            'At infra scale with untrusted network input and a fast-moving codebase, memory-safety bugs (~70% of serious CVEs) are the dominant failure and exploit class',
            'C++ lacks async support',
            'C++ cannot interface with CUDA',
          ],
          correct: [1],
          explanation:
            'C++ matches Rust on speed and control — the delta is the safety net: borrow checking turns the dominant CVE class into compile errors, and makes weekly refactors of young infrastructure survivable.',
        },
        {
          q: 'KV-aware routing in Dynamo is best mapped to which course concept?',
          options: [
            'Consistent hashing for sharding',
            'Locality/affinity scheduling — run the work where its state already lives, like cache-aware OS scheduling',
            'Round-robin load balancing',
            'Priority inheritance',
          ],
          correct: [1],
          explanation:
            'Routing a request to the worker holding its prefix cache is scheduling for state locality — the same instinct as NUMA-aware placement and cache-affinity schedulers, applied to KV blocks.',
        },
        {
          q: 'Which Rust features map most directly onto Dynamo\'s data-plane requirements?',
          options: [
            'Procedural macros and reflection',
            'tokio (async fan-out), zero-copy buffers (Bytes), Send/Sync (auditable concurrency), and free C ABI interop with CUDA/RDMA libraries',
            'The borrow checker alone — nothing else mattered',
            'Cargo\'s package registry',
          ],
          correct: [1],
          explanation:
            'The case study is the whole T3 curriculum in production: executor for 100k connections, view-instead-of-copy byte handling, compile-time race freedom, and zero-cost calls into libcuda/UCX/NIXL.',
        },
      ],
    },
  ],
}

export default lesson
