import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkChoiceCues, checkFamily, checkHashes, genSeeds, isRound, lintLiterals, readHashRows } from '../../scripts/verify-generators'
import { KC } from '../../src/data/kc/ids'
import { partsText } from '../../src/lib/items/core'
import gen from '../../src/lib/items/families/spec'
import { correctResponse } from '../../src/lib/items/grade'
import type { Instance, Level, Response } from '../../src/lib/items/types'

const LEVELS = [0, 1, 2, 3] as const
const SEEDS = genSeeds(200)
const FAMILY_FILE = new URL('../../src/lib/items/families/spec.ts', import.meta.url)
const hashFixture = readHashRows('spec') // tests/fixtures/items/hashes/spec.json

const numeric = (value: number): Response => ({ kind: 'numeric', value })
const truthOf = (inst: Instance): number => (inst.answer.kind === 'choice' ? Number.NaN : inst.answer.truth)
const diag = (inst: Instance, value: number): string | undefined => gen.grade(inst, numeric(value)).diagnosis?.id
const many = (variant: string, level: Level): Instance[] => SEEDS.map((s) => gen.make(s, level, variant))
const num = (inst: Instance, key: string): number => Number(inst.params[key])
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

/** E by adding the terms, with none of the family's code: 1 + α + α² + … + α^k. */
function tokensPerStep(alpha: number, k: number): number {
  let term = 1
  let total = 0
  for (let i = 0; i <= k; i++) {
    total += term
    term *= alpha
  }
  return total
}
const costOf = (k: number, c: number): number => 1 + k * c
/** Speedups for k = 1..6 from the exact E (or from E rounded to hundredths, as the level-3 table shows it). */
const speedups = (alpha: number, c: number, table: boolean): number[] =>
  [1, 2, 3, 4, 5, 6].map((k) => (table ? Math.round(tokensPerStep(alpha, k) * 100) / 100 : tokensPerStep(alpha, k)) / costOf(k, c))
/**
 * The rules whose ratio lies within the default 2 % window of `ratio`, in the order grade tries them: the first one names the slip,
 * and a coincidence of two ratios (1 + αk next to 1 + k·c, say) legitimately gives it to the earlier rule.
 */
function claimants(inst: Instance, ratio: number): string[] {
  return gen.ratioRules.filter((r) => {
    const rho = typeof r.ratio === 'function' ? r.ratio(inst) : r.ratio
    return rho !== null && Math.abs(ratio / rho - 1) <= 0.02
  }).map((r) => r.id)
}
/** Answers `value` and expects the diagnosis of the first rule that claims it, which must include `own`. Returns whether `own` was the one named. */
function named(inst: Instance, value: number, own: string): boolean {
  const who = claimants(inst, value / truthOf(inst))
  expect(who).toContain(own)
  expect(diag(inst, value)).toBe(who[0])
  return who[0] === own
}
const counts = (inst: Instance): number[] => String(inst.params.counts).split(',').map(Number)

describe('spec: the family', () => {
  test('passes the whole §5.6 suite at 100 seeds, and every ratio rule fires', () => {
    const r = checkFamily(gen, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.instances).toBe(100 * 4 * 4)
  })

  test('four variants, each at levels 0 to 3, covering the two KCs of the contract', () => {
    expect(gen.variants.map((v) => v.id)).toEqual(['expected-tokens', 'speedup', 'best-k', 'draft-tokens'])
    for (const v of gen.variants) expect([...v.levels]).toEqual([0, 1, 2, 3])
    expect([...gen.kcs].sort()).toEqual([KC.specAcceptance, KC.speculativeDecoding].sort())
    expect(gen.variants.map((v) => v.kcs)).toEqual([[KC.speculativeDecoding], [KC.specAcceptance], [KC.specAcceptance], [KC.speculativeDecoding]])
    expect(gen.ratioRules.map((r) => r.id)).toEqual(['spec.no-bonus', 'spec.k-terms', 'spec.linear', 'spec.ignored-cost', 'spec.unweighted-mean'])
  })

  test('the lint, the hash rows and the pins hold', () => {
    expect(lintLiterals('spec.ts', readFileSync(FAMILY_FILE, 'utf8'))).toEqual([])
    expect(Object.keys(hashFixture.spec).sort()).toEqual(gen.variants.map((v) => v.id).sort())
    expect(checkHashes(gen, hashFixture)).toEqual([])
    expect(gen.pins).toHaveLength(3)
  })

  test('make is a pure function of (seed, level, variant); no variant means the seed picks one', () => {
    for (const s of SEEDS.slice(0, 20)) {
      expect(gen.make(s, 2)).toEqual(gen.make(s, 2))
      expect(gen.make(s, 2, 'speedup')).not.toEqual(gen.make(s, 3, 'speedup'))
    }
    expect(new Set(SEEDS.map((s) => gen.make(s, 1).variant)).size).toBe(4)
    expect(() => gen.make(1, 1, 'nope')).toThrow(RangeError)
  })

  test('every number is a scenario number: no claims, and every prompt says hypothetical', () => {
    for (const v of gen.variants) {
      for (const level of LEVELS) {
        for (const inst of many(v.id, level).slice(0, 40)) {
          expect(inst.claims).toEqual([])
          expect(partsText(inst.prompt.stem)).toContain('hypothetical')
        }
      }
    }
  })

  test('α^n is never computed with Math.pow or **, which differ between engines in the last bit', () => {
    const code = readFileSync(FAMILY_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(/Math\.pow|[a-z0-9)] \*\* /.test(code)).toBe(false)
  })
})

describe('spec: levels fade the support', () => {
  test('level 0 shows every step but the last, with round numbers; level 1 blanks one middle step that hides its result', () => {
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
        // a blank step keeps its result, which the step list hides until the answer is in
        expect(shown[blank[0]].result).toBeDefined()
      }
      for (const level of [2, 3] as const) for (const inst of many(v.id, level)) expect(inst.prompt.worked).toBeUndefined()
    }
  })

  test('no worked step gives a numeric answer away', () => {
    for (const v of ['expected-tokens', 'speedup', 'draft-tokens']) {
      for (const level of [0, 1] as const) {
        for (const inst of many(v, level)) {
          const last = [...gen.solution(inst)].reverse().find((s) => s.result)!.result!
          for (const w of inst.prompt.worked ?? []) expect(w.result?.value === last.value && w.result?.unit === last.unit).toBe(false)
        }
      }
    }
  })

  test('level 3 changes the surface: steps for a reply, tokens per second, a measured table, a reply read off a log', () => {
    for (const inst of many('expected-tokens', 3)) {
      expect(inst.answer.kind === 'numeric' && inst.answer.unit).toBe('steps')
      expect(inst.params.steps).toBeUndefined()
      expect(partsText(inst.prompt.stem)).toContain('-token reply')
    }
    for (const inst of many('speedup', 3)) {
      expect(inst.answer.kind === 'numeric' && inst.answer.unit).toBe('tok/s')
      expect(inst.kcs).toEqual([KC.specAcceptance, KC.speculativeDecoding])
    }
    for (const inst of many('speedup', 2)) expect(inst.kcs).toEqual([KC.specAcceptance])
    for (const inst of many('best-k', 3)) {
      const table = inst.prompt.stem.find((p) => p.t === 'table')
      expect(table?.t === 'table' && table.rows).toHaveLength(6)
      expect(inst.params.alpha).toBeDefined()
    }
    for (const inst of many('best-k', 2)) expect(inst.prompt.stem.some((p) => p.t === 'table')).toBe(false)
    for (const inst of many('draft-tokens', 3)) expect(inst.answer.kind === 'numeric' && inst.answer.unit).toBe('steps')
  })

  test('a single step is asked about in one case of four, and a run of 10 to 99 steps in the rest', () => {
    const steps = many('expected-tokens', 2).map((i) => num(i, 'steps'))
    const one = steps.filter((n) => n === 1).length
    expect(one / steps.length).toBeGreaterThan(0.15)
    expect(one / steps.length).toBeLessThan(0.35)
    for (const n of steps) expect(n === 1 || (n >= 10 && n <= 99)).toBe(true)
  })
})

describe('spec: the numbers are right', () => {
  test('expected-tokens: E is the sum 1 + α + … + α^k, times the steps, or the reply over E', () => {
    for (const level of LEVELS) {
      for (const inst of many('expected-tokens', level)) {
        const e = tokensPerStep(num(inst, 'alpha'), num(inst, 'k'))
        expect(truthOf(inst)).toBeCloseTo(inst.params.tokens === undefined ? num(inst, 'steps') * e : num(inst, 'tokens') / e, 9)
        // a round emits between one token (an early rejection) and k + 1 (every draft accepted)
        expect(e).toBeGreaterThan(1)
        expect(e).toBeLessThan(num(inst, 'k') + 1)
      }
    }
  })

  test('expected-tokens: the stem tells the bonus token (after a clean sweep) from the correction token (at the first rejection), as draft-tokens does', () => {
    for (const level of LEVELS) {
      for (const inst of many('expected-tokens', level).slice(0, 20)) {
        const text = partsText(inst.prompt.stem)
        expect(text).toContain('the bonus token after a clean sweep')
        expect(text).toContain('the correction token at the first rejection')
      }
    }
  })

  test('speedup is E over the cost 1 + k·c, and is worth asking about', () => {
    for (const level of LEVELS) {
      for (const inst of many('speedup', level)) {
        const s = tokensPerStep(num(inst, 'alpha'), num(inst, 'k')) / costOf(num(inst, 'k'), num(inst, 'c'))
        expect(truthOf(inst)).toBeCloseTo(inst.params.rate === undefined ? s : num(inst, 'rate') * s, 9)
        expect(s).toBeGreaterThanOrEqual(1.1)
      }
    }
  })

  test('best-k: the key is the draft length with the largest speedup, which beats the runner-up by 0.5 %, also on the rounded table', () => {
    for (const level of LEVELS) {
      for (const inst of many('best-k', level)) {
        if (inst.answer.kind !== 'choice') throw new Error('best-k is a choice')
        const s = speedups(num(inst, 'alpha'), num(inst, 'c'), level === 3)
        const best = s.indexOf(Math.max(...s))
        expect(inst.answer.correct).toEqual([`k${best + 1}`])
        expect(Math.max(...s.filter((_, i) => i !== best)) * 1.005).toBeLessThanOrEqual(s[best])
        // the exact and the rounded curves agree, so the key does not depend on the level
        const other = speedups(num(inst, 'alpha'), num(inst, 'c'), level !== 3)
        expect(other.indexOf(Math.max(...other))).toBe(best)
        expect(inst.answer.options.map((o) => o.text)).toEqual(['k = 1', 'k = 2', 'k = 3', 'k = 4', 'k = 5', 'k = 6'])
      }
    }
  })

  test('best-k: the key is spread over one to six, not parked in the middle', () => {
    for (const level of LEVELS) {
      const keys = many('best-k', level).map((i) => (i.answer.kind === 'choice' ? i.answer.correct[0] : ''))
      for (const k of [1, 2, 3, 4, 5, 6]) expect(keys.filter((x) => x === `k${k}`).length / keys.length).toBeGreaterThan(0.1)
    }
  })

  test('draft-tokens: a round emits its accepted prefix plus one token, and the log\'s rounds add up', () => {
    for (const level of LEVELS) {
      for (const inst of many('draft-tokens', level)) {
        const c = counts(inst)
        expect(c).toHaveLength(num(inst, 'k') + 1)
        expect(sum(c)).toBe(num(inst, 'rounds'))
        const tokens = c.reduce((a, n, accepted) => a + n * (accepted + 1), 0)
        const mean = tokens / num(inst, 'rounds')
        expect(truthOf(inst)).toBeCloseTo(inst.params.tokens === undefined ? mean : num(inst, 'tokens') / mean, 9)
        expect(mean).toBeGreaterThanOrEqual(1)
        expect(mean).toBeLessThanOrEqual(num(inst, 'k') + 1)
      }
    }
  })

  test('draft-tokens: the logs look like acceptance, with most rounds at the short lengths when α is low', () => {
    const logs = many('draft-tokens', 2)
    const low = logs.filter((i) => counts(i)[0] > sum(counts(i)) / 2).length
    const full = logs.filter((i) => counts(i)[num(i, 'k')] > sum(counts(i)) / 2).length
    expect(low).toBeGreaterThan(5)
    expect(full).toBeGreaterThan(5)
  })
})

describe('spec: the pins reproduce the lessons', () => {
  const [mtp, draft, fig1] = gen.pins

  test('t6.l6: α = 0.85 and k = 3 give E ≈ 3.2', () => {
    const inst = mtp.make()
    expect(inst.params).toEqual({ alpha: 0.85, k: 3, steps: 1 })
    expect(truthOf(inst)).toBeCloseTo(3.1866, 3)
    expect(partsText(inst.prompt.stem)).toContain('one verification step')
  })

  test('t5.l8: α = 0.7 and k = 4 give E ≈ 2.8, and E is capped at 1 ÷ (1 − α) however long the draft', () => {
    const inst = draft.make()
    expect(truthOf(inst)).toBeCloseTo(2.7731, 3)
    expect(tokensPerStep(0.7, 100)).toBeCloseTo(1 / 0.3, 9)
  })

  test('t5.l8 fig 1: accepting 3 of 4 drafted tokens plus the bonus emits 4 tokens', () => {
    const inst = fig1.make()
    expect(truthOf(inst)).toBe(4)
    expect(gen.grade(inst, numeric(3)).diagnosis?.id).toBe('spec.no-bonus')
  })
})

describe('spec: ratio diagnoses name the slip', () => {
  const tally = (ids: (string | undefined)[], id: string): number => ids.filter((x) => x === id).length

  test('spec.no-bonus: E without the bonus token, on E, the speedup and the log', () => {
    let seen = 0
    for (const v of ['expected-tokens', 'speedup', 'draft-tokens']) {
      for (const level of [1, 2] as const) {
        for (const inst of many(v, level)) {
          const raw = v === 'draft-tokens' ? truthOf(inst) - 1 : truthOf(inst) * ((tokensPerStep(num(inst, 'alpha'), num(inst, 'k')) - 1) / tokensPerStep(num(inst, 'alpha'), num(inst, 'k')))
          if (Math.abs(raw / truthOf(inst) - 1) <= 0.06 || gen.grade(inst, numeric(raw)).ok) continue
          if (named(inst, raw, 'spec.no-bonus')) seen++
        }
      }
    }
    expect(seen).toBeGreaterThan(300)
  })

  test('spec.k-terms: k terms instead of k + 1, and spec.linear: 1 + αk', () => {
    let kTerms = 0
    let linear = 0
    for (const v of ['expected-tokens', 'speedup']) {
      for (const inst of many(v, 2)) {
        const [alpha, k] = [num(inst, 'alpha'), num(inst, 'k')]
        const e = tokensPerStep(alpha, k)
        const kt = (truthOf(inst) * tokensPerStep(alpha, k - 1)) / e
        const lin = (truthOf(inst) * (1 + alpha * k)) / e
        if (Math.abs(kt / truthOf(inst) - 1) > 0.06 && !gen.grade(inst, numeric(kt)).ok && named(inst, kt, 'spec.k-terms')) kTerms++
        if (Math.abs(lin / truthOf(inst) - 1) > 0.06 && !gen.grade(inst, numeric(lin)).ok && named(inst, lin, 'spec.linear')) linear++
      }
    }
    expect(kTerms).toBeGreaterThan(100)
    expect(linear).toBeGreaterThan(100)
  })

  test('spec.ignored-cost: tokens per step given as the speedup, and the same ratio on the tokens-per-second item', () => {
    let seen = 0
    for (const level of LEVELS) {
      for (const inst of many('speedup', level)) {
        const cost = costOf(num(inst, 'k'), num(inst, 'c'))
        if (cost - 1 <= 0.06 || gen.grade(inst, numeric(truthOf(inst) * cost)).ok) continue
        if (named(inst, truthOf(inst) * cost, 'spec.ignored-cost')) seen++
      }
    }
    expect(seen).toBeGreaterThan(300)
  })

  test('spec.unweighted-mean: the lengths 0 to k averaged without their rounds', () => {
    let seen = 0
    for (const level of [0, 1, 2] as const) {
      for (const inst of many('draft-tokens', level)) {
        const wrong = 1 + num(inst, 'k') / 2
        if (Math.abs(wrong / truthOf(inst) - 1) <= 0.06 || gen.grade(inst, numeric(wrong)).ok) continue
        if (named(inst, wrong, 'spec.unweighted-mean')) seen++
      }
    }
    expect(seen).toBeGreaterThan(50)
  })

  test('on the reply-length items a slip moves the answer the other way: a smaller E needs more steps', () => {
    const inst = many('expected-tokens', 3).find((i) => num(i, 'alpha') >= 0.8 && num(i, 'k') >= 3)!
    const [alpha, k] = [num(inst, 'alpha'), num(inst, 'k')]
    expect(diag(inst, (num(inst, 'tokens') / (tokensPerStep(alpha, k) - 1)))).toBe('spec.no-bonus')
    const log = many('draft-tokens', 3).find((i) => Math.abs((1 + num(i, 'k') / 2) / (num(i, 'tokens') / truthOf(i)) - 1) > 0.1)!
    expect(diag(log, num(log, 'tokens') / (1 + num(log, 'k') / 2))).toBe('spec.unweighted-mean')
  })

  test('every rule is dropped where its ratio is within 6 % of 1, so a right answer is never a slip', () => {
    for (const v of gen.variants) {
      for (const inst of many(v.id, 2)) {
        if (inst.answer.kind === 'choice') continue
        expect(gen.grade(inst, correctResponse(inst)).diagnosis).toBeUndefined()
        for (const r of gen.ratioRules) {
          const rho = typeof r.ratio === 'function' ? r.ratio(inst) : r.ratio
          if (rho !== null) expect(Math.abs(rho - 1)).toBeGreaterThan(0.06)
        }
      }
    }
    expect(tally([diag(many('draft-tokens', 2)[0], truthOf(many('draft-tokens', 2)[0]))], 'spec.no-bonus')).toBe(0)
  })

  test('the answer to one decimal is right: a learner who rounds E or the speedup to 0.1 is not marked wrong', () => {
    for (const v of ['expected-tokens', 'speedup', 'draft-tokens']) {
      for (const inst of many(v, 0).filter((i) => i.answer.kind === 'numeric' && i.answer.unit !== 'steps')) {
        expect(gen.grade(inst, numeric(Math.round(truthOf(inst) * 10) / 10)).ok).toBe(true)
      }
    }
  })
})

describe('spec: the choice item', () => {
  test('every option has a why, a wrong pick is diagnosed, and the verdict names the speedups', () => {
    for (const level of LEVELS) {
      for (const inst of many('best-k', level).slice(0, 80)) {
        if (inst.answer.kind !== 'choice') continue
        const key = inst.answer.correct[0]
        const best = Number(key.slice(1))
        for (const o of inst.answer.options) {
          expect(o.why.trim().length).toBeGreaterThan(20)
          const g = gen.grade(inst, { kind: 'choice', picks: [o.id] })
          expect(g.ok).toBe(o.id === key)
          if (o.id === key) continue
          const k = Number(o.id.slice(1))
          // a draft that stopped short, or one that kept going past where the cost overtakes
          expect(g.diagnosis?.id).toBe(k < best ? 'spec.stopped-early' : 'spec.ignored-cost')
          expect(o.why).toContain(`k = ${best}`)
        }
      }
    }
  })

  test('the blind-strategy gate holds at 1,000 seeds, at every level and pooled', () => {
    const r = checkChoiceCues(gen, { seeds: 1000 })
    expect(r.problems).toEqual([])
    expect(r.rows.map((x) => x.where).sort()).toEqual(['spec/best-k', 'spec/best-k@L0', 'spec/best-k@L1', 'spec/best-k@L2', 'spec/best-k@L3'])
    for (const row of r.rows) expect(row.worst.hit - row.chance).toBeLessThan(0.1)
  })

  test('the option texts are one shape, and the stem carries no digit that an option repeats', () => {
    for (const level of [0, 1, 2] as const) {
      for (const inst of many('best-k', level).slice(0, 100)) {
        const stem = partsText(inst.prompt.stem) + (inst.prompt.givens ?? []).map((g) => partsText([g.value])).join(' ')
        const tokens = new Set(stem.toLowerCase().match(/[a-z0-9]+/g) ?? [])
        // α and c are written with two or more decimals, so their tokens are never a bare 1-6
        for (const d of ['1', '2', '3', '4', '5', '6']) expect(tokens.has(d)).toBe(false)
      }
    }
  })
})
