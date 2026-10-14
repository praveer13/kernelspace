/**
 * T6b content tags, tickets and hands-on blocks (docs/specs/wave-2.md §5.4, §6.1, §6.2; task 2a-27): t6.l6-t6.l10 name
 * their KCs, tag every checkpoint item, name the misconception behind every lure and carry a ticket with two constructed
 * responses; t6.l6, t6.l8 and t6.l9 hold an item block whose variants assess a KC of the lesson; t6.l8 links lab 08; and
 * t6.l10 is the track's spiral checkpoint.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import { KCS, kcById } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { ItemBlock, Lesson, QuizBlockData } from '../../src/data/lessons/types'
import { loadFamily } from '../../src/lib/items/registry'
import { SPIRAL_ITEMS, earlierKcsOf, isNonMcq, makeGenPool, planTicket, type TicketPool } from '../../src/lib/learner/ticket'

const IDS = ['t6.l6', 't6.l7', 't6.l8', 't6.l9', 't6.l10']
const LESSONS = ALL_LESSONS.filter((l) => IDS.includes(l.id))
const MISS_ID = /^[a-z0-9]+\.[a-z0-9]+(-[a-z0-9]+)*$/
const words = (s: string) => s.trim().split(/\s+/).length

const questionsOf = (l: Lesson): QuizQuestion[] =>
  l.blocks.filter((b): b is QuizBlockData => b.type === 'quiz').flatMap((b) => b.questions)
const itemBlocksOf = (l: Lesson): ItemBlock[] => l.blocks.filter((b): b is ItemBlock => b.type === 'item')
const mcqsOf = (l: Lesson): { where: string; q: QuizQuestion }[] => [
  ...questionsOf(l).map((q, i) => ({ where: `${l.id} q${i + 1}`, q })),
  ...(l.ticket?.spiral ?? []).map((s) => ({ where: `item:${s.id}`, q: s.q })),
]

describe('T6b lessons: KCs and tickets', () => {
  test('the five lessons are there', () => {
    expect(LESSONS.map((l) => l.id)).toEqual(IDS)
  })

  for (const l of LESSONS) {
    test(`${l.id}: Lesson.kcs name 2-3 KCs of this lesson, and the ticket carries two constructed responses`, () => {
      expect(l.kcs?.length).toBeGreaterThanOrEqual(2)
      expect(l.kcs?.length).toBeLessThanOrEqual(3)
      for (const id of l.kcs ?? []) expect(kcById(id)?.lessons).toContain(l.id)
      expect(l.ticket?.form).toBe(l.id === 't6.l10' ? 'spiral' : 'ticket')
      expect(l.ticket?.cr.length).toBe(2)
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

    test(`${l.id}: every checkpoint question is tagged, and every lure names its misconception`, () => {
      expect(questionsOf(l)).toHaveLength(4)
      for (const { where, q } of mcqsOf(l)) {
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

  test('a KC named by Lesson.kcs has two tagged items or a generator to learn from', () => {
    const count = new Map<string, number>()
    const bump = (kcs: readonly string[] | undefined) => {
      for (const id of new Set(kcs ?? [])) count.set(id, (count.get(id) ?? 0) + 1)
    }
    for (const l of LESSONS) {
      for (const q of questionsOf(l)) bump(q.kcs)
      for (const cr of l.ticket?.cr ?? []) bump(cr.kcs)
      for (const s of l.ticket?.spiral ?? []) bump(s.kcs)
    }
    for (const l of LESSONS) {
      for (const id of l.kcs ?? []) {
        const gen = (kcById(id)?.gen ?? []).length > 0
        expect(gen || (count.get(id) ?? 0) >= 2).toBe(true)
      }
    }
  })
})

describe('T6b hands-on item blocks (spec §5.4)', () => {
  const EXPECT: Record<string, { family: string; variants: string[] }> = {
    't6.l6': { family: 'spec', variants: ['expected-tokens', 'speedup', 'best-k'] },
    't6.l8': { family: 'cost', variants: ['cache-discount'] },
    't6.l9': { family: 'memory', variants: ['lora'] },
  }

  for (const l of LESSONS) {
    const want = EXPECT[l.id]
    test(`${l.id}: ${want ? `one ${want.family} item block` : 'no item block (Wave 3 gives it a family)'}`, async () => {
      const blocks = itemBlocksOf(l)
      if (!want) {
        expect(blocks).toHaveLength(0)
        return
      }
      expect(blocks).toHaveLength(1)
      expect(blocks[0].family).toBe(want.family)
      expect(blocks[0].variants).toEqual(want.variants)
      // the family and each variant exist, and the variants assess a KC the lesson names
      const gen = await loadFamily(want.family)
      const offered = gen.variants.filter((v) => want.variants.includes(v.id))
      expect(offered.map((v) => v.id).sort()).toEqual([...want.variants].sort())
      const assessed = offered.flatMap((v) => v.kcs)
      expect(assessed.some((kc) => l.kcs?.includes(kc))).toBe(true)
    })
  }

  test('t6.l8 links lab 08 from a Build this line', () => {
    const l8 = LESSONS.find((l) => l.id === 't6.l8') as Lesson
    const build = l8.blocks.find((b) => b.type === 'callout' && b.title === 'Build this')
    expect(build?.type === 'callout' && build.md.includes('/forge/xgrammar-lite')).toBe(true)
  })
})

describe('t6.l10: the spiral checkpoint', () => {
  const l10 = LESSONS.find((l) => l.id === 't6.l10') as Lesson
  const earlier = earlierKcsOf('t6.l10', KCS)
  let pool: TicketPool
  beforeAll(async () => {
    const families = await Promise.all(['cost', 'frag', 'kv', 'memory', 'roofline', 'spec'].map(async (f) => [f, await loadFamily(f)] as const))
    pool = makeGenPool(new Map(families), (kc) => kcById(kc)?.gen ?? [])
  })

  test('at least four authored spiral items, on earlier KCs and never on the lesson\'s own', () => {
    const spiral = l10.ticket?.spiral ?? []
    expect(spiral.length).toBeGreaterThanOrEqual(4)
    expect(new Set(spiral.map((s) => s.id)).size).toBe(spiral.length)
    for (const s of spiral) {
      expect(s.id).toMatch(/^t6\.spiral\.[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(s.q.options).toHaveLength(4)
      expect(s.q.explanation?.trim()).toBeTruthy()
      for (const kc of s.kcs) {
        expect(earlier).toContain(kc)
        expect(l10.kcs).not.toContain(kc)
      }
    }
    // the items revisit T6 itself and the tracks before it
    const tracks = new Set(spiral.flatMap((s) => s.kcs.map((kc) => kcById(kc)?.track)))
    expect(tracks.has('t6')).toBe(true)
    expect([...tracks].some((t) => t !== 't6')).toBe(true)
  })

  test('it plans eight items: three checkpoint questions, two or more non-MCQ, deterministic per seed', () => {
    for (const seed of [1, 7, 21, 99, 4242]) {
      const plan = planTicket(l10, { pool, earlier }, [], seed)
      expect(plan).not.toBeNull()
      if (!plan) continue
      expect(plan.form).toBe('spiral')
      expect(plan.items).toHaveLength(SPIRAL_ITEMS)
      expect(plan.items.filter(isNonMcq).length).toBeGreaterThanOrEqual(2)
      expect(plan.items.filter((i) => i.source === 'quiz')).toHaveLength(3)
      expect(planTicket(l10, { pool, earlier }, [], seed)?.items.map((i) => (i.source === 'gen' ? i.inst.rev : i.source))).toEqual(
        plan.items.map((i) => (i.source === 'gen' ? i.inst.rev : i.source)),
      )
    }
  })

  test('t6.l6, t6.l8 and t6.l9 plan a three-item ticket whose non-MCQ is generated; t6.l7 asks a constructed response', () => {
    for (const l of LESSONS.filter((x) => x.id !== 't6.l10')) {
      const plan = planTicket(l, { pool }, [], 3)
      expect(plan?.items).toHaveLength(3)
      const kinds = plan?.items.filter(isNonMcq).map((i) => i.source)
      expect(kinds).toEqual([l.id === 't6.l7' ? 'cr' : 'gen'])
    }
  })
})
