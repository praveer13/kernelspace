import { useEffect, useState } from 'react'
import type { LearnerSummary } from '@/lib/learner/summary'
import { useProgress } from '@/lib/progress'

export type SummaryLoad = { status: 'loading' } | { status: 'error' } | { status: 'ready'; summary: LearnerSummary }

/**
 * The /progress summary (calibration, week, hand-off count, the ring's recall), read once per change of the
 * records it depends on. The ledger engine, the lesson corpus and the review model load on demand through
 * `summary.ts`, so the page itself stays light and a failure leaves the rest of /progress working.
 */
export function useSummary(): { load: SummaryLoad; retry: () => void } {
  const week = useProgress((s) => s.working['boot:week'])
  const prefs = useProgress((s) => s.working['today:prefs'])
  const placement = useProgress((s) => s.working['placement:result'])
  const handoff = useProgress((s) => s.working['handoff:last'])
  const lastExportAt = useProgress((s) => s.ledger.lastExportAt)
  const [load, setLoad] = useState<SummaryLoad>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    import('@/lib/learner/summary')
      .then((m) => m.loadSummary({ week, prefs, placement, handoff, lastExportAt, width: window.innerWidth }))
      .then((summary) => live && setLoad({ status: 'ready', summary }))
      .catch(() => live && setLoad({ status: 'error' }))
    return () => {
      live = false
    }
  }, [attempt, week, prefs, placement, handoff, lastExportAt])

  return {
    load,
    retry: () => {
      setLoad({ status: 'loading' })
      setAttempt((n) => n + 1)
    },
  }
}
