import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, ChevronRight, ImagePlus, Loader2, Play, X } from 'lucide-react'
import { ClaimValue } from '@/components/ClaimValue'
import { useProgress, XP } from '@/lib/progress'
import { useSlots } from '@/pages/fleet/slots'
import {
  ACT3_COST_LABEL,
  gradeMeasurementSubmission,
  gradeAct3Doc,
  gradeIncidentCall,
  incidentLedgerFrom,
  incidentMisses,
  HW_MENU,
  INCIDENT_CLOSED_NOTE,
  INCIDENTS,
  seedLabel,
  type Act2Choice,
  type ActResult,
  type Act3Eval,
  type Incident,
  type IncidentOption,
  type MeasurementActId,
  type MeasurementEvidence,
} from '@/lib/fleet-week'
import type { RouterKind, TickSample } from '@/lib/fleet-model'
import { freshSeed, shuffledOrder } from '@/lib/rng'
import { moduleBytes, runSim, SimTimeoutError } from '@/workers/sim-client'
import { cn } from '@/lib/utils'

const ACTS = [
  { id: 'engine', title: 'Act I — The Engine', brief: 'your stack vs the reference on the fleet trace', xp: XP.fleetWeekAct },
  { id: 'fleet', title: 'Act II — The Fleet', brief: 'node death + flash crowd: pick the topology, absorb it', xp: XP.fleetWeekAct },
  { id: 'business', title: 'Act III — The Business', brief: 'price the hardware, defend the claim — we execute it', xp: XP.fleetWeekAct },
  { id: 'incident', title: 'Act IV — The Incident', brief: 'three broken systems, real telemetry, name the cause', xp: XP.fleetWeekAct },
]

const EMPTY_MEASUREMENT_EVIDENCE: NonNullable<
  ReturnType<typeof useProgress.getState>['fleetWeek']['measurementEvidence']
>[string] = {}

export default function FleetWeek() {
  const actsDone = useProgress((s) => s.fleetWeek.actsDone)
  return (
    <div className="mx-auto max-w-app px-6 pb-24 pt-16 lg:px-12">
      <Link to="/capstone" className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 transition-colors hover:text-text-1">
        <ArrowLeft className="h-3.5 w-3.5" /> capstone
      </Link>
      <div className="mt-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">capstone 2.0 · fleet week</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-text-1">Four acts. Everything executes.</h1>
        <p className="mt-4 max-w-2xl text-body-lg text-text-2">
          No self-attested checkboxes: your engine runs, your fleet is disrupted, your business case is
          recomputed against the simulator, and your incident diagnosis is graded on real telemetry.
          Upload your Forge modules on the <Link to="/fleet" className="text-accent underline">Fleet page</Link> first
          — or run all-reference to see the shape of it.
        </p>
      </div>
      <div className="mt-10 space-y-6">
        {ACTS.map((a) => (
          <ActShell key={a.id} act={a} done={actsDone.includes(a.id)}>
            {a.id === 'engine' ? <ActEngine /> : a.id === 'fleet' ? <ActFleet /> : a.id === 'business' ? <ActBusiness /> : <ActIncident />}
          </ActShell>
        ))}
      </div>
    </div>
  )
}

function ActShell({ act, done, children }: { act: (typeof ACTS)[number]; done: boolean; children: React.ReactNode }) {
  return (
    <section className={cn('rounded-lg border p-6', done ? 'border-accent/50 bg-accent/[0.03]' : 'border-line bg-surface-1')}>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">{act.title}</p>
          <p className="mt-1 text-body-sm text-text-2">{act.brief}</p>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="text-accent">+{act.xp} XP</span>
          {done && (
            <span className="inline-flex items-center gap-1 rounded border border-accent/60 bg-accent/10 px-2 py-0.5 text-accent">
              <Check className="h-3 w-3" /> done
            </span>
          )}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function ResultPanel({ result }: { result: ActResult }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('mt-4 rounded-md border p-4', result.pass ? 'border-accent/50 bg-accent/10' : result.practice ? 'border-line bg-surface-2' : 'border-amber/50 bg-amber/5')}>
      <p className={cn('font-mono text-sm', result.pass ? 'text-accent' : result.practice ? 'text-text-2' : 'text-amber')}>
        {result.pass ? 'PASS' : result.practice ? 'PRACTICE' : result.closed ? 'CLOSED' : 'NOT YET'} — {result.headline}
      </p>
      <p className="mt-1 text-body-sm text-text-2">{result.detail}</p>
      <div className="mt-3 grid gap-x-6 gap-y-1 font-mono text-[11px] text-text-2 sm:grid-cols-2">
        {result.metrics.map(([k, v], i) => (
          <div key={i} className="flex justify-between gap-4">
            <span className="text-text-3">{k}</span>
            <span className="text-right">{v}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

/** What a failed job tells the learner: a timeout already says what to fix; anything else is the worker's own message. */
function describeError(e: unknown): string {
  if (e instanceof SimTimeoutError) return e.message
  const detail = (e instanceof Error ? e.message : String(e)).replace(/[.\s]+$/, '')
  return `execution failed: ${detail}. Fix the cause and run again.`
}

function ActError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-4 rounded-md border border-danger/50 bg-danger/5 p-3 font-mono text-[12px] text-danger">
      {message}
    </p>
  )
}

function useActRunner(actId: string) {
  const completeAct = useProgress((s) => s.completeFleetWeekAct)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ActResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const report = useCallback((r: ActResult) => {
    setResult(r)
    setRunning(false)
  }, [])
  const finish = useCallback(
    (r: ActResult) => {
      report(r)
      if (r.pass) completeAct(actId, r.score)
    },
    [actId, completeAct, report],
  )
  /**
   * Run one act job. A module that traps or spins rejects (the sim client times spinners out), so
   * the busy flag and the "executing…" state are cleared in finally and the act can be re-run.
   */
  const execute = useCallback(async (job: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setRunning(true)
    setProgress(0)
    setError(null)
    try {
      await job()
    } catch (e) {
      setError(describeError(e))
    } finally {
      busyRef.current = false
      setRunning(false)
    }
  }, [])
  return { running, progress, result, error, report, finish, execute, setRunning, setProgress, setError }
}

/* ------------------------------ ACT 1 ------------------------------ */

function ActEngine() {
  const slots = useSlots((s) => s.slots)
  const { running, progress, result, error, report, finish, execute, setProgress } = useActRunner('engine')
  const [traceResult, setTraceResult] = useState<ActResult | null>(null)
  const anyStudent = slots.sched || slots.mgr || slots.queue
  return (
    <div>
      <p className="text-body-sm text-text-2">
        240 requests, flash crowds included. Your uploaded stack ({anyStudent ? 'yours' : 'all-reference for now'}) against the reference engine, full speed. Pass: goodput within 3 points of the reference. Every run draws a fresh graded seed (shown in the result) and the reference re-runs on the same one.
      </p>
      <RunButton
        running={running}
        progress={progress}
        label="run the trace"
        onClick={() =>
          void execute(async () => {
            const trace = await runSim({ kind: 'act1', modules: moduleBytes(slots) }, setProgress)
            setTraceResult(trace)
            report(trace)
          })
        }
      />
      <ActError message={error} />
      {result && <ResultPanel result={result} />}
      {traceResult && (
        <MeasurementSubmission
          actId="engine"
          traceResult={traceResult}
          onSubmit={(evidence) => finish(gradeMeasurementSubmission('engine', traceResult, evidence))}
        />
      )}
    </div>
  )
}

/* ------------------------------ ACT 2 ------------------------------ */

function ActFleet() {
  const slots = useSlots((s) => s.slots)
  const { running, progress, result, error, report, finish, execute, setProgress } = useActRunner('fleet')
  const [traceResult, setTraceResult] = useState<ActResult | null>(null)
  const [workers, setWorkers] = useState<2 | 4>(2)
  const [router, setRouter] = useState<RouterKind>('jsq')
  return (
    <div>
      <p className="text-body-sm text-text-2">
        A seeded node dies with its in-flight requests somewhere in t=300–500 (which worker and when come from the run's graded seed); at t=600 a flash crowd slams the survivors.
        Pick the redundancy and the routing. Pass: ≥92% completed and ≥40% goodput under disruption.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[12px]">
        <span className="text-text-3">workers</span>
        {[2, 4].map((n) => (
          <button key={n} onClick={() => setWorkers(n as 2 | 4)} className={cn('rounded border px-2.5 py-1', workers === n ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1')}>{n}</button>
        ))}
        <span className="text-text-3">router</span>
        {(['rr', 'jsq'] as const).map((r) => (
          <button key={r} onClick={() => setRouter(r)} className={cn('rounded border px-2.5 py-1', router === r ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1')}>{r === 'rr' ? 'round-robin' : 'jsq'}</button>
        ))}
      </div>
      <RunButton
        running={running}
        progress={progress}
        label="run with disruption"
        onClick={() =>
          void execute(async () => {
            const trace = await runSim({ kind: 'act2', modules: moduleBytes(slots), choice: { workers, router } as Act2Choice }, setProgress)
            setTraceResult(trace)
            report(trace)
          })
        }
      />
      <ActError message={error} />
      {result && <ResultPanel result={result} />}
      {traceResult && (
        <MeasurementSubmission
          actId="fleet"
          traceResult={traceResult}
          onSubmit={(evidence) => finish(gradeMeasurementSubmission('fleet', traceResult, evidence))}
        />
      )}
    </div>
  )
}

function MeasurementSubmission({
  actId,
  traceResult,
  onSubmit,
}: {
  actId: MeasurementActId
  traceResult: ActResult
  onSubmit: (evidence: MeasurementEvidence) => void
}) {
  const evidence = useProgress(
    (s) => s.fleetWeek.measurementEvidence?.[actId] ?? EMPTY_MEASUREMENT_EVIDENCE,
  )
  const setEvidence = useProgress((s) => s.setFleetWeekEvidence)
  const [fileError, setFileError] = useState<string | null>(null)
  const analysis = evidence.analysis ?? ''
  const words = analysis.trim() ? analysis.trim().split(/\s+/).length : 0

  return (
    <div className="mt-4 rounded-md border border-line bg-ink p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-1">
            measurement artifact · required
          </p>
          <p className="mt-1 max-w-2xl text-body-sm text-text-2">
            Open the <Link to="/fleet" className="text-accent underline">Fleet dashboard</Link>, run
            its practice seed, and capture its six-metric panel (graded seeds are shown with each
            result here; the Fleet does not replay them). Then explain the measured result and the
            lever that caused it in 40–150 words.
          </p>
        </div>
        <p className="font-mono text-[10px] text-text-3">
          rubric · trace 50% · screenshot 15% · analysis 35%
        </p>
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 rounded border border-dashed border-line px-3 py-2 font-mono text-[11px] text-text-2 transition-colors hover:border-accent/60 hover:text-text-1">
        <ImagePlus className="h-4 w-4 text-accent" />
        {evidence.screenshotName
          ? `${evidence.screenshotName} · ${Math.ceil((evidence.screenshotBytes ?? 0) / 1024)} KiB`
          : 'attach dashboard screenshot · PNG / JPEG / WebP'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size <= 0) {
              setFileError('Use a non-empty PNG, JPEG, or WebP screenshot.')
              return
            }
            setFileError(null)
            setEvidence(actId, { screenshotName: file.name, screenshotBytes: file.size })
            event.target.value = ''
          }}
        />
      </label>
      {fileError && <p className="mt-1 font-mono text-[10px] text-danger">{fileError}</p>}

      <textarea
        value={analysis}
        onChange={(event) => setEvidence(actId, { analysis: event.target.value })}
        rows={5}
        maxLength={1400}
        placeholder={
          actId === 'engine'
            ? 'Name at least two signals, quote a measured number with units, and connect the result to scheduling, admission, batching, headroom, prefill, or intake.'
            : 'Name at least two signals, quote a measured number with units, and connect the result to routing, workers, redundancy, topology, or node failure.'
        }
        className="mt-3 w-full rounded-md border border-line bg-surface-1 p-3 font-mono text-[12px] text-text-1 outline-none placeholder:text-text-3 focus:border-accent/60"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn('font-mono text-[10px]', words > 150 ? 'text-danger' : 'text-text-3')}>
          {words}/150 words · ≥2 named signals · ≥1 measured number · ≥1 decision lever
        </p>
        <RunButton
          running={false}
          label="submit measurement artifact"
          onClick={() =>
            onSubmit({
              analysis,
              screenshotName: evidence.screenshotName,
              screenshotBytes: evidence.screenshotBytes,
            })
          }
          disabled={!traceResult.pass}
        />
      </div>
    </div>
  )
}

/* ------------------------------ ACT 3 ------------------------------ */

function ActBusiness() {
  const { running, progress, result, error, finish, execute, setProgress } = useActRunner('business')
  const [evaluation, setEvaluation] = useState<Act3Eval | null>(null)
  const [choice, setChoice] = useState<string>('b200')
  const [claim, setClaim] = useState('')
  const doc = useProgress((s) => s.fleetWeek.docText ?? '')
  const setDoc = useProgress((s) => s.setFleetWeekDoc)

  // the runner's busy ref guards double-clicks and is reset in its finally, so a failed run can be repeated
  const evaluate = useCallback(
    () =>
      execute(async () => {
        setEvaluation(await runSim({ kind: 'act3' }, setProgress))
      }),
    [execute, setProgress],
  )

  return (
    <div>
      <p className="text-body-sm text-text-2">
        The trace is the Fleet's, drawn fresh for each execution{evaluation ? ` (graded seed ${seedLabel(evaluation.seed)})` : ''}. Three hardware offers are on the table. First execute all three, then pick
        one, state your expected $/Mtok, and defend it in ≥60 words. We recompute your claim — ±25% tolerance,
        and the option must meet the SLO.
      </p>
      <RunButton running={running} progress={progress} label="execute all three options" onClick={() => void evaluate()} />
      <ActError message={error} />
      {evaluation && (
        <div className="mt-4 space-y-4">
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full font-mono text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-text-3">
                  <th className="p-2.5">option</th><th className="p-2.5">$/hr</th><th className="p-2.5">goodput</th><th className="p-2.5">SLO-met</th><th className="p-2.5">$/Mtok (sim)</th>
                </tr>
              </thead>
              <tbody>
                {evaluation.perOption.map((o) => {
                  const hw = HW_MENU.find((h) => h.id === o.id)
                  return (
                    <tr key={o.id} className={cn('border-b border-line/60', choice === o.id && 'bg-accent/5 text-accent')}>
                      <td className="p-2.5">{hw?.name ?? o.id}{o.id === evaluation.bestValue ? ' ★' : ''}</td>
                      <td className="p-2.5">{hw ? <ClaimValue id={hw.hourlyClaimId} format={(c) => `$${c.value}`} /> : null}</td>
                      <td className="p-2.5">{o.goodput}%</td>
                      <td className="p-2.5">{o.sloMet}/240</td>
                      <td className="p-2.5">{Number.isFinite(o.costPerMtok) ? `$${o.costPerMtok}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-text-3">
            $/hr: B200 is four GPUs at the dated 2026-10 median rental price; the other two are synthetic
            stand-ins (tap a value for its source). $/Mtok (sim) {ACT3_COST_LABEL}.
          </p>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
            <span className="text-text-3">your pick</span>
            {HW_MENU.map((h) => (
              <button key={h.id} onClick={() => setChoice(h.id)} className={cn('rounded border px-2.5 py-1', choice === h.id ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1')}>{h.id}</button>
            ))}
            <span className="text-text-3">claimed $/Mtok</span>
            <input value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="e.g. 1.20" className="w-24 rounded border border-line bg-ink px-2 py-1 text-text-1 outline-none focus:border-accent/60" />
          </div>
          <textarea
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            rows={5}
            placeholder="Defend the choice: the operating point on the frontier, why the goodput number holds on this trace, what the cache does to the input cost, what breaks first…"
            className="w-full rounded-md border border-line bg-ink p-3 font-mono text-[12px] text-text-1 outline-none placeholder:text-text-3 focus:border-accent/60"
          />
          <RunButton
            running={false}
            label="submit the business case"
            onClick={() => {
              const claimNum = Number(claim)
              finish(gradeAct3Doc(choice, Number.isFinite(claimNum) ? claimNum : -1, doc, evaluation))
            }}
          />
        </div>
      )}
      {result && <ResultPanel result={result} />}
    </div>
  )
}

/* ------------------------------ ACT 4 ------------------------------ */

/** The call just graded: the options as authored, with the picks as authored indices (the display order is reshuffled for the retry). */
interface IncidentCall {
  causes: IncidentOption[]
  mitigations: IncidentOption[]
  cause: number
  mitigation: number
}

/** Why the chosen option and the right one are what they are, in the same shape as QuizBlock's why list. */
function WhyList({ heading, options, picked }: { heading: string; options: IncidentOption[]; picked: number }) {
  // the pick first when it is wrong (its misconception), then the key
  const shown = [...(options[picked]?.correct ? [] : [picked]), ...options.flatMap((o, i) => (o.correct ? [i] : []))]
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">{heading}</p>
      <ul className="mt-2 space-y-1.5" aria-label={`Why each ${heading} is right or wrong`}>
        {shown.map((oi) => {
          const o = options[oi]
          const right = o.correct
          const isPick = oi === picked
          return (
            <li key={o.id} className={cn('flex items-start gap-2 rounded-md border-l-2 bg-surface-2 px-3.5 py-2.5 text-body-sm text-text-2', right ? 'border-accent' : 'border-danger')}>
              {right ? <Check size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden /> : <X size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />}
              <span>
                <span className={cn('mr-1.5 font-mono text-[10px] uppercase', right ? 'text-accent' : 'text-danger')}>
                  {right ? (isPick ? 'your pick, correct' : 'correct answer') : 'your pick, wrong'}
                </span>
                <span className="mb-1 block font-mono text-[11px] text-text-3">{o.label}</span>
                {o.why}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ActIncident() {
  const { running, result, error, finish, setRunning, setError } = useActRunner('incident')
  const [idx, setIdx] = useState(0)
  const [incident, setIncident] = useState<Incident | null>(null)
  // cause / mitigation are authored indices; the display order is reshuffled per attempt
  const [cause, setCause] = useState<number | null>(null)
  const [mitigation, setMitigation] = useState<number | null>(null)
  // only the first call on each incident counts; the act and its XP need all of them right on that call.
  // Persisted in working state so a reload or a revisit cannot reset which incidents are already practice.
  const stored = useProgress((s) => s.fleetWeek.measurementEvidence?.incident)
  const setEvidence = useProgress((s) => s.setFleetWeekEvidence)
  const ledger = useMemo(() => incidentLedgerFrom(stored), [stored])
  const missed = incidentMisses(ledger)
  const [call, setCall] = useState<IncidentCall | null>(null)
  const [seed, setSeed] = useState(freshSeed)
  const causeOrder = useMemo(() => (incident ? shuffledOrder(incident.causes.length, seed) : []), [incident, seed])
  const mitigationOrder = useMemo(() => (incident ? shuffledOrder(incident.mitigations.length, seed ^ 0x9e3779b1) : []), [incident, seed])

  // only the latest click may touch state, so a slow or failed earlier load cannot overwrite or strand a newer one
  const openSeq = useRef(0)
  const open = useCallback(async (i: number) => {
    const seq = ++openSeq.current
    setRunning(true)
    setError(null)
    setIncident(null)
    setCause(null)
    setMitigation(null)
    setCall(null)
    setIdx(i)
    setSeed(freshSeed())
    try {
      const loaded = await runSim({ kind: 'incident', id: INCIDENTS[i].id })
      if (seq === openSeq.current) setIncident(loaded)
    } catch (e) {
      if (seq === openSeq.current) setError(describeError(e))
    } finally {
      if (seq === openSeq.current) setRunning(false)
    }
  }, [setRunning, setError])

  const submit = useCallback(() => {
    if (!incident || cause === null || mitigation === null) return
    const causeOk = incident.causes[cause].correct
    const mitOk = incident.mitigations[mitigation].correct
    const graded = gradeIncidentCall(ledger, incident, causeOk, mitOk)
    if (!graded.practice) setEvidence('incident', graded.ledger)
    setCall({ causes: incident.causes, mitigations: incident.mitigations, cause, mitigation })
    // every retry gets a fresh order and a clean selection, so positions can't be memorised
    setSeed(freshSeed())
    setCause(null)
    setMitigation(null)
    finish(graded.result)
  }, [incident, cause, mitigation, ledger, setEvidence, finish])

  return (
    <div>
      <p className="mb-3 max-w-3xl text-body-sm text-text-2">
        Diagnose from the same surface you instrumented: TTFT, TPOT, queue delay, KV state,
        goodput, and cost. The incident sparklines use those timing events plus pressure counters;
        identify the first metric that moves, not the loudest symptom at the end. Only your first call
        on each incident counts toward the act; it is marked ✓ if right and ○ if missed. The answer is
        revealed after every call, so any repeat call on the same incident is practice. The act needs
        all three incidents right on the first call, and only then earns its XP. A missed first call
        closes it until fresh incidents arrive in a later update: first calls on the other incidents
        are still graded and marked, but they cannot complete the act.
      </p>
      <div className="flex flex-wrap gap-2 font-mono text-[12px]">
        {INCIDENTS.map((d, i) => (
          <button key={d.id} onClick={() => void open(i)} className={cn('rounded border px-3 py-1.5', idx === i ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1')}>
            {ledger.credited.includes(d.id) ? '✓ ' : ledger.attempted.includes(d.id) ? '○ ' : ''}{d.title.split('—')[0].trim()}
          </button>
        ))}
      </div>
      {missed > 0 && (
        <p role="status" className="mt-3 max-w-3xl rounded-md border border-amber/50 bg-amber/5 px-3.5 py-2.5 text-body-sm text-text-2">
          {INCIDENT_CLOSED_NOTE}
        </p>
      )}
      {running && <p className="mt-3 font-mono text-[12px] text-text-3"><Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />loading telemetry…</p>}
      <ActError message={error} />
      {incident && (
        <div className="mt-4 space-y-4">
          <p className="font-mono text-[11px] text-text-3">graded seed {seedLabel(incident.seed)}</p>
          <p className="max-w-3xl text-body-sm text-text-2">{incident.briefing}</p>
          <TelemetryGrid series={incident.telemetry} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">root cause</p>
              <div className="mt-2 space-y-1.5">
                {causeOrder.map((ai, pos) => (
                  <Option key={incident.causes[ai].id} tag={String.fromCharCode(65 + pos)} active={cause === ai} onClick={() => setCause(ai)} label={incident.causes[ai].label} />
                ))}
              </div>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">mitigation</p>
              <div className="mt-2 space-y-1.5">
                {mitigationOrder.map((ai, pos) => (
                  <Option key={incident.mitigations[ai].id} tag={String.fromCharCode(65 + pos)} active={mitigation === ai} onClick={() => setMitigation(ai)} label={incident.mitigations[ai].label} />
                ))}
              </div>
            </div>
          </div>
          <RunButton running={false} label={ledger.attempted.includes(incident.id) ? 'practice call (not credited)' : missed > 0 ? 'call it (marked, act stays closed)' : 'call it'} onClick={submit} disabled={cause === null || mitigation === null} />
        </div>
      )}
      {result && <ResultPanel result={result} />}
      {call && (
        <section aria-label="Why your call was right or wrong" className="mt-4 grid gap-4 sm:grid-cols-2">
          <WhyList heading="root cause" options={call.causes} picked={call.cause} />
          <WhyList heading="mitigation" options={call.mitigations} picked={call.mitigation} />
        </section>
      )}
    </div>
  )
}

function Option({ active, onClick, label, tag }: { active: boolean; onClick: () => void; label: string; tag?: string }) {
  return (
    <button onClick={onClick} className={cn('block w-full rounded border px-3 py-2 text-left font-mono text-[12px] transition-colors', active ? 'border-accent/60 bg-accent/10 text-text-1' : 'border-line bg-ink text-text-2 hover:border-text-3')}>
      {tag && <span className="mr-2 text-text-3">{tag}.</span>}
      {label}
    </button>
  )
}

const SERIES: { key: keyof TickSample; label: string; color: string }[] = [
  { key: 'ttftP95', label: 'gen_ai · TTFT p95', color: '#FB7185' },
  { key: 'tpotP95', label: 'gen_ai · TPOT p95', color: '#22D3EE' },
  { key: 'queueP95', label: 'queue delay p95', color: '#FBBF24' },
  { key: 'waiting', label: 'waiting requests', color: '#5CA8FF' },
  { key: 'shed', label: 'shed', color: '#FF5C6C' },
  { key: 'autoPreempts', label: 'auto-preempts', color: '#A78BFA' },
]

function TelemetryGrid({ series }: { series: TickSample[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {SERIES.map((s) => (
        <div key={s.key} className="rounded-md border border-line bg-ink p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">{s.label}</p>
          <Sparkline values={series.map((t) => t[s.key] as number)} color={s.color} />
          <p className="mt-1 font-mono text-[10px] text-text-3">final: {fmt(series[series.length - 1]?.[s.key] as number)}</p>
        </div>
      ))}
    </div>
  )
}

const fmt = (n: number | undefined) => (n === undefined ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n * 10) / 10}`)

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const { d, last } = useMemo(() => {
    if (values.length < 2) return { d: '', last: 0 }
    const max = Math.max(...values, 1e-9)
    const min = Math.min(...values)
    const pts = values
      .map((v, i) => `${(i / (values.length - 1)) * 100},${34 - ((v - min) / Math.max(1e-9, max - min)) * 30}`)
      .join(' ')
    return { d: pts, last: values[values.length - 1] }
  }, [values])
  void last
  if (!d) return <div className="h-9" />
  return (
    <svg viewBox="0 0 100 36" className="mt-1 h-9 w-full" preserveAspectRatio="none">
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

function RunButton({ running, progress, label, onClick, disabled }: { running: boolean; progress?: number; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={running || disabled}
      className="mt-3 inline-flex items-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-4 py-2 font-mono text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
    >
      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {running ? `executing…${progress ? ` ${Math.round(progress * 100)}%` : ''}` : label}
      <ChevronRight className="h-3.5 w-3.5" />
    </button>
  )
}
