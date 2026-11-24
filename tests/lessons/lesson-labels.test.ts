/**
 * One lesson label, from track membership and position (Wave 1 stage 0, task K1-3, audit O14).
 *
 * Today every lesson's id spells its label and its `index` is the declared position, so the helper reproduces what
 * each surface printed before, except the two that printed a shortened code (the forge readiness list and the error
 * museum's `.L`-stripped id). The fixture is audit O14's move: t6.l12 read after t6.l4 becomes the track's fifth
 * lesson, and every surface that uses the helper follows.
 */
import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { Lesson } from '../../src/data/lessons/types'
import { lessonCode, lessonLabel, lessonLabelIn, lessonPosition, trackCode } from '../../src/lib/lesson-label'

const byId = (id: string): Lesson => {
  const lesson = ALL_LESSONS.find((l) => l.id === id)
  if (!lesson) throw new Error(`no lesson ${id}`)
  return lesson
}

describe('the label rule', () => {
  test('track codes are R and T0 to T7', () => {
    expect(ALL_LESSONS.map((l) => trackCode(l.trackId)).filter((v, i, a) => a.indexOf(v) === i)).toEqual([
      'R',
      'T0',
      'T1',
      'T2',
      'T3',
      'T4',
      'T5',
      'T6',
      'T7',
    ])
  })

  test('the label comes from the track and the position, not from the id spelling', () => {
    expect(lessonLabel({ id: 't6.l12', trackId: 't6', index: 5 })).toBe('T6.L5')
    expect(lessonLabel({ id: 'not.a.lesson', trackId: 'r', index: 4 })).toBe('R.L4')
    expect(lessonPosition({ index: 7 })).toBe('L7')
  })

  test('today every label is the id spelling and the position is the declared index', () => {
    for (const lesson of ALL_LESSONS) {
      expect(lessonLabel(lesson)).toBe(lesson.id.toUpperCase())
      expect(lessonPosition(lesson)).toBe(`L${lesson.index}`)
      expect(lessonCode(lesson.id)).toBe(lessonLabel(lesson))
    }
  })

  test('the registry order already disagrees with the declared ids for t6.l12 and t6.l10, which is audit O14', () => {
    // the track reads l1 ... l9, l12, l10; a position label shows 9, 10, 11 while the ids spell 9, 12, 10
    expect(lessonLabelIn(byId('t6.l12'), ALL_LESSONS)).toBe('T6.L10')
    expect(lessonLabelIn(byId('t6.l10'), ALL_LESSONS)).toBe('T6.L11')
    for (const lesson of ALL_LESSONS.filter((l) => l.id !== 't6.l12' && l.id !== 't6.l10')) {
      expect(lessonLabelIn(lesson, ALL_LESSONS)).toBe(lessonLabel(lesson))
    }
  })
})

describe('the structure release order', () => {
  /** O14's move: t6.l12 read after t6.l4; t6.l10 stays last, the track's spiral. The release also swaps t6.l5 and t6.l6 (O13), which this fixture does not model. */
  const order = (): Pick<Lesson, 'id' | 'trackId'>[] => {
    const list: Pick<Lesson, 'id' | 'trackId'>[] = ALL_LESSONS.map((l) => ({ id: l.id, trackId: l.trackId }))
    const from = list.findIndex((l) => l.id === 't6.l12')
    const [moved] = list.splice(from, 1)
    const at = list.findIndex((l) => l.id === 't6.l4') + 1
    list.splice(at, 0, moved)
    return list
  }

  test('t6.l12 is T6.L5 under the release order, and the lessons it passes shift up by one', () => {
    const list = order()
    expect(lessonLabelIn(byId('t6.l12'), list)).toBe('T6.L5')
    for (const [id, label] of [
      ['t6.l5', 'T6.L6'],
      ['t6.l6', 'T6.L7'],
      ['t6.l9', 'T6.L10'],
      ['t6.l12', 'T6.L5'],
      ['t6.l10', 'T6.L11'],
    ] as const) {
      expect(lessonLabelIn(byId(id), list)).toBe(label)
    }
    // lessons before the move and in other tracks keep their labels
    expect(lessonLabelIn(byId('t6.l4'), list)).toBe('T6.L4')
    expect(lessonLabelIn(byId('t5.l10'), list)).toBe('T5.L10')
  })

  test('a lesson missing from the order keeps its declared label', () => {
    expect(lessonLabelIn(byId('t6.l12'), [])).toBe('T6.L12')
  })
})
