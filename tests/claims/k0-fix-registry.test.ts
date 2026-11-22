/** K0-FIX-REGISTRY: the glibc bins claim and its play row say one account of the bins and of fastbins. */
import { describe, expect, test } from 'bun:test'
import { CLAIMS } from '../../src/data/claims/all'
import { PRODUCTION_ROWS } from '../../src/data/plays'

const bins = () => CLAIMS.find((c) => c.id === 'production.glibc.bins')!
const row = () => PRODUCTION_ROWS.find((r) => r.claim === 'production.glibc.bins')!

describe('production.glibc.bins', () => {
  test('every bin kind in the value is named where the source is cited (quote or row)', () => {
    const cited = `${bins().source?.quote ?? ''} ${bins().source?.row ?? ''}`
    for (const kind of String(bins().value).split(', ')) expect(cited).toContain(`${kind} bin`)
  })

  test('the row counts lines that contain fastbin, not occurrences of the word', () => {
    const r = bins().source?.row ?? ''
    expect(r).not.toMatch(/occurs \d+ times/)
    expect(r).toMatch(/\d+ lines of malloc\.c at tag glibc-2\.42 contain fastbin/)
  })

  test('the boundary states the scope first and leaves the read record to the row', () => {
    expect(bins().boundary).toMatch(/^Per arena/)
    expect(bins().boundary).not.toContain('Read in the mirror')
  })

  test('the play row says the bins hold coalesced chunks, and that fastbins deferred coalescing', () => {
    expect(row().tail).toContain('borders another free chunk')
    expect(row().tail).toContain('deferred coalescing')
    expect(row().tail).not.toContain('skipped coalescing')
  })
})
