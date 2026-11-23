/**
 * K0-CLOSE-I: T3.L4's figure gives a task the size T2.L6 and its erratum give (its live locals, about 1 KiB for the
 * echo task), and T4.L5's Q1 explanation no longer calls gid.x the index across the dispatch, which the lesson's own
 * 2-D vec_add listing contradicts. Q1's stem, options and key stay as they were, so saved answers keep.
 * The figure's fit is held by tests/lessons/diagram-fit.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { lessonById } from '@/data/lessons'
import type { DiagramBlock } from '@/data/lessons/types'
import t2l6Erratum from '@/data/errata/2026-11-22-t2-l6-task-size-and-io-uring'
import t3l4Erratum from '@/data/errata/2026-11-23-t3-l4-task-state-is-its-live-locals'

const rendered = (id: string) => JSON.stringify(lessonById(id)).replace(/\\n/g, ' ')

function find<T>(v: unknown, pred: (o: Record<string, unknown>) => boolean, out: T[] = []): T[] {
  if (Array.isArray(v)) for (const x of v) find(x, pred, out)
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (pred(o)) out.push(o as unknown as T)
    else for (const x of Object.values(o)) find(x, pred, out)
  }
  return out
}

describe('t3.l4: a task is as big as its live locals, as t2.l6 says', () => {
  const fig = find<DiagramBlock>(lessonById('t3.l4'), (o) => o.type === 'diagram' && Array.isArray(o.nodes)).find(
    (d) => d.caption.startsWith('fig 1'),
  )
  test('the figure no longer says ~300 B', () => {
    expect(rendered('t3.l4')).not.toContain('300 B')
  })
  test("step 4's caption ends with what the erratum's after says", () => {
    const last = fig?.steps?.[3]?.caption ?? ''
    expect(last.endsWith(t3l4Erratum.after)).toBe(true)
  })
  test('t2.l6 and its erratum give the same account', () => {
    expect(t2l6Erratum.after).toContain('A task holds the locals live across its awaits')
    expect(rendered('t2.l6')).toContain('about 1 KiB for the echo server below, because its read buffer lives inside it')
    expect(t3l4Erratum.lessons).toEqual(['t3.l4'])
    // K0-CLOSE-J: the t2.l6 erratum's seccomp page backs its io_uring half only; the task's state is the Rust Reference's.
    expect(t3l4Erratum.source?.url).toBe('https://doc.rust-lang.org/1.96.0/reference/expressions/block-expr.html#r-expr.block.async.layout-unspecified')
  })
})

describe('t4.l5 Q1: gid.x is the index across the dispatch only on a 1-D grid', () => {
  type Q = { q: string; options: string[]; correct: number[]; explanation: string; why: string[] }
  const q1 = find<Q>(lessonById('t4.l5'), (o) => typeof o.q === 'string' && o.q.includes('global_invocation_id) gid.x'))[0]
  test('the listing it explains is 2-D', () => {
    const r = rendered('t4.l5')
    expect(r).toContain('let i = gid.y * (nwg.x * 256u) + gid.x;')
    expect(r).toContain('dispatchWorkgroups(256, 256)')
  })
  test('the explanation and the why say so', () => {
    expect(q1.explanation).not.toContain('flattened global index')
    expect(q1.explanation).toContain('On a 1-D grid gid.x is the index across the dispatch; on a 2-D dispatch the index joins gid.y and gid.x, as the listing does.')
    expect(q1.why[1]).not.toContain('unique position across the dispatch')
    expect(q1.why[1]).toContain("the listing's 2-D dispatch repeats each gid.x once per gid.y")
  })
  test('the stem, options and key are unchanged, so saved answers keep', () => {
    expect(q1.q).toBe('In WGSL, @builtin(global_invocation_id) gid.x corresponds to which CUDA expression?')
    expect(q1.options[1]).toBe(
      'blockIdx.x * blockDim.x + threadIdx.x as the index of the invocation across the whole dispatch',
    )
    expect(q1.options).toHaveLength(4)
    expect(q1.correct).toEqual([1])
  })
})
