/**
 * The composer (docs/specs/wave-1.md §6.3): `composeSession` turns a card set into one session of at most
 * 12 nominal minutes. Pure and deterministic per seed (verify-determinism lints this file): the clock is the
 * `now` parameter, randomness is the seed, and every item is chosen through an injected `ItemPool`, so the
 * generator families (which load lazily) and the authored content stay outside this module.
 *
 * Order: priority cards (sure-and-wrong since the last success), due threshold cards, day-7 confirmations,
 * then other due cards by lowest predicted recall. Items: a generator family at the staircase level on a
 * fresh seed, else an authored item not seen in the KC's last 3 reviews, else its constructed response.
 * Interleaving happens only inside confusable sets (Brunmair & Richter 2019: mixing dissimilar material
 * does not help); a set is the connected group of KCs linked by `confusable`, so a KC that is confusable with
 * two others brings all three together. At most 2 cold checks ride along, still reviews and measured apart.
 */

import { seedFor } from '@/lib/items/core'
import type { Level, PlayableItem } from '@/lib/items/types'
import type { Kc, KcId } from '@/lib/kc/types'
import type { LocalDay, WeekPlan } from '@/lib/ledger/types'
import { hash32, splitmix32u } from '@/lib/rng'
import { cardRetrievability, DEFAULT_SLO, isConfirmPending, isDue, type CardsContent } from './cards'
import { daysBetween, sessionMinutesOf } from './reentry'
import type { Card, CardSet, SessionMode, SessionPlan, SessionSlot, SlotReason } from './types'

/** Cold checks per session, at most. */
export const MAX_PROBES = 2
/** A cold check is a KC whose last exposure is at least this many days old and which is not due. */
export const PROBE_MIN_DAYS = 7
/** A priority card (sure and wrong) gets a second, different item in the same session. */
export const PRIORITY_ITEMS = 2
/** "Keep going" sets (spec §6.3 step 5). */
export const EXTRA_SET_SIZE = 5

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

/** Where items come from. The caller binds it to loaded families, the lesson content and the ledger. */
export interface ItemPool {
  /** Generator family ids that cover the KC (`Kc.gen`, restricted to families that are loaded). */
  families(kc: KcId): readonly string[]
  /** The staircase level for (kc, family) from the learner's history (src/lib/items/staircase.ts `levelFor`). */
  level(kc: KcId, family: string): Level
  /** One instance of `family` for the KC on `seed`, or null when the family cannot serve it. Pure in its arguments. */
  make(family: string, kc: KcId, level: Level, seed: number): PlayableItem | null
  /** Authored items tagged with the KC (checkpoint questions, anchors), in authored order. */
  authored(kc: KcId): readonly PlayableItem[]
  /** The KC's constructed response, if it has one. */
  constructed(kc: KcId): PlayableItem | null
  /** Refs of the KC's last reviews, newest first (cards.ts `recentReviewRefs`). */
  recent(kc: KcId): readonly string[]
}

export interface ComposerContent extends CardsContent {
  pool: ItemPool
  /** Called for a KC the pool could not serve at all (spec §6.3: "log `needs-content` in dev"). */
  needsContent?(kc: KcId): void
}

export interface SessionPrefs {
  /** `today:prefs.sessionMinutes`; the budget is `min(12, this)`. */
  sessionMinutes?: number
  /** The week plan's recall SLO. */
  slo?: WeekPlan['slo']
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

/** Nominal seconds of an authored multiple-choice item and of a constructed response (write, reveal, tick). */
export const AUTHORED_SEC = 30
export const CONSTRUCTED_SEC = 90

/** What a served item costs: a generated item knows its own `nsec`. */
export function itemSeconds(item: PlayableItem): number {
  switch (item.source) {
    case 'gen':
      return item.inst.nsec
    case 'cr':
      return CONSTRUCTED_SEC
    default:
      return AUTHORED_SEC
  }
}

/** The ledger ref an item is recorded under (the seed of a generated item rides on the event). */
export function itemRef(item: PlayableItem): string {
  switch (item.source) {
    case 'gen':
      return `gen:${item.inst.family}/${item.inst.variant}`
    case 'quiz':
      return `quiz:${item.lessonId}#${item.qi}`
    case 'cr':
      return `cr:${item.lessonId}#${item.index}`
    case 'item':
      return `item:${item.item.id}`
  }
}

const levelOf = (item: PlayableItem): Level | undefined => (item.source === 'gen' ? item.inst.level : undefined)

/**
 * The item for one KC, or null when the pool has nothing. `avoid` holds refs not to repeat (a priority
 * card's second item). The last resort before giving up is the authored item the learner met longest ago,
 * so a due card with only a few items is never stranded.
 */
function chooseItem(kc: KcId, pool: ItemPool, rawSeed: number, avoid: ReadonlySet<string>): PlayableItem | null {
  const seed = rawSeed >>> 0
  const families = pool.families(kc)
  for (let i = 0; i < families.length; i++) {
    const family = families[(seed + i) % families.length]
    const made = pool.make(family, kc, pool.level(kc, family), seed)
    if (made) return made
  }
  const recent = pool.recent(kc)
  const authored = pool.authored(kc).filter((it) => !avoid.has(itemRef(it)))
  const unseen = authored.filter((it) => !recent.includes(itemRef(it)))
  if (unseen.length > 0) return unseen[seed % unseen.length]
  const cr = pool.constructed(kc)
  if (cr && !avoid.has(itemRef(cr))) return cr
  if (authored.length === 0) return null
  // all met recently: the one that has been out of rotation longest (absent from `recent`, else the oldest in it)
  let oldest = authored[0]
  let age = -1
  for (const it of authored) {
    const at = recent.indexOf(itemRef(it))
    if (at > age) {
      age = at
      oldest = it
    }
  }
  return oldest
}

/* ------------------------------------------------------------------ */
/* Confusable sets                                                     */
/* ------------------------------------------------------------------ */

/** KC → the id of its confusable set (the connected component over `confusable` edges). KCs in no set are absent. */
export function confusableGroups(kcs: readonly Kc[]): Map<KcId, string> {
  const parent = new Map<KcId, KcId>()
  const find = (x: KcId): KcId => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r) as KcId
    return r
  }
  for (const k of kcs) if ((k.confusable?.length ?? 0) > 0) parent.set(k.id, k.id)
  for (const k of kcs) {
    for (const other of k.confusable ?? []) {
      if (!parent.has(other)) parent.set(other, other)
      const a = find(k.id)
      const b = find(other)
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b)
    }
  }
  const out = new Map<KcId, string>()
  for (const id of parent.keys()) out.set(id, find(id))
  return out
}

/**
 * Put the due KCs of one confusable set next to each other, at the place of the set's first member (so a
 * later member only moves up). When every KC of the set has at least two slots they alternate A B A B;
 * otherwise each KC's slots stay together. Slots of KCs in no set keep their place, and nothing is shuffled
 * across sets: dissimilar material is never mixed.
 */
export function interleaveConfusable(slots: readonly SessionSlot[], groupOf: ReadonlyMap<KcId, string>): SessionSlot[] {
  const out: SessionSlot[] = []
  const done = new Set<string>()
  for (const slot of slots) {
    const g = groupOf.get(slot.kc)
    if (g === undefined) {
      out.push(slot)
      continue
    }
    if (done.has(g)) continue
    done.add(g)
    const byKc = new Map<KcId, SessionSlot[]>()
    for (const s of slots) if (groupOf.get(s.kc) === g) byKc.set(s.kc, [...(byKc.get(s.kc) ?? []), s])
    const lanes = [...byKc.values()]
    if (lanes.length > 1 && lanes.every((l) => l.length >= 2)) {
      const rounds = Math.max(...lanes.map((l) => l.length))
      for (let r = 0; r < rounds; r++) for (const l of lanes) if (r < l.length) out.push(l[r])
    } else {
      for (const l of lanes) out.push(...l)
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* The session                                                         */
/* ------------------------------------------------------------------ */

const REASONS: readonly SlotReason[] = ['priority', 'threshold', 'confirm', 'due']

interface Candidate {
  card: Card
  tier: 0 | 1 | 2 | 3
  r: number
}

const round1 = (x: number): number => Math.round(x * 10) / 10

/** A UUID-shaped id drawn from the seed and the day: fresh whenever the caller's seed is. */
function sessionId(seed: number, day: LocalDay): string {
  const next = splitmix32u((seed ^ hash32(day)) | 0)
  const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0')
  const a = next()
  const b = next()
  const c = next()
  const d = next()
  return `${hex(a, 8)}-${hex(b >>> 16, 4)}-4${hex(b & 0xfff, 3)}-${hex(0x8000 | ((c >>> 16) & 0x3fff), 4)}-${hex(c & 0xffff, 4)}${hex(d, 8)}`
}

/** `floor((1 − slo) × cards)` in integers, so 0.9 and 40 give 4 and not 3.9999999999999996. */
const errorBudget = (slo: number, cards: number): number => Math.floor(((100 - Math.round(slo * 100)) * cards) / 100)

/**
 * One session for local day `now`. `cards` is `deriveCards`'s result (a bare `CardSet` plans as normal),
 * and `seed` fixes every choice, so the same inputs always give the same plan. The plan's `id` is derived
 * from the seed, so a caller that passes a fresh seed per session gets a fresh id.
 */
export function composeSession(
  cards: CardSet & { reentry?: boolean },
  content: ComposerContent,
  now: LocalDay,
  prefs: SessionPrefs,
  seed: number,
): SessionPlan {
  const slo = prefs.slo ?? DEFAULT_SLO
  const minutes = sessionMinutesOf(prefs.sessionMinutes)
  const budgetSec = minutes * 60
  const mode: SessionMode = cards.reentry === true ? 'reentry' : cards.paused ? 'debt' : 'normal'
  const thresholds = new Set<KcId>(content.kcs.filter((k) => k.threshold !== undefined).map((k) => k.id))
  const groups = confusableGroups(content.kcs)
  const pool = content.pool
  const all = Object.values(cards.cards)

  // 1. who is wanted, and in what order
  const wanted: Candidate[] = []
  for (const card of all) {
    if (!isDue(card, now)) continue
    const tier = card.priority ? 0 : thresholds.has(card.kc) ? 1 : isConfirmPending(card, now) ? 2 : 3
    wanted.push({ card, tier, r: cardRetrievability(card, now) })
  }
  const stability = (c: Candidate): number => c.card.memory?.stability ?? 0
  wanted.sort(
    (a, b) =>
      a.tier - b.tier ||
      // a welcome-back set serves the sturdiest cards that have slipped furthest; otherwise the lowest recall first
      (mode === 'reentry' && a.tier === 3 ? stability(b) - stability(a) : 0) ||
      a.r - b.r ||
      (a.card.kc < b.card.kc ? -1 : a.card.kc > b.card.kc ? 1 : 0),
  )

  // 2. an item for each, while the nominal time lasts
  const slots: SessionSlot[] = []
  let usedSec = 0
  let built = 0
  let full = false
  for (const w of wanted) {
    if (full) break
    const kc = w.card.kc
    const count = w.tier === 0 ? PRIORITY_ITEMS : 1
    const avoid = new Set<string>()
    for (let n = 0; n < count; n++) {
      const item = chooseItem(kc, pool, seedFor(seed, built++), avoid)
      if (!item) {
        if (n === 0) content.needsContent?.(kc)
        break
      }
      const sec = itemSeconds(item)
      if (usedSec + sec > budgetSec && slots.length > 0) {
        if (n === 0) full = true // the plan keeps its order: nothing lower-ranked jumps the queue
        break
      }
      avoid.add(itemRef(item))
      usedSec += sec
      slots.push({ kc, item, level: levelOf(item), reason: REASONS[w.tier] })
    }
  }

  // 3. confusable KCs side by side
  let plan = interleaveConfusable(slots, groups)

  // 4. cold checks: not due, last exposure a week ago or more, still reviews (probe events). A welcome-back
  // is only the short set of what matters most, so it carries none.
  const dueKcs = new Set(wanted.map((w) => w.card.kc))
  const inPlan = new Set(plan.map((s) => s.kc))
  const cold = (mode === 'reentry' ? [] : all)
    .filter((c) => !dueKcs.has(c.kc) && !inPlan.has(c.kc) && daysBetween(c.lastReviewDay ?? c.createdDay, now) >= PROBE_MIN_DAYS)
    .map((c) => c.kc)
    .sort()
  const rng = splitmix32u((seed ^ 0x9e3779b9) | 0)
  for (let i = cold.length - 1; i > 0; i--) {
    const j = Math.floor((rng() / 4294967296) * (i + 1))
    const t = cold[i]
    cold[i] = cold[j]
    cold[j] = t
  }
  const probes: SessionSlot[] = []
  for (const kc of cold) {
    if (probes.length >= MAX_PROBES) break
    const item = chooseItem(kc, pool, seedFor(seed, built++), new Set())
    if (!item) continue
    const sec = itemSeconds(item)
    if (usedSec + sec > budgetSec) continue
    usedSec += sec
    probes.push({ kc, item, level: levelOf(item), reason: 'probe' })
  }
  plan = [...plan, ...probes]

  // 5. the budget line; a welcome-back never carries a count of what is overdue
  const belowSlo = mode === 'reentry' ? 0 : all.filter((c) => cardRetrievability(c, now) < slo).length
  return {
    id: sessionId(seed, now),
    day: now,
    mode,
    slots: plan,
    estMinutes: round1(usedSec / 60),
    budget: { slo, allowed: errorBudget(slo, all.length), belowSlo },
  }
}

/**
 * "Keep going" (spec §6.3 step 5): `count` generated items on introduced (carded) KCs, lowest recall first,
 * cycling when fewer KCs can be served. They pay XP under the daily cap and still update cards.
 */
export function composeExtra(
  cards: CardSet,
  content: ComposerContent,
  now: LocalDay,
  seed: number,
  count: number = EXTRA_SET_SIZE,
): SessionSlot[] {
  const pool = content.pool
  const order = Object.values(cards.cards)
    .filter((c) => pool.families(c.kc).length > 0)
    .map((card) => ({ kc: card.kc, r: cardRetrievability(card, now) }))
    .sort((a, b) => a.r - b.r || (a.kc < b.kc ? -1 : a.kc > b.kc ? 1 : 0))
  const out: SessionSlot[] = []
  if (order.length === 0) return out
  for (let i = 0; i < order.length * count && out.length < count; i++) {
    const kc = order[i % order.length].kc
    const fams = pool.families(kc)
    const family = fams[((seed >>> 0) + i) % fams.length]
    const item = pool.make(family, kc, pool.level(kc, family), seedFor(seed, i))
    if (item) out.push({ kc, item, level: levelOf(item), reason: 'extra' })
  }
  return out
}

/** The budget line of the done card and the header: "recall SLO 0.90 · error budget 4 cards · refresh due". */
export function budgetLine(plan: Pick<SessionPlan, 'budget' | 'mode'>): string {
  const { slo, allowed, belowSlo } = plan.budget
  const head = `recall SLO ${slo.toFixed(2)}`
  if (plan.mode === 'reentry') return `${head} · welcome back`
  return `${head} · error budget ${allowed} ${allowed === 1 ? 'card' : 'cards'}${belowSlo > 0 ? ' · refresh due' : ''}`
}
