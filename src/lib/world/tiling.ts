/**
 * The Tiling Cube's model (docs/specs/wave-3.md §6.1, task 3a-13): one matmul tile, its slabs, the CTAs an SM
 * holds, a wave's reuse through L2, the FP8 ridge and a FlashAttention query block. The cube's levels, the
 * `tiling` generator family and RooflineSim's SMEM curve (3a-18) all read these functions, so the play, Today
 * and the sim show one set of numbers.
 *
 * Pure, products and sums only (no Math.pow, exp or log; verify-determinism covers `src/lib/world/**`). The
 * hardware comes from claims: H100 SXM HBM bandwidth and BF16 dense from the eager registry, and SMEM, SM count,
 * L2, registers and FP8 from the lazy `tiling` group, which this module registers by importing it. The FP8 rate is
 * 2 × BF16 dense, the rule RooflineSim and the roofline family use, so the app has one FP8 ridge (590.4 FLOP/B);
 * the FP8 claim (1,979 dense) agrees within 1 TFLOPS.
 *
 * THE MODEL. A Tm × Tn output tile of C walks K in slabs of depth k: A's Tm × k slab and B's k × Tn slab, `stages`
 * deep in shared memory. C stays in FP32 registers and is written once, so the tile's HBM traffic is its two slab
 * faces and its intensity is volume ÷ lit surface, 2·Tm·Tn ÷ ((Tm + Tn)·b).
 *
 * THE OPUS CHECK (§6.1). Every formula and pin of the spec's table was recomputed here:
 *   1. 128 × 128 FP16: 2·128·128 ÷ (256·2) = 64 FLOP/B.
 *   2. k = 64, 2 stages, FP16: 2·2T·64·2 = 512·T bytes ≤ 227 KiB gives T ≤ 454, so 448 (AI 224, below the BF16
 *      ridge 295.2). Its FP32 accumulators need 448²·4 B = 784 KiB of the 256 KiB register file: 0 CTAs per SM.
 *      The largest square tile with a CTA resident is 256 (exactly 256 KiB of accumulators).
 *   3. min(⌊228 KiB ÷ smem⌋, ⌊256 KiB ÷ (Tm·Tn·4)⌋): T = 128 gives min(3, 4) = 3, T = 64 gives 7, T = 256 gives 1.
 *      One guard is added to the spec's formula: slabs over the 227 KiB per-block limit cannot launch, so they
 *      give 0 even where ⌊228 KiB ÷ smem⌋ would be 1.
 *   4. 16,384³, 128 × 128 FP16, 132 CTAs one per SM: row-major touches 2 tile rows and 128 columns, 132·2·128² ÷
 *      ((2·128 + 128·128)·2) = 130.0; grouped 11 × 12 gives 132·2·128² ÷ (23·128·2) = 734.6, 5.65×. The plan's
 *      figures trace to the same model: one row alone is T·N ÷ (T + N) = 127.0, and 128 × 256 tiles grouped
 *      11 × 12 give 965.5.
 *   5. 2 × 989 TFLOPS ÷ 3.35 TB/s = 590.4 FLOP/B. A square FP8 tile's intensity is T, and an FP16 tile's T ÷ 2
 *      against a ridge half as high, so both need T ≥ 591, past the register cap of level 3.
 *   6. One query block of Br rows does Q·Kᵀ and P·V, 4·Br·N·d FLOPs, and streams K and V once and Q in and O out,
 *      b·2·d·(N + Br) bytes. Softmax's exponentials and rescales run on other units and are not counted, as
 *      FlashAttention's own FLOP counts do not count them. N = 32,768, d = 128, Br = 128, FP16: 127.5 FLOP/B,
 *      and the N × N score matrix it never writes is N²·2 B = 2 GiB per head.
 */

import { claimNumber } from '@/data/claims'
import '@/data/claims/lazy/tiling'
import { DTYPE_BYTES, GIB, KIB, MB, type Dtype } from '@/lib/items/units'

/* ------------------------------ hardware ------------------------------ */

/** Bytes per 32-bit register, and per FP32 accumulator. */
export const REG_BYTES = 4
/** Square tiles are searched in steps of this many elements (a warp-friendly multiple). */
export const TILE_STEP = 32
/** TB/s to bytes/s and TFLOPS to FLOP/s. */
const TERA = 1e12

export interface TilingHw {
  name: string
  /** shared memory an SM offers, bytes */
  smemPerSm: number
  /** shared memory one CTA may use, bytes; larger slabs cannot launch */
  smemPerBlock: number
  /** register file per SM, bytes */
  regBytesPerSm: number
  smCount: number
  /** L2 cache, bytes */
  l2Bytes: number
  /** HBM bandwidth, bytes/s */
  hbmBps: number
  /** dense BF16 tensor rate, FLOP/s */
  bf16Flops: number
  /** dense FP8 tensor rate, FLOP/s: 2 × BF16 dense */
  fp8Flops: number
}

/** The claims the cube reads, by role. */
export const TILING_CLAIM_IDS = {
  smemPerSm: 'hw.h100-sxm.smem-per-sm',
  smemPerBlock: 'hw.h100-sxm.smem-per-block',
  registers: 'hw.h100-sxm.registers-per-sm',
  smCount: 'hw.h100-sxm.sm-count',
  l2: 'hw.h100-sxm.l2',
  hbmBw: 'hw.h100-sxm.hbm-bw',
  bf16Dense: 'hw.h100-sxm.bf16-dense',
  fp8Dense: 'hw.h100-sxm.fp8-dense',
} as const

/** FP8 tensor cores run at twice the BF16 dense rate: the one rule the cube, RooflineSim and the roofline family share. */
export const FP8_OVER_BF16 = 2

const bf16 = claimNumber(TILING_CLAIM_IDS.bf16Dense) * TERA
export const H100: TilingHw = {
  name: 'H100 SXM',
  smemPerSm: claimNumber(TILING_CLAIM_IDS.smemPerSm) * KIB,
  smemPerBlock: claimNumber(TILING_CLAIM_IDS.smemPerBlock) * KIB,
  regBytesPerSm: claimNumber(TILING_CLAIM_IDS.registers) * REG_BYTES,
  smCount: claimNumber(TILING_CLAIM_IDS.smCount),
  l2Bytes: claimNumber(TILING_CLAIM_IDS.l2) * MB,
  hbmBps: claimNumber(TILING_CLAIM_IDS.hbmBw) * TERA,
  bf16Flops: bf16,
  fp8Flops: FP8_OVER_BF16 * bf16,
}

/* ------------------------------ one tile ------------------------------ */

export interface Tile {
  tm: number
  tn: number
}

/** A tile with its K loop: slab depth k, pipeline stages and the element type. */
export interface TileConfig extends Tile {
  k: number
  stages: number
  dtype: Dtype
}

export const bytesOf = (dtype: Dtype): number => DTYPE_BYTES[dtype]

/** Level 1: FLOP per HBM byte of one tile, 2·Tm·Tn ÷ ((Tm + Tn)·b). C stays in registers and is written once. */
export function tileAI(tile: Tile, dtype: Dtype): number {
  return (2 * tile.tm * tile.tn) / ((tile.tm + tile.tn) * bytesOf(dtype))
}

/** Level 2: shared memory for the A and B slabs, stages·(Tm + Tn)·k·b bytes. */
export function smemBytes(c: TileConfig): number {
  return c.stages * (c.tm + c.tn) * c.k * bytesOf(c.dtype)
}

/** FP32 accumulator bytes a tile keeps in registers, Tm·Tn·4. */
export function accumulatorBytes(tile: Tile): number {
  return tile.tm * tile.tn * REG_BYTES
}

/**
 * Level 2: the largest square tile, a multiple of `step`, whose slabs fit `budget` bytes of shared memory
 * (default: the per-block limit). Counts SMEM only: whether the registers hold its accumulators is level 3's.
 * 0 when not even one step fits.
 */
export function maxTile(k: number, stages: number, dtype: Dtype, budget = H100.smemPerBlock, step = TILE_STEP): number {
  // stages·2T·k·b ≤ budget
  const perT = stages * 2 * k * bytesOf(dtype)
  return Math.floor(budget / perT / step) * step
}

export interface Occupancy {
  /** CTAs per SM that shared memory allows (0 when the slabs exceed the per-block limit) */
  bySmem: number
  /** CTAs per SM that the register file allows, for the FP32 accumulators */
  byRegs: number
  ctas: number
  /** the resource that sets `ctas` (shared memory on a tie) */
  limit: 'smem' | 'registers'
}

/** Level 3: CTAs resident per SM, min(⌊SMEM per SM ÷ smem⌋, ⌊registers ÷ (Tm·Tn·4)⌋), with each part. */
export function occupancy(c: TileConfig, hw: TilingHw = H100): Occupancy {
  const smem = smemBytes(c)
  const bySmem = smem > hw.smemPerBlock ? 0 : Math.floor(hw.smemPerSm / smem)
  const byRegs = Math.floor(hw.regBytesPerSm / accumulatorBytes(c))
  return { bySmem, byRegs, ctas: Math.min(bySmem, byRegs), limit: bySmem <= byRegs ? 'smem' : 'registers' }
}

export function ctasPerSm(c: TileConfig, hw: TilingHw = H100): number {
  return occupancy(c, hw).ctas
}

/** The largest square tile, a multiple of `step`, with at least one CTA resident per SM: 256 on H100 at k = 64, 2 stages, FP16. */
export function maxRunnableTile(k: number, stages: number, dtype: Dtype, hw: TilingHw = H100, step = TILE_STEP): number {
  for (let t = maxTile(k, stages, dtype, hw.smemPerBlock, step); t >= step; t -= step) {
    if (ctasPerSm({ tm: t, tn: t, k, stages, dtype }, hw) >= 1) return t
  }
  return 0
}

/* ------------------------------ a wave through L2 ------------------------------ */

export type Raster = 'row' | 'grouped'

export interface WaveSpec extends TileConfig {
  /** the GEMM's output rows and columns */
  m: number
  n: number
  raster: Raster
  /** tile rows per group of the grouped raster (Triton's GROUP_SIZE_M); ignored by the row raster */
  group: number
  /** CTAs in the wave: one per SM, a persistent kernel (default: the SM count) */
  ctas?: number
}

export interface Wave {
  /** tiles in the wave */
  tiles: number
  /** distinct tile rows (A panels) and tile columns (B panels) the wave touches */
  rows: number
  cols: number
  /** the tiles' (row, column) in launch order */
  cells: readonly (readonly [number, number])[]
  /** FLOPs and HBM bytes per unit of K: they share the factor K, which cancels */
  flopsPerK: number
  bytesPerK: number
  /** FLOP per HBM byte of the wave, when its tiles share A and B slabs through L2 */
  ai: number
  /** bytes of slabs the wave keeps in flight: stages × (rows + cols) slabs */
  l2Bytes: number
  /** whether those slabs fit L2; if not, the shared-slab figure does not hold */
  fits: boolean
}

/** Tile `pid`'s (row, column) under a raster, on a grid of `rowsT` × `colsT` tiles. Grouped is Triton's mapping. */
export function tileAt(pid: number, rowsT: number, colsT: number, raster: Raster, group: number): [number, number] {
  if (raster === 'row') return [Math.floor(pid / colsT), pid % colsT]
  const inGroup = group * colsT
  const first = Math.floor(pid / inGroup) * group
  const height = Math.min(rowsT - first, group)
  const local = pid % inGroup
  return [first + (local % height), Math.floor(local / height)]
}

/**
 * Level 4: the first wave of a GEMM's tiles, one CTA per SM. Its tiles read each A panel and B panel they touch
 * once from HBM and share it through L2, so the wave's intensity is tiles·2·Tm·Tn ÷ ((rows·Tm + cols·Tn)·b).
 * Nothing survives between waves (a 16,384² A is 512 MiB, far past L2), so a wave is the unit of reuse.
 */
export function waveAI(w: WaveSpec, hw: TilingHw = H100): Wave {
  const rowsT = Math.floor(w.m / w.tm)
  const colsT = Math.floor(w.n / w.tn)
  const tiles = Math.min(w.ctas ?? hw.smCount, rowsT * colsT)
  const seenRows = new Set<number>()
  const seenCols = new Set<number>()
  const cells: [number, number][] = []
  for (let pid = 0; pid < tiles; pid++) {
    const cell = tileAt(pid, rowsT, colsT, w.raster, w.group)
    cells.push(cell)
    seenRows.add(cell[0])
    seenCols.add(cell[1])
  }
  const rows = seenRows.size
  const cols = seenCols.size
  const b = bytesOf(w.dtype)
  const flopsPerK = tiles * 2 * w.tm * w.tn
  const bytesPerK = (rows * w.tm + cols * w.tn) * b
  const l2Bytes = w.stages * (rows * w.tm + cols * w.tn) * w.k * b
  return { tiles, rows, cols, cells, flopsPerK, bytesPerK, ai: flopsPerK / bytesPerK, l2Bytes, fits: l2Bytes <= hw.l2Bytes }
}

/** One tile row's bound under the row raster, T·N ÷ (T + N) for a square FP16 tile: where the plan's ≈127 comes from. */
export function rowBound(t: number, n: number): number {
  return (t * n) / (t + n)
}

/* ------------------------------ the ridge ------------------------------ */

/** FLOP per byte at which a dtype's tensor rate meets HBM bandwidth: BF16 295.2, FP8 590.4 on H100. */
export function ridge(dtype: Dtype, hw: TilingHw = H100): number {
  return (bytesOf(dtype) === 1 ? hw.fp8Flops : hw.bf16Flops) / hw.hbmBps
}

/** The smallest whole square tile whose intensity, T ÷ b, reaches a ridge: 591 at FP8 and at FP16 on H100. */
export function tileToReach(r: number, dtype: Dtype): number {
  return Math.ceil(r * bytesOf(dtype))
}

/* ------------------------------ FlashAttention ------------------------------ */

export interface QBlock {
  /** sequence length (keys and values streamed) */
  n: number
  /** head dimension */
  d: number
  /** query rows in the block */
  br: number
  dtype: Dtype
}

/** Level 6: FLOP per HBM byte of one query block, 4·Br·N·d ÷ (b·2·d·(N + Br)). Softmax is not counted. */
export function qBlockAI(q: QBlock): number {
  return (4 * q.br * q.n * q.d) / (bytesOf(q.dtype) * 2 * q.d * (q.n + q.br))
}

/** Bytes of the N × N score matrix per head, which FlashAttention never writes: N²·b. */
export function scoreBytes(n: number, dtype: Dtype): number {
  return n * n * bytesOf(dtype)
}

/* ------------------------------ the six levels ------------------------------ */

/** A tile a debrief names as its reference choice. */
export interface ReferenceTile extends TileConfig {
  label: string
}

export interface CubeLevel {
  n: number
  id: 'count' | 'smem' | 'occupancy' | 'raster' | 'fp8' | 'flash'
  title: string
  question: string
  /** the generated item that opens the level: roofline/tile-ai for level 1, a `tiling` variant after */
  family: 'roofline' | 'tiling'
  variant: string
  kc: string
  /** the tiles the debrief names as reference choices */
  reference: readonly ReferenceTile[]
  /** the debrief: the model's reference choice and why, as the play shows it */
  debrief: string
  principle: string
}

/** The spec's scene: a square FP16 tile streaming K in 64-deep slabs, double-buffered. */
export const BASE: TileConfig = { tm: 128, tn: 128, k: 64, stages: 2, dtype: 'fp16' }
/** Level 4's GEMM: 16,384³. */
export const WAVE_GEMM = 16384
/** Level 4's grouped raster: groups of 11 tile rows, so one 132-CTA wave is 11 × 12 tiles. */
export const WAVE_GROUP = 11
/** Level 6's scene: a 32,768-token sequence, head dimension 128, query blocks of 128 rows, FP16. */
export const QBLOCK: QBlock = { n: 32768, d: 128, br: 128, dtype: 'fp16' }

/** A number with thousands separators and exactly `digits` decimals (130.0 stays 130.0), whatever the runtime's locale. */
function fmt(x: number, digits = 0): string {
  const [int, frac] = x.toFixed(digits).split('.')
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`
}
const kib = (bytes: number): string => `${fmt(bytes / KIB)} KiB`
const square = (t: number, label: string): ReferenceTile => ({ ...BASE, tm: t, tn: t, label })

function buildLevels(): CubeLevel[] {
  const smemCap = maxTile(BASE.k, BASE.stages, BASE.dtype)
  const runnable = maxRunnableTile(BASE.k, BASE.stages, BASE.dtype)
  const occ = occupancy(BASE)
  const wave = { ...BASE, m: WAVE_GEMM, n: WAVE_GEMM, group: WAVE_GROUP }
  const row = waveAI({ ...wave, raster: 'row' })
  const grouped = waveAI({ ...wave, raster: 'grouped' })
  const r8 = ridge('fp8')
  const t8 = tileToReach(r8, 'fp8')
  const regs = kib(H100.regBytesPerSm)
  return [
    {
      n: 1,
      id: 'count',
      title: 'Count the cube',
      question: 'A Tm × Tn output tile streams K in slabs: how many FLOPs does it do per byte it reads from HBM?',
      family: 'roofline',
      variant: 'tile-ai',
      kc: 't4.tiling-intensity',
      reference: [square(BASE.tm, '128 × 128 FP16')],
      debrief: `A 128 × 128 FP16 tile does 2·128·128 FLOPs per step of K and reads 128 + 128 values of 2 bytes: ${fmt(tileAI(BASE, BASE.dtype))} FLOP/B, T ÷ 2. C stays in registers and is written once, so it is not in the count.`,
      principle: 'Intensity is volume ÷ lit surface: a bigger tile does more work per byte it reads.',
    },
    {
      n: 2,
      id: 'smem',
      title: 'The SMEM budget',
      question: 'What is the largest square tile whose A and B slabs fit shared memory?',
      family: 'tiling',
      variant: 'smem-fit',
      kc: 't4.shared-memory-scratchpad',
      reference: [square(smemCap, `${smemCap} × ${smemCap}, the SMEM limit`), square(runnable, `${runnable} × ${runnable}, the largest that runs`)],
      debrief: `At k = 64 with 2 stages, ${smemCap} × ${smemCap} is the largest square tile whose slabs fit ${kib(H100.smemPerBlock)} (${kib(smemBytes(square(smemCap, '')))}, intensity ${fmt(tileAI(square(smemCap, ''), BASE.dtype))}). Shared memory allows it, but the register cap forbids it: its FP32 accumulators need ${kib(accumulatorBytes(square(smemCap, '')))} against a ${regs} register file, so no CTA can hold it. The largest square tile that runs is ${runnable} × ${runnable}.`,
      principle: 'Shared memory bounds the slabs; the register file bounds the tile.',
    },
    {
      n: 3,
      id: 'occupancy',
      title: 'Occupancy',
      question: 'How many CTAs of this tile can one SM hold at once?',
      family: 'tiling',
      variant: 'ctas-per-sm',
      kc: 't4.occupancy',
      reference: [square(BASE.tm, '128 × 128, 3 per SM'), square(BASE.tm / 2, '64 × 64'), square(BASE.tm * 2, '256 × 256')],
      debrief: `A 128 × 128 tile with two 64-deep FP16 stages uses ${kib(smemBytes(BASE))} of shared memory, so ${occ.bySmem} fit in ${kib(H100.smemPerSm)}; its accumulators take ${kib(accumulatorBytes(BASE))} of registers, which would allow ${occ.byRegs}. ${occ.ctas} CTAs per SM, set by shared memory. 64 × 64 gives ${ctasPerSm(square(BASE.tm / 2, ''))} with less work per byte; 256 × 256 gives ${ctasPerSm(square(BASE.tm * 2, ''))}, with nothing to hide its latency.`,
      principle: 'Occupancy trades tile size against the warps that hide memory latency.',
    },
    {
      n: 4,
      id: 'raster',
      title: 'Raster order and L2',
      question: 'One wave of 132 CTAs, one per SM: how many FLOPs per HBM byte when its tiles share slabs through L2?',
      family: 'tiling',
      variant: 'raster-ai',
      kc: 't4.raster-l2-reuse',
      reference: [square(BASE.tm, '128 × 128, grouped 11 × 12')],
      debrief: `On a 16,384³ GEMM, a row-major wave of ${row.tiles} tiles touches ${row.rows} tile rows and ${row.cols} columns: ${fmt(row.ai, 1)} FLOP/B. Grouped ${grouped.rows} × ${grouped.cols}, a wave of as many tiles touches ${grouped.rows + grouped.cols} panels: ${fmt(grouped.ai, 1)} FLOP/B, ${fmt(grouped.ai / row.ai, 1)}× from raster order alone. Both waves' slabs fit the ${fmt(H100.l2Bytes / MB)} MB L2.`,
      principle: 'Launch order decides which slabs L2 can share: a squarer wave reads fewer panels.',
    },
    {
      n: 5,
      id: 'fp8',
      title: 'FP8',
      question: 'Where is the ridge at FP8, and which square tile would reach it alone?',
      family: 'tiling',
      variant: 'fp8-ridge',
      kc: 't4.ridge-point',
      reference: [{ ...BASE, tm: t8, tn: t8, dtype: 'fp8', label: `${t8} × ${t8} FP8, arithmetic only` }],
      debrief: `FP8 doubles the tensor rate, so the ridge moves from ${fmt(ridge('bf16'), 1)} to ${fmt(r8, 1)} FLOP/B. A square FP8 tile's intensity is T, so a lone tile needs T ≥ ${t8}, as at FP16. That is arithmetic only: its accumulators would need ${kib(accumulatorBytes({ tm: t8, tn: t8 }))}, past the register cap of ${regs}, so no single CTA tile reaches either ridge on H100. Reaching it takes reuse across CTAs through L2 (level 4).`,
      principle: 'A faster roof needs more reuse, and past one tile, reuse comes from L2.',
    },
    {
      n: 6,
      id: 'flash',
      title: 'FlashAttention',
      question: 'One query block streams K and V once: how many FLOPs per HBM byte, and how big is the score matrix it never writes?',
      family: 'tiling',
      variant: 'qblock-ai',
      kc: 't4.flashattention-blocking',
      reference: [square(QBLOCK.br, '128-row query block, a 128 × 128 Q·Kᵀ tile')],
      debrief: `At N = 32,768, d = 128, a 128-row query block does 4·Br·N·d FLOPs over K and V read once: ${fmt(qBlockAI(QBLOCK), 1)} FLOP/B in FP16. Written out, the N × N score matrix would be ${fmt(scoreBytes(QBLOCK.n, QBLOCK.dtype) / GIB)} GiB per head; FlashAttention keeps one block of it on chip at a time and never writes it.`,
      principle: 'FlashAttention is cache blocking: keep the N × N scores on chip and stream K and V once.',
    },
  ]
}

// pure, so a module that reads only the formulas (the `tiling` family's chunk) leaves the debrief text out
export const CUBE_LEVELS: readonly CubeLevel[] = /* @__PURE__ */ buildLevels()

/** The plan's two level-4 figures, traced to this model (§6.1): one row's bound, and 128 × 256 tiles grouped 11 × 12. */
export const PLAN_FIGURES = {
  rowBound: /* @__PURE__ */ rowBound(BASE.tm, WAVE_GEMM),
  grouped128x256: /* @__PURE__ */ waveAI({ ...BASE, tn: 2 * BASE.tn, m: WAVE_GEMM, n: WAVE_GEMM, raster: 'grouped', group: WAVE_GROUP }).ai,
}

/** The simplifications the play states in a callout (games-3d.md: "label the simplifications"). */
export const SIMPLIFICATIONS: readonly string[] = [
  'No shared-memory bank conflicts.',
  'The 1 KiB of shared memory CUDA reserves per CTA is ignored.',
  'Registers hold only the FP32 accumulators, with no allocation granularity.',
  'A wave is the first 132 tiles in launch order, one CTA per SM, as a persistent kernel runs.',
  'Softmax work in FlashAttention is not counted as FLOPs.',
]

/** The seed of the cube's practice items, one per level (the band checks them): a grouped wave, the H100 ridge and a 4-CTA tile. */
export const CUBE_PRACTICE_SEED = 1033
/** The staircase level the play's items are drawn at: independent, one KC. */
export const CUBE_ITEM_LEVEL = 2
