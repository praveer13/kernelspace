import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'

/** Every string in a lesson: prose, chips, hints, labels. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out))
  return out
}

// "DeepSeek production" / "DeepSeek-R1's production" within 80 characters of "MTP-3", either order.
const PRODUCTION = String.raw`DeepSeek(?:-R1)?(?:'s)?(?: own)? production`
const NEAR = new RegExp(`${PRODUCTION}[\\s\\S]{0,80}MTP-3|MTP-3[\\s\\S]{0,80}${PRODUCTION}`, 'i')

describe('K0-C4: DeepSeek ran MTP-1 in production; MTP-3 is NVIDIA\'s setting', () => {
  test('no lesson or chip says DeepSeek production next to MTP-3', () => {
    const hits: string[] = []
    for (const l of ALL_LESSONS) for (const s of strings(l.blocks)) if (NEAR.test(s)) hits.push(`${l.id}: ${s.slice(0, 80)}`)
    expect(hits).toEqual([])
  })

  test('the pattern would catch the old wording', () => {
    expect(NEAR.test("this is what DeepSeek-R1's production stack runs (MTP-3: that one module")).toBe(true)
    expect(NEAR.test('MTP-3 DeepSeek-R1 production drafter')).toBe(true)
  })

  test('t6.l6 chip names MTP-1 and the lesson places MTP-3 with NVIDIA', () => {
    const l = ALL_LESSONS.find((x) => x.id === 't6.l6')!
    const text = strings(l.blocks).join('\n')
    expect(text).toMatch(/NVIDIA's TensorRT-LLM/)
    const chip = (l.blocks.find((b) => b.type === 'statline') as { stats: { value: string; label: string }[] }).stats.find((s) => s.value === 'MTP-1')
    expect(chip?.label).toContain('before DSpark')
  })
})
