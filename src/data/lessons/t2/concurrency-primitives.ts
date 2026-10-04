import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't2.l5',
  slug: 'concurrency-primitives',
  trackId: 't2',
  index: 5,
  title: 'Mutexes, Atomics & Lock-Free Queues',
  minutes: 25,
  hook: 'The synchronization toolbox: when a mutex beats an atomic, memory ordering made survivable, and the ABA problem visualized.',
  exercise: 'quiz+sim',
  simId: 'sim-vm',
  blocks: [
    {
      type: 'prose',
      md: `Shared mutable state is the original sin of concurrent programming, and this lesson is the complete taxonomy of how engineers atone. You will not learn every primitive — you will learn the *decision procedure*: mutex when the critical section is long or contended; atomic when it's one instruction's worth of state; lock-free when contention is measured in nanoseconds and correctness arguments in whiteboards. Choose wrong and you get either a serialized bottleneck or a race that ships to production.

The stakes in serving land are concrete: inference engines are pipeline machines where scheduler threads, GPU workers, and network threads pass requests through queues constantly. Every one of those queues is this lesson.`,
    },
    {
      type: 'prose',
      md: `## The mutex: mutual exclusion by waiting

A mutex guarantees that at most one thread executes the critical section at a time; everyone else **blocks**. The important detail is *how* it blocks. A **spinlock** burns CPU re-checking the flag — perfect when the wait is ~50 ns and preemption would cost microseconds; catastrophic otherwise. An **OS mutex** (futex-based on Linux) does a fast userspace atomic check, and only on contention does it **syscall into the kernel to sleep** — the waiter leaves the runqueue entirely, and the unlocker wakes it. That two-level design (fast path userspace, slow path kernel) is why "mutexes are slow" is usually wrong: uncontended acquisition is a single atomic op, ~20 ns.

The classic failure modes are yours from code review: **deadlock** (circular lock order — the fix is a global lock ordering, always), **lock convoying**, and **priority inversion** (T2.L4). The scalability ceiling has a name too: Amdahl — 5% serialized caps you at 20× no matter how many cores.`,
    },
    {
      type: 'code',
      filename: 'primitives — the same counter, four ways',
      tabs: [
        {
          label: 'Rust',
          lang: 'rust',
          code: `use std::sync::{Mutex, atomic::{AtomicU64, Ordering}};

// 1. Mutex: any critical section, sleeps on contention
static COUNTER: Mutex<u64> = Mutex::new(0);
fn bump_mutex() {
    *COUNTER.lock().unwrap() += 1;   // lock guard: unlock is automatic (RAII)
}

// 2. Atomic: single-word state, no blocking ever
static ATOMIC: AtomicU64 = AtomicU64::new(0);
fn bump_atomic() {
    ATOMIC.fetch_add(1, Ordering::Relaxed);  // one LOCK XADD on x86
}

// 3. CAS loop: the primitive lock-free algorithms are built from
fn bump_cas() {
    let mut cur = ATOMIC.load(Ordering::Relaxed);
    loop {
        match ATOMIC.compare_exchange_weak(cur, cur + 1,
                                           Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => break,              // we won the race
            Err(actual) => cur = actual, // someone else did; retry
        }
    }
}`,
        },
        {
          label: 'Java',
          lang: 'java',
          code: `// 1. synchronized: monitor lock, JVM may bias/thin-lock it
synchronized (lock) { counter++; }

// 2. AtomicLong: CAS in a loop, userspace only
AtomicLong atomic = new AtomicLong();
atomic.incrementAndGet();

// 3. LongAdder: per-core counters in padded cells (false sharing!),
// sum on read — the standard answer for hot contended counters
LongAdder adder = new LongAdder();
adder.increment();`,
        },
        {
          label: 'C',
          lang: 'c',
          code: `// pthread mutex: futex fast path, kernel sleep on contention
pthread_mutex_lock(&m); counter++; pthread_mutex_unlock(&m);

// C11 atomics: same instruction the JVM/Rust emit
_Atomic long counter;
__atomic_fetch_add(&counter, 1, __ATOMIC_RELAXED);  // LOCK XADD`,
        },
      ],
      chips: ['~20 ns uncontended mutex', 'CAS = compare_exchange', 'Amdahl: 5% serial ⇒ ≤20×'],
    },
    {
      type: 'prose',
      md: `## Memory ordering, made survivable

Here is the part everyone skips and everyone should learn once. Compilers and CPUs **reorder** memory operations for performance; on a multicore machine, "I wrote A then set flag B" does not guarantee another core *sees* them in that order. The classic bug — **publication**: thread 1 writes \`data = 42\` then \`ready = true\`; thread 2 sees \`ready\` true but reads \`data\` as 0, because the data write hasn't become visible yet.

The fix vocabulary: **Relaxed** (atomic value, no ordering — fine for counters), **Acquire** on loads (nothing after me moves before me) and **Release** on stores (nothing before me moves after me) — together they make the flag pattern safe, and \`seq_cst\` when you want total order and accept the fence cost. Java's \`volatile\` is acquire+release; a mutex unlock/lock pair is release/acquire — *that is what "synchronization" actually synchronizes*: not just mutual exclusion, but visibility.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `The double-checked locking antipattern is the canonical publication bug — it was broken in Java for years until \`volatile\` gained acquire/release semantics (JSR-133). Rule of thumb that has never failed me: if you reach for Relaxed to make a *flag* fast, you're about to ship a heisenbug. Counters: Relaxed away. Flags, pointers to just-written data: Release store / Acquire load, or use a mutex and let it handle both.`,
    },
    {
      type: 'prose',
      md: `## Lock-free queues and the ABA problem

The workhorse of high-performance systems is the lock-free MPMC queue (Vyukov/LMAX Disruptor-style): a ring buffer where producers CAS-claim slots and consumers CAS-advance. No sleeping, no kernel, no convoy — just cache lines (padded! T0.L4) and CAS loops. This is the shape of the queues inside LMAX's exchange, io_uring's submission/completion rings, and the schedulers of inference engines.

Lock-free has its own trap, and it is beautiful: **ABA**. Thread 1 reads pointer \`A\`, prepares a CAS; gets preempted. Thread 2 pops \`A\`, pops \`B\`, pushes \`A\` back (same address — allocators recycle!). Thread 1 resumes: CAS succeeds because the pointer "still" equals \`A\` — but the node's *meaning* changed; the queue is corrupted. The pointer matched; the history didn't.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — ABA: the pointer is the same, the world is not',
      height: 50,
      nodes: [
        { id: 't1', x: 2, y: 6, w: 20, h: 9, label: 'thread 1', sub: 'CAS(head, A, A.next)', color: '#22D3EE' },
        { id: 't2', x: 2, y: 34, w: 20, h: 9, label: 'thread 2', sub: 'runs while T1 sleeps', color: '#FB7185' },
        { id: 's1', x: 34, y: 6, w: 28, h: 8, label: 'head→A→B→C', sub: 'T1 reads head = A' },
        { id: 's2', x: 34, y: 22, w: 28, h: 8, label: 'head→C (A,B popped)', sub: 'T2: pop A, pop B' },
        { id: 's3', x: 34, y: 38, w: 28, h: 8, label: 'head→A→C (A recycled!)', sub: 'T2: push A back' },
        { id: 'boom', x: 74, y: 22, w: 22, h: 10, label: 'CAS succeeds ✗', sub: 'B is lost — corruption', color: '#FF5C6C' },
      ],
      edges: [
        { from: 't1', to: 's1' },
        { from: 't2', to: 's2' },
        { from: 's2', to: 's3' },
        { from: 's3', to: 'boom' },
      ],
      steps: [
        { caption: 'Thread 1 reads head = A and prepares CAS(head, A → B). It gets preempted before executing — the worst possible moment, as always.', active: ['t1', 's1'], edges: ['t1->s1'] },
        { caption: 'Thread 2 runs: pops A, pops B. Head is now C; A and B are recycled to the allocator.', active: ['t2', 's2'], edges: ['t2->s2'] },
        { caption: 'Thread 2 pushes node A again — same address (allocators recycle!), completely different position and neighbors.', active: ['s3'], edges: ['s2->s3'] },
        { caption: 'Thread 1 resumes: head == A still, so CAS succeeds and sets head = B — a popped node. The queue is silently corrupt. Fixes: tagged pointers (version counter), hazard pointers, epoch reclamation, or just… use a mutex.', active: ['boom'], edges: ['s3->boom'] },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `ABA is your distributed-systems **compare-and-swap on a stale read**, at nanosecond scale — an "ETag matched but the resource changed meaning twice." The fixes rhyme too: tagged pointers are **version numbers**, epoch reclamation is **generational GC for lock-free nodes**, and hazard pointers are **reference counting with thread-local pins**. Concurrency bugs are consistency bugs; you already have the instincts.`,
    },
    {
      type: 'prose',
      md: `## The decision procedure

Contended, long critical section → mutex (sleep is a feature). Single-word state, low contention → atomic with the weakest safe ordering. Hot bounded handoff between fixed roles → lock-free ring with padded lines. Anything fancier → reconsider; the literature is a graveyard of "obviously correct" lock-free structures. And in T3, Rust wraps all of this in types that make the data-race classes unrepresentable — same physics, compiler-enforced.`,
    },
    {
      type: 'exercise',
      simId: 'sim-vm',
      machine: 'contention',
      title: 'Contention lab: mutex vs atomic vs lock-free',
      tasks: [
        'Run the counter benchmark with 1 thread on all three implementations — note they\'re equally fast.',
        'Scale to 16 threads on the atomic counter: watch cache-line ping-pong (T0.L4) cap throughput.',
        'Switch to per-thread striped counters (the LongAdder move): watch throughput scale with cores.',
        'Replay the ABA trace in the queue inspector; then enable tagged pointers and re-run.',
      ],
      note: `Three durable lessons: uncontended everything is fast (measure only under contention); contention on one cache line is the real enemy (stripe, pad, or shard); and CAS correctness is about *history*, not just values — hence version tags.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'A futex-based mutex on Linux, when UNCONTENDED, costs about…',
          options: [
            'A system call plus a context switch (~1 µs), because the kernel must record the owner before granting the lock',
            'One userspace atomic operation (~20 ns); the kernel is entered only when a waiter must sleep or be woken',
            'A full memory fence plus a cache-line transfer (~500 ns), since acquiring any lock must synchronise every core',
            'Essentially nothing: an uncontended lock is plain loads and stores, so adding one never slows a hot path',
          ],
          correct: [1],
          explanation:
            'The two-level design: fast path is one atomic op in userspace; only contended waiters syscall to sleep. "Mutexes are slow" is usually a contention measurement, not a mutex property.',
          why: [
            'Misconception: every lock enters the kernel. A futex keeps the lock word in userspace; the syscall happens only when a thread must block or wake one, which is the contended case.',
            'Right: a compare-and-swap on the lock word takes the lock in about 20 ns. The kernel is involved only when a waiter sleeps or a releaser must wake someone.',
            'Misconception: locking synchronises every core. A single atomic touches one cache line, not all cores, and an uncontended line is already in the local cache, so it costs tens of ns.',
            'Misconception: free. An atomic read-modify-write is not a plain store; it has real cost (~20 ns) and ordering effects, which is why a contended hot lock still matters.',
          ],
        },
        {
          q: 'Acquire/release ordering exists because…',
          options: [
            'Atomic operations generate too much coherence traffic by default, so weaker orderings let a core opt out of coherence for extra speed',
            'CPUs and compilers reorder memory operations, so without ordering another core can see the flag set before the data it guards',
            'Without an explicit fence instruction on every core a mutex cannot lock at all, because lock acquisition needs the fence to be atomic',
            'Stores to nearby addresses from two cores can be lost entirely, so ordering is needed to keep each write from vanishing',
          ],
          correct: [1],
          explanation:
            'Release-store prevents prior writes from moving after the flag; acquire-load prevents later reads moving before it. Together they make "data then flag" safe — that is what volatile and mutex edges provide.',
          why: [
            'Misconception: orderings switch coherence off. Cache coherence is always on; orderings only restrict how this core and the compiler reorder operations around an atomic.',
            'Right: release keeps earlier writes before the flag write, and acquire keeps later reads after the flag read. Together they guarantee readers who see the flag also see the data (publication).',
            'Misconception: mutexes need hand-placed fences. Lock and unlock already carry acquire and release semantics; atomicity of the lock word comes from the atomic instruction, not a fence.',
            'Misconception: lost writes. Cache coherence never loses a store; the hazard is that another core observes writes in a different order than program order, not that they disappear.',
          ],
        },
        {
          q: 'The ABA problem occurs because…',
          options: [
            'Compare-and-swap is not truly atomic on some CPUs, so another thread can change the word in the gap between the compare and the swap',
            'A freed node\'s address can be recycled, so a pointer compare succeeds even though the node\'s meaning changed between read and CAS',
            'Two threads using different memory orderings can see the pointer update out of order, so the compare reads a stale value',
            'Misaligned allocations make the CAS span two cache lines, so the compare checks only half of the pointer',
          ],
          correct: [1],
          explanation:
            'CAS compares values, not history: preempted between read and CAS, the world can change twice and come back to the same address. Fixes: tagged pointers (version), hazard pointers, epochs — or a mutex.',
          why: [
            'Misconception: CAS is torn. Hardware CAS is atomic by definition; ABA is a logic error where the compare succeeds correctly on the same value after state changed twice.',
            'Right: the value goes A to B and back to A (a node freed and reallocated at the same address), so CAS sees no change and succeeds even though the structure beneath it is different.',
            'Misconception: ordering is the cause. Weak ordering can cause stale reads, but ABA happens with sequentially consistent CAS too, because the value truly matches at the time of the compare.',
            'Misconception: alignment. Unaligned CAS is a fault or a performance bug on most CPUs, and it is unrelated to ABA, which happens with perfectly aligned pointers.',
          ],
        },
        {
          q: 'Java\'s LongAdder beats AtomicLong under high contention by…',
          options: [
            'Replacing the CAS retry loop with a hardware fetch-and-add instruction, so each increment completes in one step without any retry',
            'Striping the count across per-core padded cells and summing on read, which removes the single contended cache line',
            'Locking finer-grained segments of the counter so threads rarely wait on the same lock, as ConcurrentHashMap does',
            'Dropping memory-ordering guarantees so the CPU can batch increments in store buffers without cache-line transfers',
          ],
          correct: [1],
          explanation:
            'One hot counter = one cache line ping-ponging between cores. Striping gives each core its own padded cell (T0.L4 false sharing, weaponized for good); reads pay a sum. The classic trade of write-scalability for read-cost.',
          why: [
            'Misconception: a faster instruction. AtomicLong already uses a hardware atomic add on x86; the cost under contention is the cache line bouncing between cores, not retries.',
            'Right: threads increment separate padded cells, so no line is shared on the write path. A read sums the cells, trading cheaper writes for a more expensive read.',
            'Misconception: finer locks. LongAdder takes no locks; it stripes atomic cells. Lock-per-segment is a different technique for maps, with locks rather than cells on the path.',
            'Misconception: weaker ordering. Increments are still atomic with ordering; store buffers do not combine atomic updates to a shared line, and contention remains until the line stops being shared.',
          ],
        },
      ],
    },
  ],
}

export default lesson
