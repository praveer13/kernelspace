/**
 * What Home and /progress say about Today without opening it (wave-1.md §6.9, §8.5): how big today's session
 * is, how well the model predicted first reviews, how the week is going, and how much is not yet handed off.
 *
 * Everything here is derived from the ledger, the content and the clock (W2), by the same functions Today
 * calls, so a number on Home or /progress matches the page it points to. Nothing is stored. The loaders pull
 * the lesson corpus, the KC graph and the generator families on demand, so only pages that ask for a summary
 * pay for them (never the Navbar or StatusBar, which read the snapshot only).
 */

import { RING2_LESSONS } from '@/lib/economy-table'
import type { Json, LedgerEvent, LocalDay, WeekPlan } from '@/lib/ledger/types'
import { dayOf } from '@/lib/ledger/time'
import {
  cardRetrievability,
  cardsContent,
  deriveCards,
  recentReviewRefs,
  selectFirstReviewCalibration,
  type CardsContent,
} from './cards'
import { composeSession, type ComposerContent } from './composer'
import { pendingHandoff, parseHandoffMarker, type HandoffMarker } from './handoff'
import { normalizeWeekPlan, weekStatus } from './planner'
import { buildPool, parsePrefs, type TodayContent } from './today'
import type { FirstReviewCalibration, PlacementResult, WeekStatus } from './types'

/** Mean predicted recall under which a ring shows amber (§8.5). */
export const AMBER_BELOW = 0.8

/** The raw working records the summaries read (`boot:week`, `today:prefs`, `placement:result`, `handoff:last`). */
export interface SummaryInput {
  week?: Json | undefined
  prefs?: Json | undefined
  placement?: Json | undefined
  handoff?: Json | undefined
  /** `LedgerStatus.lastExportAt`: a full backup also holds those events. */
  lastExportAt?: string | undefined
  /** The viewport width, for the planner's phone-day rule. */
  width?: number | undefined
}

/** The local calendar day of a clock reading, in the learner's timezone. */
export const localDayOf = (at: Date): LocalDay => dayOf(at.toISOString(), -at.getTimezoneOffset())

/** The placement result's solid KCs, the only part cards read. Null for anything else. */
export function placementOf(raw: Json | undefined): Pick<PlacementResult, 'solidKcs'> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const solid = (raw as Record<string, Json>).solidKcs
  return Array.isArray(solid) ? { solidKcs: solid.filter((k): k is string => typeof k === 'string') } : null
}

function contentOf(content: TodayContent): CardsContent {
  return cardsContent({ kcs: content.kcs, lessons: content.lessons, bootKcs: content.bootKcs, resolve: content.resolve })
}

export interface TodayPreview {
  /** Items in today's review session; 0 when nothing is due or no card exists yet. */
  items: number
  /** Nominal minutes, rounded up to whole minutes (at least 1 when there are items). */
  minutes: number
  /** Cards the learner has. 0 means Today shows its empty state. */
  cards: number
}

/**
 * Today's session as Today would compose it now: the same cards, pool and composer, with a seed fixed by the
 * day, so repeated previews agree. Today draws its own fresh seed, so its item count can differ by a slot or
 * two when generated items cost different seconds; the minutes stay within the learner's session length.
 */
export function previewToday(events: readonly LedgerEvent[], content: TodayContent, input: SummaryInput, now: Date = new Date()): TodayPreview {
  const day = localDayOf(now)
  const week = normalizeWeekPlan(input.week)
  const prefs = parsePrefs(input.prefs)
  const cc = contentOf(content)
  const cards = deriveCards(events, cc, day, week, { placement: placementOf(input.placement) })
  const count = Object.keys(cards.cards).length
  if (count === 0) return { items: 0, minutes: 0, cards: 0 }
  const pool = buildPool({
    kcs: content.kcs,
    gens: content.gens,
    authored: content.authored,
    constructed: content.constructed,
    stair: events as never,
    recent: recentReviewRefs(events, content),
  })
  const composer: ComposerContent = { ...cc, pool }
  const seed = Array.from(day).reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7)
  const plan = composeSession(cards, composer, day, { sessionMinutes: prefs.sessionMinutes, slo: week.slo }, seed)
  return { items: plan.slots.length, minutes: plan.slots.length === 0 ? 0 : Math.max(1, Math.ceil(plan.estMinutes)), cards: count }
}

/** "Today · 9 items · ~10 min", or what to say when there is no session to count. */
export function todayCtaLabel(preview: TodayPreview | null): string {
  if (!preview) return 'Today'
  if (preview.items > 0) return `Today · ${preview.items} ${preview.items === 1 ? 'item' : 'items'} · ~${preview.minutes} min`
  return preview.cards > 0 ? 'Today · all caught up' : 'Today · see what is next'
}

export interface RingRecall {
  /** Mean predicted recall over the carded KCs of the ring's lessons; null when none is carded. */
  mean: number | null
  /** Carded KCs counted. */
  cards: number
  /** True when `mean` is below `AMBER_BELOW`: a nudge to refresh, never a revocation or a gate (W8). */
  amber: boolean
}

/**
 * The KCs RING 2 stands on: those the graph ties to its 19 T0–T2 lessons, plus whatever the lessons themselves
 * are tagged with (`Lesson.kcs`). Either source alone would miss a KC while the other is being filled in.
 */
export function ringKcs(content: Pick<CardsContent, 'kcs' | 'lessonKcs'>): Set<string> {
  const ring = new Set<string>(RING2_LESSONS)
  const out = new Set<string>()
  for (const kc of content.kcs) if (kc.lessons.some((l) => ring.has(l))) out.add(kc.id)
  for (const id of RING2_LESSONS) for (const kc of content.lessonKcs.get(id) ?? []) out.add(kc)
  return out
}

export interface LearnerSummary {
  day: LocalDay
  calibration: FirstReviewCalibration
  week: WeekStatus
  weekPlan: WeekPlan
  /** Events not yet handed off to another device or exported. */
  pending: number
  recall: RingRecall
  handoff: HandoffMarker | null
}

/** The /progress numbers: first-review calibration, the week, the hand-off count and the ring's recall. */
export function summarize(events: readonly LedgerEvent[], content: TodayContent, input: SummaryInput, now: Date = new Date()): LearnerSummary {
  const day = localDayOf(now)
  const weekPlan = normalizeWeekPlan(input.week)
  const cc = contentOf(content)
  const extra = { placement: placementOf(input.placement) }
  const cards = deriveCards(events, cc, day, weekPlan, extra)
  const kcs = ringKcs(cc)
  const recalls = Object.values(cards.cards)
    .filter((c) => kcs.has(c.kc))
    .map((c) => cardRetrievability(c, day))
  const mean = recalls.length === 0 ? null : recalls.reduce((s, r) => s + r, 0) / recalls.length
  const handoff = parseHandoffMarker(input.handoff)
  return {
    day,
    calibration: selectFirstReviewCalibration(events, cc, day, weekPlan, extra),
    week: weekStatus(events, weekPlan, day, input.width === undefined ? {} : { viewportWidth: input.width }),
    weekPlan,
    pending: pendingHandoff(events, { last: handoff, ...(input.lastExportAt ? { lastExportAt: input.lastExportAt } : {}) }),
    recall: { mean, cards: recalls.length, amber: mean !== null && mean < AMBER_BELOW },
    handoff,
  }
}

/** Read the ledger and the content, then `previewToday`. The ledger engine and the corpus load on demand. */
export async function loadPreview(input: SummaryInput): Promise<TodayPreview> {
  const [{ getLedgerClient }, { loadTodayContent }] = await Promise.all([import('@/lib/ledger/client'), import('./today')])
  const [client, content] = await Promise.all([getLedgerClient(), loadTodayContent()])
  return previewToday(await client.events(), content, input)
}

/** Read the ledger and the content, then `summarize`. */
export async function loadSummary(input: SummaryInput): Promise<LearnerSummary> {
  const [{ getLedgerClient }, { loadTodayContent }] = await Promise.all([import('@/lib/ledger/client'), import('./today')])
  const [client, content] = await Promise.all([getLedgerClient(), loadTodayContent()])
  return summarize(await client.events(), content, input)
}
