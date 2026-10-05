/**
 * Exit tickets, the spiral checkpoint and test-out (docs/specs/wave-1.md §7.2, §8.1, §8.6; task B19): the
 * pass rules, the plan (what is asked, in what order, on which seed), the retry rules, the one-test-out-a-day
 * limit, and the write through the real façade (`recordTicket`), including what a pass does to the lesson
 * and to the cards.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { KCS, kcById } from '../../src/data/kc'
import type { Lesson, QuizBlockData } from '../../src/data/lessons/types'
import { loadFamily } from '../../src/lib/items/registry'
import { gradeItem, resultFor, type ItemResult, type PlayResponse } from '../../src/lib/items/play'
import type { AuthoredItem, ConstructedPrompt, Gen, PlayableItem } from '../../src/lib/items/types'
import { deriveCards } from '../../src/lib/learner/cards'
import {
  SPIRAL_RULE,
  TICKET_RULE,
  earlierKcsOf,
  isNonMcq,
  judgeTicket,
  makeGenPool,
  planTicket,
  testOutUsedToday,
  ticketAttempt,
  type TicketContent,
  type TicketLesson,
  type TicketPool,
} from '../../src/lib/learner/ticket'
import type { TicketPlan } from '../../src/lib/learner/types'
import { MEASURE_LEVEL } from '../../src/lib/items/staircase'
import { makeProfile, startTab } from '../ledger/env'
import { CONTENT, Journal, START } from './ledger-gen'

/* ------------------------------ fixtures ------------------------------ */

let frag: Gen
let genPool: TicketPool
beforeAll(async () => {
  frag = await loadFamily('frag')
  genPool = makeGenPool(new Map([['frag', frag]]), (kc) => kcById(kc)?.gen ?? [])
})

const NO_POOL: TicketPool = { families: () => [], make: () => null }
const kcsOfLesson = (id: string) => KCS.filter((k) => k.lessons[0] === id).map((k) => k.id)

const T1_L4 = kcsOfLesson('t1.l4') // frag-covered
const T0_L1 = kcsOfLesson('t0.l1') // no generator
const T2_L7 = kcsOfLesson('t2.l7')

const question = (n: number, kcs: string[]) => ({
  q: `Question ${n}?`,
  options: ['right', 'wrong a', 'wrong b', 'wrong c'],
  correct: [0],
  why: ['right', 'a', 'b', 'c'],
  kcs,
})

const cr = (n: number, kcs: string[]): ConstructedPrompt => ({
  prompt: `Explain ${n}.`,
  model: 'The model answer.',
  ideas: ['one', 'two', 'three'],
  kcs,
})

const authored = (id: string, kcs: string[]): AuthoredItem => ({ id, q: question(0, kcs), kcs })

/** A lesson with `n` checkpoint questions spread over its KCs and `crs` constructed responses. */
function lessonOf(id: string, kcs: string[], n = 5, crs = 2, extra: Partial<Lesson['ticket']> = {}): TicketLesson {
  const quiz: QuizBlockData = { type: 'quiz', questions: Array.from({ length: n }, (_, i) => question(i, [kcs[i % kcs.length]])) }
  return { id, kcs, blocks: [quiz], ticket: { form: 'ticket', cr: Array.from({ length: crs }, (_, i) => cr(i, kcs)), ...extra } }
}

const content = (pool: TicketPool, over: Partial<TicketContent> = {}): TicketContent => ({ pool, ...over })

const refs = (plan: TicketPlan) => plan.items.map((it) => (it.source === 'gen' ? `gen:${it.inst.family}/${it.inst.variant}` : it.source === 'quiz' ? `quiz:${it.lessonId}#${it.qi}` : it.source === 'cr' ? `cr:${it.lessonId}#${it.index}` : `item:${it.item.id}`))

/** A finished item, right or wrong, the way the player hands it over. */
function answer(item: PlayableItem, right: boolean, seed = 5): ItemResult {
  let response: PlayResponse
  if (item.source === 'cr') response = { kind: 'cr', text: 'x', ideas: right ? [true, true, false] : [true, false, false] }
  else if (item.source === 'gen' && item.inst.answer.kind !== 'choice') {
    const a = item.inst.answer
    response = a.kind === 'numeric' ? { kind: 'numeric', value: right ? a.truth : a.truth * 7 + 3, unit: a.unit } : { kind: 'estimate', value: right ? a.truth : a.truth * 1000 }
  } else {
    const correct = item.source === 'gen' ? (item.inst.answer.kind === 'choice' ? item.inst.answer.correct : []) : (item.source === 'quiz' ? item.q : item.item.q).correct.map(String)
    const options = item.source === 'gen' ? (item.inst.answer.kind === 'choice' ? item.inst.answer.options.map((o) => o.id) : []) : (item.source === 'quiz' ? item.q : item.item.q).options.map((_, i) => String(i))
    response = { kind: 'choice', picks: right ? correct : [options.find((o) => !correct.includes(o)) as string] }
  }
  const grade = gradeItem(item, response, item.source === 'gen' ? frag : undefined)
  return resultFor(item, response, grade, { seed, ms: 4000 })
}

const mustPlan = (p: TicketPlan | null): TicketPlan => {
  expect(p).not.toBeNull()
  return p as TicketPlan
}

/* ------------------------------ pass rules ------------------------------ */

describe('pass rules', () => {
  const plan3 = (): Pick<TicketPlan, 'items' | 'passRule'> => {
    const p = mustPlan(planTicket(lessonOf('t1.l4', T1_L4), content(genPool), [], 11))
    return { items: p.items, passRule: p.passRule }
  }

  test('ticket: at least 2 of 3 and the non-MCQ right', () => {
    const p = plan3()
    expect(p.passRule).toEqual(TICKET_RULE)
    expect(isNonMcq(p.items[2])).toBe(true)
    expect(judgeTicket(p, [true, true, true])).toMatchObject({ correct: 3, ok: true, nonMcqOk: true })
    expect(judgeTicket(p, [true, false, true])).toMatchObject({ correct: 2, ok: true })
    expect(judgeTicket(p, [false, true, true])).toMatchObject({ correct: 2, ok: true })
    // two of three right is not enough when the non-MCQ is the one missed
    expect(judgeTicket(p, [true, true, false])).toMatchObject({ correct: 2, ok: false, nonMcqOk: false })
    expect(judgeTicket(p, [false, false, true])).toMatchObject({ correct: 1, ok: false, nonMcqOk: true })
    expect(judgeTicket(p, [false, false, false]).ok).toBe(false)
  })

  test('an unanswered item counts as wrong', () => {
    const p = plan3()
    expect(judgeTicket(p, [true, true])).toMatchObject({ correct: 2, of: 3, ok: false })
  })

  test('spiral: at least 6 of 8 with at least one non-MCQ right', () => {
    const items: PlayableItem[] = [
      ...Array.from({ length: 6 }, (_, i): PlayableItem => ({ source: 'quiz', lessonId: 'x', qi: i, q: question(i, ['a']), kcs: ['a'] })),
      { source: 'cr', lessonId: 'x', index: 0, cr: cr(0, ['a']) },
      { source: 'cr', lessonId: 'x', index: 1, cr: cr(1, ['a']) },
    ]
    const p = { items, passRule: SPIRAL_RULE }
    expect(SPIRAL_RULE).toEqual({ minCorrect: 6, requireNonMcq: true })
    const T = true
    const F = false
    expect(judgeTicket(p, [T, T, T, T, T, F, T, F])).toMatchObject({ correct: 6, nonMcqOk: true, ok: true })
    expect(judgeTicket(p, [T, T, T, T, F, F, T, T])).toMatchObject({ correct: 6, ok: true })
    expect(judgeTicket(p, [T, T, T, T, T, T, T, T]).ok).toBe(true)
    // six right, every one of them multiple choice: not a pass
    expect(judgeTicket(p, [T, T, T, T, T, T, F, F])).toMatchObject({ correct: 6, nonMcqOk: false, ok: false })
    // both non-MCQs right but only 5 of 8
    expect(judgeTicket(p, [T, T, T, F, F, F, T, T])).toMatchObject({ correct: 5, nonMcqOk: true, ok: false })
  })
})

/* ------------------------------ the plan ------------------------------ */

describe('planTicket: ticket', () => {
  test('a family that covers a lesson KC gives a generated numeric item at level 2 on a fresh seed, shown last', () => {
    const plan = mustPlan(planTicket(lessonOf('t1.l4', T1_L4), content(genPool), [], 42))
    expect(plan).toMatchObject({ lessonId: 't1.l4', form: 'ticket', seed: 42, nonMcqIndex: 2, passRule: TICKET_RULE })
    expect(plan.items).toHaveLength(3)
    const last = plan.items[2]
    expect(last.source).toBe('gen')
    if (last.source !== 'gen') return
    expect(last.inst.family).toBe('frag')
    expect(last.inst.level).toBe(MEASURE_LEVEL)
    expect(last.inst.answer.kind).not.toBe('choice')
    expect(plan.items.slice(0, 2).map((i) => i.source)).toEqual(['quiz', 'quiz'])
  })

  test('without a family the non-MCQ is a constructed response, and it is shown last', () => {
    const plan = mustPlan(planTicket(lessonOf('t0.l1', T0_L1), content(NO_POOL), [], 42))
    expect(plan.items.map((i) => i.source)).toEqual(['quiz', 'quiz', 'cr'])
    expect(plan.nonMcqIndex).toBe(2)
  })

  test('deterministic per seed: the same inputs give the same plan; a new seed gives new numbers', () => {
    const lesson = lessonOf('t1.l4', T1_L4)
    const a = planTicket(lesson, content(genPool), [], 7)
    expect(planTicket(lesson, content(genPool), [], 7)).toEqual(a)
    const b = mustPlan(planTicket(lesson, content(genPool), [], 8))
    expect(b.items[2]).not.toEqual(mustPlan(a).items[2])
  })

  test('items 2 and 3 prefer KCs the generated item does not cover', () => {
    const covered = T1_L4.slice(0, 1)
    const lesson = lessonOf('t1.l4', T1_L4, 0, 1)
    ;(lesson.blocks[0] as QuizBlockData).questions = [question(0, covered), question(1, covered), question(2, T1_L4.slice(1, 2)), question(3, T1_L4.slice(2, 3))]
    // a pool whose only item is on `covered`
    const pool: TicketPool = {
      families: () => ['frag'],
      make: (family, kc, level, seed) => {
        const item = genPool.make(family, kc, level, seed)
        return item && item.source === 'gen' ? { source: 'gen', inst: { ...item.inst, kcs: covered } } : item
      },
    }
    const plan = mustPlan(planTicket(lesson, content(pool), [], 3))
    const qis = plan.items.flatMap((i) => (i.source === 'quiz' ? [i.qi] : []))
    expect(qis.sort()).toEqual([2, 3])
  })

  test('a lesson that cannot supply a valid ticket plans null: too few questions, or nothing to produce', () => {
    expect(planTicket(lessonOf('t0.l1', T0_L1, 1), content(NO_POOL), [], 1)).toBeNull()
    expect(planTicket(lessonOf('t0.l1', T0_L1, 5, 0), content(NO_POOL), [], 1)).toBeNull()
    // a lesson with no generator and no constructed response still has no non-MCQ: not a ticket
    expect(planTicket({ id: 'x', kcs: [], blocks: [] }, content(NO_POOL), [], 1)).toBeNull()
  })

  test('a question tagged with no KC falls back to the lesson KCs', () => {
    const lesson = lessonOf('t0.l1', T0_L1)
    for (const q of (lesson.blocks[0] as QuizBlockData).questions) delete q.kcs
    const plan = mustPlan(planTicket(lesson, content(NO_POOL), [], 1))
    for (const it of plan.items) if (it.source === 'quiz') expect(it.kcs).toEqual(T0_L1)
  })
})

describe('planTicket: retries', () => {
  const lesson = lessonOf('t0.l1', T0_L1, 6, 3)
  const day = START

  /** An earlier attempt: group g1, with the given verdicts per checkpoint question and constructed response. */
  function attempted(qOk: Record<number, boolean>, crIdx?: number) {
    const j = new Journal()
    for (const [qi, ok] of Object.entries(qOk)) j.add('item', `quiz:t0.l1#${qi}`, day, { score: ok ? 1 : 0, ok, rev: 'r', data: { src: 'ticket', grp: 'g1', lessonId: 't0.l1', form: 'ticket' } })
    if (crIdx !== undefined) j.add('item', `cr:t0.l1#${crIdx}`, day, { score: 0, ok: false, rev: 'r', data: { src: 'ticket', grp: 'g1', lessonId: 't0.l1', form: 'ticket' } })
    j.add('quiz', 'lesson:t0.l1', day, { score: 0.33, ok: false, data: { grp: 'g1', form: 'ticket', n: 3 } })
    return j.events
  }

  const qis = (p: TicketPlan) => p.items.flatMap((i) => (i.source === 'quiz' ? [i.qi] : []))

  test('after a miss the next ticket meets questions that were not shown before it repeats ones that were', () => {
    const events = attempted({ 0: false, 1: true })
    for (const seed of [1, 2, 3, 4, 5]) {
      const plan = mustPlan(planTicket(lesson, content(NO_POOL), events, seed))
      expect(qis(plan).every((qi) => qi >= 2)).toBe(true)
    }
  })

  test('with few other questions left, one missed last time comes back before one that was right', () => {
    const l = lessonOf('t0.l1', T0_L1, 3, 3)
    const events = attempted({ 0: false, 1: true, 2: true })
    for (const seed of [1, 2, 3]) {
      const plan = mustPlan(planTicket(l, content(NO_POOL), events, seed))
      expect(qis(plan)).toContain(0)
    }
  })

  test('the constructed response rotates: the one answered longest ago, a never-answered one first', () => {
    const first = mustPlan(planTicket(lesson, content(NO_POOL), [], 1)).items[2]
    expect(first).toMatchObject({ source: 'cr', index: 0 })
    const second = mustPlan(planTicket(lesson, content(NO_POOL), attempted({ 0: true }, 0), 1)).items[2]
    expect(second).toMatchObject({ source: 'cr', index: 1 })
    const j = Journal.from(attempted({ 0: true }, 0))
    j.add('item', 'cr:t0.l1#1', '2026-09-02', { score: 0, ok: false, rev: 'r', data: { src: 'ticket' } })
    j.add('item', 'cr:t0.l1#2', '2026-09-03', { score: 0, ok: false, rev: 'r', data: { src: 'ticket' } })
    expect(mustPlan(planTicket(lesson, content(NO_POOL), j.events, 1)).items[2]).toMatchObject({ source: 'cr', index: 0 })
  })

  test('"New numbers" in the same visit: refs just shown go last, before the ledger write has landed', () => {
    const a = mustPlan(planTicket(lesson, content(NO_POOL), [], 1))
    const avoid = new Set(refs(a))
    for (const seed of [2, 3, 4]) {
      const b = mustPlan(planTicket(lesson, content(NO_POOL), [], seed, { avoid }))
      expect(refs(b).filter((r) => avoid.has(r))).toEqual([])
    }
  })

  test('a miss never closes the way: a retry always plans, however often it is asked', () => {
    let events = attempted({ 0: false, 1: false })
    const avoid = new Set<string>()
    for (let seed = 1; seed <= 6; seed++) {
      const plan = mustPlan(planTicket(lesson, content(NO_POOL), events, seed, { avoid }))
      for (const r of refs(plan)) avoid.add(r)
      events = [...events]
    }
  })
})

describe('planTicket: test-out', () => {
  const lesson = lessonOf('t0.l1', T0_L1, 5, 2)

  test('meets checkpoint questions the learner has not answered, with a constructed response as the non-MCQ', () => {
    const j = new Journal()
    for (const qi of [0, 1, 2]) j.add('item', `quiz:t0.l1#${qi}`, START, { score: 1, ok: true, rev: 'r', data: { src: 'quiz', grp: 'gq' } })
    for (const seed of [1, 2, 3]) {
      const plan = mustPlan(planTicket(lesson, content(NO_POOL), j.events, seed, { form: 'testout' }))
      expect(plan.form).toBe('testout')
      expect(plan.passRule).toEqual(TICKET_RULE)
      expect(plan.items).toHaveLength(3)
      expect(plan.items.flatMap((i) => (i.source === 'quiz' ? [i.qi] : [])).sort()).toEqual([3, 4])
      expect(plan.items[2].source).toBe('cr')
    }
  })

  test('generated where a family covers the lesson', () => {
    const plan = mustPlan(planTicket(lessonOf('t1.l4', T1_L4), content(genPool), [], 9, { form: 'testout' }))
    expect(plan.items[2].source).toBe('gen')
  })

  test('one test-out per lesson per local day, whatever its verdict', () => {
    const j = new Journal()
    j.add('quiz', 'lesson:t0.l1', START, { score: 0.33, ok: false, data: { grp: 'g', form: 'testout', n: 3 } })
    expect(testOutUsedToday(j.events, 't0.l1', START)).toBe(true)
    expect(testOutUsedToday(j.events, 't0.l1', '2026-09-02')).toBe(false) // tomorrow it is offered again
    expect(testOutUsedToday(j.events, 't0.l2', START)).toBe(false) // per lesson
    // a ticket or a checkpoint on the same day does not use it
    const k = new Journal()
    k.add('quiz', 'lesson:t0.l1', START, { data: { grp: 'g', form: 'ticket', n: 3 } })
    k.add('quiz', 'lesson:t0.l1', START, { data: { grp: 'h', n: 5 } })
    expect(testOutUsedToday(k.events, 't0.l1', START)).toBe(false)
  })
})

describe('planTicket: spiral', () => {
  const earlier = earlierKcsOf('t2.l7', KCS)
  const fragKcs = earlier.filter((kc) => kcById(kc)?.gen?.includes('frag'))
  const t0Kcs = earlier.filter((kc) => kc.startsWith('t0.'))
  const spiralItems = [...t0Kcs.slice(0, 6).map((kc, i) => authored(`t0.sp${i}`, [kc])), ...earlier.filter((kc) => kc.startsWith('t2.')).slice(0, 2).map((kc, i) => authored(`t2.sp${i}`, [kc]))]
  const lesson = (): TicketLesson => lessonOf('t2.l7', T2_L7, 6, 2, { form: 'spiral', spiral: spiralItems })

  test('earlierKcsOf: T0-T2 KCs first taught before the lesson, in graph order, and no R', () => {
    expect(earlier.length).toBeGreaterThan(10)
    expect(earlier.some((kc) => kc.startsWith('r.'))).toBe(false)
    for (const kc of earlier) expect(['t0', 't1', 't2']).toContain(kcById(kc)?.track)
    for (const kc of T2_L7) expect(earlier).not.toContain(kc)
    expect(earlierKcsOf('r.l1', KCS)).toEqual([])
  })

  test('8 items: 4 on the lesson, 4 on earlier KCs, at least 2 non-MCQ, the non-MCQs last', () => {
    const plan = mustPlan(planTicket(lesson(), content(genPool, { earlier }), [], 21))
    expect(plan.form).toBe('spiral')
    expect(plan.passRule).toEqual(SPIRAL_RULE)
    expect(plan.items).toHaveLength(8)
    const flags = plan.items.map(isNonMcq)
    expect(flags.filter(Boolean).length).toBeGreaterThanOrEqual(2)
    const firstNon = flags.indexOf(true)
    expect(flags.slice(firstNon).every(Boolean)).toBe(true)
    expect(plan.nonMcqIndex).toBe(firstNon)
    // 4 of the 8 are on the lesson's own KCs (3 questions and the response), 4 are not
    const ownKcs = new Set(T2_L7)
    const own = plan.items.filter((it) => (it.source === 'quiz' && it.kcs.every((k) => ownKcs.has(k))) || (it.source === 'cr' && it.cr.kcs.every((k) => ownKcs.has(k))))
    expect(own).toHaveLength(4)
    expect(new Set(refs(plan)).size).toBe(8)
  })

  test('lowest recall first (with a generator for the non-MCQ)', () => {
    const recall = (kc: string) => (kc === t0Kcs[3] ? 0.3 : kc === t0Kcs[1] ? 0.5 : kc === t0Kcs[5] ? 0.7 : null)
    const plan = mustPlan(planTicket(lesson(), content(genPool, { earlier, recall }), [], 5))
    const authoredKcs = plan.items.flatMap((it) => (it.source === 'item' ? [it.item.kcs[0]] : []))
    // the three carded KCs lead the authored picks, lowest recall first
    expect(authoredKcs.slice(0, 3)).toEqual([t0Kcs[3], t0Kcs[1], t0Kcs[5]])
  })

  test('with no carded KC the curriculum order decides', () => {
    const plan = mustPlan(planTicket(lesson(), content(genPool, { earlier }), [], 5))
    const authoredKcs = plan.items.flatMap((it) => (it.source === 'item' ? [it.item.kcs[0]] : []))
    const order = earlier.filter((kc) => authoredKcs.includes(kc))
    expect(authoredKcs).toEqual(order)
  })

  test('a spiral that cannot be filled plans null (the lesson falls back to its checkpoint)', () => {
    expect(planTicket(lessonOf('t2.l7', T2_L7, 6, 2, { form: 'spiral', spiral: [] }), content(NO_POOL, { earlier }), [], 1)).toBeNull()
    expect(planTicket(lessonOf('t2.l7', T2_L7, 2, 2, { form: 'spiral', spiral: spiralItems }), content(genPool, { earlier }), [], 1)).toBeNull()
  })

  test('the second non-MCQ comes from a generator, whose KC need not be the lowest recall', () => {
    const recall = (kc: string) => (fragKcs.includes(kc) ? 0.99 : t0Kcs.includes(kc) ? 0.2 : null)
    const plan = mustPlan(planTicket(lesson(), content(genPool, { earlier, recall }), [], 12))
    expect(plan.items.filter((it) => it.source === 'gen' && it.inst.answer.kind !== 'choice').length).toBeGreaterThanOrEqual(1)
    expect(plan.items.filter(isNonMcq).length).toBeGreaterThanOrEqual(2)
  })
})

/* ------------------------------ the ledger write ------------------------------ */

describe('ticketAttempt', () => {
  test('one response per item in display order, with the verdict of the pass rule', () => {
    const plan = mustPlan(planTicket(lessonOf('t1.l4', T1_L4), content(genPool), [], 31))
    const attempt = ticketAttempt(plan, plan.items.map((it, i) => answer(it, i !== 0)), 12_345.6)
    expect(attempt).toMatchObject({ lessonId: 't1.l4', form: 'ticket', seed: 31, ms: 12_346, ok: true, nonMcqOk: true })
    expect(attempt.responses.map((r) => r.ok)).toEqual([false, true, true])
    expect(attempt.responses.map((r) => r.ref)).toEqual(refs(plan))
    // a generated item is on a fresh seed, so it is `unseen`; authored questions are `practice`
    expect(attempt.responses.map((r) => r.provenance)).toEqual(['practice', 'practice', 'unseen'])
    expect(attempt.responses[2].data).toMatchObject({ src: 'ticket', level: MEASURE_LEVEL })
    expect(attempt.responses[2].data.value).toBeDefined()
    expect(attempt.responses[0].data.pick).toBeDefined()
    expect(attempt.responses[2].data.kcs?.length).toBeGreaterThan(0)
  })

  test('a miss on the non-MCQ fails the rule however the questions went', () => {
    const plan = mustPlan(planTicket(lessonOf('t1.l4', T1_L4), content(genPool), [], 31))
    const attempt = ticketAttempt(plan, plan.items.map((it, i) => answer(it, i !== 2)))
    expect(attempt).toMatchObject({ ok: false, nonMcqOk: false })
  })

  test('a constructed response carries the ticked ideas, and a test-out writes src testout', () => {
    const plan = mustPlan(planTicket(lessonOf('t0.l1', T0_L1), content(NO_POOL), [], 4, { form: 'testout' }))
    const attempt = ticketAttempt(plan, plan.items.map((it) => answer(it, true)))
    expect(attempt.form).toBe('testout')
    expect(attempt.responses.every((r) => r.data.src === 'testout')).toBe(true)
    expect(attempt.responses[2].data.ideas).toEqual([0, 1])
    expect(attempt.responses[2].provenance).toBe('practice')
  })
})

describe('through the façade', () => {
  const lesson = lessonOf('t1.l4', T1_L4)

  test('a pass writes the items, the quiz summary and one complete via ticket: the lesson is done', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    const plan = mustPlan(planTicket(lesson, content(genPool), [], 77))
    getState().recordTicket(ticketAttempt(plan, plan.items.map((it, i) => answer(it, i !== 1)), 9000))
    expect(getState().lessons['t1.l4']).toMatchObject({ status: 'done' })
    expect(getState().aggregate.lessons['t1.l4'].passVia).toBe('ticket')
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'item')).toHaveLength(3)
    expect(events.find((e) => e.kind === 'quiz')).toMatchObject({ ref: 'lesson:t1.l4', ok: true, data: { form: 'ticket', n: 3, nonMcqOk: true } })
    expect(events.filter((e) => e.kind === 'complete')).toHaveLength(1)
  })

  test('a miss writes evidence and completes nothing; "continue anyway" reads it, and a later pass still makes it done', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    const plan = mustPlan(planTicket(lesson, content(genPool), [], 78))
    getState().recordTicket(ticketAttempt(plan, plan.items.map((it, i) => answer(it, i === 0))))
    expect(getState().aggregate.lessons['t1.l4'].passedAt).toBeUndefined()
    getState().completeLesson('t1.l4', 'read')
    expect(getState().lessons['t1.l4']?.status).toBe('read')
    const retry = mustPlan(planTicket(lesson, content(genPool), [], 79))
    getState().recordTicket(ticketAttempt(retry, retry.items.map((it) => answer(it, true))))
    expect(getState().lessons['t1.l4']?.status).toBe('done')
  })

  test('a test-out pass makes the lesson done via testout, and its cards carry a day-7 confirmation', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    const plan = mustPlan(planTicket(lesson, content(genPool), [], 80, { form: 'testout' }))
    getState().recordTicket(ticketAttempt(plan, plan.items.map((it) => answer(it, true))))
    expect(getState().aggregate.lessons['t1.l4'].passVia).toBe('testout')
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(testOutUsedToday(events, 't1.l4', events[0].day)).toBe(true)
    const cards = deriveCards(events, { ...CONTENT, lessonKcs: new Map([['t1.l4', T1_L4]]) }, events[0].day)
    const made = Object.values(cards.cards)
    expect(made.length).toBeGreaterThan(0)
    for (const c of made) {
      expect(c.origin).toBe('testout')
      expect(c.confirmDay).toBeDefined()
    }
  })
})
