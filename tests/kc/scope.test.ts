/**
 * Wave 1 content scope (docs/specs/wave-1.md §4.7, §8.1, §9.1; task B25): the lessons that opted in as their content tasks
 * landed are now all of them. All 29 R and T0-T2 lessons set `kcs` (every id a real KC that lists the lesson), the 19 T0-T2
 * lessons carry a ticket (t2.l7 the spiral), and the 12 T0-T1 lessons open with a `predict` block of prequestions.
 */
import { describe, expect, test } from 'bun:test'
import { kcById } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { Lesson, TrackId } from '../../src/data/lessons/types'

const inTracks = (...tracks: TrackId[]): Lesson[] => ALL_LESSONS.filter((l) => tracks.includes(l.trackId))

const SCOPE = inTracks('r', 't0', 't1', 't2')
const TICKETED = inTracks('t0', 't1', 't2')
const PREDICTED = inTracks('t0', 't1')

describe('Wave 1 content scope', () => {
  test('there are 29 R and T0-T2 lessons, 19 of them T0-T2 and 12 of those T0-T1', () => {
    expect(SCOPE).toHaveLength(29)
    expect(inTracks('r')).toHaveLength(10)
    expect(TICKETED).toHaveLength(19)
    expect(PREDICTED).toHaveLength(12)
  })

  for (const l of SCOPE) {
    test(`${l.id} sets kcs, and each names a KC that lists this lesson`, () => {
      expect(l.kcs?.length ?? 0).toBeGreaterThanOrEqual(1)
      expect(new Set(l.kcs).size).toBe(l.kcs?.length ?? 0)
      for (const id of l.kcs ?? []) {
        const kc = kcById(id)
        expect(kc).toBeDefined()
        expect(kc?.lessons).toContain(l.id)
      }
    })
  }

  for (const l of TICKETED) {
    test(`${l.id} has a ${l.id === 't2.l7' ? 'spiral checkpoint' : 'ticket'} and a quiz block for it to draw on`, () => {
      expect(l.ticket?.form).toBe(l.id === 't2.l7' ? 'spiral' : 'ticket')
      expect(l.blocks.some((b) => b.type === 'quiz')).toBe(true)
    })
  }

  for (const l of PREDICTED) {
    test(`${l.id} has one predict block with at least one prequestion`, () => {
      const blocks = l.blocks.flatMap((b) => (b.type === 'predict' ? [b] : []))
      expect(blocks).toHaveLength(1)
      expect(blocks[0].items.length).toBeGreaterThanOrEqual(1)
    })
  }

  test('T3-T7 keep the checkpoint until Wave 2: none has a ticket', () => {
    for (const l of inTracks('t3', 't4', 't5', 't6', 't7')) expect(l.ticket).toBeUndefined()
  })
})
