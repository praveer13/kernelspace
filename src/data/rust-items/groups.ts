/**
 * The compile bank's groups, loaded per need (docs/specs/wave-2.md §15.3, §22.1).
 *
 * Each group is one chunk: `served/<id>.ts`, its snippets and what rustc did after each fix, written by
 * scripts/build-rust-items.ts. Vite turns the lazy glob below into one `import()` per group, so serving a
 * compile item fetches only the group its unit lives in, and no bank file (hashes, rustc version, rustc
 * messages) ever reaches the app. The family asks for a group synchronously (`servedGroup`): a group that
 * has not loaded starts loading and the caller's `make` stops with `NotReady` (src/lib/items/on-demand.ts).
 *
 * Bun has no `import.meta.glob`: scripts and tests list `served/` and import it, and `loadAllGroups`
 * loads every group up front, so `make` never stops there.
 */

import { NotReady, want } from '@/lib/items/on-demand'
import type { ServedGroup } from './types'

type Loader = () => Promise<unknown>

const NODE_FS = 'node:fs/promises'
const SERVED_FILE = /^([a-z][a-z0-9-]*)\.ts$/
/** A group whose chunk failed to load is not asked for again for this long (offline: the caller falls back). */
const RETRY_MS = 30_000

/** Vite's lazy glob, or undefined where the runtime has none (Bun). The call is rewritten at build time. */
function viteLoaders(): Record<string, Loader> | undefined {
  try {
    return import.meta.glob('./served/*.ts')
  } catch {
    return undefined
  }
}

const VITE = viteLoaders()

/** Whether groups load on demand (the app) rather than all up front (Bun). */
export const LAZY = VITE !== undefined

/** Bun: every `served/<id>.ts` next to this file. */
async function readdirLoaders(): Promise<Record<string, Loader>> {
  const dir = new URL(/* @vite-ignore */ './served/', import.meta.url)
  const { readdir } = (await import(/* @vite-ignore */ NODE_FS)) as { readdir: (u: URL) => Promise<string[]> }
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return {}
  }
  const out: Record<string, Loader> = {}
  for (const name of names.sort()) if (SERVED_FILE.test(name)) out[`./served/${name}`] = () => import(/* @vite-ignore */ new URL(name, dir).href)
  return out
}

let discovered: Promise<Map<string, Loader>> | undefined

/** group id → loader, discovered once per runtime. */
function loaders(): Promise<Map<string, Loader>> {
  discovered ??= (async () => {
    const raw = VITE ?? (await readdirLoaders())
    const map = new Map<string, Loader>()
    for (const key of Object.keys(raw)) {
      const m = SERVED_FILE.exec(key.slice(key.lastIndexOf('/') + 1))
      if (m) map.set(m[1], raw[key])
    }
    return map
  })()
  return discovered
}

const ready = new Map<string, ServedGroup>()
const pending = new Map<string, Promise<ServedGroup>>()
const failedAt = new Map<string, number>()

/** Load one group (once; a failed load is retried by the next call). */
export function loadGroup(id: string): Promise<ServedGroup> {
  const have = ready.get(id)
  if (have) return Promise.resolve(have)
  let p = pending.get(id)
  if (!p) {
    p = (async () => {
      const load = (await loaders()).get(id)
      if (!load) throw new Error(`unknown compile bank group: ${id}`)
      const mod = (await load()) as Partial<ServedGroup>
      if (!Array.isArray(mod.SNIPPETS) || !Array.isArray(mod.AFTER)) throw new Error(`served/${id}.ts must export SNIPPETS and AFTER`)
      const group = { SNIPPETS: mod.SNIPPETS, AFTER: mod.AFTER }
      ready.set(id, group)
      failedAt.delete(id)
      return group
    })()
    p.then(
      () => pending.delete(id),
      () => {
        pending.delete(id)
        failedAt.set(id, Date.now())
      },
    )
    pending.set(id, p)
  }
  return p
}

/** Every group in `ids`, loaded. */
export async function loadGroups(ids: Iterable<string>): Promise<void> {
  await Promise.all([...ids].map(loadGroup))
}

/**
 * A group that has loaded, now. Otherwise it starts loading (unless it failed in the last RETRY_MS) and
 * throws `NotReady`, which `collect` and `settle` turn into a second run once it lands.
 */
export function servedGroup(id: string): ServedGroup {
  const have = ready.get(id)
  if (have) return have
  const failed = failedAt.get(id)
  if (failed !== undefined && Date.now() - failed < RETRY_MS) throw new NotReady(`compile bank group ${id}`)
  return want(`compile bank group ${id}`, loadGroup(id))
}

/** Whether a group has loaded. */
export const groupLoaded = (id: string): boolean => ready.has(id)

/** Tests only: forget every loaded group, so the on-demand path can be exercised under Bun. */
export function forgetGroups(): void {
  ready.clear()
  pending.clear()
  failedAt.clear()
}
