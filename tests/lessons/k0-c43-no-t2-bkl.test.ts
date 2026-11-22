import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dir, '../../src/data/lessons/t0')

describe('K0-C43: the big kernel lock is not sent to T2', () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    test(`${f} does not point to T2 for the big kernel lock`, () => {
      const text = readFileSync(join(dir, f), 'utf8')
      for (const m of text.matchAll(/big kernel lock/gi)) {
        const near = text.slice(Math.max(0, m.index! - 160), m.index! + 160)
        expect(near).not.toMatch(/\bT2\b/)
      }
    })
  }
  test('the t0.l5 lesson does not say serving stacks keep Python out entirely', () => {
    expect(readFileSync(join(dir, 'your-runtime.ts'), 'utf8')).not.toMatch(/out of Python entirely/)
  })
})
