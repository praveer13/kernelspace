import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PAIRS } from '@/data/glossary'

/**
 * K0-E8. The external-fragmentation card spoke of "60-80% of HBM", a rounding of the paper's range that named the wrong
 * memory; it now says KV memory in words, with no number (a claim import would grow the frozen entry chunk). The home page's static-batching card typed "60%+" and "$30k",
 * which no claim holds.
 */
describe('K0-E8 glossary and home', () => {
  const pair = PAIRS.find((p) => p.slug === 'external-fragmentation')!
  const text = `${pair.llmDef} ${pair.why}`

  test('the external-fragmentation card names KV memory and states the range in words', () => {
    expect(pair).toBeDefined()
    expect(text).not.toContain('60–80%')
    expect(text).not.toContain('of HBM')
    expect(pair.llmDef).not.toContain('HBM')
    expect(text).toContain('KV memory')
    // The card states the range in words: the entry chunk is frozen to the byte, and importing the claims snapshot into
    // glossary.ts grows its preload map by 53 B, so the card carries no number and imports no claim.
    expect(text).toContain('most of the KV memory it reserves')
    expect(text).not.toMatch(/\d+(?:\.\d+)?%/)
  })

  test("Home's PAINS text holds no number no claim holds", () => {
    const src = readFileSync(new URL('../../src/pages/Home.tsx', import.meta.url), 'utf8')
    const pains = src.slice(src.indexOf('const PAINS'), src.indexOf('foot:', src.indexOf('const PAINS')))
    expect(pains).toContain('Static batching')
    expect(pains).not.toContain('60%+')
    expect(pains).not.toContain('$30k')
  })
})
