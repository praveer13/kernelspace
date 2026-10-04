import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't0.l3',
  slug: 'row-vs-column',
  trackId: 't0',
  index: 3,
  title: 'Benchmark: Row- vs Column-Major Traversal',
  minutes: 25,
  hook: 'Run the 10–100× difference yourself in the interactive benchmark simulator — same math, same matrix, wildly different physics.',
  exercise: 'sim',
  simId: 'sim-memory',
  blocks: [
    {
      type: 'prose',
      md: `Here is a puzzle. Two programs sum every element of the same 8192×8192 matrix of doubles — 512 MB of data. Identical algorithm, identical arithmetic, identical output. One finishes in about **0.4 seconds**; the other takes **8 seconds**. Twenty times slower, and the slow one is arguably the more "natural" way to write it.

The difference is a single loop-ordering decision: whether consecutive iterations touch consecutive *memory addresses*. This lesson makes you run that experiment yourself, then explains exactly why the hardware cares so much — cache lines, prefetchers, and the shape of 2D arrays in memory. It is the first time in the course you will feel a 20× penalty with your own hands, and it will not be the last.`,
    },
    {
      type: 'prose',
      md: `## Memory is one-dimensional

Your matrix is an illusion. RAM knows only addresses 0 to N, so every 2D array is *projected* onto a line. **Row-major** order (C, C++, Rust, numpy default, Java by convention) lays row 0 end-to-end, then row 1, then row 2. **Column-major** order (Fortran, MATLAB, R, Julia default) lays column 0 end-to-end, then column 1.

For a row-major matrix, element \`A[i][j]\` lives at address \`base + (i * ncols + j) * elem_size\`. Walk \`j\` upward and you advance 8 bytes per step — beautifully sequential. Walk \`i\` upward and you *jump* \`ncols * 8\` bytes per step: 64 KB per hop for our 8192-column matrix. Each hop lands in a brand-new cache line, and by the time you come back around to the next column, the line you touched has long been evicted. Every single access pays full DRAM latency.

| Traversal | Addresses touched | Cache lines used per 64 B fetched | DRAM trips for 512 MB |
|---|---|---|---|
| Row-major (sequential) | consecutive 8 B steps | 8 of 8 doubles | ~8 M (minimum possible) |
| Column-major (stride 64 KB) | jumps of 65,536 B | 1 of 8 doubles | ~67 M (8× waste, no reuse) |`,
    },
    {
      type: 'code',
      filename: 'bench_rowcol — the 20× loop',
      tabs: [
        {
          label: 'Python',
          lang: 'python',
          code: `import numpy as np

A = np.random.rand(8192, 8192)   # row-major ("C order")

def row_sum(A):
    total = 0.0
    for i in range(A.shape[0]):
        for j in range(A.shape[1]):
            total += A[i, j]        # consecutive addresses
    return total

def col_sum(A):
    total = 0.0
    for j in range(A.shape[1]):
        for i in range(A.shape[0]):
            total += A[i, j]        # 64 KB stride — cache killer
    return total

# (in practice: A.sum() — vectorized, sequential, ~100x faster
#  than either interpreted loop; the benchmark sim uses C-speed loops)`,
        },
        {
          label: 'Java',
          lang: 'java',
          code: `double[][] A = new double[8192][8192];

// fast: row-major walk — A[i] is one contiguous double[]
double rowSum(double[][] A) {
    double total = 0;
    for (int i = 0; i < A.length; i++)
        for (int j = 0; j < A[i].length; j++)
            total += A[i][j];
    return total;
}

// slow: column walk — every access hops to a different row array
double colSum(double[][] A) {
    double total = 0;
    for (int j = 0; j < A[0].length; j++)
        for (int i = 0; i < A.length; i++)
            total += A[i][j];       // new object, new cache line, every time
    return total;
}`,
        },
        {
          label: 'C',
          lang: 'c',
          code: `#define N 8192
double *A = malloc((size_t)N * N * sizeof(double)); // flat, row-major

double row_sum(const double *A) {
    double total = 0;
    for (long i = 0; i < N; i++)
        for (long j = 0; j < N; j++)
            total += A[i * N + j];   // sequential: hardware prefetcher sings
    return total;
}

double col_sum(const double *A) {
    double total = 0;
    for (long j = 0; j < N; j++)
        for (long i = 0; i < N; i++)
            total += A[i * N + j];   // stride 64 KB: every load misses
    return total;
}`,
        },
      ],
      chips: ['same FLOPs', 'different bytes-per-miss', '10–100× gap'],
    },
    {
      type: 'prose',
      md: `## Three hardware mechanisms doing the damage

**Cache lines (64 B).** A column walk uses 8 bytes of every 64-byte line it drags in from DRAM, then never touches the other 56. You are paying 8× the memory traffic for the same math — before any other effect.

**The prefetcher.** Modern CPUs detect sequential (and constant-stride) access streams and fetch upcoming lines *before* you ask. A row-major walk gets effectively lower-than-DRAM latency because the data arrives just in time. A 64 KB stride is too wide and too irregular to help: every access is a cold miss.

**The TLB, again.** Pages are 4 KB. Our matrix row is 64 KB — 16 pages *per row*. The column walk touches 8192 different pages in rapid succession, thrashing the TLB (usually ~64–1536 entries) on top of the data caches. You will meet the TLB properly in T2; for now, note that bad strides punish you twice.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Java's **double[][]** is not one array — it is an array of 8192 pointers to 8192 separately heap-allocated row arrays, possibly scattered by GC. The column walk is a pointer chase across the entire heap, the worst access pattern the hierarchy knows. CPython is worse: **list of lists of float objects**. numpy / **double[]** flat buffers / C **malloc** all fix it the same way: one contiguous allocation, addressed by arithmetic, walked sequentially. If you remember one layout rule from this course: **contiguous + sequential = fast; pointers + scattered = slow.**`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `The transpose trap: "just store it column-major then" is not a free fix. Whatever order you choose, *someone's* access pattern becomes the bad one — a column-major matrix penalizes row walks by the same 20×. Pick the layout for your hottest traversal, or **tile** (T4.L6) so both are tolerable. There is no layout that makes every access pattern happy; there are only layouts matched to workloads.`,
    },
    {
      type: 'prose',
      md: `## Why this matters for LLM serving

Hold the thought until T4–T5 and watch it pay off. A transformer's weight matrices are multiplied by activations as **tiled** matrix multiplies precisely because naive walks over GB-scale matrices would be memory-bound suicide. FlashAttention is, at its core, a *loop-reordering* to keep attention tiles resident in SRAM instead of re-reading the N×N score matrix from HBM. And the KV cache layout in vLLM — fixed-size blocks of tokens — exists so that the hot decode loop reads memory in patterns the hardware can stream. Row vs column is lesson 3 of 40. It is also, secretly, lesson 30.`,
    },
    {
      type: 'exercise',
      simId: 'sim-memory',
      machine: 'matrix',
      title: 'Row vs column benchmark',
      tasks: [
        'Run the row-major sum on the 8192² matrix; record GB/s effective bandwidth.',
        'Run the column-major sum; note the bandwidth collapse and the 10–100× wall-clock gap.',
        'Shrink the matrix to 512² (fits L2) and rerun — watch the gap nearly vanish, then explain why.',
        'Enable the prefetcher toggle and observe which traversal it rescues (and which it cannot).',
      ],
      note: `When the whole matrix fits in cache, both orders run at cache speed and the gap disappears — proof that the penalty is a *hierarchy* effect, not an instruction-count effect. At 512 MB, the column walk issues ~8× the DRAM traffic of the row walk *and* gets no prefetch rescue. This is the exact experiment that motivates tiling, SoA layouts, and FlashAttention later in the course.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'A row-major 8192×8192 matrix of doubles is summed column-by-column (outer loop over columns). The slowdown vs the row-major sum is primarily caused by…',
          options: [
            'Branch misprediction at the inner loop exit: each column ends with a mispredicted branch that stalls the whole pipeline',
            'Every access jumping 64 KB, so each 64-byte line fetched yields 8 useful bytes and is evicted before reuse',
            'Index arithmetic: computing row * 8192 + col for every access costs far more multiplies than the contiguous sum',
            'The compiler failing to vectorize column loops, so each add runs as scalar code instead of SIMD',
          ],
          correct: [1],
          explanation:
            'Stride = 8192 × 8 B = 64 KB. Each access pulls a 64-byte line, uses 8 bytes, and the line is evicted before reuse: ~8× the DRAM traffic, zero spatial locality, plus TLB thrash across 8192 pages.',
          why: [
            'Predictors handle loop-exit branches well, and one mispredict per 8192 iterations costs about 20 cycles. That cannot explain a ~20x gap that comes from a DRAM miss on every access.',
            'Right: stride is 8192 × 8 B = 64 KB. Each access pulls a 64-byte line, uses 8 bytes, and the line is evicted before reuse: ~8x the DRAM traffic, no spatial locality, and TLB thrash.',
            'Compilers reduce the index math to an add, and it costs about the same in both loop orders. A few cycles of arithmetic cannot compete with ~100 ns per DRAM miss.',
            'Missing SIMD costs at most 4–8x on arithmetic, but this loop is memory-bound, so vector units would still sit idle waiting for lines. Stride, not vectorization, is the root cause.',
          ],
        },
        {
          q: 'Why does the row/column performance gap nearly vanish when the matrix shrinks to fit in L2 cache?',
          options: [
            'Small matrices use a different, faster memory bus that bypasses the DRAM controller entirely',
            'The CPU reorders loops automatically for small arrays, so both traversal orders end up running row-major',
            'Once data is cache-resident, access order barely matters: the penalty is a DRAM-latency effect',
            'The prefetcher only works on small working sets, so it hides latency for both orders once the matrix shrinks',
          ],
          correct: [2],
          explanation:
            'The 20× is the cost of missing to DRAM on every access. If everything is already in L2, both orders hit cache and run at similar speed — the cleanest proof that layout penalties are hierarchy effects.',
          why: [
            'There is one path to DRAM. Small arrays are fast because they never go there: they are served by L2 on-chip, not through a special bus.',
            'Hardware does not reorder loops; the instruction stream keeps its order. Compilers can interchange loops at -O3, but that is a compile-time change and would help the large matrix too.',
            'Right: the ~20x gap is the cost of missing to DRAM on every access. With everything in L2, both orders hit cache and run at similar speed: proof that layout penalties are hierarchy effects.',
            'Prefetchers work at any size, including on large arrays. Row order benefits from them on big matrices, which is part of why the gap exists there but disappears in L2.',
          ],
        },
        {
          q: 'The hardware prefetcher helps most when your access pattern is…',
          options: [
            'Random within a 4 KB page, because the prefetcher fetches the whole page once it sees any access inside it',
            'Sequential or small constant stride, so it can predict upcoming lines and fetch them before the load executes',
            'Strided by exactly one page (4 KB), because a perfectly regular stride gives the prefetcher a pattern to follow',
            'Pointer-based, chasing linked nodes, because it reads each node and follows the next pointer ahead of time',
          ],
          correct: [1],
          explanation:
            'Prefetchers learn streams: sequential and modest constant strides get data in flight before the load executes, hiding DRAM latency. Wide strides and pointer chases are unpredictable, so every access is a cold miss.',
          why: [
            'Streamers track ascending or descending line addresses, not whole pages, and random order gives no pattern. Fetching 4 KB per touch would waste bandwidth, so hardware does not do it.',
            'Right: prefetchers learn streams, so sequential and modest constant strides get data in flight before the load executes, hiding DRAM latency. Wide strides and pointer chases defeat them.',
            'Regular is not enough: hardware prefetchers generally stop at 4 KB page boundaries and track small strides, so a one-page stride never trains a stream and every access is a cold miss.',
            'The next address is known only after the current node loads, and mainstream prefetchers do not follow pointers. Each hop is a serialized miss, which is why linked lists are slow.',
          ],
        },
        {
          q: 'Java\'s double[][] makes the column walk especially slow compared with a flat C buffer because…',
          options: [
            'The JIT refuses to optimize 2D loops, so every array access falls back to the interpreter',
            'Rows are separately heap-allocated objects, so the walk pointer-chases across the heap with no contiguity guarantee',
            'Each array stores a length header that misaligns the elements, so doubles straddle two cache lines',
            'Bounds checks cost more than cache misses, so checking every column index dominates the walk',
          ],
          correct: [1],
          explanation:
            'double[][] is an array of references to row objects. Column access hops between row objects that may live anywhere on the heap — the pointer-chasing tax stacked on top of the stride tax.',
          why: [
            'HotSpot compiles and unrolls nested loops well, and treats a flat double[] the same way. The difference is how double[][] sits in memory, not whether it is compiled.',
            'Right: double[][] is an array of references to row objects. A column walk hops between rows that may sit anywhere on the heap: the pointer-chasing tax stacked on top of the stride tax.',
            'Object headers are padded so element data stays 8-byte aligned, and an aligned double never straddles lines. The header costs a few bytes per row, not extra misses per access.',
            'Bounds checks are predictable compare-and-branch operations that the JIT often hoists out of loops. They cost cycles, while a DRAM miss costs hundreds, so checks cannot dominate.',
          ],
        },
      ],
    },
  ],
}

export default lesson
