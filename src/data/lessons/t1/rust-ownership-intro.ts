import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't1.l6',
  slug: 'rust-ownership-intro',
  trackId: 't1',
  index: 6,
  title: 'Rust Ownership as the Answer',
  minutes: 20,
  hook: 'Every pain from this track — use-after-free, double-free, leaks, races — solved by the compiler, before your code ever runs.',
  exercise: 'read',
  kcs: ['t1.ownership-answer', 't1.memory-errors'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt: 'Pick two memory bugs from this track and say which Rust rule rules each one out.',
        model:
          'Double-free: every value has one owner and is dropped once, when the owner leaves scope, so a second free has nothing to act on. Dangling pointer or use-after-free: any other pointer must be a borrow, and the compiler rejects a borrow that would outlive its owner.',
        ideas: [
          'Double-free is ruled out by one owner and one drop',
          'Dangling pointers are ruled out, since a borrow cannot outlive its owner',
          'Both rules are checked at compile time, at no run-time cost',
        ],
        kcs: ['t1.ownership-answer', 't1.memory-errors'],
      },
      {
        prompt: 'Ownership is described as prepaid, not free. List what it costs.',
        model:
          'The price is paid at compile time. The borrow checker rejects some programs that are actually safe, so you restructure them. Ownership shapes APIs, so shared or cyclic data needs Rc, Arc or an arena with indices. And unsafe blocks remain where the compiler cannot see an invariant, kept small and auditable.',
        ideas: [
          'Compile-time friction: the checker rejects some safe programs',
          'Design pressure: shared or cyclic data needs Rc, Arc or arenas',
          'unsafe remains for invariants the compiler cannot see, kept small',
        ],
        kcs: ['t1.ownership-answer'],
      },
    ],
  },
  blocks: [
    {
      type: 'predict',
      items: [
        {
          kind: 'choice',
          q: 'A Rust program runs `let a = vec![1, 2, 3]`, then `let b = a`, then prints `a`. What happens?',
          options: [
            'It fails to compile, and the compiler reports a use of the moved value a',
            'It prints the same three numbers, and both names share one copy of data',
            'It prints an empty list, and a is left holding a vector with no items',
            'It compiles but panics at run time, and a was freed when the move happened',
          ],
          correct: [0],
          why: [
            'Right: assignment moves ownership to b, and the compiler rejects any later use of a. Nothing reaches run time.',
            'There is no sharing here. A move transfers the single owner, and a plain assignment does not copy the buffer or alias it.',
            'A moved-from variable is not left empty. It is dead, and the compiler stops you from reading it at all.',
            'The error is caught at compile time, so the program never runs. Nothing is freed by the move either, since b now owns the data.',
          ],
          revealAt: 'One owner, exactly one free',
          kcs: ['t1.ownership-answer'],
        },
        {
          kind: 'choice',
          q: 'Rust prevents use-after-free without a garbage collector. Where is the price of that guarantee paid?',
          options: [
            'At run time, as a counter that is updated each time a value is assigned to a name',
            'In a background thread that scans memory and pauses the program to free it',
            'At compile time, as programs that the checker cannot prove safe are rejected',
            'In the operating system, which verifies every pointer each time that it is used',
          ],
          correct: [2],
          why: [
            'That is reference counting, which Rust makes opt-in through Rc and Arc. Plain ownership keeps no counter at run time.',
            'Rust has no collector thread and no pauses. Values are dropped at a known point, when their owner leaves scope.',
            'Right: the borrow checker proves safety before the program runs, and the price is friction when it rejects code that is safe but unproven.',
            'The OS does not verify pointers on use. Its page protection works the same for Rust as for C, and it catches only unmapped addresses.',
          ],
          revealAt: 'What it costs, honestly',
          kcs: ['t1.ownership-answer'],
        },
      ],
    },
    {
      type: 'prose',
      md: `Take stock of what this track has taught you to fear. Dangling pointers to dead stack frames. Reads past the array that silently corrupt. Double-frees that hand two owners the same memory. Leaks that only the OOM killer notices. Data races that need exactly the wrong interleaving to lose your data. Each is a distinct bug with a distinct flavor of pain — and Microsoft and Google have both published the same statistic about their C/C++ codebases: **~70% of serious security vulnerabilities are memory-safety bugs.**

Rust's pitch is audacious: *all of the above, caught at compile time, with zero runtime cost — no GC, no reference counting on every object, no pauses.* This lesson shows you the single idea that delivers it, at the level of T1's vocabulary. T3 will make you fluent; today is about *believing it's possible*.`,
    },
    {
      type: 'prose',
      md: `## One owner, exactly one free

Rust's whole discipline grows from one rule: **every value has exactly one owner, and when the owner goes out of scope, the value is dropped (freed) — deterministically, at that instant.** Assignment doesn't copy the pointer; it *moves* ownership:

\`\`\`text
let a = vec![1, 2, 3];   // a owns the heap buffer
let b = a;               // ownership MOVES to b; a is now dead
println!("{:?}", a);     // COMPILE ERROR: use of moved value
\`\`\`

One owner means one drop, which means: no double-free (only the owner can free, exactly once), no leak-by-forgetting (scope exit is automatic — Rust's \`Drop\` is C++ RAII made universal), and no use-after-free *by construction* — because any second pointer into the value must be a **borrow**, and borrows are checked against the owner's lifetime:

- You may have **any number of shared borrows** \`&T\` (read-only), **or exactly one exclusive borrow** \`&mut T\` (read-write), never both at once.
- No borrow may outlive its owner. The compiler computes the lifetimes; if it can't prove safety, the program does not compile.

Read those two bullets again: the first one is *readers-writer locking, enforced by the compiler at zero cost*. The second is *the dangling-pointer bug class, deleted*.`,
    },
    {
      type: 'code',
      filename: 'ownership.rs — T1\'s greatest hits, rejected',
      lang: 'rust',
      code: `fn dangling() -> &'static str {
    let s = String::from("stack-local");
    // &s                          // ERROR: s dies here; returning &s would dangle.
    "literal"                      // fine: 'static lives in .rodata
}

fn double_free() {
    let v = vec![1, 2, 3];
    let w = v;                     // ownership MOVED to w
    // drop(v);                   // ERROR: v no longer owns anything. One owner,
}                                 // one drop — double-free is unrepresentable.

fn race_free() {
    let mut xs = vec![1, 2, 3];
    let r = &xs;                   // shared borrow active
    // xs.push(4);                // ERROR: can't mutate while r borrows — the
    println!("{r:?}");             // readers-vs-writer rule, checked statically.
}

// …and every borrow is lifetime-checked: a reference can never
// outlive its owner, so use-after-free cannot compile either.`,
      chips: ['move semantics', '&T xor &mut T', 'RAII drop', 'zero runtime cost'],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You already obey these rules on multi-threaded Java code — you just enforce them with *conventions, docs, and code review*. "Don't share this mutable buffer; don't mutate while iterating; close the connection exactly once." Rust moves the convention from the style guide into the type system: the compiler **is** the reviewer, and it never gets tired on Friday afternoon. The mental shift isn't learning new rules — it's discovering the rules you already follow can be *proven*.`,
    },
    {
      type: 'prose',
      md: `## What it costs, honestly

Ownership is not free; it is prepaid. The costs are: **compile-time friction** (the borrow checker rejects some safe programs — you will fight it for two weeks, then it starts feeling like pair programming), **design pressure** (ownership shapes APIs; cyclic structures need \`Rc\`/\`Arc\` reference counting or arenas with indices — the arena trick, by the way, is your T1.L3 allocator with integer "pointers"), and occasionally **explicit escape hatches** — \`unsafe\` blocks where you pinky-swear the invariants the compiler can't see. The point is that \`unsafe\` is *marked, auditable, and tiny*: typically <1% of a codebase, wrapped in safe APIs.

The payoff profile is why systems teams keep choosing it: C-level control of layout and allocation, zero GC pauses, fearless concurrency (the same rules that stop use-after-free stop data races — \`Send\`/\`Sync\` in T3), and security posture that changes what auditors say about your code.`,
    },
    {
      type: 'isomorphism',
      title: 'same guarantees, different enforcement',
      pairs: [
        {
          os: 'GC (JVM/CPython)',
          osLine: 'Safety at runtime: trace reachability, pay CPU + pauses + headers.',
          llm: '—',
          llmLine: 'Python orchestration in serving stacks: fine off the hot path.',
          breaks: 'There is no KV-cache counterpart to a collector: GC covers the host\'s orchestration objects, while KV blocks are freed explicitly by the block manager and are never traced.',
        },
        {
          os: 'ownership (Rust)',
          osLine: 'Safety at compile time: prove one owner per value, zero runtime cost.',
          llm: 'Dynamo data plane',
          llmLine: 'Rust orchestrates the KV transfers that NIXL (C++) performs between nodes; no GC pause is affordable on that path.',
          breaks: 'Ownership is checked at compile time inside one process; it does not cover bytes in flight on the network or in device memory, where unsafe and FFI code still carry the invariants.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## The through-line

T1 took you from "a function call is magic" to building an allocator. Along the way you met every classic memory bug personally. Ownership is the claim that all of them were *one* bug — uncontrolled aliasing plus unclear lifetimes — and that the bug class is solvable. When T5 shows you NVIDIA's choice of Rust for the Dynamo code that orchestrates KV transfers (NIXL, a C++ library, does the byte-moving), you will read it not as fashion but as a conclusion: **the hot path of AI infrastructure is exactly where C++ used to win by default, and exactly where memory bugs cost the most.**

Next track: the operating system. You have built memory management by hand; now you get to see how the kernel does it for every process at once — and why PagedAttention is that story wearing a GPU.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Rust\'s ownership rule is best stated as…',
          options: [
            'Each value is reference-counted at runtime, being freed when the count reaches zero',
            'Each value has one owner, with a deterministic drop when it leaves scope',
            'Each value must live on the stack, with a scope exit freeing it automatically',
            'A compile-time garbage collector scans the program, freeing unreachable values',
          ],
          correct: [1],
          explanation:
            'One owner → one drop. Double-free and leaks die immediately; moves make assignment transfer the obligation. It is RAII made universal and checked — with no runtime bookkeeping.',
          why: [
            'Describes Rc/Arc, which is opt-in. Default ownership has no count: a single owner exists, and the value is dropped deterministically when the single owner leaves scope, with no reference count.',
            'Right: one owner means one drop. A move transfers the obligation, and the value is dropped at a deterministic point when the owner leaves scope.',
            'Heap values like Box and Vec are owned too. Ownership governs lifetimes, not placement, and an owner on the stack frees its heap data on drop.',
            'Rust has no collector. The compiler checks ownership and inserts drops; it does not trace reachability, and nothing runs to find garbage at build or run time.',
          ],
          kcs: ['t1.ownership-answer'],
        },
        {
          q: 'The borrow rules ("many &T XOR one &mut T, never outliving the owner") primarily eliminate…',
          options: [
            'Stack overflow, with borrowed values left uncopied on the stack',
            'Runtime panics, including out-of-bounds indexing and unwrap on an empty Option',
            'Dangling pointers and data races, enforced statically as readers versus one writer',
            'Memory leaks from cyclic references, with borrows unable to form a cycle',
          ],
          correct: [2],
          explanation:
            'Exclusive mutable access is exactly what both use-after-free and data races violate. The compiler proves the discipline; the binary pays nothing. (Cycles can still leak under Rc — ownership prevents most, not literally all, leaks.)',
          why: [
            'Unrelated to the stack. Deep recursion still overflows it; borrowing only constrains who may read or write a value and how long a reference lives.',
            'Rust still panics at run time on out-of-bounds indexing, unwrap on None, and overflow in debug builds. Borrow rules address aliasing and lifetimes, not these checks.',
            'Right: use-after-free and data races both need a writer overlapping other access. One writer or many readers, never outliving the owner, rules both out at compile time.',
            'Cycles are made with Rc or Arc, which are owned values and not borrows, so the rules do not stop them. Rc cycles can still leak.',
          ],
          kcs: ['t1.ownership-answer', 't1.memory-errors'],
        },
        {
          q: 'When Rust code needs shared ownership or cycles, the idiomatic escape is…',
          options: [
            'static mut globals, which any function can reach without owning them',
            'Wrapping the program in an unsafe block, switching the borrow checker off',
            'Rc/Arc reference counting, or an arena with index handles in place of pointers',
            'No escape exists, with Rust unable to express graphs or cycles without a garbage collector',
          ],
          correct: [2],
          explanation:
            'Graphs and cycles are real; Rust offers opt-in runtime counting (Rc/Arc) or the arena pattern — allocate in one owner and pass indices. Both keep the unsafe surface tiny and auditable.',
          why: [
            'Mutable globals need unsafe to touch and give up the aliasing guarantees entirely. They are a last resort, not the idiomatic way to share ownership.',
            'Block-wide unsafe does not turn the borrow checker off; it only unlocks a few extra operations. Idiomatic code keeps unsafe small and wrapped behind safe types.',
            'Right: Rc/Arc add runtime counting only where sharing is needed, and an arena has one owner while nodes refer to each other by index.',
            'Graphs, trees with parent links, and cyclic structures are routine in Rust through Rc, Arc, arenas, and crates built on them. No collector is required.',
          ],
          kcs: ['t1.ownership-answer'],
        },
        {
          q: 'Dynamo\'s Rust code orchestrates KV transfers that NIXL (C++) performs. Why Rust for that layer over C++?',
          options: [
            'Rust has more mature CUDA tooling and kernel libraries than C++, making GPU work easier',
            'C-class speed and control, with compile-time memory safety and no GC pause jitter',
            'Rust binaries are smaller and start faster, helping when GPU replicas scale out',
            'C++ lacks any Python interoperability, whereas Rust has first-class bindings to the GPU stack',
          ],
          correct: [1],
          explanation:
            'The data plane coordinates gigabytes of KV-cache transfers under tail-latency budgets. It needs C++-class control but cannot afford C++-class memory bugs (70% CVE stat) or GC pauses. Rust is the only mainstream language offering both halves.',
          why: [
            'Reverses the ecosystem. CUDA toolchains, kernel libraries, and NVIDIA\'s own libraries are C++-first; Rust reaches them through bindings, so tooling is not the motive.',
            'Right: it keeps the control and speed of C++ and removes the memory-bug class at compile time, with no GC pauses to blow tail-latency budgets.',
            'Binary size and startup are not the deciding trade-off for a data plane moving gigabytes under tail-latency budgets; safety and control are.',
            'C++ binds to Python well through pybind11 and nanobind, so interop does not separate the two languages.',
          ],
          kcs: ['t1.ownership-answer'],
        },
      ],
    },
  ],
}

export default lesson
