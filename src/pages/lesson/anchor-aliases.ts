/**
 * Old heading links (K0-E7). A lesson heading's id is its slug, so renaming a heading breaks every saved link to
 * the old slug. This table maps lessonId -> { oldSlug: newSlug } so the hash effect in Lesson.tsx can land such a
 * link on the renamed heading. A task that renames a lesson heading adds its row here. Keep this module free of
 * imports from the claims registry and the lessons registry: Lesson is a lazy route, and this adds nothing to the entry.
 */

export const ANCHOR_ALIASES: Record<string, Record<string, string>> = {
  't2.l7': {
    '1-2-the-problem-in-os-vocabulary': '1-3-the-problem-in-os-vocabulary',
    '3-pagedattention-paging-verbatim': '4-pagedattention-paging-verbatim',
    '4-scheduling-the-t2-l4-layer': '4-5-scheduling-the-t2-l4-layer',
  },
}

/** The live heading id a link's hash should land on: the hash itself when live, the renamed heading for an old slug, else null. */
export function resolveAnchor(lessonId: string, rawHash: string, headingIds: readonly string[]): string | null {
  let anchor = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
  try {
    anchor = decodeURIComponent(anchor)
  } catch {
    return null
  }
  if (!anchor) return null
  if (headingIds.includes(anchor)) return anchor
  const target = Object.prototype.hasOwnProperty.call(ANCHOR_ALIASES, lessonId)
    ? ANCHOR_ALIASES[lessonId][anchor]
    : undefined
  return target && headingIds.includes(target) ? target : null
}
