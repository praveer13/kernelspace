/**
 * VRK₃₀, the north-star count (PLAN §1; wave-3.md §12.2, D16): the KCs a learner still answers right, on fresh
 * evidence and without help, 30 days or more after first learning them. Pure: `now` is a parameter and nothing is
 * stored.
 *
 * - **First learning** of a KC is the day its card was created (cards.ts: a passed quiz, Boot or the placement
 *   walk earns the KC, and the creation cap releases it). A KC earned on day 0 whose card the cap held until
 *   day 3 was first learned on day 3. A KC with no card has not been learned and is never checked.
 * - **A check** is a graded `item`, `probe` or `prove` event on the KC, at full credit (`unseen` or `proved`,
 *   provenance.ts), so an authored item (`practice`), a hint-ladder bottom-out (`assisted`) and a lab green never
 *   count. It is not a form item (forms measure tracks, §12.6) and falls 30 local days or more after the card's
 *   creation.
 * - A KC is **checked** when it has a check, and **retained** when its latest check, in `(at, id)` order, is right.
 *   A miss followed by a right check is retained; a right check followed by a miss is not.
 * - **Active study-months** are calendar months, by the events' local day, with graded work on 4 days or more.
 *   VRK₃₀ per active study-month is the retained count over those months.
 *
 * Every number is "as of `now`": events dated after `now` (another device's clock) count once their day comes.
 * KCs no generator covers can count only through `proved` (H4 v2); /me says so beside the number.
 */

import type { KcId } from '@/lib/kc/types'
import { GRADED_KINDS } from '@/lib/ledger/fold'
import { compareEvents } from '@/lib/ledger/merge'
import type { LedgerEvent, LocalDay } from '@/lib/ledger/types'
import { wilson } from './calibration'
import { deriveCards, isFormItem, type CardsContent, type CardsExtra, type CardsPlan } from './cards'
import type { Proportion } from './outcomes'
import { isCredited } from './provenance'
import { daysBetween } from './reentry'

/** Local days between a card's creation and a check that counts. */
export const VRK_MIN_DAYS = 30
/** Days of graded work that make a calendar month an active study-month. */
export const ACTIVE_MONTH_MIN_DAYS = 4
/** Checked KCs below which /me shows "not enough data" for the share (§12.5). */
export const VRK_SHARE_MIN_N = 5

/** The kinds a check can be (§12.2). */
const CHECK_KINDS: ReadonlySet<string> = new Set(['item', 'probe', 'prove'])

/** `correct` of `n` with its Wilson 95 % interval; a null rate and interval with no trial. */
export function proportionOf(correct: number, n: number): Proportion {
  if (n === 0) return { n, correct, rate: null, ci95: null }
  const w = wilson(correct, n)
  return { n, correct, rate: correct / n, ci95: [w.lo, w.hi] }
}

/** The ledger as of `now`: duplicates collapsed (a merge may deliver one twice), later days left out, `(at, id)` order. */
export function asOf(events: Iterable<LedgerEvent>, now: LocalDay): LedgerEvent[] {
  const byId = new Map<string, LedgerEvent>()
  for (const e of events) if (e.day <= now && !byId.has(e.id)) byId.set(e.id, e)
  return [...byId.values()].sort(compareEvents)
}

/** One checked KC: its card's creation and its latest check. */
export interface Vrk30Check {
  kc: KcId
  /** The day the KC's card was created: first learning. */
  created: LocalDay
  /** The latest check's day, ref and whether it was right. */
  day: LocalDay
  ref: string
  ok: boolean
}

export interface Vrk30 {
  /** Checked KCs whose latest check is right, sorted. */
  retained: KcId[]
  /** KCs with at least one check, sorted. */
  checked: KcId[]
  /** `retained` of `checked`, with its Wilson 95 % interval. */
  share: Proportion
  /** Retained KCs per active study-month; null before the first active month. */
  perActiveMonth: number | null
  activeMonths: number
  /** The latest check of every checked KC, in `checked` order. */
  latest: Vrk30Check[]
}

/** A check candidate before the KC's card is known: graded at full credit, not a form item. */
function isCheckEvent(e: LedgerEvent): boolean {
  return CHECK_KINDS.has(e.kind) && typeof (e as { ok?: unknown }).ok === 'boolean' && isCredited(e) && !isFormItem(e)
}

/** Calendar months (local) with graded work on at least `ACTIVE_MONTH_MIN_DAYS` days. */
export function activeStudyMonths(events: Iterable<LedgerEvent>, now: LocalDay): string[] {
  const days = new Map<string, Set<LocalDay>>()
  for (const e of asOf(events, now)) {
    if (!GRADED_KINDS.has(e.kind)) continue
    const month = e.day.slice(0, 7)
    const set = days.get(month) ?? new Set<LocalDay>()
    set.add(e.day)
    days.set(month, set)
  }
  return [...days].filter(([, d]) => d.size >= ACTIVE_MONTH_MIN_DAYS).map(([m]) => m).sort()
}

/**
 * VRK₃₀ as of `now` (§12.2). `plan` and `extra` are what `deriveCards` reads (the week plan, the placement result),
 * so the cards, and with them the day each KC was first learned, are the ones Today schedules.
 */
export function selectVrk30(
  eventsIn: Iterable<LedgerEvent>,
  content: CardsContent,
  now: LocalDay,
  plan?: CardsPlan | null,
  extra?: CardsExtra,
): Vrk30 {
  const events = asOf(eventsIn, now)
  const { cards } = deriveCards(events, content, now, plan, extra)
  const latest = new Map<KcId, Vrk30Check>()
  for (const e of events) {
    if (!isCheckEvent(e)) continue
    const ok = (e as { ok?: boolean }).ok === true
    for (const kc of content.resolve(e)) {
      const card = Object.hasOwn(cards, kc) ? cards[kc] : undefined
      if (!card || daysBetween(card.createdDay, e.day) < VRK_MIN_DAYS) continue
      // events are in (at, id) order, so the last write wins
      latest.set(kc, { kc, created: card.createdDay, day: e.day, ref: e.ref, ok })
    }
  }
  const checked = [...latest.keys()].sort()
  const retained = checked.filter((kc) => (latest.get(kc) as Vrk30Check).ok)
  const activeMonths = activeStudyMonths(events, now).length
  return {
    retained,
    checked,
    share: proportionOf(retained.length, checked.length),
    perActiveMonth: activeMonths === 0 ? null : retained.length / activeMonths,
    activeMonths,
    latest: checked.map((kc) => latest.get(kc) as Vrk30Check),
  }
}
