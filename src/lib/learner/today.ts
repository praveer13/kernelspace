/**
 * Today's glue (docs/specs/wave-1.md §6.3, §6.6-§6.8): everything /today needs that is not a component.
 * The composer, cards and planner are pure and already tested; this module binds them to the world
 * (an item pool over the generator families and the authored lessons) and turns what the learner does
 * into ledger writes and into the lines the page prints.
 *
 * - **Pool:** `buildPool` serves a KC from a generator family at its staircase level on a fresh seed, else
 *   from the authored items tagged with it, else from its constructed response (composer.ts picks the order).
 * - **Writes:** `itemResponseOf` is one `item` (or `probe`) event per answer, `src` `today`, `grp` the session id.
 *   A generated item on a seed the learner has never met is provenance `unseen`, anything else `practice` (§6.7).
 * - **Copy:** the SLO line, week bar, banner, done line and "item 3 of 9 · ~7 min left". None of it ever
 *   carries a count of what is overdue (a test holds that line, as reentry.ts does for its own copy).
 *
 * Pure except `loadTodayContent`, which fetches the lesson data and the families on demand. Both stay out
 * of the `/today` first-load closure: the page imports this module, and this module imports them lazily.
 */

import type { Lesson } from '@/data/lessons/types'
import type { ItemResult } from '@/lib/items/play'
import { levelFor, type StairEvent } from '@/lib/items/staircase'
import type { Gen, Instance, Level, PlayableItem } from '@/lib/items/types'
import type { Kc, KcId } from '@/lib/kc/types'
import { CATCH_UP_COPY, WELCOME_BACK_COPY, dayNumber, weekdayOf } from '@/lib/learner/reentry'
import type { ItemData, ItemRef, ItemResponse, Json, LedgerEvent, LocalDay } from '@/lib/ledger/types'
import { seedFor } from '@/lib/items/core'
import { budgetLine, itemSeconds, type ItemPool } from './composer'
import type { FirstReviewCalibration, SessionMode, SessionPlan, SessionSlot, SlotReason, WeekStatus } from './types'

/* ------------------------------------------------------------------ */
/* Preferences (`today:prefs`)                                         */
/* ------------------------------------------------------------------ */

export interface TodayPrefs {
  /** Sims open in phone mode below 640 px unless this is `false` (spec §10.4). */
  phoneMode?: boolean
  /** The review budget in minutes; the composer takes `min(12, this)`. */
  sessionMinutes?: number
}

/** The lengths the week sheet offers. */
export const SESSION_CHOICES: readonly number[] = [6, 8, 10, 12]
export const SESSION_MIN = 3
export const SESSION_MAX = 12

/** The prefs from a working record's value (any JSON): a malformed field is left out, never thrown on. */
export function parsePrefs(raw: Json | undefined | null): TodayPrefs {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const { phoneMode, sessionMinutes } = raw as Record<string, Json>
  return {
    ...(typeof phoneMode === 'boolean' ? { phoneMode } : {}),
    ...(typeof sessionMinutes === 'number' && Number.isFinite(sessionMinutes)
      ? { sessionMinutes: Math.min(SESSION_MAX, Math.max(SESSION_MIN, Math.round(sessionMinutes))) }
      : {}),
  }
}

/* ------------------------------------------------------------------ */
/* Header copy                                                         */
/* ------------------------------------------------------------------ */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** "Today · Sat 4 Oct", from the local day alone (no Date, so it reads the same in every zone). */
export function dayHeading(day: LocalDay): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m || Number.isNaN(dayNumber(day))) return 'Today'
  return `Today · ${WEEKDAYS[weekdayOf(day)]} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`
}

/**
 * The SLO line (spec §6.3 step 6): "recall SLO 0.90 · error budget 4 cards · refresh due". It names the
 * budget, never a count of what is overdue; a welcome-back says only that.
 */
export function sloLine(plan: Pick<SessionPlan, 'budget' | 'mode'>, cardCount: number): string {
  if (cardCount === 0) return `recall SLO ${plan.budget.slo.toFixed(2)} · no cards yet`
  return budgetLine(plan)
}

/** "95 / 180 min this week". */
export function weekBarText(week: Pick<WeekStatus, 'doneMinutes' | 'targetMinutes'>): string {
  return `${Math.round(week.doneMinutes)} / ${Math.round(week.targetMinutes)} min this week`
}

/** The week bar's fill, 0 to 100. */
export function weekBarPct(week: Pick<WeekStatus, 'doneMinutes' | 'targetMinutes'>): number {
  return week.targetMinutes > 0 ? Math.min(100, Math.max(0, Math.round((week.doneMinutes / week.targetMinutes) * 100))) : 0
}

export interface Banner {
  kind: 'welcome-back' | 'catch-up'
  text: string
}

/** The welcome-back or catch-up banner (spec §6.4), when the session's mode asks for one. Neither carries a number. */
export function bannerFor(mode: SessionMode): Banner | null {
  if (mode === 'reentry') return { kind: 'welcome-back', text: WELCOME_BACK_COPY }
  if (mode === 'debt') return { kind: 'catch-up', text: CATCH_UP_COPY }
  return null
}

/** "item 3 of 9 · ~7 min left": the nominal time of this item and every one after it, rounded up. */
export function progressLabel(index: number, slots: readonly SessionSlot[]): string {
  const sec = slots.slice(index).reduce((s, slot) => s + itemSeconds(slot.item), 0)
  return `item ${index + 1} of ${slots.length} · ~${Math.max(1, Math.ceil(sec / 60))} min left`
}

/* ------------------------------------------------------------------ */
/* The done card                                                       */
/* ------------------------------------------------------------------ */

/** What the done card needs from one answered slot. */
export interface SlotOutcome {
  reason: SlotReason
  ok: boolean
  /** Milliseconds from first show to submit. */
  ms: number
}

export interface Tally {
  items: number
  minutes: number
  right: number
  /** Cards that were due (priority, threshold, due or day-7 confirmation), as opposed to cold checks. */
  due: { right: number; of: number }
}

const DUE_REASONS: ReadonlySet<SlotReason> = new Set<SlotReason>(['priority', 'threshold', 'due', 'confirm'])

export function tally(outcomes: readonly SlotOutcome[]): Tally {
  let ms = 0
  let right = 0
  const due = { right: 0, of: 0 }
  for (const o of outcomes) {
    ms += o.ms
    if (o.ok) right += 1
    if (DUE_REASONS.has(o.reason)) {
      due.of += 1
      if (o.ok) due.right += 1
    }
  }
  return { items: outcomes.length, minutes: outcomes.length === 0 ? 0 : Math.max(1, Math.round(ms / 60_000)), right, due }
}

/** "9 items · 11 min · due cards 7/9 right". */
export function doneLine(t: Tally): string {
  const parts = [`${t.items} ${t.items === 1 ? 'item' : 'items'}`, `${t.minutes} min`]
  if (t.due.of > 0) parts.push(`due cards ${t.due.right}/${t.due.of} right`)
  return parts.join(' · ')
}

/** "predicted 88 %, observed 84 %": once 20 first reviews exist (spec §6.8), else nothing. */
export function firstReviewLine(cal: FirstReviewCalibration): string | null {
  if (cal.n < 20 || cal.meanPredicted === null || cal.observed === null) return null
  return `predicted ${Math.round(cal.meanPredicted * 100)} %, observed ${Math.round(cal.observed * 100)} %`
}

const isoMs = (e: Pick<LedgerEvent, 'at'>): number => Date.parse(e.at)

/**
 * The span G7 measures (spec §17): the last item's `at` minus the first item's `at`, plus the last item's
 * `ms`, over the events of one session (`data.grp`). Null when the session has no item.
 */
export function sessionSpanMs(events: Iterable<LedgerEvent>, grp: string): number | null {
  const mine = [...events]
    .filter((e) => (e.kind === 'item' || e.kind === 'probe') && (e as { data?: { grp?: string } }).data?.grp === grp)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))
  if (mine.length === 0) return null
  const last = mine[mine.length - 1]
  const ms = (last as { ms?: unknown }).ms
  return isoMs(last) - isoMs(mine[0]) + (typeof ms === 'number' && ms >= 0 ? ms : 0)
}

/* ------------------------------------------------------------------ */
/* Ledger writes                                                       */
/* ------------------------------------------------------------------ */

/** Where an answer came from: a Today session or practice outside the queue (the empty state's new numbers). */
export type TodaySrc = 'today' | 'practice'

export interface SlotContext {
  /** The session id: every item event of one session shares it as `data.grp`. */
  grp: string
  slot: number
  of: number
  reason: SlotReason
  src: TodaySrc
  /** Probes: whole days since the learner last met the KC (spec §17 G3). */
  sinceDays?: number
}

/** The identity of one served instance: where it came from, at which level, on which seed. */
export const instanceKey = (ref: string, level: number | undefined, seed: number): string => `${ref}@${level ?? '-'}:${seed}`

/** Every generated instance the learner has already been served, from the ledger's item and probe events. */
export function seenInstances(events: Iterable<LedgerEvent>): Set<string> {
  const seen = new Set<string>()
  for (const e of events) {
    if ((e.kind !== 'item' && e.kind !== 'probe') || !e.ref.startsWith('gen:')) continue
    const seed = (e as { seed?: number }).seed
    if (typeof seed !== 'number') continue
    seen.add(instanceKey(e.ref, (e as { data?: { level?: number } }).data?.level, seed))
  }
  return seen
}

/**
 * `unseen` for a generated item on a seed the learner has not met (that is what makes it a clean
 * measurement, PLAN V6); `practice` for everything else, which carries a lower credit weight.
 */
export function provenanceOf(result: Pick<ItemResult, 'source' | 'ref' | 'level' | 'seed'>, seen: ReadonlySet<string>): 'unseen' | 'practice' {
  return result.source === 'gen' && !seen.has(instanceKey(result.ref, result.level, result.seed)) ? 'unseen' : 'practice'
}

const MAX_KCS = 6
const MAX_NSEC = 600

/** The ledger input for one answered item (spec §6.7): `item`, or `probe` for a cold check. */
export function itemResponseOf(result: ItemResult, item: PlayableItem, ctx: SlotContext, seen: ReadonlySet<string>): ItemResponse {
  const r = result.response
  const truth = item.source === 'gen' && item.inst.answer.kind !== 'choice' ? item.inst.answer.truth : undefined
  const data: ItemData = {
    src: ctx.src,
    grp: ctx.grp,
    slot: ctx.slot,
    of: ctx.of,
    reason: ctx.reason,
    kcs: result.kcs.slice(0, MAX_KCS),
    nsec: Math.min(MAX_NSEC, Math.max(0, Math.round(result.nsec))),
    ...(result.level === undefined ? {} : { level: result.level }),
    ...(result.variant === undefined ? {} : { variant: result.variant }),
    ...(item.source === 'quiz' || item.source === 'cr' ? { lessonId: item.lessonId } : {}),
    ...(ctx.reason === 'probe' && ctx.sinceDays !== undefined ? { sinceDays: Math.max(0, Math.round(ctx.sinceDays)) } : {}),
    ...(r.kind === 'numeric' ? { value: r.value, ...(r.unit ? { unit: r.unit } : {}) } : {}),
    ...(r.kind === 'estimate'
      ? { value: r.value, ...(r.lo !== undefined && r.hi !== undefined ? { lo: r.lo, hi: r.hi } : {}) }
      : {}),
    ...(r.kind === 'choice' && result.pick === undefined ? { picks: r.picks } : {}),
    ...(result.pick === undefined ? {} : { pick: result.pick }),
    ...(result.ideas === undefined ? {} : { ideas: result.ideas }),
    ...(truth === undefined ? {} : { truth }),
    ...(result.grade.interval ? { hit: result.grade.interval.hit } : {}),
    ...(result.grade.diagnosis ? { miss: result.grade.diagnosis.id } : {}),
  }
  return {
    kind: ctx.reason === 'probe' ? 'probe' : 'item',
    ref: result.ref as ItemRef,
    rev: result.rev,
    score: result.score,
    ok: result.ok,
    ...(result.conf ? { conf: result.conf } : {}),
    seed: result.seed,
    ms: result.ms,
    provenance: provenanceOf(result, seen),
    data,
  }
}

/* ------------------------------------------------------------------ */
/* The item pool                                                       */
/* ------------------------------------------------------------------ */

export interface PoolInput {
  kcs: readonly Kc[]
  /** The generator families that loaded, by id. */
  gens: ReadonlyMap<string, Gen>
  /** Authored items by KC; an item carrying several KCs is listed under each. */
  authored: ReadonlyMap<KcId, readonly PlayableItem[]>
  constructed: ReadonlyMap<KcId, PlayableItem>
  /** The learner's graded history, for the staircase level (`item` and `probe` events of generated items). */
  stair: readonly StairEvent[]
  /** `recentReviewRefs`: refs of each KC's last reviews, newest first. */
  recent: ReadonlyMap<KcId, readonly string[]>
}

/**
 * The level a family can serve `kc` at: `level` itself when some variant of the KC offers it, else the
 * nearest one that is offered (the staircase asks for a level; a family may only teach some of them).
 */
function servableLevel(gen: Gen, kc: KcId, level: Level): Level | null {
  const offered = new Set<Level>()
  for (const v of gen.variants) if (v.kcs.includes(kc)) for (const l of v.levels) offered.add(l)
  if (offered.size === 0) return null
  if (offered.has(level)) return level
  return [...offered].sort((a, b) => Math.abs(a - level) - Math.abs(b - level) || a - b)[0]
}

/** One instance of `family` for `kc`: the seed picks among the variants that teach the KC at the level. Null when none does. */
export function makeInstance(gen: Gen, kc: KcId, level: Level, seed: number): Instance | null {
  const at = servableLevel(gen, kc, level)
  if (at === null) return null
  const variants = gen.variants.filter((v) => v.kcs.includes(kc) && v.levels.includes(at))
  const variant = variants[(seed >>> 0) % variants.length]
  try {
    return gen.make(seed >>> 0, at, variant.id)
  } catch {
    return null
  }
}

export function buildPool(input: PoolInput): ItemPool {
  const byId = new Map<KcId, Kc>(input.kcs.map((k) => [k.id, k]))
  return {
    families: (kc) => (byId.get(kc)?.gen ?? []).filter((f) => input.gens.has(f)),
    level: (kc, family) => levelFor(input.stair, kc, family),
    make(family, kc, level, seed) {
      const gen = input.gens.get(family)
      const inst = gen ? makeInstance(gen, kc, level, seed) : null
      return inst ? { source: 'gen', inst } : null
    },
    authored: (kc) => input.authored.get(kc) ?? [],
    constructed: (kc) => input.constructed.get(kc) ?? null,
    recent: (kc) => input.recent.get(kc) ?? [],
  }
}

/** The staircase's view of a session's answers so far, to append to the loaded history (a "keep going" set levels up on them). */
export function stairEventOf(result: Pick<ItemResult, 'ref' | 'kcs' | 'ok'>, at: string): StairEvent {
  return { kind: 'item', ref: result.ref, at, ok: result.ok, data: { kcs: result.kcs } }
}

/**
 * Authored items by KC, from the lessons' checkpoints (`quiz:<id>#<qi>`, counted lesson-wide as QuizBlock
 * and the resolver count them), constructed responses (`cr:`) and spiral items (`item:`). Only items that
 * carry `kcs` are served: an untagged question has no card to review.
 */
export function authoredFromLessons(lessons: readonly Lesson[]): { authored: Map<KcId, PlayableItem[]>; constructed: Map<KcId, PlayableItem> } {
  const authored = new Map<KcId, PlayableItem[]>()
  const constructed = new Map<KcId, PlayableItem>()
  const add = (item: PlayableItem, kcs: readonly KcId[] | undefined) => {
    for (const kc of kcs ?? []) authored.set(kc, [...(authored.get(kc) ?? []), item])
  }
  for (const lesson of lessons) {
    let qi = 0
    for (const b of lesson.blocks) {
      if (b.type !== 'quiz') continue
      for (const q of b.questions) {
        if (q.kcs?.length) add({ source: 'quiz', lessonId: lesson.id, qi, q, kcs: q.kcs }, q.kcs)
        qi += 1
      }
    }
    lesson.ticket?.cr.forEach((cr, index) => {
      if (cr.kcs.length === 0) return
      const item: PlayableItem = { source: 'cr', lessonId: lesson.id, index, cr }
      for (const kc of cr.kcs) if (!constructed.has(kc)) constructed.set(kc, item)
    })
    for (const item of lesson.ticket?.spiral ?? []) add({ source: 'item', item }, item.kcs)
  }
  return { authored, constructed }
}

/**
 * "Practice with new numbers" (spec §6.8 empty state, and "keep going"): `count` generated items over `kcs`,
 * one KC after another, each on its own fresh seed at the staircase level. KCs no family serves are skipped.
 */
export function composePractice(kcs: readonly KcId[], pool: ItemPool, seed: number, count: number, reason: SlotReason = 'extra'): SessionSlot[] {
  const servable = kcs.filter((kc) => pool.families(kc).length > 0)
  const out: SessionSlot[] = []
  if (servable.length === 0) return out
  for (let i = 0; i < servable.length * count && out.length < count; i++) {
    const kc = servable[i % servable.length]
    const fams = pool.families(kc)
    const family = fams[((seed >>> 0) + i) % fams.length]
    const item = pool.make(family, kc, pool.level(kc, family), seedFor(seed, i))
    if (item) out.push({ kc, item, level: item.source === 'gen' ? item.inst.level : undefined, reason })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Changes                                                             */
/* ------------------------------------------------------------------ */

/** "3 things you learned have changed". */
export function changesLine(count: number): string {
  return `${count} ${count === 1 ? 'thing' : 'things'} you learned ${count === 1 ? 'has' : 'have'} changed`
}

/* ------------------------------------------------------------------ */
/* Content (lazy)                                                      */
/* ------------------------------------------------------------------ */

/** What a session is built from, loaded once per visit and kept out of the first-load closure. */
export interface TodayContent {
  kcs: readonly Kc[]
  bootKcs: readonly KcId[]
  lessons: readonly Lesson[]
  gens: ReadonlyMap<string, Gen>
  authored: ReadonlyMap<KcId, readonly PlayableItem[]>
  constructed: ReadonlyMap<KcId, PlayableItem>
  /** `kcsOfEvent` over the lessons' current tags and the families' KCs (spec §4.6). */
  resolve(e: LedgerEvent): readonly KcId[]
}

/** Fetch the KC graph, the lessons, the resolver and every generator family, in parallel. */
export async function loadTodayContent(): Promise<TodayContent> {
  const [kc, lessonsMod, resolveMod, registry] = await Promise.all([
    import('@/data/kc'),
    import('@/data/lessons'),
    import('@/lib/kc/resolve'),
    import('@/lib/items/registry'),
  ])
  const gens = new Map((await registry.loadAllFamilies()).map((g) => [g.id, g] as const))
  const lessons = lessonsMod.ALL_LESSONS
  const content = resolveMod.buildKcContent({ lessons, gens: [...gens.values()] })
  const { authored, constructed } = authoredFromLessons(lessons)
  return {
    kcs: kc.KCS,
    bootKcs: kc.BOOT_KCS,
    lessons,
    gens,
    authored,
    constructed,
    resolve: (e) => resolveMod.kcsOfEvent(e, content),
  }
}
