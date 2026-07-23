import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't4.l4',
  slug: 'occupancy-coalescing',
  trackId: 't4',
  index: 4,
  title: 'Occupancy & Coalesced Memory Access',
  minutes: 25,
  hook: 'The two numbers that decide whether your kernel sings or crawls: enough warps to hide latency, and warp accesses the hardware can merge.',
  exercise: 'sim',
  simId: 'sim-roofline',
  blocks: [
    {
      type: 'prose',
      md: `T4.L1 gave you the two big GPU ideas — warps and latency-hiding. This lesson turns them into the two **measurable** quantities that dominate kernel performance in practice: **occupancy** (do you have enough warps resident to hide HBM latency?) and **coalescing** (does each warp memory instruction touch memory efficiently?). Most "my kernel is 10× slow" mysteries reduce to one of these two.

Both are, at heart, T0 ideas reincarnated on the GPU: occupancy is your I/O-bound thread-pool sizing rule, and coalescing is the 64-byte cache-line discipline at warp scale. If T0 made sense, this lesson is two small translations.`,
    },
    {
      type: 'prose',
      md: `## Occupancy: warps in residence

An SM can host a hardware-limited number of warps (64 on recent NVIDIA parts). How many *actually* fit — the **occupancy** — is throttled by three budgets: registers per SM (256 KB ÷ per-thread usage), shared memory per SM (228 KB ÷ per-block usage), and block/warp slots. A kernel using 128 registers/thread and 100 KB shared/block might fit only 4 warps per SM: 6% occupancy. When those warps stall on HBM (~400–800 cycles), the SM idles — there is nobody else to run. Throughput craters, not because the code is wrong but because the latency has no cover.

The tuning loop is mechanical: check occupancy (nsight-compute or compiler stats), find the binding budget, relax it — fewer live registers (smaller tiles), less shared per block, smaller blocks. **But** high occupancy is a means, not a goal: some of the fastest kernels run at 25% occupancy with heavy instruction-level parallelism. The rule that survives: *enough* warps (or enough ILP) to keep the memory pipeline full — measure, don't worship.`,
    },
    {
      type: 'prose',
      md: `## Coalescing: the warp-wide memory contract

When a warp issues a load, the hardware examines all 32 lane addresses and merges them into the fewest possible memory transactions. Ideal case — **lane i reads address base + i×4 bytes**: one 128-byte transaction serves the whole warp. Worst case — 32 scattered addresses: **32 separate transactions**, 1/32 of peak bandwidth for that instruction. This is the coalescing rule, and it's T0.L3 (row vs column) with a warp jury: consecutive lanes should touch consecutive addresses.

The classic violation is the "column walk" reincarnate: a kernel where \`threadIdx.x\` indexes the *slow* dimension of a row-major matrix (stride = row pitch). Every lane lands in a different 128-byte segment; the warp issues 32 transactions per load; effective bandwidth drops ~10–30×. The fixes are layout (transpose / structure-of-arrays — T0.L4 again), staging through **shared memory** (load coalesced, compute strided from SRAM — SRAM has no coalescing penalty, only bank conflicts), and padding.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — one warp load: coalesced vs scattered',
      height: 46,
      nodes: [
        { id: 'warp', x: 2, y: 8, w: 18, h: 10, label: 'warp (32 lanes)', sub: 'one load instr' },
        { id: 'coal', x: 30, y: 4, w: 30, h: 9, label: 'coalesced', sub: 'lanes → consecutive 4 B' },
        { id: 't1', x: 72, y: 4, w: 24, h: 9, label: '1 transaction', sub: '128 B, full BW', color: '#3EF2A4' },
        { id: 'scat', x: 30, y: 30, w: 30, h: 9, label: 'scattered', sub: 'lanes → stride 1 KB' },
        { id: 't32', x: 72, y: 30, w: 24, h: 9, label: '32 transactions', sub: '~1/32 peak BW', color: '#FF5C6C' },
      ],
      edges: [
        { from: 'warp', to: 'coal' },
        { from: 'coal', to: 't1' },
        { from: 'warp', to: 'scat' },
        { from: 'scat', to: 't32' },
      ],
      steps: [
        { caption: 'One warp-level load instruction. The hardware coalescer inspects all 32 lane addresses and merges them into transactions.', active: ['warp'] },
        { caption: 'Coalesced: lane i reads base+4i — the warp consumes 128 consecutive bytes in ONE transaction. Full bandwidth; this is why GPU layouts are SoA-shaped (T0.L4).', active: ['coal', 't1'], edges: ['warp->coal', 'coal->t1'] },
        { caption: 'Scattered: lanes stride a kilobyte apart — 32 separate transactions, each wasting most of its segment. Same instruction count, ~1/32 the delivered bytes per cycle.', active: ['scat', 't32'], edges: ['warp->scat', 'scat->t32'] },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Coalescing is your **N+1 query problem**, hardware edition: one warp instruction that should have been a single bulk fetch becomes 32 round-trips to HBM. The fix rhymes too — batch the access (contiguous layout) or stage it through a faster tier (shared memory) and reshape the access there. Occupancy, meanwhile, is your old thread-pool rule "threads ≥ cores when work blocks" — except "blocked on HBM" is every other instruction, so the required oversubscription is 8–16 warps, not 2×.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Shared memory has its own fragmentation-like gotcha: **bank conflicts**. SRAM is striped across 32 banks (4 B each); a warp hitting 32 distinct banks gets full speed, but N lanes hitting addresses in the *same* bank serialize N-fold. Classic trigger: striding a column through a tile stored in shared memory. Classic fix: **pad the tile row by one element** so column strides land on different banks. If this smells like T0.L4's false sharing — same family: the hardware's parallel banks are only parallel if you address them politely.`,
    },
    {
      type: 'prose',
      md: `## Why serving kernels obsess over both

Attention and GEMM kernels are coalescing masterclasses: FlashAttention's tiles exist so every HBM transaction is wide and every compute step reads from conflict-free SRAM. And on the serving side, the KV cache's *layout* (block size, head-first vs token-first) is chosen so decode reads coalesce — a badly laid-out KV cache can cost real ITL milliseconds at scale. In the simulator you'll flip a kernel between row- and column-walk and watch delivered bandwidth move an order of magnitude; then you'll tune register pressure and watch occupancy rescue a latency-drowned kernel.`,
    },
    {
      type: 'exercise',
      simId: 'sim-roofline',
      machine: 'roofline',
      title: 'Occupancy & coalescing lab',
      tasks: [
        'Run the column-walk kernel; record delivered bandwidth vs peak (~1/32).',
        'Switch to unit-stride (coalesced); confirm recovery — then transpose via shared memory instead and compare.',
        'Raise per-thread registers until occupancy drops below 25%; watch latency-hiding fail.',
        'Introduce a 32-way bank conflict in the SRAM tile, then fix it with +1 padding.',
      ],
      note: `Four levers, one theme: the GPU delivers peak bandwidth only to polite access patterns and enough resident warps. Layout (SoA), staging (SRAM tiles + padding), and occupancy budgeting are the whole toolbox — T4.L6 combines all three into tiled matmul.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'SM occupancy is limited by…',
          options: [
            'Only the warp slot count',
            'The tightest of three budgets: registers per SM, shared memory per SM, and block/warp slots',
            'The L2 cache size',
            'The PCIe generation',
          ],
          correct: [1],
          explanation:
            'Any of the three can bind first — a fat-register kernel or a shared-hungry block caps resident warps regardless of slot count. Tuning = finding and relaxing the binding budget.',
        },
        {
          q: 'A warp load where lane i reads address base + 4×i results in…',
          options: [
            '32 transactions',
            'One 128-byte transaction — perfect coalescing, full delivered bandwidth',
            'A bank conflict',
            'A warp divergence',
          ],
          correct: [1],
          explanation:
            'Consecutive lanes → consecutive addresses: the coalescer merges the warp\'s accesses into a single wide transaction. This is the GPU\'s native access pattern, and layouts are chosen to produce it.',
        },
        {
          q: 'Staging a strided access through shared memory helps because…',
          options: [
            'Shared memory is bigger than HBM',
            'HBM reads become wide/coalesced, and the strided compute reads hit SRAM, which has no coalescing requirement (only bank conflicts, fixable with padding)',
            'It reduces register pressure to zero',
            'The compiler requires it',
          ],
          correct: [1],
          explanation:
            'Separate the concerns: be polite to HBM (wide transactions), be arbitrary in SRAM. This staging pattern is the skeleton of tiled matmul and FlashAttention (T4.L6).',
        },
        {
          q: 'A 32-way shared-memory bank conflict occurs when…',
          options: [
            '32 warps share one SM',
            'All 32 lanes address words in the SAME SRAM bank, serializing the access 32-fold — typically fixed by padding tile rows',
            'The block exceeds 1024 threads',
            'Two kernels write the same array',
          ],
          correct: [1],
          explanation:
            'SRAM bandwidth is per-bank; same-bank collisions serialize. The +1 padding trick skews strides across banks — the false-sharing lesson (T0.L4) wearing a different hat.',
        },
      ],
    },
  ],
}

export default lesson
