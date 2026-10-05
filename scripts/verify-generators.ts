/**
 * verify-generators — the generator-family checks of docs/specs/wave-1.md §5.6 (fast gate, < 30 s).
 *
 * For every family, variant and level, over 1,000 seeds:
 *   - determinism: `make` twice gives deep equality, the instance survives a JSON round-trip, same rev;
 *   - validity: truth finite and > 0; no NaN, Infinity or undefined in rendered text; choice options
 *     distinct, at least 2, each with a why, the correct ids among them; and over a choice variant's
 *     seeds the correct option is strictly the longest in at most 30 % (the V1 lint);
 *   - self-consistency: `grade(inst, solution)` is ok with score 1; each applicable ratio rule's
 *     answer (truth × ρ) is not ok and carries that rule's diagnosis id; `grade` never throws on a
 *     response at ±1e9 × truth;
 *   - non-degeneracy: at least 50 % distinct truths per (variant, level); level-0 params are round;
 *   - pins: every `Pin` reproduces within its tolerance;
 *   - speed: p95 of `make` + `grade` under 1 ms.
 * It also lints each family's source (§5.4): a numeric literal outside `SYNTHETIC` and outside the
 * allow-list {0, 1, 2, 10, 100} fails, unless its line (or the line above) carries
 * `// gen-literal-ok: <reason>`; and compares 100-seed output hashes per family and variant with
 * tests/fixtures/items/hashes.json (§16.3). With no families in src/lib/items/families it passes.
 *
 * `bun test` runs the same checks at 100 seeds (tests/items/*.test.ts) through `checkFamily`.
 *
 *   bun scripts/verify-generators.ts [--seeds N] [--family a,b] [--update-hashes]
 *
 * `--update-hashes` rewrites the hash rows of the selected families (all, without --family) and
 * leaves every other family's rows alone, so each family task commits only its own.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import ts from 'typescript'
import { instanceRev, instanceText, partsText, seedFor } from '../src/lib/items/core'
import { correctResponse, diagnose, inTolerance, ruleRatio, SHARED_RULES } from '../src/lib/items/grade'
import { loadAllFamilies } from '../src/lib/items/registry'
import type { Gen, Instance, Level, Response, SolutionStep } from '../src/lib/items/types'
import { stableStringify } from '../src/lib/ledger/stable'
import { hash32 } from '../src/lib/rng'
import { CUE_STRATEGIES, MAX_HIT_OVER_CHANCE, oddOneOut, type CueQuestion } from './item-cues'

/* ------------------------------ constants ------------------------------ */

export const DEFAULT_SEEDS = 1000
export const HASH_SEEDS = 100
const SEED_BASE = 0x6b315f67
const HASH_SEED_BASE = 0x68617368
/** The V1 lint: at most this share of a choice variant's instances may have the key strictly longest. */
export const MAX_LONGEST_KEY = 0.3
export const MIN_DISTINCT_TRUTHS = 0.5
/** The blind-strategy gate samples each choice variant at every level over at least this many seeds, whatever a caller asks for. */
export const MIN_CUE_SEEDS = 200
export const MAX_P95_MS = 1
/** Samples before timing starts, so the JIT's first calls do not count. */
const WARMUP = 50
/** Messages kept per check before "and N more". */
const MAX_REPORTED = 3
const LITERAL_ALLOW = new Set([0, 1, 2, 10, 100])
const BAD_TEXT = /\b(NaN|Infinity|undefined)\b|\[object /
const CLAIM_REF = /^[^@\s]+@\d{4}-\d{2}-\d{2}$/
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HASH_FILE = path.join(ROOT, 'tests/fixtures/items/hashes.json')

/** The seeds a run uses: the two uint32 extremes first, then a fixed spread. */
export function genSeeds(n: number, base = SEED_BASE): number[] {
  const out = [0, 0xffffffff]
  for (let i = 0; out.length < n; i++) out.push(seedFor(base, i))
  return out.slice(0, n)
}

/* ------------------------------ problem collection ------------------------------ */

interface Report {
  problems: string[]
  warnings: string[]
}

/** Collects problems, keeping the first few per check so one systematic defect does not bury the rest. */
function collector() {
  const counts = new Map<string, number>()
  const problems: string[] = []
  const fail = (key: string, message: string) => {
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    if (n <= MAX_REPORTED) problems.push(message)
  }
  const finish = (): string[] => {
    for (const [key, n] of counts) if (n > MAX_REPORTED) problems.push(`${key}: and ${n - MAX_REPORTED} more`)
    return problems
  }
  return { fail, finish }
}

/* ------------------------------ one instance ------------------------------ */

/** Whether a number reads as round: at most two significant digits, or a power of two. */
export function isRound(n: number): boolean {
  if (!Number.isFinite(n)) return false
  const a = Math.abs(n)
  if (a === 0) return true
  if (Number.isInteger(a)) {
    let x = a
    while (x > 1 && x % 2 === 0) x /= 2
    if (x === 1) return true
  }
  const mantissa = String(a).split('e')[0].replace('.', '').replace(/^0+/, '').replace(/0+$/, '')
  return mantissa.length <= 2
}

/** The response a solution's final result gives: its last step with a `result`, or the correct option ids. */
export function responseFromSolution(inst: Instance, steps: readonly SolutionStep[]): Response | undefined {
  const a = inst.answer
  if (a.kind === 'choice') return { kind: 'choice', picks: [...a.correct] }
  const last = [...steps].reverse().find((s) => s.result)?.result
  if (!last) return undefined
  if (a.kind === 'numeric') return { kind: 'numeric', value: last.value, unit: last.unit ?? a.unit }
  return { kind: 'estimate', value: last.value }
}

/** Every response a hostile client could send; none may throw out of `grade`. */
function hostileResponses(inst: Instance): Response[] {
  const a = inst.answer
  if (a.kind === 'choice') {
    return [
      { kind: 'choice', picks: [] },
      { kind: 'choice', picks: ['__nope__'] },
      { kind: 'choice', picks: a.options.map((o) => o.id) },
      { kind: 'numeric', value: 1 },
    ]
  }
  const t = a.truth
  const vals = [t * 1e9, -t * 1e9, t / 1e9, -t, 0, Number.NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE]
  const out: Response[] = []
  for (const v of vals) {
    if (a.kind === 'numeric') out.push({ kind: 'numeric', value: v, unit: a.unit }, { kind: 'numeric', value: v, unit: 'furlongs' })
    else out.push({ kind: 'estimate', value: v }, { kind: 'estimate', value: t, lo: v, hi: v }, { kind: 'estimate', value: t, lo: t * 1e9, hi: t / 1e9 })
  }
  out.push({ kind: 'choice', picks: ['x'] })
  return out
}

/** Structural and answer-shape checks for one instance; returns problem texts (empty when sound). */
export function checkInstance(gen: Gen, inst: Instance, where: string): string[] {
  const out: string[] = []
  const bad = (m: string) => out.push(`${where}: ${m}`)
  if (inst.family !== gen.id) bad(`family is "${inst.family}", expected "${gen.id}"`)
  if (inst.version !== gen.version) bad(`version is ${inst.version}, expected ${gen.version}`)
  const spec = gen.variants.find((v) => v.id === inst.variant)
  if (!spec) bad(`variant "${inst.variant}" is not declared`)
  else if (!spec.levels.includes(inst.level)) bad(`level ${inst.level} is not offered by variant ${inst.variant}`)
  if (!Number.isInteger(inst.seed) || inst.seed < 0 || inst.seed > 0xffffffff) bad(`seed ${inst.seed} is not a uint32`)
  if (inst.kcs.length === 0 || inst.kcs.some((k) => !gen.kcs.includes(k))) bad(`kcs ${JSON.stringify(inst.kcs)} are not within the family's kcs`)
  if (!Number.isFinite(inst.nsec) || inst.nsec <= 0) bad(`nsec ${inst.nsec} must be a positive number`)
  for (const [k, v] of Object.entries(inst.params)) {
    if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'string' && typeof v !== 'boolean') bad(`param ${k} is not a JSON-safe value`)
  }
  for (const c of inst.claims) if (!CLAIM_REF.test(c)) bad(`claim "${c}" is not id@YYYY-MM-DD`)
  if (new Set(inst.claims).size !== inst.claims.length || [...inst.claims].sort().join() !== inst.claims.join()) bad('claims must be unique and sorted')
  if (inst.rev !== instanceRev(inst)) bad(`rev ${inst.rev} does not match its fingerprint ${instanceRev(inst)}`)

  const a = inst.answer
  if (a.kind === 'numeric' || a.kind === 'estimate') {
    if (!Number.isFinite(a.truth) || !(a.truth > 0)) bad(`truth ${a.truth} must be finite and > 0`)
    if (!a.unit) bad('answer has no unit')
    if (a.kind === 'numeric' && !((a.tolerance.rel ?? 0) > 0 || (a.tolerance.abs ?? 0) > 0)) bad('numeric tolerance needs a positive rel or abs')
    if (a.kind === 'estimate' && !(a.okWithinFactor > 1)) bad(`okWithinFactor ${a.okWithinFactor} must be > 1`)
  } else {
    const ids = a.options.map((o) => o.id)
    const texts = a.options.map((o) => o.text.trim().toLowerCase())
    if (a.options.length < 2) bad(`choice has ${a.options.length} option(s), needs at least 2`)
    if (new Set(ids).size !== ids.length) bad('option ids are not distinct')
    if (new Set(texts).size !== texts.length) bad('option texts are not distinct')
    if (a.options.some((o) => !o.text.trim())) bad('an option has empty text')
    for (const o of a.options) if (!o.why || !o.why.trim()) bad(`option ${o.id} has no why`)
    if (a.correct.length === 0 || a.correct.some((c) => !ids.includes(c))) bad('correct ids are not among the options')
    if (new Set(a.correct).size !== a.correct.length) bad('correct ids repeat')
    if (!a.multi && a.correct.length !== 1) bad('a single-answer item must have exactly one correct id')
  }
  return out
}

/* ------------------------------ one family ------------------------------ */

export interface CheckOptions {
  /** Seeds per (variant, level); the spec's gate runs 1,000, `bun test` 100. */
  seeds?: number
  /** Time make + grade (default true). */
  speed?: boolean
  /** Run the blind-strategy gate on choice variants (default true); it samples at least MIN_CUE_SEEDS seeds. */
  cues?: boolean
}

export interface CheckResult extends Report {
  instances: number
  /** p95 of make + grade in milliseconds (NaN when untimed). */
  p95Ms: number
  /** Blind-strategy rows of the choice variants (empty when `cues` is off or the family has none). */
  cues: CueRow[]
}

const percentile = (xs: number[], p: number): number => {
  const s = xs.slice().sort((a, b) => a - b)
  return s.length === 0 ? Number.NaN : s[Math.min(s.length - 1, Math.floor(p * s.length))]
}

/** Runs every §5.6 check on one family. Never throws: a throwing `make` is a problem like any other. */
export function checkFamily(gen: Gen, opts: CheckOptions = {}): CheckResult {
  const seeds = genSeeds(opts.seeds ?? DEFAULT_SEEDS)
  const { fail, finish } = collector()
  const warnings: string[] = []
  const timings: number[] = []
  const firedRules = new Set<string>()
  let instances = 0
  const head = (v: string, l: number, s?: number) => `${gen.id}/${v}@L${l}${s === undefined ? '' : ` seed ${s}`}`

  if (gen.variants.length === 0) fail('variants', `${gen.id}: declares no variants`)
  const spanned = new Set(gen.variants.flatMap((v) => v.kcs))
  for (const k of gen.kcs) if (!spanned.has(k)) fail('kcs', `${gen.id}: kc ${k} is in the family's kcs but no variant assesses it`)
  for (const v of gen.variants) for (const k of v.kcs) if (!gen.kcs.includes(k)) fail('kcs', `${gen.id}/${v.id}: kc ${k} is missing from the family's kcs`)
  const ruleIds = new Set<string>()
  for (const r of gen.ratioRules) {
    if (ruleIds.has(r.id)) fail('rules', `${gen.id}: ratio rule id ${r.id} is declared twice`)
    ruleIds.add(r.id)
    if (!r.id.startsWith(`${gen.id}.`)) fail('rules', `${gen.id}: ratio rule id ${r.id} must start with "${gen.id}."`)
  }
  const grade = (inst: Instance, r: Response) => gen.grade(inst, r)

  const longestKey = new Map<string, { n: number; longest: number }>()
  for (const spec of gen.variants) {
    for (const level of spec.levels) {
      const truths = new Set<string>()
      let n = 0
      for (const seed of seeds) {
        const where = head(spec.id, level, seed)
        let inst: Instance
        try {
          inst = gen.make(seed, level, spec.id)
          const again = gen.make(seed, level, spec.id)
          if (!isDeepStrictEqual(inst, again)) fail(`determinism ${spec.id}@L${level}`, `${where}: make twice gives different instances`)
          if (!isDeepStrictEqual(JSON.parse(JSON.stringify(inst)), inst)) fail(`json ${spec.id}@L${level}`, `${where}: the instance does not survive a JSON round-trip`)
          if (again.rev !== inst.rev) fail(`rev ${spec.id}@L${level}`, `${where}: rev differs between runs`)
        } catch (e) {
          fail(`make ${spec.id}@L${level}`, `${where}: make threw ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        instances++
        n++
        for (const m of checkInstance(gen, inst, where)) fail(`shape ${spec.id}@L${level}`, m)
        if (inst.variant !== spec.id || inst.level !== level || inst.seed !== seed) fail(`echo ${spec.id}@L${level}`, `${where}: instance carries variant ${inst.variant}, level ${inst.level}, seed ${inst.seed}`)

        let steps: SolutionStep[] = []
        try {
          steps = gen.solution(inst)
          if (steps.length === 0) fail(`solution ${spec.id}@L${level}`, `${where}: solution is empty`)
          const text = [...instanceText(inst, steps), ...gen.ratioRules.map((r) => (typeof r.message === 'function' ? r.message(inst) : r.message))]
          const flagged = text.find((t) => BAD_TEXT.test(t))
          if (flagged !== undefined) fail(`text ${spec.id}@L${level}`, `${where}: rendered text contains NaN, Infinity or undefined: "${flagged.slice(0, 80)}"`)
        } catch (e) {
          fail(`solution ${spec.id}@L${level}`, `${where}: solution or text threw ${e instanceof Error ? e.message : String(e)}`)
        }

        try {
          const viaSteps = responseFromSolution(inst, steps)
          if (!viaSteps) fail(`solution ${spec.id}@L${level}`, `${where}: no solution step carries a result`)
          else {
            const g = grade(inst, viaSteps)
            if (!g.ok || g.score !== 1) fail(`self ${spec.id}@L${level}`, `${where}: the solution's own result grades ok=${g.ok} score=${g.score}`)
          }
          const g = grade(inst, correctResponse(inst))
          if (!g.ok || g.score !== 1) fail(`self ${spec.id}@L${level}`, `${where}: the true answer grades ok=${g.ok} score=${g.score}`)
          if (g.score < 0 || g.score > 1) fail(`score ${spec.id}@L${level}`, `${where}: score ${g.score} is outside [0, 1]`)

          const a = inst.answer
          if (a.kind !== 'choice') {
            // a right answer is never a slip: no rule may claim a ratio of exactly 1
            if (diagnose(inst, 1, gen.ratioRules)) fail(`rule1 ${spec.id}@L${level}`, `${where}: a ratio of exactly 1 is diagnosed as a slip`)
            for (const r of [...gen.ratioRules, ...SHARED_RULES]) {
              const rho = ruleRatio(r, inst)
              if (rho === null) continue
              const resp: Response = a.kind === 'numeric' ? { kind: 'numeric', value: a.truth * rho, unit: a.unit } : { kind: 'estimate', value: a.truth * rho }
              const got = grade(inst, resp)
              // within tolerance the slip cannot be told from a right answer, so there is nothing to diagnose
              if (got.ok) continue
              // rules are tried in order, so an earlier rule that claims the same ratio (GQA group 2 against
              // FP8) legitimately wins: the answer must carry the diagnosis of the first rule that matches
              const expected = diagnose(inst, rho, gen.ratioRules)?.id
              const id = got.diagnosis?.id
              if (id !== expected || expected === undefined) fail(`rule ${r.id}`, `${where}: rule ${r.id} (ρ=${rho}) answered ${a.truth * rho}, diagnosis was ${id ?? 'none'}, expected ${expected ?? r.id}`)
              if (id === r.id) firedRules.add(r.id)
            }
          }
          if (seed === seeds[0] || seed === seeds[1] || n % 10 === 0) {
            for (const h of hostileResponses(inst)) {
              const hg = grade(inst, h)
              if (!(hg.score >= 0 && hg.score <= 1) || typeof hg.ok !== 'boolean' || typeof hg.feedback !== 'string') {
                fail(`hostile ${spec.id}@L${level}`, `${where}: hostile response ${JSON.stringify(h)} graded to a malformed result`)
              }
            }
          }
        } catch (e) {
          fail(`grade ${spec.id}@L${level}`, `${where}: grade threw ${e instanceof Error ? e.message : String(e)}`)
        }

        const a = inst.answer
        if (a.kind === 'choice') {
          const lens = a.options.map((o) => o.text.length)
          const max = Math.max(...lens)
          const top = a.options.filter((o) => o.text.length === max)
          const rec = longestKey.get(spec.id) ?? { n: 0, longest: 0 }
          rec.n++
          if (top.length === 1 && a.correct.includes(top[0].id)) rec.longest++
          longestKey.set(spec.id, rec)
          // a choice has no truth: its fingerprint stands in, so the instances must still vary
          truths.add(inst.rev)
        } else {
          truths.add(String(a.truth))
        }
        if (level === 0) {
          for (const [k, v] of Object.entries(inst.params)) {
            if (typeof v === 'number' && !isRound(v)) fail(`round ${spec.id}`, `${where}: level-0 param ${k}=${v} is not a round number`)
          }
        }
      }
      if (n > 0 && truths.size / n < MIN_DISTINCT_TRUTHS) {
        fail(`distinct ${spec.id}@L${level}`, `${head(spec.id, level)}: ${truths.size} distinct truths in ${n} seeds (< ${MIN_DISTINCT_TRUTHS * 100} %)`)
      }
    }
  }
  for (const [variant, { n, longest }] of longestKey) {
    if (longest / n > MAX_LONGEST_KEY) fail(`longest ${variant}`, `${gen.id}/${variant}: the key is strictly the longest option in ${((longest / n) * 100).toFixed(1)} % of ${n} instances (max ${MAX_LONGEST_KEY * 100} %)`)
  }

  for (const r of gen.ratioRules) {
    if (!firedRules.has(r.id)) warnings.push(`${gen.id}: ratio rule ${r.id} never fired over ${seeds.length} seeds (dead or never applicable?)`)
  }

  for (const pin of gen.pins) {
    try {
      const inst = pin.make()
      for (const m of checkInstance(gen, inst, `${gen.id} pin "${pin.name}"`)) fail('pin', m)
      if (!pin.name || !pin.source) fail('pin', `${gen.id}: a pin needs a name and a source`)
      if (inst.answer.kind === 'choice') fail('pin', `${gen.id} pin "${pin.name}": pins must be numeric or estimate answers`)
      else if (!inTolerance(inst.answer.truth, pin.truth, pin.tolerance ?? { rel: 1e-9 })) {
        fail('pin', `${gen.id} pin "${pin.name}" (${pin.source}): truth ${inst.answer.truth}, the lesson says ${pin.truth}`)
      }
    } catch (e) {
      fail('pin', `${gen.id} pin "${pin.name}": threw ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  let p95Ms = Number.NaN
  if (opts.speed !== false) {
    // p95 of make + grade per call, over every (variant, level), after a warm-up
    for (const spec of gen.variants) {
      for (const level of spec.levels) {
        for (let i = 0; i < seeds.length + WARMUP; i++) {
          const seed = seeds[i % seeds.length]
          try {
            const t0 = performance.now()
            const inst = gen.make(seed, level, spec.id)
            grade(inst, correctResponse(inst))
            const dt = performance.now() - t0
            if (i >= WARMUP) timings.push(dt)
          } catch {
            break // already reported above
          }
        }
      }
    }
    p95Ms = percentile(timings, 0.95)
    if (p95Ms >= MAX_P95_MS) fail('speed', `${gen.id}: p95 of make + grade is ${p95Ms.toFixed(3)} ms (max ${MAX_P95_MS} ms)`)
  }

  const problems = finish()
  let cues: CueRow[] = []
  if (opts.cues !== false) {
    const c = checkChoiceCues(gen, { seeds: seeds.length })
    problems.push(...c.problems)
    cues = c.rows
  }
  return { problems, warnings, instances, p95Ms, cues }
}

/* ------------------------------ blind strategies (Wave 1a item rules) ------------------------------ */

export interface CueRow {
  /** `family/variant`, with `@L<n>` for one level and none for all levels together. */
  where: string
  instances: number
  chance: number
  /** The strategy with the highest hit rate in this row. */
  worst: { name: string; hit: number }
}

export interface CueResult {
  problems: string[]
  rows: CueRow[]
}

/** What a blind strategy sees of an instance: the stem and givens, the option texts, the key's index. */
export function cueQuestion(inst: Instance): CueQuestion | undefined {
  const a = inst.answer
  if (a.kind !== 'choice') return undefined
  const givens = (inst.prompt.givens ?? []).map((g) => partsText([g.value])).join(' ')
  return { q: `${partsText(inst.prompt.stem)} ${givens}`, options: a.options.map((o) => o.text), correct: a.correct.map((id) => a.options.findIndex((o) => o.id === id)) }
}

/**
 * The Wave 1a item-level rules (scripts/item-cues.ts, the code scripts/verify-items.ts runs over lesson
 * quizzes) applied to every choice variant of a family, over at least MIN_CUE_SEEDS seeds at every level:
 *   - each strategy of length rank, lexical cue and surface feature (stem overlap included) hits the key
 *     at most chance + 15 points, judged per (variant, level) and per variant over all its levels;
 *   - no binary feature isolates the key: it is never the only option with, or without, the feature.
 * Numeric and estimate variants have no options and are skipped. Never throws.
 */
export function checkChoiceCues(gen: Gen, opts: { seeds?: number } = {}): CueResult {
  const seeds = genSeeds(Math.max(opts.seeds ?? DEFAULT_SEEDS, MIN_CUE_SEEDS))
  const { fail, finish } = collector()
  const rows: CueRow[] = []
  const judge = (where: string, qs: CueQuestion[], oddSeen: Map<string, number>) => {
    const single = qs.filter((q) => q.correct.length === 1)
    if (single.length === 0) return
    const chance = single.reduce((a, q) => a + 1 / q.options.length, 0) / single.length
    let worst = { name: '', hit: -1 }
    const over: string[] = []
    for (const s of CUE_STRATEGIES) {
      const hit = single.reduce((a, q) => a + s.pick(q), 0) / single.length
      if (hit > worst.hit) worst = { name: s.name, hit }
      if (hit > chance + MAX_HIT_OVER_CHANCE) over.push(`'${s.name}' ${(hit * 100).toFixed(1)} %`)
    }
    if (over.length > 0) {
      const limit = ((chance + MAX_HIT_OVER_CHANCE) * 100).toFixed(1)
      fail(`cue ${where}`, `${where}: ${over.length} blind strateg${over.length === 1 ? 'y hits' : 'ies hit'} the key above chance ${(chance * 100).toFixed(1)} % + ${MAX_HIT_OVER_CHANCE * 100} points = ${limit} % over ${single.length} instances: ${over.join(', ')}; rewrite the options so no surface feature separates the key`)
    }
    rows.push({ where, instances: single.length, chance, worst })
    for (const [message, n] of oddSeen) fail(`odd ${where} ${message}`, `${where}: ${message} in ${n} of ${qs.length} instances; no binary feature may isolate the key`)
  }
  for (const spec of gen.variants) {
    const pooled: CueQuestion[] = []
    for (const level of spec.levels) {
      const qs: CueQuestion[] = []
      const odd = new Map<string, number>()
      for (const seed of seeds) {
        try {
          const q = cueQuestion(gen.make(seed, level, spec.id))
          if (!q) break
          qs.push(q)
          for (const m of oddOneOut(q)) odd.set(m, (odd.get(m) ?? 0) + 1)
        } catch {
          break // reported by checkFamily
        }
      }
      if (qs.length === 0) break
      pooled.push(...qs)
      judge(`${gen.id}/${spec.id}@L${level}`, qs, odd)
    }
    // the per-level odd-one-out is already reported above, so the pooled row judges only the rates
    if (pooled.length > 0 && spec.levels.length > 1) judge(`${gen.id}/${spec.id}`, pooled, new Map())
  }
  return { problems: finish(), rows }
}

/* ------------------------------ hash fixture (§16.3) ------------------------------ */

/** family → variant → hash of the output for HASH_SEEDS seeds at every level the variant offers. */
export type HashRows = Record<string, Record<string, string>>

export function hashFamily(gen: Gen): Record<string, string> {
  const seeds = genSeeds(HASH_SEEDS, HASH_SEED_BASE)
  const out: Record<string, string> = {}
  for (const spec of gen.variants) {
    const all: Instance[] = []
    for (const level of spec.levels) for (const seed of seeds) all.push(gen.make(seed, level as Level, spec.id))
    out[spec.id] = hash32(stableStringify(all)).toString(16).padStart(8, '0')
  }
  return out
}

/** Differences between a family's current hashes and its fixture rows. */
export function checkHashes(gen: Gen, fixture: HashRows): string[] {
  const rows = fixture[gen.id]
  const now = hashFamily(gen)
  const hint = `regenerate with: bun scripts/verify-generators.ts --update-hashes --family ${gen.id}`
  if (!rows) return [`${gen.id}: no rows in tests/fixtures/items/hashes.json (${hint})`]
  const out: string[] = []
  for (const [variant, h] of Object.entries(now)) {
    if (rows[variant] === undefined) out.push(`${gen.id}/${variant}: no hash row (${hint})`)
    else if (rows[variant] !== h) out.push(`${gen.id}/${variant}: output drifted from the fixture (${rows[variant]} → ${h}); a deliberate change bumps the family's version (${hint})`)
  }
  for (const variant of Object.keys(rows)) if (!(variant in now)) out.push(`${gen.id}/${variant}: fixture row for a variant that no longer exists (${hint})`)
  return out
}

/* ------------------------------ literal lint (§5.4) ------------------------------ */

export interface LiteralFinding {
  line: number
  col: number
  message: string
}

/** Numeric literals in a family source that are neither synthetic, allow-listed nor annotated. */
export function lintLiterals(fileName: string, text: string): LiteralFinding[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const lines = text.split('\n')
  const annotated = (line: number): boolean => {
    const here = /gen-literal-ok:\s*\S/.test(lines[line] ?? '')
    const above = /^\s*\/\/\s*gen-literal-ok:\s*\S/.test(lines[line - 1] ?? '')
    return here || above
  }
  const found: LiteralFinding[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isNumericLiteral(node)) {
      let p: ts.Node | undefined = node.parent
      let exempt = false
      while (p) {
        if (ts.isLiteralTypeNode(p)) exempt = true
        if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.name.text === 'SYNTHETIC') exempt = true
        p = p.parent
      }
      const value = Math.abs(Number(node.text.replace(/_/g, '')))
      const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      if (!exempt && !LITERAL_ALLOW.has(value) && !annotated(line)) {
        found.push({ line: line + 1, col: character + 1, message: `numeric literal ${node.text} outside SYNTHETIC, units.ts and {0, 1, 2, 10, 100}: move it, source it from claims, or add "// gen-literal-ok: <reason>"` })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** The lint must flag and pass what the spec says; a regression here would silently weaken the gate. */
export function literalSelfTest(): string[] {
  const cases: { name: string; src: string; expect: number }[] = [
    { name: 'allow-list', src: 'const a = [0, 1, 2, 10, 100, -1]', expect: 0 },
    { name: 'stray literal', src: 'const a = x * 4096', expect: 1 },
    { name: 'synthetic', src: 'const SYNTHETIC = { layers: 32, sizes: [4096, 8192] } as const', expect: 0 },
    { name: 'annotated same line', src: 'const a = x * 8 // gen-literal-ok: bits per byte', expect: 0 },
    { name: 'annotated line above', src: '// gen-literal-ok: bits per byte\nconst a = x * 8', expect: 0 },
    { name: 'annotation without reason', src: 'const a = x * 8 // gen-literal-ok:', expect: 1 },
    { name: 'literal type', src: 'type L = 3 | 4\nconst a: L = 1', expect: 0 },
    { name: 'underscores and hex', src: 'const a = 1_000 + 0xff', expect: 2 },
    { name: 'floats', src: 'const a = x * 0.5 + y / 1e3', expect: 2 },
    { name: 'in strings and comments', src: "// 4096\nconst s = '4096' + `${x}8192`", expect: 0 },
  ]
  const failures: string[] = []
  for (const c of cases) {
    const got = lintLiterals('selftest.ts', c.src).length
    if (got !== c.expect) failures.push(`literal lint self-test "${c.name}": expected ${c.expect} finding(s), got ${got}`)
  }
  return failures
}

/* ------------------------------ main ------------------------------ */

function readHashes(): HashRows {
  try {
    return JSON.parse(readFileSync(HASH_FILE, 'utf8')) as HashRows
  } catch {
    return {}
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const seeds = Number(flag('--seeds') ?? DEFAULT_SEEDS)
  if (!Number.isInteger(seeds) || seeds < 2) {
    console.error('verify-generators: --seeds must be an integer of at least 2')
    process.exit(1)
  }
  const only = flag('--family')?.split(',')
  const update = argv.includes('--update-hashes')

  const self = literalSelfTest()
  if (self.length > 0) {
    for (const f of self) console.error(f)
    console.error('verify-generators: the literal lint itself is broken')
    process.exit(1)
  }

  const t0 = performance.now()
  let families: Gen[]
  try {
    families = await loadAllFamilies()
  } catch (e) {
    console.error(`verify-generators: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
  const unknown = (only ?? []).filter((id) => !families.some((g) => g.id === id))
  if (unknown.length > 0) {
    console.error(`verify-generators: no such family: ${unknown.join(', ')}`)
    process.exit(1)
  }
  const chosen = families.filter((g) => !only || only.includes(g.id))

  if (update) {
    const rows = readHashes()
    for (const g of chosen) rows[g.id] = hashFamily(g)
    const sorted = Object.fromEntries(Object.keys(rows).sort().map((k) => [k, Object.fromEntries(Object.entries(rows[k]).sort(([a], [b]) => (a < b ? -1 : 1)))]))
    mkdirSync(path.dirname(HASH_FILE), { recursive: true })
    writeFileSync(HASH_FILE, `${JSON.stringify(sorted, null, 2)}\n`)
    console.log(`verify-generators: wrote hash rows for ${chosen.map((g) => g.id).join(', ') || 'no families'}`)
    return
  }

  const problems: string[] = []
  const warnings: string[] = []
  const hashes = readHashes()
  for (const g of chosen) {
    const r = checkFamily(g, { seeds })
    problems.push(...r.problems)
    warnings.push(...r.warnings)
    problems.push(...checkHashes(g, hashes))
    const file = path.join(ROOT, 'src/lib/items/families', `${g.id}.ts`)
    for (const f of lintLiterals(file, readFileSync(file, 'utf8'))) problems.push(`src/lib/items/families/${g.id}.ts:${f.line}:${f.col} ${f.message}`)
    console.log(`  ${g.id}: ${g.variants.length} variants, ${r.instances} instances, p95 ${Number.isNaN(r.p95Ms) ? 'n/a' : `${r.p95Ms.toFixed(3)} ms`}`)
    // one line per choice variant: its all-levels row, or its only level's
    const perVariant = new Map<string, CueRow>()
    for (const row of r.cues) if (!perVariant.has(row.where.split('@')[0]) || !row.where.includes('@')) perVariant.set(row.where.split('@')[0], row)
    for (const row of perVariant.values()) {
      console.log(`    ${row.where}: ${row.instances} instances, worst blind strategy '${row.worst.name}' ${(row.worst.hit * 100).toFixed(1)} % against chance ${(row.chance * 100).toFixed(1)} %`)
    }
  }
  if (!only) for (const id of Object.keys(hashes)) if (!families.some((g) => g.id === id)) problems.push(`tests/fixtures/items/hashes.json: rows for family "${id}" that does not exist`)

  for (const w of warnings) console.warn(`warning: ${w}`)
  const secs = ((performance.now() - t0) / 1000).toFixed(1)
  if (problems.length > 0) {
    for (const p of problems) console.error(p)
    console.error(`verify-generators: ${problems.length} problem(s) in ${chosen.length} family(ies) at ${seeds} seeds (docs/specs/wave-1.md §5.6)`)
    process.exit(1)
  }
  console.log(`verify-generators: ${chosen.length} family(ies) at ${seeds} seeds, 0 problems (${secs} s)`)
}

if (import.meta.main) await main()
