import type { Recommendation } from '@/lib/learner/types'
import { UpNext } from './DoneCard'

export interface EmptyStateProps {
  upNext: Recommendation | null
  /** A 5-item set of generated practice on Boot's KCs; absent when no family serves them. */
  onPractice?: () => void
}

/** Spec §6.8 step 4: no cards yet. Says what earns a card, then Up Next and practice with new numbers. */
export default function EmptyState({ upNext, onPractice }: EmptyStateProps) {
  return (
    <section aria-labelledby="today-empty" className="space-y-4" data-today-empty>
      <div className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
        <h2 id="today-empty" className="font-display text-h3 text-text-1">
          Your review queue
        </h2>
        <p className="mt-2 text-body text-text-2">Nothing to refresh yet. Pass an exit ticket and its ideas start coming back here.</p>
        {onPractice && (
          <button
            type="button"
            onClick={onPractice}
            className="mt-4 min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground"
          >
            Practice with new numbers
          </button>
        )}
      </div>
      <UpNext rec={upNext} />
    </section>
  )
}
