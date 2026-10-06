import type { AuthoredItem } from '@/lib/items/types'
import type { Lesson } from '../types'

/**
 * Spiral items (wave-2.md §6.2): authored questions on earlier KCs of T0-T3, drawn by the t3.l7 checkpoint beside
 * the generated item. Refs are `item:<id>`; each option's `miss` names the slip it encodes.
 */
const SPIRAL: AuthoredItem[] = [
  {
    id: 't3.spiral.raw-pointer-send',
    kcs: ['t3.send-sync', 't3.unsafe-boundaries'],
    q: {
      q: 'A struct holds a raw pointer field, *mut u8. By default the compiler treats the struct as…',
      options: [
        'Send and Sync, since a pointer is a bare address and moving an address between threads cannot cause a race',
        'Neither Send nor Sync, since the compiler cannot see the memory behind it and an unsafe impl is a promise',
        'Send but not Sync, since a pointer may move between threads but shared use would need a lock the type lacks',
        'Rejected at compile time, since a struct with a raw pointer field cannot be defined outside an unsafe block',
      ],
      correct: [1],
      explanation:
        'Raw pointers are !Send and !Sync, so any struct holding one inherits that. Writing unsafe impl Send is a promise that the invariants make crossing threads sound, the same kind of obligation an unsafe block carries.',
      why: [
        'The compiler cannot see what the address points to. Raw pointers are !Send and !Sync on purpose, so a human has to vouch for the memory behind them.',
        'Right: the field makes the struct !Send and !Sync by default. An unsafe impl Send is the author promising that the memory behind the pointer is safe to move across threads.',
        'Raw pointers are neither Send nor Sync, so the struct is neither. There is no half-way default; the author opts in to each trait with its own unsafe impl.',
        'Defining a struct with a raw pointer field is safe code. Only dereferencing the pointer needs unsafe, which is why the unsafe block and the unsafe impl sit in the implementation.',
      ],
      miss: ['t3.raw-pointers-are-send', '', 't3.raw-pointers-are-send-only', 't3.raw-pointer-fields-need-unsafe'],
    },
  },
  {
    id: 't3.spiral.cold-future',
    kcs: ['t3.futures-state-machines'],
    q: {
      q: 'A program calls an async fn and drops the returned future without awaiting or polling it. What ran?',
      options: [
        'The whole body ran on the calling thread, since a call to an async fn runs eagerly as a JavaScript promise does',
        'The body ran up to its first await, since the call polls the future once before it returns it to the caller',
        'Nothing ran, since calling an async fn builds the state machine and a poll is what advances it past its start',
        'A task was queued on the executor, since the call spawns the future and it will run to completion later on',
      ],
      correct: [2],
      explanation:
        'Futures are lazy. The call builds a struct of locals and a start state; only poll advances it, so a future dropped unpolled never ran a line of its body.',
      why: [
        'That is the JavaScript model, where a Promise starts at once. A Rust future is lazy: the call returns a state machine and executes none of the body.',
        'No runtime thread is involved until something polls. Even the code before the first await sits inside poll, so it never ran, and there was nothing to cancel.',
        'Right: the call builds the struct of locals and a start state. Only poll advances it, so a future dropped unpolled never ran a line of its body.',
        'Queueing happens when you spawn, not when you call. Without a spawn or an await the executor never sees the future, and dropping it ends it.',
      ],
      miss: ['t3.futures-run-eagerly', 't3.futures-run-to-first-await', '', 't3.dropped-futures-still-run'],
    },
  },
  {
    id: 't3.spiral.two-queues',
    kcs: ['t3.backpressure', 't2.admission-scheduling'],
    q: {
      q: 'One design accepts all work into an unbounded queue. Another bounds the queue at 64 and returns an error when it is full. Under twice the capacity for a minute, how do they differ?',
      options: [
        'The unbounded queue keeps latency flat while the bounded one drops half the work, since a longer queue absorbs load',
        'They behave the same under overload, since in both designs the extra work waits its turn in the same order',
        'The bounded queue fails first, since refusing work wastes capacity that the unbounded queue would have used later',
        'The bounded one refuses at once so callers can shed, since the unbounded one hides overload until memory fails',
      ],
      correct: [3],
      explanation:
        'Past capacity a longer queue absorbs nothing: arrivals exceed service, so the wait grows with the backlog. A bounded queue turns the limit into an error the sender can act on while it is still cheap, which is admission control.',
      why: [
        'Under sustained overload a longer queue absorbs nothing: arrivals exceed service, so the backlog grows and every request waits longer. Latency does not stay flat.',
        'The order is the same but the outcome is not. One design lets the wait grow without bound, and the other turns the limit into an error the sender can act on.',
        'Refusing early is the point of admission control. Work accepted into a queue that guarantees missed deadlines is wasted capacity, so refusing it saves capacity for work that can still finish.',
        'Right: the unbounded queue hides the overload until memory or deadlines fail, and every request pays the wait. The bounded one pushes the refusal upstream while it is still cheap to act on.',
      ],
      miss: ['t3.longer-queues-absorb-overload', 't3.queue-bound-changes-nothing', 't3.refusing-work-wastes-capacity', ''],
    },
  },
  {
    id: 't3.spiral.particle-calls',
    kcs: ['t3.wasm-boundary-cost'],
    q: {
      q: 'A page calls a Wasm function once per particle, 100,000 times a frame, passing a string each call, and the frame is slow. The best fix is…',
      options: [
        'Write the particles into one buffer in linear memory and call once per frame, so the loop runs inside the module',
        'Rewrite the function in JavaScript, since Wasm is slower than the JIT for any call that takes a string argument',
        'Compile the module again on every frame at the highest optimiser setting, so that the calls themselves get faster',
        'Run the module in a Web Worker, so each call no longer competes with the page for time on the main thread',
      ],
      correct: [0],
      explanation:
        'Compute inside Wasm is near native; the cost is 100,000 boundary crossings with marshalled strings. One buffer and one call per frame keeps the loop on the Wasm side.',
      why: [
        'Right: one buffer and one crossing per frame leaves the loop running inside the module. Cross rarely with big payloads is the rule for the JS and Wasm boundary.',
        'Compute inside Wasm is near native, so the rewrite gives up the part that is fast. The slow part is 100,000 string crossings a frame, which batching removes without leaving Wasm.',
        'A module is compiled once at instantiation. Recompiling each frame adds cost, and the per-call marshalling that made the frame slow is still there.',
        'A worker moves the calls off the main thread, but each one still marshals a string, and messages between threads copy their payloads. Fewer, larger crossings are the fix.',
      ],
      miss: ['', 't3.wasm-is-slower-for-strings', 't3.recompile-to-speed-up-calls', 't3.isolate-the-module-to-speed-up'],
    },
  },
  {
    id: 't3.spiral.dead-frame',
    kcs: ['t1.stack-vs-heap'],
    q: {
      q: 'In C, a function returns a pointer to its own local array, and testing shows the right values for a while. Why is it still a bug?',
      options: [
        'The frame holding the array is popped on return, so its bytes last until a later call reuses that stack space',
        'Local arrays are kept in registers, so the returned address does not refer to real memory once the call is over',
        'The compiler zeroes the array on return, so any value read through the pointer is wrong and testing fails fast',
        'Pointers to locals are legal to return, so the pointer dangles if the caller later frees the array itself',
      ],
      correct: [0],
      explanation:
        'Return pops the frame but leaves its bytes in place until the next call reuses that stack space. Reads look right until then, which makes the bug silent. Rust rejects the function because the reference would outlive its owner.',
      why: [
        'Right: return pops the frame, but its bytes stay in place until the next call reuses that stack space. Reads look right until then, which is what makes the bug silent.',
        'An array of any size lives in the stack frame, not in registers, and the pointer holds a real address. That address simply stops belonging to the function after the return.',
        'Nothing zeroes a popped frame, which is why the old values still read correctly. The memory is only reused later, by whichever call comes next.',
        'The caller cannot free a stack array, and the pointer is already invalid after the return. Rust rejects this function at compile time because the reference would outlive its owner.',
      ],
      miss: ['', 't1.locals-live-in-registers', 't1.frames-are-zeroed-on-return', 't1.returned-local-pointers-are-legal'],
    },
  },
  {
    id: 't3.spiral.one-field',
    kcs: ['t0.data-layout', 't0.cache-lines'],
    q: {
      q: 'A loop sums one 4-byte field from each of a million 64-byte structs stored back to back. Switching that field to a struct-of-arrays layout mainly reduces…',
      options: [
        'The number of additions, since a vector of plain integers lets the CPU skip the loads for the other bytes',
        'The page faults on the first pass, since a packed array of integers is mapped to physical memory ahead of time',
        'The latency of each load, since the integers sit in a faster cache level than the struct that held them before',
        'The cache lines fetched, since a packed array holds sixteen values per line and each struct held a single one',
      ],
      correct: [3],
      explanation:
        'With 64-byte structs each fetched line holds one useful 4-byte value, while a packed array holds sixteen per line. The same sum reads about sixteen times fewer lines.',
      why: [
        'The loop still does one addition per element. The saving is memory traffic: the other sixty bytes of each struct were fetched with the field and never used.',
        'Page faults depend on first touch, not layout, and a packed array is mapped on demand like any other. The layout change reduces fetched cache lines, not faults.',
        'A cache level has one latency whatever it holds. The packed layout wins by needing fewer lines from DRAM, not by moving the data to a faster level.',
        'Right: with 64-byte structs each fetched line holds one useful 4-byte value, while a packed array holds sixteen per line. The loop reads about sixteen times fewer lines for the same sum.',
      ],
      miss: ['t0.soa-reduces-arithmetic', 't0.soa-prefaults-pages', 't0.soa-uses-a-faster-cache', ''],
    },
  },
  {
    id: 't3.spiral.stale-head',
    kcs: ['t2.aba'],
    q: {
      q: 'A lock-free stack pop reads the head A and its next node B. Another thread pops A and B, then pushes A back. The first thread\'s compare-and-swap on the head…',
      options: [
        'Fails, since the head changed twice and a compare-and-swap detects any change made since the read began',
        'Succeeds, since the head holds A again and the swap installs node B even though B is no longer on the stack',
        'Succeeds if one thread made every change, since a different thread would always make the comparison fail',
        'Retries on its own until the stack is quiet, since the hardware instruction loops until the value is stable',
      ],
      correct: [1],
      explanation:
        'Compare-and-swap compares only the current value with the expected one. The head is A again, so nothing looks changed, and the swap installs a stale next pointer. That blind spot is the ABA problem; a version tag beside the pointer fixes it.',
      why: [
        'Compare-and-swap compares only the current value with the expected one. The head is A again, so nothing looks changed, and that blind spot is the ABA problem.',
        'Right: the head is A again, so the compare matches, and the swap installs B, which was popped and may be freed or reused. A version tag beside the pointer fixes it.',
        'The instruction knows nothing about threads. It checks one value against another, so a change by any thread that restores the old value goes unseen.',
        'The instruction reports success or failure once; any retry is a loop written in software around it. Here it reports success, so no retry happens and the corruption goes through.',
      ],
      miss: ['t2.cas-detects-every-change', '', 't2.cas-checks-thread-identity', 't2.cas-retries-in-hardware'],
    },
  },
  {
    id: 't3.spiral.reused-slot',
    kcs: ['t3.cyclic-structures'],
    q: {
      q: 'An arena graph removes a node by marking its slot free, and a later add reuses the slot. A NodeId saved before the removal is now…',
      options: [
        'Still correct, since the index names the same slot and the arena keeps the contents of that slot valid',
        'Rejected by the borrow checker, since an index held across a removal counts as a borrow of the old node',
        'A wrong answer with no error, since it names the new occupant and a generation count would catch it',
        'A panic on first use, since the arena checks each index against the node it was originally issued for',
      ],
      correct: [2],
      explanation:
        'A handle that is only a number names whatever sits in the slot now. Pairing each slot and each handle with a generation count lets a stale handle be detected and refused.',
      why: [
        'The slot is the same but its occupant is not. The old handle reads a different node without any error, so it is valid as a number and wrong as a handle.',
        'An index is a plain integer and carries no lifetime, so the checker tracks nothing about it. That freedom is the arena\'s strength and the source of this bug.',
        'Right: the handle is just a number, so it names whatever sits in that slot now. Pairing each slot and each handle with a generation count lets a stale handle be detected and refused.',
        'A plain Vec arena only bounds-checks the index, and the index is still in range. Detecting a stale handle needs the generation counter that slotmap-style arenas add.',
      ],
      miss: ['t3.stale-index-stays-valid', 't3.index-is-a-borrow', '', 't3.arena-checks-issued-ids'],
    },
  },
]

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
      type: 'callout',
      variant: 'info',
      title: 'The T3 spiral checkpoint',
      md: `The checkpoint below is the track's spiral: eight items, six right to pass, with at least one written or computed answer. Four come from this lesson, and four revisit earlier KCs of T0 to T3, starting with the ones you remember least.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The first question in the framework (failure cost) points to Rust primarily when…',
          options: [
            'The path is slow today, so Rust is the language to reach for when raw performance matters',
            'The path takes untrusted input at scale, so a memory bug becomes an outage and an exploit',
            'The team already knows Rust well, so that familiarity lowers review and maintenance cost',
            'Rust crates already exist for the libraries involved, so ecosystem coverage decides which language is safe',
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
          kcs: ['t3.language-choice', 't3.data-plane-requirements'],
          miss: ['t3.failure-cost-is-speed', '', 't3.failure-cost-is-team-familiarity', 't3.failure-cost-is-ecosystem'],
        },
        {
          q: '"Ecosystem gravity" means…',
          options: [
            'Language popularity where you pick whichever language tops the indexes and hiring follows it',
            'The libraries you cannot avoid constrain the choice and cheap C interop becomes a hard requirement',
            'Build speed where compile times decide the language and slow builds cost the team more than runtime speed',
            'Inertia where the existing codebase and its tooling win the language choice because migration costs too much',
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
          kcs: ['t3.language-choice'],
          miss: ['t3.gravity-is-popularity', '', 't3.gravity-is-build-speed', 't3.gravity-is-inertia'],
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
          kcs: ['t3.language-choice'],
          miss: ['t3.zig-is-abandoned', 't3.zig-dominates-serving', '', 't3.zig-upgrades-rust'],
        },
        {
          q: 'C\'s role in your career here is best described as…',
          options: [
            'Obsolete, as new infrastructure moves to Rust or Zig and C matters only for legacy code',
            'The water you swim in, read weekly in driver headers and kernel interfaces even if rarely written',
            'Kernel-only, mattering for modules and device drivers but playing no part in userspace serving code',
            'A skill you can outsource, as generated bindings hide the C layer and reading it is rarely needed in practice',
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
          kcs: ['t3.language-choice'],
          miss: ['t3.c-is-obsolete', '', 't3.c-is-kernel-only', 't3.c-can-be-outsourced'],
        },
        {
          q: 'Per the component-by-component application, GPU kernels are written in…',
          options: [
            'Rust with CubeCL or rust-cuda, to keep kernels that handle untrusted GPU tensors memory safe',
            'Zig across GPU vendors, with comptime specialising each kernel per architecture at no runtime cost',
            'CUDA C++ plus Python DSLs such as CuTe DSL, Triton and TileLang that follow the vendor ecosystem',
            'Triton alone, as it has replaced hand-written CUDA C++ in production attention and MoE kernels',
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
          kcs: ['t3.language-choice', 't3.data-plane-requirements'],
          miss: ['t3.kernels-are-rust', 't3.kernels-are-zig', '', 't3.kernels-are-triton-only'],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Read the deployments, not the discourse',
      md: `The framework is only as good as the evidence: **Dynamo** (github.com/ai-dynamo/dynamo — the Rust components are named in the tree: NIXL orchestration, and KVBM until its v1.5.0 deprecation), **Infire** (Cloudflare's blog on their Rust edge engine), **TigerBeetle** (their "Safety" docs are the best explicit-allocation argument written), **ZML** (github.com/zml/zml — the one real Zig inference stack, worth an afternoon), and **Zig's own release notes** (the std churn across 0.14→0.15 is the honest maintenance price). When someone proposes a language for the next component, ask the four questions out loud and watch the sermon die.`,
    },
  ],
  kcs: ['t3.language-choice', 't3.data-plane-requirements'],
  ticket: {
    form: 'spiral',
    cr: [
      {
        prompt:
          'Run the four-question framework on a router that parses untrusted requests for 100,000 connections, and name your answer to each question.',
        model:
          'Failure cost: untrusted input at scale makes a memory bug an outage and an exploit. Ecosystem gravity: no C-ABI library forces another language. Maintenance: a large team shipping weekly gains from compiler-checked invariants. Allocation budget: tight tail latency rules out a GC. The answer is Rust.',
        ideas: [
          'Failure cost: untrusted input at scale makes memory safety a requirement',
          'Gravity and team: no library forces another language, and compiler-checked invariants help a team shipping weekly',
          'Allocation and tail latency: no GC pauses on the hot path, so Rust',
        ],
        kcs: ['t3.language-choice', 't3.data-plane-requirements'],
      },
      {
        prompt:
          'Pick the language for GPU kernels and for io_uring glue code, and say what decides each choice.',
        model:
          'GPU kernels follow the vendor ecosystem, so they are CUDA C++ or a Python DSL such as Triton or CuTe DSL, and Rust or Zig are marginal there. The kernel\'s io_uring interface is a C ABI, so the glue is C. In both cases ecosystem gravity decides, not safety or speed in the abstract.',
        ideas: [
          'GPU kernels follow the vendor ecosystem: CUDA C++ or a Python DSL, with Rust and Zig marginal',
          'The kernel\'s io_uring and eBPF interfaces are C ABIs, so the glue is C',
          'Ecosystem gravity decides both, not safety or speed in the abstract',
        ],
        kcs: ['t3.language-choice'],
      },
    ],
    spiral: SPIRAL,
  },
}

export default lesson
