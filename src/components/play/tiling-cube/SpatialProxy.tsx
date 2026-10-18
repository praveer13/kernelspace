/**
 * The cube's two spatial puzzles (docs/specs/wave-3.md §16.1, task 3s-02; docs/prereg/tiling-cube-3d.md section 3), offered
 * once the six levels are done: how many unit cubes make a stack (a number), and which order three flat views of another
 * stack come in (an ordered list, moved with buttons, never dragged: WCAG 2.5.7). A move keeps focus on the row that moved:
 * on the button pressed, or on the row's other one when the press took the row to an end and disabled the button (a disabled
 * button cannot hold focus, which would drop to the page). They are opt-in: nothing happens
 * until the learner presses "Take the two puzzles", and nothing is lost by not pressing it. Each answer is one `item`
 * event with src `practice` and no KC (spatial.ts), and the learner is not told which were right.
 *
 * The drawings are the question, so they have no text version that gives the answer away (WCAG 1.1.1's exception for a
 * test); the offer says so, and skipping is the same as not pressing the button. A learner who answered both before is not
 * asked again (a second go would measure practice), which the ledger decides, not this page's state.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { useProgress } from '@/lib/progress'
import type { ItemResponse, LedgerEvent } from '@/lib/ledger/types'
import {
  COUNT_FIGURE,
  SPATIAL_PREFIX,
  START_ORDER,
  VIEWS_FIGURE,
  VIEW_NAMES,
  boundsOf,
  countEvent,
  cubesOf,
  facePoints,
  orderEvent,
  parseCount,
  spatialRef,
  type FaceTone,
  type Heights,
  type ViewId,
} from './spatial'

/** What the puzzles read and write; tests replace it. */
export interface SpatialEnv {
  /** The ledger's events whose ref starts with the prefix. */
  history(refPrefix: string): Promise<readonly Pick<LedgerEvent, 'ref'>[]>
  record(items: ItemResponse[]): void
  now(): number
}

const liveEnv: SpatialEnv = {
  history: async (refPrefix) => (await useProgress.controls.engine()).events({ refPrefix }),
  record: (items) => useProgress.getState().recordItems(items),
  now: () => Date.now(),
}

const TONES: Record<FaceTone, string> = { top: 'fill-accent/30', left: 'fill-info/25', right: 'fill-amber/25' }
const FACES: readonly FaceTone[] = ['top', 'left', 'right']

/** An isometric stack of unit cubes, nearer cubes over farther ones. Its name says what it is and not how many, since it is the question. */
export function SpatialFigure({ heights, label }: { heights: Heights; label: string }) {
  const [x, y, w, h] = boundsOf(heights)
  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`} role="img" aria-label={label} className="mx-auto h-auto w-full max-w-[280px]" style={{ aspectRatio: `${w} / ${h}` }} data-spatial-figure>
      {cubesOf(heights).map((c) => (
        <g key={`${c.a}.${c.b}.${c.z}`}>
          {FACES.map((face) => (
            <polygon key={face} points={facePoints(c, face)} className={`${TONES[face]} stroke-line-bright`} strokeWidth={0.75} strokeLinejoin="round" />
          ))}
        </g>
      ))}
    </svg>
  )
}

type Step = 'checking' | 'offer' | 'count' | 'order' | 'done' | 'before'

const FIGURE_LABEL = 'An isometric drawing of a solid stack of unit cubes in the corner of a room. The drawing is the question, so it has no text version; you may skip these puzzles.'

export interface SpatialProxyProps {
  env?: Partial<SpatialEnv>
}

export default function SpatialProxy({ env: envIn }: SpatialProxyProps) {
  const env: SpatialEnv = { ...liveEnv, ...envIn }
  const uid = useId()
  const [step, setStep] = useState<Step>('checking')
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const [order, setOrder] = useState<ViewId[]>([...START_ORDER])
  const [moved, setMoved] = useState('')
  const shownAt = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)
  // The order puzzle's buttons by `${view}:${dir}`, and the one a move hands focus to once the list has re-rendered.
  const moveButtons = useRef(new Map<string, HTMLButtonElement>())
  const focusAfterMove = useRef<string | null>(null)

  // The ledger says whether both answers exist. Until it has answered nothing is offered, so a learner who did them is not asked twice.
  useEffect(() => {
    let live = true
    env.history(SPATIAL_PREFIX).then(
      (events) => {
        if (!live) return
        const have = new Set(events.map((e) => e.ref))
        setStep(have.has(spatialRef(1)) && have.has(spatialRef(2)) ? 'before' : 'offer')
      },
      () => live && setStep('offer'),
    )
    return () => {
      live = false
    }
    // the environment is read once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new step takes focus on its heading, except the first paint.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (step === 'count' || step === 'order' || step === 'done') heading.current?.focus()
  }, [step])

  // After a move, focus follows the row that moved. React may re-insert a moved row's node, which drops focus even when its
  // button stays enabled, so focus is put back every time, not only when the button pressed was disabled.
  useEffect(() => {
    const key = focusAfterMove.current
    focusAfterMove.current = null
    if (key) moveButtons.current.get(key)?.focus()
  }, [order])

  const open = () => {
    shownAt.current = env.now()
    setStep('count')
  }

  const recordCount = () => {
    const n = parseCount(text)
    if (n === null) {
      setBad(true)
      return
    }
    setBad(false)
    env.record([countEvent(n, Math.max(0, env.now() - shownAt.current))])
    shownAt.current = env.now()
    setStep('order')
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    // the pressed button is disabled once its row reaches that end, so focus goes to the row's other button
    const pressedOff = dir < 0 ? j === 0 : j === next.length - 1
    focusAfterMove.current = `${next[j]}:${(dir < 0) !== pressedOff ? 'up' : 'down'}`
    setOrder(next)
    setMoved(`${VIEW_NAMES[next[j]]} is now number ${j + 1} of ${next.length}.`)
  }

  const moveRef = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) moveButtons.current.set(key, el)
    else moveButtons.current.delete(key)
  }

  const recordOrder = () => {
    env.record([orderEvent(order, Math.max(0, env.now() - shownAt.current))])
    setStep('done')
  }

  if (step === 'checking') return null

  return (
    <section aria-labelledby={`${uid}-h`} data-spatial={step} className="space-y-3 rounded-md border border-line bg-surface-1 p-4">
      {step === 'offer' && (
        <>
          <h3 id={`${uid}-h`} className="font-display text-h4 text-text-1">
            Optional: two spatial puzzles
          </h3>
          <p className="text-body-sm text-text-2">
            About two minutes, and not part of the lesson. They are not marked for you: they only let us see whether the 3D view suits some learners more than others. The pictures have no text
            version, because the picture is the question. Skipping them changes nothing.
          </p>
          <Button variant="secondary" onClick={open} className="min-h-11">
            Take the two puzzles
          </Button>
        </>
      )}

      {step === 'before' && (
        <>
          <h3 id={`${uid}-h`} className="font-display text-h4 text-text-1">
            The spatial puzzles
          </h3>
          <p className="text-body-sm text-text-2">You answered both before, so they are not offered again: a second go would measure practice.</p>
        </>
      )}

      {step === 'count' && (
        <>
          <h3 id={`${uid}-h`} ref={heading} tabIndex={-1} className="font-display text-h4 text-text-1 outline-none">
            Puzzle 1 of 2: count the cubes
          </h3>
          <SpatialFigure heights={COUNT_FIGURE} label={FIGURE_LABEL} />
          <p className="text-body-sm text-text-2">
            This solid stack of unit cubes sits in the corner of a room. Every cube rests on the floor or on another cube, there are no gaps, and the stack steps down toward you. How many cubes make
            it, counting the ones you cannot see?
          </p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              recordCount()
            }}
          >
            <label htmlFor={`${uid}-n`} className="space-y-1 text-body-sm text-text-1">
              <span className="block">Number of cubes</span>
              <input
                id={`${uid}-n`}
                inputMode="numeric"
                autoComplete="off"
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setBad(false)
                }}
                aria-invalid={bad}
                aria-describedby={bad ? `${uid}-err` : undefined}
                className="block min-h-11 w-28 rounded-sm border border-line bg-surface-2 px-3 font-mono text-body text-text-1 focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
            <Button type="submit" variant="secondary" className="min-h-11">
              Record my answer
            </Button>
          </form>
          {bad && (
            <p id={`${uid}-err`} role="alert" className="text-body-sm text-danger">
              Write a whole number of cubes, such as 12.
            </p>
          )}
        </>
      )}

      {step === 'order' && (
        <>
          <h3 id={`${uid}-h`} ref={heading} tabIndex={-1} className="font-display text-h4 text-text-1 outline-none">
            Puzzle 2 of 2: order the views
          </h3>
          <SpatialFigure heights={VIEWS_FIGURE} label={FIGURE_LABEL} />
          <p className="text-body-sm text-text-2">
            Same rules, another solid. Picture three flat drawings of it, each made of unit squares: the <strong className="text-text-1">top view</strong>, looking straight down; the{' '}
            <strong className="text-text-1">left view</strong>, looking straight at the left-hand face in the drawing; and the{' '}
            <strong className="text-text-1">right view</strong>, looking straight at the right-hand face in the drawing. A square shows if any cube lies behind it along the line of sight. Put the
            three views in order, from the one with the fewest squares to the one with the most.
          </p>
          <ol className="space-y-2" aria-label="Views, fewest squares first">
            {order.map((v, i) => (
              <li key={v} className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface-2 px-3 py-1">
                <span className="w-24 text-body-sm text-text-1">
                  {i + 1}. {VIEW_NAMES[v]}
                </span>
                <Button ref={moveRef(`${v}:up`)} variant="ghost" className="min-h-11 !px-3" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${VIEW_NAMES[v]} up`}>
                  Up
                </Button>
                <Button
                  ref={moveRef(`${v}:down`)}
                  variant="ghost"
                  className="min-h-11 !px-3"
                  disabled={i === order.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${VIEW_NAMES[v]} down`}
                >
                  Down
                </Button>
              </li>
            ))}
          </ol>
          <p role="status" className="min-h-5 font-mono text-[11px] text-text-3">
            {moved}
          </p>
          <Button variant="secondary" onClick={recordOrder} className="min-h-11">
            Record my order
          </Button>
        </>
      )}

      {step === 'done' && (
        <>
          <h3 id={`${uid}-h`} ref={heading} tabIndex={-1} className="font-display text-h4 text-text-1 outline-none">
            Recorded
          </h3>
          <p className="text-body-sm text-text-2">Thank you. They are not marked for you, and nothing about your lessons changes.</p>
        </>
      )}
    </section>
  )
}
