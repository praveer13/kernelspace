/**
 * The block-placement play (docs/specs/wave-1.md §11): Play → Debrief → Compose → In production → Build this.
 * One component for the lesson embed (PlayBlock) and the full-screen route (/play/block-placement).
 *
 * The control is the chip list: every free run is a full-width row (at least 44 px tall) that takes the
 * block, or is disabled and says why. The grid is the picture and Mirror.tsx its DOM twin. Tab and the
 * arrow keys cycle the chips that fit and Enter places; frees apply by themselves, one per turn.
 *
 * The hidden reference runs inside the session (the lockstep runner plays it up front) but nothing on
 * this screen reads it: the debrief is the only reader, and it renders only after "See the debrief".
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { Button, LinkButton } from '@/components/Button'
import Compose from '@/components/play/block-placement/Compose'
import Debrief from '@/components/play/block-placement/Debrief'
import Grid from '@/components/play/block-placement/Grid'
import Mirror from '@/components/play/block-placement/Mirror'
import ProductionCard from '@/components/play/block-placement/ProductionCard'
import {
  BLOCK_PLACEMENT,
  BUILD_THIS,
  applyFree,
  canSkip,
  cellWord,
  debrief,
  freshEntropy,
  giveUp,
  heapOf,
  newSession,
  placeAt,
  recordOf,
  skip,
  stageOf,
  type Session,
} from '@/data/plays'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'
import { cells, type RunChoice } from '@/lib/world/placement'
import { PLAY_PRACTICE_SEED, drawPlacementTrace, makePlacementTrace } from '@/lib/world/traces'

/** How long a freed run shows before the next op, in ms (0 under reduced motion). */
const FREE_DELAY_MS = 700

const REDUCED = '(prefers-reduced-motion: reduce)'
const subscribeReduced = (onChange: () => void) => {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(REDUCED)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
const reducedNow = () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches
const useReducedMotion = () => useSyncExternalStore(subscribeReduced, reducedNow, () => false)

export interface BlockPlacementPlayProps {
  /** `embed` inside the lesson, `page` on /play/block-placement. */
  mode: 'embed' | 'page'
}

const practice = () => newSession(makePlacementTrace(PLAY_PRACTICE_SEED), 'practice')

/** One free run as a chip. Fitting chips place; the others are disabled and say why. */
function Chip({ choice, size, onPlace, onPreview }: { choice: RunChoice; size: number; onPlace: () => void; onPreview: (on: boolean) => void }) {
  const start = cells(choice.start)
  const run = cells(choice.size)
  return (
    <button
      type="button"
      data-chip
      disabled={!choice.fits}
      onClick={onPlace}
      onFocus={() => choice.fits && onPreview(true)}
      onBlur={() => onPreview(false)}
      onMouseEnter={() => choice.fits && onPreview(true)}
      onMouseLeave={() => onPreview(false)}
      aria-label={choice.fits ? `Place ${cellWord(size)} at cell ${start}, in the ${cellWord(run)} free run` : undefined}
      className={cn(
        'flex min-h-11 w-full items-center justify-between gap-3 rounded-sm border px-3 py-2 text-left font-mono text-[13px] transition-colors duration-150',
        choice.fits
          ? 'border-line-bright bg-surface-2 text-text-1 hover:border-accent hover:bg-accent-dim'
          : 'cursor-not-allowed border-line bg-transparent text-text-3',
      )}
    >
      <span>
        Cell {start} <span className="text-text-3">· {cellWord(run)} free</span>
      </span>
      <span className={choice.fits ? 'text-accent' : 'text-text-3'}>{choice.fits ? `leaves ${run - size}` : choice.why}</span>
    </button>
  )
}

export default function BlockPlacementPlay({ mode }: BlockPlacementPlayProps) {
  const uid = useId()
  const recordPlay = useProgress((s) => s.recordPlay)
  const reduced = useReducedMotion()
  const [session, setSession] = useState<Session>(practice)
  const [hover, setHover] = useState<number | null>(null)
  // Wall-clock of the first move, for the ledger's `ms`. Set in handlers, so a render stays pure.
  const firstMoveAt = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const stage = useMemo(() => stageOf(session), [session])
  const inDebrief = session.summary !== null
  const turns = session.ps.turns
  const freeOp = stage.kind === 'free' ? stage.op : -1

  // Frees apply by themselves, one per turn, so the freed run can show.
  useEffect(() => {
    if (stage.kind !== 'free' || inDebrief) return
    const id = setTimeout(() => setSession((s) => (stageOf(s).kind === 'free' ? applyFree(s) : s)), reduced ? 0 : FREE_DELAY_MS)
    return () => clearTimeout(id)
  }, [stage.kind, freeOp, inDebrief, reduced])

  // After a move the chip that was pressed is gone: focus the first chip that fits, so Enter keeps playing (spec §16.2).
  // Not before the first move, so loading the page or the lesson never steals focus.
  useEffect(() => {
    if (turns === 0 || stage.kind !== 'ask') return
    listRef.current?.querySelector<HTMLButtonElement>('[data-chip]:not(:disabled)')?.focus({ preventScroll: true })
  }, [turns, stage.kind])

  const place = useCallback((start: number) => {
    firstMoveAt.current ??= Date.now()
    setHover(null)
    setSession((s) => placeAt(s, start))
  }, [])

  const enterDebrief = (next: Session) => {
    const done = debrief(next)
    setSession(done)
    const result = recordOf(done, firstMoveAt.current === null ? undefined : Date.now() - firstMoveAt.current)
    if (result) recordPlay(result)
  }

  const again = () => {
    firstMoveAt.current = null
    setHover(null)
    setSession(newSession(drawPlacementTrace(freshEntropy()).trace, 'unseen'))
  }

  // Arrow keys move between the chips that fit (Tab already does); Enter and Space press the focused one.
  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }
    const chips = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-chip]:not(:disabled)'))
    if (chips.length === 0) return
    const at = chips.indexOf(document.activeElement as HTMLButtonElement)
    let to = -1
    if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = chips.length - 1
    else if (e.key in keys) to = (at + keys[e.key] + chips.length) % chips.length
    if (to < 0) return
    e.preventDefault()
    chips[to].focus()
  }

  if (inDebrief) {
    return (
      <div className="space-y-6" data-play={BLOCK_PLACEMENT.id} data-mode={mode} data-phase-now="debrief">
        <Debrief session={session} onAgain={again} />
        <Compose key={session.trace.seed} trace={session.trace} />
        <ProductionCard />
        <div className="rounded-lg border border-accent/40 bg-accent-dim/40 p-4 sm:p-5">
          <p className="section-label">Code</p>
          <p className="mt-2 text-body-sm text-text-2">
            You have placed blocks by hand and composed a policy. Lab 01 is the same allocator in Rust, and its first stage passes in two minutes.
          </p>
          <div className="mt-3">
            <LinkButton to={BUILD_THIS.to}>{BUILD_THIS.label}</LinkButton>
          </div>
        </div>
        {mode === 'embed' && (
          <p className="font-mono text-[11px] text-text-3">
            <Link to={`/play/${BLOCK_PLACEMENT.id}`} className="hover:text-accent">
              open this play full screen
            </Link>
          </p>
        )}
      </div>
    )
  }

  const view = heapOf(session)
  const live = stage.kind === 'ask' || stage.kind === 'stuck' ? stage : null
  const size = live ? cells(live.req.size) : 0
  const pickable = live && live.kind === 'ask' ? new Set(live.choices.filter((c) => c.fits).map((c) => c.start)) : undefined
  const previewSpan = live && hover !== null ? { start: cells(hover), size } : null
  const total = session.trace.ops.length
  const mirrorId = `${uid}-mirror`
  // What a screen reader hears each turn: the turn's line, then the next request.
  const announce = [session.line, live ? `Op ${live.op + 1} of ${total}: block ${live.req.id} needs ${cellWord(size)}.` : ''].filter(Boolean).join(' ')

  return (
    <div className="space-y-4" data-play={BLOCK_PLACEMENT.id} data-mode={mode} data-phase-now="play">
      <p className="font-mono text-[12px] text-text-3">
        About {BLOCK_PLACEMENT.minutes} minutes · {session.provenance === 'unseen' ? 'new numbers' : 'the shared practice trace'}
      </p>
      <p className="text-body-sm text-text-2">
        Blocks arrive one at a time. Put each one in a free run, using the list under the grid. Some blocks are freed along the way. The play ends when a block fits nowhere, and
        only then do you see how a reference policy did.
      </p>

      <Grid
        view={view}
        label={`Your heap: ${cellWord(cells(view.totalFree))} free, largest free run ${cellWord(cells(view.largestFree))}`}
        describedBy={mirrorId}
        preview={previewSpan}
        flash={session.freed}
        pickable={pickable}
        onPick={place}
      />
      <p aria-hidden className="min-h-5 font-mono text-[12px] text-text-2">
        {session.line}
      </p>

      {stage.kind === 'over' && (
        <div>
          <p className="text-body-sm text-text-1">You placed every request in the trace.</p>
          <Button className="mt-3" onClick={() => enterDebrief(session)}>
            See the debrief
          </Button>
        </div>
      )}

      {stage.kind === 'free' && (
        <p className="font-mono text-[13px] text-text-1">
          Op {stage.op + 1} of {total}: a block is freed.
        </p>
      )}

      {live && (
        <div>
          <p className="font-mono text-[13px] text-text-1">
            Op {live.op + 1} of {total}: block {live.req.id} needs <span className="text-accent">{cellWord(size)}</span>
          </p>
          <p className="mt-0.5 font-mono text-[12px] text-text-3">
            {cellWord(cells(live.view.totalFree))} free · largest run {cells(live.view.largestFree)}
          </p>
          {live.kind === 'stuck' ? (
            <div className="mt-3">
              <p className="text-body-sm text-text-1">
                No free run holds {cellWord(size)}: fragmentation stopped you, with {cellWord(cells(live.view.totalFree))} free and a largest run of {cells(live.view.largestFree)}.
              </p>
              <Button className="mt-3" onClick={() => enterDebrief(giveUp(session))}>
                See the debrief
              </Button>
            </div>
          ) : null}
          <div
            ref={listRef}
            role="group"
            aria-label={`Free runs for block ${live.req.id}, ${cellWord(size)}`}
            onKeyDown={onListKey}
            className="mt-3 space-y-2"
          >
            {live.choices.map((c) => (
              <Chip key={c.start} choice={c} size={size} onPlace={() => place(c.start)} onPreview={(on) => setHover(on ? c.start : null)} />
            ))}
          </div>
        </div>
      )}

      {canSkip(session) && (
        <div>
          <Button variant="ghost" className="min-h-11" onClick={() => enterDebrief(skip(session))}>
            Skip to the debrief
          </Button>
          <p className="font-mono text-[11px] text-text-3">The reference finishes your run from where you stand.</p>
        </div>
      )}

      <Mirror id={mirrorId} view={view} title="Your heap" line={announce} />
    </div>
  )
}
