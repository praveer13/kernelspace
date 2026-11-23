import { describe, expect, test } from 'bun:test'
import { byId } from '@/data/claims/all'
import { MOE_CLAIMS } from '@/data/claims/lazy/moe'
import erratum from '@/data/errata/2026-11-22-t6-l1-moe-18x-is-batch-1-and-round-trips'
import { lessonById } from '@/data/lessons'

/**
 * K0-C25: t6.l1's three figures, recomputed from the DeepSeek-V3 claims. The config (hidden 7168, moe_intermediate_size 2048,
 * 61 layers, first_k_dense_replace 3, one shared expert) was read on 2026-11-22; the config constants below are those rows.
 */
const num = (id: string): number => {
  const c = byId[id] ?? MOE_CLAIMS.find((m) => m.id === id)
  if (!c || typeof c.value !== 'number') throw new Error(`claim ${id} is not a number`)
  return c.value
}
const TOTAL = num('model.deepseek-v3.total-params')
const ACTIVE = num('model.deepseek-v3.active-params')
const ROUTED = num('model.deepseek-v3.routed-experts')
const TOPK = num('model.deepseek-v3.experts-per-token')
const HIDDEN = 7168
const MOE_FF = 2048
const LAYERS = 61
const DENSE = 3
const SHARED = 1

describe('t6.l1 MoE arithmetic', () => {
  test('the whole model at batch 1 is ~18x', () => {
    expect((TOTAL / ACTIVE).toFixed(1)).toBe('18.1')
  })
  test('the expert path alone is ~28x: 9 of 257 experts', () => {
    const perExpert = 3 * HIDDEN * MOE_FF
    expect(perExpert).toBe(44_040_192)
    const moeLayers = LAYERS - DENSE
    const allB = ((ROUTED + SHARED) * perExpert * moeLayers) / 1e9
    const activeB = ((TOPK + SHARED) * perExpert * moeLayers) / 1e9
    expect(allB.toFixed(1)).toBe('656.5')
    expect(activeB.toFixed(1)).toBe('23.0')
    expect(((ROUTED + SHARED) / (TOPK + SHARED)).toFixed(1)).toBe('28.6')
    expect(ROUTED / TOPK).toBe(32)
  })
  test('one dispatch and one combine in each of 58 MoE layers is 116', () => {
    expect(2 * (LAYERS - DENSE)).toBe(116)
  })
  test('the lesson and the erratum state the corrected figures', () => {
    const text = JSON.stringify(lessonById('t6.l1'))
    expect(text).toContain('at batch 1')
    expect(text).toContain('about 28')
    expect(text).toContain('one dispatch and one combine in each of the 58 MoE layers')
    expect(text).not.toContain('round-trip × 2 × layers')
    expect(text).not.toContain('every frontier open model')
    expect(text).toContain('cost profit margin')
    expect(erratum.lessons).toEqual(['t6.l1'])
  })
})
