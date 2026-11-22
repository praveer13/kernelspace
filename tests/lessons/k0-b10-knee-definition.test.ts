import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import { kneeExercise } from '@/lib/world/fleet-ex/knee'

const lesson = ALL_LESSONS.find((l) => l.id === 't7.l2')
if (!lesson) throw new Error('t7.l2 not found')

describe('t7.l2 keeps one definition of the knee (K0-B10)', () => {
  test('the Fleet exercise block and definition are titled for the goodput peak, not the knee', () => {
    const block = lesson.blocks.find((b) => b.type === 'exercise' && (b as { fleet?: string }).fleet === 'knee') as
      | { title: string }
      | undefined
    expect(block).toBeDefined()
    expect(block!.title.toLowerCase()).not.toContain('knee')
    expect(block!.title).toContain('goodput peak')
    expect(kneeExercise.title.toLowerCase()).not.toContain('knee')
    expect(kneeExercise.unit).toContain('goodput peaks')
    expect(kneeExercise.id).toBe('knee')
  })

  test('no t7.l2 prose defines the knee as the failing step', () => {
    const text = JSON.stringify(lesson)
    expect(text).not.toMatch(/knee[^.]{0,40}violate/i)
    expect(text).not.toContain('where the SLO first breaks')
    expect(text).toContain('the knee, the highest step that still meets the SLO')
  })
})
