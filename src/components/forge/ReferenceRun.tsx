/**
 * The in-browser reference run of the Run and Modify steps (docs/specs/wave-1.md §13.1; wave-2.md §13.1), for any lab.
 *
 * The lab's bundle supplies a `ReferenceRunSpec`: a pure `run(config)` that returns every frame of the strip
 * (cells filled 0 to 100, darker = fuller, the live numbers beside it, a spoken alt) and a one-line summary. The panel
 * computes the whole run up front and only walks its frames, with one button that plays, skips to the end and replays.
 * The spec's disclaimer says what the run is and is not (a labelled stand-in, never the lab's own check).
 * Nothing here talks to the ledger: `onFinished` hands the finished run to the caller, which decides what it is
 * worth (the Run step writes an observation, the Modify step grades a prediction).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, RotateCcw, SkipForward } from 'lucide-react'
import { clsx as cn } from 'clsx'
import type { ForgeBundle, RunConfig, RunResult } from '@/data/forge/types'

/** One frame of the strip every this many milliseconds (about 130 frames: a few seconds a run). */
const FRAME_MS = 45

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export interface ReferenceRunProps {
  /** The lab's bundle: `primm.run` computes the run and names it. */
  bundle: ForgeBundle
  config: RunConfig
  /** Names the run in the header; default the spec's own title for the config. */
  title?: string
  /** Called once per finished run (played to the end, or skipped to it). */
  onFinished?(run: RunResult): void
  /** Start as soon as the component mounts. Default false. */
  autoPlay?: boolean
  /** Put keyboard focus on the run button when the component mounts (the control the learner is walked to next). */
  focusRun?: boolean
}

export function ReferenceRun({ bundle, config, title, onFinished, autoPlay = false, focusRun = false }: ReferenceRunProps) {
  const spec = bundle.primm.run
  // The whole run is computed up front (tens of ms); the strip only walks its frames.
  const run = useMemo(() => spec.run(config), [spec, config])
  const last = run.frames.length - 1
  const [frame, setFrame] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'playing' | 'done'>('idle')
  const finished = useRef(onFinished)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    finished.current = onFinished
  }, [onFinished])

  const finish = () => {
    setFrame(last)
    setPhase('done')
    finished.current?.(run)
  }

  const start = () => {
    setFrame(0)
    if (prefersReducedMotion()) {
      finish()
      return
    }
    setPhase('playing')
  }

  // A new config is a new run: start again from the first frame.
  useEffect(() => {
    setFrame(0)
    setPhase('idle')
  }, [run])

  useEffect(() => {
    if (focusRun) button.current?.focus()
    if (autoPlay) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, [])

  useEffect(() => {
    if (phase !== 'playing') return
    const id = window.setInterval(() => {
      setFrame((f) => Math.min(last, f + 1))
    }, FRAME_MS)
    return () => window.clearInterval(id)
  }, [phase, last])

  useEffect(() => {
    if (phase === 'playing' && frame >= last) finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish() reads the current run
  }, [phase, frame, last])

  const f = run.frames[Math.min(frame, last)]
  const failedHere = phase === 'done' && !run.clean

  return (
    <figure className="rounded-sm border border-line bg-surface-2 p-3" data-reference-run={bundle.labId} data-phase={phase}>
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">{title ?? spec.title(config)}</span>
        <span className="font-mono text-[10px] text-text-3">
          op {f.op} / {run.total}
        </span>
      </figcaption>

      <div
        className="mt-2 grid h-9 gap-px overflow-hidden rounded-xs border border-line bg-line"
        style={{ gridTemplateColumns: `repeat(${f.cells.length}, minmax(0, 1fr))` }}
        role="img"
        aria-label={f.alt}
        data-strip
      >
        {f.cells.map((pct, i) => (
          <span key={i} className={cn('block', failedHere ? 'bg-danger' : 'bg-accent')} style={{ opacity: 0.1 + (0.9 * pct) / 100 }} />
        ))}
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
        {f.stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-[10px] uppercase text-text-3">{stat.label}</dt>
            <dd className="text-text-1" data-stat={stat.label}>
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* One button for the whole run: its label and handler follow the phase, so activating it never drops focus. */}
        <button
          ref={button}
          type="button"
          onClick={phase === 'playing' ? finish : start}
          data-run-button={phase}
          className={cn(
            'inline-flex items-center gap-1.5 [@media(pointer:coarse)]:min-h-11',
            phase === 'idle'
              ? 'rounded-md bg-accent px-3 py-1.5 font-display text-[13px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]'
              : 'rounded-sm border border-line px-3 py-1.5 font-mono text-[11px] text-text-2 hover:text-text-1',
          )}
        >
          {phase === 'idle' && (
            <>
              <Play size={13} aria-hidden /> Run it
            </>
          )}
          {phase === 'playing' && (
            <>
              <SkipForward size={13} aria-hidden /> Skip to the end
            </>
          )}
          {phase === 'done' && (
            <>
              <RotateCcw size={13} aria-hidden /> Replay
            </>
          )}
        </button>
      </div>

      <p role="status" aria-live="polite" className="mt-2 min-h-[2.5em] text-body-sm text-text-2" data-caption>
        {phase === 'done' ? run.summary : ''}
      </p>
      <p className="mt-1 font-mono text-[10px] leading-snug text-text-3">{spec.disclaimer}</p>
    </figure>
  )
}
