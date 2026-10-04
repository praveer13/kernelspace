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

**Preemptive multitasking** (the default world you live in) fixes it with the time slice: any thread can be interrupted when its slice ends (EEVDF's base slice is ~0.75–3 ms) so the runqueue rotates. Short jobs no longer wait behind long ones; the cost is context-switch overhead — the T2.L1 tax, now spent deliberately to buy responsiveness.

**Priority scheduling** layers intent on top: important threads preempt unimportant ones. Linux gives you \`nice\` values and, for the brave, real-time classes (\`SCHED_FIFO\`/\`SCHED_RR\`) that preempt *everything* below them. Priorities introduce two famous failure modes: **starvation** (low priority never runs under load) and **priority inversion** (high waits on a lock held by low, while medium hogs the CPU — high effectively runs *below* medium). The canonical fix is **priority inheritance**: the lock-holder temporarily borrows the waiter's priority. The 1997 Mars Pathfinder reset loop was fixed remotely this way — priority inversion is not trivia, it is a spacecraft bug.

**Linux EEVDF** (Earliest Eligible Virtual Deadline First — what has scheduled ordinary processes since 6.6, replacing CFS; see the [kernel EEVDF documentation](https://docs.kernel.org/scheduler/sched-eevdf.html)) doesn't use strict priorities either. Each thread still accrues **vruntime**, weighted CPU time consumed, and nice values just change the weight (the clock speed of your vruntime). EEVDF turns that into **lag**: how much CPU a thread is owed against its fair share. A thread with lag ≥ 0 is **eligible**; among eligible threads the scheduler runs the one with the earliest **virtual deadline** (eligible time + requested slice ÷ weight), found in an augmented red-black tree in O(log n). A shorter requested slice (per-task requests via sched_setattr arrived in later kernels, around 6.12) means an earlier deadline, so a latency-sensitive thread is picked sooner without being given more total CPU. Result: proportional fairness with good latency for interactive/sleep-heavy threads, and no starvation among ordinary threads — only the real-time and deadline classes above them can starve them.`,
    },
    {
      type: 'statline',
      stats: [
        { value: 'O(log n)', label: 'EEVDF pick', hint: 'Earliest virtual deadline among eligible threads, found in an augmented red-black tree.' },
        { value: '~0.75–3 ms', label: 'base slice', hint: 'Default EEVDF slice since 6.6; scales with CPU count, tunable, and on newer kernels (around 6.12) a thread can request a shorter slice via sched_setattr.' },
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
      md: `You have built a Linux-style scheduler without knowing it: a Java **ThreadPoolExecutor** with a bounded queue + \`CallerRunsPolicy\` is a scheduler with admission control and backpressure. A priority queue of tasks + worker pool is priority scheduling — and if you never thought about what happens when a low-priority task holds a connection the high-priority one needs, congratulations, you've met priority inversion in production. Python's asyncio is **cooperative** scheduling: tasks run until they \`await\` (voluntary yield). Forget an await — one \`time.sleep(5)\` — and you've head-of-line blocked the entire loop. That's why "never block the event loop" is a law.`,
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
          breaks: 'A decode step is not an interchangeable time slice: a sequence carries growing KV state, so evicting it costs a recompute of that state, not a register save.',
        },
        {
          os: 'runqueue → running set',
          osLine: 'Runnable threads wait for a slot on a core.',
          llm: 'waiting → running queue',
          llmLine: 'Requests wait for KV blocks + a batch slot; admission is capacity-checked.',
          breaks: 'A thread needs only a core, but a request needs GPU memory sized by its unknown output length, so admission is a memory forecast, not a slot count.',
        },
        {
          os: 'head-of-line blocking',
          osLine: 'A long job at the front of a FIFO runqueue delays every short job behind it.',
          llm: 'static batching',
          llmLine: 'One long generation keeps the whole batch busy until it finishes; waiting requests queue behind it.',
          breaks: 'The OS can preempt the long job at a quantum edge, but static batching cannot, which is the gap continuous batching closes.',
        },
        {
          os: 'priority inversion',
          osLine: 'High-priority waits on a lock held by low-priority under medium load.',
          llm: 'priority admission blocked by KV holders',
          llmLine: 'A high-priority request waits for KV blocks held by lower-priority running sequences; when blocks run out, the engine evicts a lowest-priority sequence (recompute in V1).',
          breaks: 'KV blocks are not a lock: the engine can reclaim them by force for a price, so there is no inheritance protocol, only a paid eviction.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## Why batching *is* scheduling

The deepest idea in modern serving is a scheduling observation: a GPU, like a CPU core, is a timeshared resource — but its "context switch" (draining one batch, loading another) is so expensive relative to the work that static, run-to-completion batching wastes most of the chip. **Continuous batching** applies preemptive timesharing at *iteration* granularity: after every single decode step (~50 ms), finished sequences leave, waiting sequences join, no one drains anything. The batch is the timeslice; the iteration is the quantum; the KV-block manager is the admission controller. T5.L7 is this lesson with GPUs; in the simulator below you can watch static batching waste the chip while continuous batching fills it.`,
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
      note: `Every phenomenon in this lab has a serving-systems twin: the convoy = static batching behind a long generation; the quantum = the decode iteration; inversion = a low-priority request holding KV blocks a high-priority one needs; admission control = the waiting queue with capacity checks. T5 is this lesson at 3 TB/s.`,
    },
    {
      type: 'field-note',
      title: 'Splitwise: Efficient Generative LLM Inference Using Phase Splitting',
      source: 'Patel et al.',
      href: 'https://arxiv.org/abs/2311.18677',
      published: 'arXiv 2023',
      verified: '2026-08',
      md: `Read Splitwise as a scheduling paper, not a hardware shopping list. One request changes resource personality after prefill: compute-heavy work becomes bandwidth-heavy serial decode. Phase splitting creates two queues and an explicit state-transfer edge so each phase can be provisioned independently. Trace the new failure modes — transfer backpressure, pool imbalance, and head-of-line blocking — using the scheduler vocabulary from this lesson.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The convoy effect in FIFO scheduling is…',
          options: [
            'Excess context switches as many short jobs pile into the runqueue, so the CPU spends its time switching rather than running',
            'Short jobs queued behind one long job, so waiting time is set by arrival order and tail latency collapses',
            'Jobs sharing a core thrashing each other\'s cache lines, so every job in the queue runs slower than it would alone',
            'A burst of arrivals overflowing the runqueue, so the scheduler drops or defers jobs and clients see timeouts',
          ],
          correct: [1],
          explanation:
            'Without preemption, service order dictates worst-case wait. One 60 s job ahead of 5 ms jobs sets their p99 to 60 s. It is also exactly the static-batching problem continuous batching solves.',
          why: [
            'Misconception: convoy means too many switches. FIFO runs each job to completion and switches rarely; the damage is waiting, not switching. Switch overhead is a preemptive-scheduler cost.',
            'Right: under FIFO the order of service fixes everyone\'s wait. A 60 s job ahead of 5 ms jobs gives them a 60 s p99 even with idle caches, the same shape as static batching.',
            'Misconception: the convoy is a cache effect. Cache pollution costs throughput, but a convoy appears on one core with perfectly warm caches; it is a queueing-order problem.',
            'Misconception: the convoy is queue overflow. It happens with an unbounded queue and nothing dropped; bounded queues and rejection belong to admission control, not to this effect.',
          ],
        },
        {
          q: 'Priority inversion is best described as…',
          options: [
            'A low-priority thread being dispatched ahead of a runnable high-priority thread because of a scheduler bug or stale priority value',
            'A high-priority thread blocked on a lock held by a low-priority thread that medium-priority threads keep preempting, so high effectively runs below medium',
            'Two threads each holding a lock the other needs, so both block forever, which raising either thread\'s priority would resolve',
            'The kernel temporarily raising every waiting thread\'s priority under load, so that long-waiting low-priority work overtakes fresh high-priority work arriving later',
          ],
          correct: [1],
          explanation:
            'The classic three-party deadlock-adjacent stall. The fix is priority inheritance (holder borrows waiter\'s priority). Mars Pathfinder 1997 is the canonical incident.',
          why: [
            'Misconception: inversion is a dispatch bug. The scheduler obeys priorities correctly; the inversion arises because the high thread cannot run, so a lower one legitimately runs.',
            'Right: the lock holder is low priority, so medium threads preempt it and the lock stays held. High waits behind medium without any scheduler error. Priority inheritance repairs it.',
            'Misconception: inversion is deadlock. The holder can finish if it gets CPU, so it is a stall rather than a cycle, and raising the holder\'s priority (inheritance) resolves it.',
            'Misconception: inversion is priority aging. Aging is a deliberate anti-starvation boost; inversion is an unintended effect of a lock and needs no priority change by the kernel to occur.',
          ],
        },
        {
          q: 'Linux\'s default scheduler for ordinary threads (EEVDF, since 6.6) shares the CPU fairly by…',
          options: [
            'Always running the thread with the smallest vruntime, taken as the leftmost node of a red-black tree, with no eligibility test',
            'Tracking each thread\'s lag against its weighted fair share and running the eligible thread (lag ≥ 0) with the earliest virtual deadline',
            'Cycling the runqueue in strict round-robin where every runnable thread gets the same fixed slice regardless of its nice value',
            'Handing each thread its weighted share of an epoch up front and letting it run until that budget is spent',
          ],
          correct: [1],
          explanation:
            'EEVDF turns weighted virtual runtime into lag: a thread owed CPU (lag ≥ 0) is eligible, and among eligible threads the earliest virtual deadline (eligible time + slice/weight) runs. Nice values change the weight; a shorter requested slice means an earlier deadline, so latency-sensitive threads are served sooner without extra CPU. Pick is still O(log n).',
          why: [
            'Stale answer: CFS picked the smallest vruntime with no eligibility test or per-thread deadline. EEVDF replaced it in 6.6; vruntime remains, but lag and virtual deadlines now decide the pick.',
            'Right: lag measures CPU owed versus fair share, eligibility is lag ≥ 0, and the earliest virtual deadline among eligible threads wins. A shorter slice gives an earlier deadline, helping latency.',
            'Misconception: fixed equal slices. Linux weights threads by nice value, so a nice -5 thread earns proportionally more CPU; fixed round-robin would ignore weights and slice requests.',
            'Misconception: epoch budgets. That resembles older epoch-based schedulers; EEVDF has no epoch, and decides continuously from lag and deadlines, so a sleeping thread\'s lag decays rather than accumulating a budget.',
          ],
        },
        {
          q: 'Continuous batching maps to preemptive scheduling because…',
          options: [
            'It spreads one batch across many GPU cores, the way a multicore scheduler spreads runnable threads across cores to hide memory latency',
            'It re-decides the running set after every iteration (quantum), so sequences join and leave without draining the device',
            'It lets a running sequence temporarily borrow the priority of a waiting one so the waiting one is never blocked behind it',
            'It groups requests of similar prompt length into one batch, so they finish together and no batch slot sits idle waiting for a straggler',
          ],
          correct: [1],
          explanation:
            'Iteration-level scheduling: the batch is the timeslice, the decode step is the quantum, KV-block availability is admission control. Static batching is run-to-completion FIFO — the convoy effect on silicon.',
          why: [
            'Misconception: core count is the link. Static batching also runs on a many-core GPU; the mapping to preemption is about when the running set is re-chosen, not how wide the hardware is.',
            'Right: the decode step plays the quantum. Re-picking the running set every iteration lets finished sequences leave and waiting ones join, so no one drains the batch, as with timeslicing.',
            'Misconception: inheritance is involved. Priority inheritance repairs lock-holder inversion; batch slots are not locks held for a waiter, and continuous batching has no such step.',
            'Misconception: length bucketing is the idea. Bucketing cuts padding but each batch still runs to completion, so one long output holds slots; that refines static batching, not scheduling per iteration.',
          ],
        },
      ],
    },
  ],
}

export default lesson
