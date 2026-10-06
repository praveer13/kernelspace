/**
 * T4 content tags, tickets and P1 (docs/specs/wave-2.md §6.1, §6.2, §6.3; task 2a-23): every lesson names its KCs,
 * carries a ticket with constructed responses, tags every checkpoint item, and opens with a predict block of two
 * prequestions whose reveal is an H2 of the lesson; the five diagrams of §6.3 gate a step on a prediction; and t4.l7
 * is a spiral checkpoint whose authored items sit on earlier KCs and plan into a valid eight.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { KCS, kcById } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { DiagramBlock, Lesson, PredictBlock, QuizBlockData } from '../../src/data/lessons/types'
import { loadFamily } from '../../src/lib/items/registry'
import { SPIRAL_ITEMS, earlierKcsOf, isNonMcq, makeGenPool, planTicket, type TicketPool } from '../../src/lib/learner/ticket'
import { extractHeadings } from '../../src/pages/lesson/markdown'

const T4 = ALL_LESSONS.filter((l) => l.trackId === 't4')
const words = (s: string) => s.trim().split(/\s+/).length

const predictOf = (l: Lesson): PredictBlock[] => l.blocks.filter((b): b is PredictBlock => b.type === 'predict')
const quizOf = (l: Lesson) => l.blocks.filter((b): b is QuizBlockData => b.type === 'quiz').flatMap((b) => b.questions)

/** The five T4 diagrams of §6.3 that carry a prediction gate (block indices are after the predict block at #0). */
const GATED = ['t4.l1', 't4.l2', 't4.l3', 't4.l4', 't4.l6']

describe('T4 lessons: KCs and tickets', () => {
  test('all seven lessons are there', () => {
    expect(T4.map((l) => l.id).sort()).toEqual(['t4.l1', 't4.l2', 't4.l3', 't4.l4', 't4.l5', 't4.l6', 't4.l7'])
  })

  for (const l of T4) {
    test(`${l.id}: Lesson.kcs name 2-3 KCs of this lesson, and the ticket carries two constructed responses`, () => {
      expect(l.kcs?.length).toBeGreaterThanOrEqual(2)
      expect(l.kcs?.length).toBeLessThanOrEqual(3)
      for (const id of l.kcs ?? []) expect(kcById(id)?.lessons).toContain(l.id)
      expect(l.ticket?.form).toBe(l.id === 't4.l7' ? 'spiral' : 'ticket')
      expect(l.ticket?.cr).toHaveLength(2)
      for (const cr of l.ticket?.cr ?? []) {
        expect(cr.prompt.trim().endsWith('.') || cr.prompt.trim().endsWith('?')).toBe(true)
        expect(words(cr.model)).toBeLessThanOrEqual(60)
        expect(cr.ideas).toHaveLength(3)
        expect(new Set(cr.ideas).size).toBe(3)
        expect(cr.kcs.length).toBeGreaterThanOrEqual(1)
        expect(cr.kcs.length).toBeLessThanOrEqual(3)
        for (const id of cr.kcs) expect(kcById(id)).toBeDefined()
      }
      expect(new Set((l.ticket?.cr ?? []).map((c) => c.prompt)).size).toBe(2)
    })

    test(`${l.id}: every checkpoint question is tagged with 1-3 KCs`, () => {
      expect(quizOf(l).length).toBeGreaterThanOrEqual(4)
      for (const q of quizOf(l)) {
        expect(q.kcs?.length ?? 0).toBeGreaterThanOrEqual(1)
        expect(q.kcs?.length ?? 0).toBeLessThanOrEqual(3)
        for (const id of q.kcs ?? []) expect(kcById(id)).toBeDefined()
        expect(q.why).toHaveLength(q.options.length)
      }
    })
  }

  test('a KC named by Lesson.kcs has at least two tagged items to learn from, or a generator', () => {
    const count = new Map<string, number>()
    const bump = (kcs: readonly string[] | undefined) => {
      for (const id of new Set(kcs ?? [])) count.set(id, (count.get(id) ?? 0) + 1)
    }
    for (const l of T4) {
      for (const q of quizOf(l)) bump(q.kcs)
      for (const cr of l.ticket?.cr ?? []) bump(cr.kcs)
      for (const s of l.ticket?.spiral ?? []) bump(s.kcs)
      for (const b of predictOf(l)) for (const p of b.items) bump(p.kcs)
      for (const b of l.blocks) if (b.type === 'diagram') bump(b.predictAt?.kcs)
    }
    for (const l of T4) {
      for (const id of l.kcs ?? []) expect((count.get(id) ?? 0) >= 2 || (kcById(id)?.gen?.length ?? 0) > 0).toBe(true)
    }
  })
})

describe('T4 lessons: prequestions and predictAt', () => {
  for (const l of T4) {
    test(`${l.id} opens with one predict block of two prequestions, each revealed at an H2 of the lesson`, () => {
      expect(l.blocks[0].type).toBe('predict')
      const blocks = predictOf(l)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].items).toHaveLength(2)
      const h2 = new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.text))
      for (const p of blocks[0].items) {
        expect(h2.has(p.revealAt)).toBe(true)
        expect(p.kcs.length).toBeGreaterThanOrEqual(1)
        expect(p.kcs.length).toBeLessThanOrEqual(3)
        for (const id of p.kcs) expect(kcById(id)).toBeDefined()
        if (p.kind === 'choice') {
          expect(p.why).toHaveLength(p.options.length)
          expect(p.correct).toHaveLength(1)
        } else {
          expect(p.truth).toBeGreaterThan(0)
          expect(p.okWithinFactor).toBeGreaterThan(1)
        }
      }
    })
  }

  test('exactly the five diagrams of §6.3 carry a prediction gate, with a why for every option', () => {
    const gated = T4.filter((l) => l.blocks.some((b) => b.type === 'diagram' && b.predictAt)).map((l) => l.id)
    expect(gated.sort()).toEqual(GATED)
    for (const l of T4) {
      for (const b of l.blocks) {
        if (b.type !== 'diagram' || !b.predictAt) continue
        const d: DiagramBlock['predictAt'] = b.predictAt
        expect(d?.step).toBeGreaterThanOrEqual(1)
        expect(d?.step).toBeLessThan(b.steps.length)
        expect(d?.options.length).toBeGreaterThanOrEqual(2)
        expect(d?.why).toHaveLength(d?.options.length ?? 0)
        expect(d?.correct).toHaveLength(1)
        for (const id of d?.kcs ?? []) expect(kcById(id)).toBeDefined()
      }
    }
  })
})

describe('T4 tickets plan with the family that covers a lesson KC', () => {
  let pool: TicketPool
  beforeAll(async () => {
    const gens = new Map(await Promise.all(['roofline', 'memory', 'frag'].map(async (f) => [f, await loadFamily(f)] as const)))
    pool = makeGenPool(gens, (kc) => kcById(kc)?.gen ?? [])
  })

  test('t4.l3, t4.l6 and t4.l7 ask a generated non-MCQ; every other lesson asks its constructed response', () => {
    for (const l of T4.filter((x) => x.id !== 't4.l7')) {
      for (const seed of [1, 7, 99]) {
        const plan = planTicket(l, { pool }, [], seed)
        expect(plan?.items).toHaveLength(3)
        const kinds = plan?.items.filter(isNonMcq).map((i) => i.source)
        expect(kinds).toEqual(l.id === 't4.l3' || l.id === 't4.l6' ? ['gen'] : ['cr'])
        const gen = plan?.items.find((i) => i.source === 'gen')
        if (gen?.source === 'gen') expect(gen.inst.family).toBe('roofline')
      }
    }
  })
})

describe('t4.l7: the spiral checkpoint', () => {
  const l7 = T4.find((l) => l.id === 't4.l7') as Lesson
  const earlier = earlierKcsOf('t4.l7', KCS)
  let pool: TicketPool
  beforeAll(async () => {
    const gens = new Map(await Promise.all(['roofline', 'memory', 'frag'].map(async (f) => [f, await loadFamily(f)] as const)))
    pool = makeGenPool(gens, (kc) => kcById(kc)?.gen ?? [])
  })

  test('at least four authored spiral items, on earlier KCs of T0-T4 and never on the lesson\'s own', () => {
    const spiral = l7.ticket?.spiral ?? []
    expect(spiral.length).toBeGreaterThanOrEqual(4)
    expect(new Set(spiral.map((s) => s.id)).size).toBe(spiral.length)
    for (const s of spiral) {
      expect(s.id).toMatch(/^t4\.spiral\.[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(s.q.options).toHaveLength(4)
      expect(s.q.explanation?.trim()).toBeTruthy()
      expect(s.q.why).toHaveLength(4)
      expect(s.q.miss).toHaveLength(4)
      for (const kc of s.kcs) {
        expect(earlier).toContain(kc)
        expect(l7.kcs).not.toContain(kc)
      }
    }
    // the items revisit the prerequisite tracks as well as T4's own earlier lessons
    const tracks = new Set(spiral.flatMap((s) => s.kcs.map((kc) => kcById(kc)?.track)))
    for (const t of ['t0', 't1', 't2', 't3', 't4']) expect(tracks.has(t as 't0')).toBe(true)
  })

  test('it plans eight items: three own checkpoint questions, two or more non-MCQ, deterministic per seed', () => {
    for (const seed of [1, 7, 21, 99, 4242]) {
      const plan = planTicket(l7, { pool, earlier }, [], seed)
      expect(plan).not.toBeNull()
      if (!plan) continue
      expect(plan.form).toBe('spiral')
      expect(plan.items).toHaveLength(SPIRAL_ITEMS)
      expect(plan.items.filter(isNonMcq).length).toBeGreaterThanOrEqual(2)
      expect(plan.items.filter((i) => i.source === 'quiz')).toHaveLength(3)
      const own = plan.items.find((i) => i.source === 'gen' && i.inst.family === 'memory')
      expect(own).toBeDefined()
      expect(planTicket(l7, { pool, earlier }, [], seed)?.items.map((i) => (i.source === 'gen' ? i.inst.rev : i.source))).toEqual(
        plan.items.map((i) => (i.source === 'gen' ? i.inst.rev : i.source)),
      )
    }
  })
})
