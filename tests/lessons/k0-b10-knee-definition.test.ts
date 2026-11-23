import { describe, expect, test } from 'bun:test'
import { ALL_LESSONS } from '@/data/lessons'
import { kneeExercise } from '@/lib/world/fleet-ex/knee'
import { PRODUCTION_ROWS } from '@/components/fleet-ex/session'

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

  // K0-FIX-T7: the exercise grades the goodput peak, and the knee sits at or below it, so the copy around the graded
  // round names the peak where it means the peak.
  test('the note after the graded round puts the goodput peak, not the knee, at one of the four interior loads', () => {
    const block = lesson.blocks.find((b) => b.type === 'exercise' && (b as { fleet?: string }).fleet === 'knee') as
      | { note?: string }
      | undefined
    expect(block?.note).toBeDefined()
    expect(block!.note).not.toMatch(/its knee at one of/)
    expect(block!.note).toContain('Each seed puts its goodput peak at one of four loads')
    expect(block!.note).toContain('The knee, the highest step that still meets the SLO, sits at or below the peak.')
  })

  test('the IN PRODUCTION rows say the goodput peak falls inside the six multipliers', () => {
    const tails = Object.values(PRODUCTION_ROWS).map((r) => r.tail)
    for (const t of tails) expect(t).not.toContain('knee falls inside')
    expect(PRODUCTION_ROWS['production.vllm.max-num-seqs'].tail).toContain('so that the goodput peak falls inside the six multipliers')
  })
})
