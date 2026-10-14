/**
 * One level of the cube while it is being played (docs/specs/wave-3.md §6.3): predict, then explore, then check. The
 * debrief is Debrief.tsx, which Play.tsx renders when the level is answered.
 *
 * Predict is the lesson-block item of the level on the session's seed, as an estimate with no verdict. Explore is the
 * steppers and the three face views, with the DOM table (Mirror.tsx, passed in by Play) beside them (Views.tsx, loaded on
 * demand: the first screen is the prediction); Check is the same item as an exact question.
 */

import { Suspense, lazy, useEffect, useId, useMemo, useRef, type ReactNode } from 'react'
import { Button } from '@/components/Button'
import ErrorBoundary from '@/components/ErrorBoundary'
import ItemCard from '@/components/items/ItemCard'
import type { ItemResult } from '@/lib/items/play'
import type { CubeLevel } from '@/lib/world/tiling'
import { genOf, levelCount, predictChecker, predictedInstance, runOf, type ChoiceControl, type CubeSession, type NumberControl } from './session'

// The explore half is not on the first screen (a prediction), so it loads on demand. Play fetches it as soon as the
// learner sends a prediction (the same import, so one fetch), so it is almost always there by the time "Open the views" is pressed.
const Views = lazy(() => import('./Views'))

/** Room for the views while they load (level 1 measures 1,164 px at 360 px wide and 959 px at 1280), so what follows them does not jump. */
const VIEWS_ROOM = 'min-h-[70rem] sm:min-h-[58rem]'

/** The Suspense fallback while the views load: a status, so a screen reader hears that more is coming. */
export function ViewsLoading() {
  return (
    <div data-phase="explore-loading" className={VIEWS_ROOM}>
      <p role="status" className="font-mono text-body-sm text-text-3">
        Loading the views…
      </p>
    </div>
  )
}

/** What replaces the views when their load failed (offline, or a deploy replaced the chunks); a reload is the retry, and the session lives in React state, so it restarts the play. */
export function ViewsFailed() {
  return (
    <div role="status" className="space-y-3" data-play-error="tiling-cube-views">
      <p className="text-body-sm text-text-2">The views did not load, so you may be offline. Your prediction is recorded; a reload starts the play again from level 1.</p>
      <Button variant="secondary" onClick={() => window.location.reload()}>
        Reload to try again
      </Button>
    </div>
  )
}

export interface LevelProps {
  session: CubeSession
  level: CubeLevel
  /** The id of the DOM table the pictures point at. */
  mirrorId: string
  /** The table itself, rendered between the views and the check. */
  mirror: ReactNode
  /** Whether a step should take focus: false for the first paint, so loading the page or the lesson never steals it. */
  focus: boolean
  onPredicted: (r: ItemResult) => void
  onOpenViews: () => void
  onNudge: (id: NumberControl, dir: 1 | -1, coarse: boolean) => void
  onChoose: (id: ChoiceControl, value: string) => void
  onToCheck: () => void
  onChecked: (r: ItemResult) => void
  onToDebrief: () => void
}

export default function Level({ session, level, mirrorId, mirror, focus, onPredicted, onOpenViews, onNudge, onChoose, onToCheck, onChecked, onToDebrief }: LevelProps) {
  const uid = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const run = runOf(session)
  const gen = useMemo(() => genOf(level), [level])
  const predictItem = useMemo(() => ({ source: 'gen' as const, inst: predictedInstance(run.inst) }), [run.inst])
  const grader = useMemo(() => predictChecker(gen), [gen])
  const checkItem = useMemo(() => ({ source: 'gen' as const, inst: run.inst }), [run.inst])
  const { step, explore } = session
  const views = step === 'explore' || step === 'check'
  const at = `${step}:${session.at}`
  // The step already on screen when this mounts, unless the learner got here by acting: the first paint never takes focus.
  const seen = useRef<string | null>(focus ? null : at)

  // A new step takes focus on its heading, so a keyboard user continues from the top of what changed. The check's own
  // card takes focus on its first field instead.
  useEffect(() => {
    if (seen.current === at) return
    seen.current = at
    if (step !== 'check') heading.current?.focus()
  }, [at, step])

  return (
    <section aria-labelledby={`${uid}-h`} data-level={level.n} data-step={step} className="space-y-4">
      <p className="section-label">{levelCount(session)}</p>
      <h3 ref={heading} id={`${uid}-h`} tabIndex={-1} className="font-display text-h4 text-text-1 outline-none">
        {level.title}
      </h3>
      <p className="text-body-sm text-text-2">{level.question}</p>

      {step === 'predict' && (
        <div data-phase="predict">
          <p className="mb-3 text-body-sm text-text-2">
            {level.n === 1 ? 'Predict the intensity of this tile first, then open the views to check it.' : 'Predict first, then open the views to check it.'} A rough number is fine, and there
            is no verdict yet.
          </p>
          <ItemCard
            key={`predict:${level.n}:${run.inst.seed}`}
            item={predictItem}
            gen={grader}
            deferVerdict
            eyebrow="your prediction"
            nextLabel="Open the views"
            onResult={onPredicted}
            onNext={onOpenViews}
          />
        </div>
      )}

      {views && (
        <ErrorBoundary fallback={<ViewsFailed />}>
          <Suspense fallback={<ViewsLoading />}>
            <Views level={level} explore={explore} step={step} mirrorId={mirrorId} mirror={mirror} onNudge={onNudge} onChoose={onChoose} onToCheck={onToCheck} />
          </Suspense>
        </ErrorBoundary>
      )}

      {step === 'check' && (
        <div data-phase="check">
          <ItemCard
            key={`check:${level.n}:${run.inst.seed}`}
            item={checkItem}
            gen={gen}
            autoFocus
            eyebrow="check · the same question, exact"
            nextLabel="See the debrief"
            onResult={onChecked}
            onNext={onToDebrief}
          />
        </div>
      )}
    </section>
  )
}
