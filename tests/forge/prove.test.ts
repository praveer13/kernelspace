/**
 * H4 v1 Prove it for lab 01 (wave-1.md §13.3): 3 of 6 authored questions, answers of at least 12 words,
 * the model answer only after that, a self-grade, one `prove` event at practice weight, and fresh
 * questions after 24 h. The reducer is the one ProveIt drives; the render checks run the panel itself.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import ProveIt from '../../src/components/forge/ProveIt'
import {
  MIN_ANSWER_WORDS,
  PROVE_LAB_ID,
  PROVE_PICK,
  PROVE_QUESTIONS,
  RETRY_AFTER_MS,
  activeIndex,
  answerReady,
  buildProveResult,
  followUpRef,
  formatWait,
  freshCards,
  pickQuestions,
  proveDone,
  proveScore,
  reduceCards,
  retryOpensAt,
  wordCount,
} from '../../src/data/forge/rust-allocator/prove'
import type { ProveAction, ProveAttempt, ProveCard } from '../../src/data/forge/rust-allocator/prove'
import { buildRows, creditedRequiredPass, resultsOf, tally } from '../../src/lib/forge/present'
import { creditFor } from '../../src/lib/forge/run'
import { KC } from '../../src/data/kc/ids'
import { makeProfile, startTab } from '../ledger/env'

const TWELVE = 'my free finds the slot by address then merges both runs together'
const ELEVEN = 'my free finds the slot by address then merges both runs'
const H = 3_600_000
const T = Date.parse('2026-10-05T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

const run = (cards: ProveCard[], ...actions: ProveAction[]) => actions.reduce(reduceCards, cards)
/** Answer, reveal and grade question `i`. */
const answer = (i: number, got: boolean): ProveAction[] => [
  { type: 'write', index: i, text: TWELVE },
  { type: 'reveal', index: i },
  { type: 'grade', index: i, got },
]

describe('the question pool', () => {
  test('six questions with unique ids, three ideas each and an answer the learner cannot already see', () => {
    expect(PROVE_QUESTIONS).toHaveLength(6)
    expect(new Set(PROVE_QUESTIONS.map((q) => q.id)).size).toBe(6)
    for (const q of PROVE_QUESTIONS) {
      expect(q.prompt.endsWith('?')).toBe(true)
      expect(q.model.length).toBeGreaterThan(120)
      expect(q.ideas).toHaveLength(3)
      expect(q.prompt).not.toContain(q.model)
      expect(q.kcs.length).toBeGreaterThan(0)
    }
  })

  test("the spec's three example questions are in the pool, and the follow-up ref is the Today item's", () => {
    const prompts = PROVE_QUESTIONS.map((q) => q.prompt)
    expect(prompts.some((p) => p.includes('`free`') && p.includes('both'))).toBe(true)
    expect(prompts.some((p) => p.includes('`align_up`') && p.includes('overflow'))).toBe(true)
    expect(prompts.some((p) => p.includes('larger than every free run'))).toBe(true)
    expect(followUpRef('free-both')).toBe('item:lab01.prove.free-both')
  })

  test('every question tags KCs that exist', () => {
    const known = new Set<string>(Object.values(KC))
    for (const q of PROVE_QUESTIONS) for (const kc of q.kcs) expect(known.has(kc)).toBe(true)
  })

  test('questions name the harness checks by their real ids', () => {
    const ids = ['boot', 'align', 'no_overlap', 'reuse', 'coalesce', 'fragmentation']
    const q = PROVE_QUESTIONS.find((x) => x.id === 'no-merge-fails')
    expect(q).toBeDefined()
    for (const id of ids) expect(q?.model).toContain(id)
  })
})

describe('the 12-word rule', () => {
  test('counts whitespace-separated words', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('   \n ')).toBe(0)
    expect(wordCount(' a  b\tc\nd ')).toBe(4)
    expect(wordCount(TWELVE)).toBe(12)
    expect(wordCount(ELEVEN)).toBe(11)
  })

  test('11 words do not reveal the model answer; 12 do', () => {
    const short = run(freshCards(), { type: 'write', index: 0, text: ELEVEN }, { type: 'reveal', index: 0 })
    expect(short[0]?.revealed).toBe(false)
    expect(answerReady(ELEVEN)).toBe(false)
    const ok = run(freshCards(), { type: 'write', index: 0, text: TWELVE }, { type: 'reveal', index: 0 })
    expect(ok[0]?.revealed).toBe(true)
    expect(MIN_ANSWER_WORDS).toBe(12)
  })

  test('the answer is locked once the model answer is out', () => {
    const c = run(freshCards(), { type: 'write', index: 0, text: TWELVE }, { type: 'reveal', index: 0 }, { type: 'write', index: 0, text: 'changed after peeking' })
    expect(c[0]?.answer).toBe(TWELVE)
  })

  test('a grade needs the reveal first, and cannot be changed afterwards', () => {
    const early = run(freshCards(), { type: 'write', index: 0, text: TWELVE }, { type: 'grade', index: 0, got: true })
    expect(early[0]?.self).toBeUndefined()
    const graded = run(freshCards(), ...answer(0, false), { type: 'grade', index: 0, got: true })
    expect(graded[0]?.self).toBe(0)
  })

  test('questions go in order: nothing later can be touched before the current one is graded', () => {
    const c = run(freshCards(), { type: 'write', index: 1, text: TWELVE }, { type: 'reveal', index: 1 })
    expect(c[1]?.answer).toBe('')
    expect(activeIndex(c)).toBe(0)
  })

  test('an answer is capped, not rejected', () => {
    const c = run(freshCards(), { type: 'write', index: 0, text: 'word '.repeat(1000) })
    expect(c[0]?.answer.length).toBeLessThanOrEqual(1200)
  })
})

describe('grading and the ledger payload', () => {
  test('no result until all three are graded; the score is the fraction "got it"', () => {
    const qs = pickQuestions([], 1)
    expect(qs).toHaveLength(PROVE_PICK)
    let cards = run(freshCards(), ...answer(0, true), ...answer(1, false))
    expect(proveDone(cards)).toBe(false)
    expect(buildProveResult(qs, cards)).toBeNull()
    cards = run(cards, ...answer(2, true))
    expect(proveDone(cards)).toBe(true)
    expect(proveScore(cards)).toBeCloseTo(2 / 3, 10)
    const r = buildProveResult(qs, cards, { ms: 90_000 })
    expect(r).toMatchObject({ labId: PROVE_LAB_ID, ok: true, ms: 90_000, data: { v: 1, self: [1, 0, 1] } })
    expect(r?.score).toBeCloseTo(2 / 3, 10)
    expect(r?.data.qids).toEqual(qs.map((q) => q.id))
    expect(r?.data.kcs?.length).toBeGreaterThan(0)
    expect(r?.data.kcs?.length).toBeLessThanOrEqual(6)
  })

  test('all "not yet" is still ok (all answered) with score 0', () => {
    const qs = pickQuestions([], 2)
    const cards = run(freshCards(), ...answer(0, false), ...answer(1, false), ...answer(2, false))
    expect(buildProveResult(qs, cards)).toMatchObject({ ok: true, score: 0, data: { self: [0, 0, 0] } })
  })

  test('recordProve writes one prove event, provenance practice, that the codec and fold accept', async () => {
    const tab = startTab(makeProfile())
    const qs = pickQuestions([], 3)
    const cards = run(freshCards(), ...answer(0, true), ...answer(1, true), ...answer(2, false))
    const result = buildProveResult(qs, cards)
    expect(result).not.toBeNull()
    if (result === null) return
    tab.progress.getState().recordProve(result)
    expect(tab.progress.getState().aggregate.proves[PROVE_LAB_ID]).toBeDefined()
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'prove')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      ref: `prove:${PROVE_LAB_ID}`,
      ok: true,
      provenance: 'practice',
      data: { v: 1, qids: qs.map((q) => q.id), self: [1, 1, 0] },
    })
    expect(events[0]?.score).toBeCloseTo(2 / 3, 10)
  })
})

describe('fresh questions after 24 h', () => {
  test('the draw is deterministic and gives three distinct questions', () => {
    const a = pickQuestions([], 7).map((q) => q.id)
    expect(pickQuestions([], 7).map((q) => q.id)).toEqual(a)
    expect(new Set(a).size).toBe(3)
  })

  test('different seeds do not always give the same three', () => {
    const sets = new Set(Array.from({ length: 20 }, (_, s) => pickQuestions([], s).map((q) => q.id).sort().join()))
    expect(sets.size).toBeGreaterThan(1)
  })

  test('the second attempt gets exactly the other three, for any seed', () => {
    for (let seed = 0; seed < 30; seed++) {
      const first = pickQuestions([], seed).map((q) => q.id)
      const second = pickQuestions([{ at: iso(T), qids: first }], seed + 100).map((q) => q.id)
      expect(second.filter((id) => first.includes(id))).toEqual([])
      expect(new Set([...first, ...second]).size).toBe(6)
    }
  })

  test('after both sets are used, the set served longest ago comes back first', () => {
    const a = pickQuestions([], 1).map((q) => q.id)
    const b = PROVE_QUESTIONS.map((q) => q.id).filter((id) => !a.includes(id))
    const history: ProveAttempt[] = [
      { at: iso(T), qids: a },
      { at: iso(T + 2 * RETRY_AFTER_MS), qids: b },
    ]
    expect(pickQuestions(history, 5).map((q) => q.id).sort()).toEqual([...a].sort())
  })

  test('a retry opens 24 h after the newest attempt, and never before', () => {
    expect(retryOpensAt([], T)).toBeNull()
    const history = [{ at: iso(T - 30 * H), qids: ['x'] }, { at: iso(T - 2 * H), qids: ['y'] }]
    expect(retryOpensAt(history, T)).toBe(T - 2 * H + RETRY_AFTER_MS)
    expect(retryOpensAt(history, T + 22 * H)).toBeNull()
    expect(retryOpensAt(history, T + 22 * H - 1)).toBe(T - 2 * H + RETRY_AFTER_MS)
  })

  test('formatWait rounds up and never says zero', () => {
    expect(formatWait(1)).toBe('1 min')
    expect(formatWait(45 * 60_000)).toBe('45 min')
    expect(formatWait(2 * H)).toBe('2 h')
    expect(formatWait(23 * H + 10 * 60_000)).toBe('23 h 10 min')
  })
})

describe('the panel', () => {
  // React separates adjacent text nodes with comments; flatten them so the checks read like the page does.
  const render = (props: Parameters<typeof ProveIt>[0]) => renderToString(createElement(ProveIt, props)).replaceAll('<!-- -->', '')

  test('locked until the checks are green', () => {
    const html = render({ unlocked: false, history: [] })
    expect(html).toContain('data-prove="locked"')
    expect(html).toContain('Opens when all six checks are green')
    expect(html).not.toContain('<textarea')
  })

  test('a green reference run leaves Prove it locked; a credited green run opens it', () => {
    const results = [
      { id: 'boot', label: 'boot', status: 'pass' as const, msg: 'ok' },
      { id: 'align', label: 'align', status: 'pass' as const, msg: 'ok', seed: 1, fresh: true },
    ]
    const green = (reference: boolean) => ({ lab: 'rust-allocator', reference, abi: 2 as const, version: 2, checks: results, seeds: 'fresh' as const, ms: 5 })
    const required = ['boot', 'align']
    const unlockedBy = (reference: boolean) => {
      const r = green(reference)
      const counts = tally(buildRows(required.map((id) => ({ id, label: id })), resultsOf(r)))
      return creditedRequiredPass(creditFor(r, {}, required), counts)
    }
    expect(unlockedBy(true)).toBe(false)
    expect(render({ unlocked: unlockedBy(true), history: [] })).toContain('data-prove="locked"')
    expect(unlockedBy(false)).toBe(true)
    expect(render({ unlocked: unlockedBy(false), history: [], now: T, seed: 4 })).toContain('data-prove="active"')
  })

  test('first question: a textarea, a 0/12 counter, a disabled reveal and no model answer', () => {
    const html = render({ history: [], now: T, seed: 4 })
    expect(html).toContain('data-prove="active"')
    expect(html).toContain('Close your agent: 3 questions about your code')
    expect(html).toContain('Question 1 of 3')
    expect(html).toContain('0/12 words')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Show the model answer/)
    expect(html).not.toContain('Model answer</p>')
    expect(html).not.toContain('Question 2 of 3')
    const first = pickQuestions([], 4)[0]
    expect(first).toBeDefined()
    for (const q of PROVE_QUESTIONS) if (q.id !== first?.id) expect(html).not.toContain(q.model.slice(0, 40))
    expect(html).not.toContain(first?.model.slice(0, 40) ?? 'x')
  })

  test('says it is self-graded practice, outside rings', () => {
    expect(render({ history: [], now: T })).toContain('counts as practice and stays outside your rings')
  })

  test('inside 24 h of the last attempt it waits and shows the last score', () => {
    const history = [{ at: iso(T - 2 * H), qids: ['free-both', 'too-big', 'zero-size'], score: 2 / 3 }]
    const html = render({ history, now: T })
    expect(html).toContain('data-prove="wait"')
    expect(html).toContain('2 of 3 got it')
    expect(html).toContain('22 h')
    expect(html).not.toContain('<textarea')
  })

  test('after 24 h a fresh set opens, without the questions already served', () => {
    const served = ['free-both', 'too-big', 'zero-size']
    const html = render({ history: [{ at: iso(T - 25 * H), qids: served, score: 1 }], now: T, seed: 9 })
    expect(html).toContain('data-prove="active"')
    const shown = [...html.matchAll(/data-qid="([a-z-]+)"/g)].map((m) => m[1])
    expect(shown).toHaveLength(1)
    expect(served).not.toContain(shown[0])
  })
})
