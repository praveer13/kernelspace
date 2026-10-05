import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { changesLine, doneLine, firstReviewLine, type Tally } from '@/lib/learner/today'
import { changeCardsFor } from '@/lib/learner/change-cards'
import type { FirstReviewCalibration, Recommendation } from '@/lib/learner/types'
import { useProgress } from '@/lib/progress'
import HandoffButton from './HandoffButton'

// The change cards and the errata behind them load only when something has changed for this learner.
const ChangeCards = lazy(() => import('@/components/changes/ChangeCards'))

/** One Up Next with its reason (spec §7.3). A link, never a gate (W8). */
export function UpNext({ rec }: { rec: Recommendation | null }) {
  if (!rec) return null
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-4" data-up-next={rec.kind}>
      <p className="font-mono text-[11px] uppercase text-text-3">Up next</p>
      <p className="mt-1 font-display text-[17px] text-text-1">{rec.title}</p>
      <p className="mt-1 text-body-sm text-text-2">{rec.why}</p>
      <Link
        to={rec.to}
        className="mt-3 inline-flex min-h-11 items-center rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground"
      >
        {rec.kind === 'boot' ? 'Start Boot' : rec.kind === 'lesson' ? 'Open the lesson' : 'Go'}
        <span className="sr-only">: {rec.title}</span>
      </Link>
    </div>
  )
}

/** "N things you learned have changed", with the cards behind a disclosure. Nothing at all when nothing has changed. */
function Changes() {
  const lessons = useProgress((s) => s.lessons)
  const acks = useProgress((s) => s.acks)
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    import('@/data/errata')
      .then(({ ERRATA }) => {
        if (live) setCount(changeCardsFor(lessons, acks, ERRATA).filter((c) => !c.acked).length)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [lessons, acks])
  if (!count) return null
  return (
    <details className="group rounded-lg border border-line bg-surface-1 p-4" data-changes>
      <summary className="flex min-h-11 cursor-pointer items-center text-body-sm font-medium text-text-1">{changesLine(count)}</summary>
      <div className="mt-3">
        <Suspense fallback={<p className="text-body-sm text-text-3">Loading…</p>}>
          <ChangeCards />
        </Suspense>
      </div>
    </details>
  )
}

export interface DoneCardProps {
  /** What the learner just did; null when there was nothing due ("you are all caught up"). */
  tally: Tally | null
  /** First-review calibration over the whole ledger (the line appears once n ≥ 20). */
  calibration: FirstReviewCalibration | null
  /** A 5-item set of generated practice on introduced KCs; absent when no family serves any of them. */
  onKeepGoing?: () => void
  upNext: Recommendation | null
  /** Events not yet handed off. */
  pendingHandoff: number
  /** After a "keep going" set the heading says so. */
  extra?: boolean
}

/** Spec §6.8 step 3: the result, the calibration line, keep going, Up next, changes and hand-off. */
export default function DoneCard({ tally, calibration, onKeepGoing, upNext, pendingHandoff, extra = false }: DoneCardProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  // The card replaces the item that held focus: the heading takes it, so a keyboard learner starts here.
  useEffect(() => heading.current?.focus({ preventScroll: false }), [])
  const first = calibration ? firstReviewLine(calibration) : null
  return (
    <section aria-labelledby="today-done" className="space-y-4" data-today-done>
      <div className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
        <h2 ref={heading} id="today-done" tabIndex={-1} className="font-display text-h3 text-text-1 outline-none">
          {tally ? (extra ? 'Extra set done' : 'Session done') : 'You are all caught up'}
        </h2>
        <p role="status" className="mt-2 text-body text-text-2">
          {tally ? doneLine(tally) : 'Nothing is waiting for review today.'}
        </p>
        {first && <p className="mt-1 font-mono text-[12px] text-text-3">First reviews: {first}</p>}
        {onKeepGoing && (
          <button
            type="button"
            onClick={onKeepGoing}
            className="mt-4 min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright"
          >
            Keep going: 5 more items
          </button>
        )}
      </div>
      <UpNext rec={upNext} />
      <Changes />
      <HandoffButton pending={pendingHandoff} />
      <p>
        <Link to="/freshness" className="inline-flex min-h-11 items-center text-body-sm text-text-2 underline underline-offset-2 hover:text-accent">
          See what has changed in the course
        </Link>
      </p>
    </section>
  )
}
