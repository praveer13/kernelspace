import { describe, expect, test } from 'bun:test'
import { claimNumber, getClaim } from '@/data/claims'
import { claimCite, claimRelease, claimValue } from '@/data/claims/cite'

const PINNED = 'production.vllm.block-size'
const UNPINNED = 'hw.h100-sxm.hbm-capacity'
const NON_NUMERIC = 'production.vllm.v1-preemption'

describe('claim helpers for lesson strings', () => {
  test('claimValue is claimNumber', () => {
    expect(claimValue(PINNED)).toBe(claimNumber(PINNED))
  })

  test('claimRelease names the repo and the pinned ref', () => {
    const { pin } = getClaim(PINNED)
    expect(pin).toBeDefined()
    expect(claimRelease(PINNED)).toBe(`vLLM ${pin!.ref}`)
    expect(claimRelease('production.sglang.retract')).toBe(`SGLang ${getClaim('production.sglang.retract').pin!.ref}`)
  })

  test('claimCite carries the value, the pin ref and the read date', () => {
    const cite = claimCite(PINNED)
    const claim = getClaim(PINNED)
    expect(cite).toContain(String(claimNumber(PINNED)))
    expect(cite).toContain(claim.pin!.ref)
    expect(cite).toContain(claim.verifiedAt)
    expect(cite).toBe(`${claimNumber(PINNED)} ${claim.unit} as of vLLM ${claim.pin!.ref}, read ${claim.verifiedAt}`)
  })

  test('claimRelease and claimCite throw on an unpinned claim', () => {
    expect(getClaim(UNPINNED).pin).toBeUndefined()
    expect(() => claimRelease(UNPINNED)).toThrow(/no pin/)
    expect(() => claimCite(UNPINNED)).toThrow(/no pin/)
  })

  test('claimValue throws on a non-numeric claim', () => {
    expect(() => claimValue(NON_NUMERIC)).toThrow(/not numeric/)
  })

  test('every function throws on an unknown id', () => {
    for (const fn of [claimValue, claimRelease, claimCite]) {
      expect(() => fn('no.such.claim')).toThrow(/unknown claim id/)
      expect(() => fn('constructor')).toThrow(/unknown claim id/)
    }
  })
})
