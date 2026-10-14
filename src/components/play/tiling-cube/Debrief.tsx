/**
 * The cube's debriefs (docs/specs/wave-3.md §6.3): one per level, and the closing one that lists the six.
 *
 * A level's debrief gives the prediction's error in the cube's wording, the model's reference choice with its reason
 * (the text lives with the model, `CUBE_LEVELS[i].debrief`, so the play, the tests and the principle share one source:
 * level 2 names the register cap, level 5 says no lone tile reaches the FP8 ridge), one line of principle and the
 * claims it rests on as chips. The closing debrief lists the six errors and the six principles.
 */

import { useEffect, useId, useRef } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/Button'
import { ClaimValue } from '@/components/ClaimValue'
import { byId } from '@/data/claims'
import { CUBE_LEVELS, type CubeLevel } from '@/lib/world/tiling'
import { LEVEL_CLAIMS, CUBE_LESSON, LEVEL_COUNT, closingHeadline, errorLine, fixed, levelsRight, runOf, type CubeSession } from './session'

export interface DebriefProps {
  session: CubeSession
  /** One level's debrief, or the closing one. */
  kind: 'level' | 'closing'
  /** Next level, or the closing debrief after the last. */
  onNext: () => void
  /** New numbers: a fresh session. */
  onAgain: () => void
  /** `page` links the lesson; the embed already sits in it. */
  mode: 'embed' | 'page'
}

/** The claims a level rests on, as labelled chips (the tap opens the source). */
function Chips({ level }: { level: CubeLevel }) {
  const ids = LEVEL_CLAIMS[level.id].filter((id) => byId[id])
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-0 font-mono text-[11px] text-text-2" data-claims>
      {ids.map((id) => (
        <li key={id} className="flex min-h-11 items-center gap-1.5">
          {byId[id].label} <ClaimValue id={id} className="inline-flex min-h-11 min-w-11 items-center justify-center text-text-1" />
        </li>
      ))}
    </ul>
  )
}

function LevelDebrief({ session, onNext }: Pick<DebriefProps, 'session' | 'onNext'>) {
  const uid = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  // The check's Next button has unmounted: hand focus to what comes next (spec §16.2).
  useEffect(() => heading.current?.focus(), [])
  const level = CUBE_LEVELS[Math.min(session.at, LEVEL_COUNT - 1)]
  const run = runOf(session)
  const last = session.at >= LEVEL_COUNT - 1
  return (
    <section aria-labelledby={`${uid}-h`} data-phase="debrief" data-level={level.n} className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">Debrief · level {level.n} of {LEVEL_COUNT}</p>
      <h3 ref={heading} id={`${uid}-h`} tabIndex={-1} className="mt-2 font-display text-h4 text-text-1 outline-none">
        {level.title}
      </h3>
      {run.predicted && (
        <p className="mt-2 rounded-sm border-l-2 border-accent bg-surface-2 px-3 py-2 text-body-sm text-text-1" data-prediction-error>
          {errorLine(run.predicted)}
        </p>
      )}
      {run.checked !== null && <p className="mt-2 text-body-sm text-text-2">{run.checked ? 'Your checked answer was right.' : 'Your checked answer was not right; the worked steps are above.'}</p>}
      <p className="mt-3 section-label">The model&apos;s reference choice</p>
      <p className="mt-1 text-body-sm text-text-2" data-reference>
        {level.debrief}
      </p>
      <ul className="mt-2 flex flex-wrap gap-2 font-mono text-[11px] text-text-2">
        {level.reference.map((r) => (
          <li key={r.label} className="rounded-sm bg-surface-2 px-1.5 py-0.5">
            {r.label}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-body-sm text-text-1" data-principle>
        {level.principle}
      </p>
      <div className="mt-3">
        <Chips level={level} />
      </div>
      <Button className="mt-4 min-h-11" onClick={onNext}>
        {last ? 'See all six' : `Level ${level.n + 1}: ${CUBE_LEVELS[level.n].title}`}
      </Button>
    </section>
  )
}

function ClosingDebrief({ session, onAgain, mode }: Pick<DebriefProps, 'session' | 'onAgain' | 'mode'>) {
  const uid = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const right = levelsRight(session)
  return (
    <section aria-labelledby={`${uid}-h`} data-phase="debrief" data-closing className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">Debrief · all six</p>
      <h3 ref={heading} id={`${uid}-h`} tabIndex={-1} className="mt-2 font-display text-h4 text-text-1 outline-none">
        {right} of {LEVEL_COUNT} predictions inside a factor of 2
      </h3>
      <p className="mt-2 rounded-sm border-l-2 border-accent bg-surface-2 px-3 py-2 text-body-sm text-text-1" data-headline>
        {closingHeadline()}
      </p>
      <ol className="mt-4 space-y-3">
        {CUBE_LEVELS.map((level, i) => {
          const p = session.runs[i].predicted
          return (
            <li key={level.id} data-closing-level={level.n} className="text-body-sm text-text-2">
              <span className="font-mono text-[12px] text-text-1">
                {level.n}. {level.title}
              </span>{' '}
              <span className="font-mono text-[12px] text-text-3">
                {p ? `${p.ok ? 'right' : 'off'}${p.logErr === undefined ? '' : `, ${fixed(10 ** p.logErr, 2)}× from the model`}` : 'not predicted'}
              </span>
              <br />
              {level.principle}
            </li>
          )
        })}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" className="min-h-11" onClick={onAgain}>
          Play again with new numbers
        </Button>
        {mode === 'embed' ? null : (
          <Link to={`/lesson/${CUBE_LESSON}`} className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
            Back to lesson {CUBE_LESSON}
          </Link>
        )}
      </div>
    </section>
  )
}

export default function Debrief({ session, kind, onNext, onAgain, mode }: DebriefProps) {
  return kind === 'closing' ? <ClosingDebrief session={session} onAgain={onAgain} mode={mode} /> : <LevelDebrief session={session} onNext={onNext} />
}
