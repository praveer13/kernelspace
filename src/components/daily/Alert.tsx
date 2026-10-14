import { useId } from 'react'
import type { IncidentClientSession } from '@/lib/fleet-session'
import { BURN_BUDGET, LIMIT_MINUTES, SCENARIO_NOTE } from '@/lib/world/incident-spec'
import { sinceAlert, sourceTitle, type IncidentSource } from '@/lib/world/daily'

export interface AlertProps {
  /** where the incident came from: the Daily's date, or a drill's seed */
  source: IncidentSource
  session: Pick<IncidentClientSession, 'alert' | 'limit'>
  /** the incident clock now, in absolute minutes (starts at `session.alert`) */
  clock: number
}

/**
 * Step 1 of the flow (docs/specs/wave-2.md §9.7): the page. It says that the fleet is missing its objective and how
 * much budget there is, and names no fault: the alert is the same sentence for every incident. The clock is
 * incident time (every probe and fix spends it while the fault keeps burning budget), never wall time.
 */
export default function Alert({ source, session, clock }: AlertProps) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="rounded-lg border border-danger/50 bg-surface-1 p-4 sm:p-5" data-flow="alert">
      <p className="font-mono text-label uppercase text-danger">SLO burn alert</p>
      <h2 id={id} className="mt-1 font-display text-h3 text-text-1">
        {sourceTitle(source)}
      </h2>
      <p className="mt-2 text-body text-text-1">
        The chat fleet is missing its latency objective: over the last 5 minutes more than 1 in 5 requests missed their first-token or per-token target.
      </p>
      <p className="mt-2 text-body-sm text-text-2">
        Error budget: {BURN_BUDGET} burn-minutes. Each minute the fault runs burns the share of requests that miss, and every probe and fix costs minutes.
      </p>
      <p className="mt-3 font-mono text-[12px] text-text-2" data-clock>
        Incident clock: {sinceAlert(clock, session.alert)} <span className="text-text-3">of {LIMIT_MINUTES}</span>
      </p>
      <p className="mt-2 text-[12px] text-text-3">{SCENARIO_NOTE}</p>
    </section>
  )
}
