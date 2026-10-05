import { Suspense, lazy, useState } from 'react'
import { Link } from 'react-router'
import { firstReviewLine, weekBarPct, weekBarText, parsePrefs, type TodayPrefs } from '@/lib/learner/today'
import { normalizeWeekPlan } from '@/lib/learner/planner'
import { localDayOf } from '@/lib/learner/summary'
import type { SummaryLoad } from './useSummary'
import type { WeekPlan } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import HandoffButton from '@/pages/today/HandoffButton'

const WeekSheet = lazy(() => import('@/pages/today/WeekSheet'))

const pct = (x: number): string => `${Math.round(x * 100)} %`

export interface ReviewPanelProps {
  load: SummaryLoad
  onRetry: () => void
}

/**
 * What the review model says about you, on /progress (wave-1.md §6.9, §8.5): first-review calibration, the
 * week, and the hand-off to another device. All of it is derived on read from the ledger by the functions
 * Today uses, so it matches what Today shows. Calibration needs 20 first reviews before it prints a line; until
 * then it says how many there are. The week is editable here through the same sheet as on Today.
 */
export default function ReviewPanel({ load, onRetry }: ReviewPanelProps) {
  const week = useProgress((s) => s.working['boot:week'])
  const prefsRaw = useProgress((s) => s.working['today:prefs'])
  const setWorking = useProgress((s) => s.setWorking)
  const [sheet, setSheet] = useState(false)

  const summary = load.status === 'ready' ? load.summary : null
  const cal = summary?.calibration
  const line = cal ? firstReviewLine(cal) : null
  const prefs: TodayPrefs = parsePrefs(prefsRaw)
  // The sheet edits the plan as it stands now, not the one the last load saw.
  const plan = normalizeWeekPlan(week)

  return (
    <section aria-labelledby="review-heading" className="rounded-lg border border-line bg-surface-1 p-6" data-progress-review>
      <h2 id="review-heading" className="font-display text-h3 text-text-1">
        Your reviews
      </h2>

      {load.status === 'loading' && (
        <p role="status" className="mt-4 font-mono text-body-sm text-text-3">
          Reading your review history…
        </p>
      )}
      {load.status === 'error' && (
        <div role="alert" className="mt-4">
          <p className="text-body-sm text-text-2">Could not read your review history.</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright"
          >
            Try again
          </button>
        </div>
      )}

      {summary && cal && (
        <div className="mt-4 space-y-6">
          <div data-calibration>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">First-review calibration</h3>
            {line && cal.observed !== null && cal.ci95 ? (
              <>
                <p className="mt-2 text-body text-text-1">First reviews: {line}</p>
                <p className="mt-1 font-mono text-[12px] text-text-3">
                  n = {cal.n} · 95 % interval on the observed share {pct(cal.ci95[0])} to {pct(cal.ci95[1])}
                </p>
              </>
            ) : (
              <p className="mt-2 text-body-sm text-text-2">
                The model predicts how much you will remember the first time an idea comes back, then checks. It prints a line after 20 first
                reviews; you have {cal.n}.
              </p>
            )}
          </div>

          <div data-week>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">This week</h3>
            <div className="mt-2 flex items-center gap-3">
              <div
                role="progressbar"
                aria-label="Minutes this week"
                aria-valuemin={0}
                aria-valuemax={Math.round(summary.week.targetMinutes)}
                aria-valuenow={Math.min(Math.round(summary.week.doneMinutes), Math.round(summary.week.targetMinutes))}
                aria-valuetext={weekBarText(summary.week)}
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line"
              >
                <div className="h-full rounded-full bg-accent motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${weekBarPct(summary.week)}%` }} />
              </div>
              <p className="shrink-0 font-mono text-[12px] text-text-2">{weekBarText(summary.week)}</p>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4">
              <button
                type="button"
                onClick={() => setSheet(true)}
                className="inline-flex min-h-11 items-center text-body-sm text-text-2 underline underline-offset-2 hover:text-accent"
              >
                Set your week
              </button>
              <Link to="/today" className="inline-flex min-h-11 items-center text-body-sm text-text-2 underline underline-offset-2 hover:text-accent">
                Open Today
              </Link>
            </div>
          </div>

          <div data-handoff>
            <h3 className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">Another device</h3>
            <p className="mb-2 mt-2 text-body-sm text-text-2">
              A file of what changed since the last hand-off. Import it on the other device with Merge. Nothing is sent anywhere.
            </p>
            <HandoffButton pending={summary.pending} />
          </div>
        </div>
      )}

      {sheet && (
        <Suspense fallback={null}>
          <WeekSheet
            plan={plan}
            prefs={prefs}
            day={localDayOf(new Date())}
            onPlan={(next: WeekPlan) => setWorking('boot:week', { ...next })}
            onPrefs={(next) => setWorking('today:prefs', { ...next })}
            onClose={() => setSheet(false)}
          />
        </Suspense>
      )}
    </section>
  )
}
