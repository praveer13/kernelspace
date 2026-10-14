/**
 * The EPLB debrief (docs/specs/wave-3.md §5.2): the first place the hidden reference appears. It gives the prediction's error,
 * then the first turn from which handing the rest of the layer to DeepSeek EPLB's rule would have met the reference, in the
 * sentences `eplbDivergence` writes from the learner's own layer, and shows the learner's final layer beside the reference's,
 * each with its DOM tables. A layer at or below the reference's has no divergence to name. Nothing here runs before the learner
 * asks for it.
 */

import { useEffect, useId, useRef } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/Button'
import { eplbView, type EplbDecisionDivergence } from '@/lib/world/eplb'
import { Layer } from './Board'
import Mirror from './Mirror'
import { EPLB_LESSON, errorLine, expertLabel, passedByHand, permille, tallyLine, times, viewOf, type EplbSession, type Tally } from './session'

export interface DebriefProps {
  /** A session with its summary set (`debrief(session)`). */
  session: EplbSession
  /** The loads passed by hand so far, this one included. */
  tally: Tally
  onAgain: () => void
  /** `page` links the lesson; the embed already sits in it. */
  mode: 'embed' | 'page'
}

/** The five experts with the most load per copy before a replicate turn, with the learner's pick and the reference's marked. */
function Ranking({ d }: { d: EplbDecisionDivergence }) {
  const v = d.before
  const mine = d.mine.kind === 'replicate' ? d.mine.expert : null
  const theirs = d.reference.kind === 'replicate' ? d.reference.expert : null
  const top = v.perCopy
    .map((units, e) => ({ units, e }))
    .sort((a, b) => b.units - a.units || a.e - b.e)
    .slice(0, 5)
  // The learner's pick may be outside the five: it is listed after them, so the sentence's numbers are all on screen.
  const rows = mine !== null && !top.some((r) => r.e === mine) ? [...top, { e: mine, units: v.perCopy[mine] }] : top
  return (
    <ol className="space-y-1 font-mono text-[12px] text-text-2" data-ranking>
      {rows.map((r) => (
        <li key={r.e}>
          {expertLabel(r.e)} · {permille(r.units)} per copy
          {r.e === mine && <span className="ml-2 text-amber">you copied this</span>}
          {r.e === theirs && <span className="ml-2 text-accent">the reference copies this</span>}
        </li>
      ))}
    </ol>
  )
}

export default function Debrief({ session, tally, onAgain, mode }: DebriefProps) {
  const { summary, prediction } = session
  const heading = useRef<HTMLHeadingElement>(null)
  const uid = useId()
  // The button that opened this has unmounted: hand focus to what comes next.
  useEffect(() => heading.current?.focus(), [])
  if (!summary) return null
  const div = summary.divergence
  const decision = div?.decision ?? null
  const mine = viewOf(session)
  const ghost = eplbView(session.play.ghost.state)

  let title = 'You matched the reference'
  if (decision) title = `The first divergence is at turn ${decision.op + 1}`
  else if (summary.mineUnits < summary.ghostUnits) title = 'You finished below the reference'

  return (
    <section aria-labelledby={`${uid}-h`} data-phase="debrief" className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">Debrief</p>
      <h3 ref={heading} id={`${uid}-h`} tabIndex={-1} className="mt-2 font-display text-h4 text-text-1 outline-none">
        {title}
      </h3>
      {prediction && (
        <p className="mt-2 rounded-sm border-l-2 border-line-bright bg-surface-2 px-3 py-2 text-body-sm text-text-1" data-prediction-error>
          {errorLine(prediction)}
        </p>
      )}
      <p className="mt-3 text-body-sm text-text-2">
        You placed {summary.placed} copies.{summary.skipped && ' You skipped ahead, so the reference finished your layer from where you stood.'}
      </p>
      <p data-debrief-explanation className="mt-3 rounded-sm border-l-2 border-accent bg-surface-2 px-3 py-2 text-body-sm text-text-1">
        {div
          ? div.explanation
          : `Your busiest GPU carries ${times(summary.mineUnits)}× the mean. The reference's busiest carries ${times(summary.ghostUnits)}×, so nothing in your layer put you behind it.`}
      </p>

      {decision && (
        <figure className="mt-4 space-y-2" data-decision>
          <figcaption className="font-mono text-[12px] text-text-1">
            {decision.kind === 'place'
              ? `Your layer just before turn ${decision.op + 1}. The copy on offer: ${expertLabel(decision.before.queue[0].expert)}, ${permille(decision.before.queue[0].units)}.`
              : `Load per copy just before turn ${decision.op + 1}.`}
          </figcaption>
          {decision.kind === 'place' && decision.mine.kind === 'place' && decision.reference.kind === 'place' ? (
            <Layer view={decision.before} marks={{ mine: decision.mine.gpu, reference: decision.reference.gpu }} />
          ) : (
            <Ranking d={decision} />
          )}
        </figure>
      )}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <DebriefSide title="Your layer" view={mine} />
        <DebriefSide title="The reference's layer" view={ghost} aside="DeepSeek EPLB's rule: copy the expert with the most load per copy, then put each copy on the least-loaded GPU with a free slot." />
      </div>

      <p className="mt-4 font-mono text-[12px] text-text-2" data-tally>
        {tallyLine(tally)}
        {!passedByHand(session) && summary.skipped && ' This layer does not count: the reference finished it.'}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="secondary" className="min-h-11" onClick={onAgain}>
          Play again with a new load
        </Button>
        {mode === 'page' && (
          <Link to={`/lesson/${EPLB_LESSON}`} className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
            Back to lesson {EPLB_LESSON}
          </Link>
        )}
        <p className="font-mono text-[11px] text-text-3">
          {session.provenance === 'unseen' ? 'a new load' : 'the shared practice load'} · load seed {session.seed}
        </p>
      </div>
    </section>
  )
}

/** One finished layer, read-only, with its own tables. */
function DebriefSide({ title, view, aside }: { title: string; view: ReturnType<typeof eplbView>; aside?: string }) {
  const uid = useId()
  return (
    <figure data-debrief-side className="min-w-0 space-y-2">
      <figcaption className="font-mono text-[12px] text-text-1">
        {title}: busiest GPU {times(view.maxUnits)}× the mean
      </figcaption>
      <Layer view={view} />
      {aside && <p className="font-mono text-[11px] text-text-3">{aside}</p>}
      <Mirror id={`${uid}-mirror`} view={view} title={title} />
    </figure>
  )
}
