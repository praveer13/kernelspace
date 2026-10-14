/**
 * The scheduler play's controls and pictures (docs/specs/wave-2.md §8.3): the waiting chips, the running list
 * and the KV bar.
 *
 * The chips are the control. Each waiting request is a full-width row (at least 44 px tall) that toggles it into
 * the admit order, or is disabled and says why. The tap order is the admit order, and a chip shows its place in
 * it. Each running request has a Preempt toggle. The KV bar is a picture with a text equivalent; Mirror.tsx is its
 * DOM twin.
 *
 * Keyboard: Tab and the arrow keys move through the chips and the Preempt toggles, Space toggles the focused
 * one, P toggles the Preempt of the focused running request and Enter runs the iteration. Motion is never needed
 * for meaning, and nothing here transitions under reduced motion (the transitions are `motion-safe`).
 */

import { cn } from '@/lib/utils'
import type { SchedFrame } from '@/lib/world/types'
import { groups, iterations, kvSplit, kvText, pickProblem, progressWords, HEADROOM_TOKENS, type KvSplit } from './session'

export interface KvBarProps {
  frame: SchedFrame
  /** This turn's picks and preempt, so the bar shows what the choice would leave. Absent: the frame as it stands. */
  picks?: readonly number[]
  preempt?: number | null
  /** The id the picture's `aria-describedby` points at (the mirror). */
  describedBy?: string
  /** Names the picture: "Your KV pool", "The reference's KV pool at iteration 37". */
  title: string
}

const pctOf = (part: number, whole: number) => `${whole === 0 ? 0 : (part / whole) * 100}%`

/** One legend entry: a swatch, and the words, so no segment is told apart by colour alone. */
function Key({ swatch, children }: { swatch: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={cn('inline-block h-2.5 w-4 shrink-0 rounded-[2px] border border-line-bright', swatch)} />
      <span>{children}</span>
    </li>
  )
}

const STRIPES = 'bg-[repeating-linear-gradient(135deg,#FFB224_0_3px,transparent_3px_6px)]'

/** The KV pool: in use, chosen this turn, the headroom marker and what is free. A picture with a text equivalent. */
export function KvBar({ frame, picks = [], preempt = null, describedBy, title }: KvBarProps) {
  const split: KvSplit = kvSplit(frame, picks, preempt)
  const label = `${title}. ${kvText(split, frame.view.running.length - (preempt !== null ? 1 : 0))}`
  return (
    <div data-kv-bar>
      <div role="img" aria-label={label} aria-describedby={describedBy} className="flex h-5 w-full overflow-hidden rounded-sm border border-line-bright bg-surface-2">
        <span data-kv="used" className="h-full bg-info" style={{ width: pctOf(split.used, split.capacity) }} />
        <span data-kv="chosen" className="h-full bg-accent" style={{ width: pctOf(split.chosen, split.capacity) }} />
        <span data-kv="headroom" className={cn('h-full', STRIPES)} style={{ width: pctOf(split.headroom, split.capacity) }} />
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-2">
        <Key swatch="bg-info">in use {groups(split.used)}</Key>
        {split.chosen > 0 && <Key swatch="bg-accent">chosen {groups(split.chosen)}</Key>}
        <Key swatch={STRIPES}>headroom {groups(split.headroom)}</Key>
        <Key swatch="bg-surface-2">free {groups(split.free)}</Key>
      </ul>
      <p className="mt-1 font-mono text-[11px] text-text-3">
        {groups(split.capacity)} tokens in all. Headroom is {HEADROOM_TOKENS} tokens for each running request to decode into.
      </p>
    </div>
  )
}

export interface QueueProps {
  frame: SchedFrame
  picks: readonly number[]
  preempt: number | null
  onToggleAdmit: (id: number) => void
  onTogglePreempt: (id: number) => void
  onRun: () => void
}

/** The controls that arrow keys walk: the chips that can be pressed, then the Preempt toggles. */
const WALK = '[data-chip]:not(:disabled), [data-preempt]'

export default function Queue({ frame, picks, preempt, onToggleAdmit, onTogglePreempt, onRun }: QueueProps) {
  const v = frame.view
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const control = (e.target as HTMLElement).closest<HTMLElement>('[data-chip], [data-preempt]')
    if (!control) return
    if (e.key === 'Enter') {
      e.preventDefault()
      onRun()
      return
    }
    if ((e.key === 'p' || e.key === 'P') && control.dataset.preempt !== undefined) {
      e.preventDefault()
      onTogglePreempt(Number(control.dataset.preempt))
      return
    }
    const stops = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(WALK))
    const at = stops.indexOf(control)
    const step: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }
    let to = -1
    if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = stops.length - 1
    else if (e.key in step) to = (at + step[e.key] + stops.length) % stops.length
    if (to < 0) return
    e.preventDefault()
    stops[to].focus()
  }

  return (
    <div onKeyDown={onKey} className="space-y-5" data-queue>
      <div role="group" aria-label="Waiting requests. Press one to admit it; the order you press is the order they are admitted." data-waiting>
        <p className="font-mono text-[12px] text-text-1">
          Waiting <span className="text-text-3">· {v.waiting.length}</span>
        </p>
        <div className="mt-2 space-y-2">
          {v.waiting.length === 0 && <p className="text-body-sm text-text-3">Nothing is waiting.</p>}
          {v.waiting.map((r) => {
            const place = picks.indexOf(r.id)
            const picked = place >= 0
            const why = picked ? '' : pickProblem(frame, picks, preempt, r.id)
            return (
              <button
                key={r.id}
                type="button"
                data-chip
                data-id={r.id}
                aria-pressed={picked}
                disabled={why !== ''}
                onClick={() => onToggleAdmit(r.id)}
                className={cn(
                  'flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-sm border px-3 py-2 text-left font-mono text-[13px] motion-safe:transition-colors motion-safe:duration-150',
                  picked
                    ? 'border-accent bg-accent-dim text-text-1'
                    : why === ''
                      ? 'border-line-bright bg-surface-2 text-text-1 hover:border-accent hover:bg-accent-dim'
                      : 'cursor-not-allowed border-line bg-transparent text-text-3',
                )}
              >
                <span>
                  #{r.id} · {groups(r.prompt)} tokens
                </span>
                <span className={picked ? 'text-accent' : 'text-text-3'}>
                  {picked ? `admit ${place + 1}` : why !== '' ? why : `waited ${iterations(v.iter - r.arrival)}`}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div role="group" aria-label="Running requests. Each has a Preempt toggle." data-running>
        <p className="font-mono text-[12px] text-text-1">
          Running <span className="text-text-3">· {v.running.length} of {v.maxRunning}</span>
        </p>
        <ul className="mt-2 space-y-2">
          {frame.running.length === 0 && <li className="text-body-sm text-text-3">Nothing is running.</li>}
          {frame.running.map((r) => {
            const marked = preempt === r.id
            return (
              <li key={r.id} data-running-row className="flex min-h-11 items-center justify-between gap-3 rounded-sm border border-line bg-surface-1 px-3 py-1.5 font-mono text-[13px] text-text-2">
                <span>
                  #{r.id} · {groups(r.prompt)} tokens <span className="text-text-3">· {progressWords(r)}</span>
                </span>
                <button
                  type="button"
                  data-preempt={r.id}
                  aria-pressed={marked}
                  aria-label={`${marked ? 'Preempting' : 'Preempt'} #${r.id}`}
                  onClick={() => onTogglePreempt(r.id)}
                  className={cn(
                    'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm border px-3 font-mono text-[12px] motion-safe:transition-colors motion-safe:duration-150',
                    marked ? 'border-amber bg-amber/15 text-text-1' : 'border-line bg-surface-2 text-text-2 hover:border-line-bright hover:text-text-1',
                  )}
                >
                  {marked ? 'Preempting' : 'Preempt'}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
