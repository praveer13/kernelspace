import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import Alert from '@/components/daily/Alert'
import Debrief from '@/components/daily/Debrief'
import FixMenu from '@/components/daily/FixMenu'
import Hypothesis from '@/components/daily/Hypothesis'
import ProbeBar from '@/components/daily/ProbeBar'
import { localDateKey } from '@/lib/economy'
import { describeFleetError, openIncidentSession, type IncidentClientSession } from '@/lib/fleet-session'
import { useVisibleClock } from '@/hooks/use-visible-clock'
import { useProgress } from '@/lib/progress'
import type { ItemState, PacketItem, RoundItem, RoundPlan } from '@/lib/mentor/interview'
import {
  HYPOTHESIS_OPTIONS,
  dailySlotBytes,
  menuOrderFor,
  readingHeadline,
  sinceAlert,
  startFlow,
  withFix,
  withHypothesis,
  withProbe,
  withWait,
  type FlowRun,
  type FlowState,
} from '@/lib/world/daily'
import type { FixId, Hypothesis as HypothesisId, ProbeId } from '@/lib/world/incident-spec'
import { recordShift, type ShiftFacts } from '@/lib/world/shift'
import type { IncidentFinish, IncidentFixReply, IncidentProbeReply, IncidentWaitReply } from '@/workers/fleet-protocol'

/**
 * The interview library (the round's plan, the items, the design sheet and the packet) loads beside the page rather than
 * inside it: it reaches the claims registry (17.9 KB gzip) and the packet helpers, which the page's first paint does not
 * need, and which would put the closure over its 200 KB figure. The page shows its frame at once and the round when this lands.
 */
type Lib = typeof import('@/lib/mentor/interview')
let libLoad: Promise<Lib> | undefined
const loadLib = (): Promise<Lib> => (libLoad ??= import('@/lib/mentor/interview').catch((e) => {
  libLoad = undefined
  throw e
}))

// The item player loads on demand, as it does on the Error Museum: the page's first paint holds the round's frame only.
const ItemCard = lazy(() => import('@/components/items/ItemCard'))

const BUTTON_PRIMARY = 'inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground'
const BUTTON_QUIET = 'inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright'
const CARD = 'rounded-lg border border-line bg-surface-1 p-4 sm:p-5'

type Part = 'napkin' | 'incident' | 'design' | 'interviewer'

const PARTS: readonly { id: Part; label: string; title: string }[] = [
  { id: 'napkin', label: 'Napkin round', title: 'Napkin round' },
  { id: 'incident', label: 'Incident', title: 'The incident' },
  { id: 'design', label: 'Capacity design', title: 'Capacity design' },
  { id: 'interviewer', label: 'Interviewer', title: 'The skeptical interviewer' },
]

/**
 * /drills (docs/specs/wave-3.md §16.4, task 3s-06): Interview mode. Untimed, in three parts and a packet.
 *   1. A napkin round: three generated items from three families, each answered with the item player.
 *   2. An incident from the drill namespace, played with the Daily's flow on the reference engine.
 *   3. A capacity design: the replicas for a peak (goodput/replicas), then the price of the node a replica is
 *      (cost/per-mtok), joined in a sheet that carries the replica count into the price (`designSheet`).
 *   4. The interviewer: a packet that makes your own agent a skeptical interviewer, with three objections that code
 *      chose from an authored list (`mentor/interview`). The page sends nothing anywhere: you copy the packet, or open
 *      your agent with a short instruction, and paste it.
 *
 * Nothing here gates anything, and no free text is recorded. The item player grades and reports, and this page
 * writes no item event (a fresh seed would stand as unseen evidence and pay XP). The incident is practice: its first
 * completed attempt of a date writes one `incident` event under the team ref, like the On-Call pilot's shift
 * (`world/shift`), and a replay writes nothing. A round is a function of the local date and the round number, so
 * "Another round" is a new set of items, a new incident and a new set of objections.
 */
export default function Drills() {
  // The date is read once per visit, like the Daily's.
  const [date] = useState(() => localDateKey())
  const [round, setRound] = useState(0)
  const [lib, setLib] = useState<Lib | null>(null)
  const [libFailed, setLibFailed] = useState(false)
  const [libAttempt, setLibAttempt] = useState(0)
  useEffect(() => {
    let live = true
    loadLib().then(
      (l) => live && setLib(l),
      () => live && setLibFailed(true),
    )
    return () => {
      live = false
    }
  }, [libAttempt])
  const plan = useMemo(() => lib?.roundPlan(date, round) ?? null, [lib, date, round])
  const heading = useRef<HTMLHeadingElement>(null)
  // a new round starts at the top: the button that asked for it is gone, so focus goes to the page's heading
  useEffect(() => {
    if (round > 0) heading.current?.focus()
  }, [round])
  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12" data-page="drills" data-round={round + 1}>
      <p className="section-label">0x00 — drills</p>
      <h1 ref={heading} tabIndex={-1} className="mt-3 font-display text-h3 text-text-1 outline-none sm:text-h2">
        Interview mode
      </h1>
      <p className="mt-2 text-body-sm text-text-2">
        Round {round + 1} · {date} · untimed. Three parts and a packet: a napkin round, an incident, a capacity design, then your own agent as a skeptical
        interviewer. Nothing here is graded for credit, pays XP or keeps what you type.
      </p>
      {lib !== null && plan !== null ? (
        <Round key={round} lib={lib} plan={plan} onAnother={() => setRound((r) => r + 1)} />
      ) : libFailed ? (
        <div role="alert" className="mt-6 rounded-lg border border-danger/50 bg-surface-1 p-4 text-body-sm text-text-2" data-load-error>
          The round could not load.{' '}
          <button type="button" className="min-h-11 underline underline-offset-2" onClick={() => {
              setLibFailed(false)
              setLibAttempt((a) => a + 1)
            }}>
            Try again
          </button>
        </div>
      ) : (
        <p role="status" className={`${CARD} mt-6 text-body-sm text-text-2`} data-opening>
          Setting up the round…
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* One round                                                            */
/* ------------------------------------------------------------------ */

function Round({ lib, plan, onAnother }: { lib: Lib; plan: RoundPlan; onAnother: () => void }) {
  const [part, setPart] = useState<Part>('napkin')
  // a part mounts when it is first opened and stays mounted (hidden) after, so going back keeps its state
  const [opened, setOpened] = useState<Record<Part, boolean>>({ napkin: true, incident: false, design: false, interviewer: false })
  const [announcement, setAnnouncement] = useState('')
  const [napkin, setNapkin] = useState<RoundItem[] | null>(null)
  const [design, setDesign] = useState<{ replicas: RoundItem; cost: RoundItem } | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [napkinStates, setNapkinStates] = useState<ItemState[]>(() => Array.from({ length: lib.NAPKIN_LENGTH }, () => 'open'))
  const [designStates, setDesignStates] = useState<{ replicas: ItemState; cost: ItemState }>({ replicas: 'open', cost: 'open' })
  const [facts, setFacts] = useState<ShiftFacts | null>(null)
  const panels = useRef<Record<Part, HTMLHeadingElement | null>>({ napkin: null, incident: null, design: null, interviewer: null })
  const moved = useRef(false)

  // The napkin items load at once; the design's two items when the design or the interviewer is first opened.
  const wantDesign = opened.design || opened.interviewer
  useEffect(() => {
    let live = true
    lib.napkinItems(plan).then(
      (items) => live && setNapkin(items),
      () => live && setLoadError(true),
    )
    return () => {
      live = false
    }
  }, [lib, plan, attempt])
  useEffect(() => {
    if (!wantDesign) return
    let live = true
    lib.designItems(plan).then(
      (items) => live && setDesign(items),
      () => live && setLoadError(true),
    )
    return () => {
      live = false
    }
  }, [lib, plan, wantDesign, attempt])

  const goTo = useCallback((next: Part) => {
    moved.current = true
    setPart(next)
    setOpened((o) => (o[next] ? o : { ...o, [next]: true }))
    const n = PARTS.findIndex((p) => p.id === next) + 1
    setAnnouncement(`Part ${n} of ${PARTS.length}: ${PARTS[n - 1].title}.`)
  }, [])
  // focus follows a move to another part, to that part's heading; the first paint leaves it where it is
  useEffect(() => {
    if (moved.current) panels.current[part]?.focus()
  }, [part])

  const setNapkinState = useCallback((i: number, ok: boolean) => setNapkinStates((s) => s.map((x, j) => (j === i ? lib.stateOf(ok) : x))), [lib])
  const onIncident = useCallback((f: ShiftFacts) => setFacts(f), [])

  return (
    <div className="mt-6">
      <nav aria-label="Parts of the round">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PARTS.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => goTo(p.id)}
                aria-current={part === p.id ? 'step' : undefined}
                data-part-button={p.id}
                className={`flex min-h-11 w-full items-center gap-2 rounded-md border px-3 text-left text-body-sm ${part === p.id ? 'border-accent bg-surface-2 text-text-1' : 'border-line bg-surface-1 text-text-2 hover:border-line-bright'}`}
              >
                <span className="font-mono text-label text-text-3">{i + 1}</span>
                {p.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {loadError && (
        <div role="alert" className="mt-4 rounded-lg border border-danger/50 bg-surface-1 p-4 text-body-sm text-text-2" data-load-error>
          The items could not load.{' '}
          <button
            type="button"
            className="min-h-11 underline underline-offset-2"
            onClick={() => {
              setLoadError(false)
              setAttempt((a) => a + 1)
            }}
          >
            Try again
          </button>
        </div>
      )}

      <div className="mt-6">
        <div hidden={part !== 'napkin'} data-part="napkin">
          <PartHeading refTo={(el) => (panels.current.napkin = el)} title="Napkin round" id="napkin">
            Three quick estimates, the kind you do on a whiteboard. Answer each, read the check, and go on. Nothing is kept.
          </PartHeading>
          <NapkinPart items={napkin} states={napkinStates} onGraded={setNapkinState} onDone={() => goTo('incident')} />
        </div>
        {opened.incident && (
          <div hidden={part !== 'incident'} data-part="incident">
            <PartHeading refTo={(el) => (panels.current.incident = el)} title="The incident" id="incident">
              Page, hypothesis, probes, fix: the Daily&rsquo;s flow on a fresh drill seed, on the reference engine. The clock is incident time, not yours.
            </PartHeading>
            <IncidentPart lib={lib} plan={plan} onFacts={onIncident} onNext={() => goTo('design')} />
          </div>
        )}
        {opened.design && (
          <div hidden={part !== 'design'} data-part="design">
            <PartHeading refTo={(el) => (panels.current.design = el)} title="Capacity design" id="design">
              Size a fleet for a peak, then price it. The two answers chain: the replica count decides how busy the fleet is at the peak, and that decides what a token costs
              then.
            </PartHeading>
            <DesignPart lib={lib} items={design} onGraded={(k, ok) => setDesignStates((s) => ({ ...s, [k]: lib.stateOf(ok) }))} onDone={() => goTo('interviewer')} />
          </div>
        )}
        {opened.interviewer && (
          <div hidden={part !== 'interviewer'} data-part="interviewer">
            <PartHeading refTo={(el) => (panels.current.interviewer = el)} title="The skeptical interviewer" id="interviewer">
              Hand your own agent a packet that makes it the interviewer. Code drew its three objections from a list we wrote; the agent voices them and picks none.
            </PartHeading>
            <InterviewerPart lib={lib} plan={plan} napkin={napkin} design={design} napkinStates={napkinStates} designStates={designStates} facts={facts} onAnother={onAnother} />
          </div>
        )}
      </div>

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-live>
        {announcement}
      </div>
    </div>
  )
}

function PartHeading({ id, title, refTo, children }: { id: string; title: string; refTo: (el: HTMLHeadingElement | null) => void; children: string }) {
  return (
    <>
      <h2 ref={refTo} tabIndex={-1} id={`part-${id}`} className="font-display text-h3 text-text-1 outline-none">
        {title}
      </h2>
      <p className="mt-2 text-body-sm text-text-2">{children}</p>
    </>
  )
}

const ItemFallback = () => (
  <p role="status" className={`${CARD} mt-4 text-body-sm text-text-2`} data-opening>
    Loading the question…
  </p>
)

/* ------------------------------------------------------------------ */
/* 1. The napkin round                                                  */
/* ------------------------------------------------------------------ */

function NapkinPart({ items, states, onGraded, onDone }: { items: RoundItem[] | null; states: ItemState[]; onGraded: (i: number, ok: boolean) => void; onDone: () => void }) {
  const [index, setIndex] = useState(0)
  if (items === null) return <ItemFallback />
  const last = index === items.length - 1
  const closeCount = states.filter((s) => s === 'right').length
  return (
    <div className="mt-4" data-napkin-index={index + 1}>
      <Suspense fallback={<ItemFallback />}>
        <ItemCard
          key={index}
          item={{ source: 'gen', inst: items[index].inst }}
          gen={items[index].gen}
          confidence={false}
          autoFocus={index > 0}
          eyebrow={`Napkin ${index + 1} of ${items.length}`}
          onResult={(r) => onGraded(index, r.ok)}
          onNext={last ? onDone : () => setIndex(index + 1)}
          nextLabel={last ? 'On to the incident' : 'Next napkin'}
        />
      </Suspense>
      {last && states[index] !== 'open' && (
        <p className="mt-3 text-body-sm text-text-2" data-napkin-tally>
          {closeCount} of {items.length} close.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 2. The incident                                                      */
/* ------------------------------------------------------------------ */

type Phase = 'opening' | 'play' | 'debrief' | 'failed'

const hypothesisName = (h: HypothesisId): string => HYPOTHESIS_OPTIONS.find((o) => o.id === h)?.label ?? h

/**
 * The Daily's flow (pages/Daily.tsx) on the round's drill-namespace incident, always on the reference engine so every
 * round plays the same boxes. The first completed attempt of a date writes one practice event (`recordShift`); a replay
 * writes nothing, and the page says which happened.
 */
function IncidentPart({ lib, plan, onFacts, onNext }: { lib: Lib; plan: RoundPlan; onFacts: (f: ShiftFacts) => void; onNext: () => void }) {
  const incident = useMemo(() => lib.roundIncident(plan), [lib, plan])
  const { source, spec } = incident
  const [attempt, setAttempt] = useState(0)
  const [session, setSession] = useState<IncidentClientSession | null>(null)
  const [flow, setFlow] = useState<FlowState | null>(null)
  const [phase, setPhase] = useState<Phase>('opening')
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [wrote, setWrote] = useState(false)
  const visible = useVisibleClock()
  const alertAt = useRef<number | null>(null)

  const fail = useCallback((e: unknown) => {
    setFailure(describeFleetError(e, 'The incident stopped'))
    setPhase('failed')
  }, [])

  useEffect(() => {
    let live = true
    let opened: IncidentClientSession | null = null
    openIncidentSession({ mode: 'incident', spec, slots: dailySlotBytes({}, true) }).then(
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
  }, [spec, attempt, fail, visible])

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
    if (has && !hadHypothesis.current) document.querySelector<HTMLButtonElement>('[data-part="incident"] [data-probe]:not(:disabled)')?.focus()
    hadHypothesis.current = has
  }, [flow?.hypothesis])

  function restart() {
    alertAt.current = null
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
      const ms = alertAt.current === null ? undefined : visible() - alertAt.current
      setWrote(recordShift(useProgress, plan.date, incident, result, ms))
      onFacts(result)
      setAnnouncement('The debrief is ready.')
    },
    [plan.date, incident, visible, onFacts],
  )

  const open = phase === 'play' && flow !== null && !flow.ended
  const menus = useMemo(() => menuOrderFor(spec), [spec])
  return (
    <div className="mt-4 space-y-4" data-phase={phase}>
      {phase === 'opening' && (
        <p role="status" className={`${CARD} text-body-sm text-text-2`} data-opening>
          Opening the incident: warming the fleet up to the alert…
        </p>
      )}
      {phase === 'failed' && failure && (
        <div role="alert" className="rounded-lg border border-danger/50 bg-surface-1 p-4" data-failure>
          <h3 className="font-display text-h3 text-text-1">{failure.title}</h3>
          <p className="mt-2 text-body-sm text-text-2">{failure.detail}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={restart} className={BUTTON_PRIMARY}>
              Try again
            </button>
            <button type="button" onClick={onNext} className={BUTTON_QUIET}>
              Skip to the design
            </button>
          </div>
        </div>
      )}
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
              <FixMenu session={session} enabled={open && flow.hypothesis !== null} fixes={menus.fixes} busy={busy} run={run} onFix={onFix} onWait={onWait} onGiveUp={() => setPhase('debrief')} />
            </>
          )}
          {phase === 'debrief' && (
            <Debrief session={session} source={source} flow={flow} busy={busy} run={run} onResult={onResult}>
              {() => (
                <>
                  <p className="text-body-sm text-text-2" data-record-note>
                    {wrote ? 'Recorded as practice: it pays nothing and is not your Daily.' : 'Practice replay: nothing was written to your record.'}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={onNext} className={BUTTON_PRIMARY} data-next-part>
                      On to the capacity design
                    </button>
                    <button type="button" onClick={restart} className={BUTTON_QUIET} data-replay-incident>
                      Replay this incident
                    </button>
                  </div>
                </>
              )}
            </Debrief>
          )}
        </>
      )}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-live-incident>
        {announcement}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 3. The capacity design                                               */
/* ------------------------------------------------------------------ */

function DesignPart({
  lib,
  items,
  onGraded,
  onDone,
}: {
  lib: Lib
  items: { replicas: RoundItem; cost: RoundItem } | null
  onGraded: (step: 'replicas' | 'cost', ok: boolean) => void
  onDone: () => void
}) {
  const [step, setStep] = useState<'replicas' | 'cost' | 'sheet'>('replicas')
  const sheet = useMemo(() => (items === null ? null : lib.designSheet(items.replicas, items.cost)), [lib, items])
  const sheetHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (step === 'sheet') sheetHeading.current?.focus()
  }, [step])
  if (items === null) return <ItemFallback />
  if (step === 'sheet') {
    return (
      <section className={`${CARD} mt-4`} aria-labelledby="design-sheet" data-design-sheet>
        <h3 ref={sheetHeading} tabIndex={-1} id="design-sheet" className="font-display text-[16px] text-text-1 outline-none">
          The design, joined
        </h3>
        {sheet === null ? (
          <p className="mt-2 text-body-sm text-text-2">These two items do not join into a sheet.</p>
        ) : (
          <>
            <p className="mt-2 text-body-sm text-text-2">Taking a replica to be the node you just priced, the fleet looks like this.</p>
            <ul className="mt-2 space-y-1 text-body-sm text-text-1">
              {lib.sheetLines(sheet).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-3 text-body-sm text-text-2">
              The fleet is never more than {100 - sheet.headroom} % used, so the price you pay per delivered token is higher than the one at full load, and it is higher still when the load
              drops below the peak. That gap is what the headroom costs. Your interviewer will ask about it.
            </p>
          </>
        )}
        <div className="mt-4">
          <button type="button" onClick={onDone} className={BUTTON_PRIMARY} data-next-part>
            On to the interviewer
          </button>
        </div>
      </section>
    )
  }
  const current = items[step]
  return (
    <div className="mt-4" data-design-step={step}>
      <Suspense fallback={<ItemFallback />}>
        <ItemCard
          key={step}
          item={{ source: 'gen', inst: current.inst }}
          gen={current.gen}
          confidence={false}
          autoFocus={step === 'cost'}
          eyebrow={step === 'replicas' ? 'Design 1 of 2 · replicas' : 'Design 2 of 2 · price (a replica is this node)'}
          onResult={(r) => onGraded(step, r.ok)}
          onNext={() => setStep(step === 'replicas' ? 'cost' : 'sheet')}
          nextLabel={step === 'replicas' ? 'On to the price' : 'See the design sheet'}
        />
      </Suspense>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 4. The interviewer                                                   */
/* ------------------------------------------------------------------ */

function InterviewerPart({
  lib,
  plan,
  napkin,
  design,
  napkinStates,
  designStates,
  facts,
  onAnother,
}: {
  lib: Lib
  plan: RoundPlan
  napkin: RoundItem[] | null
  design: { replicas: RoundItem; cost: RoundItem } | null
  napkinStates: ItemState[]
  designStates: { replicas: ItemState; cost: ItemState }
  facts: ShiftFacts | null
  onAnother: () => void
}) {
  const [status, setStatus] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const packet = useMemo(() => {
    const napkinList: PacketItem[] = (napkin ?? []).map((n, i) => ({ text: lib.scenarioText(n.inst), state: napkinStates[i] ?? 'open' }))
    const designList =
      design === null
        ? null
        : {
            replicas: { text: lib.scenarioText(design.replicas.inst), state: designStates.replicas },
            cost: { text: lib.scenarioText(design.cost.inst), state: designStates.cost },
          }
    const insts = [...(napkin ?? []).map((n) => n.inst), ...(design === null ? [] : [design.replicas.inst, design.cost.inst])]
    return lib.buildInterviewerPacket({
      objections: plan.objections,
      napkin: napkinList,
      incident: facts === null ? null : lib.incidentLine(facts),
      design: designList,
      claims: lib.claimsOfItems(insts),
    })
  }, [lib, plan, napkin, design, napkinStates, designStates, facts])

  const copy = () => {
    navigator.clipboard.writeText(packet.text).then(
      () => setStatus('Copied. Paste it into your agent as the first message.'),
      () => {
        setStatus('Your browser did not allow the copy. The packet is open below: select it and copy it by hand.')
        const details = area.current?.closest('details')
        if (details) details.open = true
        area.current?.select()
      },
    )
  }
  const ready = napkin !== null && design !== null
  return (
    <div className="mt-4 space-y-4">
      <div className={CARD} data-packet>
        <p className="text-body-sm text-text-2">
          The packet is {packet.chars.toLocaleString('en-US')} characters of 6,000 at most. The interviewer&rsquo;s rules and objections come first; the scenario, where you stand and the
          sources are fenced below them as study material. It holds no code of yours and none of what you typed, and the page keeps no record of copying it.
        </p>
        {!ready && (
          <p className="mt-2 text-body-sm text-text-2" data-packet-loading>
            The items are still loading, so the packet leaves them out for now.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={copy} className={BUTTON_PRIMARY} data-copy-packet>
            Copy the interviewer packet
          </button>
          {(['claude', 'chatgpt'] as const).map((a) => (
            <a key={a} className={BUTTON_QUIET} href={lib.interviewUrl(a)} target="_blank" rel="noopener noreferrer" data-open-agent={a}>
              Open {a === 'claude' ? 'Claude' : 'ChatGPT'}
              <span className="sr-only"> (opens a new tab; copy the packet first and paste it)</span>
            </a>
          ))}
        </div>
        <p role="status" aria-live="polite" className="mt-2 min-h-5 text-body-sm text-text-2" data-copy-status>
          {status}
        </p>
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-body-sm text-info">Read the packet</summary>
          <label htmlFor="interview-packet" className="sr-only">
            The interviewer packet, {packet.chars} characters
          </label>
          <textarea
            id="interview-packet"
            ref={area}
            readOnly
            rows={12}
            value={packet.text}
            className="mt-2 w-full min-w-0 rounded-sm border border-line bg-ink p-2 font-mono text-[12px] text-text-1"
          />
        </details>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onAnother} className={BUTTON_QUIET} data-another-round>
          Another round
        </button>
        <Link to="/today" className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
          Back to Today
        </Link>
      </div>
    </div>
  )
}
