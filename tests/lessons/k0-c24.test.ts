/**
 * K0-C24: t5.l8 says speculative output keeps the target's distribution (not bit-identical), that engines differ on
 * mixing prefill with decode by default, and that Medusa left vLLM. The two status claims it reads keep their shape.
 */
import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '../../src/data/lessons'
import { ENGINES_STATUS_CLAIMS } from '../../src/data/claims/lazy/engines-status'

const lesson = ALL_LESSONS.find((l) => l.id === 't5.l8')!
const text = JSON.stringify(lesson).replace(/\\n/g, ' ')

describe('t5.l8 speculative decoding and mixed batches', () => {
  test('no claim of bit-identical speculative output', () => {
    expect(text).not.toMatch(/bit-identical/i)
    expect(text).toContain('output distribution unchanged')
    expect(text).toContain('FLy')
  })
  test('mixed batches are not called every engine\'s default', () => {
    expect(text).not.toContain('every modern engine')
    expect(text).toContain('enable_mixed_chunk')
    expect(text).toContain('enable_chunked_prefill')
    expect(text).toContain('SGLang chunks prefill by default too')
  })
  test('Medusa is named as removed, not as a method to use', () => {
    expect(text).not.toContain('Medusa/EAGLE')
    expect(text).toMatch(/Medusa[^.]*removed from vLLM/)
  })
  test('the claim it reads is a pinned status claim with a quote', () => {
    for (const id of ['status.vllm.speculative-methods']) {
      const c = ENGINES_STATUS_CLAIMS.find((x) => x.id === id)!
      expect(c.kind).toBe('status')
      expect(c.ttlDays).toBeLessThanOrEqual(60)
      expect(c.pin).toBeDefined()
      expect(c.source?.quote?.length).toBeGreaterThan(20)
    }
  })
})
