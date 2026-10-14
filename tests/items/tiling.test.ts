import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkChoiceCues, checkFamily, checkHashes, genSeeds, lintLiterals, readHashRows, responseFromSolution } from '../../scripts/verify-generators'
import { KCS } from '../../src/data/kc'
import { partsText } from '../../src/lib/items/core'
import tiling from '../../src/lib/items/families/tiling'
import { correctResponse } from '../../src/lib/items/grade'
import type { Instance, Level, Response } from '../../src/lib/items/types'
import { KIB } from '../../src/lib/items/units'
import { BASE, H100, maxTile, occupancy, QBLOCK, qBlockAI, ridge, waveAI, WAVE_GEMM, WAVE_GROUP } from '../../src/lib/world/tiling'

/** The `tiling` family (docs/specs/wave-3.md §6.2, task 3a-13): levels 2-6 of the Tiling Cube as numeric items. */
const SEEDS = genSeeds(300)
const LEVELS: Level[] = [0, 1, 2, 3]
const FILE = new URL('../../src/lib/items/families/tiling.ts', import.meta.url)

function find(variant: string, level: Level, pred: (i: Instance) => boolean): Instance {
  for (const seed of SEEDS) {
    const i = tiling.make(seed, level, variant)
    if (pred(i)) return i
  }
  throw new Error(`no ${variant}@L${level} instance matches`)
}

const truthOf = (i: Instance): number => (i.answer.kind === 'numeric' ? i.answer.truth : Number.NaN)
const unitOf = (i: Instance): string => (i.answer.kind === 'numeric' ? i.answer.unit : '')
const answer = (i: Instance, value: number): Response => ({ kind: 'numeric', value, unit: unitOf(i) })
const diagnosisOf = (i: Instance, value: number): string | undefined => tiling.grade(i, answer(i, value)).diagnosis?.id

describe('tiling: the §5.6 suite', () => {
  test('passes at 100 seeds with no problems and no dead rules', () => {
    const r = checkFamily(tiling, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.instances).toBe(100 * 5 * 4)
  })

  test('its hash rows match the fixture', () => {
    const rows = readHashRows('tiling') // tests/fixtures/items/hashes/tiling.json
    expect(checkHashes(tiling, rows)).toEqual([])
    expect(Object.keys(rows.tiling).sort()).toEqual(tiling.variants.map((v) => v.id).sort())
  })

  test('its source passes the literal lint with nothing annotated away but the named definitions and pins', () => {
    expect(lintLiterals(FILE.pathname, readFileSync(FILE, 'utf8'))).toEqual([])
  })

  test('declares the five variants of cube levels 2-6 at levels 0 to 3; Gen.kcs is §4.3’s row, the KCs whose gen lists tiling', () => {
    expect(tiling.variants.map((v) => v.id)).toEqual(['smem-fit', 'ctas-per-sm', 'raster-ai', 'fp8-ridge', 'qblock-ai'])
    for (const v of tiling.variants) expect(v.levels).toEqual([0, 1, 2, 3])
    const row = ['t4.flashattention-blocking', 't4.occupancy', 't4.raster-l2-reuse', 't4.ridge-point', 't4.shared-memory-scratchpad']
    expect([...tiling.kcs].sort()).toEqual(row)
    expect(KCS.filter((k) => k.gen?.includes('tiling')).map((k) => k.id).sort()).toEqual(row)
    expect(tiling.variants.map((v) => v.kcs)).toEqual([['t4.shared-memory-scratchpad'], ['t4.occupancy'], ['t4.raster-l2-reuse'], ['t4.ridge-point'], ['t4.flashattention-blocking']])
  })

  test('every answer is numeric, so the blind-strategy gate has no choice variant to judge', () => {
    for (const v of tiling.variants) for (const level of LEVELS) for (const seed of SEEDS.slice(0, 20)) expect(tiling.make(seed, level, v.id).answer.kind).toBe('numeric')
    expect(checkChoiceCues(tiling, { seeds: 200 })).toEqual({ problems: [], rows: [] })
  })

  test('make is a pure function of (seed, level, variant); an unspecified variant is chosen by the seed', () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS.slice(0, 20)) expect(tiling.make(seed, level)).toEqual(tiling.make(seed, level))
      expect(new Set(SEEDS.map((s) => tiling.make(s, level).variant)).size).toBe(5)
    }
  })

  test('every solution ends on a gradable answer, and levels 0 and 1 show worked steps with one blanked', () => {
    for (const v of tiling.variants) {
      for (const level of LEVELS) {
        const i = tiling.make(SEEDS[7], level, v.id)
        const r = responseFromSolution(i, tiling.solution(i))
        expect(r).toBeDefined()
        expect(tiling.grade(i, r as Response).score).toBe(1)
        const worked = i.prompt.worked ?? []
        expect(worked.filter((s) => s.blank).length).toBe(level < 2 ? 1 : 0)
      }
    }
  })
})

describe('tiling: the pins are the cube’s', () => {
  const pinTruth = (part: string): number => {
    const p = tiling.pins.find((x) => x.name.includes(part))
    if (!p) throw new Error(`no pin "${part}"`)
    return truthOf(p.make())
  }

  test('448, 3 CTAs, 130.0 and 734.6, 590.4, 127.5 and 2 GiB, each equal to the model', () => {
    expect(pinTruth('fit 227 KiB')).toBe(448)
    expect(pinTruth('fit 227 KiB')).toBe(maxTile(64, 2, 'fp16'))
    expect(pinTruth('CTAs per SM')).toBe(3)
    expect(pinTruth('row-major').toFixed(1)).toBe('130.0')
    expect(pinTruth('grouped 11 x 12').toFixed(1)).toBe('734.6')
    expect(pinTruth('grouped 11 x 12')).toBe(waveAI({ ...BASE, m: WAVE_GEMM, n: WAVE_GEMM, raster: 'grouped', group: WAVE_GROUP }).ai)
    expect(pinTruth('FP8 ridge')).toBe(ridge('fp8'))
    expect(pinTruth('query block')).toBe(qBlockAI(QBLOCK))
    expect(pinTruth('score matrix')).toBe(2)
  })

  test('every pin grades its own true answer ok, and the H100 pins cite their claims', () => {
    for (const p of tiling.pins) {
      const i = p.make()
      expect(tiling.grade(i, correctResponse(i)).ok).toBe(true)
    }
    const fit = tiling.pins[0].make()
    expect(fit.claims.map((c) => c.split('@')[0])).toEqual(['hw.h100-sxm.smem-per-block'])
    const ridgePin = tiling.pins.find((p) => p.name.includes('FP8 ridge'))!.make()
    expect(ridgePin.claims.map((c) => c.split('@')[0])).toEqual(['hw.h100-sxm.bf16-dense', 'hw.h100-sxm.hbm-bw'])
  })
})

describe('tiling: claim-backed and hypothetical scenes', () => {
  test('an H100 scene stores no claim value in its params and cites the claims its chips show', () => {
    for (const v of tiling.variants) {
      for (const level of LEVELS) {
        for (const seed of SEEDS.slice(0, 60)) {
          const i = tiling.make(seed, level, v.id)
          const chips = [...i.prompt.stem, ...(i.prompt.givens ?? []).map((g) => g.value)].filter((p) => p.t === 'claim').map((p) => (p.t === 'claim' ? p.claim : ''))
          for (const c of chips) expect(i.claims.some((x) => x.startsWith(`${c}@`))).toBe(true)
          expect(i.claims.length).toBe(chips.length)
          for (const k of ['smemPerSm', 'smemPerBlock', 'l2', 'smCount', 'hbm']) expect(i.params[k]).toBeUndefined()
          if (i.params.hw === 'synthetic') expect(partsText(i.prompt.stem)).toContain('hypothetical')
        }
      }
    }
  })

  test('smem-fit and fp8-ridge draw both an H100 scene and a hypothetical one at every level', () => {
    for (const variant of ['smem-fit', 'fp8-ridge']) {
      for (const level of LEVELS) {
        const hw = new Set(SEEDS.map((s) => String(tiling.make(s, level, variant).params.hw)))
        expect([...hw].sort()).toEqual(['h100', 'synthetic'])
      }
    }
  })

  test('the transfer level changes the surface: FP8 or FP32 slabs, FP8 waves and blocks, sustained FP8 figures', () => {
    const dtypes = (variant: string, level: Level) => new Set(SEEDS.map((s) => String(tiling.make(s, level, variant).params.dtype)))
    for (const variant of ['smem-fit', 'ctas-per-sm', 'raster-ai', 'qblock-ai']) {
      expect([...dtypes(variant, 2)]).toEqual(['fp16'])
      expect(dtypes(variant, 3).has('fp8')).toBe(true)
    }
    expect(dtypes('smem-fit', 3).has('fp32')).toBe(true)
    for (const seed of SEEDS.slice(0, 40)) {
      expect(tiling.make(seed, 3, 'fp8-ridge').params.fc).toBeDefined()
      expect(tiling.make(seed, 2, 'fp8-ridge').params.fc).toBeUndefined()
    }
  })

  test('every FP8 tile the family asks for is past an H100 SM’s register file, as its solution says', () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const i = tiling.make(seed, level, 'fp8-ridge')
        if (i.params.ask !== 'tile') continue
        const t = truthOf(i)
        expect(t * t * 4).toBeGreaterThan(H100.regBytesPerSm)
        expect(partsText(tiling.solution(i).at(-1)!.text)).toContain('register file')
      }
    }
  })

  test('every ctas-per-sm item has at least one CTA resident, and every raster-ai wave is full and fits L2', () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        expect(truthOf(tiling.make(seed, level, 'ctas-per-sm'))).toBeGreaterThanOrEqual(1)
        const w = tiling.make(seed, level, 'raster-ai').params
        const wave = waveAI({ ...BASE, tm: Number(w.tm), tn: Number(w.tn), m: Number(w.m), n: Number(w.n), raster: w.raster === 'grouped' ? 'grouped' : 'row', group: Number(w.group ?? 1) })
        expect(wave.tiles).toBe(H100.smCount)
        expect(wave.fits).toBe(true)
      }
    }
  })
})

describe('tiling: each diagnosis, computed by running the model with the slip', () => {
  test('tiling.single-buffer: one stage of slabs in smem-fit and ctas-per-sm', () => {
    const i = tiling.pins[0].make()
    // 227 KiB ÷ (1 × 2 × 64 × 2 B) = 908, so 896
    expect(maxTile(64, 1, 'fp16')).toBe(896)
    expect(diagnosisOf(i, 896)).toBe('tiling.single-buffer')
    const c = find('ctas-per-sm', 2, (x) => occupancy({ tm: Number(x.params.tm), tn: Number(x.params.tn), k: Number(x.params.k), stages: 1, dtype: 'fp16' }).ctas > truthOf(x) && Number(x.params.stages) > 1)
    const one = occupancy({ tm: Number(c.params.tm), tn: Number(c.params.tn), k: Number(c.params.k), stages: 1, dtype: 'fp16' }).ctas
    expect(diagnosisOf(c, one)).toBe('tiling.single-buffer')
  })

  test('tiling.fp32-bytes: 4-byte elements halve an FP16 wave’s intensity and quarter the reach of an FP8 tile', () => {
    const w = tiling.pins.find((p) => p.name.includes('row-major'))!.make()
    expect(diagnosisOf(w, truthOf(w) / 2)).toBe('tiling.fp32-bytes')
    const t = find('fp8-ridge', 2, (x) => x.params.ask === 'tile')
    expect(diagnosisOf(t, truthOf(t) * 4)).toBe('tiling.fp32-bytes')
  })

  test('tiling.smem-only: counting shared memory alone where the registers bind', () => {
    const i = find('ctas-per-sm', 2, (x) => occupancy({ tm: Number(x.params.tm), tn: Number(x.params.tn), k: Number(x.params.k), stages: Number(x.params.stages), dtype: 'fp16' }).limit === 'registers')
    const o = occupancy({ tm: Number(i.params.tm), tn: Number(i.params.tn), k: Number(i.params.k), stages: Number(i.params.stages), dtype: 'fp16' })
    expect(o.bySmem).toBeGreaterThan(o.byRegs)
    expect(diagnosisOf(i, o.bySmem)).toBe('tiling.smem-only')
  })

  test('tiling.row-panels: the row raster’s 130.0 for the grouped wave', () => {
    const g = tiling.pins.find((p) => p.name.includes('grouped 11 x 12'))!.make()
    const row = tiling.pins.find((p) => p.name.includes('row-major'))!.make()
    expect(diagnosisOf(g, truthOf(row))).toBe('tiling.row-panels')
    // a row-major wave has no grouped slip to make
    expect(diagnosisOf(row, truthOf(g))).toBeUndefined()
  })

  test('tiling.fp8-same-ridge: keeping 295.2 for the FP8 ridge', () => {
    const r = tiling.pins.find((p) => p.name.includes('FP8 ridge'))!.make()
    expect(diagnosisOf(r, ridge('bf16'))).toBe('tiling.fp8-same-ridge')
  })

  test('tiling.counted-c: counting C’s face makes the FP8 tile 3/2 as big', () => {
    const t = find('fp8-ridge', 2, (x) => x.params.ask === 'tile')
    expect(diagnosisOf(t, truthOf(t) * 1.5)).toBe('tiling.counted-c')
  })

  test('tiling.materialized: the block’s slice of S counted as traffic', () => {
    const q = tiling.pins.find((p) => p.name.includes('query block'))!.make()
    // bytes grow by Br × N × 2 B: 2·128·32,896·2 → + 128·32,768·2
    const base = 2 * 2 * 128 * (32768 + 128)
    const slipped = (truthOf(q) * base) / (base + 128 * 32768 * 2)
    expect(diagnosisOf(q, slipped)).toBe('tiling.materialized')
  })

  test('a right answer is never a slip; the score ask in GiB takes the same bytes in GB, and names a MiB figure written as GiB', () => {
    for (const p of tiling.pins) {
      const i = p.make()
      expect(tiling.grade(i, correctResponse(i)).diagnosis).toBeUndefined()
    }
    const s = tiling.pins.find((p) => p.name.includes('score matrix'))!.make()
    expect(tiling.grade(s, { kind: 'numeric', value: (2 * 1024 * KIB * KIB) / 1e9, unit: 'GB' }).ok).toBe(true)
    expect(diagnosisOf(s, 2048)).toBe('unit.kibi')
  })
})
