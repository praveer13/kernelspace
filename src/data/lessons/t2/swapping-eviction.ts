import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't2.l3',
  slug: 'swapping-eviction',
  trackId: 't2',
  index: 3,
  title: 'Swapping & Eviction Policies',
  minutes: 20,
  hook: 'LRU, LFU, Clock — how the OS decides what to sacrifice, why it thrashes, and what vLLM inherited verbatim.',
  exercise: 'sim',
  simId: 'sim-vm',
  blocks: [
    {
      type: 'prose',
      md: `Memory fills up. Not "might" — *will*, because every caching layer in computing is a bet that demand will exceed capacity eventually. When the OS runs out of free frames, something must be evicted: written to swap (if dirty) or dropped (if clean and file-backed). The policy that chooses the victim is one of the most-studied decisions in systems, because it directly prices your latency tail: evict the wrong page and you just scheduled a ~100 µs major fault into someone's request path.

You already know the application-level version of this decision — Redis \`maxmemory-policy\`, your HTTP cache, your JVM's choice of what to keep in the old generation. This lesson is the general theory, and T5 will show it running inside vLLM, where the "pages" are KV blocks and the "swap" is CPU RAM.`,
    },
    {
      type: 'prose',
      md: `## The candidate policies

**OPT (Belady's algorithm)** evicts the page used *farthest in the future* — provably optimal, and provably impossible: it needs the future. Its value is as the measuring stick every real policy is graded against.

**LRU (least recently used)** bets that recent past ≈ near future: evict what hasn't been touched longest. Beautiful for loops and working sets; catastrophically wrong for scans — read a 10 GB file once through a 4 GB cache and LRU evicts *everything useful* to hold data you'll never reread. (Databases know this: Postgres and InnoDB use scan-resistant variants — ARC, midpoint insertion — precisely so one \`SELECT *\` can't flush the buffer pool.)

**LFU (least frequently used)** counts references instead of recency: scans can't evict hot items, but LFU has memory — yesterday's hot page clings on after the workload moves on. Real systems add aging (Redis's approx-LFU does).

**Clock / second-chance** is what OSes actually ship: pages sit in a circular list with a reference bit; the hand sweeps, clearing bits; a page with bit still set gets a *second chance*, a cleared page is evicted. It approximates LRU with O(1) work and no list surgery — hardware even sets the reference bit for you (the "accessed" bit in page-table entries). Linux's multi-generational version (MGLRU) is the same idea with finer age bins.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — Clock: the second-chance hand at work',
      height: 50,
      nodes: [
        { id: 'p0', x: 8, y: 6, w: 16, h: 8, label: 'pg 0 · ref=1' },
        { id: 'p1', x: 42, y: 3, w: 16, h: 8, label: 'pg 1 · ref=1' },
        { id: 'p2', x: 76, y: 6, w: 16, h: 8, label: 'pg 2 · ref=0' },
        { id: 'p3', x: 76, y: 34, w: 16, h: 8, label: 'pg 3 · ref=1' },
        { id: 'p4', x: 42, y: 38, w: 16, h: 8, label: 'pg 4 · ref=1' },
        { id: 'p5', x: 8, y: 34, w: 16, h: 8, label: 'pg 5 · ref=0' },
        { id: 'hand', x: 42, y: 18, w: 16, h: 9, label: '→ hand', sub: 'sweeping…', color: '#FFB224' },
      ],
      edges: [
        { from: 'p0', to: 'p1' },
        { from: 'p1', to: 'p2' },
        { from: 'p2', to: 'p3' },
        { from: 'p3', to: 'p4' },
        { from: 'p4', to: 'p5' },
        { from: 'p5', to: 'p0' },
      ],
      steps: [
        { caption: 'Frames sit in a ring; hardware sets each page\'s reference bit on every access. Free frames exhausted → the hand starts sweeping for a victim.', active: ['hand'] },
        { caption: 'pg 0: ref=1 — recently used. Clear the bit, spare the page ("second chance"), advance. Same for pg 1.', active: ['p0', 'p1'], edges: ['p0->p1'] },
        { caption: 'pg 2: ref=0 — untouched since last sweep. EVICT: if dirty, write to swap first; if clean, drop instantly. Frame reclaimed.', active: ['p2'], edges: ['p1->p2'] },
        { caption: 'One full sweep approximates LRU at O(1) per step, with no list operations — and the "accessed" bit is set by the MMU for free. That is why every production OS is Clock-family, not true LRU.', active: ['hand'] },
      ],
    },
    {
      type: 'prose',
      md: `## Thrashing: when eviction becomes the workload

The failure mode has a name you should fear: **thrashing**. When the total working set of runnable processes exceeds physical memory, every eviction schedules a near-future fault; the system spends more time swapping than executing. Throughput doesn't degrade gracefully — it *cliffs*. The OS is suddenly an I/O-bound application whose job is moving pages to and from disk.

The two defenses appear everywhere in this course: **admission control** (don't run what you can't fit — Linux's OOM killer is the brutal last resort version) and **working-set awareness** (size things so the hot set fits: tune \`-Xmx\` under the container limit, pin critical pages with \`mlock\`, keep Redis datasets under RAM). Every serving system rediscovers both.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You have operated this exact machinery in disguise. Redis **allkeys-lru** ≈ Clock over keys; **volatile-ttl** is priority eviction; a Redis instance evicting hot keys under memory pressure *is* a thrashing OS. And your JVM heap sizing under a cgroup limit is admission control: exceed it and you meet the container world's OOM killer, which — like the kernel's — picks the fattest process and shoots it. Same physics, different addr spaces.`,
    },
    {
      type: 'isomorphism',
      title: 'swap ≡ KV offload, eviction ≡ preemption',
      pairs: [
        {
          os: 'swap out (LRU/Clock)',
          osLine: 'Cold frames → disk under pressure; touch faults them back at ~100 µs.',
          llm: 'KV swap-out (vLLM)',
          llmLine: 'Preempted sequences\' blocks → CPU RAM; resume reloads (swap) or recomputes (recompute).',
        },
        {
          os: 'thrashing',
          osLine: 'Working set > RAM: the system pages more than it computes; throughput cliffs.',
          llm: 'preemption storm',
          llmLine: 'KV demand > HBM: the engine shuffles blocks more than it decodes; TTFT/ITL cliff.',
        },
        {
          os: 'admission control',
          osLine: 'Refuse work you can\'t fit (or OOM-kill the fattest tenant).',
          llm: 'scheduler waiting queue',
          llmLine: 'vLLM admits a sequence only when blocks exist; the rest wait — FIFO or priority.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## The vLLM footnote you are now ready for

When the vLLM engine cannot allocate blocks for the next token of *some* sequence, it must preempt: the scheduler picks victims (typically FCFS — last arrived, first preempted), and either **swaps** their KV blocks to CPU RAM or **discards** them for later recompute. Swap costs PCIe bandwidth; recompute costs prefill FLOPs; the paper analyzes both. Sound familiar? It is the swap-vs-reread decision the OS makes for file-backed pages versus anonymous pages, running at 3 TB/s inside a GPU cluster. In the simulator you will drive an eviction trace to thrashing and back — feel the cliff, then build the instinct for the admission control that prevents it.`,
    },
    {
      type: 'exercise',
      simId: 'sim-vm',
      title: 'Eviction lab: policies under pressure',
      tasks: [
        'Run the looping trace (working set fits): compare LRU vs Clock fault counts — near-identical.',
        'Run the one-shot scan trace: watch LRU evict the hot set; count the avoidable faults.',
        'Shrink frames until the working set no longer fits: find the thrashing cliff and the knee just before it.',
        'Enable admission control (refuse the 5th process); confirm the cliff disappears.',
      ],
      note: `The cliff is the signature: below it, policy choice shaves single-digit percentages; above it, NO policy saves you — only admission control or more memory. This is why capacity planning beats eviction tuning, in kernels and in serving clusters alike.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Why don\'t production operating systems implement true LRU for page eviction?',
          options: [
            'LRU is patent-encumbered',
            'True LRU needs ordered-list updates on every access; Clock/second-chance approximates it with O(1) work using the hardware "accessed" bit',
            'LRU is always worse than random eviction',
            'The MMU forbids it',
          ],
          correct: [1],
          explanation:
            'Per-access list surgery is too expensive in the kernel hot path. Clock exploits the MMU\'s accessed bit: sweep, give referenced pages a second chance, evict unreferenced ones — an excellent LRU approximation for free.',
        },
        {
          q: 'A nightly batch job reads a 10 GB file once on a host with 4 GB of page cache. Under strict LRU this is harmful because…',
          options: [
            'The file is read-only',
            'The scan evicts genuinely hot pages to cache data that will never be reread — LRU has no scan resistance',
            'LRU pins all 10 GB forever',
            'It doubles the TLB',
          ],
          correct: [1],
          explanation:
            'Scans are LRU\'s blind spot: recency rises on data with zero future. That is why databases use ARC/midpoint insertion and why Redis offers LFU — frequency and scan-resistance beat pure recency on real workloads.',
        },
        {
          q: 'Thrashing is best defined as…',
          options: [
            'Any use of swap at all',
            'Combined working set > physical memory, so the system spends more time faulting pages than executing — throughput collapses non-linearly',
            'A memory leak in the kernel',
            'Disk fragmentation on the swap device',
          ],
          correct: [1],
          explanation:
            'Past the working-set limit, every eviction schedules a future fault; the fault rate explodes and useful work falls off a cliff. The only real cures are admission control (run less) or more RAM.',
        },
        {
          q: 'vLLM\'s preemption choices (swap KV to CPU RAM vs discard-and-recompute) most closely mirror the OS decision between…',
          options: [
            'Spinlock vs mutex',
            'Swapping anonymous pages to disk vs dropping clean file-backed pages that can be re-read',
            'Huge pages vs base pages',
            'CFS vs real-time scheduling',
          ],
          correct: [1],
          explanation:
            'Same trade: pay I/O to preserve state vs recompute from source. File-backed clean pages get dropped (re-readable); anonymous pages must be swapped. vLLM weighs PCIe bandwidth against prefill FLOPs — the identical equation at GPU speeds.',
        },
      ],
    },
  ],
}

export default lesson
