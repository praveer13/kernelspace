import { describe, expect, test } from 'bun:test'
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { claimPathsFrom } from '../../scripts/gen-lesson-claims'

const fixtures = fileURLToPath(new URL('../fixtures/lesson-claims/', import.meta.url))
const lessons = fileURLToPath(new URL('../../src/data/lessons/', import.meta.url))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = `${dir}${f}`
    return statSync(p).isDirectory() ? files(`${p}/`) : p.endsWith('.ts') ? [p] : []
  })
}

describe('the import ban follows a helper module (K0-E2)', () => {
  test('a module that reaches @/data/claims through a helper outside src/data/lessons is caught', () => {
    const found = claimPathsFrom(`${fixtures}lesson-like.ts`)
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('@/data/claims')
  })

  test('a module whose helpers reach no claims module passes', () => {
    expect(claimPathsFrom(`${fixtures}clean.ts`)).toEqual([])
  })

  test('a cycle between helpers ends', () => {
    expect(claimPathsFrom(`${fixtures}lesson-like.ts`, new Set([`${fixtures}helper.ts`]))).toEqual([])
  })

  test('no file under src/data/lessons reaches src/data/claims by any path', () => {
    const found = files(lessons).flatMap((f) => claimPathsFrom(f, new Set()))
    expect(found).toEqual([])
  })
})
