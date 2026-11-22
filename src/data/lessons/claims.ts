/**
 * How a lesson module reads a claim (K0-Z2, reworked in its fix round). A lesson reads a snapshot of the claim values,
 * written by scripts/gen-lesson-claims.ts, not the claims registry: a lesson imports claims here and never from
 * `@/data/claims` or a group under `claims/lazy/`, because each chunk the lessons registry imports statically lands in the
 * entry chunk's preload map (frozen at 349,812 raw bytes), and an awaited import made every page that lists lessons wait
 * for three claims chunks (and fail with them). The snapshot is plain data: no import, no await. tests/claims/lesson-claims.test.ts
 * fails when it drifts from the registry or when a lesson reads an id it does not hold.
 *
 * A lesson that reads a new claim: read it through this module and run `bun scripts/gen-lesson-claims.ts`; the script collects the ids.
 */
import { LESSON_CLAIM_VALUES } from './claims.generated'

function row(id: string) {
  const r = Object.hasOwn(LESSON_CLAIM_VALUES, id) ? LESSON_CLAIM_VALUES[id] : undefined
  if (!r) throw new Error(`lesson claim ${id} is not in claims.generated.ts; read it through this module and run bun scripts/gen-lesson-claims.ts`)
  return r
}

/**
 * The words every lesson puts beside vLLM's default block, the first time it states it (K0-FIX3). They follow the claim's
 * boundary and the v0.34.0 release notes ("Backends with a preferred block size still override it (ROCm paged attention
 * keeps 16), and an explicit --block-size still wins"); they name no number, because no claim holds ROCm's.
 */
export const ENGINE_BLOCK_SCOPE = "ROCm's paged-attention backend keeps its own size, and an explicit `--block-size` overrides either"

/** A fraction as its claim gives it: 0.92 stays 0.92, and a whole number keeps one decimal (1 is written 1.0). */
export function fractionText(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v)
}

/** A numeric claim's value. */
export function claimNumber(id: string): number {
  const { value } = row(id)
  if (value === undefined) throw new Error(`claim ${id} is not numeric`)
  return value
}

/** The value, its release and the day it was read, e.g. "64 tokens/block as of vLLM v0.34.0, read 2026-11-21". */
export function claimCite(id: string): string {
  return row(id).cite
}

/** The release a claim was read at, e.g. "vLLM v0.34.0". */
export function claimRelease(id: string): string {
  const { release } = row(id)
  if (!release) throw new Error(`claim ${id} has no pin, so it names no release`)
  return release
}
