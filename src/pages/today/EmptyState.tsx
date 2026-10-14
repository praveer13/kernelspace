import { Suspense, lazy } from 'react'
import type { Recommendation } from '@/lib/learner/types'
import UpNextCard from '@/components/learner/UpNextCard'

// The Fleet Daily card (wave-2.md §9.7) is its own chunk, so /today stays within its closure budget.
const DailyCard = lazy(() => import('@/components/daily/DailyCard'))
// The 30-day return (wave-3.md §7.5) is a stub until 3b-04; its own chunk, so /today's static closure does not grow.
const ProveReturnCard = lazy(() => import('@/components/learner/ProveReturnCard'))

export interface EmptyStateProps {
  upNext: Recommendation | null
  /** Offer the placement walk beside Up Next (`offerPlacement(state)`). */
  offerPlacement?: boolean
  /** A 5-item set of generated practice on Boot's KCs; absent when no family serves them. */
  onPractice?: () => void
}

/**
 * Spec §6.8 step 4: no cards yet. Says what earns a card, then Up Next and practice with new numbers. With no
 * lesson started, Up Next is rule 5's first lesson of the learner's path (wave-2.md §7.3): its first T lesson,
 * or the R lesson the path opens with.
 */
export default function EmptyState({ upNext, offerPlacement = false, onPractice }: EmptyStateProps) {
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
      {upNext && <UpNextCard rec={upNext} offerPlacement={offerPlacement} as="h3" />}
      <Suspense fallback={null}>
        <DailyCard variant="empty" />
        <ProveReturnCard variant="empty" />
      </Suspense>
    </section>
  )
}
