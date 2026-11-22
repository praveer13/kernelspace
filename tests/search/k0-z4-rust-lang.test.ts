import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ALL_CLAIMS, lazyGroupFor } from '../../src/data/claims/all'
import { INDEX_PATH, UNINDEXED_GROUPS } from '../../scripts/build-search-index'
import { decodeSearchIndex, type EncodedSearchIndex } from '../../src/lib/search'

/** K0-Z4: the Rust-language claim group is indexed for cmd-K again; only the physics groups stay out. */
const root = resolve(import.meta.dir, '../..')
const decoded = decodeSearchIndex(JSON.parse(readFileSync(join(root, INDEX_PATH), 'utf8')) as EncodedSearchIndex)

describe('the rust-lang claim group in the cmd-K index', () => {
  test('is not in UNINDEXED_GROUPS', () => {
    expect([...UNINDEXED_GROUPS]).toEqual(['lazy/physics', 'lazy/ix-points'])
  })

  test('every claim of the group is found by its label in the committed index', () => {
    const group = ALL_CLAIMS.filter((c) => lazyGroupFor(c.id) === 'lazy/rust-lang')
    expect(group.length).toBeGreaterThan(0)
    for (const c of group) {
      const row = decoded.claims.find((r) => r[0] === c.id)
      expect(row?.[1]).toBe(c.label)
    }
  })
})
