import { describe, expect, test } from 'bun:test'
import erratum from '@/data/errata/2026-11-23-t7-l3-frontier-is-downward-sloping'
import { lessonById } from '@/data/lessons'

/**
 * K0-C28: t7.l3 called its frontier "concave". The lesson's worked points (tok/s/GPU, tok/s/user) are
 * A (2,400, 20), B (1,900, 35), D (900, 60), E (400, 110); the slopes between neighbours are recomputed here.
 */
const POINTS: [number, number][] = [
  [20, 2400],
  [35, 1900],
  [60, 900],
  [110, 400],
]
const slopes = POINTS.slice(1).map(([x, y], i) => (y - POINTS[i][1]) / (x - POINTS[i][0]))

const lessonText = (): string => JSON.stringify(lessonById('t7.l3'))

describe('t7.l3 frontier slope', () => {
  test('the four worked points fall everywhere but at changing, non-monotone rates', () => {
    expect(slopes.every((m) => m < 0)).toBe(true)
    const steeper = slopes.map((m, i) => (i ? Math.abs(m) > Math.abs(slopes[i - 1]) : null)).slice(1)
    const flatter = slopes.map((m, i) => (i ? Math.abs(m) < Math.abs(slopes[i - 1]) : null)).slice(1)
    // steepens, then flattens: neither a concave nor a convex curve, so the lesson must not say concave.
    expect(steeper).toEqual([true, false])
    expect(flatter).toEqual([false, true])
  })

  test('the lesson does not call the frontier concave', () => {
    expect(lessonText().toLowerCase()).not.toContain('concave')
    expect(lessonText()).toContain('downward')
  })

  test('the 30 tok/s/user figure is stated as a per-MW comparison, not a rival of the 90 crossover', () => {
    const t = lessonText()
    expect(t).not.toMatch(/leading at 30 tok\/s\/user/)
    expect(t).not.toMatch(/ahead at 30 tok\/s\/user/)
    expect(t).toContain('provisioned MW')
  })

  test('the erratum supersedes the 2026-10-05 attribution erratum and ships on its own day', () => {
    expect(erratum.supersedes).toBe('2026-10-05-t7-l3-inferencemax-deepseek-attribution')
    expect(erratum.id.startsWith(erratum.date)).toBe(true)
    expect(erratum.lessons).toEqual(['t7.l3'])
  })
})
