import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_LESSONS } from '@/data/lessons'
import type { Erratum } from '@/data/errata/schema'

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

/**
 * K0-CLOSE-H: the reference card's Kimi K2 entry is the Mooncake team's benchmark (lmsys post, 2025-07-20: "We benchmarked
 * Kimi K2 ... on 128 H200 GPUs with 1P1D"), as t6.l3 and its erratum say, not a production config. No claim holds the post's
 * GPU count or throughputs, so the card links the post and leaves its figures to it.
 */
describe('K0-CLOSE-H: t6.l4 reference card calls the Kimi K2 run a benchmark', () => {
  const l4 = ALL_LESSONS.find((l) => l.id === 't6.l4')!
  const all = strings(l4)
  const card = all.filter((s) => s.includes('**Kimi K2'))

  test('the reference card does not call all three configs production configs', () => {
    expect(card.length).toBe(1)
    expect(card[0]).not.toMatch(/production configs/i)
    expect(card[0]).toContain('(one production service, two reported runs)')
  })

  test('the Kimi K2 entry is named a benchmark, not Moonshot production, and links the post', () => {
    expect(card.length).toBe(1)
    expect(card[0]).toContain('**Kimi K2 benchmark**')
    expect(card[0]).toContain("not Moonshot's production")
    expect(card[0]).toContain('https://lmsys.org/blog/2025-07-20-k2-large-scale-ep/')
  })

  test('the card types none of the post\'s figures that no claim holds', () => {
    for (const s of card) expect(s).not.toMatch(/224k|288k|128\s*[x×]\s*H200/)
  })

  test('a new erratum names t6.l4 for the Kimi entry, and its after is what the card says', async () => {
    const dir = join(import.meta.dir, '../../src/data/errata')
    const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}-t6-l4-kimi-.*\.ts$/.test(f))
    expect(files.length).toBe(1)
    const e = (await import(join(dir, files[0]))).default as Erratum
    expect(e.lessons).toEqual(['t6.l4'])
    expect(e.kind).toBe('error')
    const plain = card[0].replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    for (const part of e.after.split(' … ')) expect(plain).toContain(part)
    expect(e.before).toContain('Three production configs to recite')
  })
})
