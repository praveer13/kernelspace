import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, ChevronRight, Loader2, Play } from 'lucide-react'
import { useProgress, XP } from '@/lib/progress'
import { useSlots } from '@/pages/fleet/slots'
import {
  evalAct3,
  gradeAct3Doc,
  HW_MENU,
  loadIncident,
  runAct1,
  runAct2,
  INCIDENTS,
  type Act2Choice,
  type ActResult,
  type Act3Eval,
  type Incident,
} from '@/lib/fleet-week'
import type { RouterKind, TickSample } from '@/lib/fleet-model'
import { cn } from '@/lib/utils'

const ACTS = [
  { id: 'engine', title: 'Act I — The Engine', brief: 'your stack vs the reference on the fleet trace', xp: XP.fleetWeekAct },
  { id: 'fleet', title: 'Act II — The Fleet', brief: 'node death + flash crowd: pick the topology, absorb it', xp: XP.fleetWeekAct },
  { id: 'business', title: 'Act III — The Business', brief: 'price the hardware, defend the claim — we execute it', xp: XP.fleetWeekAct },
  { id: 'incident', title: 'Act IV — The Incident', brief: 'three broken systems, real telemetry, name the cause', xp: XP.fleetWeekAct },
]

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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('mt-4 rounded-md border p-4', result.pass ? 'border-accent/50 bg-accent/10' : 'border-amber/50 bg-amber/5')}>
      <p className={cn('font-mono text-sm', result.pass ? 'text-accent' : 'text-amber')}>
        {result.pass ? 'PASS' : 'NOT YET'} — {result.headline}
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

function useActRunner(actId: string) {
  const completeAct = useProgress((s) => s.completeFleetWeekAct)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ActResult | null>(null)
  const finish = useCallback(
    (r: ActResult) => {
      setResult(r)
      setRunning(false)
      if (r.pass) completeAct(actId, r.score)
    },
    [actId, completeAct],
  )
  return { running, result, finish, setRunning }
}

/* ------------------------------ ACT 1 ------------------------------ */

function ActEngine() {
  const slots = useSlots((s) => s.slots)
  const { running, result, finish, setRunning } = useActRunner('engine')
  const anyStudent = slots.sched || slots.mgr || slots.queue
  return (
    <div>
      <p className="text-body-sm text-text-2">
        240 requests, flash crowds included. Your uploaded stack ({anyStudent ? 'yours' : 'all-reference for now'}) against the reference engine, full speed. Pass: goodput within 3 points of the reference.
      </p>
      <RunButton running={running} label="run the trace" onClick={async () => { setRunning(true); finish(await runAct1(slots)) }} />
      {result && <ResultPanel result={result} />}
    </div>
  )
}

/* ------------------------------ ACT 2 ------------------------------ */

function ActFleet() {
  const slots = useSlots((s) => s.slots)
  const { running, result, finish, setRunning } = useActRunner('fleet')
  const [workers, setWorkers] = useState<2 | 4>(2)
  const [router, setRouter] = useState<RouterKind>('jsq')
  return (
    <div>
      <p className="text-body-sm text-text-2">
        At t=400 a node dies with its in-flight requests; at t=600 a flash crowd slams the survivors.
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
      <RunButton running={running} label="run with disruption" onClick={async () => { setRunning(true); finish(await runAct2(slots, { workers, router } as Act2Choice)) }} />
      {result && <ResultPanel result={result} />}
    </div>
  )
}

/* ------------------------------ ACT 3 ------------------------------ */

function ActBusiness() {
  const { running, result, finish, setRunning } = useActRunner('business')
  const [evaluation, setEvaluation] = useState<Act3Eval | null>(null)
  const [choice, setChoice] = useState<string>('b200')
  const [claim, setClaim] = useState('')
  const doc = useProgress((s) => s.fleetWeek.docText ?? '')
  const setDoc = useProgress((s) => s.setFleetWeekDoc)
  const evaluatingRef = useRef(false)

  const evaluate = useCallback(async () => {
    if (evaluatingRef.current) return
    evaluatingRef.current = true
    setRunning(true)
    const ev = await evalAct3()
    setEvaluation(ev)
    setRunning(false)
    evaluatingRef.current = false
  }, [setRunning])

  return (
    <div>
      <p className="text-body-sm text-text-2">
        The trace is the Fleet's. Three hardware offers are on the table. First execute all three, then pick
        one, state your expected $/Mtok, and defend it in ≥60 words. We recompute your claim — ±25% tolerance,
        and the option must meet the SLO.
      </p>
      <RunButton running={running} label="execute all three options" onClick={evaluate} />
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
                      <td className="p-2.5">{hw?.hourlyUsd}</td>
                      <td className="p-2.5">{o.goodput}%</td>
                      <td className="p-2.5">{o.sloMet}/240</td>
                      <td className="p-2.5">{Number.isFinite(o.costPerMtok) ? `$${o.costPerMtok}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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

function ActIncident() {
  const { running, result, finish, setRunning } = useActRunner('incident')
  const [idx, setIdx] = useState(0)
  const [incident, setIncident] = useState<Incident | null>(null)
  const [cause, setCause] = useState<string | null>(null)
  const [mitigation, setMitigation] = useState<string | null>(null)
  const [solved, setSolved] = useState<string[]>([])

  const open = useCallback(async (i: number) => {
    setRunning(true)
    setIncident(null)
    setCause(null)
    setMitigation(null)
    setIdx(i)
    setIncident(loadIncident(INCIDENTS[i].id))
    setRunning(false)
  }, [setRunning])

  const submit = useCallback(() => {
    if (!incident || !cause || !mitigation) return
    const causeOk = incident.causes.find((c) => c.id === cause)?.correct
    const mitOk = incident.mitigations.find((m) => m.id === mitigation)?.correct
    const ok = causeOk && mitOk
    const newSolved = ok && !solved.includes(incident.id) ? [...solved, incident.id] : solved
    setSolved(newSolved)
    const allDone = newSolved.length >= INCIDENTS.length
    finish({
      pass: allDone,
      score: newSolved.length / INCIDENTS.length,
      headline: ok ? `correct — ${incident.title.split('—')[0].trim()} diagnosed` : 'wrong call — look at the telemetry again',
      detail: ok
        ? allDone
          ? 'all three incidents diagnosed with the right fix. The Planner would hire you.'
          : `${INCIDENTS.length - newSolved.length} incident(s) remain.`
        : `cause ${causeOk ? '✓' : '✗'} · mitigation ${mitOk ? '✓' : '✗'} — re-read the briefing and the curves.`,
      metrics: [
        ['solved', `${newSolved.length}/${INCIDENTS.length}`],
        ['cause', causeOk ? 'correct' : 'wrong'],
        ['mitigation', mitOk ? 'correct' : 'wrong'],
      ],
    })
  }, [incident, cause, mitigation, solved, finish])

  return (
    <div>
      <div className="flex flex-wrap gap-2 font-mono text-[12px]">
        {INCIDENTS.map((d, i) => (
          <button key={d.id} onClick={() => void open(i)} className={cn('rounded border px-3 py-1.5', idx === i ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1')}>
            {solved.includes(d.id) ? '✓ ' : ''}{d.title.split('—')[0].trim()}
          </button>
        ))}
      </div>
      {running && <p className="mt-3 font-mono text-[12px] text-text-3"><Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />loading telemetry…</p>}
      {incident && (
        <div className="mt-4 space-y-4">
          <p className="max-w-3xl text-body-sm text-text-2">{incident.briefing}</p>
          <TelemetryGrid series={incident.telemetry} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">root cause</p>
              <div className="mt-2 space-y-1.5">
                {incident.causes.map((c) => (
                  <Option key={c.id} active={cause === c.id} onClick={() => setCause(c.id)} label={c.label} />
                ))}
              </div>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">mitigation</p>
              <div className="mt-2 space-y-1.5">
                {incident.mitigations.map((m) => (
                  <Option key={m.id} active={mitigation === m.id} onClick={() => setMitigation(m.id)} label={m.label} />
                ))}
              </div>
            </div>
          </div>
          <RunButton running={false} label="call it" onClick={submit} disabled={!cause || !mitigation} />
        </div>
      )}
      {result && <ResultPanel result={result} />}
    </div>
  )
}

function Option({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={cn('block w-full rounded border px-3 py-2 text-left font-mono text-[12px] transition-colors', active ? 'border-accent/60 bg-accent/10 text-text-1' : 'border-line bg-ink text-text-2 hover:border-text-3')}>
      {label}
    </button>
  )
}

const SERIES: { key: keyof TickSample; label: string; color: string }[] = [
  { key: 'ttftP95', label: 'ttft p95', color: '#FB7185' },
  { key: 'waiting', label: 'waiting', color: '#FBBF24' },
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

function RunButton({ running, label, onClick, disabled }: { running: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={running || disabled}
      className="mt-3 inline-flex items-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-4 py-2 font-mono text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
    >
      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {running ? 'executing…' : label}
      <ChevronRight className="h-3.5 w-3.5" />
    </button>
  )
}
