import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { KCS } from '../../src/data/kc'
import { PLAYS } from '../../src/data/plays'
import { INDEX_PATH } from '../../scripts/build-search-index'
import { indexItems, makeSearcher, type SearchIndex } from '../../src/lib/search'
import { STATIC_ITEMS } from '../../src/components/CommandPalette'

/**
 * Wave 2 (wave-2.md §7.4, task 2a-30): ⌘K finds the T3-T7 concepts, every play of `PLAYS`, the Daily and the
 * Error Museum. Concepts and plays come from the generated index; the Daily and the Errors page are pages, so
 * they come from the palette's static list and never from the index.
 */
const root = resolve(import.meta.dir, '../..')
const index = JSON.parse(readFileSync(join(root, INDEX_PATH), 'utf8')) as SearchIndex
const search = makeSearcher([...indexItems(index), ...STATIC_ITEMS])

const FRONTIER = new Set(['t3', 't4', 't5', 't6', 't7'])
const frontierKcs = KCS.filter((k) => FRONTIER.has(k.track) && k.lessons.length > 0)

describe('concepts of T3-T7', () => {
  test('the graph has them and the index carries every one with a lesson', () => {
    expect(frontierKcs.length).toBeGreaterThan(60)
    const rows = new Map(index.kcs.map((r) => [r[0], r]))
    for (const kc of frontierKcs) expect([kc.id, rows.get(kc.id)?.[3]]).toEqual([kc.id, kc.lessons[0]])
  })

  test('typing a concept title finds that concept, and its row opens its lesson', () => {
    const misses: string[] = []
    for (const kc of frontierKcs) {
      const hit = search(kc.title).find((r) => r.id === `kc-${kc.id}`)
      if (!hit) misses.push(kc.id)
      else expect(hit.to.startsWith(`/lesson/${kc.lessons[0]}`)).toBe(true)
    }
    expect(misses).toEqual([])
  })
})

describe('plays', () => {
  test('every play of PLAYS has a row, found by its title, opening /play/<id>', () => {
    expect(Object.keys(PLAYS).length).toBeGreaterThan(0)
    expect(index.plays.map((r) => r[0]).sort()).toEqual(Object.keys(PLAYS).sort())
    for (const play of Object.values(PLAYS)) {
      const hit = search(play.title).find((r) => r.id === `play-${play.id}`)
      expect(hit?.group).toBe('Plays')
      expect(hit?.to).toBe(`/play/${play.id}`)
      expect(hit?.crumb).toContain(play.lessonId.toUpperCase())
    }
  })

  test('a play registered later (the scheduler play, 2b-11) is found the same way once the index is regenerated', () => {
    const next: SearchIndex = { ...index, plays: [...index.plays, ['scheduler', 'I was the scheduler', 't5.l7', 20]] }
    const hit = makeSearcher(indexItems(next))('I was the scheduler').find((r) => r.group === 'Plays')
    expect(hit).toMatchObject({ id: 'play-scheduler', to: '/play/scheduler' })
  })
})

describe('pages', () => {
  test('the Daily is found as a page', () => {
    for (const q of ['daily', 'Fleet Daily', 'on-call']) {
      expect([q, search(q).find((r) => r.to === '/daily')?.group]).toEqual([q, 'Pages'])
    }
  })

  test('the Errors page is found as a page', () => {
    for (const q of ['errors', 'Error Museum', 'borrow checker']) {
      expect([q, search(q).find((r) => r.to === '/errors')?.group]).toEqual([q, 'Pages'])
    }
  })

  test('the index never carries a page or a bank entry', () => {
    expect(Object.keys(index).sort()).toEqual(['claims', 'glossary', 'kcs', 'lessons', 'plays', 'version'])
    expect(index.lessons.every((r) => r[0].includes('.'))).toBe(true)
  })
})
