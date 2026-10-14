/**
 * The compile bank's snippet schema (docs/specs/wave-2.md §15.1; PLAN-100X F3a).
 *
 * A snippet is a short, self-contained Rust program in serving-domain names. Its code variants are
 * one-line edits of it, each with an authored outcome that rustc 1.96.0 then confirms
 * (scripts/build-rust-items.ts writes the results to `bank/<group>.json`; scripts/verify-rust-items.ts
 * checks, without rustc, that the bank still matches the snippets). The compile family
 * (src/lib/items/families/compile.ts) serves three kinds of item from every variant:
 *   - verdict: which error rustc reports, or "compiles";
 *   - permission: which of Read, Write and Own the flagged path lacks at the flagged line;
 *   - fix: which one-line change makes it compile without changing what it does.
 *
 * Rules the schema cannot say, enforced by verify-rust-items:
 *   - phone limits: every code (base, variant, fix) is at most 16 lines of at most 44 columns, ASCII, no tabs;
 *   - a snippet's `kcs` are what its verdict and fix items assess; `r.permissions` is assessed only by
 *     permission items, so a snippet never lists it;
 *   - permission labels follow Crichton's model (see `SnippetFocus`); a label is allowed only where the
 *     focused operation lacks exactly one of the permissions it needs, and only for the error codes
 *     `PERMISSION_CODES` (src/data/rust-items/constants.ts) lists;
 *   - the clone-lure rule (see `SnippetFix`).
 */

import type { KcId } from '@/lib/kc/types'

/** Crichton's three permissions on a path: R, W and O. */
export type Permission = 'read' | 'write' | 'own'

/** Replace 1-based `line` of the code with `text` (one line, never empty). Line numbers never shift. */
export interface LineEdit {
  line: number
  text: string
}

/**
 * What happens to a piece of code. `'compiles'`: rustc accepts it (and, for a `run` snippet, it runs to
 * the end without a panic). Otherwise the first error's code and primary line: an `E` code from rustc,
 * or, for a `run` snippet, `BorrowMutError` (`RefCell already borrowed`) or `BorrowError` (`RefCell
 * already mutably borrowed`) with the line that panicked.
 */
export type Outcome = 'compiles' | { code: string; line: number }

/**
 * The place a permission item points at, in Crichton's model (Crichton & Krishnamurthi 2024; the Rust
 * book's chapter 4): a path holds R, W and O; a move removes all three from the source; `&` removes W
 * and O while the borrow lives; `&mut` removes R as well. `needs` is what the operation at `line`
 * requires of `path` (a read: R; a `&mut` call or an assignment: R and W, or W; a move: R and O).
 */
export interface SnippetFocus {
  line: number
  /** The path as written in the code, e.g. `table.blocks`; it must appear on `line`. */
  path: string
  needs: Permission[]
}

/**
 * One candidate fix of a variant that does not compile. Exactly one fix of a variant is `ok`: it must
 * compile and keep what the code does. The others are wrong, and each says why.
 *
 * The clone-lure rule (§15.2): a fix that adds `.clone()` is never `ok` and is marked `lure: 'clone'`.
 * `.clone()` usually compiles; the lesson is that it copies (cloning a request's whole block table to
 * satisfy the checker), so a learner who picks it is told what it copies and why the copy changes what
 * the code does, and the pick is recorded as `r.clone-to-silence` unless `miss` says otherwise. A handle
 * clone written `Rc::clone(&x)` or `Arc::clone(&x)` is not a lure. A wrong fix that rustc accepts must be
 * a lure (`clone`, or `other` for any other change that compiles but changes behaviour), so every
 * "compiles but wrong" claim is labelled and explained; a wrong fix that rustc rejects needs no label.
 */
export interface SnippetFix {
  id: string
  edit: LineEdit
  ok: boolean
  lure?: 'clone' | 'other'
  /** Why this fix is right, or what is wrong with it; shown after the learner picks. */
  why: string
  /** Misconception id recorded when a learner picks this wrong fix (a clone lure defaults to `r.clone-to-silence`). */
  miss?: string
}

export interface SnippetVariant {
  /** Unique within the snippet: `base` for the unedited code, else a short kebab-case name. */
  id: string
  /** Absent: the variant is the base code itself. */
  edit?: LineEdit
  /** Authored, then checked by rustc. */
  expect: Outcome
  /** One or two sentences, in permission vocabulary, on why rustc reports this (or accepts it). */
  why: string
  /** The place the permission question points at. */
  focus?: SnippetFocus
  /** The permission `focus.path` lacks at `focus.line`: the one of `focus.needs` it no longer holds. */
  permission?: Permission
  /** 3 or 4 candidate fixes, exactly one `ok`; only on a variant that does not compile. */
  fixes?: SnippetFix[]
}

export interface RustSnippet {
  /** Unique across the bank, kebab-case: `kv-push-while-borrowed`. */
  id: string
  kcs: KcId[]
  title: string
  /** The serving object it is about: KvBlockTable, Request, Scheduler, Batch … */
  domain: string
  /** At most 16 lines of at most 44 columns (a phone at 360 px). */
  base: string
  /**
   * Build a binary and run it (the base has `fn main`): a variant that compiles but panics on a RefCell
   * borrow has the outcome `BorrowMutError` or `BorrowError`. Otherwise the code is checked as a library
   * (`--emit=metadata`) and never run.
   */
  run?: true
  /** 2 to 5 code variants. */
  variants: SnippetVariant[]
}

/** What rustc did with one piece of code, as the bank records it. */
export type BankOutcome = 'compiles' | { code: string; line: number; message: string }

export interface BankVariant {
  result: BankOutcome
  /** fix id → what rustc did with the code after that fix (no message: the family shows only the code) */
  fixes?: Record<string, Outcome>
}

export interface BankSnippet {
  /** sha256 of the snippet's canonical JSON (scripts/verify-rust-items.ts `snippetHash`). */
  hash: string
  variants: Record<string, BankVariant>
}

/** `bank/<group>.json`, written by scripts/build-rust-items.ts. */
export interface BankFile {
  group: string
  /** `rustc --version` of the compiler that built it. */
  rustc: string
  edition: string
  snippets: Record<string, BankSnippet>
}

/** One group of the bank: `snippets/<id>.ts` and its `bank/<id>.json` (null until it is built). */
export interface RustGroup {
  id: string
  snippets: RustSnippet[]
  bank: BankFile | null
}

/** One code variant the bank confirms, with what rustc did (scripts and tests; the app never loads a bank). */
export interface BankUnit {
  /** `group/snippet/variant` */
  key: string
  snippet: RustSnippet
  variant: SnippetVariant
  code: string
  result: BankOutcome
  /** fix id → what rustc did after it (variants with fixes only) */
  fixes: Record<string, Outcome>
}

/**
 * A variant as the manifest lists it: its outcome code (`''` when it compiles), then `p` when it carries a
 * permission label and `f` when it has fixes (`E0502pf`); null for a variant the bank does not confirm.
 */
export type ManifestVariant = string | null

/**
 * `manifest.json`, written by scripts/build-rust-items.ts from the banks: what the compile family needs to
 * choose a unit for a seed before loading any group. Group id → its snippets in authored order, each as
 * `[kcs, variants]`. No source, hash, rustc version or message.
 */
export interface RustManifest {
  groups: Record<string, [string[], ManifestVariant[]][]>
}

/**
 * What rustc did after one fix, as `served/<group>.ts` records it: `'compiles'`, or the first error as
 * `<code>@<line>` (`E0499@7`).
 */
export type ServedAfter = string

/**
 * `served/<group>.ts`, written by scripts/build-rust-items.ts: the group's snippets and, by snippet and
 * variant in authored order, what rustc did after each fix (null for a variant without fixes). The one
 * chunk a group loads as (`groups.ts`).
 */
export interface ServedGroup {
  SNIPPETS: RustSnippet[]
  AFTER: readonly (readonly (readonly ServedAfter[] | null)[])[]
}

/**
 * Code as a template literal, written indented in the source: drops the first line break and the
 * common indentation, and trims the end, so `base: rs\`…\`` reads like the program it is.
 */
export function rs(strings: TemplateStringsArray, ...values: unknown[]): string {
  const raw = strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''), '')
  const lines = raw.replace(/^\n/, '').replace(/\s+$/, '').split('\n')
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length))
  return lines.map((l) => l.slice(indent)).join('\n')
}
