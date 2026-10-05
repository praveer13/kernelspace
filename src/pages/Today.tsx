import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { selectRings } from '@/lib/economy'
import type { ItemResult } from '@/lib/items/play'
import { cardsContent, deriveCards, recentReviewRefs, selectFirstReviewCalibration, type CardsContent, type DerivedCards } from '@/lib/learner/cards'
import { composeExtra, composeSession, type ComposerContent } from '@/lib/learner/composer'
import { pendingHandoff, parseHandoffMarker } from '@/lib/learner/handoff'
import { dayKindOf, normalizeWeekPlan, pickContinue, planLine, weekStatus } from '@/lib/learner/planner'
import { daysBetween } from '@/lib/learner/reentry'
import {
  buildPool,
  composePractice,
  instanceKey,
  itemResponseOf,
  loadTodayContent,
  parsePrefs,
  seenInstances,
  stairEventOf,
  tally,
  upNextFor,
  type SlotOutcome,
  type TodayContent,
  type TodayPrefs,
  type TodaySrc,
} from '@/lib/learner/today'
import type { PlacementResult, SessionPlan, SessionSlot } from '@/lib/learner/types'
import { getLedgerClient } from '@/lib/ledger/client'
import type { Json, LedgerEvent, LocalDay, WeekPlan } from '@/lib/ledger/types'
import { dayOf } from '@/lib/ledger/time'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'
import DoneCard from '@/pages/today/DoneCard'
import EmptyState from '@/pages/today/EmptyState'
import Header from '@/pages/today/Header'

/**
 * /today (Wave 1, docs/specs/wave-1.md §6.3-§6.8): the review session. The page is a thin shell over the pure
 * learner model. It reads the ledger, derives the cards, composes one session of at most 12 nominal minutes,
 * and writes one `item` (or `probe`) event per answer. Nothing it shows is stored (W2): the queue, the SLO line,
 * the week bar and the first-review calibration all come from the events and the clock.
 *
 * The first-load closure stays under 200 KB gzip by loading what a session needs on demand: the item player,
 * the week sheet, the lesson data, the KC graph and the generator families. They are fetched in parallel as
 * soon as the page mounts, so they are warm by the time the first item shows.
 *
 * The page uses no framer-motion, so it needs no MotionScope; its only motion is CSS, behind `motion-safe`.
 */

// The item player (and the claim chips and answer controls behind it) and the week sheet load on demand.
const loadSession = () => import('@/pages/today/Session')
const Session = lazy(loadSession)
const WeekSheet = lazy(() => import('@/pages/today/WeekSheet'))

interface Loaded {
  events: LedgerEvent[]
  content: TodayContent
  cc: CardsContent
  day: LocalDay
  cards: DerivedCards
  seed: number
}

type Load = { status: 'loading' } | { status: 'error' } | ({ status: 'ready' } & Loaded)

interface Run {
  /** Changes with every set, so a new set remounts its session. */
  key: number
  kind: 'review' | 'extra' | 'practice'
  /** `data.grp` of every event of the set. */
  grp: string
  slots: readonly SessionSlot[]
  src: TodaySrc
}

const localDay = (): LocalDay => {
  const at = new Date()
  return dayOf(at.toISOString(), -at.getTimezoneOffset())
}

const placementOf = (raw: Json | undefined): Pick<PlacementResult, 'solidKcs'> | null => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const solid = (raw as Record<string, Json>).solidKcs
  return Array.isArray(solid) ? { solidKcs: solid.filter((k): k is string => typeof k === 'string') } : null
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

export default function Today() {
  const working = useProgress((s) => s.working)
  const aggregate = useProgress((s) => s.aggregate)
  const lessons = useProgress((s) => s.lessons)
  const bootDone = useProgress((s) => s.completions.boot !== undefined)
  const lastExportAt = useProgress((s) => s.ledger.lastExportAt)
  const recordItems = useProgress((s) => s.recordItems)
  const setWorking = useProgress((s) => s.setWorking)

  const weekRaw = working['boot:week']
  const prefsRaw = working['today:prefs']
  const handoffRaw = working['handoff:last']
  const placementRaw = working['placement:result']
  const weekPlan = useMemo(() => normalizeWeekPlan(weekRaw), [weekRaw])
  const prefs = useMemo(() => parsePrefs(prefsRaw), [prefsRaw])
  const placement = useMemo(() => placementOf(placementRaw), [placementRaw])

  const [today] = useState(localDay)
  const [width] = useState(() => (typeof window === 'undefined' ? undefined : window.innerWidth))
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [events, setEvents] = useState<LedgerEvent[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [finished, setFinished] = useState(false)
  const [outcomes, setOutcomes] = useState<SlotOutcome[]>([])
  const [frozen, setFrozen] = useState<SessionPlan | null>(null)
  const [sheet, setSheet] = useState(false)
  const runKey = useRef(0)
  // what this visit has served and answered, which the ledger read at load does not hold yet
  const seen = useRef<Set<string>>(new Set())
  const stair = useRef<ReturnType<typeof stairEventOf>[]>([])

  // 1. Read the ledger and the content, derive the cards. The plan comes from them in step 2.
  useEffect(() => {
    let live = true
    void loadSession()
    ;(async () => {
      try {
        const [client, content] = await Promise.all([getLedgerClient(), loadTodayContent()])
        const evs = await client.events()
        if (!live) return
        const cc = cardsContent({ kcs: content.kcs, lessons: content.lessons, bootKcs: content.bootKcs, resolve: content.resolve })
        setEvents(evs)
        seen.current = seenInstances(evs)
        stair.current = []
        setLoad({ status: 'ready', events: evs, content, cc, day: today, cards: deriveCards(evs, cc, today, weekPlan, { placement }), seed: freshSeed() })
      } catch {
        if (live) setLoad({ status: 'error' })
      }
    })()
    return () => {
      live = false
    }
    // The plan and placement shape the cards, but changing them mid-visit must not rebuild a session in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, today])

  const ready = load.status === 'ready' ? load : null
  const cardCount = ready ? Object.keys(ready.cards.cards).length : 0

  const pool = useMemo(
    () =>
      ready
        ? buildPool({
            kcs: ready.content.kcs,
            gens: ready.content.gens,
            authored: ready.content.authored,
            constructed: ready.content.constructed,
            stair: ready.events as never,
            recent: recentReviewRefs(ready.events, ready.content),
          })
        : null,
    [ready],
  )

  // 2. The session. Edits to the SLO or the set length reshape it until the first answer, then it is frozen.
  const composed = useMemo<SessionPlan | null>(() => {
    if (!ready || !pool) return null
    const content: ComposerContent = {
      ...ready.cc,
      pool,
      needsContent: (kc) => {
        if (import.meta.env?.DEV) console.warn(`[today] needs-content: no item serves ${kc}`)
      },
    }
    return composeSession(ready.cards, content, ready.day, { sessionMinutes: prefs.sessionMinutes, slo: weekPlan.slo }, ready.seed)
  }, [ready, pool, prefs.sessionMinutes, weekPlan.slo])
  const plan = frozen ?? composed

  // The review set is the plan until a "keep going" or practice set replaces it.
  const review = useMemo<Run | null>(
    () => (plan && cardCount > 0 ? { key: 0, kind: 'review', grp: plan.id, slots: plan.slots, src: 'today' } : null),
    [plan, cardCount],
  )
  const active = run ?? review
  const done = finished || (active !== null && active.slots.length === 0)

  const answered = outcomes.length
  const onAnswer = (index: number, slot: SessionSlot, result: ItemResult) => {
    if (!ready || !active) return
    const card = ready.cards.cards[slot.kc]
    const sinceDays = card ? daysBetween(card.lastReviewDay ?? card.createdDay, ready.day) : undefined
    recordItems([
      itemResponseOf(
        result,
        slot.item,
        { grp: active.grp, slot: index, of: active.slots.length, reason: slot.reason, src: active.src, ...(sinceDays === undefined ? {} : { sinceDays }) },
        seen.current,
      ),
    ])
    seen.current.add(instanceKey(result.ref, result.level, result.seed))
    stair.current.push(stairEventOf(result, new Date().toISOString()))
    setOutcomes((o) => [...o, { reason: slot.reason, ok: result.ok, ms: result.ms }])
    if (plan) setFrozen(plan)
  }

  // 3. After a set, read the ledger again (the write is asynchronous, so wait until this set's events are in).
  useEffect(() => {
    if (!finished || !active || answered === 0) return
    let live = true
    ;(async () => {
      try {
        const client = await getLedgerClient()
        for (let i = 0; i < 8; i++) {
          const evs = await client.events()
          const mine = evs.filter((e) => (e as { data?: { grp?: string } }).data?.grp === active.grp).length
          if (mine >= answered || i === 7) {
            if (live) setEvents(evs)
            return
          }
          await wait(250)
        }
      } catch {
        // the done card falls back on what was loaded
      }
    })()
    return () => {
      live = false
    }
  }, [finished, active, answered])

  const week = useMemo(() => (ready ? weekStatus(events, weekPlan, ready.day, { viewportWidth: width }) : null), [ready, events, weekPlan, width])
  const calibration = useMemo(
    () => (ready && done ? selectFirstReviewCalibration(events, ready.cc, ready.day, weekPlan, { placement }) : null),
    [ready, done, events, weekPlan, placement],
  )
  const pending = useMemo(
    () => (done ? pendingHandoff(events, { last: parseHandoffMarker(handoffRaw), ...(lastExportAt ? { lastExportAt } : {}) }) : 0),
    [done, events, handoffRaw, lastExportAt],
  )
  const upNext = useMemo(
    () =>
      ready
        ? upNextFor({
            bootDone,
            lessons: ready.content.lessons.map((l) => ({ id: l.id, title: l.title, minutes: l.minutes, status: lessons[l.id]?.status ?? 'unstarted' })),
            extraAvailable: Object.keys(ready.cards.cards).some((kc) => (pool?.families(kc).length ?? 0) > 0),
          })
        : null,
    [ready, bootDone, lessons, pool],
  )
  const line = useMemo(() => {
    if (!plan) return undefined
    const kind = dayKindOf(weekPlan, ready?.day ?? today, width)
    return planLine(plan.estMinutes, pickContinue(kind, upNext ? [upNext] : []))
  }, [plan, weekPlan, ready, today, width, upNext])

  const start = (kind: 'extra' | 'practice') => {
    if (!ready || !pool) return
    const livePool = buildPool({
      kcs: ready.content.kcs,
      gens: ready.content.gens,
      authored: ready.content.authored,
      constructed: ready.content.constructed,
      stair: [...(ready.events as never[]), ...stair.current],
      recent: new Map(),
    })
    const seed = freshSeed()
    const slots =
      kind === 'extra'
        ? composeExtra(ready.cards, { ...ready.cc, pool: livePool }, ready.day, seed)
        : composePractice(ready.content.bootKcs, livePool, seed, 5)
    if (slots.length === 0) return
    runKey.current += 1
    setRun({ key: runKey.current, kind, grp: crypto.randomUUID(), slots, src: kind === 'extra' ? 'today' : 'practice' })
    setOutcomes([])
    setFinished(false)
  }

  const canExtra = ready !== null && pool !== null && Object.keys(ready.cards.cards).some((kc) => pool.families(kc).length > 0)
  const canPractice = ready !== null && pool !== null && ready.content.bootKcs.some((kc) => pool.families(kc).length > 0)

  const savePlan = (next: WeekPlan) => setWorking('boot:week', { ...next })
  const savePrefs = (next: TodayPrefs) => setWorking('today:prefs', { ...next })

  return (
    <section className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12" data-page="today">
      <Header
        day={ready?.day ?? today}
        plan={plan}
        cardCount={cardCount}
        week={week}
        ring={selectRings(aggregate).rank}
        {...(line ? { planLine: line } : {})}
        onEditWeek={() => setSheet(true)}
      />

      <div className="mt-6 min-h-[16rem]">
        {load.status === 'loading' && (
          <p role="status" className="font-mono text-body-sm text-text-3">
            Loading your queue…
          </p>
        )}
        {load.status === 'error' && (
          <div role="alert" className="rounded-lg border border-line bg-surface-1 p-4">
            <p className="text-body text-text-1">Could not load your review queue.</p>
            <button
              type="button"
              onClick={() => {
                setLoad({ status: 'loading' })
                setAttempt((n) => n + 1)
              }}
              className="mt-3 min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright"
            >
              Try again
            </button>
          </div>
        )}
        {ready && !active && (
          <EmptyState
            upNext={upNext}
            {...(canPractice ? { onPractice: () => start('practice') } : {})}
          />
        )}
        {ready && active && !done && (
          <Suspense
            fallback={
              <p role="status" className="font-mono text-body-sm text-text-3">
                Loading the first item…
              </p>
            }
          >
            <Session
              key={active.key}
              slots={active.slots}
              grp={active.grp}
              gens={ready.content.gens}
              focusFirst={active.kind !== 'review'}
              onAnswer={onAnswer}
              onFinish={() => setFinished(true)}
            />
          </Suspense>
        )}
        {ready && active && done && (
          <DoneCard
            tally={outcomes.length > 0 ? tally(outcomes) : null}
            calibration={calibration}
            upNext={upNext}
            pendingHandoff={pending}
            extra={active.kind !== 'review'}
            {...(canExtra ? { onKeepGoing: () => start('extra') } : {})}
          />
        )}
      </div>

      {sheet && (
        <Suspense fallback={null}>
          <WeekSheet plan={weekPlan} prefs={prefs} day={ready?.day ?? today} onPlan={savePlan} onPrefs={savePrefs} onClose={() => setSheet(false)} />
        </Suspense>
      )}
    </section>
  )
}
