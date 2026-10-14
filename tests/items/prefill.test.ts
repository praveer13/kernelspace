import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkFamily, checkHashes, genSeeds, lintLiterals, readHashRows, responseFromSolution } from '../../scripts/verify-generators'
import { byId, claimNumber } from '../../src/data/claims'
import { partsText } from '../../src/lib/items/core'
import prefill from '../../src/lib/items/families/prefill'
import { correctResponse } from '../../src/lib/items/grade'
import type { Instance, Level, Response } from '../../src/lib/items/types'

const FILE = new URL('../../src/lib/items/families/prefill.ts', import.meta.url)
const hashes = readHashRows('prefill') // tests/fixtures/items/hashes/prefill.json
const LEVELS = [0, 1, 2, 3] as const
const seeds = genSeeds(200)

const IN_TPS = 'serving.sglang-deepseek.input-tps-per-node'
const OUT_TPS = 'serving.sglang-deepseek.output-tps-per-node'
const NODE_GPUS = 'serving.sglang-deepseek.gpus-per-node'
const KV_70B = 'zoo.llama3-70b.kv-bytes-per-token'
const KV_8B = 'model.llama3-8b.kv-bytes-per-token'

const truthOf = (i: Instance): number => (i.answer.kind === 'numeric' ? i.answer.truth : Number.NaN)
const num = (i: Instance, k: string): number => Number(i.params[k])
const stem = (i: Instance): string => partsText(i.prompt.stem)

/** Every instance of a variant over the test seeds, at the given levels. */
function all(variant: string, levels: readonly Level[] = LEVELS): Instance[] {
  return levels.flatMap((l) => seeds.map((s) => prefill.make(s, l, variant)))
}

/** The first instance of a variant and level that satisfies `pred`. */
function find(variant: string, level: Level, pred: (i: Instance) => boolean): Instance {
  const hit = seeds.map((s) => prefill.make(s, level, variant)).find(pred)
  if (!hit) throw new Error(`no ${variant}@L${level} instance matches`)
  return hit
}

/** The response of a learner who made a slip of ratio `rho`. */
const slipped = (i: Instance, rho: number): Response => ({ kind: 'numeric', value: truthOf(i) * rho, unit: i.answer.kind === 'numeric' ? i.answer.unit : '' })

describe('the prefill family (§5.1)', () => {
  test('passes the whole §5.6 suite at 100 seeds, with no dead rule', () => {
    const r = checkFamily(prefill, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.instances).toBe(100 * 5 * 4)
    // every variant is numeric, so the blind-strategy gate has no choice variant to read
    expect(r.cues).toEqual([])
  })

  test('declares the five variants at levels 0-3, the three KCs and the six diagnoses of the spec', () => {
    expect(prefill.variants.map((v) => v.id)).toEqual(['pd-ratio', 'transfer-ms', 'load-or-recompute', 'hit-gap', 'namespace-cost'])
    for (const v of prefill.variants) expect(v.levels).toEqual([0, 1, 2, 3])
    expect([...prefill.kcs].sort()).toEqual(['t6.cache-timing-oracle', 't6.epd-phases', 't6.kv-tiering'])
    expect(prefill.variants.map((v) => v.kcs)).toEqual([['t6.epd-phases'], ['t6.epd-phases'], ['t6.kv-tiering'], ['t6.cache-timing-oracle'], ['t6.cache-timing-oracle']])
    expect(prefill.ratioRules.map((r) => r.id)).toEqual(['prefill.flipped', 'prefill.tokens-not-rate', 'prefill.bits-bytes', 'prefill.ms-s', 'prefill.gb-gib', 'prefill.one-tenant'])
  })

  test('every answer is numeric and none is a choice', () => {
    for (const v of prefill.variants) for (const i of all(v.id, [0, 3]).slice(0, 60)) expect(i.answer.kind).toBe('numeric')
  })

  test("the hash fixture has this family's rows and they match", () => {
    expect(Object.keys(hashes.prefill).sort()).toEqual(prefill.variants.map((v) => v.id).sort())
    expect(checkHashes(prefill, hashes)).toEqual([])
  })

  test('its source passes the literal lint, with only the named constants and pinned lesson numbers annotated', () => {
    expect(lintLiterals(FILE.pathname, readFileSync(FILE, 'utf8'))).toEqual([])
  })

  test('make is a pure function of (seed, level, variant); an unspecified variant is chosen by the seed', () => {
    for (const level of LEVELS) {
      for (const s of seeds.slice(0, 20)) expect(prefill.make(s, level)).toEqual(prefill.make(s, level))
      expect(new Set(seeds.map((s) => prefill.make(s, level).variant)).size).toBe(5)
    }
  })
})

describe('pins', () => {
  test('t5.l9 and t6.l3: a 4k prompt of Llama-3-70B over 50 GB/s is 1.34 GB and 26.8 ms, the lessons\' "about 1.3 GB" and "~25 ms"', () => {
    const i = prefill.pins[0].make()
    expect(i.variant).toBe('transfer-ms')
    expect(truthOf(i)).toBeCloseTo((4096 * 327_680) / 50e9 * 1000, 9) // gen-literal-ok: hand check
    expect(truthOf(i)).toBeCloseTo(26.84, 2)
    expect(Math.abs(truthOf(i) - prefill.pins[0].truth)).toBeLessThanOrEqual(prefill.pins[0].tolerance?.abs ?? 0)
    expect(prefill.grade(i, correctResponse(i)).ok).toBe(true)
    // the pin reads the zoo claim and carries no claim-derived number in its params
    expect(i.claims).toEqual([`${KV_70B}@${byId[KV_70B].verifiedAt}`])
    expect(i.params).toEqual({ model: 'llama3-70b', P: 4096, B: 50 })
    expect(stem(i)).toContain('327,680')
  })

  test('the other pins are hand computations that the generator reproduces', () => {
    expect(prefill.pins.length).toBe(7)
    const truths = prefill.pins.map((p) => truthOf(p.make()))
    expect(truths[1]).toBeCloseTo((2000 / claimNumber(IN_TPS) / (500 / claimNumber(OUT_TPS))), 9) // gen-literal-ok: hand check
    expect(truths[2]).toBe(1.5) // 6,000 × 10 ÷ 20,000 = 3 prefill GPUs; 300 × 10 ÷ 1,500 = 2 decode GPUs
    expect(truths[3]).toBeCloseTo(131_072 * 20_000 / 1e9, 9) // gen-literal-ok: hand check
    expect(truths[4]).toBeCloseTo(100, 9) // gen-literal-ok: hand check
    expect(truths[5]).toBeCloseTo(0.9, 9) // gen-literal-ok: hand check
    expect(truths[6]).toBeCloseTo((2000 / (claimNumber(IN_TPS) / claimNumber(NODE_GPUS))) * 1000, 9) // gen-literal-ok: hand check
    for (const p of prefill.pins) {
      const i = p.make()
      expect(i.level).toBe(0)
      expect(prefill.grade(i, correctResponse(i)).ok).toBe(true)
    }
  })
})

describe('claim-backed and synthetic scenes', () => {
  test("SGLang's scene reads the node rates from its claims, lists them with the date checked, and stores none in its params", () => {
    for (const level of [0, 1, 2] as const) {
      const i = find('pd-ratio', level, (x) => x.params.dep === 'sglang')
      expect(i.claims).toEqual([NODE_GPUS, OUT_TPS, IN_TPS].map((c) => `${c}@${byId[c].verifiedAt}`).sort())
      expect(i.params.p).toBeUndefined()
      expect(i.params.d).toBeUndefined()
      expect(stem(i)).toContain('52,300')
      expect(stem(i)).toContain('22,300')
      expect(truthOf(i)).toBeCloseTo((num(i, 'P') * claimNumber(OUT_TPS)) / (claimNumber(IN_TPS) * num(i, 'O')), 9)
      expect(i.answer).toMatchObject({ unit: 'prefill per decode' })
    }
    // the transfer level quotes per-worker rates, which the claims do not
    expect(all('pd-ratio', [3]).every((i) => i.params.dep === 'synthetic')).toBe(true)
  })

  test('Llama-3-8B and Llama-3-70B bytes per token are claims; any other model is hypothetical and says so', () => {
    for (const variant of ['transfer-ms', 'load-or-recompute']) {
      const seen = new Set(all(variant).map((i) => String(i.params.model)))
      expect([...seen].sort()).toEqual(['custom', 'llama3-70b', 'llama3-8b'])
      for (const [model, id] of [['llama3-8b', KV_8B], ['llama3-70b', KV_70B]] as const) {
        const i = find(variant, 1, (x) => x.params.model === model)
        expect(i.claims).toEqual([`${id}@${byId[id].verifiedAt}`])
        expect(i.params.b).toBeUndefined()
        expect(stem(i)).toContain(claimNumber(id).toLocaleString('en-US'))
      }
      const hypothetical = find(variant, 1, (x) => x.params.model === 'custom')
      expect(hypothetical.claims).toEqual([])
      expect(stem(hypothetical)).toContain('The model is hypothetical and keeps')
    }
  })

  test('every scenario number is declared hypothetical, and no instance quotes an unsourced real figure', () => {
    for (const v of prefill.variants) {
      for (const level of LEVELS) {
        for (const i of seeds.map((s) => prefill.make(s, level, v.id))) {
          expect(stem(i)).toContain('hypothetical')
          for (const c of i.claims) expect(c).toMatch(/^[^@]+@\d{4}-\d{2}-\d{2}$/)
        }
      }
    }
  })

  test('hit-gap and namespace-cost draw SGLang\'s node in some scenes and a hypothetical GPU in others', () => {
    for (const variant of ['hit-gap', 'namespace-cost']) {
      for (const level of LEVELS) {
        const xs = seeds.map((s) => prefill.make(s, level, variant))
        const real = xs.filter((i) => i.claims.length > 0)
        expect(real.length).toBeGreaterThan(0)
        expect(real.length).toBeLessThan(xs.length)
        for (const i of real) expect(i.claims.some((c) => c.startsWith(`${IN_TPS}@`))).toBe(true)
      }
    }
  })
})

describe("SGLang's node: one GPU's rate for a request and for a GPU-second (F6)", () => {
  test('hit-gap times one request at the per-GPU rate namespace-cost uses, 8 times the node-rate gap, and both stems say why', () => {
    const pin = prefill.pins.find((p) => p.name.includes("one GPU's share"))!
    const i = pin.make()
    expect(i.params).toEqual({ dep: 'sglang', c: 2000 })
    expect(truthOf(i).toFixed(1)).toBe('305.9')
    // the whole node's rate would give 38.2 ms, a gap the node's GPU count too small
    expect(truthOf(i) / ((2000 / claimNumber(IN_TPS)) * 1000)).toBeCloseTo(claimNumber(NODE_GPUS), 9) // gen-literal-ok: hand check
    expect(i.claims).toEqual([NODE_GPUS, IN_TPS].map((c) => `${c}@${byId[c].verifiedAt}`).sort())
    for (const variant of ['hit-gap', 'namespace-cost']) {
      for (const level of LEVELS) {
        const sg = find(variant, level, (x) => x.params.dep === 'sglang')
        expect(stem(sg)).toContain('data-parallel')
        expect(stem(sg)).toContain("one GPU's share of the node rate")
        const syn = find(variant, level, (x) => x.params.dep === 'synthetic')
        expect(stem(syn)).toContain('A hypothetical prefill GPU processes')
      }
    }
    expect(stem(i)).toContain("a hit takes its tokens out of that GPU's work")
    expect(stem(find('namespace-cost', 2, (x) => x.params.dep === 'sglang'))).toContain("A GPU-second is one GPU's work")
    expect(stem(find('hit-gap', 2, (x) => x.params.dep === 'synthetic'))).toContain("the probe's prompt is prefilled on one such GPU")
  })
})

describe('the formulas, from the params alone', () => {
  test('pd-ratio: (λ·P ÷ p) ÷ (λ·O ÷ d), and λ cancels', () => {
    const i = find('pd-ratio', 2, (x) => x.params.dep === 'synthetic')
    expect(truthOf(i)).toBeCloseTo(((num(i, 'lam') * num(i, 'P')) / num(i, 'p')) / ((num(i, 'lam') * num(i, 'O')) / num(i, 'd')), 9)
    const other = prefill.make(i.seed, 2, 'pd-ratio')
    const twice = { ...other, params: { ...other.params, lam: num(i, 'lam') * 2 } }
    expect(truthOf(i)).toBeCloseTo((num(twice, 'P') * num(twice, 'd')) / (num(twice, 'p') * num(twice, 'O')), 9)
    expect(stem(i)).toContain('One prefill GPU processes')
  })

  test('pd-ratio keeps its answer between 0.15 and 8 so a fleet is believable', () => {
    for (const i of all('pd-ratio')) {
      expect(truthOf(i)).toBeGreaterThanOrEqual(0.15)
      expect(truthOf(i)).toBeLessThanOrEqual(8)
    }
  })

  test('pd-ratio at the transfer level gives each worker\'s rate in all and its GPUs, and the ratio is in GPUs', () => {
    const i = find('pd-ratio', 3, (x) => num(x, 'gp') !== num(x, 'gd'))
    const pre = num(i, 'p') / num(i, 'gp')
    const dec = num(i, 'd') / num(i, 'gd')
    expect(truthOf(i)).toBeCloseTo((num(i, 'P') / pre) / (num(i, 'O') / dec), 9)
    expect(stem(i)).toContain('A prefill worker spans')
    expect(stem(i)).toContain('in all')
    expect(partsText(prefill.solution(i)[0].text)).toContain('Prefill rate per GPU')
  })

  test('transfer-ms: tokens × bytes per token ÷ link × 1,000', () => {
    const i = find('transfer-ms', 2, (x) => x.params.model === 'custom')
    expect(truthOf(i)).toBeCloseTo(((num(i, 'P') * num(i, 'b')) / (num(i, 'B') * 1e9)) * 1000, 9) // gen-literal-ok: hand check
    expect(i.answer).toMatchObject({ unit: 'ms' })
    expect(stem(i)).toContain('GB/s')
    expect(all('transfer-ms', [0, 1, 2]).every((x) => x.params.lu === undefined)).toBe(true)
  })

  test('transfer-ms at the transfer level quotes the link in Gb/s or GiB/s, and the answer converts it', () => {
    const bits = find('transfer-ms', 3, (x) => x.params.lu === 'Gb/s')
    const kv = (i: Instance): number => (i.params.model === 'llama3-70b' ? 327_680 : i.params.model === 'llama3-8b' ? 131_072 : num(i, 'b')) // gen-literal-ok: claim values
    expect(truthOf(bits)).toBeCloseTo(((num(bits, 'P') * kv(bits)) / ((num(bits, 'B') / 8) * 1e9)) * 1000, 6) // gen-literal-ok: hand check
    expect(stem(bits)).toContain('gigabits per second')
    const gib = find('transfer-ms', 3, (x) => x.params.lu === 'GiB/s')
    expect(truthOf(gib)).toBeCloseTo(((num(gib, 'P') * kv(gib)) / (num(gib, 'B') * 2 ** 30)) * 1000, 6) // gen-literal-ok: hand check
    expect(stem(gib)).toContain('2³⁰ bytes per second')
    expect(new Set(all('transfer-ms', [3]).map((i) => i.params.lu))).toEqual(new Set(['Gb/s', 'GiB/s']))
  })

  test('transfer-ms stays between 2 ms and 1.5 s', () => {
    for (const i of all('transfer-ms')) {
      expect(truthOf(i)).toBeGreaterThanOrEqual(2)
      expect(truthOf(i)).toBeLessThanOrEqual(1500)
    }
  })

  test('load-or-recompute: bytes per token × prefill rate, and the prefix length cancels', () => {
    const i = find('load-or-recompute', 2, (x) => x.params.model === 'custom')
    expect(truthOf(i)).toBeCloseTo((num(i, 'b') * num(i, 'p')) / 1e9, 9) // gen-literal-ok: hand check
    expect(i.answer).toMatchObject({ unit: 'GB/s' })
    const longer = prefill.make(i.seed, 2, 'load-or-recompute')
    expect(truthOf({ ...longer, params: { ...longer.params, n: num(i, 'n') * 2 } } as Instance)).toBe(truthOf(i))
    // the last step's justification names the cancellation
    expect(partsText(prefill.solution(i).at(-1)!.text)).toContain('the prefix length cancels')
    const claimed = find('load-or-recompute', 0, (x) => x.params.model === 'llama3-8b')
    expect(truthOf(claimed)).toBeCloseTo((131_072 * num(claimed, 'p')) / 1e9, 9) // gen-literal-ok: the claim's value
  })

  test('load-or-recompute at the transfer level answers in gigabits per second', () => {
    const i = find('load-or-recompute', 3, (x) => x.params.model === 'custom')
    expect(i.answer).toMatchObject({ unit: 'Gb/s' })
    expect(truthOf(i)).toBeCloseTo(((num(i, 'b') * num(i, 'p')) / 1e9) * 8, 9) // gen-literal-ok: hand check
    expect(stem(i)).toContain('in Gb/s')
    expect(partsText(prefill.solution(i).at(-1)!.text)).toContain('× 8')
  })

  test('hit-gap: cached tokens ÷ prefill rate, in milliseconds', () => {
    const i = find('hit-gap', 2, (x) => x.params.dep === 'synthetic')
    expect(truthOf(i)).toBeCloseTo((num(i, 'c') / num(i, 'p')) * 1000, 9) // gen-literal-ok: hand check
    const sg = find('hit-gap', 2, (x) => x.params.dep === 'sglang')
    // one request is prefilled on one GPU of the node (data-parallel attention), so at the node rate over its GPUs
    expect(truthOf(sg)).toBeCloseTo((num(sg, 'c') / (claimNumber(IN_TPS) / claimNumber(NODE_GPUS))) * 1000, 9) // gen-literal-ok: hand check
    expect(sg.params.p).toBeUndefined()
    expect(partsText(prefill.solution(sg)[0].text)).toContain('Prefill rate one request gets = node rate ÷ GPUs per node')
    for (const x of all('hit-gap')) {
      expect(truthOf(x)).toBeGreaterThanOrEqual(5)
      expect(truthOf(x)).toBeLessThanOrEqual(2000)
    }
  })

  test('hit-gap at the transfer level counts only whole cached blocks', () => {
    const i = find('hit-gap', 3, (x) => x.params.dep === 'synthetic' && num(x, 'c') % num(x, 'block') !== 0)
    const cached = Math.floor(num(i, 'c') / num(i, 'block')) * num(i, 'block')
    expect(cached).toBeLessThan(num(i, 'c'))
    expect(truthOf(i)).toBeCloseTo((cached / num(i, 'p')) * 1000, 9) // gen-literal-ok: hand check
    expect(stem(i)).toContain('whole blocks')
    expect(partsText(prefill.solution(i)[0].text)).toContain('⌊matched ÷ block⌋')
    expect(all('hit-gap', [0, 1, 2]).every((x) => x.params.block === undefined)).toBe(true)
  })

  test('namespace-cost: (N − 1) · S ÷ p GPU-seconds', () => {
    const i = find('namespace-cost', 2, (x) => x.params.dep === 'synthetic')
    expect(truthOf(i)).toBeCloseTo(((num(i, 'N') - 1) * num(i, 'S')) / num(i, 'p'), 9)
    expect(i.answer).toMatchObject({ unit: 'GPU-s' })
    const sg = find('namespace-cost', 2, (x) => x.params.dep === 'sglang')
    expect(truthOf(sg)).toBeCloseTo(((num(sg, 'N') - 1) * num(sg, 'S')) / (claimNumber(IN_TPS) / claimNumber(NODE_GPUS)), 9)
    expect(partsText(prefill.solution(sg)[0].text)).toContain('Prefill rate per GPU = node rate ÷ GPUs per node')
    for (const x of all('namespace-cost', [0, 1, 2])) {
      expect(truthOf(x)).toBeGreaterThanOrEqual(0.1)
      expect(truthOf(x)).toBeLessThanOrEqual(500)
    }
  })

  test('namespace-cost at the transfer level multiplies by the daily rebuilds', () => {
    const i = find('namespace-cost', 3, (x) => x.params.dep === 'synthetic')
    expect(truthOf(i)).toBeCloseTo((((num(i, 'N') - 1) * num(i, 'S')) / num(i, 'p')) * num(i, 'refills'), 9)
    expect(i.answer).toMatchObject({ unit: 'GPU-s per day' })
    expect(stem(i)).toContain('rebuilt')
    expect(all('namespace-cost', [0, 1, 2]).every((x) => x.params.refills === undefined)).toBe(true)
  })
})

describe('levels', () => {
  test('level 0 shows every step but the last, level 1 blanks one middle step, levels 2 and 3 show none', () => {
    for (const v of prefill.variants) {
      for (const seed of seeds.slice(0, 30)) {
        const l0 = prefill.make(seed, 0, v.id)
        const steps = prefill.solution(l0)
        expect(l0.prompt.worked?.length).toBe(steps.length - 1)
        expect(l0.prompt.worked?.some((s) => s.blank)).toBe(false)
        // the answer is the learner's to complete: no worked step carries the final result
        const last = steps[steps.length - 1].result?.value
        expect(l0.prompt.worked?.some((s) => s.result?.value === last)).toBe(false)

        const l1 = prefill.make(seed, 1, v.id)
        const shown = l1.prompt.worked ?? []
        expect(shown.length).toBe(prefill.solution(l1).length - 1)
        expect(shown.filter((s) => s.blank).length).toBe(1)
        expect(shown[0].blank).toBeFalsy()

        expect(prefill.make(seed, 2, v.id).prompt.worked).toBeUndefined()
        expect(prefill.make(seed, 3, v.id).prompt.worked).toBeUndefined()
      }
    }
  })

  test('the solution ends on the answer, and its last result is a gradable response, at every level', () => {
    for (const v of prefill.variants) {
      for (const level of LEVELS) {
        for (const seed of seeds.slice(0, 20)) {
          const i = prefill.make(seed, level, v.id)
          const r = responseFromSolution(i, prefill.solution(i))
          expect(r).toBeDefined()
          expect(prefill.grade(i, r as Response).score).toBe(1)
        }
      }
    }
  })

  test('level 0 params are round', () => {
    for (const v of prefill.variants) {
      for (const i of seeds.map((s) => prefill.make(s, 0, v.id))) {
        for (const x of Object.values(i.params)) {
          if (typeof x === 'number') expect(Number.isInteger(Math.log2(x)) || String(x).replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length <= 2).toBe(true)
        }
      }
    }
  })
})

describe('diagnoses', () => {
  test('flipped: decode GPUs over prefill GPUs', () => {
    const i = find('pd-ratio', 2, (x) => Math.abs(1 / truthOf(x) ** 2 - 1) > 0.2)
    const g = prefill.grade(i, { kind: 'numeric', value: 1 / truthOf(i), unit: 'prefill per decode' })
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('prefill.flipped')
    expect(g.diagnosis?.message).toContain('prefill over decode')
    // a ratio of 1 is its own flip: the rule must not claim a right answer
    const rule = prefill.ratioRules.find((r) => r.id === 'prefill.flipped')
    const balanced = { ...i, params: { dep: 'synthetic', lam: 10, P: 4000, O: 400, p: 20000, d: 2000 } } as Instance
    expect(typeof rule?.ratio === 'function' ? rule.ratio(balanced) : undefined).toBeNull()
    expect(typeof rule?.ratio === 'function' ? rule.ratio(i) : undefined).not.toBeNull()
  })

  test('tokens-not-rate: the prompt-to-output token ratio with no rates', () => {
    const i = find('pd-ratio', 2, (x) => Math.abs(num(x, 'p') / num(x, 'd') - 1) > 0.3 && x.params.dep === 'synthetic')
    const g = prefill.grade(i, { kind: 'numeric', value: num(i, 'P') / num(i, 'O'), unit: 'prefill per decode' })
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('prefill.tokens-not-rate')
    expect(g.diagnosis?.message).toContain('per-GPU rate')
    const l3 = find('pd-ratio', 3, (x) => Math.abs(num(x, 'p') / num(x, 'gp') / (num(x, 'd') / num(x, 'gd')) - 1) > 0.3)
    expect(prefill.grade(l3, { kind: 'numeric', value: num(l3, 'P') / num(l3, 'O'), unit: 'prefill per decode' }).diagnosis?.id).toBe('prefill.tokens-not-rate')
  })

  test('bits-bytes: a link in Gb/s read as GB/s, and a GB/s answer not turned into Gb/s', () => {
    const a = find('transfer-ms', 3, (x) => x.params.lu === 'Gb/s')
    const ga = prefill.grade(a, slipped(a, 1 / 8))
    expect(ga.diagnosis?.id).toBe('prefill.bits-bytes')
    expect(ga.diagnosis?.message).toContain('gigabits per second')
    const b = find('load-or-recompute', 3, () => true)
    const gb = prefill.grade(b, slipped(b, 1 / 8))
    expect(gb.diagnosis?.id).toBe('prefill.bits-bytes')
    expect(gb.diagnosis?.message).toContain('multiply the GB/s')
    // the rule does not apply where nothing is quoted in bits
    const rule = prefill.ratioRules.find((r) => r.id === 'prefill.bits-bytes')
    const plain = find('transfer-ms', 2, () => true)
    expect(typeof rule?.ratio === 'function' ? rule.ratio(plain) : undefined).toBeNull()
  })

  test('ms-s: an answer left in seconds, for a hand-off and for a hit, and it beats the generic kilo rule', () => {
    for (const v of ['transfer-ms', 'hit-gap']) {
      const i = find(v, 2, () => true)
      const g = prefill.grade(i, slipped(i, 1 / 1000))
      expect(g.diagnosis?.id).toBe('prefill.ms-s')
      expect(g.diagnosis?.message).toContain('milliseconds')
    }
    const other = find('namespace-cost', 2, () => true)
    expect(prefill.grade(other, slipped(other, 1 / 1000)).diagnosis?.id).toBe('unit.kilo')
  })

  test('gb-gib: a link in GiB/s divided into GB without converting', () => {
    const i = find('transfer-ms', 3, (x) => x.params.lu === 'GiB/s')
    const g = prefill.grade(i, slipped(i, 1.0737))
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('prefill.gb-gib')
    expect(g.diagnosis?.message).toContain('GiB/s')
    const rule = prefill.ratioRules.find((r) => r.id === 'prefill.gb-gib')
    expect(typeof rule?.ratio === 'function' ? rule.ratio(find('transfer-ms', 3, (x) => x.params.lu === 'Gb/s')) : undefined).toBeNull()
  })

  test('one-tenant: all N tenants counted instead of N − 1, only where the two can be told apart', () => {
    const i = find('namespace-cost', 2, (x) => num(x, 'N') === 4)
    const g = prefill.grade(i, slipped(i, 4 / 3))
    expect(g.diagnosis?.id).toBe('prefill.one-tenant')
    expect(g.diagnosis?.message).toContain('all 4 tenants')
    expect(g.diagnosis?.message).toContain('the other 3')
    const rule = prefill.ratioRules.find((r) => r.id === 'prefill.one-tenant')
    expect(typeof rule?.ratio === 'function' ? rule.ratio(find('hit-gap', 2, () => true)) : undefined).toBeNull()
    expect(typeof rule?.ratio === 'function' ? rule.ratio(find('namespace-cost', 2, (x) => num(x, 'N') === 16)) : undefined).not.toBeNull()
  })

  test('a wrong answer that matches no rule gets the truth, not a diagnosis; a right one is ok within 2 %', () => {
    const i = find('hit-gap', 2, () => true)
    const g = prefill.grade(i, slipped(i, 1.5))
    expect(g.ok).toBe(false)
    expect(g.diagnosis).toBeUndefined()
    expect(g.feedback).toContain('the answer is')
    expect(prefill.grade(i, slipped(i, 1.015)).ok).toBe(true)
    expect(prefill.grade(i, slipped(i, 1.03)).ok).toBe(false)
  })
})
