import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, ChevronRight, Loader2, Play, X } from 'lucide-react'
import { ClaimValue } from '@/components/ClaimValue'
import Alert from '@/components/daily/Alert'
import Debrief from '@/components/daily/Debrief'
import FixMenu from '@/components/daily/FixMenu'
import Hypothesis from '@/components/daily/Hypothesis'
import ProbeBar from '@/components/daily/ProbeBar'
import { ReceiptEditor, type ReceiptEditorHandle } from '@/components/fleetweek/ReceiptEditor'
import { RubricReview } from '@/components/fleetweek/RubricReview'
import { rubricData, type ExemplarAct, type RubricDraft } from '@/data/fleetweek/exemplars'
import { useProgress, XP } from '@/lib/progress'
import { useSlots, type SlotState } from '@/pages/fleet/slots'
import {
  ACT1_MACHINE,
  ACT2_MACHINE,
  ACT3_COST_LABEL,
  TRACE_NOTE,
  actMeta,
  citeKeyFor,
  gradeMeasurementSubmission,
  gradeAct3Doc,
  drillCreditsFrom,
  drillKey,
  machineLine,
  recordActRun,
  recordDrill,
  replayDrill,
  runComponents,
  startDrill,
  DRILL_BURN_SLACK,
  DRILL_FAULTS_NEEDED,
  HW_MENU,
  INCIDENTS,
  MIN_VERIFIED_RECEIPTS,
  seedLabel,
  type Act2Choice,
  type ActResult,
  type Act3Eval,
  type Drill,
  type DrillGrade,
  type IncidentOption,
  type MeasurementActId,
  type ReceiptEvidence,
} from '@/lib/fleet-week'
import { citeToken, parseReceipts, runRecord, uncitedFigures, valuesOf, verifyReceipts, withRunRecord, type ReceiptCheck, type ReceiptRunner } from '@/lib/fleet-receipts'
import type { RouterKind } from '@/lib/fleet-model'
import { describeFleetError, openIncidentSession, type IncidentClientSession } from '@/lib/fleet-session'
import { sha256Hex } from '@/lib/ledger/stable'
import type { FleetActData, FleetActMeta, Json, RunRecord } from '@/lib/ledger/types'
import {
  HYPOTHESIS_OPTIONS,
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
import { FAULT_SHORT, INCIDENT_FAULTS, type FixId, type Hypothesis as HypothesisId, type ProbeId } from '@/lib/world/incident-spec'
import type { FleetSlotBytes, IncidentFinish, IncidentFixReply, IncidentProbeReply, IncidentWaitReply } from '@/workers/fleet-protocol'
import type { SimJob, SimResults } from '@/workers/sim-protocol'
import { moduleBytes, runSim, runSimWithEntropy, SimTimeoutError } from '@/workers/sim-client'
import { cn } from '@/lib/utils'

const ACTS = [
  { id: 'engine', title: 'Act I — The Engine', brief: 'your stack vs the reference on the fleet trace', xp: XP.fleetWeekAct },
  { id: 'fleet', title: 'Act II — The Fleet', brief: 'node death + flash crowd: pick the topology, absorb it', xp: XP.fleetWeekAct },
  { id: 'business', title: 'Act III — The Business', brief: 'price the hardware, defend the claim — we execute it', xp: XP.fleetWeekAct },
  { id: 'incident', title: 'Act IV — The Incident', brief: 'probe drills on fresh seeds: name the fault, apply the fix', xp: XP.fleetWeekAct },
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
        <p className="mt-3 max-w-2xl text-body-sm text-text-2">
          In Acts I to III every run is saved as a record, and every number in your write-up is a receipt: a cited value that
          the page checks by re-running that record. Nothing is graded by what the text says, only by whether its numbers reproduce.
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

/** A "cite" button: inserts the receipt token for one value of the run into the analysis. */
function CiteButton({ what, onClick }: { what: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`cite ${what}`}
      data-cite
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-line bg-surface-2 px-2 font-mono text-[11px] text-info hover:border-line-bright"
    >
      cite
    </button>
  )
}

/** What a result panel needs to offer "cite" on its rows: which act's keys they restate, the run and what to do on a click. */
interface Citing {
  actId: MeasurementActId
  record: RunRecord | null
  onCite(key: string): void
}

function ResultPanel({ result, citing }: { result: ActResult; citing?: Citing }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('mt-4 rounded-md border p-4', result.pass ? 'border-accent/50 bg-accent/10' : result.practice ? 'border-line bg-surface-2' : 'border-amber/50 bg-amber/5')}>
      <p className={cn('font-mono text-sm', result.pass ? 'font-semibold text-text-1' : result.practice ? 'text-text-2' : 'text-amber')}>
        {result.pass ? 'PASS' : result.practice ? 'PRACTICE' : 'NOT YET'} — {result.headline}
      </p>
      <p className={cn('mt-1 text-body-sm', result.pass ? 'text-text-1' : 'text-text-2')}>{result.detail}</p>
      <div className={cn('mt-3 grid gap-x-6 gap-y-1 font-mono text-[11px] sm:grid-cols-2', result.pass ? 'text-text-1' : 'text-text-2')}>
        {result.metrics.map(([k, v], i) => {
          const key = citing ? citeKeyFor(citing.actId, k, v) : null
          const value = key && citing?.record && Object.hasOwn(citing.record.values, key) ? citing.record.values[key] : undefined
          return (
            <div key={i} className="flex items-center justify-between gap-4">
              <span>{k}</span>
              <span className="flex items-center gap-1 text-right text-text-1">
                {v}
                {key && value !== undefined && citing && <CiteButton what={`${k} ${value}`} onClick={() => citing.onCite(key)} />}
              </span>
            </div>
          )
        })}
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
  const [graded, setGraded] = useState<ActResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  /** The write-up's verdict. It passes the act (and records it, with the receipts and the rubric) or says what is missing. */
  const finish = useCallback(
    (r: ActResult, meta?: FleetActMeta) => {
      setGraded(r)
      if (r.pass) completeAct(actId, r.score, meta)
    },
    [actId, completeAct],
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
    setGraded(null)
    try {
      await job()
    } catch (e) {
      setError(describeError(e))
    } finally {
      busyRef.current = false
      setRunning(false)
    }
  }, [])
  return { running, progress, graded, error, finish, execute, setProgress }
}

/**
 * Write the run's `fleet-run` event (`fleet:act1`, `fleet:act2`) when a component of yours took part (docs/specs/wave-2.md
 * §10.6). A failure to hash or record never costs the learner their result.
 */
async function recordRun(mode: 'act1' | 'act2', result: ActResult, slots: SlotState): Promise<void> {
  try {
    recordActRun(useProgress, mode, result, await runComponents(slots))
  } catch {
    // the result on screen stands; only the ledger event is lost
  }
}

/* ------------------------------ run records and receipts ------------------------------ */

/** One act run and the record that receipts cite (null when the record could not be made or stored). */
interface Recorded<R> {
  result: R
  record: RunRecord | null
}

/**
 * Run one job in the sim worker and save it as a run record in `fw:runs` (docs/specs/wave-3.md §10.2): the job with
 * its module bytes as hashes, the entropy the worker drew the graded seeds from, and the values the run reported. A
 * failure to build or store the record never costs the learner their result; it only leaves nothing to cite.
 */
async function runRecorded<K extends SimJob['kind']>(act: RunRecord['act'], job: Extract<SimJob, { kind: K }>, onProgress: (fraction: number) => void): Promise<Recorded<SimResults[K]>> {
  const { result, entropy } = await runSimWithEntropy(job, onProgress)
  try {
    const record = await runRecord(act, job, entropy, valuesOf(result), new Date().toISOString())
    const stored = useProgress.getState().working['fw:runs']
    const records = Array.isArray(stored) ? (stored as unknown as RunRecord[]) : []
    useProgress.getState().setWorking('fw:runs', withRunRecord(records, record) as unknown as Json)
    return { result, record }
  } catch {
    return { result, record: null }
  }
}

/** A module of this device by the sha256 of its bytes: a session upload first, then what is installed (the components store). */
async function moduleByHash(sha256: string): Promise<ArrayBuffer | null> {
  const slots = useSlots.getState().slots
  for (const m of Object.values(slots)) {
    if (m && (await sha256Hex(m.bytes)) === sha256) return m.bytes
  }
  try {
    return await (await useProgress.controls.engine()).componentBytes(sha256)
  } catch {
    return null
  }
}

/** How the page re-runs a record: the sim worker with the record's entropy, and the modules this device holds. */
const RECEIPT_RUNNER: ReceiptRunner = {
  run: (job, entropy) => runSim(job, undefined, entropy),
  bytes: moduleByHash,
}

/** The cite buttons' side of the editor: the editor's handle, what the last click said, and the click itself. */
function useCiting(record: RunRecord | null) {
  const editor = useRef<ReceiptEditorHandle>(null)
  const [said, setSaid] = useState('')
  const cite = useCallback(
    (key: string) => {
      if (!record || !Object.hasOwn(record.values, key)) return
      const value = record.values[key]
      const inserted = editor.current?.insert(citeToken(record.id, key, value)) ?? false
      setSaid(inserted ? `Cited ${key} ${value} in your analysis.` : 'Your analysis is full: nothing was inserted.')
    },
    [record],
  )
  return { editor, said, cite }
}

const BUTTON = 'min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground'
const BUTTON_QUIET = 'min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright'

interface WorkbenchProps {
  act: ExemplarAct
  label: string
  hint: ReactNode
  placeholder: string
  /** The run the write-up is about, and the record its receipts must cite. */
  record: RunRecord | null
  text: string
  setText(next: string): void
  editor: RefObject<ReceiptEditorHandle | null>
  /** What the cite buttons last did, for the live region. */
  said: string
  submitLabel: string
  /** Why the write-up cannot be submitted yet, or null. */
  blocked: string | null
  graded: ActResult | null
  onGrade(evidence: ReceiptEvidence, rubric: FleetActData['rubric'] | undefined): void
}

/**
 * The write-up of one act (docs/specs/wave-3.md §10): the analysis with its cite buttons' target, "Check my receipts"
 * (it re-runs each cited record and marks each value verified or not), the rubric self-review, and the submit. The
 * receipts are checked when asked and again before a submit whose text has changed since: the grade reads the checks,
 * never the words.
 */
function Workbench({ act, label, hint, placeholder, record, text, setText, editor, said, submitLabel, blocked, graded, onGrade }: WorkbenchProps) {
  const [checked, setChecked] = useState<{ text: string; checks: ReceiptCheck[] } | null>(null)
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState('')
  const [rubric, setRubric] = useState<RubricDraft>({})
  const uncited = useMemo(() => uncitedFigures(text), [text])
  const receipts = useMemo(() => parseReceipts(text), [text])
  const current = checked && checked.text === text ? checked.checks : null

  const check = useCallback(async (): Promise<ReceiptCheck[]> => {
    setChecking(true)
    setNote('Re-running the cited runs…')
    try {
      const stored = useProgress.getState().working['fw:runs']
      const records = Array.isArray(stored) ? (stored as unknown as RunRecord[]) : []
      const checks = await verifyReceipts(receipts, records, RECEIPT_RUNNER)
      setChecked({ text, checks })
      const ok = checks.filter((c) => c.status === 'verified').length
      setNote(checks.length === 0 ? 'No receipts in your analysis yet: cite a number first.' : `${ok} of ${checks.length} receipts verified by re-running.`)
      return checks
    } catch {
      setNote('The check could not run. Try again.')
      return []
    } finally {
      setChecking(false)
    }
  }, [receipts, text])

  const submit = async () => {
    if (!record) return
    const checks = current ?? (await check())
    onGrade({ runId: record.id, checks, uncited: uncitedFigures(text) }, rubricData(rubric))
  }

  return (
    <div className="mt-4 rounded-md border border-line bg-ink p-4" data-workbench={act}>
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-1">write-up · every number a receipt</p>
      {!record && <p className="mt-2 text-body-sm text-text-2">This run could not be saved as a record, so it has nothing to cite. Run it again.</p>}
      <div className="mt-3">
        <ReceiptEditor ref={editor} label={label} hint={hint} value={text} onChange={setText} placeholder={placeholder} runId={record?.id ?? null} checks={current} uncited={uncited} />
      </div>
      <div role="status" aria-live="polite" className="sr-only" data-cite-live>
        {said}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void check()} disabled={checking} className={BUTTON_QUIET} data-check-receipts>
          {checking ? 'Re-running…' : 'Check my receipts'}
        </button>
        <p role="status" aria-live="polite" className="font-mono text-[11px] text-text-2" data-check-note>
          {note}
        </p>
      </div>

      <RubricReview act={act} value={rubric} onChange={setRubric} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void submit()} disabled={!record || checking || blocked !== null} className={cn(BUTTON, 'disabled:cursor-not-allowed disabled:opacity-50')} data-submit-writeup>
          {submitLabel}
        </button>
        {blocked && (
          <p className="max-w-xl text-body-sm text-text-2" data-blocked>
            {blocked}
          </p>
        )}
      </div>
      {graded && <ResultPanel result={graded} />}
    </div>
  )
}

/* ------------------------------ ACT 1 ------------------------------ */

function ActEngine() {
  const slots = useSlots((s) => s.slots)
  const { running, progress, graded, error, finish, execute, setProgress } = useActRunner('engine')
  const [traced, setTraced] = useState<Recorded<ActResult> | null>(null)
  const text = useProgress((s) => s.fleetWeek.measurementEvidence?.engine?.analysis ?? '')
  const setEvidence = useProgress((s) => s.setFleetWeekEvidence)
  const { editor, said, cite } = useCiting(traced?.record ?? null)
  const anyStudent = slots.sched || slots.mgr || slots.queue
  const trace = traced?.result ?? null
  return (
    <div>
      <p className="text-body-sm text-text-2">
        240 requests, flash crowds included. Your engine ({anyStudent ? 'with your components in it' : 'all-reference for now'}) against the reference engine, full speed. Pass: goodput within 3 points of the reference, with at least one of your scheduler, block manager or intake queue in the engine. Every run draws a fresh graded seed (shown in the result) and the reference re-runs on the same one.
      </p>
      <p className="mt-2 max-w-3xl font-mono text-[11px] leading-relaxed text-text-3" data-machine>
        The machine: {ACT1_MACHINE}. The trace: {TRACE_NOTE}
      </p>
      <RunButton
        running={running}
        progress={progress}
        label="run the trace"
        onClick={() =>
          void execute(async () => {
            const run = await runRecorded('engine', { kind: 'act1', modules: moduleBytes(slots) }, setProgress)
            setTraced(run)
            await recordRun('act1', run.result, slots)
          })
        }
      />
      <ActError message={error} />
      {trace && <ResultPanel result={trace} citing={{ actId: 'engine', record: traced?.record ?? null, onCite: cite }} />}
      {trace?.practice && (
        <p className="mt-3 text-body-sm text-text-2" data-install-hint>
          <Link to="/forge" className="inline-flex min-h-11 items-center text-info underline underline-offset-2">
            Pick a lab in the Forge
          </Link>{' '}
          and press &ldquo;Install in your engine&rdquo; after a fresh-seed pass, or{' '}
          <Link to="/fleet" className="inline-flex min-h-11 items-center text-info underline underline-offset-2">
            drop a module on the Fleet page
          </Link>
          .
        </p>
      )}
      {traced && trace && (
        <Workbench
          act="engine"
          label="Your analysis"
          hint={<MeasurementHint />}
          placeholder="Cite what the run measured, then explain it: what limited the engine, why requests missed the SLO, and which of your components you would change."
          record={traced.record}
          text={text}
          setText={(next) => setEvidence('engine', { analysis: next })}
          editor={editor}
          said={said}
          submitLabel="submit measurement artifact"
          blocked={trace.pass ? null : trace.practice ? 'Act I passes only with one of your own components in the engine. You can cite and check receipts on this run now, and submit after a passing run.' : 'The trace has not passed yet, so there is nothing to submit. Receipts can still be checked.'}
          graded={graded}
          onGrade={(evidence, rubric) => {
            const r = gradeMeasurementSubmission('engine', trace, evidence)
            finish(r, actMeta(r, evidence, rubric))
          }}
        />
      )}
    </div>
  )
}

/** What Acts I and II ask of a write-up. */
function MeasurementHint() {
  return (
    <>
      Cite each number from the result above with its &ldquo;cite&rdquo; button (or type a token), then explain it. Passing needs the trace pass, at least {MIN_VERIFIED_RECEIPTS} values
      of this run verified by &ldquo;Check my receipts&rdquo;, and no figure with a unit left outside a receipt. A number you worked out yourself (a ratio, a break-even) is not
      a receipt: write the arithmetic in words.
    </>
  )
}

/* ------------------------------ ACT 2 ------------------------------ */

function ActFleet() {
  const slots = useSlots((s) => s.slots)
  const { running, progress, graded, error, finish, execute, setProgress } = useActRunner('fleet')
  const [traced, setTraced] = useState<Recorded<ActResult> | null>(null)
  const [workers, setWorkers] = useState<2 | 4>(2)
  const [router, setRouter] = useState<RouterKind>('jsq')
  const text = useProgress((s) => s.fleetWeek.measurementEvidence?.fleet?.analysis ?? '')
  const setEvidence = useProgress((s) => s.setFleetWeekEvidence)
  const { editor, said, cite } = useCiting(traced?.record ?? null)
  const trace = traced?.result ?? null
  return (
    <div>
      <p className="text-body-sm text-text-2">
        A seeded node dies with its in-flight requests somewhere in t=300–500 (which worker and when come from the run&rsquo;s graded seed); at t=600 a flash crowd slams the survivors.
        Pick the redundancy and the routing. Pass: ≥92% completed and ≥40% goodput under disruption.
      </p>
      <p className="mt-2 max-w-3xl font-mono text-[11px] leading-relaxed text-text-3" data-machine>
        Each worker: {ACT2_MACHINE}. The trace: {TRACE_NOTE} The flash crowd adds requests to the 240, and the result shows the total.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[12px]">
        <span className="text-text-3">workers</span>
        {[2, 4].map((n) => (
          <button key={n} aria-pressed={workers === n} onClick={() => setWorkers(n as 2 | 4)} className={cn('min-h-11 min-w-11 rounded border px-2.5 py-1', workers === n ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1')}>{n}</button>
        ))}
        <span className="text-text-3">router</span>
        {(['rr', 'jsq'] as const).map((r) => (
          <button key={r} aria-pressed={router === r} onClick={() => setRouter(r)} className={cn('min-h-11 rounded border px-2.5 py-1', router === r ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1')}>{r === 'rr' ? 'round-robin' : 'jsq'}</button>
        ))}
      </div>
      <RunButton
        running={running}
        progress={progress}
        label="run with disruption"
        onClick={() =>
          void execute(async () => {
            const run = await runRecorded('fleet', { kind: 'act2', modules: moduleBytes(slots), choice: { workers, router } as Act2Choice }, setProgress)
            setTraced(run)
            await recordRun('act2', run.result, slots)
          })
        }
      />
      <ActError message={error} />
      {trace && <ResultPanel result={trace} citing={{ actId: 'fleet', record: traced?.record ?? null, onCite: cite }} />}
      {traced && trace && (
        <Workbench
          act="fleet"
          label="Your analysis"
          hint={<MeasurementHint />}
          placeholder="Cite what the run measured, then explain it: what the node death cost, why the survivors did or did not hold, and what your topology bought."
          record={traced.record}
          text={text}
          setText={(next) => setEvidence('fleet', { analysis: next })}
          editor={editor}
          said={said}
          submitLabel="submit measurement artifact"
          blocked={trace.pass ? null : 'The trace has not passed yet, so there is nothing to submit. Receipts can still be checked.'}
          graded={graded}
          onGrade={(evidence, rubric) => {
            const r = gradeMeasurementSubmission('fleet', trace, evidence)
            finish(r, actMeta(r, evidence, rubric))
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------ ACT 3 ------------------------------ */

function ActBusiness() {
  const { running, progress, graded, error, finish, execute, setProgress } = useActRunner('business')
  const [traced, setTraced] = useState<Recorded<Act3Eval> | null>(null)
  const [choice, setChoice] = useState<string>('b200')
  const doc = useProgress((s) => s.fleetWeek.docText ?? '')
  const setDoc = useProgress((s) => s.setFleetWeekDoc)
  const { editor, said, cite } = useCiting(traced?.record ?? null)
  const evaluation = traced?.result ?? null

  // the runner's busy ref guards double-clicks and is reset in its finally, so a failed run can be repeated
  const evaluate = useCallback(
    () =>
      execute(async () => {
        setTraced(await runRecorded('business', { kind: 'act3' }, setProgress))
      }),
    [execute, setProgress],
  )

  return (
    <div>
      <p className="text-body-sm text-text-2">
        The trace is the Fleet&rsquo;s, drawn fresh for each execution{evaluation ? ` (graded seed ${seedLabel(evaluation.seed)})` : ''}. Three hardware offers are on the table. First execute all three, then pick
        one and defend it. Passing needs the option you pick to meet the SLO in the execution (goodput of at least 50%) and your $/Mtok for it to be a receipt:
        cite its cost with the button, and &ldquo;Check my receipts&rdquo; re-runs it.
      </p>
      <p className="mt-2 max-w-3xl font-mono text-[11px] leading-relaxed text-text-3" data-machine>
        Machines: {HW_MENU.map((h) => `${h.id} has ${machineLine(h.cfg)}`).join('; ')}. {TRACE_NOTE}
      </p>
      <RunButton running={running} progress={progress} label="execute all three options" onClick={() => void evaluate()} />
      <ActError message={error} />
      {evaluation && traced && (
        <div className="mt-4 space-y-4">
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full font-mono text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-text-3">
                  <th className="p-2.5">option</th><th className="p-2.5">$/hr</th><th className="p-2.5">goodput</th><th className="p-2.5">SLO-met</th><th className="p-2.5">tokens served</th><th className="p-2.5">$/Mtok (sim)</th>
                </tr>
              </thead>
              <tbody>
                {evaluation.perOption.map((o) => {
                  const hw = HW_MENU.find((h) => h.id === o.id)
                  const costKey = `costPerMtok.${o.id}`
                  const goodputKey = `goodput.${o.id}`
                  const record = traced.record
                  return (
                    <tr key={o.id} className={cn('border-b border-line/60', choice === o.id && 'bg-accent/5 text-accent')}>
                      <td className="p-2.5">{hw?.name ?? o.id}{o.id === evaluation.bestValue ? ' ★' : ''}</td>
                      <td className="p-2.5">{hw ? <ClaimValue id={hw.hourlyClaimId} format={(c) => `$${c.value}`} /> : null}</td>
                      <td className="p-2.5">
                        <span className="flex items-center gap-1 whitespace-nowrap">
                          {o.goodput}%
                          {record && Object.hasOwn(record.values, goodputKey) && <CiteButton what={`${o.id} goodput ${o.goodput}`} onClick={() => cite(goodputKey)} />}
                        </span>
                      </td>
                      <td className="p-2.5">{o.sloMet}/240</td>
                      <td className="p-2.5">{o.tokensOut.toLocaleString('en-US')}</td>
                      <td className="p-2.5">
                        <span className="flex items-center gap-1 whitespace-nowrap">
                          {Number.isFinite(o.costPerMtok) ? `$${o.costPerMtok}` : '—'}
                          {record && Object.hasOwn(record.values, costKey) && <CiteButton what={`${o.id} cost per Mtok ${o.costPerMtok}`} onClick={() => cite(costKey)} />}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-text-3">
            $/hr: B200 is four GPUs at the dated 2026-10 median rental price; the other two are synthetic
            stand-ins (tap a value for its source). $/Mtok (sim) {ACT3_COST_LABEL}. It is the run&rsquo;s hours times the hourly price, over the tokens served.
          </p>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
            <span className="text-text-3">your pick</span>
            {HW_MENU.map((h) => (
              <button key={h.id} aria-pressed={choice === h.id} onClick={() => setChoice(h.id)} className={cn('min-h-11 min-w-11 rounded border px-2.5 py-1', choice === h.id ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1')}>{h.id}</button>
            ))}
          </div>
          <Workbench
            act="business"
            label="Defend the choice"
            hint="Cite your pick's $/Mtok and its goodput, then argue: the operating point on the frontier, why the goodput holds on this trace, what moves the cost, and what breaks first."
            placeholder="I pick … Its goodput is … and its cost is … because …"
            record={traced.record}
            text={doc}
            setText={setDoc}
            editor={editor}
            said={said}
            submitLabel="submit the business case"
            blocked={null}
            graded={graded}
            onGrade={(evidence, rubric) => {
              const r = gradeAct3Doc(choice, evaluation, evidence)
              finish(r, actMeta(r, evidence, rubric))
            }}
          />
        </div>
      )}
    </div>
  )
}

/* ------------------------------ ACT 4 ------------------------------ */

/** The reference drivers in every slot: drills run on reference components (docs/specs/wave-2.md §9.8). */
const NO_SLOTS: FleetSlotBytes = { sched: null, mgr: null, queue: null }

type DrillPhase = 'idle' | 'opening' | 'play' | 'debrief' | 'failed'

/**
 * Why the learner's pick and the key are what they are, in the same shape as QuizBlock's why list. `picked` is the
 * authored index of the pick, or -1 when there was none ("unsure", or no fix applied): then only the key shows.
 */
function WhyList({ heading, options, picked }: { heading: string; options: IncidentOption[]; picked: number }) {
  // the pick first when it is wrong (its misconception), then the key
  const shown = [...(picked < 0 || options[picked]?.correct ? [] : [picked]), ...options.flatMap((o, i) => (o.correct ? [i] : []))]
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

/** The pick of a finished drill as an index into the fault's menu, or -1 for no pick. */
const pickedIndex = (options: IncidentOption[], id: string | undefined): number => (id === undefined ? -1 : options.findIndex((o) => o.id === id))


/**
 * Act IV (docs/specs/wave-2.md §9.8): probe drills on unseen seeds. A drill is the Daily's flow on an incident
 * generated from a seed drawn the moment the drill starts; the act passes after one passed drill on each of three
 * distinct faults, and a drill that is not passed is followed by a new one, so nothing closes. A replay of an
 * incident the learner has seen is practice: played and debriefed, never recorded or counted.
 */
function ActIncident() {
  const stored = useProgress((s) => s.fleetWeek.measurementEvidence?.incident)
  const credits = useMemo(() => drillCreditsFrom(stored), [stored])
  const [drill, setDrill] = useState<Drill | null>(null)
  const [session, setSession] = useState<IncidentClientSession | null>(null)
  const [flow, setFlow] = useState<FlowState | null>(null)
  const [phase, setPhase] = useState<DrillPhase>('idle')
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [graded, setGraded] = useState<{ grade: DrillGrade; done: IncidentFinish } | null>(null)
  const region = useRef<HTMLDivElement>(null)
  const recorded = useRef<Drill | null>(null)

  const fail = useCallback((e: unknown) => {
    setFailure(describeFleetError(e, 'The drill stopped'))
    setPhase('failed')
  }, [])

  const begin = useCallback((next: Drill) => {
    setSession(null)
    setFlow(null)
    setGraded(null)
    setFailure(null)
    setAnnouncement('')
    setPhase('opening')
    setDrill(next)
  }, [])

  // One session per drill. A new drill (or leaving the page) closes the worker of the one before it.
  useEffect(() => {
    if (!drill) return
    let live = true
    let opened: IncidentClientSession | null = null
    openIncidentSession({ mode: 'incident', spec: drill.spec, slots: NO_SLOTS }).then(
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
  }, [drill, fail])

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

  // A started drill takes focus (the button that started it is gone); then, once a hypothesis is logged, the first probe.
  useEffect(() => {
    if (phase === 'play') region.current?.focus()
  }, [phase, drill])
  const hadHypothesis = useRef(false)
  useEffect(() => {
    const has = flow?.hypothesis != null
    if (has && !hadHypothesis.current) region.current?.querySelector<HTMLButtonElement>('[data-probe]:not(:disabled)')?.focus()
    hadHypothesis.current = has
  }, [flow?.hypothesis])

  const onLogged = (h: HypothesisId) => {
    setFlow((f) => f && withHypothesis(f, h))
    setAnnouncement(`Hypothesis logged: ${HYPOTHESIS_OPTIONS.find((o) => o.id === h)?.label ?? h}. The probes are open.`)
  }
  const onReading = (probe: ProbeId, reply: IncidentProbeReply) => {
    setFlow((f) => f && withProbe(f, probe, reply))
    setAnnouncement(`${readingHeadline(probe, reply.category)}. Incident clock ${sinceAlert(reply.minute, flow?.alert ?? 0)}.`)
    if (reply.ended) setPhase('debrief')
  }
  const onFix = (fix: FixId, reply: IncidentFixReply) => {
    setFlow((f) => f && withFix(f, fix, reply))
    if (reply.effective) setAnnouncement('That was the fix. Replaying the incident to recovery.')
    if (reply.effective || reply.ended) setPhase('debrief')
  }
  const onWait = (reply: IncidentWaitReply) => {
    setFlow((f) => f && withWait(f, reply))
    setAnnouncement(`One minute passed. Incident clock ${sinceAlert(reply.minute, flow?.alert ?? 0)}.`)
    if (reply.ended) setPhase('debrief')
  }

  // Called once per drill by the debrief: record it, grade it against the credits, show the verdict.
  const onResult = useCallback(
    (done: IncidentFinish) => {
      if (!drill || recorded.current === drill) return
      recorded.current = drill
      const grade = recordDrill(useProgress, drill, done)
      setGraded({ grade, done })
      setAnnouncement(`The debrief is ready. ${grade.result.headline}.`)
    },
    [drill],
  )

  const open = phase === 'play' && flow !== null && !flow.ended
  // both menus are drawn from the drill's own seed, so each fresh drill shows them in a new order
  const menus = useMemo(() => menuOrderFor(drill?.spec ?? { seed: 0 }), [drill])
  const passedFaults = credits.length
  return (
    <div>
      <p className="max-w-3xl text-body-sm text-text-2">
        Probe drills. Each drill is a new incident on a seed drawn the moment you start it: read the alert, log a hypothesis, probe the pipeline on the incident
        clock, then apply a fix. A drill passes when you held the right fault, applied its fix, and burned no more than twice the expert&rsquo;s budget plus{' '}
        {DRILL_BURN_SLACK} burn-minutes. The fault that is scored is the one you hold when your first fix goes in, right or wrong. Pass one drill on each of {DRILL_FAULTS_NEEDED} different faults to finish the act. A drill you do not pass costs nothing:
        the next one is a different incident, so there is nothing to memorise. Drills run on the reference components.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2 font-mono text-[12px]" aria-label="Faults passed so far" data-faults>
        {INCIDENT_FAULTS.map((f) => {
          const passed = credits.some((c) => c.fault === f)
          return (
            <li key={f} data-passed={passed ? 'yes' : 'no'} className={cn('rounded border px-3 py-1.5', passed ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3')}>
              {passed ? '✓ ' : '○ '}
              {FAULT_SHORT[f]}
              <span className="sr-only">{passed ? ', passed' : ', not passed yet'}</span>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 font-mono text-[11px] text-text-3" data-progress>
        {passedFaults}/{DRILL_FAULTS_NEEDED} distinct faults passed
      </p>

      {phase === 'idle' && (
        <button type="button" onClick={() => begin(startDrill())} className={cn('mt-4', BUTTON)} data-start-drill>
          {passedFaults === 0 ? 'Start a drill' : 'Start another drill'}
        </button>
      )}

      {drill && (
        <div ref={region} role="group" tabIndex={-1} aria-label="Incident drill" className="mt-4 space-y-4 outline-none" data-drill data-phase={phase} data-practice={drill.practice ? 'yes' : 'no'}>
          <p className="font-mono text-[11px] text-text-3" data-drill-seed>
            {drill.practice ? `replay of 0x${drillKey(drill.seed)} (practice: not recorded, not counted)` : `drill seed 0x${drillKey(drill.seed)}, drawn when this drill started`}
          </p>

          {phase === 'opening' && (
            <p role="status" className="rounded-lg border border-line bg-surface-1 p-4 text-body-sm text-text-2" data-opening>
              <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" aria-hidden />
              Opening the incident: warming the fleet up to the alert…
            </p>
          )}

          {phase === 'failed' && failure && (
            <div role="alert" className="rounded-lg border border-danger/50 bg-surface-1 p-4" data-failure>
              <h3 className="font-display text-h3 text-text-1">{failure.title}</h3>
              <p className="mt-2 text-body-sm text-text-2">{failure.detail}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => begin(drill.practice ? drill : startDrill())} className={BUTTON}>
                  Try again
                </button>
              </div>
            </div>
          )}

          {session && flow && phase !== 'failed' && (
            <>
              <Alert source={drill.source} session={session} clock={flow.clock} />
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
                <Debrief session={session} source={drill.source} flow={flow} busy={busy} run={run} onResult={onResult}>
                  {(result) => {
                    if (!graded || graded.done !== result) return null
                    const menu = INCIDENTS.find((i) => i.id === result.fault)
                    return (
                      <>
                        <ResultPanel result={graded.grade.result} />
                        {menu && (
                          <section aria-label="Why your hypothesis and fix were right or wrong" className="grid gap-4 sm:grid-cols-2">
                            <WhyList heading="hypothesis" options={menu.causes} picked={pickedIndex(menu.causes, result.hypothesis)} />
                            <WhyList heading="fix" options={menu.mitigations} picked={pickedIndex(menu.mitigations, result.fix)} />
                          </section>
                        )}
                        <div className="flex flex-wrap items-center gap-3">
                          <button type="button" onClick={() => begin(startDrill())} className={BUTTON} data-next-drill>
                            {graded.grade.pass ? 'Another drill' : 'Next drill (a new incident)'}
                          </button>
                          <button type="button" onClick={() => begin(replayDrill(drill))} className={BUTTON_QUIET} data-replay-drill>
                            Replay this incident as practice
                          </button>
                        </div>
                      </>
                    )
                  }}
                </Debrief>
              )}
            </>
          )}
        </div>
      )}

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-live>
        {announcement}
      </div>
    </div>
  )
}

function RunButton({ running, progress, label, onClick, disabled }: { running: boolean; progress?: number; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={running || disabled}
      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-4 py-2 font-mono text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
    >
      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      {running ? `executing…${progress ? ` ${Math.round(progress * 100)}%` : ''}` : label}
      <ChevronRight className="h-3.5 w-3.5" />
    </button>
  )
}
