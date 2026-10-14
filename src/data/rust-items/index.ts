/**
 * The compile bank for scripts and tests (docs/specs/wave-2.md §15): every group with its rustc results,
 * and the light tables (re-exported from `constants.ts`).
 *
 * A group is `snippets/<id>.ts` (exporting `SNIPPETS`) with `bank/<id>.json` beside it. Content tasks add
 * a group by adding those two files and running scripts/build-rust-items.ts, which also writes what the
 * app loads instead of the banks: `manifest.json` (what the compile family needs to draw a unit before
 * its group loads), `served/<id>.ts` (a group's snippets with what rustc did after each fix, one chunk
 * per group, loaded per need by `groups.ts`) and `museum.json` (the Error Museum's exhibits).
 *
 * The app never imports this module: the banks hold source hashes, the rustc version and every rustc
 * message, which only the checks need. verify:bundle fails when a chunk holds a bank's hash. Bun has no
 * `import.meta.glob`, so the directories are listed and their files imported, as src/lib/items/registry.ts does.
 */

import type { BankFile, BankOutcome, BankUnit, Outcome, RustGroup, RustSnippet } from './types'
import { variantCode } from './constants'

export * from './constants'

type SnippetModule = { SNIPPETS?: RustSnippet[] }

const NODE_FS = 'node:fs/promises'
const GROUP_FILE = /^([a-z][a-z0-9-]*)\.(ts|json)$/

/** Every `<dir>/<id>.<ext>` next to this file, imported, by group id. A missing directory is no files. */
async function readdirModules(dir: string, ext: 'ts' | 'json'): Promise<Map<string, unknown>> {
  const url = new URL(`./${dir}/`, import.meta.url)
  const { readdir } = (await import(/* @vite-ignore */ NODE_FS)) as { readdir: (u: URL) => Promise<string[]> }
  let names: string[]
  try {
    names = await readdir(url)
  } catch {
    return new Map()
  }
  const out = new Map<string, unknown>()
  for (const name of names.sort()) {
    const m = GROUP_FILE.exec(name)
    if (!m || m[2] !== ext) continue
    const mod = (await import(/* @vite-ignore */ new URL(name, url).href)) as { default?: unknown }
    out.set(m[1], ext === 'json' ? mod.default : mod)
  }
  return out
}

let loaded: Promise<RustGroup[]> | undefined

/** Every group, sorted by id, each with its bank (null before its first build). Loaded once per runtime. */
export function loadRustGroups(): Promise<RustGroup[]> {
  loaded ??= (async () => {
    const [snippets, banks] = await Promise.all([readdirModules('snippets', 'ts'), readdirModules('bank', 'json')])
    const out: RustGroup[] = []
    for (const [id, mod] of snippets) out.push({ id, snippets: (mod as SnippetModule).SNIPPETS ?? [], bank: (banks.get(id) as BankFile | undefined) ?? null })
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })()
  return loaded
}

/** Whether a recorded result is the authored outcome (code and line; the message is rustc's own). */
export const sameOutcome = (want: Outcome, got: BankOutcome): boolean =>
  want === 'compiles' ? got === 'compiles' : got !== 'compiles' && got.code === want.code && got.line === want.line

/**
 * Every code variant the bank confirms, in bank order (groups by id, snippets and variants as authored),
 * and the keys of those left out because the bank disagrees with the snippet (verify-rust-items fails on
 * one). This order is the compile family's unit order: the manifest lists the same units.
 */
export function bankUnits(groups: readonly RustGroup[]): { units: BankUnit[]; stale: string[] } {
  const units: BankUnit[] = []
  const stale: string[] = []
  for (const g of groups) {
    for (const s of g.snippets) {
      for (const v of s.variants) {
        const key = `${g.id}/${s.id}/${v.id}`
        const b = g.bank?.snippets[s.id]?.variants[v.id]
        const fixesOk = (v.fixes ?? []).every((f) => {
          const r = b?.fixes?.[f.id]
          return r !== undefined && (!f.ok || r === 'compiles')
        })
        if (!b || !sameOutcome(v.expect, b.result) || !fixesOk) {
          stale.push(key)
          continue
        }
        units.push({ key, snippet: s, variant: v, code: variantCode(s, v), result: b.result, fixes: b.fixes ?? {} })
      }
    }
  }
  return { units, stale }
}
