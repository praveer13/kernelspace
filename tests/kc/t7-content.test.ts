/**
 * T7 content tags, tickets and item blocks (docs/specs/wave-2.md §5.4, §6.1, §6.2; task 2a-28): every lesson names
 * its KCs, carries a ticket with constructed responses, tags every checkpoint item and names the misconception behind
 * every lure; every lesson has a hands-on item block whose variants cover a lesson KC; and t7.l5 is a spiral
 * checkpoint whose authored items sit on earlier KCs of T4-T7 and plan into a valid eight.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { KCS, kcById } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { ItemBlock, Lesson, QuizBlockData } from '../../src/data/lessons/types'
import { loadFamily } from '../../src/lib/items/registry'
import type { Gen } from '../../src/lib/items/types'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import { SPIRAL_ITEMS, earlierKcsOf, isNonMcq, makeGenPool, planTicket, type TicketPool } from '../../src/lib/learner/ticket'

const T7 = ALL_LESSONS.filter((l) => l.trackId === 't7')
const MISS_ID = /^[a-z0-9]+\.[a-z0-9]+(-[a-z0-9]+)*$/
const words = (s: string) => s.trim().split(/\s+/).length

/** The item block each lesson carries (spec §5.4 table). */
const ITEM_BLOCKS: Record<string, { family: string; variants: string[] }> = {
  't7.l1': { family: 'goodput', variants: ['slo-count', 'goodput-rate'] },
  't7.l2': { family: 'goodput', variants: ['knee'] },
  't7.l3': { family: 'goodput', variants: ['frontier'] },
  't7.l4': { family: 'cost', variants: ['per-mtok', 'required-tps'] },
  't7.l5': { family: 'goodput', variants: ['replicas'] },
}

const questionsOf = (l: Lesson): QuizQuestion[] =>
  l.blocks.filter((b): b is QuizBlockData => b.type === 'quiz').flatMap((b) => b.questions)

const mcqsOf = (l: Lesson): { where: string; q: QuizQuestion }[] => [
  ...questionsOf(l).map((q, i) => ({ where: `${l.id} q${i + 1}`, q })),
  ...(l.ticket?.spiral ?? []).map((s) => ({ where: `item:${s.id}`, q: s.q })),
]

let goodput: Gen
let cost: Gen
beforeAll(async () => {
  goodput = await loadFamily('goodput')
  cost = await loadFamily('cost')
})

describe('T7 lessons: KCs and tickets', () => {
  test('all five lessons are there', () => {
    expect(T7.map((l) => l.id)).toEqual(['t7.l1', 't7.l2', 't7.l3', 't7.l4', 't7.l5'])
  })

  for (const l of T7) {
    test(`${l.id}: Lesson.kcs name 2-3 KCs of this lesson, and a ticket carries constructed responses`, () => {
      expect(l.kcs?.length).toBeGreaterThanOrEqual(2)
      expect(l.kcs?.length).toBeLessThanOrEqual(3)
      for (const id of l.kcs ?? []) expect(kcById(id)?.lessons).toContain(l.id)
      expect(l.ticket?.form).toBe(l.id === 't7.l5' ? 'spiral' : 'ticket')
      expect(l.ticket?.cr.length).toBeGreaterThanOrEqual(2)
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
        // spiral items carry their tags on the AuthoredItem, checkpoint questions on the question
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
        expect(named.size).toBe(q.options.length - q.correct.length)
      }
    })
  }

  test('a KC named by Lesson.kcs has at least two tagged items or a generator', () => {
    const count = new Map<string, number>()
    const bump = (kcs: readonly string[] | undefined) => {
      for (const id of new Set(kcs ?? [])) count.set(id, (count.get(id) ?? 0) + 1)
    }
    for (const l of T7) {
      for (const q of questionsOf(l)) bump(q.kcs)
      for (const cr of l.ticket?.cr ?? []) bump(cr.kcs)
      for (const s of l.ticket?.spiral ?? []) bump(s.kcs)
    }
    for (const l of T7) {
      for (const id of l.kcs ?? []) expect((count.get(id) ?? 0) >= 2 || (kcById(id)?.gen?.length ?? 0) > 0).toBe(true)
    }
  })
})

describe('T7 lessons: hands-on item blocks (spec §5.4)', () => {
  for (const l of T7) {
    test(`${l.id}: one item block, on the listed family and variants, covering a lesson KC`, () => {
      const blocks = l.blocks.filter((b): b is ItemBlock => b.type === 'item')
      expect(blocks).toHaveLength(1)
      const [block] = blocks
      const want = ITEM_BLOCKS[l.id]
      expect(block.family).toBe(want.family)
      expect(block.variants).toEqual(want.variants)
      expect(block.title.trim().length).toBeGreaterThan(0)
      const gen = block.family === 'goodput' ? goodput : cost
      const covered = new Set<string>()
      for (const v of block.variants) {
        const variant = gen.variants.find((x) => x.id === v)
        expect(variant).toBeDefined()
        for (const kc of variant?.kcs ?? []) covered.add(kc)
      }
      // each block's variant KCs intersect its lesson's Lesson.kcs
      expect((l.kcs ?? []).some((kc) => covered.has(kc))).toBe(true)
      // the block sits before the checkpoint it prepares
      const at = l.blocks.indexOf(block)
      const quizAt = l.blocks.findIndex((b) => b.type === 'quiz')
      expect(at).toBeLessThan(quizAt)
    })
  }
})

describe('t7.l5: the spiral checkpoint', () => {
  const l5 = T7.find((l) => l.id === 't7.l5') as Lesson
  const earlier = earlierKcsOf('t7.l5', KCS)
  let pool: TicketPool
  beforeAll(async () => {
    const gens = new Map<string, Gen>()
    for (const f of ['frag', 'kv', 'roofline', 'goodput', 'cost', 'memory', 'spec']) gens.set(f, await loadFamily(f))
    pool = makeGenPool(gens, (kc) => kcById(kc)?.gen ?? [])
  })

  test('at least four authored spiral items, on earlier KCs across T4-T7 and never on the lesson\'s own', () => {
    const spiral = l5.ticket?.spiral ?? []
    expect(spiral.length).toBeGreaterThanOrEqual(4)
    expect(new Set(spiral.map((s) => s.id)).size).toBe(spiral.length)
    for (const s of spiral) {
      expect(s.id).toMatch(/^t7\.spiral\.[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(s.q.options).toHaveLength(4)
      expect(s.q.explanation?.trim()).toBeTruthy()
      for (const kc of s.kcs) {
        expect(earlier).toContain(kc)
        expect(l5.kcs).not.toContain(kc)
      }
    }
    const tracks = new Set(spiral.flatMap((s) => s.kcs.map((kc) => kcById(kc)?.track)))
    expect([...tracks].sort()).toEqual(['t4', 't5', 't6', 't7'])
  })

  test('it plans eight items: four on its own KCs, four earlier, two or more non-MCQ, deterministic per seed', () => {
    for (const seed of [1, 7, 21, 99, 4242]) {
      const plan = planTicket(l5, { pool, earlier }, [], seed)
      expect(plan).not.toBeNull()
      if (!plan) continue
      expect(plan.form).toBe('spiral')
      expect(plan.items).toHaveLength(SPIRAL_ITEMS)
      expect(plan.items.filter(isNonMcq).length).toBeGreaterThanOrEqual(2)
      expect(plan.items.filter((i) => i.source === 'quiz')).toHaveLength(3)
      expect(planTicket(l5, { pool, earlier }, [], seed)?.items.map((i) => (i.source === 'gen' ? i.inst.rev : i.source))).toEqual(
        plan.items.map((i) => (i.source === 'gen' ? i.inst.rev : i.source)),
      )
    }
  })

  test('every other T7 lesson plans a three-item ticket whose non-MCQ is generated from its family', () => {
    for (const l of T7.filter((x) => x.id !== 't7.l5')) {
      const plan = planTicket(l, { pool }, [], 3)
      expect(plan?.items).toHaveLength(3)
      expect(plan?.items.filter(isNonMcq)).toHaveLength(1)
    }
  })
})
