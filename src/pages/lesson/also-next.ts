import type { Recommendation } from '@/lib/learner/types'

/** The lesson after this one, when Up Next points at a different lesson; otherwise null. */
export function alsoNext<L extends { id: string; title: string }>(
  rec: Pick<Recommendation, 'kind' | 'ref'> | null,
  next: L | undefined,
): { lesson: L; label: string } | null {
  if (!rec || rec.kind !== 'lesson' || !next || rec.ref === next.id) return null
  return { lesson: next, label: `${next.id.toUpperCase()} · ${next.title}` }
}
