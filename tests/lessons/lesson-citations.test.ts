/**
 * Lesson citations in prose (Wave 1 stage 0, task K1-3): every `T#.L#` / `R.L#` in a lesson's `md` field is a token (`[[l:t6.l12]]`), the token renders the same label the literal showed at today's order and
 * links to the lesson, and the allowlist names every literal deliberately left behind with its reason.
 *
 * The K1-1 ref snapshot proves the conversion moved no stored answer: no hashed field is touched.
 */
import { describe, expect, test } from 'bun:test'
import { createElement, Fragment, type ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { Lesson } from '../../src/data/lessons/types'
import {
  lessonCodeIn,
  lessonTokensIn,
  replaceLessonTokens,
  replaceLessonTokensWithLinks,
} from '../../src/lib/lesson-label'
import { renderInline } from '../../src/pages/lesson/markdown'
import { mdFields, remainingCitations, scanLessonCitations } from '../../scripts/tokenize-lesson-citations'

const ROOT = path.resolve(import.meta.dir, '../..')
const ALLOW = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/lesson-citation-allow.json'), 'utf8')) as {
  file: string
  literal: string
  reason: string
}[]
/** The citations the parent (before this part) held, in source order: what each token must be. */
const MAPPING = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/lesson-citations.json'), 'utf8')) as {
  file: string
  id: string
  literal: string
}[]

const relative = (file: string): string => path.relative(ROOT, file)

const render = (node: ReactNode): string =>
  renderToString(createElement(MemoryRouter, null, createElement(Fragment, null, node)))

const fixtureOrder = (): { id: string; trackId: Lesson['trackId'] }[] => {
  const list = ALL_LESSONS.map((l) => ({ id: l.id, trackId: l.trackId }))
  const from = list.findIndex((l) => l.id === 't6.l12')
  const [moved] = list.splice(from, 1)
  list.splice(list.findIndex((l) => l.id === 't6.l4') + 1, 0, moved)
  return list
}

describe('the prose citations', () => {
  test('no convertible citation remains in a lesson md field', () => {
    expect(remainingCitations()).toEqual([])
  })

  test('every literal left behind is allowlisted with a reason, and no allowlist row is unused', () => {
    const skipped = scanLessonCitations().filter((c) => c.skip !== null)
    for (const c of skipped) {
      const row = ALLOW.find((a) => relative(c.file) === a.file && a.literal === c.literal)
      expect(row, `${relative(c.file)}:${c.line} ${c.literal}`).toBeDefined()
      expect(row?.reason.length ?? 0).toBeGreaterThan(10)
    }
    for (const a of ALLOW) {
      expect(skipped.some((c) => relative(c.file) === a.file && c.literal === a.literal)).toBe(true)
    }
  })

  test('every token is the citation the parent held, in the same order, and names a real lesson', () => {
    const ids = new Set(ALL_LESSONS.map((l) => l.id))
    const current = new Map<string, string[]>()
    for (const field of mdFields()) {
      const found = lessonTokensIn(field.content)
      if (found.length === 0) continue
      const key = relative(field.file)
      current.set(key, [...(current.get(key) ?? []), ...found])
    }
    const expected = new Map<string, string[]>()
    for (const row of MAPPING) expected.set(row.file, [...(expected.get(row.file) ?? []), row.id])

    expect([...current.keys()].sort()).toEqual([...expected.keys()].sort())
    for (const [file, found] of expected) expect(current.get(file), file).toEqual(found)
    const total = [...current.values()].reduce((n, list) => n + list.length, 0)
    expect(total).toBe(MAPPING.length)
    expect(total).toBe(249)
    for (const row of MAPPING) {
      expect(ids.has(row.id), row.file).toBe(true)
      expect(row.literal).toBe(row.id.toUpperCase())
    }
  })

  test('at today\'s order a token renders the label the literal showed, and links to the lesson', () => {
    const html = render(renderInline('see [[l:t5.l7]] now'))
    expect(html).toContain('href="/lesson/t5.l7"')
    expect(html).toContain('>T5.L7<')
  })

  test('a token inside bold or emphasis is still a link; inline code stays literal; two tokens and punctuation work', () => {
    const bold = render(renderInline('**why [[l:t5.l8]] is smaller**'))
    expect(bold).toContain('href="/lesson/t5.l8"')
    expect(bold).toContain('>T5.L8<')
    const em = render(renderInline('*see [[l:t5.l7]]*'))
    expect(em).toContain('href="/lesson/t5.l7"')
    const code = render(renderInline('`[[l:t5.l7]]` and [[l:t4.l3]], [[l:t2.l4]].'))
    expect(code).toContain('>[[l:t5.l7]]</code>')
    expect(code).toContain('href="/lesson/t4.l3"')
    expect(code).toContain('href="/lesson/t2.l4"')
  })

  test('under the structure order a citation re-labels with its lesson, in the app text and the export', () => {
    const order = fixtureOrder()
    expect(lessonCodeIn('t6.l12')).toBe('T6.L12')
    expect(lessonCodeIn('t6.l12', order)).toBe('T6.L5')
    expect(replaceLessonTokens('read [[l:t6.l12]] after [[l:t6.l4]]', order)).toBe('read T6.L5 after T6.L4')
    expect(replaceLessonTokensWithLinks('read [[l:t6.l12]]')).toBe('read [T6.L12](/lesson/t6.l12)')
    expect(replaceLessonTokensWithLinks('read [[l:t6.l12]]', undefined, 'https://example.test/lesson')).toBe(
      'read [T6.L12](https://example.test/lesson/t6.l12)',
    )
    const html = render(renderInline('see [[l:t6.l12]] now', order))
    expect(html).toContain('>T6.L5<')
  })

  test('the token pattern does not match a bare lesson id, a drill or a cache size', () => {
    for (const text of ['t6.l12', 'R1', 'L2 cache', 'T3 L6']) expect(lessonTokensIn(text)).toEqual([])
    expect(lessonTokensIn('[[l:t6.l12]]')).toEqual(['t6.l12'])
  })
})
