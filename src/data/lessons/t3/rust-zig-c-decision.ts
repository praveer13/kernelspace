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
  verifiedAt: '2026-10',
  blocks: [
    {
      type: 'prose',
      md: `Every language sermon skips the only part that matters: the decision. T3.L6 showed you one made well (Dynamo's data plane in Rust, and the reasoning chain behind it). This lesson turns that chain into a rubric you can run in a meeting, then checks it against what the field actually ships in 2026. Spoiler: the answer is almost never "my favorite language." It is almost always "the language whose failure modes and ecosystem match this specific path."

**The four questions:**
1. **What does failure cost on this path?** Memory corruption with untrusted input (network-facing, multi-tenant, long-lived) → memory safety is not optional. That's Rust's table stakes, and the reason ~70% of serious CVEs being memory-safety issues is an argument, not a statistic.
2. **Where's the ecosystem gravity?** You do not get to choose in a vacuum. CUDA, NCCL, NIXL, UCX are C-ABI libraries — the language must interop for free. GPU kernels follow the vendor ecosystem: CUDA C++, and increasingly Python DSLs (CuTe DSL, Triton/Gluon, TileLang). Rust GPU projects (CubeCL, rust-cuda) exist but are marginal in production, and Zig and Go have no vote. (cudarc is not one of them: it wraps the host-side CUDA API so Rust can launch kernels, not write them.) The ML libraries you'll actually call (tokenizers, safetensors, cuBLAS) pick the language more often than you do.
3. **Who maintains it for five years?** Team velocity, hiring, compile-time guardrails vs review-time guardrails. A compiler that catches your invariants (Rust) is worth real money on a fast-moving codebase; a codebase your six-person team can hold in their heads entirely (Zig's pitch) is worth a different kind of money.
4. **What's the allocation and determinism budget?** Tail latency in microseconds and zero tolerance for hidden allocation (databases, embedded, schedulers) → you want allocation as a visible act: Zig's explicit-allocator discipline or C. GC-shaped languages already lost this round in T0.L5.`,
    },
    {
      type: 'prose',
      md: `## The 2026 map, honestly drawn

**Where Rust already won in this field:** NVIDIA Dynamo's entire data plane (the T3.L6 decision, shipped at v1.3 scale — orchestration around NIXL, which is itself C++ with Rust bindings, and the KVBM block manager, which Dynamo v1.5.0 has since deprecated in favor of engine-native offload). Cloudflare **Infire** — a whole edge inference engine in Rust. Hugging Face **tokenizers** — the Rust core underneath everyone's Python wrapper. The pattern: network-facing, byte-shuffling, latency-contracted infrastructure *around* the GPU. Rust owns the data plane.

**Where Zig is actually deployed:** **TigerBeetle** (the financial database — deterministic, explicit allocation everywhere, sim-tested to death; Zig's comptime used as a design tool), **Bun** (the JS runtime — Zig as a productive C replacement with a package manager), **Ghostty**, and in our field exactly one deployment that matters: **ZML** — a production inference stack in Zig, compiling models to accelerators (NVIDIA/AMD/TPU) with the compile-time metaprogramming Zig was built for. One is a pattern, four is a niche with momentum. Zig's bet: simplicity + comptime + C interop beats borrow-checker friction for teams small enough to hold the whole codebase in their heads.

**Where C is non-negotiable:** not as a *choice* — as the *water*. CUDA host APIs, kernel headers, io_uring, eBPF maps, NCCL internals when your all-reduce deadlocks at 3 AM. You will **read** C weekly for the rest of this career whether or not you ever write another line. T1.L5's ABI lesson is the literacy; the reading list is the job.`,
    },
    {
      type: 'prose',
      md: `## Applied: the serving stack, component by component

Run the four questions down the stack you've built in this course: **Router / API front** — untrusted input, 100k connections, tail latency: Rust (tokio, T3.L4). **Scheduler / KV block manager** — untrusted-adjacent, invariant-heavy, refactored weekly: Rust (your labs 02 and 06 are the proof shape). **Intake queue** — single-purpose, allocation-hostile hot loop: Rust still fine (lab 04), Zig equally defensible if the team prefers it. **GPU kernels** — ecosystem gravity wins: CUDA C++ or a Python DSL (CuTe DSL, Triton/Gluon, TileLang), with Rust and Zig marginal at best. **io_uring / eBPF glue** — the kernel's ABI is C, so C. **CLI tooling, test harnesses, one-off migrations** — whatever the team ships fastest; this is where Zig earns honest keep. Notice what didn't appear anywhere in that list: ideology.`,
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
            'The path is slow today and Rust is the language to reach for when raw performance matters',
            'The path takes untrusted input at scale and a memory bug becomes an outage and an exploit',
            'The team already knows Rust well and that familiarity lowers review and maintenance cost',
            'Rust crates already exist for the libraries involved and ecosystem coverage decides which language is safe',
          ],
          correct: [1],
          explanation:
            '~70% of serious CVEs are memory-safety. On network-facing, long-lived, multi-tenant paths, memory safety is a security property, not a comfort. That is exactly Dynamo\'s data plane and Infire\'s edge engine — and exactly why those teams paid the borrow-checker price.',
          why: [
            'Speed is not the failure-cost question. C, C++ and Zig are comparably fast; the framework asks what a memory bug costs on this path, not which language is quicker.',
            'Right: with untrusted input, long-lived multi-tenant processes and tight tails, a memory bug is both an outage and an exploit, which is where compile-time safety pays for its friction.',
            'Team familiarity belongs to question 3, who maintains it for five years. Failure cost asks what a bug on this path costs, however comfortable the team is.',
            'Library availability is question 2, ecosystem gravity. Failure cost is about the damage a memory bug does on the path, not about which crates exist.',
          ],
        },
        {
          q: '"Ecosystem gravity" means…',
          options: [
            'Language popularity where you pick whichever language tops the indexes and hiring follows it',
            'The libraries you cannot avoid constrain the choice and cheap C interop becomes a hard requirement',
            'Build speed where compile times decide the language and slow builds cost the team more than runtime speed',
            'Inertia where the existing codebase and its tooling wins the language choice and migration costs too much',
          ],
          correct: [1],
          explanation:
            'You do not choose in a vacuum. The accelerators, collectives, and transfer libraries are C-ABI; the kernels are CUDA C++ or Python DSLs such as CuTe DSL and Triton. Language decisions that ignore the gravity well get made again next quarter.',
          why: [
            'Popularity helps hiring but is not gravity. The point is that required libraries and interfaces limit your options regardless of what surveys say.',
            'Right: CUDA, NCCL, NIXL and UCX expose C ABIs and kernel toolchains come from the GPU vendor ecosystem, so those constraints exist before preferences do, and cheap C interop is non-negotiable.',
            'Build time is a team-velocity input (question 3), not gravity. Gravity means unavoidable external libraries and interfaces that constrain the language choice.',
            'Gravity is about libraries you must call, not an inertia rule. Dynamo put Rust around existing C and C++ libraries, so a stack can mix languages across a C ABI without rewrites.',
          ],
        },
        {
          q: 'Zig\'s honest 2026 position is…',
          options: [
            'Abandoned with no production users beyond hobby projects and release churn that makes it unsuitable for real systems',
            'Dominant in serving where Zig stacks have displaced Rust in most new inference engines and routers',
            'A real but deliberate niche that was chosen for its explicit allocation and comptime with C interop',
            'A strict upgrade over Rust that gives the same safety guarantees with less compile-time friction',
          ],
          correct: [2],
          explanation:
            'Four flagship deployments, one of them (ZML) in our exact field. The bet is simplicity + comptime + C interop over compile-time memory proofs. It is a deliberate choice, not a default — which is what the framework is for.',
          why: [
            'TigerBeetle, Bun and Ghostty ship in production, and ZML runs inference. Zig releases still change std between versions, which is a cost to price, not evidence that nobody uses it.',
            'ZML is the one Zig inference stack named in this field, while Rust still owns data planes like Dynamo and Infire. Zig has a niche with momentum, not a dominant share.',
            'Right: four flagship deployments, one in inference, show a deliberate niche. The bet is simplicity, comptime and C interop, and it fits teams small enough to hold the whole codebase in their heads.',
            'Zig gives explicit allocators and safety checks in debug builds, but no compile-time ownership proof like Rust\'s. It trades borrow-checker friction for simplicity, not for equal guarantees.',
          ],
        },
        {
          q: 'C\'s role in your career here is best described as…',
          options: [
            'Obsolete as new infrastructure moves to Rust or Zig and C matters just for legacy code',
            'The water you swim in that you read weekly in driver headers and kernel interfaces even if you rarely write it',
            'Kernel space with a role in modules and device drivers and no part in userspace serving code',
            'A skill you can outsource as generated bindings hide the C layer and reading it is rarely needed in practice',
          ],
          correct: [1],
          explanation:
            'Reading C is non-negotiable infrastructure literacy — the ABI is the water (T1.L5). Writing it is reserved for kernel-space glue and the places the kernel already owns.',
          why: [
            'The interfaces everything else binds to remain C: CUDA host APIs, kernel headers, io_uring and eBPF. New code in other languages still calls into C and gets debugged at that layer.',
            'Right: the C ABI underlies the whole stack. Reading CUDA host APIs, kernel headers or NCCL internals is routine when something deadlocks, even if you never write a line.',
            'Userspace serving stacks call C constantly: CUDA host APIs, NCCL and UCX are C libraries, and io_uring and eBPF are kernel interfaces used from user space, not only inside the kernel.',
            'Bindings hide syntax, not behaviour. When an all-reduce hangs or a CUDA call fails, the diagnosis sits in the C layer\'s headers and docs, so reading it is routine.',
          ],
        },
        {
          q: 'Per the component-by-component application, GPU kernels are written in…',
          options: [
            'Rust with CubeCL or rust-cuda to keep kernels that handle untrusted tensors memory safe',
            'Zig across vendors with comptime specialising each kernel per architecture at no runtime cost',
            'The vendor C++ dialect plus Python kernel languages such as CuTe and Triton and TileLang',
            'Triton alone as it has replaced hand-written vendor C++ in production attention kernels and MoE paths',
          ],
          correct: [2],
          explanation:
            'The four questions are per-component, not per-project. Router: Rust. Scheduler: Rust. Kernels: CUDA C++ or a Python DSL (CuTe DSL, Triton/Gluon, TileLang). io_uring glue: C. CLI tools: whatever ships. Ideology appears nowhere — that\'s the point of the framework.',
          why: [
            'Safety is why Rust owns host code like the router and scheduler. Rust GPU projects such as CubeCL and rust-cuda exist but are marginal in production kernels, and cudarc only wraps the host-side CUDA API.',
            'Comptime specialises Zig code at build time, but GPU kernels reach the device through toolchains from the GPU vendor ecosystem, and there the vendor libraries and tooling live.',
            'Right: kernels follow the vendor ecosystem, which means CUDA C++ plus Python DSLs such as CuTe DSL (FlashAttention-4), Triton/Gluon and TileLang. Rust and Zig serve the host side.',
            'FlashAttention-4 is written in CuTe DSL, and vLLM v0.30 defaults to a FlashInfer CuTe DSL NVFP4 path on SM100. Triton is one DSL among several, and CUDA C++ remains.',
          ],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Read the deployments, not the discourse',
      md: `The framework is only as good as the evidence: **Dynamo** (github.com/ai-dynamo/dynamo — the Rust components are named in the tree: NIXL orchestration, and KVBM until its v1.5.0 deprecation), **Infire** (Cloudflare's blog on their Rust edge engine), **TigerBeetle** (their "Safety" docs are the best explicit-allocation argument written), **ZML** (github.com/zml/zml — the one real Zig inference stack, worth an afternoon), and **Zig's own release notes** (the std churn across 0.14→0.15 is the honest maintenance price). When someone proposes a language for the next component, ask the four questions out loud and watch the sermon die.`,
    },
  ],
}

export default lesson
