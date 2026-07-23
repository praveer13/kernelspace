/**
 * PlaygroundShell — the shared simulator chrome for /lab/:simId (playground.md §1–3).
 *
 * Contract (depended on by all nine simulators):
 *   default-exported <PlaygroundShell simId title subtitle? tasks?> {children} </PlaygroundShell>
 *   - renders SimHeader (back · SIM chip · title · concept tag · used-in · share · help)
 *   - transport-style instrument layout: children fill the stage zone, guided-tasks
 *     sidebar on the right wired to the progress store (+XP toast on completion)
 *   - URL-state note (configs live in ?cfg=) + visit tracking
 *   - ?embed=1 hides all chrome (header/tasks) — used by ExerciseShell in lessons
 *
 * Sims provide their own canvas/controls/transport/log inside `children`.
 * Named exports below are shared sim infrastructure (log console, transport bar,
 * task completion helper, config-URL codec) so every machine feels identical.
 */
/* eslint-disable react-refresh/only-export-components -- mixed helper/component
   exports are the intended shared-sim contract (see header). */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  HelpCircle,
  ListChecks,
  Pause,
  Play,
  RotateCcw,
  Share2,
  StepForward,
  Trash2,
} from 'lucide-react'
import { getProgress, useProgress } from '@/lib/progress'
import { lessonById } from '@/data/lessons'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'

/* ------------------------------------------------------------------ */
/* Contract types                                                      */
/* ------------------------------------------------------------------ */

export interface SimTask {
  id: string
  text: string
  xp: number
}

export interface PlaygroundShellProps {
  simId: string
  title: string
  subtitle?: string
  tasks?: SimTask[]
  /** Optional rich content for the `?` help modal (theory recap, how it works). */
  help?: ReactNode
  children: ReactNode
}

/** Chrome metadata for the nine known machines (number chip + track accent). */
const SIM_CHROME: Record<string, { num: string; color: string }> = {
  'sim-memory': { num: 'SIM-01', color: '#FBBF24' },
  'sim-allocator': { num: 'SIM-02', color: '#FBBF24' },
  'sim-vm': { num: 'SIM-03', color: '#22D3EE' },
  'sim-roofline': { num: 'SIM-04', color: '#A78BFA' },
  'sim-wgsl': { num: 'SIM-05', color: '#A78BFA' },
  'sim-quant': { num: 'SIM-06', color: '#A78BFA' },
  'sim-kv': { num: 'SIM-07', color: '#FB7185' },
  'sim-batching': { num: 'SIM-08', color: '#FB7185' },
  'sim-engine': { num: 'SIM-09', color: '#3EF2A4' },
}

/* ------------------------------------------------------------------ */
/* Context — sims read embed mode to trim their own chrome             */
/* ------------------------------------------------------------------ */

interface PlaygroundContextValue {
  simId: string
  embed: boolean
}

const PlaygroundContext = createContext<PlaygroundContextValue>({ simId: '', embed: false })

export function usePlaygroundContext(): PlaygroundContextValue {
  return useContext(PlaygroundContext)
}

/* ------------------------------------------------------------------ */
/* Task completion — sims call this when they auto-detect a task.      */
/* Idempotent; awards XP once and lets the shell toast via store diff. */
/* ------------------------------------------------------------------ */

export function completeSimTask(simId: string, taskId: string, xp = 60): void {
  const state = getProgress()
  if (state.sims[simId]?.tasksDone.includes(taskId)) return
  state.recordSimTask(simId, taskId)
  useProgress.setState((s) => ({ xp: s.xp + xp }))
}

/* ------------------------------------------------------------------ */
/* Reduced motion                                                      */
/* ------------------------------------------------------------------ */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/* ------------------------------------------------------------------ */
/* Config ↔ URL codec (playground.md §2: base64 JSON, versioned)       */
/* ------------------------------------------------------------------ */

export function encodeCfg(cfg: unknown): string {
  try {
    return btoa(JSON.stringify({ v: 1, cfg }))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
  } catch {
    return ''
  }
}

export function decodeCfg<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    const b64 = raw.replaceAll('-', '+').replaceAll('_', '/')
    const parsed = JSON.parse(atob(b64)) as { v: number; cfg: T }
    return parsed?.v === 1 ? parsed.cfg : null
  } catch {
    return null
  }
}

/** Serialize a sim's config object into ?cfg= (debounced, replace — keeps ?embed/?from). */
export function useWriteCfg(cfg: unknown): void {
  const [, setSearchParams] = useSearchParams()
  useEffect(() => {
    const id = window.setTimeout(() => {
      const encoded = encodeCfg(cfg)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (encoded) next.set('cfg', encoded)
          return next
        },
        { replace: true },
      )
    }, 250)
    return () => window.clearTimeout(id)
  }, [cfg, setSearchParams])
}

/** Read the cfg param once (lazy useState initializer — safe on remount). */
export function useInitialCfg<T>(): T | null {
  const [searchParams] = useSearchParams()
  const [value] = useState<T | null>(() => decodeCfg<T>(searchParams.get('cfg')))
  return value
}

/* ------------------------------------------------------------------ */
/* The shell                                                           */
/* ------------------------------------------------------------------ */

export default function PlaygroundShell({
  simId,
  title,
  subtitle,
  tasks = [],
  help,
  children,
}: PlaygroundShellProps) {
  const [searchParams] = useSearchParams()
  const embed = searchParams.get('embed') === '1'
  const from = searchParams.get('from')
  /* ?from carries the originating lesson id (e.g. t0.l2); legacy links sent the
     literal string "lesson", which produced a dead /lesson/lesson href. Only
     render the chip when the id resolves to a real lesson. */
  const fromLesson = lessonById(from ?? undefined)
  const chrome = SIM_CHROME[simId] ?? { num: simId.toUpperCase(), color: '#3EF2A4' }

  const recordSimVisit = useProgress((s) => s.recordSimVisit)
  const simProgress = useProgress((s) => s.sims[simId])
  const tasksDone = useMemo(() => simProgress?.tasksDone ?? [], [simProgress])
  const visits = simProgress?.visits ?? 0

  /* Count a run once per mount (never in embed mode). */
  useEffect(() => {
    if (!embed) recordSimVisit(simId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simId, embed])

  /* Toast on newly completed tasks — observes the store, so completion
     triggered from anywhere (this sim, an embed, another tab) animates. */
  const [toast, setToast] = useState<{ key: number; text: string; xp: number } | null>(null)
  const prevDoneRef = useRef<string[] | null>(null)
  useEffect(() => {
    if (prevDoneRef.current === null) {
      prevDoneRef.current = tasksDone
      return
    }
    const prev = prevDoneRef.current
    const fresh = tasksDone.filter((id) => !prev.includes(id))
    prevDoneRef.current = tasksDone
    if (fresh.length > 0) {
      const task = tasks.find((t) => t.id === fresh[fresh.length - 1])
      if (task) setToast({ key: Date.now(), text: task.text, xp: task.xp })
    }
  }, [tasksDone, tasks])
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(id)
  }, [toast])

  const [copied, setCopied] = useState(false)
  const share = useCallback(() => {
    void navigator.clipboard?.writeText(window.location.href).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }, [])

  const doneCount = tasks.filter((t) => tasksDone.includes(t.id)).length

  if (embed) {
    return (
      <PlaygroundContext.Provider value={{ simId, embed: true }}>
        <div className="bg-ink font-sans">{children}</div>
      </PlaygroundContext.Provider>
    )
  }

  return (
    <PlaygroundContext.Provider value={{ simId, embed: false }}>
      <section className="flex flex-col lg:h-[calc(100dvh-6.5rem)]">
        {/* ---- SimHeader (56px) ---- */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-4">
          <Link
            to="/lab"
            className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-text-3 transition-colors duration-150 hover:text-accent"
          >
            <ArrowLeft size={14} strokeWidth={1.75} />
            lab
          </Link>
          <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
          <span
            className="shrink-0 rounded-xs border px-2 py-0.5 font-mono text-[10px] font-medium tracking-[0.10em]"
            style={{
              color: chrome.color,
              borderColor: `${chrome.color}55`,
              backgroundColor: `${chrome.color}14`,
            }}
          >
            {chrome.num}
          </span>
          <h1 className="truncate font-display text-[15px] font-medium text-text-1">{title}</h1>
          {subtitle && (
            <span className="hidden truncate font-mono text-[11px] text-text-3 md:inline">
              {subtitle}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {fromLesson && (
              <Link
                to={`/lesson/${fromLesson.id}`}
                title={fromLesson.title}
                className="hidden items-center gap-1 rounded-sm border border-line bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-2 transition-colors duration-150 hover:border-line-bright hover:text-accent sm:flex"
              >
                used in {fromLesson.id.toUpperCase()}
                <ExternalLink size={10} strokeWidth={1.75} />
              </Link>
            )}
            <button
              type="button"
              onClick={share}
              className="flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface-2 px-2.5 font-mono text-[11px] text-text-2 transition-all duration-150 hover:border-line-bright hover:text-text-1 active:scale-95"
              aria-label="Copy shareable URL (with current config)"
            >
              {copied ? (
                <Check size={13} strokeWidth={1.75} className="text-accent" />
              ) : (
                <Share2 size={13} strokeWidth={1.75} />
              )}
              <span className="hidden sm:inline">{copied ? 'copied' : 'share'}</span>
            </button>
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-sm border border-line bg-surface-2 text-text-2 transition-all duration-150 hover:border-line-bright hover:text-text-1 active:scale-95"
                  aria-label="How this simulator works"
                >
                  <HelpCircle size={14} strokeWidth={1.75} />
                </button>
              </DialogTrigger>
              <DialogContent className="border-line bg-surface-1 text-text-2 sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle className="font-display text-text-1">
                    <span className="mr-2 font-mono text-sm" style={{ color: chrome.color }}>
                      {chrome.num}
                    </span>
                    {title}
                  </DialogTitle>
                  {subtitle && (
                    <DialogDescription className="font-mono text-xs text-text-3">
                      {subtitle}
                    </DialogDescription>
                  )}
                </DialogHeader>
                <div className="space-y-3 text-body-sm leading-relaxed">
                  {help ?? (
                    <>
                      <p>
                        This is a live machine, not a video. Drive it with the transport bar:
                        <span className="font-mono text-text-1"> space</span> plays/pauses,
                        <span className="font-mono text-text-1"> →</span> single-steps, and
                        <span className="font-mono text-text-1"> r</span> resets.
                      </p>
                      <p>
                        The right-hand panel lists guided tasks — the sim auto-detects when you
                        pull one off and awards XP. State is scratch: the config serializes into
                        the URL, so <span className="font-mono text-text-1">share</span> hands a
                        friend your exact broken scenario.
                      </p>
                    </>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* ---- Body: stage (children) + guided-tasks rail ---- */}
        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          <div className="min-w-0 flex-1">{children}</div>

          {tasks.length > 0 && (
            <aside className="flex w-full shrink-0 flex-col border-t border-line bg-surface-1 xl:w-[264px] xl:border-l xl:border-t-0">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <span className="flex items-center gap-2 font-mono text-label uppercase tracking-[0.10em] text-text-3">
                  <ListChecks size={13} strokeWidth={1.75} />
                  exercise tasks
                </span>
                <span className="font-mono text-[10px] text-text-3">
                  {doneCount}/{tasks.length}
                </span>
              </div>
              <ul className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                {tasks.map((task) => {
                  const done = tasksDone.includes(task.id)
                  return (
                    <li
                      key={task.id}
                      className={cn(
                        'relative flex items-start gap-2.5 overflow-hidden rounded-sm border px-3 py-2.5 transition-colors duration-250',
                        done ? 'border-accent/40 bg-accent-dim/30' : 'border-line bg-surface-2',
                      )}
                    >
                      {done && (
                        <motion.span
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-accent/20 to-transparent"
                          initial={{ x: '-120%' }}
                          animate={{ x: '340%' }}
                          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                        />
                      )}
                      <span
                        className={cn(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-250',
                          done ? 'border-accent bg-accent text-accent-foreground' : 'border-line-bright',
                        )}
                      >
                        {done && <Check size={10} strokeWidth={3} />}
                      </span>
                      <span
                        className={cn(
                          'text-body-sm leading-snug',
                          done ? 'text-text-3' : 'text-text-2',
                        )}
                      >
                        {task.text}
                      </span>
                      <span
                        className={cn(
                          'ml-auto shrink-0 font-mono text-[10px]',
                          done ? 'text-text-3' : 'text-accent',
                        )}
                      >
                        +{task.xp}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <div className="border-t border-line px-4 py-3 font-mono text-[10px] leading-relaxed text-text-3">
                <p>
                  state is scratch · config lives in the url{' '}
                  <span className="text-text-2">?cfg=…</span> — share a broken heap with a friend.
                </p>
                <p className="mt-1.5">
                  {visits} runs · tasks persist to <span className="text-text-2">/progress</span>
                </p>
              </div>
            </aside>
          )}
        </div>

        {/* ---- +XP toast (above StatusBar) ---- */}
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.key}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="fixed bottom-14 right-4 z-[70] flex items-center gap-3 rounded-md border border-accent/40 bg-surface-2 py-2.5 pl-3 pr-4 shadow-2xl"
              role="status"
            >
              <span className="h-8 w-1 rounded-full bg-accent" aria-hidden />
              <div>
                <p className="font-mono text-xs font-medium text-accent">
                  +{toast.xp} XP — task complete
                </p>
                <p className="max-w-[280px] truncate text-body-sm text-text-2">{toast.text}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </PlaygroundContext.Provider>
  )
}

/* ------------------------------------------------------------------ */
/* Log console (playground.md §1) — shared by all sims                 */
/* ------------------------------------------------------------------ */

export type LogLevel = 'op' | 'ok' | 'warn' | 'err'

export interface LogLine {
  id: number
  tick: number
  tag: string
  msg: string
  level: LogLevel
}

let logLineId = 0

/** Log state for a sim: `log(tick, 'ALLOC', '64B @ 0x02A0', 'ok')`. */
export function useSimLog(maxLines = 160) {
  const [lines, setLines] = useState<LogLine[]>([])
  const log = useCallback(
    (tick: number, tag: string, msg: string, level: LogLevel = 'op') => {
      logLineId += 1
      const line: LogLine = { id: logLineId, tick, tag, msg, level }
      setLines((prev) =>
        prev.length >= maxLines ? [...prev.slice(prev.length - maxLines + 1), line] : [...prev, line],
      )
    },
    [maxLines],
  )
  const clear = useCallback(() => setLines([]), [])
  return { lines, log, clear }
}

const LOG_LEVEL_CLASS: Record<LogLevel, string> = {
  op: 'text-text-2',
  ok: 'text-accent',
  warn: 'text-amber',
  err: 'text-danger',
}

export function formatLogLine(l: LogLine): string {
  return `[t+${String(l.tick).padStart(4, '0')}] ${l.tag.padEnd(7)} ${l.msg}`
}

export function LogConsole({
  lines,
  onClear,
  className,
}: {
  lines: LogLine[]
  onClear?: () => void
  className?: string
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el && !hovering && !collapsed) el.scrollTop = el.scrollHeight
  }, [lines, hovering, collapsed])

  const copyAll = () => {
    void navigator.clipboard
      ?.writeText(lines.map(formatLogLine).join('\n'))
      .catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  const last = lines[lines.length - 1]

  return (
    <div className={cn('shrink-0 border-t border-line bg-surface-2', className)}>
      <div className="flex h-10 items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 font-mono text-label uppercase tracking-[0.10em] text-text-3 transition-colors hover:text-text-1"
          aria-expanded={!collapsed}
        >
          <ChevronDown
            size={13}
            strokeWidth={1.75}
            className={cn('transition-transform duration-250', collapsed && '-rotate-90')}
          />
          log
        </button>
        {collapsed && last && (
          <span className={cn('truncate font-mono text-xs', LOG_LEVEL_CLASS[last.level])}>
            {formatLogLine(last)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={copyAll}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
            aria-label="Copy log"
          >
            {copied ? (
              <Check size={13} strokeWidth={1.75} className="text-accent" />
            ) : (
              <Copy size={13} strokeWidth={1.75} />
            )}
          </button>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="flex h-7 w-7 items-center justify-center rounded-sm text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1"
              aria-label="Clear log"
            >
              <Trash2 size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
      {!collapsed && (
        <div
          ref={scrollRef}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          className="scrollbar-slim h-40 overflow-y-auto px-4 pb-3 font-mono text-[13px] leading-[1.7]"
          aria-live="polite"
        >
          {lines.length === 0 ? (
            <p className="text-text-3">— quiet. do something to the machine.</p>
          ) : (
            lines.map((l) => (
              <p key={l.id} className={cn('whitespace-pre-wrap', LOG_LEVEL_CLASS[l.level])}>
                {formatLogLine(l)}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Transport bar (playground.md §1)                                    */
/* ------------------------------------------------------------------ */

export interface TransportBarProps {
  playing: boolean
  onTogglePlay: () => void
  onStep: () => void
  onReset: () => void
  speed: number
  onSpeedChange: (v: number) => void
  ticks: number
  /** Enable space / → / r keyboard control (default true). */
  keyboard?: boolean
  /** Disables play/step (e.g. nothing scripted to run). */
  idle?: boolean
  className?: string
}

export function TransportBar({
  playing,
  onTogglePlay,
  onStep,
  onReset,
  speed,
  onSpeedChange,
  ticks,
  keyboard = true,
  idle = false,
  className,
}: TransportBarProps) {
  useEffect(() => {
    if (!keyboard) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        onTogglePlay()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onStep()
      } else if (e.key === 'r' || e.key === 'R') {
        onReset()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard, onTogglePlay, onStep, onReset])

  const btn =
    'flex h-8 w-8 items-center justify-center rounded-sm border border-line bg-surface-2 text-text-2 transition-all duration-150 hover:border-line-bright hover:text-text-1 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-text-2'

  return (
    <div
      className={cn(
        'flex h-12 shrink-0 items-center gap-2 border-t border-line bg-surface-1 px-4',
        className,
      )}
    >
      <button
        type="button"
        onClick={onTogglePlay}
        disabled={idle}
        className={btn}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <Pause size={14} strokeWidth={1.75} />
        ) : (
          <Play size={14} strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        onClick={onStep}
        disabled={idle}
        className={btn}
        aria-label="Step forward"
      >
        <StepForward size={14} strokeWidth={1.75} />
      </button>

      <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden />

      <div className="flex items-center gap-2">
        <Slider
          value={[speed]}
          min={0.25}
          max={4}
          step={0.25}
          onValueChange={([v]) => onSpeedChange(v)}
          className="w-24 sm:w-28"
          aria-label="Simulation speed"
        />
        <span className="w-10 font-mono text-[11px] text-text-2">{speed.toFixed(2)}×</span>
      </div>

      <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden />

      <button
        type="button"
        onClick={onReset}
        className="flex h-8 items-center gap-1.5 rounded-sm border border-danger/40 bg-transparent px-2.5 font-mono text-[11px] text-danger transition-all duration-150 hover:bg-danger/10 active:scale-95"
        aria-label="Reset simulator"
      >
        <RotateCcw size={13} strokeWidth={1.75} />
        <span className="hidden sm:inline">reset</span>
      </button>

      <span className="ml-auto font-mono text-[11px] text-text-3">
        t = <span className="text-text-1">{String(ticks).padStart(4, '0')}</span>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Control-panel primitives                                            */
/* ------------------------------------------------------------------ */

export function ControlGroup({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('border-b border-line px-4 py-4', className)}>
      <p className="mb-3 font-mono text-label uppercase tracking-[0.10em] text-text-3">{label}</p>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

export function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between font-mono text-[11px]">
        <span className="text-text-2">{label}</span>
        <span className="text-text-1">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
        aria-label={label}
      />
    </div>
  )
}

/** Small mono chip-button used across control panels. */
export function ChipButton({
  active,
  onClick,
  children,
  color,
  className,
  disabled,
}: {
  active?: boolean
  onClick: () => void
  children: ReactNode
  color?: string
  className?: string
  disabled?: boolean
}) {
  const c = color ?? '#3EF2A4'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={
        active
          ? { color: c, borderColor: `${c}66`, backgroundColor: `${c}14` }
          : undefined
      }
      className={cn(
        'rounded-sm border px-2.5 py-1.5 font-mono text-[11px] transition-all duration-120 active:scale-[.92] disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-line-bright'
          : 'border-line bg-surface-2 text-text-2 hover:border-line-bright hover:text-text-1',
        className,
      )}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* InlineQuiz — the "explain" guided tasks (quiz popover, §5/§7)       */
/* ------------------------------------------------------------------ */

export function InlineQuiz({
  question,
  options,
  correctIndex,
  onSolved,
}: {
  question: string
  options: string[]
  correctIndex: number
  onSolved: () => void
}) {
  const [picked, setPicked] = useState<number | null>(null)
  const [shakeKey, setShakeKey] = useState(0)
  const solved = picked === correctIndex

  return (
    <div className="rounded-md border border-line bg-surface-2 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">checkpoint</p>
      <p className="mt-1.5 text-body-sm leading-snug text-text-1">{question}</p>
      <div className="mt-2.5 space-y-1.5">
        {options.map((opt, i) => {
          const isPicked = picked === i
          const isCorrect = i === correctIndex
          return (
            <motion.button
              key={`${i}-${isPicked && !isCorrect ? shakeKey : 0}`}
              type="button"
              disabled={solved}
              onClick={() => {
                setPicked(i)
                if (i === correctIndex) onSolved()
                else setShakeKey((k) => k + 1)
              }}
              animate={isPicked && !isCorrect ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
              transition={{ duration: 0.3 }}
              className={cn(
                'flex w-full items-start gap-2 rounded-sm border px-2.5 py-2 text-left text-[13px] leading-snug transition-colors duration-150',
                solved && isCorrect
                  ? 'border-accent/50 bg-accent-dim/40 text-accent'
                  : isPicked && !isCorrect
                    ? 'border-danger/50 bg-danger/10 text-danger'
                    : 'border-line bg-surface-1 text-text-2 hover:border-line-bright hover:text-text-1',
                solved && !isCorrect && 'opacity-50',
              )}
            >
              <span className="font-mono text-[10px] text-text-3">{String.fromCharCode(65 + i)}</span>
              {opt}
            </motion.button>
          )
        })}
      </div>
      {solved && (
        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 font-mono text-[11px] text-accent"
        >
          ✓ exactly — task logged.
        </motion.p>
      )}
    </div>
  )
}
