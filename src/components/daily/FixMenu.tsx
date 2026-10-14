import { useRef, useState } from 'react'
import type { IncidentClientSession } from '@/lib/fleet-session'
import { FIXES, FIX_IDS, FIX_MINUTES, WAIT_MINUTES, WRONG_FIX_MINUTES, type FixId } from '@/lib/world/incident-spec'
import type { FlowRun } from '@/lib/world/daily'
import type { IncidentFixReply, IncidentWaitReply } from '@/workers/fleet-protocol'

export interface FixMenuProps {
  session: Pick<IncidentClientSession, 'fix' | 'wait'>
  /** fixes open with the probes (a hypothesis is logged) and close when the incident has ended */
  enabled: boolean
  busy: boolean
  run: FlowRun
  onFix: (fix: FixId, reply: IncidentFixReply) => void
  onWait: (reply: IncidentWaitReply) => void
  /** stop here: run the clock out and see the debrief without the right fix */
  onGiveUp: () => void
}

/**
 * Step 4 (docs/specs/wave-2.md §9.7): the fix menu. One fix per fault, the same four for every incident. The right
 * one takes a minute to roll out; any other wastes five and changes nothing. "Wait a minute" lets the clock run
 * while you think. A wrong fix says so in a status line that takes focus, so the keyboard learner hears what it cost.
 */
export default function FixMenu({ session, enabled, busy, run, onFix, onWait, onGiveUp }: FixMenuProps) {
  const [message, setMessage] = useState('')
  const status = useRef<HTMLParagraphElement>(null)
  async function apply(fix: FixId) {
    const reply = await run(() => session.fix(fix))
    if (!reply) return
    if (!reply.effective && !reply.ended) {
      setMessage(`${FIXES[fix].label}: that did not help. ${WRONG_FIX_MINUTES} incident minutes passed and the fault is still there.`)
      // after the render that shows the message
      setTimeout(() => status.current?.focus(), 0)
    }
    onFix(fix, reply)
  }
  async function wait() {
    const reply = await run(() => session.wait())
    if (!reply) return
    setMessage(`You waited ${WAIT_MINUTES} minute. Nothing changed but the clock.`)
    setTimeout(() => status.current?.focus(), 0)
    onWait(reply)
  }
  return (
    <section className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5" data-flow="fix">
      <h2 className="font-display text-h3 text-text-1">Fix</h2>
      <p className="mt-1 text-body-sm text-text-2">
        The right fix takes {FIX_MINUTES} minute to roll out. A wrong one wastes {WRONG_FIX_MINUTES} and changes nothing. You can revise your hypothesis before you pick.
      </p>
      <ul className="mt-3 space-y-2">
        {FIX_IDS.map((id) => (
          <li key={id}>
            <button
              type="button"
              data-fix={id}
              disabled={!enabled || busy}
              onClick={() => void apply(id)}
              className="min-h-11 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-left text-body-sm text-text-1 hover:border-line-bright disabled:cursor-not-allowed disabled:opacity-50"
            >
              {FIXES[id].label}
            </button>
          </li>
        ))}
      </ul>
      <p ref={status} tabIndex={-1} role="status" className="mt-3 text-body-sm text-amber outline-none" data-fix-status>
        {message}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-wait
          disabled={!enabled || busy}
          onClick={() => void wait()}
          className="min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright disabled:cursor-not-allowed disabled:opacity-50"
        >
          Wait a minute
        </button>
        <button
          type="button"
          data-give-up
          disabled={!enabled || busy}
          onClick={onGiveUp}
          className="min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-2 hover:border-line-bright disabled:cursor-not-allowed disabled:opacity-50"
        >
          Stop and see the debrief
        </button>
      </div>
    </section>
  )
}
