/**
 * The EPLB play's board (docs/specs/wave-3.md §5.2): the prediction that opens the play, the experts to copy, the GPUs to
 * place on, and the read-only layer the debrief shows. Nothing here reads the hidden reference.
 *
 * The experts are a grid of 44 px buttons and the GPUs are rows of slot buttons, each one at least 44 px tall and wide; every
 * control is a button (no drag, WCAG 2.5.7). One tab stop per group (a roving tabindex): the arrow keys move between experts
 * or between GPUs that still have a free slot, Enter or Space presses (the expert is copied, the offered copy lands on the
 * GPU), and the turn's line is spoken by the mirror's live region (Mirror.tsx). A filled slot is text, not a button: only a
 * free slot does anything. Nothing moves except the loads; there is no animation to reduce.
 */

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/Button'
import { cn } from '@/lib/utils'
import { EXPERTS, GPUS, MEAN_PERMILLE, MEAN_UNITS, REPLICATE_TURNS, SLOTS_PER_GPU, expertLabel, gpuLabel, nextWithRoom, parsePrediction, permille, times, type EplbStage } from './session'
import type { EplbView } from '@/lib/world/eplb'

const FIELD =
  'min-h-11 min-w-0 rounded-md border border-line bg-surface-2 px-3 text-base text-text-1 placeholder:text-text-3 focus-visible:border-line-bright disabled:cursor-default disabled:opacity-70'
const RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/* ------------------------------------------------------------------ */
/* Predict                                                              */
/* ------------------------------------------------------------------ */

export interface PredictProps {
  /** The 16 loads in per mille, as the learner sees them. */
  loads: readonly number[]
  onPredict: (value: number) => void
}

/** The opening question: round robin's imbalance on these loads, as a number. */
export function Predict({ loads, onPredict }: PredictProps) {
  const uid = useId()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const r = parsePrediction(text)
    if (!r.ok) {
      setProblem(r.problem)
      return
    }
    setProblem(null)
    onPredict(r.value)
  }
  return (
    <section aria-labelledby={`${uid}-h`} data-phase="predict" className="space-y-3">
      <p className="section-label">Predict first</p>
      <h3 id={`${uid}-h`} className="font-display text-h4 text-text-1">
        How badly does round robin skew this layer?
      </h3>
      <p className="text-body-sm text-text-2">
        This layer sends its tokens to {EXPERTS} experts, in these shares of the load (per mille, summing to 1,000). Four GPUs share it, so the mean GPU carries {MEAN_PERMILLE} ‰. Round robin
        without replicas deals the 16 experts out heaviest first: the heaviest to GPU 1, the next to GPU 2, and so on round the four GPUs, so the fifth heaviest goes back to GPU 1. The
        layer waits for its busiest GPU. What is the busiest GPU&apos;s load divided by the mean?
      </p>
      <ul className="grid grid-cols-4 gap-x-2 gap-y-1 font-mono text-[12px] text-text-2" aria-label="Expert loads in per mille" data-loads>
        {loads.map((l, e) => (
          <li key={e}>
            <span className="text-text-3">{expertLabel(e)}</span> {l} ‰
          </li>
        ))}
      </ul>
      <form onSubmit={submit} noValidate className="space-y-2">
        <label htmlFor={`${uid}-v`} className="block font-mono text-[11px] uppercase text-text-3">
          Your prediction, as a multiple of the mean
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${uid}-v`}
            data-ks-field
            inputMode="decimal"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${uid}-p` : undefined}
            className={cn(FIELD, 'w-full flex-1 font-mono')}
          />
          <span aria-hidden className="shrink-0 font-mono text-body-sm text-text-2">
            ×
          </span>
        </div>
        {problem && (
          <p id={`${uid}-p`} role="alert" className="text-body-sm text-amber">
            {problem}
          </p>
        )}
        <Button type="submit" className="min-h-11 w-full sm:w-auto">
          Lock in my prediction
        </Button>
        <p className="font-mono text-[11px] text-text-3">A rough number is fine. The debrief shows what round robin gives.</p>
      </form>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* The bar a GPU's load draws                                           */
/* ------------------------------------------------------------------ */

/** A GPU's load against the mean, in a bar twice as long as the mean: the mark is the mean. The text beside it is the data. */
function LoadBar({ units, busiest }: { units: number; busiest: boolean }) {
  const pct = Math.min(100, (units / (MEAN_UNITS * 2)) * 100)
  return (
    <div aria-hidden className="relative h-2 rounded-sm bg-surface-2">
      <div className={cn('absolute inset-y-0 left-0 rounded-sm', busiest ? 'bg-amber' : 'bg-accent')} style={{ width: `${pct}%` }} />
      <div className="absolute inset-y-0 left-1/2 w-px bg-text-2" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Replicate: the experts                                               */
/* ------------------------------------------------------------------ */

const COLS = 4

function ExpertGrid({ view, onCopy, labelledBy }: { view: EplbView; onCopy: (e: number) => void; labelledBy: string }) {
  const [cursor, setCursor] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const hottest = Math.max(...view.loads)
  const go = (e: number) => {
    setCursor(e)
    root.current?.querySelector<HTMLButtonElement>(`[data-expert="${e}"]`)?.focus()
  }
  const keys = (ev: KeyboardEvent<HTMLDivElement>) => {
    const n = view.loads.length
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }
    let to: number | null = null
    if (ev.key in step) to = cursor + step[ev.key]
    else if (ev.key === 'Home') to = 0
    else if (ev.key === 'End') to = n - 1
    if (to === null) return
    ev.preventDefault()
    if (to >= 0 && to < n) go(to)
  }
  return (
    <div ref={root} role="group" aria-labelledby={labelledBy} onKeyDown={keys} className="grid grid-cols-4 gap-1.5">
      {view.loads.map((_, e) => {
        const copies = view.copies[e]
        return (
          <button
            key={e}
            type="button"
            data-expert={e}
            {...(cursor === e ? { 'data-stop': '' } : {})}
            tabIndex={cursor === e ? 0 : -1}
            aria-label={`Copy expert ${expertLabel(e)}: ${permille(view.perCopy[e])} per copy now, ${copies} ${copies === 1 ? 'copy' : 'copies'} so far`}
            onFocus={() => setCursor(e)}
            onClick={() => onCopy(e)}
            className={cn(
              'flex min-h-11 min-w-11 flex-col justify-center gap-0.5 rounded-sm border border-line-bright bg-surface-1 px-1.5 py-1 text-left hover:border-accent hover:bg-accent-dim motion-safe:transition-colors motion-safe:duration-150',
              RING,
            )}
          >
            <span className="font-mono text-[13px] leading-none text-text-1">
              {expertLabel(e)}
              {copies > 1 && <span className="text-accent"> ×{copies}</span>}
            </span>
            <span className="font-mono text-[11px] leading-none text-text-2">{permille(view.perCopy[e])}</span>
            <span aria-hidden className="block h-1 rounded-sm bg-surface-2">
              <span className="block h-1 rounded-sm bg-accent" style={{ width: `${Math.min(100, (view.loads[e] / hottest) * 100)}%` }} />
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Place: the GPUs                                                      */
/* ------------------------------------------------------------------ */

function GpuRows({ view, onPlace, labelledBy }: { view: EplbView; onPlace: (g: number) => void; labelledBy: string }) {
  const [cursor, setCursor] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const copy = view.queue[0]
  // The stop is the cursor's GPU, or the next one with room once it fills up.
  const stop = view.gpus[cursor].free > 0 ? cursor : nextWithRoom(view, cursor, 1)
  const go = (g: number) => {
    setCursor(g)
    root.current?.querySelector<HTMLButtonElement>(`[data-gpu="${g}"] [data-slot="free"]`)?.focus()
  }
  const keys = (ev: KeyboardEvent<HTMLDivElement>) => {
    let to: number | null = null
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') to = nextWithRoom(view, stop, 1)
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') to = nextWithRoom(view, stop, -1)
    else if (ev.key === 'Home') to = view.gpus.findIndex((g) => g.free > 0)
    else if (ev.key === 'End') to = GPUS - 1 - [...view.gpus].reverse().findIndex((g) => g.free > 0)
    if (to === null) return
    ev.preventDefault()
    if (to >= 0 && to < GPUS) go(to)
  }
  return (
    <div ref={root} role="group" aria-labelledby={labelledBy} onKeyDown={keys} className="space-y-2">
      {view.gpus.map((g, i) => (
        <div
          key={i}
          role="group"
          aria-label={`${gpuLabel(i)}, ${permille(g.units)}, ${g.free} of ${SLOTS_PER_GPU} slots free`}
          data-gpu={i}
          data-units={g.units}
          data-free={g.free}
          className="rounded-md border border-line bg-surface-1 p-2"
        >
          <div className="flex items-baseline justify-between gap-2 font-mono text-[12px]">
            <span className="text-text-1">{gpuLabel(i)}</span>
            <span className="text-text-2" data-load>
              {permille(g.units)} · {times(g.units)}× the mean
            </span>
          </div>
          <div className="mt-1.5">
            <LoadBar units={g.units} busiest={g.units === view.maxUnits && g.units > 0} />
          </div>
          <div className="mt-2 flex gap-1.5">
            {Array.from({ length: SLOTS_PER_GPU }, (_, slot) => {
              if (slot < g.experts.length) {
                const e = g.experts[slot]
                return (
                  <span
                    key={slot}
                    data-slot="filled"
                    className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-sm border border-line bg-surface-2 px-0.5 font-mono"
                  >
                    <span className="text-[12px] leading-tight text-text-1">{expertLabel(e)}</span>
                    <span className="text-[11px] leading-tight text-text-2">{permille(view.perCopy[e]).replace(' ‰', '')}</span>
                  </span>
                )
              }
              const first = slot === g.experts.length
              return (
                <button
                  key={slot}
                  type="button"
                  data-slot="free"
                  {...(i === stop && first ? { 'data-stop': '' } : {})}
                  tabIndex={i === stop && first ? 0 : -1}
                  aria-label={`${gpuLabel(i)}, ${permille(g.units)} now, ${g.free} free ${g.free === 1 ? 'slot' : 'slots'}. Place ${expertLabel(copy.expert)}'s copy, ${permille(copy.units)}, here.`}
                  onFocus={() => setCursor(i)}
                  onClick={() => onPlace(i)}
                  className={cn(
                    'flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-sm border border-dashed border-line-bright font-mono text-[11px] text-text-3 hover:border-accent hover:bg-accent-dim hover:text-text-1 motion-safe:transition-colors motion-safe:duration-150',
                    RING,
                  )}
                >
                  free
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The board                                                            */
/* ------------------------------------------------------------------ */

export interface BoardProps {
  stage: Extract<EplbStage, { kind: 'turn' }>
  onCopy: (e: number) => void
  onPlace: (g: number) => void
}

/** The turn the learner is on: the experts to copy, or the copy on offer and the GPUs to put it on. */
export default function Board({ stage, onCopy, onPlace }: BoardProps) {
  const uid = useId()
  const { view, copy } = stage
  const then = view.queue.slice(1, 5)
  return (
    <section data-board={stage.phase} className="space-y-3">
      {stage.phase === 'replicate' ? (
        <>
          <h3 id={`${uid}-h`} className="font-display text-h4 text-text-1">
            Copy an expert
          </h3>
          <p className="text-body-sm text-text-2">
            Each GPU has {SLOTS_PER_GPU} slots and there are {EXPERTS} experts, so {REPLICATE_TURNS} slots are spare. Copying an expert splits its load evenly over its copies, so a hot expert&apos;s copies weigh less. Press the
            expert you want a copy of. Arrow keys move between experts.
          </p>
          <ExpertGrid view={view} onCopy={onCopy} labelledBy={`${uid}-h`} />
        </>
      ) : (
        <>
          <h3 id={`${uid}-h`} className="font-display text-h4 text-text-1">
            Place the next copy
          </h3>
          {copy && (
            <p data-next-copy className="rounded-sm border-l-2 border-accent bg-surface-2 px-3 py-2 font-mono text-[13px] text-text-1">
              Next copy: {expertLabel(copy.expert)} · {permille(copy.units)}
              {then.length > 0 && (
                <span className="block text-[11px] text-text-3">
                  Then {then.map((c) => `${expertLabel(c.expert)} ${permille(c.units)}`).join(', ')}
                  {view.queue.length > 5 ? ', …' : ''}
                </span>
              )}
            </p>
          )}
          <p className="text-body-sm text-text-2">Press a free slot on the GPU that gets it. Up and down arrows move between GPUs that still have room, and Enter places.</p>
          <GpuRows view={view} onPlace={onPlace} labelledBy={`${uid}-h`} />
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* A finished layer, read-only (the debrief)                            */
/* ------------------------------------------------------------------ */

export interface LayerProps {
  view: EplbView
  /** GPUs to mark: where the learner put the copy, and where the reference puts it. */
  marks?: { mine?: number; reference?: number }
}

/** The GPUs of a layer as text and bars, for the debrief. */
export function Layer({ view, marks }: LayerProps) {
  return (
    <ul className="space-y-2" data-layer>
      {view.gpus.map((g, i) => (
        <li key={i} data-gpu={i} className="rounded-md border border-line bg-surface-2 p-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 font-mono text-[12px]">
            <span className="text-text-1">
              {gpuLabel(i)}
              {marks?.mine === i && <span className="ml-2 rounded-sm bg-surface-1 px-1.5 py-0.5 text-[11px] text-amber">you put it here</span>}
              {marks?.reference === i && <span className="ml-2 rounded-sm bg-surface-1 px-1.5 py-0.5 text-[11px] text-accent">the reference puts it here</span>}
            </span>
            <span className="text-text-2">
              {permille(g.units)} · {times(g.units)}× the mean
            </span>
          </div>
          <div className="mt-1.5">
            <LoadBar units={g.units} busiest={g.units === view.maxUnits && g.units > 0} />
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-text-2">
            {g.experts.length === 0 ? 'no copies yet' : g.experts.map((e) => `${expertLabel(e)} ${permille(view.perCopy[e])}`).join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  )
}
