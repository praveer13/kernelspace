import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import { ANCHOR_ALIASES, resolveAnchor } from '@/pages/lesson/anchor-aliases'
import { extractHeadings } from '@/pages/lesson/markdown'
import published from '../fixtures/lesson-headings/slugs.json'

const idsOf = (lessonId: string) => {
  const lesson = ALL_LESSONS.find((l) => l.id === lessonId)
  if (!lesson) throw new Error(`${lessonId} not found`)
  return extractHeadings(lesson.blocks).map((h) => h.id)
}

describe('old heading links land on the renamed heading (K0-E7)', () => {
  const ids = idsOf('t2.l7')

  test('each old t2.l7 slug resolves to a live heading', () => {
    for (const old of Object.keys(ANCHOR_ALIASES['t2.l7'])) {
      const live = resolveAnchor('t2.l7', `#${old}`, ids)
      expect(live).not.toBeNull()
      expect(ids).toContain(live!)
    }
    expect(resolveAnchor('t2.l7', '#3-pagedattention-paging-verbatim', ids)).toBe('4-pagedattention-paging-verbatim')
  })

  test('a live slug maps to itself and an unknown one to null', () => {
    for (const id of ids) expect(resolveAnchor('t2.l7', `#${id}`, ids)).toBe(id)
    expect(resolveAnchor('t2.l7', '#no-such-heading', ids)).toBeNull()
    expect(resolveAnchor('t2.l7', '', ids)).toBeNull()
    expect(resolveAnchor('t2.l7', '#%E0%A4%A', ids)).toBeNull()
    expect(resolveAnchor('t2.l1', '#3-pagedattention-paging-verbatim', idsOf('t2.l1'))).toBeNull()
  })

  test('every alias target is a heading of its lesson and no key is one', () => {
    for (const [lessonId, rows] of Object.entries(ANCHOR_ALIASES)) {
      const live = idsOf(lessonId)
      for (const [old, now] of Object.entries(rows)) {
        expect(live).toContain(now)
        expect(live).not.toContain(old)
      }
    }
  })
})

// Every heading slug a saved link may name: the headings of the published course and of this branch. A heading that
// is renamed or removed leaves its slug here, so the test asks for an alias row that lands its old links.
describe('a renamed heading keeps its old links (K0-FIX-LESSON-APP)', () => {
  const snapshot = published as Record<string, string[]>

  test('every lesson in the snapshot still exists', () => {
    for (const lessonId of Object.keys(snapshot)) expect(ALL_LESSONS.some((l) => l.id === lessonId)).toBe(true)
  })

  test('every slug in the snapshot is a live heading or has an alias row to one', () => {
    const lost: string[] = []
    for (const [lessonId, slugs] of Object.entries(snapshot)) {
      const live = idsOf(lessonId)
      for (const slug of slugs) if (resolveAnchor(lessonId, `#${slug}`, live) === null) lost.push(`${lessonId}#${slug}`)
    }
    expect(lost).toEqual([])
  })

  test('the two headings renamed before E7 land on their new slugs', () => {
    expect(resolveAnchor('t6.l2', '#mechanism-3-dual-batch-overlap-hide-the-network-under-compute', idsOf('t6.l2'))).toBe(
      'mechanism-3-overlap-hide-the-network-under-compute',
    )
    expect(resolveAnchor('r.l8', '#mutex-the-same-rule-across-threads', idsOf('r.l8'))).toBe(
      'mutex-and-rwlock-the-rule-across-threads',
    )
  })
})
