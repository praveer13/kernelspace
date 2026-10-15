/**
 * Content scope (docs/specs/wave-1.md §4.7, §8.1, §9.1; docs/specs/wave-2.md §4.4, §5.4, §6, §23; tasks B25 and 2a-32):
 * coverage is unconditional. All 69 lessons set `kcs` (every id a real KC that lists the lesson, none first taught later),
 * every checkpoint item is tagged, every T0-T7 lesson carries a ticket (the last lesson of T2-T7 a spiral), the 12 T0-T1
 * lessons and the 17 T4-T5 lessons open with a `predict` block, and the five real spirals plan into eight items with at
 * least two non-MCQ. `verify-kc` requires the tags too (the last test here proves it on a lesson with them removed).
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { CLAIMS } from '../../src/data/claims/all'
import { KC, KCS, KC_GRAPH, REF_KCS, RUST_ANCHOR_KC, THRESHOLD_KCS, kcById } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS, LESSONS_BY_TRACK, ORDERED_LESSON_IDS } from '../../src/data/lessons'
import { ORDERED_LESSON_IDS as TRACK_ORDERED_IDS, TRACKS } from '../../src/lib/tracks'
import type { Lesson, TrackId } from '../../src/data/lessons/types'
import { loadFamily } from '../../src/lib/items/registry'
import type { Gen } from '../../src/lib/items/types'
import { SPIRAL_ITEMS, SPIRAL_MIN_NON_MCQ, earlierKcsOf, isNonMcq, makeGenPool, planTicket, type TicketPool } from '../../src/lib/learner/ticket'
import { PENDING_FAMILIES, discoverFamilies, verifyKc, type VerifyKcInput } from '../../scripts/verify-kc'

const inTracks = (...tracks: TrackId[]): Lesson[] => ALL_LESSONS.filter((l) => tracks.includes(l.trackId))

const TICKETED = inTracks('t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7')
const PREDICTED = inTracks('t0', 't1', 't4', 't5')
/** The last lesson of a track from T2 on is its spiral checkpoint (wave-2 §6.2). */
const SPIRALS = ['t2.l7', 't3.l7', 't4.l7', 't5.l10', 't6.l10', 't7.l5']
const REAL_FIVE = SPIRALS.filter((id) => id !== 't2.l7')

describe('content scope: every lesson is tagged', () => {
  test('there are 69 lessons: 10 R and 59 T0-T7, 12 of them T0-T1 and 40 T3-T7', () => {
    expect(ALL_LESSONS).toHaveLength(69)
    expect(inTracks('r')).toHaveLength(10)
    expect(TICKETED).toHaveLength(59)
    expect(inTracks('t0', 't1')).toHaveLength(12)
    expect(inTracks('t3', 't4', 't5', 't6', 't7')).toHaveLength(40)
    // T0, T1, T4 and T5 only, so t6.l12 (wave-3 §16.2) leaves it at 29
    expect(PREDICTED).toHaveLength(29)
  })

  test('the track cards agree with the registry: each track\'s lesson count and the reading order (t6.l12 before the t6.l10 spiral)', () => {
    for (const t of TRACKS) expect({ track: t.id, lessons: t.lessons }).toEqual({ track: t.id, lessons: LESSONS_BY_TRACK[t.id as TrackId].length })
    expect(TRACK_ORDERED_IDS).toEqual(ORDERED_LESSON_IDS)
    expect(LESSONS_BY_TRACK.t6.map((l) => l.id).slice(-3)).toEqual(['t6.l9', 't6.l12', 't6.l10'])
  })

  test('t6.l12\'s statline shows its KC\'s benchmark claims at their registered values', () => {
    const l = ALL_LESSONS.find((x) => x.id === 't6.l12') as Lesson
    const chips = l.blocks.flatMap((b) => (b.type === 'statline' ? b.stats : []))
    const ids = kcById(KC.attentionFfnSplit)?.claims ?? []
    expect(chips).toHaveLength(ids.length)
    ids.forEach((id, i) => {
      const claim = CLAIMS.find((c) => c.id === id)
      expect(claim?.kind).toBe('benchmark')
      expect(claim?.source?.url).toMatch(/^https:\/\/arxiv\.org\/abs\/\d{4}\.\d{5}v\d+$/)
      const value = claim?.value as number
      expect(chips[i].value).toContain(value.toLocaleString('en-US'))
      expect(chips[i].hint).toContain(id)
    })
  })

  for (const l of ALL_LESSONS) {
    test(`${l.id} sets kcs, each names a KC that lists this lesson, and every checkpoint item is tagged`, () => {
      expect(l.kcs?.length ?? 0).toBeGreaterThanOrEqual(1)
      expect(l.kcs?.length ?? 0).toBeLessThanOrEqual(3)
      expect(new Set(l.kcs).size).toBe(l.kcs?.length ?? 0)
      for (const id of l.kcs ?? []) {
        const kc = kcById(id)
        expect(kc).toBeDefined()
        expect(kc?.lessons).toContain(l.id)
      }
      const quizzes = l.blocks.flatMap((b) => (b.type === 'quiz' ? [b] : []))
      expect(quizzes.length).toBe(1)
      for (const [qi, q] of (quizzes[0]?.questions ?? []).entries()) {
        expect(q.kcs?.length ?? 0, `${l.id} checkpoint question ${qi + 1} is untagged`).toBeGreaterThanOrEqual(1)
        expect(q.kcs?.length ?? 0).toBeLessThanOrEqual(3)
        for (const id of q.kcs ?? []) expect(kcById(id), `${l.id} q${qi + 1} tags unknown KC ${id}`).toBeDefined()
      }
    })
  }

  test('T3-T7 lessons name 2-3 KCs (wave-2 §4.4)', () => {
    for (const l of inTracks('t3', 't4', 't5', 't6', 't7')) {
      expect(l.kcs?.length, l.id).toBeGreaterThanOrEqual(2)
      expect(l.kcs?.length, l.id).toBeLessThanOrEqual(3)
    }
  })
})

describe('content scope: tickets', () => {
  for (const l of TICKETED) {
    const spiral = SPIRALS.includes(l.id)
    test(`${l.id} has a ${spiral ? 'spiral checkpoint' : 'ticket'}, two constructed responses and a quiz block for it to draw on`, () => {
      expect(l.ticket?.form).toBe(spiral ? 'spiral' : 'ticket')
      expect(l.ticket?.cr.length ?? 0).toBeGreaterThanOrEqual(2)
      expect(l.blocks.some((b) => b.type === 'quiz')).toBe(true)
      // a spiral's earlier items are authored (at least four, wave-2 §6.2); a plain ticket carries none
      if (spiral) expect(l.ticket?.spiral?.length ?? 0).toBeGreaterThanOrEqual(4)
    })
  }

  test('R lessons carry no ticket', () => {
    for (const l of inTracks('r')) expect(l.ticket).toBeUndefined()
  })
})

describe('content scope: prequestions', () => {
  for (const l of PREDICTED) {
    const wantTwo = l.trackId === 't4' || l.trackId === 't5'
    test(`${l.id} has one predict block with ${wantTwo ? 'two prequestions' : 'at least one prequestion'}`, () => {
      const blocks = l.blocks.flatMap((b) => (b.type === 'predict' ? [b] : []))
      expect(blocks).toHaveLength(1)
      if (wantTwo) expect(blocks[0].items).toHaveLength(2)
      else expect(blocks[0].items.length).toBeGreaterThanOrEqual(1)
      for (const p of blocks[0].items) {
        expect(p.kcs.length).toBeGreaterThanOrEqual(1)
        for (const id of p.kcs) expect(kcById(id)).toBeDefined()
      }
    })
  }

  test('T4 and T5 have 17 lessons between them', () => {
    expect(inTracks('t4', 't5')).toHaveLength(17)
  })
})

describe('content scope: the five real spirals plan into eight items', () => {
  let pool: TicketPool
  beforeAll(async () => {
    const gens = new Map<string, Gen>()
    for (const f of ['frag', 'kv', 'roofline', 'goodput', 'cost', 'memory', 'spec']) gens.set(f, await loadFamily(f))
    pool = makeGenPool(gens, (kc) => kcById(kc)?.gen ?? [])
  })

  for (const id of REAL_FIVE) {
    test(`${id}: ${SPIRAL_ITEMS} items with at least ${SPIRAL_MIN_NON_MCQ} non-MCQ, on every one of 20 seeds`, () => {
      const l = ALL_LESSONS.find((x) => x.id === id) as Lesson
      const earlier = earlierKcsOf(id, KCS)
      expect(earlier.length).toBeGreaterThan(0)
      for (let seed = 1; seed <= 20; seed++) {
        const plan = planTicket(l, { pool, earlier }, [], seed * 37)
        expect(plan, `${id} seed ${seed * 37} did not plan`).not.toBeNull()
        if (!plan) continue
        expect(plan.form).toBe('spiral')
        expect(plan.items).toHaveLength(SPIRAL_ITEMS)
        expect(plan.items.filter(isNonMcq).length).toBeGreaterThanOrEqual(SPIRAL_MIN_NON_MCQ)
        expect(plan.nonMcqIndex).toBeGreaterThanOrEqual(0)
      }
    })
  }
})

describe('verify-kc requires Lesson.kcs on every lesson', () => {
  const base = async (lessons: readonly Lesson[]): Promise<VerifyKcInput> => ({
    graph: structuredClone(KC_GRAPH),
    contract: Object.values(KC),
    thresholds: THRESHOLD_KCS,
    anchor: RUST_ANCHOR_KC,
    lessons,
    labs: FORGE_LABS,
    claims: new Set(CLAIMS.map((c) => c.id)),
    refMap: REF_KCS,
    families: await discoverFamilies(),
    pendingFamilies: PENDING_FAMILIES,
    items: [],
  })
  const without = (id: string): Lesson[] =>
    ALL_LESSONS.map((l) => {
      if (l.id !== id) return l
      const copy = structuredClone(l)
      delete copy.kcs
      return copy
    })

  test('the committed lessons pass', async () => {
    expect(verifyKc(await base(ALL_LESSONS)).errors).toEqual([])
  })

  test('a lesson that does not set kcs is an error, wherever it sits', async () => {
    for (const id of ['r.l1', 't2.l3', 't7.l5']) {
      expect(verifyKc(await base(without(id))).errors).toContain(`${id}: does not set Lesson.kcs (every lesson must, wave-2 §4.4)`)
    }
  })
})
