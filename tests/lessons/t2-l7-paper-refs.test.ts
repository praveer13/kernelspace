import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'

// Headings and figure captions of Kwon et al., "Efficient Memory Management for Large Language Model
// Serving with PagedAttention" (arXiv 2309.06180v1), as the paper's own contents list gives them.
const SECTIONS = new Set([
  '1', '2', '2.1', '2.2', '2.3', '3', '3.1',
  '4', '4.1', '4.2', '4.3', '4.4', '4.5', '4.6',
  '5', '5.1', '5.2', '6', '6.1', '6.2', '6.3', '6.4', '6.5',
  '7', '7.1', '7.2', '7.3', '8', '9', '10',
])
const FIGURE_CAPTIONS: Record<string, string> = {
  '2': 'Average percentage of memory wastes',
  '4': 'vLLM system overview',
  '8': 'Parallel sampling example',
}

const lesson = ALL_LESSONS.find((l) => l.id === 't2.l7')
if (!lesson) throw new Error('t2.l7 not found')
const text = JSON.stringify(lesson).replace(/\\'/g, "'")

describe('t2.l7 cites only sections and figures the PagedAttention paper has (K0-C17)', () => {
  test('every section reference is a heading of the paper', () => {
    const cited = [...text.matchAll(/§(\d+(?:\.\d+)?)(?:–(\d+(?:\.\d+)?))?/g)]
    expect(cited.length).toBeGreaterThan(5)
    for (const m of cited) {
      expect(SECTIONS.has(m[1]!)).toBe(true)
      if (m[2]) expect(SECTIONS.has(m[2])).toBe(true)
    }
  })

  test('every figure reference is a figure the table knows, and the lesson names it by its caption', () => {
    const figs = new Set([...text.matchAll(/Figure (\d+)/g)].map((m) => m[1]!))
    expect([...figs].sort()).toEqual(['2', '4', '8'])
    for (const n of figs) expect(Object.keys(FIGURE_CAPTIONS)).toContain(n)
  })

  test('the fork() diagram is Figure 8 and Figure 4 is the system overview', () => {
    expect(text).toContain('Figure 8 (\\"Parallel sampling example\\") is the fork() diagram')
    expect(text).toContain('Figure 4 is the system overview')
    expect(text).not.toMatch(/Figure 4 is the fork/)
    expect(FIGURE_CAPTIONS['8']).toBe('Parallel sampling example')
  })

  test('the preemption stem cites section 4.5, where the paper puts scheduling and preemption', () => {
    expect(text).toContain('preemption debate in §4.5 mirrors')
    expect(text).not.toContain('preemption debate in §4 mirrors')
  })
})
