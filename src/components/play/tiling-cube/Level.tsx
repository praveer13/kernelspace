/**
 * One level of the cube while it is being played (docs/specs/wave-3.md §6.3): predict, then explore, then check. The
 * debrief is Debrief.tsx, which Play.tsx renders when the level is answered.
 *
 * Predict is the lesson-block item of the level on the session's seed, as an estimate with no verdict. Explore is the
 * steppers and the three face views, with the DOM table (Mirror.tsx, passed in by Play) beside them; Check is the same item
 * as an exact question. Every control is a button or a radio, never a drag (WCAG 2.5.7): "−" and "+" step one notch along
 * a ladder of whole numbers, Page Up and Page Down four. A button at the end of its ladder says so with `aria-disabled`
 * and ignores the press, so focus stays where the keyboard put it.
 */

import { useEffect, useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import ItemCard from '@/components/items/ItemCard'
import type { ItemResult } from '@/lib/items/play'
import { SIMPLIFICATIONS, type CubeLevel } from '@/lib/world/tiling'
import { cn } from '@/lib/utils'
import Mirror2D from './Mirror2D'
import {
  DTYPES,
  LADDERS,
  RASTERS,
  controlsFor,
  fixed,
  genOf,
  isChoice,
  levelCount,
  predictChecker,
  predictedInstance,
  runOf,
  type ChoiceControl,
  type ControlDef,
  type CubeSession,
  type NumberControl,
} from './session'

export interface LevelProps {
  session: CubeSession
  level: CubeLevel
  /** The id of the DOM table the pictures point at. */
  mirrorId: string
  /** The table itself, rendered between the views and the check. */
  mirror: ReactNode
  /** Whether a step should take focus: false for the first paint, so loading the page or the lesson never steals it. */
  focus: boolean
  onPredicted: (r: ItemResult) => void
  onOpenViews: () => void
  onNudge: (id: NumberControl, dir: 1 | -1, coarse: boolean) => void
  onChoose: (id: ChoiceControl, value: string) => void
  onToCheck: () => void
  onChecked: (r: ItemResult) => void
  onToDebrief: () => void
}

const NOTCH = 'Page Up and Page Down step four notches.'

function Stepper({ def, value, onStep }: { def: ControlDef; value: number; onStep: (dir: 1 | -1, coarse: boolean) => void }) {
  const uid = useId()
  const ladder = LADDERS[def.id as NumberControl]
  const atMin = value <= ladder[0]
  const atMax = value >= ladder[ladder.length - 1]
  const keys = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      onStep(e.key === 'PageUp' ? 1 : -1, true)
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

export default function Level({ session, level, mirrorId, mirror, focus, onPredicted, onOpenViews, onNudge, onChoose, onToCheck, onChecked, onToDebrief }: LevelProps) {
  const uid = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const run = runOf(session)
  const gen = useMemo(() => genOf(level), [level])
  const predictItem = useMemo(() => ({ source: 'gen' as const, inst: predictedInstance(run.inst) }), [run.inst])
  const grader = useMemo(() => predictChecker(gen), [gen])
  const checkItem = useMemo(() => ({ source: 'gen' as const, inst: run.inst }), [run.inst])
  const { step, explore } = session
  const views = step === 'explore' || step === 'check'
  const at = `${step}:${session.at}`
  // The step already on screen when this mounts, unless the learner got here by acting: the first paint never takes focus.
  const seen = useRef<string | null>(focus ? null : at)

  // A new step takes focus on its heading, so a keyboard user continues from the top of what changed. The check's own
  // card takes focus on its first field instead.
  useEffect(() => {
    if (seen.current === at) return
    seen.current = at
    if (step !== 'check') heading.current?.focus()
  }, [at, step])

  return (
    <section aria-labelledby={`${uid}-h`} data-level={level.n} data-step={step} className="space-y-4">
      <p className="section-label">{levelCount(session)}</p>
      <h3 ref={heading} id={`${uid}-h`} tabIndex={-1} className="font-display text-h4 text-text-1 outline-none">
        {level.title}
      </h3>
      <p className="text-body-sm text-text-2">{level.question}</p>

      {step === 'predict' && (
        <div data-phase="predict">
          <p className="mb-3 text-body-sm text-text-2">
            {level.n === 1 ? 'Predict the intensity of this tile first, then open the views to check it.' : 'Predict first, then open the views to check it.'} A rough number is fine, and there
            is no verdict yet.
          </p>
          <ItemCard
            key={`predict:${level.n}:${run.inst.seed}`}
            item={predictItem}
            gen={grader}
            deferVerdict
            eyebrow="your prediction"
            nextLabel="Open the views"
            onResult={onPredicted}
            onNext={onOpenViews}
          />
        </div>
      )}

      {views && (
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
                <Stepper key={def.id} def={def} value={explore[def.id as NumberControl]} onStep={(dir, coarse) => onNudge(def.id as NumberControl, dir, coarse)} />
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
      )}

      {step === 'check' && (
        <div data-phase="check">
          <ItemCard
            key={`check:${level.n}:${run.inst.seed}`}
            item={checkItem}
            gen={gen}
            autoFocus
            eyebrow="check · the same question, exact"
            nextLabel="See the debrief"
            onResult={onChecked}
            onNext={onToDebrief}
          />
        </div>
      )}
    </section>
  )
}
