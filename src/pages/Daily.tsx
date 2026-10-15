import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import Alert from '@/components/daily/Alert'
import Debrief from '@/components/daily/Debrief'
import FixMenu from '@/components/daily/FixMenu'
import Hypothesis from '@/components/daily/Hypothesis'
import ProbeBar from '@/components/daily/ProbeBar'
import ShareString from '@/components/daily/ShareString'
import { season0Day, season0Header } from '@/data/season0'
import { localDateKey } from '@/lib/economy'
import { describeFleetError, openIncidentSession, type IncidentClientSession } from '@/lib/fleet-session'
import { useVisibleClock } from '@/hooks/use-visible-clock'
import { useProgress } from '@/lib/progress'
import { useSlots } from '@/pages/fleet/slots'
import {
  DAILY_MINUTES,
  HYPOTHESIS_OPTIONS,
  boxHashes,
  dailyBoxes,
  dailyIncident,
  dailyNumber,
  dailyPlayed,
  dailySlotBytes,
  dailySource,
  engineLine,
  menuOrderFor,
  ownBoxes,
  readingHeadline,
  recordDaily,
  shareString,
  sinceAlert,
  startFlow,
  withFix,
  withHypothesis,
  withProbe,
  withWait,
  type DailyBox,
  type FlowRun,
  type FlowState,
} from '@/lib/world/daily'
import type { Hypothesis as HypothesisId, FixId, ProbeId } from '@/lib/world/incident-spec'
import { SHIFT_LENGTH, handoffNote, recordShift, shiftIncidents, shiftRequested, shiftSummary, type ShiftFacts, type ShiftNote } from '@/lib/world/shift'
import type { IncidentFinish, IncidentFixReply, IncidentProbeReply, IncidentWaitReply } from '@/workers/fleet-protocol'

const BUTTON_QUIET = 'min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright'

type Phase = 'opening' | 'play' | 'debrief' | 'failed'

const hypothesisName = (h: HypothesisId): string => HYPOTHESIS_OPTIONS.find((o) => o.id === h)?.label ?? h

/**
 * /daily (docs/specs/wave-2.md §9.7): the Fleet Daily. One incident per local date, the same for everybody on that
 * date: read the alert, log a hypothesis, probe on a clock, fix, then the debrief and a share string. The incident
 * runs in a fleet worker session (§9.5), so nothing the learner's modules do can hang the page. This page owns the
 * date, the session and the record; the flow components take the session and the incident's source as props, so
 * Act IV's drills (2b-17) play the same flow on a fresh seed.
 *
 * Your engine (§9.7, 2b-21): the session opens on the modules installed in your scheduler, block manager and intake
 * slots (`useSlots`), and the debrief says which boxes were yours and names an installed prefix router as not used
 * (D37: incident clusters route by shortest queue). The boxes are read once, when the
 * session opens, so installing something in another tab mid-incident changes the next attempt and not this one. A
 * module that stops responding ends the attempt with its error card, and "Play on the reference engine" runs the same
 * Daily without your modules, so a broken install never locks the Daily out.
 *
 * Recording: the first completed attempt on a date writes one `incident` event (the Daily's seed is public, so
 * it is graded practice), naming the hashes of your modules that ran; a replay is practice and writes nothing. Its
 * `ms` is the attempt's visible time from the alert to the debrief (`useVisibleClock`: a hidden tab adds nothing),
 * capped at `INCIDENT_MAX_MS` (wave-3.md §15.1).
 *
 * The On-Call pilot (§16.6, 3s-08): `/daily?shift=3` plays three drill-namespace incidents from one seed in a row
 * (`world/shift`), on the reference engine so every session in the pilot plays the same boxes. Between them a handoff
 * note, built from the debrief just shown, is read before the next alert. The notes and results live in this
 * component's state and nowhere else; each incident writes one event graded practice (`recordShift`), and the Daily's
 * own record is untouched. The shift is a pilot URL the owner hands to a think-aloud participant (docs/oncall/pilot.md),
 * not a link anywhere on the site.
 *
 * Season 0 (§16.7, 3s-09): on the seven dates of `data/season0` the header says "Season 0 · day k of 7", and the card on
 * /me lists your results. The incident is the date's own, as on any other day; the shift has no Season 0 line.
 */
export default function Daily() {
  const [params] = useSearchParams()
  const shifting = shiftRequested(params.get('shift'))
  // keyed, so turning the shift on or off starts the page afresh rather than carrying a step or a result across
  return <DailyPage key={shifting ? 'shift' : 'daily'} shifting={shifting} />
}

function DailyPage({ shifting }: { shifting: boolean }) {
  // The date is read once per visit; a page left open past midnight keeps yesterday's incident until reloaded.
  const [date] = useState(() => localDateKey())
  const plan = useMemo(() => (shifting ? shiftIncidents(date) : null), [shifting, date])
  /** the shift's place (0-based): the Daily has no steps */
  const [step, setStep] = useState(0)
  const incident = plan?.[step] ?? null
  const source = useMemo(() => incident?.source ?? dailySource(date), [incident, date])
  const spec = useMemo(() => incident?.spec ?? dailyIncident(date), [incident, date])
  const number = dailyNumber(date)
  /** which day of Season 0 the date is, or null outside it and in the shift */
  const seasonDay = shifting ? null : season0Day(date)
  /** what each shift incident reported, kept in this page's memory for the handoff note and the summary: never written */
  const [finished, setFinished] = useState<Record<number, ShiftFacts>>({})
  const shiftHead = useRef<HTMLParagraphElement>(null)

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
  /** your installed modules are read before the incident opens (their bytes load from the components store) */
  const ready = useSlots((s) => s.ready)
  const installed = useSlots((s) => s.installed)
  /** play without your modules: the fallback after one fails, and a choice for a replay; the shift always plays this way */
  const [reference, setReference] = useState(shifting)
  /** the boxes of the attempt in play (three, plus an unused prefix router when one is installed): whose they were */
  const [boxes, setBoxes] = useState<DailyBox[]>([])
  // the shift plays the reference engine, so every session of the pilot plays the same boxes
  const canUseYours = useMemo(() => !shifting && ownBoxes(dailyBoxes(installed)).length > 0, [shifting, installed])
  /** the page's visible time, and its reading when this attempt's alert showed */
  const visible = useVisibleClock()
  const alertAt = useRef<number | null>(null)

  const fail = useCallback((e: unknown) => {
    setFailure(describeFleetError(e, 'The incident stopped'))
    setPhase('failed')
  }, [])

  useEffect(() => {
    if (!ready) return
    let live = true
    let opened: IncidentClientSession | null = null
    // read when the session opens: a module installed mid-incident belongs to the next attempt
    const mine = useSlots.getState().installed
    // named before the open, so a module that traps while the incident warms up still offers the reference engine
    setBoxes(dailyBoxes(mine, reference))
    openIncidentSession({ mode: 'incident', spec, slots: dailySlotBytes(mine, reference) }).then(
      (s) => {
        if (!live) {
          s.close()
          return
        }
        opened = s
        setSession(s)
        setFlow(startFlow(s.alert, s.limit))
        setPhase('play')
        alertAt.current = visible()
      },
      (e) => {
        if (live) fail(e)
      },
    )
    return () => {
      live = false
      opened?.close()
    }
  }, [spec, attempt, ready, reference, fail, visible])

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

  /** `advance` takes the shift's next incident: its spec differs, so the new session opens on it */
  function restart(onReference = reference, advance = false) {
    setReference(onReference)
    alertAt.current = null
    setSession(null)
    setFlow(null)
    setWrote(false)
    setFailure(null)
    setAnnouncement(advance ? `Incident ${step + 2} of ${SHIFT_LENGTH}. The handoff note from incident ${step + 1} is above the alert once it opens.` : '')
    setPhase('opening')
    setAttempt((a) => a + 1)
    if (advance) setStep((i) => i + 1)
  }

  // Focus goes to the new shift header, since the button that asked for the next incident is gone.
  useEffect(() => {
    if (step > 0) shiftHead.current?.focus()
  }, [step])

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
      const ms = alertAt.current === null ? undefined : visible() - alertAt.current
      if (incident) {
        // graded practice, once per incident of the date; the facts are kept for the note and the summary, in memory only
        setWrote(recordShift(useProgress, date, incident, result, ms))
        setFinished((f) => ({ ...f, [incident.index]: result }))
      } else setWrote(recordDaily(useProgress, date, spec, result, boxHashes(boxes), ms))
      setAnnouncement('The debrief is ready.')
    },
    [date, spec, boxes, visible, incident],
  )

  const open = phase === 'play' && flow !== null && !flow.ended
  const menus = useMemo(() => menuOrderFor(spec), [spec])
  const onMyEngine = boxes.some((b) => b.own)
  /** the note from the incident before this one, read again while this one plays */
  const carried = step > 0 && finished[step - 1] ? handoffNote(finished[step - 1], step - 1) : null
  return (
    <section
      className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12"
      data-page="daily"
      data-phase={phase}
      data-daily-date={date}
      {...(shifting ? { 'data-shift': SHIFT_LENGTH, 'data-shift-step': step + 1 } : {})}
    >
      <p className="section-label">0x00 — daily</p>
      <h1 className="mt-3 font-display text-h3 text-text-1 sm:text-h2">{shifting ? 'On-call shift' : 'Fleet Daily'}</h1>
      {seasonDay !== null && (
        <p className="mt-2 text-body-sm text-text-2" data-season0={seasonDay}>
          <span className="font-mono text-label uppercase text-text-1">{season0Header(seasonDay)}</span>
          {' · '}your results stay on this device, listed on{' '}
          <Link to="/me" className="text-info underline underline-offset-2">
            Me
          </Link>
          .
        </p>
      )}
      {shifting ? (
        <p className="mt-2 text-body-sm text-text-2" data-shift-intro>
          Pilot · {date} · {SHIFT_LENGTH} incidents in a row, about {SHIFT_LENGTH * DAILY_MINUTES} min. The same three for everybody on your date. Each one is
          graded practice: it pays nothing and does not count as your Daily.
        </p>
      ) : (
        <p className="mt-2 text-body-sm text-text-2">
          #{number} · {date} · about {DAILY_MINUTES} min. One new incident each day, the same one for everybody on your date.
        </p>
      )}
      {plan && (
        <p ref={shiftHead} tabIndex={-1} className="mt-3 font-mono text-label uppercase text-text-2 outline-none" data-shift-head>
          Incident {step + 1} of {plan.length}
        </p>
      )}
      {session && phase !== 'failed' && canUseYours && (
        <p className="mt-1 text-body-sm text-text-2" data-engine-line data-on={onMyEngine ? 'yours' : 'reference'}>
          {onMyEngine ? `Running on ${engineLine(ownBoxes(boxes).length)}.` : 'Running on the reference engine.'}
        </p>
      )}
      {!shifting && played && !wrote && phase !== 'failed' && (
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
              <button type="button" onClick={() => restart()} className="min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground">
                Try again
              </button>
              {boxes.some((b) => b.own) && !reference && (
                <button type="button" onClick={() => restart(true)} className={BUTTON_QUIET} data-play-reference>
                  Play on the reference engine
                </button>
              )}
              <Link to="/fleet" className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
                Run the fleet yourself
              </Link>
            </div>
          </div>
        )}

        {carried && phase !== 'debrief' && phase !== 'failed' && <NoteCard note={carried} carried />}

        {session && flow && phase !== 'failed' && (
          <>
            <Alert source={source} session={session} clock={flow.clock} />
            {phase === 'play' && (
              <>
                <Hypothesis session={session} logged={flow.hypothesis} lockedAt={flow.hypothesisAtFix} options={menus.hypotheses} busy={busy} run={run} onLogged={onLogged} />
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
                  fixes={menus.fixes}
                  busy={busy}
                  run={run}
                  onFix={onFix}
                  onWait={onWait}
                  onGiveUp={() => setPhase('debrief')}
                />
              </>
            )}
            {phase === 'debrief' && plan && (
              <Debrief session={session} source={source} flow={flow} busy={busy} run={run} onResult={onResult}>
                {(result) => (
                  <>
                    <p className="text-body-sm text-text-2" data-record-note>
                      {wrote ? `Recorded as practice: incident ${step + 1} of ${plan.length}.` : 'Practice replay: nothing was written to your record.'}
                    </p>
                    {step < plan.length - 1 ? (
                      <NoteCard note={handoffNote(result, step)} />
                    ) : (
                      <NoteCard note={shiftSummary(plan.flatMap((p) => (p.index === step ? [result] : finished[p.index] ? [finished[p.index]] : [])))} summary />
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      {step < plan.length - 1 && (
                        <button type="button" onClick={() => restart(undefined, true)} className="min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground" data-next-incident>
                          Take incident {step + 2} of {plan.length}
                        </button>
                      )}
                      <button type="button" onClick={() => restart()} className={BUTTON_QUIET} data-replay-incident>
                        Replay this incident
                      </button>
                      <Link to="/today" className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
                        Back to Today
                      </Link>
                    </div>
                  </>
                )}
              </Debrief>
            )}
            {phase === 'debrief' && !plan && (
              <Debrief session={session} source={source} flow={flow} busy={busy} run={run} boxes={boxes} onResult={onResult}>
                {(result) => (
                  <>
                    <ShareString text={shareString(number, result.probes.length, result.burn, onMyEngine)} />
                    <p className="text-body-sm text-text-2" data-record-note>
                      {wrote ? 'Recorded as today’s Daily.' : 'Practice replay: nothing was written to your record.'}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => restart()} className={BUTTON_QUIET}>
                        Replay as practice
                      </button>
                      {canUseYours && (
                        <button type="button" onClick={() => restart(!reference)} className={BUTTON_QUIET} data-switch-engine>
                          {reference ? 'Replay on your engine' : 'Replay on the reference engine'}
                        </button>
                      )}
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

/**
 * A handoff note or the shift summary: a heading and a line each. It says it is not saved, because it is not: it is
 * computed from the debrief on screen and lives in the page's memory (world/shift). `carried` is the note read again
 * while the next incident plays, folded away so it does not push the alert down a 360 px screen.
 */
function NoteCard({ note, carried = false, summary = false }: { note: ShiftNote; carried?: boolean; summary?: boolean }) {
  const lines = (
    <>
      <ul className="mt-2 space-y-1 text-body-sm text-text-2">
        {note.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-text-3">This is shown here only. It is not saved, and it is gone when you leave the page.</p>
    </>
  )
  if (carried) {
    return (
      <details className="rounded-lg border border-line bg-surface-1 p-4" data-handoff="carried">
        <summary className="min-h-11 cursor-pointer font-display text-[16px] text-text-1">{note.heading}</summary>
        {lines}
      </details>
    )
  }
  return (
    <section className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5" aria-label={note.heading} data-handoff={summary ? 'summary' : 'next'}>
      <h3 className="font-display text-[16px] text-text-1">{note.heading}</h3>
      {lines}
    </section>
  )
}
