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
 * The 3D box (Cube3D.tsx) is a second picture of the faces, behind View3D, and the evaluation of it lives here
 * (docs/prereg/tiling-cube-3d.md): a learner's six levels split 3 + 3 between "2D only" and "3D available"
 * (`cubeViewsFor`, by the learner's `exp:seed`), the split is fixed when a level's views open, and the closing record carries
 * each level's view. A learner with no seed yet (the ledger still loading, or a read-only tab) is offered no 3D and has no
 * view recorded, so the level is not in the comparison. The scene's chunk, three and R3F, is fetched only when a learner
 * asks for it on a level that offers it. The two optional spatial puzzles (SpatialProxy.tsx) follow the closing debrief for
 * learners who are in the evaluation.
 *
 * The first session runs on the practice seed that the cube's band checks; "Play again with new numbers" draws a seed that
 * passes the same band, so a new session is unseen.
 */

import { Suspense, lazy, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/Button'
import ErrorBoundary from '@/components/ErrorBoundary'
import View3D from '@/components/three/View3D'
import { TILING_CUBE, freshEntropy } from '@/data/plays'
import { ensureExpSeed, readExpSeed } from '@/lib/learner/experiments'
import { cubeViewsFor, withViews, type CubeView } from '@/lib/learner/cube-views'
import { useProgress } from '@/lib/progress'
import { CUBE_PLAY_ID, checkEvent, choose, freshSession, levelOf, nextLevel, nudge, openViews, practiceSession, predictEvent, predictedOf, recordOf, runOf, toCheck, toDebrief, withChecked, withPrediction } from './session'
import type { ChoiceControl, CubeSession, NumberControl } from './session'
import Level from './Level'
import type { Cube3DProps } from './Cube3D'
import type { ItemResult } from '@/lib/items/play'
import { CUBE_LEVELS, type CubeLevel } from '@/lib/world/tiling'

// The first screen is the prediction, so it carries only the session, the level and its item card. The views and their
// table (Views.tsx, Mirror.tsx), the debriefs (their chips pull in the claim popover) and the In-production card load on
// demand; the first prediction starts fetching all of them, so they are there when the learner reaches them.
const loadViews = () => import('./Views')
const loadMirror = () => import('./Mirror')
const loadDebrief = () => import('./Debrief')
const loadCard = () => import('./ProductionCard')
const Mirror = lazy(loadMirror)
const Debrief = lazy(loadDebrief)
const ProductionCard = lazy(loadCard)
// The optional spatial puzzles are offered only at the end, so they load only then.
const SpatialProxy = lazy(() => import('./SpatialProxy'))

/** The scene, three and R3F with it: its chunk is fetched when View3D first renders it, on a learner's request. */
const Cube3DScene = lazy(() => import('./Cube3D'))

/** The cube in 3D under the 2D faces and their table: nothing renders until `available` is true, which the play sets only on a level the evaluation gives 3D. */
export function CubeView3D({ level, explore, mirrorId, available }: { level: CubeLevel; explore: CubeSession['explore']; mirrorId: string; available?: boolean }) {
  return <View3D id="tiling-cube" available={available} Scene={Cube3DScene} sceneProps={{ level, explore, describedBy: mirrorId } satisfies Cube3DProps} />
}

/** Room for a debrief while it loads (level 1 measures 603 px at 360 px wide and 441 px at 1280), so what follows it does not jump. */
const DEBRIEF_ROOM = 'min-h-[37rem] sm:min-h-[27rem]'

/** The Suspense fallback while a debrief loads: a status, so a screen reader hears that more is coming. */
export function DebriefLoading() {
  return (
    <div className={DEBRIEF_ROOM}>
      <p role="status" className="font-mono text-body-sm text-text-3">
        Loading the debrief…
      </p>
    </div>
  )
}

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

/** What replaces a debrief when its load failed; the answers were recorded when they were given, and a reload is the retry, which restarts the play (the session lives in React state). */
export function DebriefFailed() {
  return (
    <div role="status" className="space-y-3" data-play-error="tiling-cube-debrief">
      <p className="text-body-sm text-text-2">The debrief did not load, so you may be offline. Your answers are recorded; a reload starts the play again from level 1.</p>
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
  // The evaluation (docs/prereg/tiling-cube-3d.md): the view each opened level was given, by level id, fixed when its views open.
  const [views, setViews] = useState<Readonly<Record<string, CubeView>>>({})
  const ledgerReady = useProgress((s) => s.ledger.ready)
  const expSeed = useProgress((s) => readExpSeed(s.working['exp:seed']))
  // `exp:seed` is created once, after the ledger has loaded (the ladder experiment does the same; the first one wins).
  useEffect(() => {
    if (ledgerReady && expSeed === undefined) ensureExpSeed(useProgress.getState(), Math.random)
  }, [ledgerReady, expSeed])
  // Wall-clock of the first prediction, for the ledger's `ms`. Set in handlers, so a render stays pure.
  const startedAt = useRef<number | null>(null)

  const act = useCallback((f: (s: CubeSession) => CubeSession) => {
    setTouched(true)
    setSession(f)
  }, [])

  const onPredicted = (r: ItemResult) => {
    if (startedAt.current === null) {
      startedAt.current = Date.now()
      // The learner is in the run: fetch what comes after the prediction now, so it is there when it is wanted.
      for (const load of [loadViews, loadMirror, loadDebrief, loadCard]) void load().catch(() => undefined)
    }
    recordItems([predictEvent(session, session.at, r)])
    act((s) => withPrediction(s, predictedOf(r, runOf(s).inst)))
  }

  const onChecked = (r: ItemResult) => {
    recordItems([checkEvent(session, session.at, r)])
    act((s) => withChecked(s, r.ok))
  }

  // The level's views open: the learner's split fixes this level's view, so what is shown and what is recorded cannot differ.
  const onOpenViews = () => {
    const id = levelOf(session).id
    if (expSeed !== undefined && views[id] === undefined) {
      const split = cubeViewsFor(CUBE_LEVELS.map((l) => l.id), expSeed)
      setViews({ ...views, [id]: split[CUBE_LEVELS.findIndex((l) => l.id === id)] })
    }
    act(openViews)
  }

  const onNext = () => {
    const next = nextLevel(session)
    setTouched(true)
    setSession(next)
    const result = recordOf(next, startedAt.current === null ? undefined : Date.now() - startedAt.current)
    if (result) recordPlay(result.data ? { ...result, data: { ...result.data, levels: withViews(result.data.levels ?? [], views) } } : result)
  }

  const onAgain = () => {
    startedAt.current = null
    setViews({})
    setSession(freshSession(freshEntropy()))
  }

  const level = levelOf(session)
  const inEvaluation = Object.keys(views).length > 0
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
        <ErrorBoundary fallback={<DebriefFailed />}>
          <Suspense fallback={<DebriefLoading />}>
            <Debrief session={session} kind="closing" onNext={onNext} onAgain={onAgain} mode={mode} />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary fallback={<AfterDebriefFailed />}>
          <Suspense fallback={<AfterDebriefLoading />}>
            <ProductionCard />
          </Suspense>
        </ErrorBoundary>
        {inEvaluation && (
          <div className="space-y-3">
            <p className="text-body-sm text-text-2">
              Which three levels offered a 3D view was picked at random for you, to find out whether the 3D view helps. It is recorded on this device with your play, and the rule for reading it was fixed
              before anyone's results (docs/prereg/tiling-cube-3d.md).
            </p>
            <ErrorBoundary fallback={null}>
              <Suspense fallback={null}>
                <SpatialProxy />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
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
        <ErrorBoundary fallback={<DebriefFailed />}>
          <Suspense fallback={<DebriefLoading />}>
            <Debrief session={session} kind="level" onNext={onNext} onAgain={onAgain} mode={mode} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <Level
          session={session}
          level={level}
          mirrorId={mirrorId}
          mirror={
            <>
              <Mirror id={mirrorId} level={level} explore={session.explore} />
              {views[level.id] === '3d' && (
                <p className="font-mono text-[11px] text-text-3">Three of the six levels offer a 3D view, picked at random for you, to find out whether it helps.</p>
              )}
              <CubeView3D level={level} explore={session.explore} mirrorId={mirrorId} available={views[level.id] === '3d'} />
            </>
          }
          focus={touched}
          onPredicted={onPredicted}
          onOpenViews={onOpenViews}
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
