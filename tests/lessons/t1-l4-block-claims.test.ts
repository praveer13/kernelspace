import { describe, expect, test } from 'bun:test'
import { claimNumber, getClaim } from '@/data/claims'
import { ALL_LESSONS } from '@/data/lessons'

const lesson = ALL_LESSONS.find((l) => l.id === 't1.l4')
if (!lesson) throw new Error('t1.l4 not found')

/** Every string reachable from the lesson, however deep. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const all = strings(lesson.blocks)

describe('t1.l4 block-size claims (K0-D14)', () => {
  test('every claims id on a prequestion resolves once the lesson is imported', () => {
    const ids: string[] = []
    for (const b of lesson.blocks) if (b.type === 'predict') for (const p of b.items) ids.push(...(p.claims ?? []))
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(() => getClaim(id)).not.toThrow()
  })

  test('the 16-token prequestion is keyed to the paper, not to vLLM default', () => {
    const block = lesson.blocks.find((b) => b.type === 'predict')
    if (block?.type !== 'predict') throw new Error('no predict block')
    const numeric = block.items.find((p) => p.kind === 'numeric')
    expect(numeric?.claims).toEqual(['serving.pagedattention.paper-block-size'])
    expect(claimNumber('serving.pagedattention.paper-block-size')).toBe(16)
  })

  test("the prose carries vLLM's default from the claim and the paper's 16", () => {
    const text = all.join('\n')
    expect(text).toContain(String(claimNumber('production.vllm.block-size')))
    expect(text).toContain(`⌈300/${claimNumber('production.vllm.block-size')}⌉`)
    expect(text).toContain('⌈300/16⌉ = 19')
  })

  test("no string calls <4% the paper's figure or headline", () => {
    // the 4% is the course's estimate (synthetic.kv.paged-waste); the paper's words are near-zero waste
    for (const s of all) expect(s).not.toMatch(/headline/i)
    const chip = lesson.blocks.find((b) => b.type === 'statline')
    if (chip?.type !== 'statline') throw new Error('no statline block')
    const waste = chip.stats.find((x) => x.value === '<4%')
    expect(waste?.label).toContain('course estimate')
    expect(waste?.hint).toContain('is not in the paper\'s text')
  })

  test("the mixed-batch waste names its block size and is computed for both: 1.4% at 16, 8.1% at 64", () => {
    const text = all.join('\n')
    expect(text).toContain("1.4% at the paper's 16-token blocks, under 4%, and 8.1% at vLLM's 64")
    expect(text).not.toMatch(/a figure the paper does not report|came from the course/)
    expect(JSON.stringify(ALL_LESSONS.find((l) => l.id === 't5.l5'))).toContain("1.4% at the paper's 16-token blocks, under 4%, and 8.1% at vLLM's 64")
  })

  test('no string types vLLM default as 16', () => {
    for (const s of all) expect(s).not.toMatch(/default 16\b|16-token default/)
  })
})
