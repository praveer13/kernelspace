import { describe, expect, test } from 'bun:test'
import { claimNumber } from '@/data/lessons/claims'
import { ALL_LESSONS } from '@/data/lessons'

// K0-B4: a C ABI selects for free C interop, not for C; the 70% is Chromium's count.
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

const lesson = ALL_LESSONS.find((l) => l.id === 't3.l7')!
const text = strings(lesson).join('\n')

describe('t3.l7 io_uring and the memory-safety statistic', () => {
  test('no sentence says the io_uring glue is C', () => {
    expect(text).not.toContain('io_uring glue: C.')
    expect(text).not.toContain('so the glue is C')
    expect(text).not.toContain('so C. **')
    expect(text).toContain('any language with free C interop')
  })
  test('the 70% sentences carry the Chromium label and no "serious CVEs"', () => {
    expect(text).not.toContain('serious CVEs')
    const share = claimNumber('status.chromium.memory-safety-share')
    expect(text).toContain(`${share}% of Chromium's high-severity security bugs`)
    expect(text).toContain(`Chromium counts around ${share}% of its high-severity security bugs`)
  })
  test('the cr ticket keeps three distinct ideas, the second on free C interop', () => {
    const t = JSON.stringify(lesson)
    expect(t).toContain('The io_uring and eBPF interfaces are C ABIs, so any language with free C interop can drive them')
    expect(t).toContain('Rust or C both qualify')
  })
})
