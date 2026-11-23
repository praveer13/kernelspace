import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ALL_LESSONS } from '@/data/lessons'

/**
 * K0-FIX-T5-BLOCKS, the lane review's fixes: the block-table explorer names no copy size beside the task that asks
 * for it, no lesson doubles an engine's name in front of a release that already carries it, and fig 1 of t5.l5 draws
 * tables that are true at every step, in nodes wide enough for their text.
 */
const read = (p: string) => readFileSync(p, 'utf8')

describe('the block-table explorer names no copy size', () => {
  const src = read('src/components/sims/BlockTableExplorer.tsx')
  test('no "<n>-token copy" sentence: the copy size is what blk.cow asks the learner to predict', () => {
    expect(src.match(/\d+-token copy/)?.[0] ?? null).toBeNull()
  })
  test('the diverge control and its sentence read the logical block from the model', () => {
    expect(src.match(/diverge B at L\d/)?.[0] ?? null).toBeNull()
    expect(src.match(/logical block \d/)?.[0] ?? null).toBeNull()
    expect(src.includes('diverge B at L{DIVERGE_AT}')).toBe(true)
  })
})

describe('no lesson doubles an engine name before a release that carries it', () => {
  const all = JSON.stringify(ALL_LESSONS)
  test.each(['vLLM vLLM', 'SGLang SGLang'])('%s appears nowhere', (doubled) => {
    const i = all.indexOf(doubled)
    expect(i === -1 ? null : all.slice(Math.max(0, i - 40), i + 60)).toBeNull()
  })
  test('the generated t5.l5 page agrees', () => {
    expect(read('public/lessons-md/t5.l5.md').includes('vLLM vLLM')).toBe(false)
  })
})

describe('t5.l5 fig 1 draws what is true at every step', () => {
  const lesson = ALL_LESSONS.find((l) => l.id === 't5.l5')
  const fig = lesson?.blocks.find((b) => b.type === 'diagram')
  if (!fig || fig.type !== 'diagram') throw new Error('t5.l5 has no diagram')
  const node = (id: string) => fig.nodes.find((n) => n.id === id)

  test("beam A's table starts as a copy of beam B's and shows its change to block 9", () => {
    const b = node('seqB')?.sub ?? ''
    const a = node('seqA')?.sub ?? ''
    expect(b).toBe('[7, 3, 12]')
    expect(a.startsWith(`${b} → `)).toBe(true)
    expect(a.endsWith('[7, 3, 9]')).toBe(true)
  })

  // src/pages/lesson/diagram.tsx draws labels at fontSize 2.9 and subs at 2.2 in JetBrains Mono, whose advance is
  // 0.6 em; a node's text must fit its width (default 18) with a little room on each side.
  test('every label and sub fits inside its node', () => {
    for (const n of fig.nodes) {
      const w = n.w ?? 18
      expect({ id: n.id, fits: n.label.length * 0.6 * 2.9 <= w - 1 }).toEqual({ id: n.id, fits: true })
      if (n.sub) expect({ id: n.id, fits: n.sub.length * 0.6 * 2.2 <= w - 1 }).toEqual({ id: n.id, fits: true })
    }
  })

  test('no two nodes overlap', () => {
    const ns = fig.nodes.map((n) => ({ id: n.id, x0: n.x, y0: n.y, x1: n.x + (n.w ?? 18), y1: n.y + (n.h ?? 9) }))
    for (const a of ns)
      for (const b of ns) {
        if (a.id >= b.id) continue
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
        expect({ pair: `${a.id}/${b.id}`, overlap }).toEqual({ pair: `${a.id}/${b.id}`, overlap: false })
      }
  })
})
