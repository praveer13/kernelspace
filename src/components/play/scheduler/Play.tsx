/**
 * The scheduler play (docs/specs/wave-2.md §8): Play → Debrief → Compose → In production → Build this. One
 * component for the lesson embed (PlayBlock) and the full-screen route (/play/scheduler).
 *
 * The control is the chip list: every waiting request that matters is a full-width row (at least 44 px tall) that
 * toggles it into the admit order, or is disabled and says why. The KV bar is the picture and Mirror.tsx its DOM
 * twin. Tab and the arrow keys walk the chips, Space toggles one, P preempts the focused running request and
 * Enter runs the iteration. Iterations where no request can be admitted run by themselves.
 *
 * The hidden reference runs inside the session (the lockstep runner plays it up front) but nothing on this screen
 * reads it: the debrief is the only reader, and it renders only after "See the debrief".
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button, LinkButton } from '@/components/Button'
import { BUILD_THIS_SCHEDULER, SCHEDULER, freshEntropy } from '@/data/plays'
import { useProgress } from '@/lib/progress'
import { groups, schedEndLine } from '@/lib/world/sched'
import { drawSchedTrace, loadSchedSource, minuteSampleLine, practiceMinute, type SchedSource } from '@/lib/world/sched-traces'
import Compose from './Compose'
import Debrief from './Debrief'
import Mirror from './Mirror'
import ProductionCard from './ProductionCard'
import Queue, { KvBar } from './Queue'
import {
  actionOf,
  canSkip,
  debrief,
  frameOf,
  newSchedSession,
  provenanceLine,
  recordOf,
  runIteration,
  skip,
  stageOf,
  togglePick,
  togglePreempt,
  type SchedSession,
} from './session'

export interface SchedulerPlayProps {
  /** `embed` inside the lesson, `page` on /play/scheduler. */
  mode: 'embed' | 'page'
}

/** The two trace artifacts, fetched once per page load and shared by the embed and the page. */
let sourceLoad: Promise<SchedSource> | null = null
const loadSource = () => {
  sourceLoad ??= loadSchedSource().catch((e: unknown) => {
    sourceLoad = null
    throw e
  })
  return sourceLoad
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface SchedulerPlayViewProps extends SchedulerPlayProps {
  source: SchedSource
}

/** The play once its traces are loaded. Exported so tests can render it with the artifacts read from disk. */
export function SchedulerPlayView({ source, mode }: SchedulerPlayViewProps) {
  const uid = useId()
  const recordPlay = useProgress((s) => s.recordPlay)
  const [session, setSession] = useState<SchedSession>(() => newSchedSession(practiceMinute(source)))
  // Wall-clock of the first move, for the ledger's `ms`. Set in handlers, so a render stays pure.
  const firstMoveAt = useRef<number | null>(null)
  const queueRef = useRef<HTMLDivElement>(null)
  const runRef = useRef<HTMLButtonElement>(null)
  const debriefRef = useRef<HTMLButtonElement>(null)
  const stage = useMemo(() => stageOf(session), [session])
  const inDebrief = session.summary !== null
  const turns = session.play.turns

  // After a turn the chips that were pressed are gone or changed: put focus on the first chip that can be pressed,
  // else on Run, so Space and Enter keep playing. Not before the first turn, so loading never steals focus.
  useEffect(() => {
    if (turns === 0 || inDebrief) return
    if (stage.kind === 'over') {
      debriefRef.current?.focus({ preventScroll: true })
      return
    }
    const chip = queueRef.current?.querySelector<HTMLButtonElement>('[data-chip]:not(:disabled)')
    ;(chip ?? runRef.current)?.focus({ preventScroll: true })
  }, [turns, stage.kind, inDebrief])

  const mark = useCallback(() => {
    firstMoveAt.current ??= Date.now()
  }, [])
  const toggleAdmit = useCallback(
    (id: number) => {
      mark()
      setSession((s) => togglePick(s, id))
    },
    [mark],
  )
  const togglePreemptOf = useCallback(
    (id: number) => {
      mark()
      setSession((s) => togglePreempt(s, id))
    },
    [mark],
  )
  const run = useCallback(() => {
    mark()
    setSession((s) => runIteration(s))
  }, [mark])

  const enterDebrief = (next: SchedSession) => {
    const done = debrief(next)
    setSession(done)
    const result = recordOf(done, firstMoveAt.current === null ? undefined : Date.now() - firstMoveAt.current)
    if (result) recordPlay(result)
  }

  const again = () => {
    firstMoveAt.current = null
    setSession(newSchedSession(drawSchedTrace(freshEntropy(), source).trace))
  }

  if (inDebrief) {
    return (
      <div className="space-y-6" data-play={SCHEDULER.id} data-mode={mode} data-phase-now="debrief">
        <Debrief session={session} onAgain={again} />
        <Compose key={session.trace.id} trace={session.trace} source={source} />
        <ProductionCard />
        <div className="rounded-lg border border-accent/40 bg-accent-dim/40 p-4 sm:p-5">
          <p className="section-label">Code</p>
          <p className="mt-2 text-body-sm text-text-2">
            You have scheduled a minute by hand and composed a policy. Lab 06 is the same admission policy in Rust, graded on goodput under the same kind of SLO.
          </p>
          <div className="mt-3">
            <LinkButton to={BUILD_THIS_SCHEDULER.to}>{BUILD_THIS_SCHEDULER.label}</LinkButton>
          </div>
        </div>
        {mode === 'embed' && (
          <p className="font-mono text-[11px] text-text-3">
            <Link to={`/play/${SCHEDULER.id}`} className="hover:text-accent">
              open this play full screen
            </Link>
          </p>
        )}
      </div>
    )
  }

  const frame = frameOf(session)
  const v = frame.view
  const live = stage.kind === 'turn' ? stage : null
  const mirrorId = `${uid}-mirror`
  const action = actionOf(session)
  const trace = session.trace
  // What a screen reader hears each turn: the turn's line, then the next turn.
  const announce = [
    session.line,
    live ? `Turn ${live.turn + 1}, iteration ${v.iter}: ${v.waiting.length} waiting, ${groups(frame.free)} tokens free.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const sourceLine = trace.provenance === 'practice' ? minuteSampleLine(source.minute) : `${trace.requests.length} requests resampled from BurstGPT v2's busiest hour`

  return (
    <div className="space-y-4" data-play={SCHEDULER.id} data-mode={mode} data-phase-now="play">
      <p className="font-mono text-[12px] text-text-3">
        About {SCHEDULER.minutes} minutes · {provenanceLine(trace.provenance)}
      </p>
      <p className="font-mono text-[12px] text-text-3">{sourceLine}</p>
      <p className="text-body-sm text-text-2">
        You are the scheduler of a small serving engine. Each time requests are waiting and one of them fits, you decide who is admitted: press the requests you want, in the
        order you want them, then run the iteration. Iterations with nothing to decide run by themselves. Only when the run ends do you see how a reference scheduler did.
      </p>

      <p className="font-mono text-[13px] text-text-1">
        {live ? (
          <>
            Turn {live.turn + 1} of at most {SCHEDULER.turnCap} · iteration {v.iter}
          </>
        ) : (
          <>The run is over</>
        )}
        <span className="text-text-3">
          {' '}
          · {frame.arrived} of {frame.total} requests arrived · {frame.completed} done
        </span>
      </p>

      <KvBar frame={frame} picks={session.picks} preempt={session.preempt} describedBy={mirrorId} title="Your KV pool" />

      <p aria-hidden className="min-h-5 font-mono text-[12px] text-text-2">
        {session.line}
      </p>

      {stage.kind === 'over' && (
        <div>
          <p className="text-body-sm text-text-1">{capital(schedEndLine(session.setup, session.play))}.</p>
          <Button ref={debriefRef} className="mt-3" onClick={() => enterDebrief(session)}>
            See the debrief
          </Button>
        </div>
      )}

      {live && (
        <div>
          <div ref={queueRef}>
            <Queue frame={live.frame} picks={session.picks} preempt={session.preempt} onToggleAdmit={toggleAdmit} onTogglePreempt={togglePreemptOf} onRun={run} />
          </div>
          <p className="mt-4 font-mono text-[12px] text-text-2" data-action-line>
            Admit: <span className="text-text-1">{action.admit.length ? action.admit.map((id) => `#${id}`).join(', then ') : 'nothing'}</span>
            {action.preempt.length > 0 && (
              <>
                {' '}
                · Preempt: <span className="text-text-1">#{action.preempt[0]}</span>
              </>
            )}
          </p>
          <Button ref={runRef} className="mt-2 min-h-11 w-full sm:w-auto" onClick={run}>
            Run iteration {v.iter}
          </Button>
          <p className="mt-2 font-mono text-[11px] text-text-3">
            Keys: Tab or the arrow keys move between requests, Space admits or removes one, P preempts a focused running request and Enter runs the iteration.
          </p>
        </div>
      )}

      {canSkip(session) && (
        <div>
          <Button variant="ghost" className="min-h-11" onClick={() => enterDebrief(skip(session))}>
            Skip to the debrief
          </Button>
          <p className="font-mono text-[11px] text-text-3">The reference finishes your run from where you stand.</p>
        </div>
      )}

      <Mirror id={mirrorId} frame={frame} title="Your queues" line={announce} />
    </div>
  )
}

/** The page and the lesson block mount this: it fetches the traces, then plays. */
export default function SchedulerPlay({ mode }: SchedulerPlayProps) {
  const [state, setState] = useState<{ source: SchedSource } | { error: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    loadSource().then(
      (source) => live && setState({ source }),
      (e: unknown) => live && setState({ error: e instanceof Error ? e.message : 'the traces did not load' }),
    )
    return () => {
      live = false
    }
  }, [attempt])

  if (state === null) return <p className="font-mono text-body-sm text-text-3">Loading the minute…</p>
  if ('error' in state) {
    return (
      <div className="space-y-3" data-play-error="scheduler-traces">
        <p className="text-body-sm text-text-2">The traces did not load, so there is no minute to schedule: {state.error}.</p>
        <Button
          variant="secondary"
          onClick={() => {
            setState(null)
            setAttempt((n) => n + 1)
          }}
        >
          Try again
        </Button>
      </div>
    )
  }
  return <SchedulerPlayView source={state.source} mode={mode} />
}
