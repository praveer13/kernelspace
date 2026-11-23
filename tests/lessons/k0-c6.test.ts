import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (Array.isArray(v)) return v.flatMap(strings)
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings)
  return []
}

describe('K0-C6: t6.l4 DeepSeek decode', () => {
  const l4 = ALL_LESSONS.find((l) => l.id === 't6.l4')!
  const all = strings(l4)

  test('the DeepSeek decode card runs two micro-batches through its pipeline (decode splits the batch too)', () => {
    const card = all.filter((s) => s.includes('**DeepSeek decode**'))
    expect(card.length).toBeGreaterThan(0)
    for (const s of card) expect(s).toContain('two micro-batches through a 5-stage pipeline')
  })

  test('the DeepSeek decode card names the 5-stage pipeline', () => {
    expect(all.some((s) => s.includes('**DeepSeek decode**') && s.includes('5-stage pipeline'))).toBe(true)
  })

  test('no sentence puts every GPU of the DeepSeek decode config inside a TP group', () => {
    expect(all.filter((s) => /every one of those GPUs is also inside a TP group/.test(s))).toEqual([])
  })
})
