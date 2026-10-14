/**
 * The 30-day return on Today (docs/specs/wave-3.md §7.5, §2.3): a question about a lab the learner proved a month
 * ago, beside the Fleet Daily card. A stub until 3b-04 fills it; it renders nothing, so Today's done card and empty
 * state mount it already and 3b-04 never edits them. `variant` is the word DailyCard takes.
 */
export interface ProveReturnCardProps {
  variant: 'done' | 'empty'
}

export default function ProveReturnCard(props: ProveReturnCardProps): null {
  void props
  return null
}
