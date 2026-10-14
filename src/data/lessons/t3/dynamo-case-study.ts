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

This lesson is a case study in *why* — using everything you've learned in T0–T3. By the end you should be able to make (and defend) the same call for your own infrastructure. T5.L10 returns to Dynamo's full architecture; today is about the language decision and the machinery it enables.`,
    },
    {
      type: 'prose',
      md: `## What the data plane actually does

Disaggregated serving (T5.L9 gives the full treatment) splits the cluster: **prefill workers** compute the prompt's KV cache; **decode workers** generate tokens. The data plane is the connective tissue between them, and its job description reads like a greatest-hits of this course:

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
      md: `This architecture should look familiar: it's the **Netty/JVM split** (Java API over a native epoll transport), the **CPython split** (Python over C extension hot loops — numpy, torch), and the **Postgres split** (SQL planner over C executor) — every mature system eventually draws the line at "ergonomics above, bytes below." Dynamo just drew it with Rust for the first time at this scale in AI infra. T5.L10 will show the same pattern in SGLang (Python scheduler + RadixAttention core) and TensorRT-LLM (Python API over C++ runtime).`,
    },
    {
      type: 'prose',
      md: `## The takeaway for your own architecture reviews

The Dynamo decision is a template, not a religion. The reasoning chain you should steal: (1) **find the hot path** — measure where bytes and tail latency actually live; (2) **price the failure modes** — pauses, memory bugs, concurrency accidents, each with a dollar/incident cost; (3) **price the ergonomics** — team velocity, hiring, library ecosystem; (4) **draw the boundary** so each language does what it's for. Notice that nothing in that chain is "Rust is fast" or "Python is slow" — the entire argument is *where* each property matters.

You've now finished T3. T4 goes underneath all of this, to the machine the models actually run on: the GPU.`,
    },
    {
      type: 'field-note',
      title: 'Mooncake: Trading More Storage for Less Computation',
      source: 'Qin et al.',
      href: 'https://www.usenix.org/conference/fast25/presentation/qin',
      published: "FAST '25 Best Paper",
      verified: '2026-08',
      md: `Mooncake is the distributed-systems complement to Dynamo's data plane. KV is no longer an allocation trapped on one GPU; it is a named object moved through GPU HBM, host DRAM, SSD, and RDMA by a transfer engine, while the scheduler optimizes effective throughput under latency SLOs. Read the component boundaries first — metadata, transfer, placement, admission — and ask which invariants deserve ownership types or fail-closed APIs.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Dynamo keeps Python for the orchestration plane but Rust for the data plane primarily because…',
          options: [
            'Python cannot call the accelerator libraries and any code that drives transfers must live in a compiled language such as C++',
            'The data plane moves bulk bytes under tight tail budgets where collector pauses and the interpreter lock cannot be budgeted',
            'Rust is simply faster than Python in general and the split mostly reflects the parts the team rewrote to date',
            'The Rust async executor can drive kernels on the accelerator directly and the Python asyncio loop cannot',
          ],
          correct: [1],
          explanation:
            'The boundary is drawn at physics: millions of small decisions + bulk bytes per second vs hundreds of planning decisions. Language properties (GC, GIL) are priced per plane — the mature "ergonomics above, bytes below" split.',
          why: [
            'Python drives CUDA daily through PyTorch and other C-extension libraries. The limit is runtime behaviour on the hot path, not whether the language can call the GPU stack.',
            'Right: the data plane needs pause-free, parallel handling of bulk bytes under tight tail latency, while the planner makes few decisions. Each plane gets the language whose costs fit it.',
            'The argument is where properties matter, not that one language is faster everywhere. Python stays for low-rate planning; the boundary follows the hot path, not a rewrite backlog.',
            'Kernel launches go through the CUDA runtime, a C API reachable from any language. An async executor schedules host-side tasks; it does not run or drive GPU work itself.',
          ],
          kcs: ['t3.data-plane-requirements'],
          miss: ['t3.python-cannot-drive-accelerators', '', 't3.rust-is-faster-everywhere', 't3.executor-drives-gpu-kernels'],
        },
        {
          q: 'The strongest argument against C++ for Dynamo\'s data plane was…',
          options: [
            'C++ cannot match Rust\'s speed on transfer paths, so KV transfer throughput would drop and stall decode workers',
            'Memory-safety bugs dominate the failures and exploits on network-facing paths, so safety wins over speed',
            'C++ lacks a mature async I/O ecosystem, so the team would write its own event loop for connection fan-out',
            'C++ cannot link against the accelerator and transfer libraries directly, so it needs a wrapper layer around each',
          ],
          correct: [1],
          explanation:
            'C++ matches Rust on speed and control — the delta is the safety net: borrow checking turns the dominant CVE class into compile errors, and makes weekly refactors of young infrastructure survivable.',
          why: [
            'C++ matches Rust on speed and layout control; neither pays for a GC or heavy runtime. Throughput on transfer paths was not the gap.',
            'Right: both languages are fast. The difference is that compile-time ownership checking removes the dominant vulnerability class for a large team shipping network-facing code weekly.',
            'Asio and C++20 coroutines give C++ capable async I/O. The case against C++ here is memory safety, not missing event-loop machinery.',
            'CUDA and the RDMA libraries are C or C++ themselves, so C++ links to them with no wrapper. Interop favours C++, which makes safety the deciding factor.',
          ],
          kcs: ['t3.data-plane-requirements'],
          miss: ['t3.cpp-is-slower-than-rust', '', 't3.cpp-lacks-async-io', 't3.cpp-cannot-link-accelerator-libraries'],
        },
        {
          q: 'KV-aware routing in Dynamo is best mapped to which course concept?',
          options: [
            'Consistent hashing on the prompt prefix that statically maps each prefix to a fixed worker',
            'Locality scheduling that sends work to where its state already lives by using live cache state',
            'Least-connections load balancing that sends each request to the worker with the fewest in-flight requests',
            'Work stealing where idle workers pull queued requests from the queues of busy peers',
          ],
          correct: [1],
          explanation:
            'Routing a request to the worker holding its prefix cache is scheduling for state locality — the same instinct as NUMA-aware placement and cache-affinity schedulers, applied to KV blocks.',
          why: [
            'A hash gives a fixed mapping that ignores what each worker holds after evictions and transfers. KV-aware routing reads live cache state, so it follows where the blocks are now.',
            'Right: the router scores workers by how much of the request\'s prefix cache each holds, as an affinity scheduler keeps a thread near its warm caches.',
            'Least-connections optimises load only and is blind to cache contents, so a request can land on a worker with none of its prefix and redo the prefill.',
            'Work stealing moves queued work toward idle workers, trading locality for balance. KV-aware routing picks a worker up front because it holds the blocks, not because it is idle.',
          ],
          kcs: ['t3.data-plane-requirements'],
          miss: ['t3.kv-routing-is-prefix-hashing', '', 't3.kv-routing-is-least-connections', 't3.kv-routing-is-work-stealing'],
        },
        {
          q: 'Which Rust features map most directly onto Dynamo\'s data-plane requirements?',
          options: [
            'Procedural macros, reflection and codegen, which let the data plane serialize KV descriptors without hand-written code',
            'Tokio for async fan-out, Bytes for zero-copy buffers, Send and Sync for auditable races, and the C ABI for interop',
            'The borrow checker alone, with every other requirement equally met by C++ and the same libraries',
            'Cargo and its package registry, which supply pure-Rust replacements for the CUDA and RDMA transfer libraries',
          ],
          correct: [1],
          explanation:
            'The case study is the whole T3 curriculum in production: executor for 100k connections, view-instead-of-copy byte handling, compile-time race freedom, and zero-cost calls into libcuda/UCX/NIXL.',
          why: [
            'Rust has no run-time reflection, and proc macros only save boilerplate. They do not address pauses, fan-out, copies or races, so they are a convenience rather than a data-plane requirement.',
            'Right: these four map directly to fan-out, copy discipline, race freedom, and calling libcuda, UCX and NIXL, which is what the data plane has to do.',
            'The borrow checker covers memory safety only. Handling 100k connections, avoiding copies and calling CUDA or RDMA libraries still depend on tokio, Bytes and the C ABI.',
            'There is no pure-Rust CUDA or RDMA stack to swap in. The data plane calls the existing C and C++ libraries through FFI; the registry helps only with ordinary dependencies.',
          ],
          kcs: ['t3.data-plane-requirements'],
          miss: ['t3.rust-needs-macros-and-reflection', '', 't3.borrow-checker-alone-suffices', 't3.cargo-replaces-cuda-libraries'],
        },
        {
          q: 'A decode worker\'s intake queue is full while requests keep arriving. Which response is backpressure?',
          options: [
            'Grow the queue without limit, so every request is accepted and each one waits longer as the backlog builds up',
            'Drop the oldest queued requests silently, so the queue stays short and clients learn of it by timing out',
            'Make the push fail or wait so the caller has to retry, shed or reroute while the delay is still small',
            'Add a retry loop inside the worker, so it polls the full queue until a slot frees up for the next one',
          ],
          correct: [2],
          explanation:
            'Backpressure is a bounded queue that says no: the push fails or waits, so overload is felt by the producer, which can retry, shed or reroute. It is admission control with the limit built into the queue\'s type.',
          why: [
            'An unbounded queue hides overload: memory and latency grow until something else fails. Backpressure means the limit is visible to the producer, not absorbed by a growing backlog.',
            'Silent drops discard work without telling the producer, so nothing upstream slows down or reroutes. Backpressure is a signal the sender can act on, such as an Err or a wait.',
            'Right: a bounded queue whose push returns an error or blocks tells the producer to retry, shed or reroute while the delay is still small. Overload waits upstream instead of exhausting memory.',
            'Spinning on the consumer side burns a core and tells no sender anything. The signal has to travel back to the producer, which is what a bounded push does.',
          ],
          kcs: ['t3.backpressure', 't2.admission-scheduling'],
          miss: ['t3.unbounded-queue-is-backpressure', 't3.silent-drop-is-backpressure', '', 't3.worker-spin-is-backpressure'],
        },
      ],
    },
  ],
  kcs: ['t3.data-plane-requirements', 't3.backpressure'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt:
          'A decode worker saturates while the router keeps sending. Explain how a bounded queue turns that overload into backpressure.',
        model:
          'With an unbounded queue the backlog grows until memory or latency fails. With a bounded queue, push returns an error or waits when it is full, so the router learns at once that the worker is saturated. It can retry, shed load or reroute to another worker, so overload is handled upstream before tail latency explodes.',
        ideas: [
          'An unbounded queue hides overload until memory or latency fails',
          'A bounded push returns an error or waits when full, so the sender learns immediately',
          'The sender can then retry, shed or reroute before tail latency explodes',
        ],
        kcs: ['t3.backpressure', 't2.admission-scheduling'],
      },
      {
        prompt:
          'Split a serving system into a data plane and a control plane, and say what each one needs from its language.',
        model:
          'The data plane moves bulk bytes at millions of decisions a second under tight tail budgets, so it needs no GC pauses, control over layout and memory safety: Rust. The control plane, the planner and orchestration, decides hundreds of times a second, so Python\'s ergonomics win. The boundary follows the measured hot path.',
        ideas: [
          'The data plane moves bulk bytes at high rates under tight tail budgets, so it needs no pauses and memory safety',
          'The control plane decides at low rates, so ergonomics matter more than raw speed',
          'Draw the boundary at the measured hot path',
        ],
        kcs: ['t3.data-plane-requirements'],
      },
    ],
  },
}

export default lesson
