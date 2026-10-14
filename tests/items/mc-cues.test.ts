import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkChoiceCues, checkFamily, cueQuestion, MIN_CUE_SEEDS } from '../../scripts/verify-generators'
import {
  collectOwnPools,
  CUE_STRATEGIES,
  len,
  MAX_HIT_OVER_CHANCE,
  MAX_RANK_AGGREGATE,
  MAX_RANK_LESSON,
  MAX_RANK_SET_AGGREGATE,
  NAMED_RANK_SET_STRATEGIES,
  oddOneOut,
  OWN_POOLS,
  passProbability,
  pickRank,
  pickRankSet,
  poolCueFailures,
  poolCueRows,
  POOLS_OF_LENGTH_STRATEGIES,
  RANK_STRATEGIES,
  SINGLE_RANK_STRATEGIES,
  type CueQuestion,
  type CueStrategy,
} from '../../scripts/item-cues'
import { ALL_LESSONS } from '../../src/data/lessons'
import { INCIDENTS } from '../../src/lib/fleet-week'
import { loadAllFamilies } from '../../src/lib/items/registry'
import roofline from '../../src/lib/items/families/roofline'
import type { ChoiceOption, Gen, Instance, Level, VariantSpec } from '../../src/lib/items/types'
import demo from './fixture-family'

/**
 * The blind-strategy gate for generator multiple-choice variants (B27): the Wave 1a item rules of
 * scripts/item-cues.ts, applied to every choice variant over at least 200 seeds at every level.
 */

const LEVELS = [0, 1, 2, 3] as const
/** The tests that walk every family (each new family adds choice variants): Bun's 5 s default is too tight on a loaded machine. */
// the cue suites sample every family at 200 to 1,000 seeds: the slowest takes about 24.5 s on a GitHub runner,
// about twice this host's time, so the limit leaves room for a slow runner
const SLOW = 90_000
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
  }, SLOW)

  test('the gate really samples: every choice variant, frag fit-choice and roofline bound among them, is judged at every level, and pooled', async () => {
    const wheres = new Set<string>()
    // a variant is a choice variant when its instances are choices, so a new family's choice variants are judged without editing this list
    const choice = new Set<string>()
    for (const gen of await loadAllFamilies()) {
      for (const row of checkChoiceCues(gen, { seeds: MIN_CUE_SEEDS }).rows) wheres.add(row.where)
      for (const v of gen.variants) if (gen.make(1, v.levels[0], v.id).answer.kind === 'choice') choice.add(`${gen.id}/${v.id}`)
    }
    for (const v of ['frag/fit-choice', 'roofline/bound']) {
      expect(choice.has(v)).toBe(true)
      expect(wheres.has(v)).toBe(true)
      for (const l of LEVELS) expect(wheres.has(`${v}@L${l}`)).toBe(true)
    }
    // numeric and estimate variants have no options, so nothing else is judged
    expect([...wheres].every((w) => choice.has(w.split('@')[0]))).toBe(true)
    expect([...choice].every((v) => wheres.has(v))).toBe(true)
  }, SLOW)

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
  }, SLOW)
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

/* ---- 2a-10: every uniform choice over a proper subset of the length ranks (spec 19.2) ---- */

/** An item whose option lengths are exactly `lens` in display order and whose key is the option at `key`; length is all the options carry. */
const withLengths = (lens: number[], key: number): CueQuestion => ({ q: 'stem', options: lens.map((l) => 'x'.repeat(l)), correct: [key] })
/** An item of `n` options with distinct lengths 40, 34, 28, 22 (the first n of them) whose key sits at length rank `rank` (0 = longest). */
const ranked = (rank: number, n = 4): CueQuestion => withLengths([40, 34, 28, 22].slice(0, n), rank)

/** The pick probability of a strategy for a key at each length rank of an n-option item. */
const byRank = (s: CueStrategy, n: number): number[] => [...Array(n).keys()].map((r) => s.pick(ranked(r, n)))
const named = (name: string): CueStrategy => RANK_STRATEGIES.find((s) => s.name === name)!

describe('rank-subset strategies: every uniform choice over a non-empty proper subset of the length ranks', () => {
  /** All non-empty proper subsets of ranks 0..n-1, as the pick-probability vector each implies (1/|S| at its ranks, 0 elsewhere). */
  const subsets = (n: number): number[][] => {
    const out: number[][] = []
    for (let mask = 1; mask < (1 << n) - 1; mask++) {
      const size = [...Array(n).keys()].filter((r) => mask & (1 << r)).length
      out.push([...Array(n).keys()].map((r) => (mask & (1 << r) ? 1 / size : 0)))
    }
    return out
  }
  const close = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]) < 1e-12)

  test('14 subsets for 4 options and 6 for 3: each is some strategy of RANK_STRATEGIES', () => {
    expect(subsets(4)).toHaveLength(14)
    expect(subsets(3)).toHaveLength(6)
    for (const n of [3, 4]) {
      for (const want of subsets(n)) expect(RANK_STRATEGIES.some((s) => close(byRank(s, n), want))).toBe(true)
    }
  })

  test('the four one-rank strategies are unchanged and come first, then the three named ones', () => {
    expect(RANK_STRATEGIES.slice(0, 4).map((s) => s.name)).toEqual(['1st-longest', '2nd-longest', '2nd-shortest', 'shortest'])
    expect(SINGLE_RANK_STRATEGIES).toHaveLength(4)
    expect(RANK_STRATEGIES.slice(4, 7).map((s) => s.name)).toEqual(['middle-length', 'avoid-longest', 'avoid-shortest'])
    expect(NAMED_RANK_SET_STRATEGIES).toHaveLength(3)
    // 4 one-rank + 3 named + the 10 multi-rank subsets of four ranks
    expect(RANK_STRATEGIES).toHaveLength(17)
    for (const n of ['middle-length', 'avoid-longest', 'avoid-shortest']) expect(CUE_STRATEGIES.map((s) => s.name)).toContain(n)
  })

  test('middle-length picks strictly between the longest and the shortest, at any option count', () => {
    expect(byRank(named('middle-length'), 4)).toEqual([0, 0.5, 0.5, 0])
    expect(byRank(named('middle-length'), 3)).toEqual([0, 1, 0])
    // two options have no middle: the cue says nothing
    expect(byRank(named('middle-length'), 2)).toEqual([0.5, 0.5])
  })

  test('avoid-longest and avoid-shortest pick uniformly over every other rank', () => {
    expect(byRank(named('avoid-longest'), 4)).toEqual([0, 1 / 3, 1 / 3, 1 / 3])
    expect(byRank(named('avoid-shortest'), 4)).toEqual([1 / 3, 1 / 3, 1 / 3, 0])
    expect(byRank(named('avoid-longest'), 3)).toEqual([0, 0.5, 0.5])
  })

  test('ties share a rank, and the pick stays uniform over the tied options', () => {
    // lengths 30, 20, 20, 10: the two middle options tie, so middle-length picks one of them and the key is one of the two
    expect(named('middle-length').pick(withLengths([30, 20, 20, 10], 1))).toBeCloseTo(0.5)
    expect(named('middle-length').pick(withLengths([30, 20, 20, 10], 0))).toBe(0)
    // every option the same length: ranks carry no information, and every subset is chance
    expect(pickRankSet(withLengths([5, 5, 5, 5], 2), [1, 2])).toBeCloseTo(0.25)
  })

  test('a set that names no rank of the item, or every rank, says nothing; a multi-select is never hit', () => {
    expect(pickRankSet(ranked(1), [7, 8])).toBe(0.25)
    expect(pickRankSet(ranked(1), [0, 1, 2, 3])).toBe(0.25)
    expect(pickRankSet({ q: 's', options: ['a', 'bb', 'ccc', 'dddd'], correct: [1, 2] }, [1, 2])).toBe(0)
  })
})

/** The three pools verify-items judges: lesson quizzes (grouped by lesson), Act IV's items and errata items. */
interface Pools {
  lessons: CueQuestion[][]
  fleet: CueQuestion[]
  errata: CueQuestion[]
}
const hitRate = (qs: CueQuestion[], s: CueStrategy) => qs.reduce((a, q) => a + s.pick(q), 0) / qs.length
const chanceOf = (qs: CueQuestion[]) => qs.reduce((a, q) => a + 1 / q.options.length, 0) / qs.length

/**
 * The gates before 2a-10 (`now` false): the four one-rank strategies at the lesson level (at most MAX_RANK_AGGREGATE expected
 * lessons, no lesson at MAX_RANK_LESSON) and every item-level strategy but the rank subsets, over the pooled items and the lessons
 * and errata pools. The gates after (`now`): every RANK_STRATEGIES entry (the subsets held to MAX_RANK_SET_AGGREGATE) and Act IV's
 * pool judged on its own. The same constants and strategies verify-items imports.
 */
function gateProblems(pools: Pools, now: boolean): string[] {
  const problems: string[] = []
  const single = new Set(SINGLE_RANK_STRATEGIES.map((s) => s.name))
  for (const s of now ? RANK_STRATEGIES : SINGLE_RANK_STRATEGIES) {
    const ps = pools.lessons.map((qs) => passProbability(qs.map(s.pick)))
    const limit = single.has(s.name) ? MAX_RANK_AGGREGATE : MAX_RANK_SET_AGGREGATE
    const expected = ps.reduce((a, b) => a + b, 0)
    if (expected > limit) problems.push(`lessons: '${s.name}' passes ${expected.toFixed(2)} lessons (limit ${limit})`)
    if (ps.some((p) => p >= MAX_RANK_LESSON)) problems.push(`lessons: '${s.name}' passes one lesson at p >= ${MAX_RANK_LESSON}`)
  }
  const all = { lessons: pools.lessons.flat(), 'fleet-week': pools.fleet, errata: pools.errata }
  const pooled = Object.values(all).flat()
  const isSubset = (s: CueStrategy) => RANK_STRATEGIES.includes(s) && !single.has(s.name)
  for (const s of CUE_STRATEGIES.filter((c) => now || !isSubset(c))) {
    if (hitRate(pooled, s) > chanceOf(pooled) + MAX_HIT_OVER_CHANCE) problems.push(`items: '${s.name}' over all pools`)
    const judged: readonly string[] = now && RANK_STRATEGIES.includes(s) ? POOLS_OF_LENGTH_STRATEGIES : ['lessons', 'errata']
    for (const [pool, qs] of Object.entries(all)) {
      if (judged.includes(pool) && qs.length && hitRate(qs, s) > chanceOf(qs) + MAX_HIT_OVER_CHANCE) problems.push(`items: '${s.name}' in the ${pool} pool`)
    }
  }
  return problems
}

describe('the old gates passed these fixtures; the new ones fail them', () => {
  /** 20 lessons of five items: 15 whose keys all sit at the middle ranks (the top-heavy ones alternate), 5 whose keys sit at the ends. */
  const middleLessons = (): CueQuestion[][] => {
    const lessons: CueQuestion[][] = []
    for (let i = 0; i < 15; i++) lessons.push((i % 2 === 0 ? [1, 2, 1, 2, 1] : [2, 1, 2, 1, 2]).map((r) => ranked(r)))
    for (let i = 0; i < 5; i++) lessons.push([0, 3, 0, 3, i % 2 ? 0 : 3].map((r) => ranked(r)))
    return lessons
  }

  test('a lesson pool whose keys sit at the middle ranks: no one rank passes a lesson, but middle-length does', () => {
    const pools: Pools = { lessons: middleLessons(), fleet: [], errata: [] }
    // the old gate: every single length rank stays under the item-level bar, and none passes a lesson
    expect(gateProblems(pools, false)).toEqual([])
    for (const s of SINGLE_RANK_STRATEGIES) {
      expect(hitRate(pools.lessons.flat(), s)).toBeLessThanOrEqual(0.4)
      expect(pools.lessons.every((qs) => passProbability(qs.map(s.pick)) === 0)).toBe(true)
    }
    // the new gate: picking at random between the two middle options passes about 0.19 of each of the 15 middle lessons
    const problems = gateProblems(pools, true)
    expect(problems.some((p) => /^lessons: 'middle-length' passes 2\.8\d lessons \(limit 2\)/.test(p))).toBe(true)
    expect(problems.some((p) => p.startsWith("lessons: 'ranks-1+2' passes"))).toBe(true)
    // the leak is the lesson-level one: at the item level the pool is not above chance + 15 points for any strategy
    expect(problems.filter((p) => p.startsWith('items:'))).toEqual([])
  })

  /** The six Act IV items as they were before 2a-10: the option lengths of every cause and mitigation, and the key's place in each. */
  const OLD_ACT_IV = [
    withLengths([88, 87, 81, 90], 1),
    withLengths([99, 98, 84, 90], 1),
    withLengths([97, 89, 89, 99], 0),
    withLengths([85, 83, 80, 97], 1),
    withLengths([117, 116, 124, 105], 0),
    withLengths([76, 92, 101, 105], 1),
  ]

  test("Act IV's old option lengths: every key at a middle rank, passed by the old gates, failed by the new item-level rule", () => {
    expect(hitRate(OLD_ACT_IV, named('middle-length'))).toBe(0.5)
    // the old gates saw Act IV only in the pooled rate, diluted by the lesson items
    const lessons = [[0, 1, 2, 3, 1, 2, 1, 2, 3, 0].map((r) => ranked(r))]
    const pools: Pools = { lessons, fleet: OLD_ACT_IV, errata: [] }
    expect(gateProblems(pools, false)).toEqual([])
    // the new gate judges the pool on its own
    const problems = gateProblems(pools, true)
    for (const name of ['middle-length', 'ranks-1+2', '2nd-longest', '2nd-shortest']) expect(problems).toContain(`items: '${name}' in the fleet-week pool`)
  })

  test('the Act IV options as shipped pass the item-level rule on their own, and no strategy gets an incident right at p >= 0.5', () => {
    const asQuestions: CueQuestion[] = INCIDENTS.flatMap((inc) => [inc.causes, inc.mitigations]).map((list) => ({
      q: 'stem',
      options: list.map((o) => o.label),
      correct: list.flatMap((o, i) => (o.correct ? [i] : [])),
    }))
    // one cause and one mitigation item per catalog fault (2b-17: four faults, was three static incidents)
    expect(asQuestions).toHaveLength(2 * INCIDENTS.length)
    for (const s of RANK_STRATEGIES) {
      expect(hitRate(asQuestions, s)).toBeLessThanOrEqual(chanceOf(asQuestions) + MAX_HIT_OVER_CHANCE)
      expect(passProbability(asQuestions.map(s.pick))).toBeLessThan(MAX_RANK_LESSON)
      for (let k = 0; k < INCIDENTS.length; k++) expect(s.pick(asQuestions[2 * k]) * s.pick(asQuestions[2 * k + 1])).toBeLessThan(MAX_RANK_LESSON)
    }
  })
})

/** A pool of `n` four-option items whose key takes the length rank `rank(i)` (0 = shortest) and whose texts are otherwise alike. */
function rankedPool(n: number, rank: (i: number) => number): { ref: string; q: { q: string; options: string[]; correct: number[] } }[] {
  return Array.from({ length: n }, (_, i) => {
    const key = rank(i)
    // option at rank r has 40 + 8 * r characters; the key is placed at display index i % 4 so the position says nothing
    const at = i % 4
    const ranks = [0, 1, 2, 3].filter((r) => r !== key)
    const options = Array.from({ length: 4 }, (_, k) => {
      const r = k === at ? key : (ranks.shift() as number)
      return `${'w'.repeat(40 + 8 * r)}`.replace(/(.{6})/g, '$1 ').trim()
    })
    return { ref: `pre:fixture#${i}`, q: { q: 'Which one?', options, correct: [at] } }
  })
}

describe('the own pools: prequestions, diagram predictions and spiral items are each held to the item-level bar on their own (owner rule, rule 19)', () => {
  test('a prequestion pool whose key is the second-shortest option 11 times in 23 fails, as the review measured', () => {
    const lopsided = rankedPool(23, (i) => (i < 11 ? 1 : [0, 2, 3][i % 3]))
    const problems = poolCueFailures('prequestion', lopsided)
    expect(problems.some((p) => /'2nd-shortest' hits 4\d\.\d% of the 23 prequestion items on their own/.test(p))).toBe(true)
  })

  test('a pool whose key is always the same length rank fails that rank, for each rank', () => {
    const names = ['shortest', '2nd-shortest', '2nd-longest', '1st-longest']
    names.forEach((name, rank) => {
      const problems = poolCueFailures('predictAt', rankedPool(6, () => rank))
      expect(problems.some((p) => p.includes(`'${name}' hits 100.0%`))).toBe(true)
    })
  })

  test('a pool whose key takes every rank equally often passes', () => {
    expect(poolCueFailures('prequestion', rankedPool(24, (i) => i % 4))).toEqual([])
  })

  test('each own pool is judged by every length strategy of spec 19.2 too: the one-rank, the named multi-rank and the ranks-* subsets', () => {
    const names = poolCueRows(rankedPool(4, (i) => i)).map((r) => r.name)
    for (const s of RANK_STRATEGIES) expect(names).toContain(s.name)
    // keys only at the two middle ranks: picking at random between the middle options hits half of them
    const problems = poolCueFailures('prequestion', rankedPool(8, (i) => 1 + (i % 2)))
    for (const name of ['middle-length', 'ranks-1+2']) expect(problems.some((p) => p.includes(`'${name}' hits 50.0% of the 8 prequestion items on their own`))).toBe(true)
  })

  test('an item whose key a binary feature isolates is named, whichever pool it is in', () => {
    const items = rankedPool(4, (i) => i)
    items[0].q.options[items[0].q.correct[0]] += ' (see 3)'
    const problems = poolCueFailures('spiral', items)
    expect(problems.some((p) => p.startsWith('odd-one-out: spiral pre:fixture#0 ') && /a parenthetical/.test(p))).toBe(true)
  })

  test('the shipped lessons yield the three pools, and each passes on its own', () => {
    const all = collectOwnPools(ALL_LESSONS)
    const count = (pool: string) => all.filter((e) => e.pool === pool).length
    expect(OWN_POOLS).toEqual(['prequestion', 'predictAt', 'spiral'])
    expect(count('prequestion')).toBeGreaterThanOrEqual(23)
    expect(count('predictAt')).toBeGreaterThanOrEqual(6)
    expect(count('spiral')).toBeGreaterThanOrEqual(8)
    for (const pool of OWN_POOLS) {
      const items = all.filter((e) => e.pool === pool)
      expect(poolCueFailures(pool, items)).toEqual([])
      // a why for every option, parallel to the options
      for (const e of items) expect(e.q.why?.length).toBe(e.q.options.length)
    }
  })

  test('refs are the ledger refs: pre:<lesson>#<i>, dia:<lesson>#<block index>, item:<id>', () => {
    for (const e of collectOwnPools(ALL_LESSONS)) {
      expect(e.ref).toMatch(e.pool === 'prequestion' ? /^pre:t\d\.l\d+#\d+$/ : e.pool === 'predictAt' ? /^dia:t\d\.l\d+#\d+$/ : /^item:t\d\.spiral\./)
    }
    const dia = collectOwnPools(ALL_LESSONS).find((e) => e.pool === 'predictAt')
    const lesson = ALL_LESSONS.find((l) => l.id === dia?.lessonId)
    const bi = Number(dia?.ref.split('#')[1])
    expect(lesson?.blocks[bi]?.type).toBe('diagram')
  })

  test('verify-items collects the pools and runs the shared own-pool gate', () => {
    const src = readFileSync(new URL('../../scripts/verify-items.ts', import.meta.url), 'utf8')
    expect(src).toContain('collectOwnPools(ALL_LESSONS)')
    expect(src).toContain('poolCueFailures(pool, ownPool(pool))')
    expect(src).toContain("'src/pages/lesson/diagram.tsx'")
  })
})
