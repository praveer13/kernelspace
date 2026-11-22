import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import type { ContentBlock } from '@/data/lessons/types'

const PAPER_URL = 'https://arxiv.org/abs/2309.06180'

const lesson = ALL_LESSONS.find((l) => l.id === 't2.l7')
if (!lesson) throw new Error('t2.l7 not found')

describe('t2.l7 links the PagedAttention paper where the exam asks the learner to read it (K0-A19)', () => {
  test('t2.l7 contains the arXiv abstract link', () => {
    expect(JSON.stringify(lesson)).toContain('arxiv.org/abs/2309.06180')
  })

  test('the first prose block links the paper title with an https link', () => {
    const first = lesson.blocks[0] as ContentBlock
    expect(first.type).toBe('prose')
    if (first.type !== 'prose') return
    expect(first.md).toContain(`["Efficient Memory Management for Large Language Model Serving with PagedAttention"](${PAPER_URL})`)
  })

  test('a field-note block for the paper follows the first prose block', () => {
    const note = lesson.blocks[1] as ContentBlock
    expect(note.type).toBe('field-note')
    if (note.type !== 'field-note') return
    expect(note.href).toBe(PAPER_URL)
    expect(note.source).toBe('Kwon et al.')
    expect(note.published).toBe("SOSP '23")
    expect(note.verified).toMatch(/^\d{4}-\d{2}$/)
  })

  test('every lesson whose title or first prose says "read the paper" links an https source', () => {
    for (const l of ALL_LESSONS) {
      const first = l.blocks[0]
      const firstMd = first && first.type === 'prose' ? first.md : ''
      const asks = /read the .*paper/i.test(l.title) || /read the .*paper/i.test(firstMd)
      if (!asks) continue
      expect(firstMd).toMatch(/\]\(https:\/\//)
    }
  })
})
