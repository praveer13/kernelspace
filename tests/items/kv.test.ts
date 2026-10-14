import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkFamily, checkHashes, genSeeds, lintLiterals, readHashRows, responseFromSolution } from '../../scripts/verify-generators'
import { byId, claimNumber } from '../../src/data/claims'
import { BOOT, CHAT_TOKENS } from '../../src/lib/boot/model'
import { partsText } from '../../src/lib/items/core'
import kv from '../../src/lib/items/families/kv'
import { correctResponse } from '../../src/lib/items/grade'
import type { Instance, Level, Response } from '../../src/lib/items/types'
import { zooBytes, zooPresetById, ZOO_CONTEXTS, type ZooModel } from '../../src/lib/kv-zoo'
import { stableStringify } from '../../src/lib/ledger/stable'
import { hash32 } from '../../src/lib/rng'

const SEEDS = genSeeds(200)
const LEVELS: Level[] = [0, 1, 2, 3]
const FILE = new URL('../../src/lib/items/families/kv.ts', import.meta.url)
/** The four K-and-V variants of version 1; the zoo variants came in version 2. */
const KV_VARIANTS = ['bytes-per-token', 'seq-bytes', 'capacity-tokens', 'capacity-chats']
const ZOO_VARIANTS = ['mla-bytes', 'swa-capacity', 'linear-state']

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
    expect(r.instances).toBe(100 * 7 * 4)
  })

  test('its hash rows match the fixture', () => {
    const rows = readHashRows('kv') // tests/fixtures/items/hashes/kv.json
    expect(checkHashes(kv, rows)).toEqual([])
    expect(Object.keys(rows.kv).sort()).toEqual(kv.variants.map((v) => v.id).sort())
  })

  test('its source passes the literal lint with nothing annotated away but the named scenario figures', () => {
    expect(lintLiterals(FILE.pathname, readFileSync(FILE, 'utf8'))).toEqual([])
  })

  test('declares the seven variants at levels 0 to 3 and the three KCs, version 2', () => {
    expect(kv.version).toBe(2)
    expect(kv.variants.map((v) => v.id)).toEqual([...KV_VARIANTS, ...ZOO_VARIANTS])
    for (const v of kv.variants) expect(v.levels).toEqual([0, 1, 2, 3])
    expect([...kv.kcs].sort()).toEqual(['t5.gqa-kv-heads', 't5.kv-bytes-per-token', 't5.kv-capacity'])
  })

  test('the zoo variants assess the family\'s existing KCs, so no KC file changes', () => {
    const kcs = (id: string) => kv.variants.find((v) => v.id === id)?.kcs
    expect(kcs('mla-bytes')).toEqual(['t5.kv-bytes-per-token'])
    expect(kcs('linear-state')).toEqual(['t5.kv-bytes-per-token'])
    expect(kcs('swa-capacity')).toEqual(['t5.kv-capacity'])
    for (const v of ZOO_VARIANTS) for (const level of LEVELS) expect(kv.make(SEEDS[0], level, v).kcs).toEqual(kcs(v))
  })

  test('the four version-1 variants give the instances they gave before, apart from the version field', () => {
    const all = []
    for (const v of KV_VARIANTS) {
      for (const level of LEVELS) {
        for (const seed of genSeeds(25)) {
          const { version, rev, ...rest } = kv.make(seed, level, v)
          expect(version).toBe(2)
          expect(typeof rev).toBe('string')
          all.push(rest)
        }
      }
    }
    // computed from the version-1 family before the zoo variants were added
    expect(hash32(stableStringify(all)).toString(16).padStart(8, '0')).toBe('cd2ac28a')
  })

  test('make is a pure function of (seed, level, variant); an unspecified variant is chosen by the seed', () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS.slice(0, 20)) {
        expect(kv.make(seed, level)).toEqual(kv.make(seed, level))
        expect(kv.make(seed, level).level).toBe(level)
      }
      const seen = new Set(SEEDS.map((s) => kv.make(s, level).variant))
      expect(seen.size).toBe(7)
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
    for (const v of kv.variants.filter((x) => KV_VARIANTS.includes(x.id))) {
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
    for (const v of kv.variants.filter((x) => KV_VARIANTS.includes(x.id))) {
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

describe('kv: the zoo variants (version 2)', () => {
  const gradeOf = (i: Instance, rho: number) => kv.grade(i, slipped(i, rho))
  const bytesPer = (i: Instance): number => ({ bf16: 2, fp16: 2, fp8: 1, int8: 1, fp4: 0.5 } as Record<string, number>)[String(i.params.dtype)]

  /** The same model as a kv-zoo ZooModel: kv-zoo's per-layer arithmetic is the second reader of these items. */
  const zooModelOf = (i: Instance): ZooModel => {
    const base = { id: 'x', name: 'x', note: '', claimIds: [] }
    if (i.variant === 'mla-bytes') return { ...base, groups: [{ count: num(i, 'layers'), label: 'MLA', layer: { kind: 'mla', latentDim: num(i, 'latentDim'), ropeDim: num(i, 'ropeDim') } }] }
    if (i.variant === 'linear-state') {
      return { ...base, groups: [{ count: num(i, 'layers'), label: 'linear', layer: { kind: 'linear', heads: num(i, 'heads'), keyDim: num(i, 'keyDim'), valueDim: num(i, 'valueDim') } }] }
    }
    const kvHeads = num(i, 'kvHeads')
    const headDim = num(i, 'headDim')
    return {
      ...base,
      groups: [
        { count: num(i, 'swaLayers'), label: 'swa', layer: { kind: 'swa', kvHeads, headDim, window: num(i, 'window'), sinks: num(i, 'sinks') } },
        { count: num(i, 'fullLayers'), label: 'full', layer: { kind: 'full', kvHeads, headDim } },
      ],
    }
  }

  test('every instance agrees with kv-zoo: bytes per token, the constant state, and the context that fills the budget', () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS.slice(0, 60)) {
        const mla = kv.make(seed, level, 'mla-bytes')
        const unit = (mla.answer as { unit: string }).unit
        expect(truthOf(mla) * (unit === 'KiB' ? 1024 : 1)).toBe(zooBytes(zooModelOf(mla), 1, bytesPer(mla)).stored)

        const lin = kv.make(seed, level, 'linear-state')
        const state = zooBytes(zooModelOf(lin), num(lin, 'tokens'), bytesPer(lin)).stored
        const per = { MB: 1e6, GB: 1e9, MiB: 1024 ** 2, GiB: 1024 ** 3 }[(lin.answer as { unit: string }).unit] as number
        expect(truthOf(lin)).toBeCloseTo(state / per, 9)
        expect(zooBytes(zooModelOf(lin), 1, bytesPer(lin)).stored).toBe(zooBytes(zooModelOf(lin), 1048576, bytesPer(lin)).stored)

        const swa = kv.make(seed, level, 'swa-capacity')
        const t = truthOf(swa)
        // kv-zoo takes whole tokens: the cache at the integer below the answer fits the budget, the one above does not
        const lo = zooBytes(zooModelOf(swa), Math.floor(t), bytesPer(swa)).stored
        const hi = zooBytes(zooModelOf(swa), Math.floor(t) + 1, bytesPer(swa)).stored
        expect(lo).toBeLessThanOrEqual(num(swa, 'kvGb') * 1e9)
        expect(hi).toBeGreaterThan(num(swa, 'kvGb') * 1e9)
      }
    }
  })

  test('the zoo pins equal the presets at the zoo contexts', () => {
    const pin = (part: string) => {
      const p = kv.pins.find((x) => x.name.includes(part))
      if (!p) throw new Error(`no pin "${part}"`)
      return p
    }
    const v3 = zooPresetById('deepseek-v3')
    const kimi = zooPresetById('kimi-linear')
    const qwen = zooPresetById('qwen3-5-397b')
    const oss = zooPresetById('gpt-oss-120b')
    if (!v3 || !kimi || !qwen || !oss) throw new Error('missing preset')
    for (const t of ZOO_CONTEXTS) {
      // MLA's stored bytes grow with t at 70,272 B per token; a linear layer's state is the same at every context
      expect(zooBytes(v3, t).stored / t).toBe(70_272)
      expect(zooBytes(qwen, t).groups[0].stored).toBe(188_743_680) // float32 state: the config's mamba_ssm_dtype
      expect(zooBytes(kimi, t).groups[0].stored).toBe(20_971_520)
    }
    expect(truthOf(pin('DeepSeek-V3 MLA').make())).toBe(70_272)
    expect(truthOf(pin('Kimi Linear MLA').make())).toBe(8_064)
    expect(truthOf(pin('Qwen3.5 gated-DeltaNet').make())).toBeCloseTo(188.74368, 9)
    expect(truthOf(pin('Kimi Linear KDA').make())).toBeCloseTo(20.97152, 9)
    // a budget of exactly what kv-zoo stores at 128k (and at 1M) tokens fills at exactly that context
    expect(truthOf(pin('128k-token cache').make())).toBeCloseTo(131_072, 3)
    expect(truthOf(pin('1M-token cache').make())).toBeCloseTo(1_048_576, 3)
    expect(zooBytes(oss, 131_072).stored).toBe(4_836_556_800)
    for (const name of ['DeepSeek-V3 MLA', 'Kimi Linear MLA', 'Qwen3.5 gated-DeltaNet', 'Kimi Linear KDA', '128k-token cache', '1M-token cache']) {
      expect(pin(name).source).toBe('kv-zoo')
    }
  })

  test('claim-backed scenes read the zoo claims; synthetic ones say hypothetical', () => {
    const models = new Set<string>()
    for (const v of ZOO_VARIANTS) {
      for (const level of LEVELS) {
        const all = SEEDS.map((s) => kv.make(s, level, v))
        for (const i of all) {
          const model = String(i.params.model)
          models.add(`${v}:${model}`)
          if (model === 'synthetic') {
            expect(i.claims).toEqual([])
            expect(partsText(i.prompt.stem)).toContain('hypothetical')
          } else {
            expect(i.claims.length).toBeGreaterThanOrEqual(3)
            for (const c of i.claims) expect(c.startsWith(`zoo.${model}.`)).toBe(true)
            const chips = i.prompt.stem.filter((p) => p.t === 'claim')
            expect(chips.length).toBeGreaterThan(0)
            // the sentence around a chip says what the number counts, so the chip carries no unit of its own
            for (const c of chips) if (c.t === 'claim' && c.claim !== `zoo.${model}.window`) expect(c.unit).toBe('')
          }
        }
        expect(all.some((i) => i.params.model === 'synthetic')).toBe(true)
        expect(all.some((i) => i.params.model !== 'synthetic')).toBe(true)
      }
    }
    for (const m of ['mla-bytes:deepseek-v3', 'mla-bytes:kimi-linear', 'swa-capacity:gpt-oss-120b', 'linear-state:qwen3-5-397b', 'linear-state:kimi-linear']) expect(models.has(m)).toBe(true)
  })

  test('mla-bytes: one latent per layer, no factor 2; a 2-byte cache; binary units at the transfer level', () => {
    const i = find('mla-bytes', 2, (x) => x.params.model === 'deepseek-v3')
    expect(num(i, 'layers')).toBe(61)
    expect(partsText(kv.solution(i)[1].text)).toContain('no factor 2')
    for (const level of LEVELS) for (const s of SEEDS) expect(bytesPer(kv.make(s, level, 'mla-bytes'))).toBe(2)
    expect(find('mla-bytes', 3, () => true).answer).toMatchObject({ kind: 'numeric', unit: 'KiB' })
    expect(find('mla-bytes', 2, () => true).answer).toMatchObject({ kind: 'numeric', unit: 'B' })
  })

  test('kv.mla-as-gqa: twice the truth is a GQA-style price, and the K-and-V and query-head slips do not apply to MLA', () => {
    const i = find('mla-bytes', 2, () => true)
    const g = gradeOf(i, 2)
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('kv.mla-as-gqa')
    expect(g.diagnosis?.message).toContain('GQA')
    // half is not "forgot K and V": MLA has no K and V planes
    expect(gradeOf(i, 0.5).diagnosis?.id).toBeUndefined()
    expect(gradeOf(i, 1 / num(i, 'layers')).diagnosis?.id).toBe('kv.one-layer')
    expect(gradeOf(i, 1 / num(i, 'layers')).diagnosis?.message).toContain('latent')
    // the rule is about MLA only
    const gqa = find('bytes-per-token', 2, (x) => x.params.dtype === 'bf16' && num(x, 'attnHeads') === num(x, 'kvHeads'))
    expect(gradeOf(gqa, 2).diagnosis?.id).toBeUndefined()
  })

  test('swa-capacity: the window layers stop growing, so the answer is past the window and in tokens', () => {
    for (const level of LEVELS) {
      for (const s of SEEDS) {
        const i = kv.make(s, level, 'swa-capacity')
        expect(i.answer).toMatchObject({ kind: 'estimate', unit: 'tokens', interval: true })
        expect(truthOf(i)).toBeGreaterThanOrEqual(8 * (num(i, 'window') + num(i, 'sinks')))
        expect(num(i, 'layers')).toBe(num(i, 'swaLayers') + num(i, 'fullLayers'))
        expect(bytesPer(i)).toBe(2)
      }
    }
    const l3 = find('swa-capacity', 3, () => true)
    expect(partsText(l3.prompt.stem)).toContain('repeating pattern')
    expect(kv.solution(l3)[0].text.map((p) => partsText([p])).join('')).toContain('Full-attention layers')
    expect(partsText(find('swa-capacity', 2, () => true).prompt.stem)).not.toContain('repeating pattern')
    // synthetic draws include sink tokens; a real one has none (gpt-oss's sinks are softmax logits, claim value 0)
    expect(SEEDS.some((s) => num(kv.make(s, 2, 'swa-capacity'), 'sinks') > 0)).toBe(true)
    expect(find('swa-capacity', 2, (x) => x.params.model === 'gpt-oss-120b').params.sinks).toBe(0)
  })

  test('kv.window-ignored: giving every layer the full cache lands on the uniform context, and it is diagnosed', () => {
    for (const level of LEVELS) {
      const i = find('swa-capacity', level, () => true)
      const uniform = (num(i, 'kvGb') * 1e9) / (2 * num(i, 'kvHeads') * num(i, 'headDim') * bytesPer(i) * num(i, 'layers'))
      const g = kv.grade(i, { kind: 'estimate', value: uniform })
      expect(g.ok).toBe(false)
      expect(g.diagnosis?.id).toBe('kv.window-ignored')
      expect(g.diagnosis?.message).toContain(`${num(i, 'window')}-token window`)
      expect(g.diagnosis?.message).toContain(`${num(i, 'fullLayers')} full-attention layers`)
    }
    // the K-and-V, query-head and one-layer slips are inexact for a window model, so they do not claim its wrong answers
    const i = find('swa-capacity', 2, () => true)
    for (const rho of [0.5, 2, 0.25, num(i, 'layers')]) expect(kv.grade(i, { kind: 'estimate', value: truthOf(i) * rho }).diagnosis?.id).not.toBe('kv.forgot-k-and-v')
    expect(kv.grade(i, { kind: 'estimate', value: truthOf(i) * num(i, 'layers') }).diagnosis?.id).toBeUndefined()
    // the rule is about window models only
    const cap = find('capacity-tokens', 2, () => true)
    const rule = kv.ratioRules.find((r) => r.id === 'kv.window-ignored')
    expect(typeof rule?.ratio === 'function' ? rule.ratio(cap) : undefined).toBeNull()
  })

  test('linear-state: the state does not depend on the context, and the solution says so', () => {
    for (const level of LEVELS) {
      const i = find('linear-state', level, () => true)
      const steps = kv.solution(i)
      expect(steps.some((s) => s.result === undefined && partsText(s.text).includes('does not enter'))).toBe(true)
      expect(partsText(i.prompt.stem)).toContain('After a context of')
    }
    expect((find('linear-state', 2, () => true).answer as { unit: string }).unit).toMatch(/^(MB|GB)$/)
    expect((find('linear-state', 3, () => true).answer as { unit: string }).unit).toMatch(/^(MiB|GiB)$/)
    // narrow dtypes are priced too: an FP8 state priced at 2 bytes is the FP16 slip
    const fp8 = find('linear-state', 2, (x) => x.params.dtype === 'fp8')
    expect(gradeOf(fp8, 2).diagnosis?.id).toBe('kv.priced-fp16')
  })

  test('kv.state-grows: scaling the state with the context is diagnosed, by the context the prompt names', () => {
    for (const level of LEVELS) {
      const i = find('linear-state', level, () => true)
      const g = gradeOf(i, num(i, 'tokens'))
      expect(g.ok).toBe(false)
      expect(g.diagnosis?.id).toBe('kv.state-grows')
      expect(g.diagnosis?.message).toContain('does not grow')
    }
    const i = find('linear-state', 2, () => true)
    expect(gradeOf(i, 1 / num(i, 'layers')).diagnosis?.id).toBe('kv.one-layer')
    expect(gradeOf(i, 1 / num(i, 'layers')).diagnosis?.message).toContain('state')
    expect(gradeOf(i, 0.5).diagnosis?.id).toBeUndefined()
  })

  test('every zoo rule fires somewhere (the generator gate warns on a dead one)', () => {
    const r = checkFamily(kv, { seeds: 100, speed: false })
    expect(r.warnings).toEqual([])
    for (const id of ['kv.mla-as-gqa', 'kv.window-ignored', 'kv.state-grows']) expect(kv.ratioRules.some((x) => x.id === id)).toBe(true)
  })
})
