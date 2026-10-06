/**
 * `compile`: graded Rust on a phone, from the compile bank (docs/specs/wave-2.md §15.3; PLAN-100X F3a).
 *
 * Every item is a code variant of a bank snippet (src/data/rust-items) whose outcome rustc 1.96.0 has
 * confirmed (scripts/build-rust-items.ts). Three kinds of item:
 *   - verdict: which error rustc reports, or "compiles". Four options: the key, "compiles" (and, for a
 *     snippet that runs, its RefCell panic), and codes from the key's cluster that the bank holds, so
 *     every distractor is an error the learner meets elsewhere as a key. The codes all read alike
 *     (`E0502`), so the only surface difference is the "compiles" option, and the bank's verdict
 *     quota (about 25 % compile, verify-rust-items) keeps that from being a cue.
 *   - permission: which of Read, Write and Own the flagged path lacks at the flagged line (Crichton's
 *     model). The three options have the same length, words and punctuation.
 *   - fix: which one-line change makes it compile without changing what it does, among the variant's
 *     authored fixes; a `.clone()` pick is diagnosed as `r.clone-to-silence`.
 * Each why says what rustc (or the run) actually did, then the authored reason.
 *
 * Variants are per KC, `<kind>.<kc without "r.">` (`verdict.borrow-rules`, `fix.ownership-moves`), and
 * `permission` for `r.permissions`: Today and tickets choose a variant by the KC they serve and `make`
 * takes no KC, so a KC-specific pool is what keeps an item on its KC (§15.3: "a seeded code variant whose
 * KCs include the item's KC"). A pool is declared once it holds MIN_POOL units, so a KC the bank barely
 * covers is served by its other kinds rather than by one or two snippets. Every level serves the same
 * pool: a bank item has no worked form, and the staircase still tracks accuracy per (KC, family).
 *
 * The bank is loaded at module evaluation (top-level await; synchronous under Vite's eager glob), so
 * `make` stays synchronous. A unit whose recorded result does not match its authored outcome is never
 * served (verify-rust-items fails on one in the fast gate). The hash fixture is deferred until 2c-18
 * freezes the bank.
 */

import { KC } from '@/data/kc/ids'
import { CLONE_MISS, ERROR_CODES, loadRustGroups, PANIC_CODES, variantCode } from '@/data/rust-items'
import type { BankOutcome, Outcome, Permission, RustSnippet, SnippetFix, SnippetVariant } from '@/data/rust-items/types'
import { finishInstance, resolveVariant, rngFor, type Rng } from '../core'
import { gradeResponse } from '../grade'
import type { ChoiceOption, Gen, Instance, Level, PromptPart, SolutionStep, VariantSpec } from '../types'

const ID = 'compile'
const VERSION = 1
const L3: Level = 3 // gen-literal-ok: the transfer level index
const ALL_LEVELS: readonly Level[] = [0, 1, 2, L3]
const NSEC = { verdict: 30, permission: 30, fix: 45 } // gen-literal-ok: nominal seconds per kind
/** A (kind, KC) pool is served once it holds this many units. */
export const MIN_POOL = 4 // gen-literal-ok: smallest pool a variant draws from
/** Options of a verdict item (§15.3). */
const VERDICT_OPTIONS = 4 // gen-literal-ok: the key and three distractors

/** The KCs whose `gen` lists `compile` (verify-kc holds Gen.kcs and the graph to each other). */
export const COMPILE_KCS = [KC.ownershipMoves, 'r.clone-copy-drop', KC.permissions, KC.borrowRules, 'r.slices', KC.analyzerLimits, 'r.interior-mutability', 'r.lifetimes'] as const

export type CompileKind = 'verdict' | 'permission' | 'fix'

/** `verdict.borrow-rules`; `permission` for r.permissions, whose only kind it is. */
export function compileVariantId(kind: CompileKind, kc: string): string {
  return kind === 'permission' ? 'permission' : `${kind}.${kc.replace(/^r\./, '')}`
}

/* ------------------------------ the bank ------------------------------ */

/** One code variant the bank has confirmed. */
export interface Unit {
  /** `group/snippet/variant` */
  key: string
  snippet: RustSnippet
  variant: SnippetVariant
  code: string
  result: BankOutcome
  /** fix id → what rustc did after it (variants with fixes only) */
  fixes: Record<string, Outcome>
}

const sameOutcome = (want: Outcome, got: BankOutcome): boolean =>
  want === 'compiles' ? got === 'compiles' : got !== 'compiles' && got.code === want.code && got.line === want.line

const GROUPS = await loadRustGroups()

/** Every confirmed unit, and the keys of those left out because the bank disagrees with the snippet. */
export const UNITS: readonly Unit[] = []
export const STALE: readonly string[] = []
for (const g of GROUPS) {
  for (const s of g.snippets) {
    for (const v of s.variants) {
      const key = `${g.id}/${s.id}/${v.id}`
      const b = g.bank?.snippets[s.id]?.variants[v.id]
      const fixesOk = (v.fixes ?? []).every((f) => {
        const r = b?.fixes?.[f.id]
        return r !== undefined && (!f.ok || r === 'compiles')
      })
      if (!b || !sameOutcome(v.expect, b.result) || !fixesOk) {
        ;(STALE as string[]).push(key)
        continue
      }
      ;(UNITS as Unit[]).push({ key, snippet: s, variant: v, code: variantCode(s, v), result: b.result, fixes: b.fixes ?? {} })
    }
  }
}

/** Every outcome code some unit has as its key: verdict distractors come only from these. */
const BANK_CODES: readonly string[] = [...new Set(UNITS.flatMap((u) => (u.result === 'compiles' ? [] : [u.result.code])))].sort()

/** variant id → its pool, before the MIN_POOL cut. */
const RAW_POOLS = new Map<string, Unit[]>()
const addTo = (id: string, u: Unit) => {
  const pool = RAW_POOLS.get(id) ?? []
  pool.push(u)
  RAW_POOLS.set(id, pool)
}
for (const u of UNITS) {
  for (const kc of u.snippet.kcs) {
    addTo(compileVariantId('verdict', kc), u)
    if (u.variant.fixes) addTo(compileVariantId('fix', kc), u)
  }
  if (u.variant.permission) addTo(compileVariantId('permission', KC.permissions), u)
}

const KIND_TITLE: Record<CompileKind, string> = { verdict: 'Which error does rustc report?', permission: 'Which permission is missing?', fix: 'Which fix keeps the behaviour?' }

const VARIANTS: VariantSpec[] = []
/** Declared variant id → its pool. */
export const POOLS = new Map<string, readonly Unit[]>()
for (const kc of COMPILE_KCS) {
  for (const kind of ['verdict', 'permission', 'fix'] as const) {
    if ((kind === 'permission') !== (kc === KC.permissions)) continue
    const id = compileVariantId(kind, kc)
    const pool = RAW_POOLS.get(id) ?? []
    if (pool.length < MIN_POOL) continue
    POOLS.set(id, pool)
    const topic = kc.replace(/^r\./, '').replace(/-/g, ' ')
    VARIANTS.push({ id, title: kind === 'permission' ? KIND_TITLE[kind] : `${KIND_TITLE[kind]} (${topic})`, kcs: [kc], levels: ALL_LEVELS, nsec: NSEC[kind] })
  }
}

/* ------------------------------ wording ------------------------------ */

const isPanic = (code: string): boolean => (PANIC_CODES as readonly string[]).includes(code)
const COMPILES_TEXT = 'compiles with 0 errors'
const RUNS_TEXT = '0 errors, runs to the end'
const panicText = (code: string) => `0 errors, then ${code}`

/** What happened, as a clause: "rustc reports E0502 at line 5", "it compiles", "it panics at line 6 with BorrowMutError". */
function outcomeClause(o: Outcome | BankOutcome, run: boolean): string {
  if (o === 'compiles') return run ? 'it compiles and runs to the end' : 'it compiles'
  return isPanic(o.code) ? `it compiles, then panics at line ${o.line} with ${o.code}` : `rustc reports ${o.code} at line ${o.line}`
}

/** A clause as a sentence; "rustc" keeps its lower case, as the tool spells it. */
const sentence = (s: string) => (s.startsWith('rustc ') ? s : s.charAt(0).toUpperCase() + s.slice(1))

/** rustc's own words, when there are some. */
const quoted = (o: BankOutcome): string => (o === 'compiles' ? '' : `: "${o.message}"`)

/** The why of the key of a verdict item, and of the solution. */
function keyWhy(u: Unit): string {
  return `${sentence(outcomeClause(u.result, Boolean(u.snippet.run)))}${quoted(u.result)}. ${u.variant.why}`
}

/* ------------------------------ verdict ------------------------------ */

const optionText = (id: string, run: boolean): string => (id === 'compiles' ? (run ? RUNS_TEXT : COMPILES_TEXT) : isPanic(id) ? panicText(id) : id)

function verdictOptions(u: Unit, rng: Rng): string[] {
  const run = Boolean(u.snippet.run)
  const key = u.result === 'compiles' ? 'compiles' : u.result.code
  const panics = u.snippet.variants.flatMap((v) => (v.expect !== 'compiles' && isPanic(v.expect.code) ? [v.expect.code] : []))
  const anchors = run ? ['compiles', panics[0] ?? PANIC_CODES[0]] : ['compiles']
  const chosen = [...new Set([key, ...anchors])]
  // the key's cluster; for "compiles", the clusters of the errors the snippet's other variants hit
  const near = key === 'compiles' || isPanic(key) ? u.snippet.variants.flatMap((v) => (v.expect === 'compiles' ? [] : [v.expect.code])) : [key]
  const clusters = new Set(near.map((c) => ERROR_CODES[c]?.cluster))
  const codes = BANK_CODES.filter((c) => !isPanic(c) && !chosen.includes(c))
  const same = codes.filter((c) => clusters.has(ERROR_CODES[c]?.cluster))
  const other = codes.filter((c) => !clusters.has(ERROR_CODES[c]?.cluster))
  const need = VERDICT_OPTIONS - chosen.length
  const fromSame = rng.sample(same, Math.min(need, same.length))
  const fromOther = rng.sample(other, Math.min(need - fromSame.length, other.length))
  return [...chosen, ...fromSame, ...fromOther].sort()
}

function verdictWhy(u: Unit, id: string): string {
  const run = Boolean(u.snippet.run)
  const key = u.result === 'compiles' ? 'compiles' : u.result.code
  if (id === key) return keyWhy(u)
  const here = `${outcomeClause(u.result, run)}. ${u.variant.why}`
  if (id === 'compiles') return u.result !== 'compiles' && isPanic(u.result.code) ? `It compiles, but it does not run to the end: ${here}` : `It does not compile: ${here}`
  if (isPanic(id)) return u.result === 'compiles' ? `It never panics: ${here}` : `It never gets to run: ${here}`
  return `${id} is ${ERROR_CODES[id]?.means ?? 'another error'}. Here ${here}`
}

function makeVerdict(u: Unit, rng: Rng): Pick<Instance, 'prompt' | 'answer' | 'params'> {
  const run = Boolean(u.snippet.run)
  const ids = verdictOptions(u, rng)
  const key = u.result === 'compiles' ? 'compiles' : u.result.code
  const options: ChoiceOption[] = ids.map((id) => ({ id, text: optionText(id, run), why: verdictWhy(u, id) }))
  const ask = run ? 'Build and run this program. Which error does it hit, if any?' : 'Which error does rustc report for this code, if any?'
  return {
    params: { unit: u.key, options: ids.join(' ') },
    prompt: { stem: [{ t: 'text', text: `${ask} ` }, { t: 'code', code: u.code, lang: 'rust', lines: true }] },
    answer: { kind: 'choice', options, correct: [key] },
  }
}

/* ------------------------------ permission ------------------------------ */

const PERMISSIONS: readonly Permission[] = ['read', 'write', 'own']
/** Same length, words and punctuation, so no surface feature points at the key. */
const PERMISSION_TEXT: Record<Permission, string> = { read: 'Read: inspect it', write: 'Write: modify it', own: 'Own: transfer it' }
const PERMISSION_NAME: Record<Permission, string> = { read: 'Read (R)', write: 'Write (W)', own: 'Own (O)' }

const listOf = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

function permissionWhy(u: Unit, p: Permission): string {
  const f = u.variant.focus!
  const key = u.variant.permission!
  const why = u.variant.why
  if (p === key) return `\`${f.path}\` has lost ${PERMISSION_NAME[p]}, which line ${f.line} needs. ${why}`
  if (f.needs.includes(p)) return `\`${f.path}\` still holds ${PERMISSION_NAME[p]} at line ${f.line}; what it lacks is ${PERMISSION_NAME[key]}. ${why}`
  return `Line ${f.line} does not need ${PERMISSION_NAME[p]} of \`${f.path}\`: it needs ${listOf(f.needs.map((n) => PERMISSION_NAME[n]))}. ${why}`
}

function makePermission(u: Unit): Pick<Instance, 'prompt' | 'answer' | 'params'> {
  const f = u.variant.focus!
  const options: ChoiceOption[] = PERMISSIONS.map((p) => ({ id: p, text: PERMISSION_TEXT[p], why: permissionWhy(u, p) }))
  return {
    params: { unit: u.key },
    prompt: {
      stem: [
        { t: 'text', text: `Line ${f.line} needs a permission on \`${f.path}\` that the path does not hold there. Which one? ` },
        { t: 'code', code: u.code, lang: 'rust', lines: true, mark: f.line },
      ],
    },
    answer: { kind: 'choice', options, correct: [u.variant.permission!] },
  }
}

/* ------------------------------ fix ------------------------------ */

function fixWhy(u: Unit, f: SnippetFix): string {
  const r = u.fixes[f.id]
  const run = Boolean(u.snippet.run)
  if (f.ok) return `${run ? 'It compiles, runs to the end' : 'It compiles'} and keeps what the code does. ${f.why}`
  if (r === 'compiles') return `${run ? 'It runs' : 'rustc accepts it'}, but it changes what the code does. ${f.why}`
  return `It still fails: ${outcomeClause(r, run)}. ${f.why}`
}

function makeFix(u: Unit): Pick<Instance, 'prompt' | 'answer' | 'params'> {
  const fixes = u.variant.fixes!
  const r = u.result as Exclude<BankOutcome, 'compiles'>
  const ask = isPanic(r.code)
    ? `This panics with ${r.code} at run time. Which one-line change stops the panic without changing what it does? `
    : `rustc rejects this with ${r.code}. Which one-line change makes it compile without changing what it does? `
  const options: ChoiceOption[] = fixes.map((f) => {
    const miss = f.miss ?? (f.lure === 'clone' ? CLONE_MISS : undefined)
    return { id: f.id, text: `line ${f.edit.line}: ${f.edit.text.trim()}`, why: fixWhy(u, f), ...(miss && !f.ok ? { miss } : {}) }
  })
  return {
    params: { unit: u.key },
    prompt: { stem: [{ t: 'text', text: ask }, { t: 'code', code: u.code, lang: 'rust', lines: true }] },
    answer: { kind: 'choice', options, correct: [fixes.find((f) => f.ok)!.id] },
  }
}

/* ------------------------------ the family ------------------------------ */

const kindOf = (variant: string): CompileKind => variant.split('.')[0] as CompileKind

function make(seed: number, level: Level, variant?: string): Instance {
  const spec = resolveVariant(gen, seed, level, variant)
  const pool = POOLS.get(spec.id)!
  const rng = rngFor(ID, spec.id, level, seed)
  const u = rng.pick(pool)
  const kind = kindOf(spec.id)
  const built = kind === 'verdict' ? makeVerdict(u, rng) : kind === 'permission' ? makePermission(u) : makeFix(u)
  return finishInstance(gen, { variant: spec.id, seed, level, kcs: [...spec.kcs], nsec: spec.nsec, ...built })
}

/** The unit an instance was drawn from. */
export const unitOf = (inst: Instance): Unit | undefined => UNITS.find((u) => u.key === inst.params.unit)

function solution(inst: Instance): SolutionStep[] {
  const a = inst.answer
  const key = a.kind === 'choice' ? a.options.find((o) => a.correct.includes(o.id)) : undefined
  const text: PromptPart[] = [{ t: 'text', text: key ? `${key.text}. ${key.why}` : 'See the explanation.' }]
  return [{ text }]
}

const gen: Gen = {
  id: ID,
  version: VERSION,
  title: 'Compile bank: name the error, the missing permission and the fix',
  kcs: COMPILE_KCS,
  variants: VARIANTS,
  ratioRules: [],
  make,
  grade: (inst, response) => gradeResponse(inst, response, []),
  solution,
  pins: [],
  // a variant's distinct instances are bounded by its pool; the smallest pool is what every variant must cover
  bank: { units: Math.min(...[...POOLS.values()].map((p) => p.length)) },
  hashFixture: 'deferred',
}

export default gen
