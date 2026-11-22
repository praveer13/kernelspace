import { describe, expect, test } from 'bun:test'
import { claimNumber, getClaim } from '@/data/claims'
import { ALL_LESSONS } from '@/data/lessons'

// K0-E5: the paper's Section 1 range. Its two claims cite the page that holds the quote and say which Orca runs
// they cover; t1.l4 renders the range as its chip and words the vLLM KV blocks bullet the same way.

const LOW = 'model.kv.static-utilization-low'
const HIGH = 'model.kv.static-utilization-high'
const lesson = ALL_LESSONS.find((l) => l.id === 't1.l4')
if (!lesson) throw new Error('t1.l4 not found')

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const all = strings(lesson.blocks)

describe('the two claims cite the page that holds their quote', () => {
  for (const id of [LOW, HIGH]) {
    test(`${id}: the HTML page, not the abstract page`, () => {
      const url = getClaim(id).source?.url ?? ''
      expect(url).toContain('arxiv.org/html/2309.06180v')
      expect(url).not.toContain('/abs/')
    })
  }
})

describe('the boundary says which runs the range covers', () => {
  const b = getClaim(LOW).boundary ?? ''
  test('it names Orca (Max) and Orca (Oracle)', () => {
    expect(b).toContain('Orca (Max)')
    expect(b).toContain('Orca (Oracle)')
  })
  test('it does not say every system in the range pre-allocates the maximum length, nor name FasterTransformer as in it', () => {
    expect(b).not.toMatch(/systems that pre-allocate the maximum length/)
    expect(b).not.toContain('(FasterTransformer, Orca)')
  })
  test('the labels name the variants', () => {
    expect(getClaim(LOW).label).toContain('Orca (Max)')
    expect(getClaim(HIGH).label).toContain('Orca (Oracle)')
    for (const id of [LOW, HIGH]) expect(getClaim(id).label).not.toMatch(/worst|best/)
  })
})

describe('t1.l4 renders the range from the claims', () => {
  const low = claimNumber(LOW)
  const high = claimNumber(HIGH)
  test('the chip is the range of KV memory not holding token states, in t5.l5 form', () => {
    const block = lesson.blocks.find((b) => b.type === 'statline')
    if (block?.type !== 'statline') throw new Error('no statline block')
    const range = `${(100 - high).toFixed(1)}–${(100 - low).toFixed(1)}%`
    const chip = block.stats.find((s) => s.value === range)
    expect(chip).toBeDefined()
    expect(chip?.hint).toContain('Section 1')
  })
  test("no string contains '60%+'", () => {
    for (const s of all) expect(s).not.toContain('60%+')
  })
  test('the vLLM KV blocks bullet words the range as the Orca runs, from the claims', () => {
    const bullet = all.find((s) => s.includes('vLLM KV blocks'))
    expect(bullet).toBeDefined()
    expect(bullet).toContain(`Orca kept token states in only ${low}% of its KV memory when it reserved each request's maximum length, and in ${high}% even when told the true length`)
    expect(bullet).not.toContain('which is arithmetic')
    expect(bullet).not.toContain('sized to max length')
  })
  test("the bullet has no two consecutive sentences that both start \"The paper's\"", () => {
    const bullet = all.find((s) => s.includes('vLLM KV blocks')) ?? ''
    const sentences = bullet.split(/(?<=[.!?])\s+/)
    for (let i = 1; i < sentences.length; i++) {
      expect(sentences[i - 1].startsWith("The paper's") && sentences[i].startsWith("The paper's")).toBe(false)
    }
  })
})
