/**
 * The Tiling Cube in 2D (docs/specs/wave-3.md §6.3): six levels, each predict → explore → check → debrief, then a
 * closing debrief that lists the six and the In-production card. One component for the lesson embed (PlayBlock) and the
 * full-screen route (/play/tiling-cube).
 *
 * The controls are steppers and radios: no control is a drag (WCAG 2.5.7), and every number the three face views draw is
 * in the DOM table beside them (Mirror.tsx). Each level opens with a prediction on the session's seed, written as a
 * `predict` event (src `play`) before any view opens; the check is an `item` event on the same instance. The play itself
 * is recorded once, when the closing debrief is reached.
 *
 * The first session runs on the practice seed that the cube's band checks; "Play again with new numbers" draws a seed that
 * passes the same band, so a new session is unseen.
 */

import { Suspense, lazy, useCallback, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/Button'
import ErrorBoundary from '@/components/ErrorBoundary'
import { TILING_CUBE, freshEntropy } from '@/data/plays'
import { useProgress } from '@/lib/progress'
import { CUBE_PLAY_ID, checkEvent, choose, freshSession, levelOf, nextLevel, nudge, openViews, practiceSession, predictEvent, predictedOf, recordOf, runOf, toCheck, toDebrief, withChecked, withPrediction } from './session'
import type { ChoiceControl, CubeSession, NumberControl } from './session'
import Debrief from './Debrief'
import Level from './Level'
import Mirror from './Mirror'
import type { ItemResult } from '@/lib/items/play'

// The In-production card appears only after the closing debrief, so it loads then; the first paint does not carry it.
const loadCard = () => import('./ProductionCard')
const ProductionCard = lazy(loadCard)

/** The Suspense fallback while the card loads: a status, so a screen reader hears that more is coming. */
export function AfterDebriefLoading() {
  return (
    <p role="status" className="font-mono text-body-sm text-text-3">
      Loading the card…
    </p>
  )
}

/**
 * What replaces the card when its load failed (offline, or a deploy replaced the chunks). The retry is a reload: the browser
 * keeps a failed dynamic import for the life of the page. The play was recorded when the closing debrief opened.
 */
export function AfterDebriefFailed() {
  return (
    <div role="status" className="space-y-3" data-play-error="tiling-cube-card">
      <p className="text-body-sm text-text-2">The card did not load, so you may be offline. Your play is saved; reload to try again.</p>
      <Button variant="secondary" onClick={() => window.location.reload()}>
        Reload to try again
      </Button>
    </div>
  )
}

export interface TilingCubePlayProps {
  /** `embed` inside the lesson, `page` on /play/tiling-cube. */
  mode: 'embed' | 'page'
}

const provenanceLine = (s: CubeSession): string => (s.provenance === 'unseen' ? 'new numbers' : 'the shared practice numbers')

export default function TilingCubePlay({ mode }: TilingCubePlayProps) {
  const uid = useId()
  const recordPlay = useProgress((s) => s.recordPlay)
  const recordItems = useProgress((s) => s.recordItems)
  const [session, setSession] = useState<CubeSession>(practiceSession)
  // Set once the learner has acted, so the first paint never takes focus. A ref cannot drive the render, so it is state.
  const [touched, setTouched] = useState(false)
  // Wall-clock of the first prediction, for the ledger's `ms`. Set in handlers, so a render stays pure.
  const startedAt = useRef<number | null>(null)

  const act = useCallback((f: (s: CubeSession) => CubeSession) => {
    setTouched(true)
    setSession(f)
  }, [])

  const onPredicted = (r: ItemResult) => {
    if (startedAt.current === null) {
      startedAt.current = Date.now()
      // The learner is in the run: fetch the card now, so it is there when the closing debrief opens.
      void loadCard().catch(() => undefined)
    }
    recordItems([predictEvent(session, session.at, r)])
    act((s) => withPrediction(s, predictedOf(r, runOf(s).inst)))
  }

  const onChecked = (r: ItemResult) => {
    recordItems([checkEvent(session, session.at, r)])
    act((s) => withChecked(s, r.ok))
  }

  const onNext = () => {
    const next = nextLevel(session)
    setTouched(true)
    setSession(next)
    const result = recordOf(next, startedAt.current === null ? undefined : Date.now() - startedAt.current)
    if (result) recordPlay(result)
  }

  const onAgain = () => {
    startedAt.current = null
    setSession(freshSession(freshEntropy()))
  }

  const level = levelOf(session)
  const mirrorId = `${uid}-mirror`
  const embedLink =
    mode === 'embed' ? (
      <p className="font-mono text-[11px] text-text-3">
        <Link to={`/play/${CUBE_PLAY_ID}`} className="hover:text-accent">
          open this play full screen
        </Link>
      </p>
    ) : null

  if (session.step === 'closing') {
    return (
      <div className="space-y-6" data-play={TILING_CUBE.id} data-mode={mode} data-phase-now="debrief">
        <Debrief session={session} kind="closing" onNext={onNext} onAgain={onAgain} mode={mode} />
        <ErrorBoundary fallback={<AfterDebriefFailed />}>
          <Suspense fallback={<AfterDebriefLoading />}>
            <ProductionCard />
          </Suspense>
        </ErrorBoundary>
        {embedLink}
      </div>
    )
  }

  return (
    <div className="space-y-4" data-play={TILING_CUBE.id} data-mode={mode} data-phase-now={session.step === 'debrief' ? 'level-debrief' : 'play'}>
      <p className="font-mono text-[12px] text-text-3">
        About {TILING_CUBE.minutes} minutes · {provenanceLine(session)}
      </p>
      <p className="text-body-sm text-text-2">
        A matmul kernel computes one tile of C at a time. Its work is the tile&apos;s volume and the bytes it reads are the areas of two faces, so how big, how deep and in what order
        you launch tiles decides whether the GPU waits on memory. Six levels, each one starting with a guess.
      </p>
      {session.step === 'debrief' ? (
        <Debrief session={session} kind="level" onNext={onNext} onAgain={onAgain} mode={mode} />
      ) : (
        <Level
          session={session}
          level={level}
          mirrorId={mirrorId}
          mirror={<Mirror id={mirrorId} level={level} explore={session.explore} />}
          focus={touched}
          onPredicted={onPredicted}
          onOpenViews={() => act(openViews)}
          onNudge={(id: NumberControl, dir, coarse) => act((s) => nudge(s, id, dir, coarse))}
          onChoose={(id: ChoiceControl, value) => act((s) => choose(s, id, value))}
          onToCheck={() => act(toCheck)}
          onChecked={onChecked}
          onToDebrief={() => act(toDebrief)}
        />
      )}
      {embedLink}
    </div>
  )
}
