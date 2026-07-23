import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't3.l1',
  slug: 'ownership',
  trackId: 't3',
  index: 1,
  title: 'Ownership, Borrowing & Lifetimes',
  minutes: 30,
  hook: 'Live memory diagrams of the rules that make memory bugs unrepresentable — and the moment the borrow checker starts feeling like a colleague.',
  exercise: 'sim',
  simId: 'sim-allocator',
  blocks: [
    {
      type: 'prose',
      md: `T1 ended with the pitch; this lesson is the practice. Ownership is not a feature you learn — it's a *discipline the compiler enforces on every line*, and the fastest way to internalize it is to watch memory while the rules operate. We'll take the four bug classes you met personally in T1 — dangling pointers, double-free, iterator invalidation, data races — and watch each one die at compile time, with diagrams.

The mental model to install: **Rust tracks, for every value, exactly who can reach it and how, at every point in the program — and it proves that no reachable path can ever observe a dead value or a conflicting mutation.** The proof is conservative: it rejects some safe programs. That's the deal, and it's a good deal.`,
    },
    {
      type: 'prose',
      md: `## Moves: assignment transfers the obligation

In Rust, assigning a value that owns resources **moves** ownership; the old binding is statically dead. This single rule gives deterministic destruction for free — the owner dies, the resource drops, once, always at a known program point. It's RAII (C++'s trick) made universal and mandatory: memory, file handles, sockets, mutex guards all free themselves at scope end.

\`\`\`text
let a = String::from("kv-cache");   // a owns a heap buffer
let b = a;                          // ownership moves; a is dead from here
// use(a)                          // compile error: value used after move
drop(b);                            // buffer freed exactly once, provably
\`\`\`

Compare with the two worlds you know: C++ moves leave a *valid but unspecified* source you can still touch (footgun preserved); Java/Python *share* the object and let the GC sort out liveness (safe, but with runtime tracking and no deterministic end). Rust gets deterministic destruction **and** safety by making the ownership transfer explicit in the type system.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — move vs shared borrow vs exclusive borrow, as memory sees it',
      height: 54,
      nodes: [
        { id: 's1', x: 2, y: 4, w: 30, h: 8, label: 'let a = String::from(…)', sub: 'a → [ptr|len|cap] → heap "kv…"' },
        { id: 's2', x: 2, y: 16, w: 30, h: 8, label: 'let b = a; // MOVE', sub: 'b owns; a is dead (checked)' },
        { id: 's3', x: 2, y: 28, w: 30, h: 8, label: 'let r = &b;', sub: 'shared borrow: read-only' },
        { id: 's4', x: 2, y: 40, w: 30, h: 8, label: 'let m = &mut b;', sub: 'exclusive: read-write, alone' },
        { id: 'heap', x: 44, y: 16, w: 24, h: 14, label: 'heap buffer', sub: '"kv-cache" · 1 owner', color: '#F97316' },
        { id: 'rule', x: 76, y: 8, w: 22, h: 32, label: 'the law', sub: 'many &T XOR one &mut T · no borrow outlives owner' },
      ],
      edges: [
        { from: 's1', to: 'heap' },
        { from: 's2', to: 'heap' },
        { from: 's3', to: 'heap' },
        { from: 's4', to: 'heap' },
      ],
      steps: [
        { caption: 'A String is a small stack struct (ptr, len, cap) pointing at a heap buffer. Ownership = "I am responsible for freeing that buffer, and I will, exactly once."', active: ['s1', 'heap'], edges: ['s1->heap'] },
        { caption: 'let b = a MOVES ownership: b is now responsible; a is statically dead. Double-free is impossible because only b can drop the buffer — there is no second owner to free it again.', active: ['s2', 'heap'], edges: ['s2->heap'] },
        { caption: 'Shared borrows &b: any number, all read-only. The owner can\'t mutate or drop while they\'re live — readers are protected from surprise.', active: ['s3', 'heap'], edges: ['s3->heap'] },
        { caption: 'Exclusive borrow &mut b: exactly one, no shared borrows concurrent. The writer sees a consistent, uncontended view — data races die here, at compile time.', active: ['s4', 'rule'], edges: ['s4->heap'] },
      ],
    },
    {
      type: 'prose',
      md: `## Borrowing: lending with compile-time escrow

You can't move ownership into every function (it would never come back), so Rust lends: \`&T\` (shared) and \`&mut T\` (exclusive). The rules you saw in fig 1 exist to make three T1 horrors structurally impossible:

- **Dangling**: a borrow's lifetime is computed from the program; if the owner can't be proven to outlive it, compilation fails. The classic \`fn f() -> &String { let s = …; &s }\` is a *compile error*, not a CVE.
- **Iterator invalidation**: mutate a \`Vec\` while a shared borrow (like an iterator) is live? Rejected. Java throws \`ConcurrentModificationException\` at you at runtime if you're lucky; Rust refuses to build it.
- **Data races**: shared-XOR-mutable across threads is the same rule, so \`Send\`/\`Sync\` (T3.L3) can build on it.

**Lifetimes** are mostly inferred ("lifetime elision" covers the common patterns). You write explicit \`'a\` annotations when the compiler can't infer relationships — most commonly when a function returns a reference derived from one of several arguments. The annotation isn't decoration; it's you telling the compiler *which input the output borrows from* so callers get checked correctly.`,
    },
    {
      type: 'code',
      filename: 'lifetimes.rs — annotations that mean something',
      lang: 'rust',
      code: `// "the returned &str borrows from whichever of x/y lives shorter"
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}

// A struct holding a reference must declare the relationship:
struct Block<'a> {
    tokens: &'a [u32],     // this Block may not outlive the slice
}

// The fix when lifetimes don't work out: take OWNERSHIP instead.
fn longest_owned(x: String, y: String) -> String {
    if x.len() > y.len() { x } else { y }   // moved in, moved out — no borrows
}

// Rust proverb: when the borrow checker fights you for an hour,
// the ownership design is usually wrong. Clone early, redesign soon.`,
      chips: ["'a = a region of code", 'elision covers ~90%', 'redesign > clone() > fight'],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You enforce these invariants by convention today: "this buffer is only valid during the callback" (a lifetime), "don't mutate the config map after publishing it" (shared-XOR-mutable), "exactly one of us closes the connection" (ownership). The JVM even has a vestigial version: \`try-with-resources\` is manual RAII — deterministic cleanup you opt into per type. Rust's move is to make the convention *universal and checked*: the code reviewer that never sleeps is the type system.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `The two-week wall is real: newcomers fight the checker on doubly-linked structures (lists, graphs, caches with back-pointers). The exits are known: **indices into an arena** (your T1 allocator returns! "pointers" become \`usize\` into a \`Vec\`), **Rc<RefCell<T>>** for single-threaded shared ownership with runtime checks, **Arc<Mutex<T>>** across threads, or restructuring so ownership forms a tree. Choose arenas first in systems code — they're cache-friendly (T0.L4) and borrow-free.`,
    },
    {
      type: 'prose',
      md: `## The simulator: watch the checker think

The exercise replays ownership scenarios on a live memory diagram: moves, borrows, scope exits, drops, and the exact moment a program transitions from "compiles" to "rejected." Predict each verdict before you step. By the end, the checker should feel less like a bouncer and more like a colleague who proofreads your pointer arithmetic — which, after T1, you know you need.`,
    },
    {
      type: 'exercise',
      simId: 'sim-allocator',
      machine: 'rust-ownership',
      title: 'Ownership diagrams live',
      tasks: [
        'Step a move (`let b = a`) and verify: one owner, one drop; using `a` flags an error.',
        'Create two shared borrows, then attempt `push` on the owner — watch the rejection point.',
        'Return a reference to a stack local; locate the lifetime proof failure.',
        'Refactor the rejected graph case to arena indices; confirm it compiles and runs cache-friendlier.',
      ],
      note: `Everything rejected on screen was a T1 bug caught at build time: use-after-move (double-free's sibling), mutation-under-shared-borrow (iterator invalidation), escaping references (dangling). The arena refactor works because indices aren't borrows — ownership stays in one \`Vec\`, and "links" are just numbers.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: '`let b = a;` for an owning type (String, Vec) in Rust…',
          options: [
            'Copies the heap buffer',
            'Reference-counts the buffer',
            'Moves ownership: b becomes responsible for the single drop, and a is statically unusable afterward',
            'Borrows a immutably',
          ],
          correct: [2],
          explanation:
            'Move semantics: one owner at all times → exactly one drop → double-free and use-after-free are unrepresentable. The compiler, not a runtime, tracks the obligation.',
        },
        {
          q: 'The borrow rule "many &T XOR one &mut T" directly prevents…',
          options: [
            'Memory leaks',
            'Iterator invalidation and data races — nobody can mutate while readers exist, and writers never share',
            'Stack overflow',
            'Integer overflow',
          ],
          correct: [1],
          explanation:
            'Both bug classes need simultaneous aliasing + mutation. The rule is readers-writer locking with zero runtime cost, enforced by lifetime analysis.',
        },
        {
          q: 'An explicit lifetime annotation like <\'a> on fn longest(x: &\'a str, y: &\'a str) -> &\'a str tells the compiler…',
          options: [
            'How long the strings live at runtime',
            'That the returned reference borrows from the inputs, so the caller must keep BOTH alive while using the result',
            'To allocate the result on the heap',
            'To skip borrow checking inside the function',
          ],
          correct: [1],
          explanation:
            'Annotations describe relationships used to check CALLERS: the output is valid only while both inputs are. Nothing about runtime changes — it\'s proof metadata.',
        },
        {
          q: 'The idiomatic systems-Rust answer to cyclic structures (graphs, linked lists) is…',
          options: [
            'unsafe pointers everywhere',
            'An arena: one owning Vec plus usize indices as "pointers" — borrow-free and cache-friendly',
            'Giving up and using C++',
            'Storing everything in Rc<RefCell<…>> regardless of cost',
          ],
          correct: [1],
          explanation:
            'Arenas keep single ownership (the Vec) and replace pointers with indices: no borrow fights, O(1) access, dense layout (T0.L4). Rc<RefCell> is the fallback when ownership is genuinely dynamic.',
        },
      ],
    },
  ],
}

export default lesson
