import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkFamily, checkHashes, genSeeds, lintLiterals, responseFromSolution, type HashRows } from '../../scripts/verify-generators'
import { byId, claimNumber } from '../../src/data/claims'
import { BOOT, CHAT_TOKENS } from '../../src/lib/boot/model'
import { partsText } from '../../src/lib/items/core'
import kv from '../../src/lib/items/families/kv'
import { correctResponse } from '../../src/lib/items/grade'
import type { Instance, Level, Response } from '../../src/lib/items/types'

const SEEDS = genSeeds(200)
const LEVELS: Level[] = [0, 1, 2, 3]
const FILE = new URL('../../src/lib/items/families/kv.ts', import.meta.url)

/** The first instance of a variant and level, over a fixed spread of seeds, that satisfies `pred`. */
function find(variant: string, level: Level, pred: (i: Instance) => boolean): Instance {
  for (const seed of SEEDS) {
    const i = kv.make(seed, level, variant)
    if (pred(i)) return i
  }
  throw new Error(`no ${variant}@L${level} instance matches`)
}

const truthOf = (i: Instance): number => (i.answer.kind === 'choice' ? Number.NaN : i.answer.truth)
const num = (i: Instance, k: string): number => Number(i.params[k])

/** The response a learner who made a slip of ratio `rho` would give, in the answer's own unit. */
function slipped(i: Instance, rho: number): Response {
  const a = i.answer
  if (a.kind === 'numeric') return { kind: 'numeric', value: a.truth * rho, unit: a.unit }
  if (a.kind === 'estimate') return { kind: 'estimate', value: a.truth * rho }
  throw new Error('a choice has no slip ratio')
}

describe('kv: the §5.6 suite', () => {
  test('passes at 100 seeds with no problems and no dead rules', () => {
    const r = checkFamily(kv, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.instances).toBe(100 * 4 * 4)
  })

  test('its hash rows match the fixture', () => {
    const rows = JSON.parse(readFileSync(new URL('../fixtures/items/hashes.json', import.meta.url), 'utf8')) as HashRows
    expect(checkHashes(kv, rows)).toEqual([])
    expect(Object.keys(rows.kv).sort()).toEqual(kv.variants.map((v) => v.id).sort())
  })

  test('its source passes the literal lint with nothing annotated away but the named scenario figures', () => {
    expect(lintLiterals(FILE.pathname, readFileSync(FILE, 'utf8'))).toEqual([])
  })

  test('declares the four variants at levels 0 to 3 and the three KCs', () => {
    expect(kv.variants.map((v) => v.id)).toEqual(['bytes-per-token', 'seq-bytes', 'capacity-tokens', 'capacity-chats'])
    for (const v of kv.variants) expect(v.levels).toEqual([0, 1, 2, 3])
    expect([...kv.kcs].sort()).toEqual(['t5.gqa-kv-heads', 't5.kv-bytes-per-token', 't5.kv-capacity'])
  })

  test('make is a pure function of (seed, level, variant); an unspecified variant is chosen by the seed', () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS.slice(0, 20)) {
        expect(kv.make(seed, level)).toEqual(kv.make(seed, level))
        expect(kv.make(seed, level).level).toBe(level)
      }
      const seen = new Set(SEEDS.map((s) => kv.make(s, level).variant))
      expect(seen.size).toBe(4)
    }
  })
})

describe('kv: the pins', () => {
  const byName = (part: string) => {
    const p = kv.pins.find((x) => x.name.includes(part))
    if (!p) throw new Error(`no pin "${part}"`)
    return p
  }
  const truth = (part: string): number => truthOf(byName(part).make())

  test('Llama-3-8B BF16 is 131,072 B per token, the claim', () => {
    expect(truth('Llama-3-8B BF16')).toBe(131_072)
    expect(claimNumber('model.llama3-8b.kv-bytes-per-token')).toBe(131_072)
    expect(byName('Llama-3-8B BF16').make().claims).toContain(`model.llama3-8b.layers@${byId['model.llama3-8b.layers'].verifiedAt}`)
  })

  test('the t5.l4 lesson figures: 70B 320 KiB per token, 8B 512 MiB for a 4k chat and 16 GiB for 128k', () => {
    expect(truth('Llama-3-70B')).toBe(327_680)
    expect(truth('4k conversation')).toBe(512)
    expect(truth('128k context')).toBe(16)
  })

  test("Boot's 487,823 tokens and 119.1 chats on an H100 agree with src/lib/boot/model.ts", () => {
    expect(Math.abs(truth('tokens of KV cache') - BOOT.kvTokens)).toBeLessThan(1)
    expect(Math.round(truth('tokens of KV cache'))).toBe(487_823)
    expect(truth('chats of 4,096')).toBeCloseTo(BOOT.kvTokens / CHAT_TOKENS, 6)
    expect(truth('chats of 4,096').toFixed(1)).toBe('119.1')
    // the same bands as tests/boot/model.test.ts
    expect(truth('tokens of KV cache')).toBeGreaterThanOrEqual(480_000)
    expect(truth('tokens of KV cache')).toBeLessThanOrEqual(495_000)
  })

  test('every pin grades its own true answer ok', () => {
    for (const p of kv.pins) {
      const i = p.make()
      expect(kv.grade(i, correctResponse(i)).ok).toBe(true)
    }
  })
})

describe('kv: claim-backed and synthetic scenes', () => {
  test('every variant and level draws both, and a claim-backed shape equals its claims', () => {
    for (const v of kv.variants) {
      for (const level of LEVELS) {
        const all = SEEDS.map((s) => kv.make(s, level, v.id))
        const real = all.filter((i) => i.params.model !== 'synthetic')
        expect(real.length).toBeGreaterThan(0)
        expect(real.length).toBeLessThan(all.length)
        for (const i of real) {
          const claim = `model.${i.params.model}`
          expect(num(i, 'layers')).toBe(claimNumber(`${claim}.layers`))
          expect(num(i, 'kvHeads')).toBe(claimNumber(`${claim}.kv-heads`))
          expect(num(i, 'attnHeads')).toBe(claimNumber(`${claim}.attn-heads`))
          expect(num(i, 'headDim')).toBe(claimNumber(`${claim}.head-dim`))
          expect(i.claims.length).toBeGreaterThanOrEqual(4)
        }
        for (const i of all.filter((x) => x.params.model === 'synthetic')) {
          expect(i.claims).toEqual([])
          expect(partsText(i.prompt.stem)).toContain('hypothetical')
        }
      }
    }
  })

  test('the claim-backed models include the configs B3 added', () => {
    const models = new Set(SEEDS.flatMap((s) => LEVELS.map((l) => String(kv.make(s, l, 'bytes-per-token').params.model))))
    for (const m of ['llama3-8b', 'llama3-70b', 'qwen3-0-6b', 'mixtral-8x7b', 'synthetic']) expect(models.has(m)).toBe(true)
  })

  test('capacity on a real GPU row reads the HBM claim and prices only the model whose parameters are claimed', () => {
    const i = find('capacity-tokens', 2, (x) => typeof x.params.gpu === 'string')
    expect(i.params.model).toBe('llama3-8b')
    expect(i.claims.some((c) => c.startsWith('hw.'))).toBe(true)
    expect(i.claims.some((c) => c.startsWith('model.llama3-8b.params@'))).toBe(true)
    const chip = i.prompt.stem.filter((p) => p.t === 'claim').map((p) => (p.t === 'claim' ? p.claim : ''))
    expect(chip.some((c) => c.startsWith('hw.'))).toBe(true)
  })

  test('a claim update changes the fingerprint (the claims carry id@verifiedAt)', () => {
    const i = kv.make(SEEDS[0], 2, 'bytes-per-token')
    for (const c of i.claims) expect(c).toMatch(/^[^@]+@\d{4}-\d{2}-\d{2}$/)
  })
})

describe('kv: levels', () => {
  test('level 0 shows every step but the last, level 1 blanks one middle step, levels 2 and 3 show none', () => {
    for (const v of kv.variants) {
      for (const seed of SEEDS.slice(0, 30)) {
        const l0 = kv.make(seed, 0, v.id)
        const steps = kv.solution(l0)
        expect(l0.prompt.worked?.length).toBe(steps.length - 1)
        expect(l0.prompt.worked?.some((s) => s.blank)).toBe(false)
        // the answer is the learner's to complete: no worked step carries the final result
        const last = steps[steps.length - 1].result?.value
        expect(l0.prompt.worked?.some((s) => s.result?.value === last)).toBe(false)

        const l1 = kv.make(seed, 1, v.id)
        const shown = l1.prompt.worked ?? []
        expect(shown.length).toBe(kv.solution(l1).length - 1)
        expect(shown.filter((s) => s.blank).length).toBe(1)
        expect(shown.find((s) => s.blank)?.result).toBeUndefined()
        expect(shown[0].blank).toBeFalsy()

        expect(kv.make(seed, 2, v.id).prompt.worked).toBeUndefined()
        expect(kv.make(seed, 3, v.id).prompt.worked).toBeUndefined()
      }
    }
  })

  test('level 3 gives a group size, not the KV heads, and assesses the GQA KC too', () => {
    for (const v of kv.variants) {
      const i = find(v.id, 3, () => true)
      expect(i.kcs).toContain('t5.gqa-kv-heads')
      expect(partsText(i.prompt.stem)).toContain('share one K and V head')
      expect(partsText(i.prompt.stem)).not.toContain('KV heads')
      expect(num(i, 'attnHeads') / num(i, 'kvHeads')).toBeGreaterThan(1)
      expect(kv.solution(i)[0].text.map((p) => partsText([p])).join('')).toContain('group size')
      expect(kv.make(SEEDS[0], 2, v.id).kcs).not.toContain('t5.gqa-kv-heads')
    }
  })

  test('level 3 changes the surface: binary units for sizes, a different GPU row for capacity', () => {
    expect(find('bytes-per-token', 3, () => true).answer).toMatchObject({ kind: 'numeric', unit: 'KiB' })
    expect(['MiB', 'GiB']).toContain((find('seq-bytes', 3, () => true).answer as { unit: string }).unit)
    expect(['MB', 'GB']).toContain((find('seq-bytes', 2, () => true).answer as { unit: string }).unit)
    const gpus = new Set(SEEDS.map((s) => kv.make(s, 3, 'capacity-tokens').params.gpu).filter((g) => typeof g === 'string'))
    expect(gpus.has('h100')).toBe(false)
    expect(gpus.size).toBeGreaterThan(1)
  })

  test('the solution ends on the answer, and its last result is a gradable response', () => {
    for (const v of kv.variants) {
      for (const level of LEVELS) {
        const i = kv.make(SEEDS[3], level, v.id)
        const r = responseFromSolution(i, kv.solution(i))
        expect(r).toBeDefined()
        expect(kv.grade(i, r as Response).score).toBe(1)
      }
    }
  })

  test('chats are never fewer than a handful, and capacity is the HBM left after the weights', () => {
    for (const level of LEVELS) {
      for (const s of SEEDS) {
        const i = kv.make(s, level, 'capacity-chats')
        expect(truthOf(i)).toBeGreaterThan(1)
      }
    }
    const i = find('capacity-tokens', 1, (x) => x.params.gpu === undefined)
    const free = (num(i, 'hbmGb') - num(i, 'weightsGb')) * 1e9
    const perToken = 2 * num(i, 'layers') * num(i, 'kvHeads') * num(i, 'headDim') * ({ bf16: 2, fp16: 2, fp8: 1, int8: 1, fp4: 0.5 } as Record<string, number>)[String(i.params.dtype)]
    expect(truthOf(i)).toBeCloseTo(free / perToken, 6)
  })
})

describe('kv: diagnoses', () => {
  test('priced FP16: an FP8 cache priced at 2 bytes is twice the size, an FP4 cache four times', () => {
    const fp8 = find('bytes-per-token', 2, (i) => i.params.dtype === 'fp8')
    const g8 = kv.grade(fp8, slipped(fp8, 2))
    expect(g8.ok).toBe(false)
    expect(g8.diagnosis?.id).toBe('kv.priced-fp16')
    expect(g8.diagnosis?.message).toBe('You priced FP16: this cache is FP8, 1 byte per value.')
    const fp4 = find('seq-bytes', 2, (i) => i.params.dtype === 'fp4')
    expect(kv.grade(fp4, slipped(fp4, 4)).diagnosis?.id).toBe('kv.priced-fp16')
    expect(kv.grade(fp4, slipped(fp4, 4)).diagnosis?.message).toContain('half a byte per value')
    // a BF16 cache has nothing to over-price
    const bf16 = find('bytes-per-token', 2, (i) => i.params.dtype === 'bf16' && num(i, 'attnHeads') === num(i, 'kvHeads'))
    expect(kv.grade(bf16, slipped(bf16, 2)).diagnosis?.id).not.toBe('kv.priced-fp16')
  })

  test('forgot K and V: half the truth', () => {
    const i = find('bytes-per-token', 2, (x) => num(x, 'layers') > 20)
    const g = kv.grade(i, slipped(i, 0.5))
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('kv.forgot-k-and-v')
  })

  test('used query heads: attention heads over KV heads times the truth', () => {
    const i = find('bytes-per-token', 2, (x) => num(x, 'attnHeads') / num(x, 'kvHeads') === 4 && x.params.dtype === 'bf16')
    const g = kv.grade(i, slipped(i, 4))
    expect(g.diagnosis?.id).toBe('kv.query-heads')
    expect(g.diagnosis?.message).toContain(`${num(i, 'attnHeads')} attention heads`)
    // multi-head attention has no GQA slip: the rule does not apply
    const mha = find('bytes-per-token', 2, (x) => num(x, 'attnHeads') === num(x, 'kvHeads'))
    expect(kv.ratioRules.find((r) => r.id === 'kv.query-heads')?.ratio).toBeInstanceOf(Function)
    const rule = kv.ratioRules.find((r) => r.id === 'kv.query-heads')
    expect(typeof rule?.ratio === 'function' ? rule.ratio(mha) : undefined).toBeNull()
  })

  test('one layer: the truth over the layer count', () => {
    const i = find('bytes-per-token', 2, (x) => x.params.dtype === 'bf16' && num(x, 'attnHeads') === num(x, 'kvHeads'))
    const g = kv.grade(i, slipped(i, 1 / num(i, 'layers')))
    expect(g.diagnosis?.id).toBe('kv.one-layer')
  })

  test('a capacity answer carries the inverse ratio of each slip', () => {
    const i = find('capacity-tokens', 2, (x) => x.params.dtype === 'fp8' && num(x, 'attnHeads') / num(x, 'kvHeads') === 4)
    expect(kv.grade(i, slipped(i, 0.5)).diagnosis?.id).toBe('kv.priced-fp16')
    expect(kv.grade(i, slipped(i, 2)).diagnosis?.id).toBe('kv.forgot-k-and-v')
    expect(kv.grade(i, slipped(i, 0.25)).diagnosis?.id).toBe('kv.query-heads')
    expect(kv.grade(i, slipped(i, num(i, 'layers'))).diagnosis?.id).toBe('kv.one-layer')
    expect(kv.grade(i, slipped(i, 0.25)).ok).toBe(false)
    // the slip is still a slip for chats
    const c = find('capacity-chats', 2, (x) => x.params.dtype === 'fp8')
    expect(kv.grade(c, slipped(c, 0.5)).diagnosis?.id).toBe('kv.priced-fp16')
  })

  test('unit slips: 128 KB for 128 KiB, and a prefix off by 1,000', () => {
    const i = find('bytes-per-token', 2, (x) => x.params.model === 'llama3-8b' && x.params.dtype === 'bf16')
    const truthBytes = truthOf(i)
    // the right bytes written in the wrong unit: KiB's number with a KB label
    const kibi = kv.grade(i, { kind: 'numeric', value: truthBytes / 1024, unit: 'KB' })
    expect(kibi.ok).toBe(false)
    expect(kibi.diagnosis?.id).toBe('unit.kibi-vs-kilo')
    // the right number in the right unit is ok, in either spelling
    expect(kv.grade(i, { kind: 'numeric', value: truthBytes / 1024, unit: 'KiB' }).ok).toBe(true)
    expect(kv.grade(i, { kind: 'numeric', value: truthBytes / 1000, unit: 'KB' }).ok).toBe(true)
    const kilo = kv.grade(i, { kind: 'numeric', value: truthBytes * 1000, unit: 'B' })
    expect(kilo.diagnosis?.id).toBe('unit.kilo')
    // a unit the item does not offer is ungradable, not wrong
    expect(kv.grade(i, { kind: 'numeric', value: 1, unit: 'furlongs' }).diagnosis).toBeUndefined()
  })

  test('a sequence answered in the wrong decimal or binary prefix is diagnosed', () => {
    const i = find('seq-bytes', 2, () => true)
    const a = i.answer as { truth: number; unit: string }
    expect(kv.grade(i, { kind: 'numeric', value: a.truth * 1024, unit: a.unit }).diagnosis?.id).toBe('unit.kibi')
    expect(kv.grade(i, { kind: 'numeric', value: a.truth / 1000, unit: a.unit }).diagnosis?.id).toBe('unit.kilo')
  })

  test('a wrong answer that matches no rule gets the truth, not a diagnosis', () => {
    const i = find('bytes-per-token', 2, () => true)
    const g = kv.grade(i, slipped(i, 1.5))
    expect(g.ok).toBe(false)
    expect(g.diagnosis).toBeUndefined()
    expect(g.feedback).toContain('the answer is')
  })

  test('the interval is scored for capacity estimates', () => {
    const i = find('capacity-tokens', 2, () => true)
    const t = truthOf(i)
    const g = kv.grade(i, { kind: 'estimate', value: t, lo: t / 1.5, hi: t * 1.5 })
    expect(g.ok).toBe(true)
    expect(g.interval?.hit).toBe(true)
    expect(kv.grade(i, { kind: 'estimate', value: t * 1.2 }).ok).toBe(true)
    expect(kv.grade(i, { kind: 'estimate', value: t * 1.3 }).ok).toBe(false)
  })
})
