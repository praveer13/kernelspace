import { describe, expect, test } from 'bun:test'
import { cardRetrievability, deriveCards, isDue } from '../../src/lib/learner/cards'
import { composeSession } from '../../src/lib/learner/composer'
import {
  CATCH_UP_COPY,
  DEBT_SESSIONS,
  GAP_DAYS,
  NOMINAL_REVIEW_SEC,
  SESSION_MAX_MINUTES,
  SPREAD_DAYS,
  WELCOME_BACK_COPY,
  addDays,
  dayFromNumber,
  dayNumber,
  daysBetween,
  isDebt,
  isGapReturn,
  planReentry,
  sessionCapacity,
  sessionMinutesOf,
  weekdayOf,
  type AtRisk,
} from '../../src/lib/learner/reentry'
import { splitmix32 } from '../../src/lib/rng'
import { CONTENT, Journal, composerContent, simulate, START } from './ledger-gen'

describe('local days', () => {
  test('agree with the calendar for 160 years of days', () => {
    for (let n = -20_000; n <= 40_000; n += 13) {
      const iso = new Date(n * 86_400_000).toISOString().slice(0, 10)
      expect(dayFromNumber(n)).toBe(iso)
      expect(dayNumber(iso)).toBe(n)
      expect(weekdayOf(iso)).toBe(new Date(n * 86_400_000).getUTCDay())
    }
  })
  test('addDays and daysBetween cross months, years and leap days', () => {
    expect(addDays('2026-10-05', 1)).toBe('2026-10-06')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28')
    expect(addDays('2026-10-05', -280)).toBe('2025-12-29')
    expect(daysBetween('2026-10-05', '2026-10-19')).toBe(14)
    expect(daysBetween('2026-10-19', '2026-10-05')).toBe(-14)
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366)
  })
  test('weekdays count from Sunday', () => {
    expect(weekdayOf('2026-10-04')).toBe(0)
    expect(weekdayOf('2026-10-05')).toBe(1)
    expect(weekdayOf('2026-10-10')).toBe(6)
  })
  test('a malformed day is NaN, never a silent wrong date', () => {
    expect(dayNumber('2026-1-5')).toBeNaN()
    expect(dayNumber('soon')).toBeNaN()
  })
})

describe('sessions and debt (spec §6.4)', () => {
  test('a session is the learner\'s length, at most 12 minutes', () => {
    expect(sessionMinutesOf()).toBe(12)
    expect(sessionMinutesOf(25)).toBe(12)
    expect(sessionMinutesOf(8)).toBe(8)
    expect(sessionMinutesOf(0)).toBe(1)
    expect(sessionMinutesOf(Number.NaN)).toBe(12)
    expect(SESSION_MAX_MINUTES).toBe(12)
  })
  test('capacity is the reviews a session holds at the nominal time', () => {
    expect(sessionCapacity(12)).toBe((12 * 60) / NOMINAL_REVIEW_SEC)
    expect(sessionCapacity(0.1)).toBe(1)
  })
  test('debt is more than two sessions of due work', () => {
    const edge = (2 * 12 * 60) / NOMINAL_REVIEW_SEC // 32 reviews fill exactly two sessions
    expect(DEBT_SESSIONS).toBe(2)
    expect(isDebt(edge, 12)).toBe(false)
    expect(isDebt(edge + 1, 12)).toBe(true)
    expect(isDebt(0, 12)).toBe(false)
    expect(isDebt(10, 2)).toBe(true) // a short session is a small budget
  })
  test('a gap is seven or more days since the last graded event, and needs one', () => {
    expect(GAP_DAYS).toBe(7)
    expect(isGapReturn('2026-10-01', '2026-10-07')).toBe(false)
    expect(isGapReturn('2026-10-01', '2026-10-08')).toBe(true)
    expect(isGapReturn(null, '2026-10-08')).toBe(false)
  })
})

describe('planReentry', () => {
  const ANCHOR = '2026-11-01'
  function overdue(seed: number, n: number): AtRisk[] {
    const rand = splitmix32(seed)
    return Array.from({ length: n }, (_, i) => ({
      kc: `t0.k${String(i).padStart(3, '0')}`,
      priority: rand() < 0.1,
      threshold: rand() < 0.1,
      retrievability: Math.round(rand() * 1000) / 1000, // ties on purpose
      stability: Math.round(rand() * 50) / 5,
    }))
  }
  const byDay = (m: Map<string, string>) => {
    const out = new Map<string, number>()
    for (const d of m.values()) out.set(d, (out.get(d) ?? 0) + 1)
    return out
  }

  test('splits the overdue cards into a welcome-back set and a spread over the next 14 days', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const n = 1 + (seed * 7) % 90
      const cards = overdue(seed, n)
      const cap = 16
      const plan = planReentry(cards, cap, ANCHOR)
      // a partition: every card is in exactly one place
      expect(plan.welcomeBack.length).toBe(Math.min(cap, n))
      expect(plan.spread.size).toBe(n - plan.welcomeBack.length)
      for (const c of cards) expect(plan.welcomeBack.includes(c.kc) !== plan.spread.has(c.kc)).toBe(true)
      // the spread lies in anchor+1 … anchor+14, evenly
      const m = plan.spread.size
      const days = byDay(plan.spread)
      for (const [d, k] of days) {
        expect(daysBetween(ANCHOR, d)).toBeGreaterThanOrEqual(1)
        expect(daysBetween(ANCHOR, d)).toBeLessThanOrEqual(SPREAD_DAYS)
        expect(k).toBeLessThanOrEqual(Math.ceil(m / SPREAD_DAYS))
      }
      if (m >= SPREAD_DAYS) expect(days.size).toBe(SPREAD_DAYS)
      // most urgent first: priority, then threshold, then the lowest recall
      const rank = (c: AtRisk) => [c.priority ? 0 : 1, c.threshold ? 0 : 1, c.retrievability, c.kc] as const
      const spreadCards = cards.filter((c) => plan.spread.has(c.kc))
      spreadCards.sort((a, b) => {
        const [x, y] = [rank(a), rank(b)]
        return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (x[3] < y[3] ? -1 : 1)
      })
      for (let i = 1; i < spreadCards.length; i++) {
        expect(daysBetween(plan.spread.get(spreadCards[i - 1].kc) as string, plan.spread.get(spreadCards[i].kc) as string)).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('the welcome-back set is priority, then threshold, then the sturdiest cards', () => {
    const cards = overdue(3, 60)
    const plan = planReentry(cards, 16, ANCHOR)
    const by = new Map(cards.map((c) => [c.kc, c]))
    const welcome = plan.welcomeBack.map((k) => by.get(k) as AtRisk)
    // nothing left out outranks anything let in
    const left = cards.filter((c) => plan.spread.has(c.kc))
    const tier = (c: AtRisk) => (c.priority ? 0 : c.threshold ? 1 : 2)
    for (const c of left) {
      if (tier(c) < 2) expect(welcome.some((w) => tier(w) > tier(c))).toBe(false)
    }
    const plain = welcome.filter((c) => tier(c) === 2).map((c) => c.stability)
    expect([...plain].sort((a, b) => b - a)).toEqual(plain)
    // with room for everyone nothing is spread
    expect(planReentry(cards, 60, ANCHOR).spread.size).toBe(0)
    // with no room everything is
    expect(planReentry(cards, 0, ANCHOR).welcomeBack).toEqual([])
  })

  test('threshold cards are served first when the set cannot hold everything', () => {
    const cards: AtRisk[] = [
      { kc: 'a', priority: false, threshold: false, retrievability: 0.1, stability: 90 },
      { kc: 'b', priority: false, threshold: true, retrievability: 0.8, stability: 1 },
      { kc: 'c', priority: true, threshold: false, retrievability: 0.9, stability: 1 },
    ]
    expect(planReentry(cards, 2, ANCHOR).welcomeBack).toEqual(['c', 'b'])
    expect(planReentry(cards, 1, ANCHOR).welcomeBack).toEqual(['c'])
  })

  test('is deterministic and ignores the order of the input', () => {
    const cards = overdue(9, 70)
    const a = planReentry(cards, 16, ANCHOR)
    const b = planReentry([...cards].reverse(), 16, ANCHOR)
    expect(b.welcomeBack).toEqual(a.welcomeBack)
    expect([...b.spread]).toEqual([...a.spread])
    expect(planReentry([], 16, ANCHOR)).toEqual({ welcomeBack: [], spread: new Map() })
  })

  test('copy never carries a number', () => {
    expect(WELCOME_BACK_COPY).not.toMatch(/\d/)
    expect(CATCH_UP_COPY).toBe('Catch-up mode: new topics wait until your queue is back under two sessions.')
    expect(WELCOME_BACK_COPY).not.toMatch(/overdue|behind|missed/i)
  })
})

describe('re-entry on a real ledger (cards + composer)', () => {
  /** A learner who works for 60 days, then leaves. The cards are all earned, so nothing is created during the gap. */
  function away(seed: number, gap: number) {
    const r = simulate(seed, { days: 60, pActive: 1, pLesson: 0.6, accuracy: 0.8 })
    const natural = deriveCards(r.events, CONTENT, addDays(r.end, 2)) // two days out: no gap yet, so the natural schedule
    return { r, natural, now: addDays(r.end, gap) }
  }

  test('spreads the overdue cards over 14 days, behind a welcome-back set of one session', () => {
    let spreadCards = 0
    for (const seed of [5, 6, 7, 8]) {
      const { r, natural, now } = away(seed, 25)
      if (natural.pending.length > 0) continue
      const set = deriveCards(r.events, CONTENT, now)
      expect(set.reentry).toBe(true)
      expect(Object.keys(set.cards)).toEqual(Object.keys(natural.cards))
      const moved = Object.values(set.cards).filter((c) => c.dueDay !== natural.cards[c.kc].dueDay)
      const overdue = Object.values(natural.cards).filter((c) => c.dueDay <= now)
      const dueNow = Object.values(set.cards).filter((c) => c.dueDay <= now)
      // one session's worth is due; the rest keep their turn
      expect(dueNow.length).toBe(Math.min(16, overdue.length))
      expect(moved.length).toBe(overdue.length - dueNow.length)
      const perDay = new Map<string, number>()
      for (const c of moved) {
        expect(natural.cards[c.kc].dueDay <= now).toBe(true)
        expect(daysBetween(now, c.dueDay)).toBeGreaterThanOrEqual(1)
        expect(daysBetween(now, c.dueDay)).toBeLessThanOrEqual(14)
        perDay.set(c.dueDay, (perDay.get(c.dueDay) ?? 0) + 1)
      }
      for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(Math.ceil(moved.length / 14))
      if (moved.length >= 14) expect(perDay.size).toBe(14)
      spreadCards += moved.length
      // untouched cards are untouched
      for (const c of Object.values(set.cards)) if (!moved.includes(c)) expect(c.dueDay).toBe(natural.cards[c.kc].dueDay)
    }
    expect(spreadCards).toBeGreaterThan(20)
  })

  test('the next session is a welcome-back that exposes no overdue count', () => {
    const { r, now } = away(5, 25)
    const set = deriveCards(r.events, CONTENT, now)
    const plan = composeSession(set, composerContent(r.events), now, { sessionMinutes: 25, slo: 0.9 }, 3)
    expect(plan.mode).toBe('reentry')
    expect(plan.slots.length).toBeGreaterThan(0)
    expect(plan.estMinutes).toBeLessThanOrEqual(12)
    for (const s of plan.slots) expect(isDue(set.cards[s.kc], now)).toBe(true)
    expect(Object.keys(plan).sort()).toEqual(['budget', 'day', 'estMinutes', 'id', 'mode', 'slots'])
    expect(plan.budget.belowSlo).toBe(0)
    expect(JSON.stringify(plan)).not.toMatch(/overdue/i)
    // the cards a learner is about to be shown slipped far under the SLO, which the plan does not count
    expect(Object.values(set.cards).filter((c) => cardRetrievability(c, now) < 0.9).length).toBeGreaterThan(30)
  })

  test('after the first post-gap answer the spread stays and the session is normal again', () => {
    const { r, now } = away(5, 25)
    const before = deriveCards(r.events, CONTENT, now)
    const first = composeSession(before, composerContent(r.events), now, {}, 3)
    const j = Journal.from(r.events)
    for (const s of first.slots) j.slot(now, s, true)
    const after = deriveCards(j.events, CONTENT, addDays(now, 1))
    expect(after.reentry).toBe(false)
    const answered = new Set(first.slots.map((s) => s.kc))
    for (const c of Object.values(before.cards)) {
      if (!answered.has(c.kc)) expect(after.cards[c.kc].dueDay).toBe(c.dueDay) // the same virtual day, derived again
    }
    expect(composeSession(after, composerContent(j.events), addDays(now, 1), {}, 4).mode).toBe('normal')
  })

  test('a short break changes nothing', () => {
    const r = simulate(5, { days: 60, pActive: 1, pLesson: 0.6 })
    const a = deriveCards(r.events, CONTENT, addDays(r.end, 3))
    expect(a.reentry).toBe(false)
    // the last graded day is `end - 1`
    expect(deriveCards(r.events, CONTENT, addDays(r.end, 5)).reentry).toBe(false) // six days on
    expect(deriveCards(r.events, CONTENT, addDays(r.end, 6)).reentry).toBe(true) // seven days on
  })

  test('a second gap spreads again, from its own return day', () => {
    const { r, now } = away(5, 25)
    const j = Journal.from(r.events)
    j.answer(now, 'r.slices', true)
    const second = addDays(now, 40)
    const set = deriveCards(j.events, CONTENT, second)
    expect(set.reentry).toBe(true)
    const dueNow = Object.values(set.cards).filter((c) => c.dueDay <= second).length
    expect(dueNow).toBeLessThanOrEqual(16)
    for (const c of Object.values(set.cards)) expect(c.dueDay <= second || daysBetween(second, c.dueDay) >= 1).toBe(true)
  })

  test('debt mode is not entered by a returning learner (the spread is what prevents it)', () => {
    const { r, now } = away(5, 60)
    const set = deriveCards(r.events, CONTENT, now)
    expect(set.reentry).toBe(true)
    expect(set.paused).toBe(false)
    expect(START < now).toBe(true)
  })
})
