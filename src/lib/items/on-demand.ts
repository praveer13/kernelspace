/**
 * Data a family loads per instance, with `make` kept synchronous (docs/specs/wave-2.md §15.3, §22.1).
 *
 * The compile family draws a unit from a small manifest, then needs that unit's group (a chunk of the
 * bank). When the group has not loaded, `make` calls `want` with the load and throws `NotReady`; callers
 * already treat a throwing `make` as "no item". `collect` runs synchronous work that may call `make` and
 * reports what it wanted; `settle` awaits that and runs the work again until nothing is missing. The work
 * is deterministic, so the run that misses nothing makes exactly what it would with every group loaded.
 *
 * Every other family has all its data in its own chunk and never calls `want`, so wrapping work over them
 * costs one run. Scripts and tests (Bun) load every group up front, so `make` never throws there.
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
