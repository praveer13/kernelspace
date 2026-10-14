/**
 * T3 content tags and tickets (docs/specs/wave-2.md §6.1, §6.2, §17.4; task 2a-22): every lesson names 2-3 KCs, carries a
 * ticket with two constructed responses, tags every checkpoint item and names the misconception behind every lure;
 * t3.l7 is a spiral checkpoint whose authored items sit on earlier KCs and plan into a valid eight; t3.l1 opens with
 * retrieval of the R KCs and no longer carries the R9 material; t3.l4 links lab 05.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { KCS, kcById } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { Lesson, QuizBlockData } from '../../src/data/lessons/types'
import { loadFamily } from '../../src/lib/items/registry'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import { SPIRAL_ITEMS, earlierKcsOf, isNonMcq, makeGenPool, planTicket, type TicketPool } from '../../src/lib/learner/ticket'

const T3 = ALL_LESSONS.filter((l) => l.trackId === 't3')
const lessonById = (id: string) => T3.find((l) => l.id === id) as Lesson
const MISS_ID = /^[a-z0-9]+\.[a-z0-9]+(-[a-z0-9]+)*$/
const words = (s: string) => s.trim().split(/\s+/).length

const questionsOf = (l: Lesson): QuizQuestion[] =>
  l.blocks.filter((b): b is QuizBlockData => b.type === 'quiz').flatMap((b) => b.questions)

/** The checkpoint and spiral questions of a lesson, with where each lives (for messages). */
const mcqsOf = (l: Lesson): { where: string; q: QuizQuestion }[] => [
  ...questionsOf(l).map((q, i) => ({ where: `${l.id} q${i + 1}`, q })),
  ...(l.ticket?.spiral ?? []).map((s) => ({ where: `item:${s.id}`, q: s.q })),
]

describe('T3 lessons: KCs and tickets', () => {
  test('all seven lessons are there', () => {
    expect(T3.map((l) => l.id)).toEqual(['t3.l1', 't3.l2', 't3.l3', 't3.l4', 't3.l5', 't3.l6', 't3.l7'])
  })

  for (const l of T3) {
    test(`${l.id}: Lesson.kcs name 2-3 KCs of this lesson, and a ticket carries two constructed responses`, () => {
      expect(l.kcs?.length).toBeGreaterThanOrEqual(2)
      expect(l.kcs?.length).toBeLessThanOrEqual(3)
      for (const id of l.kcs ?? []) expect(kcById(id)?.lessons).toContain(l.id)
      expect(l.ticket?.form).toBe(l.id === 't3.l7' ? 'spiral' : 'ticket')
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

    test(`${l.id}: each Lesson.kcs KC has a checkpoint question and at least two tagged items to learn from`, () => {
      const items = [
        ...questionsOf(l).map((q) => q.kcs ?? []),
        ...(l.ticket?.cr ?? []).map((c) => c.kcs),
        ...(l.ticket?.spiral ?? []).map((s) => s.kcs),
      ]
      for (const id of l.kcs ?? []) {
        expect(items.filter((kcs) => kcs.includes(id)).length).toBeGreaterThanOrEqual(2)
        expect(questionsOf(l).some((q) => q.kcs?.includes(id))).toBe(true)
      }
    })
  }
})

describe('t3.l1: a retrieval spiral', () => {
  const l1 = lessonById('t3.l1')
  const predict = l1.blocks[0]

  test('opens with four retrieval items on the R KCs it no longer teaches', () => {
    expect(predict.type).toBe('predict')
    if (predict.type !== 'predict') return
    expect(predict.items).toHaveLength(4)
    const tagged = new Set(predict.items.flatMap((p) => p.kcs))
    for (const id of ['r.ownership-moves', 'r.borrow-rules', 'r.lifetimes']) expect(tagged.has(id)).toBe(true)
    const h2s = l1.blocks.flatMap((b) => (b.type === 'prose' ? [...b.md.matchAll(/^## (.+)$/gm)].map((m) => m[1]) : []))
    for (const p of predict.items) {
      expect(p.kind).toBe('choice')
      if (p.kind !== 'choice') continue
      expect(p.why).toHaveLength(p.options.length)
      // the reveal lands at the end of a real section, and the lesson's own KCs are not what these items retrieve
      expect(h2s).toContain(p.revealAt)
      for (const id of p.kcs) expect(kcById(id)?.track).toBe('r')
    }
  })

  test('drops the duplicated longest<\'a> and Block<\'a> material', () => {
    const text = JSON.stringify(l1.blocks.filter((b) => b.type !== 'predict'))
    expect(text).not.toContain('longest')
    expect(text).not.toContain("Block<'a>")
    expect(text).not.toContain("<'a>")
  })

  test('teaches what T3 adds: arenas, Rc<RefCell>, Arc<Mutex> and their costs', () => {
    const prose = l1.blocks.flatMap((b) => (b.type === 'prose' ? [b.md] : [])).join('\n')
    expect(prose).toContain('arena')
    expect(prose).toContain('Rc<RefCell<')
    expect(prose).toContain('Arc<Mutex<')
    expect(prose).toContain('What each one costs')
    // the checkpoint asks about T3's own KCs, not the retrieved R ones
    for (const q of questionsOf(l1)) for (const id of q.kcs ?? []) expect(kcById(id)?.track).toBe('t3')
  })
})

describe('t3.l4: lab 05', () => {
  test('carries one "Build this" line that links the toy-executor lab', () => {
    const l4 = lessonById('t3.l4')
    const callouts = l4.blocks.filter((b) => b.type === 'callout' && b.md.startsWith('**Build this.**'))
    expect(callouts).toHaveLength(1)
    const md = callouts[0].type === 'callout' ? callouts[0].md : ''
    expect(md).toContain('Lab 05')
    expect(md).toContain('/forge/toy-executor')
  })
})

describe('t3.l7: the spiral checkpoint', () => {
  const l7 = lessonById('t3.l7')
  const earlier = earlierKcsOf('t3.l7', KCS)
  let pool: TicketPool
  beforeAll(async () => {
    const frag = await loadFamily('frag')
    pool = makeGenPool(new Map([['frag', frag]]), (kc) => kcById(kc)?.gen ?? [])
  })

  test('at least four authored spiral items, on earlier KCs and never on the lesson\'s own', () => {
    const spiral = l7.ticket?.spiral ?? []
    expect(spiral.length).toBeGreaterThanOrEqual(4)
    expect(new Set(spiral.map((s) => s.id)).size).toBe(spiral.length)
    for (const s of spiral) {
      expect(s.id).toMatch(/^t3\.spiral\.[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(s.q.options).toHaveLength(4)
      expect(s.q.explanation?.trim()).toBeTruthy()
      for (const kc of s.kcs) {
        expect(earlier).toContain(kc)
        expect(l7.kcs).not.toContain(kc)
      }
    }
    // the items revisit T3 and the tracks before it
    const tracks = new Set(spiral.flatMap((s) => s.kcs.map((kc) => kcById(kc)?.track)))
    expect([...tracks].sort()).toEqual(['t0', 't1', 't2', 't3'])
  })

  test('it plans eight items: four on the lesson, four earlier, two or more non-MCQ, deterministic per seed', () => {
    for (const seed of [1, 7, 21, 99, 4242]) {
      const plan = planTicket(l7, { pool, earlier }, [], seed)
      expect(plan).not.toBeNull()
      if (!plan) continue
      expect(plan.form).toBe('spiral')
      expect(plan.items).toHaveLength(SPIRAL_ITEMS)
      expect(plan.items.filter(isNonMcq).length).toBeGreaterThanOrEqual(2)
      expect(plan.items.filter((i) => i.source === 'item').length).toBeGreaterThanOrEqual(2)
      expect(plan.items.filter((i) => i.source === 'quiz')).toHaveLength(3)
      expect(planTicket(l7, { pool, earlier }, [], seed)?.items.map((i) => (i.source === 'gen' ? i.inst.rev : i.source))).toEqual(
        plan.items.map((i) => (i.source === 'gen' ? i.inst.rev : i.source)),
      )
    }
  })

  test('a learner whose T3 recall is lowest meets the T3 spiral items first', () => {
    const recall = (kc: string) => (kcById(kc)?.track === 't3' ? 0.3 : 0.9)
    for (const seed of [1, 7, 21]) {
      const plan = planTicket(l7, { pool, earlier, recall }, [], seed)
      expect(plan?.items).toHaveLength(SPIRAL_ITEMS)
      const authored = (plan?.items ?? []).flatMap((i) => (i.source === 'item' ? [i.item] : []))
      expect(authored.length).toBeGreaterThanOrEqual(3)
      expect(authored.filter((a) => a.kcs.some((kc) => kcById(kc)?.track === 't3')).length).toBeGreaterThanOrEqual(3)
    }
  })

  test('every other T3 lesson plans a three-item ticket whose non-MCQ is a constructed response', () => {
    for (const l of T3.filter((x) => x.id !== 't3.l7')) {
      const plan = planTicket(l, { pool }, [], 3)
      expect(plan?.items).toHaveLength(3)
      expect(plan?.items.filter(isNonMcq).map((i) => i.source)).toEqual(['cr'])
    }
  })
})
