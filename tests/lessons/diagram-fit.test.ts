import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import type { DiagramBlock } from '@/data/lessons/types'

// The renderer (src/pages/lesson/diagram.tsx) sets node text at a fixed 2.9 (label) and 2.2 (sub) in a 0-100
// viewBox, centred on the node, with no fitting. A monospace glyph is about 0.6 em wide. This is an estimate with a
// 5% tolerance; e2e/lesson-figures.spec.ts measures the real boxes.
const LABEL = 2.9
const SUB = 2.2
const GLYPH = 0.6
const TOL = 1.05

function diagrams(v: unknown, out: DiagramBlock[] = []): DiagramBlock[] {
  if (Array.isArray(v)) for (const x of v) diagrams(x, out)
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.type === 'diagram' && Array.isArray(o.nodes)) out.push(o as unknown as DiagramBlock)
    else for (const x of Object.values(o)) diagrams(x, out)
  }
  return out
}

function half(n: { label: string; sub?: string }): number {
  const w = Math.max(n.label.length * LABEL, (n.sub?.length ?? 0) * SUB) * GLYPH
  return (w / 2) * TOL
}

// Vertical extent of the drawn text: the label baseline sits 0.6 above the node's middle (1 below it with no sub),
// the sub baseline 2.6 below it. Ascent and descent are taken as 0.8 and 0.25 of the font size.
function textRows(n: { y: number; h?: number; sub?: string }): [number, number] {
  const mid = n.y + (n.h ?? 9) / 2
  return n.sub ? [mid - 0.6 - LABEL * 0.8, mid + 2.6 + SUB * 0.25] : [mid + 1 - LABEL * 0.8, mid + 1 + LABEL * 0.25]
}

const found: { lesson: string; d: DiagramBlock }[] = []
for (const l of ALL_LESSONS) for (const d of diagrams(l)) found.push({ lesson: l.id, d })

describe('lesson diagram text fits its figure', () => {
  test('there are diagrams to check', () => {
    expect(found.length).toBeGreaterThan(20)
  })
  test('every node text box lies inside [0, 100]', () => {
    const bad: string[] = []
    for (const { lesson, d } of found)
      for (const n of d.nodes) {
        const cx = n.x + (n.w ?? 18) / 2
        const h = half(n)
        if (cx - h < 0 || cx + h > 100)
          bad.push(`${lesson} "${d.caption}" node ${n.id}: ${(cx - h).toFixed(1)}..${(cx + h).toFixed(1)}`)
      }
    expect(bad).toEqual([])
  })
  test('no node text box overlaps another node text box', () => {
    const bad: string[] = []
    for (const { lesson, d } of found)
      for (let i = 0; i < d.nodes.length; i++)
        for (let j = i + 1; j < d.nodes.length; j++) {
          const a = d.nodes[i]
          const b = d.nodes[j]
          const ca = a.x + (a.w ?? 18) / 2
          const cb = b.x + (b.w ?? 18) / 2
          const ha = half(a)
          const hb = half(b)
          const ya = textRows(a)
          const yb = textRows(b)
          const xOver = ca - ha < cb + hb && cb - hb < ca + ha
          const yOver = ya[0] < yb[1] && yb[0] < ya[1]
          if (xOver && yOver) bad.push(`${lesson} "${d.caption}": ${a.id} and ${b.id}`)
        }
    expect(bad).toEqual([])
  })
})
