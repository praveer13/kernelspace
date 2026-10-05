import { readOnlyNote } from '@/lib/ledger/read-only'
import type { ReadOnlyReason } from '@/lib/ledger/types'

/**
 * Shown when the schema guard has latched this tab read-only (spec §8.7, §9.3): a newer bundle owns the
 * data, so actions are no-ops and nothing is written. It says which reason latched it, in the same words
 * as the /progress note, because a newer snapshot or database is not "open in another tab". Reload is the
 * only way out.
 *
 * A polite status, not an alert, and it never takes focus: the learner may be mid-quiz or mid-sentence.
 */
export default function ReadOnlyBanner({ reason }: { reason?: ReadOnlyReason }) {
  return (
    <div
      role="status"
      className="border-b border-amber/40 bg-surface-2 py-2.5 font-mono text-xs text-text-1"
    >
      <div className="mx-auto flex max-w-app flex-wrap items-center gap-x-4 gap-y-1 px-6 lg:px-12">
        <p>
          <span className="text-amber">read-only</span>
          {' · '}
          {readOnlyNote(reason)}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-line-bright px-2.5 py-1 text-accent hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          reload
        </button>
      </div>
    </div>
  )
}
