import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'

// K0-C10: t3.l2 states a host clone in milliseconds, names no NATS, and its slab listing ties the view to a borrowed owner.

const lesson = ALL_LESSONS.find((l) => l.id === 't3.l2')
if (!lesson) throw new Error('t3.l2 not found')

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const text = strings(lesson.blocks).join('\n')
const slab = lesson.blocks.find(
  (b) => b.type === 'code' && b.filename.startsWith('unsafe_slab.rs'),
)
if (!slab || slab.type !== 'code') throw new Error('unsafe_slab.rs listing not found')

describe('t3.l2 zero-copy', () => {
  test('a 100 MiB clone is not 30 microseconds and NATS is not named', () => {
    expect(text).not.toMatch(/30\s*µs/)
    expect(text).not.toContain('NATS')
    expect(text).toContain('tens of milliseconds')
  })
  test('the slab view borrows a Mapping instead of an unbounded raw constructor', () => {
    expect(slab.code).toContain("PhantomData<&'a Mapping>")
    expect(slab.code).toContain("pub fn view(&self) -> SlabView<'_>")
    expect(slab.code).not.toContain('pub unsafe fn new(base')
    expect(slab.code).not.toContain('&self proves no conflicting')
  })
  test('the safety contract forbids writers during the view', () => {
    expect(slab.code).toMatch(/no process writes that range/)
    expect(slab.chips ?? []).not.toContain('PhantomData ties lifetimes')
  })
})
