import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useProgress } from '@/lib/progress'
import ReadOnlyBanner from './ReadOnlyBanner'

/**
 * Storage notices that still apply under Addendum A (spec §9.8): the read-only banner (§8.7) and the two
 * "your progress is not where you think it is" states. Layout mounts this lazily and only when the ledger
 * status asks for it, so a healthy session never fetches the chunk.
 *
 * Each notice is a polite `role="status"` in normal flow below the navbar. None takes focus.
 */
export default function LedgerNotices() {
  const ledger = useProgress((s) => s.ledger)
  const [clearedSeen, setClearedSeen] = useState(false)

  return (
    <>
      {ledger.readOnly && <ReadOnlyBanner />}
      {ledger.backend === 'memory' && (
        <Notice>
          Storage is limited here: export your progress regularly.{' '}
          <Link to="/progress" className="text-accent underline underline-offset-2">
            open progress
          </Link>
        </Notice>
      )}
      {ledger.cleared && !clearedSeen && (
        <Notice onDismiss={() => setClearedSeen(true)}>
          This browser cleared your saved progress. Restore it from your last export.{' '}
          <Link to="/progress" className="text-accent underline underline-offset-2">
            import an export
          </Link>
        </Notice>
      )}
    </>
  )
}

function Notice({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    <div
      role="status"
      className="border-b border-amber/40 bg-surface-2 py-2.5 font-mono text-xs text-text-1"
    >
      <div className="mx-auto flex max-w-app flex-wrap items-center gap-x-4 gap-y-1 px-6 lg:px-12">
        <p>{children}</p>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-line-bright px-2.5 py-1 text-text-2 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            dismiss
          </button>
        )}
      </div>
    </div>
  )
}
