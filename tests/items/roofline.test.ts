import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkFamily, checkHashes, genSeeds, lintLiterals, type HashRows } from '../../scripts/verify-generators'
import { atlasRow } from '../../src/data/atlas'
import { BOOT } from '../../src/lib/boot/model'
import { partsText } from '../../src/lib/items/core'
import { correctResponse } from '../../src/lib/items/grade'
import roofline from '../../src/lib/items/families/roofline'
import type { Instance, Level, Response } from '../../src/lib/items/types'

const FILE = new URL('../../src/lib/items/families/roofline.ts', import.meta.url)
const hashes = JSON.parse(readFileSync(new URL('../fixtures/items/hashes.json', import.meta.url), 'utf8')) as HashRows
const LEVELS = [0, 1, 2, 3] as const
const seeds = genSeeds(100)
const HW = ['h100', 'b200', 'a100-80', 'rtx4090', 't4', 'tpu7x']

const truthOf = (i: Instance): number => (i.answer.kind === 'choice' ? Number.NaN : i.answer.truth)
const numeric = (i: Instance, value: number): Response => ({ kind: i.answer.kind === 'estimate' ? 'estimate' : 'numeric', value, ...(i.answer.kind === 'numeric' ? { unit: i.answer.unit } : {}) }) as Response

/** Every instance of a variant over the 100 test seeds and four levels. */
function all(variant: string, levels: readonly Level[] = LEVELS): Instance[] {
  return levels.flatMap((l) => seeds.map((s) => roofline.make(s, l, variant)))
}

describe('the roofline family (§5.5)', () => {
  test('passes the whole §5.6 suite at 100 seeds, with no dead rule', () => {
    const r = checkFamily(roofline, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.instances).toBe(100 * 6 * 4)
  })

  test('declares the six variants at levels 0-3 and the four KCs', () => {
    expect(roofline.variants.map((v) => v.id)).toEqual(['ridge', 'bound', 'attainable', 'decode-b1', 'batch-to-ridge', 'tile-ai'])
    for (const v of roofline.variants) expect(v.levels).toEqual([0, 1, 2, 3])
    expect([...roofline.kcs].sort()).toEqual(['t4.bound-classification', 't4.decode-bandwidth', 't4.ridge-point', 't4.tiling-intensity'])
    expect(roofline.ratioRules.map((r) => r.id)).toEqual([
      'roofline.inverted-ridge',
      'roofline.sparse-flops',
      'roofline.tb-vs-gb',
      'roofline.bits-bytes',
      'roofline.elements-not-bytes',
    ])
  })

  test('the hash fixture has this family\'s rows and they match', () => {
    expect(Object.keys(hashes.roofline).sort()).toEqual(roofline.variants.map((v) => v.id).sort())
    expect(checkHashes(roofline, hashes)).toEqual([])
  })

  test('its source passes the literal lint', () => {
    expect(lintLiterals(FILE.pathname, readFileSync(FILE, 'utf8'))).toEqual([])
  })
})

describe('pins', () => {
  const pin = (needle: string) => roofline.pins.find((p) => p.name.includes(needle))!.make()

  test('H100 ridge 295.2, B200 ridge 281.25, decode 208.6 tok/s, 0.34 % busy, a 128 tile at 64', () => {
    expect(truthOf(pin('H100 ridge'))).toBeCloseTo(295.2, 1)
    expect(truthOf(pin('B200 ridge'))).toBe(281.25)
    expect(truthOf(pin('decode at batch 1'))).toBeCloseTo(208.6, 1)
    expect(truthOf(pin('0.34 %'))).toBeCloseTo(0.34, 2)
    expect(truthOf(pin('128 x 128'))).toBe(64)
    expect(roofline.pins).toHaveLength(5)
  })

  test('the Boot pins follow BOOT, the model the spec names as their source', () => {
    expect(truthOf(pin('H100 ridge'))).toBeCloseTo(BOOT.ridge, 1)
    expect(truthOf(pin('decode at batch 1'))).toBeCloseTo(BOOT.decodeTps, 1)
    expect(truthOf(pin('0.34 %'))).toBeCloseTo(BOOT.mathBusyBatch1 * 100, 2)
  })

  test('the busy pin says 0.34 % in its own prompt and the decode pin uses the Llama-3-8B claim', () => {
    expect(partsText(pin('0.34 %').prompt.stem)).toContain('share of the peak')
    const d = pin('decode at batch 1')
    expect(d.claims.some((c) => c.startsWith('model.llama3-8b.params@'))).toBe(true)
    expect(partsText(d.prompt.stem)).toContain('8.03 B parameters')
  })
})

describe('the truths follow the atlas', () => {
  const row = (id: string) => {
    const r = atlasRow(id)
    return { bw: r.hbmBwGBs!, peak: r.bf16DenseGflops! }
  }

  test('ridge = sustained peak ÷ sustained bandwidth, doubled for FP8', () => {
    for (const i of all('ridge')) {
      const { bw, peak } = row(String(i.params.hw))
      const fp8 = i.params.dtype === 'fp8' ? 2 : 1
      expect(truthOf(i)).toBeCloseTo(((peak * fp8 * Number(i.params.fc)) / 100) / ((bw * Number(i.params.fb)) / 100), 9)
      expect(HW).toContain(i.params.hw)
    }
  })

  test('the class of a kernel is whether its intensity is left of the ridge, and the key says so', () => {
    for (const i of all('bound')) {
      const { bw, peak } = row(String(i.params.hw))
      const ridge = (peak * (i.params.dtype === 'fp8' ? 2 : 1)) / bw
      const ai = Number(i.params.ai)
      expect(ai < ridge ? ai * 1.5 <= ridge : ai >= ridge * 1.5).toBe(true)
      expect(i.answer.kind === 'choice' && i.answer.correct).toEqual([ai < ridge ? 'bw' : 'cb'])
    }
  })

  test('attainable is the lower of the two roofs, in TFLOP/s or as a share of the peak', () => {
    for (const i of all('attainable')) {
      const { bw, peak } = row(String(i.params.hw))
      const got = Math.min(peak, bw * Number(i.params.ai))
      expect(truthOf(i)).toBeCloseTo(i.params.ask === 'busy' ? (100 * got) / peak : got / 1000, 9)
      expect(i.level === 3 ? i.params.ask : 'tflops').toBe(i.params.ask)
    }
    const sides = new Set(all('attainable').map((i) => Number(i.params.ai) >= row(String(i.params.hw)).peak / row(String(i.params.hw)).bw))
    expect(sides.size).toBe(2)
  })

  test('decode tok/s is bandwidth ÷ weight bytes, and the weights fit in memory', () => {
    const bytes: Record<string, number> = { bf16: 2, fp8: 1, fp4: 0.5 }
    for (const i of all('decode-b1')) {
      const { bw } = row(String(i.params.hw))
      const weights = Number(i.params.paramsB) * bytes[String(i.params.dtype)]
      expect(truthOf(i)).toBeCloseTo(((bw * Number(i.params.fb)) / 100) / weights, 9)
      const cap = atlasRow(String(i.params.hw)).hbmGb ?? 192
      expect(weights).toBeLessThanOrEqual(cap)
    }
  })

  test('the batch that reaches the ridge is the ridge times bytes ÷ 2', () => {
    const bytes: Record<string, number> = { bf16: 2, int8: 1, fp4: 0.5 }
    for (const i of all('batch-to-ridge')) {
      const { bw, peak } = row(String(i.params.hw))
      const ridge = ((peak * Number(i.params.fc)) / 100) / ((bw * Number(i.params.fb)) / 100)
      expect(truthOf(i)).toBeCloseTo((ridge * bytes[String(i.params.dtype)]) / 2, 9)
    }
  })

  test('a tile has intensity 2·Tm·Tn ÷ ((Tm + Tn)·bytes), which is T ÷ bytes when square', () => {
    for (const i of all('tile-ai')) {
      const [tm, tn] = [Number(i.params.tm), Number(i.params.tn)]
      const b = { fp16: 2, fp8: 1, fp32: 4 }[String(i.params.dtype)]!
      expect(truthOf(i)).toBeCloseTo((2 * tm * tn) / ((tm + tn) * b), 9)
      if (tm === tn) expect(truthOf(i)).toBeCloseTo(tm / b, 9)
    }
  })
})

describe('levels', () => {
  test('levels 0 and 1 show a worked example with exactly one blanked step that hides its answer; levels 2 and 3 show none', () => {
    for (const v of roofline.variants) {
      for (const l of LEVELS) {
        const i = roofline.make(seeds[3], l, v.id)
        if (l >= 2) {
          expect(i.prompt.worked).toBeUndefined()
          continue
        }
        const worked = i.prompt.worked!
        expect(worked.filter((w) => w.blank)).toHaveLength(1)
        const blank = worked.findIndex((w) => w.blank)
        expect(blank).toBe(l === 0 ? worked.length - 1 : Math.floor((worked.length - 1) / 2))
        const full = roofline.solution(i)
        expect(partsText(worked[blank].text).length).toBeLessThan(partsText(full[blank].text).length)
      }
    }
  })

  test('the transfer level changes the surface: FP8 math, FP8 or FP4 weights, another tile dtype, a share of the peak', () => {
    expect(new Set(all('ridge', [3]).map((i) => i.params.dtype))).toEqual(new Set(['fp8']))
    expect(new Set(all('bound', [3]).map((i) => i.params.dtype))).toEqual(new Set(['fp8']))
    expect(new Set(all('ridge', [3]).map((i) => i.params.hw))).toEqual(new Set(['h100', 'b200', 'tpu7x']))
    expect(new Set(all('batch-to-ridge', [3]).map((i) => i.params.dtype))).toEqual(new Set(['int8', 'fp4']))
    expect(new Set(all('tile-ai', [3]).map((i) => i.params.dtype))).toEqual(new Set(['fp8', 'fp32']))
    expect(new Set(all('attainable', [3]).map((i) => i.params.ask))).toEqual(new Set(['busy']))
    expect(roofline.make(seeds[5], 3, 'batch-to-ridge').kcs).toEqual(['t4.decode-bandwidth', 't4.ridge-point'])
  })

  test('a T4 reads FP16, not BF16, because Turing has no BF16', () => {
    const t4 = all('ridge', [0]).find((i) => i.params.hw === 't4')!
    expect(partsText(t4.prompt.stem)).toContain('FP16 math')
    expect(partsText(t4.prompt.stem)).not.toContain('BF16')
  })
})

describe('diagnoses', () => {
  const ids = (variant: string, level: Level = 2) => seeds.map((s) => roofline.make(s, level, variant))
  const diag = (i: Instance, value: number) => roofline.grade(i, numeric(i, value)).diagnosis?.id

  test('an inverted ridge (bandwidth ÷ peak) is named on the ridge and the batch', () => {
    // at level 2 the weights are BF16, so the batch that reaches the ridge equals the ridge
    for (const v of ['ridge', 'batch-to-ridge']) {
      for (const i of ids(v)) expect(diag(i, 1 / truthOf(i))).toBe('roofline.inverted-ridge')
    }
  })

  test('the sparse datasheet figure doubles the ridge and the compute roof, but only where the datasheet lists one', () => {
    const sparse = ['h100', 'b200', 'a100-80', 'rtx4090']
    for (const i of ids('ridge')) expect(diag(i, truthOf(i) * 2)).toBe(sparse.includes(String(i.params.hw)) ? 'roofline.sparse-flops' : undefined)
    const compute = ids('attainable').filter((i) => i.params.ask === 'tflops' && sparse.includes(String(i.params.hw)) && truthOf(i) === atlasRow(String(i.params.hw)).bf16DenseGflops! / 1000)
    expect(compute.length).toBeGreaterThan(5)
    for (const i of compute) expect(diag(i, truthOf(i) * 2)).toBe('roofline.sparse-flops')
  })

  test('TB/s read as GB/s: the ridge reads 1,000 high, decode 1,000 low', () => {
    for (const i of ids('ridge')) expect(diag(i, truthOf(i) * 1000)).toBe('roofline.tb-vs-gb')
    for (const i of ids('batch-to-ridge')) expect(diag(i, truthOf(i) * 1000)).toBe('roofline.tb-vs-gb')
    for (const i of ids('decode-b1')) expect(diag(i, truthOf(i) / 1000)).toBe('roofline.tb-vs-gb')
    const bw = ids('attainable').filter((i) => i.params.ask === 'tflops' && Number(i.params.ai) < 100)
    for (const i of bw) expect(diag(i, truthOf(i) / 1000)).toBe('roofline.tb-vs-gb')
  })

  test('bits as bytes: decode and tiles come out an eighth', () => {
    for (const i of [...ids('decode-b1'), ...ids('tile-ai')]) expect(diag(i, truthOf(i) / 8)).toBe('roofline.bits-bytes')
  })

  test('counting elements, not bytes, doubles a 2-byte tile and is not a slip for a 1-byte one', () => {
    for (const i of ids('tile-ai', 2)) expect(diag(i, truthOf(i) * 2)).toBe('roofline.elements-not-bytes')
    const fp8 = all('tile-ai', [3]).find((i) => i.params.dtype === 'fp8')!
    expect(diag(fp8, truthOf(fp8) * 2)).toBeUndefined()
    const fp32 = all('tile-ai', [3]).find((i) => i.params.dtype === 'fp32')!
    expect(diag(fp32, truthOf(fp32) * 4)).toBe('roofline.elements-not-bytes')
  })

  test('the wrong class on a bound item is diagnosed by the side of the ridge, and each why says what is true', () => {
    // an inverted ridge is about 0.003, so a learner who inverted it calls every kernel compute-bound:
    // that is the slip only left of the ridge. Right of it, picking bandwidth is a different misconception.
    const sides = { left: 0, right: 0 }
    for (const l of LEVELS) {
      for (const i of all('bound', [l])) {
        if (i.answer.kind !== 'choice') throw new Error('bound is a choice')
        const left = i.answer.correct[0] === 'bw'
        sides[left ? 'left' : 'right']++
        const wrong = i.answer.options.find((o) => o.id === (left ? 'cb' : 'bw'))!
        const expected = left ? 'roofline.inverted-ridge' : 'roofline.bandwidth-above-ridge'
        expect(wrong.miss).toBe(expected)
        expect(roofline.grade(i, { kind: 'choice', picks: [wrong.id] }).diagnosis?.id).toBe(expected)
        // only left-of-ridge items talk about the inverse of the ridge
        expect(wrong.why.includes('bandwidth ÷ peak')).toBe(left)
        expect(wrong.why.includes(left ? 'inverse' : 'tensor cores saturate')).toBe(true)
        expect(i.answer.options.filter((o) => o.miss === 'roofline.inverted-ridge')).toHaveLength(left ? 1 : 0)
        expect(roofline.grade(i, { kind: 'choice', picks: ['nm'] }).diagnosis?.id).toBe('roofline.needs-measuring')
        expect(roofline.grade(i, correctResponse(i)).ok).toBe(true)
        for (const o of i.answer.options) expect(o.why.length).toBeGreaterThan(20)
      }
    }
    expect(sides.left).toBeGreaterThan(0)
    expect(sides.right).toBeGreaterThan(0)
  })

  test('the sparse peak halves a bandwidth-bound share of the peak, and is not diagnosed on the compute roof', () => {
    const sparse = ['h100', 'b200', 'a100-80', 'rtx4090']
    const busy = all('attainable', [3])
    const bw = busy.filter((i) => sparse.includes(String(i.params.hw)) && truthOf(i) < 100)
    expect(bw.length).toBeGreaterThan(5)
    for (const i of bw) expect(diag(i, truthOf(i) / 2)).toBe('roofline.sparse-flops')
    const t4 = busy.find((i) => i.params.hw === 't4' && truthOf(i) < 100)
    if (t4) expect(diag(t4, truthOf(t4) / 2)).toBeUndefined()
  })

  test('a right answer is never diagnosed', () => {
    for (const v of roofline.variants) {
      const i = roofline.make(seeds[9], 2, v.id)
      const g = roofline.grade(i, correctResponse(i))
      expect(g.ok).toBe(true)
      expect(g.diagnosis).toBeUndefined()
    }
  })
})

describe('the choice item', () => {
  test('the key is never strictly the longest option, so length is no cue', () => {
    const items = all('bound')
    let longest = 0
    for (const i of items) {
      if (i.answer.kind !== 'choice') continue
      const lens = i.answer.options.map((o) => o.text.length)
      const top = i.answer.options.filter((o) => o.text.length === Math.max(...lens))
      if (top.length === 1 && i.answer.correct.includes(top[0].id)) longest++
    }
    expect(longest / items.length).toBeLessThanOrEqual(0.3)
  })

  test('both sides of the ridge occur at every level', () => {
    for (const l of LEVELS) {
      const keys = new Set(all('bound', [l]).map((i) => (i.answer.kind === 'choice' ? i.answer.correct[0] : '')))
      expect([...keys].sort()).toEqual(['bw', 'cb'])
    }
  })
})
