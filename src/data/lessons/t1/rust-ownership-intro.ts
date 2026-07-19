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
  blocks: [
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
        },
        {
          os: 'ownership (Rust)',
          osLine: 'Safety at compile time: prove one owner per value, zero runtime cost.',
          llm: 'Dynamo data plane',
          llmLine: 'KV bytes move between nodes at line rate; no GC pause is affordable.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## The through-line

T1 took you from "a function call is magic" to building an allocator. Along the way you met every classic memory bug personally. Ownership is the claim that all of them were *one* bug — uncontrolled aliasing plus unclear lifetimes — and that the bug class is solvable. When T5 shows you NVIDIA's choice of Rust for Dynamo's KV-moving data plane, you will read it not as fashion but as a conclusion: **the hot path of AI infrastructure is exactly where C++ used to win by default, and exactly where memory bugs cost the most.**

Next track: the operating system. You have built memory management by hand; now you get to see how the kernel does it for every process at once — and why PagedAttention is that story wearing a GPU.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Rust\'s ownership rule is best stated as…',
          options: [
            'Every value is reference-counted at runtime',
            'Every value has exactly one owner; when the owner goes out of scope the value is dropped deterministically',
            'All memory must be allocated on the stack',
            'The compiler garbage-collects at build time',
          ],
          correct: [1],
          explanation:
            'One owner → one drop. Double-free and leaks die immediately; moves make assignment transfer the obligation. It is RAII made universal and checked — with no runtime bookkeeping.',
        },
        {
          q: 'The borrow rules ("many &T XOR one &mut T, never outliving the owner") primarily eliminate…',
          options: [
            'Stack overflow',
            'Integer overflow',
            'Dangling pointers and data races, statically — readers-vs-writer enforced at compile time',
            'Memory leaks from cyclic references',
          ],
          correct: [2],
          explanation:
            'Exclusive mutable access is exactly what both use-after-free and data races violate. The compiler proves the discipline; the binary pays nothing. (Cycles can still leak under Rc — ownership prevents most, not literally all, leaks.)',
        },
        {
          q: 'When Rust code needs shared ownership or cycles, the idiomatic escape is…',
          options: [
            'Global variables',
            'unsafe everywhere',
            'Rc/Arc reference counting, or arena allocation with index handles instead of pointers',
            'It is impossible — such programs cannot be written in Rust',
          ],
          correct: [2],
          explanation:
            'Graphs and cycles are real; Rust offers opt-in runtime counting (Rc/Arc) or the arena pattern — allocate in one owner and pass indices. Both keep the unsafe surface tiny and auditable.',
        },
        {
          q: 'Why did NVIDIA choose Rust for Dynamo\'s KV-moving data plane over C++?',
          options: [
            'Rust has more mature CUDA tooling than C++',
            'C-level performance and layout control with compile-time memory safety — no GC pauses, far fewer memory bugs on the hottest path',
            'Rust binaries are smaller',
            'Python interop is impossible from C++',
          ],
          correct: [1],
          explanation:
            'The data plane moves gigabytes of KV cache under tail-latency budgets. It needs C++-class control but cannot afford C++-class memory bugs (70% CVE stat) or GC pauses. Rust is the only mainstream language offering both halves.',
        },
      ],
    },
  ],
}

export default lesson
