import { claimNumber, formatClaimValue, getClaim } from './index'

/**
 * Helpers that let a lesson's .ts module read a claim inside a template literal, so the page, the markdown export,
 * llms.txt and the search index carry the registry's value. Pure and synchronous. Deliberately not imported by
 * index.ts: the claims chunk /boot and /today load must not grow (tests/claims/lazy.test.ts).
 * A lazy claim must be registered first: the lesson module imports its group, as for any getClaim call.
 */

const REPO_NAMES: Record<string, string> = {
  'vllm-project/vllm': 'vLLM',
  'sgl-project/sglang': 'SGLang',
}

/** A numeric claim's value, unscaled. Throws on an unknown id or a non-numeric claim. */
export function claimValue(id: string): number {
  return claimNumber(id)
}

/** The release a claim was read at, e.g. "vLLM v0.34.0". Throws on an unknown id or a claim with no pin. */
export function claimRelease(id: string): string {
  const { pin } = getClaim(id)
  if (!pin) throw new Error(`claim ${id} has no pin, so it names no release`)
  return `${REPO_NAMES[pin.repo] ?? pin.repo} ${pin.ref}`
}

/** The value, its release and the day it was read, e.g. "64 tokens/block (vLLM v0.34.0, checked 2026-11-21)". */
export function claimCite(id: string): string {
  const claim = getClaim(id)
  return `${formatClaimValue(claim)} (${claimRelease(id)}, checked ${claim.verifiedAt})`
}
