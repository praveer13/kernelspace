/**
 * ⌘K search (docs/specs/wave-1.md §7.4, B24): the shape of the build-time index
 * (src/data/search-index.json, written by scripts/build-search-index.ts), the rows the palette
 * searches, and the one Fuse configuration the palette, verify-search-index and the tests share.
 *
 * Only the palette chunk imports this module for its values, so Fuse never reaches the entry chunk.
 */

import Fuse from 'fuse.js'

export type SearchGroup = 'Lessons' | 'Concepts' | 'Numbers' | 'Glossary' | 'Pages' | 'Tracks' | 'Simulators'

/** Result order in the palette. */
export const GROUP_ORDER: readonly SearchGroup[] = ['Lessons', 'Concepts', 'Numbers', 'Glossary', 'Pages', 'Tracks', 'Simulators']

/** The groups with a row for every page, track and sim; shown before the learner types. */
export const STATIC_GROUPS: readonly SearchGroup[] = ['Pages', 'Tracks', 'Simulators']

/** Rows are positional tuples: the JSON ships once, so it drops the key names. */
export type LessonRow = [id: string, title: string, hook: string, h2s: string[]]
/**
 * `can` is the competence statement without "You can ". `anchor` is the id of the H2 the KC is introduced
 * under, or '' to open the lesson at the top. `claimIds` are the claims its numbers rest on.
 */
export type KcRow = [id: string, title: string, can: string, lessonId: string, anchor: string, claimIds: string[]]
export type ClaimRow = [id: string, label: string, value: number | string, unit: string]
export type GlossaryRow = [slug: string, os: string, llm: string, lessonId: string, synonyms: string]

export interface SearchIndex {
  version: 1
  lessons: LessonRow[]
  kcs: KcRow[]
  claims: ClaimRow[]
  glossary: GlossaryRow[]
}

export interface SearchItem {
  id: string
  group: SearchGroup
  title: string
  crumb: string
  to: string
  keywords: string[]
}

const label = (lessonId: string) => lessonId.toUpperCase()

const claimValue = (value: number | string, unit: string) => {
  const v = typeof value === 'number' ? value.toLocaleString('en-US') : value
  return unit ? `${v} ${unit}` : v
}

/** Where a claim opens: the Claims tab of /freshness, scrolled to its row (ClaimsTable gives rows their ids). */
export const claimPath = (id: string) => `/freshness?tab=claims#${id}`

/**
 * The searchable rows of the generated index, in group order. Rows borrow words from the rows they link to,
 * which costs nothing in the JSON: a lesson matches the titles of the concepts it introduces ("ridge point"
 * finds the roofline lesson), and a claim matches the concepts whose numbers rest on it ("PagedAttention" finds
 * the vLLM block size).
 */
export function indexItems(index: SearchIndex): SearchItem[] {
  const kcTitlesByLesson = new Map<string, string[]>()
  const kcTitlesByClaim = new Map<string, string[]>()
  for (const [, title, , lessonId, , claimIds] of index.kcs) {
    kcTitlesByLesson.set(lessonId, [...(kcTitlesByLesson.get(lessonId) ?? []), title])
    for (const id of claimIds) kcTitlesByClaim.set(id, [...(kcTitlesByClaim.get(id) ?? []), title])
  }
  return [
    ...index.lessons.map<SearchItem>(([id, title, hook, h2s]) => ({
      id: `lesson-${id}`,
      group: 'Lessons',
      title,
      crumb: `lesson · ${label(id)} · ${hook}`,
      to: `/lesson/${id}`,
      keywords: [...h2s, ...(kcTitlesByLesson.get(id) ?? []), hook],
    })),
    ...index.kcs.map<SearchItem>(([id, title, can, lessonId, anchor]) => ({
      id: `kc-${id}`,
      group: 'Concepts',
      title,
      crumb: `concept · ${label(lessonId)} · you can ${can}`,
      to: `/lesson/${lessonId}${anchor ? `#${anchor}` : ''}`,
      keywords: [can, id],
    })),
    ...index.claims.map<SearchItem>(([id, name, value, unit]) => ({
      id: `claim-${id}`,
      group: 'Numbers',
      title: name,
      crumb: `${claimValue(value, unit)} · ${id}`,
      to: claimPath(id),
      keywords: [id, String(value), unit, ...(kcTitlesByClaim.get(id) ?? [])],
    })),
    ...index.glossary.map<SearchItem>(([slug, os, llm, lessonId, synonyms]) => ({
      id: `glossary-${slug}`,
      group: 'Glossary',
      title: `${os} ≡ ${llm}`,
      crumb: `glossary · ${label(lessonId)}`,
      to: `/glossary#${slug}`,
      keywords: [os, llm, synonyms],
    })),
  ]
}

/** Rows kept per group when a query is typed, so one group cannot push the others off the list. */
const PER_GROUP = 4
const MAX_ROWS = 16

/** Queries this short must match closely: one typo in five letters otherwise matches half the index ("ridge" and "bridge"). */
const SHORT_QUERY = 5

/**
 * A searcher over `items`. Titles outweigh keywords. `ignoreLocation` matters because keywords hold
 * whole sentences: without it a hit past the first 60 characters scores as a miss.
 */
export function makeSearcher(items: readonly SearchItem[]) {
  const make = (threshold: number) =>
    new Fuse(items, {
      keys: [
        { name: 'title', weight: 3 },
        { name: 'keywords', weight: 1 },
        { name: 'crumb', weight: 0.3 },
      ],
      threshold,
      ignoreLocation: true,
    })
  const fuzzy = make(0.3)
  const close = make(0.12)
  const statics = items.filter((i) => STATIC_GROUPS.includes(i.group))

  /** Matching rows in group order, best match first inside a group. An empty query lists the static rows. */
  return (query: string): SearchItem[] => {
    const q = query.trim()
    const hits = q ? (q.length <= SHORT_QUERY ? close : fuzzy).search(q).map((r) => r.item) : statics
    const byGroup = new Map<SearchGroup, SearchItem[]>(GROUP_ORDER.map((g) => [g, []]))
    for (const item of hits) {
      const rows = byGroup.get(item.group)!
      if (rows.length < (q ? PER_GROUP : MAX_ROWS)) rows.push(item)
    }
    return GROUP_ORDER.flatMap((g) => byGroup.get(g)!).slice(0, MAX_ROWS)
  }
}
