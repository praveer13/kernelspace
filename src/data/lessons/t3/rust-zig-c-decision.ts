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

**Where Rust already won in this field:** NVIDIA Dynamo's entire data plane (the T3.L6 decision, shipped at v1.3 scale — orchestration around NIXL, which is itself C++ with Rust bindings, and the KVBM block manager, which Dynamo v1.5.0 has since deprecated in favor of engine-native offload). Cloudflare **Infire** — a whole edge inference engine in Rust. Hugging Face **tokenizers** — the Rust core underneath everyone's Python wrapper. The pattern: network-facing, byte-shuffling, latency-contracted infrastructure *around* the GPU. Rust owns the data plane.

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
            'The path is slow today, since Rust is the language you reach for when raw performance matters most to the team',
            'The path takes untrusted input at scale under tail-latency contracts, so a memory bug is outage and exploit',
            'The team already knows Rust well, since that familiarity lowers the cost of reviewing and maintaining the code',
            'Rust crates already exist for the libraries involved, since ecosystem coverage decides which language is safe',
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
            'Language popularity: pick whichever language tops developer surveys, since hiring and tutorials follow it',
            'The libraries you cannot avoid (CUDA, NCCL, NIXL, UCX) constrain the choice, so free C-ABI interop is mandatory',
            'Build speed: compile times decide the language, since slow builds cost the team more than runtime performance does',
            'Inertia: the language of the existing codebase always wins, because migration is never worth the cost',
          ],
          correct: [1],
          explanation:
            'You do not choose in a vacuum. The accelerators, collectives, and transfer libraries are C-ABI; the kernels are CUDA C/Triton. Language decisions that ignore the gravity well get made again next quarter.',
          why: [
            'Popularity helps hiring but is not gravity. The point is that required libraries and interfaces limit your options regardless of what surveys say.',
            'Right: CUDA, NCCL, NIXL and UCX expose C ABIs and kernels are CUDA C or Triton, so those constraints exist before preferences do, and cheap C interop is non-negotiable.',
            'Build time is a team-velocity input (question 3), not gravity. Gravity means unavoidable external libraries and interfaces that constrain the language choice.',
            'Gravity is about libraries you must call, not an inertia rule. Dynamo put Rust around existing C and C++ libraries, so a stack can mix languages across a C ABI without rewrites.',
          ],
        },
        {
          q: 'Zig\'s honest 2026 position is…',
          options: [
            'Abandoned: the language has no production users, and release-to-release churn makes it unsuitable for real systems',
            'Dominant in serving: ZML and similar stacks have displaced Rust for most new inference engines and data planes',
            'A real but deliberate niche (TigerBeetle, Bun, Ghostty, ZML), chosen for explicit allocation and comptime',
            'A strict upgrade over Rust, giving the same safety guarantees with less compile-time friction',
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
            'Obsolete: new infrastructure is written in Rust or Zig, so C only matters for maintaining legacy code',
            'The water you swim in: CUDA host APIs, kernel headers, io_uring, eBPF and NCCL internals, read weekly even if you rarely write it',
            'Kernel-only: C matters for kernel modules and drivers, but userspace serving code never needs it',
            'A skill you can outsource: generated bindings and wrappers hide the C layer, so reading it is rarely needed',
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
            'Rust, because memory safety matters most where kernels process untrusted tensors and model weights',
            'Zig, because comptime can specialise kernels for each GPU architecture at build time',
            'CUDA C or Triton: ecosystem gravity is absolute, and this is the one component with no vote',
            'Go, because goroutines map naturally onto the thousands of GPU threads a kernel launches',
          ],
          correct: [2],
          explanation:
            'The four questions are per-component, not per-project. Router: Rust. Scheduler: Rust. Kernels: CUDA C/Triton. io_uring glue: C. CLI tools: whatever ships. Ideology appears nowhere — that\'s the point of the framework.',
          why: [
            'Safety is why Rust owns host code like the router and scheduler. Kernels depend on the CUDA and Triton toolchains and libraries, which mainstream serving stacks have no Rust equivalent for.',
            'Zig\'s comptime is host-side metaprogramming. Kernels in this field are written in CUDA C or Triton because the vendor compilers and libraries live there; ecosystem decides, not language features.',
            'Right: the toolchains, profilers and libraries for GPU kernels are CUDA C or Triton. Rust, Zig and the rest apply to the host-side components around them.',
            'Goroutines are scheduled by Go\'s runtime on CPU threads. GPU threads run in lockstep groups on the accelerator, and mainstream kernels are written in CUDA C or Triton, not Go.',
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
