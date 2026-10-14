/**
 * The amber nudge of every ring (wave-2.md §6.4): a ring that is earned shows amber when the mean predicted
 * recall over its KCs is below `AMBER_BELOW`. Amber never revokes a ring and never gates anything (W8); it
 * only says "a short review on Today brings this up".
 *
 * RING 2's number is the one `summarize` reports (`ringKcs` over the same lessons), generalised to the rings
 * Wave 2 earns. A ring's KCs are the KCs the graph ties to its lessons plus what those lessons are tagged with
 * (`Lesson.kcs`); labs add none, as for RING 2. Derived from the ledger, the content and the clock (W2).
 */

import { RING0_LESSONS, RING1_LESSONS, RING2_LESSONS, ROOT_LESSONS } from '@/lib/economy-table'
import type { RingName } from '@/lib/economy'
import type { LedgerEvent, LocalDay } from '@/lib/ledger/types'
import { cardRetrievability, cardsContent, deriveCards, type CardsContent } from './cards'
import { normalizeWeekPlan } from './planner'
import { AMBER_BELOW, localDayOf, placementOf, type RingRecall, type SummaryInput } from './summary'
import type { TodayContent } from './today'

/** The rings that have KCs of their own. RING 3 is the floor and has no amber. */
export type AmberRing = Exclude<RingName, 'RING 3'>

export const AMBER_RINGS: readonly AmberRing[] = ['RING 2', 'RING 1', 'RING 0', 'ROOT']

const RING_LESSONS: Readonly<Record<AmberRing, readonly string[]>> = {
  'RING 2': RING2_LESSONS,
  'RING 1': RING1_LESSONS,
  'RING 0': RING0_LESSONS,
  ROOT: ROOT_LESSONS,
}

/** The KCs a ring stands on: the graph's KCs of its lessons, plus the lessons' own `kcs` tags. */
export function kcsOfLessons(content: Pick<CardsContent, 'kcs' | 'lessonKcs'>, lessons: readonly string[]): Set<string> {
  const ids = new Set<string>(lessons)
  const out = new Set<string>()
  for (const kc of content.kcs) if (kc.lessons.some((l) => ids.has(l))) out.add(kc.id)
  for (const id of lessons) for (const kc of content.lessonKcs.get(id) ?? []) out.add(kc)
  return out
}

export function ringKcSets(content: Pick<CardsContent, 'kcs' | 'lessonKcs'>): Record<AmberRing, Set<string>> {
  return Object.fromEntries(AMBER_RINGS.map((r) => [r, kcsOfLessons(content, RING_LESSONS[r])])) as Record<AmberRing, Set<string>>
}

/** Mean of `recalls`, with `amber` when it is under the bar; null with no carded KC (nothing to nudge). */
export function recallOf(recalls: readonly number[]): RingRecall {
  if (recalls.length === 0) return { mean: null, cards: 0, amber: false }
  const mean = recalls.reduce((s, r) => s + r, 0) / recalls.length
  return { mean, cards: recalls.length, amber: mean < AMBER_BELOW }
}

/** Predicted recall of each carded KC on `day`, the replay of cards.ts as Today reads it. */
export function ringRecalls(
  events: readonly LedgerEvent[],
  content: TodayContent,
  input: SummaryInput,
  now: Date = new Date(),
): Record<AmberRing, RingRecall> {
  const day: LocalDay = localDayOf(now)
  const cc = cardsContent({ kcs: content.kcs, lessons: content.lessons, bootKcs: content.bootKcs, resolve: content.resolve })
  const cards = deriveCards(events, cc, day, normalizeWeekPlan(input.week), { placement: placementOf(input.placement) })
  const carded = Object.values(cards.cards)
  const sets = ringKcSets(cc)
  return Object.fromEntries(
    AMBER_RINGS.map((r) => [r, recallOf(carded.filter((c) => sets[r].has(c.kc)).map((c) => cardRetrievability(c, day)))]),
  ) as Record<AmberRing, RingRecall>
}
