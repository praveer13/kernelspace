/**
 * The `step` family, η-free variants (docs/specs/s5.md §7.2, §7.4-7.5; task S5-10). Every truth is checked against an
 * oracle written here from the claims and the lessons' formulas alone (not from the family's code), the scenes against
 * the capacity rule, the fairness of §7.2 is printed and asserted over 2,000 instances per variant, and the forms'
 * blueprints are shown unchanged by the family's presence (S5-D51).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkFamily, checkHashes, genSeeds, lintLiterals, readHashRows } from '../../scripts/verify-generators'
import { claimNumber } from '../../src/data/claims'
import { KCS } from '../../src/data/kc'
import { deriveBoot } from '../../src/lib/boot/model'
import { partsText } from '../../src/lib/items/core'
import step from '../../src/lib/items/families/step'
import { gradeResponse } from '../../src/lib/items/grade'
import { loadAllFamilies } from '../../src/lib/items/registry'
import type { Gen, Instance, Level, Response } from '../../src/lib/items/types'
import { formBlueprint } from '../../src/lib/learner/forms'

const FILE = new URL('../../src/lib/items/families/step.ts', import.meta.url)
const hashes = readHashRows('step') // tests/fixtures/items/hashes/step.json
const TOL = 0.02
const GB = 1e9
const seeds = genSeeds(2000)

/* ------------------------------ the oracle ------------------------------ */

/** Bandwidth, dense BF16 peak and capacity claims of each atlas chip, in base units. */
const CHIPS: Record<string, { bw: number; peak: number; cap: number }> = {
  h100: { bw: claimNumber('hw.h100-sxm.hbm-bw', 1e12), peak: claimNumber('hw.h100-sxm.bf16-dense', 1e12), cap: claimNumber('hw.h100-sxm.hbm-capacity', GB) },
  b200: { bw: claimNumber('hw.b200.hbm-bw', 1e12), peak: claimNumber('hw.b200.bf16-dense', 1e12), cap: claimNumber('hw.b200.hbm-capacity', GB) },
  'a100-80': { bw: claimNumber('hw.a100-80-sxm.hbm-bw', GB), peak: claimNumber('hw.a100.bf16-dense', 1e12), cap: claimNumber('hw.a100-80-sxm.hbm-capacity', GB) },
  'a100-40': { bw: claimNumber('hw.a100-40.hbm-bw', GB), peak: claimNumber('hw.a100.bf16-dense', 1e12), cap: claimNumber('hw.a100-40.hbm-capacity', GB) },
  rtx4090: { bw: claimNumber('hw.rtx4090.mem-bw', GB), peak: claimNumber('hw.rtx4090.bf16-dense', 1e12), cap: claimNumber('hw.rtx4090.mem-capacity', GB) },
}

/** Llama-3-8B in BF16 (2 B per weight), Llama-3-70B in FP8 (1 B per weight and per KV value, twice the BF16 rate). */
function arch(model: string) {
  const c = (k: string) => claimNumber(`model.${model}.${k}`)
  const bytes = model === 'llama3-8b' ? 2 : 1
  return { P: claimNumber(`model.${model}.params`, GB), L: c('layers'), H: c('hidden-size'), bytes, W: claimNumber(`model.${model}.params`, GB) * bytes, kv: 2 * c('layers') * c('kv-heads') * c('head-dim') * bytes, rate: 3 - bytes }
}

const p = (i: Instance, k: string): number => Number(i.params[k])
const truthOf = (i: Instance): number => (i.answer.kind === 'numeric' ? i.answer.truth : Number.NaN)

/** The KV tokens a scene holds, and its card. */
function scene(i: Instance) {
  const a = arch(String(i.params.model))
  const chip = CHIPS[String(i.params.hw)]
  const tokens = i.variant === 'prefill-ms' ? p(i, 'prompt') : p(i, 'users') * p(i, 'ctx')
  return { a, chip, tokens }
}

/** What the variant asks, from the lessons' formulas: bytes = weights + KV; FLOP = 2·params·tokens + 4·layers·hidden·pairs. */
function oracle(i: Instance): number {
  if (i.variant === 'quant-bytes') return p(i, 'paramsB') * (i.params.dtype === 'bf16' ? 2 : i.params.dtype === 'fp8' ? 1 : 4.5 / 8)
  const { a, chip, tokens } = scene(i)
  const prefill = i.variant === 'prefill-ms'
  const T = prefill ? p(i, 'prompt') : p(i, 'users')
  const pairs = prefill ? (T * (T + 1)) / 2 : tokens
  const bytes = a.W + a.kv * tokens
  const flop = 2 * a.P * T + 4 * a.L * a.H * pairs
  if (i.variant === 'ridge-kv') return flop / bytes
  return Math.max(bytes / chip.bw, flop / (chip.peak * a.rate)) * 1e3
}

/** Every variant's instances: 2,000 seeds spread over the levels it offers. */
function instances(variant: string): Instance[] {
  const levels = step.variants.find((v) => v.id === variant)!.levels
  return seeds.map((s, k) => step.make(s, levels[k % levels.length], variant))
}

/** The first instance of a variant and level that satisfies `pred` (a scan of up to 200,000 seeds). */
function find(variant: string, level: Level, pred: (i: Instance) => boolean): Instance {
  for (let s = 0; s < 200_000; s++) {
    const inst = step.make(s, level, variant)
    if (pred(inst)) return inst
  }
  throw new Error(`no ${variant}@L${level} instance matches`)
}

const wrong = (i: Instance, rho: number): Response => ({ kind: 'numeric', value: truthOf(i) * rho, unit: i.answer.kind === 'numeric' ? i.answer.unit : '' })

/* ------------------------------ the family ------------------------------ */

describe('the step family, η-free variants (§7.2, §7.4-7.5)', () => {
  test('passes the whole §5.6 suite at 100 seeds, with no dead rule', () => {
    const r = checkFamily(step, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.cues).toEqual([])
  })

  test('declares the four variants on the five KCs, each without level 2, and every answer is numeric', () => {
    expect(step.variants.map((v) => v.id)).toEqual(['decode-ms', 'prefill-ms', 'ridge-kv', 'quant-bytes'])
    expect(step.variants.map((v) => v.kcs)).toEqual([['t4.decode-bandwidth', 't5.latency-metrics'], ['t5.prefill-vs-decode'], ['t4.ridge-point'], ['t6.fp4-capacity']])
    expect([...step.kcs].sort()).toEqual(['t4.decode-bandwidth', 't4.ridge-point', 't5.latency-metrics', 't5.prefill-vs-decode', 't6.fp4-capacity'])
    // quant-bytes also stops before level 3, so the placement walk's confirmation on t6.fp4-capacity stays with `memory`
    expect(step.variants.map((v) => v.levels)).toEqual([[0, 1, 3], [0, 1, 3], [0, 1, 3], [0, 1]])
    for (const v of step.variants) {
      expect(() => step.make(1, 2, v.id)).toThrow()
      for (const l of v.levels) expect(step.make(7, l, v.id).answer.kind).toBe('numeric')
    }
    expect(() => step.make(1, 2)).toThrow()
  })

  test("the hash fixture has this family's rows and they match", () => {
    expect(Object.keys(hashes.step).sort()).toEqual(step.variants.map((v) => v.id).sort())
    expect(checkHashes(step, hashes)).toEqual([])
  })

  test('its source passes the literal lint, and reads no lazy claim group, no table and no engine', () => {
    const text = readFileSync(FILE, 'utf8')
    expect(lintLiterals(FILE.pathname, text)).toEqual([])
    const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1])
    expect(imports.filter((x) => /physics|lazy|ix-points|claims\//.test(x)).sort()).toEqual(['@/lib/world/physics/card', '@/lib/world/physics/types'])
    expect(text).not.toMatch(/lazy\/|table\.ts|engine-v2|ix-points/)
  })

  test('make is a pure function of (seed, level, variant); an unspecified variant is chosen by the seed', () => {
    for (const level of [0, 1, 3] as const) {
      for (const s of seeds.slice(0, 20)) expect(step.make(s, level)).toEqual(step.make(s, level))
      // quant-bytes stops before level 3
      expect(new Set(seeds.map((s) => step.make(s, level).variant)).size).toBe(level === 3 ? 3 : 4)
    }
  })

  test('level 2 is in no variant, so the loaded family changes no track blueprint (S5-D51)', async () => {
    const all = new Map((await loadAllFamilies()).map((g) => [g.id, g] as [string, Gen]))
    expect(all.get('step')).toBeDefined()
    const without = new Map([...all].filter(([id]) => id !== 'step'))
    for (const t of ['t4', 't5', 't6', 't7']) {
      const blueprint = formBlueprint(t, { gens: all, kcs: KCS })
      expect(blueprint, t).not.toBeNull()
      expect(blueprint, t).toEqual(formBlueprint(t, { gens: without, kcs: KCS }))
      expect(blueprint!.some((b) => b.family === 'step')).toBe(false)
    }
  })
})

/* ------------------------------ truth, scenes and labels ------------------------------ */

describe('truth: the card at η = 1, from the claims', () => {
  for (const v of ['decode-ms', 'prefill-ms', 'ridge-kv', 'quant-bytes']) {
    test(`${v}: every one of 2,000 instances equals the oracle to 1e-9 relative, in the unit it names`, () => {
      for (const i of instances(v)) {
        expect(Math.abs(truthOf(i) / oracle(i) - 1)).toBeLessThan(1e-9)
        if (i.answer.kind === 'numeric') expect(i.answer.unit).toBe(v === 'quant-bytes' ? 'GB' : v === 'ridge-kv' ? 'FLOP/B' : 'ms')
        if (i.answer.kind === 'numeric') expect(i.answer.tolerance).toEqual({ rel: TOL })
      }
    })
  }

  test("worked by hand: Boot's 4.794 ms a token (16.06 GB over 3.35 TB/s) plus 1,000 tokens of KV (0.131 GB, 0.039 ms)", () => {
    const i = find('decode-ms', 0, (x) => x.params.hw === 'h100' && x.params.model === 'llama3-8b' && p(x, 'users') === 1 && p(x, 'ctx') === 1000)
    expect(deriveBoot().tokenSeconds * 1e3).toBeCloseTo(4.794, 3)
    // 16.06e9 / 3.35e12 = 4.7940 ms; 1,000 × 131,072 B = 131.07e6 B → 0.03913 ms; the math (2 × 8.03e9 FLOP ÷ 989e12) is 0.016 ms, hidden
    expect(truthOf(i)).toBeCloseTo(4.7940 + 0.03913, 3)
  })

  test('worked by hand: 20 users × 1,500 tokens of Llama-3-70B in FP8 on a B200 take 9.433 ms, bandwidth-bound', () => {
    const i = find('decode-ms', 3, (x) => x.params.hw === 'b200' && x.params.model === 'llama3-70b' && p(x, 'users') === 20 && p(x, 'ctx') === 1500)
    // KV = 163,840 B × 30,000 = 4.915 GB; (70.55 + 4.915) GB ÷ 8 TB/s = 9.4332 ms; math = (2 × 70.55e9 × 20 + 4 × 80 × 8192 × 30,000) ÷ 4.5e15 = 0.645 ms
    expect(truthOf(i)).toBeCloseTo(9.4332, 3)
    expect(partsText(i.prompt.stem)).toContain('bandwidth')
    expect(partsText(step.solution(i).at(-1)!.text)).toContain('bandwidth-bound')
  })

  test('worked by hand: a 4,000-token prompt of Llama-3-8B on an A100 80GB takes 219.3 ms, compute-bound', () => {
    const i = find('prefill-ms', 0, (x) => x.params.hw === 'a100-80' && p(x, 'prompt') === 4000)
    // 2 × 8.03e9 × 4,000 = 64.24 TFLOP; attention 4 × 32 × 4,096 × (4,000 × 4,001 ÷ 2) = 4.195 TFLOP; 68.435 ÷ 312 TFLOP/s = 219.34 ms
    // (the weights and KV take 16.6 GB ÷ 2,039 GB/s = 8.1 ms)
    expect(truthOf(i)).toBeCloseTo(219.34, 1)
  })

  test("decode intensity tends to the spec's 63.8 FLOP/B at a 2k context and 243.3 at 512 (Llama-3-8B, BF16), below H100's ridge of 295.2", () => {
    const a = arch('llama3-8b')
    const limit = (ctx: number) => (2 * a.P) / (ctx * a.kv) + (4 * a.L * a.H) / a.kv
    expect(limit(2048)).toBeCloseTo(63.8, 1)
    expect(limit(512)).toBeCloseTo(243.3, 1)
    expect(CHIPS.h100.peak / CHIPS.h100.bw).toBeCloseTo(295.2, 1)
    // the family's own instances never reach it: the largest H100 / 8B intensity is below the ridge
    const best = Math.max(...instances('ridge-kv').filter((x) => x.params.hw === 'h100' && x.params.model === 'llama3-8b').map(truthOf))
    expect(best).toBeLessThan(CHIPS.h100.peak / CHIPS.h100.bw)
  })

  test('NVFP4 weights are 4.5 bits each: 0.5625 B, so 70.55 B parameters weigh 39.68 GB against 70.55 GB in FP8 (spec §3.3)', () => {
    expect(claimNumber('serving.nvfp4.bits-per-weight') / 8).toBe(0.5625)
    const i = find('quant-bytes', 0, (x) => x.params.dtype === 'nvfp4')
    expect(truthOf(i)).toBeCloseTo(p(i, 'paramsB') * 0.5625, 9)
    expect(70.55 * 0.5625).toBeCloseTo(39.684, 3)
  })

  test('every scene is feasible and on the chips the spec names (2,000 instances per variant, none infeasible)', () => {
    const seen = new Set<string>()
    for (const v of ['decode-ms', 'prefill-ms', 'ridge-kv']) {
      for (const i of instances(v)) {
        const { a, chip, tokens } = scene(i)
        expect(a.W + tokens * a.kv, `${v} ${JSON.stringify(i.params)}`).toBeLessThanOrEqual(0.9 * chip.cap)
        seen.add(`${i.params.hw}/${i.params.model}`)
        if (i.params.model === 'llama3-70b') expect(['h100', 'b200']).toContain(i.params.hw)
        // FP8 math only where the chip has it: the 70B scenes carry the FP8 peak, the 8B ones the BF16 figure
        expect(partsText(i.prompt.stem)).toContain(i.params.model === 'llama3-70b' ? '(FP8 weights, TP 1)' : '(BF16 weights, TP 1)')
      }
    }
    expect([...seen].sort()).toEqual(['a100-40/llama3-8b', 'a100-80/llama3-8b', 'b200/llama3-70b', 'b200/llama3-8b', 'h100/llama3-70b', 'h100/llama3-8b', 'rtx4090/llama3-8b'])
  })

  test('levels 0 and 1 draw only Llama-3-8B in BF16; the 70B scenes join at level 3', () => {
    for (const v of ['decode-ms', 'prefill-ms', 'ridge-kv']) {
      for (const l of [0, 1] as const) expect(seeds.slice(0, 300).every((s) => step.make(s, l, v).params.model === 'llama3-8b')).toBe(true)
      expect(seeds.slice(0, 300).some((s) => step.make(s, 3, v).params.model === 'llama3-70b')).toBe(true)
    }
  })

  test('every stem is labelled "datasheet bound", and no stem or solution names a fitted term (S5-D5)', () => {
    for (const v of step.variants) {
      for (const l of v.levels) {
        for (const s of seeds.slice(0, 100)) {
          const i = step.make(s, l, v.id)
          const text = [partsText(i.prompt.stem), ...step.solution(i).map((x) => partsText(x.text)), ...(i.prompt.givens ?? []).map((g) => g.label)].join(' ')
          expect(text).toContain('datasheet bound')
          expect(text).not.toMatch(/\b(eta|η_|t_layer|t_seq|beta|β)\b|measured|fitted|InferenceX|vLLM/i)
        }
      }
    }
  })

  test('the claims an instance lists are the ones its stem and givens show, plus the capacity that decides the scene', () => {
    const i = find('decode-ms', 3, (x) => x.params.model === 'llama3-70b' && x.params.hw === 'h100')
    expect(i.claims.map((c) => c.split('@')[0]).sort()).toEqual(
      ['hw.h100-sxm.bf16-dense', 'hw.h100-sxm.hbm-bw', 'hw.h100-sxm.hbm-capacity', 'model.llama3-70b.head-dim', 'model.llama3-70b.hidden-size', 'model.llama3-70b.kv-heads', 'model.llama3-70b.layers', 'model.llama3-70b.params'].sort(),
    )
    // 70B has no eager KV claim: the stem derives it (2 × 80 × 8 × 128 × 1 B) and says so
    const kv = i.prompt.givens!.find((g) => g.label.startsWith('KV bytes per token'))!
    expect(kv.label).toContain('2 × layers × KV heads × head dim × 1 B')
    expect(partsText([kv.value])).toBe('163,840 B')
    const peak = i.prompt.givens!.find((g) => g.label.startsWith('Peak'))!
    expect(peak.label).toContain('FP8')
    expect(partsText([peak.value])).toBe('1,978 TFLOPS')
  })
})

/* ------------------------------ grading and slips ------------------------------ */

describe('grading at the family tolerance, and the slips it names', () => {
  test('a response within 2 % is right, one beyond it is not', () => {
    for (const v of step.variants) {
      const i = step.make(11, 1, v.id)
      expect(gradeResponse(i, wrong(i, 1.019), step.ratioRules).ok).toBe(true)
      expect(gradeResponse(i, wrong(i, 0.981), step.ratioRules).ok).toBe(true)
      expect(gradeResponse(i, wrong(i, 1.03), step.ratioRules).ok).toBe(false)
    }
  })

  test('dividing a decode step by the users is named (the erratum t5-l3-itl-kit)', () => {
    const i = find('decode-ms', 1, (x) => p(x, 'users') === 8)
    const g = step.grade(i, wrong(i, 1 / 8))
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('step.per-user')
    expect(g.feedback).toContain('whole step')
  })

  test('leaving the KV cache out is named, and it is what a learner with a heavy cache would answer', () => {
    const i = find('decode-ms', 1, (x) => x.params.hw === 'a100-40' && p(x, 'users') * p(x, 'ctx') > 100_000)
    const a = arch('llama3-8b')
    const slip = ((a.W / CHIPS['a100-40'].bw) * 1e3) / truthOf(i)
    expect(slip).toBeLessThan(0.8)
    const g = step.grade(i, wrong(i, slip))
    expect(g.diagnosis?.id).toBe('step.kv-missing')
  })

  test("timing the limit that does not bind is named: a long prefill answered with the weights' read time", () => {
    const i = find('prefill-ms', 0, (x) => x.params.hw === 'h100' && p(x, 'prompt') === 8000)
    const a = arch('llama3-8b')
    const memory = ((a.W + a.kv * 8000) / CHIPS.h100.bw) * 1e3
    expect(memory).toBeLessThan(truthOf(i) / 2)
    const g = step.grade(i, { kind: 'numeric', value: memory, unit: 'ms' })
    expect(g.diagnosis?.id).toBe('step.wrong-limit')
    expect(g.feedback).toContain('limit that does not bind')
  })

  test('the true answer is right whatever the unit slip rules say, in every variant and level', () => {
    for (const v of step.variants) {
      for (const l of v.levels) {
        for (const s of seeds.slice(0, 50)) {
          const i = step.make(s, l, v.id)
          expect(step.grade(i, { kind: 'numeric', value: truthOf(i), unit: i.answer.kind === 'numeric' ? i.answer.unit : '' }).ok).toBe(true)
        }
      }
    }
  })
})

/* ------------------------------ fairness (§7.2) ------------------------------ */

/**
 * The constant that is right (|c − t| ≤ tol·t) for the most truths, and the share it covers. A window of sorted truths
 * from t_i to t_j has such a constant iff t_j(1 − tol) ≤ t_i(1 + tol); the constant is the middle of that range, so a
 * truth is never on the edge of the grader's tolerance.
 */
function bestConstant(ts: number[], tol: number): { c: number; share: number } {
  const s = ts.slice().sort((a, b) => a - b)
  const reach = ((1 + tol) / (1 - tol)) * (1 - 1e-9)
  let best = { c: 0, share: 0 }
  let j = 0
  for (let i = 0; i < s.length; i++) {
    j = Math.max(j, i)
    while (j + 1 < s.length && s[j + 1] <= s[i] * reach) j++
    if ((j - i + 1) / s.length > best.share) best = { c: (s[j] * (1 - tol) + s[i] * (1 + tol)) / 2, share: (j - i + 1) / s.length }
  }
  return best
}

describe('fairness (§7.2): over 2,000 instances per variant the best constant is within 2 % on at most 10 %, and the answers span at least 10×', () => {
  for (const v of step.variants) {
    test(v.id, () => {
      const all = instances(v.id)
      const ts = all.map(truthOf)
      const best = bestConstant(ts, TOL)
      const span = Math.max(...ts) / Math.min(...ts)
      // the constant is right by the family's own grader, on exactly the share counted
      const unit = all[0].answer.kind === 'numeric' ? all[0].answer.unit : ''
      const graded = all.filter((i) => step.grade(i, { kind: 'numeric', value: best.c, unit }).ok).length / all.length
      expect(graded).toBe(best.share)
      const perLevel = v.levels.map((l) => {
        const lv = seeds.map((s) => truthOf(step.make(s, l, v.id)))
        return { l, ...bestConstant(lv, TOL), span: Math.max(...lv) / Math.min(...lv) }
      })
      const line = `fairness ${v.id.padEnd(11)} ${all.length} instances, answers ${Math.min(...ts).toPrecision(4)}..${Math.max(...ts).toPrecision(5)} ${unit} (span ${span.toFixed(1)}x), best constant ${best.c.toPrecision(5)} covers ${(best.share * 100).toFixed(1)} % | per level: ${perLevel.map((x) => `L${x.l} ${(x.share * 100).toFixed(1)} % span ${x.span.toFixed(0)}x`).join(', ')}`
      console.log(line)
      expect(best.share).toBeLessThanOrEqual(0.1)
      expect(span).toBeGreaterThanOrEqual(10)
      for (const x of perLevel) {
        expect(x.share, `${v.id} L${x.l}`).toBeLessThanOrEqual(0.1)
        expect(x.span, `${v.id} L${x.l}`).toBeGreaterThanOrEqual(10)
      }
    })
  }
})
