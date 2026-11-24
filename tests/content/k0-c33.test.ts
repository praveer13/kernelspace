import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { byId } from '@/data/claims/all'
import erratum from '@/data/errata/2026-11-22-t4-l3-prefill-ai-and-5ms-floor'

/**
 * K0-C33, t4.l3: prefill arithmetic intensity is seq_len FLOP/byte at FP16, and a batch-1 token on an H100 takes at least
 * about 5 ms, the weight read at peak bandwidth. Both figures are recomputed from the claims (the 8B parameter count and
 * the H100 SXM HBM bandwidth); the lesson and the erratum state the rounded results.
 */
const num = (id: string): number => {
  const c = byId[id]
  if (!c) throw new Error(`claim ${id} is not registered`)
  if (typeof c.value !== 'number') throw new Error(`claim ${id} is not a number`)
  return c.value
}

const PARAMS = num('model.llama3-8b.params') * 1e9 // billions of parameters → parameters
const BYTES_PER_WEIGHT = 2 // FP16
const WEIGHT_BYTES = PARAMS * BYTES_PER_WEIGHT
const BW = num('hw.h100-sxm.hbm-bw') * 1e12 // TB/s → B/s
const STEP_MS = (WEIGHT_BYTES / BW) * 1e3

const lessonSource = readFileSync(new URL('../../src/data/lessons/t4/roofline.ts', import.meta.url), 'utf8')

describe('K0-C33: the weight read and the prefill intensity', () => {
  test('16 GB of FP16 weights over 3.35 TB/s is 4.8 ms, which the lesson rounds to at least about 5 ms', () => {
    expect(Math.round(WEIGHT_BYTES / 1e9)).toBe(16)
    expect(STEP_MS.toFixed(1)).toBe('4.8')
    expect(Math.round(STEP_MS)).toBe(5)
  })

  test('prefill AI is 2 × seq_len FLOPs over 2 bytes per weight, which is seq_len FLOP/byte at FP16', () => {
    const seqLen = 2048
    const flopsPerWeight = 2 * seqLen
    expect(flopsPerWeight / BYTES_PER_WEIGHT).toBe(seqLen)
  })

  test('t4.l3 states AI = seq_len at FP16 and at least about 5 ms per token, not the old params/bytes factor or "physics"', () => {
    expect(lessonSource).toContain('seq_len FLOP/byte at FP16')
    expect(lessonSource).toContain('at least about 5 ms')
    expect(lessonSource).not.toContain('seq_len × (params/bytes)')
    expect(lessonSource).not.toContain('physics, not engineering')
    expect(lessonSource).not.toContain('the physics floor behind the 5 ms/token')
  })

  test('the erratum names t4.l3, is an error, and points at the earlier decode erratum', () => {
    expect(erratum.id).toBe('2026-11-22-t4-l3-prefill-ai-and-5ms-floor')
    expect(erratum.date).toBe('2026-11-22')
    expect(erratum.kind).toBe('error')
    expect(erratum.lessons).toEqual(['t4.l3'])
    expect(erratum.why).toContain('2026-10-04-decode-ai-is-one')
    for (const field of [erratum.before, erratum.after]) expect(field.length).toBeLessThanOrEqual(240)
  })
})
