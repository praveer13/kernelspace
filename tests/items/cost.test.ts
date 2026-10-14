import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkFamily, checkHashes, genSeeds, lintLiterals, readHashRows, responseFromSolution } from '../../scripts/verify-generators'
import { byId, claimNumber } from '../../src/data/claims'
import { partsText } from '../../src/lib/items/core'
import cost from '../../src/lib/items/families/cost'
import { correctResponse } from '../../src/lib/items/grade'
import type { Instance, Level, Response } from '../../src/lib/items/types'

const FILE = new URL('../../src/lib/items/families/cost.ts', import.meta.url)
const hashes = readHashRows('cost') // tests/fixtures/items/hashes/cost.json
const LEVELS = [0, 1, 2, 3] as const
const seeds = genSeeds(200)

const truthOf = (i: Instance): number => (i.answer.kind === 'numeric' ? i.answer.truth : Number.NaN)
const num = (i: Instance, k: string): number => Number(i.params[k])
const stem = (i: Instance): string => partsText(i.prompt.stem)

/** Every instance of a variant over the test seeds, at the given levels. */
function all(variant: string, levels: readonly Level[] = LEVELS): Instance[] {
  return levels.flatMap((l) => seeds.map((s) => cost.make(s, l, variant)))
}

/** The first instance of a variant and level that satisfies `pred`. */
function find(variant: string, level: Level, pred: (i: Instance) => boolean): Instance {
  const hit = seeds.map((s) => cost.make(s, level, variant)).find(pred)
  if (!hit) throw new Error(`no ${variant}@L${level} instance matches`)
  return hit
}

/** The response of a learner who made a slip of ratio `rho`. */
const slipped = (i: Instance, rho: number): Response => ({ kind: 'numeric', value: truthOf(i) * rho, unit: i.answer.kind === 'numeric' ? i.answer.unit : '' })

describe('the cost family (§5.3)', () => {
  test('passes the whole §5.6 suite at 100 seeds, with no dead rule', () => {
    const r = checkFamily(cost, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.instances).toBe(100 * 4 * 4)
    // every variant is numeric, so the blind-strategy gate has no choice variant to read
    expect(r.cues).toEqual([])
  })

  test('declares the four variants at levels 0-3, the three KCs and the five diagnoses of the spec', () => {
    expect(cost.variants.map((v) => v.id)).toEqual(['per-mtok', 'required-tps', 'node-day', 'cache-discount'])
    for (const v of cost.variants) expect(v.levels).toEqual([0, 1, 2, 3])
    expect([...cost.kcs].sort()).toEqual(['t6.agent-prefix-locality', 't6.ep-economics', 't7.cost-per-mtok'])
    expect(cost.variants.map((v) => v.kcs)).toEqual([['t7.cost-per-mtok'], ['t7.cost-per-mtok'], ['t6.ep-economics'], ['t6.agent-prefix-locality']])
    const ids = cost.ratioRules.map((r) => r.id)
    for (const id of ['cost.per-gpu-vs-node', 'cost.seconds-hours', 'cost.k-vs-m', 'cost.hit-as-miss', 'cost.output-as-input']) expect(ids).toContain(id)
  })

  test('every answer is numeric and none is a choice', () => {
    for (const v of cost.variants) for (const i of all(v.id, [0, 3]).slice(0, 60)) expect(i.answer.kind).toBe('numeric')
  })

  test("the hash fixture has this family's rows and they match", () => {
    expect(Object.keys(hashes.cost).sort()).toEqual(cost.variants.map((v) => v.id).sort())
    expect(checkHashes(cost, hashes)).toEqual([])
  })

  test('its source passes the literal lint, with only the named constants and pinned lesson numbers annotated', () => {
    expect(lintLiterals(FILE.pathname, readFileSync(FILE, 'utf8'))).toEqual([])
  })

  test('make is a pure function of (seed, level, variant); an unspecified variant is chosen by the seed', () => {
    for (const level of LEVELS) {
      for (const s of seeds.slice(0, 20)) expect(cost.make(s, level)).toEqual(cost.make(s, level))
      expect(new Set(seeds.map((s) => cost.make(s, level).variant)).size).toBe(4)
    }
  })
})

describe('pins', () => {
  test("t7.l4 and t6.l2: SGLang's DeepSeek node at $2 per GPU-hour is $0.20 per million output tokens, in both framings", () => {
    expect(cost.pins.length).toBe(2)
    for (const p of cost.pins) {
      const i = p.make()
      expect(truthOf(i)).toBeCloseTo(0.2, 2)
      expect(truthOf(i)).toBeCloseTo((2 * 8 * 24) / ((22_300 * 86_400) / 1e6), 9) // gen-literal-ok: hand check of the lesson's arithmetic
      expect(Math.abs(truthOf(i) - p.truth)).toBeLessThanOrEqual(0.005)
      expect(i.level).toBe(0)
      expect(cost.grade(i, correctResponse(i)).ok).toBe(true)
    }
  })

  test('the pin reads the claims, and carries no claim-derived number in its params', () => {
    const i = cost.pins[0].make()
    expect(i.claims).toEqual([
      `serving.sglang-deepseek.gpus-per-node@${byId['serving.sglang-deepseek.gpus-per-node'].verifiedAt}`,
      `serving.sglang-deepseek.output-tps-per-node@${byId['serving.sglang-deepseek.output-tps-per-node'].verifiedAt}`,
      `synthetic.cost.gpu-hourly@${byId['synthetic.cost.gpu-hourly'].verifiedAt}`,
    ])
    expect(i.params).toEqual({ dep: 'sglang', price: 'lessons' })
    expect(stem(i)).toContain('22,300')
    expect(stem(i)).toContain('the price the lessons assume')
    // the DeepSeek day's own $0.20 claim is the published estimate the lesson says this matches
    expect(Math.abs(truthOf(i) - claimNumber('serving.sglang-deepseek.cost-per-mtok'))).toBeLessThan(0.005)
  })
})

describe('claim-backed and synthetic scenes', () => {
  test('a dated price is the claim, and its instance lists the claim and the date it was checked', () => {
    for (const [key, id] of [['h100', 'price.h100.median'], ['b200', 'price.b200.median']] as const) {
      const i = find('per-mtok', 2, (x) => x.params.price === key && x.params.dep === 'synthetic')
      const node = (claimNumber(id) * num(i, 'gpus') * 1e6) / (num(i, 'tps') * 3600) // gen-literal-ok: hand check of $/Mtok
      expect(truthOf(i)).toBeCloseTo(node, 9)
      expect(i.claims).toContain(`${id}@${byId[id].verifiedAt}`)
      expect(stem(i)).toContain(`checked ${byId[id].verifiedAt}`)
      expect(stem(i)).toContain(claimNumber(id).toString())
    }
  })

  test('both worlds are drawn at every level of every variant, and a hypothetical scene says so and carries no claim', () => {
    for (const v of cost.variants) {
      for (const level of LEVELS) {
        const xs = seeds.map((s) => cost.make(s, level, v.id))
        const real = xs.filter((i) => i.claims.length > 0)
        // the transfer level of required-tps gives the node's rent, a hypothetical number, so no claim stands behind it
        if (v.id !== 'required-tps' || level !== 3) expect(real.length).toBeGreaterThan(0)
        expect(real.length).toBeLessThan(xs.length)
        for (const i of xs) {
          if (i.claims.length === 0) expect(stem(i)).toContain('hypothetical')
          for (const c of i.claims) expect(c).toMatch(/^[^@]+@\d{4}-\d{2}-\d{2}$/)
        }
      }
    }
  })

  test("SGLang's scene reads the node from its claims at every level that draws it", () => {
    for (const level of [0, 1, 2] as const) {
      const i = find('node-day', level, (x) => x.params.dep === 'sglang')
      expect(i.claims.some((c) => c.startsWith('serving.sglang-deepseek.output-tps-per-node@'))).toBe(true)
      expect(i.params.gpus).toBeUndefined()
      expect(i.params.tps).toBeUndefined()
    }
    // the transfer level of a node-day gives per-GPU speed, which the claim does not
    expect(all('node-day', [3]).every((i) => i.params.dep === 'synthetic')).toBe(true)
  })

  test('a cache multiplier is a published claim or a hypothetical provider, never an unsourced Anthropic number', () => {
    const seen = new Set(all('cache-discount').map((i) => String(i.params.mult)))
    expect([...seen].sort()).toEqual(['custom', 'fable', 'opus', 'std'])
    for (const [key, id] of [['std', 'serving.cache.anthropic-read-multiplier'], ['opus', 'serving.cache.anthropic-opus-5-5-read-multiplier'], ['fable', 'serving.cache.anthropic-fable-5-1-read-multiplier']] as const) {
      const i = find('cache-discount', 1, (x) => x.params.mult === key)
      expect(i.claims).toEqual([`${id}@${byId[id].verifiedAt}`])
      const h = num(i, 'hit') / 100
      expect(truthOf(i)).toBeCloseTo(num(i, 'base') * (1 - h + h * claimNumber(id)), 9)
    }
    const hypothetical = find('cache-discount', 1, (x) => x.params.mult === 'custom')
    expect(hypothetical.claims).toEqual([])
    expect(stem(hypothetical)).toContain('A hypothetical provider')
  })
})

describe('the formulas, from the params alone', () => {
  test('per-mtok: $/GPU-hr × GPUs ÷ (tok/s × 3,600) × 10⁶', () => {
    const i = find('per-mtok', 2, (x) => x.params.price === 'custom')
    expect(truthOf(i)).toBeCloseTo((num(i, 'rate') * num(i, 'gpus') * 1e6) / (num(i, 'tps') * 3600), 9) // gen-literal-ok: hand check
  })

  test('per-mtok at the transfer level divides by the tokens within the SLO', () => {
    const i = find('per-mtok', 3, (x) => x.params.dep === 'synthetic' && x.params.price === 'custom')
    const every = (num(i, 'rate') * num(i, 'gpus') * 1e6) / (num(i, 'tps') * 3600) // gen-literal-ok: hand check
    expect(truthOf(i)).toBeCloseTo(every / (num(i, 'slo') / 100), 9)
    expect(stem(i)).toContain('within the SLO')
    // the last step divides by those tokens, not by "tokens per hour"
    const last = cost.solution(i).at(-1)
    expect(last && partsText(last.text)).toBe('Cost per million tokens = cost per hour ÷ tokens delivered within the SLO per hour × 1,000,000')
    const plain = find('per-mtok', 0, () => true)
    const plainLast = cost.solution(plain).at(-1)
    expect(plainLast && partsText(plainLast.text)).toContain('÷ tokens per hour')
    expect(all('per-mtok', [0, 1, 2]).every((x) => x.params.slo === undefined)).toBe(true)
  })

  test('required-tps: the price times 10⁶ over the target and 3,600, per GPU, whatever the GPU count', () => {
    for (const i of all('required-tps').slice(0, 200)) {
      expect(truthOf(i)).toBeCloseTo((claimOrRate(i) * 1e6) / (num(i, 'target') * 3600), 6) // gen-literal-ok: hand check
    }
    const a = find('required-tps', 2, (x) => num(x, 'gpus') === 2)
    const b = { ...a.params, gpus: 16 }
    expect(truthOf(a)).toBeCloseTo((claimOrRate({ ...a, params: b }) * 1e6) / (num(a, 'target') * 3600), 6) // gen-literal-ok: hand check
  })

  test('required-tps at the transfer level gives the node price, and the GPU count divides it', () => {
    const i = find('required-tps', 3, () => true)
    expect(i.params.perNode).toBe(true)
    expect(stem(i)).toContain('The node rents for a hypothetical')
    expect(stem(i)).toContain(String(Math.round(num(i, 'rate') * num(i, 'gpus') * 100) / 100))
    expect(kcOnly(i)).toEqual(['t7.cost-per-mtok'])
  })

  test('node-day: tok/s per node × 86,400 against $/GPU-hr × GPUs × 24', () => {
    const i = find('node-day', 2, (x) => x.params.dep === 'synthetic' && x.params.price === 'custom')
    expect(truthOf(i)).toBeCloseTo((num(i, 'rate') * num(i, 'gpus') * 24 * 1e6) / (num(i, 'tps') * 86_400), 9) // gen-literal-ok: hand check
  })

  test('node-day at the transfer level gives per-GPU speed, so the GPUs cancel', () => {
    const i = find('node-day', 3, (x) => x.params.price === 'custom')
    expect(i.params.tpsGpu).toBeDefined()
    expect(truthOf(i)).toBeCloseTo((num(i, 'rate') * 24 * 1e6) / (num(i, 'tpsGpu') * 86_400), 9) // gen-literal-ok: hand check
    expect(stem(i)).toContain('each GPU generates')
  })

  test('cache-discount: blended = (1 − h) × base + h × m × base; a loop derives h from its history and its new tokens', () => {
    const i = find('cache-discount', 2, (x) => x.params.mult === 'custom')
    const h = num(i, 'prefix') / (num(i, 'prefix') + num(i, 'fresh'))
    expect(h).toBeGreaterThanOrEqual(0.5)
    expect(h).toBeLessThanOrEqual(0.97)
    expect(truthOf(i)).toBeCloseTo(num(i, 'base') * (1 - h + h * num(i, 'm')), 9)
    expect(stem(i)).toContain('the whole history hits the cache')
    expect(i.params.hit).toBeUndefined()
  })

  test('cache-discount at the transfer level prices 1,000 turns with the output at its own price, undiscounted', () => {
    const i = find('cache-discount', 3, (x) => x.params.mult === 'custom')
    const h = num(i, 'prefix') / (num(i, 'prefix') + num(i, 'fresh'))
    const blended = num(i, 'base') * (1 - h + h * num(i, 'm'))
    const turn = ((num(i, 'prefix') + num(i, 'fresh')) * blended + num(i, 'outTokens') * num(i, 'base') * num(i, 'outMult')) * 1000 / 1e6 // gen-literal-ok: hand check
    expect(truthOf(i)).toBeCloseTo(turn, 9)
    expect(i.answer).toMatchObject({ unit: 'USD per 1,000 turns' })
  })
})

describe('levels', () => {
  test('level 0 shows every step but the last, level 1 blanks one middle step, levels 2 and 3 show none', () => {
    for (const v of cost.variants) {
      for (const seed of seeds.slice(0, 30)) {
        const l0 = cost.make(seed, 0, v.id)
        const steps = cost.solution(l0)
        expect(l0.prompt.worked?.length).toBe(steps.length - 1)
        expect(l0.prompt.worked?.some((s) => s.blank)).toBe(false)
        // the answer is the learner's to complete: no worked step carries the final result
        const last = steps[steps.length - 1].result?.value
        expect(l0.prompt.worked?.some((s) => s.result?.value === last)).toBe(false)

        const l1 = cost.make(seed, 1, v.id)
        const shown = l1.prompt.worked ?? []
        expect(shown.length).toBe(cost.solution(l1).length - 1)
        expect(shown.filter((s) => s.blank).length).toBe(1)
        expect(shown[0].blank).toBeFalsy()

        expect(cost.make(seed, 2, v.id).prompt.worked).toBeUndefined()
        expect(cost.make(seed, 3, v.id).prompt.worked).toBeUndefined()
      }
    }
  })

  test('the solution ends on the answer, and its last result is a gradable response, at every level', () => {
    for (const v of cost.variants) {
      for (const level of LEVELS) {
        const i = cost.make(seeds[3], level, v.id)
        const r = responseFromSolution(i, cost.solution(i))
        expect(r).toBeDefined()
        expect(cost.grade(i, r as Response).score).toBe(1)
      }
    }
  })

  test('level 0 params are round, and the values stay in a believable range', () => {
    for (const v of cost.variants) {
      for (const i of seeds.map((s) => cost.make(s, 0, v.id))) {
        for (const x of Object.values(i.params)) if (typeof x === 'number') expect(String(x).replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length).toBeLessThanOrEqual(2)
      }
    }
    for (const i of all('per-mtok')) {
      expect(truthOf(i)).toBeGreaterThan(0.01)
      expect(truthOf(i)).toBeLessThan(100)
    }
    for (const i of all('required-tps')) {
      expect(truthOf(i)).toBeGreaterThan(10)
      expect(truthOf(i)).toBeLessThan(100_000)
    }
  })
})

describe('diagnoses', () => {
  test('per-gpu-vs-node: one GPU priced against the node (per-mtok, node-day), the node rate given per GPU (required-tps)', () => {
    const a = find('per-mtok', 2, (x) => num(x, 'gpus') === 8)
    expect(cost.grade(a, slipped(a, 1 / 8)).diagnosis?.id).toBe('cost.per-gpu-vs-node')
    expect(cost.grade(a, slipped(a, 1 / 8)).diagnosis?.message).toContain('whole node')
    const b = find('node-day', 2, (x) => x.params.dep === 'sglang')
    expect(cost.grade(b, slipped(b, 1 / 8)).diagnosis?.id).toBe('cost.per-gpu-vs-node')
    const c = find('required-tps', 2, (x) => num(x, 'gpus') === 4)
    expect(cost.grade(c, slipped(c, 4)).diagnosis?.id).toBe('cost.per-gpu-vs-node')
    const d = find('node-day', 3, (x) => num(x, 'gpus') === 16)
    expect(cost.grade(d, slipped(d, 16)).diagnosis?.id).toBe('cost.per-gpu-vs-node')
  })

  test('seconds-hours: 3,600 times too large for a price and a rate, 24 times for a node-day', () => {
    const a = find('per-mtok', 2, () => true)
    expect(cost.grade(a, slipped(a, 3600)).diagnosis?.id).toBe('cost.seconds-hours')
    const b = find('required-tps', 2, () => true)
    expect(cost.grade(b, slipped(b, 3600)).diagnosis?.id).toBe('cost.seconds-hours')
    const c = find('node-day', 2, () => true)
    const g = cost.grade(c, slipped(c, 24))
    expect(g.diagnosis?.id).toBe('cost.seconds-hours')
    expect(g.diagnosis?.message).toContain('86,400')
  })

  test('k-vs-m: a price per thousand tokens is a thousandth of the price per million, and beats the generic kilo rule', () => {
    for (const v of ['per-mtok', 'required-tps', 'node-day']) {
      const i = find(v, 2, () => true)
      const g = cost.grade(i, slipped(i, 1 / 1000))
      expect(g.diagnosis?.id).toBe('cost.k-vs-m')
      expect(g.diagnosis?.message).toContain('per thousand tokens')
    }
    const i = find('per-mtok', 2, () => true)
    // the other direction is the shared kilo rule
    expect(cost.grade(i, slipped(i, 1000)).diagnosis?.id).toBe('unit.kilo')
  })

  test('all-tokens: dividing by every token instead of the ones within the SLO', () => {
    const i = find('per-mtok', 3, (x) => num(x, 'slo') === 60)
    const g = cost.grade(i, slipped(i, 0.6))
    expect(g.diagnosis?.id).toBe('cost.all-tokens')
    expect(g.diagnosis?.message).toContain('60 %')
    // without an SLO there is no such slip
    const rule = cost.ratioRules.find((r) => r.id === 'cost.all-tokens')
    const plain = find('per-mtok', 2, () => true)
    expect(typeof rule?.ratio === 'function' ? rule.ratio(plain) : undefined).toBeNull()
  })

  test('hit-as-miss: the hit rate read as the miss rate; no-discount: every token at the base price', () => {
    const i = find('cache-discount', 1, (x) => x.params.hit === 80 && x.params.mult === 'std')
    const h = 0.8
    const m = claimNumber('serving.cache.anthropic-read-multiplier')
    const swapped = num(i, 'base') * (1 - (1 - h) + (1 - h) * m)
    const g = cost.grade(i, { kind: 'numeric', value: swapped, unit: 'USD/Mtok' })
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('cost.hit-as-miss')
    expect(g.diagnosis?.message).toContain('80 %')
    const none = cost.grade(i, { kind: 'numeric', value: num(i, 'base'), unit: 'USD/Mtok' })
    expect(none.diagnosis?.id).toBe('cost.no-discount')
    // a 50 % hit rate is its own swap: the rule must not claim a right answer
    const fifty = find('cache-discount', 1, (x) => x.params.hit === 50)
    expect(cost.grade(fifty, correctResponse(fifty)).diagnosis).toBeUndefined()
    const rule = cost.ratioRules.find((r) => r.id === 'cost.hit-as-miss')
    expect(typeof rule?.ratio === 'function' ? rule.ratio(fifty) : undefined).toBeNull()
  })

  test('output-as-input: the output tokens billed at the input price, only where it differs enough to tell', () => {
    const i = find('cache-discount', 3, (x) => x.params.mult === 'custom' && num(x, 'outTokens') >= 2000 && num(x, 'outMult') === 5) // gen-literal-ok: a lure that differs by more than the guard
    const h = num(i, 'prefix') / (num(i, 'prefix') + num(i, 'fresh'))
    const blended = num(i, 'base') * (1 - h + h * num(i, 'm'))
    const wrong = ((num(i, 'prefix') + num(i, 'fresh')) * blended + num(i, 'outTokens') * num(i, 'base')) * 1000 / 1e6 // gen-literal-ok: hand check
    const g = cost.grade(i, { kind: 'numeric', value: wrong, unit: 'USD per 1,000 turns' })
    expect(g.diagnosis?.id).toBe('cost.output-as-input')
    expect(g.diagnosis?.message).toContain('5 times the base price')
    const rule = cost.ratioRules.find((r) => r.id === 'cost.output-as-input')
    expect(typeof rule?.ratio === 'function' ? rule.ratio(find('cache-discount', 1, () => true)) : undefined).toBeNull()
  })

  test('a wrong answer that matches no rule gets the truth, not a diagnosis; a right one is ok within 2 %', () => {
    const i = find('per-mtok', 2, () => true)
    const g = cost.grade(i, slipped(i, 1.5))
    expect(g.ok).toBe(false)
    expect(g.diagnosis).toBeUndefined()
    expect(g.feedback).toContain('the answer is')
    expect(cost.grade(i, slipped(i, 1.015)).ok).toBe(true)
    expect(cost.grade(i, slipped(i, 1.03)).ok).toBe(false)
  })
})

/** The dollar price of one GPU-hour of an instance, from its params and the claims. */
function claimOrRate(i: Pick<Instance, 'params'>): number {
  const ids: Record<string, string> = { h100: 'price.h100.median', b200: 'price.b200.median', lessons: 'synthetic.cost.gpu-hourly' }
  const key = String(i.params.price)
  return ids[key] ? claimNumber(ids[key]) : Number(i.params.rate)
}

const kcOnly = (i: Instance): string[] => [...i.kcs]
