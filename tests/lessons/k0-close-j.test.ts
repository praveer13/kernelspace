/**
 * K0-CLOSE-J: five correction cards this pull request wrote now say what their lessons say and no more.
 * - t5.l10 (Dynamo GA and NATS): the before holds only what the lesson said about GA and NATS; it no longer calls the
 *   KVBM removal target a course error (2026-11-21-dynamo-kvbm-removal-v1-7-0 records a change at the source).
 * - t4.l6 (FlashAttention): the after types no year or month for FlashAttention-3 or -4, as the lesson does not.
 * - t4.l3 (the 5 ms): the 5 ms is the floor of one decode step; at batch 1 it is the floor per token, and more tokens
 *   per weight read or fewer bytes per weight lower the time per token, not the step's floor.
 * - t7.l2 (knee and step 32): the goodput peak usually sits a little below Little's-law capacity, as the lesson says.
 * - t3.l4 (a task's state): the source is the Rust Reference at 1.96.0, which says the generated future stores the data
 *   needed to resume from each await point, not Docker's seccomp page.
 */
import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import dynamo from '@/data/errata/2026-11-22-t5-l10-dynamo-ga-and-nats'
import flash from '@/data/errata/2026-11-22-t4-l6-flashattention-after-2022'
import prefill from '@/data/errata/2026-11-22-t4-l3-prefill-ai-and-5ms-floor'
import knee from '@/data/errata/2026-11-23-t7-l2-knee-and-step-32'
import task from '@/data/errata/2026-11-23-t3-l4-task-state-is-its-live-locals'

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const text = (id: string): string => {
  const l = ALL_LESSONS.find((x) => x.id === id)
  if (!l) throw new Error(`${id} not found`)
  return strings(l.blocks).join('\n')
}

describe('t5.l10: the Dynamo GA and NATS card does not contradict the KVBM card', () => {
  test('its before says nothing of KVBM and quotes only what t5.l10 said about GA and NATS', () => {
    expect(dynamo.before).not.toContain('KVBM')
    expect(dynamo.before).not.toContain('given wrongly')
    expect(dynamo.before).toBe(
      'The Dynamo paragraph said it "went GA (v1.3)", and the trade-offs said Dynamo comes "with NATS, etcd, and transfer fabric of its own".',
    )
  })
})

describe('t4.l6: the FlashAttention card types no date the lesson removed', () => {
  test('its after names FlashAttention-3 and -4 as the lesson does, with no year or month', () => {
    const lesson = text('t4.l6')
    expect(flash.after).not.toMatch(/\b(?:19|20)\d{2}\b/)
    expect(flash.after).not.toMatch(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/)
    for (const part of [
      'FlashAttention-3 targets Hopper; FlashAttention-4 targets Blackwell',
      'FlashAttention-4 targets Blackwell, where tensor-core throughput doubles while shared-memory bandwidth and exponential units scale more slowly',
      'It still rests on the same blocking.',
    ])
      expect(flash.after).toContain(part)
    expect(lesson).toContain("targets Hopper's asynchronous copies and Tensor Cores")
    expect(lesson).toContain('targets Blackwell, where tensor-core throughput doubles while shared-memory bandwidth and exponential units scale more slowly')
    expect(lesson).toContain('It still rests on the same blocking.')
    expect(flash.after.length).toBeLessThanOrEqual(240)
  })
})

describe('t4.l3: the 5 ms is the floor of one step; more tokens per weight read lower the time per token', () => {
  test('the card says what the caption says', () => {
    const lesson = text('t4.l3')
    expect(lesson).toContain('At batch 1 that is the floor per token, which only more tokens per weight read')
    for (const field of [prefill.title, prefill.after]) {
      expect(field).not.toContain('per-step floor that only more tokens per weight read')
      expect(field).not.toContain('only more tokens per weight read or fewer bytes lower it')
    }
    expect(prefill.after).toContain('each decode step of an 8B FP16 model (16 GB of weights) takes at least about 5 ms')
    expect(prefill.after).toContain('takes at least about 5 ms, the floor per token at batch 1; only more tokens per weight read or fewer bytes per weight lower that.')
    expect(prefill.title).toContain('the 5 ms is the floor of one decode step, and at batch 1 the floor per token')
    expect(prefill.title.length).toBeLessThanOrEqual(240)
    expect(prefill.after.length).toBeLessThanOrEqual(240)
  })
})

describe("t7.l2: the goodput peak usually sits a little below Little's-law capacity", () => {
  test("the card says 'usually', as the lesson does", () => {
    expect(text('t7.l2')).toContain('peaks near the load that reaches it, usually a little below')
    expect(knee.why).toContain("which usually sits a little below Little's-law capacity")
    expect(knee.why).not.toMatch(/which sits below/)
    expect(knee.why.trim().split(/\s+/).length).toBeLessThanOrEqual(40)
  })
})

describe("t3.l4: the task-size card cites the Rust Reference's async-block layout note", () => {
  test('its source is the Reference at 1.96.0, not the seccomp page', () => {
    expect(task.source?.url).toBe('https://doc.rust-lang.org/1.96.0/reference/expressions/block-expr.html#r-expr.block.async.layout-unspecified')
    expect(task.source?.url).not.toContain('docker')
    expect(task.source?.title).toBe('The Rust Reference, Rust 1.96.0: Block expressions, async blocks')
  })
})
