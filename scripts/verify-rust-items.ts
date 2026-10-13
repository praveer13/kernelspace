/**
 * verify-rust-items — the compile-bank checks of docs/specs/wave-2.md §15.2 (fast gate, no rustc).
 *
 * Over every group of src/data/rust-items (snippets/<group>.ts and bank/<group>.json):
 *   - the schema: ids, KCs (only those whose `gen` lists `compile`, never `r.permissions`), 2-5 variants
 *     of one-line edits, outcomes from the shared code table, a why everywhere, the permission labelling
 *     rule (PERMISSION_CODES; the label is one of `focus.needs`), 3-4 fixes with exactly one `ok`, and
 *     the clone-lure rule (a fix that adds `.clone()` is a `clone` lure and never `ok`);
 *   - the phone limits: every code a learner can see (base, variant, after a fix) is at most 16 lines
 *     of at most 44 columns, ASCII without tabs;
 *   - the bank: built by rustc 1.96.0 for edition 2024, a source hash per snippet that matches the
 *     snippet as it is now, and recorded results that match every authored outcome (an `ok` fix
 *     compiles; a wrong fix that compiles is a labelled lure);
 *   - the verdict quota: 20-30 % of verdict items have "compiles" as the key, and no family pool more
 *     than 30 % (the V1 lint fails a key that is strictly the longest option more often), so a fixed
 *     option set gives no cue;
 *   - at least 3 snippets per error code, the Error Museum's floor (§15.6): a failure since 2c-18 froze the bank.
 * scripts/build-rust-items.ts runs rustc and writes the banks; this script never does.
 *
 *   bun scripts/verify-rust-items.ts
 */

import { createHash } from 'node:crypto'
import { KCS } from '../src/data/kc'
import { addsClone, applyEdit, ERROR_CODES, loadRustGroups, MAX_COLS, MAX_LINES, PANIC_CODES, PERMISSION_CODES, variantCode } from '../src/data/rust-items'
import type { BankOutcome, BankSnippet, Outcome, Permission, RustGroup, RustSnippet, SnippetVariant } from '../src/data/rust-items/types'
import { KC } from '../src/data/kc/ids'
import { stableStringify } from '../src/lib/ledger/stable'
import { MIN_SNIPPETS_PER_CODE } from '../src/lib/rust/museum'

/** The labs' pin (labs.yml RUST_TOOLCHAIN): the bank is built by exactly this compiler. */
export const RUSTC_VERSION = '1.96.0'
export const EDITION = '2024'
export const VERDICT_QUOTA = { min: 0.2, max: 0.3 } as const
/** No KC pool of verdict items may have "compiles" as the key more often than this. */
export const VERDICT_POOL_MAX = 0.3
export { MIN_SNIPPETS_PER_CODE }
const ID = /^[a-z][a-z0-9-]*$/
const MISS = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
const BAD_TEXT = /\b(NaN|Infinity|undefined)\b/
const PERMISSIONS: readonly Permission[] = ['read', 'write', 'own']

/** The KCs a snippet may assess: those whose `gen` lists the compile family. */
export const COMPILE_KCS: readonly string[] = KCS.filter((k) => (k.gen ?? []).includes('compile')).map((k) => k.id)

/** sha256 of the snippet's canonical JSON: any change to code, outcomes, whys or fixes changes it. */
export function snippetHash(s: RustSnippet): string {
  return createHash('sha256').update(stableStringify(s)).digest('hex')
}

/** The code a fix leaves: the variant's code with the fix's line replaced. */
export const fixCode = (s: RustSnippet, v: SnippetVariant, fix: { edit: { line: number; text: string } }): string => applyEdit(variantCode(s, v), fix.edit)

/** Lines over the phone limits, or characters a phone font may not render at the same width. */
export function phoneProblems(code: string): string[] {
  const out: string[] = []
  const lines = code.split('\n')
  if (lines.length > MAX_LINES) out.push(`${lines.length} lines (max ${MAX_LINES})`)
  lines.forEach((l, i) => {
    if (l.length > MAX_COLS) out.push(`line ${i + 1} is ${l.length} columns (max ${MAX_COLS})`)
    if (/\t/.test(l)) out.push(`line ${i + 1} has a tab`)
    if (/[^\t\x20-\x7e]/.test(l)) out.push(`line ${i + 1} has a non-ASCII character`)
    if (/\s$/.test(l)) out.push(`line ${i + 1} has trailing whitespace`)
  })
  return out
}

const outcomeText = (o: Outcome | BankOutcome): string => (o === 'compiles' ? 'compiles' : `${o.code} at line ${o.line}`)

/** Whether a recorded result is the authored outcome (code and line; the message is rustc's own). */
export const sameOutcome = (want: Outcome, got: BankOutcome): boolean =>
  want === 'compiles' ? got === 'compiles' : got !== 'compiles' && got.code === want.code && got.line === want.line

/* ------------------------------ schema ------------------------------ */

function checkEdit(where: string, code: string, edit: { line: number; text: string }, bad: (m: string) => void): void {
  const lines = code.split('\n')
  if (!Number.isInteger(edit.line) || edit.line < 1 || edit.line > lines.length) return bad(`${where}: edit line ${edit.line} is outside 1..${lines.length}`)
  if (typeof edit.text !== 'string' || !edit.text.trim()) bad(`${where}: edit text is empty`)
  else if (edit.text.includes('\n')) bad(`${where}: edit text spans lines; an edit replaces one line`)
  else if (edit.text === lines[edit.line - 1]) bad(`${where}: edit leaves line ${edit.line} unchanged`)
}

function checkOutcome(where: string, s: RustSnippet, o: Outcome, lines: number, bad: (m: string) => void): void {
  if (o === 'compiles') return
  if (!o || typeof o !== 'object') return bad(`${where}: expect must be 'compiles' or {code, line}`)
  if (!(o.code in ERROR_CODES)) bad(`${where}: code ${o.code} is not in ERROR_CODES (src/data/rust-items/index.ts)`)
  if ((PANIC_CODES as readonly string[]).includes(o.code) && !s.run) bad(`${where}: ${o.code} is a run-time panic, so the snippet needs run: true`)
  if (!Number.isInteger(o.line) || o.line < 1 || o.line > lines) bad(`${where}: expected line ${o.line} is outside 1..${lines}`)
}

function checkText(where: string, text: string | undefined, bad: (m: string) => void): void {
  if (typeof text !== 'string' || !text.trim()) bad(`${where} is empty`)
  else if (BAD_TEXT.test(text)) bad(`${where} contains NaN, Infinity or undefined, which the generator lint rejects`)
}

/** Every schema, labelling and phone-limit problem of the snippets, as `group/snippet/variant: message`. */
export function checkSnippets(groups: readonly RustGroup[], compileKcs: readonly string[] = COMPILE_KCS): string[] {
  const out: string[] = []
  const seen = new Map<string, string>()
  for (const g of groups) {
    if (!ID.test(g.id)) out.push(`${g.id}: a group id is kebab-case`)
    if (g.snippets.length === 0) out.push(`${g.id}: snippets/${g.id}.ts exports no SNIPPETS`)
    for (const s of g.snippets) {
      const at = `${g.id}/${s.id}`
      const bad = (m: string) => out.push(m.startsWith(at) ? m : `${at}: ${m}`)
      if (!ID.test(s.id)) bad('the id is kebab-case')
      if (seen.has(s.id)) bad(`the id is also used in group ${seen.get(s.id)}`)
      seen.set(s.id, g.id)
      if (!Array.isArray(s.kcs) || s.kcs.length === 0) bad('kcs is empty')
      for (const k of s.kcs ?? []) {
        if (k === KC.permissions) bad(`${k} is assessed by permission items only; a snippet's kcs are what its verdict and fix items assess`)
        else if (!compileKcs.includes(k)) bad(`kc ${k} does not list the compile family in its gen`)
      }
      if (new Set(s.kcs).size !== s.kcs.length) bad('kcs repeat')
      checkText(`${at}: title`, s.title, bad)
      checkText(`${at}: domain`, s.domain, bad)
      if (typeof s.base !== 'string') {
        bad('base is not a string')
        continue
      }
      for (const p of phoneProblems(s.base)) bad(`base: ${p}`)
      if (s.run && !/\bfn main\(\)/.test(s.base)) bad('a run snippet needs fn main()')
      const lines = s.base.split('\n').length
      if (!Array.isArray(s.variants) || s.variants.length < 2 || s.variants.length > 5) bad(`has ${s.variants?.length ?? 0} variants (2 to 5)`)
      const vids = new Set<string>()
      const codes = new Map<string, string>()
      for (const v of s.variants ?? []) {
        const vat = `${at}/${v.id}`
        const vbad = (m: string) => out.push(`${vat}: ${m}`)
        if (!ID.test(v.id)) vbad('the id is kebab-case')
        if (vids.has(v.id)) vbad('the id repeats')
        vids.add(v.id)
        if (v.edit) checkEdit(vat, s.base, v.edit, (m) => out.push(m))
        else if (v.id !== 'base') vbad("a variant without an edit is the base code, and its id is 'base'")
        let code: string
        try {
          code = variantCode(s, v)
        } catch (e) {
          vbad(e instanceof Error ? e.message : String(e))
          continue
        }
        if (codes.has(code)) vbad(`its code is the same as variant ${codes.get(code)}'s`)
        codes.set(code, v.id)
        for (const p of phoneProblems(code)) vbad(p)
        checkOutcome(vat, s, v.expect, lines, (m) => out.push(m))
        checkText(`${vat}: why`, v.why, (m) => out.push(m))
        const codeLines = code.split('\n')
        if (v.focus) {
          const f = v.focus
          if (!Number.isInteger(f.line) || f.line < 1 || f.line > lines) vbad(`focus line ${f.line} is outside 1..${lines}`)
          else if (!f.path || !codeLines[f.line - 1].includes(f.path)) vbad(`focus path \`${f.path}\` does not appear on line ${f.line}`)
          if (!Array.isArray(f.needs) || f.needs.length === 0 || f.needs.some((p) => !PERMISSIONS.includes(p)) || new Set(f.needs).size !== f.needs.length) {
            vbad('focus.needs lists one or more of read, write, own, once each')
          }
        }
        if (v.permission !== undefined) {
          if (!PERMISSIONS.includes(v.permission)) vbad(`permission ${v.permission} is not read, write or own`)
          if (!v.focus) vbad('a permission label needs a focus')
          else if (!v.focus.needs?.includes(v.permission)) vbad(`permission ${v.permission} is not among what line ${v.focus.line} needs (${v.focus.needs?.join(', ')})`)
          if (v.expect === 'compiles') vbad('a variant that compiles lacks no permission')
          else {
            const allowed = PERMISSION_CODES[v.expect.code]
            if (!allowed) vbad(`${v.expect.code} takes no permission label: its operation lacks no single permission (PERMISSION_CODES)`)
            else if (!allowed.includes(v.permission)) vbad(`${v.expect.code} labels ${allowed.join(' or ')}, not ${v.permission}`)
          }
        }
        if (v.fixes !== undefined) {
          if (v.expect === 'compiles') vbad('a variant that compiles has nothing to fix')
          if (v.fixes.length < 3 || v.fixes.length > 4) vbad(`has ${v.fixes.length} fixes (3 or 4)`)
          if (v.fixes.filter((f) => f.ok).length !== 1) vbad('exactly one fix is ok')
          const fids = new Set<string>()
          const texts = new Set<string>()
          for (const f of v.fixes) {
            const fat = `${vat}/fix ${f.id}`
            const fbad = (m: string) => out.push(`${fat}: ${m}`)
            if (!ID.test(f.id)) fbad('the id is kebab-case')
            if (fids.has(f.id)) fbad('the id repeats')
            fids.add(f.id)
            checkEdit(fat, code, f.edit, (m) => out.push(m))
            const option = `${f.edit.line}:${f.edit.text.trim()}`
            if (texts.has(option)) fbad('it reads the same as another fix')
            texts.add(option)
            checkText(`${fat}: why`, f.why, (m) => out.push(m))
            if (f.miss !== undefined && !MISS.test(f.miss)) fbad(`miss ${f.miss} is not a dotted misconception id`)
            if (f.lure !== undefined && f.ok) fbad('an ok fix is not a lure')
            const before = codeLines[f.edit.line - 1] ?? ''
            const clone = addsClone(before, f.edit.text)
            if (clone && f.ok) fbad('adds .clone(), so it is the clone lure, never the ok fix (a handle clone is written Rc::clone(&x))')
            if (clone && !f.ok && f.lure !== 'clone') fbad("adds .clone(), so it is marked lure: 'clone'")
            if (f.lure === 'clone' && !clone) fbad("is marked lure: 'clone' but adds no .clone()")
            try {
              for (const p of phoneProblems(applyEdit(code, f.edit))) fbad(p)
            } catch {
              // reported by checkEdit
            }
          }
        }
      }
    }
  }
  return out
}

/* ------------------------------ bank ------------------------------ */

/** Problems of one snippet's recorded results against its authored outcomes and fixes. */
export function compareSnippet(s: RustSnippet, b: BankSnippet | undefined, at: string): string[] {
  if (!b) return [`${at}: not in the bank; run bun scripts/build-rust-items.ts`]
  const out: string[] = []
  if (b.hash !== snippetHash(s)) out.push(`${at}: the bank's source hash is stale (the snippet changed since it was built); run bun scripts/build-rust-items.ts`)
  for (const v of s.variants) {
    const r = b.variants[v.id]
    const vat = `${at}/${v.id}`
    if (!r) {
      out.push(`${vat}: not in the bank`)
      continue
    }
    if (!sameOutcome(v.expect, r.result)) out.push(`${vat}: authored ${outcomeText(v.expect)}, rustc gives ${outcomeText(r.result)}`)
    for (const f of v.fixes ?? []) {
      const fr = r.fixes?.[f.id]
      const fat = `${vat}/fix ${f.id}`
      if (!fr) out.push(`${fat}: not in the bank`)
      else if (f.ok && fr !== 'compiles') out.push(`${fat}: the ok fix does not compile (${outcomeText(fr)})`)
      else if (!f.ok && fr === 'compiles' && !f.lure) out.push(`${fat}: rustc accepts this wrong fix, so it must be a labelled lure (clone or other) whose why says what it changes`)
    }
    for (const id of Object.keys(r.fixes ?? {})) if (!(v.fixes ?? []).some((f) => f.id === id)) out.push(`${vat}: the bank has a result for fix ${id}, which no longer exists`)
  }
  for (const id of Object.keys(b.variants)) if (!s.variants.some((v) => v.id === id)) out.push(`${at}: the bank has a result for variant ${id}, which no longer exists`)
  return out
}

/** The bank of each group against its snippets: compiler, edition, hashes and every result. */
export function checkBanks(groups: readonly RustGroup[]): string[] {
  const out: string[] = []
  for (const g of groups) {
    const b = g.bank
    if (!b) {
      out.push(`${g.id}: no bank/${g.id}.json; run bun scripts/build-rust-items.ts --group ${g.id}`)
      continue
    }
    if (b.group !== g.id) out.push(`bank/${g.id}.json: names group ${b.group}`)
    if (!b.rustc?.startsWith(`rustc ${RUSTC_VERSION} `)) out.push(`bank/${g.id}.json: built by "${b.rustc}", not rustc ${RUSTC_VERSION}`)
    if (b.edition !== EDITION) out.push(`bank/${g.id}.json: edition ${b.edition}, not ${EDITION}`)
    for (const s of g.snippets) out.push(...compareSnippet(s, b.snippets[s.id], `${g.id}/${s.id}`))
    for (const id of Object.keys(b.snippets)) if (!g.snippets.some((s) => s.id === id)) out.push(`bank/${g.id}.json: has snippet ${id}, which no longer exists`)
  }
  return out
}

/* ------------------------------ quotas ------------------------------ */

export interface Quota {
  /** verdict units (code variants) and how many have "compiles" as the key */
  units: number
  compiles: number
  /** per KC: the same, over the variants of the snippets that list it */
  pools: Record<string, { units: number; compiles: number }>
}

export function verdictQuota(groups: readonly RustGroup[]): Quota {
  const q: Quota = { units: 0, compiles: 0, pools: {} }
  for (const g of groups) {
    for (const s of g.snippets) {
      for (const v of s.variants) {
        const c = v.expect === 'compiles' ? 1 : 0
        q.units++
        q.compiles += c
        for (const k of s.kcs) {
          const p = (q.pools[k] ??= { units: 0, compiles: 0 })
          p.units++
          p.compiles += c
        }
      }
    }
  }
  return q
}

export function quotaProblems(q: Quota): string[] {
  const out: string[] = []
  if (q.units === 0) return ['the bank has no verdict items']
  const share = q.compiles / q.units
  if (share < VERDICT_QUOTA.min || share > VERDICT_QUOTA.max) {
    out.push(`verdict quota: ${(share * 100).toFixed(1)} % of ${q.units} verdict items have "compiles" as the key (want ${VERDICT_QUOTA.min * 100}-${VERDICT_QUOTA.max * 100} %, so a fixed option set gives no cue)`)
  }
  for (const [k, p] of Object.entries(q.pools)) {
    if (p.compiles / p.units > VERDICT_POOL_MAX) out.push(`verdict quota: ${p.compiles} of the ${p.units} verdict items on ${k} compile (max ${VERDICT_POOL_MAX * 100} %)`)
  }
  return out
}

/** Error codes the bank holds in fewer than `MIN_SNIPPETS_PER_CODE` snippets: the Error Museum shows one entry per code, and a code needs company to be worth one. */
export function codeProblems(groups: readonly RustGroup[]): string[] {
  const out: string[] = []
  for (const [code, ids] of [...codeCounts(groups)].sort()) {
    if (ids.size < MIN_SNIPPETS_PER_CODE) out.push(`${code} has ${ids.size} snippet(s); the frozen bank holds at least ${MIN_SNIPPETS_PER_CODE} per error code (§15.2, §15.6)`)
  }
  return out
}

/** error code → the snippets that expect it in some variant */
export function codeCounts(groups: readonly RustGroup[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const g of groups) {
    for (const s of g.snippets) {
      for (const v of s.variants) {
        if (v.expect === 'compiles') continue
        const set = out.get(v.expect.code) ?? new Set<string>()
        set.add(s.id)
        out.set(v.expect.code, set)
      }
    }
  }
  return out
}

/* ------------------------------ main ------------------------------ */

async function main(): Promise<void> {
  const groups = await loadRustGroups()
  const problems = [...checkSnippets(groups)]
  // a bank is only worth comparing once the snippets are sound
  if (problems.length === 0) problems.push(...checkBanks(groups))
  const q = verdictQuota(groups)
  problems.push(...quotaProblems(q))
  problems.push(...codeProblems(groups))
  const counts = codeCounts(groups)
  const snippets = groups.reduce((a, g) => a + g.snippets.length, 0)
  const variants = groups.reduce((a, g) => a + g.snippets.reduce((b, s) => b + s.variants.length, 0), 0)
  const labelled = groups.reduce((a, g) => a + g.snippets.reduce((b, s) => b + s.variants.filter((v) => v.permission).length, 0), 0)
  const fixed = groups.reduce((a, g) => a + g.snippets.reduce((b, s) => b + s.variants.filter((v) => v.fixes).length, 0), 0)
  for (const g of groups) console.log(`  ${g.id}: ${g.snippets.length} snippets, bank ${g.bank ? g.bank.rustc : 'missing'}`)
  console.log(`  ${snippets} snippets, ${variants} code variants (${labelled} with a permission label, ${fixed} with fixes), ${counts.size} error codes`)
  if (q.units > 0) console.log(`  verdict quota: ${q.compiles}/${q.units} = ${((q.compiles / q.units) * 100).toFixed(1)} % compile`)
  if (problems.length > 0) {
    for (const p of problems) console.error(p)
    console.error(`verify-rust-items: ${problems.length} problem(s) (docs/specs/wave-2.md §15.2)`)
    process.exit(1)
  }
  console.log(`verify-rust-items: ${groups.length} group(s), 0 problems`)
}

if (import.meta.main) await main()
