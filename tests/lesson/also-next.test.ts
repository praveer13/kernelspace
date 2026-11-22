import { describe, expect, test } from 'bun:test'
import { alsoNext } from '../../src/pages/lesson/also-next'
import { ALL_LESSONS, nextLesson } from '../../src/data/lessons'

const next = { id: 't5.l2', title: 'Next one' }

describe('alsoNext', () => {
  test('offers the next lesson when the pick is another lesson', () => {
    expect(alsoNext({ kind: 'lesson', ref: 'r.l1' }, next)).toEqual({ lesson: next, label: 'T5.L2 · Next one' })
  })
  test('nothing when the pick is the next lesson', () => {
    expect(alsoNext({ kind: 'lesson', ref: 't5.l2' }, next)).toBeNull()
  })
  test('nothing for a non-lesson pick, no pick, or no next lesson', () => {
    expect(alsoNext({ kind: 'lab', ref: 'x' }, next)).toBeNull()
    expect(alsoNext(null, next)).toBeNull()
    expect(alsoNext({ kind: 'lesson', ref: 'r.l1' }, undefined)).toBeNull()
  })
  test('works on real lessons', () => {
    const l = ALL_LESSONS[0]
    expect(alsoNext({ kind: 'lesson', ref: 'zzz' }, nextLesson(l))?.lesson.id).toBe(ALL_LESSONS[1].id)
  })
})
