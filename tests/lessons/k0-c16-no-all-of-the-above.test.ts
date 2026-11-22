import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'

// K0-C16: Rust catches temporal bugs and data races at compile time; bounds are checked at run time and Rc cycles leak.

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

describe('t1.l6 does not claim Rust catches everything at compile time', () => {
  test('"all of the above, caught at compile time" occurs in no lesson', () => {
    for (const l of ALL_LESSONS)
      for (const t of strings(l)) expect(t.toLowerCase()).not.toContain('all of the above, caught at compile time')
  })
  test('t1.l6 names run-time bounds checks and does not call its 70% a Microsoft and Google figure', () => {
    const l = ALL_LESSONS.find((x) => x.id === 't1.l6')!
    const text = strings(l).join('\n')
    expect(text).toContain('checked at run time')
    expect(text).toContain('Chromium')
    expect(text).not.toContain('Microsoft and Google have both published')
    expect(text).not.toContain('zero runtime cost')
  })
})
