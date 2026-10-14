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
  kcs: ['t4.occupancy', 't4.coalescing'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt: 'Name the three budgets that limit occupancy, and say what happens when a kernel exhausts one of them.',
        model:
          'Registers per multiprocessor, shared memory per multiprocessor, and the block and warp slots. Whichever runs out first caps the resident warps. With few warps, a stall on HBM leaves nothing else to run, so the multiprocessor idles and throughput falls even though the code is correct.',
        ideas: [
          'The budgets are registers, shared memory and block or warp slots',
          'Whichever budget runs out first caps the number of resident warps',
          'Too few warps leave a stall on HBM uncovered, so the multiprocessor idles',
        ],
        kcs: ['t4.occupancy'],
      },
      {
        prompt: 'Count the memory transactions of one warp load when lane i reads base plus 4i bytes, and when it reads base plus 1024i bytes, and say what the second costs.',
        model:
          'The first touches 128 consecutive bytes, so it takes one transaction at full bandwidth. In the second every lane lands in its own 128-byte segment, so the load takes 32 transactions and delivers about a thirty-second of peak bandwidth. Staging through shared memory fixes it by coalescing the global loads.',
        ideas: [
          'Consecutive 4-byte reads fill one 128-byte segment, so one transaction',
          'A kilobyte stride puts each lane in its own segment, so 32 transactions',
          'Delivered bandwidth falls to about a thirty-second, and staging through shared memory restores it',
        ],
        kcs: ['t4.coalescing'],
      },
    ],
  },
  blocks: [
    {
      type: 'predict',
      items: [
        {
          kind: 'choice',
          q: 'A kernel uses so many registers per thread that only four warps fit on each multiprocessor, and all four wait on HBM loads. What does the multiprocessor do?',
          options: [
            'It idles until a load returns, with no other warp resident to take over',
            'It speculates past the loads, with the hardware running ahead until the data arrives',
            'It pulls warps from a neighbouring multiprocessor, with the idle slots filled from its queue',
            'It serves the loads from L2 instead, with the shorter latency leaving no time to idle',
          ],
          correct: [0],
          why: [
            'Right: latency hiding needs other warps to switch to, and four warps that all wait leave nothing ready. The multiprocessor sits idle for most of each load.',
            'GPU cores are in-order and do not speculate. The only cover for a stall is another resident warp, and here there is none.',
            'A multiprocessor cannot borrow warps from another one. A block stays on the multiprocessor it was assigned to until it finishes.',
            'Loads that miss in L1 may hit in L2, but that is a property of the data, not a response to a stall, and an L2 hit still takes far longer than a cycle or two.',
          ],
          revealAt: 'Occupancy: warps in residence',
          kcs: ['t4.occupancy'],
        },
        {
          kind: 'choice',
          q: 'The 32 lanes of a warp read 32 different addresses that fall in the same bank of shared memory. Next to 32 lanes on 32 different banks, how long does the access take?',
          options: [
            'About the same time, with shared memory serving the lanes together whichever banks they hit',
            'Many times longer, with the accesses to the one bank served one after another',
            'About twice as long, with the hardware splitting the warp into two halves of lanes',
            'It faults, with the hardware rejecting a warp whose lanes collide on one bank',
          ],
          correct: [1],
          why: [
            'Shared memory is striped across banks and each bank serves one address per cycle. Lanes on different banks go together; lanes on the same bank do not.',
            'Right: each bank handles one address at a time, so 32 different addresses in one bank take 32 passes. Padding the tile row by one element spreads the lanes across banks.',
            'The warp is not split in halves for this. The hardware replays the access once for each extra address in the busiest bank, which can be as many as 32.',
            'A bank conflict is legal and silent. It costs time, not an error, which is why it shows up only in a profiler.',
          ],
          revealAt: 'Coalescing: the warp-wide memory contract',
          kcs: ['t4.coalescing'],
        },
      ],
    },
    {
      type: 'prose',
      md: `T4.L1 gave you the two big GPU ideas — warps and latency-hiding. This lesson turns them into the two **measurable** quantities that dominate kernel performance in practice: **occupancy** (do you have enough warps resident to hide HBM latency?) and **coalescing** (does each warp memory instruction touch memory efficiently?). Most "my kernel is 10× slow" mysteries reduce to one of these two.

Both are, at heart, T0 ideas reincarnated on the GPU: occupancy is your I/O-bound thread-pool sizing rule, and coalescing is the 64-byte cache-line discipline at warp scale. If T0 made sense, this lesson is two small translations.`,
    },
    {
      type: 'prose',
      md: `## Occupancy: warps in residence

An SM can host a hardware-limited number of warps (64 on recent NVIDIA parts). How many *actually* fit — the **occupancy** — is throttled by three budgets: registers per SM (256 KiB ÷ per-thread usage), shared memory per SM (228 KiB ÷ per-block usage), and block/warp slots. A kernel using 128 registers/thread and 100 KiB shared/block might fit only 4 warps per SM: 6% occupancy. When those warps stall on HBM (~400–800 cycles), the SM idles — there is nobody else to run. Throughput craters, not because the code is wrong but because the latency has no cover.

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
        { id: 'scat', x: 30, y: 30, w: 30, h: 9, label: 'scattered', sub: 'lanes → stride 1 KiB' },
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
      predictAt: {
        step: 2,
        prompt: 'Now the lanes read addresses a kilobyte apart. Next to the coalesced load, how many memory transactions does this one instruction need?',
        options: [
          'One, with the hardware merging whichever addresses a warp gives it into one wide transaction',
          'Two, with one transaction for each half of the lanes in the warp',
          'Eight, with one transaction for each group of four neighbouring lanes',
          'Thirty-two, with one transaction for each lane and most of each segment wasted',
        ],
        correct: [3],
        why: [
          'The coalescer can only merge addresses that fall in the same 128-byte segment. A kilobyte apart, no two lanes share one.',
          'There is no half-warp rule here. Transactions are counted by distinct segments touched, and each lane touches its own.',
          'Groups of four lanes would share a segment only if their addresses were within 128 bytes of each other, and a kilobyte stride puts them far apart.',
          'Right: each lane lands in a different 128-byte segment, so the one instruction becomes 32 transactions, each fetching a segment to use 4 bytes. Delivered bandwidth falls to about a thirty-second.',
        ],
        kcs: ['t4.coalescing'],
      },
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
      taskIds: ['roof.coalesce', 'roof.occupancy', 'roof.bank'],
      config: { m: 'H100', accessPattern: 'strided', warps: 16, registers: 32, bankConflict: false },
      tasks: [
        'Run the column-walk kernel; record delivered bandwidth vs peak (~1/32).',
        'Switch to unit-stride (coalesced); confirm recovery. Then predict what a transpose through shared memory delivers, switch to it and compare.',
        'Predict the register limit of 16 warps per SM, then raise per-thread registers until occupancy drops below 25%; watch latency-hiding fail.',
        'Introduce a 32-way bank conflict in the SRAM tile, predict what +1 padding gives back, then apply it.',
      ],
      note: `Four levers, one theme: the GPU delivers peak bandwidth only to polite access patterns and enough resident warps. Layout (SoA), staging (SRAM tiles + padding), and occupancy budgeting are the whole toolbox — T4.L6 combines all three into tiled matmul.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'SM occupancy is limited by…',
          options: [
            'The warp slot count on the multiprocessor, with registers and shared memory playing no part in residency',
            'The tightest of three per-multiprocessor budgets among registers, shared memory and warp slots',
            'The second-level cache capacity, which gives each resident warp a slice for its working set',
            'The memory clock, which lets faster memory keep more loads in flight and more warps resident',
          ],
          correct: [1],
          explanation:
            'Any of the three can bind first — a fat-register kernel or a shared-hungry block caps resident warps regardless of slot count. Tuning = finding and relaxing the binding budget.',
          why: [
            'Registers and shared memory are allocated per resident warp and block. A kernel that uses a lot of either fits fewer warps than the slots allow.',
            'Right: residency is set by whichever of registers, shared memory or block and warp slots runs out first. Tuning means finding and relaxing that one.',
            'L2 is shared across SMs and is not partitioned per warp. Residency is set by per-SM resources: registers, shared memory and slots.',
            'HBM speed changes how long a stalled warp waits, not how many warps fit. The count is fixed by per-SM resources.',
          ],
          kcs: ['t4.occupancy'],
        },
        {
          q: 'A warp load where lane i reads address base + 4×i results in…',
          options: [
            '32 separate 4-byte transactions with one per lane as each lane issues its own independent load',
            'One 128-byte transaction with 32 consecutive words sharing a segment at full bandwidth',
            'A shared-memory bank conflict with 32 consecutive words mapping onto 1 bank',
            'A divergent warp with 32 lanes computing 32 different addresses in that load',
          ],
          correct: [1],
          explanation:
            'Consecutive lanes → consecutive addresses: the coalescer merges the warp\'s accesses into a single wide transaction. This is the GPU\'s native access pattern, and layouts are chosen to produce it.',
          why: [
            'The hardware inspects all 32 addresses of the warp together. Consecutive 4-byte addresses fall in one 128-byte segment and merge into a single transaction.',
            'Right: 32 consecutive 4-byte words fill one 128-byte segment, so the coalescer serves the whole warp with one transaction at full bandwidth.',
            'Consecutive words map to different banks, which is the conflict-free pattern in shared memory. Conflicts need many lanes on one bank.',
            'Divergence is about branching. Lanes may use different addresses in one instruction; all lanes still execute the same load.',
          ],
          kcs: ['t4.coalescing'],
        },
        {
          q: 'Staging a strided access through shared memory helps because…',
          options: [
            'Shared memory reorders the strided global accesses on its own, with the hardware making them wide and needing no kernel change',
            'Global reads become wide and coalesced, while the strided reads hit on-chip memory that has no coalescing rule',
            'Shared memory is backed by the second-level cache, with repeated strided reads of a tile coming from it',
            'Shared memory has more banks than global memory has channels, with strided reads spreading over more parallel units',
          ],
          correct: [1],
          explanation:
            'Separate the concerns: be polite to HBM (wide transactions), be arbitrary in SRAM. This staging pattern is the skeleton of tiled matmul and FlashAttention (T4.L6).',
          why: [
            'Nothing reorders for you. The kernel itself must issue coalesced loads into SRAM; only then can it read the scratchpad in any pattern.',
            'Right: load coalesced from HBM into SRAM, then read in any order from SRAM, where only bank conflicts matter and +1 padding fixes them.',
            'Shared memory is on-chip SRAM inside the SM and is not backed by L2. Its benefit is explicit staging, not caching.',
            'Banks are SRAM internals and do not change HBM efficiency. HBM traffic is efficient only when the loads are coalesced.',
          ],
          kcs: ['t4.coalescing', 't4.shared-memory-scratchpad'],
        },
        {
          q: 'A 32-way shared-memory bank conflict occurs when…',
          options: [
            'More than 32 warps are resident on one multiprocessor and shared memory requests queue at the memory controller',
            'The 32 lanes of a warp hit different addresses in the same bank and the access serializes 32-fold',
            'A block uses more than 1024 threads and the hardware splits it into serialized waves that reuse the banks',
            'Two kernels write one global array at once and their writes serialize on a single 128-byte cache line',
          ],
          correct: [1],
          explanation:
            'SRAM bandwidth is per-bank; different-address collisions in one bank serialize. The +1 padding trick skews strides across banks — the false-sharing lesson (T0.L4) wearing a different hat.',
          why: [
            'Bank conflicts arise between the lanes of one warp\'s own access. The number of resident warps affects occupancy, not banks.',
            'Right: SRAM bandwidth is per bank, so 32 lanes on different addresses in one bank serialize 32-fold (one shared address is a broadcast). Padding the tile rows skews the strides across banks.',
            'A block is capped at 1024 threads and a launch above that fails; it is not serialized into waves. Conflicts depend on addresses within one warp.',
            'That is contention on global memory, a different problem. A bank conflict is among lanes of one warp in shared memory.',
          ],
          kcs: ['t4.coalescing'],
        },
      ],
    },
  ],
}

export default lesson
