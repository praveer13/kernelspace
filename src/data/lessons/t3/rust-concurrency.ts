import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't3.l3',
  slug: 'rust-concurrency',
  trackId: 't3',
  index: 3,
  title: 'Concurrency: Send, Sync, Channels, Atomics',
  minutes: 25,
  hook: 'The type system that makes "fearless concurrency" literal — and how to pick between message passing, locks, and lock-free.',
  exercise: 'sim',
  simId: 'sim-allocator',
  blocks: [
    {
      type: 'prose',
      md: `T2 gave you the concurrency physics: races, publication, ABA, the mutex/atomic/lock-free decision procedure. Rust's contribution is to move the *entire* discussion into the type system. Two marker traits do the work: **\`Send\`** — "this value may move to another thread" — and **\`Sync\`** — "this value may be *shared* between threads via references." They are auto-derived from the ownership rules, checked by the compiler, and unforgeable without \`unsafe\`.

The result is the famous slogan made literal: if it compiles, it has no data races. Not "probably no races under test" — *no data races, period*, because the program cannot express unsynchronized shared mutation. Races on *logic* (your protocol being wrong) remain possible, and deadlocks too — Rust never promised to fix those. But the T2 bug class that took down your Saturday? Gone at build time.`,
    },
    {
      type: 'prose',
      md: `## How Send/Sync fall out of ownership

Think it through with three types:

- \`u64\`, \`String\`, \`Vec<T>\`: plain owned data. Moving to another thread transfers the single owner — safe. **Send + Sync.**
- \`Rc<T>\` (single-threaded refcount): its count is a plain integer, updated non-atomically. Two threads bumping it concurrently = a torn counter = a use-after-free. So \`Rc\` is deliberately **!Send** — the compiler simply won't let it cross a thread boundary. Its thread-safe sibling \`Arc<T>\` pays for atomic counts, so **\`Arc<T>\` is Send + Sync** (when T is).
- \`&mut T\` and \`Mutex<T>\`: exclusive borrows are Send (the exclusivity travels); \`Mutex<T>\` is Sync because the lock *provides* the exclusion the type system demands.

The whole design is T3.L1's law — shared XOR mutable — applied across threads: shared references to \`T\` may cross threads only if \`T: Sync\`; unique things may move. \`unsafe\` can opt out (raw pointers are !Send/!Sync by default, forcing a human to vouch for them) — and that's where concurrency bugs in Rust actually live.`,
    },
    {
      type: 'code',
      filename: 'concurrency.rs — three correct architectures',
      lang: 'rust',
      code: `use std::sync::{Arc, Mutex, mpsc, atomic::{AtomicU64, Ordering}};
use std::thread;

// 1. MESSAGE PASSING: share by communicating (the Go/Erlang instinct)
fn pipeline() {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {          // tx MOVES into the worker
        tx.send(vec![1, 2, 3]).unwrap();
    });                              // tx is gone from this thread — no aliasing
    let batch = rx.recv().unwrap();  // ownership of the Vec moved across
}

// 2. SHARED STATE: Arc<Mutex<T>> — the java.util.concurrent style
fn shared_counter() {
    let c = Arc::new(Mutex::new(0u64));
    let mut hs = vec![];
    for _ in 0..8 {
        let c = Arc::clone(&c);      // atomic refcount bump
        hs.push(thread::spawn(move || {
            *c.lock().unwrap() += 1; // guard borrows exclusively; RAII unlocks
        }));
    }
    for h in hs { h.join().unwrap(); }
}

// 3. LOCK-FREE: atomics for single-word state (T2 rules still apply)
static SLOTS: AtomicU64 = AtomicU64::new(0);
fn admit() -> bool {
    SLOTS.fetch_update(Ordering::AcqRel, Ordering::Acquire,
        |n| (n > 0).then_some(n - 1)).is_ok()   // CAS loop, no lock
}`,
      chips: ['Send = movable', 'Sync = shareable', 'Rc is !Send on purpose'],
    },
    {
      type: 'prose',
      md: `## Choosing the architecture, with T2 physics

The three styles in the code are not interchangeable fashion — they map to the T2.L5 decision procedure:

- **Channels** when the handoff is the point (pipeline stages, producer/consumer): ownership moves, so there's *nothing to synchronize* after the send. Contention lives in the queue itself, which std implements as a lock-free-ish structure. In serving terms: the scheduler pushing admitted requests to GPU workers.
- **Arc<Mutex<T>>** when the critical section is long or the state is compound (a whole map): simple, correct, and the lock's sleep-on-contention is a feature. Beware the classics: lock ordering (deadlock), holding across \`.await\` (an async footgun — the guard is not Send-safe to hold across suspension in most runtimes; use \`tokio::sync::Mutex\` or drop first).
- **Atomics** for counters and flags: cheapest, but remember T2's ordering rules — \`Relaxed\` for counters, \`AcqRel\`/\`Acquire\` when publishing. And remember T0.L4: a hot atomic is a ping-ponging cache line; shard it (the LongAdder move: \`Crossbeam\`'s sharded counters, or per-thread slots).`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Java gave you the same menu with runtime seatbelts: \`synchronized\`/ReentrantLock (mutex), \`AtomicLong\` (CAS), \`BlockingQueue\` (channel-ish), plus immutable DTOs as the "share by communicating" trick. The difference is who checks the rules: \`Collections.synchronizedMap\` shared unsafely compiles fine and corrupts on the third deploy; in Rust the equivalent program *doesn't build*. Python asyncio programmers: channels ≈ \`asyncio.Queue\`, and the GIL is your accidental \`Mutex<Everything>\`.`,
    },
    {
      type: 'callout',
      variant: 'segfault',
      title: 'COMMON MISCONCEPTION',
      md: `"Rust has no data races, so concurrent Rust is easy." The type system kills *data* races — unsynchronized memory access. It does nothing for **logic races** (check-then-act across an await), **deadlocks** (yes, \`Mutex\` can still be locked in the wrong order), or **livelock/starvation** in your protocol. What changes is the debugging surface: when a concurrent Rust system misbehaves, you reason about protocol design — not about torn memory.`,
    },
    {
      type: 'prose',
      md: `## In the simulator

The exercise wires the three architectures against the same workload and shows you where each wins: channel throughput as stages are added, mutex collapse under lock-hold-time growth, atomic counter plateauing on one cache line until sharded. The graphs are T2.L5's decision procedure, measured in Rust.`,
    },
    {
      type: 'exercise',
      simId: 'sim-allocator',
      machine: 'rust-concurrency',
      title: 'Concurrency shootout',
      tasks: [
        'Run the pipeline (channel) at 1→4 stages; observe near-linear handoff scaling.',
        'Grow the mutex critical section from 50 ns to 50 µs; find where channels overtake shared state.',
        'Hot atomic counter, 16 threads: confirm the single-line plateau; shard it and re-measure.',
        'Attempt to send an Rc across threads in the inspector — read the exact compile error (Send violation).',
      ],
      note: `The measured ordering matches T2 theory: channels for handoffs, mutexes for compound state, atomics for words — and the Rc experiment shows the type system doing its one job: making "accidentally shared" a compile error instead of an incident.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Send and Sync mean, respectively…',
          options: [
            'Serializable / Synchronized',
            'May be MOVED to another thread / may be SHARED between threads via references',
            'Sent over a socket / Synced to disk',
            'Fast / Safe',
          ],
          correct: [1],
          explanation:
            'Two auto-derived marker traits that encode T3.L1\'s law across threads: unique things may move (Send), things shared by reference must provide their own exclusion story (Sync).',
        },
        {
          q: 'Rc<T> is !Send because…',
          options: [
            'It is slower than Arc',
            'Its refcount updates are non-atomic; sharing it across threads could tear the count and cause use-after-free',
            'It uses too much memory',
            'The compiler forbids all reference counting across threads',
          ],
          correct: [1],
          explanation:
            'The compiler isn\'t moralizing — it\'s preventing the exact bug: two threads racing on a plain integer count. Arc pays for atomic counts and earns Send+Sync. The type system encodes the performance/safety trade explicitly.',
        },
        {
          q: 'Rust\'s "fearless concurrency" guarantee covers…',
          options: [
            'All concurrency bugs including deadlocks',
            'Data races (unsynchronized shared memory access) — logic races, deadlocks, and starvation remain your problem',
            'Only single-threaded programs',
            'Only code without unsafe',
          ],
          correct: [1],
          explanation:
            'If it compiles, memory cannot be torn by racing threads. Protocol-level bugs (check-then-act across await, lock ordering) still exist — but you debug design, not corruption.',
        },
        {
          q: 'Holding a std::sync::MutexGuard across an .await in async Rust is dangerous because…',
          options: [
            'Mutexes are illegal in async code',
            'The suspended task holds the lock while parked, blocking all other tasks on that thread pool — and the guard isn\'t Send-safe across suspension in most runtimes',
            'await consumes the guard',
            'It disables the waker',
          ],
          correct: [1],
          explanation:
            'A parked task holding a mutex serializes the executor and can deadlock it. Drop the guard before awaiting, restructure, or use tokio::sync::Mutex (async-aware, still costly) — the standard async footgun.',
        },
      ],
    },
  ],
}

export default lesson
