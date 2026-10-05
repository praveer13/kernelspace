/**
 * TestOut: "Already know this? Test out: 3 items, about 3 minutes." (docs/specs/wave-1.md §7.2; owner
 * answer O7). Offered on a lesson that is not done. The bar is the exit ticket's (at least 2 of 3, the
 * non-MCQ right), and a pass marks the lesson done with its cards on a day-7 confirmation. The bar is not
 * lower for being asked first: O7 adds the confirmation, not a shortcut.
 *
 * Items are generated where a family covers the lesson's KCs; otherwise they are checkpoint questions the
 * learner has not answered, with a constructed response as the non-MCQ (`planTicket`, form `testout`). The
 * attempt is written by `recordTicket` with `form: 'testout'`.
 *
 * A miss offers the lesson and locks nothing. The one limit is one test-out per lesson per local day, read
 * from the ledger and from this browser's outbox (a write reaches the outbox synchronously and the engine a
 * moment later, so a reload right after a test-out still sees it): it keeps the measurement honest, and the
 * lesson itself stays open (W8).
 */
import { useEffect, useState } from 'react'
import type { Lesson } from '@/data/lessons/types'
import { localDateKey } from '@/lib/economy'
import { browserEnv, getLedgerClient } from '@/lib/ledger/client'
import { collectOutboxes, pendingFrom } from '@/lib/ledger/outbox'
import type { LocalDay } from '@/lib/ledger/types'
import { testOutUsedToday } from '@/lib/learner/ticket'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'
import ExitTicket from './ExitTicket'

export interface TestOutProps {
  lesson: Lesson
  trackColor?: string
  className?: string
}

/** Whether a test-out for this lesson sits in a localStorage outbox on `day`: the write the engine may not have committed yet. */
function usedInOutbox(lessonId: string, day: LocalDay): boolean {
  try {
    return testOutUsedToday(pendingFrom(collectOutboxes(browserEnv().storage, browserEnv().tabId)).events, lessonId, day)
  } catch {
    return false
  }
}

export default function TestOut({ lesson, trackColor, className }: TestOutProps) {
  const status = useProgress((s) => s.lessons[lesson.id]?.status)
  const [open, setOpen] = useState(false)
  // null until the ledger has been read (a read that fails leaves the offer open); a write still in the outbox counts at once
  const [usedToday, setUsedToday] = useState<boolean | null>(() => (usedInOutbox(lesson.id, localDateKey() as LocalDay) ? true : null))

  useEffect(() => {
    let live = true
    const day = localDateKey() as LocalDay
    const pending = usedInOutbox(lesson.id, day)
    getLedgerClient()
      .then((client) => client.events({ kinds: ['quiz'], refPrefix: `lesson:${lesson.id}` }))
      .then((events) => live && setUsedToday(pending || testOutUsedToday(events, lesson.id, day)))
      .catch(() => live && setUsedToday(pending))
    return () => {
      live = false
    }
  }, [lesson.id])

  // a test-out that passes marks the lesson done under its own verdict panel: keep it until it is closed
  if (open) {
    return (
      <ExitTicket
        lesson={lesson}
        form="testout"
        {...(trackColor ? { trackColor } : {})}
        className={className}
        onResolved={() => setUsedToday(true)}
        onClose={() => setOpen(false)}
        fallback={<p className={cn('text-body-sm text-text-2', className)}>This lesson has no test-out yet. Read it, then take its exit ticket.</p>}
      />
    )
  }
  if (status === 'done') return null

  if (usedToday) {
    return (
      <p className={cn('rounded-md border border-line bg-surface-1 px-4 py-3 text-body-sm text-text-2', className)}>
        You used today&apos;s test-out for this lesson. The lesson is open, and a test-out is available again tomorrow.
      </p>
    )
  }

  const checking = usedToday === null
  return (
    <div className={cn('rounded-md border border-line bg-surface-1 px-4 py-3', className)}>
      <p className="text-body-sm text-text-1">Already know this? Test out: 3 items, about 3 minutes.</p>
      <button
        type="button"
        aria-disabled={checking}
        onClick={() => !checking && setOpen(true)}
        className={cn(
          'mt-2 min-h-11 rounded-md border border-line-bright bg-surface-2 px-5 font-display text-[15px] font-semibold text-text-1',
          checking ? 'opacity-60' : 'hover:border-accent',
        )}
      >
        Test out
      </button>
      {checking && (
        <p role="status" className="mt-2 text-body-sm text-text-2">
          Checking whether today&apos;s test-out is free.
        </p>
      )}
    </div>
  )
}
