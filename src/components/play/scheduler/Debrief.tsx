/**
 * The scheduler debrief (docs/specs/wave-2.md §8.3): the first place the hidden reference appears. It names the
 * request the reference served and you did not, then the decision that lost it, in the sentences schedDivergence
 * writes, and shows both runs at that iteration side by side (waiting list, running list, free tokens), each with
 * its DOM mirror. Nothing here runs before the learner asks for it.
 */

import { useEffect, useId, useRef } from 'react'
import { Button } from '@/components/Button'
import { referenceScheduler } from '@/lib/fleet-model'
import { effectiveAdmits, groups, schedEndLine } from '@/lib/world/sched'
import type { SchedFrame } from '@/lib/world/types'
import Mirror from './Mirror'
import { KvBar } from './Queue'
import { iterations, progressWords, provenanceLine, sloLine, type SchedSession } from './session'

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const ids = (xs: readonly number[]) => (xs.length === 0 ? 'nothing' : xs.map((x) => `#${x}`).join(', '))

export interface DebriefProps {
  /** A session with its summary set (`debrief(session)`). */
  session: SchedSession
  onAgain: () => void
}

/** One run at the debrief's iteration, read-only: the pool, who waits, who runs, and what was admitted. */
function Side({ title, frame, admitted, preempted, aside }: { title: string; frame: SchedFrame; admitted: readonly number[]; preempted?: readonly number[]; aside?: string }) {
  const uid = useId()
  const v = frame.view
  return (
    <figure data-debrief-side className="min-w-0 space-y-2">
      <figcaption className="font-mono text-[12px] text-text-1">{title}</figcaption>
      <KvBar frame={frame} describedBy={`${uid}-mirror`} title={title} />
      <p className="font-mono text-[12px] text-text-2">
        Admitted: <span className="text-text-1">{ids(admitted)}</span>
        {preempted && preempted.length > 0 && (
          <>
            {' '}
            · Preempted: <span className="text-text-1">{ids(preempted)}</span>
          </>
        )}
      </p>
      <p className="font-mono text-[11px] text-text-3">Waiting, {v.waiting.length}</p>
      <ul className="space-y-1 font-mono text-[12px] text-text-2">
        {v.waiting.map((r) => (
          <li key={r.id} className={admitted.includes(r.id) ? 'text-accent' : undefined}>
            #{r.id} · {groups(r.prompt)} tokens · waited {iterations(v.iter - r.arrival)}
            {admitted.includes(r.id) && ' · admitted'}
          </li>
        ))}
        {v.waiting.length === 0 && <li className="text-text-3">nothing</li>}
      </ul>
      <p className="font-mono text-[11px] text-text-3">
        Running, {v.running.length} of {v.maxRunning}
      </p>
      <ul className="space-y-1 font-mono text-[12px] text-text-2">
        {frame.running.map((r) => (
          <li key={r.id}>
            #{r.id} · {groups(r.prompt)} tokens · {progressWords(r)}
          </li>
        ))}
        {frame.running.length === 0 && <li className="text-text-3">nothing</li>}
      </ul>
      {aside && <p className="font-mono text-[11px] text-text-3">{aside}</p>}
      <Mirror id={`${uid}-mirror`} frame={frame} title={title} />
    </figure>
  )
}

export default function Debrief({ session, onAgain }: DebriefProps) {
  const { summary, setup, trace } = session
  const heading = useRef<HTMLHeadingElement>(null)
  const uid = useId()
  // The button that opened this has unmounted: hand focus to what comes next.
  useEffect(() => heading.current?.focus(), [])
  if (!summary) return null
  const div = summary.divergence
  const decision = div?.decision ?? null
  const blockSize = trace.cfg.blockSize

  let title = 'You kept pace with the reference'
  if (decision) title = `The first divergence is at iteration ${decision.iter}`
  else if (div) title = `The first request you lost is #${div.request.id}`

  return (
    <section aria-labelledby={`${uid}-h`} data-phase="debrief" className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">Debrief</p>
      <h3 ref={heading} id={`${uid}-h`} tabIndex={-1} className="mt-2 font-display text-h4 text-text-1 outline-none">
        {title}
      </h3>
      <p className="mt-2 text-body-sm text-text-2">
        {capital(schedEndLine(setup, session.play))}.{summary.skipped && ' You skipped ahead, so the reference finished your run from where you stood.'} You served {summary.survived} of{' '}
        {summary.total} requests within the SLO ({sloLine}). The reference served {summary.ghostSurvived}.
      </p>

      {div ? (
        <>
          <p data-debrief-explanation className="mt-4 rounded-sm border-l-2 border-accent bg-surface-2 px-3 py-2 text-body-sm text-text-1">
            {div.explanation}
          </p>
          {decision && (
            <>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <Side
                  title={`Your run at iteration ${decision.iter}`}
                  frame={decision.mineFrame}
                  admitted={effectiveAdmits(decision.mineFrame.view, decision.mine, blockSize)}
                  preempted={decision.mine.preempt}
                  aside={`On this same view the reference admits ${ids(decision.reference.admit)}.`}
                />
                <Side
                  title={`The reference's run at iteration ${decision.iter}`}
                  frame={decision.ghostFrame}
                  admitted={referenceScheduler(decision.ghostFrame.view).admit}
                  aside="The reference's own run reaches this iteration in its own state, so its queues can differ from yours."
                />
              </div>
              <p className="mt-3 font-mono text-[11px] text-text-3">
                {decision.recoverable
                  ? 'Handing your run to the reference at this turn would have served the request in time.'
                  : 'No later turn could have served the request in time; this is the earliest turn where you and the reference chose differently.'}
              </p>
            </>
          )}
        </>
      ) : (
        <p className="mt-3 text-body-sm text-text-2">
          Nothing in your run put you behind the reference: every request it served within the SLO, you served too.{' '}
          {session.provenance === 'practice'
            ? 'The shared practice minute is gentle, with short prompts and a pool that never fills, so most orders get through it. A new minute is drawn to be harder. Compose below, or play one.'
            : 'Compose a policy below and see what else holds up.'}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="secondary" onClick={onAgain}>
          Play again with a new minute
        </Button>
        <p className="font-mono text-[11px] text-text-3">
          {provenanceLine(session.provenance)}
          {trace.seed !== null && ` · seed ${trace.seed}`}
        </p>
      </div>
    </section>
  )
}
