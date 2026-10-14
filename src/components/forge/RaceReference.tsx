import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Cpu, Flag } from 'lucide-react'
import { clsx as cn } from 'clsx'
import type { ForgeLab } from '@/data/labs'
import SimMirror from '@/components/sims/SimMirror'
import { requiredChecksOf } from '@/lib/engine/store'
import type { Credit } from '@/lib/forge/run'
import { BESTIARY_TABLE_ID, BIN_POINTS, RACE_BAR_POINTS, bestiaryTable, histogramBins, placementSentence, raceOffered, runRace, type RaceDeps, type RaceOutcome } from '@/lib/forge/race'
import type { LabRunReport } from '@/lib/forge/types'
import { sha256Hex } from '@/lib/ledger/stable'
import { useProgress } from '@/lib/progress'
import type { BestiaryRow } from '@/lib/world/bestiary'
import { useSlots } from '@/pages/fleet/slots'
import { SimTimeoutError, runSimWithEntropy } from '@/workers/sim-client'

/**
 * "Race the reference" on ForgeLab (docs/specs/wave-3.md §8.3, §2.3), shown after a run. ForgeLab mounts it with the
 * same run values InstallButton gets: the report, the credit `creditFor` gave it and the exact module bytes that ran.
 *
 * It appears for lab 06 only, and only for a module that passed every required check on fresh seeds in this run. The
 * race is Act I's job with just your scheduler in the engine, on a graded seed drawn when you press the button (so a
 * seed your code has not seen); the result is written to your ledger as an engine run, and within 3 points of the
 * reference it meets RING 0's lab 06 line. The bestiary then places your goodput among twelve policies from the
 * scheduler play's Compose dials, run on the same seed. The last block opens the Fleet's real-engine panel with your
 * scheduler installed. Everything that draws a number lives in `lib/forge/race.ts` and the sim worker.
 */
export interface RaceReferenceProps {
  lab: ForgeLab
  /** The module that produced `report`, as dropped. */
  bytes: ArrayBuffer
  report: LabRunReport
  credit: Credit
}

/** One id per module, so a new run (new bytes) remounts the panel and forgets the last race. */
const moduleIds = new WeakMap<ArrayBuffer, number>()
let lastModuleId = 0
function moduleKey(bytes: ArrayBuffer): number {
  let id = moduleIds.get(bytes)
  if (id === undefined) {
    id = ++lastModuleId
    moduleIds.set(bytes, id)
  }
  return id
}

export default function RaceReference(props: RaceReferenceProps) {
  if (!raceOffered(props.lab.id, props.report, props.credit)) return null
  return <RacePanel key={moduleKey(props.bytes)} {...props} />
}

/** The real edges: the sim worker, the ledger and the hash. */
const realDeps = (): RaceDeps => ({
  run: runSimWithEntropy,
  record: (run) => useProgress.getState().recordFleetRun(run),
  sha256: sha256Hex,
})

type Phase = { kind: 'idle' } | { kind: 'running'; fraction: number } | { kind: 'done'; outcome: RaceOutcome } | { kind: 'failed'; message: string }

/** The seed as Fleet Week shows it, so a run can be quoted (`seedLabel` in fleet-week.ts, which this chunk does not import). */
const seedLabel = (seed: number | null): string => (seed === null ? 'practice (fixed)' : `0x${seed.toString(16).padStart(8, '0')}`)

const describeError = (e: unknown): string => {
  if (e instanceof SimTimeoutError) return e.message
  const detail = (e instanceof Error ? e.message : String(e)).replace(/[.\s]+$/, '')
  return `execution failed: ${detail}. Fix the cause and race again.`
}

/** The panel, with its edges injectable so a test can race a fake scheduler module without the worker. */
export function RacePanel({ lab, report, bytes, deps = realDeps() }: RaceReferenceProps & { deps?: RaceDeps }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const running = phase.kind === 'running'

  const onRace = () => {
    if (running) return
    setPhase({ kind: 'running', fraction: 0 })
    runRace(bytes, deps, (fraction) => setPhase((p) => (p.kind === 'running' ? { kind: 'running', fraction } : p))).then(
      (outcome) => setPhase({ kind: 'done', outcome }),
      (e: unknown) => setPhase({ kind: 'failed', message: describeError(e) }),
    )
  }

  return (
    <section aria-labelledby="race-title" data-testid="race-panel" className="mt-4 rounded-md border border-accent/40 bg-accent/5 p-4">
      <p id="race-title" className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
        race the reference · {lab.title}
      </p>
      <p className="mt-2 text-body-sm text-text-2">
        Act I&apos;s job: 240 requests through one engine, with only your scheduler in it, against the reference engine on the same trace. A graded seed is drawn when you
        press the button, so it is a trace your code has not seen. Goodput within {RACE_BAR_POINTS} points of the reference meets the lab 06 line of RING 0.
      </p>
      <button
        type="button"
        onClick={onRace}
        disabled={running}
        aria-describedby="race-status"
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-3.5 py-2 font-mono text-[12px] text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
      >
        <Flag className="h-3.5 w-3.5" aria-hidden="true" />
        {running ? 'racing…' : phase.kind === 'done' ? 'race again on a new seed' : 'race the reference'}
      </button>
      {/* one persistent live region: progress while it runs (visible), the verdict when it ends (read aloud; the result box shows it) */}
      <p id="race-status" role="status" className={cn('font-mono text-[11px] text-text-3', running ? 'mt-2' : 'sr-only')}>
        {running ? `racing · ${Math.round(phase.fraction * 100)}%` : phase.kind === 'done' ? verdictLine(phase.outcome) : ''}
      </p>
      {phase.kind === 'failed' && (
        <p role="alert" className="mt-2 rounded-md border border-danger/50 bg-danger/5 p-3 font-mono text-[12px] text-danger">
          {phase.message}
        </p>
      )}
      {phase.kind === 'done' && <RaceResult outcome={phase.outcome} />}
      <RealEngineLink lab={lab} report={report} bytes={bytes} />
    </section>
  )
}

const verdictLine = (o: RaceOutcome): string => `${o.within ? 'WITHIN 3 POINTS' : 'NOT YET'} — goodput ${o.goodput}% vs reference ${o.refGoodput}%`

/** The verdict, the numbers, and the bestiary when it ran. Pure of the worker and the ledger. */
export function RaceResult({ outcome }: { outcome: RaceOutcome }) {
  const gap = Math.round((outcome.refGoodput - outcome.goodput) * 10) / 10
  return (
    <div className="mt-4" data-testid="race-result">
      <div className={cn('rounded-md border p-3', outcome.within ? 'border-accent/50 bg-accent/10' : 'border-amber/50 bg-amber/5')}>
        <p className={cn('font-mono text-sm', outcome.within ? 'text-accent' : 'text-amber')}>{verdictLine(outcome)}</p>
        <p className="mt-1 text-body-sm text-text-2">
          {outcome.within
            ? outcome.goodput >= outcome.refGoodput
              ? 'your scheduler matched or beat the reference on a seed it had not seen.'
              : `${gap} points behind the reference, inside the ${RACE_BAR_POINTS}-point bar.`
            : outcome.detail}
        </p>
        <p className="mt-1 font-mono text-[11px] text-text-2">
          graded seed {seedLabel(outcome.seed)} ·{' '}
          {outcome.recorded
            ? outcome.within
              ? 'recorded on your ledger as an unseen engine run; RING 0 counts it'
              : 'recorded on your ledger as an unseen engine run, outside the bar'
            : 'not recorded: the ledger could not take this run'}
        </p>
      </div>
      {outcome.bestiary ? (
        <Bestiary goodput={outcome.goodput} rows={outcome.bestiary.rows} seed={outcome.bestiary.seed} />
      ) : (
        outcome.bestiaryError && (
          <p role="alert" className="mt-3 rounded-md border border-line bg-surface-1 p-3 font-mono text-[12px] text-text-2">
            The twelve-policy comparison did not run: {outcome.bestiaryError}
          </p>
        )
      )}
    </div>
  )
}

/* ------------------------------ the bestiary ------------------------------ */

function Bestiary({ goodput, rows, seed }: { goodput: number; rows: readonly BestiaryRow[]; seed: number | null }) {
  const sentence = placementSentence(goodput, rows)
  return (
    <div className="mt-4" data-testid="bestiary">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">where you fall · twelve policies from the Compose dials</h3>
      <p className="mt-1 text-body-sm text-text-2">
        {sentence} These are twelve settings of the scheduler play&apos;s Compose dials (order, guard, headroom, preempt), run on the same seed
        ({seedLabel(seed)}). They are not production schedulers.
      </p>
      <BestiaryChart goodput={goodput} rows={rows} describedBy={BESTIARY_TABLE_ID} label={`Dot histogram of goodput in ${BIN_POINTS}-point bins. ${sentence}`} className="mt-3" />
      <SimMirror id={BESTIARY_TABLE_ID} table={bestiaryTable(goodput, rows)} className="mt-3" />
    </div>
  )
}

const W = 240
const PAD_X = 8
const CELL = 24
const AXIS_H = 20

/**
 * A dot histogram: one dot per policy (numbered as in the table; the reference in amber), one square for you, in bins of
 * 5 points. Counting dots reads the distribution without a y-axis; the table beside it holds the numbers.
 */
export function BestiaryChart({ goodput, rows, label, describedBy, className }: { goodput: number; rows: readonly BestiaryRow[]; label: string; describedBy: string; className?: string }) {
  const bins = histogramBins(rows, goodput)
  const slot = (W - 2 * PAD_X) / bins.length
  const stack = Math.max(...bins.map((b) => b.rows.length + (b.mine ? 1 : 0)))
  const H = stack * CELL + AXIS_H
  const x0 = (i: number) => PAD_X + i * slot
  const cx = (i: number) => x0(i) + slot / 2
  const y = (k: number) => H - AXIS_H - (k + 0.5) * CELL
  return (
    <figure className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-auto w-full max-w-md" role="img" aria-label={label} aria-describedby={describedBy}>
        <line x1={PAD_X} x2={W - PAD_X} y1={H - AXIS_H} y2={H - AXIS_H} className="stroke-line-bright" strokeWidth="1" />
        {bins.map((b, i) => (
          <g key={b.lo}>
            {(b.lo % 10 === 0) && (
              <text x={x0(i)} y={H - 6} className="fill-text-3" fontSize="9" textAnchor="middle">
                {b.lo}%
              </text>
            )}
            {b.rows.map((r, k) => (
              <g key={r.id}>
                <circle cx={cx(i)} cy={y(k)} r={CELL / 2 - 2} className={r.id === 'b1' ? 'fill-amber' : 'fill-text-3'} />
                <text x={cx(i)} y={y(k)} className="fill-ink" fontSize="10" fontWeight="600" textAnchor="middle" dominantBaseline="central">
                  {r.id.slice(1)}
                </text>
              </g>
            ))}
            {b.mine && (
              <g>
                <rect x={cx(i) - (CELL / 2 - 2)} y={y(b.rows.length) - (CELL / 2 - 2)} width={CELL - 4} height={CELL - 4} rx="3" className="fill-accent" />
                <text x={cx(i)} y={y(b.rows.length)} className="fill-accent-foreground" fontSize="9" fontWeight="700" textAnchor="middle" dominantBaseline="central">
                  you
                </text>
              </g>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 font-mono text-[11px] text-text-3">
        goodput, percent of 240 requests within the TTFT SLO · circles are policies (numbers as in the table, amber is the reference) · the square is you
      </figcaption>
    </figure>
  )
}

/* ------------------------- the real-engine panel link ------------------------- */

/**
 * Opens the Fleet's real-engine panel with this scheduler in the engine: it installs the module (the same checks as
 * "install in your engine", which this run already passed), then goes to /fleet?mode=real.
 */
function RealEngineLink({ lab, report, bytes }: Pick<RaceReferenceProps, 'lab' | 'report' | 'bytes'>) {
  const install = useSlots((s) => s.install)
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const onOpen = () => {
    setBusy(true)
    setError('')
    install({ slot: 'scheduler', report, bytes, required: requiredChecksOf(lab.id) }).then(
      (out) => {
        setBusy(false)
        if (out.ok) void navigate('/fleet?mode=real')
        else setError(out.message)
      },
      (e: unknown) => {
        setBusy(false)
        setError(`could not save this module on this device: ${e instanceof Error ? e.message : String(e)}`)
      },
    )
  }
  return (
    <div className="mt-4 border-t border-line pt-3" data-testid="real-engine-link">
      <p className="text-body-sm text-text-2">
        The Fleet&apos;s real-engine panel lets your scheduler arbitrate one generation slot of a real model (Qwen3-0.6B) running in this tab, with TTFT and
        inter-token latency measured in wall-clock milliseconds.
      </p>
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-line-bright bg-surface-2 px-3.5 py-2 font-mono text-[12px] text-text-1 transition-colors hover:border-accent/60 disabled:opacity-50"
      >
        <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
        {busy ? 'installing…' : 'install it and open the real-engine panel'}
      </button>
      <p role="status" className="mt-2 text-body-sm text-danger empty:mt-0">
        {error}
      </p>
    </div>
  )
}
