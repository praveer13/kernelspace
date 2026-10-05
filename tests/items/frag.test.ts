import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkFamily, checkHashes, genSeeds, isRound, lintLiterals, type HashRows } from '../../scripts/verify-generators'
import { claimRef, partsText } from '../../src/lib/items/core'
import { KC } from '../../src/data/kc/ids'
import gen from '../../src/lib/items/families/frag'
import { correctResponse } from '../../src/lib/items/grade'
import type { Instance, Level, Response } from '../../src/lib/items/types'

const LEVELS = [0, 1, 2, 3] as const
const SEEDS = genSeeds(200)
const FAMILY_FILE = new URL('../../src/lib/items/families/frag.ts', import.meta.url)
const hashFixture = JSON.parse(readFileSync(new URL('../fixtures/items/hashes.json', import.meta.url), 'utf8')) as HashRows

const nums = (s: unknown): number[] => String(s).split(',').map(Number)
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)
const numeric = (value: number, unit?: string): Response => ({ kind: 'numeric', value, ...(unit ? { unit } : {}) })
const truthOf = (inst: Instance): number => (inst.answer.kind === 'choice' ? Number.NaN : inst.answer.truth)
const diag = (inst: Instance, r: Response): string | undefined => gen.grade(inst, r).diagnosis?.id
/** The instances of one variant and level over the test seeds. */
const many = (variant: string, level: Level): Instance[] => SEEDS.map((s) => gen.make(s, level, variant))

describe('frag: the family', () => {
  test('passes the whole §5.6 suite at 100 seeds, and every ratio rule fires', () => {
    const r = checkFamily(gen, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.instances).toBe(100 * 5 * 4)
  })

  test('five variants, each at levels 0 to 3, covering the four KCs', () => {
    expect(gen.variants.map((v) => v.id)).toEqual(['internal-waste', 'largest-fit', 'frag-metric', 'fit-choice', 'kv-block-waste'])
    for (const v of gen.variants) expect([...v.levels]).toEqual([0, 1, 2, 3])
    expect([...new Set(gen.variants.flatMap((v) => v.kcs))].sort()).toEqual([...gen.kcs].sort())
    // the family writes its four ids out (to keep its chunk small): they must stay the contract's ids
    expect([...gen.kcs].sort()).toEqual([KC.externalFrag, KC.fixedBlocks, KC.internalFrag, KC.placementPolicy].sort())
  })

  test('the lint, the hash rows and the pins hold', () => {
    expect(lintLiterals('frag.ts', readFileSync(FAMILY_FILE, 'utf8'))).toEqual([])
    expect(checkHashes(gen, hashFixture)).toEqual([])
    expect(gen.pins).toHaveLength(4)
  })

  test('make is a pure function of (seed, level, variant); no variant means the seed picks one', () => {
    for (const s of SEEDS.slice(0, 20)) {
      expect(gen.make(s, 2)).toEqual(gen.make(s, 2))
      expect(gen.make(s, 2, 'frag-metric')).not.toEqual(gen.make(s, 3, 'frag-metric'))
    }
    expect(new Set(SEEDS.map((s) => gen.make(s, 1).variant)).size).toBe(5)
    expect(() => gen.make(1, 1, 'nope')).toThrow(RangeError)
  })
})

describe('frag: levels fade the support', () => {
  test('level 0 shows every step but the last, with round numbers; level 1 blanks one middle step', () => {
    for (const v of gen.variants) {
      for (const inst of many(v.id, 0)) {
        const steps = gen.solution(inst)
        const shown = inst.prompt.worked ?? []
        expect(shown.some((s) => s.blank)).toBe(false)
        expect(shown.length).toBeGreaterThan(0)
        for (const [k, w] of shown.entries()) expect(partsText(w.text)).toBe(partsText(steps[k].text))
        for (const x of Object.values(inst.params)) if (typeof x === 'number') expect(isRound(x)).toBe(true)
      }
      for (const inst of many(v.id, 1)) {
        const shown = inst.prompt.worked ?? []
        const blank = shown.flatMap((s, k) => (s.blank ? [k] : []))
        expect(blank).toEqual([Math.floor(shown.length / 2)])
        expect(shown[blank[0]].result).toBeUndefined()
      }
      for (const level of [2, 3] as const) for (const inst of many(v.id, level)) expect(inst.prompt.worked).toBeUndefined()
    }
  })

  test('no worked step gives the answer away', () => {
    for (const v of gen.variants) {
      for (const level of [0, 1] as const) {
        for (const inst of many(v.id, level)) {
          if (inst.answer.kind !== 'numeric') continue
          const last = [...gen.solution(inst)].reverse().find((s) => s.result)!.result!
          for (const w of inst.prompt.worked ?? []) expect(w.result?.value === last.value && w.result?.unit === last.unit).toBe(false)
        }
      }
    }
  })

  test('level 3 changes the surface: KiB pages, KiB answers, percents', () => {
    for (const inst of many('internal-waste', 3)) {
      expect(inst.params.ask).toBe('kib')
      expect([2048, 4096, 8192]).toContain(inst.params.block)
      expect(inst.answer.kind === 'numeric' && inst.answer.unit).toBe('KiB')
    }
    for (const inst of many('largest-fit', 3)) {
      expect(inst.answer.kind === 'numeric' && inst.answer.unit).toBe('KiB')
      expect(partsText(inst.prompt.stem)).toContain('KiB')
    }
    for (const inst of many('kv-block-waste', 3)) expect(inst.answer.kind === 'numeric' && inst.answer.unit).toBe('%')
  })
})

describe('frag: the numbers are right', () => {
  test('internal-waste: waste is allocated minus requested, and below one block per request', () => {
    for (const level of LEVELS) {
      for (const inst of many('internal-waste', level)) {
        const block = Number(inst.params.block)
        const sizes = nums(inst.params.sizes)
        const alloc = sizes.map((s) => Math.ceil(s / block) * block)
        const waste = sum(alloc) - sum(sizes)
        expect(waste).toBeGreaterThan(0)
        expect(waste).toBeLessThan(sizes.length * block)
        const want = { bytes: waste, percent: (waste * 100) / sum(alloc), kib: waste / 1024 }[String(inst.params.ask)]
        expect(truthOf(inst)).toBeCloseTo(want!, 9)
      }
    }
  })

  test('largest-fit and frag-metric read the free runs, also out of a used/free layout', () => {
    for (const level of LEVELS) {
      for (const inst of many('largest-fit', level)) {
        const runs = inst.params.layout === undefined ? nums(inst.params.runs) : nums(inst.params.layout).filter((_, i) => i % 2 === 1)
        expect(truthOf(inst)).toBe(level === 3 ? Math.max(...runs) / 1024 : Math.max(...runs))
      }
      for (const inst of many('frag-metric', level)) {
        const runs = inst.params.layout === undefined ? nums(inst.params.runs) : nums(inst.params.layout).filter((_, i) => i % 2 === 1)
        expect(truthOf(inst)).toBeCloseTo(100 * (1 - Math.max(...runs) / sum(runs)), 9)
        expect(truthOf(inst)).toBeGreaterThan(0)
      }
    }
  })

  test('kv-block-waste: each sequence wastes under one block, so the total is under n × (B − 1)', () => {
    for (const level of LEVELS) {
      for (const inst of many('kv-block-waste', level)) {
        const block = Number(inst.params.block)
        const lens = nums(inst.params.lens)
        const alloc = sum(lens.map((l) => Math.ceil(l / block) * block))
        const waste = alloc - sum(lens)
        expect(waste).toBeLessThanOrEqual(lens.length * (block - 1))
        expect(truthOf(inst)).toBeCloseTo(inst.params.ask === 'percent' ? (waste * 100) / alloc : waste, 9)
        // the vLLM default block size is a sourced claim; any other block size is a scenario number
        expect(inst.claims).toEqual(block === 16 ? [claimRef('production.vllm.block-size')] : [])
        expect(gen.solution(inst).at(-1)!.result).toBeUndefined()
        expect(partsText(gen.solution(inst).at(-1)!.text)).toContain(`at most ${block - 1} slots, under one block`)
      }
    }
  })
})

describe('frag: the pins reproduce the lesson', () => {
  const [fig1, fig1Largest, oneSeq, chip] = gen.pins

  test('t1.l4 fig 1: free runs 2K + 1K + 3K are 50 % fragmented and cannot serve 6K', () => {
    const frag = fig1.make()
    expect(truthOf(frag)).toBe(50)
    expect(partsText([frag.prompt.givens![0].value])).toContain('free 2')
    const largest = fig1Largest.make()
    expect(truthOf(largest)).toBe(3)
    // a 6K request exceeds the 3K largest run although 6K is free in total
    const runs = nums(largest.params.layout).filter((_, i) => i % 2 === 1)
    expect(sum(runs) / 1024).toBe(6)
    expect(6 * 1024).toBeGreaterThan(Math.max(...runs))
    expect(gen.grade(largest, numeric(6, 'KiB')).diagnosis?.id).toBe('frag.used-total-free')
    expect(gen.grade(frag, numeric(0.5)).diagnosis?.id).toBe('frag.percent-vs-fraction')
  })

  test('t1.l4: a 300-token sequence takes 19 16-token blocks and wastes 4 slots', () => {
    const inst = oneSeq.make()
    expect(truthOf(inst)).toBe(4)
    expect(Math.ceil(300 / 16)).toBe(19)
    expect(inst.claims).toEqual([claimRef('production.vllm.block-size')])
    expect(partsText(gen.solution(inst)[0].text)).toContain('19')
  })

  test('the "<4 % vLLM KV waste" chip: a batch in 16-token blocks wastes under 4 % of the slots', () => {
    const inst = chip.make()
    expect(inst.params.block).toBe(16)
    expect(truthOf(inst)).toBeGreaterThan(0)
    expect(truthOf(inst)).toBeLessThan(4)
    expect(inst.answer.kind === 'numeric' && inst.answer.unit).toBe('%')
  })
})

describe('frag: ratio diagnoses name the slip', () => {
  test('frag.counted-full-blocks: every partly filled block counted as wasted', () => {
    let seen = 0
    for (const variant of ['internal-waste', 'kv-block-waste'] as const) {
      for (const level of [1, 2] as const) {
        for (const inst of many(variant, level)) {
          const block = Number(inst.params.block)
          const sizes = nums(inst.params.sizes ?? inst.params.lens)
          const partial = sizes.filter((s) => s % block !== 0).length
          const wrong = partial * block
          const truth = inst.params.ask === 'percent' ? undefined : truthOf(inst)
          if (truth === undefined || Math.abs(wrong / truth - 1) <= 0.03) continue
          expect(diag(inst, numeric(wrong))).toBe('frag.counted-full-blocks')
          seen++
        }
      }
    }
    expect(seen).toBeGreaterThan(50)
  })

  test('frag.forgot-last-partial: the last request is missing from the sum', () => {
    let seen = 0
    for (const inst of many('kv-block-waste', 1)) {
      const block = Number(inst.params.block)
      const lens = nums(inst.params.lens)
      const last = (block - (lens[lens.length - 1] % block)) % block
      const wrong = truthOf(inst) - last
      if (last === 0 || Math.abs(wrong / truthOf(inst) - 1) <= 0.03 || wrong <= 0) continue
      const id = diag(inst, numeric(wrong))
      // the earlier rule (every partial counted as waste) may claim the same number first
      expect(['frag.forgot-last-partial', 'frag.counted-full-blocks']).toContain(id)
      if (id === 'frag.forgot-last-partial') seen++
    }
    expect(seen).toBeGreaterThan(20)
  })

  test('frag.used-total-free: the total of the free runs given instead of the largest', () => {
    for (const level of [0, 1, 2] as const) {
      for (const inst of many('largest-fit', level)) {
        expect(diag(inst, numeric(sum(nums(inst.params.runs)), 'B'))).toBe('frag.used-total-free')
      }
    }
  })

  test('frag.inverted-metric and frag.percent-vs-fraction on the fragmentation metric', () => {
    let inverted = 0
    for (const level of [0, 1, 2] as const) {
      for (const inst of many('frag-metric', level)) {
        const runs = nums(inst.params.runs)
        const share = (Math.max(...runs) * 100) / sum(runs)
        // largest ÷ total as a percent; at an exact 50 % it is the right answer
        if (Math.abs(share / truthOf(inst) - 1) <= 0.03) continue
        expect(diag(inst, numeric(share))).toBe('frag.inverted-metric')
        inverted++
        expect(diag(inst, numeric(truthOf(inst) / 100))).toBe('frag.percent-vs-fraction')
      }
    }
    expect(inverted).toBeGreaterThan(100)
  })

  test('shared unit slips still apply: KiB read as bytes', () => {
    for (const inst of many('internal-waste', 3).slice(0, 50)) {
      expect(diag(inst, numeric(truthOf(inst) * 1024, 'KiB'))).toBe('unit.kibi')
    }
  })

  test('the right answer in either unit is ok with no diagnosis', () => {
    for (const inst of many('internal-waste', 3).slice(0, 50)) {
      expect(gen.grade(inst, correctResponse(inst)).ok).toBe(true)
      const bytes = gen.grade(inst, numeric(truthOf(inst) * 1024, 'B'))
      expect(bytes.ok).toBe(true)
      expect(bytes.diagnosis).toBeUndefined()
    }
  })
})

/** An independent placement simulator: a cell map, scanned for runs, with none of the family's code. */
function cellSim(holesText: string, reqs: number[], policy: 'first' | 'best' | 'next'): number[] {
  const holes = holesText.split(',').map((h) => h.split(':').map(Number))
  const free: boolean[] = []
  for (const [off, size] of holes) for (let i = 0; i < size; i++) free[off + i] = true
  const runs = (): [number, number][] => {
    const out: [number, number][] = []
    for (let i = 0; i < free.length; i++) {
      if (!free[i] || free[i - 1]) continue
      let j = i
      while (free[j]) j++
      out.push([i, j - i])
    }
    return out
  }
  let rover = 0
  const placed: number[] = []
  for (const size of reqs) {
    const fits = runs().filter(([, len]) => len >= size)
    let at: [number, number] | undefined
    if (policy === 'first') at = fits[0]
    else if (policy === 'best') at = fits.reduce<[number, number] | undefined>((b, r) => (!b || r[1] < b[1] ? r : b), undefined)
    else at = fits.find(([off]) => off >= rover) ?? fits[0]
    if (!at) {
      placed.push(-1)
      break
    }
    for (let i = 0; i < size; i++) free[at[0] + i] = false
    placed.push(at[0])
    rover = at[0] + size
  }
  return placed
}

describe('frag: fit-choice agrees with an independent simulator', () => {
  const POLICIES = ['first', 'best', 'next'] as const
  const offsetOf = (text: string): number => Number(/Offset (\d+)/.exec(text)![1])

  test('place form: the key is the asked policy\'s offset and the three offsets differ', () => {
    let seen = 0
    for (const level of LEVELS) {
      for (const inst of many('fit-choice', level)) {
        if (inst.params.form !== 'place' || inst.answer.kind !== 'choice') continue
        const reqs = nums(inst.params.reqs)
        const sims = POLICIES.map((p) => cellSim(String(inst.params.holes), reqs, p))
        for (const [k, p] of POLICIES.entries()) {
          const opt = inst.answer.options.find((o) => o.id === p)!
          expect(offsetOf(opt.text)).toBe(sims[k][reqs.length - 1])
          expect(sims[k]).not.toContain(-1)
          expect(opt.why.length).toBeGreaterThan(0)
        }
        expect(new Set(sims.map((s) => s[reqs.length - 1])).size).toBe(3)
        expect(inst.answer.correct).toEqual([String(inst.params.policy)])
        seen++
      }
    }
    expect(seen).toBeGreaterThan(400)
  })

  test('fail form: the key is the one policy that fails first, or none', () => {
    const keys = new Set<string>()
    for (const level of [2, 3] as const) {
      for (const inst of many('fit-choice', level)) {
        if (inst.params.form !== 'fail' || inst.answer.kind !== 'choice') continue
        const reqs = nums(inst.params.reqs)
        const fails = POLICIES.map((p) => {
          const r = cellSim(String(inst.params.holes), reqs, p)
          return r.includes(-1) ? r.length - 1 : reqs.length
        })
        const min = Math.min(...fails)
        const key = min === reqs.length ? 'none' : POLICIES[fails.indexOf(min)]
        if (min !== reqs.length) expect(fails.filter((f) => f === min)).toHaveLength(1)
        expect(inst.answer.correct).toEqual([key])
        keys.add(key)
      }
    }
    expect([...keys].sort()).toEqual(['best', 'first', 'next', 'none'])
  })

  test('every option has a why, and a wrong pick is diagnosed with its misconception', () => {
    for (const level of LEVELS) {
      for (const inst of many('fit-choice', level).slice(0, 60)) {
        if (inst.answer.kind !== 'choice') continue
        for (const o of inst.answer.options) {
          expect(o.why.trim().length).toBeGreaterThan(20)
          const g = gen.grade(inst, { kind: 'choice', picks: [o.id] })
          expect(g.ok).toBe(inst.answer.correct.includes(o.id))
          if (!g.ok) expect(g.diagnosis?.id).toBe(o.miss)
        }
      }
    }
  })

  test('the key is rarely strictly the longest option (the V1 lint, with room to spare)', () => {
    let longest = 0
    let n = 0
    for (const level of LEVELS) {
      for (const inst of many('fit-choice', level)) {
        if (inst.answer.kind !== 'choice') continue
        const lens = inst.answer.options.map((o) => o.text.length)
        const max = Math.max(...lens)
        const key = inst.answer.options.find((o) => o.id === inst.answer.correct[0])!
        if (key.text.length === max && lens.filter((l) => l === max).length === 1) longest++
        n++
      }
    }
    expect(longest / n).toBeLessThan(0.2)
  })
})
