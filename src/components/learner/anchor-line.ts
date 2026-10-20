import type { LearningPath } from '@/lib/ledger/types'
import type { WalkOutcome } from '@/lib/learner/placement'

type RustAnchor = WalkOutcome['result']['rustAnchor']

const ANCHOR_LINE: Record<RustAnchor, string> = {
  solid: 'Rust reading: solid. The Rust Zero lessons are offered as test-outs instead of lessons.',
  missed: 'Rust reading: not yet. Rust Zero stays in your plan, braided in just before the lessons that need it.',
  skipped: 'Rust reading: not asked. The Rust Zero lessons are offered as test-outs.',
}

/** `serving-first` has no Rust Zero lessons or test-outs to promise: its Rust is the reading blocks inside T5 and T6 (serving-reading.md §5.5). */
const SERVING_ANCHOR_LINE: Record<RustAnchor, string> = {
  solid: 'Rust reading: solid. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.',
  missed: 'Rust reading: not yet. That is fine on this path: short reading items inside T5 and T6 cover the Rust those lessons use, and Rust Zero stays open in the Curriculum.',
  skipped: 'Rust reading: not asked. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.',
}

/** The result's Rust line for the learner's path; the other two paths keep the braid and test-out wording. */
export const anchorLine = (rustAnchor: RustAnchor, path: LearningPath): string => (path === 'serving-first' ? SERVING_ANCHOR_LINE : ANCHOR_LINE)[rustAnchor]
