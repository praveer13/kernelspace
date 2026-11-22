import type { TrackId } from '@/data/lessons/types'
import { getTrack } from '@/lib/tracks'

export interface ResultHeadingInput {
  /** The track the walk placed the learner on. */
  entryTrack: string
  /** A blind-answering pattern was read: the walk says little, so the ramp starts at its first lesson. */
  pattern: boolean
  /** The lesson the plan starts at (the one the Start button names), or null when the plan has none. */
  startLessonId: string | null | undefined
}

const trackName = (id: string): string => {
  const t = getTrack(id)
  return t ? `${t.code} · ${t.name}` : id.toUpperCase()
}

/**
 * The placement result's heading, derived from the plan's first lesson so it names the same start the button,
 * Today and Up Next name. The entry track alone is not enough: a missed Rust anchor puts Rust Zero lessons ahead
 * of the entry track's first lesson, and serving-first opens on its own head lesson.
 */
export function resultHeading({ entryTrack, pattern, startLessonId }: ResultHeadingInput): string {
  if (pattern) return 'Start at the beginning'
  const startTrack: string = startLessonId ? (startLessonId.split('.')[0] as TrackId) : entryTrack
  if (startTrack === entryTrack) return `Start at ${trackName(entryTrack)}`
  if (startTrack === 'r') return `Start with ${trackName('r')}, then ${trackName(entryTrack)}`
  return `Start at ${trackName(startTrack)}`
}
