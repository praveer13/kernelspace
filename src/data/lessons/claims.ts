/**
 * How a lesson module reads a claim (K0-Z2, reworked in its fix round). A lesson reads a snapshot of the claim values,
 * written by scripts/gen-lesson-claims.ts, not the claims registry: a lesson imports claims here and never from
 * `@/data/claims` or a group under `claims/lazy/`, because each chunk the lessons registry imports statically lands in the
 * entry chunk's preload map (frozen at 349,812 raw bytes), and an awaited import made every page that lists lessons wait
 * for three claims chunks (and fail with them). The snapshot is plain data: no import, no await. tests/claims/lesson-claims.test.ts
 * fails when it drifts from the registry or when a lesson reads an id it does not hold.
 *
 * A lesson that reads a new claim: add the id to LESSON_CLAIMS in scripts/gen-lesson-claims.ts and run the script.
 */
import { LESSON_CLAIM_VALUES } from './claims.generated'

function row(id: string) {
  const r = Object.hasOwn(LESSON_CLAIM_VALUES, id) ? LESSON_CLAIM_VALUES[id] : undefined
  if (!r) throw new Error(`lesson claim ${id} is not in claims.generated.ts; add it to scripts/gen-lesson-claims.ts and run it`)
  return r
}

/** A numeric claim's value. */
export function claimNumber(id: string): number {
  const { value } = row(id)
  if (value === undefined) throw new Error(`claim ${id} is not numeric`)
  return value
}

/** The value, its release and the day it was read, e.g. "64 tokens/block (vLLM v0.34.0, checked 2026-11-21)". */
export function claimCite(id: string): string {
  return row(id).cite
}

/** The release a claim was read at, e.g. "vLLM v0.34.0". */
export function claimRelease(id: string): string {
  const { release } = row(id)
  if (!release) throw new Error(`claim ${id} has no pin, so it names no release`)
  return release
}
