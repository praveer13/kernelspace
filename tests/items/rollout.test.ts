import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkFamily, checkHashes, genSeeds, lintLiterals, readHashRows, responseFromSolution } from '../../scripts/verify-generators'
import { byId } from '../../src/data/claims'
import { partsText } from '../../src/lib/items/core'
import rollout from '../../src/lib/items/families/rollout'
import { correctResponse } from '../../src/lib/items/grade'
import type { Instance, Level, Response } from '../../src/lib/items/types'

const FILE = new URL('../../src/lib/items/families/rollout.ts', import.meta.url)
const hashes = readHashRows('rollout') // tests/fixtures/items/hashes/rollout.json
const LEVELS = [0, 1, 2, 3] as const
const seeds = genSeeds(200)

const truthOf = (i: Instance): number => (i.answer.kind === 'numeric' ? i.answer.truth : Number.NaN)
const num = (i: Instance, k: string): number => Number(i.params[k])
const stem = (i: Instance): string => partsText(i.prompt.stem)

/** Every instance of a variant over the test seeds, at the given levels. */
function all(variant: string, levels: readonly Level[] = LEVELS): Instance[] {
  return levels.flatMap((l) => seeds.map((s) => rollout.make(s, l, variant)))
}

/** The first instance of a variant and level that satisfies `pred`. */
function find(variant: string, level: Level, pred: (i: Instance) => boolean): Instance {
  const hit = seeds.map((s) => rollout.make(s, level, variant)).find(pred)
  if (!hit) throw new Error(`no ${variant}@L${level} instance matches`)
  return hit
}

/** The response of a learner who made a slip of ratio `rho`. */
const slipped = (i: Instance, rho: number): Response => ({ kind: 'numeric', value: truthOf(i) * rho, unit: i.answer.kind === 'numeric' ? i.answer.unit : '' })

const lengths = (i: Instance): number[] => Array.from({ length: num(i, 'k') }, (_, n) => num(i, `l${n + 1}`))
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

describe('the rollout family (§5.1)', () => {
  test('passes the whole §5.6 suite at 100 seeds, with no dead rule', () => {
    const r = checkFamily(rollout, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.instances).toBe(100 * 4 * 4)
    // every variant is numeric, so the blind-strategy gate has no choice variant to read
    expect(r.cues).toEqual([])
  })

  test('declares the four variants at levels 0-3, the two KCs and the four diagnoses of the spec', () => {
    expect(rollout.variants.map((v) => v.id)).toEqual(['rollout-share', 'long-tail', 'group-tokens', 'sync-seconds'])
    for (const v of rollout.variants) expect(v.levels).toEqual([0, 1, 2, 3])
    expect([...rollout.kcs].sort()).toEqual(['t6.rollout-bound-rl', 't6.weight-sync'])
    expect(rollout.variants.map((v) => v.kcs)).toEqual([['t6.rollout-bound-rl'], ['t6.rollout-bound-rl'], ['t6.rollout-bound-rl'], ['t6.weight-sync']])
    expect(rollout.ratioRules.map((r) => r.id)).toEqual(['rollout.linear', 'rollout.mean-not-max', 'rollout.unsliced', 'rollout.bits-bytes'])
  })

  test('every answer is numeric and none is a choice', () => {
    for (const v of rollout.variants) for (const i of all(v.id, [0, 3]).slice(0, 60)) expect(i.answer.kind).toBe('numeric')
  })

  test("the hash fixture has this family's rows and they match", () => {
    expect(Object.keys(hashes.rollout).sort()).toEqual(rollout.variants.map((v) => v.id).sort())
    expect(checkHashes(rollout, hashes)).toEqual([])
  })

  test('its source passes the literal lint, with only the named constants and pinned lesson numbers annotated', () => {
    expect(lintLiterals(FILE.pathname, readFileSync(FILE, 'utf8'))).toEqual([])
  })

  test('make is a pure function of (seed, level, variant); an unspecified variant is chosen by the seed', () => {
    for (const level of LEVELS) {
      for (const s of seeds.slice(0, 20)) expect(rollout.make(s, level, undefined)).toEqual(rollout.make(s, level, undefined))
      expect(new Set(seeds.map((s) => rollout.make(s, level).variant)).size).toBe(4)
    }
  })

  test('every scene is announced as hypothetical, and only sync-seconds carries a claim', () => {
    for (const v of rollout.variants) {
      for (const i of all(v.id, [0, 3]).slice(0, 80)) {
        expect(stem(i)).toContain('hypothetical')
        expect(i.claims.length).toBe(v.id === 'sync-seconds' ? 1 : 0)
      }
    }
  })
})

describe('pins', () => {
  test('four hand-computed instances, one per variant, each reproducing its arithmetic', () => {
    expect(rollout.pins.length).toBe(4)
    const truths = rollout.pins.map((p) => truthOf(p.make()))
    expect(truths[0]).toBeCloseTo(1 / (0.2 + 0.8 / 2), 9) // gen-literal-ok: hand check
    expect(truths[1]).toBeCloseTo(100 * (1 - 5000 / 8000), 9) // gen-literal-ok: hand check
    expect(truths[2]).toBe(256 * 16 * 4000) // gen-literal-ok: hand check
    expect(truths[3]).toBeCloseTo(1, 9) // gen-literal-ok: hand check
    for (const p of rollout.pins) {
      const i = p.make()
      expect(Math.abs(truthOf(i) - p.truth)).toBeLessThanOrEqual(p.tolerance?.abs ?? 0)
      expect(i.level).toBe(0)
      expect(rollout.grade(i, correctResponse(i)).ok).toBe(true)
    }
  })

  test("the sync pin is t6.l7's 400 GB payload, and no pin takes its number from checkpoint-engine", () => {
    const i = rollout.pins[3].make()
    expect(num(i, 'paramsB') * 2).toBe(400) // gen-literal-ok: BF16 bytes
    expect(i.params).toEqual({ paramsB: 200, dtype: 'bf16', shards: 8, link: 50, linkUnit: 'GB/s' }) // gen-literal-ok: the pinned scene
    // the cited 20 s is a comparison line only: no pin's truth is it
    for (const p of rollout.pins) expect(p.truth).not.toBe(byId['bench.checkpoint-engine.sync'].value)
  })
})

describe('the formulas, from the params alone', () => {
  test('rollout-share: 1 ÷ ((1 − f) + f ÷ s), with f inside the lesson’s 70-90 % band', () => {
    for (const i of all('rollout-share', [0, 1, 2])) {
      const f = num(i, 'f') / 100
      expect(f).toBeGreaterThanOrEqual(0.7) // gen-literal-ok: the lesson's band
      expect(f).toBeLessThanOrEqual(0.9) // gen-literal-ok: the lesson's band
      expect(truthOf(i)).toBeCloseTo(1 / (1 - f + f / num(i, 's')), 9)
      // Amdahl: never above the rollout's own speedup, never above 1 ÷ (1 − f)
      expect(truthOf(i)).toBeLessThan(num(i, 's'))
      expect(truthOf(i)).toBeLessThan(1 / (1 - f))
    }
  })

  test('rollout-share at the transfer level states minutes, and the share is derived from them', () => {
    const i = find('rollout-share', 3, () => true)
    expect(i.params.f).toBeUndefined()
    const f = num(i, 'rollMin') / (num(i, 'rollMin') + num(i, 'trainMin'))
    expect(f).toBeGreaterThanOrEqual(0.7) // gen-literal-ok: the lesson's band
    expect(f).toBeLessThanOrEqual(0.9) // gen-literal-ok: the lesson's band
    expect(truthOf(i)).toBeCloseTo(1 / (1 - f + f / num(i, 's')), 9)
    expect(stem(i)).toContain('minutes in rollout')
  })

  test('long-tail: 1 − mean ÷ max of the listed lengths, as a percentage, from a real table in the prompt', () => {
    for (const level of LEVELS) {
      const i = find('long-tail', level, () => true)
      const xs = lengths(i)
      expect(xs.length).toBe([4, 4, 6, 8][level]) // gen-literal-ok: group sizes by level
      expect(truthOf(i)).toBeCloseTo(100 * (1 - mean(xs) / Math.max(...xs)), 9) // gen-literal-ok: hand check
      const table = i.prompt.stem.find((p) => p.t === 'table')
      expect(table?.t === 'table' ? table.rows.map((r) => r[1]) : []).toEqual(xs)
    }
    for (const i of all('long-tail')) expect(Math.max(...lengths(i)) / mean(lengths(i))).toBeGreaterThanOrEqual(1.2) // gen-literal-ok: the tail is worth asking about
  })

  test('long-tail at the transfer level gives decode seconds, and the answer is the same share', () => {
    const i = find('long-tail', 3, () => true)
    expect(i.params.unit).toBe('s')
    expect(stem(i)).toContain('Decode time of each sample (seconds)')
    const last = rollout.solution(i).at(-1)
    expect(last && partsText(last.text)).toBe('Idle share = 1 − mean ÷ max')
  })

  test('group-tokens: prompts × samples per prompt × the mean length', () => {
    for (const i of all('group-tokens', [0, 1, 2])) expect(truthOf(i)).toBe(num(i, 'prompts') * num(i, 'samples') * num(i, 'mean'))
  })

  test('group-tokens at the transfer level mixes a short and a long population', () => {
    const i = find('group-tokens', 3, () => true)
    const mix = (num(i, 'shortPct') * num(i, 'short') + (100 - num(i, 'shortPct')) * num(i, 'long')) / 100 // gen-literal-ok: hand check
    expect(truthOf(i)).toBeCloseTo(num(i, 'prompts') * num(i, 'samples') * mix, 6)
    expect(i.params.mean).toBeUndefined()
    expect(rollout.solution(i).length).toBe(3)
    expect(rollout.solution(rollout.make(seeds[0], 2, 'group-tokens')).length).toBe(3)
  })

  test('sync-seconds divides params × bytes by one seeded shard count S and then by the link', () => {
    for (const i of all('sync-seconds', [0, 1, 2])) {
      const bytes = i.params.dtype === 'bf16' ? 2 : 1
      expect(truthOf(i)).toBeCloseTo((num(i, 'paramsB') * bytes) / num(i, 'shards') / num(i, 'link'), 9)
      expect([2, 4, 8, 16, 32, 64]).toContain(num(i, 'shards')) // gen-literal-ok: the shard pool
      expect(i.params.linkUnit).toBe('GB/s')
      expect(Object.keys(i.params).sort()).toEqual(['dtype', 'link', 'linkUnit', 'paramsB', 'shards'])
      expect(stem(i)).toContain('a synthetic shard count')
      expect(truthOf(i)).toBeGreaterThanOrEqual(0.5) // gen-literal-ok: a sync worth asking about
      expect(truthOf(i)).toBeLessThanOrEqual(120) // gen-literal-ok: a sync worth asking about
    }
  })

  test('sync-seconds has no TP or EP in its params or its text', () => {
    for (const i of all('sync-seconds', [0, 3]).slice(0, 100)) {
      expect(Object.keys(i.params).some((k) => /tp|ep|dp/i.test(k))).toBe(false)
      expect(stem(i)).not.toMatch(/\b(TP|EP|DP)\b/)
      for (const s of rollout.solution(i)) expect(partsText(s.text)).not.toMatch(/\b(TP|EP|DP)\b/)
    }
  })

  test('sync-seconds at the transfer level quotes the link in Gb/s, and the solution converts it first', () => {
    const i = find('sync-seconds', 3, () => true)
    expect(i.params.linkUnit).toBe('Gb/s')
    expect(num(i, 'link') % 8).toBe(0) // gen-literal-ok: bits per byte
    const bytes = i.params.dtype === 'bf16' ? 2 : 1
    expect(truthOf(i)).toBeCloseTo((num(i, 'paramsB') * bytes) / num(i, 'shards') / (num(i, 'link') / 8), 9) // gen-literal-ok: bits per byte
    expect(partsText(rollout.solution(i)[0].text)).toContain('Gb/s ÷ 8')
  })
})

describe('the checkpoint-engine line', () => {
  test('sync-seconds cites the claim after its last step as a comparison with no result, and lists the claim on the instance', () => {
    const claim = byId['bench.checkpoint-engine.sync']
    for (const level of LEVELS) {
      const i = rollout.make(seeds[7], level, 'sync-seconds')
      expect(i.claims).toEqual([`bench.checkpoint-engine.sync@${claim.verifiedAt}`])
      const steps = rollout.solution(i)
      const line = steps.at(-1)
      expect(line?.result).toBeUndefined()
      expect(line && partsText(line.text)).toContain('about 20 seconds')
      expect(line && partsText(line.text)).toContain('a comparison, not a check on your number')
      // the line is neither shown as a worked step nor the step the answer is read from
      expect(i.prompt.worked?.some((s) => s.text.some((p) => p.t === 'claim'))).not.toBe(true)
      expect(responseFromSolution(i, steps)).toEqual({ kind: 'numeric', value: truthOf(i), unit: 's' })
    }
  })

  test('no other variant cites it', () => {
    for (const v of ['rollout-share', 'long-tail', 'group-tokens']) {
      const i = rollout.make(seeds[7], 0, v)
      for (const s of rollout.solution(i)) expect(s.text.some((p) => p.t === 'claim')).toBe(false)
    }
  })
})

describe('levels', () => {
  test('level 0 shows every step but the last, level 1 blanks one middle step, levels 2 and 3 show none', () => {
    for (const v of rollout.variants) {
      for (const seed of seeds.slice(0, 30)) {
        const l0 = rollout.make(seed, 0, v.id)
        // the cited comparison is not a step of the working
        const steps = rollout.solution(l0).filter((s) => s.result)
        expect(l0.prompt.worked?.length).toBe(steps.length - 1)
        expect(l0.prompt.worked?.some((s) => s.blank)).toBe(false)
        // the answer is the learner's to complete: no worked step carries the final result
        const last = steps[steps.length - 1].result?.value
        expect(l0.prompt.worked?.some((s) => s.result?.value === last)).toBe(false)

        const l1 = rollout.make(seed, 1, v.id)
        const shown = l1.prompt.worked ?? []
        expect(shown.length).toBe(rollout.solution(l1).filter((s) => s.result).length - 1)
        expect(shown.filter((s) => s.blank).length).toBe(1)
        expect(shown[0].blank).toBeFalsy()

        expect(rollout.make(seed, 2, v.id).prompt.worked).toBeUndefined()
        expect(rollout.make(seed, 3, v.id).prompt.worked).toBeUndefined()
      }
    }
  })

  test('the solution ends on the answer (or its comparison line), and its last result is a gradable response, at every level', () => {
    for (const v of rollout.variants) {
      for (const level of LEVELS) {
        const i = rollout.make(seeds[3], level, v.id)
        const r = responseFromSolution(i, rollout.solution(i))
        expect(r).toBeDefined()
        expect(rollout.grade(i, r as Response).score).toBe(1)
      }
    }
  })

  test('level 0 params are round', () => {
    for (const v of rollout.variants) {
      for (const i of seeds.map((s) => rollout.make(s, 0, v.id))) {
        for (const x of Object.values(i.params)) if (typeof x === 'number') expect(String(x).replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length).toBeLessThanOrEqual(2)
      }
    }
  })
})

describe('diagnoses', () => {
  test('linear: the rollout speedup given as the step speedup', () => {
    const i = find('rollout-share', 2, (x) => num(x, 'f') === 80 && num(x, 's') >= 3) // gen-literal-ok: a lure well away from the truth
    const g = rollout.grade(i, { kind: 'numeric', value: num(i, 's'), unit: '×' })
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('rollout.linear')
    expect(g.diagnosis?.message).toContain('Training and scoring did not get faster')
    // also at the transfer level, where the share is derived
    const j = find('rollout-share', 3, (x) => num(x, 's') >= 3) // gen-literal-ok: a lure well away from the truth
    expect(rollout.grade(j, { kind: 'numeric', value: num(j, 's'), unit: '×' }).diagnosis?.id).toBe('rollout.linear')
  })

  test('linear does not apply to other variants, and is null where the slip cannot be told from a right answer', () => {
    const rule = rollout.ratioRules.find((r) => r.id === 'rollout.linear')
    const ratio = (i: Instance) => (typeof rule?.ratio === 'function' ? rule.ratio(i) : undefined)
    expect(ratio(find('long-tail', 2, () => true))).toBeNull()
    const near = rollout.make(seeds[0], 0, 'rollout-share')
    expect(ratio({ ...near, params: { f: 90, s: 1.1 } })).toBeNull() // gen-literal-ok: the speedup barely moves a 90 % share
  })

  test('mean-not-max: the gap divided by the mean length, not the longest', () => {
    const i = find('long-tail', 2, () => true)
    const xs = lengths(i)
    const wrong = (100 * (Math.max(...xs) - mean(xs))) / mean(xs) // gen-literal-ok: hand check
    const g = rollout.grade(i, { kind: 'numeric', value: wrong, unit: '%' })
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('rollout.mean-not-max')
    expect(g.diagnosis?.message).toContain('longest')
  })

  test('unsliced: the whole checkpoint through one link is S times too long, and the answer carries no TP·EP product', () => {
    for (const level of [0, 2, 3] as const) {
      const i = find('sync-seconds', level, (x) => num(x, 'shards') === 16) // gen-literal-ok: a shard count apart from every unit slip
      const g = rollout.grade(i, slipped(i, 16)) // gen-literal-ok: the shard count
      expect(g.diagnosis?.id).toBe('rollout.unsliced')
      expect(g.diagnosis?.message).toContain('only its slice')
      expect(g.diagnosis?.message).not.toMatch(/TP|EP/)
    }
    // for every shard count, ×S is the rule's ratio and nothing else
    const rule = rollout.ratioRules.find((r) => r.id === 'rollout.unsliced')
    for (const i of all('sync-seconds', [0]).slice(0, 50)) expect(typeof rule?.ratio === 'function' ? rule.ratio(i) : undefined).toBe(num(i, 'shards'))
  })

  test('bits-bytes: the Gb/s figure read as GB/s is 8 times too short, and only the transfer level can make it', () => {
    const i = find('sync-seconds', 3, (x) => num(x, 'shards') !== 8) // gen-literal-ok: ×8 is also the unsliced slip at 8 shards
    const g = rollout.grade(i, slipped(i, 1 / 8)) // gen-literal-ok: a byte is 8 bits
    expect(g.diagnosis?.id).toBe('rollout.bits-bytes')
    expect(g.diagnosis?.message).toContain('8 bits')
    const rule = rollout.ratioRules.find((r) => r.id === 'rollout.bits-bytes')
    expect(typeof rule?.ratio === 'function' ? rule.ratio(find('sync-seconds', 2, () => true)) : undefined).toBeNull()
  })

  test('a wrong answer that matches no rule gets the truth, not a diagnosis; a right one is ok within 2 %', () => {
    const i = find('group-tokens', 2, () => true)
    const g = rollout.grade(i, slipped(i, 1.5))
    expect(g.ok).toBe(false)
    expect(g.diagnosis).toBeUndefined()
    expect(g.feedback).toContain('the answer is')
    expect(rollout.grade(i, slipped(i, 1.015)).ok).toBe(true)
    expect(rollout.grade(i, slipped(i, 1.03)).ok).toBe(false)
  })

  test('a percentage answered to the whole point is right', () => {
    const i = find('long-tail', 2, () => true)
    expect(rollout.grade(i, { kind: 'numeric', value: Math.round(truthOf(i)), unit: '%' }).ok).toBe(true)
    expect(rollout.grade(i, { kind: 'numeric', value: truthOf(i) + 3, unit: '%' }).ok).toBe(false) // gen-literal-ok: three points off
  })
})
