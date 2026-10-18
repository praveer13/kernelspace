/**
 * The lesson exporter's Wave 3 blocks (docs/specs/wave-3.md §2.3, task 3a-03): a Fleet exercise prints its title and
 * "run it in the lesson", an isomorphism pair prints where it breaks, the principle follows, and a break item prints
 * its options without the key. A lesson with no breaks, principle or fleet block exports as it did. A protégé block
 * (§16.9) never names its false sentence, by number or by text, outside the passage and the find's options.
 * scripts/export-lessons-md.ts writes files only when it is run as a script, so importing it here writes nothing.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { blockToMd, lessonToMd, PROTEGE_EXPORT_STEM } from '../../scripts/export-lessons-md'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { FleetExerciseBlock, IsomorphismBlock, ProtegeBlock } from '../../src/data/lessons/types'
import { protegeNumber, sentenceLabel, stepQuestion } from '../../src/lib/learner/protege'

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

describe('protégé blocks never give away the find', () => {
  const blocks = ALL_LESSONS.flatMap((l) => l.blocks.filter((b): b is ProtegeBlock => b.type === 'protege').map((b) => ({ l, b })))
  const ORDINAL = /\b(first|second|third|fourth|fifth|sixth)\s+(sentence|line)\b/i
  /** The export below the passage, without the find's options (one per offered sentence number, each named once). */
  const below = (md: string) => md.split('_One sentence above is false._')[1].replace(/^- \(o\d\) Sentence \d$/gm, '')

  test('the shipped lessons hold protégé blocks, and some authored fix stems name the false sentence (so the check bites)', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(9)
    expect(blocks.some(({ b }) => stepQuestion(b, 'fix').q.includes(`sentence ${b.falseAt + 1}`))).toBe(true)
  })

  test('tag and fix ask a fixed stem that names no sentence', () => {
    for (const q of Object.values(PROTEGE_EXPORT_STEM)) {
      expect(q).not.toMatch(/\d/)
      expect(q).not.toMatch(ORDINAL)
    }
    expect(PROTEGE_EXPORT_STEM.fix).toBe('Which sentence should replace the false one?')
  })

  test('no block names the false line by number or text outside the passage and the find options', () => {
    for (const { l, b } of blocks) {
      const md = lessonToMd(l)
      const n = protegeNumber(l, b)
      const own = md.split(`**${b.title}**`)[1].split('\n\n---\n\n')[0]
      const rest = below(own)
      const falseLine = b.sentences[b.falseAt].trim()
      expect(md.split(falseLine).length - 1, `${l.id} #${n}: the false line appears once, in the passage`).toBe(1)
      expect(rest, `${l.id} #${n}`).not.toMatch(/\b(sentence|line)s?\s+\d/i)
      expect(rest, `${l.id} #${n}`).not.toMatch(ORDINAL)
      expect(rest).toContain(`**Fix. ${PROTEGE_EXPORT_STEM.fix}**`)
      expect(rest).toContain(`**Tag. ${PROTEGE_EXPORT_STEM.tag}**`)
      // every offered sentence number is printed once, so none is singled out
      for (const i of b.find.offer) expect(own.match(new RegExp(`^- \\(o\\d\\) ${sentenceLabel(i)}$`, 'gm'))).toHaveLength(1)
    }
  })

  test('the export does not depend on which sentence is false, nor on the authored tag and fix stems', () => {
    for (const { l, b } of blocks) {
      const md = blockToMd(b, l.id, 0, 0, 0, 0, 0)
      for (const i of b.find.offer) expect(blockToMd({ ...b, falseAt: i }, l.id, 0, 0, 0, 0, 0)).toBe(md)
      const restemmed = { ...b, tag: { ...b.tag, q: 'Which idea is behind sentence 1?' }, fix: { ...b.fix, q: 'What replaces sentence 1?' } }
      expect(blockToMd(restemmed, l.id, 0, 0, 0, 0, 0)).toBe(md)
    }
  })
})
