import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, '../../src/data/lessons/t5/kv-cache-math.ts'), 'utf8')

describe('t5.l4 bandwidth wall fix', () => {
  test('no text recommends batching as an ITL fix', () => {
    expect(src).not.toMatch(/fix it with batching/)
    expect(src).not.toMatch(/solve with batching/)
  })
  test('the fix names a smaller batch, fewer bytes and more bandwidth', () => {
    expect(src.match(/smaller running batch/g)?.length).toBe(2)
    expect(src.match(/sharding/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
