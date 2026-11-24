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

/**
 * A lesson citation in prose: `[[l:t6.l12]]`. The codemod that converts the `T#.L#` literals writes this form; the
 * renderer prints the label above and links to `/lesson/<id>`, and the markdown export passes the site's base.
 * The token carries the id, which never changes, so the structure release re-renders every citation from the new order.
 *
 * The source pattern has no capture group, for a renderer that adds its own; the two patterns cannot drift.
 */
export const LESSON_TOKEN_SOURCE = '\\[\\[l:[a-z0-9]+(?:\\.[a-z0-9]+)+\\]\\]'

/** The token pattern, whose one capture group is the lesson id. */
export const LESSON_TOKEN_RE = /\[\[l:([a-z0-9]+(?:\.[a-z0-9]+)+)\]\]/g

/** The token form of one lesson citation. */
export const lessonToken = (id: string): string => `[[l:${id}]]`

/** The label for an id, under an optional explicit order. Track membership is parsed from the id. */
export function lessonCodeIn(id: string, order?: readonly Pick<LabelledLesson, 'id' | 'trackId'>[]): string {
  if (!order || !order.some((l) => l.id === id)) return lessonCode(id)
  const trackId = id.split('.')[0] as TrackId
  return lessonLabelIn({ id, trackId, index: 0 }, order)
}

/** Every lesson token in a text, as ids. */
export function lessonTokensIn(text: string): string[] {
  const ids: string[] = []
  for (const m of text.matchAll(new RegExp(LESSON_TOKEN_RE.source, 'g'))) ids.push(m[1])
  return ids
}

/** The text with every token replaced by its label (the search index and any plain-text reader). */
export function replaceLessonTokens(text: string, order?: readonly Pick<LabelledLesson, 'id' | 'trackId'>[]): string {
  return text.replace(LESSON_TOKEN_RE, (_, id: string) => lessonCodeIn(id, order))
}

/** The markdown export's form: the label, linked to the lesson. `base` is the link prefix (the site's for an export). */
export function replaceLessonTokensWithLinks(
  text: string,
  order?: readonly Pick<LabelledLesson, 'id' | 'trackId'>[],
  base = '/lesson',
): string {
  return text.replace(LESSON_TOKEN_RE, (_, id: string) => `[${lessonCodeIn(id, order)}](${base}/${id})`)
}
