import { byId, CLAIMS } from './index'
import type { Claim } from './schema'

/**
 * Registration for the lazy claim groups (spec wave-3 §4.4). It lives apart from `index.ts` so the eager claims chunk
 * /boot and /today load carries none of it (D19: that chunk does not grow); only a lazy group under `lazy/` imports it.
 */

/** A claim's fields as one string with keys in sorted order, so two bodies compare equal whatever order they were written in. */
function body(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

/**
 * Adds a group of claims to the registry (spec wave-3 §4.4). A lazy group under `lazy/` calls this when its module
 * is evaluated, so a consumer that imports the group registers it and the eager chunk never carries it. Idempotent:
 * an id already registered with the same body is skipped (a module that evaluates twice, or two groups that share a
 * claim); the same id with a different body throws, so two groups cannot quietly disagree about a number.
 */
export function registerClaims(list: readonly Claim[]): void {
  for (const claim of list) {
    const held = Object.hasOwn(byId, claim.id) ? byId[claim.id] : undefined
    if (held) {
      if (body(held) !== body(claim)) throw new Error(`claim ${claim.id} is registered twice with different bodies`)
      continue
    }
    CLAIMS.push(claim)
    byId[claim.id] = claim
  }
}
