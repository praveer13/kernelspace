import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ContentBlock } from '../../src/data/lessons/types'
import { extractHeadings } from '../../src/pages/lesson/markdown'
import { ProseView } from '../../src/pages/lesson/prose'

const html = (md: string) => renderToStaticMarkup(createElement(ProseView, { md, trackColor: '#fff' }))

describe('ProseView fenced blocks', () => {
  test('a fence renders as one pre/code with the exact lines and no backticks', () => {
    const out = html('Before.\n\n```text\na = min( x , y )\n\nb = 2\n```\n\nAfter.')
    expect(out).toContain('<pre')
    expect(out).toContain('a = min( x , y )\n\nb = 2')
    expect(out).not.toContain('```')
    expect(out).toContain('After.')
  })
  test('a fence right after a paragraph line opens its own block', () => {
    const out = html('Run it:\n```sh\nls -la\n```')
    expect(out).toContain('<p')
    expect(out).toContain('Run it:')
    expect(out).toContain('<pre')
    expect(out).not.toContain('```')
    expect(out).not.toContain('<p class="my-5 max-w-measure text-body-lg leading-[1.65] text-text-2 first:mt-0 last:mb-0">Run it: ')
  })
  test('markup inside a fence stays literal and a ## line is not an H2', () => {
    const out = html('```\n## not a heading\n**bold** | a | b\n- item\n```')
    expect(out).not.toContain('<h2')
    expect(out).not.toContain('<strong')
    expect(out).not.toContain('<table')
    expect(out).not.toContain('<ul')
    expect(out).toContain('## not a heading')
  })
  test('extractHeadings ignores ## lines inside fences', () => {
    const blocks = [{ type: 'prose', md: '## Real\n```\n## Fake\n### Fake3\n```\n### Real3' }] as ContentBlock[]
    expect(extractHeadings(blocks).map((h) => h.text)).toEqual(['Real', 'Real3'])
  })
})
