import type { TrackId } from '@/data/lessons/types'
import { getTrack } from '@/lib/tracks'

export interface ResultHeadingInput {
  /** The track the walk placed the learner on. */
  entryTrack: string
  /** A blind-answering pattern was read: the walk says little, so the ramp starts at its first lesson. */
  pattern: boolean
  /** The lesson the plan starts at (the one the Start button names), or null when the plan has none left. */
  startLessonId: string | null | undefined
  /** The plan's lessons in order: the heading names no track that has no lesson here. */
  lessons: readonly string[]
}

const trackName = (id: string): string => {
  const t = getTrack(id)
  return t ? `${t.code} · ${t.name}` : id.toUpperCase()
}

const trackOf = (lessonId: string): string => lessonId.split('.')[0] as TrackId

/**
 * The placement result's heading, derived from the plan so it names the same start the button, Today and Up Next
 * name, and no track the plan never visits. The entry track alone is not enough: a missed Rust anchor puts Rust Zero
 * lessons ahead of the entry track's first lesson, serving-first opens on its own head lesson, and rust-systems has
 * no T0, T4 or T5 lessons at all. After a Rust Zero start, "then" names the track of the plan's next other lesson.
 */
export function resultHeading({ entryTrack, pattern, startLessonId, lessons }: ResultHeadingInput): string {
  if (pattern) return 'Start at the beginning'
  if (lessons.length === 0) return 'Your placement skips every lesson on this path'
  if (!startLessonId) return `Start at ${trackName(lessons.some((id) => trackOf(id) === entryTrack) ? entryTrack : trackOf(lessons[0]))}`
  const startTrack = trackOf(startLessonId)
  if (startTrack === entryTrack || startTrack !== 'r') return `Start at ${trackName(startTrack)}`
  const from = lessons.indexOf(startLessonId)
  const next = lessons.slice(from + 1).find((id) => trackOf(id) !== 'r')
  return next ? `Start with ${trackName('r')}, then ${trackName(trackOf(next))}` : `Start with ${trackName('r')}`
}
