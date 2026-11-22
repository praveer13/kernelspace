import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'

/** Every string a lesson block carries, quiz options and explanations included. */
function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(strings)
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings)
  return []
}

describe('K0-C5: EPLB is not consistent hashing', () => {
  const t6 = ALL_LESSONS.filter((l) => l.trackId === 't6')

  test('t6 lessons exist', () => expect(t6.length).toBeGreaterThan(0))

  for (const l of t6) {
    test(`${l.id}: no sentence puts consistent hashing beside EPLB`, () => {
      const bad = strings(l)
        .flatMap((s) => s.split(/(?<=[.!?])\s+|\n+/))
        .filter((sentence) => /consistent[- ]hash/i.test(sentence) && /EPLB/.test(sentence) && !/\b(not|no|never)\b/i.test(sentence))
      expect(bad).toEqual([])
    })
  }

  test('t6.l2 no longer says EPLB is consistent hashing anywhere in the lesson', () => {
    const l2 = ALL_LESSONS.find((l) => l.id === 't6.l2')!
    expect(strings(l2).filter((s) => /consistent hashing with live rebalancing/i.test(s))).toEqual([])
  })

  test('t6.l2 dates the DeepEP modes and gives decode its own pipeline', () => {
    const l2 = ALL_LESSONS.find((l) => l.id === 't6.l2')!
    const text = strings(l2).join('\n')
    expect(text).toContain('EPBuffer')
    expect(text).toContain('5-stage pipeline')
    expect(text).not.toMatch(/write-with-immediate/)
    expect(text).toContain('cost profit margin of 545%')
  })
})
