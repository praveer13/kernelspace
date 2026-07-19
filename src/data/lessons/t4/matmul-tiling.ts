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
  blocks: [
    {
      type: 'prose',
      md: `Matrix multiplication is the most important kernel in the world right now — a transformer is, numerically, matmuls with garnish. It is also the perfect capstone for this track, because writing a *fast* one forces you to use every lesson so far: the hierarchy (T0), strides (T0.L3), SRAM staging and coalescing (T4.L4), roofline arithmetic (T4.L3). And the punchline is beautiful: **FlashAttention, the algorithm that made long-context LLMs practical, is not an attention trick — it is a cache-blocking trick.** This lesson earns you that sentence.

Naive matmul \`C = A × B\` (N×N): for each of N² outputs, dot a row of A with a column of B — N multiply-adds, walking a full row and a full column per output. Total: \`2N³\` FLOPs against \`~N³\` elements *touched* if you naively re-read from DRAM: arithmetic intensity ≈ 2 FLOP/byte — deep in bandwidth-bound territory. The GPU's tensor cores could do this 100× faster than its memory can feed it. The fix is the oldest trick in numerical computing: **tiling**.`,
    },
    {
      type: 'prose',
      md: `## Tiling: block the problem to fit the fast tier

The insight: a \`T × T\` output tile \`C_tile\` only needs a \`T × K\` slab of A and a \`K × T\` slab of B. Choose \`T\` and \`K\` so those slabs fit in **shared memory** (T4.L2's 228 KB scratchpad), and the algorithm becomes: cooperatively load both slabs (coalesced, T4.L4), barrier, then compute from SRAM at ~20–30× HBM's bandwidth, accumulating into registers. March the slabs along the K dimension and repeat.

Now count bytes: with \`T = 128\`, each element of A and B loaded from HBM is reused **T times** from SRAM before being discarded. Arithmetic intensity jumps from ~2 to ~\`T\` FLOP/byte — comfortably right of the H100's ridge (~295 F/B at FP16 with \`T\` large enough). **Same 2N³ FLOPs, same math, ~100× delivered throughput.** Tiling didn't change the algorithm; it changed which tier of the hierarchy the algorithm *lives* in.`,
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
        { caption: 'Goal: compute a T×T tile of C. Instead of streaming whole rows/columns from HBM per output element (AI ≈ 2), stage slabs through shared memory.', active: ['a', 'b'] },
        { caption: 'The block cooperatively loads a T×K slab of A and a K×T slab of B into SRAM — wide, coalesced transactions, every byte fetched once.', active: ['aslab', 'bslab'], edges: ['a->aslab', 'b->bslab'] },
        { caption: 'Compute: each SRAM element is read T times from the fast tier (AI ≈ T). Barrier, march K, repeat. HBM traffic collapses by a factor of T; tensor cores stay fed.', active: ['ctile', 'tc'], edges: ['aslab->ctile', 'bslab->ctile'] },
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
      chips: ['AI: 2 → ~T', 'HBM traffic ÷ T', 'barriers bracket the tile'],
    },
    {
      type: 'prose',
      md: `## FlashAttention: the same trick, one softmax harder

Standard attention materializes the \`N × N\` score matrix \`S = QKᵀ\` in HBM — for a 128k-context model that matrix is *terabytes*-scale traffic and tens of GB of capacity. The 2022 FlashAttention paper (Tri Dao et al.) noticed two things: (1) attention is three matmul-shaped ops around a softmax, and (2) the softmax denominator is just a **reduction** (T4.L5), which can be computed *incrementally*. So: tile Q, K, V into SRAM-sized blocks; for each KV block, compute the partial scores *in SRAM*, update the softmax statistics **online** (rescaling the running max and sum — the "online softmax"), and accumulate the output — never writing the N×N matrix to HBM at all.

The result: HBM traffic drops from \`O(N²)\` to \`O(N)\`-ish, memory capacity stops scaling quadratically, and the kernel gets *faster* despite doing extra rescaling math — because it was bandwidth-bound, and bytes dropped 10–20×. **FlashAttention is cache blocking applied to attention.** The transformer papers gave you the math; the systems move was recognizing the roofline regime and tiling the problem to fit SRAM. (This is also why "flash" kernels exist for everything now — it's a general recipe: fuse, tile, keep the working set in the fast tier.)`,
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
      title: 'Tiling playground: matmul to FlashAttention',
      tasks: [
        'Run naive matmul (N=4096): measure AI ≈ 2 F/B and the resulting bandwidth wall.',
        'Sweep tile T = 16 → 128: plot HBM traffic (∝ 1/T) and delivered TFLOPs; locate the compute roof.',
        'Oversize the tile until shared memory limits occupancy; observe the U-shaped performance curve.',
        'Toggle the attention view: naive (materialize S) vs flash (online softmax); compare HBM bytes at 32k context.',
      ],
      note: `The U-curve is the whole craft: too small a tile → bandwidth starves; too big → occupancy starves. And the attention comparison is the industry's favorite before/after: same math, 10–20× fewer HBM bytes — the definition of a systems win.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Tiling raises matmul performance primarily by…',
          options: [
            'Reducing the FLOP count',
            'Raising arithmetic intensity: each element staged into SRAM is reused ~T times, so HBM traffic drops ∝ 1/T and the kernel moves from bandwidth-bound to compute-bound',
            'Using more SMs',
            'Increasing clock frequency',
          ],
          correct: [1],
          explanation:
            'The 2N³ FLOPs are fixed; what changes is which tier feeds them. Reuse from the fast tier is the whole game — the roofline, weaponized.',
        },
        {
          q: 'FlashAttention\'s core insight is that…',
          options: [
            'Attention can skip the softmax',
            'The N×N score matrix never needs to live in HBM: tile Q/K/V into SRAM and fold the softmax denominator in incrementally (online softmax) while accumulating the output',
            'GPUs have special attention units',
            'Quantizing scores to INT4 is lossless',
          ],
          correct: [1],
          explanation:
            'It is a memory-traffic optimization, not an approximation: exact attention with O(N) HBM traffic instead of O(N²) — cache blocking plus a streaming reduction (T4.L5) for the softmax.',
        },
        {
          q: 'Why can\'t tiles simply be as large as possible?',
          options: [
            'The compiler rejects large arrays',
            'Large tiles consume the SRAM/register budget per SM, crushing occupancy — too few resident warps to hide latency, so performance falls again (the U-curve)',
            'Bigger tiles cause bank conflicts',
            'HBM refuses large transactions',
          ],
          correct: [1],
          explanation:
            'Reuse (favors big T) fights residency (favors small footprint). cuBLAS/CUTLASS tune per-GPU shapes precisely because the optimum sits in the middle of the U.',
        },
        {
          q: 'The closest database analog to matmul tiling is…',
          options: [
            'A covering index',
            'The block nested-loop join: chunk both inputs to fit the buffer pool and reuse each chunk from memory instead of re-reading per row',
            'Query memoization',
            'Write-ahead logging',
          ],
          correct: [1],
          explanation:
            'Same move at a different layer: bound the working set to the fast tier and multiply reuse. It\'s also Spark\'s broadcast-join decision and Welford\'s streaming variance — one pattern, many hats.',
        },
      ],
    },
  ],
}

export default lesson
