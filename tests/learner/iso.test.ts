/**
 * P3's pure side (docs/specs/wave-3.md §11.1; task 3b-07): the align rows, their grade, the work row that is shown and
 * never graded, and the two ledger events. What the panel draws is tests/lesson/isomorphism.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { collectIsoItems } from '../../scripts/item-pools'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { ContentBlock, IsomorphismBlock } from '../../src/data/lessons/types'
import { gradeItem, playView, resultFor } from '../../src/lib/items/play'
import {
  alignRef,
  alignResponse,
  alignRows,
  alignRev,
  backgroundOf,
  breakItem,
  breakRef,
  breakResponse,
  gradeAlign,
  isActive,
  isoKcs,
  isoNumber,
  labelsOf,
  shuffledLabels,
  workApplies,
} from '../../src/lib/learner/iso'
import { BACKGROUNDS } from '../../src/lib/ledger/constants'
import { validateEvent } from '../../src/lib/ledger/codec'
import type { Background, LedgerEvent } from '../../src/lib/ledger/types'

const BREAK: QuizQuestion = {
  q: 'Where does this analogy break?',
  options: ['the table is hardware', 'both are maps', 'both are lazy', 'both are shared'],
  correct: [0],
  why: ['A true break.', 'Holds on both sides.', 'Holds on both sides.', 'Holds on both sides.'],
}

const block = (extra: Partial<IsomorphismBlock> = {}): IsomorphismBlock => ({
  type: 'isomorphism',
  title: 'fixture',
  pairs: [
    { os: 'page table', osLine: 'Per-process map.', llm: 'block table', llmLine: 'Per-sequence map.', breaks: 'hardware walks one' },
    { os: 'frame', osLine: 'A physical unit.', llm: 'KV block', llmLine: 'A KV unit.' },
    {
      os: 'swap',
      osLine: 'Spill to disk.',
      llm: 'preemption',
      llmLine: 'Free and recompute.',
      work: { backgrounds: ['jvm', 'backend'], os: 'connection pool', osLine: 'Reuse connections.', breaks: 'a connection returns whole' },
    },
  ],
  principle: 'Same mechanism, different cost model.',
  breakItem: BREAK,
  kcs: ['kc.a', 'kc.b'],
  ...extra,
})

const prose = (md = 'x'): ContentBlock => ({ type: 'prose', md })

describe('numbering and refs', () => {
  test('n counts the lesson\'s isomorphism blocks from 1, those without a break item too', () => {
    const a = block({ breakItem: undefined })
    const b = block()
    const c = block()
    const lesson = { blocks: [prose(), a, prose(), b, c] }
    expect([a, b, c].map((x) => isoNumber(lesson, x))).toEqual([1, 2, 3])
    expect(isoNumber({ blocks: [prose()] }, a)).toBe(0)
  })

  test('the refs are the ones the gates collect', () => {
    const lesson = { id: 't9.l1', kcs: ['kc.lesson'], blocks: [block({ breakItem: undefined }), block({ kcs: undefined })] }
    const pool = collectIsoItems([lesson as never])
    expect(pool.map((p) => p.ref)).toEqual([breakRef('t9.l1', isoNumber(lesson, lesson.blocks[1] as IsomorphismBlock))])
    expect(alignRef('t2.l2', 1)).toBe('item:t2.l2.iso.1')
    expect(breakRef('t2.l2', 1)).toBe('item:t2.l2.iso.1.break')
    expect(pool[0].kcs).toEqual(['kc.lesson'])
  })

  test('a block is active only with a break item, and its KCs are its own else the lesson\'s, at most 6', () => {
    expect(isActive(block())).toBe(true)
    expect(isActive(block({ breakItem: undefined }))).toBe(false)
    expect(isoKcs({ kcs: ['kc.a'] }, ['kc.l'])).toEqual(['kc.a'])
    expect(isoKcs({}, ['kc.l'])).toEqual(['kc.l'])
    expect(isoKcs({}, undefined)).toEqual([])
    expect(isoKcs({}, Array.from({ length: 9 }, (_, i) => `kc.${i}`))).toHaveLength(6)
  })

  test('the background reads one of the six values and nothing else', () => {
    for (const b of BACKGROUNDS) expect(backgroundOf(b)).toBe(b)
    for (const v of [undefined, null, '', 'JVM', 'dba', 3, {}]) expect(backgroundOf(v)).toBeNull()
  })
})

describe('the rows', () => {
  test('one base row per pair, in pair order, with no work row unless the background matches', () => {
    const b = block()
    for (const bg of [null, 'sre', 'ml', 'student', 'other'] as (Background | null)[]) {
      const rows = alignRows(b, bg)
      expect(rows.map((r) => [r.id, r.os, r.llm, r.work])).toEqual([
        ['p0', 'page table', 'block table', false],
        ['p1', 'frame', 'KV block', false],
        ['p2', 'swap', 'preemption', false],
      ])
    }
  })

  test('a matching background adds the work row right after its pair; its right label is the pair\'s', () => {
    const b = block()
    for (const bg of ['jvm', 'backend'] as const) {
      const rows = alignRows(b, bg)
      expect(rows.map((r) => r.id)).toEqual(['p0', 'p1', 'p2', 'w2'])
      const w = rows[3]
      expect(w).toMatchObject({ work: true, pair: 2, os: 'connection pool', osLine: 'Reuse connections.', llm: 'preemption', llmLine: 'Free and recompute.', breaks: 'a connection returns whole' })
    }
    expect(workApplies(b.pairs[2], 'jvm')).toBe(true)
    expect(workApplies(b.pairs[2], 'sre')).toBe(false)
    expect(workApplies(b.pairs[2], null)).toBe(false)
    expect(workApplies(b.pairs[0], 'jvm')).toBe(false)
  })

  test('the choices are the pairs\' distinct llm labels', () => {
    expect(labelsOf(block())).toEqual(['block table', 'KV block', 'preemption'])
    const dup = block({ pairs: [...block().pairs, { os: 'x', osLine: 'x', llm: 'KV block', llmLine: 'x' }] })
    expect(labelsOf(dup)).toEqual(['block table', 'KV block', 'preemption'])
  })

  test('the shuffle is a permutation, the same for a seed, and never the authored order', () => {
    const b = block()
    const authored = labelsOf(b)
    const seen = new Set<string>()
    for (let seed = 0; seed < 300; seed++) {
      const order = shuffledLabels(b, seed)
      expect([...order].sort()).toEqual([...authored].sort())
      expect(order).not.toEqual(authored)
      expect(shuffledLabels(b, seed)).toEqual(order)
      seen.add(order.join('|'))
    }
    expect(seen.size).toBe(5) // 3! = 6 orders, minus the authored one
    const one = block({ pairs: [b.pairs[0]] })
    expect(shuffledLabels(one, 1)).toEqual(['block table'])
  })
})

describe('grading: base rows only', () => {
  const b = block()
  const right = { p0: 'block table', p1: 'KV block', p2: 'preemption' }

  test('all base rows right is ok with score 1; each miss costs 1 ÷ base rows', () => {
    const rows = alignRows(b, null)
    expect(gradeAlign(rows, right)).toMatchObject({ right: 3, base: 3, score: 1, ok: true, complete: true })
    const one = gradeAlign(rows, { ...right, p1: 'preemption' })
    expect(one).toMatchObject({ right: 2, base: 3, ok: false, complete: true })
    expect(one.score).toBeCloseTo(2 / 3, 12)
    expect(gradeAlign(rows, { p0: 'KV block', p1: 'preemption', p2: 'block table' })).toMatchObject({ right: 0, score: 0, ok: false })
  })

  test('an unanswered row is incomplete and not right', () => {
    const g = gradeAlign(alignRows(b, null), { p0: 'block table' })
    expect(g.complete).toBe(false)
    expect(g.rows.map((v) => [v.picked, v.right])).toEqual([['block table', true], [null, false], [null, false]])
    expect(gradeAlign(alignRows(b, null), {}).right).toBe(0)
  })

  test('a work row is never in the score: right or wrong, the grade is the same as without it', () => {
    const plain = gradeAlign(alignRows(b, null), right)
    for (const w of ['preemption', 'block table', 'KV block']) {
      const g = gradeAlign(alignRows(b, 'jvm'), { ...right, w2: w })
      expect({ right: g.right, base: g.base, score: g.score, ok: g.ok }).toEqual({ right: plain.right, base: plain.base, score: plain.score, ok: plain.ok })
      expect(g.rows.find((v) => v.id === 'w2')).toMatchObject({ graded: false, right: w === 'preemption' })
    }
    const missed = { ...right, p0: 'KV block' }
    const a = gradeAlign(alignRows(b, null), missed)
    const c = gradeAlign(alignRows(b, 'jvm'), { ...missed, w2: 'preemption' })
    expect([c.right, c.base, c.score, c.ok]).toEqual([a.right, a.base, a.score, a.ok])
  })

  test('a work row left empty keeps the step incomplete (it gets its feedback), but not the score', () => {
    const g = gradeAlign(alignRows(b, 'jvm'), right)
    expect(g.complete).toBe(false)
    expect(g.score).toBe(1)
  })
})

describe('the align event', () => {
  const b = block()
  const picks = { p0: 'block table', p1: 'preemption', p2: 'preemption' }
  const event = (bg: Background | null, extra: Record<string, string> = {}) =>
    alignResponse('t2.l2', 1, b, ['kc.lesson'], gradeAlign(alignRows(b, bg), { ...picks, ...extra }), { seed: 4_000_000_000, ms: 1234.6 })

  test('item:<lesson>.iso.<n>, src lesson, the block\'s KCs, score right ÷ base rows, the authored label index per base row', () => {
    const e = event(null)
    expect(e).toMatchObject({ kind: 'item', ref: 'item:t2.l2.iso.1', ok: false, seed: 4_000_000_000, ms: 1235 })
    expect(e.score).toBeCloseTo(2 / 3, 12)
    expect(e.rev).toBe(alignRev(b))
    expect(e.data).toEqual({ src: 'lesson', pick: [0, 2, 2], lessonId: 't2.l2', kcs: ['kc.a', 'kc.b'], nsec: 45 })
    expect(event(null, { p1: 'KV block' }).ok).toBe(true)
  })

  test('the lesson\'s KCs stand in when the block names none', () => {
    const e = alignResponse('t2.l2', 2, { ...b, kcs: undefined }, ['kc.lesson'], gradeAlign(alignRows(b, null), picks), { seed: 1, ms: 5 })
    expect((e.data as { kcs: string[] }).kcs).toEqual(['kc.lesson'])
    expect(e.ref).toBe('item:t2.l2.iso.2')
  })

  test('two learners with the same base picks write the same event whatever their background or work answer', () => {
    const base = event(null)
    for (const bg of BACKGROUNDS) {
      for (const w of [undefined, 'preemption', 'KV block']) {
        const rows = alignRows(b, bg)
        const e = alignResponse('t2.l2', 1, b, ['kc.lesson'], gradeAlign(rows, { ...picks, ...(w && rows.some((r) => r.work) ? { w2: w } : {}) }), { seed: 4_000_000_000, ms: 1234.6 })
        expect(e).toEqual(base)
      }
    }
  })

  test('the codec accepts the event', () => {
    const e = event(null)
    const at = '2026-10-14T12:00:00.000Z'
    const ev = { id: 'e1', v: 1, kind: e.kind, ref: e.ref, at, tz: 0, day: '2026-10-14', dev: 'd1', rev: e.rev, score: e.score, ok: e.ok, provenance: 'practice', seed: e.seed, ms: e.ms, data: e.data }
    const checked = validateEvent(ev)
    expect(checked.ok ? '' : checked.error).toBe('')
    const bad = validateEvent({ ...ev, ref: 'lesson:t2.l2' })
    expect(bad.ok).toBe(false)
    expect((checked.ok ? checked.value : ({} as LedgerEvent)).ref).toBe('item:t2.l2.iso.1')
  })
})

describe('the break event', () => {
  const b = block()

  test('the item is item:<lesson>.iso.<n>.break under the block\'s KCs, and the response records src lesson, the pick and the miss id', () => {
    const q: QuizQuestion = { ...BREAK, miss: ['', 'confuse.kc.a', '', ''] }
    const item = breakItem('t2.l2', 1, b, q, ['kc.lesson'])
    expect(item).toEqual({ source: 'item', item: { id: 't2.l2.iso.1.break', q, kcs: ['kc.a', 'kc.b'] } })
    expect(playView(item, 3).ref).toBe('item:t2.l2.iso.1.break')
    const pickLure = { kind: 'choice' as const, picks: [String(q.options.indexOf(q.options[1]))] }
    const wrong = breakResponse('t2.l2', resultFor(item, pickLure, gradeItem(item, pickLure), { seed: 3, ms: 900 }))
    expect(wrong).toMatchObject({ kind: 'item', ref: 'item:t2.l2.iso.1.break', ok: false, score: 0, seed: 3, ms: 900 })
    expect(wrong.data).toMatchObject({ src: 'lesson', pick: [1], lessonId: 't2.l2', kcs: ['kc.a', 'kc.b'], miss: 'confuse.kc.a' })
    const key = { kind: 'choice' as const, picks: ['0'] }
    const right = breakResponse('t2.l2', resultFor(item, key, gradeItem(item, key), { seed: 3, ms: 900 }))
    expect(right).toMatchObject({ ok: true, score: 1 })
    expect((right.data as { miss?: string }).miss).toBeUndefined()
  })
})

describe('the lessons as they stand', () => {
  test('every block that asks the break question is numbered like the gates number it', () => {
    const pool = collectIsoItems(ALL_LESSONS)
    for (const lesson of ALL_LESSONS) {
      const refs = pool.filter((p) => p.lessonId === lesson.id).map((p) => p.ref)
      const mine = lesson.blocks.filter((x): x is IsomorphismBlock => x.type === 'isomorphism' && x.breakItem !== undefined)
      expect(mine.map((x) => breakRef(lesson.id, isoNumber(lesson, x)))).toEqual(refs)
    }
  })
})
