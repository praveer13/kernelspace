/**
 * build-search-index — the ⌘K index (docs/specs/wave-1.md §7.4, B24).
 *
 * Writes src/data/search-index.json from the lessons, the KC graph, the claims registry and the glossary
 * pairs. The file is committed; CI regenerates it and fails on a diff (`bun run verify:search-index`), the
 * way it does for public/lessons-md. The palette imports it as its own chunk on first open, so the file is
 * kept compact: positional rows, one per line, no authored prose beyond titles, hooks and headings.
 *
 *   bun scripts/build-search-index.ts
 */
import { writeFileSync } from 'node:fs'
import { CLAIMS } from '../src/data/claims'
import { PAIRS } from '../src/data/glossary'
import { KCS } from '../src/data/kc'
import { ALL_LESSONS, lessonById } from '../src/data/lessons'
import type { Lesson } from '../src/data/lessons/types'
import { extractHeadings, slugify } from '../src/pages/lesson/markdown'
import type { SearchIndex } from '../src/lib/search'

export const INDEX_PATH = 'src/data/search-index.json'

/** Hooks and competence statements are crumbs in the palette; the full text is one click away. Cut to keep the chunk under budget. */
const HOOK_MAX = 60
const CAN_MAX = 70

/** `text` cut at a word boundary to at most `max` characters, with an ellipsis when something was cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  return `${head.slice(0, head.lastIndexOf(' '))}…`
}

/** A competence statement without its "You can " lead-in and final period: it opens the palette's crumb. */
const canClause = (can: string) => clip(can.replace(/^You can /, '').replace(/\.$/, ''), CAN_MAX)

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

export function buildSearchIndex(): SearchIndex {
  return {
    version: 1,
    lessons: ALL_LESSONS.map((l) => [l.id, l.title, clip(l.hook, HOOK_MAX), h2Of(l).map((h) => h.text)]),
    // A lab-only KC (no lesson) has no page to open, so it is not indexed.
    kcs: KCS.flatMap((k) => {
      const lesson = lessonById(k.lessons[0])
      return lesson ? [[k.id, k.title, canClause(k.can), lesson.id, kcAnchor(k.id, k.title, k.can, lesson), k.claims ?? []]] : []
    }),
    claims: CLAIMS.map((c) => [c.id, c.label, c.value, c.unit ?? '']),
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
  "claims": ${rows(index.claims)},
  "glossary": ${rows(index.glossary)}
}
`
}

if (import.meta.main) {
  const text = serializeSearchIndex(buildSearchIndex())
  writeFileSync(INDEX_PATH, text)
  console.log(`wrote ${INDEX_PATH} (${text.length} bytes)`)
}
