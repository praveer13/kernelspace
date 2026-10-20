/**
 * Data a family loads per instance, with `make` kept synchronous (docs/specs/wave-2.md §15.3, §22.1).
 *
 * The compile family draws a unit from a small manifest, then needs that unit's group (a chunk of the
 * bank). When the group has not loaded, `make` calls `want` with the load and throws `NotReady`; callers
 * already treat a throwing `make` as "no item". `collect` runs synchronous work that may call `make` and
 * reports what it wanted; `settle` awaits that and runs the work again until nothing is missing. The work
 * is deterministic, so the run that misses nothing makes exactly what it would with every group loaded.
 *
 * A family with an on-demand part (`familyPart` below: the `step` family's calibrated variants) wants it the same way.
 * Every other family has all its data in its own chunk and never calls `want`, so wrapping work over them
 * costs one run. Scripts and tests (Bun) load every group and part up front, so `make` never throws there.
 */

/** Thrown by `make` when the data an instance needs has not loaded; `want` has started the load. */
export class NotReady extends Error {
  constructor(what: string) {
    super(`${what} has not loaded yet`)
    this.name = 'NotReady'
  }
}

/** The loads the running `collect` has been asked for; null outside one. Work is synchronous, so one at a time. */
let wanted: Set<Promise<unknown>> | null = null

/** Ask for data an instance needs and stop: records `load` for the running `collect`, then throws `NotReady`. */
export function want(what: string, load: Promise<unknown>): never {
  wanted?.add(load)
  throw new NotReady(what)
}

export interface Collected<T> {
  /** What the work returned; undefined when the work itself stopped on `NotReady` (then `stopped` holds it). */
  value: T | undefined
  stopped?: NotReady
  /** Resolves (never rejects) once every load the work asked for has settled; null when it asked for none. */
  ready: Promise<void> | null
}

/** Run synchronous work that may call `make`, and report the loads its makes asked for. */
export function collect<T>(work: () => T): Collected<T> {
  const outer = wanted
  const mine = new Set<Promise<unknown>>()
  wanted = mine
  let value: T | undefined
  let stopped: NotReady | undefined
  try {
    value = work()
  } catch (e) {
    if (!(e instanceof NotReady)) throw e
    stopped = e
  } finally {
    wanted = outer
  }
  return { value, ...(stopped ? { stopped } : {}), ready: mine.size === 0 ? null : Promise.allSettled(mine).then(() => undefined) }
}

/** The most runs `settle` makes: each run can only add data (the bank has four groups), so this is never reached. */
const MAX_RUNS = 8

/**
 * Run `work` until its makes miss nothing, loading what they ask for in between; the last run's value.
 * A load that fails is not asked for again by this call (the loader remembers it for a while), so the last
 * run serves whatever else it can and the caller falls back as it does for any missing item. When the work
 * itself stops on data that never loaded, the `NotReady` is thrown.
 */
export async function settle<T>(work: () => T): Promise<T> {
  let run = collect(work)
  for (let i = 1; run.ready && i < MAX_RUNS; i++) {
    await run.ready
    run = collect(work)
  }
  if (run.stopped) throw run.stopped
  return run.value as T
}

/* ------------------------------ a family's on-demand parts ------------------------------ */

type Loader = () => Promise<unknown>

/** A part whose load failed is not asked for again for this long (offline: the caller falls back), as compile's groups. */
const PART_RETRY_MS = 30_000

/**
 * Vite's lazy glob of the parts, or undefined where the runtime has none (Bun). A part is `families/lazy/<name>.ts`: code
 * and data only some of a family's variants read, in a module (and chunk) of its own that is no family, since the
 * registry's family glob does not reach the directory. The loader lives here, not in the registry (S5-D79): this module
 * is a chunk of its own that /today already holds, so the glob's import map joins neither the family's chunk nor every
 * closure that holds the registry. This module issues the `import()`, so a family that awaits its part under Bun
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
 * PART_RETRY_MS) and throws `NotReady`, which `collect` and `settle` turn into a second run once it lands.
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
