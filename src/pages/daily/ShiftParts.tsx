import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { DAILY_MINUTES } from '@/lib/world/daily'
import { SHIFT_LENGTH, type ShiftFacts, type ShiftIncident } from '@/lib/world/shift'
import { handoffNote, shiftSummary } from '@/lib/world/shift-note'
import NoteCard from './NoteCard'

/**
 * The shift's parts of the /daily page (docs/specs/wave-3.md §16.6, 3s-08), kept out of `pages/Daily.tsx` so that an
 * ordinary /daily visit does not download their markup and text: the page loads them with the rest of the shift
 * (`shift-kit`) when the URL asks for a shift. They take what they show as props and own no state of the page's.
 */

const BUTTON_QUIET = 'min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright'

/** What the shift says it is, above the first alert. */
export function ShiftIntro({ date }: { date: string }) {
  return (
    <p className="mt-2 text-body-sm text-text-2" data-shift-intro>
      Pilot · {date} · {SHIFT_LENGTH} incidents in a row, about {SHIFT_LENGTH * DAILY_MINUTES} min. The same three for everybody on your date. Each one is graded
      practice: it pays nothing and does not count as your Daily.
    </p>
  )
}

/** "Incident k of 3". Focus goes here when the shift moves on, since the button that asked for the next incident is gone. */
export function ShiftHead({ step, total }: { step: number; total: number }) {
  const head = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (step > 0) head.current?.focus()
  }, [step])
  return (
    <p ref={head} tabIndex={-1} className="mt-3 font-mono text-label uppercase text-text-2 outline-none" data-shift-head>
      Incident {step + 1} of {total}
    </p>
  )
}

/** The note from the incident before this one, read again (folded away) while this one plays; nothing on the first. */
export function CarriedNote({ finished, step }: { finished: Record<number, ShiftFacts>; step: number }) {
  const done = step > 0 ? finished[step - 1] : undefined
  return done ? <NoteCard note={handoffNote(done, step - 1)} carried /> : null
}

/** What follows a shift incident's debrief: the record line, the handoff note (the summary after the last), and the buttons. */
export function ShiftDebrief({
  plan,
  step,
  result,
  finished,
  wrote,
  onNext,
  onReplay,
}: {
  plan: readonly ShiftIncident[]
  step: number
  result: ShiftFacts
  finished: Record<number, ShiftFacts>
  wrote: boolean
  onNext: () => void
  onReplay: () => void
}) {
  const last = step >= plan.length - 1
  return (
    <>
      <p className="text-body-sm text-text-2" data-record-note>
        {wrote ? `Recorded as practice: incident ${step + 1} of ${plan.length}.` : 'Practice replay: nothing was written to your record.'}
      </p>
      {last ? (
        <NoteCard note={shiftSummary(plan.flatMap((p) => (p.index === step ? [result] : finished[p.index] ? [finished[p.index]] : [])))} summary />
      ) : (
        <NoteCard note={handoffNote(result, step)} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!last && (
          <button type="button" onClick={onNext} className="min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground" data-next-incident>
            Take incident {step + 2} of {plan.length}
          </button>
        )}
        <button type="button" onClick={onReplay} className={BUTTON_QUIET} data-replay-incident>
          Replay this incident
        </button>
        <Link to="/today" className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
          Back to Today
        </Link>
      </div>
    </>
  )
}
