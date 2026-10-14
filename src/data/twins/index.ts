/**
 * The twins registry (docs/specs/wave-3.md §9, D21): lab id -> a lazy `import()` of its twin module, found by readdir
 * as the Forge registry finds bundles (`../forge/index.ts`), so a lab's twin is its own chunk and loads only once that
 * lab is done. A twin is a file `<labId>.ts` next to this one with a `default` export of type `TwinModule` whose
 * `labId` equals the file name; dropping a file in is all it takes, and this module never lists them. A lab with no
 * such file has no twin, and its panel renders nothing.
 *
 * Discovery: Vite resolves `import.meta.glob` at build time (the app). Bun does not implement it, so scripts and tests
 * list the directory with `readdir` and `import()` each file, as `../forge/index.ts` does.
 */

import type { Claim } from '@/data/claims/schema'
import type { TwinModule } from './types'

export type { TwinItem, TwinModule } from './types'

type Loader = () => Promise<unknown>

const NODE_FS = 'node:fs/promises'
/** A twin file: `<labId>.ts`; `index.ts` and `types.ts` are taken out by name. */
const TWIN_FILE = /^([a-z][a-z0-9-]*)\.ts$/
const NOT_TWINS = new Set(['index', 'types'])

/** The twin's lab id from a file name or glob key (`./radix-cache.ts`), or null when the file is not a twin. */
function labOf(file: string): string | null {
  const m = TWIN_FILE.exec(file.replace(/^\.\//, ''))
  return m !== null && !NOT_TWINS.has(m[1]) ? m[1] : null
}

/** Questions a twin plays (spec §9: "three tracing questions"). */
export const TWIN_ITEMS_PER_LAB = 3

/** An authored item names 1-3 KCs (`QuizQuestion.kcs`); the ledger's cap is 6. */
const MAX_ITEM_KCS = 3

/** Vite's glob, or undefined where the runtime has none (Bun). The call is rewritten at build time. */
function viteLoaders(): Record<string, Loader> | undefined {
  try {
    return import.meta.glob('./*.ts')
  } catch {
    return undefined
  }
}

/** Bun: every `<labId>.ts` under this directory. */
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
  for (const name of names.sort()) if (labOf(name) !== null) out[`./${name}`] = () => import(/* @vite-ignore */ new URL(name, dir).href)
  return out
}

let discovered: Promise<Map<string, Loader>> | undefined

/** lab id -> loader, discovered once per runtime. */
function loaders(): Promise<Map<string, Loader>> {
  discovered ??= (async () => {
    const raw = viteLoaders() ?? (await readdirLoaders())
    const map = new Map<string, Loader>()
    for (const key of Object.keys(raw).sort()) {
      const lab = labOf(key)
      if (lab !== null) map.set(lab, raw[key])
    }
    return map
  })()
  return discovered
}

/** Every lab id that has a twin, sorted. Loads no twin. */
export async function twinLabIds(): Promise<string[]> {
  return [...(await loaders()).keys()]
}

const loaded = new Map<string, Promise<TwinModule>>()

/**
 * One lab's twin, loaded on first use. Throws for a lab with no twin, and for a module that does not default-export a
 * `TwinModule` whose `labId` matches its file name.
 */
export function loadTwin(labId: string): Promise<TwinModule> {
  let p = loaded.get(labId)
  if (!p) {
    p = (async () => {
      const load = (await loaders()).get(labId)
      if (!load) throw new Error(`no twin for lab: ${labId}`)
      const twin = ((await load()) as { default?: TwinModule }).default
      if (!twin || typeof twin.labId !== 'string') throw new Error(`twins/${labId}.ts must default-export a TwinModule`)
      if (twin.labId !== labId) throw new Error(`twins/${labId}.ts exports lab "${twin.labId}": the id must match the file name`)
      return twin
    })()
    // a failed load must not stick: the next call retries (a chunk that failed to fetch may succeed)
    p.catch(() => loaded.delete(labId))
    loaded.set(labId, p)
  }
  return p
}

/** The twin of a lab, or undefined when the lab has none (every lab but the ones whose twin has shipped). */
export async function findTwin(labId: string): Promise<TwinModule | undefined> {
  return (await loaders()).has(labId) ? loadTwin(labId) : undefined
}

/** The item id of a twin's n-th question (from 1): the ref without `item:`, `lab07.twin.1`. */
export function twinItemId(labNo: string, n: number): string {
  return `lab${labNo}.twin.${n}`
}

/** The file at the claim's pinned ref, on GitHub: a link that reads the same bytes the claim's quote was copied from. */
export function twinFileUrl(pin: { repo: string; ref: string }, path: string): string {
  return `https://github.com/${pin.repo}/blob/${pin.ref}/${path}`
}

/**
 * What is wrong with a twin, if anything: exactly three questions whose ids are `lab<NN>.twin.<n>` in order (the refs the
 * panel records and item-pools collects), a why for every option, 1-3 KCs each, and a claim that pins the release the
 * path is read at. The panel renders nothing for a twin with a problem; the content task's test and verify:items say why.
 */
export function twinProblems(twin: TwinModule, claim: Claim | undefined): string[] {
  const out: string[] = []
  if (!/^\d{2}$/.test(twin.labNo)) out.push(`labNo "${twin.labNo}" is not two digits`)
  if (twin.path.trim() === '' || twin.path.startsWith('/')) out.push(`path "${twin.path}" is not a path inside the repository`)
  if (twin.symbols.length === 0) out.push('names no symbol')
  if (twin.youWrote.trim() === '') out.push('has no "you just wrote" line')
  if (twin.items.length !== TWIN_ITEMS_PER_LAB) out.push(`has ${twin.items.length} questions, not ${TWIN_ITEMS_PER_LAB}`)
  twin.items.forEach((item, i) => {
    const at = `question ${i + 1}`
    const want = twinItemId(twin.labNo, i + 1)
    if (item.id !== want) out.push(`${at}: id "${item.id}" is not "${want}"`)
    if (item.kcs.length < 1 || item.kcs.length > MAX_ITEM_KCS) out.push(`${at}: names ${item.kcs.length} KCs, not 1-${MAX_ITEM_KCS}`)
    const { q } = item
    if (q.why?.length !== q.options.length || q.why.some((w) => w.trim() === '')) out.push(`${at}: needs a why for every option`)
    if (q.correct.length === 0 || q.correct.some((c) => !Number.isInteger(c) || c < 0 || c >= q.options.length)) out.push(`${at}: correct is not an option`)
  })
  if (claim === undefined) out.push(`claim ${twin.claimId} is not registered`)
  else if (claim.pin === undefined) out.push(`claim ${twin.claimId} has no pin {repo, ref}`)
  return out
}
