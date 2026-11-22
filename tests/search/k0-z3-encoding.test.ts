import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ALL_CLAIMS, lazyGroupFor } from '../../src/data/claims/all'
import { PAIRS } from '../../src/data/glossary'
import { KCS } from '../../src/data/kc'
import { ALL_LESSONS, lessonById } from '../../src/data/lessons'
import { PLAYS } from '../../src/data/plays'
import { extractHeadings, slugify } from '../../src/pages/lesson/markdown'
import { buildSearchIndex, encodeSearchIndex, INDEX_PATH, UNINDEXED_GROUPS } from '../../scripts/build-search-index'
import { decodeSearchIndex, headingSlug, indexItems, type EncodedSearchIndex } from '../../src/lib/search'

/**
 * K0-Z3 (docs/specs/k0.md K0-Z-D16): the committed ⌘K index is an encoding of the same rows. Decoding it gives back,
 * row for row, what the version-1 file held (that file was `JSON.stringify` of `buildSearchIndex()`'s rows), so the
 * palette searches and shows exactly what it did; and every lesson, concept, play and glossary row is there, with every
 * claim but those of `UNINDEXED_GROUPS`.
 */
const root = resolve(import.meta.dir, '../..')
const encoded = JSON.parse(readFileSync(join(root, INDEX_PATH), 'utf8')) as EncodedSearchIndex
const decoded = decodeSearchIndex(encoded)
/** What the version-1 file held: the built rows through a JSON round trip. */
const v1 = JSON.parse(JSON.stringify(buildSearchIndex())) as ReturnType<typeof buildSearchIndex>

describe('the encoded search index', () => {
  test('is version 2, and decodes row for row to the version-1 rows', () => {
    expect(encoded.version).toBe(2)
    for (const key of ['lessons', 'kcs', 'plays', 'claims', 'glossary'] as const) {
      expect(decoded[key].length).toBe(v1[key].length)
      decoded[key].forEach((row, i) => expect([key, i, row]).toEqual([key, i, v1[key][i]]))
    }
    expect(decoded).toEqual(v1)
  })

  test('the palette builds the same rows from it as from the version-1 rows', () => {
    expect(indexItems(decoded)).toEqual(indexItems(v1))
  })

  test('encoding a decoded index gives the committed encoding back', () => {
    expect(JSON.parse(JSON.stringify(encodeSearchIndex(decoded)))).toEqual(encoded)
  })

  test('holds every lesson, concept with a lesson, play and glossary pair, and every claim outside UNINDEXED_GROUPS', () => {
    expect(decoded.lessons.map((r) => r[0])).toEqual(ALL_LESSONS.map((l) => l.id))
    expect(decoded.kcs.map((r) => r[0])).toEqual(KCS.filter((k) => lessonById(k.lessons[0])).map((k) => k.id))
    expect(decoded.plays.map((r) => r[0])).toEqual(Object.values(PLAYS).map((p) => p.id))
    expect(decoded.glossary.map((r) => r[0])).toEqual(PAIRS.map((p) => p.slug))
    const indexed = ALL_CLAIMS.filter((c) => !UNINDEXED_GROUPS.includes(lazyGroupFor(c.id) ?? '')).map((c) => c.id)
    expect(decoded.claims.map((r) => r[0])).toEqual(indexed)
    expect(indexed.length).toBeGreaterThan(200)
  })

  test("the palette's heading slug is the lesson page's, for every H2 and H3 of every lesson", () => {
    for (const lesson of ALL_LESSONS) {
      for (const h of extractHeadings(lesson.blocks)) expect([lesson.id, headingSlug(h.text)]).toEqual([lesson.id, slugify(h.text)])
    }
    for (const text of ['  Leading and trailing!  ', 'Q&A: 4 × 16 = 64', 'Ünïcödé', '']) expect(headingSlug(text)).toBe(slugify(text))
  })

  test('a concept anchor and a claim reference survive as positions', () => {
    const paged = decoded.kcs.find((k) => k[4] === '4-pagedattention-paging-verbatim')
    expect(paged).toBeDefined()
    const cites = decoded.kcs.filter((k) => k[5].length > 0)
    expect(cites.length).toBeGreaterThan(0)
    for (const [, , , , , ids] of cites) for (const id of ids) expect(typeof id).toBe('string')
  })
})
