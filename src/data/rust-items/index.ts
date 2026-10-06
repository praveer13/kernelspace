/**
 * The compile bank (docs/specs/wave-2.md §15): every group, loaded by glob, and the tables the family,
 * the build and the checks share.
 *
 * A group is `snippets/<id>.ts` (exporting `SNIPPETS`) with `bank/<id>.json` beside it. Content tasks add
 * a group by adding those two files: nothing here lists them, so no shared index needs editing.
 *
 * Loading: Vite resolves the eager globs at build time, so the groups are static imports of whatever
 * imports this module (the compile family's chunk, precached with it). Bun has no `import.meta.glob`,
 * so scripts and tests list the directories and `import()` the files, as src/lib/items/registry.ts
 * does; that path is reached only when the glob is absent, and its Node import is written so the
 * browser build neither bundles nor warns about it.
 */

import type { BankFile, Outcome, Permission, RustGroup, RustSnippet } from './types'

type SnippetModule = { SNIPPETS?: RustSnippet[] }

const NODE_FS = 'node:fs/promises'
const GROUP_FILE = /^([a-z][a-z0-9-]*)\.(ts|json)$/

/** The phone limits (§15.1): a 360 px screen shows 44 columns of code at the item's font size. */
export const MAX_LINES = 16
export const MAX_COLS = 44

/** Vite's eager globs, or undefined where the runtime has none (Bun). The calls are rewritten at build time. */
function viteModules(): { snippets: Record<string, unknown>; banks: Record<string, unknown> } | undefined {
  try {
    return {
      snippets: import.meta.glob('./snippets/*.ts', { eager: true }),
      banks: import.meta.glob('./bank/*.json', { eager: true, import: 'default' }),
    }
  } catch {
    return undefined
  }
}

/** Bun: every `<dir>/<id>.<ext>` next to this file, imported. A missing directory is no files. */
async function readdirModules(dir: string, ext: 'ts' | 'json'): Promise<Record<string, unknown>> {
  const url = new URL(/* @vite-ignore */ `./${dir}/`, import.meta.url)
  const { readdir } = (await import(/* @vite-ignore */ NODE_FS)) as { readdir: (u: URL) => Promise<string[]> }
  let names: string[]
  try {
    names = await readdir(url)
  } catch {
    return {}
  }
  const out: Record<string, unknown> = {}
  for (const name of names.sort()) {
    const m = GROUP_FILE.exec(name)
    if (!m || m[2] !== ext) continue
    const mod = (await import(/* @vite-ignore */ new URL(name, url).href)) as { default?: unknown }
    out[`./${dir}/${name}`] = ext === 'json' ? mod.default : mod
  }
  return out
}

/** `./snippets/seed.ts` → `seed`. */
const groupOf = (key: string): string | undefined => GROUP_FILE.exec(key.slice(key.lastIndexOf('/') + 1))?.[1]

function assemble(snippets: Record<string, unknown>, banks: Record<string, unknown>): RustGroup[] {
  const bankBy = new Map<string, BankFile>()
  for (const [key, bank] of Object.entries(banks)) {
    const id = groupOf(key)
    if (id) bankBy.set(id, bank as BankFile)
  }
  const out: RustGroup[] = []
  for (const key of Object.keys(snippets).sort()) {
    const id = groupOf(key)
    if (!id) continue
    out.push({ id, snippets: (snippets[key] as SnippetModule).SNIPPETS ?? [], bank: bankBy.get(id) ?? null })
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

let loaded: Promise<RustGroup[]> | undefined

/** Every group, sorted by id, each with its bank (null before its first build). Loaded once per runtime. */
export function loadRustGroups(): Promise<RustGroup[]> {
  loaded ??= (async () => {
    const vite = viteModules()
    if (vite) return assemble(vite.snippets, vite.banks)
    return assemble(await readdirModules('snippets', 'ts'), await readdirModules('bank', 'json'))
  })()
  return loaded
}

/* ------------------------------ code ------------------------------ */

/** The code with one line replaced (1-based). Throws on a line outside the code. */
export function applyEdit(code: string, edit: { line: number; text: string } | undefined): string {
  if (!edit) return code
  const lines = code.split('\n')
  if (!Number.isInteger(edit.line) || edit.line < 1 || edit.line > lines.length) throw new RangeError(`edit line ${edit.line} is outside 1..${lines.length}`)
  lines[edit.line - 1] = edit.text
  return lines.join('\n')
}

/** A variant's code: the base with the variant's edit. */
export const variantCode = (s: RustSnippet, v: { edit?: { line: number; text: string } }): string => applyEdit(s.base, v.edit)

export const isCompiles = (o: Outcome | { code: string }): o is 'compiles' => o === 'compiles'

/* ------------------------------ error codes ------------------------------ */

/** The run-time panics a `run` snippet can expect: RefCell's dynamic borrow check (r.l8). */
export const PANIC_CODES = ['BorrowMutError', 'BorrowError'] as const

/** The clusters verdict options are drawn from (§15.3: "the key plus three from the same KC cluster"). */
export type CodeCluster = 'moves' | 'borrows' | 'lifetimes' | 'cells'

/**
 * Every outcome code the bank may expect, with the cluster its verdict distractors come from and one
 * clause on what it means (shown when a learner picks it and it is wrong). Codes rustc reports for
 * ownership, borrowing and lifetimes, so the three content groups (§15.5) never need to edit this file.
 */
export const ERROR_CODES: Readonly<Record<string, { cluster: CodeCluster; means: string }>> = {
  E0106: { cluster: 'lifetimes', means: 'a returned or stored reference with no lifetime to tie it to' },
  E0373: { cluster: 'lifetimes', means: 'a closure that may outlive the function while it borrows a local' },
  E0381: { cluster: 'moves', means: 'a read of a binding that was never given a value' },
  E0382: { cluster: 'moves', means: 'a use of a value after it was moved' },
  E0384: { cluster: 'moves', means: 'a second assignment to a binding not declared `mut`' },
  E0499: { cluster: 'borrows', means: 'two `&mut` borrows of one place alive at once' },
  E0502: { cluster: 'borrows', means: 'a `&mut` borrow while a `&` borrow is alive, or the reverse' },
  E0503: { cluster: 'borrows', means: 'a use of a value while it is mutably borrowed' },
  E0505: { cluster: 'moves', means: 'a move out of a value while it is borrowed' },
  E0506: { cluster: 'borrows', means: 'an assignment to a place while it is borrowed' },
  E0507: { cluster: 'moves', means: 'a move out of a place behind a reference' },
  E0508: { cluster: 'moves', means: 'a move out of an array element by index' },
  E0509: { cluster: 'moves', means: 'a move out of a field of a type that implements Drop' },
  E0515: { cluster: 'lifetimes', means: 'a returned reference to data the function owns' },
  E0521: { cluster: 'lifetimes', means: 'borrowed data escaping the function' },
  E0594: { cluster: 'borrows', means: 'an assignment through a `&` reference or to a binding not declared `mut`' },
  E0596: { cluster: 'borrows', means: 'a `&mut` borrow of a place not declared `mut`' },
  E0597: { cluster: 'lifetimes', means: 'a value dropped while something still borrows it' },
  E0716: { cluster: 'lifetimes', means: 'a temporary dropped at the end of its statement while still borrowed' },
  BorrowMutError: { cluster: 'cells', means: 'a `borrow_mut` on a RefCell that is already borrowed, a panic at run time' },
  BorrowError: { cluster: 'cells', means: 'a `borrow` on a RefCell that is already mutably borrowed, a panic at run time' },
}

/**
 * The permission labelling rule (§15.4, Crichton's model): the codes whose focused operation can lack
 * exactly one permission it needs, and which one. Anything else (E0499's second `&mut` lacks R and W at
 * once; lifetime errors are about how long a borrow lives, not a permission at a line) gets no label.
 *   - E0382: a read (R) or a write (W) of a moved path, which lost all three;
 *   - E0502: a `&mut` use while `&` lives (W), or a read while `&mut` lives (R);
 *   - E0503, E0506: a use (R) or an assignment (W) while borrowed;
 *   - E0505, E0507, E0508, E0509: a move (O) out of a borrowed or borrowed-through place;
 *   - E0384, E0594, E0596: a write (W) to a path that never had W.
 */
export const PERMISSION_CODES: Readonly<Record<string, readonly Permission[]>> = {
  E0382: ['read', 'write'],
  E0384: ['write'],
  E0502: ['read', 'write'],
  E0503: ['read'],
  E0505: ['own'],
  E0506: ['write'],
  E0507: ['own'],
  E0508: ['own'],
  E0509: ['own'],
  E0594: ['write'],
  E0596: ['write'],
}

/** The misconception a `.clone()` lure records when picked (§15.3). */
export const CLONE_MISS = 'r.clone-to-silence'

/** Whether a fix line adds a method-call `.clone()` that the line it replaces did not have. */
export function addsClone(before: string, after: string): boolean {
  const count = (s: string) => (s.match(/\.clone\(\)/g) ?? []).length
  return count(after) > count(before)
}
