import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import Alert from '@/components/daily/Alert'
import Debrief from '@/components/daily/Debrief'
import FixMenu from '@/components/daily/FixMenu'
import Hypothesis from '@/components/daily/Hypothesis'
import ProbeBar from '@/components/daily/ProbeBar'
import ShareString from '@/components/daily/ShareString'
import { localDateKey } from '@/lib/economy'
import { describeFleetError, openIncidentSession, type IncidentClientSession } from '@/lib/fleet-session'
import { useProgress } from '@/lib/progress'
import {
  DAILY_MINUTES,
  HYPOTHESIS_OPTIONS,
  dailyIncident,
  dailyNumber,
  dailyPlayed,
  dailySource,
  readingHeadline,
  recordDaily,
  shareString,
  sinceAlert,
  startFlow,
  withFix,
  withHypothesis,
  withProbe,
  withWait,
  type FlowRun,
  type FlowState,
} from '@/lib/world/daily'
import type { Hypothesis as HypothesisId, FixId, ProbeId } from '@/lib/world/incident-spec'
import type { FleetSlotBytes, IncidentFinish, IncidentFixReply, IncidentProbeReply, IncidentWaitReply } from '@/workers/fleet-protocol'

/** The reference drivers in every slot. 2b-21 fills these from the learner's installed engine. */
const NO_SLOTS: FleetSlotBytes = { sched: null, mgr: null, queue: null }

type Phase = 'opening' | 'play' | 'debrief' | 'failed'

const hypothesisName = (h: HypothesisId): string => HYPOTHESIS_OPTIONS.find((o) => o.id === h)?.label ?? h

/**
 * /daily (docs/specs/wave-2.md §9.7): the Fleet Daily. One incident per local date, the same for everybody on that
 * date: read the alert, log a hypothesis, probe on a clock, fix, then the debrief and a share string. The incident
 * runs in a fleet worker session (§9.5), so nothing the learner's modules do can hang the page. This page owns the
 * date, the session and the record; the flow components take the session and the incident's source as props, so
 * Act IV's drills (2b-17) play the same flow on a fresh seed.
 *
 * Recording: the first completed attempt on a date writes one `incident` event (the Daily's seed is public, so
 * it is graded practice); a replay is practice and writes nothing.
 */
export default function Daily() {
  // The date is read once per visit; a page left open past midnight keeps yesterday's incident until reloaded.
  const [date] = useState(() => localDateKey())
  const source = useMemo(() => dailySource(date), [date])
  const spec = useMemo(() => dailyIncident(date), [date])
  const number = dailyNumber(date)

  const [attempt, setAttempt] = useState(0)
  const [session, setSession] = useState<IncidentClientSession | null>(null)
  const [flow, setFlow] = useState<FlowState | null>(null)
  const [phase, setPhase] = useState<Phase>('opening')
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  /** this attempt wrote the date's event */
  const [wrote, setWrote] = useState(false)
  const played = useProgress((s) => dailyPlayed({ getState: () => s }, date))

  const fail = useCallback((e: unknown) => {
    setFailure(describeFleetError(e, 'The incident stopped'))
    setPhase('failed')
  }, [])

  useEffect(() => {
    let live = true
    let opened: IncidentClientSession | null = null
    openIncidentSession({ mode: 'incident', spec, slots: NO_SLOTS }).then(
      (s) => {
        if (!live) {
          s.close()
          return
        }
        opened = s
        setSession(s)
        setFlow(startFlow(s.alert, s.limit))
        setPhase('play')
      },
      (e) => {
        if (live) fail(e)
      },
    )
    return () => {
      live = false
      opened?.close()
    }
  }, [spec, attempt, fail])

  const run = useCallback<FlowRun>(
    async (command) => {
      setBusy(true)
      try {
        return await command()
      } catch (e) {
        fail(e)
        return null
      } finally {
        setBusy(false)
      }
    },
    [fail],
  )

  // After the hypothesis is logged, focus goes to the first probe, so the keyboard path continues where it opened.
  const hadHypothesis = useRef(false)
  useEffect(() => {
    const has = flow?.hypothesis != null
    if (has && !hadHypothesis.current) document.querySelector<HTMLButtonElement>('[data-probe]:not(:disabled)')?.focus()
    hadHypothesis.current = has
  }, [flow?.hypothesis])

  function restart() {
    setSession(null)
    setFlow(null)
    setWrote(false)
    setFailure(null)
    setAnnouncement('')
    setPhase('opening')
    setAttempt((a) => a + 1)
  }

  function onLogged(h: HypothesisId) {
    setFlow((f) => f && withHypothesis(f, h))
    setAnnouncement(`Hypothesis logged: ${hypothesisName(h)}. The probes are open.`)
  }

  function onReading(probe: ProbeId, reply: IncidentProbeReply) {
    setFlow((f) => f && withProbe(f, probe, reply))
    setAnnouncement(`${readingHeadline(probe, reply.category)}. Incident clock ${sinceAlert(reply.minute, flow?.alert ?? 0)}.`)
    if (reply.ended) setPhase('debrief')
  }

  function onFix(fix: FixId, reply: IncidentFixReply) {
    setFlow((f) => f && withFix(f, fix, reply))
    if (reply.effective) setAnnouncement('That was the fix. Replaying the incident to recovery.')
    if (reply.effective || reply.ended) setPhase('debrief')
  }

  function onWait(reply: IncidentWaitReply) {
    setFlow((f) => f && withWait(f, reply))
    setAnnouncement(`One minute passed. Incident clock ${sinceAlert(reply.minute, flow?.alert ?? 0)}.`)
    if (reply.ended) setPhase('debrief')
  }

  const onResult = useCallback(
    (result: IncidentFinish) => {
      setWrote(recordDaily(useProgress, date, spec, result))
      setAnnouncement('The debrief is ready.')
    },
    [date, spec],
  )

  const open = phase === 'play' && flow !== null && !flow.ended
  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12" data-page="daily" data-phase={phase} data-daily-date={date}>
      <p className="section-label">0x00 — daily</p>
      <h1 className="mt-3 font-display text-h3 text-text-1 sm:text-h2">Fleet Daily</h1>
      <p className="mt-2 text-body-sm text-text-2">
        #{number} · {date} · about {DAILY_MINUTES} min. One new incident each day, the same one for everybody on your date.
      </p>
      {played && !wrote && phase !== 'failed' && (
        <p className="mt-3 rounded-md border border-line bg-surface-1 p-3 text-body-sm text-text-2" data-practice>
          You have played today&rsquo;s Daily. This run is practice: it writes nothing to your record.
        </p>
      )}

      <div className="mt-6 space-y-4">
        {phase === 'opening' && (
          <p role="status" className="rounded-lg border border-line bg-surface-1 p-4 text-body-sm text-text-2" data-opening>
            Opening today&rsquo;s incident: warming the fleet up to the alert…
          </p>
        )}

        {phase === 'failed' && failure && (
          <div role="alert" className="rounded-lg border border-danger/50 bg-surface-1 p-4" data-failure>
            <h2 className="font-display text-h3 text-text-1">{failure.title}</h2>
            <p className="mt-2 text-body-sm text-text-2">{failure.detail}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={restart} className="min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground">
                Try again
              </button>
              <Link to="/fleet" className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
                Run the fleet yourself
              </Link>
            </div>
          </div>
        )}

        {session && flow && phase !== 'failed' && (
          <>
            <Alert source={source} session={session} clock={flow.clock} />
            {phase === 'play' && (
              <>
                <Hypothesis session={session} logged={flow.hypothesis} busy={busy} run={run} onLogged={onLogged} />
                <ProbeBar
                  session={session}
                  alert={flow.alert}
                  enabled={open && flow.hypothesis !== null}
                  closedReason={flow.hypothesis === null ? 'Log a hypothesis first: the probes open once you commit to a suspect.' : undefined}
                  log={flow.log}
                  busy={busy}
                  run={run}
                  onReading={onReading}
                />
                <FixMenu
                  session={session}
                  enabled={open && flow.hypothesis !== null}
                  busy={busy}
                  run={run}
                  onFix={onFix}
                  onWait={onWait}
                  onGiveUp={() => setPhase('debrief')}
                />
              </>
            )}
            {phase === 'debrief' && (
              <Debrief session={session} source={source} flow={flow} busy={busy} run={run} onResult={onResult}>
                {(result) => (
                  <>
                    <ShareString text={shareString(number, result.probes.length, result.burn)} />
                    <p className="text-body-sm text-text-2" data-record-note>
                      {wrote ? 'Recorded as today’s Daily.' : 'Practice replay: nothing was written to your record.'}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={restart}
                        className="min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright"
                      >
                        Replay as practice
                      </button>
                      <Link to="/today" className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
                        Back to Today
                      </Link>
                    </div>
                  </>
                )}
              </Debrief>
            )}
          </>
        )}
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-live>
        {announcement}
      </div>
    </section>
  )
}
