import { useCallback, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenCheck,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileCode,
  Terminal,
  Upload,
  X,
} from 'lucide-react'
import { FORGE_LABS } from '@/data/labs'
import { lessonById } from '@/data/lessons'
import { getTrack } from '@/lib/tracks'
import { useProgress, XP } from '@/lib/progress'
import { LabAbiError, LabTrapError, runLabWasm, type LabReport } from '@/lib/wasm-lab'
import { cn } from '@/lib/utils'

type RunState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'report'; report: LabReport }
  | { kind: 'error'; title: string; detail: string }

const LANES = [
  {
    id: 'a',
    title: 'lane A — your machine',
    body: 'Two commands if you have Rust; one installer if you don\u2019t.',
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

export default function ForgeLab() {
  const { labId } = useParams()
  const lab = FORGE_LABS.find((l) => l.id === labId)
  const labState = useProgress((s) => (lab ? s.labs[lab.id] : undefined))
  const labDone = labState?.done ?? false
  const recordLabResult = useProgress((s) => s.recordLabResult)
  const unlockAchievement = useProgress((s) => s.unlockAchievement)

  const [run, setRun] = useState<RunState>({ kind: 'idle' })
  const [dragOver, setDragOver] = useState(false)
  const [setupCopied, setSetupCopied] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const onFile = useCallback(
    async (file: File) => {
      if (!lab) return
      setRun({ kind: 'running' })
      try {
        const report = await runLabWasm(await file.arrayBuffer())
        if (report.lab !== lab.id) {
          setRun({
            kind: 'error',
            title: 'wrong lab module',
            detail: `this module is for "${report.lab}", but this page grades "${lab.id}". Drop the right .wasm.`,
          })
          return
        }
        setRun({ kind: 'report', report })
        const requiredIds = new Set(
          lab.checks.filter((check) => !check.optional).map((check) => check.id),
        )
        const passedIds = report.checks
          .filter((check) => check.pass && requiredIds.has(check.id))
          .map((check) => check.id)
        recordLabResult(lab.id, passedIds, requiredIds.size)
        const nowDone = useProgress.getState().labs[lab.id]?.done
        if (nowDone && !labDone) {
          unlockAchievement('forge-first')
          setToast(`+${XP.lab} XP — lab complete`)
          window.setTimeout(() => setToast(null), 3500)
        }
      } catch (e) {
        if (e instanceof LabTrapError) {
          setRun({ kind: 'error', title: 'not implemented yet', detail: e.message })
        } else if (e instanceof LabAbiError) {
          setRun({ kind: 'error', title: 'not a lab module', detail: e.message })
        } else {
          setRun({ kind: 'error', title: 'unexpected error', detail: String(e) })
        }
      }
    },
    [lab, labDone, recordLabResult, unlockAchievement],
  )

  if (!lab) {
    return (
      <div className="mx-auto max-w-app px-6 pt-24 lg:px-12">
        <p className="text-text-2">
          unknown lab. <Link to="/forge" className="text-accent underline">back to the forge</Link>
        </p>
      </div>
    )
  }

  const track = getTrack(lab.trackId)
  const lesson = lessonById(lab.lessonId)
  const readinessLessons =
    lab.readiness?.lessonIds.map((id) => lessonById(id)).filter((item) => item !== undefined) ?? []
  const done = labState?.done ?? false
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
  const requiredReportChecks = report?.checks.filter((check) =>
    requiredChecks.some((expected) => expected.id === check.id),
  )
  const requiredReportPassed =
    requiredReportChecks?.length === requiredChecks.length &&
    requiredReportChecks.every((check) => check.pass)

  return (
    <div className="mx-auto max-w-app px-6 pb-24 pt-16 lg:px-12">
      <Link
        to="/forge"
        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 transition-colors hover:text-text-1"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> the forge
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
          <span className="text-accent">+{XP.lab} XP</span>
          {done && (
            <span className="mt-1 inline-flex items-center gap-1 rounded border border-accent/60 bg-accent/10 px-2 py-0.5 text-accent">
              <Check className="h-3 w-3" /> complete
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
      <section className="mt-8 max-w-3xl overflow-hidden rounded-lg border border-line bg-surface-1">
        <div className="border-b border-line px-5 py-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
            start here · the contract before the compiler
          </p>
          <p className="mt-1 text-body-sm text-text-2">
            A remaining <span className="font-mono text-[12px] text-text-1">todo!()</span> is
            expected to panic. It is a placeholder, not a useful compiler diagnostic.
          </p>
        </div>
        <div className="grid md:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b border-line p-5 md:border-b-0 md:border-r">
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
              <BookOpenCheck className="h-3.5 w-3.5" /> before editing
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
              <Check className="h-3.5 w-3.5" /> what green means
            </p>
            <ol className="mt-3 space-y-2.5">
              {lab.checks.map((check, index) => (
                <li key={check.id} className="flex items-start gap-2.5 text-body-sm text-text-2">
                  <span className="mt-0.5 font-mono text-[10px] text-text-3">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <span className="text-text-1">{check.label}</span>
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
                  className="inline-flex items-center gap-1 text-body-sm text-accent underline"
                >
                  {reference.label} <ChevronRight className="h-3 w-3" />
                </a>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* get the lab */}
      <section className="mt-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
          1 · get the lab
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {LANES.map((lane) => (
            <div key={lane.id} className="rounded-lg border border-line bg-surface-1 p-5">
              <p className="font-mono text-sm text-text-1">{lane.title}</p>
              <p className="mt-2 text-body-sm text-text-2">{lane.body}</p>
              {lane.code && (
                <pre className="mt-3 overflow-x-auto rounded border border-line bg-ink p-3 font-mono text-[12px] text-text-1">
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
              className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-text-3 transition-colors hover:text-text-1"
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
          <pre className="overflow-x-auto bg-ink p-4 font-mono text-[12px] leading-relaxed text-text-1">
            {setupCommand}
          </pre>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <p className="text-body-sm text-text-3">
              Creates a fresh folder and enters the exercise crate. It stops if that folder already exists.
            </p>
            <a
              href={lab.zip}
              download
              className="inline-flex shrink-0 items-center gap-2 font-mono text-[11px] text-accent underline"
            >
              <Download className="h-3.5 w-3.5" /> download ZIP instead
            </a>
          </div>
        </div>
      </section>

      {/* make it green */}
      <section className="mt-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
          2 · make it green
        </p>
        <div className="mt-4 rounded-lg border border-line bg-surface-1 p-5">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
            <Terminal className="h-3.5 w-3.5" /> in the crate
          </div>
          <pre className="mt-3 overflow-x-auto rounded border border-line bg-ink p-4 font-mono text-[12px] leading-relaxed text-text-1">
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

      {/* drop the wasm */}
      <section className="mt-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
          3 · drop the wasm
        </p>
        <div
          role="button"
          tabIndex={0}
          aria-label="drop your compiled .wasm here"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
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
          <input
            ref={inputRef}
            type="file"
            accept=".wasm,application/wasm"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
              e.target.value = ''
            }}
          />
        </div>

        {/* error states */}
        <AnimatePresence>
          {run.kind === 'error' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-4 flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 p-5"
            >
              {run.title === 'not implemented yet' ? (
                <FileCode className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              )}
              <div>
                <p className="font-mono text-sm text-text-1">{run.title}</p>
                <p className="mt-1 text-body-sm text-text-2">{run.detail}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* results */}
        {report && (
          <div className="mt-4 rounded-lg border border-line bg-surface-1 p-5">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
                report · {report.lab} v{report.version}
              </p>
              <p
                className={cn(
                  'font-mono text-[11px]',
                  requiredReportPassed ? 'text-accent' : 'text-amber',
                )}
              >
                {requiredReportChecks?.filter((check) => check.pass).length ?? 0}/
                {requiredChecks.length} required
                {optionalChecks.length > 0 &&
                  ` · ${report.checks.filter((check) => check.pass && optionalChecks.some((expected) => expected.id === check.id)).length}/${optionalChecks.length} advanced`}
              </p>
            </div>
            <div className="mt-3 space-y-1.5">
              {report.checks.map((c, i) => {
                const optional = lab.checks.find((check) => check.id === c.id)?.optional ?? false
                return (
                  <motion.p
                    key={c.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={cn(
                      'flex items-start gap-2 font-mono text-[12px]',
                      c.pass ? 'text-text-2' : optional ? 'text-amber' : 'text-danger',
                    )}
                  >
                    {c.pass ? (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    ) : (
                      <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>
                      <span className="text-text-3">{c.id}</span>
                      {optional && (
                        <span className="ml-1 rounded border border-amber/40 px-1 py-0.5 text-[9px] uppercase text-amber">
                          advanced
                        </span>
                      )}{' '}
                      — {c.msg}
                    </span>
                  </motion.p>
                )
              })}
            </div>
            {requiredReportPassed && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mt-4 rounded-md border border-accent/50 bg-accent/10 p-4"
              >
                <p className="font-mono text-sm text-accent">
                  {lab.completion.title}
                </p>
                <p className="mt-1 text-body-sm text-text-2">
                  {lab.completion.next}{' '}
                  <Link to={`/lesson/${lab.lessonId}`} className="text-accent underline">
                    revisit {lab.lessonId}
                  </Link>{' '}
                  <ChevronRight className="inline h-3.5 w-3.5" />
                </p>
                {lab.profile && (
                  <div className="mt-4 border-t border-accent/20 pt-4">
                    <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-1">
                      <Terminal className="h-3.5 w-3.5 text-accent" /> profile this · measurement pass
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded border border-line bg-ink px-3 py-2 font-mono text-[11px] text-text-1">
                      {lab.profile.command}
                    </pre>
                    <p className="mt-2 text-body-sm text-text-2">{lab.profile.question}</p>
                    <Link
                      to="/lesson/t0.l6"
                      className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] text-accent underline"
                    >
                      read the flame-graph workflow <ChevronRight className="h-3 w-3" />
                    </Link>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        )}
      </section>

      {/* toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
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
