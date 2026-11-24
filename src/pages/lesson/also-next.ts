import type { Recommendation } from '@/lib/learner/types'
import { lessonCode } from '@/lib/lesson-label'

type LessonRef = { id: string; title: string; trackId: string }

/**
 * The lesson after this one, when Up Next points at a different lesson; otherwise null. The lead says what the link
 * does: the next lesson in curriculum order opens the next track at a track's end, so there it is not "the track".
 */
export function alsoNext<L extends LessonRef>(
  rec: Pick<Recommendation, 'kind' | 'ref'> | null,
  here: Pick<LessonRef, 'trackId'>,
  next: L | undefined,
): { lesson: L; lead: string; label: string } | null {
  if (!rec || rec.kind !== 'lesson' || !next || rec.ref === next.id) return null
  const lead = next.trackId === here.trackId ? 'Or continue the track' : 'Or go on to the next track'
  return { lesson: next, lead, label: `${lessonCode(next.id)} · ${next.title}` }
}
