import type { Claim } from './schema'
import { HARDWARE_CLAIMS } from './hardware'
import { MODEL_CLAIMS } from './models'
import { PRICE_CLAIMS } from './prices'

export type { Claim, ClaimKind } from './schema'

export const CLAIMS: Claim[] = [...HARDWARE_CLAIMS, ...MODEL_CLAIMS, ...PRICE_CLAIMS]

export const byId: Record<string, Claim> = Object.fromEntries(CLAIMS.map((c) => [c.id, c]))

/** A claim by id; an unknown id is a typo, so it throws instead of rendering nothing. */
export function getClaim(id: string): Claim {
  const claim = byId[id]
  if (!claim) throw new Error(`unknown claim id: ${id}`)
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
