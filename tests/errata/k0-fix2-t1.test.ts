import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import erratum from '@/data/errata/2026-11-22-t1-l2-jvm-null-check-is-a-fault'

// K0-FIX2-T1: the t1.l2 erratum (new in this pull request, not yet published) says what the lesson now says.
// An NPE is sometimes the same caught SIGSEGV, and the JIT recompiles to an explicit test where nulls turn
// out common; Chromium's share is of its high-severity security bugs, and the lesson gives no sample size.

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

const lesson = ALL_LESSONS.find((l) => l.id === 't1.l2')
if (!lesson) throw new Error('t1.l2 not found')
const text = strings(lesson).join('\n')

describe('t1.l2 erratum: the null check', () => {
  test('its why does not say the JVM and C always hit the same unmapped page', () => {
    expect(erratum.why).not.toContain('hit the same unmapped page')
    expect(erratum.why).not.toContain('only the signal handler differs')
  })
  test('its why says the fault is often taken and the JIT switches to an explicit test', () => {
    expect(erratum.why).toContain('often lets a null access fault and catches the SIGSEGV')
    expect(erratum.why).toContain('the JIT switches to an explicit test where nulls turn out common')
    expect(text).toContain('the JIT recompiles with an explicit null test')
  })
  test('its why stays within 40 words', () => {
    expect(erratum.why.trim().split(/\s+/).length).toBeLessThanOrEqual(40)
  })
})

describe("t1.l2 erratum: Chromium's share", () => {
  test('its after names no sample the lesson does not give', () => {
    expect(erratum.after).not.toContain('912')
    expect(erratum.after).not.toContain('2015')
    expect(text).not.toContain('912')
  })
  test('its after names the share as the lesson does', () => {
    expect(erratum.after).toContain("Chromium's share of its high-severity security bugs")
    expect(text).toContain('of its high-severity security bugs')
  })
})
