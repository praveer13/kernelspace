/**
 * The placement result's Rust line tells the truth per path (docs/specs/serving-reading.md §5.5, SR-07): serving-first
 * has no Rust Zero lessons to braid in and no test-outs to offer, so its line never promises either and names the
 * reading items inside T5 and T6 instead; the other two paths keep today's wording.
 */
import { describe, expect, test } from 'bun:test'
import { anchorLine } from '../../src/components/learner/anchor-line'
import type { LearningPath } from '../../src/lib/ledger/types'

const ANCHORS = ['solid', 'missed', 'skipped'] as const
const OTHER: LearningPath[] = ['full-ramp', 'rust-systems']

describe('anchorLine', () => {
  test('serving-first says its Rust comes as reading items inside T5 and T6, with the spec strings', () => {
    expect(anchorLine('solid', 'serving-first')).toBe('Rust reading: solid. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.')
    expect(anchorLine('missed', 'serving-first')).toBe(
      'Rust reading: not yet. That is fine on this path: short reading items inside T5 and T6 cover the Rust those lessons use, and Rust Zero stays open in the Curriculum.',
    )
    expect(anchorLine('skipped', 'serving-first')).toBe('Rust reading: not asked. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.')
  })

  test('serving-first never promises R lessons in the plan or test-outs', () => {
    for (const a of ANCHORS) {
      const line = anchorLine(a, 'serving-first')
      expect(line).not.toMatch(/test-out/i)
      expect(line).not.toMatch(/braided|stays in your plan|instead of lessons/i)
      expect(line).toContain('reading items inside T5 and T6')
    }
  })

  test('the other paths keep their lines, which still name test-outs and the braid', () => {
    for (const p of OTHER) {
      expect(anchorLine('solid', p)).toBe('Rust reading: solid. The Rust Zero lessons are offered as test-outs instead of lessons.')
      expect(anchorLine('missed', p)).toBe('Rust reading: not yet. Rust Zero stays in your plan, braided in just before the lessons that need it.')
      expect(anchorLine('skipped', p)).toBe('Rust reading: not asked. The Rust Zero lessons are offered as test-outs.')
    }
  })

  test('no line names a persona', () => {
    for (const p of ['serving-first', ...OTHER] as LearningPath[]) for (const a of ANCHORS) expect(anchorLine(a, p)).not.toMatch(/\bWei\b|ML engineer/i)
  })
})
