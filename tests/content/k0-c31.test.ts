import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * K0-C31, t4.l6: the tiling paragraph uses K0-C30's account of shared memory against HBM (an order of magnitude on an
 * A100, from the FlashAttention paper), and the unsourced 20-30x does not come back.
 */
const src = readFileSync(new URL('../../src/data/lessons/t4/matmul-tiling.ts', import.meta.url), 'utf8')

describe('K0-C31: t4.l6 shared memory against HBM', () => {
  test('t4.l6 says an order of magnitude on an A100', () => {
    expect(src).toContain('about an order of magnitude faster than HBM on an A100')
  })
  test('the old 20-30x is gone', () => {
    expect(src).not.toMatch(/20[–-]30\s*×/)
    expect(src).not.toMatch(/20[–-]30\s*x\b/)
  })
})
