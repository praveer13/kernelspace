/**
 * K0-C44: the r.l8 lesson quotes the panic text a real run prints. The expected text is the message the
 * compile bank recorded from running its BorrowMutError snippet on the pinned rustc (scripts/build-rust-items.ts
 * writes src/data/rust-items/museum.json from those runs, and its --check re-runs them), so a toolchain re-pin
 * that changes the message fails this test until the lesson says the new text.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '../..')
const museum = JSON.parse(readFileSync(path.join(root, 'src/data/rust-items/museum.json'), 'utf8')) as { code: string; panic?: boolean; message?: string }[]
const lesson = readFileSync(path.join(root, 'src/data/lessons/r/interior-mutability.ts'), 'utf8')
const entry = museum.find((e) => e.code === 'BorrowMutError')
const recorded = entry?.message ?? ''

describe('r.l8 RefCell panic text', () => {
  test('the bank holds a recorded panic message for BorrowMutError', () => {
    expect(entry?.panic).toBe(true)
    expect(recorded.length).toBeGreaterThan(0)
    // every BorrowMutError outcome the bank recorded prints the same message
    const bank = path.join(root, 'src/data/rust-items/bank')
    const seen = new Set<string>()
    for (const f of readdirSync(bank).filter((x) => x.endsWith('.json'))) {
      for (const m of readFileSync(path.join(bank, f), 'utf8').matchAll(/"code":"BorrowMutError","line":\d+,"message":"([^"]*)"/g)) seen.add(m[1])
    }
    expect([...seen]).toEqual([recorded])
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
  test('the Mutex section heading names RwLock, which its paragraph calls the counterpart, and write excludes readers', () => {
    expect(lesson).toContain('## Mutex and RwLock: the rule across threads')
    expect(lesson).not.toContain('## Mutex: the same rule across threads')
    expect(lesson).toContain('\\`write\\` admits one writer and no readers')
    expect(lesson).not.toContain('needs exactly one writer')
  })
  test('no unsourced claim about what older compilers printed', () => {
    expect(lesson).not.toContain('older compilers printed')
    expect(lesson).toContain(`The panic message is "${recorded}". \\\`BorrowMutError\\\` is a real type`)
  })
})
