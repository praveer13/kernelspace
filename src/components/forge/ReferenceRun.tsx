/**
 * The in-browser reference run of lab 01's Run and Modify steps (docs/specs/wave-1.md §13.1).
 *
 * One allocator (first-fit, worst-fit or a bump pointer; coalescing on or off) replays the seeded churn through
 * `world/heap`, and a strip shows the heap in address order (darker = more live bytes), the live bytes and the
 * largest free run as the ops go by. The churn has check 6's shape but is its own trace, and the panel says so.
 * Nothing here talks to the ledger: `onFinished` hands the finished run to the caller, which decides what it is
 * worth (the Run step writes an observation, the Modify step grades a prediction).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, RotateCcw, SkipForward } from 'lucide-react'
import { clsx as cn } from 'clsx'
import { CHURN, describeRun, runChurn, type ChurnConfig, type ChurnRun } from '@/data/forge/rust-allocator/primm'

/** One frame of the strip every this many milliseconds (about 130 frames: a few seconds a run). */
const FRAME_MS = 45

const kib = (bytes: number) => `${Math.round(bytes / 102.4) / 10} KiB`

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export interface ReferenceRunProps {
  config: ChurnConfig
  /** Names the run in the header, e.g. "Reference: first-fit with coalescing". */
  title: string
  /** Called once per finished run (played to the end, or skipped to it). */
  onFinished?(run: ChurnRun): void
  /** Start as soon as the component mounts. Default false. */
  autoPlay?: boolean
  /** Put keyboard focus on the run button when the component mounts (the control the learner is walked to next). */
  focusRun?: boolean
}

export function ReferenceRun({ config, title, onFinished, autoPlay = false, focusRun = false }: ReferenceRunProps) {
  // The whole run is computed up front (tens of ms); the strip only walks its samples.
  const run = useMemo(() => runChurn(config), [config])
  const last = run.samples.length - 1
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

  const s = run.samples[Math.min(frame, last)]
  const failedHere = phase === 'done' && !run.clean
  const heapKiB = CHURN.capacity / 1024

  return (
    <figure className="rounded-sm border border-line bg-surface-2 p-3" data-reference-run={config.fit} data-phase={phase}>
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">{title}</span>
        <span className="font-mono text-[10px] text-text-3">
          op {s.op} / {run.total}
        </span>
      </figcaption>

      <div
        className="mt-2 grid h-9 gap-px overflow-hidden rounded-xs border border-line bg-line"
        style={{ gridTemplateColumns: `repeat(${CHURN.buckets}, minmax(0, 1fr))` }}
        role="img"
        aria-label={`The ${heapKiB / 1024} MiB heap in address order, ${CHURN.buckets} buckets of ${heapKiB / CHURN.buckets} KiB. ${kib(s.liveBytes)} live, largest free run ${kib(s.largestFree)}.`}
        data-strip
      >
        {s.map.map((pct, i) => (
          <span
            key={i}
            className={cn('block', failedHere ? 'bg-danger' : 'bg-accent')}
            style={{ opacity: 0.1 + (0.9 * pct) / 100 }}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[9px] text-text-3" aria-hidden>
        <span>0</span>
        <span>{heapKiB / 1024} MiB</span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
        <div>
          <dt className="text-[10px] uppercase text-text-3">live bytes</dt>
          <dd className="text-text-1" data-live>
            {kib(s.liveBytes)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase text-text-3">largest free run</dt>
          <dd className="text-text-1" data-largest-free>
            {kib(s.largestFree)}
          </dd>
        </div>
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
        {phase === 'done' ? describeRun(run) : ''}
      </p>
      <p className="mt-1 font-mono text-[10px] leading-snug text-text-3">
        This is the page&rsquo;s own churn, shaped like check 6 (same heap, same request sizes), not check 6 itself.
      </p>
    </figure>
  )
}
