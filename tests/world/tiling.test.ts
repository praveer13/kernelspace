import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { practiceBandOf } from '../../scripts/verify-plays'
import { claimNumber, getClaim } from '../../src/data/claims'
import tilingFamily from '../../src/lib/items/families/tiling'
import { GIB, KIB } from '../../src/lib/items/units'
import { band, checkCubeBand, cubeBandResult, levelInstance, MIN_RASTER_RATIO } from '../../src/lib/world/bands/tiling-cube'
import {
  BASE,
  CUBE_LEVELS,
  CUBE_PRACTICE_SEED,
  ctasPerSm,
  H100,
  maxRunnableTile,
  maxTile,
  occupancy,
  PLAN_FIGURES,
  QBLOCK,
  qBlockAI,
  ridge,
  rowBound,
  scoreBytes,
  smemBytes,
  tileAI,
  tileAt,
  tileToReach,
  waveAI,
  WAVE_GEMM,
  WAVE_GROUP,
  type TilingHw,
} from '../../src/lib/world/tiling'

/**
 * The Tiling Cube's model (docs/specs/wave-3.md §6.1, task 3a-13): the six levels' pins on the §4.4 claims, the
 * debriefs' reference tiles, and the cube's practice band.
 */
const ROOT = resolve(import.meta.dir, '../..')
const square = (t: number) => ({ ...BASE, tm: t, tn: t })
const wave = { ...BASE, m: WAVE_GEMM, n: WAVE_GEMM, group: WAVE_GROUP }

describe('the hardware comes from claims', () => {
  test('H100 SXM: SMEM, registers, SM count, L2, HBM and BF16 dense read the claims; FP8 is 2 × BF16 dense', () => {
    expect(H100.smemPerSm).toBe(claimNumber('hw.h100-sxm.smem-per-sm') * KIB)
    expect(H100.smemPerBlock).toBe(227 * KIB)
    expect(H100.regBytesPerSm).toBe(claimNumber('hw.h100-sxm.registers-per-sm') * 4)
    expect(H100.regBytesPerSm).toBe(256 * KIB)
    expect(H100.smCount).toBe(claimNumber('hw.h100-sxm.sm-count'))
    expect(H100.l2Bytes).toBe(50e6)
    expect(H100.hbmBps).toBeCloseTo(claimNumber('hw.h100-sxm.hbm-bw') * 1e12, 0)
    expect(H100.fp8Flops).toBe(2 * H100.bf16Flops)
  })

  test('the FP8 claim (1,979 dense) is within 1 TFLOPS of 2 × 989, the one FP8 rule the cube, RooflineSim and the roofline family share', () => {
    const bf16 = claimNumber('hw.h100-sxm.bf16-dense')
    expect(bf16).toBe(989)
    expect(Math.abs(claimNumber('hw.h100-sxm.fp8-dense') - 2 * bf16)).toBeLessThanOrEqual(1)
    expect(getClaim('hw.h100-sxm.fp8-dense').derived?.from).toEqual(['hw.h100-sxm.fp8-sparse'])
  })
})

describe('the six levels: the §6.1 pins', () => {
  test('level 1: a 128 × 128 FP16 tile does 64 FLOP/B (T ÷ 2); FP8 doubles it, a rectangle sits between its sides', () => {
    expect(tileAI(BASE, 'fp16')).toBe(64)
    expect(tileAI(BASE, 'fp8')).toBe(128)
    expect(tileAI({ tm: 128, tn: 256 }, 'fp16')).toBeCloseTo(85.33, 2)
  })

  test('level 2: the largest square tile whose slabs fit 227 KiB at k = 64, 2 stages is 448 (SMEM only), and it cannot run', () => {
    expect(smemBytes(BASE)).toBe(64 * KIB)
    expect(maxTile(64, 2, 'fp16')).toBe(448)
    expect(smemBytes(square(448))).toBeLessThanOrEqual(H100.smemPerBlock)
    expect(smemBytes(square(480))).toBeGreaterThan(H100.smemPerBlock)
    expect(tileAI(square(448), 'fp16')).toBe(224)
    expect(tileAI(square(448), 'fp16')).toBeLessThan(ridge('bf16'))
    // its FP32 accumulators, 448² × 4 B = 784 KiB, overflow the 256 KiB register file
    expect(occupancy(square(448))).toEqual({ bySmem: 1, byRegs: 0, ctas: 0, limit: 'registers' })
    expect(ctasPerSm(square(448))).toBe(0)
    expect(maxRunnableTile(64, 2, 'fp16')).toBe(256)
    expect(ctasPerSm(square(288))).toBe(0)
  })

  test('level 3: 3 CTAs per SM at T = 128 (shared memory binds; registers allow 4); 7 at T = 64; 1 at T = 256', () => {
    expect(occupancy(BASE)).toEqual({ bySmem: 3, byRegs: 4, ctas: 3, limit: 'smem' })
    expect(ctasPerSm(square(64))).toBe(7)
    expect(ctasPerSm(square(256))).toBe(1)
  })

  test('level 3: slabs over the 227 KiB per-block limit cannot launch, though ⌊228 KiB ÷ smem⌋ would be 1', () => {
    // 1 stage, (Tm + Tn) × k × 1 B = 455 × 512 B = 227.5 KiB: past the per-block limit, under the SM's 228
    const c = { tm: 227, tn: 228, k: 512, stages: 1, dtype: 'fp8' as const }
    expect(smemBytes(c)).toBe(227 * KIB + KIB / 2)
    expect(Math.floor(H100.smemPerSm / smemBytes(c))).toBe(1)
    expect(occupancy(c)).toEqual({ bySmem: 0, byRegs: 1, ctas: 0, limit: 'smem' })
  })

  test('level 4: one 132-CTA wave on the 16,384³ GEMM is 130.0 FLOP/B row-major and 734.6 grouped 11 × 12, 5.7× apart', () => {
    const row = waveAI({ ...wave, raster: 'row' })
    const grouped = waveAI({ ...wave, raster: 'grouped' })
    expect([row.tiles, row.rows, row.cols]).toEqual([132, 2, 128])
    expect([grouped.tiles, grouped.rows, grouped.cols]).toEqual([132, 11, 12])
    expect(row.ai.toFixed(1)).toBe('130.0')
    expect(grouped.ai.toFixed(1)).toBe('734.6')
    expect((grouped.ai / row.ai).toFixed(1)).toBe('5.7')
    // the L2 window: stages × (rows + columns) slabs of 16 KiB fit 50 MB for both
    expect(row.l2Bytes).toBe(2 * 130 * 16 * KIB)
    expect(grouped.l2Bytes).toBe(2 * 23 * 16 * KIB)
    expect(row.fits && grouped.fits).toBe(true)
  })

  test("level 4: the plan's figures trace to the same model: one row's bound 127.0, and 128 × 256 grouped 11 × 12 at 965.5", () => {
    expect(PLAN_FIGURES.rowBound.toFixed(1)).toBe('127.0')
    expect(rowBound(128, 16384)).toBe(PLAN_FIGURES.rowBound)
    expect(PLAN_FIGURES.grouped128x256.toFixed(1)).toBe('965.5')
  })

  test('level 5: the FP8 ridge is 590.4 (BF16 295.2), and the square tile that reaches it alone is T ≥ 591 at FP8 as at FP16', () => {
    expect(ridge('fp8').toFixed(1)).toBe('590.4')
    expect(ridge('bf16').toFixed(1)).toBe('295.2')
    expect(ridge('fp8')).toBeCloseTo(2 * ridge('bf16'), 9)
    expect(tileToReach(ridge('fp8'), 'fp8')).toBe(591)
    expect(tileToReach(ridge('bf16'), 'fp16')).toBe(591)
    expect(tileAI(square(591), 'fp8')).toBeGreaterThanOrEqual(ridge('fp8'))
    expect(tileAI(square(590), 'fp8')).toBeLessThan(ridge('fp8'))
    // arithmetic only: no CTA can hold it
    expect(ctasPerSm({ ...square(591), dtype: 'fp8' })).toBe(0)
  })

  test('level 6: a 128-row query block at N = 32,768, d = 128, FP16 does 127.5 FLOP/B, and S would be 2 GiB per head', () => {
    expect(qBlockAI(QBLOCK).toFixed(1)).toBe('127.5')
    expect(scoreBytes(QBLOCK.n, 'fp16')).toBe(2 * GIB)
    // d cancels: the block's intensity is 2·Br·N ÷ (b·(N + Br))
    expect(qBlockAI({ ...QBLOCK, d: 64 })).toBeCloseTo(qBlockAI(QBLOCK), 9)
  })
})

describe('raster order and the L2 window', () => {
  test("the grouped order is Triton's: down a column of `group` rows, then the next column; a short last group shrinks", () => {
    // a 5 × 4 grid in groups of 2 rows: (0,0) (1,0) (0,1) (1,1) … then rows 2-3, then the 1-row last group
    const cells = Array.from({ length: 20 }, (_, pid) => tileAt(pid, 5, 4, 'grouped', 2))
    expect(cells.slice(0, 4)).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]])
    expect(cells.slice(8, 10)).toEqual([[2, 0], [3, 0]])
    expect(cells.slice(16)).toEqual([[4, 0], [4, 1], [4, 2], [4, 3]])
    expect(new Set(cells.map((c) => c.join())).size).toBe(20)
    expect(tileAt(5, 5, 4, 'row', 2)).toEqual([1, 1])
  })

  test('a wave whose slabs overflow L2 says so, and a grid smaller than the SMs makes a short wave', () => {
    const tiny: TilingHw = { ...H100, l2Bytes: 1e6 }
    expect(waveAI({ ...wave, raster: 'row' }, tiny).fits).toBe(false)
    expect(waveAI({ ...wave, raster: 'grouped' }, tiny).fits).toBe(true)
    const short = waveAI({ ...BASE, m: 1024, n: 1024, raster: 'row', group: 1 })
    expect([short.tiles, short.rows, short.cols]).toEqual([64, 8, 8])
  })
})

describe('the debriefs (§6.3)', () => {
  test('six levels in order, level 1 on roofline/tile-ai and levels 2-6 on the five tiling variants', () => {
    expect(CUBE_LEVELS.map((l) => l.n)).toEqual([1, 2, 3, 4, 5, 6])
    expect(CUBE_LEVELS.map((l) => `${l.family}/${l.variant}`)).toEqual(['roofline/tile-ai', ...tilingFamily.variants.map((v) => `tiling/${v.id}`)])
    expect(CUBE_LEVELS.map((l) => l.kc)).toEqual(['t4.tiling-intensity', 't4.shared-memory-scratchpad', 't4.occupancy', 't4.raster-l2-reuse', 't4.ridge-point', 't4.flashattention-blocking'])
  })

  test('every tile a debrief names as a reference choice has ctasPerSm ≥ 1, or the debrief names the register cap', () => {
    for (const level of CUBE_LEVELS) {
      expect(level.reference.length).toBeGreaterThan(0)
      for (const tile of level.reference) {
        const runs = ctasPerSm(tile) >= 1
        if (!runs) expect(level.debrief).toMatch(/register cap/)
        expect(runs || /register cap/.test(level.debrief)).toBe(true)
      }
    }
    // not vacuous: levels 2 and 5 name a tile that cannot run, and say why
    const unrunnable = CUBE_LEVELS.filter((l) => l.reference.some((t) => ctasPerSm(t) === 0)).map((l) => l.n)
    expect(unrunnable).toEqual([2, 5])
  })

  test("the debriefs carry the model's numbers, not copies of the spec's", () => {
    const by = (id: string) => CUBE_LEVELS.find((l) => l.id === id)!.debrief
    expect(by('count')).toContain(`${tileAI(BASE, 'fp16')} FLOP/B`)
    expect(by('smem')).toContain(`${maxTile(64, 2, 'fp16')} × ${maxTile(64, 2, 'fp16')}`)
    expect(by('smem')).toContain('784 KiB')
    expect(by('occupancy')).toContain(`${ctasPerSm(BASE)} CTAs per SM`)
    expect(by('raster')).toContain(`${waveAI({ ...wave, raster: 'row' }).ai.toFixed(1)} FLOP/B`)
    expect(by('raster')).toContain(`${waveAI({ ...wave, raster: 'grouped' }).ai.toFixed(1)} FLOP/B`)
    expect(by('fp8')).toContain(`T ≥ ${tileToReach(ridge('fp8'), 'fp8')}`)
    expect(by('flash')).toContain(`${qBlockAI(QBLOCK).toFixed(1)} FLOP/B`)
  })
})

describe('the practice band (bands/tiling-cube.ts)', () => {
  test('the pinned practice seed is in band, and the band takes no loader because it reads no file', async () => {
    const r = await band()
    expect(r.ok).toBe(true)
    expect(r.detail).toContain(`practice seed ${CUBE_PRACTICE_SEED} is in band`)
    const check = checkCubeBand(CUBE_PRACTICE_SEED)
    expect(check.inBand).toBe(true)
    expect(check.rasterRatio).toBeGreaterThanOrEqual(MIN_RASTER_RATIO)
  })

  test('verify-plays finds the module by its play id', async () => {
    const r = await practiceBandOf('tiling-cube', ROOT)
    expect(r).toEqual({ inBand: true, note: (await band()).detail })
  })

  test('each practice instance is its level’s item at the play’s level', () => {
    for (const level of CUBE_LEVELS) {
      const i = levelInstance(level, CUBE_PRACTICE_SEED)
      expect(i.family).toBe(level.family)
      expect(i.variant).toBe(level.variant)
      expect(i.level).toBe(2)
    }
  })

  test('a seed whose instance has no slip to name, or whose rasters sit close, is out of band, and the detail says which level', () => {
    let missing: number | undefined
    for (let s = 0; s < 200 && missing === undefined; s++) if (checkCubeBand(s).problems[3].some((p) => p.includes('no diagnosis'))) missing = s
    expect(missing).toBeDefined()
    const r = cubeBandResult(checkCubeBand(missing!))
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('level 3: no diagnosis applies to it')

    let close: number | undefined
    for (let s = 0; s < 400 && close === undefined; s++) if (checkCubeBand(s).rasterRatio < MIN_RASTER_RATIO) close = s
    expect(close).toBeDefined()
    expect(cubeBandResult(checkCubeBand(close!)).detail).toMatch(/level 4: .*under 3×/)
  })

  test('a check that claims to be in band with a problem left is still out of band', () => {
    const check = checkCubeBand(CUBE_PRACTICE_SEED)
    expect(cubeBandResult({ ...check, problems: { ...check.problems, 6: ['the slip tiling.materialized is within the tolerance of the truth'] } }).ok).toBe(false)
    expect(cubeBandResult({ ...check, inBand: false }).ok).toBe(false)
  })
})
