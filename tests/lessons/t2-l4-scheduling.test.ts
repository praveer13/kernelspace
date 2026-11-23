import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import { claimNumber } from '@/data/lessons/claims'

const lesson = ALL_LESSONS.find((l) => l.id === 't2.l4')
if (!lesson) throw new Error('t2.l4 not found')
const text = JSON.stringify(lesson)

describe('t2.l4 scheduling prose (K0-C38)', () => {
  test('the decode step is not "~50 ms", and the lesson cites the measured mean', () => {
    expect(text).not.toContain('~50 ms')
    const ms = (claimNumber('bench.ix-l70.h100-vllm-0-10-2-fp8.tp4.1024-1024.c4.tpot') * 1000).toFixed(1)
    expect(ms).toBe('11.8')
    expect(text).toContain(`${ms} ms per output token`)
  })

  test('continuous batching has no quantum and the batch is not a timeslice', () => {
    expect(text).not.toContain('the iteration is the quantum')
    expect(text).not.toContain('the decode step is the quantum')
    expect(text).not.toContain('The batch is the timeslice')
    expect(text).not.toContain('the batch is the timeslice')
    expect(text).not.toContain('the quantum = the decode iteration')
    expect(text).toContain('there is no quantum')
  })

  test("Little's Law is not blamed for unbounded queues", () => {
    expect(text).not.toContain("Little's Law is not a suggestion")
    expect(text).toContain('L = λW')
  })
})

/**
 * K0-CLOSE-G: one account in every lesson. Continuous batching re-decides the batch after each decode step; the step is
 * a scheduling boundary, not a timeslice or a quantum, and nothing is time-sliced (PagedAttention paper §2.3: "After each
 * iteration, completed requests are removed from the batch, and new ones are added"). The phrases the published course
 * used for the other account, in t2.l1, t2.l4, t2.l7 and t5.l7, must not come back in any lesson.
 */
describe('no lesson calls the batch a timeslice or the step a quantum (K0-CLOSE-G)', () => {
  const FORBIDDEN = [
    'the batch is the timeslice',
    'the iteration is the quantum',
    'the decode step is the quantum',
    'the quantum = the decode iteration',
    'the decode step plays the quantum',
    "timesharing system's quantum",
    'the quantum of work',
    'the quantum is small because',
    'the quantum can be this small',
    'the quantum is one model step',
    'into a timesharing system',
    'evictable state enables timesharing',
    'timesharing with hbm',
    'not an interchangeable time slice',
  ]

  for (const lesson of ALL_LESSONS) {
    test(`${lesson.id} keeps none of the quantum phrases`, () => {
      const t = JSON.stringify(lesson).toLowerCase()
      expect(FORBIDDEN.filter((phrase) => t.includes(phrase))).toEqual([])
    })
  }

  const textOf = (id: string) => {
    const l = ALL_LESSONS.find((x) => x.id === id)
    if (!l) throw new Error(`${id} not found`)
    return JSON.stringify(l)
  }

  test('t2.l1 and t5.l7 say the step is a scheduling boundary, and their errata quote what they now say', async () => {
    const l1 = (await import('@/data/errata/2026-11-23-t2-l1-no-timeslice')).default
    const l7 = (await import('@/data/errata/2026-11-23-t5-l7-no-quantum')).default
    expect(l1.lessons).toEqual(['t2.l1'])
    expect(l7.lessons).toEqual(['t5.l7'])
    expect(textOf('t2.l1')).toContain(l1.after)
    expect(textOf('t5.l7')).toContain(l7.after)
    expect(l1.after).toContain('scheduling boundary, not a timeslice')
    expect(l7.after).toContain('scheduling boundary, not a quantum')
  })
})
