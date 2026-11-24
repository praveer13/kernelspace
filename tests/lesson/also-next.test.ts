import { describe, expect, test } from 'bun:test'
import { alsoNext } from '../../src/pages/lesson/also-next'
import { ALL_LESSONS, nextLesson } from '../../src/data/lessons'

const here = { id: 't5.l1', title: 'This one', trackId: 't5' }
const next = { id: 't5.l2', title: 'Next one', trackId: 't5' }

describe('alsoNext', () => {
  test('offers the next lesson when the pick is another lesson', () => {
    expect(alsoNext({ kind: 'lesson', ref: 'r.l1' }, here, next)).toEqual({
      lesson: next,
      lead: 'Or continue the track',
      label: 'T5.L2 · Next one',
    })
  })
  test('nothing when the pick is the next lesson', () => {
    expect(alsoNext({ kind: 'lesson', ref: 't5.l2' }, here, next)).toBeNull()
  })
  test('nothing for a non-lesson pick, no pick, or no next lesson', () => {
    expect(alsoNext({ kind: 'lab', ref: 'x' }, here, next)).toBeNull()
    expect(alsoNext(null, here, next)).toBeNull()
    expect(alsoNext({ kind: 'lesson', ref: 'r.l1' }, here, undefined)).toBeNull()
  })
  test('works on real lessons', () => {
    const l = ALL_LESSONS[0]
    expect(alsoNext({ kind: 'lesson', ref: 'zzz' }, l, nextLesson(l))?.lesson.id).toBe(ALL_LESSONS[1].id)
  })
  test('at the end of a track it says the next lesson opens the next track, never "continue the track"', () => {
    const ends = ALL_LESSONS.filter((l) => {
      const n = nextLesson(l)
      return n !== undefined && n.trackId !== l.trackId
    })
    expect(ends.length).toBeGreaterThan(0)
    for (const l of ends) {
      const also = alsoNext({ kind: 'lesson', ref: 'zzz' }, l, nextLesson(l))
      expect(also?.lead).toBe('Or go on to the next track')
    }
    const t4l7 = ALL_LESSONS.find((l) => l.id === 't4.l7')!
    expect(alsoNext({ kind: 'lesson', ref: 't0.l1' }, t4l7, nextLesson(t4l7))?.lead).not.toBe('Or continue the track')
  })
  test('inside a track it says continue the track', () => {
    for (const l of ALL_LESSONS) {
      const n = nextLesson(l)
      if (!n || n.trackId !== l.trackId) continue
      expect(alsoNext({ kind: 'lesson', ref: 'zzz' }, l, n)?.lead).toBe('Or continue the track')
    }
  })
})
