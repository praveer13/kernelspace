import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import type { Erratum } from '@/data/errata/schema'
import { curlyQuotes } from '@/lib/typography'

describe('curlyQuotes', () => {
  test('an erratum title with a quoted range gets an opening and a closing quote', () => {
    expect(curlyQuotes('H100 rents for a median $3.49 per GPU-hour, not "$2–3"')).toBe('H100 rents for a median $3.49 per GPU-hour, not “$2–3”')
  })
  test('a title with no quote is unchanged', () => {
    expect(curlyQuotes('vLLM defaults to 16 tokens per block')).toBe('vLLM defaults to 16 tokens per block')
  })
  test('a quote at the start opens, one after a bracket opens, one after punctuation closes', () => {
    expect(curlyQuotes('"a" and ("b").')).toBe('“a” and (“b”).')
  })
  test('a quote after a slash, a hyphen or a colon-space opens; one after a letter, digit or closing mark closes', () => {
    expect(curlyQuotes('a/"b"')).toBe('a/“b”')
    expect(curlyQuotes('-"d"')).toBe('-“d”')
    expect(curlyQuotes('x: "y", z')).toBe('x: “y”, z')
    expect(curlyQuotes('"40 GB"')).toBe('“40 GB”')
    expect(curlyQuotes('("a")."')).toBe('(“a”).”')
  })
  test('every erratum title comes out as balanced opening and closing pairs', async () => {
    const files = readdirSync('src/data/errata').filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.ts$/.test(f))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const e = ((await import(`@/data/errata/${f.replace(/\.ts$/, '')}`)) as { default: Erratum }).default
      const t = curlyQuotes(e.title)
      expect(`${e.id}: ${t.includes('"')}`).toBe(`${e.id}: false`)
      let open = false
      for (const ch of t) {
        if (ch === '“') { expect(`${e.id}: nested ${open}`).toBe(`${e.id}: nested false`); open = true }
        if (ch === '”') { expect(`${e.id}: unopened ${!open}`).toBe(`${e.id}: unopened false`); open = false }
      }
      expect(`${e.id}: left open ${open}`).toBe(`${e.id}: left open false`)
    }
  })
  test('single quotes and apostrophes are left alone', () => {
    expect(curlyQuotes("it's 'x'")).toBe("it's 'x'")
  })
})

