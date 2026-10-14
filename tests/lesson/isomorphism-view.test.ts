/**
 * The isomorphism panel after it moved into src/components/lesson/Isomorphism.tsx (docs/specs/wave-3.md §2.3, task
 * 3a-03): the lesson dispatcher still renders it, and a real T2 panel mounts with its pairs and its "where it
 * breaks" lines as before. The panel is mounted in a small DOM (tests/dom/mini-dom.ts).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { IsomorphismView } from '../../src/components/lesson/Isomorphism'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { IsomorphismBlock, Lesson } from '../../src/data/lessons/types'
import { RenderBlock } from '../../src/pages/lesson/blocks'
import { installDom, type DomKit } from '../dom/mini-dom'

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

const t2: Lesson = ALL_LESSONS.find((l) => l.id === 't2.l1')!
const panel = t2.blocks.find((b): b is IsomorphismBlock => b.type === 'isomorphism')!

const count = (text: string, needle: string) => text.split(needle).length - 1

describe('IsomorphismView', () => {
  test('a T2 panel shows its title, both sides of every pair and a where-it-breaks line per break', async () => {
    const m = await dom.mount(createElement(IsomorphismView, { block: panel }))
    const text = m.container.textContent
    expect(panel.pairs.length).toBeGreaterThanOrEqual(2)
    expect(text).toContain(panel.title!)
    for (const p of panel.pairs) {
      for (const part of [p.os, p.osLine, p.llm, p.llmLine, p.breaks!]) expect(text).toContain(part)
    }
    expect(count(text, 'where it breaks:')).toBe(panel.pairs.filter((p) => p.breaks).length)
    expect(count(text, '≡')).toBe(panel.pairs.length)
    await m.unmount()
  })

  test('a pair without a break draws no where-it-breaks line, and a block without a title uses the default', async () => {
    const block: IsomorphismBlock = {
      type: 'isomorphism',
      pairs: [
        { os: 'page', osLine: 'a fixed unit', llm: 'block', llmLine: 'a fixed unit of KV' },
        { os: 'swap', osLine: 'spill to disk', llm: 'offload', llmLine: 'spill to host', breaks: 'disk is slower than host memory' },
      ],
    }
    const m = await dom.mount(createElement(IsomorphismView, { block }))
    const text = m.container.textContent
    expect(text).toContain('the same idea, twice')
    expect(count(text, 'where it breaks:')).toBe(1)
    expect(text).toContain('disk is slower than host memory')
    await m.unmount()
  })

  test('the lesson dispatcher renders the same panel as the component does', async () => {
    const direct = await dom.mount(createElement(IsomorphismView, { block: panel }))
    const viaLesson = await dom.mount(createElement(RenderBlock, { block: panel, lesson: t2, trackColor: '#22D3EE', h2Start: 0 }))
    expect(viaLesson.container.innerHTML).toBe(direct.container.innerHTML)
    expect(viaLesson.container.innerHTML.length).toBeGreaterThan(200)
    await direct.unmount()
    await viaLesson.unmount()
  })
})
