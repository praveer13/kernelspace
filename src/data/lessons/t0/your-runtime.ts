import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't0.l5',
  slug: 'your-runtime',
  trackId: 't0',
  index: 5,
  title: 'Your JVM/Python Runtime Under the Hood',
  minutes: 20,
  hook: 'GC and JIT as reference points for everything that follows — your runtime is a systems program, and it has been teaching you all along.',
  exercise: 'quiz',
  blocks: [
    {
      type: 'prose',
      md: `Every idea in this course lands twice as fast if it lands on familiar ground. So before T1 drops you into raw pointers, let's cash in your existing intuition. You have run the JVM or CPython in production for years. Both are **systems programs** — millions of lines of C and C++ that manage memory, schedule execution, and compile code behind your back. They are the perfect reference implementation of the concepts you are about to learn the manual way.

This is the last lesson of T0, and it has a quiet agenda: after this, whenever the course says "allocator," "compaction," "safepoint," or "code cache," your brain should answer "ah — like the GC, like the JIT." That reflex is the whole point.`,
    },
    {
      type: 'prose',
      md: `## The JVM: an operating system for one tenant

Strip the marketing off the HotSpot JVM and you find a memory manager, a scheduler, and a dynamic compiler — an OS kernel specialized to run one process' worth of Java bytecode.

**The heap is managed memory.** New objects are bump-allocated in a thread-local allocation buffer (TLAB): allocation is literally incrementing a pointer, as cheap as the stack. When eden fills, a minor GC copies survivors to a survivor space — a **compacting** collector, which is why Java allocation can stay a pointer bump while C's \`malloc\` walks free lists. Remember this when you build the toy allocator in T1: the JVM's trick is not that allocation is magic, it is that *reclamation does the expensive work, in bulk, later.*

**The GC trades memory for pause time.** G1, ZGC, Shenandoah — three generations of the same equation: how much CPU and headroom do you spend to keep stop-the-world pauses under a target (ZGC: sub-millisecond, at the cost of barriers and colored pointers)? Every LLM serving system faces the identical trade-off with KV-cache capacity: hold more state, or spend cycles moving and reclaiming it. When you tuned \`-Xmx\` up to delay GC, you were doing capacity planning against an eviction policy. Same skill, new nouns.

**The JIT is profile-guided compilation.** Bytecode starts interpreted; hot methods get compiled C1 → C2 with speculative optimizations (inlining, monomorphic call sites, escape analysis that *stack-allocates* objects that never leave the method — yes, the JVM stack-allocates, T1 will show you what that means). Speculations that fail trigger **deoptimization**: the frame is rewritten back to interpreter state, mid-execution. Hold that image: an optimistic fast path with a safe fallback is also how **speculative decoding** works in T5.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '~1 ns', label: 'TLAB alloc', hint: 'Bump a thread-local pointer. Cheaper than a cache miss.' },
        { value: '<1 ms', label: 'ZGC pause', hint: 'Concurrent compaction with load barriers — pauses decoupled from heap size.' },
        { value: '12–16 B', label: 'object header', hint: 'Mark word + class pointer: every Java object pays it before your first field.' },
        { value: '~10k', label: 'JIT threshold', hint: 'Invocations before C2 compiles a method (default, roughly).' },
      ],
    },
    {
      type: 'prose',
      md: `## CPython: reference counting and the big lock

CPython's model is simpler and more brutal. Every object carries a **reference count**; when it hits zero, the object is freed immediately, in place. That is deterministic reclamation without a tracing GC (a cyclic-detecting GC handles the rare reference cycles). The cost: *every assignment everywhere must maintain counts* — an invisible tax on all pointer traffic, and the reason CPython objects are chubby heap allocations rather than tightly packed values.

Then there is the **GIL** — the global interpreter lock. One big mutex ensuring only one thread executes Python bytecode at a time. It exists precisely because reference counts must stay consistent: fine-grained locking or atomics on every object were measured to slow single-threaded code by double-digit percentages, so the language chose one big lock instead. You will meet this exact decision again in T2 as the *big kernel lock* trade-off, and again in T5 when you see why Python-based serving stacks keep the hot data plane out of Python entirely.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You have already felt every one of these systems from the outside: a **GC pause** is a stop-the-world page-fault storm for the heap; the **GIL** is a kernel-level mutex with priority-inversion flavor; **JIT warmup** is a code cache filling; **metaspace** pressure is fragmentation. The course from here is: same machines, no manager. You'll be the runtime.`,
    },
    {
      type: 'prose',
      md: `## The contract your runtime signs for you

It helps to make the invisible contract explicit. Managed runtimes give you four guarantees and charge for each:

- **Memory safety** — no dangling pointers, no use-after-free. Cost: GC CPU, barriers, heap headroom.
- **Dynamic escape hatches** — reflection, monkey-patching, hot classloading. Cost: deopt machinery, megamorphic call sites, limited inlining.
- **Portability** — bytecode everywhere. Cost: an interpretation/JIT layer between you and the ISA.
- **Ergonomics** — allocation without ownership decisions. Cost: object headers, pointer-chasing layouts, and no say over *where* bytes live.

Systems languages (C, C++, Rust, Zig) decline the contract and hand you the bill's line items to manage yourself. That is not machismo — it is what you want when the workload is *moving 16 GB of weights per generated token* and every percent of bandwidth is revenue. The whole arc of LLM serving engineering — from FlashAttention to Dynamo's Rust data plane — is the industry deciding that this workload has outgrown the managed-runtime contract.`,
    },
    {
      type: 'isomorphism',
      title: 'runtime concepts you already own',
      pairs: [
        {
          os: 'GC compaction',
          osLine: 'Copies live objects to fight fragmentation; pauses are the price.',
          llm: 'KV-cache defrag / preemption',
          llmLine: 'vLLM evicts or re-allocates KV blocks under pressure; TTFT pays.',
        },
        {
          os: 'JIT speculation + deopt',
          osLine: 'Assume the fast path; rewrite the frame if the assumption breaks.',
          llm: 'speculative decoding',
          llmLine: 'Draft tokens optimistically; verify in parallel; roll back on mismatch.',
        },
        {
          os: 'thread pool + bounded queue',
          osLine: 'Admission control: reject or queue when saturated.',
          llm: 'scheduler admission',
          llmLine: 'vLLM admits/preempts sequences when KV blocks run out.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## Where you stand

T0 is done when these five things feel like home: the latency ladder (0.5 ns → 100 µs), the 20× row/column gap, the 64-byte line and false sharing, the managed-runtime contract — and the conviction that LLM serving reuses every one of them. T1 takes off the guardrails: real stack frames, real pointers, a real segfault, and an allocator you build with your own hands. That toy allocator, it turns out, is the direct ancestor of the KV-cache manager that made vLLM famous. See you at the bottom of the stack.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Java can allocate objects as cheaply as a pointer bump mainly because…',
          options: [
            'The JIT removes all allocations via escape analysis',
            'TLABs give each thread a private bump region, and compacting GC keeps free space contiguous',
            'The JVM pre-allocates every object at startup',
            'malloc is only slow on Windows',
          ],
          correct: [1],
          explanation:
            'Bump allocation works only when free memory is contiguous. Copying/compacting collectors guarantee that, so the fast path is "increment a thread-local pointer." Reclamation pays the cost later, in bulk — the reverse of malloc\'s free-list design.',
        },
        {
          q: 'CPython needs the GIL primarily to protect…',
          options: [
            'The bytecode verifier',
            'Object reference counts, which every assignment must update consistently',
            'The cyclic garbage collector',
            'C extension modules that are not thread-safe',
          ],
          correct: [1],
          explanation:
            'Reference counting is everywhere — every name binding mutates a count. Making that race-free with atomics or fine locks measurably slowed single-threaded programs, so CPython chose one global lock. (PEP 703 is now, decades later, attempting free-threaded CPython with biased reference counting.)',
        },
        {
          q: 'JIT deoptimization most closely resembles which LLM-serving technique?',
          options: [
            'Quantization',
            'Speculative decoding — optimistic fast path, verified and rolled back when wrong',
            'Continuous batching',
            'Prefix caching',
          ],
          correct: [1],
          explanation:
            'Both run an optimistic fast path built on an assumption (monomorphic call site / drafted tokens) with a cheap check and a safe rollback to the slow path. Optimism + verification + fallback is a systems pattern, not a coincidence.',
        },
        {
          q: 'Why do LLM serving stacks keep Python out of the hot data plane?',
          options: [
            'Python cannot call CUDA',
            'GC pauses, per-object overhead, and the GIL are unacceptable when moving GBs per token at tight tail-latency budgets',
            'Python has no async support',
            'Licensing restrictions from NVIDIA',
          ],
          correct: [1],
          explanation:
            'The managed-runtime contract costs exactly what decode cannot spare: unpredictable pauses, pointer-chasing layouts, serialized threads. Orchestration stays in Python; the byte-moving plane drops to C++/Rust/CUDA — Dynamo being the clean recent example.',
        },
      ],
    },
  ],
}

export default lesson
