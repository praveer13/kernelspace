/**
 * The explore half of a level (docs/specs/wave-3.md §6.3): the steppers and radios, the three face views, the DOM table
 * beside them (passed in by Play) and the "Answer it now" button. The first screen is a prediction, which needs none of
 * this, so Level loads it on demand (and Play fetches it as soon as the learner has sent a prediction).
 *
 * Every control is a button or a radio, never a drag (WCAG 2.5.7): "−" and "+" step one notch along a ladder of whole
 * numbers, Page Up and Page Down four. A button whose press would change nothing (the end of its ladder, or the floor
 * `normalize` holds under M and N once a large tile lifts them) says so with `aria-disabled` and ignores the press, so
 * focus stays where the keyboard put it.
 */

import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { SIMPLIFICATIONS, type CubeLevel } from '@/lib/world/tiling'
import { cn } from '@/lib/utils'
import Mirror2D from './Mirror2D'
import {
  DTYPES,
  RASTERS,
  controlsFor,
  fixed,
  isChoice,
  stepControl,
  type ChoiceControl,
  type ControlDef,
  type CubeSession,
  type Explore,
  type NumberControl,
} from './session'

export interface ViewsProps {
  level: CubeLevel
  explore: Explore
  /** `explore` until the learner answers, then `check`: the button that opens the check shows only before. */
  step: CubeSession['step']
  /** The id of the DOM table the pictures point at. */
  mirrorId: string
  /** The table itself, rendered between the views and the check. */
  mirror: ReactNode
  onNudge: (id: NumberControl, dir: 1 | -1, coarse: boolean) => void
  onChoose: (id: ChoiceControl, value: string) => void
  onToCheck: () => void
}

const NOTCH = 'Page Up and Page Down step four notches.'

function Stepper({ def, explore, onStep }: { def: ControlDef; explore: Explore; onStep: (dir: 1 | -1, coarse: boolean) => void }) {
  const uid = useId()
  const id = def.id as NumberControl
  const value = explore[id]
  // A press is dead when it would change nothing: the end of the ladder, or a floor `normalize` holds (a large tile lifts
  // M and N, so "−" at the lifted GEMM does nothing though the ladder has rungs below). A coarse step moves at least as far.
  const atMin = stepControl(explore, id, -1)[id] === value
  const atMax = stepControl(explore, id, 1)[id] === value
  const keys = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      if (!(e.key === 'PageUp' ? atMax : atMin)) onStep(e.key === 'PageUp' ? 1 : -1, true)
    }
  }
  const button = (dir: 1 | -1, off: boolean) => (
    <button
      type="button"
      data-step={dir > 0 ? 'up' : 'down'}
      aria-label={`${dir > 0 ? 'Increase' : 'Decrease'} ${def.label}`}
      aria-disabled={off || undefined}
      aria-describedby={`${uid}-v`}
      onClick={() => !off && onStep(dir, false)}
      onKeyDown={keys}
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-sm border border-line-bright bg-surface-1 font-mono text-[16px] text-text-1 focus-visible:outline-2 focus-visible:outline-accent',
        off ? 'cursor-not-allowed text-text-3' : 'hover:border-accent hover:bg-accent-dim',
      )}
    >
      <span aria-hidden>{dir > 0 ? '+' : '−'}</span>
    </button>
  )
  return (
    <div role="group" aria-labelledby={`${uid}-l`} data-control={def.id} className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-line bg-surface-2 py-1 pl-3 pr-1">
      <div className="min-w-0">
        <span id={`${uid}-l`} className="block font-mono text-[13px] text-text-1">
          {def.label}
        </span>
        <span className="block text-[11px] leading-tight text-text-3">{def.hint}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {button(-1, atMin)}
        <span id={`${uid}-v`} data-value className="min-w-[3.5rem] text-center font-mono text-[14px] text-accent">
          {fixed(value)}
        </span>
        {button(1, atMax)}
      </div>
    </div>
  )
}

function Choice({ def, value, options, onPick }: { def: ControlDef; value: string; options: readonly string[]; onPick: (v: string) => void }) {
  const uid = useId()
  return (
    <fieldset data-control={def.id} className="rounded-md border border-line bg-surface-2 px-3 py-1.5">
      <legend className="px-1 font-mono text-[13px] text-text-1">{def.label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o} className="relative inline-flex min-h-11 cursor-pointer items-center">
            <input type="radio" name={`${uid}-${def.id}`} value={o} checked={value === o} onChange={() => onPick(o)} className="peer sr-only" />
            <span className="inline-flex min-h-11 items-center rounded-sm border border-line-bright px-3 font-mono text-[13px] text-text-2 peer-checked:border-accent peer-checked:bg-accent-dim peer-checked:text-text-1 peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {o === 'row' ? 'Row-major' : o === 'grouped' ? 'Grouped' : o.toUpperCase()}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export default function Views({ level, explore, step, mirrorId, mirror, onNudge, onChoose, onToCheck }: ViewsProps) {
  return (
    <div data-phase="explore" className="space-y-4">
      <p className="text-body-sm text-text-2">
        Step the controls and the three faces and the table follow. {NOTCH}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {controlsFor(level, explore).map((def) =>
          isChoice(def.id) ? (
            <Choice
              key={def.id}
              def={def}
              value={def.id === 'dtype' ? explore.dtype : explore.raster}
              options={def.id === 'dtype' ? DTYPES : RASTERS}
              onPick={(v) => onChoose(def.id as ChoiceControl, v)}
            />
          ) : (
            <Stepper key={def.id} def={def} explore={explore} onStep={(dir, coarse) => onNudge(def.id as NumberControl, dir, coarse)} />
          ),
        )}
      </div>
      <Mirror2D level={level} explore={explore} describedBy={mirrorId} />
      {mirror}
      <details className="rounded-md border border-line bg-surface-1 px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 font-mono text-[12px] text-text-2">What this model leaves out</summary>
        <ul className="list-disc space-y-1 pl-5 pb-2 text-body-sm text-text-2">
          {SIMPLIFICATIONS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
      {step === 'explore' && (
        <button
          type="button"
          onClick={onToCheck}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-auto"
        >
          Answer it now
        </button>
      )}
    </div>
  )
}
