/**
 * K0-FIX-T2: the lane t2 fix round. One account per fact across the lane's lessons:
 * - Continuous batching re-decides the batch at every decode step; it has no quantum and time-slices nothing (t2.l4, t2.l7).
 * - Old ZGC multi-mapped the heap, so its colour bits sat inside the heap's address part; generational ZGC uses barrier
 *   code, so they need not (JEP 439, "No multi-mapped memory").
 * - About 1 KiB is the echo server's task (its buffer lives across the await), not every tokio task.
 * - The t2.l7 lesson keeps its "§5–6" heading, so the erratum does not list §5-6 among the wrong numbers.
 */
import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import paperErratum from '@/data/errata/2026-11-22-t2-l7-paper-figure-and-numbers'

const textOf = (id: string) => {
  const lesson = ALL_LESSONS.find((l) => l.id === id)
  if (!lesson) throw new Error(`${id} not found`)
  return JSON.stringify(lesson)
}

describe('continuous batching has one analogy: scheduling at step granularity, no quantum', () => {
  test('t2.l4 does not call it timesharing', () => {
    const t = textOf('t2.l4')
    expect(t).not.toContain('preemptive timesharing')
    expect(t).not.toContain('It is timesharing')
    expect(t).not.toContain('timeshared resource')
    expect(t).toContain('re-decides the batch at *iteration* granularity')
    expect(t).toContain('It is scheduling, finally applied to a GPU.')
  })

  test('t2.l7 does not make the iteration a quantum', () => {
    const t = textOf('t2.l7')
    expect(t).not.toContain('the iteration is the quantum')
    expect(t).not.toContain('It is a timesharing system')
    expect(t).toContain('the decode step is the scheduling boundary (not a quantum')
  })
})

describe('t2.l2 ZGC follows JEP 439', () => {
  test('under multi-mapping the colour bits sat inside the heap-address part of the pointer', () => {
    const t = textOf('t2.l2')
    expect(t).not.toContain('those bits sat outside the part of the pointer that addresses the heap')
    expect(t).toContain('three virtual address ranges, so its colour bits sat inside the part of the pointer that addresses the heap')
    expect(t).toContain('so its colour bits no longer need to be part of the heap')
  })
})

describe('t2.l6 Q3 is about the echo server task', () => {
  test('the stem does not state 1 KiB for every tokio task', () => {
    const t = textOf('t2.l6')
    expect(t).not.toContain('A suspended tokio task costs about 1 KiB')
    expect(t).toContain("The echo server's suspended task costs about 1 KiB instead of ~1 MiB because")
  })
})

describe('the t2.l7 paper erratum', () => {
  test('does not list the §5–6 heading the lesson keeps among the wrong section numbers', () => {
    expect(textOf('t2.l7')).toContain('## §5–6')
    expect(paperErratum.before).not.toMatch(/§5-6|§5–6/)
  })
})
