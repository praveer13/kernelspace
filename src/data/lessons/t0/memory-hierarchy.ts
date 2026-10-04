import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't0.l2',
  slug: 'memory-hierarchy',
  trackId: 't0',
  index: 2,
  title: 'The Memory Hierarchy',
  minutes: 20,
  hook: 'Registers/L1/L2/L3/DRAM/NVMe — the latency numbers every engineer should know, and the simulator where you walk them.',
  exercise: 'sim',
  simId: 'sim-memory',
  blocks: [
    {
      type: 'prose',
      md: `There is no such thing as "memory" on a modern machine. There is a **hierarchy** — a stack of progressively larger, slower, cheaper stores, from a few hundred registers at the top to terabytes of flash at the bottom. Every load instruction you have ever written starts at the top of that stack and walks down until it finds the data. The walk can take half a nanosecond or a tenth of a millisecond, and the difference is entirely about *where the bytes happen to be*.

This is the single most consequential performance fact in computing, and it is invisible in every language you write. Python will not tell you. Java will not tell you. The hardware just quietly makes the same code run 1,000× faster or slower depending on your data's location and layout.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '~0.5 ns', label: 'L1 cache', hint: 'Roughly one CPU cycle at ~3–5 GHz. 32–64 KB per core.' },
        { value: '~5 ns', label: 'L2 cache', hint: '~10 cycles. 256 KB–2 MB per core.' },
        { value: '~15 ns', label: 'L3 cache', hint: '~40 cycles. Tens of MB shared across cores.' },
        { value: '~100 ns', label: 'DRAM', hint: '~300 cycles. This is the "×200 vs L1" number that runs the course.' },
        { value: '~100 µs', label: 'NVMe SSD', hint: 'Random read. About 200,000 L1 accesses (100 µs ÷ 0.5 ns) could have happened instead.' },
      ],
    },
    {
      type: 'prose',
      md: `## The numbers, made human

Nanoseconds are below human resolution, so rescale. Suppose one L1 access takes **one second**. Then an L2 hit takes ~10 seconds, an L3 hit ~30 seconds, a trip to DRAM takes **three to four minutes**, and a random read from an NVMe SSD takes about **two and a half days**. A page fault that has to fetch from disk? Start the request now, come back next week.

Every performance instinct you want is already in that paragraph. When a profiler shows your hot loop stalling, the right mental image is not "the CPU is slow" — it is "the CPU is a world-class sprinter standing at a closed door for four minutes at a time." The fix is never a faster CPU. The fix is bringing the data closer, or visiting it in an order the hardware can prefetch.

| Level | Size (typical) | Latency | Analogy (L1 = 1 s) |
|---|---|---|---|
| Registers | ~1 KB per core | <0.3 ns | instant |
| L1 cache | 32–64 KB per core | ~0.5 ns | 1 second |
| L2 cache | 0.5–2 MB per core | ~5 ns | 10 seconds |
| L3 cache | 16–64 MB shared | ~15 ns | 30 seconds |
| DRAM | 32–512 GB | ~100 ns | ~3.5 minutes |
| NVMe SSD | 1–8 TB | ~100 µs | ~2.5 days |

These are rounded, order-of-magnitude values. L1 (0.5 ns) and DRAM (100 ns, 200× L1) come from the Jeff Dean / Peter Norvig latency table; the ~100 µs random SSD read comes from Eskildsen's [napkin-math](https://github.com/sirupsen/napkin-math) (Dean's 2012 table lists 150 µs). L2 and L3 are typical rounded values (Dean lists L2 at 7 ns). Everything in this lesson, from the 200× DRAM ratio to the 200,000× NVMe ratio, uses this one set.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — a load instruction walks the hierarchy until something answers',
      height: 52,
      nodes: [
        { id: 'cpu', x: 2, y: 20, w: 14, h: 10, label: 'CPU core', sub: 'load r1, [addr]' },
        { id: 'l1', x: 24, y: 4, w: 16, h: 9, label: 'L1', sub: '~0.5 ns · 48 KB' },
        { id: 'l2', x: 24, y: 20, w: 16, h: 9, label: 'L2', sub: '~5 ns · 1 MB' },
        { id: 'l3', x: 24, y: 36, w: 16, h: 9, label: 'L3', sub: '~15 ns · 32 MB' },
        { id: 'dram', x: 56, y: 12, w: 18, h: 10, label: 'DRAM', sub: '~100 ns · 128 GB' },
        { id: 'ssd', x: 56, y: 32, w: 18, h: 10, label: 'NVMe', sub: '~100 µs · 4 TB' },
        { id: 'hbm', x: 82, y: 20, w: 16, h: 12, label: 'HBM (GPU)', sub: '~3.35 TB/s', color: '#A78BFA' },
      ],
      edges: [
        { from: 'cpu', to: 'l1' },
        { from: 'l1', to: 'l2' },
        { from: 'l2', to: 'l3' },
        { from: 'l3', to: 'dram' },
        { from: 'dram', to: 'ssd' },
      ],
      steps: [
        { caption: 'A load executes. The address is checked against L1 — the closest, smallest store. Hit: done in ~0.5 ns. This is the common case when your data layout is kind.', active: ['cpu', 'l1'], edges: ['cpu->l1'] },
        { caption: 'L1 miss → L2. L2 miss → L3. Each step is bigger and ~3–10× slower. Still on-chip; still fast. The caches work because programs reuse data and touch neighboring bytes.', active: ['l1', 'l2', 'l3'], edges: ['l1->l2', 'l2->l3'] },
        { caption: 'L3 miss → DRAM. ~100 ns, ~200 L1-equivalents. The memory controller fetches a full 64-byte cache line, not just the 8 bytes you asked for — remember this; T0.L4 is built on it.', active: ['dram'], edges: ['l3->dram'] },
        { caption: 'If the OS swapped the page out, the CPU takes a page fault and reads from NVMe: ~100 µs, about 200,000× slower than L1. In T2 and T5 you will see why vLLM V1 avoids that trip for KV cache and recomputes instead.', active: ['ssd'], edges: ['dram->ssd'] },
        { caption: 'GPUs have their own version: HBM instead of DRAM. Enormous bandwidth (~3.35 TB/s on H100) but still finite — and it is the wall LLM decode runs into every single token.', active: ['hbm'] },
      ],
    },
    {
      type: 'prose',
      md: `## Why the hierarchy exists at all

Physics and economics, jointly. Fast memory (SRAM, the stuff caches are made of) costs roughly 6 transistors per bit and burns area and power; DRAM costs 1 transistor + 1 capacitor per bit. You cannot buy 128 GB of SRAM at any price that fits in a server chassis. So the industry settled the trade-off decades ago: a small amount of fast, a large amount of slow, and hardware that shuttles data between them automatically in 64-byte units called **cache lines**.

Two kinds of locality make the whole scheme work. **Temporal locality:** data you just used, you will probably use again — so keep it close. **Spatial locality:** data near what you just used, you will probably use soon — so fetch the whole line. Every cache, prefetcher, and eviction policy on the chip is a bet on those two heuristics. When your code cooperates, the hierarchy is nearly invisible. When it does not, you pay full DRAM latency on every access — the "pointer-chasing tax" that makes linked structures so much slower than arrays, and that made your Java \`LinkedList\` benchmarks look silly in university.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `The JVM and CPython both spend enormous engineering effort hiding this from you, and both leak. A Java **HashMap** scatters entries across the heap; iterating it pointer-chases through DRAM. CPython objects are pointers all the way down — a "list of ints" is an array of pointers to heap-allocated int objects, each a boxed object with its own header, refcount and pointer hop, and a cache miss once the heap fragments. **numpy** exists precisely to escape this: one contiguous buffer of raw values, no boxing, handed to compiled SIMD loops and iterated in cache-line order. Layout is part of the trick, interpreter overhead is most of it, and together they are worth 50–500× on numeric loops.`,
    },
    {
      type: 'prose',
      md: `## The same ladder, on the GPU

LLM serving runs on the same physics with different numbers. An H100 pairs huge compute with **HBM3** — high-bandwidth memory delivering ~3.35 TB/s and ~80 GB of capacity. Above HBM sits a ~50 MB L2, and above that, per-SM SRAM ("shared memory") of up to 228 KB with ~20+ TB/s of aggregate bandwidth. The hierarchy is *steeper*: compute is so abundant that feeding it is the entire problem. That is why this course keeps returning to one question — **how many bytes must move per unit of work?** — whether the work is a Java loop, a CUDA kernel, or a transformer forward pass.

In the simulator below you will walk this ladder yourself: fire accesses at different working-set sizes and stride patterns, watch which level answers, and feel the 0.5 ns → 100 µs cliff in your hands instead of on a slide.`,
    },
    {
      type: 'exercise',
      simId: 'sim-memory',
      machine: 'latency',
      title: 'Latency-walk visualizer',
      tasks: [
        'Run the pointer-chase with a 32 KB working set — find which cache level answers (flat, fast).',
        'Grow the working set to 64 MB and watch the latency step up L1 → L2 → L3 → DRAM.',
        'Compare stride-1 vs stride-4096 traversal of the same buffer; explain the difference using 64-byte cache lines.',
        'Locate HBM on the ladder and note its bandwidth vs DRAM — the number decode lives and dies by.',
      ],
      note: `The step pattern you just saw is the memory hierarchy measured directly. Each plateau is a level: while the working set fits in L1 you pay ~0.5 ns; once it spills, latency jumps to the next level. **Stride-4096 defeats the prefetcher and the TLB at once** — every access lands in a new 4 KB page and a new cache line. This exact experiment, run on a GPU against HBM, is why LLM inference engineers obsess over memory access patterns.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Roughly how much slower is a DRAM access than an L1 cache hit?',
          options: [
            'About 2×: both live on the chip, so a DRAM access costs roughly two cache hits',
            'About 10×: one order of magnitude, like the step between adjacent cache levels',
            'About 200×: ~100 ns against ~0.5 ns, so DRAM costs two orders of magnitude more',
            'About 20,000×: off-chip DRAM pays a round trip closer to tens of microseconds per access',
          ],
          correct: [2],
          explanation:
            '~0.5 ns vs ~100 ns — about two orders of magnitude. On the "L1 = 1 second" scale, DRAM is a 3–4 minute wait. This is the ratio behind nearly every cache optimization you will ever make.',
          why: [
            'Treats DRAM as part of the cache family. DRAM is off-chip, behind a memory controller: ~100 ns against ~0.5 ns for L1. Even the hop from L1 to L2 is about 10x, so 2x is smaller than a single cache-level step.',
            'Matches the L2-to-L3 step, which is 3x to 10x. Each cache level is only a few times slower than the one above; the jump to DRAM is a much larger cliff.',
            'Right: about 100 ns against about 0.5 ns. On the "L1 = 1 second" scale DRAM is a 3 to 4 minute wait, the ratio behind nearly every cache optimization you will make.',
            'Overshoots by two orders of magnitude. Tens of microseconds is closer to flash than DRAM; an NVMe read at ~100 µs is the roughly 200,000x case. DRAM stays near 100 ns.',
          ],
        },
        {
          q: 'When the CPU needs 8 bytes from DRAM, how many bytes does the memory controller actually fetch?',
          options: [
            'Exactly 8 bytes: the memory system is byte-addressed, so the controller fetches only what the load asked for',
            '64 bytes: one full cache line, betting that neighboring bytes will be used soon (spatial locality)',
            '4,096 bytes: DRAM is accessed a page at a time, so every miss pulls in a full 4 KB page',
            'However many bytes the compiler requested with prefetch hints, since hardware fetches only what software asks for',
          ],
          correct: [1],
          explanation:
            'The atom of the memory system is the 64-byte cache line. If you use any of the neighboring 56 bytes soon, the fetch was free; if not, you wasted 8× the bandwidth. AoS-vs-SoA layout (T0.L4) is entirely about this number.',
          why: [
            'Addresses are byte-granular but transfers are not. Caches and the memory controller move whole lines, so an 8-byte load costs a 64-byte transfer. Assuming byte precision hides the wasted bandwidth.',
            'Right: the 64-byte cache line is the atom of the memory system. Use the neighbors soon and the fetch was free; otherwise you wasted 8x the bandwidth. AoS-vs-SoA layout is built on this number.',
            '4 KB is the virtual-memory page size, a unit of translation and OS paging, not of cache fills. CPU caches fill 64-byte lines, so a miss does not drag in a whole page.',
            'Prefetch hints only request extra lines; every demand miss still fetches a full line. Hardware prefetchers also run without any hints, so software requests do not set the fetch size.',
          ],
        },
        {
          q: 'A Python loop over a list of 1M integers is far slower than the same loop over a numpy array mostly because…',
          options: [
            'Every list element is a pointer to a scattered heap object, so each iteration is a guaranteed DRAM cache miss',
            'Per-element interpreter work: bytecode dispatch, refcounting and a boxed int for every add, with no SIMD loop',
            'numpy releases the GIL and spreads the loop across all cores while the list loop is stuck on one core',
            'Python integers are arbitrary-precision, so even a small add has to walk a multi-word bignum representation',
          ],
          correct: [1],
          explanation:
            'Each list iteration runs several bytecodes (~20–50 ns/op), updates reference counts, and allocates a boxed int for the result; numpy runs one compiled loop over raw, contiguous values, often with SIMD. Cache misses add cost on a fragmented heap, but ints created in sequence usually sit close together, so they are rarely the dominant term.',
          why: [
            'Overstated. Ints created in a loop are usually allocated near each other, small ints are cached, and prefetching helps. Cache misses add cost on a fragmented heap but rarely dominate a simple sum.',
            'Right: each element pays bytecode dispatch (~20–50 ns/op), a refcount update and a boxed int result. numpy runs one compiled, often SIMD, loop over raw values. Memory layout is secondary here.',
            'Elementwise numpy operations run on one thread by default; only some BLAS-backed routines use several cores. The gap exists on a single core, so parallelism is not the main cause.',
            'CPython ints do use arbitrary-precision digits, but a value under 2^30 occupies one digit with a fast path. The cost is the boxed object and interpreter overhead around the add, not bignum arithmetic.',
          ],
        },
        {
          q: 'Why can\'t we simply build 128 GB of L1-speed SRAM and skip the hierarchy?',
          options: [
            'Large SRAM arrays cannot be fabricated at all: past a few MB the cells stop holding their state reliably',
            'SRAM needs ~6 transistors per bit vs 1 transistor plus a capacitor for DRAM: area, power and cost make it infeasible',
            'DRAM cells are intrinsically faster than SRAM but harder to program, so designers put SRAM caches in front for convenience',
            'A 128 GB array would be too hot to cool: the memory controller would overheat and throttle the whole chip',
          ],
          correct: [1],
          explanation:
            'It is pure economics and physics: 6T per bit vs ~1T+1C. Fast memory is big, hot, and expensive per bit, so we buy a little of it and let locality do the rest.',
          why: [
            'Large SRAM is buildable: Groq LPUs carry ~500 MB each and Cerebras WSE-3 has 44 GB on one wafer. It just costs enormous area and money per bit, which is the real constraint.',
            'Right: 6T per bit against ~1T+1C makes SRAM big, hot and expensive per bit, so we buy a little of it and let locality do the rest.',
            'Backwards. SRAM is the faster technology and DRAM the denser, cheaper one. The hierarchy exists for cost and capacity reasons, and programmers do not choose between them; hardware moves lines automatically.',
            'Power density is part of the cost story, but it is not a controller defect. The fundamental limit is transistors, area and dollars per bit, which would be prohibitive well before any thermal limit.',
          ],
        },
      ],
    },
  ],
}

export default lesson
