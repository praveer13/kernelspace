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
      md: `There is no such thing as "memory" on a modern machine. There is a **hierarchy** — a stack of progressively larger, slower, cheaper stores, from a few hundred registers at the top to terabytes of flash at the bottom. Every load instruction you have ever written starts at the top of that stack and walks down until it finds the data. The walk can take half a nanosecond or a fifth of a millisecond, and the difference is entirely about *where the bytes happen to be*.

This is the single most consequential performance fact in computing, and it is invisible in every language you write. Python will not tell you. Java will not tell you. The hardware just quietly makes the same code run 1,000× faster or slower depending on your data's location and layout.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '~0.5 ns', label: 'L1 cache', hint: 'Roughly one CPU cycle at ~3–5 GHz. 32–64 KB per core.' },
        { value: '~5 ns', label: 'L2 cache', hint: '~10 cycles. 256 KB–2 MB per core.' },
        { value: '~15 ns', label: 'L3 cache', hint: '~40 cycles. Tens of MB shared across cores.' },
        { value: '~100 ns', label: 'DRAM', hint: '~300 cycles. This is the "×200 vs L1" number that runs the course.' },
        { value: '~100 µs', label: 'NVMe SSD', hint: 'Random read. One million L1 accesses could have happened instead.' },
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
| NVMe SSD | 1–8 TB | ~100 µs | ~2.5 days |`,
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
        { from: 'cpu', to: 'l2' },
        { from: 'cpu', to: 'l3' },
        { from: 'l3', to: 'dram' },
        { from: 'l3', to: 'ssd' },
      ],
      steps: [
        { caption: 'A load executes. The address is checked against L1 — the closest, smallest store. Hit: done in ~0.5 ns. This is the common case when your data layout is kind.', active: ['cpu', 'l1'], edges: ['cpu->l1'] },
        { caption: 'L1 miss → L2. L2 miss → L3. Each step is bigger and ~3–10× slower. Still on-chip; still fast. The caches work because programs reuse data and touch neighboring bytes.', active: ['l2', 'l3'], edges: ['cpu->l2', 'cpu->l3'] },
        { caption: 'L3 miss → DRAM. ~100 ns, ~200 L1-equivalents. The memory controller fetches a full 64-byte cache line, not just the 8 bytes you asked for — remember this; T0.L4 is built on it.', active: ['dram'], edges: ['l3->dram'] },
        { caption: 'If the OS swapped the page out, the CPU takes a page fault and reads from NVMe: ~100 µs, a million times slower than L1. In T5 you will watch vLLM swap KV cache the same way.', active: ['ssd'], edges: ['l3->ssd'] },
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
      md: `The JVM and CPython both spend enormous engineering effort hiding this from you, and both leak. A Java **HashMap** scatters entries across the heap; iterating it pointer-chases through DRAM. CPython objects are pointers all the way down — a "list of ints" is an array of pointers to heap-allocated int objects, each a separate cache-miss lottery ticket. **numpy** exists precisely to escape this: one contiguous buffer, iterated in cache-line order. That is the whole trick, and it is worth 50–500× on numeric loops.`,
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
          options: ['About 2×', 'About 10×', 'About 200×', 'About 20,000×'],
          correct: [2],
          explanation:
            '~0.5 ns vs ~100 ns — about two orders of magnitude. On the "L1 = 1 second" scale, DRAM is a 3–4 minute wait. This is the ratio behind nearly every cache optimization you will ever make.',
        },
        {
          q: 'When the CPU needs 8 bytes from DRAM, how many bytes does the memory controller actually fetch?',
          options: [
            'Exactly 8 — hardware is byte-precise',
            '64 — one full cache line, betting on spatial locality',
            '4,096 — one full page, always',
            'However many the compiler requested with prefetch hints',
          ],
          correct: [1],
          explanation:
            'The atom of the memory system is the 64-byte cache line. If you use any of the neighboring 56 bytes soon, the fetch was free; if not, you wasted 8× the bandwidth. AoS-vs-SoA layout (T0.L4) is entirely about this number.',
        },
        {
          q: 'A Python loop over a list of 1M integers is far slower than the same loop over a numpy array mostly because…',
          options: [
            'CPython\'s bytecode dispatch costs ~50 ns per instruction',
            'Each list element is a pointer to a separately heap-allocated int object — a cache-miss lottery per element',
            'numpy uses SIMD, which CPython forbids',
            'Python integers are arbitrary-precision',
          ],
          correct: [1],
          explanation:
            'Dispatch overhead is real (~20–50 ns/op) but the killer is memory: a Python list of ints is an array of pointers to scattered PyLong objects. Iteration pointer-chases through DRAM; numpy iterates one contiguous buffer in cache-line order — the hierarchy\'s favorite pattern.',
        },
        {
          q: 'Why can\'t we simply build 128 GB of L1-speed SRAM and skip the hierarchy?',
          options: [
            'SRAM cannot be manufactured above ~1 MB due to quantum tunneling',
            'SRAM needs ~6 transistors per bit (vs ~1.3 for DRAM) — cost, area, and power make it infeasible',
            'DRAM is actually faster but harder to program',
            'The memory controller would overheat',
          ],
          correct: [1],
          explanation:
            'It is pure economics and physics: 6T per bit vs ~1T+1C. Fast memory is big, hot, and expensive per bit, so we buy a little of it and let locality do the rest.',
        },
      ],
    },
  ],
}

export default lesson
