/**
 * K0-C44: the r.l8 lesson quotes the panic text a real run prints. The fixture holds the panic message
 * line recorded from compiling and running the lesson's RefCell snippet (wrapped in fn main) on rustc 1.96.0.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '../..')
const recorded = readFileSync(path.join(root, 'tests/fixtures/lessons/refcell-panic-line.txt'), 'utf8').trim()
const lesson = readFileSync(path.join(root, 'src/data/lessons/r/interior-mutability.ts'), 'utf8')

describe('r.l8 RefCell panic text', () => {
  test('the recorded line is the real message', () => {
    expect(recorded).toBe('RefCell already borrowed')
  })
  test('the table, chip, trace row and quiz name the recorded text', () => {
    expect(lesson).toContain(`| panic: ${recorded} |`)
    expect(lesson).toContain(`'panics on line 5: ${recorded}'`)
    expect(lesson.split(`"${recorded}"`).length - 1).toBeGreaterThanOrEqual(4)
  })
  test('no panic is described as "panic: BorrowMutError" or "panics with BorrowMutError"', () => {
    expect(lesson).not.toContain('panic: BorrowMutError')
    expect(lesson).not.toContain('panics on line 5: BorrowMutError')
    expect(lesson).not.toMatch(/panics (on line 5 )?with BorrowMutError/)
  })
  test('the museum anchor is kept and RwLock is named', () => {
    expect(lesson).toContain('(/errors#BorrowMutError)')
    expect(lesson).toContain('RwLock')
  })
})
