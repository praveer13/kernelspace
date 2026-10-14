/**
 * Alignment items in the R lessons (docs/specs/wave-2.md §17.2, task CF3 of the 2c review fixes):
 *  - the lesson records `item:<lesson>.align.<n>` with the n that scripts/item-pools.ts gives the same item,
 *    counting from 1;
 *  - every item is answerable in every codeLang setting: the language switch can hide the alternate, so a stem
 *    quotes what it needs and never points at a version "above".
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import AlignItem, { alignItem, alignResponse } from '../../src/components/lesson/AlignItem'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { CodeBlockData } from '../../src/data/lessons/types'
import { gradeItem, playView, resultFor } from '../../src/lib/items/play'
import { getProgress, useProgress, type CodeLang } from '../../src/lib/progress'
import { alignStartOf } from '../../src/pages/lesson/blocks'
import { collectAlignItems } from '../../scripts/item-pools'

/** The lesson's alignment items as the lesson plays them: the block, the item's number from 1 and the question. */
function played() {
  return ALL_LESSONS.flatMap((lesson) =>
    lesson.blocks.flatMap((block) =>
      block.type === 'code' ? (block.align ?? []).map((q, i) => ({ lesson, block, n: alignStartOf(lesson, block) + i, q })) : [],
    ),
  )
}

describe('alignment item refs agree with the gates (item-pools numbers from 1)', () => {
  const pool = collectAlignItems(ALL_LESSONS)

  test('the R lessons author alignment items, and the pool collects every one', () => {
    expect(played().length).toBeGreaterThanOrEqual(7)
    expect(pool).toHaveLength(played().length)
    expect(new Set(pool.map((p) => p.ref)).size).toBe(pool.length)
  })

  test('the first item of a lesson is align.1, and the numbers run on across code blocks', () => {
    const l4 = pool.filter((p) => p.lessonId === 'r.l4').map((p) => p.ref)
    expect(l4[0]).toBe('item:r.l4.align.1')
    for (const lesson of ALL_LESSONS) {
      const refs = pool.filter((p) => p.lessonId === lesson.id).map((p) => p.ref)
      expect(refs).toEqual(refs.map((_, i) => `item:${lesson.id}.align.${i + 1}`))
    }
  })

  test('the ref the lesson plays and the ref AlignItem records equal the ref item-pools collects for the same item', () => {
    const items = played()
    expect(items.map((p) => `item:${p.lesson.id}.align.${p.n}`)).toEqual(pool.map((p) => p.ref))
    items.forEach(({ lesson, n, q }, k) => {
      const item = alignItem(lesson.id, n, q, lesson.kcs)
      expect(playView(item, 3).ref).toBe(pool[k].ref)
      const response = { kind: 'choice' as const, picks: ['0'] }
      const record = alignResponse(lesson.id, resultFor(item, response, gradeItem(item, response), { seed: 3, ms: 900 }))
      expect(record.ref).toBe(pool[k].ref)
      expect(record.data).toMatchObject({ src: 'lesson', lessonId: lesson.id })
    })
  })

  test('a block with items numbers them after the items of the blocks before it', () => {
    const two = (a: number, b: number): CodeBlockData => ({ type: 'code', code: 'x', lang: 'rust', align: Array.from({ length: a + b }, () => ({ q: 'q', options: ['a', 'b'], correct: [0] })) })
    const lesson = { ...ALL_LESSONS[0], blocks: [two(0, 0), two(1, 1), two(2, 0)] }
    expect(lesson.blocks.map((b) => alignStartOf(lesson, b))).toEqual([1, 1, 3])
  })

  test('the rendered item is labelled with its number from 1', () => {
    const { lesson, n, q } = played()[0]
    const html = renderToStaticMarkup(createElement(AlignItem, { lessonId: lesson.id, n, q, seed: 1 }))
    expect(html).toContain(`aria-label="Alignment item ${n}"`)
    expect(n).toBe(1)
  })
})

describe('every alignment item is answerable in every codeLang setting', () => {
  // The switch can show Java, Python or only the Rust, so a stem that says "the version above" would point at
  // nothing. A stem names a language only to quote what that language's program does.
  const POINTS_AT_A_VERSION = /\b(above|below|familiar|the (java|python)( and (java|python))? versions?|your own language|this version)\b/i
  const NAMES_A_LANGUAGE = /\b(java|python)\b/i
  const QUOTES_THE_RUN = /\b(runs?|compiles?|throws?|prints?|never stops|loops?)\b/i

  test('no stem points at a version the learner may not be shown', () => {
    for (const { lesson, n, q } of played()) {
      expect({ ref: `${lesson.id}.align.${n}`, points: POINTS_AT_A_VERSION.exec(q.q)?.[0] }).toEqual({ ref: `${lesson.id}.align.${n}`, points: undefined })
    }
  })

  test('a stem that names Java or Python says what that program does', () => {
    for (const { lesson, n, q } of played()) {
      if (NAMES_A_LANGUAGE.test(q.q)) expect({ ref: `${lesson.id}.align.${n}`, quotes: QUOTES_THE_RUN.test(q.q) }).toEqual({ ref: `${lesson.id}.align.${n}`, quotes: true })
    }
  })

  const initial = getProgress()
  const setLang = (codeLang: CodeLang | undefined) => useProgress.setState({ settings: { ...getProgress().settings, codeLang } })
  afterEach(() => useProgress.setState({ settings: initial.settings }))

  test('the stem and all four options render whatever settings.codeLang says', () => {
    for (const lang of [undefined, 'rust', 'java', 'python'] as const) {
      setLang(lang)
      for (const { lesson, n, q } of played()) {
        const html = renderToStaticMarkup(createElement(AlignItem, { lessonId: lesson.id, n, q, lessonKcs: lesson.kcs, seed: 7 })).replace(/<!-- -->/g, '')
        const text = html.replace(/<[^>]+>/g, '')
        const plain = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;')
        expect({ lang, ref: `${lesson.id}.align.${n}`, stem: html.includes(plain(q.q)) }).toEqual({ lang, ref: `${lesson.id}.align.${n}`, stem: true })
        for (const o of q.options) expect(text.includes(plain(o).replace(/<[^>]+>/g, ''))).toBe(true)
      }
    }
  })
})
