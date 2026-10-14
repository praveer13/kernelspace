/**
 * The lesson exporter's Wave 3 blocks (docs/specs/wave-3.md §2.3, task 3a-03): a Fleet exercise prints its title and
 * "run it in the lesson", an isomorphism pair prints where it breaks, the principle follows, and a break item prints
 * its options without the key. A lesson with no breaks, principle or fleet block exports as it did.
 * scripts/export-lessons-md.ts writes files only when it is run as a script, so importing it here writes nothing.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { blockToMd, lessonToMd } from '../../scripts/export-lessons-md'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { FleetExerciseBlock, IsomorphismBlock } from '../../src/data/lessons/types'

const root = join(import.meta.dir, '../..')
const lesson = (id: string) => ALL_LESSONS.find((l) => l.id === id)!

describe('fleet exercise blocks', () => {
  const fleet: FleetExerciseBlock = { type: 'exercise', fleet: 'knee', title: 'Find the knee', note: 'goodput peaks at 1.25x' }

  test('print the title and "run it in the lesson", and keep the note, which explains the sweep, in the lesson', () => {
    const md = blockToMd(fleet, 't7.l2', 0, 0, 0)
    expect(md).toContain('**Exercise: Find the knee**')
    expect(md.toLowerCase()).toContain('run it in the lesson')
    expect(md).toContain('/lesson/t7.l2')
    expect(md).not.toContain('goodput peaks')
  })

  test('a sim exercise block still prints its numbered tasks and its note', () => {
    const md = blockToMd({ type: 'exercise', simId: 'sim-kv', title: 'Pages', tasks: ['first', 'second'], note: 'why' }, 't5.l2', 0, 0, 0)
    expect(md).toBe('**Exercise: Pages**\n\n1. first\n2. second\n\n_why_')
  })
})

describe('isomorphism blocks', () => {
  const pair = { os: 'page', osLine: 'fixed unit', llm: 'KV block', llmLine: 'fixed unit of KV' }
  const key = 'KEYWORD-the-correct-option'
  const block: IsomorphismBlock = {
    type: 'isomorphism',
    title: 'paging, twice',
    pairs: [pair, { ...pair, os: 'swap', breaks: 'disk is slower than host memory' }],
    principle: 'Fixed-size units remove external fragmentation.',
    breakItem: {
      q: 'Where does the page analogy break?',
      options: ['wrong one', key, 'wrong two'],
      correct: [1],
      explanation: 'EXPLANATION-that-names-the-key',
    },
  }

  test('a pair without a break exports exactly as before', () => {
    const md = blockToMd({ type: 'isomorphism', title: 't', pairs: [pair] }, 'x.l1', 0, 0, 0)
    expect(md).toBe('_t_\n\n- **page** (fixed unit) ≡ **KV block** (fixed unit of KV)')
  })

  test('a pair with a break gains a "where it breaks" line under it, and the principle follows the pairs', () => {
    const md = blockToMd({ ...block, breakItem: undefined }, 'x.l1', 0, 0, 0)
    expect(md).toContain(
      '- **swap** (fixed unit) ≡ **KV block** (fixed unit of KV)\n  - where it breaks: disk is slower than host memory',
    )
    expect(md.split('where it breaks').length - 1).toBe(1)
    expect(md.endsWith('\n\n**Principle:** Fixed-size units remove external fragmentation.')).toBe(true)
  })

  test('a break item prints its stem and its options as o1..o3 and withholds the key and the explanation', () => {
    const md = blockToMd(block, 'x.l1', 0, 0, 0)
    expect(md).toContain('**Where does it break? Where does the page analogy break?**')
    for (const o of ['(o1)', '(o2)', '(o3)']) expect(md).toContain(o)
    for (const text of ['wrong one', key, 'wrong two']) expect(md).toContain(text)
    expect(md).not.toContain('EXPLANATION')
    expect(md).toContain('Answers withheld')
  })

  test('the option order is fixed per lesson and per break item, and does not read as authored order', () => {
    const a = blockToMd(block, 'x.l1', 0, 0, 0, 0)
    expect(blockToMd(block, 'x.l1', 0, 0, 0, 0)).toBe(a)
    const orders = new Set(Array.from({ length: 12 }, (_, i) => blockToMd(block, 'x.l1', 0, 0, 0, i)))
    expect(orders.size).toBeGreaterThan(1)
  })
})

describe('the committed export', () => {
  test('a T2 pair with a break is pinned to its exported line', () => {
    const md = lessonToMd(lesson('t2.l1'))
    expect(md).toContain(
      '- **context switch** (Save/restore state per thread; cache+TLB warmth is the hidden cost.) ≡ **sequence preemption** (vLLM pauses a sequence by evicting its KV; resuming recomputes or reloads it.)\n' +
        '  - where it breaks: A thread switch saves a few hundred bytes of registers; preempting a sequence offloads or regenerates megabytes to gigabytes of KV, so it is rarer and far costlier.',
    )
  })

  test('public/lessons-md is what the exporter writes, for every lesson', () => {
    for (const l of ALL_LESSONS) expect(readFileSync(join(root, 'public/lessons-md', `${l.id}.md`), 'utf8')).toBe(lessonToMd(l))
  })

  test('only isomorphism blocks with breaks add lines: a lesson with none carries no where-it-breaks text', () => {
    const withBreaks = ALL_LESSONS.filter((l) => l.blocks.some((b) => b.type === 'isomorphism' && b.pairs.some((p) => p.breaks)))
    for (const l of ALL_LESSONS) {
      const has = lessonToMd(l).includes('where it breaks')
      expect(has).toBe(withBreaks.includes(l))
    }
  })
})
