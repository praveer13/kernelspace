import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ALL_LESSONS } from '@/data/lessons'
import { claimNumber } from '@/data/lessons/claims'

// K0-FIX-T1: the lane t1 fix round.
// 1. t1.l3's toymalloc.c is a translation unit that compiles: its braces balance, and gcc accepts it with -Wall -Wextra.
// 2. Chromium's memory-unsafe share is read from its claim, never typed, in t1.l2 and t1.l6.
// 3. t1.l2 says an NPE may well be a caught SIGSEGV, and that the JIT recompiles to an explicit test once nulls are common.

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}

function lesson(id: string) {
  const l = ALL_LESSONS.find((x) => x.id === id)
  if (!l) throw new Error(`${id} not found`)
  return l
}

const listing = (() => {
  const blocks = lesson('t1.l3').blocks.filter(
    (b): b is Extract<typeof b, { type: 'code' }> => b.type === 'code' && 'lang' in b && b.lang === 'c',
  )
  const toy = blocks.find((b) => (b.filename ?? '').startsWith('toymalloc.c'))
  if (!toy) throw new Error('toymalloc.c block not found in t1.l3')
  return toy
})()

/** The code with comments, string literals and character literals blanked out. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
}

describe('t1.l3: toymalloc.c is a whole translation unit', () => {
  test('its braces balance and never go negative', () => {
    let depth = 0
    let min = 0
    for (const ch of codeOnly(listing.code)) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
      min = Math.min(min, depth)
    }
    expect(min).toBe(0)
    expect(depth).toBe(0)
  })
  test('its last line closes free() with one brace', () => {
    const lines = listing.code.trimEnd().split('\n')
    expect(lines.at(-1)).toBe('}')
  })
  test('its title gives its true line count', () => {
    const n = listing.code.trimEnd().split('\n').length
    expect(listing.filename).toContain(`${n} lines`)
  })
  const gcc = Bun.which('gcc')
  test.skipIf(!gcc)('gcc compiles it with -Wall -Wextra -Werror', () => {
    const r = Bun.spawnSync([gcc!, '-fsyntax-only', '-std=gnu11', '-Wall', '-Wextra', '-Werror', '-x', 'c', '-'], {
      stdin: new TextEncoder().encode(listing.code),
      stderr: 'pipe',
    })
    expect(r.stderr.toString()).toBe('')
    expect(r.exitCode).toBe(0)
  })
})

describe("Chromium's memory-unsafe share comes from its claim", () => {
  const share = claimNumber('status.chromium.memory-safety-share')
  const files = ['src/data/lessons/t1/pointers.ts', 'src/data/lessons/t1/rust-ownership-intro.ts']
  for (const f of files) {
    test(`${f} types neither the share nor the sample's count and year`, () => {
      const src = readFileSync(f, 'utf8')
      expect(src).not.toMatch(/\b70\s*%/)
      expect(src).not.toContain('912')
      expect(src).not.toContain('2015')
      expect(src).toContain("claimNumber('status.chromium.memory-safety-share')")
    })
  }
  for (const id of ['t1.l2', 't1.l6']) {
    test(`${id} renders the claim's value beside Chromium`, () => {
      const text = strings(lesson(id)).join('\n')
      expect(text).toContain(`${share}%`)
      expect(text).toContain('Chromium')
    })
  }
})

describe('t1.l2: a NullPointerException may be a caught SIGSEGV, not usually one', () => {
  const text = strings(lesson('t1.l2')).join('\n')
  test('it does not say the NPE a learner got usually came from a fault', () => {
    expect(text).not.toContain('you usually hit the same unmapped page')
    expect(text).toContain('you may well have hit the same unmapped page')
  })
  test('it says the JIT recompiles with an explicit test once nulls are common', () => {
    expect(text).toContain('recompiles with an explicit null test')
  })
  test('the Q4 explanation has no capital after a dash', () => {
    expect(text).not.toContain('null — In')
  })
})
