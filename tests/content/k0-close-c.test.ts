import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import { claimNumber } from '@/data/lessons/claims'
import nullCheck from '@/data/errata/2026-11-22-t1-l2-jvm-null-check-is-a-fault'
import ioUring from '@/data/errata/2026-11-22-t3-l7-io-uring-from-rust'
import labsR10 from '@/data/errata/2026-11-22-labs-r10-checks-one-thread-and-lab01-coalescing'

/**
 * K0-CLOSE-C, the closing fix round for T0 to T4 wording and the T1, T3 and labs errata.
 * t4.l6 links the three FlashAttention papers and types no year for FlashAttention-3 or -4 (no claim holds either);
 * t0.l6 says what a wall-clock profile is where the term first appears; t0.l4's keyed prequestion why no longer cites
 * Drepper's quad-core as a case of its answer; the t1.l2 and t3.l7 errata say the course now cites Chromium's page and
 * no longer cites Microsoft (not re-read), instead of calling the Microsoft attribution an error; the labs erratum says
 * the Ordering passed in each call is what nothing grades, while ordering_for is graded.
 */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const lesson = (id: string) => {
  const l = ALL_LESSONS.find((x) => x.id === id)
  if (!l) throw new Error(`${id} not found`)
  return l
}
const words = (s: string) => s.trim().split(/\s+/).length

describe('t4.l6 FlashAttention lineage names its papers and types no dates', () => {
  const text = strings(lesson('t4.l6').blocks).join('\n')
  test('no typed year for FlashAttention-3 or -4', () => {
    expect(text).not.toContain('FlashAttention-3 (2024)')
    expect(text).not.toContain('FlashAttention-4 (March 2026)')
  })
  test('each of FlashAttention-2, -3 and -4 links its arXiv paper', () => {
    expect(text).toContain('[FlashAttention-2](https://arxiv.org/abs/2307.08691)')
    expect(text).toContain('[FlashAttention-3](https://arxiv.org/abs/2407.08608)')
    expect(text).toContain('[FlashAttention-4](https://arxiv.org/abs/2603.05451)')
  })
})

describe('t0.l6 defines a wall-clock profile where it first uses the term', () => {
  test('the first body use of "wall-clock profile" carries its definition', () => {
    const prose = lesson('t0.l6')
      .blocks.filter((b) => b.type === 'prose')
      .map((b) => (b as { md: string }).md)
      .join('\n')
    const first = prose.indexOf('wall-clock profile')
    expect(first).toBeGreaterThan(-1)
    const after = prose.slice(first, first + 220)
    expect(after).toContain('samples every thread, running or parked')
    expect(after).toContain('a CPU profile sees only running threads')
  })
})

describe('t0.l4 prequestion: the keyed why does not cite a chip where its key is false', () => {
  const item = strings(lesson('t0.l4').blocks).join('\n')
  test("why[3] says the older quad-core came close to scaling and the slowdown is this run's result", () => {
    expect(item).not.toContain('on some, such as the quad-core Drepper measured, the penalty stays small')
    expect(item).toContain(
      'How much depends on the chip: on some older chips, such as the quad-core Drepper measured, the penalty stayed small and the threads came close to scaling, so the slowdown is this run\'s result, not every chip\'s.',
    )
  })
  test('the question, its options and its key are unchanged', () => {
    const json = JSON.stringify(lesson('t0.l4').blocks)
    expect(json).toContain('Lower than one thread, with the cores fighting over the one line the counters share')
    expect(json).toContain(
      "Eight threads each increment their own counter. The eight counters sit side by side in one array, and no thread touches another's. How does total throughput compare with one thread?",
    )
  })
})

describe('the 70% errata cite Chromium and do not call the Microsoft attribution an error', () => {
  const share = claimNumber('status.chromium.memory-safety-share')
  test('t1.l2 title and why', () => {
    expect(nullCheck.title).toBe(`A NullPointerException is often a caught segfault; the ${share}% is now cited to Chromium's page`)
    expect(nullCheck.why).not.toContain("one codebase's count")
    expect(nullCheck.why).toContain(`Microsoft's figure for the ${share}% was not re-read, so the course no longer cites it`)
    expect(words(nullCheck.why)).toBeLessThanOrEqual(40)
  })
  test('t3.l7 title and why', () => {
    expect(ioUring.title).not.toContain(`the ${share}% figure is Chromium's`)
    expect(ioUring.title).toContain(`the ${share}% is now cited to Chromium's page`)
    expect(ioUring.why).not.toContain("it is one C++ codebase's count")
    expect(ioUring.why).not.toContain('was never a share')
    expect(ioUring.why).toContain("Microsoft's figure was not re-read")
    expect(words(ioUring.why)).toBeLessThanOrEqual(40)
    expect(ioUring.title.length).toBeLessThanOrEqual(240)
  })
})

describe('the labs erratum says what nothing grades, and that ordering_for is graded', () => {
  test('why', () => {
    expect(labsR10.why).not.toContain('the protocol you write down is the part nothing grades')
    expect(labsR10.why).toContain('the Ordering you pass in each call is the part nothing grades')
    expect(labsR10.why).toContain('ordering_for')
    expect(words(labsR10.why)).toBeLessThanOrEqual(40)
  })
})
