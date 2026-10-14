import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { byId, CLAIMS } from '../../src/data/claims'
import { buildSearchIndex, clip, INDEX_PATH, serializeSearchIndex } from '../../scripts/build-search-index'
import { ACCEPTANCE_QUERIES, checkSearchIndex } from '../../scripts/verify-search-index'
import { GROUP_ORDER, claimPath, indexItems, makeSearcher, type SearchIndex } from '../../src/lib/search'

/**
 * Wave 1 B24 (wave-1.md §7.4): the ⌘K index is generated, committed, fresh, small, and reaches lessons,
 * concepts and claims; a claim opens its row on /freshness?tab=claims.
 */
const root = resolve(import.meta.dir, '../..')
const committed = readFileSync(join(root, INDEX_PATH), 'utf8')
const index = JSON.parse(committed) as SearchIndex
const search = makeSearcher(indexItems(index))

describe('search index freshness', () => {
  test('the committed file is what the build script writes', () => {
    expect(committed).toBe(serializeSearchIndex(buildSearchIndex()))
    expect(checkSearchIndex(committed)).toEqual([])
  })

  test('the claim rows do not depend on the order the lazy groups registered in', () => {
    // A page, test file or script that imports a lazy group first moves it up the live registry; CI ran the test
    // files in another order than the dev host and the rows moved. Scrambling the live order changes nothing.
    const live = [...CLAIMS]
    CLAIMS.reverse()
    try {
      expect(serializeSearchIndex(buildSearchIndex())).toBe(committed)
    } finally {
      CLAIMS.splice(0, CLAIMS.length, ...live)
    }
    expect(CLAIMS).toEqual(live)
  })

  test('a stale file fails the check', () => {
    const stale = committed.replace('"The Roofline Model"', '"The Roofline Model (old)"')
    expect(stale).not.toBe(committed)
    expect(checkSearchIndex(stale).some((e) => e.includes('stale'))).toBe(true)
  })

  test('a hand-edited KC anchor fails the check as stale', () => {
    const row = index.kcs.find((k) => k[4])!
    const broken = committed.replace(`"${row[4]}"`, '"no-such-heading"')
    expect(broken).not.toBe(committed)
    const errors = checkSearchIndex(broken)
    expect(errors.some((e) => e.includes('stale'))).toBe(true)
  })
})

describe('search results', () => {
  test.each(ACCEPTANCE_QUERIES)('"%s" finds a lesson, a concept and a claim', (query) => {
    const groups = new Set(search(query).map((r) => r.group))
    expect(groups.has('Lessons')).toBe(true)
    expect(groups.has('Concepts')).toBe(true)
    expect(groups.has('Numbers')).toBe(true)
  })

  test('a claim opens the Claims tab at its row', () => {
    const hit = search('KV cache').find((r) => r.group === 'Numbers')!
    const id = hit.id.replace(/^claim-/, '')
    expect(byId[id]).toBeDefined()
    expect(hit.to).toBe(`/freshness?tab=claims#${id}`)
    expect(claimPath('hw.h100-sxm.hbm-bw')).toBe('/freshness?tab=claims#hw.h100-sxm.hbm-bw')
  })

  test('a concept opens its introducing lesson, at its H2 when one is known', () => {
    const hit = search('PagedAttention').find((r) => r.group === 'Concepts')!
    expect(hit.to).toBe('/lesson/t2.l7#3-pagedattention-paging-verbatim')
  })

  test('a short query does not fuzz into unrelated rows', () => {
    const titles = search('ridge').map((r) => r.title)
    expect(titles).toContain('The ridge point')
    expect(titles).not.toContain('Interior Mutability: Cell, RefCell & Mutex')
  })

  test('groups come out in palette order', () => {
    const seen = search('cache').map((r) => GROUP_ORDER.indexOf(r.group))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  test('a concept row shows and matches its competence text', () => {
    const hit = search('PagedAttention').find((r) => r.group === 'Concepts')!
    const row = index.kcs.find((k) => `kc-${k[0]}` === hit.id)!
    expect(row[2].length).toBeGreaterThan(0)
    expect(hit.crumb).toContain(`you can ${row[2]}`)
    // The competence wording is searchable: a query made of its first words finds the concept.
    const query = row[2].split(' ').slice(0, 4).join(' ')
    expect(search(query).some((r) => r.id === hit.id)).toBe(true)
  })

  test('concept crumbs carry the competence text and lesson crumbs the hook, clipped to the budget', () => {
    const items = indexItems(index)
    const concepts = items.filter((i) => i.group === 'Concepts')
    expect(concepts.filter((i) => i.crumb.includes('you can ')).length).toBeGreaterThan(concepts.length * 0.9)
    expect(index.lessons.some((l) => l[2].length > 32)).toBe(true)
    expect(Math.max(...index.lessons.map((l) => l[2].length))).toBeLessThanOrEqual(61)
  })

  test('a typo still finds the concept', () => {
    expect(search('pagedatention').some((r) => r.group === 'Concepts')).toBe(true)
  })
})

describe('search index shape', () => {
  test('clip cuts at a word and marks the cut', () => {
    expect(clip('short', 10)).toBe('short')
    expect(clip('a longer hook that runs on', 12)).toBe('a longer…')
  })

  test('the palette fetches the index on open and the claims table gives rows their ids', () => {
    const palette = readFileSync(join(root, 'src/components/CommandPalette.tsx'), 'utf8')
    expect(palette).toMatch(/import\('@\/data\/search-index\.json'\)/)
    expect(palette).not.toMatch(/^import .*search-index\.json/m)
    const table = readFileSync(join(root, 'src/components/ClaimsTable.tsx'), 'utf8')
    expect(table).toMatch(/id=\{claim\.id\}/)
  })
})
