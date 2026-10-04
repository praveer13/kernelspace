import { describe, expect, test } from 'bun:test'
import { BOOT } from '@/lib/boot/model'
import { CORRECT, OPTIONS } from '../../src/pages/boot/whyBatching'

/** The same length-tell rules verify:items applies to the course quizzes (PLAN-100X; spec §12.2 lint). */
describe('step 5 MCQ (item boot:why-batching)', () => {
  const lens = OPTIONS.map((o) => o.text.length)
  const max = Math.max(...lens)

  test('the longest option is within 1.3x of the shortest', () => {
    expect(max / Math.min(...lens)).toBeLessThanOrEqual(1.3)
  })

  test('the key is not strictly the longest option', () => {
    const top = lens.flatMap((l, i) => (l === max ? [i] : []))
    expect(top.length === 1 && top[0] === CORRECT).toBe(false)
  })

  test('exactly one key, and every option has a why', () => {
    expect(CORRECT).toBeGreaterThanOrEqual(0)
    expect(CORRECT).toBeLessThan(OPTIONS.length)
    for (const o of OPTIONS) expect(o.why(BOOT).length).toBeGreaterThan(20)
  })

  test('the key why uses the rounded chat count the heading uses', () => {
    expect(OPTIONS[CORRECT].why(BOOT)).toContain('about 120 users')
    expect(OPTIONS[CORRECT].why(BOOT)).not.toContain('119')
  })
})
