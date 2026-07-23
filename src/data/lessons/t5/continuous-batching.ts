import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't5.l6',
  slug: 'continuous-batching',
  trackId: 't5',
  index: 6,
  title: 'Continuous Batching',
  minutes: 25,
  hook: 'The race-track animation: iteration-level scheduling vs static batching — the 2022 scheduling idea that multiplied every GPU\'s goodput.',
  exercise: 'sim',
  simId: 'sim-batching',
  blocks: [
    {
      type: 'prose',
      md: `T2.L4 ended with a promise: continuous batching is a 1960s scheduler wearing a GPU. This lesson pays it off. The problem it solves is the **convoy effect** you met in the scheduling lab: with *static* batching, a batch of sequences runs together until the **longest** finishes — a 500-token generation convoying 20-token generations, the GPU idling on padding and finished slots. Utilization numbers for naive static serving were dreadful (often <30%), and every finished request sat in the batch, burning KV space and compute, until the slowest sibling completed.

The fix, popularized by Orca (2022) and made famous by vLLM: **schedule at iteration granularity.** After *every single decode step*, the engine re-evaluates the batch: finished sequences leave immediately (freeing their blocks), waiting sequences join if memory allows, preempted ones swap out and back. No one waits for anyone. The batch is the timeslice; the iteration is the quantum; the KV block manager is the admission controller. You learned this machine in T2 — here it is running the world's inference.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — static vs continuous: the same 4 requests on one GPU',
      height: 56,
      nodes: [
        { id: 's1', x: 2, y: 4, w: 44, h: 7, label: 'static: [A B C D] run until LONGEST (D, 40 steps)', sub: 'A,B,C idle from step 8 on', color: '#FF5C6C' },
        { id: 's2', x: 2, y: 14, w: 44, h: 7, label: '…then batch 2: [E F G H]', sub: 'queue waits a full 40-step batch' },
        { id: 'c1', x: 54, y: 4, w: 10, h: 7, label: 'it 1–8', sub: 'A B C D', color: '#3EF2A4' },
        { id: 'c2', x: 54, y: 14, w: 10, h: 7, label: 'it 9', sub: 'D + E F join', color: '#3EF2A4' },
        { id: 'c3', x: 54, y: 24, w: 10, h: 7, label: 'it 12', sub: 'D E F + G', color: '#3EF2A4' },
        { id: 'c4', x: 54, y: 34, w: 10, h: 7, label: 'it 40', sub: 'D done · H in', color: '#3EF2A4' },
        { id: 'legend', x: 76, y: 14, w: 22, h: 20, label: 'per-iteration', sub: 'leave on finish · join on free blocks', color: '#22D3EE' },
      ],
      edges: [
        { from: 'c1', to: 'c2' },
        { from: 'c2', to: 'c3' },
        { from: 'c3', to: 'c4' },
      ],
      steps: [
        { caption: 'Static batching: A (8 tokens) finishes at step 8 but its slot — and KV blocks — are held hostage until D finishes at step 40. GPU rows idle; waiting requests watch.', active: ['s1'] },
        { caption: 'Continuous: after EVERY step the scheduler edits the batch. Step 9: A, B, C are gone (blocks freed instantly); E and F are admitted mid-flight.', active: ['c1', 'c2'], edges: ['c1->c2'] },
        { caption: 'The batch is always full of *live* work: utilization tracks demand, not the longest sequence. Same GPU, same model — 2–8× goodput in real deployments (paper: up to ~24× vs naive).', active: ['c3', 'legend'], edges: ['c2->c3'] },
        { caption: 'When blocks run out mid-flight, the scheduler PREEMPTS (swap/recompute from T5.L5) and resumes later — timesharing with HBM as the RAM. You have seen this OS before: it\'s T2, at 3 TB/s.', active: ['c4'], edges: ['c3->c4'] },
      ],
    },
    {
      type: 'prose',
      md: `## The scheduler loop, in systems vocabulary

Each iteration, the engine runs the same loop — annotate it with T2 names:

1. **Pick the running set** for this step: the running queue (already admitted) plus admissions from the waiting queue — FCFS by default, priorities possible. *Scheduling decision.*
2. **Check capacity:** free blocks must cover every running sequence's potential next block (one per sequence, worst case). If not, **preempt** the lowest-priority/youngest sequences — swap their KV to CPU or drop for recompute. *Eviction under pressure.*
3. **Run one model step** for the whole batch: one weight read, N sequences advanced (the T4.L3 batching win — arithmetic intensity × N). *The quantum of work.*
4. **Sample, append tokens, free the finished:** sequences hitting EOS/length limits exit immediately; their blocks' refcounts drop and return to the free queue in O(1). *Reclamation.*

Two refinements complete the picture. **Waiting-queue policy** is a research area by itself (FCFS vs shortest-remaining vs priority — the same taxonomy as T2.L4, with TTFT as the metric). And **prefill chunking** (T5.L7) interleaves sliced prefills into this loop so a 100k-token prompt doesn't become a 5-second convoy inside the "continuous" schedule.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '~50 ms', label: 'one iteration', hint: 'A decode step for a mid-size model/batch — the quantum of this timesharing system.' },
        { value: '2–8×', label: 'goodput gain', hint: 'Continuous vs static batching on real traffic; the paper claims up to ~24× vs naive.' },
        { value: 'O(1)', label: 'slot recycle', hint: 'Finished sequence\'s blocks return to the free queue instantly — the T1 fixed-block win.' },
        { value: '1 step', label: 'preemption latency', hint: 'Eviction decisions happen between iterations, never mid-kernel.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `If static batching is the **charter bus** (leaves when the slowest passenger boards, everyone rides to the last stop), continuous batching is the **subway**: doors open at every station (iteration), whoever's done gets off, whoever fits gets on, the train never idles. You have also built the primitive version: a Java thread pool with \`take()\` from a bounded queue is iteration-level *admission*; what you never had was safe *preemption* mid-task — which is what the KV block manager (swappable state!) uniquely enables. State you can evict is what makes this scheduler better than a thread pool.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Continuous batching doesn't delete the trade-offs — it moves them into policy. **Bigger running set** → better throughput, worse ITL (more KV read per step) and worse preemption risk; **smaller** → the reverse. **Preemption policy** shapes fairness: preempt the youngest (default) and long requests can starve under load (T2.L4's starvation); preempt by age and you hurt TTFT for everyone. There is no free schedule — only visible ones. Tune with goodput (T5.L3), not throughput.`,
    },
    {
      type: 'prose',
      md: `## In the simulator

The simulator includes a deterministic four-request trace — exactly **8/12/20/40 decode steps** — before the stochastic workload. Run it in static mode to see 80 of 160 slot-steps idle and A/B/C held until step 40; run the same trace continuously to see slots recycle at steps 8, 12, and 20. Then use the live workload to push past capacity, and compare **youngest-first** with **oldest-first** preemption under the same pressure.`,
    },
    {
      type: 'exercise',
      simId: 'sim-batching',
      machine: 'batching',
      title: 'Batching race: static vs continuous',
      tasks: [
        'Run 4 requests (lengths 8/12/20/40) on static: measure GPU idle fraction and per-request wait.',
        'Same trace on continuous: watch E/F/G join mid-flight; compare goodput.',
        'Sweep arrival rate to 2× capacity: find the preemption-storm cliff (thrashing, T2.L3).',
        'Change preemption policy (youngest-first vs oldest-first): measure fairness vs TTFT.',
      ],
      note: `The cliff at overload is the deepest serving lesson: past capacity, no scheduling policy saves you — only admission control (queue and reject early) or more HBM. The scheduler's job is to make the trade visible and fair, not to repeal physics.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Static batching wastes GPU capacity because…',
          options: [
            'Batches are too small',
            'The batch runs until the LONGEST sequence finishes — short sequences\' slots and KV blocks are held hostage, and new requests wait a whole batch (convoy effect)',
            'GPUs cannot switch contexts',
            'Padding tokens are computed eagerly',
          ],
          correct: [1],
          explanation:
            'Head-of-line blocking at batch scope: utilization craters on mixed-length traffic. It is the FIFO convoy from T2.L4 with HBM as the held resource.',
        },
        {
          q: 'Continuous batching schedules at what granularity?',
          options: [
            'Per request',
            'Per iteration — after every decode step, finished sequences leave and waiting ones join, subject to free KV blocks',
            'Per 100 tokens',
            'Per second',
          ],
          correct: [1],
          explanation:
            'Iteration-level scheduling: the batch is edited every ~50 ms step. The quantum is small because switching is metadata (block tables), not a context switch — the key enabler.',
        },
        {
          q: 'What makes preemption practical in an inference engine (vs a thread pool)?',
          options: [
            'GPUs support hardware preemption',
            'Sequence state is pageable KV blocks: swap to CPU RAM or recompute from the prompt — evictable state enables timesharing',
            'Threads are cheaper than sequences',
            'The scheduler runs on the CPU',
          ],
          correct: [1],
          explanation:
            'You cannot preempt a thread and swap its mind to disk cheaply; you CAN with KV blocks (T5.L5). Pageable state is what turns an executor into a timesharing system — T2.L3\'s swap, repurposed.',
        },
        {
          q: 'Under sustained overload (arrivals > capacity), the correct system response is…',
          options: [
            'A smarter preemption policy',
            'Admission control — queue/reject early and cheaply — or more capacity; past the cliff, no scheduling policy prevents thrashing',
            'Longer timeouts',
            'Smaller models for all traffic',
          ],
          correct: [1],
          explanation:
            'The thrashing law from T2.L3: working set > capacity ⇒ policy only chooses who suffers. Healthy systems reject early (bounded queues, load shedding) instead of degrading everyone.',
        },
      ],
    },
  ],
}

export default lesson
