/**
 * The counts the site states about itself outside the app (G7 of the 3s review, round 1's 3s-03 m1): index.html's meta
 * description and README.md's curriculum heading and track table name how many lessons and tracks there are. Both said 68
 * lessons after t6.l12 made 69, and no test read them; this one holds them to the lesson registry, so they cannot go stale.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_LESSONS } from '../../src/data/lessons'
import { TRACKS } from '../../src/lib/tracks'

const root = join(import.meta.dir, '../..')
const read = (file: string) => readFileSync(join(root, file), 'utf8')

describe('the lesson and track counts outside the app match the registry', () => {
  test('index.html\'s meta description', () => {
    const description = /<meta\s+name="description"\s+content="([^"]*)"/.exec(read('index.html'))?.[1] ?? ''
    const counts = /(\d+) tracks, (\d+) lessons/.exec(description)
    expect(counts, description).not.toBeNull()
    expect(Number(counts![1])).toBe(TRACKS.length)
    expect(Number(counts![2])).toBe(ALL_LESSONS.length)
  })

  test('README.md\'s curriculum heading and its per-track lesson counts', () => {
    const readme = read('README.md')
    const heading = /^## Curriculum — (\d+) lessons, (\d+) tracks$/m.exec(readme)
    expect(heading).not.toBeNull()
    expect(Number(heading![1])).toBe(ALL_LESSONS.length)
    expect(Number(heading![2])).toBe(TRACKS.length)
    for (const t of TRACKS) {
      const row = new RegExp(`^\\| ${t.code} \\| [^|]+ \\| (\\d+) \\|`, 'm').exec(readme)
      expect(row, t.code).not.toBeNull()
      expect(Number(row![1]), t.code).toBe(ALL_LESSONS.filter((l) => l.trackId === t.id).length)
    }
  })
})
