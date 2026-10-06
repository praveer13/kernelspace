/**
 * T2 content tags and tickets (docs/specs/wave-1.md §4.5, §8.1, §8.6; task B16): every lesson names its KCs, carries
 * a ticket with constructed responses, tags every checkpoint item and names the misconception behind every lure; and
 * t2.l7 is a spiral checkpoint whose authored items sit on earlier T0-T2 KCs and plan into a valid eight.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { KCS, kcById } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { Lesson, QuizBlockData } from '../../src/data/lessons/types'
import { loadFamily } from '../../src/lib/items/registry'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import { SPIRAL_ITEMS, earlierKcsOf, isNonMcq, makeGenPool, planTicket, type TicketPool } from '../../src/lib/learner/ticket'

const T2 = ALL_LESSONS.filter((l) => l.trackId === 't2')
const MISS_ID = /^[a-z0-9]+\.[a-z0-9]+(-[a-z0-9]+)*$/
const words = (s: string) => s.trim().split(/\s+/).length

const questionsOf = (l: Lesson): QuizQuestion[] =>
  l.blocks.filter((b): b is QuizBlockData => b.type === 'quiz').flatMap((b) => b.questions)

/** The checkpoint and spiral questions of a lesson, with where each lives (for messages). */
const mcqsOf = (l: Lesson): { where: string; q: QuizQuestion }[] => [
  ...questionsOf(l).map((q, i) => ({ where: `${l.id} q${i + 1}`, q })),
  ...(l.ticket?.spiral ?? []).map((s) => ({ where: `item:${s.id}`, q: s.q })),
]

describe('T2 lessons: KCs and tickets', () => {
  test('all seven lessons are there', () => {
    expect(T2.map((l) => l.id)).toEqual(['t2.l1', 't2.l2', 't2.l3', 't2.l4', 't2.l5', 't2.l6', 't2.l7'])
  })

  for (const l of T2) {
    test(`${l.id}: Lesson.kcs name 2-3 KCs of this lesson, and a ticket carries at least one constructed response`, () => {
      expect(l.kcs?.length).toBeGreaterThanOrEqual(2)
      expect(l.kcs?.length).toBeLessThanOrEqual(3)
      for (const id of l.kcs ?? []) expect(kcById(id)?.lessons).toContain(l.id)
      expect(l.ticket?.form).toBe(l.id === 't2.l7' ? 'spiral' : 'ticket')
      expect(l.ticket?.cr.length).toBeGreaterThanOrEqual(1)
      for (const cr of l.ticket?.cr ?? []) {
        expect(cr.prompt.trim().endsWith('.') || cr.prompt.trim().endsWith('?')).toBe(true)
        expect(words(cr.model)).toBeLessThanOrEqual(60)
        expect(cr.ideas).toHaveLength(3)
        expect(new Set(cr.ideas).size).toBe(3)
        expect(cr.kcs.length).toBeGreaterThanOrEqual(1)
        expect(cr.kcs.length).toBeLessThanOrEqual(3)
        for (const id of cr.kcs) expect(kcById(id)).toBeDefined()
      }
      expect(new Set((l.ticket?.cr ?? []).map((c) => c.prompt)).size).toBe(l.ticket?.cr.length)
    })

    test(`${l.id}: every checkpoint question is tagged, and every lure names its misconception`, () => {
      for (const { where, q } of mcqsOf(l)) {
        expect(q.kcs === undefined || q.kcs.length > 0).toBe(true)
        if (!where.startsWith('item:')) {
          expect(q.kcs?.length ?? 0).toBeGreaterThanOrEqual(1)
          expect(q.kcs?.length ?? 0).toBeLessThanOrEqual(3)
          for (const id of q.kcs ?? []) expect(kcById(id)).toBeDefined()
        }
        expect(q.why).toHaveLength(q.options.length)
        expect(q.miss).toHaveLength(q.options.length)
        const named = new Set<string>()
        q.options.forEach((_, i) => {
          const miss = q.miss?.[i] ?? ''
          if (q.correct.includes(i)) {
            expect(miss).toBe('')
            return
          }
          expect(MISS_ID.test(miss)).toBe(true)
          named.add(miss)
        })
        // one misconception per lure
        expect(named.size).toBe(q.options.length - q.correct.length)
      }
    })
  }

  test('a KC named by Lesson.kcs has at least two tagged items to learn from', () => {
    const count = new Map<string, number>()
    const bump = (kcs: readonly string[] | undefined) => {
      for (const id of new Set(kcs ?? [])) count.set(id, (count.get(id) ?? 0) + 1)
    }
    for (const l of T2) {
      for (const q of questionsOf(l)) bump(q.kcs)
      for (const cr of l.ticket?.cr ?? []) bump(cr.kcs)
      for (const s of l.ticket?.spiral ?? []) bump(s.kcs)
    }
    for (const l of T2) for (const id of l.kcs ?? []) expect(count.get(id) ?? 0).toBeGreaterThanOrEqual(2)
  })

  test('the EEVDF erratum\'s lure is named, so a placement miss can say "CFS still schedules Linux"', () => {
    const l4 = T2.find((l) => l.id === 't2.l4')
    expect(questionsOf(l4 as Lesson).some((q) => q.miss?.includes('t2.cfs-current'))).toBe(true)
  })
})

describe('t2.l7: the spiral checkpoint', () => {
  const l7 = T2.find((l) => l.id === 't2.l7') as Lesson
  const earlier = earlierKcsOf('t2.l7', KCS)
  let pool: TicketPool
  beforeAll(async () => {
    const frag = await loadFamily('frag')
    pool = makeGenPool(new Map([['frag', frag]]), (kc) => kcById(kc)?.gen ?? [])
  })

  test('at least four authored spiral items, on earlier T0-T2 KCs and never on the lesson\'s own', () => {
    const spiral = l7.ticket?.spiral ?? []
    expect(spiral.length).toBeGreaterThanOrEqual(4)
    expect(new Set(spiral.map((s) => s.id)).size).toBe(spiral.length)
    for (const s of spiral) {
      expect(s.id).toMatch(/^t2\.spiral\.[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(s.q.options).toHaveLength(4)
      expect(s.q.explanation?.trim()).toBeTruthy()
      for (const kc of s.kcs) {
        expect(earlier).toContain(kc)
        expect(l7.kcs).not.toContain(kc)
      }
    }
    // the items span the three tracks the spiral revisits
    const tracks = new Set(spiral.flatMap((s) => s.kcs.map((kc) => kcById(kc)?.track)))
    expect([...tracks].sort()).toEqual(['t0', 't1', 't2'])
    // the placement walk draws the threshold KCs it can from these items
    expect(spiral.some((s) => s.kcs.includes('t2.admission-scheduling'))).toBe(true)
    expect(spiral.some((s) => s.kcs.includes('t2.address-translation'))).toBe(true)
  })

  test('it plans eight items: four authored spiral items or generated ones, two or more non-MCQ, deterministic per seed', () => {
    for (const seed of [1, 7, 21, 99, 4242]) {
      const plan = planTicket(l7, { pool, earlier }, [], seed)
      expect(plan).not.toBeNull()
      if (!plan) continue
      expect(plan.form).toBe('spiral')
      expect(plan.items).toHaveLength(SPIRAL_ITEMS)
      expect(plan.items.filter(isNonMcq).length).toBeGreaterThanOrEqual(2)
      expect(plan.items.filter((i) => i.source === 'item').length).toBeGreaterThanOrEqual(3)
      expect(plan.items.filter((i) => i.source === 'quiz')).toHaveLength(3)
      expect(planTicket(l7, { pool, earlier }, [], seed)?.items.map((i) => (i.source === 'gen' ? i.inst.rev : i.source))).toEqual(
        plan.items.map((i) => (i.source === 'gen' ? i.inst.rev : i.source)),
      )
    }
  })

  test('every other T2 lesson plans a three-item ticket with a constructed response when no family covers it', () => {
    for (const l of T2.filter((x) => x.id !== 't2.l7')) {
      const plan = planTicket(l, { pool }, [], 3)
      expect(plan?.items).toHaveLength(3)
      expect(plan?.items.filter(isNonMcq).map((i) => i.source)).toEqual(['cr'])
    }
  })
})
