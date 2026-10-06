/**
 * verify-search-index — the ⌘K index is fresh, sound and small (docs/specs/wave-1.md §7.4, B24).
 *
 * Regenerates src/data/search-index.json in memory and fails when the committed file differs, the way CI
 * does for public/lessons-md. It also checks that every row points somewhere real (lesson, H2 anchor, claim),
 * that the index gzips to the 15 KB budget, and that the acceptance queries find a lesson, a concept and a claim.
 *
 *   bun run verify:search-index
 */
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { byId } from '../src/data/claims'
import { lessonById } from '../src/data/lessons'
import { extractHeadings } from '../src/pages/lesson/markdown'
import { claimPath, indexItems, makeSearcher, type SearchIndex } from '../src/lib/search'
import { buildSearchIndex, INDEX_PATH, serializeSearchIndex } from './build-search-index'

/** Spec §16.1: the index chunk's gzip budget. The JSON is the chunk's payload, so it is gated here, ahead of verify:bundle's report of the built chunk. */
export const BUDGET_BYTES = 15 * 1024

/** Queries that must each reach a lesson, a concept (KC) and a claim. */
export const ACCEPTANCE_QUERIES = ['PagedAttention', 'KV cache', 'ridge']

/** Everything wrong with `committed` (the text of src/data/search-index.json), as sentences. Empty means fine. */
export function checkSearchIndex(committed: string): string[] {
  const errors: string[] = []
  const index = buildSearchIndex()
  const expected = serializeSearchIndex(index)
  if (committed !== expected) {
    errors.push(`${INDEX_PATH} is stale: run \`bun scripts/build-search-index.ts\` and commit it`)
  }

  const gz = gzipSync(expected).length
  if (gz > BUDGET_BYTES) errors.push(`the index is ${gz} bytes gzip, over the ${BUDGET_BYTES} byte budget`)

  errors.push(...rowErrors(index))

  const search = makeSearcher(indexItems(index))
  for (const query of ACCEPTANCE_QUERIES) {
    const groups = new Set(search(query).map((r) => r.group))
    for (const group of ['Lessons', 'Concepts', 'Numbers'] as const) {
      if (!groups.has(group)) errors.push(`searching "${query}" finds no ${group} row`)
    }
  }
  return errors
}

/** Dangling destinations and duplicate ids. */
function rowErrors(index: SearchIndex): string[] {
  const errors: string[] = []
  const dupes = (kind: string, ids: string[]) => {
    for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) errors.push(`duplicate ${kind} id ${id}`)
  }
  dupes('lesson', index.lessons.map((r) => r[0]))
  dupes('kc', index.kcs.map((r) => r[0]))
  dupes('claim', index.claims.map((r) => r[0]))
  dupes('glossary', index.glossary.map((r) => r[0]))

  for (const [id] of index.lessons) if (!lessonById(id)) errors.push(`lesson row ${id} has no lesson`)
  for (const [id, , , lessonId, anchor, claimIds] of index.kcs) {
    const lesson = lessonById(lessonId)
    if (!lesson) errors.push(`kc ${id} opens ${lessonId}, which is not a lesson`)
    else if (anchor && !extractHeadings(lesson.blocks).some((h) => h.level === 2 && h.id === anchor)) {
      errors.push(`kc ${id} opens ${lessonId}#${anchor}, which is not an H2 of that lesson`)
    }
    for (const claimId of claimIds) if (!byId[claimId]) errors.push(`kc ${id} cites claim ${claimId}, which is not in the registry`)
  }
  for (const [id] of index.claims) {
    if (!byId[id]) errors.push(`claim row ${id} is not in the registry`)
    if (!claimPath(id).endsWith(`#${id}`)) errors.push(`claim ${id} has no anchor`)
  }
  for (const [slug, , , lessonId] of index.glossary) if (!lessonById(lessonId)) errors.push(`glossary ${slug} points at ${lessonId}, which is not a lesson`)
  return errors
}

if (import.meta.main) {
  const errors = checkSearchIndex(readFileSync(INDEX_PATH, 'utf8'))
  if (errors.length > 0) {
    for (const e of errors) console.error(`FAIL ${e}`)
    process.exit(1)
  }
  const index = buildSearchIndex()
  const gz = gzipSync(serializeSearchIndex(index)).length
  console.log(
    `verify-search-index: ok (${index.lessons.length} lessons, ${index.kcs.length} concepts, ${index.claims.length} claims, ${index.glossary.length} glossary rows; ${(gz / 1024).toFixed(1)} KB gzip of ${BUDGET_BYTES / 1024})`,
  )
}
