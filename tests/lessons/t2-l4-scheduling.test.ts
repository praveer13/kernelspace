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
