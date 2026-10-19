/**
 * The family registry (docs/specs/wave-1.md §5.1): family id → a lazy `import()`, so Today and
 * tickets load only the families they serve, and each family is its own chunk outside the `/today`
 * first-load closure.
 *
 * A family is a module `families/<id>.ts` with a `default` export of type `Gen` whose `id` equals
 * the file name. Dropping a file in is all it takes: this module never lists them.
 *
 * Discovery: Vite resolves `import.meta.glob` at build time (the app). Bun does not implement it,
 * so scripts and tests list the directory with `readdir` and `import()` the files, as
 * verify-errata does. The Bun path is only reached when the glob is absent, and its Node imports
 * are written so the browser build neither bundles nor warns about them.
 */

import { NotReady, want } from './on-demand'
import type { Gen } from './types'

type Loader = () => Promise<unknown>

const NODE_FS = 'node:fs/promises'
const FAMILY_FILE = /^([a-z][a-z0-9-]*)\.ts$/

/** Vite's glob, or undefined where the runtime has none (Bun). The call is rewritten at build time. */
function viteLoaders(): Record<string, Loader> | undefined {
  try {
    return import.meta.glob('./families/*.ts')
  } catch {
    return undefined
  }
}

/** Bun: every `families/<id>.ts` next to this file. A missing directory is zero families. */
async function readdirLoaders(): Promise<Record<string, Loader>> {
  const dir = new URL(/* @vite-ignore */ './families/', import.meta.url)
  const { readdir } = (await import(/* @vite-ignore */ NODE_FS)) as { readdir: (u: URL) => Promise<string[]> }
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return {}
  }
  const out: Record<string, Loader> = {}
  for (const name of names.sort()) {
    if (FAMILY_FILE.test(name)) out[`./families/${name}`] = () => import(/* @vite-ignore */ new URL(name, dir).href)
  }
  return out
}

let discovered: Promise<Map<string, Loader>> | undefined

/** family id → loader, discovered once per runtime. */
function loaders(): Promise<Map<string, Loader>> {
  discovered ??= (async () => {
    const raw = viteLoaders() ?? (await readdirLoaders())
    const map = new Map<string, Loader>()
    for (const key of Object.keys(raw).sort()) {
      const m = FAMILY_FILE.exec(key.slice(key.lastIndexOf('/') + 1))
      if (m) map.set(m[1], raw[key])
    }
    return map
  })()
  return discovered
}

/** Every family id, sorted. Loads nothing. */
export async function familyIds(): Promise<string[]> {
  return [...(await loaders()).keys()]
}

const loaded = new Map<string, Promise<Gen>>()

/**
 * One family, loaded on first use. Throws for an unknown id, and for a module that does not
 * default-export a `Gen` with a matching `id`.
 */
export function loadFamily(id: string): Promise<Gen> {
  let p = loaded.get(id)
  if (!p) {
    p = (async () => {
      const load = (await loaders()).get(id)
      if (!load) throw new Error(`unknown generator family: ${id}`)
      const gen = ((await load()) as { default?: Gen }).default
      if (!gen || typeof gen.make !== 'function') throw new Error(`families/${id}.ts must default-export a Gen`)
      if (gen.id !== id) throw new Error(`families/${id}.ts exports family "${gen.id}": the id must match the file name`)
      return gen
    })()
    // a failed load must not stick: the next call retries (a chunk that failed to fetch may succeed)
    p.catch(() => loaded.delete(id))
    loaded.set(id, p)
  }
  return p
}

/** Every family, loaded. For verify-generators and tests; the app loads the families it needs by id. */
export async function loadAllFamilies(): Promise<Gen[]> {
  return Promise.all((await familyIds()).map(loadFamily))
}

/* ------------------------------ a family's on-demand parts ------------------------------ */

/** A part whose load failed is not asked for again for this long (offline: the caller falls back), as compile's groups. */
const PART_RETRY_MS = 30_000

/**
 * Vite's lazy glob of the parts, or undefined where the runtime has none (Bun). A part is `families/lazy/<name>.ts`: code
 * and data only some of a family's variants read, in a module (and chunk) of its own that is no family, since the family
 * glob above does not reach the directory. This module issues the `import()`, so a family that awaits its part under Bun
 * (top-level await) holds no dynamic import itself: Rollup treats an `import()` in a module with top-level await as a
 * static one, and would move modules out of the entry chunk to serve it.
 */
function vitePartLoaders(): Record<string, Loader> | undefined {
  try {
    return import.meta.glob('./families/lazy/*.ts')
  } catch {
    return undefined
  }
}

const PART_LOADERS = vitePartLoaders()

/** Whether parts load on demand (the app) rather than when their family's module evaluates (Bun: scripts and tests). */
export const PARTS_ON_DEMAND = PART_LOADERS !== undefined

const parts = new Map<string, unknown>()
const partLoads = new Map<string, Promise<unknown>>()
const partFailedAt = new Map<string, number>()

/** Load one part (once; a failed load is retried by the next call). An unknown name throws. */
export function loadFamilyPart<T>(name: string): Promise<T> {
  let p = partLoads.get(name)
  if (!p) {
    const load = PART_LOADERS
      ? PART_LOADERS[`./families/lazy/${name}.ts`]
      : () => import(/* @vite-ignore */ new URL(`${name}.ts`, new URL(/* @vite-ignore */ './families/lazy/', import.meta.url)).href)
    if (!load) throw new Error(`unknown family part: ${name}`)
    p = load().then((m) => {
      parts.set(name, m)
      return m
    })
    p.catch(() => {
      partLoads.delete(name)
      partFailedAt.set(name, Date.now())
    })
    partLoads.set(name, p)
  }
  return p as Promise<T>
}

/**
 * A part that has loaded, now, for a family's synchronous `make`. Otherwise it starts loading (unless it failed in the last
 * PART_RETRY_MS) and throws `NotReady`, which `collect` and `settle` (on-demand.ts) turn into a second run once it lands.
 */
export function familyPart<T>(name: string): T {
  if (parts.has(name)) return parts.get(name) as T
  const what = `family part ${name}`
  const failed = partFailedAt.get(name)
  if (failed !== undefined && Date.now() - failed < PART_RETRY_MS) throw new NotReady(what)
  return want(what, loadFamilyPart(name))
}

/** Tests only: forget every loaded part, so the on-demand path can be exercised under Bun. */
export function forgetFamilyParts(): void {
  parts.clear()
  partLoads.clear()
  partFailedAt.clear()
}
