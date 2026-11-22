import type { LearningPath } from '@/lib/ledger/types'
import type { WalkOutcome } from '@/lib/learner/placement'

type RustAnchor = WalkOutcome['result']['rustAnchor']

const ANCHOR_LINE: Record<RustAnchor, string> = {
  solid: 'Rust reading: solid. The Rust Zero lessons are offered as test-outs instead of lessons.',
  missed: 'Rust reading: not yet. Rust Zero stays in your plan, braided in just before the lessons that need it.',
  skipped: 'Rust reading: not asked. The Rust Zero lessons are offered as test-outs.',
}

const isRust = (lessonId: string): boolean => lessonId.split('.')[0] === 'r'
const lessonsOf = (n: number): string => (n === 1 ? 'lesson' : 'lessons')

/** The missed-anchor sentence, counted from the computed plan: how many Rust Zero lessons open it and how many follow. */
function missedLine(lessons: readonly string[]): string {
  const total = lessons.filter(isRust).length
  const firstOther = lessons.findIndex((id) => !isRust(id))
  const lead = firstOther === -1 ? lessons.length : firstOther
  const head = 'Rust reading: not yet. Rust Zero stays in your plan'
  if (total === 0 || lead === 0) return ANCHOR_LINE.missed
  if (lead === total) return `${head}, and ${total === 1 ? 'its one lesson comes' : `all ${total} Rust Zero lessons come`} first.`
  return `${head}: the first ${lead} Rust Zero ${lessonsOf(lead)} open it, and the other ${total - lead} follow later, before the lessons that need them.`
}

/** `serving-first` has no Rust Zero lessons or test-outs to promise: its Rust is the reading blocks inside T5 and T6 (serving-reading.md §5.5). */
const SERVING_ANCHOR_LINE: Record<RustAnchor, string> = {
  solid: 'Rust reading: solid. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.',
  missed: 'Rust reading: not yet. That is fine on this path: short reading items inside T5 and T6 cover the Rust those lessons use, and Rust Zero stays open in the Curriculum.',
  skipped: 'Rust reading: not asked. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.',
}

/**
 * The result's Rust line for the learner's path; the other two paths keep the test-out wording, and their missed line
 * counts the Rust Zero lessons in `plan` (the order the learner will walk), so it never promises a braid the plan does not have.
 */
export const anchorLine = (rustAnchor: RustAnchor, path: LearningPath, plan: { lessons: readonly string[] }): string => {
  if (path === 'serving-first') return SERVING_ANCHOR_LINE[rustAnchor]
  return rustAnchor === 'missed' ? missedLine(plan.lessons) : ANCHOR_LINE[rustAnchor]
}
