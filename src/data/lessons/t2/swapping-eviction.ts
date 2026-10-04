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

You already know the application-level version of this decision — Redis \`maxmemory-policy\`, your HTTP cache, your JVM's choice of what to keep in the old generation. This lesson is the general theory, and T5 will show it running inside vLLM, where the "pages" are KV blocks and the victim is a whole sequence.`,
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
      title: 'eviction ≡ preemption, thrashing ≡ preemption storm',
      pairs: [
        {
          os: 'swap out (LRU/Clock)',
          osLine: 'Cold frames → disk under pressure; touch faults them back at ~100 µs.',
          llm: 'KV preemption (vLLM V1)',
          llmLine: 'Preempted sequence\'s blocks are freed; on resume it is recomputed. (V0 and the paper could also swap them to CPU RAM.)',
          breaks: 'The OS evicts single cold pages chosen by recency and can write them to swap; V1 evicts all blocks of a whole sequence at once and keeps nothing, because KV can be regenerated and a dirty anonymous page cannot.',
        },
        {
          os: 'thrashing',
          osLine: 'Working set > RAM: the system pages more than it computes; throughput cliffs.',
          llm: 'preemption storm',
          llmLine: 'KV demand > HBM: the engine shuffles blocks more than it decodes; TTFT/ITL cliff.',
          breaks: 'OS thrashing comes from many processes\' working sets; here one growing decode batch drives it, and recompute preemption burns GPU FLOPs rather than disk bandwidth.',
        },
        {
          os: 'admission control',
          osLine: 'Refuse work you can\'t fit (or OOM-kill the fattest tenant).',
          llm: 'scheduler waiting queue',
          llmLine: 'vLLM admits a sequence only when blocks exist; the rest wait — FIFO or priority.',
          breaks: 'A process\'s memory need is roughly known at start; a request\'s final KV size depends on an output length nobody knows, so admission can be wrong and need preemption later.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## The vLLM footnote you are now ready for

When the vLLM engine cannot allocate blocks for the next token of *some* sequence, it must preempt: the scheduler picks victims (typically FCFS — last arrived, first preempted) and takes their memory back. The PagedAttention paper (SOSP '23, §4) describes two ways: **swap** the victim's KV blocks to CPU RAM, or **discard** them for later recompute. Swap costs PCIe bandwidth; recompute costs prefill FLOPs; the paper analyzes both, and vLLM V0 shipped both. **V1, the current engine, is recompute-only:** \`_preempt_request\` frees the victim's blocks and resets its computed-token count to zero, so the sequence is prefilled again when rescheduled (prefix-cache hits or engine KV offload can shorten that). Sound familiar? It is the swap-vs-reread decision the OS makes for anonymous pages versus file-backed pages, running at 3 TB/s inside a GPU cluster, with V1 on the drop-and-reread side. In the simulator you will drive an eviction trace to thrashing and back — feel the cliff, then build the instinct for the admission control that prevents it.`,
    },
    {
      type: 'exercise',
      simId: 'sim-vm',
      machine: 'paging',
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
            'LRU performs no better than random eviction on real workloads, so kernels evict random pages and skip the bookkeeping',
            'True LRU needs an ordered-list update on every access; Clock approximates it in O(1) using the hardware accessed bit',
            'LRU is correct but too slow to find a victim, because scanning all pages for the oldest timestamp is O(n) per eviction',
            'Hardware gives no reference information, so the kernel cannot tell which pages were used recently and must guess',
          ],
          correct: [1],
          explanation:
            'Per-access list surgery is too expensive in the kernel hot path. Clock exploits the MMU\'s accessed bit: sweep, give referenced pages a second chance, evict unreferenced ones — an excellent LRU approximation for free.',
          why: [
            'Misconception: recency is useless. Recency predicts reuse well on most workloads, and kernels do track it approximately; the objection to true LRU is its cost, not its quality.',
            'Right: exact LRU would reorder a list on every memory access, which is far too costly. Clock sweeps and reads the MMU accessed bit, approximating recency with O(1) work per eviction.',
            'Misconception: victim lookup is slow. With a list the oldest page is at the tail, so finding a victim is O(1); the expense is reordering the list on every single access.',
            'Misconception: no usage signal. The MMU sets an accessed bit in each page-table entry on use; the kernel reads and clears it, and that is exactly what Clock builds on.',
          ],
        },
        {
          q: 'A nightly batch job reads a 10 GB file once on a host with 4 GB of page cache. Under strict LRU this is harmful because…',
          options: [
            'A read-only file cannot be kept in the cache by LRU, so every pass of the scan goes back to disk and slows the job',
            'The scan evicts hot pages to cache data that will never be reread, because LRU treats a first touch as a sign of future use',
            'LRU pins every page it has touched, so after 10 GB the cache is full of unevictable pages and new reads fail',
            'The scan doubles the number of TLB entries in use, so address translation slows for every process on the host',
          ],
          correct: [1],
          explanation:
            'Scans are LRU\'s blind spot: recency rises on data with zero future. That is why databases use ARC/midpoint insertion and why Redis offers LFU — frequency and scan-resistance beat pure recency on real workloads.',
          why: [
            'Misconception: read-only files are uncacheable. Read-only pages are the easiest to cache and evict; the harm is the scan pushing out other data, not a failure to cache it.',
            'Right: every scanned page becomes most recently used, pushing genuinely hot pages toward eviction. The scanned data is never reread, so the cache turns over and pays for nothing.',
            'Misconception: LRU pins pages. LRU evicts the least recently used page whenever it needs space; nothing becomes unevictable, so reads never fail, the useful set is simply flushed.',
            'Misconception: TLB doubling. Page-cache eviction is about physical frames and has no effect on how many TLB entries a process uses; the damage is lost cache hits.',
          ],
        },
        {
          q: 'Thrashing is best defined as…',
          options: [
            'Any steady use of swap space at all, since every swapped-out page implies a slow disk round trip the next time any process touches it',
            'Combined working sets exceeding physical memory, so the system faults pages in more than it executes and throughput collapses',
            'A kernel memory leak that shrinks free memory until the page cache is squeezed to nothing and the OOM killer runs',
            'Heavy fragmentation of the swap device, so reading a swapped page needs many seeks and latency grows with swap size',
          ],
          correct: [1],
          explanation:
            'Past the working-set limit, every eviction schedules a future fault; the fault rate explodes and useful work falls off a cliff. The only real cures are admission control (run less) or more RAM.',
          why: [
            'Misconception: any swap is thrashing. Cold pages sitting in swap cost nothing; thrashing means pages being evicted and faulted back continuously because the working set does not fit.',
            'Right: when the working sets of running processes exceed RAM, each eviction causes a near-term fault. Fault rate rises, CPU idles on I/O, and throughput falls off a cliff.',
            'Misconception: thrashing is a leak. A leak steadily exhausts memory and ends in an OOM kill; thrashing occurs with healthy processes whose combined hot data is just too big.',
            'Misconception: swap fragmentation. Swap is accessed by slot and latency comes from device speed and fault volume; the cause of thrashing is demand exceeding RAM, not disk layout.',
          ],
        },
        {
          q: 'The PagedAttention paper\'s two preemption options (swap KV to CPU RAM vs discard-and-recompute; vLLM V1 keeps only recompute) most closely mirror the OS decision between…',
          options: [
            'Spinning versus sleeping on a lock: keep holding the core while waiting, or yield it and pay a wake-up later',
            'Swapping anonymous pages to disk versus dropping clean file-backed pages that can be re-read from their source',
            'Huge pages versus base pages: fewer, larger blocks to move at once versus finer-grained blocks that waste less',
            'Fair-share versus real-time scheduling: preempt by weighted time used, or by a fixed priority class',
          ],
          correct: [1],
          explanation:
            'Same trade: pay I/O to preserve state vs recompute from source. File-backed clean pages get dropped (re-readable); anonymous pages must be swapped. The paper weighs PCIe bandwidth against prefill FLOPs — the identical equation at GPU speeds — and V1 settled on recompute.',
          why: [
            'Misconception: it is a waiting-policy choice. Spin versus sleep concerns how to wait for a lock; vLLM is deciding how to give up memory, which is a storage choice.',
            'Right: dropping a clean file-backed page and re-reading it is recompute; swapping an anonymous page preserves unrecoverable state at the cost of I/O. the paper faces the same swap versus recompute choice, and V1 chose recompute.',
            'Misconception: it is a page-size choice. Huge versus base pages trade TLB reach against internal waste; vLLM already fixes the block size and is choosing what to do with evicted state.',
            'Misconception: it is a scheduling-class choice. Fair-share versus real-time decides who runs; swap versus recompute decides how an already-preempted sequence\'s memory is restored.',
          ],
        },
      ],
    },
  ],
}

export default lesson
