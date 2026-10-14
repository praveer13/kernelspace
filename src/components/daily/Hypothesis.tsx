import { useId, useState } from 'react'
import type { IncidentClientSession } from '@/lib/fleet-session'
import { HYPOTHESIS_OPTIONS, type FlowRun } from '@/lib/world/daily'
import type { Hypothesis as HypothesisId } from '@/lib/world/incident-spec'

export interface HypothesisProps {
  session: Pick<IncidentClientSession, 'hypothesis'>
  /** the hypothesis logged so far; `null` until the first, and no probe opens before that */
  logged: HypothesisId | null
  busy: boolean
  run: FlowRun
  onLogged: (h: HypothesisId) => void
}

/**
 * Step 2 (docs/specs/wave-2.md §9.7): a hypothesis first. The learner picks a fault class or "unsure" and logs it
 * before the first probe, and may revise it until the fix goes in (the one held then is the one scored). The menu
 * is the same four faults for every incident, so it says nothing about which one this is.
 */
export default function Hypothesis({ session, logged, busy, run, onLogged }: HypothesisProps) {
  const name = useId()
  const [choice, setChoice] = useState<HypothesisId | null>(logged)
  const changed = choice !== null && choice !== logged
  async function log() {
    if (!choice) return
    const ok = await run(async () => {
      await session.hypothesis(choice)
      return true
    })
    if (ok) onLogged(choice)
  }
  return (
    <section className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5" data-flow="hypothesis" data-logged={logged ?? ''}>
      <fieldset>
        <legend className="font-display text-h3 text-text-1">{logged ? 'Your hypothesis' : 'What do you think is wrong?'}</legend>
        <p className="mt-1 text-body-sm text-text-2">
          {logged
            ? 'Revise it any time before you fix; the one you hold when the fix goes in is the one scored.'
            : 'Commit to a suspect before you look at anything. The probes open once you log it.'}
        </p>
        <div className="mt-3 space-y-2">
          {HYPOTHESIS_OPTIONS.map((o) => (
            <label
              key={o.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-body-sm text-text-1 has-[:checked]:border-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-info"
            >
              <input
                type="radio"
                name={name}
                value={o.id}
                checked={choice === o.id}
                onChange={() => setChoice(o.id)}
                className="h-5 w-5 shrink-0 accent-accent"
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        onClick={() => void log()}
        disabled={!changed || busy}
        className="mt-4 min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {logged ? 'Revise hypothesis' : 'Log hypothesis'}
      </button>
    </section>
  )
}
