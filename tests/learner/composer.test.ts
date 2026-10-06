import { describe, expect, test } from 'bun:test'
import { KCS } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import { seedFor } from '../../src/lib/items/core'
import { loadAllFamilies } from '../../src/lib/items/registry'
import type { AuthoredItem, PlayableItem } from '../../src/lib/items/types'
import { cardRetrievability, deriveCards, isConfirmPending, isDue } from '../../src/lib/learner/cards'
import {
  AUTHORED_SEC,
  CONSTRUCTED_SEC,
  EXTRA_SET_SIZE,
  MAX_PROBES,
  composeExtra,
  composeSession,
  budgetLine,
  confusableGroups,
  interleaveConfusable,
  itemKcs,
  itemRef,
  itemSeconds,
  type ComposerContent,
} from '../../src/lib/learner/composer'
import { addDays } from '../../src/lib/learner/reentry'
import { authoredFromLessons, buildPool } from '../../src/lib/learner/today'
import { splitmix32u } from '../../src/lib/rng'
import type { Card, CardSet, SessionSlot } from '../../src/lib/learner/types'
import { CONTENT, composerContent, constructedItem, genItem, quizItem, simulate, START } from './ledger-gen'

const D = (n: number) => addDays(START, n)
const NOW = D(30)

/** A card with a mid-strength memory last reviewed `last` and due `due`. */
function card(kc: string, over: Partial<Card> = {}): Card {
  return {
    kc,
    origin: 'ticket',
    createdDay: D(0),
    memory: { stability: 6, difficulty: 5 },
    lastReviewDay: D(20),
    reps: 2,
    lapses: 0,
    dueDay: D(40),
    priority: false,
    ...over,
  }
}
const set = (cards: Card[], over: Partial<CardSet> = {}): CardSet & { reentry?: boolean } => ({
  cards: Object.fromEntries(cards.map((c) => [c.kc, c])),
  pending: [],
  offset: 0.02,
  paused: false,
  ...over,
})
const kcsOf = (slots: SessionSlot[]) => slots.map((s) => s.kc)
const reasons = (slots: SessionSlot[]) => slots.map((s) => s.reason)

// KCs of the real graph used below: none is in a confusable set or a generator family unless a test says so.
const THR = 't0.locality' // core threshold
const U1 = 't0.flame-graphs'
const U2 = 't0.wait-bars'
const U3 = 't0.runtime-costs'
const PRI = 't0.stride-traversal'
const A = 't0.cache-lines' // confusable with t0.false-sharing
const B = 't0.false-sharing'
const C = 't0.data-layout' // confusable with t0.false-sharing

describe('order (spec §6.3 step 1)', () => {
  test('priority, due threshold, confirmation, then other due cards by lowest recall', () => {
    const cards = set([
      card(U2, { dueDay: D(25), lastReviewDay: D(24) }),
      card(U1, { dueDay: D(25), lastReviewDay: D(10) }),
      card(U3, { dueDay: D(80), lastReviewDay: D(20), confirmDay: D(25), origin: 'testout' }),
      card(THR, { dueDay: D(28), lastReviewDay: D(27) }),
      card(PRI, { dueDay: D(29), lastReviewDay: D(28), priority: true }),
    ])
    const plan = composeSession(cards, composerContent(), NOW, {}, 7)
    // the priority card gets a second, different item
    expect(kcsOf(plan.slots)).toEqual([PRI, PRI, THR, U3, U1, U2])
    expect(reasons(plan.slots)).toEqual(['priority', 'priority', 'threshold', 'confirm', 'due', 'due'])
    expect(plan.slots[0].item).not.toEqual(plan.slots[1].item)
  })

  test('a card that is not due, and has no pending confirmation, is left out', () => {
    const cards = set([card(U1, { dueDay: D(31), lastReviewDay: D(29) }), card(U2, { dueDay: D(30), lastReviewDay: D(29) })])
    expect(kcsOf(composeSession(cards, composerContent(), NOW, {}, 1).slots)).toEqual([U2])
  })

  test('a welcome-back set serves the sturdiest slipped cards first', () => {
    const weak = card(U1, { dueDay: D(20), lastReviewDay: D(10), memory: { stability: 3, difficulty: 5 } })
    const strong = card(U2, { dueDay: D(20), lastReviewDay: D(10), memory: { stability: 40, difficulty: 5 } })
    const cards = { ...set([weak, strong]), reentry: true }
    expect(kcsOf(composeSession(cards, composerContent(), NOW, {}, 1).slots)).toEqual([U2, U1])
    expect(kcsOf(composeSession(set([weak, strong]), composerContent(), NOW, {}, 1).slots)).toEqual([U1, U2]) // lowest recall first
  })
})

describe('the time budget', () => {
  const many = () => set([U1, U2, U3, 't0.idea-reuse', 't0.latency-ladder', 't0.stride-traversal'].map((k, i) => card(k, { dueDay: D(20 + i), lastReviewDay: D(10) })))

  test('is 12 nominal minutes at most, whatever the session length', () => {
    const items = (n: number): ComposerContent =>
      composerContent([], { authored: (kc) => [genItem(kc, `f-${kc}`, 1, n, 200)], make: () => null, families: () => [] })
    const plan = composeSession(many(), items(1), NOW, { sessionMinutes: 90 }, 1)
    expect(plan.slots).toHaveLength(3) // 3 × 200 s = 10 min; a fourth would pass 12
    expect(plan.estMinutes).toBe(10)
  })

  test('shrinks to the learner\'s session length and keeps the queue order', () => {
    const plan = composeSession(many(), composerContent(), NOW, { sessionMinutes: 1 }, 1)
    expect(plan.slots).toHaveLength(2) // 2 × 30 s
    expect(plan.estMinutes).toBe(1)
    expect(kcsOf(plan.slots)).toEqual(kcsOf(composeSession(many(), composerContent(), NOW, {}, 1).slots).slice(0, 2))
  })

  test('always serves one item when anything is due', () => {
    const plan = composeSession(many(), composerContent([], { authored: (kc) => [genItem(kc, 'f', 1, 0, 900)], families: () => [] }), NOW, {}, 1)
    expect(plan.slots).toHaveLength(1)
  })

  test('nothing due and nothing cold is an empty plan', () => {
    const plan = composeSession(set([card(U1, { dueDay: D(60), lastReviewDay: D(29) })]), composerContent(), NOW, {}, 1)
    expect(plan.slots).toEqual([])
    expect(plan.estMinutes).toBe(0)
  })
})

describe('item choice per KC (spec §6.3 step 2)', () => {
  const KC = 't1.external-frag' // generator family `frag`
  const due = (kc: string) => set([card(kc, { dueDay: D(25), lastReviewDay: D(20) })])

  test('a generator family at the staircase level, on a fresh seed', () => {
    const content = composerContent([], { level: () => 3 })
    const a = composeSession(due(KC), content, NOW, {}, 5).slots[0]
    expect(a.item.source).toBe('gen')
    expect(a.level).toBe(3)
    const seen = (s: SessionSlot) => (s.item.source === 'gen' ? s.item.inst.seed : -1)
    expect(seen(a)).toBe(seedFor(5, 0))
    expect(seen(composeSession(due(KC), content, NOW, {}, 6).slots[0])).not.toBe(seen(a))
  })

  test('else an authored item not seen in the last 3 reviews', () => {
    const recent = new Map([[U1, [itemRef(quizItem(U1, 0))]]])
    const plan = composeSession(due(U1), composerContent([], { authored: (kc) => [quizItem(kc, 0), quizItem(kc, 1)], recent: (kc) => recent.get(kc) ?? [] }), NOW, {}, 3)
    expect(plan.slots[0].item).toEqual(quizItem(U1, 1))
  })

  test('else the KC\'s constructed response', () => {
    const recent = [itemRef(quizItem(U1, 0)), itemRef(quizItem(U1, 1))]
    const content = composerContent([], { recent: () => recent, constructed: (kc) => constructedItem(kc) })
    const slot = composeSession(due(U1), content, NOW, {}, 3).slots[0]
    expect(slot.item.source).toBe('cr')
  })

  test('with only recent authored items and no constructed response, the one met longest ago, never a stranded card', () => {
    const recent = [itemRef(quizItem(U1, 0)), itemRef(quizItem(U1, 1))] // newest first: item 1 is the older
    const slot = composeSession(due(U1), composerContent([], { recent: () => recent }), NOW, {}, 3).slots[0]
    expect(slot.item).toEqual(quizItem(U1, 1))
  })

  test('a KC the pool cannot serve at all is skipped and reported', () => {
    const missing: string[] = []
    const content: ComposerContent = { ...composerContent([], { authored: () => [] }), needsContent: (kc) => missing.push(kc) }
    const cards = set([card(U1, { dueDay: D(25) }), card(U2, { dueDay: D(25) })])
    const plan = composeSession(cards, { ...content, pool: { ...content.pool, authored: (kc) => (kc === U1 ? [] : [quizItem(kc, 0)]) } }, NOW, {}, 3)
    expect(kcsOf(plan.slots)).toEqual([U2])
    expect(missing).toEqual([U1])
  })

  test('items and seeds are the same for the same session seed', () => {
    const cards = set([KC, U1, U2].map((k) => card(k, { dueDay: D(25) })))
    expect(composeSession(cards, composerContent(), NOW, {}, 99)).toEqual(composeSession(cards, composerContent(), NOW, {}, 99))
  })
})

describe('interleaving only inside confusable sets (spec §6.3 step 3)', () => {
  const slot = (kc: string, n: number): SessionSlot => ({ kc, item: quizItem(kc, n), reason: 'due' })

  test('connected confusable KCs share a group; others have none', () => {
    const g = confusableGroups(KCS)
    expect(g.get(A)).toBe(g.get(B))
    expect(g.get(C)).toBe(g.get(B))
    expect(g.get('t1.internal-frag')).toBe(g.get('t1.external-frag'))
    expect(g.get(U1)).toBeUndefined()
    expect(g.get(A)).not.toBe(g.get('t1.internal-frag'))
  })

  test('two due KCs of one set are placed adjacent at the first one\'s place', () => {
    const out = interleaveConfusable([slot(A, 0), slot(U1, 0), slot(B, 0), slot(U2, 0)], confusableGroups(KCS))
    expect(kcsOf(out)).toEqual([A, B, U1, U2])
  })

  test('with two or more items each they alternate A B A B', () => {
    const out = interleaveConfusable([slot(A, 0), slot(A, 1), slot(U1, 0), slot(B, 0), slot(B, 1)], confusableGroups(KCS))
    expect(kcsOf(out)).toEqual([A, B, A, B, U1])
  })

  test('with fewer than two items on one side each KC stays together', () => {
    const out = interleaveConfusable([slot(A, 0), slot(A, 1), slot(B, 0)], confusableGroups(KCS))
    expect(kcsOf(out)).toEqual([A, A, B])
  })

  test('a set of three alternates round-robin', () => {
    const slots = [A, B, C].flatMap((k) => [slot(k, 0), slot(k, 1)])
    expect(kcsOf(interleaveConfusable(slots, confusableGroups(KCS)))).toEqual([A, B, C, A, B, C])
  })

  test('KCs outside every set are never reordered', () => {
    const slots = [slot(U3, 0), slot(U1, 0), slot(U2, 0), slot(PRI, 0)]
    expect(interleaveConfusable(slots, confusableGroups(KCS))).toEqual(slots)
  })

  test('a due KC with no confusable partner in the plan is not moved', () => {
    const slots = [slot(U1, 0), slot(A, 0), slot(U2, 0)]
    expect(interleaveConfusable(slots, confusableGroups(KCS))).toEqual(slots)
  })

  test('the composer applies it to the due part of a session', () => {
    const cards = set([
      card(A, { dueDay: D(25), lastReviewDay: D(1) }),
      card(U1, { dueDay: D(25), lastReviewDay: D(10) }),
      card(B, { dueDay: D(25), lastReviewDay: D(20) }),
    ])
    expect(kcsOf(composeSession(cards, composerContent(), NOW, {}, 1).slots)).toEqual([A, B, U1])
  })
})

describe('cold checks (spec §6.3 step 4)', () => {
  const cold = (kc: string, over: Partial<Card> = {}) => card(kc, { dueDay: D(90), lastReviewDay: D(15), ...over })

  test('at most two, after the due items, served as probes', () => {
    const cards = set([card(U1, { dueDay: D(25) }), cold(U2), cold(U3), cold('t0.idea-reuse'), cold('t0.latency-ladder')])
    const plan = composeSession(cards, composerContent(), NOW, {}, 4)
    const probes = plan.slots.filter((s) => s.reason === 'probe')
    expect(probes).toHaveLength(MAX_PROBES)
    expect(plan.slots[0]).toMatchObject({ kc: U1, reason: 'due' })
    expect(plan.slots.slice(-MAX_PROBES)).toEqual(probes)
    for (const p of probes) expect(isDue(cards.cards[p.kc], NOW)).toBe(false)
  })

  test('a welcome-back carries none', () => {
    const cards = { ...set([card(U1, { dueDay: D(25) }), cold(U2), cold(U3)]), reentry: true }
    expect(reasons(composeSession(cards, composerContent(), NOW, {}, 4).slots)).toEqual(['due'])
  })

  test('a KC met less than a week ago, or one that is due, is never a cold check', () => {
    const cards = set([cold(U1, { lastReviewDay: D(24) }), cold(U2, { lastReviewDay: D(23) }), card(U3, { dueDay: D(20), lastReviewDay: D(10) })])
    const plan = composeSession(cards, composerContent(), NOW, {}, 4)
    expect(plan.slots.map((s) => s.reason)).toEqual(['due', 'probe']) // U2: exactly 7 days, due is U3
    expect(plan.slots[1].kc).toBe(U2)
  })

  test('an unreviewed card counts from its creation', () => {
    const fresh = card(U1, { memory: null, lastReviewDay: null, createdDay: D(20), dueDay: D(90), reps: 0 })
    expect(composeSession(set([fresh]), composerContent(), NOW, {}, 1).slots[0]?.reason).toBe('probe')
    expect(composeSession(set([{ ...fresh, createdDay: D(24) }]), composerContent(), NOW, {}, 1).slots).toEqual([])
  })

  test('they sample the eligible KCs by seed', () => {
    const cards = set(['t0.idea-reuse', U1, U2, U3, 't0.latency-ladder', 't0.wait-bars'].map((k) => cold(k)))
    const pick = (seed: number) => kcsOf(composeSession(cards, composerContent(), NOW, {}, seed).slots).join()
    expect(pick(1)).toBe(pick(1))
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(pick)).size).toBeGreaterThan(2)
  })

  test('they take only the time that is left', () => {
    const cards = set([card(U1, { dueDay: D(25) }), cold(U2)])
    const content = composerContent([], { authored: (kc) => [genItem(kc, 'f', 1, 0, kc === U1 ? 700 : 60)], families: () => [] })
    expect(composeSession(cards, content, NOW, {}, 1).slots.map((s) => s.reason)).toEqual(['due'])
  })
})

describe('modes and the budget line (spec §6.3 step 6)', () => {
  test('normal, debt and welcome-back', () => {
    const cards = set([card(U1, { dueDay: D(25) })])
    expect(composeSession(cards, composerContent(), NOW, {}, 1).mode).toBe('normal')
    expect(composeSession({ ...cards, paused: true }, composerContent(), NOW, {}, 1).mode).toBe('debt')
    expect(composeSession({ ...cards, reentry: true }, composerContent(), NOW, {}, 1).mode).toBe('reentry')
    expect(composeSession({ ...cards, paused: true, reentry: true }, composerContent(), NOW, {}, 1).mode).toBe('reentry')
  })

  test('allowed = floor((1 − slo) × cards), in whole numbers', () => {
    const forty = set(Array.from({ length: 40 }, (_, i) => card(`t0.k${i}`, { dueDay: D(90) })))
    expect(composeSession(forty, composerContent(), NOW, { slo: 0.9 }, 1).budget.allowed).toBe(4)
    expect(composeSession(forty, composerContent(), NOW, { slo: 0.85 }, 1).budget.allowed).toBe(6)
    expect(composeSession(forty, composerContent(), NOW, {}, 1).budget.slo).toBe(0.9)
  })

  test('belowSlo counts the cards whose recall is under the SLO', () => {
    const cards = set([
      card(U1, { dueDay: D(90), lastReviewDay: D(29) }),
      card(U2, { dueDay: D(90), lastReviewDay: D(0), memory: { stability: 1, difficulty: 5 } }),
    ])
    const plan = composeSession(cards, composerContent(), NOW, { slo: 0.9 }, 1)
    expect(plan.budget.belowSlo).toBe(1)
    expect(cardRetrievability(cards.cards[U2], NOW)).toBeLessThan(0.9)
    expect(budgetLine(plan)).toBe('recall SLO 0.90 · error budget 0 cards · refresh due')
  })

  test('a welcome-back plan carries no count of what is overdue', () => {
    const cards = { ...set(Array.from({ length: 30 }, (_, i) => card(`t0.k${i}`, { dueDay: D(5), lastReviewDay: D(1) }))), reentry: true }
    const plan = composeSession(cards, composerContent(), NOW, { slo: 0.9 }, 1)
    expect(plan.budget.belowSlo).toBe(0)
    expect(budgetLine(plan)).toBe('recall SLO 0.90 · welcome back')
    expect(budgetLine(plan)).not.toMatch(/overdue/i)
  })

  test('budget lines', () => {
    const b = (allowed: number, belowSlo: number) => budgetLine({ mode: 'normal', budget: { slo: 0.85, allowed, belowSlo } })
    expect(b(1, 0)).toBe('recall SLO 0.85 · error budget 1 card')
    expect(b(4, 2)).toBe('recall SLO 0.85 · error budget 4 cards · refresh due')
  })
})

describe('the plan\'s identity', () => {
  test('a UUID-shaped id that is stable per seed and day and differs across them', () => {
    const cards = set([card(U1, { dueDay: D(25) })])
    const id = (seed: number, day = NOW) => composeSession(cards, composerContent(), day, {}, seed).id
    expect(id(1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(id(1)).toBe(id(1))
    expect(id(1)).not.toBe(id(2))
    expect(id(1)).not.toBe(id(1, D(31)))
    expect(composeSession(cards, composerContent(), NOW, {}, 1).day).toBe(NOW)
  })
})

describe('items', () => {
  test('refs and nominal seconds by source', () => {
    const gen = genItem('t5.kv-capacity', 'kv', 2, 9, 55)
    expect(itemRef(gen)).toBe('gen:kv/v')
    expect(itemSeconds(gen)).toBe(55)
    expect(itemRef(quizItem(U1, 3))).toBe('quiz:t0.l6#3')
    expect(itemSeconds(quizItem(U1, 3))).toBe(AUTHORED_SEC)
    expect(itemRef(constructedItem(U1, 2))).toBe('cr:t0.l6#2')
    expect(itemSeconds(constructedItem(U1, 2))).toBe(CONSTRUCTED_SEC)
    const authored: PlayableItem = { source: 'item', item: { id: 'r.anchor.e0502-1', q: { q: '', options: [], correct: 0 } as never, kcs: [] } }
    expect(itemRef(authored)).toBe('item:r.anchor.e0502-1')
  })
})

describe('"keep going" (spec §6.3 step 5)', () => {
  const KV = 't5.kv-capacity'
  const FR = 't1.external-frag'
  const cards = set([card(KV, { lastReviewDay: D(10) }), card(FR, { lastReviewDay: D(25) }), card(U1)])

  test('five generated items on introduced KCs, lowest recall first, cycling', () => {
    const slots = composeExtra(cards, composerContent(), NOW, 3)
    expect(slots).toHaveLength(EXTRA_SET_SIZE)
    expect(kcsOf(slots)).toEqual([KV, FR, KV, FR, KV])
    for (const s of slots) {
      expect(s.reason).toBe('extra')
      expect(s.item.source).toBe('gen')
    }
  })

  test('deterministic per seed, with a fresh item seed each', () => {
    expect(composeExtra(cards, composerContent(), NOW, 3)).toEqual(composeExtra(cards, composerContent(), NOW, 3))
    const seeds = composeExtra(cards, composerContent(), NOW, 3).map((s) => (s.item.source === 'gen' ? s.item.inst.seed : -1))
    expect(new Set(seeds).size).toBe(EXTRA_SET_SIZE)
  })

  test('nothing when no carded KC has a generator, and it never serves authored items', () => {
    expect(composeExtra(set([card(U1)]), composerContent(), NOW, 3)).toEqual([])
    expect(composeExtra(cards, composerContent([], { make: () => null }), NOW, 3)).toEqual([])
  })
})

describe('properties over generated sessions', () => {
  const SEEDS = [11, 12, 13, 14, 15, 16]
  const groups = confusableGroups(KCS)
  const thresholds = new Set(KCS.filter((k) => k.threshold).map((k) => k.id))
  const tally = { sessions: 0, priority: 0, threshold: 0, confirm: 0, due: 0, probe: 0, debt: 0, sets: 0 }

  test('due before not-due; priority, then threshold, first; confusable adjacency only; the budget holds', () => {
    for (const seed of SEEDS) {
      simulate(seed, {
        days: 100,
        pActive: 0.85,
        pLesson: 0.7,
        accuracy: 0.65,
        onSession: ({ day, cards, session }) => {
          tally.sessions += 1
          const byKc = cards.cards
          const due = session.slots.filter((s) => s.reason !== 'probe' && s.reason !== 'extra')
          const probes = session.slots.filter((s) => s.reason === 'probe')
          // due before not-due: every non-probe slot is a due card, every probe is not, and probes come last
          for (const s of due) expect(isDue(byKc[s.kc], day)).toBe(true)
          for (const s of probes) expect(isDue(byKc[s.kc], day)).toBe(false)
          expect(session.slots.slice(0, due.length)).toEqual(due)
          expect(probes.length).toBeLessThanOrEqual(MAX_PROBES)
          // tiers never regress, except that a confusable set sits where its best-ranked member is
          const tier = (kc: string) => (byKc[kc].priority ? 0 : thresholds.has(kc) ? 1 : isConfirmPending(byKc[kc], day) ? 2 : 3)
          const rank = (kc: string) => {
            const g = groups.get(kc)
            return g === undefined ? tier(kc) : Math.min(...due.filter((x) => groups.get(x.kc) === g).map((x) => tier(x.kc)))
          }
          for (let i = 0; i < due.length; i++) {
            expect(due[i].reason).toBe(['priority', 'threshold', 'confirm', 'due'][tier(due[i].kc)])
            if (i > 0) expect(rank(due[i].kc)).toBeGreaterThanOrEqual(rank(due[i - 1].kc))
          }
          // a KC appears once, twice if it is a priority card, and each group sits in one block
          const seen = new Map<string, number>()
          for (const s of due) seen.set(s.kc, (seen.get(s.kc) ?? 0) + 1)
          for (const [kc, n] of seen) expect(n).toBeLessThanOrEqual(byKc[kc].priority ? 2 : 1)
          const blocks: string[] = []
          for (const s of due) {
            const key = groups.get(s.kc) ?? `kc:${s.kc}`
            if (blocks[blocks.length - 1] !== key) blocks.push(key)
          }
          expect(new Set(blocks).size).toBe(blocks.length)
          if (blocks.length < due.filter((s, i) => i === 0 || due[i - 1].kc !== s.kc).length) tally.sets += 1 // a set shared a block
          // the budget: 12 nominal minutes, or the one item that did not fit an otherwise empty plan
          const sec = session.slots.reduce((t, s) => t + itemSeconds(s.item), 0)
          expect(session.estMinutes).toBe(Math.round(sec / 6) / 10)
          if (session.slots.length > 1) expect(sec).toBeLessThanOrEqual(720)
          expect(session.mode).toBe(cards.reentry ? 'reentry' : cards.paused ? 'debt' : 'normal')
          if (cards.paused) tally.debt += 1
          for (const s of session.slots) tally[s.reason as keyof typeof tally] += 1
          // deterministic per seed
          const again = composeSession(cards, composerContent(), day, { sessionMinutes: 25, slo: 0.9 }, seedFor(seed, 0))
          expect(composeSession(cards, composerContent(), day, { sessionMinutes: 25, slo: 0.9 }, seedFor(seed, 0))).toEqual(again)
        },
      })
    }
    // the generated ledgers must exercise every rule, or the properties above prove little
    expect(tally.sessions).toBeGreaterThan(300)
    expect(tally.priority).toBeGreaterThan(0)
    expect(tally.threshold).toBeGreaterThan(0)
    expect(tally.due).toBeGreaterThan(100)
    expect(tally.probe).toBeGreaterThan(0)
    expect(tally.sets).toBeGreaterThan(50)
  })

  test('the plan is a function of the ledger and the seed: any event order, same plan', () => {
    const r = simulate(21, { days: 50, accuracy: 0.7 })
    const a = deriveCards(r.events, CONTENT, r.end)
    const b = deriveCards([...r.events].reverse(), CONTENT, r.end)
    const plan = (c: typeof a) => composeSession(c, composerContent(r.events), r.end, {}, 77)
    expect(plan(b)).toEqual(plan(a))
  })
})

/* ------------------------------ one item once per session (1b blocking 3) ------------------------------ */

describe('no session serves an item twice', () => {
  const multi = (id: string, kcs: string[]): PlayableItem => ({
    source: 'item',
    item: { id, q: { q: 'q', options: ['a', 'b'], correct: [0], why: ['a', 'b'] }, kcs } as AuthoredItem,
  })
  const SHARED = multi('shared', [U1, U2])
  const only = (items: Record<string, PlayableItem[]>) =>
    composerContent([], { families: () => [], authored: (kc) => items[kc] ?? [], recent: () => [] })
  const dueCards = (kcs: string[], over: Partial<Card> = {}) => set(kcs.map((k) => card(k, { dueDay: D(25), lastReviewDay: D(20), ...over })))

  test('a KC already covered by an earlier slot\'s multi-KC item is skipped, not asked again', () => {
    const content = only({ [U1]: [SHARED], [U2]: [SHARED, quizItem(U2, 0)] })
    for (let seed = 0; seed < 40; seed++) {
      const plan = composeSession(dueCards([U1, U2]), content, NOW, {}, seed)
      expect(plan.slots.map((s) => itemRef(s.item))).toEqual(['item:shared'])
      expect(itemKcs(plan.slots[0].item)).toEqual([U1, U2])
    }
  })

  test('one avoid set spans the session: a later KC takes another item, or none, never the one already served', () => {
    const content = only({ [U1]: [quizItem(U1, 0)], [U2]: [quizItem(U1, 0)], [U3]: [quizItem(U1, 0), quizItem(U3, 0)] })
    const refs = composeSession(dueCards([U1, U2, U3]), content, NOW, {}, 1).slots.map((s) => itemRef(s.item))
    expect(new Set(refs).size).toBe(refs.length)
  })

  test('a KC whose every item was served is not reported as missing content', () => {
    const missing: string[] = []
    const content = { ...only({ [U1]: [quizItem(U1, 0)], [U2]: [quizItem(U1, 0)] }), needsContent: (kc: string) => missing.push(kc) }
    composeSession(dueCards([U1, U2]), content, NOW, {}, 1)
    expect(missing).toEqual([])
    composeSession(dueCards([U3]), content, NOW, {}, 1)
    expect(missing).toEqual([U3])
  })

  test('a priority card still gets its second, different item', () => {
    const plan = composeSession(dueCards([U1], { priority: true }), only({ [U1]: [quizItem(U1, 0), quizItem(U1, 1)] }), NOW, {}, 4)
    expect(new Set(plan.slots.map((s) => itemRef(s.item))).size).toBe(2)
  })

  test('over the real content pool and 500 seeds, no session repeats an item id', async () => {
    const gens = new Map((await loadAllFamilies()).map((g) => [g.id, g] as const))
    const { authored, constructed } = authoredFromLessons(ALL_LESSONS)
    const pool = buildPool({ kcs: KCS, gens, authored, constructed, stair: [], recent: new Map() })
    const content: ComposerContent = { ...CONTENT, pool }
    const servable = KCS.filter((k) => pool.families(k.id).length > 0 || pool.authored(k.id).length > 0 || pool.constructed(k.id)).map((k) => k.id)
    expect(servable.length).toBeGreaterThan(40)
    // an instance of a generated item is its family, variant and seed; every other item is its ref
    const idOf = (item: PlayableItem) => (item.source === 'gen' ? `${itemRef(item)}@${item.inst.seed}` : itemRef(item))
    const tally = { sessions: 0, shared: 0, skipped: 0 }
    for (let seed = 0; seed < 500; seed++) {
      const next = splitmix32u(seed * 7919 + 13)
      const n = 3 + (next() % 8) // 3 to 10 due cards
      const kcs = new Set<string>()
      while (kcs.size < n) kcs.add(servable[next() % servable.length])
      const cards = set([...kcs].map((kc) => card(kc, { dueDay: D(25 + (next() % 4)), lastReviewDay: D(15 + (next() % 8)), priority: next() % 9 === 0 })))
      const plan = composeSession(cards, content, NOW, { sessionMinutes: 12 }, seedFor(seed, 1))
      const ids = plan.slots.map((s) => idOf(s.item))
      expect(new Set(ids).size).toBe(ids.length)
      const covered = new Set<string>()
      for (const slot of plan.slots) {
        const kcsOfItem = itemKcs(slot.item)
        for (const k of kcsOfItem) covered.add(k)
        if (kcsOfItem.length > 1) tally.shared += 1
      }
      tally.skipped += [...kcs].filter((kc) => !plan.slots.some((s) => s.kc === kc) && covered.has(kc)).length
      tally.sessions += 1
    }
    // the draw must exercise the rule: multi-KC items served, and KCs skipped because one already covered them
    expect(tally.sessions).toBe(500)
    expect(tally.shared).toBeGreaterThan(0)
    expect(tally.skipped).toBeGreaterThan(0)
  })
})
