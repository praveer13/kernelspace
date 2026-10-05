import type { RingName } from '@/lib/economy'
import { bannerFor, dayHeading, sloLine, weekBarPct, weekBarText } from '@/lib/learner/today'
import type { SessionPlan, WeekStatus } from '@/lib/learner/types'
import type { LocalDay } from '@/lib/ledger/types'

export interface HeaderProps {
  day: LocalDay
  /** The session as composed, or null before it exists. */
  plan: Pick<SessionPlan, 'budget' | 'mode'> | null
  /** Cards the learner has; 0 reads "no cards yet". */
  cardCount: number
  /** The week against the plan, or null until the ledger has been read. */
  week: WeekStatus | null
  /** The highest ring earned (spec §8.5). */
  ring: RingName
  /** "10 min review + continue T1.L4 (20 min)" */
  planLine?: string
  onEditWeek: () => void
}

/** Spec §6.8 step 1: the day, the SLO line, the week bar, the ring chip and the welcome-back or catch-up banner. */
export default function Header({ day, plan, cardCount, week, ring, planLine, onEditWeek }: HeaderProps) {
  const banner = plan ? bannerFor(plan.mode) : null
  return (
    <header>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="section-label">0x00 — today</p>
          <h1 className="mt-2 font-display text-h3 text-text-1 sm:text-h2">{dayHeading(day)}</h1>
        </div>
        <span className="mt-1 shrink-0 rounded-sm border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-text-2">
          <span className="sr-only">Highest ring earned: </span>
          {ring}
        </span>
      </div>

      {plan && <p className="mt-2 font-mono text-[12px] text-text-3">{sloLine(plan, cardCount)}</p>}
      {planLine && <p className="mt-1 text-body-sm text-text-2">{planLine}</p>}

      {week && (
        <div className="mt-3 flex items-center gap-3">
          <div
            role="progressbar"
            aria-label="Minutes this week"
            aria-valuemin={0}
            aria-valuemax={Math.round(week.targetMinutes)}
            aria-valuenow={Math.min(Math.round(week.doneMinutes), Math.round(week.targetMinutes))}
            aria-valuetext={weekBarText(week)}
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line"
          >
            <div className="h-full rounded-full bg-accent motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${weekBarPct(week)}%` }} />
          </div>
          <p className="shrink-0 font-mono text-[12px] text-text-2">{weekBarText(week)}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onEditWeek}
        className="mt-1 inline-flex min-h-11 items-center text-body-sm text-text-2 underline underline-offset-2 hover:text-accent"
      >
        Set your week
      </button>

      {banner && (
        <p role="status" data-banner={banner.kind} className="mt-3 rounded-md border border-line bg-surface-2 px-4 py-3 text-body-sm text-text-2">
          {banner.text}
        </p>
      )}
    </header>
  )
}
