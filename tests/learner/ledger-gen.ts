/**
 * Test support for the learner model (B12): generated ledgers over the real KC graph.
 *
 * `simulate(seed)` runs a learner through `deriveCards` and `composeSession` day by day, so the ledgers the
 * property tests judge are the ones the loop itself produces (cards earned from lesson passes, sessions
 * composed from the due queue, answers written back as events). Everything is driven by splitmix32, so a seed
 * replays exactly. Fake items stand in for the generator families and the authored content: the composer
 * only needs an `Instance` or a `QuizQuestion` to carry, never to render.
 */
import { BOOT_KCS, KCS } from '../../src/data/kc'
import { seedFor } from '../../src/lib/items/core'
import type { Level, PlayableItem } from '../../src/lib/items/types'
import type { Kc, KcId } from '../../src/lib/kc/types'
import { cardsContent, deriveCards, recentReviewRefs, type CardsContent, type CardsPlan, type DerivedCards } from '../../src/lib/learner/cards'
import { composeSession, itemRef, type ComposerContent, type ItemPool } from '../../src/lib/learner/composer'
import { addDays } from '../../src/lib/learner/reentry'
import type { SessionPlan, SessionSlot } from '../../src/lib/learner/types'
import type { LedgerEvent, LocalDay } from '../../src/lib/ledger/types'
import { splitmix32 } from '../../src/lib/rng'

export const START: LocalDay = '2026-09-01'

export const KC_BY_ID = new Map<KcId, Kc>(KCS.map((k) => [k.id, k]))

/** Lessons in curriculum order with the KCs they introduce (`Lesson.kcs` of the real content, by the graph's own record). */
export const LESSONS: { id: string; kcs: KcId[] }[] = (() => {
  const out = new Map<string, KcId[]>()
  for (const k of KCS) if (k.lessons[0]) out.set(k.lessons[0], [...(out.get(k.lessons[0]) ?? []), k.id])
  return [...out].map(([id, kcs]) => ({ id, kcs }))
})()

/** The injected resolver of these tests: the write-time tag, which every generated event carries. */
export const resolveTag = (e: LedgerEvent): readonly KcId[] => (e as { data?: { kcs?: KcId[] } }).data?.kcs ?? []

export const CONTENT: CardsContent = cardsContent({ kcs: KCS, lessons: LESSONS, bootKcs: BOOT_KCS, resolve: resolveTag })

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export function genItem(kc: KcId, family: string, level: Level, seed: number, nsec = 40): PlayableItem {
  return {
    source: 'gen',
    inst: {
      family,
      version: 1,
      variant: 'v',
      seed,
      level,
      params: {},
      kcs: [kc],
      prompt: { stem: [] },
      answer: { kind: 'numeric', truth: 1, unit: '', tolerance: {} },
      claims: [],
      rev: 'r',
      nsec,
    },
  }
}

export function quizItem(kc: KcId, qi: number): PlayableItem {
  const lessonId = KC_BY_ID.get(kc)?.lessons[0] ?? 'x.l0'
  return { source: 'quiz', lessonId, qi, q: { q: 'q', options: ['a', 'b'], correct: 0 } as never, kcs: [kc] }
}

export function constructedItem(kc: KcId, index = 0): PlayableItem {
  const lessonId = KC_BY_ID.get(kc)?.lessons[0] ?? 'x.l0'
  return { source: 'cr', lessonId, index, cr: { prompt: 'p', model: 'm', ideas: ['a', 'b', 'c'], kcs: [kc] } }
}

/** A pool over the real graph: a KC with `gen` is served by its first family, every KC has two authored items. */
export function makePool(recent: ReadonlyMap<KcId, string[]> = new Map(), over: Partial<ItemPool> = {}): ItemPool {
  return {
    families: (kc) => KC_BY_ID.get(kc)?.gen ?? [],
    level: () => 1,
    make: (family, kc, level, seed) => genItem(kc, family, level, seed),
    authored: (kc) => [quizItem(kc, 0), quizItem(kc, 1)],
    constructed: () => null,
    recent: (kc) => recent.get(kc) ?? [],
    ...over,
  }
}

export function composerContent(events: readonly LedgerEvent[] = [], over: Partial<ItemPool> = {}): ComposerContent {
  return { ...CONTENT, pool: makePool(recentReviewRefs(events, CONTENT), over) }
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

type Extra = Record<string, unknown>

/** Appends events with ids and instants that increase, one `day` at a time. */
export class Journal {
  events: LedgerEvent[] = []
  private n = 0

  /** Continue a ledger: new ids never collide with the old ones. */
  static from(events: readonly LedgerEvent[]): Journal {
    const j = new Journal()
    j.events = [...events]
    j.n = events.length
    return j
  }

  private sec = new Map<LocalDay, number>()

  add(kind: string, ref: string, day: LocalDay, extra: Extra = {}): LedgerEvent {
    const s = (this.sec.get(day) ?? 8 * 3600) + 20
    this.sec.set(day, s)
    const hh = String(Math.floor(s / 3600)).padStart(2, '0')
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    const graded = ['item', 'probe', 'quiz', 'predict', 'sim-task', 'lab-check', 'play', 'prove'].includes(kind)
    const e = {
      id: `g${String(this.n++).padStart(6, '0')}`,
      v: 1,
      kind,
      ref,
      at: `${day}T${hh}:${mm}:${ss}.000Z`,
      tz: 0,
      day,
      dev: 'dev-1',
      ...(graded ? { score: 1, ok: true, provenance: 'practice' } : {}),
      ...extra,
    } as unknown as LedgerEvent
    this.events.push(e)
    return e
  }

  /** One graded answer to `kc` as Today writes it. */
  answer(day: LocalDay, kc: KcId, ok: boolean, o: { conf?: 'guess' | 'think' | 'sure'; ms?: number; nsec?: number; ref?: string; kind?: 'item' | 'probe'; extra?: Extra } = {}): LedgerEvent {
    return this.add(o.kind ?? 'item', o.ref ?? `gen:frag/v`, day, {
      score: ok ? 1 : 0,
      ok,
      rev: 'r',
      ...(o.conf ? { conf: o.conf } : {}),
      ...(o.ms !== undefined ? { ms: o.ms } : {}),
      data: { src: 'today', kcs: [kc], nsec: o.nsec ?? 40, ...o.extra },
    })
  }

  /** An exit ticket pass: the ticket's item events, then the `ok` quiz summary the lesson passes on. */
  passLesson(day: LocalDay, lessonId: string, kcs: readonly KcId[], form: 'ticket' | 'testout' | 'spiral' = 'ticket'): void {
    kcs.forEach((kc, i) => this.answer(day, kc, true, { ref: `quiz:${lessonId}#${i}`, extra: { src: form, form, lessonId } }))
    this.add('quiz', `lesson:${lessonId}`, day, { score: 1, ok: true, data: { form, kcs: [...kcs], n: kcs.length } })
  }

  /** The answer events of a session slot, `ok` decided by the caller. */
  slot(day: LocalDay, s: SessionSlot, ok: boolean, o: { conf?: 'guess' | 'think' | 'sure'; ms?: number } = {}): LedgerEvent {
    const seed = s.item.source === 'gen' ? s.item.inst.seed : undefined
    return this.answer(day, s.kc, ok, {
      ...o,
      ref: itemRef(s.item),
      kind: s.reason === 'probe' ? 'probe' : 'item',
      nsec: s.item.source === 'gen' ? s.item.inst.nsec : 30,
      extra: { reason: s.reason, ...(seed !== undefined ? { seed } : {}) },
    })
  }
}

/* ------------------------------------------------------------------ */
/* The simulated learner                                               */
/* ------------------------------------------------------------------ */

export interface SessionCtx {
  day: LocalDay
  cards: DerivedCards
  session: SessionPlan
  events: readonly LedgerEvent[]
}

export interface SimOptions {
  days?: number
  start?: LocalDay
  /** Chance a day is active at all. */
  pActive?: number
  /** Chance an answer is right. */
  accuracy?: number
  /** Chance an active day also passes the next lesson. */
  pLesson?: number
  /** Chance an active day actually answers the composed session (false: the learner only opens a lesson). */
  pReview?: number
  plan?: CardsPlan
  /** Called with every composed session, before its answers are written. */
  onSession?: (ctx: SessionCtx) => void
}

export interface SimResult {
  events: LedgerEvent[]
  /** The day after the last simulated day. */
  end: LocalDay
}

export function simulate(seed: number, o: SimOptions = {}): SimResult {
  const rand = splitmix32(seed)
  const j = new Journal()
  const start = o.start ?? START
  const days = o.days ?? 60
  const plan: CardsPlan = o.plan ?? { slo: 0.9, sessionMinutes: 25 }
  let nextLesson = 0
  for (let d = 0; d < days; d++) {
    const day = addDays(start, d)
    if (rand() >= (o.pActive ?? 0.7)) continue
    if (rand() < (o.pReview ?? 1)) {
      const cards = deriveCards(j.events, CONTENT, day, plan)
      const session = composeSession(cards, composerContent(j.events), day, plan, seedFor(seed, d))
      o.onSession?.({ day, cards, session, events: j.events })
      for (const s of session.slots) {
        const ok = rand() < (o.accuracy ?? 0.8)
        const r = rand()
        j.slot(day, s, ok, { conf: r < 0.3 ? 'sure' : r < 0.8 ? 'think' : 'guess', ms: Math.floor(rand() * 60_000) })
      }
    }
    if (nextLesson < LESSONS.length && rand() < (o.pLesson ?? 0.5)) {
      const l = LESSONS[nextLesson++]
      j.passLesson(day, l.id, l.kcs)
    }
  }
  return { events: j.events, end: addDays(start, days) }
}

/** The same events in a different order: every property of the derivation must hold regardless. */
export function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const rand = splitmix32(seed)
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1))
    ;[out[i], out[k]] = [out[k], out[i]]
  }
  return out
}
