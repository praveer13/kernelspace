/**
 * The Forge registry (docs/specs/wave-2.md §13.1): lab id → a lazy `import()` of its bundle, so a lab's PRIMM, ladder
 * and Prove-it data is its own chunk and loads only on that lab's page.
 *
 * A lab is a directory `<labId>/` next to this file whose `index.ts` has a `default` export of type `ForgeBundle` with
 * a `labId` equal to the directory name. Dropping a directory in is all it takes: this module never lists them.
 *
 * Discovery: Vite resolves `import.meta.glob` at build time (the app). Bun does not implement it, so scripts and tests
 * list the directory with `readdir` and `import()` each `index.ts`, the pattern of `lib/items/registry.ts`. The Bun
 * path is only reached when the glob is absent, and its Node imports are written so the browser build neither bundles
 * nor warns about them.
 */

import type { ForgeBundle } from './types'

type Loader = () => Promise<unknown>

const NODE_FS = 'node:fs/promises'
/** A lab directory: no dot, so `types.ts` and `index.ts` themselves are never taken for one. */
const LAB_DIR = /^[a-z][a-z0-9-]*$/

/** Vite's glob, or undefined where the runtime has none (Bun). The call is rewritten at build time. */
function viteLoaders(): Record<string, Loader> | undefined {
  try {
    return import.meta.glob('./*/index.ts')
  } catch {
    return undefined
  }
}

/** Bun: every `<labId>/index.ts` under this directory. A missing directory is zero labs. */
async function readdirLoaders(): Promise<Record<string, Loader>> {
  const dir = new URL(/* @vite-ignore */ './', import.meta.url)
  const { readdir } = (await import(/* @vite-ignore */ NODE_FS)) as { readdir: (u: URL) => Promise<string[]> }
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return {}
  }
  const out: Record<string, Loader> = {}
  for (const name of names.sort()) {
    // a directory without an index.ts fails at load time, with the lab's name in the message
    if (LAB_DIR.test(name)) out[`./${name}/index.ts`] = () => import(/* @vite-ignore */ new URL(`${name}/index.ts`, dir).href)
  }
  return out
}

let discovered: Promise<Map<string, Loader>> | undefined

/** lab id → loader, discovered once per runtime. */
function loaders(): Promise<Map<string, Loader>> {
  discovered ??= (async () => {
    const raw = viteLoaders() ?? (await readdirLoaders())
    const map = new Map<string, Loader>()
    for (const key of Object.keys(raw).sort()) {
      const m = /^\.\/([a-z][a-z0-9-]*)\/index\.ts$/.exec(key)
      if (m) map.set(m[1], raw[key])
    }
    return map
  })()
  return discovered
}

/** Lab ids from the glob's keys (`./<labId>/index.ts`). The keys are known at build time; no chunk is fetched for them. */
function idsOf(keys: Iterable<string>): string[] {
  const ids: string[] = []
  for (const key of keys) {
    const m = /^\.\/([a-z][a-z0-9-]*)\/index\.ts$/.exec(key)
    if (m) ids.push(m[1])
  }
  return ids.sort()
}

/**
 * Every lab id that has a bundle, known at once: Vite's glob keys in the app, a directory listing in Bun (through
 * `process.getBuiltinModule`, the one synchronous door to `node:fs` that a browser build never reaches). Empty where
 * neither exists. Loads no bundle.
 */
function syncIds(): string[] {
  const glob = viteLoaders()
  if (glob) return idsOf(Object.keys(glob))
  const fs = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.(NODE_FS.replace('/promises', '')) as
    | { readdirSync(u: URL): string[] }
    | undefined
  if (!fs) return []
  try {
    return fs.readdirSync(new URL(/* @vite-ignore */ './', import.meta.url)).filter((n) => LAB_DIR.test(n)).sort()
  } catch {
    return []
  }
}

let known: ReadonlySet<string> | undefined

/**
 * Whether a lab has a Forge bundle, answered without loading it, so a page can lay out the walk before its chunk
 * arrives instead of drawing the plain page first and swapping.
 */
export function hasForgeBundle(labId: string): boolean {
  known ??= new Set(syncIds())
  return known.has(labId)
}

/** Every lab id that has a bundle, sorted. Loads nothing. */
export async function forgeBundleIds(): Promise<string[]> {
  return [...(await loaders()).keys()]
}

const loaded = new Map<string, Promise<ForgeBundle>>()

/**
 * One lab's bundle, loaded on first use. Throws for a lab with no bundle, and for a module that does not
 * default-export a `ForgeBundle` whose `labId` matches its directory.
 */
export function loadForgeBundle(labId: string): Promise<ForgeBundle> {
  let p = loaded.get(labId)
  if (!p) {
    p = (async () => {
      const load = (await loaders()).get(labId)
      if (!load) throw new Error(`no forge bundle for lab: ${labId}`)
      const bundle = ((await load()) as { default?: ForgeBundle }).default
      if (!bundle || typeof bundle.labId !== 'string') throw new Error(`${labId}/index.ts must default-export a ForgeBundle`)
      if (bundle.labId !== labId) throw new Error(`${labId}/index.ts exports lab "${bundle.labId}": the id must match the directory name`)
      return bundle
    })()
    // a failed load must not stick: the next call retries (a chunk that failed to fetch may succeed)
    p.catch(() => loaded.delete(labId))
    loaded.set(labId, p)
  }
  return p
}

/** The bundle of a lab, or undefined when the lab has none (every lab but the ones with a ladder, so far). */
export async function findForgeBundle(labId: string): Promise<ForgeBundle | undefined> {
  return (await loaders()).has(labId) ? loadForgeBundle(labId) : undefined
}

/** Every bundle, loaded. For scripts and tests; the app loads the one lab it shows. */
export async function loadAllForgeBundles(): Promise<ForgeBundle[]> {
  return Promise.all((await forgeBundleIds()).map(loadForgeBundle))
}
