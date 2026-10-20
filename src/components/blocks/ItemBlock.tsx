/**
 * The item block (Wave 2, docs/specs/wave-2.md §5.2; task 2a-12): generated items inside a lesson. The learner
 * predicts the first instance before any worked step, then answers items on fresh seeds at the staircase
 * level, and the block is done after `count` correct answers on distinct instances ("3/3 · done"). Nothing locks:
 * "New numbers" is always there, before an answer (a different instance) and after it (the next one).
 *
 * When every KC the block's variants teach has a card with predicted recall >= 0.9, the block starts collapsed,
 * "You know this. Practice anyway?", and writes nothing until the learner asks. A reload reads the block back
 * from the ledger (its prediction, its answers, a first instance still unanswered), so nothing is asked twice.
 *
 * A `reading` block (docs/specs/serving-reading.md §5.2) is the same block over compile-bank variants, one that only
 * serving-first learners are walked into: on another path a fresh one starts collapsed, "Rust Zero covers this on your
 * path. Practice anyway?", and writes nothing until the learner asks. Compile blocks say "snippet" where the numeric
 * families say "numbers".
 *
 * Planning runs under `settle` (src/lib/items/on-demand.ts): a family that loads data on demand (the compile bank's groups)
 * returns no instance on a cold load until what it asked for has landed, and `settle` waits for that and plans again. The
 * draw number is taken before the wait, so a plan stays a pure function of the session seed and its draw. Every stage
 * change carries a visit token, so a slow load can never overwrite a newer stage.
 *
 * The shared item player (ItemCard) draws, grades and owns the keys (A-D pick, 1-3 confidence, Enter) and the
 * `aria-live` verdict, exactly as on /today; this file owns the sequence and the ledger write. The pure parts are in
 * src/lib/learner/item-block.ts. XP follows from the events' `nsec` (`itemSec`, under the daily cap).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import ItemCard from '@/components/items/ItemCard'
import type { ItemBlock as ItemBlockData } from '@/data/lessons/types'
import { loadFamily } from '@/lib/items/registry'
import type { Gen, PlayableItem } from '@/lib/items/types'
import {
  blockEventOf,
  blockNeeds,
  familyPrefix,
  itemBlockKcs,
  lessonItemResponse,
  makeAt,
  planItem,
  predictGen,
  predictInstance,
  predictLine,
  predictResponse,
  progressText,
  readBlock,
  seenKeys,
  wantsPredict,
  type BlockEvent,
  type BlockState,
  type Planned,
} from '@/lib/learner/item-block'
import { settle } from '@/lib/items/on-demand'
import { pathOf } from '@/lib/learner/paths'
import { depsFrom, expertFor } from '@/lib/learner/prequestions'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'

export interface ItemBlockProps {
  lessonId: string
  /** The block's index in the lesson; the ledger group is `<lessonId>#<blockIndex>`. */
  blockIndex: number
  block: ItemBlockData
  trackColor: string
  /** A serving-first Rust `reading` block (its `block` is derived from it): collapsed on another path. */
  reading?: boolean
}

type Stage =
  | { kind: 'loading' }
  | { kind: 'error' }
  /** Every KC is solid: collapsed until the learner asks. */
  | { kind: 'expert' }
  /** A reading block on a path that has Rust Zero: collapsed until the learner asks. */
  | { kind: 'offpath' }
  /** Done, and nothing on screen but the way to more numbers. */
  | { kind: 'idle' }
  | { kind: 'predict'; plan: Planned; focus: boolean }
  | { kind: 'practice'; plan: Planned; focus: boolean; answered: boolean }
  /** The family cannot make an instance (a content error, never a learner's): say so instead of hanging. */
  | { kind: 'broken' }

const BUTTON = 'min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright'

export default function ItemBlock({ lessonId, blockIndex, block, trackColor, reading = false }: ItemBlockProps) {
  const recordItems = useProgress((s) => s.recordItems)
  const count = blockNeeds(block)
  /** Compile blocks serve code snippets, not numbers. */
  const snippets = block.family === 'compile'
  const again = snippets ? 'Another snippet' : 'New numbers'
  const at = useMemo(() => ({ lessonId, blockIndex, family: block.family, count }), [lessonId, blockIndex, block.family, count])
  const [gen, setGen] = useState<Gen | null>(null)
  const [events, setEvents] = useState<BlockEvent[]>([])
  const [stage, setStage] = useState<Stage>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  /** One base seed per visit: item `i` of the visit is `seedFor(base, i)`, so every visit meets new numbers. */
  const [sessionSeed] = useState(freshSeed)
  /** Items drawn so far this visit, answered or not; it also steps the round-robin through the variants. */
  const draw = useRef(0)
  const local = useRef(0)
  /** Bumped by every stage change and by a reload: a slow `more` that finds it moved is stale and drops its stage. */
  const visit = useRef(0)
  const [waiting, setWaiting] = useState(false)

  const state: BlockState = useMemo(() => readBlock(events, at), [events, at])

  /** Show a stage now, and drop any `more` still waiting on a load. */
  const show = (next: Stage) => {
    visit.current += 1
    setWaiting(false)
    setStage(next)
  }

  /** The next item as a stage; the family history is whatever `evs` holds. */
  const nextStage = async (g: Gen, evs: readonly BlockEvent[], s: BlockState, focus: boolean, restore = false): Promise<Stage> => {
    // only a reload resumes the predicted first instance; a fresh draw always draws another
    if (restore && s.pending) {
      const { variant, level, seed } = s.pending
      const planned = await settle(() => makeAt(g, variant, level, seed))
      if (planned) return { kind: 'practice', plan: planned, focus, answered: false }
    }
    // the draw is taken before the wait: a plan is a pure function of (sessionSeed, draw), however often settle reruns it
    const d = draw.current
    draw.current += 1
    const plan = await settle(() => planItem(g, block, evs, sessionSeed, d))
    if (plan === null) return { kind: 'broken' }
    if (wantsPredict(block) && s.predict === null && s.served.length === 0) return { kind: 'predict', plan, focus }
    return { kind: 'practice', plan, focus, answered: false }
  }

  // What the ledger already holds: a reload keeps the answers, and a learner who has begun is never offered the skip.
  useEffect(() => {
    let live = true
    visit.current += 1
    setWaiting(false)
    setStage({ kind: 'loading' })
    ;(async () => {
      try {
        const deps = depsFrom(useProgress)
        const [g, evs] = await Promise.all([loadFamily(block.family), deps.events({ refPrefix: familyPrefix(block.family) })])
        const s = readBlock(evs, at)
        const fresh = s.predict === null && s.served.length === 0
        // a reading block is for the serving-first path: anywhere else, a fresh one asks first (and is not an expert skip)
        const offpath = fresh && reading && pathOf(deps.working['boot:path']) !== 'serving-first'
        const expert = fresh && !offpath && (await expertFor(itemBlockKcs(g, block), deps))
        // a superseded load stops before it touches the shared draw, so the live load's first plan is draw served.length
        if (!live) return
        draw.current = s.served.length
        const next: Stage = s.done ? { kind: 'idle' } : offpath ? { kind: 'offpath' } : expert ? { kind: 'expert' } : await nextStage(g, evs, s, false, true)
        if (!live) return
        setGen(g)
        setEvents(evs)
        setStage(next)
      } catch {
        if (live) setStage({ kind: 'error' })
      }
    })()
    return () => {
      live = false
      visit.current += 1
    }
    // nextStage reads only what is passed to it and refs; the load runs once per block and per retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, block, attempt, reading])

  const write = (response: Parameters<typeof blockEventOf>[0]) => {
    recordItems([response])
    local.current += 1
    setEvents((evs) => [...evs, blockEventOf(response, new Date().toISOString(), `local:${local.current}`)])
  }

  /** More numbers (or another snippet): a fresh instance, the block's staircase level, whatever has been answered. */
  const more = async () => {
    if (!gen) return
    visit.current += 1
    const mine = visit.current
    setWaiting(true)
    let next: Stage
    try {
      next = await nextStage(gen, events, state, true)
    } catch {
      next = { kind: 'error' }
    }
    // a newer stage (a later press, an answer, a reload) has moved the token: this one is stale
    if (visit.current !== mine) return
    setWaiting(false)
    setStage(next)
  }

  const item: PlayableItem | null = stage.kind === 'practice' ? { source: 'gen', inst: stage.plan.inst } : null
  const showPredicted = stage.kind === 'practice' && (stage.answered || state.served.length > 0) && state.predict !== null

  return (
    <section
      className="my-8 rounded-lg border border-line bg-surface-1 px-4 py-4 sm:px-5"
      data-block={reading ? 'reading' : 'item'}
      data-lesson={lessonId}
      data-block-index={blockIndex}
      aria-label={block.title}
      aria-busy={stage.kind === 'loading' || waiting}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-mono text-label uppercase" style={{ color: trackColor }}>
          {block.title}
        </p>
        <p role="status" aria-live="polite" data-item-progress className="font-mono text-body-sm text-text-2">
          {gen && stage.kind !== 'expert' && stage.kind !== 'offpath' ? progressText(state.passes, count) : ''}
        </p>
      </div>

      {stage.kind === 'loading' && <p className="mt-2 min-h-11 font-mono text-body-sm text-text-3">loading…</p>}

      {stage.kind === 'error' && (
        <div role="alert" className="mt-3">
          <p className="text-body-sm text-text-1">Could not load these questions.</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`mt-3 ${BUTTON}`}>
            Try again
          </button>
        </div>
      )}

      {stage.kind === 'broken' && (
        <div role="alert" className="mt-3">
          <p className="text-body-sm text-text-2">This block has no question to show right now.</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`mt-3 ${BUTTON}`}>
            Try again
          </button>
        </div>
      )}

      {stage.kind === 'offpath' && gen && (
        <div className="mt-3">
          <p className="text-body-sm text-text-1">Rust Zero covers this on your path. Practice anyway?</p>
          <button type="button" onClick={more} className={`mt-3 ${BUTTON}`}>
            Practice anyway
          </button>
        </div>
      )}

      {stage.kind === 'expert' && gen && (
        <div className="mt-3">
          <p className="text-body-sm text-text-1">You know this. Practice anyway?</p>
          <button type="button" onClick={more} className={`mt-3 ${BUTTON}`}>
            Practice anyway
          </button>
        </div>
      )}

      {stage.kind === 'idle' && (
        <div className="mt-3">
          <p className="text-body-sm text-text-2">
            {snippets ? `${count} read right on new code. Done. There are always more.` : `${count} correct on new numbers. Done. There are always more.`}
          </p>
          <button type="button" onClick={more} className={`mt-3 ${BUTTON}`}>
            {again}
          </button>
        </div>
      )}

      {stage.kind === 'predict' && gen && (
        <div className="mt-3">
          <p className="mb-3 text-body-sm text-text-2">Predict before the steps. There is no verdict yet.</p>
          <ItemCard
            key={`predict:${stage.plan.inst.variant}:${stage.plan.inst.seed}`}
            item={{ source: 'gen', inst: predictInstance(stage.plan.inst) }}
            gen={predictGen(gen)}
            deferVerdict
            autoFocus={stage.focus}
            eyebrow="your prediction"
            nextLabel="Now solve it"
            onResult={(r) => write(predictResponse(predictInstance(stage.plan.inst), r, { lessonId, blockIndex }))}
            onNext={() => show({ kind: 'practice', plan: stage.plan, focus: true, answered: false })}
          />
        </div>
      )}

      {stage.kind === 'practice' && gen && item && (
        <div className="mt-3">
          <ItemCard
            key={`practice:${stage.plan.inst.variant}:${stage.plan.inst.seed}`}
            item={item}
            gen={gen}
            autoFocus={stage.focus}
            eyebrow={`${snippets ? 'another snippet' : 'new numbers'} · ${progressText(state.passes, count)}`}
            nextLabel={again}
            onResult={(r) => {
              write(lessonItemResponse(r, item, { lessonId, blockIndex }, seenKeys(events)))
              show({ ...stage, answered: true })
            }}
            onNext={more}
          />
          {!stage.answered && (
            <button type="button" onClick={more} className={`mt-3 ${BUTTON}`}>
              {again}
            </button>
          )}
          {showPredicted && state.predict && <p className="mt-3 text-body-sm text-text-2">{predictLine(state.predict)}</p>}
        </div>
      )}
    </section>
  )
}
