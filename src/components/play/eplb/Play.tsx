/**
 * The EPLB play (docs/specs/wave-3.md §5.2): Predict → Play → Debrief → Compose → In production. One component for the lesson
 * embed (PlayBlock) and the full-screen route (/play/eplb).
 *
 * The learner first predicts what round robin does to this layer, as a number. Then they replicate four hot experts and place
 * every copy on a GPU (Board.tsx): the experts and the free slots are buttons of at least 44 px, Tab reaches one stop per group,
 * the arrow keys move within it and Enter presses. Each turn is one announcement in the mirror's live region (Mirror.tsx), which
 * is also the DOM twin of the board. The hidden reference, DeepSeek EPLB's rule, runs inside the session (the lockstep runner
 * plays it up front) but nothing on this screen reads it: the debrief is the only reader, and it renders only after "See the
 * debrief". The prediction is recorded the moment it is locked in, the play when the debrief opens, and each Compose spec when it
 * runs. The pass tally is read back from those play records at mount, so a reload keeps it.
 */

import { Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/Button'
import ErrorBoundary from '@/components/ErrorBoundary'
import { EPLB, freshEntropy } from '@/data/plays'
import { useProgress } from '@/lib/progress'
import Board, { Predict } from './Board'
import Debrief from './Debrief'
import Mirror from './Mirror'
import {
  EMPTY_TALLY,
  EPLB_TURNS,
  REPLICATE_TURNS,
  announceOf,
  canSkip,
  copyExpert,
  debrief,
  freshSession,
  ledgerTally,
  mergeTally,
  placeOn,
  practiceSession,
  predictEvent,
  recordOf,
  skip,
  stageOf,
  tallyAfter,
  times,
  viewOf,
  withPrediction,
  type EplbSession,
  type Tally,
} from './session'

// Compose and the In-production card appear only after the debrief, so they load then: the play's first paint does not carry the
// policy compiler, the Compose table or the card's claim rows.
const loadCompose = () => import('./Compose')
const loadCard = () => import('./ProductionCard')
const Compose = lazy(loadCompose)
const ProductionCard = lazy(loadCard)

/** A head start on the two chunks: a chunk that fails offline here is shown by the component that needs it, not rejected unhandled. */
const prefetchAfterDebrief = () => void Promise.all([loadCompose(), loadCard()]).catch(() => undefined)

/** The Suspense fallback while Compose and the card load: a status, so a screen reader hears that more is coming. */
export function AfterDebriefLoading() {
  return (
    <p role="status" className="font-mono text-body-sm text-text-3">
      Loading Compose and the card…
    </p>
  )
}

/**
 * What replaces them when the load failed (offline, or a deploy replaced the chunks). The retry is a reload: the browser keeps
 * a failed dynamic import for the life of the page. The play was recorded when the debrief opened, so nothing is lost by it.
 */
export function AfterDebriefFailed() {
  return (
    <div role="status" className="space-y-3" data-play-error="eplb-after-debrief">
      <p className="text-body-sm text-text-2">Compose and the card did not load, so you may be offline. Your play is saved; reload to try again.</p>
      <Button variant="secondary" onClick={() => window.location.reload()}>
        Reload to try again
      </Button>
    </div>
  )
}

/** Compose and the In-production card, lazy: a failed load shows the retry message instead of unmounting the play. */
function AfterDebrief({ session }: { session: EplbSession }) {
  const { loads, seed, provenance } = session
  return (
    <ErrorBoundary fallback={<AfterDebriefFailed />}>
      <Suspense fallback={<AfterDebriefLoading />}>
        <Compose key={seed} loads={loads} load={{ seed, provenance }} />
        <ProductionCard />
      </Suspense>
    </ErrorBoundary>
  )
}

export interface EplbPlayProps {
  /** `embed` inside the lesson, `page` on /play/eplb. */
  mode: 'embed' | 'page'
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function EplbPlay({ mode }: EplbPlayProps) {
  const uid = useId()
  const recordPlay = useProgress((s) => s.recordPlay)
  const recordItems = useProgress((s) => s.recordItems)
  const [session, setSession] = useState<EplbSession>(practiceSession)
  const [tally, setTally] = useState<Tally>(EMPTY_TALLY)
  // Wall-clock of the question's first paint and of the prediction, for the ledger's `ms`. Set in effects and handlers, so a render stays pure.
  const shownAt = useRef<number | null>(null)
  const startedAt = useRef<number | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const debriefRef = useRef<HTMLButtonElement>(null)
  const stage = useMemo(() => stageOf(session), [session])
  const inDebrief = session.summary !== null
  const predicted = session.prediction !== null
  const turns = session.play.turns

  // After a prediction or a turn, put focus on the board's one tab stop (a pressed free slot is gone), or on the debrief button once
  // every copy is placed. Not before the prediction, so loading the page never steals focus.
  useEffect(() => {
    if (!predicted || inDebrief) return
    if (stage.kind === 'over') {
      debriefRef.current?.focus({ preventScroll: true })
      return
    }
    boardRef.current?.querySelector<HTMLElement>('[data-stop]')?.focus({ preventScroll: true })
  }, [predicted, turns, stage.kind, inDebrief])

  useEffect(() => {
    shownAt.current ??= Date.now()
  }, [])

  // The tally is the ledger's: every debriefed play is recorded with its `ok`, provenance and load seed, so a reload reads back
  // what earlier sessions passed. Merged, not replaced, so a debrief that lands before the read keeps its pass. A ledger that
  // cannot be read leaves this page's own count.
  useEffect(() => {
    let live = true
    useProgress.controls
      .engine()
      .then(ledgerTally)
      .then(
        (held) => {
          if (live) setTally((t) => mergeTally(t, held))
        },
        () => undefined,
      )
    return () => {
      live = false
    }
  }, [])

  const onPredict = useCallback(
    (value: number) => {
      const next = withPrediction(session, value)
      if (next.prediction === null) return
      const now = Date.now()
      startedAt.current = now
      // The learner is in the run: start fetching what the debrief shows, so it is there by the time they get to it.
      prefetchAfterDebrief()
      const event = predictEvent(next, shownAt.current === null ? undefined : Math.max(0, now - shownAt.current))
      if (event) recordItems([event])
      setSession(next)
    },
    [session, recordItems],
  )
  const onCopy = useCallback((e: number) => setSession((s) => copyExpert(s, e)), [])
  const onPlace = useCallback((g: number) => setSession((s) => placeOn(s, g)), [])

  const enterDebrief = (next: EplbSession) => {
    const done = debrief(next)
    setSession(done)
    setTally((t) => tallyAfter(t, done))
    const result = recordOf(done, startedAt.current === null ? undefined : Date.now() - startedAt.current)
    if (result) recordPlay(result)
  }

  const again = () => {
    startedAt.current = null
    shownAt.current = Date.now()
    setSession(freshSession(freshEntropy()))
  }

  if (inDebrief) {
    return (
      <div className="space-y-6" data-play={EPLB.id} data-mode={mode} data-phase-now="debrief">
        <Debrief session={session} tally={tally} onAgain={again} mode={mode} />
        <AfterDebrief session={session} />
        {mode === 'embed' && (
          <p className="font-mono text-[11px] text-text-3">
            <Link to={`/play/${EPLB.id}`} className="hover:text-accent">
              open this play full screen
            </Link>
          </p>
        )}
      </div>
    )
  }

  const view = viewOf(session)
  const mirrorId = `${uid}-mirror`
  const live = stage.kind === 'turn' ? stage : null
  const left = live ? (live.phase === 'replicate' ? REPLICATE_TURNS - live.turn : view.queue.length) : 0

  return (
    <div className="space-y-4" data-play={EPLB.id} data-mode={mode} data-phase-now={predicted ? 'play' : 'predict'}>
      <p className="font-mono text-[12px] text-text-3">
        About {EPLB.minutes} minutes · {session.provenance === 'unseen' ? 'a new load' : 'the shared practice load'}
      </p>
      <p className="text-body-sm text-text-2">
        One mixture-of-experts layer has 16 experts spread over 4 GPUs of 5 slots each, so 4 slots are spare. You decide which experts to copy and which GPU each copy goes on. A
        token waits for its slowest GPU, so the score is how far your busiest GPU sits above the mean. Only when every copy is placed do you see how DeepSeek&apos;s EPLB rule did.
      </p>

      {stage.kind === 'predict' && <Predict loads={session.loads} onPredict={onPredict} />}

      {session.prediction && (
        <p className="font-mono text-[12px] text-text-2" data-prediction-saved>
          Your prediction for round robin: {session.prediction.value.toFixed(2)}× the mean. The debrief shows what it gives.
        </p>
      )}

      {live && (
        <>
          <p className="font-mono text-[13px] text-text-1" data-turn-line>
            Turn {live.turn + 1} of {EPLB_TURNS}
            <span className="text-text-3">
              {' '}
              ·{' '}
              {live.phase === 'replicate' ? `copy an expert, ${left} ${left === 1 ? 'copy' : 'copies'} left to make` : `${left} ${left === 1 ? 'copy' : 'copies'} left to place`}
              {live.phase === 'place' && view.maxUnits > 0 ? ` · busiest GPU ${times(view.maxUnits)}× the mean so far` : ''}
            </span>
          </p>
          <p aria-hidden className="min-h-5 font-mono text-[12px] text-text-2">
            {session.line}
          </p>
          <div ref={boardRef}>
            <Board stage={live} onCopy={onCopy} onPlace={onPlace} />
          </div>
        </>
      )}

      {stage.kind === 'over' && (
        <div>
          <p aria-hidden className="min-h-5 font-mono text-[12px] text-text-2">
            {session.line}
          </p>
          <p className="text-body-sm text-text-1">{capital(`all the copies are placed. Your busiest GPU carries ${times(view.maxUnits)}× the mean`)}.</p>
          <Button ref={debriefRef} className="mt-3 min-h-11" onClick={() => enterDebrief(session)}>
            See the debrief
          </Button>
        </div>
      )}

      {canSkip(session) && stage.kind === 'turn' && (
        <div>
          <Button variant="ghost" className="min-h-11" onClick={() => enterDebrief(skip(session))}>
            Skip to the debrief
          </Button>
          <p className="font-mono text-[11px] text-text-3">The reference&apos;s rule finishes your layer from where you stand.</p>
        </div>
      )}

      {predicted && <Mirror id={mirrorId} view={view} title="Your GPUs" line={announceOf(session)} />}
    </div>
  )
}
