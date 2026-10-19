/**
 * The `step` family (docs/specs/s5.md §7.2-7.5): the η-free variants (task S5-10) and the calibrated ones (S5-14). Every
 * truth is checked against an oracle written here from the claims and the lessons' formulas alone (not from the
 * family's code), the scenes against the capacity rule or the row's box and envelope, the fairness of §7.2 is printed and
 * asserted over 2,000 instances per variant (ratio variants by the protocol's ratio rule), the cut calibrated variants
 * are shown to fail it, and the forms' blueprints are shown unchanged by the family's presence (S5-D51).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkFamily, checkHashes, genSeeds, lintLiterals, readHashRows } from '../../scripts/verify-generators'
import { claimNumber, getClaim } from '../../src/data/claims'
import { lazyGroupFor } from '../../src/data/claims/homes'
import { KCS } from '../../src/data/kc'
import { deriveBoot } from '../../src/lib/boot/model'
import { partsText } from '../../src/lib/items/core'
import * as stepModule from '../../src/lib/items/families/step'
import { gradeResponse } from '../../src/lib/items/grade'
import { collect, NotReady, settle } from '../../src/lib/items/on-demand'
import { forgetFamilyParts, loadAllFamilies, loadFamilyPart } from '../../src/lib/items/registry'
import type { Gen, Instance, Level, Response } from '../../src/lib/items/types'
import { formBlueprint } from '../../src/lib/learner/forms'
import { BOX_BLOCK_SIZE, BOX_RANGE_RATIO, exceeds, inBox, kvRoomTokens } from '../../src/lib/world/physics/box'
import { stepCard } from '../../src/lib/world/physics/card'
import { checkEligibility, familyConsumers } from '../../src/lib/world/physics/consumers'
import { IX_INBOX, PHYS_ID, PHYSICS_ROWS } from '../../src/lib/world/physics/table'
import type { CalibratedRow, StepLoad } from '../../src/lib/world/physics/types'

const step = stepModule.default
const ETA_FREE = ['decode-ms', 'prefill-ms', 'ridge-kv', 'quant-bytes']
const CALIBRATED = ['prefill-ms-v2', 'tp-speedup']
/** Ratio variants: the protocol's ratio rule, constant cover only (no span bound; `items.ratioRule`, S5-D57). */
const RATIOS = new Set(['tp-speedup'])
const FILE = new URL('../../src/lib/items/families/step.ts', import.meta.url)
const PART_FILE = new URL('../../src/lib/items/families/lazy/step-calibrated.ts', import.meta.url)
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

  test('declares the six variants on the six KCs, each without level 2, and every answer is numeric', () => {
    expect(step.variants.map((v) => v.id)).toEqual([...ETA_FREE, ...CALIBRATED])
    expect(step.variants.map((v) => v.kcs)).toEqual([
      ['t4.decode-bandwidth', 't5.latency-metrics'],
      ['t5.prefill-vs-decode'],
      ['t4.ridge-point'],
      ['t6.fp4-capacity'],
      ['t5.prefill-vs-decode'],
      ['t6.parallelism-composition'],
    ])
    expect([...step.kcs].sort()).toEqual(['t4.decode-bandwidth', 't4.ridge-point', 't5.latency-metrics', 't5.prefill-vs-decode', 't6.fp4-capacity', 't6.parallelism-composition'])
    // quant-bytes also stops before level 3, so the placement walk's confirmation on t6.fp4-capacity stays with `memory`
    expect(step.variants.map((v) => v.levels)).toEqual([[0, 1, 3], [0, 1, 3], [0, 1, 3], [0, 1], [0, 1, 3], [0, 1, 3]])
    // the generator version moved with the calibrated variants (2) and with the prefill stems' wording (3, S5-10 m2 and
    // S5-14 m3), so every stored instance of an earlier version stays itself
    expect(step.version).toBe(3)
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

  test('its source passes the literal lint; it imports the card, and no table, claim group or engine: those are the calibrated part\'s (B10)', () => {
    const text = readFileSync(FILE, 'utf8')
    expect(lintLiterals(FILE.pathname, text)).toEqual([])
    const imports = [...text.matchAll(/(?:from |import )'([^']+)'/g)].map((m) => m[1])
    expect(imports.filter((x) => /physics|lazy|ix-points|claims\/|registry/.test(x)).sort()).toEqual([
      './lazy/step-calibrated',
      '@/lib/items/registry',
      '@/lib/world/physics/card',
      '@/lib/world/physics/consumers',
      '@/lib/world/physics/types',
    ])
    // the consumer contract and the part are types here: a value import would put the registries, or the part, in the chunk
    expect(text).toContain("import type { PhysicsConsumer } from '@/lib/world/physics/consumers'")
    expect(text).toContain("import type * as Calibrated from './lazy/step-calibrated'")
    // nor does it import the part by `import()`: under Bun it awaits the part (top-level await), and Rollup treats an
    // `import()` in such a module as a static import; the registry's `familyPart` issues it
    expect(text).not.toMatch(/import\(/)
  })

  test("the calibrated part passes the same literal lint (verify:generators lints only families/<id>.ts) and holds the table and the three claim groups", () => {
    const text = readFileSync(PART_FILE, 'utf8')
    expect(lintLiterals(PART_FILE.pathname, text)).toEqual([])
    const imports = [...text.matchAll(/(?:from |import )'([^']+)'/g)].map((m) => m[1])
    expect(imports.filter((x) => /physics|lazy|ix-points|claims\//.test(x)).sort()).toEqual([
      '@/data/claims/lazy/ix-points',
      '@/data/claims/lazy/physics',
      '@/data/claims/lazy/tiling',
      '@/lib/world/physics/card',
      '@/lib/world/physics/consumers',
      '@/lib/world/physics/table',
      '@/lib/world/physics/types',
    ])
    expect(text).toContain("import type { PhysicsConsumer } from '@/lib/world/physics/consumers'")
    // it never imports the family (step.ts awaits it under Bun: a cycle would deadlock)
    expect(imports.some((x) => /families\/step|\.\.\/step/.test(x))).toBe(false)
  })

  test('a calibrated draw before the part loads throws NotReady and starts the load; after settle it is the eager build, solution included', async () => {
    const eager = CALIBRATED.flatMap((v) => [0, 1, 3].map((l) => step.make(seeds[l + 1], l as Level, v)))
    const eagerFree = step.make(seeds[0], 1, 'decode-ms')
    forgetFamilyParts()
    try {
      for (const v of CALIBRATED) expect(() => step.make(seeds[1], 0, v)).toThrow(NotReady)
      // the η-free variants never need the part
      expect(step.make(seeds[0], 1, 'decode-ms')).toEqual(eagerFree)
      // inside collect the stop is reported with the load it asked for
      const run = collect(() => step.make(seeds[1], 0, 'tp-speedup'))
      expect(run.value).toBeUndefined()
      expect(run.stopped).toBeInstanceOf(NotReady)
      expect(run.ready).not.toBeNull()
      forgetFamilyParts()
      const made = await settle(() => CALIBRATED.flatMap((v) => [0, 1, 3].map((l) => step.make(seeds[l + 1], l as Level, v))))
      expect(made).toEqual(eager)
      made.forEach((i, k) => expect(step.solution(i)).toEqual(step.solution(eager[k])))
      // once loaded it stays loaded: make is synchronous again
      expect(step.make(seeds[1], 0, 'prefill-ms-v2')).toEqual(eager[0])
    } finally {
      await loadFamilyPart('step-calibrated')
    }
  })

  test('the η-free variants still read no lazy claim group and no table: every claim they list is eager (S5-D61)', () => {
    for (const v of ETA_FREE) {
      for (const l of step.variants.find((x) => x.id === v)!.levels) {
        for (const s of seeds.slice(0, 200)) {
          for (const c of step.make(s, l, v).claims) expect(lazyGroupFor(c.split('@')[0]), `${v} ${c}`).toBeUndefined()
        }
      }
    }
  })

  test('make is a pure function of (seed, level, variant); an unspecified variant is chosen by the seed', () => {
    for (const level of [0, 1, 3] as const) {
      for (const s of seeds.slice(0, 20)) expect(step.make(s, level)).toEqual(step.make(s, level))
      // quant-bytes stops before level 3
      expect(new Set(seeds.map((s) => step.make(s, level).variant)).size).toBe(level === 3 ? 5 : 6)
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
  for (const v of ETA_FREE) {
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

  test('every η-free stem is labelled "datasheet bound", and no stem or solution names a fitted term (S5-D5)', () => {
    for (const v of step.variants.filter((x) => ETA_FREE.includes(x.id))) {
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

  test("a prefill reads the weights and writes its prompt's KV: the stem says so, and the bytes it times are both (S5-10 m2)", () => {
    for (const l of [0, 1, 3] as const) {
      for (const s of seeds.slice(0, 50)) {
        const i = step.make(s, l, 'prefill-ms')
        const stem = partsText(i.prompt.stem)
        expect(stem).toContain("reads the weights once and writes the prompt's KV bytes")
        expect(stem).not.toContain("plus the prompt's KV")
        // the card counts the written KV in its bytes: weights + P × KV bytes per token
        const { a, chip } = scene(i)
        expect(((a.W + a.kv * p(i, 'prompt')) / chip.bw) * 1e3).toBeLessThanOrEqual(truthOf(i) * (1 + 1e-12))
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

describe('fairness (§7.2): over 2,000 instances per variant the best constant is within 2 % on at most 10 %, and absolute answers span at least 10× (ratios: no span bound)', () => {
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
      const line = `fairness ${v.id.padEnd(13)} ${all.length} instances, answers ${Math.min(...ts).toPrecision(4)}..${Math.max(...ts).toPrecision(5)} ${unit} (span ${span.toFixed(1)}x), best constant ${best.c.toPrecision(5)} covers ${(best.share * 100).toFixed(1)} % | per level: ${perLevel.map((x) => `L${x.l} ${(x.share * 100).toFixed(1)} % span ${x.span.toFixed(0)}x`).join(', ')}`
      console.log(`${line}${RATIOS.has(v.id) ? ' (ratio rule: no span bound)' : ''}`)
      expect(best.share).toBeLessThanOrEqual(0.1)
      if (!RATIOS.has(v.id)) expect(span).toBeGreaterThanOrEqual(10)
      for (const x of perLevel) {
        expect(x.share, `${v.id} L${x.l}`).toBeLessThanOrEqual(0.1)
        if (!RATIOS.has(v.id)) expect(x.span, `${v.id} L${x.l}`).toBeGreaterThanOrEqual(10)
      }
    })
  }
})

/* ------------------------------ the calibrated variants (S5-14) ------------------------------ */

const rowOf = (i: Instance): CalibratedRow => PHYSICS_ROWS.find((r) => r.key === i.params.row)!
const METRIC: Record<string, 'tpot' | 'ttft'> = { 'prefill-ms-v2': 'ttft', 'tp-speedup': 'tpot' }

/** The claim ids of a row's chip, peak and weights, as protocol.md's rows name them. */
function rowClaims(key: string) {
  const hw = key.startsWith('h100') ? 'hw.h100-sxm' : 'hw.b200'
  const prec = key.endsWith('nvfp4') ? 'nvfp4' : 'fp8'
  return { bw: `${hw}.hbm-bw`, peak: `${hw}.${prec === 'nvfp4' ? 'fp4' : 'fp8'}-dense`, hbm: `${hw}.hbm-capacity`, weights: `model.llama3-70b.weight-bytes-${prec}` }
}

/** A scene's step, in ms, from the claims the stem shows (the phys.* parameters among them) and §3.2's formulas. */
function calOracleMs(key: string, tp: number, users: number, ctx: number, prompt: number): number {
  const c = rowClaims(key)
  const ph = (k: string) => claimNumber(`phys.${key}.${k}`)
  const [P, L, H] = [claimNumber('model.llama3-70b.params', GB), claimNumber('model.llama3-70b.layers'), claimNumber('model.llama3-70b.hidden-size')]
  const kv = claimNumber('model.llama3-70b.kv-bytes-per-token-fp8')
  const d = prompt > 0 ? users - 1 : users
  const T = d + prompt
  const K = d * ctx + prompt
  const A = d * ctx + (prompt * (prompt + 1)) / 2
  const mem = (claimNumber(c.weights) + kv * K) / tp / (ph('eta-mem') * claimNumber(c.bw, 1e12))
  const flop = (2 * P * T + 4 * L * H * A) / tp / (ph('eta-flop') * claimNumber(c.peak, 1e12))
  const link = tp > 1 ? (2 * L * T * H * 2 * 2 * (tp - 1)) / tp / (ph('link-gbs') * GB) : 0
  return ((L * ph('layer-us') + users * ph('seq-us')) / 1e6 + link + Math.max(mem, flop)) * 1e3
}

function calOracle(i: Instance): number {
  const at = (tp: number) => calOracleMs(String(i.params.row), tp, p(i, 'users'), p(i, 'ctx'), i.params.prompt === undefined ? 0 : p(i, 'prompt'))
  return i.variant === 'tp-speedup' ? at(p(i, 'tp')) / at(p(i, 'tpTo')) : at(p(i, 'tp'))
}

/** The scene's step load and its decoding sequences, as §3.1 counts them. */
function calLoad(i: Instance): { load: StepLoad; decoding: number } {
  const n = i.params.prompt === undefined ? 0 : p(i, 'prompt')
  const d = n > 0 ? p(i, 'users') - 1 : p(i, 'users')
  const k = d * p(i, 'ctx')
  return { load: { seqs: p(i, 'users'), tokens: d + n, kvTokens: k + n, attnPairs: k + (n * (n + 1)) / 2 }, decoding: d }
}

const calInstances = new Map(CALIBRATED.map((v) => [v, instances(v)]))
/** The H4 label: the stem's parts from the one that opens it. */
const labelOf = (i: Instance) => i.prompt.stem.slice(i.prompt.stem.findIndex((x) => x.t === 'text' && x.text.startsWith('[v2 physics')))
const pct = (fraction: number): string => String(Math.round(fraction * 1000) / 10)
/** Every string an instance shows: stem, givens, the solution and the slip messages. */
const textOf = (i: Instance): string =>
  [
    partsText(i.prompt.stem),
    ...(i.prompt.givens ?? []).flatMap((g) => [g.label, partsText([g.value])]),
    ...step.solution(i).map((x) => partsText(x.text)),
    ...step.ratioRules.map((r) => (typeof r.message === 'string' ? r.message : r.message(i))),
  ].join(' ')

describe('calibrated variants: rows, box and the table (S5-14)', () => {
  test("the table's parameters are the phys.* claims the stems show, at the claims' precision, and its chips and model are the input claims", () => {
    for (const r of PHYSICS_ROWS) {
      const q = r.spec.params
      const ph = (k: string) => claimNumber(`phys.${r.key}.${k}`)
      // η to 0.01 and µs, GB/s and ms to 0.1, the precision the claims print and the family shows
      expect(Math.round(q.etaMem * 100) / 100, r.key).toBe(ph('eta-mem'))
      expect(Math.round(q.etaFlop * 100) / 100, r.key).toBe(ph('eta-flop'))
      expect(Math.round(q.layerUs * 10) / 10, r.key).toBe(ph('layer-us'))
      expect(Math.round(q.seqUs * 10) / 10, r.key).toBe(ph('seq-us'))
      expect(Math.round(q.linkGBs! * 10) / 10, r.key).toBe(ph('link-gbs'))
      expect(Math.round(r.harnessMs * 10) / 10, r.key).toBe(ph('harness-ms'))
      // the H4 figures (fractions in the table, percent in the claims)
      expect(pct(r.label.tpot.p90), r.key).toBe(String(ph('loo-tpot-p90')))
      expect(pct(r.label.ttft.p90), r.key).toBe(String(ph('loo-ttft8k-p90')))
      expect(pct(r.label.ttft.mean), r.key).toBe(String(ph('loo-ttft8k-mean')))
      const c = rowClaims(r.key)
      expect(r.spec.chip).toEqual({ bwBps: claimNumber(c.bw, 1e12), peakFlops: claimNumber(c.peak, 1e12), hbmBytes: claimNumber(c.hbm, GB) })
      expect(r.spec.model).toEqual({
        params: claimNumber('model.llama3-70b.params', GB),
        layers: claimNumber('model.llama3-70b.layers'),
        hidden: claimNumber('model.llama3-70b.hidden-size'),
        kvBytesPerToken: claimNumber('model.llama3-70b.kv-bytes-per-token-fp8'),
        weightBytes: claimNumber(c.weights),
      })
    }
    // the S5-D70 figures the TTFT labels print: H100 20.7 %, B200 FP8 19.1 %, NVFP4 26.1 %
    expect(PHYSICS_ROWS.map((r) => [r.key, claimNumber(`phys.${r.key}.loo-ttft8k-p90`)])).toEqual([
      ['h100-vllm-0-10-2-fp8', 20.7],
      ['b200-vllm-0-10-2-fp8', 19.1],
      ['b200-vllm-0-10-2-nvfp4', 26.1],
    ])
  })

  for (const v of CALIBRATED) {
    test(`${v}: every one of 2,000 instances equals the card worked from the stem's claims, to 1e-9 relative`, () => {
      for (const i of calInstances.get(v)!) {
        expect(Math.abs(truthOf(i) / calOracle(i) - 1), JSON.stringify(i.params)).toBeLessThan(1e-9)
        expect(i.answer.kind === 'numeric' && i.answer.unit).toBe(v === 'tp-speedup' ? '×' : 'ms')
        expect(i.answer.kind === 'numeric' && i.answer.tolerance).toEqual({ rel: TOL })
      }
    })

    test(`${v}: the claims' rounding is far inside the tolerance: the table's unrounded parameters move no answer by 0.2 %`, () => {
      let worst = 0
      for (const i of calInstances.get(v)!) {
        const r = rowOf(i)
        const exact = (tp: number) => stepCard(r.spec, tp, calLoad(i).load).stepS * 1e3
        const t = v === 'tp-speedup' ? exact(p(i, 'tp')) / exact(p(i, 'tpTo')) : exact(p(i, 'tp'))
        worst = Math.max(worst, Math.abs(t / truthOf(i) - 1))
      }
      console.log(`${v}: the largest move from the table's unrounded parameters is ${(worst * 100).toFixed(3)} %`)
      expect(worst).toBeLessThan(0.002)
    })

    test(`${v}: only rows the table marks calibrated and ${METRIC[v]}-eligible, in the box (box.ts) and the envelope at every TP the item names`, () => {
      const rows = new Set<string>()
      for (const i of calInstances.get(v)!) {
        const r = rowOf(i)
        rows.add(r.key)
        expect(r.status).toBe('calibrated')
        expect(r.eligible[METRIC[v]]).toBe(true)
        const isl = p(i, 'isl')
        const osl = p(i, 'osl')
        expect(p(i, 'ctx')).toBeGreaterThanOrEqual(BOX_RANGE_RATIO * isl)
        expect(p(i, 'ctx')).toBeLessThanOrEqual(isl + osl)
        if (v === 'prefill-ms-v2') {
          expect(p(i, 'prompt')).toBeGreaterThanOrEqual(BOX_RANGE_RATIO * isl)
          expect(p(i, 'prompt')).toBeLessThanOrEqual(isl)
        }
        const { load, decoding } = calLoad(i)
        for (const tp of v === 'tp-speedup' ? [p(i, 'tp'), p(i, 'tpTo')] : [p(i, 'tp')]) {
          const box = inBox(r, { tp, maxNumSeqs: p(i, 'users'), batchTokens: r.box.batchTokens, blockSize: BOX_BLOCK_SIZE, shape: { isl, osl, ratio: BOX_RANGE_RATIO } })
          expect(box, JSON.stringify(i.params)).toEqual({ ok: true, reason: '' })
          expect(exceeds(r.envelope, load, tp, decoding), JSON.stringify(i.params)).toBe(false)
          expect(load.kvTokens).toBeLessThanOrEqual(kvRoomTokens(r, tp))
        }
        if (v === 'tp-speedup') expect(p(i, 'tpTo')).toBeGreaterThan(p(i, 'tp'))
      }
      // every eligible row is drawn, and PHYSICS_CONSUMERS names exactly those
      expect([...rows].sort()).toEqual(PHYSICS_ROWS.filter((r) => r.status === 'calibrated' && r.eligible[METRIC[v]]).map((r) => r.key).sort())
      expect([...stepModule.PHYSICS_CONSUMERS.find((c) => c.id === `step/${v}`)!.rows].sort()).toEqual([...rows].sort())
    })
  }

  test('PHYSICS_CONSUMERS names each calibrated variant with its rows and metric, and every one is eligible (S5-D54)', () => {
    expect(stepModule.PHYSICS_CONSUMERS).toEqual([
      { id: 'step/prefill-ms-v2', rows: ['h100-vllm-0-10-2-fp8', 'b200-vllm-0-10-2-fp8', 'b200-vllm-0-10-2-nvfp4'], metric: 'ttft' },
      { id: 'step/tp-speedup', rows: ['h100-vllm-0-10-2-fp8', 'b200-vllm-0-10-2-fp8', 'b200-vllm-0-10-2-nvfp4'], metric: 'tpot' },
    ])
    // what collectConsumers() reads from this module, and what verify:physics then checks
    expect(familyConsumers('step', stepModule).map((c) => ({ id: c.id, rows: c.rows, metric: c.metric }))).toEqual(stepModule.PHYSICS_CONSUMERS)
    expect(checkEligibility(stepModule.PHYSICS_CONSUMERS, PHYSICS_ROWS, PHYS_ID)).toEqual([])
    for (const c of stepModule.PHYSICS_CONSUMERS) expect(c.metric).toBe(METRIC[c.id.slice('step/'.length)])
    // a row the table did not calibrate would fail the same check
    const failed = PHYSICS_ROWS.map((r) => (r.key === 'b200-vllm-0-10-2-nvfp4' ? { ...r, status: 'failed' as const } : r))
    expect(checkEligibility(stepModule.PHYSICS_CONSUMERS, failed)).toHaveLength(2)
  })
})

describe('calibrated variants: labels, givens and whys (S5-14)', () => {
  test("every stem ends with §7.0's H4 label for its metric: TTFT's p90 for prefill-ms-v2, no '9 in 10' on the tp-speedup ratio (S5-D58)", () => {
    for (const v of CALIBRATED) {
      for (const i of calInstances.get(v)!.slice(0, 400)) {
        const r = rowOf(i)
        const label = labelOf(i)
        const text = partsText(label)
        const name = r.key.startsWith('h100') ? 'H100 SXM' : 'B200'
        const prec = r.key.endsWith('nvfp4') ? 'NVFP4' : 'FP8'
        // n is the item's metric's (§7.0 H4): n_F, the points the fit read, on a ratio; G3's ~8k-prompt points on a TTFT label,
        // which the fit read too, so the label says they are the points the TTFT error was checked on (S5-14 m3)
        const points = RATIOS.has(v) ? `fitted on ${r.label.tpot.n} InferenceX points` : `checked on ${r.label.ttft.n} InferenceX points with ~8k prompts`
        expect(text.startsWith(`[v2 physics · ${name} · vLLM 0.10.2 · ${prec} · ${points} (2025-10-29)`), text).toBe(true)
        expect(text.endsWith(` · ${PHYS_ID}]`)).toBe(true)
        // the label's metric: the claim it carries is the item's metric's leave-one-out p90, or none on a ratio
        const claims = label.flatMap((x) => (x.t === 'claim' ? [x.claim] : []))
        if (RATIOS.has(v)) {
          expect(claims).toEqual([])
          expect(text).not.toContain('9 in 10')
        } else {
          expect(METRIC[v]).toBe('ttft')
          expect(claims).toEqual([`phys.${r.key}.loo-ttft8k-p90`])
          expect(text).toContain(` · TTFT 9 in 10 within ${pct(r.label.ttft.p90)} % (leave-one-out, plus the harness term) · `)
          expect(text).not.toContain('TPOT')
          expect(text).not.toContain(`${r.label.tpot.n} InferenceX`)
        }
        // H4 only: no decision-level H1 figure, and the parameters are "the engine's numbers", not hardware facts
        expect(textOf(i)).not.toMatch(/frontier|\bH1\b|separation/)
        expect(partsText(i.prompt.stem)).toContain("the engine's numbers: this fit's split of one benchmark sweep, not hardware facts")
      }
    }
  })

  test("the givens show the row's inputs and the engine's numbers as claim chips, β only where a link term runs", () => {
    for (const v of CALIBRATED) {
      for (const i of calInstances.get(v)!.slice(0, 200)) {
        const r = rowOf(i)
        const c = rowClaims(r.key)
        const ids = i.prompt.givens!.map((g) => (g.value.t === 'claim' ? g.value.claim : null))
        const link = Math.max(p(i, 'tp'), i.params.tpTo === undefined ? 1 : p(i, 'tpTo')) > 1
        expect(ids).toEqual([
          c.bw,
          c.peak,
          c.weights,
          'model.llama3-70b.params',
          'model.llama3-70b.layers',
          'model.llama3-70b.hidden-size',
          'model.llama3-70b.kv-bytes-per-token-fp8',
          ...['eta-mem', 'eta-flop', 'layer-us', 'seq-us', ...(link ? ['link-gbs'] : [])].map((k) => `phys.${r.key}.${k}`),
        ])
        // each listed claim resolves, and the capacity and the harness settings that decide the box are listed too
        for (const ref of i.claims) expect(getClaim(ref.split('@')[0]).verifiedAt).toBe(ref.split('@')[1])
        const listed = i.claims.map((x) => x.split('@')[0])
        for (const id of [c.hbm, 'bench.inferencex.llama70b-2025-10-29', 'status.inferencex.harness.gpu-mem-util', 'status.inferencex.harness.range-ratio']) expect(listed).toContain(id)
      }
    }
  })

  test('tp-speedup whys show the measured TPOT at both TPs exactly when both are fit points in the box (a point claim each); prefill-ms-v2 whys show none', () => {
    let shown = 0
    for (const i of calInstances.get('tp-speedup')!) {
      const sol = step.solution(i)
      const pts = sol.flatMap((x) => x.text).flatMap((x) => (x.t === 'claim' && x.claim.startsWith('bench.ix-l70.') ? [x.claim] : []))
      const at = (tp: number) => IX_INBOX[String(i.params.row)].find((x) => x.tp === tp && x.conc === p(i, 'users') && x.isl === p(i, 'isl') && x.osl === p(i, 'osl'))
      const a = at(p(i, 'tp'))
      const b = at(p(i, 'tpTo'))
      if (a && b) {
        shown++
        const ids = [p(i, 'tp'), p(i, 'tpTo')].map((tp) => `bench.ix-l70.${i.params.row}.tp${tp}.${i.params.isl}-${i.params.osl}.c${i.params.users}.tpot`)
        expect(pts).toEqual(ids)
        // the point claims hold the table's measured TPOT (the same published rows), and the why prints their ratio
        expect([getClaim(ids[0]).value, getClaim(ids[1]).value]).toEqual([a.tpot, b.tpot])
        expect(getClaim(ids[0]).source?.row).toBe(`id ${a.id}`)
        const why = partsText(sol.at(-1)!.text)
        expect(why).toContain(`(${String(Math.round((claimNumber(ids[0], 1e3) / claimNumber(ids[1], 1e3)) * 1000) / 1000)} ×)`)
        expect(why).toContain('not this one step')
      } else expect(pts).toEqual([])
      // the measured value is a why, never the graded result
      expect(sol.filter((x) => x.result).at(-1)!.result!.value).toBe(truthOf(i))
    }
    console.log(`tp-speedup: ${shown} of 2000 instances show InferenceX's measured TPOT at both TPs`)
    // the why says measured TPOT falls short of the TP ratio on every published pair in the box: it does, on all of them
    let pairs = 0
    for (const pts of Object.values(IX_INBOX)) {
      for (const a of pts) {
        for (const b of pts.filter((x) => x.tp > a.tp && x.conc === a.conc && x.isl === a.isl && x.osl === a.osl)) {
          pairs++
          expect(a.tpot / b.tpot).toBeLessThan(b.tp / a.tp)
        }
      }
    }
    expect(pairs).toBe(98)
    expect(shown).toBeGreaterThan(100)
    for (const i of calInstances.get('prefill-ms-v2')!) {
      const sol = step.solution(i)
      expect(sol.flatMap((x) => x.text).some((x) => x.t === 'claim' && x.claim.startsWith('bench.'))).toBe(false)
      expect(sol.map((x) => partsText(x.text)).join(' ')).not.toMatch(/measured/i)
    }
  })

  test('no copy names a fitted term as the cause (S5-D5): the forbidden phrasings appear in no stem, given, solution or slip message', () => {
    const FORBIDDEN = [/because the fixed/i, /because t_seq/i, /η_m is/i]
    for (const v of step.variants) {
      for (const l of v.levels) {
        for (const s of seeds.slice(0, 100)) {
          const text = textOf(step.make(s, l, v.id))
          for (const f of FORBIDDEN) expect(text, `${v.id}@L${l}`).not.toMatch(f)
        }
      }
    }
  })

  test('worked by hand: H100 FP8, TP 2 → 8, 4 users of ~1k/~1k at context 1,400 speed up 1.983× on the card; InferenceX measured 1.910×', () => {
    const i = find('tp-speedup', 3, (x) => x.params.row === 'h100-vllm-0-10-2-fp8' && p(x, 'tp') === 2 && p(x, 'tpTo') === 8 && p(x, 'users') === 4 && p(x, 'isl') === 1024 && p(x, 'osl') === 1024 && p(x, 'ctx') === 1400)
    // K = 4 × 1,400 = 5,600; bytes = 70.55e9 + 163,840 × 5,600 = 71.4675e9
    // TP 2: memory 71.4675e9 ÷ 2 ÷ (0.89 × 3.35e12) = 11.9852 ms; link 2·80·4·8192·4·1/2 = 10.49 MB ÷ 213.2 GB/s = 0.0492 ms;
    //       fixed 80 × 72.3 + 4 × 61.1 = 6,028.4 µs; step 18.0627 ms (math 0.28 ms, hidden)
    // TP 8: memory 2.9963 ms; link 18.35 MB ÷ 213.2 GB/s = 0.0861 ms; step 9.1108 ms; 18.0627 ÷ 9.1108 = 1.9826×
    expect(truthOf(i)).toBeCloseTo(1.9826, 4)
    // the measured pair is the tab's finding phys.finding.tp2-to-tp8: 17.41 → 9.11 ms (ids 42017 → 41625)
    const why = partsText(step.solution(i).at(-1)!.text)
    expect(why).toContain('17.41 ms at TP 2 and 9.114 ms at TP 8')
    expect(why).toContain('(1.91 ×)')
    expect(claimNumber('phys.finding.tp2-to-tp8')).toBe(1.91)
  })

  test('worked by hand: B200 FP8, TP 1, a 7,400-token prompt beside 3 users at context 7,800 takes 544.40 ms, compute-bound', () => {
    // T = 7,403; K = 7,400 + 3 × 7,800 = 30,800; pairs = 7,400 × 7,401 ÷ 2 + 23,400 = 27,407,100
    // FLOP = 2 × 70.55e9 × 7,403 + 4 × 80 × 8,192 × 27,407,100 = 1.116409e15; ÷ (0.46 × 4.5e15) = 539.328 ms
    // memory (70.55e9 + 163,840 × 30,800) ÷ (0.84 × 8e12) = 11.249 ms; fixed 80 × 61.8 + 4 × 32.6 = 5,074.4 µs
    expect(calOracleMs('b200-vllm-0-10-2-fp8', 1, 4, 7800, 7400)).toBeCloseTo(544.4026, 3)
    const i = find('prefill-ms-v2', 3, (x) => x.params.row === 'b200-vllm-0-10-2-fp8' && p(x, 'tp') === 1 && p(x, 'isl') === 8192 && p(x, 'users') === 4)
    expect(Math.abs(truthOf(i) / calOracle(i) - 1)).toBeLessThan(1e-9)
    expect(partsText(step.solution(i).filter((x) => x.result).at(-1)!.text)).toContain('compute-bound')
  })
})

/* ------------------------------ the cut variants ------------------------------ */

/** Every in-box decode step of a row at a TP: the sweep's users, its shapes, and two-significant-digit contexts in range. */
function decodeScenes(r: CalibratedRow, tp: number): StepLoad[] {
  const ctxs: number[] = []
  for (let m = 10; m <= 99; m++) ctxs.push(m * 10, m * 100)
  const out: StepLoad[] = []
  for (const users of [4, 8, 16, 32, 64]) {
    for (const { isl, osl } of r.box.shapes) {
      if (!inBox(r, { tp, maxNumSeqs: users, batchTokens: r.box.batchTokens, blockSize: BOX_BLOCK_SIZE, shape: { isl, osl, ratio: BOX_RANGE_RATIO } }).ok) continue
      for (const ctx of ctxs.filter((x) => x >= BOX_RANGE_RATIO * isl && x <= isl + osl)) {
        const load = { seqs: users, tokens: users, kvTokens: users * ctx, attnPairs: users * ctx }
        if (!exceeds(r.envelope, load, tp, users)) out.push(load)
      }
    }
  }
  return out
}

describe('the cut calibrated variants fail the protocol whatever their sampling (§7.2, S5-D57)', () => {
  test('calibrated decode-ms: every in-box decode step of every row lies within 10× of every other, so no draw can span 10×', () => {
    const ms: number[] = []
    for (const r of PHYSICS_ROWS.filter((x) => x.status === 'calibrated' && x.eligible.tpot)) {
      for (const tp of r.box.tp) for (const load of decodeScenes(r, tp)) ms.push(stepCard(r.spec, tp, load).stepS * 1e3)
    }
    const span = Math.max(...ms) / Math.min(...ms)
    console.log(`cut decode-ms (calibrated): ${ms.length} in-box decode steps, ${Math.min(...ms).toFixed(2)}..${Math.max(...ms).toFixed(2)} ms, span ${span.toFixed(2)}x < 10x (items.answerSpanMin)`)
    expect(span).toBeLessThan(10)
  })

  test("quant-speedup: B200 FP8 → NVFP4 at TP 1-4 spans so little that some constant is right on more than 10 % under any sampling; it stays the tab's finding", () => {
    const fp8 = PHYSICS_ROWS.find((r) => r.key === 'b200-vllm-0-10-2-fp8')!
    const nv = PHYSICS_ROWS.find((r) => r.key === 'b200-vllm-0-10-2-nvfp4')!
    const ratios: number[] = []
    for (const tp of nv.box.tp) {
      for (const load of decodeScenes(fp8, tp)) {
        if (exceeds(nv.envelope, load, tp, load.seqs)) continue
        ratios.push(stepCard(fp8.spec, tp, load).stepS / stepCard(nv.spec, tp, load).stepS)
      }
    }
    const lo = Math.min(...ratios)
    const hi = Math.max(...ratios)
    // a constant c is right on [c ÷ 1.02, c ÷ 0.98]; k such windows cover [lo, hi], so one of them holds at least 1 / k of any draw
    const k = Math.ceil(Math.log(hi / lo) / Math.log(1.02 / 0.98))
    console.log(`cut quant-speedup: ${ratios.length} in-box scenes, ratios ${lo.toFixed(3)}..${hi.toFixed(3)}x; ${k} tolerance windows cover them, so the best constant covers at least ${(100 / k).toFixed(1)} % of any draw (max 10 %)`)
    expect(1 / k).toBeGreaterThan(0.1)
    // the measured finding the tab keeps: 1.01-1.32x at TP 1-4
    expect(claimNumber('phys.finding.nvfp4-tpot-gain')).toBe(1.32)
  })
})
