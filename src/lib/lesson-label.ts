/**
 * One name for a lesson (docs/specs/wave-1.md; Wave 1 stage 0, task K1-3, audit O14).
 *
 * A lesson's id is a key and never changes; the number a learner sees is its position. Today the two agree
 * (`t3.l6` is the sixth T3 lesson) and `index` is the declared position, so every surface can use this module and
 * render exactly what it rendered before. The structure release (K1-5) changes the reading order; it feeds that
 * order to `lessonLabelIn` (or makes `index` derived) and every surface follows from one place instead of from the
 * id's spelling.
 *
 * This module carries no lesson data: it ships in the entry chunk through `recommend` and `paths`. The id-only
 * `lessonCode` is the fallback for a caller that has an id and not the lesson; it is id-spelled today, which is why
 * it matches the labels everywhere except the two surfaces that printed a shortened code (the forge readiness list's
 * `R1` and the error museum's `.L`-stripped `T36`), which now say `R.L1` and `T3.L6`.
 */
import type { TrackId } from '@/data/lessons/types'

/** What a label reads of a lesson. `Lesson` from src/data/lessons satisfies it. */
export interface LabelledLesson {
  id: string
  trackId: TrackId
  index: number
}

/** `R`, `T0`, ... — the track's code as the course prints it. */
export const trackCode = (trackId: TrackId): string => (trackId === 'r' ? 'R' : trackId.toUpperCase())

/** `T6.L12`: track code plus the lesson's position in its track, the code a learner sees. */
export const lessonLabel = (lesson: LabelledLesson): string => `${trackCode(lesson.trackId)}.L${lesson.index}`

/** `L12`: the position alone, for a surface that is already inside the track. */
export const lessonPosition = (lesson: Pick<LabelledLesson, 'index'>): string => `L${lesson.index}`

/**
 * A code for a caller that has only the id. Today a lesson's id spells its label (`t3.l6` -> `T3.L6`), so this is
 * the same string; the structure release replaces the id spelling with the reading-order table, and the label helper
 * above becomes the only source.
 */
export const lessonCode = (id: string): string => id.toUpperCase()

/**
 * The label under an explicit reading order: the same rule, with positions counted in `order` rather than `index`.
 * The order must be complete for each track it covers; a partial list numbers from its own first entry. A lesson
 * missing from the order keeps its declared label. The order entry, not the argument, names the track.
 */
export function lessonLabelIn(lesson: LabelledLesson, order: readonly Pick<LabelledLesson, 'id' | 'trackId'>[]): string {
  const entry = order.find((l) => l.id === lesson.id)
  if (!entry) return lessonLabel(lesson)
  const inTrack = order.filter((l) => l.trackId === entry.trackId)
  const at = inTrack.findIndex((l) => l.id === lesson.id)
  return `${trackCode(entry.trackId)}.L${at + 1}`
}
