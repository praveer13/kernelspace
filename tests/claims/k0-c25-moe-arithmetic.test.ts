import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { byId } from '@/data/claims/all'
import { MOE_CLAIMS } from '@/data/claims/lazy/moe'
import erratum from '@/data/errata/2026-11-22-t6-l1-moe-18x-is-batch-1-and-round-trips'
import { ALL_LESSONS, lessonById } from '@/data/lessons'

/**
 * K0-C25: t6.l1's three figures. Total and active parameters, routed experts, experts per token and num_hidden_layers
 * come from the DeepSeek-V3 claims (zoo.deepseek-v3.layers holds the layer count). No claim holds the other four config
 * fields, so they are typed below: hidden_size, moe_intermediate_size, first_k_dense_replace and n_shared_experts, as
 * config.json at e815299 gives them (read 2026-11-22 and again 2026-11-23). Nothing ties these four constants to the pin;
 * a re-read of the config must check them.
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
const LAYERS = num('zoo.deepseek-v3.layers')
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
  test("one dispatch and one combine in each of 58 MoE layers is 116, and the lesson's chip says 2 × 58", () => {
    expect(2 * (LAYERS - DENSE)).toBe(116)
    const stats = lessonById('t6.l1')!.blocks.flatMap((b) => (b.type === 'statline' ? b.stats : []))
    const chip = stats.find((s) => s.label === 'all-to-alls per forward')
    expect(chip?.value).toBe(`2 × ${LAYERS - DENSE}`)
    expect(chip?.hint).toContain(`${LAYERS - DENSE} of ${LAYERS}; the first ${DENSE} are dense`)
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
  test('the lesson builds the sizes, the layer counts and the all-to-all count from the claims, and types none of them', () => {
    const text = JSON.stringify(lessonById('t6.l1'))
    expect(text).toContain(`whole model at batch 1 (${TOTAL}B ÷ ${ACTIVE}B)`)
    expect(text).toContain(`for the whole model (${TOTAL}B ÷ ${ACTIVE}B)`)
    expect(text).toContain(`DeepSeek-V3 has ${LAYERS} layers, but the first ${DENSE} are dense`)
    expect(text).toContain(`2 × ${LAYERS - DENSE} = ${2 * (LAYERS - DENSE)} trips per forward pass`)
    expect(text).toContain(`about ${ACTIVE} GB of weights`)
    expect(text).toContain(`about ${TOTAL} GB of weights in HBM`)
    const source = readFileSync(new URL('../../src/data/lessons/t6/moe-anatomy.ts', import.meta.url), 'utf8')
    for (const typed of ['671B ÷ 37B', '671B / 37B', 'Total parameters: 671B', 'has 61 layers', '58 of 61', "value: '2 × 58'"]) {
      expect(source).not.toContain(typed)
    }
    // K0-CLOSE-B: no other spelling of the totals, the active count, the layer counts or the all-to-all count either
    // (671, 37, 61, 58 and 116, and the 74 GB and 296 GB lures worked from 37), in prose, items, comments or the ticket.
    expect(source.match(/\b(671|37|61|58|116|74|296)\b/g) ?? []).toEqual([])
  })
  // K0-CLOSE2-B: the MLA quiz explanation once held a ${...} placeholder inside a single-quoted string, so the learner
  // read the raw template text after submitting. The ratio is worked here from the same bytes the lesson uses: a
  // 576-element BF16 latent in every layer against Llama-3-70B's 327,680 B per token.
  test("the MLA explanation renders the ratio, ~4.7× against Llama-3-70B, not the template text", () => {
    const ratio = (327_680 / (576 * 2 * LAYERS)).toFixed(1)
    expect(ratio).toBe('4.7')
    const quiz = lessonById('t6.l1')!.blocks.flatMap((b) => (b.type === 'quiz' ? b.questions : []))
    const mla = quiz.find((q) => q.q.startsWith("MLA's contribution"))
    expect(mla?.explanation).toContain(`It shrinks the cache ~${ratio}× against Llama-3-70B`)
    expect(mla?.explanation).not.toContain('${')
  })
})

describe('every lesson renders its template text', () => {
  test("no lesson's data holds a raw ${ placeholder", () => {
    const leaks = ALL_LESSONS.filter((l) => JSON.stringify(l).includes('${')).map((l) => l.id)
    expect(leaks).toEqual([])
  })
})
