/**
 * The lesson-shape ratchet (Wave 1 stage 0, task K5-1): D3, D5, D8 and D10 measured over every lesson, today's violations
 * frozen in scripts/baselines/lesson-shape.json, and the analogy callout's new "where it breaks" field.
 */
import { describe, expect, test } from 'bun:test'
import { findings, formatReport, isEmpty, readBaseline, scanShape, stretches } from '../../scripts/verify-lesson-shape'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { ContentBlock } from '../../src/data/lessons/types'
import { blockToMd } from '../../scripts/export-lessons-md'

// the table the wave's report quotes
console.log(formatReport())

const lesson = (id: string) => {
  const l = ALL_LESSONS.find((x) => x.id === id)
  if (!l) throw new Error(`${id} not found`)
  return l
}

describe('the measurements', () => {
  test('words before the first activity and the longest activity-free stretch', () => {
    const s = stretches(lesson('t0.l1'))
    expect(s.first).toBe('predict')
    expect(s.beforeFirst).toBeGreaterThanOrEqual(0)
    expect(s.longest).toBeGreaterThan(s.beforeFirst)
  })

  test('a lesson whose first activity is the quiz is counted unless it is the exam or the retrieval opening', () => {
    const r = scanShape()
    expect(r.totals.noPredict).toBeGreaterThan(0)
    expect(r.totals.analogyNoBreaks).toBeGreaterThan(0)
    expect(r.rows.some((x) => x.lesson === 't2.l7' && x.rule === 'quiz-first')).toBe(false)
    expect(r.rows.some((x) => x.lesson === 't3.l1' && x.rule === 'quiz-first')).toBe(false)
  })
})

describe('the baseline ratchet', () => {
  test('the committed baseline matches the tree, and a new or worse row fails', () => {
    const scan = scanShape()
    expect(isEmpty(findings(readBaseline(), scan))).toBe(true)
    const worse = { ...scan, rows: [...scan.rows, { lesson: 't0.l1', rule: 'analogy-no-breaks', value: 99 }] }
    expect(findings(readBaseline(), worse).worse).toHaveLength(1)
  })

  test('a fixed row is stale until its line is removed, so the file only shrinks', () => {
    const scan = scanShape()
    const f = findings([...readBaseline(), { lesson: 't0.l1', rule: 'gone', value: 1 }], scan)
    expect(f.stale).toHaveLength(1)
  })

  test('the report prints the audit counts beside today\'s', () => {
    const report = formatReport()
    expect(report).toContain('lessons with no predict block')
    expect(report).toMatch(/39 \/ 39/)
    expect(report).toContain('quiz options over 25 words')
  })
})

describe('the analogy callout\'s breaks field', () => {
  test('an analogy with breaks exports a "Where it breaks" line; one without exports none', () => {
    const withBreaks: ContentBlock = { type: 'callout', variant: 'analogy', md: 'A JVM is an OS.', breaks: 'The JVM has no syscalls.' }
    const out = blockToMd(withBreaks, 't0.l1', 0, 0, 0)
    expect(out).toContain('**Where it breaks:** The JVM has no syscalls.')
    const without: ContentBlock = { type: 'callout', variant: 'analogy', md: 'A JVM is an OS.' }
    expect(blockToMd(without, 't0.l1', 0, 0, 0)).not.toContain('Where it breaks')
  })
})
