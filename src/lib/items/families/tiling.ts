/**
 * `tiling`: the Tiling Cube's levels 2–6 as generated items (docs/specs/wave-3.md §6.2; KCs t4.shared-memory-scratchpad,
 * t4.occupancy, t4.raster-l2-reuse, t4.ridge-point, t4.flashattention-blocking). Level 1 of the cube is
 * `roofline/tile-ai`, so the play and Today use one instrument.
 *
 * Five numeric variants, every truth from the cube's model (`src/lib/world/tiling.ts`), so the family, the play and
 * RooflineSim agree: the largest square tile whose slabs fit a shared-memory budget, the CTAs an SM holds, a wave's
 * FLOP per HBM byte under row-major or grouped raster, the FP8 ridge or the square tile that would reach it, and a
 * FlashAttention query block's intensity or the bytes of the score matrix it never writes. H100 figures come from
 * claims through the model; budgets, chips, GEMM shapes and sequences that are not the H100's are hypothetical,
 * declared in SYNTHETIC, and the prompt says so (W4). A claim-backed scene stores no claim value in its params.
 *
 * The slips are the spec's diagnoses, each computed by running the model with the slip (forgetting the stages,
 * 4-byte elements, ignoring the registers, the row raster's panels for a grouped wave, the BF16 ridge at FP8, C's
 * face counted, S counted in FlashAttention's bytes), so a ratio rule fires exactly where the slip changes the answer.
 */

import { KC } from '@/data/kc/ids'
import { claimRef, finishInstance, resolveVariant, rngFor, type Rng } from '@/lib/items/core'
import { gradeResponse } from '@/lib/items/grade'
import type { AnswerSpec, Gen, Instance, Level, Params, PromptPart, RatioRule, SolutionStep, VariantSpec } from '@/lib/items/types'
import { byteUnitChoices, BYTE_UNITS, formatNumber, KIB, type Dtype } from '@/lib/items/units'
import {
  BASE,
  bytesOf,
  FP8_OVER_BF16,
  H100,
  occupancy,
  qBlockAI,
  QBLOCK,
  REG_BYTES,
  ridge,
  scoreBytes,
  smemBytes,
  maxTile,
  TILE_STEP,
  TILING_CLAIM_IDS as CL,
  tileToReach,
  waveAI,
  WAVE_GEMM,
  WAVE_GROUP,
  type TileConfig,
  type WaveSpec,
} from '@/lib/world/tiling'

const SYNTHETIC = {
  /** nominal seconds per variant */
  nsec: { smem: 55, ctas: 60, raster: 80, fp8: 45, qblock: 60 },
  /** a rate or an intensity is right within this share */
  relTol: 0.02,
  /** a tile side or a CTA count is whole, so only the exact one passes */
  countTol: 0.01,
  /**
   * Tile sides and CTA counts are small whole numbers, so "distinct truths" cannot hold for them (goodput's counts
   * set the precedent). The gate's bank rule, distinct fingerprints, is the honest measure: this is a floor on the
   * distinct instances each variant can draw, far above 80 % of any seed budget, so the rule reduces to 50 %
   * distinct fingerprints.
   */
  bankUnits: 1000000,
  /** percent of draws on the H100's claims rather than a hypothetical budget or chip */
  realPct: 20,
  /** a slip counts as one only when it moves the answer at least this far, relatively */
  apart: 0.05,
  /** draws before a variant falls back to its pinned scene */
  tries: 64,
  /** slab depths k, and stage counts */
  slabK: [16, 32, 64, 128],
  stages: [1, 2, 3, 4],
  /** hypothetical shared-memory budgets per CTA, KiB: round ones at level 0, any whole KiB after */
  budgetMin: 32,
  budgetMax: 250,
  /** the largest tile side an smem-fit item may ask for */
  maxSide: 1024,
  /** tile sides of a ctas-per-sm item: round at level 0, multiples of 16 after */
  roundSides: [16, 32, 48, 64, 80, 96, 128, 160, 256],
  sideStep: 16,
  sideMax: 256,
  ctasSlabK: [32, 64, 128],
  ctasStages: [1, 2, 3, 4, 5],
  /** a wave's tile shapes, GEMM sides and group heights */
  waveTiles: [64, 128, 256],
  roundGemm: [2048, 4096, 8192, 16384, 32768],
  gemm: [2048, 3072, 4096, 6144, 8192, 12288, 16384, 24576, 32768],
  groupMin: 2,
  groupMax: 16,
  /** percent of raster-ai draws that ask a grouped wave */
  groupedPct: 60,
  /** hypothetical chips, two significant digits: dense BF16 in tens of TFLOPS, HBM in tenths of TB/s */
  peakMin: 10,
  peakMax: 99,
  bwMin: 10,
  bwMax: 99,
  /** level 3 sustains these percentages of the datasheet figures */
  fracMin: 50,
  fracMax: 100,
  /** FlashAttention scenes: sequence lengths, head dimensions, query-block rows, heads and batch */
  roundSeq: [1000, 1024, 2000, 2048, 4000, 4096, 5000, 8000, 8192, 10000, 16000, 16384, 20000, 32000, 32768, 50000, 64000, 65536, 100000, 131072],
  seqStep: 1024,
  seqMax: 131072,
  headDims: [64, 128, 256],
  blockRows: [16, 32, 64, 128, 256],
  heads: [1, 8, 16, 32, 40, 64, 96, 128],
  batch: [1, 2, 4, 8, 16, 32],
}

const TRANSFER: Level = 3 // gen-literal-ok: level 3 of the staircase
const ALL_LEVELS = [0, 1, 2, TRANSFER] as const
/** TB/s and TFLOP/s against B/s and FLOP/s. */
const PER_TERA = 1e12 // gen-literal-ok: tera prefix
const VARIANTS: VariantSpec[] = [
  { id: 'smem-fit', title: 'The largest tile shared memory holds', kcs: ['t4.shared-memory-scratchpad'], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.smem },
  { id: 'ctas-per-sm', title: 'CTAs resident per SM', kcs: ['t4.occupancy'], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.ctas },
  { id: 'raster-ai', title: 'A wave’s intensity under a raster order', kcs: [KC.rasterL2Reuse], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.raster },
  { id: 'fp8-ridge', title: 'The FP8 ridge', kcs: [KC.ridgePoint], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.fp8 },
  { id: 'qblock-ai', title: 'A FlashAttention query block', kcs: ['t4.flashattention-blocking'], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.qblock },
]
const spec = (id: string): VariantSpec => VARIANTS.find((x) => x.id === id)!

/* ------------------------------ the maths, through the cube's model ------------------------------ */

const num = (p: Params, k: string): number => Number(p[k])
const dt = (p: Params): Dtype => String(p.dtype) as Dtype
const real = (p: Params): boolean => p.hw === 'h100'
const cfg = (p: Params): TileConfig => ({ tm: num(p, 'tm'), tn: num(p, 'tn'), k: num(p, 'k'), stages: num(p, 'stages'), dtype: dt(p) })
/** smem-fit's budget in bytes: the H100's per-block limit, or a hypothetical one in KiB. */
const budgetOf = (p: Params): number => (real(p) ? H100.smemPerBlock : num(p, 'budget') * KIB)
const waveOf = (p: Params) =>
  waveAI({ ...BASE, tm: num(p, 'tm'), tn: num(p, 'tn'), dtype: dt(p), m: num(p, 'm'), n: num(p, 'n'), raster: p.raster === 'grouped' ? 'grouped' : 'row', group: Number(p.group ?? 1) } satisfies WaveSpec)
/** FP8 rate ÷ bandwidth, sustained where a benchmark says so. */
function ridgeOf(p: Params): number {
  const r = real(p) ? ridge('fp8') : (FP8_OVER_BF16 * num(p, 'peak')) / num(p, 'bw')
  return (r * Number(p.fc ?? 100)) / Number(p.fb ?? 100)
}
const qOf = (p: Params) => ({ n: num(p, 'seq'), d: num(p, 'd'), br: num(p, 'br'), dtype: dt(p) })
const scoresOf = (p: Params): number => (scoreBytes(num(p, 'seq'), dt(p)) * num(p, 'heads') * num(p, 'batch')) / BYTE_UNITS[String(p.unit)]

function truthOf(variant: string, p: Params): number {
  switch (variant) {
    case 'smem-fit':
      return maxTile(num(p, 'k'), num(p, 'stages'), dt(p), budgetOf(p))
    case 'ctas-per-sm':
      return occupancy(cfg(p)).ctas
    case 'raster-ai':
      return waveOf(p).ai
    case 'fp8-ridge':
      // a square FP8 tile's intensity is T ÷ 1 B, so it reaches the ridge at T ≥ the ridge: the smallest whole side is its ceiling
      return p.ask === 'tile' ? tileToReach(ridgeOf(p), 'fp8') : ridgeOf(p)
    default:
      return p.ask === 'score' ? scoresOf(p) : qBlockAI(qOf(p))
  }
}

/* ------------------------------ prompt and solution text ------------------------------ */

const t = (text: string): PromptPart => ({ t: 'text', text })
const v = (value: number, unit?: string, digits?: number): PromptPart => ({ t: 'value', value, ...(unit ? { unit } : {}), ...(digits === undefined ? {} : { digits }) })
const c = (claim: string, scale?: number, unit?: string): PromptPart => ({ t: 'claim', claim, ...(scale === undefined ? {} : { scale }), ...(unit ? { unit } : {}) })
const step = (text: PromptPart[], result?: { value: number; unit?: string }): SolutionStep => ({ text, ...(result ? { result } : {}) })
const f = (x: number): string => formatNumber(x)
const dtName = (p: Params): string => dt(p).toUpperCase()
const sustained = (p: Params): boolean => p.fc !== undefined

function steps(variant: string, p: Params, truth: number): SolutionStep[] {
  const b = bytesOf(dt(p))
  switch (variant) {
    case 'smem-fit': {
      const perT = num(p, 'stages') * 2 * num(p, 'k') * b
      const budget = budgetOf(p)
      return [
        step([t('A square tile’s slabs take stages × (T + T) × k × b = '), v(perT, 'B'), t(' for every element of T')], { value: perT, unit: 'B' }),
        step([t('The budget in bytes: '), v(budget / KIB, 'KiB'), t(' × 1,024 = '), v(budget, 'B')], { value: budget, unit: 'B' }),
        step([t('T ≤ budget ÷ that = '), v(budget / perT, undefined, 1), t(`; rounded down to a multiple of ${TILE_STEP}: `), v(truth, 'elements')], { value: truth, unit: 'elements' }),
      ]
    }
    case 'ctas-per-sm': {
      const o = occupancy(cfg(p))
      const smem = smemBytes(cfg(p))
      const acc = num(p, 'tm') * num(p, 'tn') * REG_BYTES
      return [
        step([t('Shared memory per CTA = stages × (Tm + Tn) × k × b = '), v(smem / KIB, 'KiB')], { value: smem / KIB, unit: 'KiB' }),
        step([t('CTAs that shared memory allows = ⌊'), v(H100.smemPerSm / KIB, 'KiB'), t(' ÷ '), v(smem / KIB, 'KiB'), t('⌋ = '), v(o.bySmem)], { value: o.bySmem, unit: 'CTAs' }),
        step([t('FP32 accumulators per CTA = Tm × Tn × 4 B = '), v(acc / KIB, 'KiB'), t(', so the registers allow ⌊'), v(H100.regBytesPerSm / KIB, 'KiB'), t(' ÷ '), v(acc / KIB, 'KiB'), t('⌋ = '), v(o.byRegs)], { value: o.byRegs, unit: 'CTAs' }),
        step([t(`CTAs per SM, the smaller of the two (${o.limit === 'smem' ? 'shared memory' : 'the registers'} binding): `), v(truth)], { value: truth, unit: 'CTAs' }),
      ]
    }
    case 'raster-ai': {
      const w = waveOf(p)
      return [
        step([t('The grid is '), v(num(p, 'm') / num(p, 'tm')), t(' × '), v(num(p, 'n') / num(p, 'tn')), t(` tiles; in ${p.raster === 'grouped' ? `groups of ${f(num(p, 'group'))} rows` : 'row-major order'} the wave’s `), v(w.tiles), t(' tiles touch '), v(w.rows), t(' tile rows and '), v(w.cols), t(' columns, panels touched = '), v(w.rows + w.cols, 'panels')], { value: w.rows + w.cols, unit: 'panels' }),
        step([t('FLOPs per unit of K = tiles × 2 × Tm × Tn = '), v(w.flopsPerK, 'FLOP')], { value: w.flopsPerK, unit: 'FLOP' }),
        step([t('HBM bytes per unit of K = (rows × Tm + columns × Tn) × b = '), v(w.bytesPerK, 'B')], { value: w.bytesPerK, unit: 'B' }),
        step([t('Intensity = FLOPs ÷ bytes = '), v(truth, 'FLOP/B', 1)], { value: truth, unit: 'FLOP/B' }),
      ]
    }
    case 'fp8-ridge': {
      const peak = real(p) ? H100.fp8Flops / PER_TERA : FP8_OVER_BF16 * num(p, 'peak')
      const bw = real(p) ? H100.hbmBps / PER_TERA : num(p, 'bw')
      const sp = (peak * Number(p.fc ?? 100)) / 100
      const sb = (bw * Number(p.fb ?? 100)) / 100
      const out = [
        step([t(`${sustained(p) ? 'Sustained ' : ''}FP8 peak = 2 × the BF16 dense rate${sustained(p) ? ' × the sustained share' : ''} = `), v(sp, 'TFLOP/s')], { value: sp, unit: 'TFLOP/s' }),
        step([t(`${sustained(p) ? 'Sustained bandwidth' : 'Bandwidth'} = `), v(sb, 'TB/s')], { value: sb, unit: 'TB/s' }),
        step([t('Ridge = peak ÷ bandwidth = '), v(ridgeOf(p), 'FLOP/B', 1)], { value: ridgeOf(p), unit: 'FLOP/B' }),
      ]
      if (p.ask !== 'tile') return out
      return [
        ...out,
        step(
          [t('A square FP8 tile does 2T² FLOPs per step of K and reads 2T bytes, so its intensity is T and it needs T ≥ the ridge, '), v(ridgeOf(p), undefined, 1), t('. A side is whole, so the smallest is that rounded up: T = '), v(truth, 'elements'), t('. Arithmetic only: its FP32 accumulators, T × T × 4 B = '), v(truth * truth * REG_BYTES / KIB, 'KiB', 0), t(', are past the '), v(H100.regBytesPerSm / KIB, 'KiB'), t(' register file of an H100 SM, so no lone CTA reaches the ridge; reuse across CTAs through L2 does.')],
          { value: truth, unit: 'elements' },
        ),
      ]
    }
    default: {
      if (p.ask === 'score') {
        const one = scoreBytes(num(p, 'seq'), dt(p))
        return [
          step([t('One head’s score matrix = N × N × b = '), v(one / KIB / KIB, 'MiB')], { value: one / KIB / KIB, unit: 'MiB' }),
          step([t('× heads × sequences = '), v(truth, String(p.unit))], { value: truth, unit: String(p.unit) }),
        ]
      }
      const q = qOf(p)
      const flops = 4 * q.br * q.n * q.d // gen-literal-ok: Q·Kᵀ and P·V, 2 FLOPs per multiply-add each
      const bytes = b * 2 * q.d * (q.n + q.br)
      return [
        step([t('FLOPs = Q·Kᵀ and P·V, 2 × Br × N × d each = '), v(flops, 'FLOP')], { value: flops, unit: 'FLOP' }),
        step([t('HBM bytes = K and V once (2 × N × d) plus Q in and O out (2 × Br × d), times b = '), v(bytes, 'B')], { value: bytes, unit: 'B' }),
        step([t('Intensity = FLOPs ÷ bytes = '), v(truth, 'FLOP/B', 1)], { value: truth, unit: 'FLOP/B' }),
      ]
    }
  }
}

/** A blanked step shows its lead-in and hides the answer after the last "=" or ":". */
function blanked(s: SolutionStep): SolutionStep {
  const cut = s.text.map((x) => x.t === 'text' && /[=:]\s*$/.test(x.text)).lastIndexOf(true)
  return { ...s, text: cut < 0 ? s.text : s.text.slice(0, cut + 1), blank: true }
}

/* ------------------------------ building an instance ------------------------------ */

const H100_NAME = 'an H100 SXM'

function stemOf(variant: string, p: Params): { stem: PromptPart[]; givens?: { label: string; value: PromptPart }[]; claims: string[] } {
  switch (variant) {
    case 'smem-fit': {
      const where = real(p) ? `on ${H100_NAME}, whose per-block limit is given below` : `with a hypothetical budget of ${f(num(p, 'budget'))} KiB of shared memory per CTA`
      return {
        stem: [t(`A matmul kernel keeps A’s T × k slab and B’s k × T slab in shared memory, k = ${f(num(p, 'k'))} deep and ${f(num(p, 'stages'))} stage${num(p, 'stages') === 1 ? '' : 's'} deep, in ${dtName(p)} (${f(bytesOf(dt(p)))} B per value), ${where}. Counting shared memory only, what is the largest square tile side T, a multiple of ${TILE_STEP}, whose slabs fit?`)],
        ...(real(p) ? { givens: [{ label: 'Shared memory per CTA (H100 SXM)', value: c(CL.smemPerBlock) }] } : {}),
        claims: real(p) ? [CL.smemPerBlock] : [],
      }
    }
    case 'ctas-per-sm':
      return {
        stem: [t(`On ${H100_NAME}, a matmul kernel computes ${f(num(p, 'tm'))} × ${f(num(p, 'tn'))} output tiles. Each CTA keeps ${f(num(p, 'stages'))} stage${num(p, 'stages') === 1 ? '' : 's'} of A and B slabs k = ${f(num(p, 'k'))} deep in ${dtName(p)} in shared memory, and its tile of C in FP32 registers. Counting only those two resources, how many CTAs can one SM hold at once?`)],
        givens: [
          { label: 'Shared memory per SM', value: c(CL.smemPerSm) },
          { label: 'Register file per SM (4 B each)', value: c(CL.registers) },
        ],
        claims: [CL.smemPerSm, CL.registers],
      }
    case 'raster-ai': {
      const order = p.raster === 'grouped' ? `in groups of ${f(num(p, 'group'))} tile rows: down a column of the group, then the next column, as Triton’s grouped order does` : 'in row-major order: along a row of tiles, then the next row'
      return {
        stem: [
          t(`A ${f(num(p, 'm'))} × ${f(num(p, 'n'))} GEMM (a scenario, K long) runs on ${H100_NAME} as a persistent kernel, one CTA per SM, each computing a ${f(num(p, 'tm'))} × ${f(num(p, 'tn'))} tile in ${dtName(p)}. Tiles launch ${order}. The first wave’s CTAs share A and B slabs through L2, so each A row panel and B column panel it touches is read from HBM once. What is the wave’s intensity, in FLOP per HBM byte?`),
        ],
        givens: [
          { label: 'SMs, so CTAs in a wave', value: c(CL.smCount) },
          { label: 'L2 (the wave’s slabs fit)', value: c(CL.l2) },
        ],
        claims: [CL.smCount, CL.l2],
      }
    }
    case 'fp8-ridge': {
      const chip = real(p) ? H100_NAME : `a hypothetical GPU with ${f(num(p, 'peak'))} TFLOP/s of dense BF16 and ${f(num(p, 'bw'))} TB/s of HBM`
      const bench = sustained(p) ? ` In a hypothetical benchmark it sustains ${f(num(p, 'fc'))} % of the FP8 peak and ${f(num(p, 'fb'))} % of the bandwidth; use the sustained figures.` : ''
      const ask =
        p.ask === 'tile'
          ? ' What is the smallest whole square tile side T that gives an FP8 tile (C in registers, written once) an intensity of at least that ridge? A side is a whole number of elements, so round up: only that whole number is right. Answer the arithmetic, even if no CTA could hold the tile.'
          : ' Where is its FP8 ridge, in FLOP per byte?'
      return {
        stem: [t(`FP8 tensor cores run at 2 × the dense BF16 rate. Take ${chip}.${bench}${ask}`)],
        ...(real(p)
          ? {
              givens: [
                { label: 'Peak FP8, dense (2 × the BF16 figure)', value: c(CL.bf16Dense, FP8_OVER_BF16) },
                { label: 'Memory bandwidth', value: c(CL.hbmBw) },
              ],
            }
          : {}),
        claims: real(p) ? [CL.bf16Dense, CL.hbmBw] : [],
      }
    }
    default: {
      const scene = `A FlashAttention kernel processes a ${f(num(p, 'seq'))}-token sequence (a scenario) with head dimension d = ${f(num(p, 'd'))} in ${dtName(p)}.`
      const ask =
        p.ask === 'score'
          ? ` It never writes the N × N score matrix to HBM. For ${f(num(p, 'heads'))} head${num(p, 'heads') === 1 ? '' : 's'} and ${f(num(p, 'batch'))} sequence${num(p, 'batch') === 1 ? '' : 's'}, how many ${String(p.unit)} would those score matrices take if it did?`
          : ` One query block of Br = ${f(num(p, 'br'))} rows streams all of K and V once, reads its Q block and writes its O block; S stays on chip. Counting the matmul FLOPs only, what is the block’s intensity, in FLOP per HBM byte?`
      return { stem: [t(`${scene}${ask}`)], claims: [] }
    }
  }
}

function build(vs: VariantSpec, level: Level, seed: number, p: Params): Instance {
  const truth = truthOf(vs.id, p)
  const { stem, givens, claims } = stemOf(vs.id, p)
  let answer: AnswerSpec
  switch (vs.id) {
    case 'smem-fit':
      answer = { kind: 'numeric', truth, unit: 'elements', tolerance: { abs: SYNTHETIC.countTol } }
      break
    case 'ctas-per-sm':
      answer = { kind: 'numeric', truth, unit: 'CTAs', tolerance: { abs: SYNTHETIC.countTol } }
      break
    case 'qblock-ai':
      answer =
        p.ask === 'score'
          ? { kind: 'numeric', truth, unit: String(p.unit), tolerance: { rel: SYNTHETIC.relTol }, units: byteUnitChoices(String(p.unit), ['MB', 'GB', 'TB', 'MiB', 'GiB']) }
          : { kind: 'numeric', truth, unit: 'FLOP/B', tolerance: { rel: SYNTHETIC.relTol } }
      break
    case 'fp8-ridge':
      // a tile side is whole, as smem-fit's is: the stem says to round up, and only that side passes
      answer = p.ask === 'tile' ? { kind: 'numeric', truth, unit: 'elements', tolerance: { abs: SYNTHETIC.countTol } } : { kind: 'numeric', truth, unit: 'FLOP/B', tolerance: { rel: SYNTHETIC.relTol } }
      break
    default:
      answer = { kind: 'numeric', truth, unit: 'FLOP/B', tolerance: { rel: SYNTHETIC.relTol } }
  }
  // level 0 shows every step with the last blanked; level 1 blanks one in the middle
  const full = steps(vs.id, p, truth)
  const blankAt = level === 0 ? full.length - 1 : Math.floor((full.length - 1) / 2)
  const worked = level < 2 ? full.map((s, i) => (i === blankAt ? blanked(s) : s)) : undefined
  return finishInstance(gen, {
    variant: vs.id,
    seed,
    level,
    params: p,
    kcs: [...vs.kcs],
    prompt: { stem, ...(givens ? { givens } : {}), ...(worked ? { worked } : {}) },
    answer,
    claims: claims.map(claimRef),
    nsec: vs.nsec,
  })
}

/* ------------------------------ drawing params ------------------------------ */

const range = (lo: number, hi: number, by = 1): number[] => Array.from({ length: Math.floor((hi - lo) / by) + 1 }, (_, i) => lo + i * by)
/** Two significant digits: 10–99, then 100–990 in tens. */
const ROUND_BUDGETS = [...range(SYNTHETIC.budgetMin, SYNTHETIC.budgetMax).filter((x) => x < 100 || x % 10 === 0), 256] // gen-literal-ok: 2^8 KiB is round too
const ALL_BUDGETS = range(SYNTHETIC.budgetMin, SYNTHETIC.budgetMax)
const SIDES = range(SYNTHETIC.sideStep, SYNTHETIC.sideMax, SYNTHETIC.sideStep)
const SEQS = range(SYNTHETIC.seqStep, SYNTHETIC.seqMax, SYNTHETIC.seqStep)
const pct = (r: Rng, share: number): boolean => r.int(0, 100 - 1) < share
/** The dtype of the slabs: FP16 below the transfer level, FP8 or FP32 at it. */
const slabDtype = (level: Level, r: Rng, fp32: boolean): Dtype => (level === TRANSFER ? r.pick<Dtype>(fp32 ? ['fp8', 'fp32'] : ['fp8']) : 'fp16')

/** Whether a square tile of side `side` holds more FP32 accumulators than an H100 SM's register file. */
const pastRegisters = (side: number): boolean => side * side * REG_BYTES > H100.regBytesPerSm

/** Draws until `ok`, then falls back to `fallback`: deterministic, and never an unanswerable item. */
function drawUntil(once: () => Params, ok: (p: Params) => boolean, fallback: Params): Params {
  for (let i = 0; i < SYNTHETIC.tries; i++) {
    const p = once()
    if (ok(p)) return p
  }
  return fallback
}

function draw(variant: string, level: Level, r: Rng): Params {
  switch (variant) {
    case 'smem-fit':
      return drawUntil(
        () => {
          const base = { k: r.pick(SYNTHETIC.slabK), stages: r.pick(SYNTHETIC.stages), dtype: slabDtype(level, r, true) }
          return pct(r, SYNTHETIC.realPct) ? { hw: 'h100', ...base } : { hw: 'synthetic', budget: r.pick(level === 0 ? ROUND_BUDGETS : ALL_BUDGETS), ...base }
        },
        (p) => {
          const side = truthOf('smem-fit', p)
          return side >= TILE_STEP && side <= SYNTHETIC.maxSide
        },
        { hw: 'h100', k: BASE.k, stages: BASE.stages, dtype: 'fp16' },
      )
    case 'ctas-per-sm': {
      const sides = level === 0 ? SYNTHETIC.roundSides : SIDES
      return drawUntil(
        () => ({ hw: 'h100', tm: r.pick(sides), tn: r.pick(sides), k: r.pick(SYNTHETIC.ctasSlabK), stages: r.pick(SYNTHETIC.ctasStages), dtype: slabDtype(level, r, false) }),
        (p) => truthOf('ctas-per-sm', p) >= 1,
        { hw: 'h100', tm: BASE.tm, tn: BASE.tn, k: BASE.k, stages: BASE.stages, dtype: 'fp16' },
      )
    }
    case 'raster-ai': {
      const gemm = level === 0 ? SYNTHETIC.roundGemm : SYNTHETIC.gemm
      return drawUntil(
        () => {
          const base = { hw: 'h100', tm: r.pick(SYNTHETIC.waveTiles), tn: r.pick(SYNTHETIC.waveTiles), m: r.pick(gemm), n: r.pick(gemm), dtype: slabDtype(level, r, false) }
          return pct(r, SYNTHETIC.groupedPct) ? { ...base, raster: 'grouped', group: r.int(SYNTHETIC.groupMin, SYNTHETIC.groupMax) } : { ...base, raster: 'row' }
        },
        (p) => {
          const w = waveOf(p)
          // a full wave that fits L2, and for a grouped one a group no taller than the grid, which moves the answer off the row raster
          if (w.tiles < H100.smCount || !w.fits) return false
          return p.raster === 'row' || (num(p, 'group') <= num(p, 'm') / num(p, 'tm') && truthOf('raster-ai', { ...p, raster: 'row' }) !== w.ai)
        },
        { hw: 'h100', tm: BASE.tm, tn: BASE.tn, m: WAVE_GEMM, n: WAVE_GEMM, dtype: 'fp16', raster: 'grouped', group: WAVE_GROUP },
      )
    }
    case 'fp8-ridge': {
      const ask = r.int(0, 1) === 0 ? 'ridge' : 'tile'
      return drawUntil(
        () => {
          const chip: Params = pct(r, SYNTHETIC.realPct) ? { hw: 'h100' } : { hw: 'synthetic', peak: r.int(SYNTHETIC.peakMin, SYNTHETIC.peakMax) * 10, bw: r.int(SYNTHETIC.bwMin, SYNTHETIC.bwMax) / 10 }
          const bench: Params = level === TRANSFER ? { fc: r.int(SYNTHETIC.fracMin, SYNTHETIC.fracMax), fb: r.int(SYNTHETIC.fracMin, SYNTHETIC.fracMax) } : {}
          return { ...chip, ...bench, ask }
        },
        // the tile that reaches the ridge must be one no CTA can hold, as the solution says
        (p) => ask === 'ridge' || pastRegisters(truthOf('fp8-ridge', p)),
        { hw: 'h100', ask },
      )
    }
    default: {
      const seq = r.pick(level === 0 ? SYNTHETIC.roundSeq : SEQS)
      const dtype = slabDtype(level, r, false)
      if (r.int(0, 1) === 0) return { seq, d: r.pick(SYNTHETIC.headDims), br: r.pick(SYNTHETIC.blockRows), dtype, ask: 'ai' }
      const heads = r.pick(SYNTHETIC.heads)
      const batch = r.pick(SYNTHETIC.batch)
      const total = scoreBytes(seq, dtype) * heads * batch
      return { seq, d: r.pick(SYNTHETIC.headDims), heads, batch, dtype, ask: 'score', unit: total >= BYTE_UNITS.GiB ? 'GiB' : 'MiB' }
    }
  }
}

function make(seed: number, level: Level, variant?: string): Instance {
  const vs = resolveVariant(gen, seed, level, variant)
  return build(vs, level, seed, draw(vs.id, level, rngFor(gen.id, vs.id, level, seed)))
}

/* ------------------------------ grading ------------------------------ */

/** A slip's answer over the truth, or null where the slip does not move the answer far enough to tell. */
function slip(i: Instance, wrong: number): number | null {
  const a = i.answer
  if (a.kind === 'choice' || !(wrong > 0)) return null
  const rho = wrong / a.truth
  return Math.abs(rho - 1) <= SYNTHETIC.apart ? null : rho
}
const is = (i: Instance, ...ids: string[]): boolean => ids.includes(i.variant)

const RATIO_RULES: RatioRule[] = [
  {
    id: 'tiling.single-buffer',
    ratio: (i) => (is(i, 'smem-fit', 'ctas-per-sm') && num(i.params, 'stages') > 1 ? slip(i, truthOf(i.variant, { ...i.params, stages: 1 })) : null),
    message: 'You sized one stage of slabs. The kernel keeps every stage in flight so loads overlap the math, and each stage takes its own shared memory.',
  },
  {
    id: 'tiling.fp32-bytes',
    ratio: (i) => {
      if (i.params.dtype === 'fp32' || (is(i, 'fp8-ridge') && i.params.ask !== 'tile')) return null
      // the tile that reaches the ridge with 4-byte elements: intensity T ÷ 4, so ⌈4 × ridge⌉
      if (is(i, 'fp8-ridge')) return slip(i, tileToReach(ridgeOf(i.params), 'fp32'))
      return slip(i, truthOf(i.variant, { ...i.params, dtype: 'fp32' }))
    },
    message: (i) => `You used 4-byte elements. This tile is ${i.variant === 'fp8-ridge' ? 'FP8' : dtName(i.params)}: ${f(bytesOf(i.variant === 'fp8-ridge' ? 'fp8' : dt(i.params)))} B per value. Only the accumulators are FP32, and they stay in registers.`,
  },
  {
    id: 'tiling.smem-only',
    ratio: (i) => {
      if (!is(i, 'ctas-per-sm')) return null
      const o = occupancy(cfg(i.params))
      return o.limit === 'registers' ? slip(i, o.bySmem) : null
    },
    message: 'You counted shared memory only. Each CTA also holds its tile of C as FP32 accumulators in the register file, and here the registers run out first.',
  },
  {
    id: 'tiling.row-panels',
    ratio: (i) => (is(i, 'raster-ai') && i.params.raster === 'grouped' ? slip(i, truthOf('raster-ai', { ...i.params, raster: 'row' })) : null),
    message: 'You counted the panels of a row-major wave. In groups the same number of tiles covers a near-square block, touching far fewer A and B panels.',
  },
  {
    id: 'tiling.fp8-same-ridge',
    // the BF16 ridge, or the whole tile that reaches it
    ratio: (i) => {
      if (!is(i, 'fp8-ridge')) return null
      return i.params.ask === 'tile' ? slip(i, tileToReach(ridgeOf(i.params) / FP8_OVER_BF16, 'fp8')) : 1 / FP8_OVER_BF16
    },
    message: 'You kept the BF16 ridge. FP8 tensor cores run twice as fast against the same bandwidth, so the ridge doubles.',
  },
  {
    id: 'tiling.counted-c',
    // C counted as a third face: a square tile's intensity becomes 2T ÷ 3b instead of 2T ÷ 2b, so T must be 3/2 as big, rounded up
    ratio: (i) => (is(i, 'fp8-ridge') && i.params.ask === 'tile' ? slip(i, tileToReach((ridgeOf(i.params) * (2 + 1)) / 2, 'fp8')) : null),
    message: 'You counted C’s face as traffic. C stays in registers across the K loop and is written once, so each step reads only the A and B slabs.',
  },
  {
    id: 'tiling.materialized',
    ratio: (i) => {
      if (!is(i, 'qblock-ai') || i.params.ask === 'score') return null
      const q = qOf(i.params)
      const bytes = bytesOf(q.dtype) * 2 * q.d * (q.n + q.br)
      return slip(i, (truthOf('qblock-ai', i.params) * bytes) / (bytes + q.br * q.n * bytesOf(q.dtype)))
    },
    message: 'You counted the block’s slice of S as HBM traffic. FlashAttention keeps S on chip: it reads K and V once and never writes the scores.',
  },
]

const pin = (name: string, source: string, variant: string, p: Params, truth: number, tolerance: { abs?: number; rel?: number }) => ({
  name,
  source,
  make: () => build(spec(variant), 2, 1, p),
  truth,
  tolerance,
})

const gen: Gen = {
  id: 'tiling',
  // v2: fp8-ridge's tile ask is the whole side that reaches the ridge (591 on H100), graded exactly
  version: 2,
  title: 'Tiling: shared memory, occupancy, raster order, FP8 and FlashAttention',
  kcs: ['t4.shared-memory-scratchpad', 't4.occupancy', KC.rasterL2Reuse, KC.ridgePoint, 't4.flashattention-blocking'],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution: (inst) => steps(inst.variant, inst.params, inst.answer.kind === 'choice' ? 0 : inst.answer.truth),
  pins: [
    // gen-literal-ok: the cube's level-2 pin, 448
    pin('The largest square FP16 tile whose slabs fit 227 KiB at k = 64, 2 stages (cube level 2)', 'tiling-cube', 'smem-fit', { hw: 'h100', k: BASE.k, stages: BASE.stages, dtype: 'fp16' }, 448, { abs: 0 }),
    // gen-literal-ok: the cube's level-3 pin, 3 CTAs
    pin('CTAs per SM of a 128 x 128 FP16 tile, k = 64, 2 stages (cube level 3)', 'tiling-cube', 'ctas-per-sm', { hw: 'h100', tm: BASE.tm, tn: BASE.tn, k: BASE.k, stages: BASE.stages, dtype: 'fp16' }, 3, { abs: 0 }),
    // gen-literal-ok: the cube's level-4 row-major pin, 130.0
    pin('A row-major 132-CTA wave on a 16,384^3 GEMM, 128 x 128 FP16 (cube level 4)', 'tiling-cube', 'raster-ai', { hw: 'h100', tm: BASE.tm, tn: BASE.tn, m: WAVE_GEMM, n: WAVE_GEMM, dtype: 'fp16', raster: 'row' }, 130.0, { abs: 0.05 }),
    // gen-literal-ok: the cube's level-4 grouped pin, 734.6
    pin('The same wave grouped 11 x 12 (cube level 4)', 'tiling-cube', 'raster-ai', { hw: 'h100', tm: BASE.tm, tn: BASE.tn, m: WAVE_GEMM, n: WAVE_GEMM, dtype: 'fp16', raster: 'grouped', group: WAVE_GROUP }, 734.6, { abs: 0.05 }),
    // gen-literal-ok: the cube's level-5 pin, the H100 FP8 ridge 590.4
    pin('The H100 FP8 ridge, 2 x BF16 dense over HBM (cube level 5)', 'tiling-cube', 'fp8-ridge', { hw: 'h100', ask: 'ridge' }, 590.4, { abs: 0.05 }),
    // gen-literal-ok: the cube's level-5 tile pin, the whole side 591 that reaches 590.4
    pin('The smallest whole square FP8 tile side that reaches the H100 ridge (cube level 5)', 'tiling-cube', 'fp8-ridge', { hw: 'h100', ask: 'tile' }, 591, { abs: 0 }),
    // gen-literal-ok: the cube's level-6 pin, 127.5
    pin('A 128-row FlashAttention query block at N = 32,768, d = 128, FP16 (cube level 6)', 'tiling-cube', 'qblock-ai', { seq: QBLOCK.n, d: QBLOCK.d, br: QBLOCK.br, dtype: 'fp16', ask: 'ai' }, 127.5, { abs: 0.05 }),
    pin('The N x N FP16 score matrix of one head at N = 32,768, in GiB (cube level 6)', 'tiling-cube', 'qblock-ai', { seq: QBLOCK.n, d: QBLOCK.d, heads: 1, batch: 1, dtype: 'fp16', ask: 'score', unit: 'GiB' }, 2, { abs: 0 }),
  ],
  bank: { units: SYNTHETIC.bankUnits },
}

export default gen
