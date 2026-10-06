/**
 * PlacementWalk: "Already know some of this?" in at most 20 items and about 15 minutes (docs/specs/wave-1.md
 * §7.1; PLAN-100X K3). It replaces the 8-item modal on /curriculum. The rules (solid, missed, the tie-break,
 * the cap, the blind-pattern read) live in `src/lib/learner/placement.ts`; this component loads what the walk
 * needs (the generator families for the KCs they cover, and which checkpoint items the learner has already
 * answered), plays the items one at a time in the item player, and on the last answer writes
 * `completePlacement` once. Nothing is written before that: leaving earlier saves nothing.
 *
 * Nothing locks (W8). **Not sure** skips an item as a miss, the Rust questions can be skipped on
 * `serving-first` (where R arrives as reading items only), and the result says in words where the learner
 * starts and why, never a score. The Rust items' Java analogue lives in each item's explanation, which the
 * player shows after the answer and not before.
 *
 * It is an inline section, not a dialog: 20 items do not fit a focus trap on a phone. Focus goes to the
 * heading when it opens, to the first control of each new item, and to the result heading at the end. Keys
 * inside a card are the item player's. Every state names its meaning in words and an icon, never colour alone.
 */
import { ArrowRight, Check, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router'
import ItemCard from '@/components/items/ItemCard'
import { kcById, KCS, RUST_ANCHOR_KC } from '@/data/kc'
import { ALL_LESSONS, lessonPath } from '@/data/lessons'
import { R_ANCHORS } from '@/data/placement/anchors'
import { loadFamily } from '@/lib/items/registry'
import type { ItemResult } from '@/lib/items/play'
import { getLedgerClient } from '@/lib/ledger/client'
import type { LearningPath } from '@/lib/ledger/types'
import { cachedPathPlan, lessonCode, type PathGraph } from '@/lib/learner/paths'
import {
  MAX_ITEMS,
  PROBES,
  advance,
  answerOf,
  canSkipAnchor,
  authoredIndex,
  currentLesson,
  finishWalk,
  placementJson,
  record,
  skipAnchor,
  skippedAnswer,
  startWalk,
  walkProgress,
  type Step,
  type WalkContent,
  type WalkOutcome,
  type WalkState,
} from '@/lib/learner/placement'
import { makeGenPool } from '@/lib/learner/ticket'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'
import { getTrack } from '@/lib/tracks'
import { cn } from '@/lib/utils'

export interface PlacementWalkProps {
  /** `boot:path`: the Rust questions are optional on `serving-first`. */
  path: LearningPath
  /** Close the walk (before the end, or after the result). */
  onClose: () => void
  className?: string
}

/** The plan after a placement reads lessons and the graph only: labs do not change which lesson is current. */
const GRAPH: PathGraph = { kcs: KCS, lessons: ALL_LESSONS, labs: [] }

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line-bright bg-surface-2 px-5 font-display text-[15px] font-semibold text-text-1 hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
const LINK_BUTTON =
  'inline-flex min-h-11 items-center text-body-sm text-text-2 underline decoration-line-bright underline-offset-4 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

/* ------------------------------ what a walk needs ------------------------------ */

/** Refs of the checkpoint and authored items the learner has answered, or nothing when the ledger cannot be read (the walk still works). */
async function loadAnswered(): Promise<Set<string>> {
  try {
    const client = await getLedgerClient()
    const events = await client.events({ kinds: ['item'] })
    return new Set(events.map((e) => e.ref).filter((r) => r.startsWith('quiz:') || r.startsWith('item:')))
  } catch {
    return new Set()
  }
}

async function loadContent(): Promise<WalkContent> {
  const ids = [...new Set(PROBES.flatMap((kc) => kcById(kc)?.gen ?? []))]
  // a family that fails to load is left out: its KC falls back to checkpoint items, or goes unprobed
  const [settled, answered] = await Promise.all([Promise.allSettled(ids.map((id) => loadFamily(id))), loadAnswered()])
  const gens = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  return {
    pool: makeGenPool(new Map(gens.map((g) => [g.id, g])), (kc) => kcById(kc)?.gen ?? []),
    authored: authoredIndex(ALL_LESSONS, R_ANCHORS),
    answered,
  }
}

interface Session {
  content: WalkContent
  walk: WalkState
  /** The item on screen; null once the walk is over. */
  step: Step | null
}

const trackOf = (kc: string) => kcById(kc)?.track ?? 't0'

/* ------------------------------ the component ------------------------------ */

export default function PlacementWalk({ path, onClose, className }: PlacementWalkProps) {
  const headingId = useId()
  const completePlacement = useProgress((s) => s.completePlacement)
  const [session, setSession] = useState<Session | null>(null)
  // the verdict of the item on screen is showing: Next is offered, Not sure is not
  const [answered, setAnswered] = useState(false)
  const [outcome, setOutcome] = useState<WalkOutcome | null>(null)
  const written = useRef(false)
  const rootRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const resultRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let alive = true
    loadContent().then((content) => {
      if (!alive) return
      const first = advance(startWalk(path, freshSeed()), content)
      setSession({ content, walk: first.state, step: first.step })
    })
    return () => {
      alive = false
    }
  }, [path])

  // opening the walk brings it into view and names it; a result names itself the same way
  useEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: 'start' })
    headingRef.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    if (outcome) resultRef.current?.focus()
  }, [outcome])

  /** Moves on from `walk` (with the answer already recorded): the next item, or the end. */
  const proceed = (s: Session, walk: WalkState) => {
    const next = advance(walk, s.content)
    if (next.step) {
      setSession({ ...s, walk: next.state, step: next.step })
      setAnswered(false)
      return
    }
    setSession({ ...s, walk: next.state, step: null })
    if (written.current) return
    written.current = true
    const done = finishWalk(next.state, trackOf, new Date().toISOString())
    completePlacement(placementJson(done.result))
    setOutcome(done)
  }

  const onResult = (r: ItemResult) => {
    if (!session?.step) return
    setSession({ ...session, walk: record(session.walk, session.step, answerOf(session.step.item, r)) })
    setAnswered(true)
  }
  const notSure = () => {
    if (!session?.step || answered) return
    proceed(session, record(session.walk, session.step, skippedAnswer(session.step.item)))
  }
  const skipRust = () => {
    if (!session || answered) return
    proceed(session, skipAnchor(session.walk))
  }
  const next = () => session && proceed(session, session.walk)

  // after an answer, is there another item? It names the Next button.
  const upcoming = useMemo(() => (session && answered ? advance(session.walk, session.content).step : undefined), [session, answered])

  const shell = cn('min-w-0 max-w-full scroll-mt-20 rounded-lg border border-line bg-surface-1 p-4 sm:p-5', className)
  const header = (
    <div className="mb-4">
      <div className="flex items-start justify-between gap-3">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-display text-h4 text-text-1 focus-visible:outline-none">
          Placement walk
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={outcome ? 'Close the placement walk' : 'Leave the placement walk without saving'}
          className="-mr-2 -mt-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-text-3 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      <p className="-mt-2 max-w-measure text-body-sm text-text-2">
        At most {MAX_ITEMS} items, about 15 minutes. Answer what you can. A miss only tells us where to start, and nothing here locks a
        lesson.{outcome ? '' : ' Leaving before the end saves nothing.'}
      </p>
    </div>
  )

  if (!session) {
    return (
      <section ref={rootRef} aria-labelledby={headingId} aria-busy="true" id="placement-walk" className={shell}>
        {header}
        <p className="text-body-sm text-text-2">Preparing your items.</p>
      </section>
    )
  }

  if (outcome) {
    return (
      <section ref={rootRef} aria-labelledby={headingId} id="placement-walk" className={shell}>
        {header}
        <Result outcome={outcome} path={path} headingRef={resultRef} onClose={onClose} />
      </section>
    )
  }

  const { step, walk } = session
  if (!step) return null
  const p = walkProgress(walk)
  // only while skipAnchor can act: not on the anchor's second item, where it would do nothing
  const rustOptional = step.kc === RUST_ANCHOR_KC && canSkipAnchor(walk)
  return (
    <section ref={rootRef} aria-labelledby={headingId} id="placement-walk" className={shell}>
      {header}
      <ItemCard
        key={`${walk.seed}:${step.ordinal}`}
        item={step.item}
        seed={step.seed}
        eyebrow={`Item ${step.ordinal} · topic ${p.topic} of ${p.topics} · about ${Math.max(1, p.minutes)} min left`}
        autoFocus={step.ordinal > 1}
        onResult={onResult}
        onNext={next}
        nextLabel={upcoming === null ? 'See your placement' : 'Next item'}
      />
      {!answered && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
          <button type="button" onClick={notSure} className={LINK_BUTTON}>
            Not sure: skip this one
          </button>
          {rustOptional && (
            <button type="button" onClick={skipRust} className={LINK_BUTTON}>
              Skip the Rust questions
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/* ------------------------------ the result ------------------------------ */

const ANCHOR_LINE: Record<WalkOutcome['result']['rustAnchor'], string> = {
  solid: 'Rust reading: solid. The Rust Zero lessons are offered as test-outs instead of lessons.',
  missed: 'Rust reading: not yet. Rust Zero stays in your plan, braided in just before the lessons that need it.',
  skipped: 'Rust reading: not asked. The Rust Zero lessons are offered as test-outs.',
}

function titles(kcs: readonly string[]): string {
  return kcs.map((kc) => kcById(kc)?.title ?? kc).join(', ')
}

function Result({ outcome, path, headingRef, onClose }: { outcome: WalkOutcome; path: LearningPath; headingRef: RefObject<HTMLHeadingElement | null>; onClose: () => void }) {
  const lessons = useProgress((s) => s.lessons)
  const { result, pattern, slips } = outcome
  const track = getTrack(result.entryTrack)
  const plan = cachedPathPlan(path, GRAPH, result)
  const startId = currentLesson(plan, (id) => lessons[id]?.status)
  const start = startId ? ALL_LESSONS.find((l) => l.id === startId) : undefined
  return (
    <div className="space-y-4">
      <h3 ref={headingRef} tabIndex={-1} className="font-display text-h3 text-text-1 focus-visible:outline-none">
        {pattern ? 'Start at the beginning' : `Start at ${track?.code ?? result.entryTrack.toUpperCase()}${track ? ` · ${track.name}` : ''}`}
      </h3>

      {pattern && (
        <p className="max-w-measure text-body-sm text-text-1">
          {pattern === 'position'
            ? 'Your multiple-choice answers all sat in the same position, so they say little about what you know.'
            : 'Your multiple-choice answers were all the longest option, so they say little about what you know.'}{' '}
          The ramp starts at its first lesson, and every lesson has a test-out when you want to prove a part of it.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="flex items-center gap-2 font-mono text-label uppercase text-text-3">
            <Check size={14} className="text-accent" aria-hidden /> solid ({result.solidKcs.length})
          </p>
          <p className="mt-1 text-body-sm text-text-2">{result.solidKcs.length > 0 ? titles(result.solidKcs) : 'None yet.'}</p>
        </div>
        <div>
          <p className="flex items-center gap-2 font-mono text-label uppercase text-text-3">
            <X size={14} className="text-danger" aria-hidden /> to work on ({result.missedKcs.length})
          </p>
          <p className="mt-1 text-body-sm text-text-2">{result.missedKcs.length > 0 ? titles(result.missedKcs) : 'None.'}</p>
        </div>
      </div>

      <p className="max-w-measure text-body-sm text-text-2">{ANCHOR_LINE[result.rustAnchor]}</p>

      {slips.length > 0 && (
        <div>
          <p className="font-mono text-label uppercase text-text-3">worth a second look</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-body-sm text-text-2">
            {slips.map((s) => (
              <li key={s.id}>{s.message}</li>
            ))}
          </ul>
        </div>
      )}

      {result.solidKcs.length > 0 && (
        <p className="max-w-measure text-body-sm text-text-2">
          Each solid idea joins your review queue over the next days and is re-checked 7 days after it joins, so a lucky guess does not stay on the books.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {start && (
          <Link to={lessonPath(start)} className={cn(BUTTON, 'border-transparent bg-accent text-accent-foreground hover:border-transparent hover:bg-accent/90')}>
            Start at {lessonCode(start.id)}
            <ArrowRight size={16} aria-hidden />
          </Link>
        )}
        <button type="button" onClick={onClose} className={BUTTON}>
          Browse the map
        </button>
      </div>
    </div>
  )
}
