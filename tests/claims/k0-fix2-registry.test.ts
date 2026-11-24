/** K0-FIX2-REGISTRY: the play card says no more about coalescing than malloc.c's bin invariant, and the row cites it. */
import { describe, expect, test } from 'bun:test'
import { CLAIMS } from '../../src/data/claims/all'
import { PRODUCTION_ROWS } from '../../src/data/plays'

const bins = () => CLAIMS.find((c) => c.id === 'production.glibc.bins')!
const row = () => PRODUCTION_ROWS.find((r) => r.claim === 'production.glibc.bins')!

describe('production.glibc.bins and coalescing', () => {
  test('the card bounds the invariant to chunks in the bins, not every free chunk', () => {
    expect(row().tail).not.toContain('borders another free chunk')
    expect(row().tail).toContain('no chunk in these bins borders another chunk in them')
  })

  test('the card says chunks in the per-thread cache are not merged', () => {
    expect(row().tail).toContain('(chunks waiting in the per-thread cache are not merged)')
  })

  test('the row cites the line of malloc.c that states the invariant', () => {
    expect(bins().source?.row ?? '').toContain('line 1478 says no consolidated chunk physically borders another one')
  })
})
