import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't4.l6',
  slug: 'matmul-tiling',
  trackId: 't4',
  index: 6,
  title: 'Matmul, Tiling & FlashAttention as Cache Blocking',
  minutes: 30,
  hook: 'The interactive tiling visualization: how blocking turns a memory-bound matmul into a compute monster — and why FlashAttention is the same trick.',
  exercise: 'sim',
  simId: 'sim-roofline',
  verifiedAt: '2026-10',
  blocks: [
    {
      type: 'prose',
      md: `Matrix multiplication is the most important kernel in the world right now — a transformer is, numerically, matmuls with garnish. It is also the perfect capstone for this track, because writing a *fast* one forces you to use every lesson so far: the hierarchy (T0), strides (T0.L3), SRAM staging and coalescing (T4.L4), roofline arithmetic (T4.L3). And the punchline is beautiful: **FlashAttention, the algorithm that made long-context LLMs practical, is not an attention trick — it is a cache-blocking trick.** This lesson earns you that sentence.

Naive matmul \`C = A × B\` (N×N): for each of N² outputs, dot a row of A with a column of B — N multiply-adds, walking a full row and a full column per output. Total: \`2N³\` FLOPs against \`~2N³\` elements *touched* (a row and a column per output) if you naively re-read from DRAM: that is \`1/b\` FLOP/byte for \`b\`-byte elements, **≈ 0.5 FLOP/byte at FP16** — deep in bandwidth-bound territory. On an H100 (ridge ≈ 295 FLOP/byte at FP16, T4.L3) HBM can feed only 0.5 × 3.35 TB/s ≈ 1.7 TFLOP/s of the ~989 TFLOP/s the tensor cores could do: about **590×** short of the compute roof. The fix is the oldest trick in numerical computing: **tiling**.`,
    },
    {
      type: 'prose',
      md: `## Tiling: block the problem to fit the fast tier

The insight: a \`T × T\` output tile \`C_tile\` only needs a \`T × K\` slab of A and a \`K × T\` slab of B. Choose \`T\` and \`K\` so those slabs fit in **shared memory** (T4.L2's 228 KB scratchpad), and the algorithm becomes: cooperatively load both slabs (coalesced, T4.L4), barrier, then compute from SRAM at ~20–30× HBM's bandwidth, accumulating into registers. March the slabs along the K dimension and repeat.

Now count bytes. Marching K steps, the tile does \`2·T²·K\` FLOPs and loads \`2·T·K\` elements — \`2·T·K·b\` bytes at \`b\` bytes each — so intensity is \`T / b\`: **\`T/2\` FLOP/byte at FP16**. With \`T = 128\` each element of A and B loaded from HBM is reused **T times** from SRAM, and intensity jumps from 0.5 (the naive case is just \`T = 1\`) to 64 FLOP/byte — a 128× lift — and keeps growing linearly with \`T\` toward the H100's ridge (~295 F/B at FP16, reached near \`T ≈ 590\` on HBM traffic alone; real kernels close the gap with L2 reuse across blocks). **Same 2N³ FLOPs, same math, far more delivered throughput.** Tiling didn't change the algorithm; it changed which tier of the hierarchy the algorithm *lives* in.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — one output tile, fed by SRAM slabs',
      height: 52,
      nodes: [
        { id: 'a', x: 2, y: 6, w: 20, h: 26, label: 'A (HBM)', sub: 'N×N' },
        { id: 'aslab', x: 30, y: 6, w: 14, h: 26, label: 'A slab', sub: 'T×K → SRAM', color: '#A78BFA' },
        { id: 'b', x: 2, y: 38, w: 42, h: 12, label: 'B (HBM)', sub: 'N×N' },
        { id: 'bslab', x: 52, y: 38, w: 14, h: 12, label: 'B slab', sub: 'K×T → SRAM', color: '#A78BFA' },
        { id: 'ctile', x: 56, y: 6, w: 16, h: 16, label: 'C tile', sub: 'T×T in regs', color: '#3EF2A4' },
        { id: 'tc', x: 80, y: 8, w: 18, h: 12, label: 'tensor cores', sub: 'MMA from SRAM' },
      ],
      edges: [
        { from: 'a', to: 'aslab', label: 'coalesced load' },
        { from: 'b', to: 'bslab', label: 'coalesced load' },
        { from: 'aslab', to: 'ctile' },
        { from: 'bslab', to: 'ctile' },
        { from: 'ctile', to: 'tc' },
      ],
      steps: [
        { caption: 'Goal: compute a T×T tile of C. Instead of streaming whole rows/columns from HBM per output element (AI ≈ 0.5 at FP16), stage slabs through shared memory.', active: ['a', 'b'] },
        { caption: 'The block cooperatively loads a T×K slab of A and a K×T slab of B into SRAM — wide, coalesced transactions, every byte fetched once.', active: ['aslab', 'bslab'], edges: ['a->aslab', 'b->bslab'] },
        { caption: 'Compute: each SRAM element is read T times from the fast tier (AI = T/2 at FP16). Barrier, march K, repeat. HBM traffic collapses by a factor of T; tensor cores stay fed.', active: ['ctile', 'tc'], edges: ['aslab->ctile', 'bslab->ctile'] },
      ],
    },
    {
      type: 'code',
      filename: 'tiled_matmul.wgsl — the skeleton (abridged)',
      lang: 'rust',
      code: `var<workgroup> As: array<f32, 128 * 16>;   // A slab: 128×16
var<workgroup> Bs: array<f32, 16 * 128>;    // B slab: 16×128

@compute @workgroup_size(16, 8)
fn main(@builtin(local_invocation_id) lid: vec3<u32>,
        @builtin(workgroup_id) wid: vec3<u32>) {
    var acc: array<f32, 16>;                // per-thread accumulators (regs)
    for (var k0 = 0u; k0 < N; k0 += 16u) {
        // 1. cooperative, COALESCED load of both slabs → SRAM
        load_tile(&As, A, wid.y, k0);
        load_tile(&Bs, B, k0, wid.x);
        workgroupBarrier();
        // 2. compute from SRAM: every byte reused ~T times
        for (var k = 0u; k < 16u; k++) {
            accumulate_from_sram(&acc, &As, &Bs, lid, k);
        }
        workgroupBarrier();
    }
    store_tile(C, acc, wid);                // one HBM write per element
}`,
      chips: ['AI: 0.5 → T/2 (FP16)', 'HBM traffic ÷ T', 'barriers bracket the tile'],
    },
    {
      type: 'prose',
      md: `## FlashAttention: the same trick, one softmax harder

Standard attention materializes the \`N × N\` score matrix \`S = QKᵀ\` in HBM — for a 128k-context model that matrix is *terabytes*-scale traffic and tens of GB of capacity. The 2022 FlashAttention paper (Tri Dao et al.) noticed two things: (1) attention is three matmul-shaped ops around a softmax, and (2) the softmax denominator is just a **reduction** (T4.L5), which can be computed *incrementally*. So: tile Q, K, V into SRAM-sized blocks; for each KV block, compute the partial scores *in SRAM*, update the softmax statistics **online** (rescaling the running max and sum — the "online softmax"), and accumulate the output — never writing the N×N matrix to HBM at all.

The result: the extra memory drops from \`O(N²)\` to \`O(N)\`, HBM accesses fall from \`Θ(Nd + N²)\` to \`Θ(N²d²/M)\` (head dimension \`d\`, SRAM size \`M\`, Theorem 2 of the paper), and the kernel gets *faster* despite doing extra rescaling math — because it was bandwidth-bound: the speedup comes from fewer HBM accesses (about 9× fewer in Dao et al., Fig. 2: 40.3 GB vs 4.4 GB on GPT-2 medium attention), while the memory saving is up to 20× and grows with sequence length N. **FlashAttention is cache blocking applied to attention.** The transformer papers gave you the math; the systems move was recognizing the roofline regime and tiling the problem to fit SRAM. (This is also why "flash" kernels exist for everything now — it's a general recipe: fuse, tile, keep the working set in the fast tier.)`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You've done this before, at service scale: the naive join reads the whole table per row (O(N²) I/O); the **block nested-loop join** stages both tables in page-size chunks and reuses each chunk from the buffer pool — a database tiling, exact same arithmetic-intensity argument. And online softmax is your **running mean/variance** (Welford) wearing softmax clothes: fold a streaming reduction into the loop so you never store the intermediate. Systems ideas don't retire; they change hats.`,
    },
    {
      type: 'callout',
      variant: 'info',
      md: `Why not just bigger tiles forever? SRAM is 228 KB/SM and registers 256 KB/SM — tile size trades against **occupancy** (T4.L4): a giant tile leaves room for few warps, and latency-hiding suffers. Real GEMM libraries (cuBLAS, CUTLASS) auto-tune tile shapes per GPU generation. The craft is balancing reuse (AI) against residency (occupancy) — two of this track's lessons pulling in opposite directions, as physics intended.`,
    },
    {
      type: 'prose',
      md: `## In the simulator

You'll drag the tile size across a live matmul: watch HBM traffic fall \`∝ 1/T\`, watch arithmetic intensity climb the roofline toward the compute roof, and then push tiles too big and watch occupancy collapse the gains. Then flip to the attention view and watch the N×N score matrix vanish as online-softmax tiling kicks in.`,
    },
    {
      type: 'exercise',
      simId: 'sim-roofline',
      machine: 'roofline',
      title: 'Tiling playground: matmul to FlashAttention',
      tasks: [
        'Start at the smallest tile, T = 16: read AI = T/2 = 8 F/B and the HBM traffic. Naive matmul is the T = 1 case, 0.5 F/B at FP16, below the slider, so compute it by hand and compare.',
        'Sweep tile T = 16 → 128: plot HBM traffic (∝ 1/T) and delivered TFLOPs; locate the compute roof.',
        'Oversize the tile until shared memory limits occupancy; observe the U-shaped performance curve.',
        'Toggle the attention view: naive (materialize S) vs flash (online softmax); compare HBM bytes at 32k context.',
      ],
      note: `The U-curve is the whole craft: too small a tile → bandwidth starves; too big → occupancy starves. And the attention comparison is the industry's favorite before/after: same math, several times fewer HBM accesses (about 9× in Dao et al., Fig. 2) — the definition of a systems win.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Tiling raises matmul performance primarily by…',
          options: [
            'Reducing the arithmetic count with blocking that lets the kernel skip tile products of little value',
            'Raising arithmetic intensity with each staged tile element reused many times and memory traffic falling in proportion',
            'Spreading the multiply over more multiprocessors with small tiles creating more thread blocks and more hardware in use',
            'Running the tensor cores at a higher clock with data staged on-chip letting the cores run faster than when fed from memory',
          ],
          correct: [1],
          explanation:
            'The 2N³ FLOPs are fixed; what changes is which tier feeds them. Reuse from the fast tier is the whole game — the roofline, weaponized.',
          why: [
            'Tiling does exactly the same 2N³ FLOPs. Only the number of bytes fetched from HBM changes.',
            'Right: the FLOPs are fixed, but each element staged into SRAM is reused about T times. Intensity is T/2 at FP16, so the kernel rides up toward the compute roof.',
            'A naive kernel can already launch blocks on every SM. The limit was bytes per FLOP, not SM count, and smaller tiles lower reuse.',
            'Clock speed is fixed by the part and its power limit. Tiling feeds the existing compute better; it does not change the clock.',
          ],
        },
        {
          q: 'FlashAttention\'s core insight is that…',
          options: [
            'Most attention scores are near zero and keys can be dropped from the score matrix for an approximate result',
            'The score matrix does not need to live in global memory and an online softmax folds in each tile',
            'Recent chips have dedicated attention units that compute the whole operation in one instruction',
            'Quantizing the score matrix to four bits is lossless for softmax and the scores fit in a quarter of the space',
          ],
          correct: [1],
          explanation:
            'It is a memory-traffic optimization, not an approximation: exact attention that never writes the N×N matrix to HBM. HBM accesses fall from Θ(Nd + N²) to Θ(N²d²/M), and the extra memory is O(N), not O(N²) — cache blocking plus a streaming reduction (T4.L5) for the softmax.',
          why: [
            'FlashAttention is exact, not approximate: every score is computed. The saving comes from where the scores live (SRAM, not HBM), not from dropping any.',
            'Right: exact attention that tiles Q, K and V into SRAM and updates the softmax online, so the N×N matrix is never written to HBM.',
            'GPUs have no single attention instruction. FlashAttention runs on ordinary tensor-core matmul and SIMT code, restructured to cut HBM traffic.',
            'FlashAttention does not quantize the scores; its output matches standard attention up to floating-point rounding. It never stores the matrix at all.',
          ],
        },
        {
          q: 'Why can\'t tiles simply be as large as possible?',
          options: [
            'The compiler rejects shared memory arrays above a few kilobytes and a larger tile fails to compile',
            'Big tiles use up the per-multiprocessor memory and registers and leave too few resident warps to hide latency',
            'Bigger tiles need more global memory transactions per output and lose coalescing across memory segments',
            'Larger tiles make bank conflicts unavoidable and map more lanes onto the same banks as they grow',
          ],
          correct: [1],
          explanation:
            'Reuse (favors big T) fights residency (favors small footprint). cuBLAS/CUTLASS tune per-GPU shapes precisely because the optimum sits in the middle of the U.',
          why: [
            'Blocks can opt in to well over 48 KB (about 227 KB on H100), so a few-KB cap is false. The real constraint is per-SM residency: big tiles leave room for fewer blocks.',
            'Right: reuse favors big tiles, but each tile claims SRAM and registers, so fewer warps stay resident and latency hiding suffers.',
            'Bigger tiles do less HBM traffic per FLOP (it falls as 1/T), and slab loads stay coalesced. The cost is on-chip residency, not HBM efficiency.',
            'Bank conflicts depend on access stride, and padding fixes them at any tile size. They are not what limits tile growth.',
          ],
        },
        {
          q: 'The closest database analog to matmul tiling is…',
          options: [
            'A covering index that answers a query from index entries and skips the base table pages',
            'The block nested-loop join that chunks both inputs to fit the buffer pool and reuses each chunk',
            'Query memoization that caches the output of an expensive subquery and lets identical requests skip recomputation',
            'An index nested-loop join that replaces each inner scan with a logarithmic B-tree probe per outer row',
          ],
          correct: [1],
          explanation:
            'Same move at a different layer: bound the working set to the fast tier and multiply reuse. It\'s also Spark\'s broadcast-join decision and Welford\'s streaming variance — one pattern, many hats.',
          why: [
            'A covering index avoids table lookups by storing the needed columns. It does not reorder a loop nest so each fetched block serves many operations.',
            'Right: the block nested-loop join loads chunks of both inputs into the buffer pool and reuses each chunk, the same reuse argument as SRAM tiles.',
            'Memoization stores results to skip repeated work. Tiling still computes every product; it reorders them so each loaded element serves many.',
            'Each probe cuts the rows touched, but pages are still re-read per outer row. Tiling keeps a chunk resident and reuses it.',
          ],
        },
      ],
    },
  ],
}

export default lesson
