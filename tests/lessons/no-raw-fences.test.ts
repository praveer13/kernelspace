import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { ALL_LESSONS } from '../../src/data/lessons'
import { ProseView } from '../../src/pages/lesson/prose'

function mds(v: unknown, out: string[] = [], seen = new Set<object>()): string[] {
  if (!v || typeof v !== 'object' || seen.has(v)) return out
  seen.add(v)
  for (const [k, x] of Object.entries(v)) {
    if (k === 'md' && typeof x === 'string') out.push(x)
    else mds(x, out, seen)
  }
  return out
}

describe('no lesson prose shows a raw code fence', () => {
  test('every prose, callout and deep-dive md renders without ```', () => {
    let fenced = 0
    for (const l of ALL_LESSONS)
      for (const md of mds(l)) {
        if (md.includes('```')) fenced++
        const out = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProseView, { md, trackColor: '#fff' })))
        expect(out).not.toContain('```')
        // the inline-code rule splits a raw fence into `` + <code> + `` (never a literal ```), so also check the text
        expect(out.replace(/<[^>]*>/g, '')).not.toContain('``')
      }
    expect(fenced).toBeGreaterThan(0)
  })
})
