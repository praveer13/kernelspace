import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't2.l4',
  slug: 'scheduling',
  trackId: 't2',
  index: 4,
  title: 'Scheduling & Admission Control',
  minutes: 25,
  hook: 'Preemptive multitasking, priority inversion, and why continuous batching is a 1960s scheduler wearing a GPU.',
  exercise: 'sim',
  simId: 'sim-batching',
  blocks: [
    {
      type: 'prose',
      md: `The scheduler is the kernel's allocator of *time*: given N runnable threads and M cores, who runs next, for how long, and who gets preempted? It answers the same three questions every resource manager answers — admission (who may enter), allocation (who runs now), and reclamation (who gets interrupted) — and it answers them under a constraint allocators don't have: **latency is the product.** A scheduling decision isn't good or bad in aggregate; it's good or bad *per request, per tail percentile*.

This lesson is the bridge of the whole course: the ideas here — time slices, priorities, inversion, head-of-line blocking, admission control — reappear verbatim in T5 as the scheduling layer of an LLM inference engine. Continuous batching is not a new idea. It is timesharing, finally applied to a GPU.`,
    },
    {
      type: 'prose',
      md: `## The policy zoo, compressed

**FIFO/round-robin** is the floor: run to completion (or quantum expiry), next in line. Simple, fair-ish, and poisoned by **head-of-line blocking** — one 60-second job ahead of your 5 ms job and your p99 is 60 seconds. The **convoy effect** is why nobody serves latency-sensitive traffic FIFO.

**Preemptive multitasking** (the default world you live in) fixes it with the time slice: any thread can be interrupted at quantum end (~1–10 ms) so the runqueue rotates. Short jobs no longer wait behind long ones; the cost is context-switch overhead — the T2.L1 tax, now spent deliberately to buy responsiveness.

**Priority scheduling** layers intent on top: important threads preempt unimportant ones. Linux gives you \`nice\` values and, for the brave, real-time classes (\`SCHED_FIFO\`/\`SCHED_RR\`) that preempt *everything* below them. Priorities introduce two famous failure modes: **starvation** (low priority never runs under load) and **priority inversion** (high waits on a lock held by low, while medium hogs the CPU — high effectively runs *below* medium). The canonical fix is **priority inheritance**: the lock-holder temporarily borrows the waiter's priority. The 1997 Mars Pathfinder reset loop was fixed remotely this way — priority inversion is not trivia, it is a spacecraft bug.

**Linux CFS** (what actually schedules your processes) doesn't use strict priorities: it tracks each thread's **vruntime** — weighted CPU time consumed — and always runs the *smallest* vruntime (a red-black tree, O(log n) pick). Nice values just change the weight (the clock speed of your vruntime). Result: proportional fairness with good latency for interactive/sleep-heavy threads, and no starvation, ever.`,
    },
    {
      type: 'statline',
      stats: [
        { value: 'O(log n)', label: 'CFS pick', hint: 'Leftmost node of a vruntime-ordered red-black tree.' },
        { value: '~1–10 ms', label: 'quantum', hint: 'Typical preemption slice at low load; shrinks as runnable threads grow.' },
        { value: '1997', label: 'Mars Pathfinder', hint: 'Priority inversion caused watchdog resets on Mars; fixed by enabling priority inheritance.' },
        { value: 'p99', label: 'the real metric', hint: 'Schedulers are judged at the tail, not the mean.' },
      ],
    },
    {
      type: 'prose',
      md: `## Admission control: the scheduler's other half

Every scheduler has a silent partner deciding what enters the runqueue at all. Too much admitted work and *no* scheduling policy survives: context switches eat the CPU (T2.L1), or queues grow without bound (Little's Law is not a suggestion). Real systems push back: bounded thread pools with rejection policies, load shedding at the LB, semaphore-bounded concurrency in your service, and the kernel's own OOM killer as the failure-typed admission controller. **The healthiest systems reject early and cheaply** rather than accepting work into a queue that guarantees missed deadlines for everyone.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You have built CFS without knowing it: a Java **ThreadPoolExecutor** with a bounded queue + \`CallerRunsPolicy\` is a scheduler with admission control and backpressure. A priority queue of tasks + worker pool is priority scheduling — and if you never thought about what happens when a low-priority task holds a connection the high-priority one needs, congratulations, you've met priority inversion in production. Python's asyncio is **cooperative** scheduling: tasks run until they \`await\` (voluntary yield). Forget an await — one \`time.sleep(5)\` — and you've head-of-line blocked the entire loop. That's why "never block the event loop" is a law.`,
    },
    {
      type: 'isomorphism',
      title: 'OS scheduler ≡ inference engine scheduler',
      pairs: [
        {
          os: 'time slice / preemption',
          osLine: 'Interrupt at quantum end; another runnable thread gets the core.',
          llm: 'iteration-level scheduling',
          llmLine: 'After EVERY decode step, the engine re-picks which sequences occupy the batch.',
        },
        {
          os: 'runqueue → running set',
          osLine: 'Runnable threads wait for a slot on a core.',
          llm: 'waiting → running queue',
          llmLine: 'Requests wait for KV blocks + a batch slot; admission is capacity-checked.',
        },
        {
          os: 'priority inversion',
          osLine: 'High-priority waits on a lock held by low-priority under medium load.',
          llm: 'head-of-line / preemption',
          llmLine: 'Long sequences hog batch slots; vLLM preempts (swap/recompute) to restore fairness.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## Why batching *is* scheduling

The deepest idea in modern serving is a scheduling observation: a GPU, like a CPU core, is a timeshared resource — but its "context switch" (draining one batch, loading another) is so expensive relative to the work that static, run-to-completion batching wastes most of the chip. **Continuous batching** applies preemptive timesharing at *iteration* granularity: after every single decode step (~50 ms), finished sequences leave, waiting sequences join, no one drains anything. The batch is the timeslice; the iteration is the quantum; the KV-block manager is the admission controller. T5.L6 is this lesson with GPUs; in the simulator below you can watch static batching waste the chip while continuous batching fills it.`,
    },
    {
      type: 'exercise',
      simId: 'sim-batching',
      machine: 'scheduler',
      title: 'Scheduler lab: slices, priorities, admission',
      tasks: [
        'Run FIFO with one 60× long job: measure the convoy effect on short-job p99.',
        'Enable round-robin (quantum 1×): watch short-job p99 collapse; note the throughput overhead.',
        'Add priorities and reproduce inversion: high waits on low\'s resource while medium runs.',
        'Enable priority inheritance; confirm high-priority latency recovers.',
        'Toggle admission control off under 2× overload: watch the queue (and p99) explode.',
      ],
      note: `Every phenomenon in this lab has a serving-systems twin: the convoy = static batching behind a long generation; the quantum = the decode iteration; inversion = long sequences starving short ones; admission control = the waiting queue with capacity checks. T5 is this lesson at 3 TB/s.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The convoy effect in FIFO scheduling is…',
          options: [
            'Too many context switches',
            'Short jobs stuck behind one long job — head-of-line blocking that destroys tail latency',
            'The runqueue overflowing',
            'Cache thrashing between jobs',
          ],
          correct: [1],
          explanation:
            'Without preemption, service order dictates worst-case wait. One 60 s job ahead of 5 ms jobs sets their p99 to 60 s. It is also exactly the static-batching problem continuous batching solves.',
        },
        {
          q: 'Priority inversion is best described as…',
          options: [
            'A low-priority thread running first by mistake',
            'A high-priority thread blocked on a resource held by a low-priority thread, while medium-priority threads preempt the holder — high effectively runs below medium',
            'Two threads with equal priority racing',
            'The kernel boosting all priorities under load',
          ],
          correct: [1],
          explanation:
            'The classic three-party deadlock-adjacent stall. The fix is priority inheritance (holder borrows waiter\'s priority). Mars Pathfinder 1997 is the canonical incident.',
        },
        {
          q: 'Linux CFS achieves fairness by…',
          options: [
            'Strict round-robin with fixed 10 ms slices',
            'Always running the thread with the smallest vruntime (weighted consumed CPU), picked from a red-black tree',
            'Randomly sampling the runqueue',
            'Prioritizing threads with the most page faults',
          ],
          correct: [1],
          explanation:
            'CFS tracks consumed weighted time per thread and runs whoever is "most behind"; nice values change the weight. Proportional fairness, no starvation, O(log n) — and sleep-heavy interactive threads naturally win the latency game.',
        },
        {
          q: 'Continuous batching maps to preemptive scheduling because…',
          options: [
            'It runs on GPUs with many cores',
            'It re-decides the running set after every iteration (quantum), letting sequences join/leave without draining the device',
            'It uses priority inheritance',
            'It batches only same-length prompts',
          ],
          correct: [1],
          explanation:
            'Iteration-level scheduling: the batch is the timeslice, the decode step is the quantum, KV-block availability is admission control. Static batching is run-to-completion FIFO — the convoy effect on silicon.',
        },
      ],
    },
  ],
}

export default lesson
