/**
 * The Tiling Cube's session (docs/specs/wave-3.md §6.3, task 3b-01): the pure model the components drive, so the
 * rules run under `bun test` (tests/plays/tiling-cube.test.ts) and a component keeps none of its own.
 *
 * A session is six levels. Each level is predict → explore → check → debrief:
 *   1. Predict. The level's opening item on the session's seed, as an estimate within a factor of 2 (a `predict`
 *      event, src `play`), with no verdict yet.
 *   2. Explore. Steppers (never a drag, WCAG 2.5.7) move the tile and the rest of the scene; the three face views and
 *      the DOM table read the same `Explore` state through the cube's model (`src/lib/world/tiling.ts`).
 *   3. Check. The same item as an exact question, graded with its worked steps (an `item` event, src `play`).
 *   4. Debrief. The model's reference choice, the prediction's error, one line of principle.
 * The closing debrief lists the six, and only then is the play recorded: `recordPlay {phase 'play', turns 6,
 * survived: predictions within a factor of 2, ghostSurvived 6, levels}`.
 *
 * THE CONTROLS NEVER OFFER A SHAPE THE MODEL REFUSES. `waveAI` and `tileAt` throw a RangeError for a GEMM smaller than
 * one tile and for a grouped raster whose group is not a whole number of at least 1. Every number control steps along
 * a ladder of whole numbers, and `normalize` lifts the GEMM to hold a whole tile after every step, so no control
 * reaches such a shape (a test drives every control to both ends).
 *
 * The session opens on the practice seed, which the band checks (`CUBE_PRACTICE_SEED`; 200 of 300 sampled seeds are
 * out of band), and "new numbers" draws a seed that passes the same band. The reference model is not hidden: it is
 * the cube's arithmetic, and the learner meets it after predicting.
 */

import roofline from '@/lib/items/families/roofline'
import tiling from '@/lib/items/families/tiling'
import { seedFor } from '@/lib/items/core'
import type { ItemResult } from '@/lib/items/play'
import { gradeResponse } from '@/lib/items/grade'
import type { AnswerSpec, Gen, Instance } from '@/lib/items/types'
import { GIB, KIB, MB, MIB, type Dtype } from '@/lib/items/units'
import type { ItemData, ItemResponse, PlayResult } from '@/lib/ledger/types'
import { byId } from '@/data/claims'
import { checkCubeBand, levelInstance } from '@/lib/world/bands/tiling-cube'
import {
  BASE,
  CUBE_LEVELS,
  CUBE_PRACTICE_SEED,
  H100,
  WAVE_GEMM,
  WAVE_GROUP,
  accumulatorBytes,
  bytesOf,
  occupancy,
  qBlockAI,
  ridge,
  scoreBytes,
  smemBytes,
  tileAI,
  tileToReach,
  waveAI,
  type CubeLevel,
  type Occupancy,
  type Raster,
  type Wave,
} from '@/lib/world/tiling'

export const CUBE_PLAY_ID = 'tiling-cube'
export const LEVEL_COUNT = 6
/** A prediction within this factor of the model's value counts as right (the same factor every `predict` event uses). */
export const RIGHT_FACTOR = 2
/** The lesson the play lives in: the events carry it as `lessonId`. */
export const CUBE_LESSON = 't4.l6'
/** Seeds tried for new numbers before the practice seed stands in. */
const FRESH_TRIES = 64

/** The family each level's item comes from, by its `CubeLevel.family`. */
const FAMILIES: Record<CubeLevel['family'], Gen> = { roofline, tiling }
export const genOf = (level: CubeLevel): Gen => FAMILIES[level.family]

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** A number with thousands separators and exactly `digits` decimals (130.0 stays 130.0), whatever the runtime's locale. */
export function fixed(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return String(x)
  const [int, frac] = x.toFixed(digits).split('.')
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`
}
const kibText = (bytes: number): string => `${fixed(bytes / KIB, bytes % KIB === 0 ? 0 : 1)} KiB`
const dtypeName = (d: Dtype): string => d.toUpperCase()
const times = (x: number): string => `${fixed(x, 1)}×`

/* ------------------------------------------------------------------ */
/* The explorer's state and controls                                   */
/* ------------------------------------------------------------------ */

export type NumberControl = 'tm' | 'tn' | 'k' | 'stages' | 'm' | 'n' | 'group' | 'seq' | 'd' | 'br'
export type ChoiceControl = 'dtype' | 'raster'
/** The element types the cube prices: FP8 against the FP8 ridge, FP16 against the BF16 one (the same tensor rate on H100). */
export type CubeDtype = 'fp8' | 'fp16'
export type ControlId = NumberControl | ChoiceControl

/** The scene the steppers move. Fields a level does not use sit at their defaults. */
export interface Explore {
  tm: number
  tn: number
  /** slab depth */
  k: number
  stages: number
  dtype: CubeDtype
  /** the GEMM's output rows and columns (level 4) */
  m: number
  n: number
  raster: Raster
  /** tile rows per group of the grouped raster: a whole number of at least 1 */
  group: number
  /** FlashAttention's sequence length, head dimension and query-block rows (level 6) */
  seq: number
  d: number
  br: number
  /** Level 2 only: a hypothetical shared-memory budget per CTA, KiB; absent means the H100's per-block limit. */
  budgetKib?: number
  /** Level 5 only: a hypothetical chip (dense BF16 TFLOP/s, HBM TB/s) and the share a benchmark sustains of each. */
  chip?: { bf16Tflops: number; hbmTBs: number; fcPct: number; fbPct: number }
}

const range = (lo: number, hi: number, by = 1): number[] => Array.from({ length: Math.floor((hi - lo) / by) + 1 }, (_, i) => lo + i * by)

/** Tile sides: fine steps while the tile is small, coarser as it grows. 448 (level 2) and 256 are on it. */
const TILE_LADDER: readonly number[] = [...range(8, 64, 8), ...range(80, 256, 16), ...range(288, 512, 32), ...range(576, 1024, 64)]
const GEMM_LADDER: readonly number[] = [1024, 1536, 2048, 3072, 4096, 6144, 8192, 12288, 16384, 24576, 32768]

/** The whole numbers each number control steps along. Group heights are whole numbers from 1: 0 is not on the ladder. */
export const LADDERS: Readonly<Record<NumberControl, readonly number[]>> = {
  tm: TILE_LADDER,
  tn: TILE_LADDER,
  k: [16, 32, 48, 64, 96, 128, 192, 256],
  stages: range(1, 8),
  m: GEMM_LADDER,
  n: GEMM_LADDER,
  group: [...range(1, 16), 20, 24, 32],
  seq: [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072],
  d: [64, 128, 256],
  br: [16, 32, 64, 128, 256],
}

/** How many ladder notches a coarse step (Page Up, Page Down) moves. */
export const COARSE = 4

/** The next value along a ladder from `v`, which need not be on it: `by` notches up or down, or `v` itself at the end. */
export function stepOn(ladder: readonly number[], v: number, dir: 1 | -1, by = 1): number {
  if (dir > 0) {
    const i = ladder.findIndex((x) => x > v)
    return i < 0 ? v : ladder[Math.min(ladder.length - 1, i + by - 1)]
  }
  let i = -1
  ladder.forEach((x, at) => {
    if (x < v) i = at
  })
  return i < 0 ? v : ladder[Math.max(0, i - (by - 1))]
}

/** The smallest ladder value of at least `x`, or the top of the ladder. */
const atLeast = (ladder: readonly number[], x: number): number => ladder.find((v) => v >= x) ?? ladder[ladder.length - 1]

/**
 * Keeps the scene one the model prices: a GEMM that holds at least one whole tile each way and a group height that is a
 * whole number of at least 1. Every step goes through it, so no control can reach a shape `waveAI` refuses.
 */
export function normalize(e: Explore): Explore {
  return { ...e, m: Math.max(e.m, atLeast(GEMM_LADDER, e.tm)), n: Math.max(e.n, atLeast(GEMM_LADDER, e.tn)), group: Math.max(1, Math.floor(e.group)) }
}

/** One notch (or `COARSE` notches) along a number control's ladder. */
export function stepControl(e: Explore, id: NumberControl, dir: 1 | -1, coarse = false): Explore {
  return normalize({ ...e, [id]: stepOn(LADDERS[id], e[id], dir, coarse ? COARSE : 1) })
}

/**
 * The element types the control offers. FP32 is not one: an H100 runs FP32 inputs at the TF32 tensor rate (half of BF16
 * dense) or on CUDA cores, and no registered claim carries that rate, so the cube could only price it against the BF16
 * ridge, which would be wrong. The model still counts 4-byte elements (tiling.ts) for the item families that ask.
 */
export const DTYPES: readonly CubeDtype[] = ['fp8', 'fp16']
export const RASTERS: readonly Raster[] = ['row', 'grouped']

/** A choice control set to one of its options; anything else leaves the scene as it was. */
export function chooseControl(e: Explore, id: ChoiceControl, value: string): Explore {
  if (id === 'dtype') return DTYPES.includes(value as CubeDtype) ? normalize({ ...e, dtype: value as CubeDtype }) : e
  return RASTERS.includes(value as Raster) ? normalize({ ...e, raster: value as Raster }) : e
}

export interface ControlDef {
  id: ControlId
  label: string
  /** The words for a screen reader and the hint under the control. */
  hint: string
}

const DEFS: Record<ControlId, ControlDef> = {
  tm: { id: 'tm', label: 'Tm', hint: 'rows of the output tile' },
  tn: { id: 'tn', label: 'Tn', hint: 'columns of the output tile' },
  k: { id: 'k', label: 'k', hint: 'depth of each slab of A and B' },
  stages: { id: 'stages', label: 'Stages', hint: 'slabs in flight, so loads overlap the math' },
  dtype: { id: 'dtype', label: 'Element type', hint: 'bytes per value' },
  m: { id: 'm', label: 'M', hint: 'output rows of the GEMM' },
  n: { id: 'n', label: 'N', hint: 'output columns of the GEMM' },
  raster: { id: 'raster', label: 'Raster order', hint: 'the order tiles launch in' },
  group: { id: 'group', label: 'Group height', hint: 'tile rows per group, from 1' },
  seq: { id: 'seq', label: 'N (sequence)', hint: 'tokens whose keys and values stream through' },
  d: { id: 'd', label: 'd (head dimension)', hint: 'values per head' },
  br: { id: 'br', label: 'Br (query rows)', hint: 'rows of the query block' },
}

const CONTROLS: Record<CubeLevel['id'], readonly ControlId[]> = {
  count: ['tm', 'tn', 'k', 'dtype'],
  smem: ['tm', 'tn', 'k', 'stages', 'dtype'],
  occupancy: ['tm', 'tn', 'k', 'stages', 'dtype'],
  raster: ['tm', 'tn', 'm', 'n', 'raster', 'group', 'dtype'],
  fp8: ['tm', 'tn', 'dtype'],
  flash: ['seq', 'd', 'br', 'dtype'],
}

/** The controls a level shows, for the scene as it stands (the group height only matters to the grouped raster). */
export function controlsFor(level: CubeLevel, e: Explore): ControlDef[] {
  return CONTROLS[level.id].filter((id) => id !== 'group' || e.raster === 'grouped').map((id) => DEFS[id])
}

export const isChoice = (id: ControlId): id is ChoiceControl => id === 'dtype' || id === 'raster'

/** The dtype of the scene: FP8 and INT8 are one byte, everything else the 16-bit default (the cube's items never carry FP32). */
function dtypeOf(x: unknown): CubeDtype {
  const s = String(x)
  return s === 'fp8' || s === 'int8' ? 'fp8' : 'fp16'
}

const finite = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback)

/** The scene a level opens on: the item's own numbers, so the views show the tile the learner just predicted about. */
export function exploreFor(level: CubeLevel, inst: Instance): Explore {
  const p = inst.params
  const base: Explore = { tm: BASE.tm, tn: BASE.tn, k: BASE.k, stages: BASE.stages, dtype: 'fp16', m: WAVE_GEMM, n: WAVE_GEMM, raster: 'grouped', group: WAVE_GROUP, seq: 32768, d: 128, br: 128 }
  switch (level.id) {
    case 'count':
      return normalize({ ...base, tm: finite(p.tm, base.tm), tn: finite(p.tn, base.tn), dtype: dtypeOf(p.dtype) })
    case 'smem':
      return normalize({ ...base, k: finite(p.k, base.k), stages: finite(p.stages, base.stages), dtype: dtypeOf(p.dtype), ...(p.hw === 'synthetic' && finite(p.budget, 0) > 0 ? { budgetKib: finite(p.budget, 0) } : {}) })
    case 'occupancy':
      return normalize({ ...base, tm: finite(p.tm, base.tm), tn: finite(p.tn, base.tn), k: finite(p.k, base.k), stages: finite(p.stages, base.stages), dtype: dtypeOf(p.dtype) })
    case 'raster':
      return normalize({
        ...base,
        tm: finite(p.tm, base.tm),
        tn: finite(p.tn, base.tn),
        m: finite(p.m, base.m),
        n: finite(p.n, base.n),
        dtype: dtypeOf(p.dtype),
        raster: p.raster === 'row' ? 'row' : 'grouped',
        group: finite(p.group, WAVE_GROUP),
      })
    case 'fp8':
      return normalize({
        ...base,
        dtype: 'fp8',
        ...(p.hw === 'synthetic' ? { chip: { bf16Tflops: finite(p.peak, 0), hbmTBs: finite(p.bw, 0), fcPct: finite(p.fc, 100), fbPct: finite(p.fb, 100) } } : {}),
      })
    default:
      return normalize({ ...base, seq: finite(p.seq, base.seq), d: finite(p.d, base.d), br: finite(p.br, base.br), dtype: dtypeOf(p.dtype) })
  }
}

/* ------------------------------------------------------------------ */
/* What the model says of the scene (the table, the live line, the views) */
/* ------------------------------------------------------------------ */

/** The tile and K loop of a scene, as the model takes them. */
const configOf = (e: Explore) => ({ tm: e.tm, tn: e.tn, k: e.k, stages: e.stages, dtype: e.dtype })

/** The two waves of a scene, row-major and grouped, on its GEMM and tile; and the one it has chosen. */
export function wavesOf(e: Explore): { row: Wave; grouped: Wave; chosen: Wave } {
  const spec = { ...configOf(e), m: e.m, n: e.n, group: e.group }
  const row = waveAI({ ...spec, raster: 'row' })
  const grouped = waveAI({ ...spec, raster: 'grouped' })
  return { row, grouped, chosen: e.raster === 'row' ? row : grouped }
}

/**
 * The ridge a scene is held against: the tensor rate of its element type over HBM bandwidth. FP8 runs at the FP8 rate
 * (2 × BF16 dense) and FP16 at the BF16 one (the same tensor rate on H100), the cube's single rule. A hypothetical chip (level 5) scales
 * with the share a benchmark sustains.
 */
export function ridgeOf(e: Explore): { value: number; rate: 'FP8' | 'BF16' } {
  const rate = bytesOf(e.dtype) === 1 ? 'FP8' : 'BF16'
  if (e.chip) {
    const mult = rate === 'FP8' ? 2 : 1
    return { value: (mult * e.chip.bf16Tflops * (e.chip.fcPct / 100)) / (e.chip.hbmTBs * (e.chip.fbPct / 100)), rate }
  }
  return { value: ridge(e.dtype), rate }
}

/** The shared-memory budget a scene's slabs are held to: a hypothetical one, or the H100's per-block limit. */
export const budgetBytes = (e: Explore): number => (e.budgetKib === undefined ? H100.smemPerBlock : e.budgetKib * KIB)

export interface ModelReadout {
  occ: Occupancy
  smem: number
  fits: boolean
  acc: number
  ai: number
}

export function readout(e: Explore): ModelReadout {
  const c = configOf(e)
  const smem = smemBytes(c)
  return { occ: occupancy(c), smem, fits: smem <= budgetBytes(e), acc: accumulatorBytes(c), ai: tileAI(c, e.dtype) }
}

type Row = [string, string]

/** The DOM table of a scene: what the three face views draw, as text (the cube's required mirror, games-3d.md:190–196). */
export function tableOf(level: CubeLevel, e: Explore): { caption: string; columns: string[]; rows: Row[]; announce: string } {
  const columns = ['Quantity', 'Value']
  const b = bytesOf(e.dtype)
  if (level.id === 'flash') {
    const flops = 4 * e.br * e.seq * e.d
    const bytes = b * 2 * e.d * (e.seq + e.br)
    const ai = qBlockAI({ n: e.seq, d: e.d, br: e.br, dtype: e.dtype })
    const s = scoreBytes(e.seq, e.dtype)
    const sText = s >= GIB ? `${fixed(s / GIB, 2)} GiB` : `${fixed(s / MIB, 1)} MiB`
    return {
      caption: `A query block of ${e.br} rows, N = ${fixed(e.seq)}, d = ${e.d}, ${dtypeName(e.dtype)}`,
      columns,
      rows: [
        ['Query block', `${e.br} rows × d = ${e.d}`],
        ['FLOPs per block', `4·Br·N·d = ${fixed(flops)}`],
        ['HBM bytes per block', `b·2·d·(N + Br) = ${fixed(bytes)} B`],
        ['Intensity', `${fixed(ai, 1)} FLOP/B`],
        ['Score matrix S, one head', `${sText}, never written`],
      ],
      announce: `Query block of ${e.br} rows at N ${fixed(e.seq)}: ${fixed(ai, 1)} FLOP per byte.`,
    }
  }
  const r = readout(e)
  const rg = ridgeOf(e)
  const tile = `${e.tm} × ${e.tn} ${dtypeName(e.dtype)}`
  const rows: Row[] = [['Tile', tile]]
  if (level.id === 'raster') {
    const w = wavesOf(e)
    rows.push(
      ['GEMM', `${fixed(e.m)} × ${fixed(e.n)} (${fixed(Math.floor(e.m / e.tm))} × ${fixed(Math.floor(e.n / e.tn))} tiles)`],
      ['Row-major wave', `${w.row.tiles} tiles touch ${w.row.rows} tile rows and ${w.row.cols} columns: ${fixed(w.row.ai, 1)} FLOP/B`],
      [`Grouped wave (groups of ${e.group})`, `${w.grouped.tiles} tiles touch ${w.grouped.rows} tile rows and ${w.grouped.cols} columns: ${fixed(w.grouped.ai, 1)} FLOP/B`],
      ['Raster order alone', `${times(w.grouped.ai / w.row.ai)}`],
      [`Slabs the ${e.raster === 'row' ? 'row-major' : 'grouped'} wave keeps in L2`, `${fixed(w.chosen.l2Bytes / MB, 1)} MB of ${fixed(H100.l2Bytes / MB)} MB: ${w.chosen.fits ? 'fits' : 'does not fit'}`],
      ['Ridge', `${fixed(rg.value, 1)} FLOP/B (${rg.rate} rate)`],
    )
    return {
      caption: `A wave of ${w.row.tiles} CTAs, one per SM, on a ${fixed(e.m)} × ${fixed(e.n)} GEMM`,
      columns,
      rows,
      announce: `Row-major wave ${fixed(w.row.ai, 1)} FLOP per byte, grouped ${fixed(w.grouped.ai, 1)}.`,
    }
  }
  rows.push(
    ['FLOPs per step of K', `2·Tm·Tn = ${fixed(2 * e.tm * e.tn)}`],
    ['Bytes per step of K', `(Tm + Tn)·b = ${fixed((e.tm + e.tn) * b)} B`],
    ['Intensity', `${fixed(r.ai, 1)} FLOP/B`],
    ['Ridge', `${fixed(rg.value, 1)} FLOP/B (${rg.rate} rate)`],
    ['Slabs in shared memory', `${kibText(r.smem)}: ${e.stages} stage${e.stages === 1 ? '' : 's'} of k = ${e.k}`],
    [e.budgetKib === undefined ? 'Shared memory per block' : 'This question’s budget', `${kibText(budgetBytes(e))}: slabs ${r.fits ? 'fit' : 'do not fit'}`],
    ['Accumulators in registers', `${kibText(r.acc)} of ${kibText(H100.regBytesPerSm)}`],
    ['CTAs per SM', `${r.occ.ctas} (shared memory allows ${r.occ.bySmem}, registers ${r.occ.byRegs})`],
  )
  if (level.id === 'fp8') {
    // a square tile's intensity is T ÷ b, so it reaches the ridge at T = ⌈ridge · b⌉ whichever the element type
    const t = tileToReach(rg.value, e.dtype)
    const need = accumulatorBytes({ tm: t, tn: t })
    rows.push(['Square tile that reaches the ridge', `T ≥ ${fixed(t)}: its accumulators need ${kibText(need)}, ${need > H100.regBytesPerSm ? 'past' : 'within'} the ${kibText(H100.regBytesPerSm)} register file`])
  }
  return {
    caption: `A ${tile} tile, k = ${e.k}, ${e.stages} stage${e.stages === 1 ? '' : 's'}`,
    columns,
    rows,
    announce: `Tile ${e.tm} by ${e.tn} ${dtypeName(e.dtype)}: ${fixed(r.ai, 1)} FLOP per byte, ${r.occ.ctas} CTAs per SM.`,
  }
}

/* ------------------------------------------------------------------ */
/* The pictures' geometry                                              */
/* ------------------------------------------------------------------ */

/** The side of the square the three faces are fitted into, in drawing units. */
export const SIZE = 300
const GAP = 6
/** A face is never drawn thinner than this, so a small tile is still a thing to look at. */
const MIN_PX = 5
/** Gridlines per face edge at most. */
export const MAX_LINES = 16

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface FaceLayout {
  width: number
  height: number
  a: Rect
  b: Rect
  c: Rect
  /** element counts of each face: rows × columns */
  dims: { a: [number, number]; b: [number, number]; c: [number, number] }
}

const MAX_SEQ = 131072
const MIN_LEN = 8

/** FlashAttention's lengths span four decades, so they are drawn on a log scale (the caption says so). */
const logLen = (x: number): number => Math.log2(Math.max(x, MIN_LEN) / MIN_LEN) / Math.log2(MAX_SEQ / MIN_LEN)

/**
 * The unfolded faces of a scene: B above C, A left of C. A and C share the tile's rows, B and C its columns, and A's
 * columns are B's rows (k, or d for attention). Linear in elements for a tile, log for FlashAttention.
 */
export function layoutFaces(e: Explore, flash: boolean): FaceLayout {
  // rows × columns of each face
  const a: [number, number] = flash ? [e.br, e.d] : [e.tm, e.k]
  const b: [number, number] = flash ? [e.d, e.seq] : [e.k, e.tn]
  const c: [number, number] = flash ? [e.br, e.seq] : [e.tm, e.tn]
  // lengths in drawing units before scaling
  const len = (x: number): number => (flash ? 1 + 8 * logLen(x) : x)
  const wA = len(a[1])
  const hB = len(b[0])
  const wC = len(c[1])
  const hC = len(c[0])
  const span = Math.max(wA + wC, hB + hC)
  const scale = (SIZE - GAP) / span
  const px = (x: number) => Math.max(MIN_PX, x * scale)
  const aw = px(wA)
  const bh = px(hB)
  const cw = px(wC)
  const ch = px(hC)
  return {
    width: aw + GAP + cw,
    height: bh + GAP + ch,
    a: { x: 0, y: bh + GAP, w: aw, h: ch },
    b: { x: aw + GAP, y: 0, w: cw, h: bh },
    c: { x: aw + GAP, y: bh + GAP, w: cw, h: ch },
    dims: { a, b, c },
  }
}

export interface WaveLayout {
  width: number
  height: number
  cellW: number
  cellH: number
  /** the window of the grid the wave covers: tile rows × columns */
  rows: number
  cols: number
  lit: readonly (readonly [number, number])[]
  litRows: readonly number[]
  litCols: readonly number[]
}

export const EDGE = 8
const MAX_CELL = 24
const MAX_MAP_H = 150

/** The part of the output grid a wave covers, with its tiles and the rows and columns they touch. The cells are stretched to fit, not to scale. */
export function layoutWave(w: Wave): WaveLayout {
  const rows = Math.max(...w.cells.map((c) => c[0])) + 1
  const cols = Math.max(...w.cells.map((c) => c[1])) + 1
  const cellW = Math.min(MAX_CELL, (SIZE - EDGE) / cols)
  const cellH = Math.min(MAX_CELL, MAX_MAP_H / rows)
  return {
    width: EDGE + cols * cellW,
    height: EDGE + rows * cellH,
    cellW,
    cellH,
    rows,
    cols,
    lit: w.cells,
    litRows: [...new Set(w.cells.map((c) => c[0]))].sort((x, y) => x - y),
    litCols: [...new Set(w.cells.map((c) => c[1]))].sort((x, y) => x - y),
  }
}


/* ------------------------------------------------------------------ */
/* The session                                                         */
/* ------------------------------------------------------------------ */

export type Step = 'predict' | 'explore' | 'check' | 'debrief' | 'closing'
export type Provenance = 'practice' | 'unseen'

/** What the learner predicted at the opening of a level. */
export interface Predicted {
  value: number
  truth: number
  unit: string
  /** log10 of the larger over the smaller; absent when a ratio is undefined (a prediction of 0 or less) */
  logErr?: number
  /** within a factor of `RIGHT_FACTOR` of the model's value */
  ok: boolean
}

export interface LevelRun {
  inst: Instance
  predicted: Predicted | null
  /** The checked answer: right or not; null until checked. */
  checked: boolean | null
}

export interface CubeSession {
  /** The seed every level's item is drawn on. */
  seed: number
  provenance: Provenance
  runs: LevelRun[]
  /** The level in play, 0-5; 6 once the closing debrief is reached. */
  at: number
  step: Step
  explore: Explore
}

/** The six items of a seed. */
function itemsOf(seed: number): Instance[] {
  return CUBE_LEVELS.map((level) => levelInstance(level, seed))
}

export function newSession(seed: number, provenance: Provenance): CubeSession {
  const runs = itemsOf(seed).map((inst): LevelRun => ({ inst, predicted: null, checked: null }))
  return { seed, provenance, runs, at: 0, step: 'predict', explore: exploreFor(CUBE_LEVELS[0], runs[0].inst) }
}

/** The pinned practice seed's session. */
export const practiceSession = (): CubeSession => newSession(CUBE_PRACTICE_SEED, 'practice')

/**
 * New numbers: the first seed from `entropy`'s stream that is in the cube's band (every item gradable, every slip outside
 * the tolerance, level 4's rasters 3× apart); the practice seed stands in if none is found.
 */
export function freshSeed(entropy: number): number {
  for (let i = 0; i < FRESH_TRIES; i++) {
    const seed = seedFor(entropy, i)
    if (checkCubeBand(seed).inBand) return seed
  }
  return CUBE_PRACTICE_SEED
}

export const freshSession = (entropy: number): CubeSession => {
  const seed = freshSeed(entropy)
  return newSession(seed, seed === CUBE_PRACTICE_SEED ? 'practice' : 'unseen')
}

export const levelOf = (s: CubeSession): CubeLevel => CUBE_LEVELS[Math.min(s.at, LEVEL_COUNT - 1)]
export const runOf = (s: CubeSession): LevelRun => s.runs[Math.min(s.at, LEVEL_COUNT - 1)]

/** The prediction of an opening item, from the card's result. */
export function predictedOf(r: ItemResult, inst: Instance): Predicted {
  const a = inst.answer
  const truth = a.kind === 'choice' ? 0 : a.truth
  const unit = a.kind === 'choice' ? 'option' : a.unit
  const value = r.response.kind === 'estimate' || r.response.kind === 'numeric' ? r.response.value : 0
  const logErr = value > 0 && truth > 0 ? Math.abs(Math.log10(value / truth)) : undefined
  return { value, truth, unit, ...(logErr === undefined ? {} : { logErr }), ok: r.ok }
}

/** The prediction is in: the next button opens the views. */
export function withPrediction(s: CubeSession, p: Predicted): CubeSession {
  if (s.step !== 'predict' || runOf(s).predicted) return s
  return { ...s, runs: s.runs.map((r, i) => (i === s.at ? { ...r, predicted: p } : r)) }
}

/** Opens the views: only once a prediction is made. */
export function openViews(s: CubeSession): CubeSession {
  return s.step === 'predict' && runOf(s).predicted ? { ...s, step: 'explore' } : s
}

/** A stepper moved. Only while the views are open. */
export function nudge(s: CubeSession, id: NumberControl, dir: 1 | -1, coarse = false): CubeSession {
  return s.step === 'explore' || s.step === 'check' ? { ...s, explore: stepControl(s.explore, id, dir, coarse) } : s
}

export function choose(s: CubeSession, id: ChoiceControl, value: string): CubeSession {
  return s.step === 'explore' || s.step === 'check' ? { ...s, explore: chooseControl(s.explore, id, value) } : s
}

/** "Answer it now": the same item, exact. */
export function toCheck(s: CubeSession): CubeSession {
  return s.step === 'explore' ? { ...s, step: 'check' } : s
}

export function withChecked(s: CubeSession, ok: boolean): CubeSession {
  if (s.step !== 'check' || runOf(s).checked !== null) return s
  return { ...s, runs: s.runs.map((r, i) => (i === s.at ? { ...r, checked: ok } : r)) }
}

/** The level's debrief: only once the check is answered. */
export function toDebrief(s: CubeSession): CubeSession {
  return s.step === 'check' && runOf(s).checked !== null ? { ...s, step: 'debrief' } : s
}

/** Past the last level is the closing debrief, which records the play. */
export function nextLevel(s: CubeSession): CubeSession {
  if (s.step !== 'debrief') return s
  const at = s.at + 1
  if (at >= LEVEL_COUNT) return { ...s, at: LEVEL_COUNT, step: 'closing' }
  return { ...s, at, step: 'predict', explore: exploreFor(CUBE_LEVELS[at], s.runs[at].inst) }
}

/** Predictions within the factor of 2. */
export const levelsRight = (s: CubeSession): number => s.runs.filter((r) => r.predicted?.ok === true).length

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

/**
 * The prediction's error, in the cube's wording: what was predicted, what the model gives, how far apart in a factor,
 * and whether that is inside the factor of 2 that counts as right.
 */
export function errorLine(p: Predicted): string {
  const said = `${fixed(p.value, p.value >= 100 || Number.isInteger(p.value) ? 0 : 1)} ${p.unit}`
  const model = `${fixed(p.truth, Number.isInteger(p.truth) ? 0 : 1)} ${p.unit}`
  if (p.logErr === undefined) return `You predicted ${said}; the model gives ${model}, which a factor cannot compare.`
  const factor = 10 ** p.logErr
  const inside = p.ok ? `inside the factor of ${RIGHT_FACTOR} that counts as right` : `outside the factor of ${RIGHT_FACTOR} that counts as right`
  return `You predicted ${said}; the model gives ${model}. You were off by a factor of ${fixed(factor, 2)}, ${inside}.`
}

/** The claims a level's debrief chips, by level id: the hardware numbers its reference choice rests on. */
export const LEVEL_CLAIMS: Readonly<Record<CubeLevel['id'], readonly string[]>> = {
  count: ['hw.h100-sxm.hbm-bw', 'hw.h100-sxm.bf16-dense'],
  smem: ['hw.h100-sxm.smem-per-block', 'hw.h100-sxm.registers-per-sm'],
  occupancy: ['hw.h100-sxm.smem-per-sm', 'hw.h100-sxm.registers-per-sm'],
  raster: ['hw.h100-sxm.sm-count', 'hw.h100-sxm.l2'],
  fp8: ['hw.h100-sxm.fp8-dense', 'hw.h100-sxm.bf16-dense', 'hw.h100-sxm.hbm-bw'],
  flash: ['hw.h100-sxm.hbm-bw'],
}

/** The closing debrief's headline: intensity is volume over lit surface, and the raster factor of level 4, from the model. */
export function closingHeadline(): string {
  const spec = { ...BASE, m: WAVE_GEMM, n: WAVE_GEMM, group: WAVE_GROUP }
  const row = waveAI({ ...spec, raster: 'row' })
  const grouped = waveAI({ ...spec, raster: 'grouped' })
  return `Intensity is volume ÷ lit surface; raster order alone moved this wave ${fixed(grouped.ai / row.ai, 1)}×.`
}

/** The play's session pieces a screen shows as one line: "Level 2 of 6". */
export const levelCount = (s: CubeSession): string => `Level ${Math.min(s.at + 1, LEVEL_COUNT)} of ${LEVEL_COUNT}`

/** The releases the card's claims pin, in row order, read from the claims. */
export function pinnedReleases(claims: readonly string[]): string[] {
  const out: string[] = []
  for (const id of claims) {
    const pin = byId[id]?.pin
    const text = pin ? `${pin.repo} ${pin.ref}` : ''
    if (text && !out.includes(text)) out.push(text)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* The ledger                                                          */
/* ------------------------------------------------------------------ */

const grpOf = (n: number): string => `play:${CUBE_PLAY_ID}#${n}`

/** Nominal seconds of a prediction, as a prequestion's (`PRE_NSEC`, prequestions.ts; a test holds them equal). */
export const PREDICT_NSEC = 20
const MAX_KCS = 6
const MAX_NSEC = 600

/**
 * The opening item as the card asks it: no worked steps (they would hand over the answer), and a numeric answer becomes an
 * estimate within a factor of `RIGHT_FACTOR` with an optional 90 % range. The lesson block asks its first item the same way
 * (`predictInstance`, item-block.ts); this copy keeps the lesson block's whole module, and the Today session behind it, out
 * of the play's chunk. A test holds the two equal.
 */
export function predictedInstance(inst: Instance): Instance {
  const a = inst.answer
  const answer: AnswerSpec = a.kind === 'numeric' ? { kind: 'estimate', truth: a.truth, unit: a.unit, okWithinFactor: RIGHT_FACTOR, interval: true } : a
  return { ...inst, prompt: { stem: inst.prompt.stem, ...(inst.prompt.givens ? { givens: inst.prompt.givens } : {}) }, answer, nsec: PREDICT_NSEC }
}

/** The checker for the prediction: the shared grading with the family's ratio rules, and no solution to show. */
export const predictChecker = (gen: Gen): Gen => ({ ...gen, grade: (inst, response) => gradeResponse(inst, response, gen.ratioRules), solution: () => [] })

/** What every cube event carries of its item: the level, the variant, the KCs and the miss a ratio rule named. */
function itemFields(r: ItemResult): Pick<ItemData, 'kcs' | 'level' | 'variant' | 'hit' | 'miss' | 'lo' | 'hi'> {
  return {
    kcs: r.kcs.slice(0, MAX_KCS),
    ...(r.level === undefined ? {} : { level: r.level }),
    ...(r.variant === undefined ? {} : { variant: r.variant }),
    ...(r.response.kind === 'estimate' && r.response.lo !== undefined && r.response.hi !== undefined ? { lo: r.response.lo, hi: r.response.hi } : {}),
    ...(r.grade.interval ? { hit: r.grade.interval.hit } : {}),
    ...(r.grade.diagnosis ? { miss: r.grade.diagnosis.id } : {}),
  }
}

const valueOf = (r: ItemResult): number => (r.response.kind === 'estimate' || r.response.kind === 'numeric' ? r.response.value : 0)

/**
 * The `predict` event of a level's opening item (src `play`): the lesson block's write (`predictResponse`, item-block.ts)
 * with the play as its source. The estimate is within a factor of 2, with its 90 % range, and log-scored.
 */
export function predictEvent(s: CubeSession, n: number, r: ItemResult): ItemResponse {
  const a = s.runs[n].inst.answer
  const truth = a.kind === 'choice' ? 0 : a.truth
  const unit = a.kind === 'choice' ? 'option' : a.unit
  return {
    kind: 'predict',
    ref: r.ref as ItemResponse['ref'],
    rev: r.rev,
    score: r.score,
    ok: r.ok,
    ...(r.conf ? { conf: r.conf } : {}),
    seed: r.seed,
    ms: r.ms,
    data: { src: 'play', value: valueOf(r), unit, truth, nsec: PREDICT_NSEC, grp: grpOf(n), lessonId: CUBE_LESSON, ...itemFields(r) },
  }
}

/**
 * The `item` event of a level's check (src `play`), the mapping Today and the lesson block share (`itemResponseOf`,
 * today.ts) for a numeric item. A practice session's items are practice; a new seed's are unseen.
 */
export function checkEvent(s: CubeSession, n: number, r: ItemResult): ItemResponse {
  const a = s.runs[n].inst.answer
  return {
    kind: 'item',
    ref: r.ref as ItemResponse['ref'],
    rev: r.rev,
    score: r.score,
    ok: r.ok,
    ...(r.conf ? { conf: r.conf } : {}),
    seed: r.seed,
    ms: r.ms,
    provenance: s.provenance,
    data: {
      src: 'play',
      grp: grpOf(n),
      lessonId: CUBE_LESSON,
      nsec: Math.min(MAX_NSEC, Math.max(0, Math.round(r.nsec))),
      ...(r.response.kind === 'numeric' ? { value: r.response.value, ...(r.response.unit ? { unit: r.response.unit } : {}) } : { value: valueOf(r) }),
      ...(a.kind === 'choice' ? {} : { truth: a.truth }),
      ...itemFields(r),
    },
  }
}

/** The KCs the six levels teach, in level order. */
export const CUBE_KCS: readonly string[] = CUBE_LEVELS.map((l) => l.kc)

/**
 * The ledger result of the closed play (wave-3.md §6.3): `{phase 'play', turns 6, survived: levels right, ghostSurvived
 * 6, levels}`, `ok` once the closing debrief is reached, and null before it. The reference model is right on every level,
 * so its count is 6.
 */
export function recordOf(s: CubeSession, ms?: number): PlayResult | null {
  if (s.step !== 'closing') return null
  const levels = s.runs.map((r, i) => ({
    id: CUBE_LEVELS[i].id,
    ok: r.predicted?.ok === true,
    ...(r.predicted?.logErr === undefined ? {} : { logErr: Math.round(r.predicted.logErr * 1e4) / 1e4 }),
  }))
  const right = levelsRight(s)
  return {
    playId: CUBE_PLAY_ID,
    score: right / LEVEL_COUNT,
    ok: true,
    seed: s.seed,
    provenance: s.provenance,
    ...(ms === undefined ? {} : { ms }),
    data: { phase: 'play', turns: LEVEL_COUNT, survived: right, ghostSurvived: LEVEL_COUNT, kcs: [...CUBE_KCS], levels },
  }
}
