/**
 * K0-FIX2-T5: the t5 lane's second fix round. The t5.l3 ITL chip says what erratum 2026-11-22-t5-l3-itl-reading-speed's
 * `after` says, and no more: no note to the learner about how the course sourced it.
 */
import { describe, expect, test } from 'bun:test'
import { lessonById } from '@/data/lessons'
import erratum from '@/data/errata/2026-11-22-t5-l3-itl-reading-speed'

type Stat = { label: string; hint?: string }
const itlHint = (): string => {
  const lesson = lessonById('t5.l3') as unknown as { blocks: { type: string; stats?: Stat[] }[] }
  const stats = lesson.blocks.flatMap((b) => (b.type === 'statline' ? (b.stats ?? []) : []))
  const chip = stats.find((s) => s.label === 'ITL comfort')
  if (chip?.hint === undefined) throw new Error('t5.l3 has no ITL comfort chip with a hint')
  return chip.hint
}

describe('t5.l3: the ITL comfort chip', () => {
  test('speaks of reading, not of the course\'s own sourcing', () => {
    const hint = itlHint()
    expect(hint).not.toContain('The course knows')
    expect(hint).not.toContain('title and citation')
    expect(hint).not.toContain('no figure of its own')
  })
  test('says what the erratum\'s after says: adult silent reading is far slower than 50 ms per token (K0-FIX4-T5 names no study)', () => {
    const hint = itlHint()
    expect(erratum.after).toContain('Adult silent reading is far slower than 50 ms per token')
    expect(hint).toContain('Adult silent reading is far slower than 50 ms per token')
  })
  test('gives no reading-speed figure, as the erratum\'s why says', () => {
    expect(itlHint()).not.toMatch(/words per minute|wpm/)
    expect(itlHint().match(/\d+\s*ms/g)).toEqual(['50 ms'])
  })
})
