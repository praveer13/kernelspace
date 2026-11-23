/**
 * K0-CLOSE2-D: the t2.l5 ABA node's correction (the published 'B is lost — corruption' became 'head = B (freed!)')
 * is a correction of a published fact, so an erratum names it (docs/specs/k0.md, K0-Z-D5).
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import type { Erratum } from '@/data/errata/schema'

// As index.ts globs them: date-prefixed modules only.
const errata: Erratum[] = await Promise.all(
  readdirSync('src/data/errata')
    .filter((f) => /^\d.*\.ts$/.test(f))
    .map(async (f) => (await import(`@/data/errata/${f.slice(0, -3)}`)).default as Erratum),
)

describe('t2.l5: the ABA figure correction has its erratum', () => {
  const e = errata.find((x) => x.lessons.includes('t2.l5') && x.before.includes('B is lost'))
  test('an erratum on t2.l5 says what the figure said and what it says now', () => {
    expect(e).toBeDefined()
    expect(e!.kind).toBe('error')
    expect(e!.after).toContain('head = B')
    expect(e!.after).toContain('freed')
    expect(e!.source?.url).toMatch(/^https:\/\//)
  })
})
