/**
 * The Fleet Daily card on Today (docs/specs/wave-2.md §9.7, §2.3): "Fleet Daily #47 · about 8 min · your engine:
 * 2 of 4 boxes". A stub until 2b-19 fills it; it renders nothing, so Today's done card and empty state mount it
 * already and 2b-19 never edits them. Today loads it lazily to stay within its 200 KB closure.
 */
export interface DailyCardProps {
  /** Where it sits: under the done card's result, or in the empty state. */
  variant: 'done' | 'empty'
}

export default function DailyCard(props: DailyCardProps): null {
  void props
  return null
}
