import { describe, expect, test } from 'bun:test'
import erratum from '@/data/errata/2026-11-22-t3-l4-toy-executor-compiles'
import { ALL_LESSONS } from '@/data/lessons'

// K0-B2: the t3.l4 toy executor listing compiles (a pinned boxed future, std Wake), waits on a Condvar without
// holding the queue lock, and has a wake path. The listing was compiled and run by hand; this holds its shape.

const lesson = ALL_LESSONS.find((l) => l.id === 't3.l4')
const blocks = lesson?.blocks ?? []
const code = blocks.filter((b) => b.type === 'code' && b.lang === 'rust')

describe('t3.l4 toy executor listing', () => {
  test('has exactly one rust listing', () => {
    expect(code.length).toBe(1)
  })
  const src = String((code[0] as { code?: string } | undefined)?.code ?? '')
  test('pins the future and wakes through std Wake', () => {
    expect(src).toContain('Pin<Box<dyn Future')
    expect(src).toContain('impl Wake for Task')
    expect(src).toContain('Waker::from(task.clone())')
  })
  test('waits on a Condvar and never parks the thread', () => {
    expect(src).not.toContain('thread::park')
    expect(src).toContain('ready.wait(q)')
    expect(src).toContain('ready.notify_one()')
  })
  test('has a leaf future whose helper thread wakes it', () => {
    expect(src).toContain('impl Future for Sleep')
    expect(src).toContain('waker.wake()')
    expect(src).toContain('use std::thread;')
  })
  test('chips and prose name the Condvar wait', () => {
    const chips = (code[0] as { chips?: string[] }).chips ?? []
    expect(chips).toContain('Condvar wait between events')
    expect(JSON.stringify(blocks)).not.toContain('parks its thread')
  })
})

describe('t3.l4 erratum', () => {
  test('is published for t3.l4 as an error', () => {
    expect(erratum.kind).toBe('error')
    expect(erratum.lessons).toEqual(['t3.l4'])
  })
})

describe('t3.l4 lab paragraph', () => {
  test('keeps the Build this callout and names the lab differences', () => {
    const md = JSON.stringify(blocks)
    expect(md).toContain('/forge/toy-executor')
    expect(md).toContain('single-threaded shape')
    expect(md).toContain('not counted as a poll')
  })
})
