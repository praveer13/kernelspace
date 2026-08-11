import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't2.l1',
  slug: 'processes-threads',
  trackId: 't2',
  index: 1,
  title: 'Processes, Threads & Context Switches',
  minutes: 20,
  hook: 'Watch a context switch burn cycles — what the OS saves, what it costs, and why your thread pool sizing is a physics problem.',
  exercise: 'sim',
  simId: 'sim-batching',
  blocks: [
    {
      type: 'prose',
      md: `A **process** is an address space plus a kernel-managed bundle of resources: page table, file descriptors, signal handlers, credentials. A **thread** is an execution context — registers, program counter, stack — that *shares* a process's address space with its siblings. That one sentence contains the whole design space: processes give you isolation (a crash or an exploit stays inside one address space); threads give you sharing (zero-copy communication, one heap) at the price of every race condition in this track.

You deploy both daily. Your app server is a process tree; its worker pool is threads; Kubernetes is, at heart, a process scheduler for datacenters. This lesson is about the machinery that lets 8 hardware cores pretend to run 200 threads: the **context switch** — and about its surprisingly measurable cost.`,
    },
    {
      type: 'prose',
      md: `## What a context switch actually does

The OS timer (or an I/O completion, or a higher-priority wakeup) fires; the CPU traps into the kernel; the scheduler picks the next runnable thread. Then the switch itself:

1. **Save** the outgoing thread's full register state into its kernel structure.
2. **Restore** the incoming thread's registers.
3. If it's a *different process*, also switch the page table (load the new \`CR3\` on x86) — which invalidates TLB entries, making the next memory accesses walk page tables the slow way.

The raw mechanics are fast — a few microseconds at worst. The *real* cost is the **cache and TLB aftermath**: the new thread starts with cold caches, and every miss is a ~100 ns DRAM trip. Studies consistently put the *effective* cost of a process switch (including cache pollution) at **1–10+ µs**, versus sub-µs for a same-process thread switch. Multiply by tens of thousands of switches per second on a busy box and you see why "just add more threads" stops working.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '~1–3 µs', label: 'thread switch', hint: 'Same address space: registers + scheduler bookkeeping.' },
        { value: '~3–10 µs', label: 'process switch', hint: 'Plus page-table switch, TLB shootdown, cold caches.' },
        { value: '~50–100 ns', label: 'syscall', hint: 'User→kernel transition without a thread change. Cheap but not free.' },
        { value: '~10 ms', label: 'CFS timeslice', hint: 'Rough preemption quantum for Linux\'s default scheduler at low load.' },
      ],
    },
    {
      type: 'diagram',
      caption: 'fig 1 — one core, two threads: the switch cycle',
      height: 52,
      nodes: [
        { id: 't1', x: 4, y: 6, w: 22, h: 10, label: 'thread A', sub: 'running', color: '#22D3EE' },
        { id: 'save', x: 38, y: 6, w: 24, h: 10, label: 'save A state', sub: 'regs → PCB_A' },
        { id: 'sched', x: 38, y: 24, w: 24, h: 10, label: 'scheduler', sub: 'pick next (runqueue)' },
        { id: 'load', x: 38, y: 42, w: 24, h: 10, label: 'restore B state', sub: 'PCB_B → regs' },
        { id: 't2', x: 74, y: 42, w: 22, h: 10, label: 'thread B', sub: 'running', color: '#FB7185' },
        { id: 'cache', x: 74, y: 6, w: 22, h: 10, label: 'L1/L2 + TLB', sub: 'cold for B', color: '#FFB224' },
      ],
      edges: [
        { from: 't1', to: 'save' },
        { from: 'save', to: 'sched' },
        { from: 'sched', to: 'load' },
        { from: 'load', to: 't2' },
        { from: 't2', to: 'cache' },
      ],
      steps: [
        { caption: 'Thread A is executing. The timer interrupt fires (or A blocks on I/O); the CPU traps to kernel mode. A\'s remaining timeslice is forfeit.', active: ['t1'], edges: ['t1->save'] },
        { caption: 'The kernel saves A\'s entire register file into its process control block — a few hundred bytes, deterministic cost.', active: ['save'], edges: ['save->sched'] },
        { caption: 'The scheduler consults the runqueue (Linux: CFS red-black tree ordered by vruntime) and picks the next thread. Fairness is the goal; latency is the casualty.', active: ['sched'], edges: ['sched->load'] },
        { caption: 'B\'s registers are restored; the CPU resumes — but B\'s data is not in this core\'s caches. The next few thousand instructions run at DRAM speed while caches refill. THIS is the hidden tax.', active: ['load', 't2', 'cache'], edges: ['load->t2', 't2->cache'] },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Your Java thread pool tuning was context-switch economics all along. **N threads on 8 cores** with CPU-bound work just means the kernel timeslices the excess — every switch burns the cache warmth your JIT spent thousands of iterations earning. That's why the classic sizing \`cores + blocking_wait_ratio\` exists: compute-bound → ~cores threads; I/O-bound → more, because a blocked thread's switch is *productive* (it overlaps I/O latency with someone else's compute). Python note: the GIL serializes bytecode, but CPython still pays real OS context switches between its threads — worst of both worlds.`,
    },
    {
      type: 'prose',
      md: `## The alternatives the industry built

When switches get expensive, engineers stop switching. Three great escapes, all of which you will meet again:

- **Event loops / async I/O** — one thread, thousands of connections, switch only at I/O points *in userspace* (no kernel transition, no register dump). Node, nginx, tokio. T2.L6.
- **Green threads / goroutines** — the runtime multiplexes M logical threads onto N OS threads, so most "context switches" are userspace function calls. Go, Java virtual threads (Loom), Erlang.
- **Run-to-completion batching** — do a big unit of work per wake-up, amortizing the switch. This is the philosophical ancestor of **continuous batching** in LLM serving: instead of switching between requests token-by-token at great cost, pack them and run the GPU iteration once for all of them. T5.L7 makes the mapping exact.`,
    },
    {
      type: 'isomorphism',
      title: 'the scheduler you will meet again',
      pairs: [
        {
          os: 'context switch',
          osLine: 'Save/restore state per thread; cache+TLB warmth is the hidden cost.',
          llm: 'sequence swap / preemption',
          llmLine: 'vLLM pauses a sequence by evicting its KV; resuming recomputes or reloads it.',
        },
        {
          os: 'runqueue / timeslice',
          osLine: 'Runnable threads wait for a quantum on a core.',
          llm: 'waiting queue / iteration',
          llmLine: 'Waiting requests get a slot in the next GPU iteration — the batch is the timeslice.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## In the simulator

The batching simulator doubles as a scheduler visualization here: crank the number of runnable units far past the number of workers and watch throughput *fall* as switch overhead eats the quantum — the classic context-switch cliff. Then raise the unit-of-work size and watch overhead amortize away. Everything in T2.L4 (scheduling) and T5.L7 (continuous batching) is a variation on these two curves.`,
    },
    {
      type: 'exercise',
      simId: 'sim-batching',
      machine: 'context-switch',
      title: 'Context-switch burn',
      tasks: [
        'Run 8 workers on 8 slots with pure compute: measure throughput (baseline — near zero overhead).',
        'Scale to 64 runnable units on 8 slots; watch switch overhead consume the quantum (throughput cliff).',
        'Halve the timeslice; confirm overhead grows ~linearly with switch frequency.',
        'Increase unit-of-work 10× at the same load: watch amortization recover throughput.',
      ],
      note: `The cliff you saw is why "more threads" has an optimum, not a monotone benefit — and why serving systems batch: one GPU iteration for 256 sequences costs barely more than for 1, so the *switch* cost per token collapses. The 1960s scheduler and the 2020s batcher are solving the same equation.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The defining difference between a process and a thread is…',
          options: [
            'Processes are faster to create',
            'A process owns a private address space and resource bundle; threads share their process\'s address space',
            'Threads cannot access the heap',
            'Processes cannot be scheduled',
          ],
          correct: [1],
          explanation:
            'Process = address space + resources (isolation); thread = execution context within it (sharing). Every trade-off — safety vs communication cost — follows from that single fact.',
        },
        {
          q: 'The largest hidden cost of a context switch is usually…',
          options: [
            'Saving the registers',
            'The kernel trap itself',
            'Cache and TLB cold-start for the incoming thread — thousands of instructions at DRAM latency',
            'Updating the runqueue',
          ],
          correct: [2],
          explanation:
            'Register save/restore is microseconds at worst; the aftermath is the tax. Warm caches are a thread\'s most valuable possession, and the switch throws them away — especially across processes (CR3 switch → TLB flush).',
        },
        {
          q: 'A CPU-bound service with 8 cores should run about how many busy threads?',
          options: ['64 — more parallelism is always better', '8 — matching cores minimizes wasted switches', '1 — avoid contention entirely', 'It depends only on RAM'],
          correct: [1],
          explanation:
            'Beyond core count, extra compute-bound threads only timeslice: same total CPU, minus context-switch and cache overhead. The classic formula (cores × utilization targeting) only exceeds cores when threads block on I/O.',
        },
        {
          q: 'Java virtual threads (Loom) and goroutines reduce switch cost by…',
          options: [
            'Using more CPU cores',
            'Multiplexing many logical threads onto few OS threads in userspace — most "switches" never enter the kernel',
            'Disabling the garbage collector',
            'Pinning each thread to a NUMA node',
          ],
          correct: [1],
          explanation:
            'M:N scheduling makes parking/resuming a userspace operation (stack copy, no trap, no TLB flush). It is the event-loop idea with thread syntax — the same reason tokio exists (T2.L6, T3.L4).',
        },
      ],
    },
  ],
}

export default lesson
