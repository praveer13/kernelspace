import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenCheck,
  Check,
  ChevronRight,
  Circle,
  Copy,
  Download,
  FileCode,
  Loader2,
  Terminal,
  Upload,
  X,
} from 'lucide-react'
import Discussion from '@/components/community/Discussion'
import { FORGE_LABS, type ForgeLab as ForgeLabDef } from '@/data/labs'
import { lessonById } from '@/data/lessons'
import { getTrack } from '@/lib/tracks'
import { labXp } from '@/lib/economy'
import { useProgress } from '@/lib/progress'
import { LabAbiError, LabTimeoutError, LabTrapError } from '@/lib/wasm-lab'
import { runLab } from '@/lib/lab-worker'
import { creditFor, toLabRun, type Credit } from '@/lib/forge/run'
import type { CheckResult, LabRunReport } from '@/lib/forge/types'
import {
  STATE_WORD,
  buildRows,
  creditNote,
  creditedRequiredPass,
  hasDetail,
  requiredFailedCount,
  resultsOf,
  tally,
  unseenCount,
  type CreditNote,
  type Row,
} from '@/lib/forge/present'
import { sha256Hex } from '@/lib/ledger/stable'
import { cn } from '@/lib/utils'

/*
 * Motion: App.tsx loads this page through `lazyMotion`, so every animation below runs inside MotionScope
 * (reduced motion honoured, wave-1.md §16.2); the page does not wrap itself a second time.
 *
 * Lab 01 (the allocator) has the PRIMM walk, the hint ladder and Prove it. They load on demand, so the other
 * 17 labs do not carry them, and the walk's fallback is the same get-the-lab and drop-zone content, so a slow or
 * failed chunk never takes the drop zone away.
 */
const PrimmPanel = lazy(() => import('@/components/forge/PrimmPanel').then((m) => ({ default: m.PrimmPanel })))
const HintLadder = lazy(() => import('@/components/forge/HintLadder'))
const ProveIt = lazy(() => import('@/components/forge/ProveIt'))

/** The one lab with the walk, the ladder and Prove it so far (§13). */
const LAB01 = 'rust-allocator'

type RunState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'report'; report: LabRunReport; credit: Credit; note: CreditNote }
  | { kind: 'error'; title: string; detail: string }

/** Checks as they finish while a run is in flight (v2 modules post each one). */
interface Live {
  results: ReadonlyMap<string, CheckResult>
  running: string | null
}
const NO_LIVE: Live = { results: new Map(), running: null }

const LANES = [
  {
    id: 'a',
    title: 'lane A — your machine',
    body: 'Two commands if you have Rust; one installer if you don’t.',
    code: 'rustup target add wasm32-unknown-unknown',
  },
  {
    id: 'b',
    title: 'lane B — dev container',
    body: 'Open the unzipped folder in VS Code → "Reopen in Container". Toolchain and wasm target preinstalled.',
  },
  {
    id: 'c',
    title: 'lane C — codespaces',
    body: 'Open the kernelspace repo in a Codespace. Same environment, burns your free GitHub quota.',
  },
]

const sectionLabel = 'font-mono text-[11px] uppercase tracking-[0.14em] text-text-3'

export default function ForgeLab() {
  const { labId } = useParams()
  const lab = FORGE_LABS.find((l) => l.id === labId)
  if (!lab) {
    return (
      <div className="mx-auto max-w-app px-6 pt-24 lg:px-12">
        <p className="text-text-2">
          unknown lab. <Link to="/forge" className="text-accent underline">back to the forge</Link>
        </p>
      </div>
    )
  }
  // Keyed by lab: moving from one lab to the next must not carry a run, its hints or its credit across.
  return <LabPage key={lab.id} lab={lab} />
}

function LabPage({ lab }: { lab: ForgeLabDef }) {
  const labState = useProgress((s) => s.labs[lab.id])
  const unseenChecks = useProgress((s) => s.aggregate.labs[lab.id]?.unseen)
  const recordLabRun = useProgress((s) => s.recordLabRun)
  const unlockAchievement = useProgress((s) => s.unlockAchievement)

  const [run, setRun] = useState<RunState>({ kind: 'idle' })
  const [live, setLive] = useState<Live>(NO_LIVE)
  // Every graded run of this visit, oldest first: the hint ladder reads the reds, the stage panel the greens.
  const [reports, setReports] = useState<LabRunReport[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [setupCopied, setSetupCopied] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLHeadingElement>(null)
  const busy = useRef(false)
  const focusResults = useRef(false)

  const requiredIds = lab.checks.filter((check) => !check.optional).map((check) => check.id)
  const xp = labXp(lab.id)

  const onFile = useCallback(
    async (file: File) => {
      if (busy.current) return
      busy.current = true
      setLive(NO_LIVE)
      setRun({ kind: 'running' })
      try {
        const bytes = await file.arrayBuffer()
        // Seeds are drawn here, per seeded check, so a green on them is unseen (§12.4). A v1 module ignores them.
        const report = await runLab(bytes, {
          seeds: 'fresh',
          expected: { lab: lab.id, checks: lab.checks },
          onProgress: (e) => {
            if (e.type === 'check-start') setLive((l) => ({ ...l, running: e.id }))
            else if (e.type === 'check-done') setLive((l) => ({ results: new Map(l.results).set(e.result.id, e.result), running: null }))
          },
        })
        if (report.lab !== lab.id) {
          setRun({
            kind: 'error',
            title: 'wrong lab module',
            detail: `this module is for "${report.lab}", but this page grades "${lab.id}". Drop the right .wasm.`,
          })
          return
        }
        const required = lab.checks.filter((check) => !check.optional).map((check) => check.id)
        const earlier = useProgress.getState().aggregate.labs[lab.id]
        const credit = creditFor(report, { unseen: earlier?.unseen, assistedUntil: earlier?.assistedUntil }, required)
        const note = creditNote(credit, report, {
          required: required.length,
          unseenSoFar: unseenCount(report, required, earlier?.unseen),
          requiredFailed: requiredFailedCount(report, required),
        })
        focusResults.current = true
        setReports((prev) => [...prev, report])
        setRun({ kind: 'report', report, credit, note })
        // A reference build is shown and never written (§12.3). Anything else is one `lab-check` event whose
        // provenance is what creditFor said; the ledger records which module earned it. crypto.subtle is absent on insecure origins.
        if (credit !== null) {
          const wasDone = useProgress.getState().labs[lab.id]?.done ?? false
          const wasmSha256 = await sha256Hex(bytes).catch(() => undefined)
          recordLabRun(toLabRun(report, credit, required, wasmSha256 ? { wasmSha256 } : {}))
          if (useProgress.getState().labs[lab.id]?.done && !wasDone) {
            unlockAchievement('forge-first')
            setToast(`+${labXp(lab.id)} XP — lab complete`)
            window.setTimeout(() => setToast(null), 3500)
          }
        }
      } catch (e) {
        if (e instanceof LabTrapError) {
          setRun({ kind: 'error', title: 'not implemented yet', detail: e.message })
        } else if (e instanceof LabTimeoutError) {
          setRun({ kind: 'error', title: e.title, detail: e.message })
        } else if (e instanceof LabAbiError) {
          setRun({ kind: 'error', title: 'not a lab module', detail: e.message })
        } else {
          setRun({ kind: 'error', title: 'unexpected error', detail: String(e) })
        }
      } finally {
        busy.current = false
      }
    },
    [lab, recordLabRun, unlockAchievement],
  )

  // A finished run takes focus once, because the control that started it (the drop zone's file picker) is behind it
  // now. Not from under a learner who is typing somewhere else (a hint's teach-back, say).
  const finished = run.kind === 'report' || run.kind === 'error'
  useEffect(() => {
    if (!finished || !focusResults.current) return
    focusResults.current = false
    const at = document.activeElement
    const typing = at instanceof HTMLElement && at.matches('textarea, select, input:not([type=file]), [contenteditable]')
    if (!typing) resultsRef.current?.focus({ preventScroll: false })
  }, [finished, run])

  const track = getTrack(lab.trackId)
  const lesson = lessonById(lab.lessonId)
  const readinessLessons =
    lab.readiness?.lessonIds.map((id) => lessonById(id)).filter((item) => item !== undefined) ?? []
  const done = labState?.done ?? false
  const allUnseen = requiredIds.length > 0 && requiredIds.every((id) => unseenChecks?.[id] === true)
  const report = run.kind === 'report' ? run.report : null
  const requiredChecks = lab.checks.filter((check) => !check.optional)
  const optionalChecks = lab.checks.filter((check) => check.optional)
  const archiveName = lab.zip.split('/').pop() ?? `${lab.id}.zip`
  const downloadUrl = new URL(lab.zip, window.location.origin).href
  const workspaceDir = lab.id
  const setupCommand =
    `test ! -e ${workspaceDir} && ` +
    `curl -fsSL ${downloadUrl} -o ${archiveName} && ` +
    `mkdir ${workspaceDir} && ` +
    `unzip -q ${archiveName} -d ${workspaceDir} && ` +
    `cd ${workspaceDir}/${lab.crateDir ?? lab.id}`

  const rows = buildRows(lab.checks, report ? resultsOf(report) : live.results, run.kind === 'running' ? live.running : null)
  const counts = tally(rows)
  const allRequiredGreen = counts.requiredTotal > 0 && counts.required === counts.requiredTotal
  // A reference build (credit null) can be all green and still earns nothing: it never opens Prove it or the completion panel.
  const requiredReportPassed = run.kind === 'report' && creditedRequiredPass(run.credit, counts)

  // What the latest graded (non-reference) run passed, for the stage panel; every run's, for attempts-to-green.
  const graded = reports.filter((r) => !r.reference)
  const latest = graded[graded.length - 1]
  const passedNow = new Set(latest === undefined ? [] : latest.checks.filter((c) => c.status === 'pass').map((c) => c.id))
  const runsPassed = graded.map((r) => r.checks.filter((c) => c.status === 'pass').map((c) => c.id))
  const isLab01 = lab.id === LAB01

  const getTheLab = (
    <section className="mt-12" aria-labelledby="get-lab">
      <h2 id="get-lab" className={sectionLabel}>
        1 · get the lab
      </h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {LANES.map((lane) => (
          <div key={lane.id} className="min-w-0 rounded-lg border border-line bg-surface-1 p-5">
            <p className="font-mono text-sm text-text-1">{lane.title}</p>
            <p className="mt-2 text-body-sm text-text-2">{lane.body}</p>
            {lane.code && (
              <pre tabIndex={0} className="mt-3 overflow-x-auto rounded border border-line bg-ink p-3 font-mono text-[12px] text-text-1">
                {lane.code}
              </pre>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-1">
              one-command workspace
            </p>
            <p className="mt-0.5 text-body-sm text-text-3">
              macOS, Linux, or WSL · requires curl and unzip
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(setupCommand).catch(() => undefined)
              setSetupCopied(true)
              window.setTimeout(() => setSetupCopied(false), 1200)
            }}
            className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-text-3 transition-colors hover:text-text-1 [@media(pointer:coarse)]:min-h-11"
            aria-label="Copy workspace setup command"
          >
            {setupCopied ? (
              <Check className="h-3.5 w-3.5 text-accent" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {setupCopied ? 'copied' : 'copy'}
          </button>
        </div>
        <pre tabIndex={0} className="overflow-x-auto bg-ink p-4 font-mono text-[12px] leading-relaxed text-text-1">
          {setupCommand}
        </pre>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="text-body-sm text-text-3">
            Creates a fresh folder and enters the exercise crate. It stops if that folder already exists.
          </p>
          <a
            href={lab.zip}
            download
            className="inline-flex shrink-0 items-center gap-2 font-mono text-[11px] text-accent underline [@media(pointer:coarse)]:min-h-11"
          >
            <Download className="h-3.5 w-3.5" /> download ZIP instead
          </a>
        </div>
      </div>
    </section>
  )

  const makeGreen = (
    <section className="mt-12" aria-labelledby="make-green">
      <h2 id="make-green" className={sectionLabel}>
        2 · make it green
      </h2>
      <div className="mt-4 rounded-lg border border-line bg-surface-1 p-5">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
          <Terminal className="h-3.5 w-3.5" /> in the crate
        </div>
        <pre tabIndex={0} className="mt-3 overflow-x-auto rounded border border-line bg-ink p-4 font-mono text-[12px] leading-relaxed text-text-1">
{`cd ${lab.crateDir ?? lab.id}
$EDITOR ${lab.editFile}${' '.repeat(Math.max(1, 20 - lab.editFile.length))}# the only file with TODO(you)
cargo test                    # ${requiredChecks.length} required${optionalChecks.length > 0 ? ` + ${optionalChecks.length} advanced` : ''}
cargo build --release --target wasm32-unknown-unknown`}
        </pre>
        <p className="mt-3 text-body-sm text-text-2">
          the artifact to drop below:{' '}
          <span className="font-mono text-[12px] text-text-1">{lab.artifact}</span>
        </p>
      </div>
    </section>
  )

  const dropZone = (
    <section className="mt-12" aria-labelledby="drop-wasm">
      <h2 id="drop-wasm" className={sectionLabel}>
        3 · drop the wasm
      </h2>
      <div
        role="button"
        tabIndex={0}
        aria-label="drop your compiled .wasm here"
        aria-busy={run.kind === 'running'}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void onFile(f)
        }}
        className={cn(
          'mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors duration-150',
          dragOver
            ? 'border-accent bg-accent/5'
            : 'border-line bg-surface-1 hover:border-text-3',
        )}
      >
        <Upload className={cn('h-6 w-6', dragOver ? 'text-accent' : 'text-text-3')} />
        <p className="text-body-sm text-text-2">
          {run.kind === 'running'
            ? 'running your checks…'
            : `drop ${lab.artifact.split('/').pop()} here, or click to browse`}
        </p>
        <p className="font-mono text-[11px] text-text-3">
          runs in a sandbox in this tab · nothing is uploaded
        </p>
        <p className="max-w-md font-mono text-[11px] text-text-3">
          each check gets its own fresh instance and 2 s · seeded checks run on seeds drawn when you drop the file
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".wasm,application/wasm"
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ''
          }}
        />
      </div>
    </section>
  )

  const results = (
    <>
      {/* always mounted, so the verdict is written into a live region that already exists */}
      <div role="status" className="sr-only" data-run-status>
        {run.kind === 'report'
          ? `${counts.required} of ${counts.requiredTotal} required checks passed. ${run.note.label}.`
          : run.kind === 'error'
            ? `${run.title}. ${run.detail}`
            : ''}
      </div>
      {run.kind !== 'idle' && (
        <section aria-labelledby="lab-report" data-results data-run={run.kind} className="mt-12">
          <h2
            id="lab-report"
            ref={resultsRef}
            tabIndex={-1}
            className={cn(sectionLabel, 'mb-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent')}
          >
            4 · results
          </h2>

          {/* error states */}
          <AnimatePresence>
            {run.kind === 'error' && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 p-5"
              >
                {run.title === 'not implemented yet' ? (
                  <FileCode className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="font-mono text-sm text-text-1">{run.title}</p>
                  <p className="mt-1 break-words text-body-sm text-text-2">{run.detail}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* per-check results, live while the run is in flight */}
          {(run.kind === 'running' || report) && (
            <div className="rounded-lg border border-line bg-surface-1 p-5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
                  {report ? (
                    <>
                      report · {report.lab} v{report.version} · abi {report.abi}
                      {report.abi === 2 && report.seeds === 'fresh' ? ' · fresh seeds' : ''}
                    </>
                  ) : (
                    'running · one fresh instance per check'
                  )}
                </p>
                <p className={cn('font-mono text-[11px]', report !== null && allRequiredGreen ? 'text-accent' : 'text-amber')}>
                  {counts.required}/{counts.requiredTotal} required
                  {counts.advancedTotal > 0 && ` · ${counts.advanced}/${counts.advancedTotal} advanced`}
                </p>
              </div>

              {run.kind === 'report' && <CreditLine note={run.note} />}

              <ol className="mt-3 space-y-2" aria-label="Checks">
                {rows.map((row, i) => (
                  <CheckRow key={row.id} row={row} index={i} />
                ))}
              </ol>

              {run.kind === 'report' && requiredReportPassed && run.credit !== null && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="mt-4 rounded-md border border-accent/50 bg-accent/10 p-4"
                >
                  <p className="font-mono text-sm text-accent">{lab.completion.title}</p>
                  <p className="mt-1 text-body-sm text-text-2">
                    {lab.completion.next}{' '}
                    <Link to={`/lesson/${lab.lessonId}`} className="text-accent underline">
                      revisit {lab.lessonId}
                    </Link>{' '}
                    <ChevronRight className="inline h-3.5 w-3.5" aria-hidden />
                  </p>
                  {lab.profile && (
                    <div className="mt-4 border-t border-accent/20 pt-4">
                      <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-1">
                        <Terminal className="h-3.5 w-3.5 text-accent" aria-hidden /> profile this · measurement pass
                      </p>
                      <pre tabIndex={0} className="mt-2 overflow-x-auto rounded border border-line bg-ink px-3 py-2 font-mono text-[11px] text-text-1">
                        {lab.profile.command}
                      </pre>
                      <p className="mt-2 text-body-sm text-text-2">{lab.profile.question}</p>
                      <Link
                        to="/lesson/t0.l6"
                        className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-accent underline [@media(pointer:coarse)]:min-h-11"
                      >
                        read the flame-graph workflow <ChevronRight className="h-3 w-3" aria-hidden />
                      </Link>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          )}
        </section>
      )}
    </>
  )

  // The walk's Make step holds everything the learner does with the file; the walk's loading fallback is the same content.
  const doing = (
    <>
      {getTheLab}
      {makeGreen}
      {dropZone}
    </>
  )

  return (
    <div className="mx-auto max-w-app px-6 pb-24 pt-16 lg:px-12">
      <Link
        to="/forge"
        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 transition-colors hover:text-text-1 [@media(pointer:coarse)]:min-h-11"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> the forge
      </Link>

      {/* header */}
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
            {lab.trackId === 'r'
              ? `drill R${lab.index}`
              : `lab ${String(lab.index).padStart(2, '0')}`}{' '}
            · {track?.code ?? lab.trackId}
            {lesson && (
              <>
                {' '}
                · deepens{' '}
                <Link to={`/lesson/${lesson.id}`} className="underline hover:text-text-1">
                  {lesson.id}
                </Link>
              </>
            )}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-text-1 sm:text-4xl">
            {lab.title}
          </h1>
          <p className="mt-3 text-body-lg text-text-2">{lab.hook}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 font-mono text-[11px] text-text-3">
          <span>~{lab.minutes} min</span>
          <span>
            {requiredChecks.length} checks
            {optionalChecks.length > 0 ? ` + ${optionalChecks.length} advanced` : ''}
          </span>
          <span className="text-accent">+{xp} XP</span>
          {done && (
            <span className="mt-1 inline-flex items-center gap-1 rounded border border-accent/60 bg-accent/10 px-2 py-0.5 text-accent">
              <Check className="h-3 w-3" aria-hidden /> complete
            </span>
          )}
          {allUnseen && (
            <span className="inline-flex items-center gap-1 rounded border border-accent/40 px-2 py-0.5 text-accent">
              <Check className="h-3 w-3" aria-hidden /> unseen pass
            </span>
          )}
        </div>
      </div>

      {lab.readiness && (
        <div
          className={cn(
            'mt-8 flex max-w-3xl items-start gap-3 rounded-lg border p-4',
            lab.readiness.required
              ? 'border-amber/50 bg-amber/10'
              : 'border-line bg-surface-1',
          )}
        >
          <BookOpenCheck
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0',
              lab.readiness.required ? 'text-amber' : 'text-accent',
            )}
            aria-hidden
          />
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
              {lab.readiness.label}
            </p>
            <p className="mt-1 text-body-sm text-text-2">
              Complete{' '}
              {readinessLessons.map((item, index) => (
                <span key={item.id}>
                  {index > 0 && (index === readinessLessons.length - 1 ? ' and ' : ', ')}
                  <Link to={`/lesson/${item.id}`} className="text-accent underline">
                    {item.id.replace('.l', '').toUpperCase()} · {item.title}
                  </Link>
                </span>
              ))}
              {lab.readiness.required
                ? ' before starting this lab.'
                : ' first if any of the Rust vocabulary in the brief is unfamiliar.'}
            </p>
          </div>
        </div>
      )}

      {/* brief */}
      <div className="mt-10 max-w-3xl space-y-4">
        {lab.brief.map((p, i) => (
          <p key={i} className="text-body text-text-2">
            {p}
          </p>
        ))}
      </div>

      {/* start here */}
      <section className="mt-8 max-w-3xl overflow-hidden rounded-lg border border-line bg-surface-1" aria-labelledby="start-here">
        <div className="border-b border-line px-5 py-4">
          <h2 id="start-here" className="font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-accent">
            start here · the contract before the compiler
          </h2>
          <p className="mt-1 text-body-sm text-text-2">
            A remaining <span className="font-mono text-[12px] text-text-1">todo!()</span> is
            expected to panic. It is a placeholder, not a useful compiler diagnostic.
          </p>
        </div>
        <div className="grid md:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b border-line p-5 md:border-b-0 md:border-r">
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
              <BookOpenCheck className="h-3.5 w-3.5" aria-hidden /> before editing
            </p>
            <ol className="mt-3 space-y-3 text-body-sm text-text-2">
              {lesson && (
                <li>
                  <span className="mr-2 font-mono text-accent">1.</span>
                  Read{' '}
                  <Link to={`/lesson/${lesson.id}`} className="text-accent underline">
                    {lesson.id.toUpperCase()} · {lesson.title}
                  </Link>
                  .{' '}
                  {lab.trackId === 'r'
                    ? 'Its examples are the first syntax reference for this exercise.'
                    : 'It explains the system this lab asks you to implement.'}
                </li>
              )}
              <li>
                <span className="mr-2 font-mono text-accent">{lesson ? '2.' : '1.'}</span>
                Open <span className="font-mono text-[12px] text-text-1">src/lib.rs</span> and
                read the check inputs and expected outputs. That file is the read-only spec.
              </li>
              <li>
                <span className="mr-2 font-mono text-accent">{lesson ? '3.' : '2.'}</span>
                Edit only{' '}
                <span className="font-mono text-[12px] text-text-1">{lab.editFile}</span>, one
                function at a time, without changing its signature.
              </li>
            </ol>
            {lab.trackId === 'r' && requiredChecks[0] && (
              <div className="mt-4 rounded border border-line bg-ink p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-3">
                  run only the first check
                </p>
                <code className="mt-1 block overflow-x-auto font-mono text-[12px] text-text-1">
                  cargo test {requiredChecks[0].id}
                </code>
              </div>
            )}
          </div>
          <div className="p-5">
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
              <Check className="h-3.5 w-3.5" aria-hidden /> what green means
            </p>
            <ol className="mt-3 space-y-2.5">
              {lab.checks.map((check, index) => (
                <li key={check.id} className="flex items-start gap-2.5 text-body-sm text-text-2">
                  <span className="mt-0.5 font-mono text-[10px] text-text-3">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <span className="text-text-1">{check.label}</span>
                    {check.stage !== undefined && lab.trackId !== 'r' && (
                      <span className="ml-1.5 rounded border border-line px-1 py-0.5 font-mono text-[9px] uppercase text-text-3">
                        stage {check.stage}
                      </span>
                    )}
                    {check.optional && (
                      <span className="ml-1.5 rounded border border-amber/40 px-1 py-0.5 font-mono text-[9px] uppercase text-amber">
                        advanced
                      </span>
                    )}
                    {check.expectation && (
                      <span className="block text-text-3">{check.expectation}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        {lab.syntaxReferences && lab.syntaxReferences.length > 0 && (
          <div className="border-t border-line px-5 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
              syntax references · use these when a method name is unfamiliar
            </p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
              {lab.syntaxReferences.map((reference) => (
                <a
                  key={reference.href}
                  href={reference.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-body-sm text-accent underline [@media(pointer:coarse)]:min-h-11"
                >
                  {reference.label} <ChevronRight className="h-3 w-3" aria-hidden />
                </a>
              ))}
            </div>
          </div>
        )}
      </section>

      {isLab01 ? (
        <>
          {/* the walk: predict, run, investigate, modify, make. Make holds the stage list and the drop zone */}
          <section className="mt-12" aria-labelledby="the-walk">
            <h2 id="the-walk" className={sectionLabel}>
              the walk · predict, run, investigate, modify, make
            </h2>
            <div className="mt-4">
              <Suspense fallback={doing}>
                <PrimmPanel
                  checks={lab.checks}
                  passed={passedNow}
                  runs={runsPassed}
                  initial={(labState?.checksDone.length ?? 0) > 0 ? 'make' : 'predict'}
                >
                  {doing}
                </PrimmPanel>
              </Suspense>
            </div>
          </section>
          {results}
          <div className="mt-10 max-w-3xl space-y-8">
            <Suspense fallback={null}>
              <HintLadder reports={reports} />
              <ProveIt unlocked={done || requiredReportPassed} />
            </Suspense>
          </div>
        </>
      ) : (
        <>
          {getTheLab}
          {makeGreen}
          {dropZone}
          {results}
        </>
      )}

      <Discussion kind="lab" id={lab.id} />

      {/* toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-accent/60 bg-ink px-4 py-2 font-mono text-sm text-accent shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** What the run earned, in words: its provenance and why, or that a reference build earns nothing. */
function CreditLine({ note }: { note: CreditNote }) {
  return (
    <div
      data-credit={note.label}
      className={cn(
        'mt-3 rounded-md border px-3 py-2',
        note.tone === 'full' ? 'border-accent/50 bg-accent/10' : note.tone === 'none' ? 'border-amber/50 bg-amber/10' : 'border-line bg-surface-2',
      )}
    >
      <p className={cn('font-mono text-[11px] uppercase tracking-[0.1em]', note.tone === 'full' ? 'text-accent' : note.tone === 'none' ? 'text-amber' : 'text-text-1')}>
        {note.label}
      </p>
      <p className="mt-1 text-body-sm text-text-2">{note.detail}</p>
    </div>
  )
}

const ROW_TEXT: Record<Row['state'], string> = {
  pending: 'text-text-3',
  running: 'text-text-2',
  pass: 'text-text-2',
  fail: 'text-danger',
  trap: 'text-danger',
  timeout: 'text-danger',
}

function StateIcon({ row }: { row: Row }) {
  if (row.state === 'pass') return <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
  if (row.state === 'running') return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-2 motion-safe:animate-spin" aria-hidden />
  if (row.state === 'pending') return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
  return <X className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', row.optional ? 'text-amber' : 'text-danger')} aria-hidden />
}

/** A scrollable block that a keyboard user can reach (it holds the panic text or the trace). */
function Scroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="mt-1.5 max-h-48 overflow-auto rounded border border-line bg-ink px-3 py-2">
      <pre tabIndex={0} className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text-1">{children}</pre>
    </div>
  )
}

/** One check: its verdict and message, then (for a trap, or a check that traced) the panic text and the trace. */
function CheckRow({ row, index }: { row: Row; index: number }) {
  const tone = row.optional && row.state !== 'pass' && row.state !== 'pending' && row.state !== 'running' ? 'text-amber' : ROW_TEXT[row.state]
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      data-check={row.id}
      data-state={row.state}
      className="min-w-0"
    >
      <div className={cn('flex items-start gap-2 font-mono text-[12px]', tone)}>
        <StateIcon row={row} />
        <div className="min-w-0 flex-1">
          <p className="break-words">
            <span className="text-text-3">{row.id}</span>
            {row.stage !== undefined && (
              <span className="ml-1.5 rounded border border-line px-1 py-0.5 text-[9px] uppercase text-text-3">stage {row.stage}</span>
            )}
            {row.optional && (
              <span className="ml-1.5 rounded border border-amber/40 px-1 py-0.5 text-[9px] uppercase text-amber">advanced</span>
            )}
            <span className="sr-only"> {STATE_WORD[row.state]}.</span>
            {row.msg !== undefined && <> — {row.msg}</>}
            {row.state === 'running' && <span className="text-text-3"> — running…</span>}
          </p>
          {row.seed !== undefined && (
            <p className="mt-0.5 text-[10px] text-text-3">
              seed {row.seed} · {row.fresh === true ? 'drawn when you dropped the file' : 'the crate’s own seed'}
              {row.ms !== undefined && ` · ${row.ms < 10 ? row.ms.toFixed(1) : Math.round(row.ms)} ms`}
            </p>
          )}
          {hasDetail(row) && (
            <details className="mt-1.5" data-detail>
              <summary className="inline-flex cursor-pointer items-center py-0.5 text-[11px] text-text-2 underline [@media(pointer:coarse)]:min-h-11">
                {row.panic !== undefined && row.trace !== undefined ? 'panic text and trace' : row.panic !== undefined ? 'panic text' : 'trace'}
                <span className="sr-only"> for {row.id}</span>
              </summary>
              {row.panic !== undefined && <Scroll label={`Panic text of ${row.id}`}>{row.panic}</Scroll>}
              {row.trace !== undefined && <Scroll label={`Trace of ${row.id}`}>{row.trace}</Scroll>}
            </details>
          )}
        </div>
      </div>
    </motion.li>
  )
}
