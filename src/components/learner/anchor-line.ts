import { KCS } from '@/data/kc'
import type { LearningPath } from '@/lib/ledger/types'
import { kcsIntroducedBy, kcsOfLesson, type BraidPair } from '@/lib/learner/paths'
import type { WalkOutcome } from '@/lib/learner/placement'
import { getTrack } from '@/lib/tracks'

type RustAnchor = WalkOutcome['result']['rustAnchor']

/** No Rust Zero lesson has a ticket, so none offers a test-out: a solid or skipped anchor takes Rust Zero out of the plan, and its lessons stay open. */
const ANCHOR_LINE: Record<RustAnchor, string> = {
  solid: 'Rust reading: solid. Rust Zero is not in your plan; every lesson stays open in the Curriculum.',
  missed: 'Rust reading: not yet. Rust Zero stays in your plan, braided in just before the lessons that need it.',
  // the learner answered "Not sure" to the Rust item (on these paths it is never left out) after a walk with every
  // other KC solid; after a weaker walk finishWalk reads it as missed
  skipped: 'Rust reading: skipped. The rest of your walk was solid, so Rust Zero is not in your plan; every lesson stays open in the Curriculum.',
}

const isRust = (lessonId: string): boolean => lessonId.split('.')[0] === 'r'
const lessonsOf = (n: number): string => (n === 1 ? 'lesson' : 'lessons')
const trackCode = (lessonId: string): string => getTrack(lessonId.split('.')[0])?.code ?? lessonId.split('.')[0].toUpperCase()

/** "a, b and c" */
const andList = (parts: readonly string[]): string => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`)

/** "1 comes ... it", "2 come ... them" */
const counted = (n: number, one: string, many: string, rest: (pronoun: string) => string): string => `${n} ${n === 1 ? one : many} ${rest(n === 1 ? 'it' : 'them')}`

/**
 * Lesson `l` uses Rust Zero lesson `r` when a KC taught in `l` is one `r` introduces or requires one (the braid's own
 * rule, paths.ts needEdge), whether `l` is a T lesson or a later Rust Zero lesson.
 */
const uses = (r: string, l: string): boolean => {
  const introduced = new Set(kcsIntroducedBy(KCS, r).map((k) => k.id))
  return kcsOfLesson(KCS, l).some((k) => introduced.has(k.id) || k.requires.some((id) => introduced.has(id)))
}

/**
 * The missed-anchor sentence, counted from the computed plan. The Rust Zero lessons that open the plan are counted
 * first. On the full ramp each later one is placed against the first lesson in the plan, R or T, that uses it: before
 * it, after it (the braid's cap can slide one forward past its first T user), or with no lesson in the plan that uses
 * it. rust-systems has no pairing: its later half follows the lessons named by track.
 */
function missedLine(plan: { lessons: readonly string[]; pairs?: readonly BraidPair[] }): string {
  const { lessons } = plan
  const total = lessons.filter(isRust).length
  const firstOther = lessons.findIndex((id) => !isRust(id))
  if (total === 0) return ANCHOR_LINE.missed
  if (firstOther === -1) return `Rust reading: not yet. Your plan is the ${total === 1 ? 'one Rust Zero lesson' : `${total} Rust Zero lessons`}.`
  const head = 'Rust reading: not yet. Rust Zero stays in your plan'
  const lead = firstOther
  if (lead === total) return `${head}, and ${total === 1 ? 'its one lesson comes' : `all ${total} Rust Zero lessons come`} first.`
  const clauses = lead > 0 ? [`the first ${lead} Rust Zero ${lessonsOf(lead)} open it`] : []
  const later = lessons.slice(lead).filter(isRust)
  const pairs = plan.pairs ?? []
  if (pairs.length === 0) {
    // rust-systems: the later Rust Zero lessons follow the tracks between them and the opening run
    const at = lessons.indexOf(later[0])
    const codes = [...new Set(lessons.slice(lead, at).map(trackCode))]
    clauses.push(`the other ${later.length} come after the ${andList(codes)} lessons`)
    return `${head}: ${andList(clauses)}.`
  }
  let before = 0
  let after = 0
  let unused = 0
  for (const r of later) {
    const at = lessons.indexOf(r)
    const firstUser = lessons.findIndex((l, i) => i !== at && uses(r, l))
    if (firstUser === -1) unused++
    else if (at < firstUser) before++
    else after++
  }
  if (lead === 0 && after === 0 && unused === 0) return ANCHOR_LINE.missed
  if (before > 0) clauses.push(counted(before, 'comes', 'come', (p) => `before the first lesson that uses ${p}`))
  if (after > 0) clauses.push(counted(after, 'comes', 'come', (p) => `after the first lesson that uses ${p}`))
  if (unused > 0) clauses.push(counted(unused, 'is', 'are', (p) => `there though no lesson in this plan uses ${p}`))
  return `${head}: ${andList(clauses)}.`
}

/** `serving-first` has no Rust Zero lessons or test-outs to promise: its Rust is the reading blocks inside T5 and T6 (serving-reading.md §5.5). */
const SERVING_ANCHOR_LINE: Record<RustAnchor, string> = {
  solid: 'Rust reading: solid. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.',
  missed: 'Rust reading: not yet. That is fine on this path: short reading items inside T5 and T6 cover the Rust those lessons use, and Rust Zero stays open in the Curriculum.',
  skipped: 'Rust reading: not asked. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.',
}

/** serving-first, the Rust item shown and every answer to it "Not sure": it was asked, so the line does not say "not asked" (the spec's row covers the item left out). */
const SERVING_SKIPPED_SHOWN = 'Rust reading: skipped. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.'

/**
 * The result's Rust line for the learner's path; on the other two paths a solid or skipped anchor leaves Rust Zero out of the plan, and the missed line
 * counts the Rust Zero lessons in `plan` (the order the learner will walk, with the full ramp's braid pairing), so it
 * never promises a braid the plan does not have.
 */
export const anchorLine = (
  rustAnchor: RustAnchor,
  path: LearningPath,
  plan: { lessons: readonly string[]; pairs?: readonly BraidPair[] },
  /** The walk showed the Rust item (`WalkOutcome.anchorShown`); only serving-first can leave it out. */
  anchorShown = path !== 'serving-first',
  /**
   * Every answer to the Rust item was "Not sure" (`WalkOutcome.anchorNotSure`). On serving-first that reads skipped after
   * any walk, though the stored anchor is a miss unless the rest of the walk was solid (so a later switch to a path with
   * Rust Zero keeps its lessons). The other paths read the stored anchor alone.
   */
  anchorNotSure = false,
): string => {
  if (path === 'serving-first') return (rustAnchor === 'skipped' || anchorNotSure) && anchorShown ? SERVING_SKIPPED_SHOWN : SERVING_ANCHOR_LINE[rustAnchor]
  return rustAnchor === 'missed' ? missedLine(plan) : ANCHOR_LINE[rustAnchor]
}
