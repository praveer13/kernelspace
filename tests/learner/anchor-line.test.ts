/**
 * The placement result's Rust line tells the truth per path (docs/specs/serving-reading.md §5.5, SR-07): serving-first
 * has no Rust Zero lessons to braid in and no test-outs to offer, so its line never promises either and names the
 * reading items inside T5 and T6 instead; the other two paths keep today's wording.
 */
import { describe, expect, test } from 'bun:test'
import { anchorLine } from '../../src/components/learner/anchor-line'
import { KCS } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { pathPlan } from '../../src/lib/learner/paths'
import type { LearningPath } from '../../src/lib/ledger/types'

const ANCHORS = ['solid', 'missed', 'skipped'] as const
const OTHER: LearningPath[] = ['full-ramp', 'rust-systems']
const GRAPH = { kcs: KCS, lessons: ALL_LESSONS, labs: FORGE_LABS }
const PLAN = { lessons: [] as string[] }
const planFor = (path: LearningPath, entryTrack: 't0' | 't5', rustAnchor: (typeof ANCHORS)[number]) => pathPlan(path, GRAPH, { entryTrack, rustAnchor, missedKcs: [] })

describe('anchorLine', () => {
  test('serving-first says its Rust comes as reading items inside T5 and T6, with the spec strings', () => {
    expect(anchorLine('solid', 'serving-first', PLAN)).toBe('Rust reading: solid. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.')
    expect(anchorLine('missed', 'serving-first', PLAN)).toBe(
      'Rust reading: not yet. That is fine on this path: short reading items inside T5 and T6 cover the Rust those lessons use, and Rust Zero stays open in the Curriculum.',
    )
    expect(anchorLine('skipped', 'serving-first', PLAN)).toBe('Rust reading: not asked. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.')
  })

  test('serving-first never promises R lessons in the plan or test-outs', () => {
    for (const a of ANCHORS) {
      const line = anchorLine(a, 'serving-first', PLAN)
      expect(line).not.toMatch(/test-out/i)
      expect(line).not.toMatch(/braided|stays in your plan|instead of lessons/i)
      expect(line).toContain('reading items inside T5 and T6')
    }
  })

  test('the other paths keep their test-out lines, which still name test-outs', () => {
    for (const p of OTHER) {
      expect(anchorLine('solid', p, PLAN)).toBe('Rust reading: solid. The Rust Zero lessons are offered as test-outs instead of lessons.')
      expect(anchorLine('skipped', p, PLAN)).toBe('Rust reading: not asked. The Rust Zero lessons are offered as test-outs.')
    }
  })

  test('a missed anchor states the order the plan really has, counted from plan.lessons', () => {
    // rust-systems with entry T5: no T5 lesson on the path, all ten Rust Zero lessons are the whole plan
    const all = planFor('rust-systems', 't5', 'missed')
    const n = all.lessons.filter((id) => id.startsWith('r.')).length
    expect(anchorLine('missed', 'rust-systems', all)).toBe(`Rust reading: not yet. Rust Zero stays in your plan, and all ${n} Rust Zero lessons come first.`)
    // full ramp with entry T5: two Rust Zero lessons open the plan, the rest are braided between T5 lessons
    const ramp = planFor('full-ramp', 't5', 'missed')
    expect(ramp.lessons.slice(0, 3)).toEqual(['r.l1', 'r.l2', 't5.l1'])
    expect(anchorLine('missed', 'full-ramp', ramp)).toBe(
      `Rust reading: not yet. Rust Zero stays in your plan: the first 2 Rust Zero lessons open it, and the other ${n - 2} follow later, before the lessons that need them.`,
    )
    // full ramp with entry T0: the braid opens with T0.L1, so the original sentence is true
    expect(anchorLine('missed', 'full-ramp', planFor('full-ramp', 't0', 'missed'))).toBe('Rust reading: not yet. Rust Zero stays in your plan, braided in just before the lessons that need it.')
  })

  test('a missed line never says "braided" when Rust Zero lessons open the plan', () => {
    for (const p of OTHER) expect(anchorLine('missed', p, planFor(p, 't5', 'missed'))).not.toMatch(/braided/)
  })

  test('no line names a persona', () => {
    for (const p of ['serving-first', ...OTHER] as LearningPath[]) for (const a of ANCHORS) expect(anchorLine(a, p, PLAN)).not.toMatch(/\bWei\b|ML engineer/i)
  })
})
