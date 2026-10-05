import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkChoiceCues, checkFamily, cueQuestion, MIN_CUE_SEEDS } from '../../scripts/verify-generators'
import { CUE_STRATEGIES, len, MAX_HIT_OVER_CHANCE, oddOneOut, pickRank } from '../../scripts/item-cues'
import { loadAllFamilies } from '../../src/lib/items/registry'
import roofline from '../../src/lib/items/families/roofline'
import type { ChoiceOption, Gen, Instance, Level, VariantSpec } from '../../src/lib/items/types'
import demo from './fixture-family'

/**
 * The blind-strategy gate for generator multiple-choice variants (B27): the Wave 1a item rules of
 * scripts/item-cues.ts, applied to every choice variant over at least 200 seeds at every level.
 */

const LEVELS = [0, 1, 2, 3] as const
const PLANE: VariantSpec = { id: 'which-plane', title: 'Which plane', kcs: ['t5.kv-bytes-per-token'], levels: LEVELS, nsec: 20 }

/** A family whose one choice variant draws its options from `options(seed)`; the key is the option with `key: true`. */
function choiceFamily(options: (seed: number, level: Level) => (Pick<ChoiceOption, 'text'> & { key?: boolean })[]): Gen {
  const make = (seed: number, level: Level): Instance => {
    const base = demo.make(seed, level, 'which-plane')
    const opts = options(seed, level).map((o, i) => ({ id: `o${i}`, text: o.text, why: 'because', key: o.key === true }))
    return { ...base, answer: { kind: 'choice', options: opts.map(({ id, text, why }) => ({ id, text, why })), correct: opts.filter((o) => o.key).map((o) => o.id) } }
  }
  return { ...demo, id: 'synthetic', variants: [PLANE], make }
}

/** A deterministic 0..n-1 draw from a seed, so synthetic families are reproducible. */
const roll = (seed: number, salt: number, n: number): number => Math.abs(Math.imul(seed ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b) >>> 7) % n

describe('the blind-strategy gate on the shipped families', () => {
  test('every choice variant of every family passes at 200 seeds over all levels', async () => {
    for (const gen of await loadAllFamilies()) {
      const r = checkChoiceCues(gen, { seeds: MIN_CUE_SEEDS })
      expect(r.problems).toEqual([])
    }
  })

  test('the gate really samples: frag fit-choice and roofline bound are judged at every level, and pooled', async () => {
    const wheres = new Set<string>()
    for (const gen of await loadAllFamilies()) for (const row of checkChoiceCues(gen, { seeds: MIN_CUE_SEEDS }).rows) wheres.add(row.where)
    for (const v of ['frag/fit-choice', 'roofline/bound']) {
      expect(wheres.has(v)).toBe(true)
      for (const l of LEVELS) expect(wheres.has(`${v}@L${l}`)).toBe(true)
    }
    // numeric and estimate variants have no options, so nothing else is judged
    expect([...wheres].every((w) => /^(frag\/fit-choice|roofline\/bound)(@L\d)?$/.test(w))).toBe(true)
  })

  test('checkFamily runs it by default, from at least 200 seeds even when asked for fewer', () => {
    const r = checkFamily(roofline, { seeds: 20, speed: false })
    expect(r.cues.length).toBeGreaterThan(0)
    // four levels of 200 seeds each, and the same instances pooled
    for (const row of r.cues) expect(row.instances).toBe(row.where.includes('@') ? MIN_CUE_SEEDS : MIN_CUE_SEEDS * LEVELS.length)
    expect(checkFamily(roofline, { seeds: 20, speed: false, cues: false }).cues).toEqual([])
  })

  test('the worst strategy on each shipped row stays within chance + 15 points, with room to spare', async () => {
    for (const gen of await loadAllFamilies()) {
      for (const row of checkChoiceCues(gen, { seeds: 1000 }).rows) {
        expect(row.worst.hit).toBeLessThanOrEqual(row.chance + MAX_HIT_OVER_CHANCE)
        // roofline's bound was rebuilt to sit near chance, not on the edge of the limit
        if (gen.id === 'roofline') expect(row.worst.hit - row.chance).toBeLessThan(0.1)
      }
    }
  })
})

describe('the gate catches what it is for', () => {
  test('the old roofline bound options: a third option that is always the longest and never the key', () => {
    const old = (i: Instance): Instance => {
      if (i.answer.kind !== 'choice') return i
      const text: Record<string, string> = {
        bw: 'Bandwidth-bound: memory traffic is the limit, not the tensor cores',
        cb: 'Compute-bound: the tensor cores are the limit, not memory traffic',
        nm: 'It cannot be told until the kernel is measured on the chip, whatever its intensity',
      }
      return { ...i, answer: { ...i.answer, options: i.answer.options.map((o) => ({ ...o, text: text[o.id] })) } }
    }
    const legacy: Gen = { ...roofline, variants: roofline.variants.filter((v) => v.id === 'bound'), make: (s, l, v) => old(roofline.make(s, l, v)) }
    const r = checkChoiceCues(legacy, { seeds: MIN_CUE_SEEDS })
    for (const l of LEVELS) expect(r.problems.some((p) => p.startsWith(`roofline/bound@L${l}: `) && /blind strateg/.test(p))).toBe(true)
    expect(r.problems.join('\n')).toMatch(/'2nd-longest'|'shortest'|'avoid-absolutes'/)
    // and the V1 lint of checkFamily would already have said the key is never longest, which is not the leak: the rank rates are
    const q = (s: number) => cueQuestion(legacy.make(s, 2, 'bound'))!
    expect([...Array(200).keys()].filter((s) => pickRank(q(s), 0, true) > 0)).toEqual([])
  })

  test('a key that is always the second-longest option', () => {
    const g = choiceFamily((seed) => [{ text: 'Short option' }, { text: 'The medium length key', key: true }, { text: `The longest of the three options${' x'.repeat(roll(seed, 1, 3))}` }])
    const r = checkChoiceCues(g, { seeds: MIN_CUE_SEEDS })
    expect(r.problems.some((p) => /'2nd-longest' 100\.0 %/.test(p))).toBe(true)
  })

  test('a key that is the only option with a digit, or the only one without', () => {
    const only = (withDigit: boolean) =>
      checkChoiceCues(
        choiceFamily((seed) => {
          const pad = (k: number) => 'a'.repeat(8 + roll(seed, k, 5))
          return [
            { text: `${pad(1)} ${withDigit ? '4' : 'x'} here`, key: true },
            { text: `${pad(2)} ${withDigit ? 'y' : '5'} there` },
            { text: `${pad(3)} ${withDigit ? 'z' : '6'} again` },
          ]
        }),
        { seeds: MIN_CUE_SEEDS },
      )
    expect(only(true).problems.some((p) => /the key is the only option with a digit/.test(p))).toBe(true)
    expect(only(false).problems.some((p) => /the key is the only option without a digit/.test(p))).toBe(true)
  })

  test('a key that is the only option with a reason connective', () => {
    const g = choiceFamily((seed) => [
      { text: `${'a'.repeat(10 + roll(seed, 1, 4))} because of it`, key: true },
      { text: `${'b'.repeat(10 + roll(seed, 2, 4))} in spite of it` },
      { text: `${'c'.repeat(10 + roll(seed, 3, 4))} next to it` },
    ])
    expect(checkChoiceCues(g, { seeds: MIN_CUE_SEEDS }).problems.some((p) => /only option with a reason connective/.test(p))).toBe(true)
  })

  test('exchangeable options pass: lengths, words and punctuation trade places at random', () => {
    const g = choiceFamily((seed) => {
      const pad = (k: number) => ' very'.repeat(roll(seed, k, 4))
      return [
        { text: `Alpha: first${pad(1)} reading, not second`, key: true },
        { text: `Beta: second${pad(2)} reading, not first` },
        { text: `Gamma: third${pad(3)} reading, not other` },
      ]
    })
    expect(checkChoiceCues(g, { seeds: MIN_CUE_SEEDS }).problems).toEqual([])
  })

  test('a leak that shows at one level only: the key is always the longest at the fourth', () => {
    const g = choiceFamily((seed, level) => [
      { text: `Key text${' k'.repeat(roll(seed, 1, 4))}${level === 3 ? ' and then some' : ''}`, key: true },
      { text: `Odd text${' d'.repeat(roll(seed, 2, 4))}` },
      { text: `Any text${' e'.repeat(roll(seed, 3, 4))}` },
    ])
    const r = checkChoiceCues(g, { seeds: MIN_CUE_SEEDS })
    expect(r.problems.some((p) => p.startsWith('synthetic/which-plane@L3: ') && /'1st-longest' 100\.0 %/.test(p))).toBe(true)
    for (const l of [0, 1, 2]) expect(r.problems.some((p) => p.startsWith(`synthetic/which-plane@L${l}: `))).toBe(false)
  })

  test('multi-select and numeric variants are not judged as single-key choices', () => {
    expect(checkChoiceCues(demo, { seeds: MIN_CUE_SEEDS }).rows.map((r) => r.where).filter((w) => !w.startsWith('demo/which-plane'))).toEqual([])
    const multi = choiceFamily((seed) => [{ text: 'a b c', key: true }, { text: 'a b c d e f', key: true }, { text: `a${'b'.repeat(roll(seed, 1, 3))}` }])
    expect(checkChoiceCues(multi, { seeds: MIN_CUE_SEEDS })).toEqual({ problems: [], rows: [] })
  })
})

describe('roofline bound: options built so no surface feature says which one is the key', () => {
  const items = (l: Level, n = 1000): Instance[] => [...Array(n).keys()].map((s) => roofline.make(s * 7919 + l, l, 'bound'))

  test('three options, each with a why, ids bw, cb and nm, and the key is the side of the ridge', () => {
    for (const l of LEVELS) {
      for (const i of items(l, 200)) {
        if (i.answer.kind !== 'choice') throw new Error('bound is a choice')
        expect(i.answer.options.map((o) => o.id)).toEqual(['bw', 'cb', 'nm'])
        for (const o of i.answer.options) expect(o.why.length).toBeGreaterThan(20)
        expect(i.answer.options.find((o) => o.id === 'nm')!.miss).toBe('roofline.needs-measuring')
      }
    }
  })

  test('the three options share one shape: a colon, a comma, no digits, parentheses or absolute words', () => {
    for (const i of items(2, 300)) {
      if (i.answer.kind !== 'choice') throw new Error('bound is a choice')
      for (const o of i.answer.options) {
        expect(o.text.match(/:/g)).toHaveLength(1)
        expect(o.text.match(/,/g)).toHaveLength(1)
        expect(/\d|[()]/.test(o.text)).toBe(false)
        expect(oddOneOut(cueQuestion(i)!)).toEqual([])
      }
    }
  })

  test('at every level the key takes each length rank about equally often', () => {
    for (const l of LEVELS) {
      const ranks = [0, 0, 0]
      for (const i of items(l)) {
        const q = cueQuestion(i)!
        const lens = q.options.map(len)
        ranks[lens.filter((x) => x > lens[q.correct[0]]).length]++
      }
      for (const n of ranks) {
        expect(n / 1000).toBeGreaterThan(0.2)
        expect(n / 1000).toBeLessThan(0.45)
      }
    }
  })

  test('the pads do not depend on the key: both sides of the ridge draw every pad', () => {
    const seen = new Map<string, Set<string>>()
    for (const i of items(1, 600)) {
      const side = i.answer.kind === 'choice' ? i.answer.correct[0] : ''
      seen.set(side, new Set([...(seen.get(side) ?? []), String(i.params.pads)]))
    }
    for (const pads of seen.values()) expect(pads.size).toBeGreaterThan(40)
    expect([...seen.keys()].sort()).toEqual(['bw', 'cb'])
  })

  test('the stem asks which limit is reached first, and names neither verdict', () => {
    for (const i of items(0, 20)) expect(i.prompt.stem.map((p) => (p.t === 'text' ? p.text : '')).join('')).toMatch(/Which limit does it reach first\?$/)
  })
})

describe('the strategies are the ones verify-items runs', () => {
  test('one shared module: verify-items imports it and defines none of the strategies itself', () => {
    const src = readFileSync(new URL('../../scripts/verify-items.ts', import.meta.url), 'utf8')
    expect(src).toContain("from './item-cues'")
    for (const name of ['function oddOneOut', 'function pickRank', 'function pickMatching', 'function pickByScore', 'const BINARY_FLAGS', 'const FEATURES', 'const SURFACE_STRATEGIES']) expect(src).not.toContain(name)
    const gen = readFileSync(new URL('../../scripts/verify-generators.ts', import.meta.url), 'utf8')
    expect(gen).toContain("from './item-cues'")
  })

  test('length ranks, lexical cues, surface features and stem overlap are all in the set', () => {
    const names = CUE_STRATEGIES.map((s) => s.name)
    for (const n of ['1st-longest', '2nd-longest', '2nd-shortest', 'shortest', 'has-parentheses', 'has-colon', 'has-", so"', 'no-because/since', 'most-characters', 'fewest-words', 'most-acronyms', 'fewest-absolutes', 'stem-overlap', 'stem-overlap-4+', 'avoid-absolutes']) {
      expect(names).toContain(n)
    }
    expect(new Set(names).size).toBe(names.length)
  })
})
