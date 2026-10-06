import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkChoiceCues, checkFamily, checkHashes, genSeeds, lintLiterals, readHashRows, responseFromSolution } from '../../scripts/verify-generators'
import { byId, claimNumber } from '../../src/data/claims'
import { partsText } from '../../src/lib/items/core'
import memory from '../../src/lib/items/families/memory'
import { correctResponse } from '../../src/lib/items/grade'
import type { Instance, Level, Response } from '../../src/lib/items/types'
import { GB, GIB } from '../../src/lib/items/units'

const SEEDS = genSeeds(300)
const LEVELS: Level[] = [0, 1, 2, 3]
const FILE = new URL('../../src/lib/items/families/memory.ts', import.meta.url)

/** The first instance of a variant and level, over a fixed spread of seeds, that satisfies `pred`. */
function find(variant: string, level: Level, pred: (i: Instance) => boolean): Instance {
  for (const seed of SEEDS) {
    const i = memory.make(seed, level, variant)
    if (pred(i)) return i
  }
  throw new Error(`no ${variant}@L${level} instance matches`)
}

const truthOf = (i: Instance): number => (i.answer.kind === 'choice' ? Number.NaN : i.answer.truth)
const num = (i: Instance, k: string): number => Number(i.params[k])
const unitOf = (i: Instance): string => (i.answer.kind === 'numeric' ? i.answer.unit : '')

/** The response a learner who made a slip of ratio `rho` would give, in the answer's own unit. */
function slipped(i: Instance, rho: number): Response {
  const a = i.answer
  if (a.kind !== 'numeric') throw new Error('every memory answer is numeric')
  return { kind: 'numeric', value: a.truth * rho, unit: a.unit }
}

describe('memory: the §5.6 suite', () => {
  test('passes at 100 seeds with no problems and no dead rules', () => {
    const r = checkFamily(memory, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.instances).toBe(100 * 5 * 4)
  })

  test('its hash rows match the fixture', () => {
    const rows = readHashRows('memory') // tests/fixtures/items/hashes/memory.json
    expect(checkHashes(memory, rows)).toEqual([])
    expect(Object.keys(rows.memory).sort()).toEqual(memory.variants.map((v) => v.id).sort())
  })

  test('its source passes the literal lint with nothing annotated away but the named definitions and pins', () => {
    expect(lintLiterals(FILE.pathname, readFileSync(FILE, 'utf8'))).toEqual([])
  })

  test('declares the five variants at levels 0 to 3 and the five KCs', () => {
    expect(memory.variants.map((v) => v.id)).toEqual(['weight-bytes', 'fp4-fit', 'active-bytes', 'shard', 'lora'])
    for (const v of memory.variants) expect(v.levels).toEqual([0, 1, 2, 3])
    expect([...memory.kcs].sort()).toEqual(['t4.quantized-bytes', 't6.fp4-capacity', 't6.lora-adapter-bytes', 't6.moe-active-params', 't6.parallel-memory'])
    // the first KC of each variant is the one it assesses below the transfer level
    expect(memory.variants.map((v) => v.kcs[0])).toEqual(['t4.quantized-bytes', 't6.fp4-capacity', 't6.moe-active-params', 't6.parallel-memory', 't6.lora-adapter-bytes'])
  })

  test('every answer is numeric, so the blind-strategy gate has no choice variant to judge', () => {
    for (const v of memory.variants) for (const level of LEVELS) for (const seed of SEEDS.slice(0, 20)) expect(memory.make(seed, level, v.id).answer.kind).toBe('numeric')
    expect(checkChoiceCues(memory, { seeds: 200 })).toEqual({ problems: [], rows: [] })
  })

  test('make is a pure function of (seed, level, variant); an unspecified variant is chosen by the seed', () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS.slice(0, 20)) {
        expect(memory.make(seed, level)).toEqual(memory.make(seed, level))
        expect(memory.make(seed, level).level).toBe(level)
      }
      expect(new Set(SEEDS.map((s) => memory.make(s, level).variant)).size).toBe(5)
    }
  })

  test('every instance has a unit, and its solution ends on a gradable answer', () => {
    for (const v of memory.variants) {
      for (const level of LEVELS) {
        const i = memory.make(SEEDS[3], level, v.id)
        const r = responseFromSolution(i, memory.solution(i))
        expect(r).toBeDefined()
        expect(memory.grade(i, r as Response).score).toBe(1)
        expect(unitOf(i)).not.toBe('')
      }
    }
  })
})

describe('memory: the pins', () => {
  const byName = (part: string) => {
    const p = memory.pins.find((x) => x.name.includes(part))
    if (!p) throw new Error(`no pin "${part}"`)
    return p
  }
  const truth = (part: string): number => truthOf(byName(part).make())

  test('671 B x 4.5 bits / 8 is 377.4 GB, the claims multiplied', () => {
    expect(truth('DeepSeek-V3 in NVFP4')).toBeCloseTo((claimNumber('model.deepseek-v3.total-params') * claimNumber('serving.nvfp4.bits-per-weight')) / 8, 6)
    expect(Math.round(truth('DeepSeek-V3 in NVFP4'))).toBe(377)
    const i = byName('DeepSeek-V3 in NVFP4').make()
    expect(i.claims.map((c) => c.split('@')[0]).sort()).toEqual(['model.deepseek-v3.total-params', 'serving.nvfp4.bits-per-weight'])
  })

  test('Llama-3-70B: the lessons round 140 GB at BF16 and 35 GB at INT4; the claim says 141.1 and 35.3', () => {
    expect(truth('Llama-3-70B at BF16')).toBeCloseTo(claimNumber('model.llama3-70b.params') * 2, 6)
    expect(truth('Llama-3-70B at BF16')).toBeCloseTo(141.1, 6)
    expect(truth('Llama-3-70B at INT4')).toBeCloseTo(35.275, 6)
  })

  test('DeepSeek-V3 at FP8: 671 GB resident, 37 GB read by one decode step', () => {
    expect(truth('resident weights')).toBeCloseTo(671, 6)
    expect(truth('one decode step reads')).toBeCloseTo(37, 6)
  })

  test("Llama-3-8B's rank-16 q/o adapter is exactly 16 MiB", () => {
    const i = byName('rank-16 q/o adapter').make()
    expect(unitOf(i)).toBe('MiB')
    expect(truthOf(i)).toBe(16)
  })

  test('every pin grades its own true answer ok', () => {
    for (const p of memory.pins) {
      const i = p.make()
      expect(memory.grade(i, correctResponse(i)).ok).toBe(true)
    }
  })
})

describe('memory: claim-backed and synthetic scenes', () => {
  test('every variant and level draws both; a claim-backed scene stores no claim value in params and cites its claims', () => {
    for (const v of memory.variants) {
      for (const level of LEVELS) {
        const all = SEEDS.map((s) => memory.make(s, level, v.id))
        const real = all.filter((i) => i.params.model !== 'synthetic')
        expect(real.length).toBeGreaterThan(0)
        expect(real.length).toBeLessThan(all.length)
        for (const i of real) {
          expect(i.claims.length).toBeGreaterThanOrEqual(1)
          for (const k of ['paramsB', 'activeB', 'layers', 'hidden', 'hbm']) expect(i.params[k]).toBeUndefined()
          const chips = i.prompt.stem.filter((p) => p.t === 'claim').map((p) => (p.t === 'claim' ? p.claim : ''))
          expect(chips.length).toBeGreaterThan(0)
          for (const c of chips) expect(i.claims.some((x) => x.startsWith(`${c}@`))).toBe(true)
        }
        for (const i of all.filter((x) => x.params.model === 'synthetic')) {
          expect(partsText(i.prompt.stem)).toContain('hypothetical')
          // an NVFP4 item always reads the format's bits per weight from its claim, even for a hypothetical model
          expect(i.claims.every((c) => c.startsWith('serving.nvfp4.'))).toBe(true)
        }
      }
    }
  })

  test('the claim-backed models cover every claim the spec names', () => {
    const models = new Set(SEEDS.flatMap((s) => LEVELS.flatMap((l) => memory.variants.map((v) => String(memory.make(s, l, v.id).params.model)))))
    for (const m of ['llama3-8b', 'llama3-70b', 'mixtral-8x7b', 'deepseek-v3', 'deepseek-r1', 'synthetic']) expect(models.has(m)).toBe(true)
  })

  test('a claim update changes the fingerprint (the claims carry id@verifiedAt)', () => {
    const i = find('fp4-fit', 2, (x) => x.params.model === 'deepseek-v3')
    for (const c of i.claims) expect(c).toMatch(/^[^@]+@\d{4}-\d{2}-\d{2}$/)
    expect(i.claims).toContain(`serving.nvfp4.bits-per-weight@${byId['serving.nvfp4.bits-per-weight'].verifiedAt}`)
  })

  test('fp4-fit on a claim-backed GPU reads B200 HBM; a hypothetical accelerator states its own', () => {
    const real = find('fp4-fit', 2, (x) => x.params.gpu === 'b200' && x.params.ask === 'gpus')
    expect(real.claims.some((c) => c.startsWith('hw.b200.hbm-capacity@'))).toBe(true)
    expect(['deepseek-v3', 'deepseek-r1']).toContain(real.params.model as string)
    const synth = find('fp4-fit', 2, (x) => x.params.model === 'synthetic')
    expect(synth.params.ask).toBe('gpus')
    expect(synth.params.hbmUnit).toBe('GB')
    expect(partsText(synth.prompt.stem)).toContain('hypothetical accelerator')
  })

  test('active-bytes: a hypothetical MoE is shared + experts, a real one reads its total and active claims', () => {
    const s = find('active-bytes', 2, (x) => x.params.model === 'synthetic' && x.params.ask === 'read')
    const bytesPerWeight = { bf16: 2, fp8: 1, int4: 0.5 }[String(s.params.dtype) as 'bf16']
    expect(truthOf(s)).toBeCloseTo((num(s, 'shared') + num(s, 'topk') * num(s, 'expert')) * bytesPerWeight, 9)
    const r = find('active-bytes', 2, (x) => x.params.model === 'mixtral-8x7b' && x.params.ask === 'resident')
    expect(r.claims.map((c) => c.split('@')[0]).sort()).toEqual(['model.mixtral-8x7b.active-params', 'model.mixtral-8x7b.params'])
  })

  test('a hypothetical MoE never visits more than a quarter of its experts', () => {
    for (const s of SEEDS) {
      const i = memory.make(s, 2, 'active-bytes')
      if (i.params.model === 'synthetic') expect(num(i, 'topk') * 4).toBeLessThanOrEqual(num(i, 'experts'))
    }
  })

  test('shard: the dense scene is Llama-3-70B, the experts are hypothetical and only appear from level 2', () => {
    for (const level of [0, 1] as Level[]) for (const s of SEEDS) expect(memory.make(s, level, 'shard').params.expertB).toBeUndefined()
    const moe = find('shard', 2, (x) => x.params.expertB !== undefined)
    expect(moe.params.model).toBe('synthetic')
    expect(num(moe, 'ep')).toBeGreaterThan(1)
    const dense = find('shard', 1, (x) => x.params.model === 'llama3-70b')
    expect(dense.claims).toEqual([`model.llama3-70b.params@${byId['model.llama3-70b.params'].verifiedAt}`])
    const bpw = { bf16: 2, fp8: 1, int4: 0.5 }[String(dense.params.dtype) as 'bf16']
    expect(truthOf(dense)).toBeCloseTo((claimNumber('model.llama3-70b.params') * bpw) / (num(dense, 'tp') * num(dense, 'pp')), 9)
  })

  test('lora: a claim-backed adapter reads layers and hidden size; q and o are the hidden x hidden matrices', () => {
    const i = find('lora', 2, (x) => x.params.model === 'llama3-8b' && x.params.ask === 'bytes')
    expect(i.claims.map((c) => c.split('@')[0]).sort()).toEqual(['model.llama3-8b.hidden-size', 'model.llama3-8b.layers'])
    expect(num(i, 'targets')).toBeLessThanOrEqual(2)
    const bytes = num(i, 'rank') * 2 * 4096 * num(i, 'targets') * 32 * ({ bf16: 2, fp32: 4 }[String(i.params.dtype) as 'bf16'])
    expect(truthOf(i) * (unitOf(i) === 'GB' ? GB : 1e6)).toBeCloseTo(bytes, 3)
  })

  test('lora fit never asks for fewer than a handful of adapters', () => {
    let seen = 0
    for (const level of LEVELS) {
      for (const s of SEEDS) {
        const i = memory.make(s, level, 'lora')
        if (i.params.ask !== 'fit') continue
        seen++
        expect(truthOf(i)).toBeGreaterThanOrEqual(4)
        expect(unitOf(i)).toBe('adapters')
      }
    }
    expect(seen).toBeGreaterThan(100)
  })
})

describe('memory: levels', () => {
  test('level 0 shows every step but the last, level 1 blanks one middle step, levels 2 and 3 show none', () => {
    for (const v of memory.variants) {
      for (const seed of SEEDS.slice(0, 30)) {
        const l0 = memory.make(seed, 0, v.id)
        const steps = memory.solution(l0)
        expect(l0.prompt.worked?.length).toBe(steps.length - 1)
        expect(l0.prompt.worked?.some((s) => s.blank)).toBe(false)
        // the answer is the learner's to complete: no worked step carries the final result
        const last = steps[steps.length - 1].result
        expect(l0.prompt.worked?.some((s) => s.result?.value === last?.value && s.result?.unit === last?.unit)).toBe(false)

        const l1 = memory.make(seed, 1, v.id)
        const shown = l1.prompt.worked ?? []
        expect(shown.length).toBe(memory.solution(l1).length - 1)
        expect(shown.filter((s) => s.blank).length).toBe(1)
        expect(shown.find((s) => s.blank)?.result).toBeUndefined()

        expect(memory.make(seed, 2, v.id).prompt.worked).toBeUndefined()
        expect(memory.make(seed, 3, v.id).prompt.worked).toBeUndefined()
      }
    }
  })

  test('level 3 assesses the variant\'s other KCs too; levels 0 to 2 assess one', () => {
    for (const v of memory.variants) {
      expect(memory.make(SEEDS[0], 3, v.id).kcs).toEqual(v.kcs)
      for (const level of [0, 1, 2] as Level[]) expect(memory.make(SEEDS[0], level, v.id).kcs).toEqual([v.kcs[0]])
    }
  })

  test('level 3 changes the surface to binary units, and a hypothetical accelerator states its HBM in GiB', () => {
    for (const v of ['weight-bytes', 'active-bytes', 'shard']) expect(unitOf(find(v, 3, () => true))).toBe('GiB')
    for (const v of ['weight-bytes', 'active-bytes', 'shard']) expect(unitOf(find(v, 2, () => true))).toBe('GB')
    expect(['MiB', 'GiB']).toContain(unitOf(find('lora', 3, (x) => x.params.ask === 'bytes')))
    expect(['MB', 'GB']).toContain(unitOf(find('lora', 2, (x) => x.params.ask === 'bytes')))
    const g = find('fp4-fit', 3, (x) => x.params.model === 'synthetic')
    expect(g.params.hbmUnit).toBe('GiB')
    expect(partsText(g.prompt.stem)).toContain('GiB of HBM')
    expect(partsText(find('fp4-fit', 3, (x) => x.params.ask === 'weights').prompt.stem)).toContain('Answer in GiB')
  })

  test('level 0 offers no mixture of experts to shard', () => {
    for (const s of SEEDS) expect(memory.make(s, 0, 'shard').params.ep).toBeUndefined()
  })

  test('a numeric size accepts any unit of the item, converted', () => {
    const i = find('weight-bytes', 2, () => true)
    const t = truthOf(i)
    expect(memory.grade(i, { kind: 'numeric', value: t * 1000, unit: 'MB' }).ok).toBe(true)
    expect(memory.grade(i, { kind: 'numeric', value: (t * GB) / GIB, unit: 'GiB' }).ok).toBe(true)
    expect(memory.grade(i, { kind: 'numeric', value: t / 1000, unit: 'TB' }).ok).toBe(true)
  })

  test('a count of adapters may be off by one (the learner may leave the fraction on)', () => {
    const i = find('lora', 2, (x) => x.params.ask === 'fit')
    expect(memory.grade(i, { kind: 'numeric', value: truthOf(i) + 0.9, unit: 'adapters' }).ok).toBe(true)
    expect(memory.grade(i, { kind: 'numeric', value: truthOf(i) * 1.5 + 2, unit: 'adapters' }).ok).toBe(false)
  })
})

describe('memory: diagnoses', () => {
  test('bits as bytes: the bits per value in place of bytes is 8 times the truth, and an adapter count is an eighth of it', () => {
    const w = find('weight-bytes', 2, () => true)
    const g = memory.grade(w, slipped(w, 8))
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('memory.bits-as-bytes')
    const l = find('lora', 2, (x) => x.params.ask === 'fit' && truthOf(x) > 200)
    expect(memory.grade(l, slipped(l, 1 / 8)).diagnosis?.id).toBe('memory.bits-as-bytes')
    const b = find('lora', 2, (x) => x.params.ask === 'bytes')
    expect(memory.grade(b, slipped(b, 8)).diagnosis?.id).toBe('memory.bits-as-bytes')
  })

  test('NVFP4 without its scales: 4 bits against 4.5, an eighth less', () => {
    const i = find('fp4-fit', 2, () => true)
    const g = memory.grade(i, slipped(i, 4 / 4.5))
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('memory.fp4-no-scales')
    expect(g.diagnosis?.message).toContain('4.5 bits')
    // the other variants have no scales to forget
    const rule = memory.ratioRules.find((r) => r.id === 'memory.fp4-no-scales')
    expect(typeof rule?.ratio === 'function' ? rule.ratio(find('weight-bytes', 2, () => true)) : undefined).toBeNull()
  })

  test('no KV reserve: all the HBM counted as usable is (1 - reserve) times the truth', () => {
    const i = find('fp4-fit', 2, (x) => x.params.ask === 'gpus' && num(x, 'reserve') === 50)
    const g = memory.grade(i, slipped(i, 0.5))
    expect(g.diagnosis?.id).toBe('memory.no-kv-reserve')
    expect(g.diagnosis?.message).toContain('50 %')
    // a weights question has no reserve
    const w = find('fp4-fit', 2, (x) => x.params.ask === 'weights')
    expect(memory.grade(w, slipped(w, 0.5)).diagnosis?.id).not.toBe('memory.no-kv-reserve')
  })

  test('total for active: every parameter counted is total / active times the bytes one step reads', () => {
    const i = find('active-bytes', 2, (x) => x.params.model === 'deepseek-v3' && x.params.ask === 'read')
    const g = memory.grade(i, slipped(i, 671 / 37))
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('memory.total-for-active')
    expect(g.diagnosis?.message).toContain('37 billion')
    const s = find('active-bytes', 2, (x) => x.params.model === 'synthetic' && x.params.ask === 'read')
    const rho = (num(s, 'shared') + num(s, 'experts') * num(s, 'expert')) / (num(s, 'shared') + num(s, 'topk') * num(s, 'expert'))
    expect(memory.grade(s, slipped(s, rho)).diagnosis?.id).toBe('memory.total-for-active')
  })

  test('active for total: only the active parameters counted for the resident bytes', () => {
    const i = find('active-bytes', 2, (x) => x.params.model === 'deepseek-r1' && x.params.ask === 'resident')
    const g = memory.grade(i, slipped(i, 37 / 671))
    expect(g.diagnosis?.id).toBe('memory.active-for-total')
    expect(g.diagnosis?.message).toContain('671 billion')
    // the read question has no such slip
    const read = find('active-bytes', 2, (x) => x.params.ask === 'read')
    const rule = memory.ratioRules.find((r) => r.id === 'memory.active-for-total')
    expect(typeof rule?.ratio === 'function' ? rule.ratio(read) : undefined).toBeNull()
  })

  test('unsharded: a dense weight left whole is TP x PP times the truth', () => {
    const i = find('shard', 1, (x) => x.params.expertB === undefined && num(x, 'tp') * num(x, 'pp') === 12)
    const g = memory.grade(i, slipped(i, 12))
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('memory.unsharded')
    expect(g.diagnosis?.message).toContain('TP')
    expect(g.diagnosis?.message).toContain('12 ways')
  })

  test('experts unsharded: every expert kept on each GPU', () => {
    const i = find('shard', 2, (x) => x.params.expertB !== undefined && num(x, 'ep') >= 16 && num(x, 'tp') * num(x, 'pp') <= 4)
    const rule = memory.ratioRules.find((r) => r.id === 'memory.experts-unsharded')
    const rho = typeof rule?.ratio === 'function' ? rule.ratio(i) : null
    expect(rho).not.toBeNull()
    const g = memory.grade(i, slipped(i, rho as number))
    expect(g.diagnosis?.id).toBe('memory.experts-unsharded')
    expect(g.diagnosis?.message).toContain(`EP ${num(i, 'ep')}`)
    // a dense model has no experts to leave whole
    const d = find('shard', 1, () => true)
    expect(typeof rule?.ratio === 'function' ? rule.ratio(d) : undefined).toBeNull()
  })

  test('LoRA slips: one matrix, one layer, a full matrix; each inverts for a count of adapters', () => {
    const b = find('lora', 2, (x) => x.params.ask === 'bytes' && num(x, 'targets') === 4 && x.params.model === 'synthetic' && num(x, 'rank') <= 32)
    expect(memory.grade(b, slipped(b, 1 / 4)).diagnosis?.id).toBe('memory.lora-one-target')
    expect(memory.grade(b, slipped(b, 1 / num(b, 'layers'))).diagnosis?.id).toBe('memory.lora-one-layer')
    const full = memory.grade(b, slipped(b, num(b, 'hidden') / (num(b, 'rank') * 2)))
    expect(full.diagnosis?.id).toBe('memory.lora-full-matrix')
    expect(full.diagnosis?.message).toContain('two thin ones')
    const f = find('lora', 2, (x) => x.params.ask === 'fit' && num(x, 'targets') === 4 && x.params.model === 'synthetic' && truthOf(x) > 50)
    expect(memory.grade(f, slipped(f, 4)).diagnosis?.id).toBe('memory.lora-one-target')
    expect(memory.grade(f, slipped(f, num(f, 'layers'))).diagnosis?.id).toBe('memory.lora-one-layer')
  })

  test('GB against GiB: the other prefix is 7 % off, in either direction', () => {
    const gb = find('weight-bytes', 2, () => true)
    expect(memory.grade(gb, slipped(gb, GB / GIB)).diagnosis?.id).toBe('memory.gb-gib')
    const gib = find('weight-bytes', 3, () => true)
    const g = memory.grade(gib, slipped(gib, GIB / GB))
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('memory.gb-gib')
    expect(g.diagnosis?.message).toContain('7 %')
    // the right number in the right unit is ok, in either spelling
    expect(memory.grade(gb, { kind: 'numeric', value: (truthOf(gb) * GB) / GIB, unit: 'GiB' }).ok).toBe(true)
    // HBM read as GB when it was GiB
    const hbm = find('fp4-fit', 3, (x) => x.params.model === 'synthetic')
    expect(memory.grade(hbm, slipped(hbm, GIB / GB)).diagnosis?.id).toBe('memory.gb-gib')
    // a count of adapters in X GiB read as X GB fits fewer
    const fit = find('lora', 2, (x) => x.params.ask === 'fit' && truthOf(x) > 100)
    expect(memory.grade(fit, slipped(fit, GB / GIB)).diagnosis?.id).toBe('memory.gb-gib')
  })

  test('a wrong answer that matches no rule gets the truth, not a diagnosis', () => {
    const i = find('shard', 1, () => true)
    const g = memory.grade(i, slipped(i, 1.5))
    expect(g.ok).toBe(false)
    expect(g.diagnosis).toBeUndefined()
    expect(g.feedback).toContain('the answer is')
  })

  test('the right answer is never diagnosed as a slip', () => {
    for (const v of memory.variants) {
      for (const level of LEVELS) {
        for (const s of SEEDS.slice(0, 40)) {
          const i = memory.make(s, level, v.id)
          expect(memory.grade(i, correctResponse(i)).diagnosis).toBeUndefined()
        }
      }
    }
  })
})
