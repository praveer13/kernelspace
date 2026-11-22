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

/**
 * K0-FIX3 (R9): a lesson reaches the claims registry by no path at all. Every import specifier under src/data/lessons/
 * ('@/...', relative, or a dynamic import()) is resolved, and none may land in src/data/claims/. The snapshot's generator,
 * scripts/gen-lesson-claims.ts, is the one module that reads the registry for the lessons, and it lives outside.
 */
const SRC = new URL('../../src/', import.meta.url).pathname
export function claimImports(file: string, src: string): string[] {
  const specs = [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]!)
  return specs.filter((spec) => {
    let target: string
    if (spec.startsWith('@/')) target = `${SRC}${spec.slice(2)}`
    else if (spec.startsWith('.')) target = new URL(spec, `file://${file}`).pathname
    else return false
    return target === `${SRC}data/claims` || target.startsWith(`${SRC}data/claims/`) || target.startsWith(`${SRC}data/claims.`)
  })
}

describe('no lesson module imports src/data/claims by any path', () => {
  test('the resolver catches an alias, a relative path and a dynamic import', () => {
    const at = `${root}t1/probe.ts`
    // the rule this replaces matched only the alias, so a relative path into src/data/claims passed it
    expect("import { claimCite } from '../../claims/cite'").not.toMatch(/from '@\/data\/claims/)
    expect(claimImports(at, "import { claimNumber } from '@/data/claims'")).toHaveLength(1)
    expect(claimImports(at, "import { claimCite } from '../../claims/cite'")).toHaveLength(1)
    expect(claimImports(at, "import '../../claims/lazy/kvpool'")).toHaveLength(1)
    expect(claimImports(at, "const m = await import('../../claims')")).toHaveLength(1)
    expect(claimImports(`${root}claims.ts`, "import { X } from '../claims/index'")).toHaveLength(1)
    expect(claimImports(at, "import { claimNumber } from '../claims'")).toEqual([])
    expect(claimImports(at, "import type { Lesson } from '../types'")).toEqual([])
  })

  test('every file under src/data/lessons, the reader and its snapshot included', () => {
    const found: string[] = []
    for (const f of files(root)) for (const spec of claimImports(f, readFileSync(f, 'utf8'))) found.push(`${f.slice(root.length)}: ${spec}`)
    expect(found).toEqual([])
  })
})
