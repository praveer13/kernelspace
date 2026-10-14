/**
 * P3 content for T0-T2 (docs/specs/wave-3.md §11.2, task 3b-16): the ten panels that already had a `breaks` line on every pair
 * now carry a principle (at most 40 words), their lesson's KCs and a break item (four options, one key, a why for each), and
 * the quiz lures on t2.address-translation that take it for a block table or a prefix-cache key carry `confuse.<that KC>`.
 */
import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { IsomorphismBlock } from '../../src/data/lessons/types'

const PANELS: Record<string, number> = {
  't0.l1': 3, 't0.l5': 3, 't1.l2': 2, 't1.l3': 3, 't1.l6': 2, 't2.l1': 2, 't2.l2': 3, 't2.l3': 3, 't2.l4': 4, 't2.l7': 4,
}

const panelOf = (id: string) => {
  const lesson = ALL_LESSONS.find((l) => l.id === id)!
  const blocks = lesson.blocks.filter((b): b is IsomorphismBlock => b.type === 'isomorphism')
  return { lesson, blocks }
}

describe('the ten T0-T2 panels', () => {
  for (const [id, pairs] of Object.entries(PANELS)) {
    test(`${id}: ${pairs} pairs with breaks, a principle of at most 40 words, the lesson's KCs and a well-formed break item`, () => {
      const { lesson, blocks } = panelOf(id)
      expect(blocks).toHaveLength(1)
      const b = blocks[0]
      expect(b.pairs).toHaveLength(pairs)
      for (const p of b.pairs) expect(p.breaks?.length ?? 0).toBeGreaterThan(0)
      expect(b.principle).toBeTruthy()
      expect(b.principle!.trim().split(/\s+/).length).toBeLessThanOrEqual(40)
      expect(b.kcs).toEqual(lesson.kcs)
      const q = b.breakItem!
      expect(q.options).toHaveLength(4)
      expect(q.correct).toHaveLength(1)
      expect(q.why).toHaveLength(4)
      for (const w of q.why!) expect(w.trim().length).toBeGreaterThan(0)
      // The key says what a pair's own `breaks` line says; the three others are the statements that hold on both sides.
      expect(q.why![q.correct[0]].startsWith('Right:')).toBe(true)
      q.why!.forEach((w, i) => {
        if (i !== q.correct[0]) expect(w.startsWith('Holds on both sides')).toBe(true)
      })
    })
  }

  test('the key of a break item is never the longest option strictly (the iso pool ratchet baseline is 0)', () => {
    for (const id of Object.keys(PANELS)) {
      const q = panelOf(id).blocks[0].breakItem!
      const lens = q.options.map((o) => o.length)
      const max = Math.max(...lens)
      const longest = lens.flatMap((l, i) => (l === max ? [i] : []))
      expect(longest.length === 1 && longest[0] === q.correct[0]).toBe(false)
    }
  })
})

describe('confuse.<KC> lures (spec §11.2, §15.1)', () => {
  const CONFUSE = /^confuse\.(t5\.block-tables|t5\.prefix-cache-keys)$/
  const lures = (id: string) =>
    panelOf(id).lesson.blocks.flatMap((b) =>
      b.type === 'quiz'
        ? b.questions.flatMap((q) =>
            (q.kcs ?? []).includes('t2.address-translation') ? (q.miss ?? []).filter((m) => CONFUSE.test(m)) : [],
          )
        : [],
    )

  test('t2.l2 and t2.l7 each tag at least one lure on a t2.address-translation item, and together name both other KCs', () => {
    const l2 = lures('t2.l2')
    const l7 = lures('t2.l7')
    expect(l2.length).toBeGreaterThanOrEqual(1)
    expect(l7.length).toBeGreaterThanOrEqual(1)
    expect(new Set([...l2, ...l7])).toEqual(new Set(['confuse.t5.block-tables', 'confuse.t5.prefix-cache-keys']))
    expect(l2.length + l7.length).toBeGreaterThanOrEqual(2)
  })

  test('a tagged lure is never the key, and its why names the misconception', () => {
    for (const id of ['t2.l2', 't2.l7']) {
      for (const b of panelOf(id).lesson.blocks) {
        if (b.type !== 'quiz') continue
        for (const q of b.questions) {
          (q.miss ?? []).forEach((m, i) => {
            if (!CONFUSE.test(m)) return
            expect(q.correct).not.toContain(i)
            expect(q.why![i].startsWith('Misconception:')).toBe(true)
          })
        }
      }
    }
  })
})
