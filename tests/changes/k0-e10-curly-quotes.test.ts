import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
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
  test('single quotes and apostrophes are left alone', () => {
    expect(curlyQuotes("it's 'x'")).toBe("it's 'x'")
  })
})

test('no erratum module is edited', () => {
  const out = execFileSync('git', ['diff', '--name-only', 'HEAD~0', '--', 'src/data/errata'], { encoding: 'utf8' })
  expect(out.trim()).toBe('')
})
