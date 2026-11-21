import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { claimNumber, getClaim } from '@/data/claims'
import { claimCite, claimRelease } from '@/data/claims/cite'
import '@/data/claims/lazy/kvpool'
import * as lessonClaims from '@/data/lessons/claims'
import { LESSON_CLAIMS, OUT, render } from '../../scripts/gen-lesson-claims'

const root = new URL('../../src/data/lessons/', import.meta.url).pathname
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = `${dir}${f}`
    return statSync(p).isDirectory() ? files(`${p}/`) : p.endsWith('.ts') ? [p] : []
  })
}

describe('the lessons read their claims from a generated snapshot (K0-Z2 fix)', () => {
  test('the snapshot is what the generator writes from the registry', () => {
    expect(readFileSync(OUT, 'utf8')).toBe(render())
  })

  test('each snapshot value equals the registry reader it stands for', () => {
    for (const id of LESSON_CLAIMS) {
      expect(lessonClaims.claimCite(id)).toBe(getClaim(id).pin ? claimCite(id) : String(getClaim(id).value))
      if (typeof getClaim(id).value === 'number') expect(lessonClaims.claimNumber(id)).toBe(claimNumber(id))
      if (getClaim(id).pin) expect(lessonClaims.claimRelease(id)).toBe(claimRelease(id))
    }
  })

  test('every id a lesson reads is in the snapshot, and no lesson imports the claims registry', () => {
    const read = new Set<string>()
    for (const f of files(root)) {
      if (f.endsWith('/claims.ts') || f.endsWith('claims.generated.ts')) continue
      const src = readFileSync(f, 'utf8')
      expect(src).not.toMatch(/from '@\/data\/claims/)
      for (const m of src.matchAll(/claim(?:Number|Cite|Release)\(\s*'([^']+)'/g)) read.add(m[1]!)
    }
    expect(read.size).toBeGreaterThan(3)
    for (const id of read) expect(LESSON_CLAIMS).toContain(id)
  })

  test('the lessons module has no import() and no await, so no claims chunk gates a page', () => {
    const src = readFileSync(`${root}claims.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(src).not.toMatch(/\bawait\b|\bimport\(/)
    expect(src).not.toMatch(/from '@\/data\/claims/)
  })

  test('an unknown id throws', () => {
    expect(() => lessonClaims.claimNumber('nope')).toThrow()
    expect(() => lessonClaims.claimNumber('constructor')).toThrow()
  })
})
