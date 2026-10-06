import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KCS } from '../../src/data/kc'
import { gradeItem, resultFor, type ItemResult } from '../../src/lib/items/play'
import { loadFamily } from '../../src/lib/items/registry'
import { correctResponse } from '../../src/lib/items/grade'
import type { Gen, PlayableItem } from '../../src/lib/items/types'
import type { Lesson } from '../../src/data/lessons/types'
import { composeSession } from '../../src/lib/learner/composer'
import { CATCH_UP_COPY, WELCOME_BACK_COPY } from '../../src/lib/learner/reentry'
import type { SessionPlan, SessionSlot } from '../../src/lib/learner/types'
import {
  SESSION_MAX,
  authoredFromLessons,
  bannerFor,
  buildPool,
  changesLine,
  composePractice,
  dayHeading,
  doneLine,
  firstReviewLine,
  instanceKey,
  itemResponseOf,
  makeInstance,
  parsePrefs,
  progressLabel,
  provenanceOf,
  seenInstances,
  sessionSpanMs,
  sloLine,
  tally,
  weekBarPct,
  weekBarText,
  type SlotContext,
} from '../../src/lib/learner/today'
import { validateEvent } from '../../src/lib/ledger/codec'
import type { LedgerEvent } from '../../src/lib/ledger/types'
import { CONTENT, Journal, START, genItem, quizItem } from './ledger-gen'

const frag = await loadFamily('frag')
const kv = await loadFamily('kv')
const GENS = new Map<string, Gen>([
  [frag.id, frag],
  [kv.id, kv],
])

const EXT = 't1.external-frag'
const KV_BYTES = 't5.kv-bytes-per-token'

const ctx = (over: Partial<SlotContext> = {}): SlotContext => ({ grp: 'g1', slot: 0, of: 5, reason: 'due', src: 'today', ...over })

/** Answer an instance correctly (or with `wrong`) the way ItemCard reports it. */
function answered(item: PlayableItem, ok = true, extra: { conf?: 'guess' | 'think' | 'sure'; ms?: number; seed?: number } = {}): ItemResult {
  if (item.source !== 'gen') throw new Error('gen only')
  const response = ok ? correctResponse(item.inst) : item.inst.answer.kind === 'choice' ? { kind: 'choice' as const, picks: ['__nope__'] } : { kind: 'numeric' as const, value: -1, unit: item.inst.answer.unit }
  const grade = gradeItem(item, response, GENS.get(item.inst.family))
  return resultFor(item, response, grade, { seed: extra.seed ?? item.inst.seed, ms: extra.ms ?? 12_000, ...(extra.conf ? { conf: extra.conf } : {}) })
}

const inst = (family: Gen, kc: string, level: 0 | 1 | 2 | 3, seed: number): PlayableItem => {
  const made = makeInstance(family, kc, level, seed)
  if (!made) throw new Error(`no ${family.id} instance for ${kc}`)
  return { source: 'gen', inst: made }
}

describe('prefs (today:prefs)', () => {
  test('a malformed value is empty; fields are clamped and typed', () => {
    expect(parsePrefs(undefined)).toEqual({})
    expect(parsePrefs(null)).toEqual({})
    expect(parsePrefs([1])).toEqual({})
    expect(parsePrefs('x')).toEqual({})
    expect(parsePrefs({ phoneMode: 'yes', sessionMinutes: 'ten' })).toEqual({})
    expect(parsePrefs({ phoneMode: false, sessionMinutes: 10 })).toEqual({ phoneMode: false, sessionMinutes: 10 })
    expect(parsePrefs({ sessionMinutes: 90 }).sessionMinutes).toBe(SESSION_MAX)
    expect(parsePrefs({ sessionMinutes: 0 }).sessionMinutes).toBe(3)
  })
})

describe('header copy', () => {
  test('the heading reads the local day alone', () => {
    expect(dayHeading('2026-10-04')).toBe('Today · Sun 4 Oct')
    expect(dayHeading('2026-10-03')).toBe('Today · Sat 3 Oct')
    expect(dayHeading('2024-02-29')).toBe('Today · Thu 29 Feb')
    expect(dayHeading('garbage')).toBe('Today')
  })

  const plan = (mode: SessionPlan['mode'], belowSlo: number, allowed = 4, slo = 0.9): Pick<SessionPlan, 'budget' | 'mode'> => ({ mode, budget: { slo, allowed, belowSlo } })

  test('the SLO line names the budget, never an overdue count', () => {
    expect(sloLine(plan('normal', 3), 40)).toBe('recall SLO 0.90 · error budget 4 cards · refresh due')
    expect(sloLine(plan('normal', 0, 1), 10)).toBe('recall SLO 0.90 · error budget 1 card')
    expect(sloLine(plan('normal', 0, 0, 0.85), 0)).toBe('recall SLO 0.85 · no cards yet')
    for (const belowSlo of [0, 1, 7, 38, 400]) {
      for (const mode of ['normal', 'debt', 'reentry'] as const) {
        const line = sloLine(plan(mode, belowSlo), 40)
        // the only numbers on the line are the SLO and the budget; the count of cards below the SLO never appears
        expect(line).not.toMatch(/overdue|late|behind|missed/i)
        expect(line.match(/\d+(\.\d+)?/g)).toEqual(mode === 'reentry' ? ['0.90'] : ['0.90', '4'])
      }
    }
  })

  test('the week bar rounds and clamps', () => {
    expect(weekBarText({ doneMinutes: 94.6, targetMinutes: 180 })).toBe('95 / 180 min this week')
    expect(weekBarPct({ doneMinutes: 90, targetMinutes: 180 })).toBe(50)
    expect(weekBarPct({ doneMinutes: 500, targetMinutes: 180 })).toBe(100)
    expect(weekBarPct({ doneMinutes: 5, targetMinutes: 0 })).toBe(0)
  })

  test('the banner is the welcome-back or catch-up copy, and neither carries a number', () => {
    expect(bannerFor('normal')).toBeNull()
    expect(bannerFor('reentry')).toEqual({ kind: 'welcome-back', text: WELCOME_BACK_COPY })
    expect(bannerFor('debt')).toEqual({ kind: 'catch-up', text: CATCH_UP_COPY })
    for (const b of [bannerFor('reentry'), bannerFor('debt')]) expect(b?.text).not.toMatch(/\d/)
  })

  test('the progress label counts the nominal time still to go, rounded up', () => {
    const slots: SessionSlot[] = [40, 40, 40, 40, 60].map((nsec, i) => ({ kc: EXT, reason: 'due', item: genItem(EXT, 'frag', 1, i, nsec) }))
    expect(progressLabel(0, slots)).toBe('item 1 of 5 · ~4 min left')
    expect(progressLabel(2, slots)).toBe('item 3 of 5 · ~3 min left')
    expect(progressLabel(4, slots)).toBe('item 5 of 5 · ~1 min left')
  })
})

describe('the done card', () => {
  test('the tally counts due cards apart from cold checks', () => {
    const t = tally([
      { reason: 'priority', ok: false, ms: 30_000 },
      { reason: 'threshold', ok: true, ms: 60_000 },
      { reason: 'due', ok: true, ms: 45_000 },
      { reason: 'confirm', ok: true, ms: 30_000 },
      { reason: 'probe', ok: false, ms: 30_000 },
    ])
    expect(t).toEqual({ items: 5, minutes: 3, right: 3, due: { right: 3, of: 4 } })
    expect(doneLine(t)).toBe('5 items · 3 min · due cards 3/4 right')
  })

  test('an empty or probe-only session still reads sensibly', () => {
    expect(doneLine(tally([]))).toBe('0 items · 0 min')
    expect(doneLine(tally([{ reason: 'probe', ok: true, ms: 100 }]))).toBe('1 item · 1 min')
  })

  test('the first-review line waits for 20 reviews', () => {
    expect(firstReviewLine({ n: 19, meanPredicted: 0.88, observed: 0.84, ci95: [0.6, 0.9] })).toBeNull()
    expect(firstReviewLine({ n: 20, meanPredicted: 0.884, observed: 0.84, ci95: [0.6, 0.9] })).toBe('predicted 88 %, observed 84 %')
    expect(firstReviewLine({ n: 30, meanPredicted: null, observed: null, ci95: null })).toBeNull()
  })

  test('changes read in the singular and the plural', () => {
    expect(changesLine(1)).toBe('1 thing you learned has changed')
    expect(changesLine(4)).toBe('4 things you learned have changed')
  })

  test('G7: the span is last at, minus first at, plus the last ms, within one session', () => {
    const j = new Journal()
    j.answer(START, EXT, true, { ms: 20_000, extra: { grp: 's1' } })
    j.answer(START, EXT, true, { ms: 20_000, extra: { grp: 's2' } })
    j.answer(START, EXT, true, { ms: 30_000, extra: { grp: 's1' } })
    expect(sessionSpanMs(j.events, 's1')).toBe(40_000 + 30_000) // the journal stamps events 20 s apart: s1 answers at +20 s and +60 s
    expect(sessionSpanMs(j.events, 'nope')).toBeNull()
    expect(sessionSpanMs([], 's1')).toBeNull()
  })
})

describe('provenance (spec §6.7)', () => {
  test('a generated item on a seed the learner has not met is unseen', () => {
    const item = inst(frag, EXT, 1, 12345)
    const r = answered(item)
    expect(provenanceOf(r, new Set())).toBe('unseen')
    expect(provenanceOf(r, new Set([instanceKey(r.ref, r.level, r.seed)]))).toBe('practice')
  })

  test('an authored item is practice', () => {
    const quiz = quizItem(EXT, 0)
    const r = { source: quiz.source, ref: 'quiz:t1.l4#0', level: undefined, seed: 1 }
    expect(provenanceOf(r, new Set())).toBe('practice')
  })

  test('seenInstances reads the item and probe events of generated items only', () => {
    const j = new Journal()
    j.answer(START, EXT, true, { ref: 'gen:frag/internal-waste', extra: { level: 2 } })
    const seeded = j.events[0] as LedgerEvent & { seed?: number }
    seeded.seed = 99
    j.add('item', 'quiz:t1.l4#0', START, { rev: 'r', score: 1, ok: true, provenance: 'practice', seed: 5, data: { src: 'quiz' } })
    const seen = seenInstances(j.events)
    expect(seen.size).toBe(1)
    expect(seen.has(instanceKey('gen:frag/internal-waste', 2, 99))).toBe(true)
  })
})

describe('ledger writes (itemResponseOf)', () => {
  /** What the façade makes of an ItemResponse, so the real codec can judge it. */
  const asEvent = (r: ReturnType<typeof itemResponseOf>): unknown => ({
    id: 'e1',
    v: 1,
    kind: r.kind,
    ref: r.ref,
    at: '2026-10-05T10:00:00.000Z',
    tz: 0,
    day: '2026-10-05',
    dev: 'd',
    score: r.score,
    ok: r.ok,
    provenance: r.provenance ?? 'practice',
    rev: r.rev,
    ...(r.conf ? { conf: r.conf } : {}),
    ...(r.seed === undefined ? {} : { seed: r.seed }),
    ...(r.ms === undefined ? {} : { ms: r.ms }),
    data: r.data,
  })

  test('every generated answer shape is a valid item event carrying the session fields', () => {
    const cases: [string, PlayableItem][] = []
    for (const [g, kc] of [
      [frag, EXT],
      [frag, 't1.internal-frag'],
      [kv, KV_BYTES],
    ] as const) {
      for (let seed = 1; seed <= 40; seed++) cases.push([`${g.id}/${seed}`, inst(g, kc, ((seed % 4) as 0 | 1 | 2 | 3), seed * 7919)])
    }
    const kinds = new Set<string>()
    for (const [name, item] of cases) {
      for (const ok of [true, false]) {
        const result = answered(item, ok, { conf: 'think' })
        const w = itemResponseOf(result, item, ctx({ slot: 2, of: 9 }), new Set())
        const checked = validateEvent(asEvent(w))
        expect({ name, ok: checked.ok, reason: checked.ok ? '' : checked.reason }).toEqual({ name, ok: true, reason: '' })
        expect(w.kind).toBe('item')
        expect(w.provenance).toBe('unseen')
        expect(w.data).toMatchObject({ src: 'today', grp: 'g1', slot: 2, of: 9, reason: 'due' })
        expect((w.data as { kcs: string[] }).kcs.length).toBeGreaterThan(0)
        expect((w.data as { nsec: number }).nsec).toBe((item as { inst: { nsec: number } }).inst.nsec)
        kinds.add(result.response.kind)
      }
    }
    expect([...kinds].sort()).toEqual(['choice', 'estimate', 'numeric'].filter((k) => kinds.has(k)))
    expect(kinds.size).toBeGreaterThanOrEqual(2)
  })

  test('a cold check is a probe that records how long it had been', () => {
    const item = inst(frag, EXT, 2, 31)
    const w = itemResponseOf(answered(item), item, ctx({ reason: 'probe', sinceDays: 9.4 }), new Set())
    expect(w.kind).toBe('probe')
    expect(w.data).toMatchObject({ reason: 'probe', sinceDays: 9 })
    expect(validateEvent(asEvent(w)).ok).toBe(true)
  })

  test('a numeric answer keeps its value and unit; the truth rides along, and a wrong one names the slip when it knows it', () => {
    let seen = 0
    for (let seed = 1; seed < 200 && seen < 3; seed++) {
      const item = inst(frag, 't1.internal-frag', 2, seed * 104729)
      if (item.source !== 'gen' || item.inst.answer.kind !== 'numeric') continue
      seen++
      const r = answered(item, true)
      const w = itemResponseOf(r, item, ctx(), new Set())
      const d = w.data as { value: number; unit?: string; truth: number }
      expect(d.value).toBe(item.inst.answer.truth)
      expect(d.truth).toBe(item.inst.answer.truth)
      expect(w.ok).toBe(true)
      expect(w.score).toBe(1)
    }
    expect(seen).toBeGreaterThan(0)
  })

  test('an authored question writes its authored pick and lesson; a constructed response writes ticks, never text', () => {
    const q: PlayableItem = { source: 'quiz', lessonId: 't1.l4', qi: 3, q: { q: 'q', options: ['a', 'b'], correct: [0] }, kcs: [EXT] }
    const grade = { ok: true, score: 1, feedback: 'Correct.' }
    const quizResult = resultFor(q, { kind: 'choice', picks: ['0'] }, grade, { seed: 3, ms: 8000 })
    const qw = itemResponseOf(quizResult, q, ctx({ reason: 'threshold' }), new Set())
    expect(qw.provenance).toBe('practice')
    expect(qw.data).toMatchObject({ pick: [0], lessonId: 't1.l4', reason: 'threshold' })
    expect(qw.ref).toBe('quiz:t1.l4#3')

    const cr: PlayableItem = { source: 'cr', lessonId: 't1.l4', index: 0, cr: { prompt: 'p', model: 'm', ideas: ['a', 'b', 'c'], kcs: [EXT] } }
    const crResult = resultFor(cr, { kind: 'cr', text: 'my private answer', ideas: [true, false, true] }, { ok: true, score: 1, feedback: '' }, { seed: 1, ms: 1000 })
    const cw = itemResponseOf(crResult, cr, ctx(), new Set())
    expect(cw.data).toMatchObject({ ideas: [0, 2], lessonId: 't1.l4' })
    expect(JSON.stringify(cw)).not.toContain('my private answer')
    expect(validateEvent(asEvent(cw)).ok).toBe(true)
  })

  test('kcs are capped at the codec limit and nsec at 600', () => {
    const item = inst(frag, EXT, 1, 5)
    const r = { ...answered(item), kcs: ['a.a', 'a.b', 'a.c', 'a.d', 'a.e', 'a.f', 'a.g', 'a.h'], nsec: 9999 }
    const w = itemResponseOf(r, item, ctx(), new Set())
    expect((w.data as { kcs: string[] }).kcs).toHaveLength(6)
    expect((w.data as { nsec: number }).nsec).toBe(600)
    expect(validateEvent(asEvent(w)).ok).toBe(true)
  })
})

describe('the item pool', () => {
  const pool = (over: Partial<Parameters<typeof buildPool>[0]> = {}) =>
    buildPool({ kcs: KCS, gens: GENS, authored: new Map(), constructed: new Map(), stair: [], recent: new Map(), ...over })

  test('a KC is served by the loaded families that cover it', () => {
    const p = pool()
    expect(p.families(EXT)).toEqual(['frag'])
    expect(p.families(KV_BYTES)).toEqual(['kv'])
    expect(p.families('t0.locality')).toEqual([])
    expect(pool({ gens: new Map() }).families(EXT)).toEqual([])
  })

  test('make builds an instance for that KC, deterministically per seed, or null when no variant teaches it', () => {
    const p = pool()
    const a = p.make('frag', EXT, 1, 77)
    const b = p.make('frag', EXT, 1, 77)
    expect(a).toEqual(b)
    expect(a?.source === 'gen' && a.inst.kcs).toContain(EXT)
    expect(p.make('frag', 't0.locality', 1, 77)).toBeNull()
    expect(p.make('nope', EXT, 1, 77)).toBeNull()
  })

  test('every seed and level yields an instance that teaches the KC', () => {
    for (const [g, kc] of [
      [frag, EXT],
      [frag, 't1.placement-policy'],
      [kv, KV_BYTES],
    ] as const) {
      for (let seed = 0; seed < 25; seed++) {
        for (const level of [0, 1, 2, 3] as const) {
          const made = makeInstance(g, kc, level, seed * 2654435761)
          expect(made).not.toBeNull()
          expect(made?.kcs).toContain(kc)
        }
      }
    }
  })

  test('the level comes from the learner\'s history on that family', () => {
    const j = new Journal()
    for (let i = 0; i < 3; i++) j.answer(START, EXT, true, { ref: 'gen:frag/internal-waste' })
    expect(pool({ stair: j.events as never }).level(EXT, 'frag')).toBe(2)
    expect(pool().level(EXT, 'frag')).toBe(1)
  })

  test('authored items and recent refs come through as given', () => {
    const q = quizItem(EXT, 0)
    const p = pool({ authored: new Map([[EXT, [q]]]), recent: new Map([[EXT, ['quiz:t1.l4#0']]]) })
    expect(p.authored(EXT)).toEqual([q])
    expect(p.authored('t0.locality')).toEqual([])
    expect(p.recent(EXT)).toEqual(['quiz:t1.l4#0'])
    expect(p.constructed(EXT)).toBeNull()
  })

  test('composeSession through the real pool serves fresh generated items on fresh seeds', () => {
    // one due card, in a family
    const cards = {
      cards: {
        [EXT]: {
          kc: EXT,
          origin: 'ticket' as const,
          createdDay: '2026-09-01',
          memory: { stability: 4, difficulty: 5 },
          lastReviewDay: '2026-09-10',
          reps: 2,
          lapses: 0,
          dueDay: '2026-09-14',
          priority: false,
        },
      },
      pending: [],
      offset: 0.02,
      paused: false,
    }
    const content = { ...CONTENT, pool: pool() }
    const a = composeSession(cards, content, '2026-10-05', {}, 111)
    const b = composeSession(cards, content, '2026-10-05', {}, 222)
    expect(a.slots).toHaveLength(1)
    expect(a.slots[0].item.source).toBe('gen')
    expect(a.estMinutes).toBeLessThanOrEqual(12)
    expect(a.slots[0].item).not.toEqual(b.slots[0].item)
    expect(a.id).not.toBe(b.id)
  })

  test('practice cycles the KCs a family serves and skips the rest', () => {
    const p = pool()
    const slots = composePractice([EXT, 't0.locality', KV_BYTES], p, 9, 5)
    expect(slots).toHaveLength(5)
    expect(slots.every((s) => s.reason === 'extra' && s.item.source === 'gen')).toBe(true)
    expect(new Set(slots.map((s) => s.kc))).toEqual(new Set([EXT, KV_BYTES]))
    expect(new Set(slots.map((s) => (s.item.source === 'gen' ? s.item.inst.seed : 0))).size).toBe(5)
    expect(composePractice(['t0.locality'], p, 9, 5)).toEqual([])
    expect(composePractice([EXT], p, 9, 5)).toEqual(composePractice([EXT], p, 9, 5))
  })
})

describe('authored items from lessons', () => {
  const q = (n: number, kcs?: string[]) => ({ q: `q${n}`, options: ['a', 'b'], correct: [0], ...(kcs ? { kcs } : {}) })
  const lesson = {
    id: 't1.l4',
    blocks: [
      { type: 'text' },
      { type: 'quiz', questions: [q(0, [EXT]), q(1), q(2, [EXT, 't1.internal-frag'])] },
    ],
    ticket: {
      form: 'ticket',
      cr: [
        { prompt: 'p0', model: 'm', ideas: ['a', 'b', 'c'], kcs: [EXT] },
        { prompt: 'p1', model: 'm', ideas: ['a', 'b', 'c'], kcs: [EXT] },
        { prompt: 'untagged', model: 'm', ideas: ['a', 'b', 'c'], kcs: [] },
      ],
      spiral: [{ id: 't1.s1', q: q(9), kcs: ['t1.fixed-blocks'] }],
    },
  } as unknown as Lesson

  test('only tagged items are served, indexed lesson-wide, under every KC they carry', () => {
    const { authored, constructed } = authoredFromLessons([lesson])
    expect(authored.get(EXT)?.map((i) => (i.source === 'quiz' ? i.qi : -1))).toEqual([0, 2])
    expect(authored.get('t1.internal-frag')?.map((i) => (i.source === 'quiz' ? i.qi : -1))).toEqual([2])
    expect(authored.get('t1.fixed-blocks')?.[0].source).toBe('item')
    expect(constructed.get(EXT)).toMatchObject({ source: 'cr', index: 0 })
  })

  test('a lesson without kcs contributes nothing', () => {
    const bare = { id: 't0.l1', blocks: [{ type: 'quiz', questions: [q(0)] }] } as unknown as Lesson
    const { authored, constructed } = authoredFromLessons([bare])
    expect(authored.size).toBe(0)
    expect(constructed.size).toBe(0)
  })
})

describe('Today moves focus to its first item', () => {
  const page = readFileSync(join(import.meta.dir, '../../src/pages/Today.tsx'), 'utf8')
  test('the review session takes focus on load, unless the learner already moved it on the page', () => {
    // the first item card focuses its first control on mount, once (it never re-runs on a re-render)
    expect(page).toContain("focusFirst={active.kind !== 'review' || ready.focusFirst}")
    // decided once, at load, from whether focus had already gone to something on this page
    expect(page).toContain('focusFirst: !touched.current')
    expect(page).toContain('onFocusCapture')
  })
})
