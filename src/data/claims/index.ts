import type { Claim } from './schema'
import { ENGINE_CLAIMS } from './engines'
import { HARDWARE_CLAIMS } from './hardware'
import { MODEL_CLAIMS } from './models'
import { PRICE_CLAIMS } from './prices'
import { PRODUCTION_CLAIMS } from './production'
import { SERVING_CLAIMS } from './serving'
import { ZOO_CLAIMS } from './zoo'

export type { Claim, ClaimKind } from './schema'
export { isEngineSetting, pinProblems } from './schema'

export const CLAIMS: Claim[] = [
  ...HARDWARE_CLAIMS,
  ...MODEL_CLAIMS,
  ...PRICE_CLAIMS,
  ...PRODUCTION_CLAIMS,
  ...ENGINE_CLAIMS,
  ...SERVING_CLAIMS,
  ...ZOO_CLAIMS,
]

export const byId: Record<string, Claim> = Object.fromEntries(CLAIMS.map((c) => [c.id, c]))

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

/**
 * Where each lazy group lives: a claim id prefix to the module that holds it, relative to `src/data/claims/`.
 * `getClaim` reads it to name the group to import, since the group is not loaded and `all.ts`, which imports every
 * group, is not in the browser. Add a line with the group; tests/claims/lazy.test.ts fails when a lazy claim's id
 * has no line here or its line names another file.
 */
export const LAZY_GROUP_HOMES: Record<string, string> = {}

/** The module to import for an id that is not registered: the longest matching prefix of `LAZY_GROUP_HOMES`, or undefined. */
export function lazyGroupFor(id: string): string | undefined {
  let best: string | undefined
  for (const prefix of Object.keys(LAZY_GROUP_HOMES)) {
    if (id.startsWith(prefix) && (best === undefined || prefix.length > best.length)) best = prefix
  }
  return best === undefined ? undefined : LAZY_GROUP_HOMES[best]
}

/** A claim by id; an unknown id is a typo or a lazy group nobody imported, so it throws instead of rendering nothing. */
export function getClaim(id: string): Claim {
  const claim = Object.hasOwn(byId, id) ? byId[id] : undefined
  if (!claim) {
    const home = lazyGroupFor(id)
    throw new Error(home ? `unknown claim id: ${id}; it lives in the lazy group ${home}, so import '@/data/claims/${home}'` : `unknown claim id: ${id}`)
  }
  return claim
}

/** A numeric claim's value, optionally scaled (TB/s to GB/s, TFLOPS to GFLOPS) and rounded off float dust. */
export function claimNumber(id: string, scale = 1): number {
  const { value } = getClaim(id)
  if (typeof value !== 'number') throw new Error(`claim ${id} is not numeric`)
  return Math.round(value * scale * 1e6) / 1e6
}

/** The value with its unit, e.g. "3.35 TB/s" or "131,072 bytes/token". */
export function formatClaimValue(claim: Claim): string {
  const v = typeof claim.value === 'number' ? claim.value.toLocaleString('en-US') : claim.value
  return claim.unit ? `${v} ${claim.unit}` : String(v)
}

const DAY_MS = 86_400_000

/** The day a claim went stale (verifiedAt + ttlDays) as YYYY-MM-DD, or null while it is still fresh. */
export function staleSince(claim: Claim, now: Date = new Date()): string | null {
  const verified = Date.parse(`${claim.verifiedAt}T00:00:00Z`)
  if (Number.isNaN(verified)) return null
  const expiry = verified + claim.ttlDays * DAY_MS
  return now.getTime() > expiry ? new Date(expiry).toISOString().slice(0, 10) : null
}
