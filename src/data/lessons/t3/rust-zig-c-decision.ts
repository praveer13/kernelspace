import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't3.l7',
  slug: 'rust-zig-c-decision',
  trackId: 't3',
  index: 7,
  title: 'Rust, Zig, or C: The Decision Framework',
  minutes: 20,
  hook: 'T3 taught you Rust. The senior skill is knowing when NOT to reach for it — four questions that decide the language, the case studies that prove them, and the honest 2026 map of who writes what in this field.',
  exercise: 'read+quiz',
  blocks: [
    {
      type: 'prose',
      md: `Every language sermon skips the only part that matters: the decision. T3.L6 showed you one made well (Dynamo's data plane in Rust, and the reasoning chain behind it). This lesson turns that chain into a rubric you can run in a meeting, then checks it against what the field actually ships in 2026. Spoiler: the answer is almost never "my favorite language." It is almost always "the language whose failure modes and ecosystem match this specific path."

**The four questions:**
1. **What does failure cost on this path?** Memory corruption with untrusted input (network-facing, multi-tenant, long-lived) → memory safety is not optional. That's Rust's table stakes, and the reason ~70% of serious CVEs being memory-safety issues is an argument, not a statistic.
2. **Where's the ecosystem gravity?** You do not get to choose in a vacuum. CUDA, NCCL, NIXL, UCX are C-ABI libraries — the language must interop for free. GPU kernels are CUDA C and Triton — no Rust, no Zig, no exceptions worth your quarter. The ML libraries you'll actually call (tokenizers, safetensors, cuBLAS) pick the language more often than you do.
3. **Who maintains it for five years?** Team velocity, hiring, compile-time guardrails vs review-time guardrails. A compiler that catches your invariants (Rust) is worth real money on a fast-moving codebase; a codebase your six-person team can hold in their heads entirely (Zig's pitch) is worth a different kind of money.
4. **What's the allocation and determinism budget?** Tail latency in microseconds and zero tolerance for hidden allocation (databases, embedded, schedulers) → you want allocation as a visible act: Zig's explicit-allocator discipline or C. GC-shaped languages already lost this round in T0.L5.`,
    },
    {
      type: 'prose',
      md: `## The 2026 map, honestly drawn

**Where Rust already won in this field:** NVIDIA Dynamo's entire data plane (the T3.L6 decision, shipped at v1.3 scale — NIXL's orchestration, KVBM's block manager). Cloudflare **Infire** — a whole edge inference engine in Rust. Hugging Face **tokenizers** — the Rust core underneath everyone's Python wrapper. The pattern: network-facing, byte-shuffling, latency-contracted infrastructure *around* the GPU. Rust owns the data plane.

**Where Zig is actually deployed:** **TigerBeetle** (the financial database — deterministic, explicit allocation everywhere, sim-tested to death; Zig's comptime used as a design tool), **Bun** (the JS runtime — Zig as a productive C replacement with a package manager), **Ghostty**, and in our field exactly one deployment that matters: **ZML** — a production inference stack in Zig, compiling models to accelerators (NVIDIA/AMD/TPU) with the compile-time metaprogramming Zig was built for. One is a pattern, four is a niche with momentum. Zig's bet: simplicity + comptime + C interop beats borrow-checker friction for teams small enough to hold the whole codebase in their heads.

**Where C is non-negotiable:** not as a *choice* — as the *water*. CUDA host APIs, kernel headers, io_uring, eBPF maps, NCCL internals when your all-reduce deadlocks at 3 AM. You will **read** C weekly for the rest of this career whether or not you ever write another line. T1.L5's ABI lesson is the literacy; the reading list is the job.`,
    },
    {
      type: 'prose',
      md: `## Applied: the serving stack, component by component

Run the four questions down the stack you've built in this course: **Router / API front** — untrusted input, 100k connections, tail latency: Rust (tokio, T3.L4). **Scheduler / KV block manager** — untrusted-adjacent, invariant-heavy, refactored weekly: Rust (your labs 02 and 06 are the proof shape). **Intake queue** — single-purpose, allocation-hostile hot loop: Rust still fine (lab 04), Zig equally defensible if the team prefers it. **GPU kernels** — ecosystem gravity wins: CUDA C or Triton, no vote. **io_uring / eBPF glue** — the kernel's ABI is C, so C. **CLI tooling, test harnesses, one-off migrations** — whatever the team ships fastest; this is where Zig earns honest keep. Notice what didn't appear anywhere in that list: ideology.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You have run this exact rubric as **"Postgres or Redis or Kafka?"** — failure cost (durability vs latency), ecosystem gravity (drivers, ops tooling), team (what you can operate at 3 AM), budget (memory, tail latency). Nobody chose Kafka for the user table because it was their favorite. The language decision is the same discipline one abstraction down: it's a data structure choice, not a personality.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The first question in the framework (failure cost) points to Rust primarily when…',
          options: [
            'The code is slow',
            'The path handles untrusted input at scale with tail-latency contracts — memory corruption is the dominant failure AND exploit class there',
            'The team likes Rust',
            'Rust has more crates',
          ],
          correct: [1],
          explanation:
            '~70% of serious CVEs are memory-safety. On network-facing, long-lived, multi-tenant paths, memory safety is a security property, not a comfort. That is exactly Dynamo\'s data plane and Infire\'s edge engine — and exactly why those teams paid the borrow-checker price.',
        },
        {
          q: '"Ecosystem gravity" means…',
          options: [
            'Popular languages win polls',
            'The libraries you cannot avoid — CUDA, NCCL, NIXL, UCX — pick the language for you: free C-ABI interop is mandatory, and GPU kernels mean CUDA C or Triton with no alternatives',
            'Rust is heavier',
            'Zig compiles faster',
          ],
          correct: [1],
          explanation:
            'You do not choose in a vacuum. The accelerators, collectives, and transfer libraries are C-ABI; the kernels are CUDA C/Triton. Language decisions that ignore the gravity well get made again next quarter.',
        },
        {
          q: 'Zig\'s honest 2026 position is…',
          options: [
            'Dead',
            'Dominant in serving',
            'A real but deliberate niche: TigerBeetle, Bun, Ghostty, and ZML in inference — chosen for explicit-allocation determinism and comptime by teams that hold the whole codebase in their heads',
            'A better C++ replacement than Rust in every way',
          ],
          correct: [2],
          explanation:
            'Four flagship deployments, one of them (ZML) in our exact field. The bet is simplicity + comptime + C interop over compile-time memory proofs. It is a deliberate choice, not a default — which is what the framework is for.',
        },
        {
          q: 'C\'s role in your career here is best described as…',
          options: [
            'Obsolete',
            'The water you swim in: CUDA host APIs, kernel headers, io_uring, eBPF, NCCL internals — read weekly whether or not you ever write it',
            'Only for kernels',
            'A personality type',
          ],
          correct: [1],
          explanation:
            'Reading C is non-negotiable infrastructure literacy — the ABI is the water (T1.L5). Writing it is reserved for kernel-space glue and the places the kernel already owns.',
        },
        {
          q: 'Per the component-by-component application, GPU kernels are written in…',
          options: [
            'Rust, because safety',
            'Zig, because comptime',
            'CUDA C or Triton — ecosystem gravity is absolute here; this is the one component with no vote',
            'Python',
          ],
          correct: [2],
          explanation:
            'The four questions are per-component, not per-project. Router: Rust. Scheduler: Rust. Kernels: CUDA C/Triton. io_uring glue: C. CLI tools: whatever ships. Ideology appears nowhere — that\'s the point of the framework.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Read the deployments, not the discourse',
      md: `The framework is only as good as the evidence: **Dynamo** (github.com/ai-dynamo/dynamo — the Rust components are named in the tree: KVBM, NIXL orchestration), **Infire** (Cloudflare's blog on their Rust edge engine), **TigerBeetle** (their "Safety" docs are the best explicit-allocation argument written), **ZML** (github.com/zml/zml — the one real Zig inference stack, worth an afternoon), and **Zig's own release notes** (the std churn across 0.14→0.15 is the honest maintenance price). When someone proposes a language for the next component, ask the four questions out loud and watch the sermon die.`,
    },
  ],
}

export default lesson
