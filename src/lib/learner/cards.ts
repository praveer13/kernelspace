/**
 * Cards: one FSRS-6 card per KC, derived from the ledger (docs/specs/wave-1.md §6.2). Pure and stateless:
 * `deriveCards` replays the events in `(at, id)` order and returns the card set for a local day, so a
 * merge, an import or a second device always agrees with itself (invariant W2). Nothing here is stored.
 *
 * - Creation: a KC earns a card from a lesson pass, a test-out, a placement walk or Boot, and a token
 *   bucket (1.2 per local day, burst 3, and never more than 36 in any 30 days) releases earned KCs to the
 *   queue, threshold KCs first. Creation pauses in debt mode.
 * - Reviews: every graded event that resolves to a carded KC is a review of it, rated from `ok`, `conf`
 *   and the time taken (V2). A multi-KC item rates every KC it carries.
 * - Scheduling: `target = slo + offset`, where the offset is learned from the learner's first spaced
 *   reviews, predicted recall against what happened (0.02 before 20 of them, then clamp(pred − obs, 0, 0.08)).
 * - Re-entry: after a 7-day gap the overdue cards are spread over 14 days (reentry.ts).
 *
 * The event → KC resolver is injected (`CardsContent.resolve`), so this module imports no lesson data.
 * A card that has not been reviewed yet has `memory: null` and is scheduled and predicted as if its
 * first review will be graded Good (the stability prior `PRIOR`).
 */

import type { Kc, KcId } from '@/lib/kc/types'
import { GRADED_KINDS } from '@/lib/ledger/fold'
import type { LedgerEvent, LocalDay, WeekPlan } from '@/lib/ledger/types'
import { wilson } from './calibration'
import { intervalDays, nextMemory, retrievability } from './fsrs'
import {
  addDays,
  daysBetween,
  isDebt,
  isGapReturn,
  planReentry,
  sessionCapacity,
  sessionMinutesOf,
  type AtRisk,
} from './reentry'
import type { Card, CardOrigin, CardSet, FirstReviewCalibration, MemoryState, PlacementResult, Rating } from './types'

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** The recall SLO of a week plan that sets none. */
export const DEFAULT_SLO = 0.9
/** The optimism offset before enough first reviews exist, and its bounds (spec §6.2). */
export const OFFSET_DEFAULT = 0.02
export const OFFSET_MAX = 0.08
/** First spaced reviews needed before the offset is learned. */
export const OFFSET_MIN_N = 20
/** The plan's cap: at most 1.2 cards per local day, in a bucket of 3, and at most 36 in any 30 days. */
export const CREATE_PER_DAY = 1.2
export const CREATE_BURST = 3
export const CREATE_WINDOW_DAYS = 30
export const CREATE_WINDOW_MAX = Math.floor(CREATE_PER_DAY * CREATE_WINDOW_DAYS)
/** Test-out and placement cards get their day-7 confirmation. */
export const CONFIRM_DAYS = 7

/** The bucket in tenths of a card, so 1.2 a day is exact. */
const TOKEN_UNIT = 10
const TOKEN_RATE = Math.round(CREATE_PER_DAY * TOKEN_UNIT)
const TOKEN_MAX = CREATE_BURST * TOKEN_UNIT

/** The memory a never-reviewed card is scheduled and predicted with: a first review graded Good. */
export const PRIOR: MemoryState = nextMemory(null, 0, 3)

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

/** What card derivation reads. Build it once per content version. */
export interface CardsContent {
  /** The KC graph in full-ramp order: threshold flags, and the creation order of equally eligible KCs. */
  kcs: readonly Kc[]
  /** `Lesson.kcs` by lesson id. A lesson absent here (T3-T7 in Wave 1) earns no cards. */
  lessonKcs: ReadonlyMap<string, readonly KcId[]>
  /** Boot's four KCs, earned when Boot completes. */
  bootKcs: readonly KcId[]
  /** The KCs an event is evidence for (src/lib/kc/resolve.ts `kcsOfEvent` over a `KcContent`). Injected. */
  resolve(e: LedgerEvent): readonly KcId[]
}

export interface CardsContentInput {
  kcs: readonly Kc[]
  lessons: readonly { id: string; kcs?: readonly KcId[] }[]
  bootKcs: readonly KcId[]
  resolve: CardsContent['resolve']
}

export function cardsContent(input: CardsContentInput): CardsContent {
  const lessonKcs = new Map<string, readonly KcId[]>()
  for (const l of input.lessons) if (l.kcs && l.kcs.length > 0) lessonKcs.set(l.id, l.kcs)
  return { kcs: input.kcs, lessonKcs, bootKcs: input.bootKcs, resolve: input.resolve }
}

/** What the replay needs beyond the ledger: the working record `placement:result` is not an event. */
export interface CardsExtra {
  placement?: Pick<PlacementResult, 'solidKcs'> | null
}

/** The plan fields cards read; a missing plan is the default one. */
export type CardsPlan = Partial<Pick<WeekPlan, 'slo' | 'sessionMinutes'>>

/** A card set that also says whether the next session is a welcome-back (a gap of 7+ days is open). */
export type DerivedCards = CardSet & { reentry: boolean }

/** One first spaced review: what the model predicted and what happened. */
export interface FirstReview {
  kc: KcId
  day: LocalDay
  predicted: number
  ok: boolean
}

/* ------------------------------------------------------------------ */
/* Ratings                                                             */
/* ------------------------------------------------------------------ */

const dataOf = (e: LedgerEvent): Record<string, unknown> => {
  const d = (e as { data?: unknown }).data
  return typeof d === 'object' && d !== null ? (d as Record<string, unknown>) : {}
}

/**
 * A review of a card: a graded event except the `quiz` summary (its items are already events, and the
 * summary is what creates a card, not what reviews it) and an assisted one (a hint-ladder bottom-out is
 * not retrieval).
 */
export function isReviewEvent(e: LedgerEvent): boolean {
  if (!GRADED_KINDS.has(e.kind) || e.kind === 'quiz') return false
  return (e as { provenance?: string }).provenance !== 'assisted'
}

/** Self-checked responses (constructed responses, Prove-it) never rate Easy. */
const isSelfChecked = (e: LedgerEvent): boolean => e.kind === 'prove' || e.ref.startsWith('cr:')

/**
 * The FSRS rating of a review (spec §6.2): wrong is Again; right with `guess` is Hard; right with `think` or
 * no rating is Good; right with `sure` and within the item's nominal time is Easy.
 */
export function ratingOf(e: LedgerEvent): Rating {
  const g = e as { ok?: boolean; conf?: string; ms?: number }
  if (g.ok !== true) return 1
  if (g.conf === 'guess') return 2
  if (g.conf === 'sure' && !isSelfChecked(e)) {
    const nsec = dataOf(e).nsec
    if (typeof nsec === 'number' && typeof g.ms === 'number' && g.ms <= nsec * 1000) return 4
  }
  return 3
}

/* ------------------------------------------------------------------ */
/* Card queries                                                        */
/* ------------------------------------------------------------------ */

/** Predicted recall of a card on `day`; an unreviewed card uses the prior and counts from its creation. */
export function cardRetrievability(card: Card, day: LocalDay): number {
  const from = card.lastReviewDay ?? card.createdDay
  return retrievability(Math.max(0, daysBetween(from, day)), (card.memory ?? PRIOR).stability)
}

/** A test-out or placement card whose day-7 check has come and not yet been answered. */
export function isConfirmPending(card: Card, day: LocalDay): boolean {
  if (card.confirmDay === undefined || card.confirmDay > day) return false
  return card.lastReviewDay === null || card.lastReviewDay < card.confirmDay
}

/** Due by the schedule (the virtual due day of a re-entry spread counts) or waiting for its day-7 check. */
export const isDue = (card: Card, day: LocalDay): boolean => card.dueDay <= day || isConfirmPending(card, day)

/** The scheduling target: the SLO plus the learned optimism offset. */
export const targetOf = (slo: number, offset: number): number => Math.min(0.99, slo + offset)

/** The optimism offset after the first reviews seen so far (spec §6.2). */
export function learnOffset(reviews: readonly Pick<FirstReview, 'predicted' | 'ok'>[]): number {
  const n = reviews.length
  if (n < OFFSET_MIN_N) return OFFSET_DEFAULT
  let pred = 0
  let ok = 0
  for (const r of reviews) {
    pred += r.predicted
    if (r.ok) ok += 1
  }
  return Math.min(OFFSET_MAX, Math.max(0, pred / n - ok / n))
}

/* ------------------------------------------------------------------ */
/* The replay                                                          */
/* ------------------------------------------------------------------ */

export interface CardsDetail {
  set: DerivedCards
  firstReviews: FirstReview[]
}

/** Events in `(at, id)` order with duplicate ids collapsed (a merge may deliver one twice). */
function ordered(events: Iterable<LedgerEvent>): LedgerEvent[] {
  const byId = new Map<string, LedgerEvent>()
  for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

const copyCard = (c: Card): Card => ({ ...c, memory: c.memory ? { ...c.memory } : null })

/** `deriveCards` with the first spaced reviews it saw, for `selectFirstReviewCalibration`. */
export function deriveCardsDetailed(
  eventsIn: Iterable<LedgerEvent>,
  content: CardsContent,
  now: LocalDay,
  plan?: CardsPlan | null,
  extra?: CardsExtra,
): CardsDetail {
  const events = ordered(eventsIn)
  const slo = plan?.slo ?? DEFAULT_SLO
  const session = sessionMinutesOf(plan?.sessionMinutes)
  const capacity = sessionCapacity(session)

  const rampIndex = new Map<KcId, number>(content.kcs.map((k, i) => [k.id, i]))
  const thresholds = new Set<KcId>(content.kcs.filter((k) => k.threshold !== undefined).map((k) => k.id))

  const cards = new Map<KcId, Card>()
  /** Earned and waiting for the cap. */
  const waiting = new Map<KcId, { origin: CardOrigin }>()
  const firstReviews: FirstReview[] = []
  const spacedSeen = new Set<KcId>()
  const createdOn: LocalDay[] = []
  let offset = OFFSET_DEFAULT
  let tokens = TOKEN_MAX
  let clock = null as LocalDay | null
  let lastGraded = null as LocalDay | null

  // The placement result belongs to the latest walk only: an earlier `complete placement` earns nothing.
  let lastPlacement: string | null = null
  for (const e of events) if (e.kind === 'complete' && e.ref === 'placement') lastPlacement = e.id

  const dueCount = (day: LocalDay): number => {
    let n = 0
    for (const c of cards.values()) if (isDue(c, day)) n += 1
    return n
  }

  const waitingOrder = (a: KcId, b: KcId): number => {
    const ta = thresholds.has(a) ? 0 : 1
    const tb = thresholds.has(b) ? 0 : 1
    const ra = rampIndex.get(a) ?? Number.POSITIVE_INFINITY
    const rb = rampIndex.get(b) ?? Number.POSITIVE_INFINITY
    return ta - tb || (ra === rb ? 0 : ra - rb) || (a < b ? -1 : a > b ? 1 : 0)
  }

  const createdInWindow = (day: LocalDay): number => {
    let n = 0
    for (let i = createdOn.length - 1; i >= 0; i--) {
      if (daysBetween(createdOn[i], day) >= CREATE_WINDOW_DAYS) break
      n += 1
    }
    return n
  }

  /** Release waiting KCs while the bucket, the 30-day window and debt mode allow. */
  const flush = (day: LocalDay): void => {
    if (waiting.size === 0 || tokens < TOKEN_UNIT) return
    if (isDebt(dueCount(day), session)) return
    const target = targetOf(slo, offset)
    for (const kc of [...waiting.keys()].sort(waitingOrder)) {
      if (tokens < TOKEN_UNIT || createdInWindow(day) >= CREATE_WINDOW_MAX) break
      const { origin } = waiting.get(kc) as { origin: CardOrigin }
      waiting.delete(kc)
      tokens -= TOKEN_UNIT
      createdOn.push(day)
      const card: Card = {
        kc,
        origin,
        createdDay: day,
        memory: null,
        lastReviewDay: null,
        reps: 0,
        lapses: 0,
        dueDay: addDays(day, intervalDays(PRIOR.stability, target)),
        priority: false,
      }
      if (origin === 'testout' || origin === 'placement') card.confirmDay = addDays(day, CONFIRM_DAYS)
      cards.set(kc, card)
    }
  }

  /** Re-entry on `day`: the cards due that day beyond one session's worth wait their turn over 14 days. */
  const spreadOverdue = (day: LocalDay): void => {
    const overdue: AtRisk[] = []
    for (const c of cards.values()) {
      if (c.dueDay > day) continue
      overdue.push({
        kc: c.kc,
        priority: c.priority,
        threshold: thresholds.has(c.kc),
        retrievability: cardRetrievability(c, day),
        stability: (c.memory ?? PRIOR).stability,
      })
    }
    const { spread } = planReentry(overdue, capacity, day)
    for (const [kc, due] of spread) {
      const c = cards.get(kc) as Card
      c.dueDay = due
      if (c.confirmDay !== undefined && c.confirmDay <= day && (c.lastReviewDay === null || c.lastReviewDay < c.confirmDay)) {
        c.confirmDay = due > c.confirmDay ? due : c.confirmDay
      }
    }
  }

  /** Move the clock to `day`: refill the bucket for each day passed and release what the cap allows. */
  const advance = (day: LocalDay, gapReturn: boolean): void => {
    if (clock === null) {
      clock = day
      if (gapReturn) spreadOverdue(day)
      flush(day)
      return
    }
    if (daysBetween(clock, day) <= 0) {
      if (gapReturn) spreadOverdue(day)
      return
    }
    const span = daysBetween(clock, day)
    for (let i = 1; i <= span; i++) {
      const d = addDays(clock, i)
      if (i === span && gapReturn) spreadOverdue(d)
      tokens = Math.min(TOKEN_MAX, tokens + TOKEN_RATE)
      flush(d)
    }
    clock = day
  }

  const earn = (kcs: readonly KcId[], origin: CardOrigin, day: LocalDay): void => {
    for (const kc of kcs) if (!cards.has(kc) && !waiting.has(kc)) waiting.set(kc, { origin })
    flush(day)
  }

  const review = (card: Card, e: LedgerEvent, day: LocalDay): void => {
    const rating = ratingOf(e)
    const from = card.lastReviewDay ?? card.createdDay
    const t = Math.max(0, daysBetween(from, day))
    // The first spaced review (a day or more after the card's last exposure) is what calibration measures.
    if (t >= 1 && !spacedSeen.has(card.kc)) {
      spacedSeen.add(card.kc)
      firstReviews.push({
        kc: card.kc,
        day,
        predicted: retrievability(t, (card.memory ?? PRIOR).stability),
        ok: rating > 1,
      })
      offset = learnOffset(firstReviews)
    }
    card.memory = nextMemory(card.memory, t, rating)
    card.reps += 1
    if (rating === 1) {
      card.lapses += 1
      if ((e as { conf?: string }).conf === 'sure') card.priority = true
    } else {
      card.priority = false
    }
    if (card.lastReviewDay === null || day > card.lastReviewDay) card.lastReviewDay = day
    card.dueDay = addDays(card.lastReviewDay, intervalDays(card.memory.stability, targetOf(slo, offset)))
  }

  for (const e of events) {
    const graded = GRADED_KINDS.has(e.kind)
    const gapReturn = graded && isGapReturn(lastGraded, e.day)
    advance(e.day, gapReturn)
    const day = clock as LocalDay // the later of the event's day and the clock (a tz change can step a day back)
    if (graded && (lastGraded === null || e.day > lastGraded)) lastGraded = e.day

    if (isReviewEvent(e)) {
      for (const kc of content.resolve(e)) {
        const card = cards.get(kc)
        if (card) review(card, e, e.day)
      }
    }

    if (e.kind === 'quiz' && (e as { ok?: boolean }).ok === true && e.ref.startsWith('lesson:')) {
      const form = dataOf(e).form
      const kcs = content.lessonKcs.get(e.ref.slice('lesson:'.length)) ?? []
      earn(kcs, form === 'testout' ? 'testout' : 'ticket', day)
    } else if (e.kind === 'complete' && e.ref === 'boot') {
      earn(content.bootKcs, 'boot', day)
    } else if (e.kind === 'complete' && e.ref === 'placement' && e.id === lastPlacement) {
      earn(extra?.placement?.solidKcs ?? [], 'placement', day)
    }
  }

  // A gap that is still open: the learner has not returned yet, so the spread is anchored on today.
  advance(now, isGapReturn(lastGraded, now))

  const record: Record<KcId, Card> = {}
  for (const c of [...cards.values()].sort((a, b) => (a.kc < b.kc ? -1 : 1))) record[c.kc] = copyCard(c)
  const set: DerivedCards = {
    cards: record,
    pending: [...waiting.keys()].sort(waitingOrder),
    offset,
    paused: isDebt(dueCount(now), session),
    reentry: isGapReturn(lastGraded, now),
  }
  return { set, firstReviews }
}

/**
 * The card set for local day `now`, replayed from `events` (spec §6.2). `plan` is the week plan (SLO and
 * session length); `extra` carries the placement result, which lives in a working record, not an event.
 * Deterministic: the same events in any order give the same set. Every event replays, including one dated after
 * `now` (clock skew), and `now` is the day the queue is read for; pass the ledger as it stands.
 */
export function deriveCards(
  events: Iterable<LedgerEvent>,
  content: CardsContent,
  now: LocalDay,
  plan?: CardsPlan | null,
  extra?: CardsExtra,
): DerivedCards {
  return deriveCardsDetailed(events, content, now, plan, extra).set
}

/**
 * First-review calibration (the Wave 1 exit gate, spec §17): the mean recall the model predicted for each
 * card's first spaced review against the share answered right, with a Wilson interval on that share.
 */
export function selectFirstReviewCalibration(
  events: Iterable<LedgerEvent>,
  content: CardsContent,
  now: LocalDay,
  plan?: CardsPlan | null,
  extra?: CardsExtra,
): FirstReviewCalibration {
  const { firstReviews } = deriveCardsDetailed(events, content, now, plan, extra)
  const n = firstReviews.length
  if (n === 0) return { n, meanPredicted: null, observed: null, ci95: null }
  const right = firstReviews.filter((r) => r.ok).length
  const w = wilson(right, n)
  return {
    n,
    meanPredicted: firstReviews.reduce((s, r) => s + r.predicted, 0) / n,
    observed: right / n,
    ci95: [w.lo, w.hi],
  }
}

/**
 * The refs of each KC's most recent reviews, newest first, at most `n` each. The composer avoids an
 * authored item the learner met in its last 3 reviews (spec §6.3).
 */
export function recentReviewRefs(events: Iterable<LedgerEvent>, content: Pick<CardsContent, 'resolve'>, n = 3): Map<KcId, string[]> {
  const out = new Map<KcId, string[]>()
  for (const e of ordered(events).reverse()) {
    if (!isReviewEvent(e)) continue
    for (const kc of content.resolve(e)) {
      const refs = out.get(kc) ?? []
      if (refs.length < n) refs.push(e.ref)
      out.set(kc, refs)
    }
  }
  return out
}
