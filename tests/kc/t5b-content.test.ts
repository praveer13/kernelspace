/**
 * T5b content (docs/specs/wave-2.md §6.1, §6.3, §8.1; task 2a-25): t5.l6 to t5.l10 name their KCs, carry a ticket with
 * constructed responses, tag every checkpoint item and name the misconception behind every lure, open with two
 * prequestions, gate the t5.l6/l7/l8 diagrams with a prediction, and carry what the spec places in them: the scheduler
 * play after t5.l7's opening prose, a spec item block in t5.l8, 'Build this' lines for labs 07 and 06, and t5.l10 as
 * the T5 spiral checkpoint.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import { KCS, kcById } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { ContentBlock, Lesson, QuizBlockData } from '../../src/data/lessons/types'
import { loadFamily } from '../../src/lib/items/registry'
import { SPIRAL_ITEMS, earlierKcsOf, isNonMcq, makeGenPool, planTicket, type TicketPool } from '../../src/lib/learner/ticket'

const IDS = ['t5.l6', 't5.l7', 't5.l8', 't5.l9', 't5.l10']
const T5B = ALL_LESSONS.filter((l) => IDS.includes(l.id))
const MISS_ID = /^[a-z0-9]+\.[a-z0-9]+(-[a-z0-9]+)*$/
/** A miss id is a slug, or `confuse.<kcId>` (wave-3.md §11.2): the learner took one KC for another. */
const isMissId = (miss: string) => MISS_ID.test(miss) || (miss.startsWith('confuse.') && kcById(miss.slice('confuse.'.length)) !== undefined)
const words = (s: string) => s.trim().split(/\s+/).length
const lesson = (id: string) => T5B.find((l) => l.id === id) as Lesson

const questionsOf = (l: Lesson): QuizQuestion[] =>
  l.blocks.filter((b): b is QuizBlockData => b.type === 'quiz').flatMap((b) => b.questions)

const headings = (l: Lesson): string[] =>
  l.blocks.flatMap((b) => (b.type === 'prose' ? [...b.md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()) : []))

describe('t5.l6-l10: KCs, tickets and tags', () => {
  test('all five lessons are there', () => {
    expect(T5B.map((l) => l.id)).toEqual(IDS)
  })

  for (const l of T5B) {
    test(`${l.id}: 2-3 Lesson.kcs of this lesson, and a ${l.id === 't5.l10' ? 'spiral' : 'ticket'} with two constructed responses`, () => {
      expect(l.kcs?.length).toBeGreaterThanOrEqual(2)
      expect(l.kcs?.length).toBeLessThanOrEqual(3)
      for (const id of l.kcs ?? []) expect(kcById(id)?.lessons).toContain(l.id)
      expect(l.ticket?.form).toBe(l.id === 't5.l10' ? 'spiral' : 'ticket')
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

    test(`${l.id}: every checkpoint question is tagged with 1-3 KCs, and every lure names its misconception`, () => {
      const qs = [...questionsOf(l).map((q, i) => ({ where: `${l.id} q${i + 1}`, q })), ...(l.ticket?.spiral ?? []).map((s) => ({ where: `item:${s.id}`, q: s.q }))]
      expect(questionsOf(l)).toHaveLength(4)
      for (const { where, q } of qs) {
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
          if (q.correct.includes(i)) return expect(miss).toBe('')
          expect(isMissId(miss)).toBe(true)
          named.add(miss)
        })
        expect(named.size).toBe(q.options.length - q.correct.length)
      }
    })

    test(`${l.id}: opens with a predict block of two prequestions that name a heading of the lesson`, () => {
      const first = l.blocks[0]
      expect(first.type).toBe('predict')
      if (first.type !== 'predict') return
      expect(first.items).toHaveLength(2)
      const h2 = headings(l)
      for (const p of first.items) {
        expect(h2).toContain(p.revealAt)
        expect(p.kcs.length).toBeGreaterThanOrEqual(1)
        for (const id of p.kcs) expect(kcById(id)).toBeDefined()
        if (p.kind === 'choice') {
          expect(p.options).toHaveLength(4)
          expect(p.why).toHaveLength(4)
        } else {
          expect(p.truth).toBeGreaterThan(0)
          expect(p.okWithinFactor).toBeGreaterThan(1)
        }
      }
      expect(l.blocks.filter((b) => b.type === 'predict')).toHaveLength(1)
    })
  }

  test('a KC named by Lesson.kcs has at least two tagged items to learn from', () => {
    const count = new Map<string, number>()
    const bump = (kcs: readonly string[] | undefined) => {
      for (const id of new Set(kcs ?? [])) count.set(id, (count.get(id) ?? 0) + 1)
    }
    for (const l of T5B) {
      for (const b of l.blocks) {
        if (b.type === 'predict') for (const p of b.items) bump(p.kcs)
        if (b.type === 'diagram') bump(b.predictAt?.kcs)
        if (b.type === 'quiz') for (const q of b.questions) bump(q.kcs)
      }
      for (const cr of l.ticket?.cr ?? []) bump(cr.kcs)
      for (const s of l.ticket?.spiral ?? []) bump(s.kcs)
    }
    for (const l of T5B) for (const id of l.kcs ?? []) expect(count.get(id) ?? 0).toBeGreaterThanOrEqual(2)
  })
})

describe('t5.l6, t5.l7 and t5.l8: predictAt on the figure the spec names', () => {
  for (const [id, caption] of [
    ['t5.l6', 'longest-prefix lookup in a radix cache'],
    ['t5.l7', 'static vs continuous'],
    ['t5.l8', 'one speculative round'],
  ]) {
    test(`${id}: the "${caption}" diagram withholds its later captions behind a prediction`, () => {
      const dia = lesson(id).blocks.find((b) => b.type === 'diagram')
      expect(dia?.type === 'diagram' ? dia.caption : '').toContain(caption)
      const gate = dia?.type === 'diagram' ? dia.predictAt : undefined
      expect(gate).toBeDefined()
      if (!gate || dia?.type !== 'diagram') return
      expect(gate.step).toBeGreaterThanOrEqual(1)
      expect(gate.step).toBeLessThan(dia.steps.length)
      expect(gate.options).toHaveLength(4)
      expect(gate.why).toHaveLength(4)
      expect(gate.correct).toHaveLength(1)
      expect(gate.kcs.length).toBeGreaterThanOrEqual(1)
    })
  }

  test('t5.l9 and t5.l10 have no diagram gate (the spec lists only t5.l6 to t5.l8)', () => {
    for (const id of ['t5.l9', 't5.l10']) expect(lesson(id).blocks.some((b) => b.type === 'diagram' && b.predictAt)).toBe(false)
  })
})

describe('what the spec places in t5.l6 to t5.l8', () => {
  const blockOf = (id: string, type: ContentBlock['type']) => lesson(id).blocks.filter((b) => b.type === type)

  test('t5.l7: the scheduler play comes right after the opening prose', () => {
    const blocks = lesson('t5.l7').blocks
    const opening = blocks.findIndex((b) => b.type === 'prose')
    expect(blocks[opening + 1]).toEqual({ type: 'play', playId: 'scheduler', title: 'I was the scheduler' })
    expect(blockOf('t5.l7', 'play')).toHaveLength(1)
  })

  test('t5.l7 keeps its simulator exercise block untouched', () => {
    const ex = blockOf('t5.l7', 'exercise')
    expect(ex).toHaveLength(1)
    expect(ex[0].type === 'exercise' && ex[0].simId).toBe('sim-batching')
    expect(ex[0].type === 'exercise' && ex[0].tasks).toHaveLength(4)
  })

  test('t5.l8: a spec item block whose variants exist and whose KCs meet Lesson.kcs', async () => {
    const items = blockOf('t5.l8', 'item')
    expect(items).toHaveLength(1)
    const item = items[0]
    if (item.type !== 'item') return
    expect(item.family).toBe('spec')
    const spec = await loadFamily('spec')
    const vs = item.variants.map((v) => spec.variants.find((x) => x.id === v))
    for (const v of vs) expect(v).toBeDefined()
    const kcs = new Set(vs.flatMap((v) => v?.kcs ?? []))
    expect((lesson('t5.l8').kcs ?? []).some((k) => kcs.has(k))).toBe(true)
  })

  for (const [id, labId, href, firstCheck] of [
    ['t5.l6', 'radix-cache', '/forge/radix-cache', 'exact_match'],
    ['t5.l7', 'batching-scheduler', '/forge/batching-scheduler', 'runs_clean'],
  ]) {
    test(`${id}: a 'Build this' line links lab ${labId} and names its first check`, () => {
      const lab = FORGE_LABS.find((x) => x.id === labId)
      expect(lab?.lessonId).toBe(id)
      expect(lab?.checks[0].id).toBe(firstCheck)
      const callout = lesson(id).blocks.find((b) => b.type === 'callout' && b.title?.startsWith('Build this'))
      expect(callout?.type === 'callout' ? callout.md : '').toContain(`](${href})`)
      expect(callout?.type === 'callout' ? callout.md : '').toContain(firstCheck)
    })
  }
})

describe('t5.l10: the T5 spiral checkpoint', () => {
  const l10 = lesson('t5.l10')
  const earlier = earlierKcsOf('t5.l10', KCS)
  let pool: TicketPool
  beforeAll(async () => {
    const gens = new Map(await Promise.all(['kv', 'roofline', 'frag', 'memory', 'spec'].map(async (f) => [f, await loadFamily(f)] as const)))
    pool = makeGenPool(gens, (kc) => kcById(kc)?.gen ?? [])
  })

  test('at least four authored spiral items, on earlier KCs of T3 to T5 and never on the lesson\'s own', () => {
    const spiral = l10.ticket?.spiral ?? []
    expect(spiral.length).toBeGreaterThanOrEqual(4)
    expect(new Set(spiral.map((s) => s.id)).size).toBe(spiral.length)
    for (const s of spiral) {
      expect(s.id).toMatch(/^t5\.spiral\.[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(s.q.options).toHaveLength(4)
      expect(s.q.explanation?.trim()).toBeTruthy()
      for (const kc of s.kcs) {
        expect(earlier).toContain(kc)
        expect(l10.kcs).not.toContain(kc)
      }
    }
    const tracks = new Set(spiral.flatMap((s) => s.kcs.map((kc) => kcById(kc)?.track)))
    expect([...tracks].sort()).toEqual(['t3', 't4', 't5'])
  })

  test('it plans eight items with two or more non-MCQ, deterministic per seed', () => {
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

  test('t5.l6 to t5.l9 plan a three-item ticket with one non-MCQ', () => {
    for (const l of T5B.filter((x) => x.id !== 't5.l10')) {
      const plan = planTicket(l, { pool }, [], 3)
      expect(plan?.items).toHaveLength(3)
      expect(plan?.items.filter(isNonMcq)).toHaveLength(1)
    }
  })
})
