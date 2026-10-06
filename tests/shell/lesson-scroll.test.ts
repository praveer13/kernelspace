import { describe, expect, test } from 'bun:test'
import { GRADED_SURFACES, gradedSurfaceInView, scrollBehavior } from '../../src/lib/lesson-scroll'

const box = (top: number, bottom: number) => ({
  getBoundingClientRect: () => ({ top, bottom, height: bottom - top }),
})
const page = (boxes: ReturnType<typeof box>[]) => ({ querySelectorAll: () => boxes })

describe('gradedSurfaceInView', () => {
  test('is true while any part of a ticket or test-out is on screen', () => {
    expect(gradedSurfaceInView(page([box(600, 900)]), 640)).toBe(true)
    expect(gradedSurfaceInView(page([box(-300, 10)]), 640)).toBe(true)
  })
  test('is false when every surface is above or below the viewport, or has no height', () => {
    expect(gradedSurfaceInView(page([box(-500, 0), box(640, 900)]), 640)).toBe(false)
    expect(gradedSurfaceInView(page([box(100, 100)]), 640)).toBe(false)
    expect(gradedSurfaceInView(page([]), 640)).toBe(false)
  })
  test('does not gate on the checkpoint quiz: the bar and Continue anyway must show beside it', () => {
    expect(GRADED_SURFACES).not.toContain('Checkpoint')
    expect(GRADED_SURFACES).toContain('data-ks-ticket')
    expect(GRADED_SURFACES).toContain('data-ks-testout')
  })
})

describe('scrollBehavior', () => {
  test('is auto under prefers-reduced-motion and smooth otherwise', () => {
    const seen: string[] = []
    const mm = (matches: boolean) => (q: string) => {
      seen.push(q)
      return { matches }
    }
    expect(scrollBehavior(mm(true))).toBe('auto')
    expect(scrollBehavior(mm(false))).toBe('smooth')
    expect(seen.every((q) => q === '(prefers-reduced-motion: reduce)')).toBe(true)
  })
})
