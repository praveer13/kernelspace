import { describe, expect, test } from 'bun:test'
import { PAIRS } from '@/data/glossary'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Erratum } from '@/data/errata/schema'

const dir = join(import.meta.dir, '../../src/data/errata')
const ERRATA: Erratum[] = await Promise.all(
  readdirSync(dir)
    .filter((n) => /^[0-9].*\.ts$/.test(n))
    .map(async (n) => (await import(join(dir, n))).default as Erratum),
)

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
const bigrams = (s: string) => {
  const w = words(s)
  return new Set(w.slice(1).map((x, i) => `${w[i]} ${x}`))
}

describe('K0-C12: a glossary pair does not repeat a pairing an erratum retired', () => {
  test('the priority-inversion pair is not head-of-line blocking', () => {
    const p = PAIRS.find((x) => x.slug === 'priority-inversion')!
    expect(`${p.llm} ${p.llmDef}`.toLowerCase()).not.toMatch(/head.of.line/)
    expect(`${p.llm} ${p.llmDef}`.toLowerCase()).toContain('kv blocks')
  })

  test('no pair twin shares a phrase with an erratum before-text that names the pair', () => {
    // Only an erratum whose before-text states a pairing can retire one.
    for (const e of ERRATA.filter((x) => /\b(pair|pairing|twin|isomorphism|maps? to)\b/i.test(x.before))) {
      const before = ` ${words(e.before).join(' ')} `
      const bg = bigrams(e.before)
      for (const p of PAIRS) {
        if (!before.includes(` ${words(p.os).join(' ')} `)) continue
        const shared = [...bigrams(`${p.llm} ${p.llmDef}`)].filter((b) => bg.has(b))
        expect({ erratum: e.id, pair: p.slug, shared }).toEqual({ erratum: e.id, pair: p.slug, shared: [] })
      }
    }
  })

  test('the lock-free pair keeps lock-free apart from wait-free and names no NATS', () => {
    const p = PAIRS.find((x) => x.slug === 'lock-free-queue')!
    expect(p.osDef).toContain('some thread always makes progress')
    expect(p.osDef).toContain('bounded number of steps')
    expect(JSON.stringify(p).toLowerCase()).not.toContain('nats')
  })
})
