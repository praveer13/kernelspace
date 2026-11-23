import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import type { DiagramBlock } from '@/data/lessons/types'

// The renderer (src/pages/lesson/diagram.tsx) sets node text at a fixed 2.9 (label) and 2.2 (sub) in a 0-100
// viewBox, centred on the node, with no fitting. A monospace glyph is about 0.6 em wide. This is an estimate with a
// 5% tolerance; e2e/lesson-figures.spec.ts measures the real boxes.
const LABEL = 2.9
const SUB = 2.2
// Edge labels: 2.6, centred on the midpoint of the two node centres, baseline 1.2 above it.
const EDGE = 2.6
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

type Box = [number, number, number, number] // x0, y0, x1, y1

function rect(n: { x: number; y: number; w?: number; h?: number }): Box {
  return [n.x, n.y, n.x + (n.w ?? 18), n.y + (n.h ?? 9)]
}

function nodeText(n: { x: number; y: number; w?: number; h?: number; label: string; sub?: string }): Box {
  const cx = n.x + (n.w ?? 18) / 2
  const [top, bottom] = textRows(n)
  return [cx - half(n), top, cx + half(n), bottom]
}

function overlaps(a: Box, b: Box): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

// Collisions in lessons whose files belong to other tasks of this wave, listed for their owners to fix. The two
// tests below fail on any collision not listed here; an entry is removed when its figure is fixed.
const KNOWN = new Set([
  't1.l1 edge main->ret under main',
  't1.l4 node h2 over h1',
  't1.l4 node h2 over h3',
  't1.l4 node h4 over h3',
  't1.l4 node h4 over h5',
  't2.l6 edge app->sq under sq',
  't2.l6 edge sq->kern under sq',
  't3.l4 edge fut->io under fut',
  't3.l4 edge fut->io under io',
  't3.l4 edge wake->requeue under wake',
  't3.l4 edge wake->requeue under requeue',
  't4.l1 edge sm->w2 under sm',
  't4.l6 edge a->aslab under a',
  't4.l6 edge a->aslab under aslab',
  't4.l6 edge b->bslab under b',
  't4.l6 edge b->bslab under bslab',
  't5.l1 edge kvc->attn under attn',
])

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
  // The renderer paints edges first, then each node's rect with an opaque fill (#111722) when idle or dim, in node
  // order. Text under a later rect is hidden; text over an earlier one is drawn across a box it does not belong to.
  test('no node text runs over another node box', () => {
    const bad: string[] = []
    for (const { lesson, d } of found)
      d.nodes.forEach((a, i) => {
        const t = nodeText(a)
        d.nodes.forEach((b, j) => {
          if (i === j) return
          // A node drawn on top of an earlier node (t7.l3's regions on the frontier) is meant to sit inside it.
          if (j < i && overlaps(rect(a), rect(b))) return
          if (overlaps(t, rect(b))) bad.push(`${lesson} node ${a.id} over ${b.id}`)
        })
      })
    expect(bad.filter((x) => !KNOWN.has(x))).toEqual([])
  })
  test('no edge label lies under a node box', () => {
    const bad: string[] = []
    for (const { lesson, d } of found) {
      const centre = new Map(d.nodes.map((n) => [n.id, [n.x + (n.w ?? 18) / 2, n.y + (n.h ?? 9) / 2]]))
      for (const e of d.edges ?? []) {
        const a = centre.get(e.from)
        const b = centre.get(e.to)
        if (!e.label || !a || !b) continue
        const x = (a[0] + b[0]) / 2
        const y = (a[1] + b[1]) / 2 - 1.2
        const h = ((e.label.length * EDGE * GLYPH) / 2) * TOL
        const t: Box = [x - h, y - EDGE * 0.8, x + h, y + EDGE * 0.25]
        if (t[0] < 0 || t[2] > 100) bad.push(`${lesson} edge ${e.from}->${e.to} outside [0, 100]`)
        for (const n of d.nodes) if (overlaps(t, rect(n))) bad.push(`${lesson} edge ${e.from}->${e.to} under ${n.id}`)
      }
    }
    expect(bad.filter((x) => !KNOWN.has(x))).toEqual([])
  })
})
