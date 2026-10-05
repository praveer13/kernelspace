import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't5.l7',
  slug: 'continuous-batching',
  trackId: 't5',
  index: 7,
  title: 'Continuous Batching',
  minutes: 25,
  hook: 'The race-track animation: iteration-level scheduling vs static batching — the 2022 scheduling idea that multiplied every GPU\'s goodput.',
  exercise: 'sim',
  simId: 'sim-batching',
  blocks: [
    {
      type: 'prose',
      md: `T2.L4 ended with a promise: continuous batching is a 1960s scheduler wearing a GPU. This lesson pays it off. The problem it solves is the **convoy effect** you met in the scheduling lab: with *static* batching, a batch of sequences runs together until the **longest** finishes — a 500-token generation convoying 20-token generations, the GPU idling on padding and finished slots. Utilization numbers for naive static serving were dreadful (often <30%), and every finished request sat in the batch, burning KV space and compute, until the slowest sibling completed.

The fix, popularized by Orca (2022) and made famous by vLLM: **schedule at iteration granularity.** After *every single decode step*, the engine re-evaluates the batch: finished sequences leave immediately (freeing their blocks), waiting sequences join if memory allows, preempted ones are evicted and later resumed by recomputation. No one waits for anyone. The batch is the timeslice; the iteration is the quantum; the KV block manager is the admission controller. You learned this machine in T2 — here it is running the world's inference.`,
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
        { caption: 'When blocks run out mid-flight, the scheduler PREEMPTS (vLLM V1 frees the victim\'s blocks and recomputes its prefill on resume, T5.L5) and resumes later — timesharing with HBM as the RAM. You have seen this OS before: it\'s T2, at 3 TB/s.', active: ['c4'], edges: ['c3->c4'] },
      ],
    },
    {
      type: 'prose',
      md: `## The scheduler loop, in systems vocabulary

Each iteration, the engine runs the same loop — annotate it with T2 names:

1. **Pick the running set** for this step: the running queue (already admitted) plus admissions from the waiting queue — FCFS by default, priorities possible. *Scheduling decision.*
2. **Check capacity:** free blocks must cover every running sequence's potential next block (one per sequence, worst case). If not, **preempt** the lowest-priority/youngest sequences — free their KV blocks and recompute their prefill when they resume (vLLM V1; the older V0 engine could also swap KV to CPU RAM, trading PCIe bandwidth for compute). *Eviction under pressure.*
3. **Run one model step** for the whole batch: one weight read, N sequences advanced (the T4.L3 batching win — arithmetic intensity × N). *The quantum of work.*
4. **Sample, append tokens, free the finished:** sequences hitting EOS/length limits exit immediately; their blocks' refcounts drop and return to the free queue in O(1). *Reclamation.*

Two refinements complete the picture. **Waiting-queue policy** is a research area by itself (FCFS vs shortest-remaining vs priority — the same taxonomy as T2.L4, with TTFT as the metric). And **prefill chunking** (T5.L8) interleaves sliced prefills into this loop so a 100k-token prompt doesn't become a 5-second convoy inside the "continuous" schedule.`,
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
      md: `If static batching is the **charter bus** (leaves when the slowest passenger boards, everyone rides to the last stop), continuous batching is the **subway**: doors open at every station (iteration), whoever's done gets off, whoever fits gets on, the train never idles. You have also built the primitive version: a Java thread pool with \`take()\` from a bounded queue is iteration-level *admission*; what you never had was safe *preemption* mid-task — which is what the KV block manager (evictable, recomputable state!) uniquely enables. State you can evict is what makes this scheduler better than a thread pool.`,
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
            'Batches are capped at a small size, and each decode step re-reads the weights to advance too few sequences at a time',
            'The batch runs until its longest sequence finishes, and short sequences keep their slots while new requests wait',
            'The hardware must flush its caches and context-switch when a sequence ends, and an early finish stalls the whole batch',
            'Requests in a static batch are tokenized and prefilled one after another, and that serializes the start of the batch',
          ],
          correct: [1],
          explanation:
            'Head-of-line blocking at batch scope: utilization craters on mixed-length traffic. It is the FIFO convoy from T2.L4 with HBM as the held resource.',
          why: [
            'Batch size is not the defect. A static batch can be large; the waste comes from finished sequences occupying slots until the longest one ends, not from small batches.',
            'Right: head-of-line blocking at batch scope. Slots and KV blocks of finished sequences sit idle until the longest sibling ends, the FIFO convoy with HBM as the held resource.',
            'No context switch is involved. Slots idle because the batch is only edited when it fully drains, not because the GPU flushes state when a sequence ends.',
            'Prefill runs in parallel across the batch\'s prompts, so startup is not serialized. The waste appears later, when finished sequences wait on the slowest one.',
          ],
        },
        {
          q: 'Continuous batching schedules at what granularity?',
          options: [
            'Per request, where a request is admitted whole and keeps its batch slot until its final token is produced',
            'Per iteration, where finished sequences leave and waiting ones join after each decode step if free blocks remain',
            'Per block of generated tokens, where the batch is re-formed after each block and switching cost stays amortized',
            'Per time slice, where a fixed wall-clock quantum ends and the batch is re-evaluated whatever the sequences are doing',
          ],
          correct: [1],
          explanation:
            'Iteration-level scheduling: the batch is edited every ~50 ms step. The quantum is small because switching is metadata (block tables), not a context switch — the main enabler.',
          why: [
            'That is static batching. Per-request granularity keeps the batch fixed until it drains, so finished sequences wait for slow ones.',
            'Right: the batch is edited after every step, roughly 50 ms. The quantum can be this small because switching only updates block tables, not a context.',
            'No such quantum exists. The scheduler runs between every decode step; waiting 100 tokens would reintroduce convoys, and switching is cheap enough that amortizing it is unnecessary.',
            'The quantum is one model step, not a wall-clock tick. A one-second period would leave finished slots idle for roughly twenty steps at about 50 ms each.',
          ],
        },
        {
          q: 'What makes preemption practical in an inference engine (vs a thread pool)?',
          options: [
            'The hardware can pause a running sequence mid-iteration and save its registers, as an operating system saves a thread\'s context',
            'State lives in pageable key-value blocks, and a victim\'s blocks are freed and its prefill is recomputed when it resumes',
            'Each sequence is a small stateless request, and dropping one to replay it from the prompt costs less than preempting a thread',
            'Kernels checkpoint after each layer in hardware, and the scheduler can stop a sequence mid-forward-pass and resume it later',
          ],
          correct: [1],
          explanation:
            'You cannot preempt a thread and park its mind cheaply; you CAN with KV blocks (T5.L5): free them and recompute the prefill later. V1 does exactly that (V0 could also swap to host RAM). Evictable state is what turns an executor into a timesharing system — T2.L3\'s paging, repurposed.',
          why: [
            'GPUs do not preempt a sequence by saving register state; decisions happen between iterations. Preemption works because the sequence\'s state is KV blocks the engine can free and rebuild.',
            'Right: evictable state enables timesharing. Free the blocks and recompute the prefill later (V1), or in V0 swap to host RAM. A thread\'s state cannot be parked this cheaply.',
            'A sequence is not stateless: its KV cache is large and unique. Preemption is practical because that state can be freed and recomputed, and recompute still costs real prefill FLOPs.',
            'Scheduling decisions are made between iterations, never mid-kernel or mid-layer. Preemption does not resume partial forward passes; it frees blocks and recomputes the prefill.',
          ],
        },
        {
          q: 'Under sustained overload (arrivals > capacity), the correct system response is…',
          options: [
            'A smarter preemption policy such as oldest-first, which keeps requests progressing and prevents thrashing under load',
            'Admission control that rejects load early or adds capacity, as no scheduling policy prevents thrashing past the cliff',
            'Longer client timeouts, which give queued requests enough time to drain once preempted sequences are recomputed',
            'A larger running set, which shares each weight read among more sequences and lets the batch absorb the extra arrivals',
          ],
          correct: [1],
          explanation:
            'The thrashing law from T2.L3: working set > capacity ⇒ policy only chooses who suffers. Healthy systems reject early (bounded queues, load shedding) instead of degrading everyone.',
          why: [
            'Policy only chooses who suffers. When demand exceeds capacity, any preemption order recomputes more work than it completes; oldest-first changes fairness, not the cliff.',
            'Right: with the working set above capacity, policy only picks victims. Healthy systems bound queues and shed load early instead of degrading every request.',
            'Timeouts add no capacity. With arrivals above the service rate the queue grows without bound, so longer waits only delay failures and raise tail latency for everyone.',
            'A larger running set needs more KV blocks than exist at overload, so it raises preemption and recompute. Batching amortizes weight reads but cannot create HBM.',
          ],
        },
      ],
    },
  ],
}

export default lesson
