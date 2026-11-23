/**
 * The placement result's Rust line tells the truth per path (docs/specs/serving-reading.md §5.5, SR-07): serving-first
 * has no Rust Zero lessons to braid in and no test-outs to offer, so its line never promises either and names the
 * reading items inside T5 and T6 instead; the other two paths keep today's wording. A skipped item says "skipped", not
 * "not asked", and a missed anchor's line counts where each Rust Zero lesson sits in the plan (K0-FIX-LEARNER-APP).
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
const ANCHOR_MISSED = 'Rust reading: not yet. Rust Zero stays in your plan, braided in just before the lessons that need it.'
const planFor = (path: LearningPath, entryTrack: 't0' | 't1' | 't2' | 't3' | 't4' | 't5', rustAnchor: (typeof ANCHORS)[number]) => pathPlan(path, GRAPH, { entryTrack, rustAnchor, missedKcs: [] })

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
      expect(anchorLine('skipped', p, PLAN)).toBe(
        'Rust reading: skipped. The Rust Zero lessons are offered as test-outs, and each one is still in the Curriculum to take as a lesson.',
      )
    }
  })

  test('the learner who skipped the Rust item on a path with Rust Zero is never told it was not asked', () => {
    for (const p of OTHER) expect(anchorLine('skipped', p, PLAN)).not.toMatch(/not asked/)
  })

  test('a missed anchor states the order the plan really has, counted from plan.lessons', () => {
    // rust-systems with entry T5: no T5 lesson on the path, all ten Rust Zero lessons are the whole plan, and nothing follows them
    const all = planFor('rust-systems', 't5', 'missed')
    const n = all.lessons.filter((id) => id.startsWith('r.')).length
    expect(all.lessons.length).toBe(n)
    expect(anchorLine('missed', 'rust-systems', all)).toBe(`Rust reading: not yet. Your plan is the ${n} Rust Zero lessons.`)
    // rust-systems with entry T2: all ten come first, and T2 follows them
    const first = planFor('rust-systems', 't2', 'missed')
    expect(first.lessons.slice(0, n).every((id) => id.startsWith('r.'))).toBe(true)
    expect(anchorLine('missed', 'rust-systems', first)).toBe(`Rust reading: not yet. Rust Zero stays in your plan, and all ${n} Rust Zero lessons come first.`)
    // rust-systems with entry T1: five open the plan, the other five follow the T1 lessons
    const half = planFor('rust-systems', 't1', 'missed')
    expect(half.lessons.slice(0, 6)).toEqual(['r.l1', 'r.l2', 'r.l3', 'r.l4', 'r.l5', 't1.l1'])
    expect(anchorLine('missed', 'rust-systems', half)).toBe('Rust reading: not yet. Rust Zero stays in your plan: the first 5 Rust Zero lessons open it and the other 5 come after the T1 lessons.')
    // full ramp with entry T5: two Rust Zero lessons open the plan; of the others, r.l7 comes before t5.l5, r.l5 and r.l6
    // come after t5.l2 (the braid's cap slid them forward), and nothing in a T5-T7 plan uses r.l3, r.l4, r.l8, r.l9 or r.l10
    const ramp = planFor('full-ramp', 't5', 'missed')
    expect(ramp.lessons.slice(0, 3)).toEqual(['r.l1', 'r.l2', 't5.l1'])
    const at = (id: string) => ramp.lessons.indexOf(id)
    const userOf = (r: string) => ramp.pairs.find((p) => p.r === r)?.t ?? null
    expect(at('r.l7')).toBeLessThan(at(userOf('r.l7') as string))
    for (const r of ['r.l5', 'r.l6']) expect(at(r)).toBeGreaterThan(at(userOf(r) as string))
    for (const r of ['r.l3', 'r.l4', 'r.l8', 'r.l9', 'r.l10']) expect(userOf(r)).toBeNull()
    expect(anchorLine('missed', 'full-ramp', ramp)).toBe(
      'Rust reading: not yet. Rust Zero stays in your plan: the first 2 Rust Zero lessons open it, 1 comes before the first lesson that uses it, 2 come after the first lesson that uses them and 5 are there though no lesson in this plan uses them.',
    )
    // full ramp with entry T4: none opens the plan, and six have no lesson in it that uses them, so the line is not the braid sentence
    const t4 = planFor('full-ramp', 't4', 'missed')
    expect(anchorLine('missed', 'full-ramp', t4)).toBe(
      'Rust reading: not yet. Rust Zero stays in your plan: 4 come before the first lesson that uses them and 6 are there though no lesson in this plan uses them.',
    )
    // full ramp with entry T0: the braid opens with T0.L1, so the original sentence is true
    expect(anchorLine('missed', 'full-ramp', planFor('full-ramp', 't0', 'missed'))).toBe(ANCHOR_MISSED)
  })

  test('on the full ramp the missed line counts each Rust Zero lesson where the plan puts it, for every entry track', () => {
    const num = (line: string, re: RegExp) => Number(line.match(re)?.[1] ?? 0)
    for (const entryTrack of ['t0', 't1', 't2', 't3', 't4', 't5'] as const) {
      const plan = planFor('full-ramp', entryTrack, 'missed')
      const line = anchorLine('missed', 'full-ramp', plan)
      const at = (id: string) => plan.lessons.indexOf(id)
      const r = plan.lessons.filter((id) => id.startsWith('r.'))
      const lead = plan.lessons.findIndex((id) => !id.startsWith('r.'))
      const later = r.filter((id) => at(id) >= lead)
      const userAt = (id: string) => {
        const t = plan.pairs.find((p) => p.r === id)?.t
        return t ? at(t) : -1
      }
      const before = later.filter((id) => userAt(id) > at(id)).length
      const after = later.filter((id) => userAt(id) >= 0 && userAt(id) < at(id)).length
      const unused = later.filter((id) => userAt(id) < 0).length
      if (line === ANCHOR_MISSED) {
        // the braid sentence only where it is true: nothing opens the plan, and every one comes before the lesson that uses it
        expect({ entryTrack, lead, after, unused }).toEqual({ entryTrack, lead: 0, after: 0, unused: 0 })
        continue
      }
      expect({ entryTrack, lead: num(line, /the first (\d+) Rust Zero/), before: num(line, /(\d+) comes? before/), after: num(line, /(\d+) comes? after/), unused: num(line, /(\d+) (?:is|are) there/) }).toEqual({
        entryTrack,
        lead,
        before,
        after,
        unused,
      })
    }
  })

  test('a missed line never says "braided" when Rust Zero lessons open the plan', () => {
    for (const p of OTHER) expect(anchorLine('missed', p, planFor(p, 't5', 'missed'))).not.toMatch(/braided/)
  })

  test('no line names a persona', () => {
    for (const p of ['serving-first', ...OTHER] as LearningPath[]) for (const a of ANCHORS) expect(anchorLine(a, p, PLAN)).not.toMatch(/\bWei\b|ML engineer/i)
  })
})
