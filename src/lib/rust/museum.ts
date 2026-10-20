/**
 * The Error Museum's model (docs/specs/wave-2.md §15.6): one entry per error code the compile bank
 * holds, each built from a code variant the bank confirms.
 *
 * An entry shows the shortest confirmed variant that has a real fix, a permission label (where the code
 * has one) and a `.clone()` wrong fix (where the code has one), so the museum teaches the same lesson the
 * lessons do: read the error as a missing permission, and a clone that silences the checker copies.
 * The choice is a pure function of the bank, so scripts/aquascope/extract.ts (which draws each entry's
 * permission diagram into src/data/aquascope/errors.json) and the page agree on which code to draw; the
 * diagram is hash-checked against that code like a lesson's (tests/rust/museum.test.ts), so a change to
 * the bank that moves a pick fails there until the trace is extracted again.
 *
 * The page does not run this: scripts/build-rust-items.ts writes `museumEntries` over the banks into
 * src/data/rust-items/museum.json (21 exhibits, a few KB), which /errors renders without loading a group
 * of the bank, and verify:rust-items fails when that file is stale. This module imports only the bank's
 * light tables, so the page can share its types and lesson titles without pulling any snippet in.
 *
 * Pure: no DOM, no clock, no randomness.
 */

import { ERROR_CODES, isReadingSnippet, PANIC_CODES, PERMISSION_CODES, type CodeCluster } from '@/data/rust-items/constants'
import type { BankUnit, Permission, SnippetFocus } from '@/data/rust-items/types'

type Unit = BankUnit

/** The least snippets the final bank holds per error code (§15.2; a failure since 2c-18 froze the bank). */
export const MIN_SNIPPETS_PER_CODE = 3

/** The entries the spec names first (computing-education.md:184-186), in this order; the rest follow by code. */
export const CORE_CODES = ['E0382', 'E0499', 'E0502', 'E0505', 'E0506', 'E0597', 'E0716', 'BorrowMutError'] as const

/**
 * The R lessons that teach each code. The cluster's lesson is always there (moves: R3, borrows: R4,
 * lifetimes and closures: R9, cells: R8); the table adds the lessons that name the code or teach the
 * rule behind it. tests/rust/museum.test.ts fails when a lesson's text names a code it does not list.
 */
export const TAUGHT_IN: Readonly<Record<string, readonly string[]>> = {
  BorrowError: ['r.l8'],
  BorrowMutError: ['r.l8'],
  E0106: ['r.l9'],
  E0373: ['r.l9'],
  E0381: ['r.l1'],
  E0382: ['r.l3'],
  E0384: ['r.l1'],
  E0499: ['r.l3', 'r.l4'],
  E0502: ['r.l3', 'r.l4', 'r.l8', 'r.l9'],
  E0503: ['r.l4'],
  E0505: ['r.l3'],
  E0506: ['r.l4'],
  E0507: ['r.l3'],
  E0508: ['r.l3'],
  E0509: ['r.l3'],
  E0515: ['r.l9'],
  E0521: ['r.l9'],
  E0594: ['r.l4'],
  E0596: ['r.l3', 'r.l4'],
  E0597: ['r.l9'],
  E0716: ['r.l9'],
}

/** The titles of the lessons `TAUGHT_IN` names, so the page links them without loading any lesson (a test holds them to the lessons). */
export const LESSON_TITLES: Readonly<Record<string, string>> = {
  'r.l1': 'Bindings, Types & Expressions',
  'r.l3': 'Ownership, Moves, Clones & Drops',
  'r.l4': 'Borrowing, References & Slices',
  'r.l8': 'Interior Mutability: Cell, RefCell & Mutex',
  'r.l9': 'Practical Lifetimes',
}

/** A candidate fix as the museum shows it. */
export interface MuseumFix {
  id: string
  line: number
  text: string
  /** What the bank recorded after this fix: 'compiles', or the error it still reports. */
  after: string
  why: string
}

export interface MuseumEntry {
  /** The error code: `E0502`, or `BorrowMutError` for the run-time panic. */
  code: string
  cluster: CodeCluster
  /** One clause on what the code means. */
  means: string
  /** A run-time panic, not a compile error. */
  panic: boolean
  /** `group/snippet/variant`: the code variant on show. */
  key: string
  title: string
  domain: string
  /** The Rust on show, exactly as the bank compiled it. */
  source: string
  /** The line rustc (or the run) reports. */
  line: number
  /** rustc's own message. */
  message: string
  /** Why it is reported, in permission vocabulary. */
  why: string
  /** The permission question the bank asks about it, when the code has one. */
  focus?: SnippetFocus
  permission?: Permission
  /** The real fix. */
  fix: MuseumFix
  /** The tempting wrong fix: the `.clone()` lure when the bank has one, else the first wrong fix. */
  wrong?: MuseumFix & { clone: boolean; compiles: boolean }
  lessons: string[]
  /** How many snippets and code variants the bank holds for this code. */
  snippets: number
  variants: number
}

const isPanic = (code: string): boolean => (PANIC_CODES as readonly string[]).includes(code)

const codeOf = (u: Unit): string | undefined => (u.result === 'compiles' ? undefined : u.result.code)

/** Fewer lines, then fewer characters, then the key: the minimal snippet. */
const bySize = (a: Unit, b: Unit): number => {
  const la = a.code.split('\n').length
  const lb = b.code.split('\n').length
  return la - lb || a.code.length - b.code.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

/**
 * The unit an entry shows. Tiers, best first: a real fix, a permission label (when the code has one),
 * a `.clone()` lure; a unit that lacks a tier is passed over only if some unit has it.
 */
export function pickUnit(units: readonly Unit[], code: string): Unit | undefined {
  const mine = units.filter((u) => codeOf(u) === code && u.variant.fixes?.some((f) => f.ok))
  const wants: ((u: Unit) => boolean)[] = [
    ...(PERMISSION_CODES[code] ? [(u: Unit) => Boolean(u.variant.permission && u.variant.focus)] : []),
    (u: Unit) => Boolean(u.variant.fixes?.some((f) => f.lure === 'clone')),
  ]
  let pool = mine
  for (const want of wants) {
    const next = pool.filter(want)
    if (next.length > 0) pool = next
  }
  return [...pool].sort(bySize)[0]
}

function fixOf(u: Unit, id: string): MuseumFix {
  const f = u.variant.fixes!.find((x) => x.id === id)!
  const after = u.fixes[f.id]
  return { id: f.id, line: f.edit.line, text: f.edit.text, after: after === 'compiles' ? 'compiles' : after.code, why: f.why }
}

/** Every code the bank holds, with the units that expect it. */
export function codesOf(units: readonly Unit[]): string[] {
  const all = [...new Set(units.flatMap((u) => codeOf(u) ?? []))]
  const rank = (c: string) => {
    const i = (CORE_CODES as readonly string[]).indexOf(c)
    return i >= 0 ? i : CORE_CODES.length
  }
  // the core codes in the spec's order; then compile errors by number; run-time panics last
  return all.sort((a, b) => rank(a) - rank(b) || Number(isPanic(a)) - Number(isPanic(b)) || (a < b ? -1 : a > b ? 1 : 0))
}

/** The museum: one entry per code the bank holds at least `MIN_SNIPPETS_PER_CODE` times. */
export function museumEntries(all: readonly Unit[]): MuseumEntry[] {
  // the reading groups serve serving-first lesson blocks only (docs/specs/serving-reading.md)
  const units = all.filter((u) => !isReadingSnippet(u.snippet))
  const out: MuseumEntry[] = []
  for (const code of codesOf(units)) {
    const mine = units.filter((u) => codeOf(u) === code)
    const snippets = new Set(mine.map((u) => u.snippet.id)).size
    if (snippets < MIN_SNIPPETS_PER_CODE) continue
    const u = pickUnit(units, code)
    if (!u || u.result === 'compiles') continue
    const real = u.variant.fixes!.find((f) => f.ok)!
    const lure = u.variant.fixes!.find((f) => f.lure === 'clone') ?? u.variant.fixes!.find((f) => !f.ok)
    const wrong = lure ? fixOf(u, lure.id) : undefined
    out.push({
      code,
      cluster: ERROR_CODES[code]?.cluster ?? 'borrows',
      means: ERROR_CODES[code]?.means ?? '',
      panic: isPanic(code),
      key: u.key,
      title: u.snippet.title,
      domain: u.snippet.domain,
      source: u.code,
      line: u.result.line,
      message: u.result.message,
      why: u.variant.why,
      ...(u.variant.focus ? { focus: u.variant.focus } : {}),
      ...(u.variant.permission ? { permission: u.variant.permission } : {}),
      fix: fixOf(u, real.id),
      ...(wrong && lure ? { wrong: { ...wrong, clone: lure.lure === 'clone', compiles: wrong.after === 'compiles' } } : {}),
      lessons: [...(TAUGHT_IN[code] ?? [])],
      snippets,
      variants: mine.length,
    })
  }
  return out
}

/** The code with one line replaced (1-based), for showing a fix in place. */
export function withLine(source: string, line: number, text: string): string {
  const lines = source.split('\n')
  lines[line - 1] = text
  return lines.join('\n')
}
