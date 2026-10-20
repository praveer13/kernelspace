/**
 * Serving-first reading blocks B1-B7 are where the promise says (docs/specs/serving-reading.md §5.3, M1 item 1, SR-06).
 *
 * The check itself is `readingCoverage()` in ./reading-coverage.ts, which SR-07's copy test also runs, so Boot's blurb
 * and the blocks cannot drift apart. `outcomes.ts` keeps its own literals (SR-08), and this file holds them to the
 * blocks and to `READING_KCS`.
 */
import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '../../src/data/lessons'
import { READING_KCS } from '../../src/data/rust-items/constants'
import { SERVING_READING_HOSTS, SERVING_READING_KCS } from '../../src/lib/learner/outcomes'
import { pathPlan } from '../../src/lib/learner/paths'
import { BLOCKS, GRAPH, KEYED, ON_PAGE, directEdges, keyedIndices, lessonOf, reachable, readingCoverage, readingOf, specOf } from './reading-coverage'

describe('reading blocks B1-B7', () => {
  test('the coverage holds', () => {
    const { problems, hosts } = readingCoverage()
    expect(problems).toEqual([])
    expect(hosts).toEqual(Object.keys(BLOCKS))
  })

  test('every host is a T5 or T6 lesson on the serving-first path, with exactly one reading block', () => {
    const plan = pathPlan('serving-first', GRAPH).lessons
    for (const id of Object.keys(BLOCKS)) {
      const l = lessonOf(id)
      expect({ id, track: l.trackId, onPath: plan.includes(id), blocks: readingOf(l).length }).toEqual({ id, track: id.split('.')[0], onPath: true, blocks: 1 })
      expect(['t5', 't6']).toContain(l.trackId)
    }
  })

  test('the blocks sit at the frozen indices, after every keyed block and before the quiz', () => {
    for (const [id, want] of Object.entries(BLOCKS)) {
      const l = lessonOf(id)
      const b = readingOf(l)[0]
      expect({ id, at: l.blocks.indexOf(b), count: b.count }).toEqual({ id, at: want.at, count: want.count })
      expect({ id, keyed: keyedIndices(l) }).toEqual({ id, keyed: [...KEYED[id]] })
      expect(Math.max(-1, ...KEYED[id])).toBeLessThan(want.at)
      expect(l.blocks.findIndex((x) => x.type === 'quiz')).toBeGreaterThan(want.at)
    }
  })

  test('the seven blocks ask for 16 correct answers, and none asks for more than it has variants', () => {
    const blocks = Object.keys(BLOCKS).map((id) => readingOf(lessonOf(id))[0])
    expect(blocks.reduce((n, b) => n + b.count, 0)).toBe(16)
    for (const b of blocks) {
      expect(b.count).toBeLessThanOrEqual(b.variants.length)
      expect(new Set(b.variants).size).toBe(b.variants.length)
    }
  })

  test('each block has a title, a lead of one to three sentences, and names no persona', () => {
    for (const id of Object.keys(BLOCKS)) {
      const b = readingOf(lessonOf(id))[0]
      expect(b.title.startsWith('Read it in Rust: ')).toBe(true)
      const sentences = b.lead
        .replace(/`[^`]*`/g, 'code')
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean)
      expect(sentences.length).toBeGreaterThanOrEqual(1)
      expect(sentences.length).toBeLessThanOrEqual(3)
      expect(/\b(Wei|persona)\b/.test(b.lead + b.title)).toBe(false)
    }
  })

  test('direct edges are covered, the deferred one is the only gap, and the check bites', () => {
    const plan = pathPlan('serving-first', GRAPH).lessons
    const uncovered = plan.flatMap((id) => {
      const covered = new Set(readingOf(lessonOf(id)).flatMap((b) => b.variants.slice(0, b.count).map((v) => specOf(v)?.kcs[0])))
      return directEdges(lessonOf(id)).filter((kc) => !covered.has(kc)).map((kc) => `${id} ${kc}`)
    })
    expect(uncovered).toEqual(['t0.l2 r.bindings-expressions'])
    // the narrow host rule: t5.l7 reaches enums only, so a smart-pointer block there would be rejected
    expect([...reachable(lessonOf('t5.l7'))]).toEqual(['r.enums-option-result'])
    expect([...reachable(lessonOf('t6.l9'))].sort()).toEqual(['r.enums-option-result', 'r.iterators-ownership'])
    expect(ON_PAGE['t5.l6']).toEqual(['r.closures-collections'])
    expect(reachable(lessonOf('t5.l6')).has('r.closures-collections')).toBe(false)
  })
})

describe("outcomes.ts' literals follow the blocks (SR-08)", () => {
  test('SERVING_READING_HOSTS equals the hosts of the mounted reading blocks', () => {
    const hosts = ALL_LESSONS.filter((l) => readingOf(l).length > 0).map((l) => l.id)
    expect([...SERVING_READING_HOSTS].sort()).toEqual([...hosts].sort())
  })

  test('SERVING_READING_KCS equals READING_KCS, and the blocks draw every one of them', () => {
    expect([...SERVING_READING_KCS]).toEqual([...READING_KCS])
    const drawn = new Set(ALL_LESSONS.flatMap((l) => readingOf(l).flatMap((b) => b.variants.map((v) => specOf(v)?.kcs[0]))))
    expect([...drawn].sort()).toEqual([...READING_KCS].sort())
  })
})
