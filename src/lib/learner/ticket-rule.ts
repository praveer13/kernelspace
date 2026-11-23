/**
 * The words an exit ticket, spiral or test-out uses for its non-MCQ item, and the rule line that states
 * the pass rule. A written item is self-checked: the learner ticks the ideas their answer covered, and the
 * site does not read the answer.
 */
import { isNonMcq } from '@/lib/learner/ticket'
import type { TicketPlan } from '@/lib/learner/types'

export const nonMcqWord = (plan: TicketPlan): string => {
  const kinds = new Set(plan.items.filter(isNonMcq).map((it) => (it.source === 'cr' ? 'written' : 'numeric')))
  return kinds.size === 1 ? [...kinds][0] : 'written or numeric'
}

const SELF_CHECK = ', which you check yourself against the model answer'

/** The rule line under the heading: the pass rule, and the written item named as self-checked when there is one. */
export const ticketRule = (p: TicketPlan): string => {
  const word = nonMcqWord(p)
  const self = word === 'written' ? SELF_CHECK : ''
  return p.form === 'spiral'
    ? `${p.items.length} items · pass with ${p.passRule.minCorrect} right, at least one of them ${word}${self}`
    : `${p.items.length} items · pass with ${p.passRule.minCorrect} right, including the ${word} one${self}`
}
