/**
 * build-search-index — the ⌘K index (docs/specs/wave-1.md §7.4, B24).
 *
 * Writes src/data/search-index.json from the lessons, the KC graph (T3-T7 included), the plays of `PLAYS`, the
 * claims registry and the glossary pairs. Pages (the Daily, the Error Museum) are the palette's static list, not
 * the index (wave-2.md §7.4), so the bank's entries never reach it. The file is committed; CI regenerates it
 * and fails on a diff (`bun run verify:search-index`), the way it does for public/lessons-md. The palette
 * imports it as its own chunk on first open, so the file is kept compact: positional rows, one per line, no
 * authored prose beyond titles, hooks and headings.
 *
 *   bun scripts/build-search-index.ts
 */
import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { ALL_CLAIMS } from '../src/data/claims/all'
import { PAIRS } from '../src/data/glossary'
import { KCS } from '../src/data/kc'
import { PLAYS } from '../src/data/plays'
import { ALL_LESSONS, lessonById } from '../src/data/lessons'
import type { Lesson } from '../src/data/lessons/types'
import { extractHeadings, slugify } from '../src/pages/lesson/markdown'
import type { SearchIndex } from '../src/lib/search'

export const INDEX_PATH = 'src/data/search-index.json'

/**
 * Hooks and competence statements are crumbs in the palette; the full text is one click away. Cut to keep the chunk
 * under budget: the largest lengths that keep the index at 18 KB gzip, 2 KB under verify:search-index's 20 KB budget
 * (wave-2 D24), so 2b and 2c content has room. They were 32 and 0 under Wave 1's 15 KB; at 0 a concept row's crumb
 * fell back to its lesson title and the competence wording was not searchable. Wave 3 grew the index to 20,317 bytes
 * gzip (19.8 KB of 20) at CAN_MAX 41; wave-3.md §4.4's cut to 32 brought it to 19,723 (19.3 KB). Raise them only with
 * the size in hand (`bun scripts/build-search-index.ts` prints it).
 */
const HOOK_MAX = 60
export const CAN_MAX = 32

/** `text` cut at a word boundary to at most `max` characters, with an ellipsis when something was cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  return `${head.slice(0, head.lastIndexOf(' '))}…`
}

/** A competence statement without its "You can " lead-in and final period: it opens the palette's crumb ('' when `max` is 0). */
const canClause = (can: string, max: number) => (max > 0 ? clip(can.replace(/^You can /, '').replace(/\.$/, ''), max) : '')

const h2Of = (lesson: Lesson) => extractHeadings(lesson.blocks).filter((h) => h.level === 2)

const STOP = new Set(['the', 'and', 'for', 'you', 'can', 'with', 'from', 'that', 'this', 'what', 'when', 'your', 'are', 'not', 'into', 'one', 'how', 'why'])

/** Lowercase words of 3+ letters without a trailing s, so "holes" meets "hole" and "pages" meets "page". */
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w))

/**
 * The H2 a KC is introduced under in its first lesson. A prequestion on the KC names the section that teaches
 * it (`revealAt`), which is the authored answer. Otherwise the H2 sharing the most words with the KC's title
 * (counted twice) and competence statement, with a score of at least 3 (a lone title word is not enough).
 * Otherwise none, and the palette opens the lesson at the top rather than at a guess.
 */
export function kcAnchor(kcId: string, title: string, can: string, lesson: Lesson): string {
  const h2s = h2Of(lesson)
  for (const block of lesson.blocks) {
    if (block.type !== 'predict') continue
    for (const item of block.items) {
      if (!item.kcs.includes(kcId)) continue
      const id = slugify(item.revealAt)
      if (h2s.some((h) => h.id === id)) return id
    }
  }
  const t = new Set(words(title))
  const c = new Set(words(can))
  let best = ''
  let bestScore = 2
  for (const h of h2s) {
    let score = 0
    for (const w of new Set(words(h.text))) score += (t.has(w) ? 2 : 0) + (c.has(w) ? 1 : 0)
    if (score > bestScore) {
      best = h.id
      bestScore = score
    }
  }
  return best
}

export function buildSearchIndex(hookMax = HOOK_MAX, canMax = CAN_MAX): SearchIndex {
  return {
    version: 1,
    lessons: ALL_LESSONS.map((l) => [l.id, l.title, clip(l.hook, hookMax), h2Of(l).map((h) => h.text)]),
    // A lab-only KC (no lesson) has no page to open, so it is not indexed.
    kcs: KCS.flatMap((k) => {
      const lesson = lessonById(k.lessons[0])
      return lesson ? [[k.id, k.title, canClause(k.can, canMax), lesson.id, kcAnchor(k.id, k.title, k.can, lesson), k.claims ?? []]] : []
    }),
    plays: Object.values(PLAYS).map((p) => [p.id, p.title, p.lessonId, p.minutes]),
    claims: ALL_CLAIMS.map((c) => [c.id, c.label, c.value, c.unit ?? '']),
    glossary: PAIRS.map((p) => [p.slug, p.os, p.llm, p.lesson, p.syn.join(', ')]),
  }
}

/** The committed file's text: top-level keys on their own lines and one row per line, so a content change diffs small. */
export function serializeSearchIndex(index: SearchIndex): string {
  const rows = (list: readonly unknown[]) => `[\n${list.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]`
  return `{
  "version": ${index.version},
  "lessons": ${rows(index.lessons)},
  "kcs": ${rows(index.kcs)},
  "plays": ${rows(index.plays)},
  "claims": ${rows(index.claims)},
  "glossary": ${rows(index.glossary)}
}
`
}

if (import.meta.main) {
  const text = serializeSearchIndex(buildSearchIndex())
  writeFileSync(INDEX_PATH, text)
  console.log(`wrote ${INDEX_PATH} (${text.length} bytes, ${gzipSync(text).length} gzip)`)
}
