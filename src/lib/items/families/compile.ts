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
 * Loading (§22.1): this chunk holds only the manifest (src/data/rust-items/manifest.json, about 1 KB
 * gzip), which lists every unit the bank confirms with its outcome code, KCs and item kinds. That is all
 * the variants, the pools, the seeded draw and the verdict distractors need. The unit's code, whys and
 * fixes are in its group, one chunk per group loaded on first need (src/data/rust-items/groups.ts):
 * `make` stays synchronous, and when the group it draws from has not loaded it starts the load and
 * throws `NotReady`, which `settle` (src/lib/items/on-demand.ts) turns into a second run once the group
 * lands. Under Bun (scripts and tests) every group loads at module evaluation, so `make` never stops.
 * Items serve each variant's authored outcome, which verify-rust-items proves equal to rustc's; no source
 * hash, rustc version or rustc message reaches the app.
 *
 * 2c-18 froze the bank: the family's hash fixture (tests/fixtures/items/hashes/compile.json) pins its
 * output, so a change to a snippet, a group or this file's wording shows up as a drift to bump the version
 * for, as in every other family. Version 2 (CF1): the key's why no longer quotes rustc's message, which
 * stays with the bank files.
 *
 * `practiceInstance` serves the Error Museum (/errors): an item on one error code, drawn from the units
 * whose key is that code, built by the same functions `make` uses. It is not part of `make`, so the
 * fixture and the pools do not depend on it.
 */

import { KC } from '@/data/kc/ids'
import { CLONE_MISS, ERROR_CODES, PANIC_CODES, variantCode } from '@/data/rust-items/constants'
import { LAZY, loadGroups, servedGroup } from '@/data/rust-items/groups'
import manifest from '@/data/rust-items/manifest.json'
import type { Outcome, Permission, RustManifest, RustSnippet, ServedGroup, SnippetFix, SnippetVariant } from '@/data/rust-items/types'
import { finishInstance, resolveVariant, rngFor, type Rng } from '../core'
import { gradeResponse } from '../grade'
import type { ChoiceOption, Gen, Instance, Level, PromptPart, SolutionStep, VariantSpec } from '../types'

const ID = 'compile'
const VERSION = 2
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

const MANIFEST = manifest as unknown as RustManifest

/** A unit as the manifest lists it: enough to pool and draw it before its group loads. */
export interface UnitRef {
  group: string
  /** Snippet and variant positions within the group. */
  s: number
  v: number
  /** The key's outcome code, or 'compiles'. */
  outcome: string
  kcs: readonly string[]
  permission: boolean
  fixes: boolean
}

/** One code variant the bank has confirmed, with its group loaded. */
export interface Unit {
  /** `group/snippet/variant` */
  key: string
  snippet: RustSnippet
  variant: SnippetVariant
  code: string
  /** The authored outcome, which rustc confirmed. */
  result: Outcome
  /** fix id → what rustc did after it (variants with fixes only) */
  fixes: Record<string, Outcome>
}

const MANIFEST_VARIANT = /^(?<code>E\d{4}|[A-Za-z]+Error)?(?<label>p?)(?<fixes>f?)$/

/** The bank's groups, by id. */
export const GROUP_IDS: readonly string[] = Object.keys(MANIFEST.groups).sort()

/** Every unit the bank confirms, in bank order (groups by id, snippets and variants as authored). */
export const REFS: readonly UnitRef[] = GROUP_IDS.flatMap((group) =>
  MANIFEST.groups[group].flatMap(([kcs, variants], s) =>
    variants.flatMap((mv, v): UnitRef[] => {
      if (mv === null) return []
      const m = MANIFEST_VARIANT.exec(mv)?.groups
      if (!m) throw new Error(`manifest.json: ${group} snippet ${s} variant ${v} reads "${mv}"`)
      return [{ group, s, v, outcome: m.code ?? 'compiles', kcs, permission: m.label === 'p', fixes: m.fixes === 'f' }]
    }),
  ),
)

const parseAfter = (a: string): Outcome => {
  if (a === 'compiles') return a
  const at = a.lastIndexOf('@')
  return { code: a.slice(0, at), line: Number(a.slice(at + 1)) }
}

/** A loaded group's units, by `${s}/${v}`, built once per loaded group. */
const unitsOf = new WeakMap<ServedGroup, Map<string, Unit>>()

function unitIn(group: string, served: ServedGroup, s: number, v: number): Unit {
  let units = unitsOf.get(served)
  if (!units) unitsOf.set(served, (units = new Map()))
  const at = `${s}/${v}`
  let u = units.get(at)
  if (!u) {
    const snippet = served.SNIPPETS[s]
    const variant = snippet?.variants[v]
    if (!variant) throw new Error(`manifest.json lists ${group} snippet ${s} variant ${v}, which served/${group}.ts does not hold; run bun scripts/build-rust-items.ts --derived`)
    const after = served.AFTER[s]?.[v] ?? []
    const fixes: Record<string, Outcome> = {}
    variant.fixes?.forEach((f, i) => {
      if (after[i] !== undefined) fixes[f.id] = parseAfter(after[i])
    })
    u = { key: `${group}/${snippet.id}/${variant.id}`, snippet, variant, code: variantCode(snippet, variant), result: variant.expect, fixes }
    units.set(at, u)
  }
  return u
}

/** The unit behind a ref. Throws `NotReady` (after starting the load) when its group has not loaded. */
export const unitAt = (r: UnitRef): Unit => unitIn(r.group, servedGroup(r.group), r.s, r.v)

// Scripts and tests have every group in hand; the app loads each on first need.
if (!LAZY) await loadGroups(GROUP_IDS)

/** Every outcome code some unit has as its key: verdict distractors come only from these. */
const BANK_CODES: readonly string[] = [...new Set(REFS.flatMap((r) => (r.outcome === 'compiles' ? [] : [r.outcome])))].sort()

/** variant id → its pool, before the MIN_POOL cut. */
const RAW_POOLS = new Map<string, UnitRef[]>()
const addTo = (id: string, r: UnitRef) => {
  const pool = RAW_POOLS.get(id) ?? []
  pool.push(r)
  RAW_POOLS.set(id, pool)
}
for (const r of REFS) {
  for (const kc of r.kcs) {
    addTo(compileVariantId('verdict', kc), r)
    if (r.fixes) addTo(compileVariantId('fix', kc), r)
  }
  if (r.permission) addTo(compileVariantId('permission', KC.permissions), r)
}

const KIND_TITLE: Record<CompileKind, string> = { verdict: 'Which error does rustc report?', permission: 'Which permission is missing?', fix: 'Which fix keeps the behaviour?' }

const VARIANTS: VariantSpec[] = []
/** Declared variant id → its pool. */
export const POOLS = new Map<string, readonly UnitRef[]>()
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
function outcomeClause(o: Outcome, run: boolean): string {
  if (o === 'compiles') return run ? 'it compiles and runs to the end' : 'it compiles'
  return isPanic(o.code) ? `it compiles, then panics at line ${o.line} with ${o.code}` : `rustc reports ${o.code} at line ${o.line}`
}

/** A clause as a sentence; "rustc" keeps its lower case, as the tool spells it. */
const sentence = (s: string) => (s.startsWith('rustc ') ? s : s.charAt(0).toUpperCase() + s.slice(1))

/** The why of the key of a verdict item, and of the solution. */
function keyWhy(u: Unit): string {
  return `${sentence(outcomeClause(u.result, Boolean(u.snippet.run)))}. ${u.variant.why}`
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
  const r = u.result as Exclude<Outcome, 'compiles'>
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
  const u = unitAt(rng.pick(pool))
  const kind = kindOf(spec.id)
  const built = kind === 'verdict' ? makeVerdict(u, rng) : kind === 'permission' ? makePermission(u) : makeFix(u)
  return finishInstance(gen, { variant: spec.id, seed, level, kcs: [...spec.kcs], nsec: spec.nsec, ...built })
}

/**
 * The Error Museum's "practice this error" (§15.6): one item whose key is `code`, a pure function of
 * (code, seed). The unit is drawn from those the bank confirms with that outcome; the kind (verdict,
 * permission, fix) from what the unit supports; the variant is the pool of the unit's first KC that has
 * one, so the item is recorded under a KC it assesses. Undefined when the bank holds no unit for `code`.
 * The draw needs only the manifest, so only the drawn unit's group loads (`NotReady` until it has; the
 * museum runs this under `settle`).
 */
export function practiceInstance(code: string, seed: number): Instance | undefined {
  const level: Level = 2 // gen-literal-ok: the independent level
  const rng = rngFor(ID, `practice.${code}`, level, seed)
  const refs = REFS.filter((r) => r.outcome !== 'compiles' && r.outcome === code)
  const kindsOf = (r: UnitRef): CompileKind[] => ['verdict', ...(r.permission ? (['permission'] as const) : []), ...(r.fixes ? (['fix'] as const) : [])]
  const variantOf = (r: UnitRef, kind: CompileKind): string | undefined =>
    kind === 'permission' ? (POOLS.has('permission') ? 'permission' : undefined) : r.kcs.map((kc) => compileVariantId(kind, kc)).find((id) => POOLS.has(id))
  const options = refs.flatMap((r) => kindsOf(r).flatMap((kind) => (variantOf(r, kind) ? [{ r, kind, id: variantOf(r, kind)! }] : [])))
  if (options.length === 0) return undefined
  const { r, kind, id } = rng.pick(options)
  const u = unitAt(r)
  const spec = VARIANTS.find((v) => v.id === id)!
  const built = kind === 'verdict' ? makeVerdict(u, rng) : kind === 'permission' ? makePermission(u) : makeFix(u)
  return finishInstance(gen, { variant: id, seed, level, kcs: [...spec.kcs], nsec: spec.nsec, ...built })
}

/** The unit an instance was drawn from (its group must have loaded). */
export function unitOf(inst: Instance): Unit | undefined {
  const group = String(inst.params.unit).split('/')[0]
  const r = REFS.find((x) => x.group === group && unitAt(x).key === inst.params.unit)
  return r ? unitAt(r) : undefined
}

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
}

export default gen
