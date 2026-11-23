/**
 * The placement result's Rust line tells the truth per path (docs/specs/serving-reading.md §5.5, SR-07): serving-first
 * has no Rust Zero lessons to braid in and no test-outs to offer, so its line never promises either and names the
 * reading items inside T5 and T6 instead; the other two paths keep today's wording. A skipped item says "skipped", not
 * "not asked", and a missed anchor's line counts where each Rust Zero lesson sits in the plan (K0-FIX-LEARNER-APP).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { anchorLine } from '../../src/components/learner/anchor-line'
import { KCS } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { pathPlan } from '../../src/lib/learner/paths'
import { rLayerNote } from '../../src/lib/learner/placement'
import type { LearningPath } from '../../src/lib/ledger/types'

const ANCHORS = ['solid', 'missed', 'skipped'] as const
const OTHER: LearningPath[] = ['full-ramp', 'rust-systems']
const GRAPH = { kcs: KCS, lessons: ALL_LESSONS, labs: FORGE_LABS }
const PLAN = { lessons: [] as string[] }
const ANCHOR_MISSED = 'Rust reading: not yet. Rust Zero stays in your plan, braided in just before the lessons that need it.'
const SOLID_NOTE = 'placement found your Rust reading solid: these lessons are not in your plan, and each stays open.'
const SKIPPED_NOTE = 'you skipped the Rust question in placement: these lessons are not in your plan, and each stays open.'
/** Lesson `l` uses Rust Zero lesson `r`: a KC taught in `l` is one `r` introduces, or requires one. Over every lesson, R or T. */
const usesR = (r: string, l: string): boolean => {
  const introduced = new Set(KCS.filter((k) => k.lessons[0] === r).map((k) => k.id))
  return KCS.filter((k) => k.lessons.includes(l)).some((k) => introduced.has(k.id) || k.requires.some((id) => introduced.has(id)))
}
const planFor = (path: LearningPath, entryTrack: 't0' | 't1' | 't2' | 't3' | 't4' | 't5', rustAnchor: (typeof ANCHORS)[number]) => pathPlan(path, GRAPH, { entryTrack, rustAnchor, missedKcs: [] })

describe('anchorLine', () => {
  test('serving-first says its Rust comes as reading items inside T5 and T6, with the spec strings', () => {
    expect(anchorLine('solid', 'serving-first', PLAN)).toBe('Rust reading: solid. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.')
    expect(anchorLine('missed', 'serving-first', PLAN)).toBe(
      'Rust reading: not yet. That is fine on this path: short reading items inside T5 and T6 cover the Rust those lessons use, and Rust Zero stays open in the Curriculum.',
    )
    expect(anchorLine('skipped', 'serving-first', PLAN)).toBe('Rust reading: not asked. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.')
    expect(anchorLine('skipped', 'serving-first', PLAN, false)).toBe('Rust reading: not asked. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.')
  })

  test('serving-first: a learner shown the Rust item who answered "Not sure" reads "skipped", never "not asked"', () => {
    const line = anchorLine('skipped', 'serving-first', PLAN, true)
    expect(line).toBe('Rust reading: skipped. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.')
    expect(line).not.toMatch(/not asked/)
    // shown or not, solid and missed keep the spec strings
    for (const a of ['solid', 'missed'] as const) expect(anchorLine(a, 'serving-first', PLAN, true)).toBe(anchorLine(a, 'serving-first', PLAN, false))
  })

  test('serving-first: "Not sure" after a weak walk is stored as a miss and still reads "skipped" (K0-CLOSE-E)', () => {
    const skipped = 'Rust reading: skipped. This path has no Rust Zero lessons; its Rust comes as short reading items inside T5 and T6.'
    expect(anchorLine('missed', 'serving-first', PLAN, true, true)).toBe(skipped)
    expect(anchorLine('skipped', 'serving-first', PLAN, true, true)).toBe(skipped)
    // a wrong answer is a miss and keeps the spec string
    expect(anchorLine('missed', 'serving-first', PLAN, true, false)).toBe(anchorLine('missed', 'serving-first', PLAN))
    // the other paths read the stored anchor alone: a miss there counts Rust Zero lessons in the plan
    for (const p of OTHER) expect(anchorLine('missed', p, PLAN, true, true)).toBe(anchorLine('missed', p, PLAN, true, false))
  })

  test('serving-first never promises R lessons in the plan or test-outs', () => {
    for (const a of ANCHORS) {
      const line = anchorLine(a, 'serving-first', PLAN)
      expect(line).not.toMatch(/test-out/i)
      expect(line).not.toMatch(/braided|stays in your plan|instead of lessons/i)
      expect(line).toContain('reading items inside T5 and T6')
    }
  })

  test('the other paths say Rust Zero leaves the plan and stays open, with no test-out (no R lesson has a ticket)', () => {
    for (const p of OTHER) {
      expect(anchorLine('solid', p, PLAN)).toBe('Rust reading: solid. Rust Zero is not in your plan; every lesson stays open in the Curriculum.')
      expect(anchorLine('skipped', p, PLAN)).toBe(
        'Rust reading: skipped. The rest of your walk was solid, so Rust Zero is not in your plan; every lesson stays open in the Curriculum.',
      )
    }
  })

  test('while a Rust Zero lesson has no ticket, no Rust line, Curriculum note or pattern sentence promises a test-out', () => {
    const rLessons = ALL_LESSONS.filter((l) => l.trackId === 'r')
    expect(rLessons.length).toBeGreaterThan(0)
    if (rLessons.every((l) => l.ticket)) return
    const entries = ['t0', 't1', 't2', 't3', 't4', 't5'] as const
    for (const p of ['serving-first', ...OTHER] as LearningPath[]) {
      for (const a of ANCHORS) {
        for (const e of entries) {
          const plan = planFor(p, e, a)
          for (const shown of [true, false]) expect(anchorLine(a, p, plan, shown)).not.toMatch(/test.?out/i)
          const note = rLayerNote(a, plan.testOut.length > 0)
          if (note !== null) expect(note).not.toMatch(/test.?out/i)
        }
      }
    }
    for (const a of [...ANCHORS, null, undefined]) for (const t of [true, false]) expect(rLayerNote(a, t) ?? '').not.toMatch(/test.?out/i)
    // the blind-pattern result names the lessons that have a test-out, which Rust Zero's are not
    const walk = readFileSync(join(import.meta.dir, '../../src/components/learner/PlacementWalk.tsx'), 'utf8')
    expect(walk).not.toContain('every lesson has a test-out')
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
    // full ramp with entry T5: two Rust Zero lessons open the plan; of the others, r.l5 and r.l6 come after t5.l2 (the
    // braid's cap slid them forward), r.l3, r.l4, r.l7 and r.l8 come before their first user (r.l3 is used by r.l4, r.l8 by
    // r.l10: later Rust Zero lessons count), and only r.l9 and r.l10 have no lesson in the plan that uses them
    const ramp = planFor('full-ramp', 't5', 'missed')
    expect(ramp.lessons.slice(0, 3)).toEqual(['r.l1', 'r.l2', 't5.l1'])
    const at = (id: string) => ramp.lessons.indexOf(id)
    const firstUser = (r: string) => ramp.lessons.find((l) => l !== r && usesR(r, l)) ?? null
    for (const r of ['r.l5', 'r.l6']) expect(at(r)).toBeGreaterThan(at(firstUser(r) as string))
    for (const r of ['r.l3', 'r.l4', 'r.l7', 'r.l8']) expect(at(r)).toBeLessThan(at(firstUser(r) as string))
    expect(usesR('r.l3', 'r.l4')).toBe(true)
    expect(usesR('r.l8', 'r.l10')).toBe(true)
    for (const r of ['r.l9', 'r.l10']) expect(firstUser(r)).toBeNull()
    expect(anchorLine('missed', 'full-ramp', ramp)).toBe(
      'Rust reading: not yet. Rust Zero stays in your plan: the first 2 Rust Zero lessons open it, 4 come before the first lesson that uses them, 2 come after the first lesson that uses them and 2 are there though no lesson in this plan uses them.',
    )
    // full ramp with entry T4: none opens the plan; r.l9 and r.l10 are the two no lesson in it uses
    const t4 = planFor('full-ramp', 't4', 'missed')
    expect(anchorLine('missed', 'full-ramp', t4)).toBe(
      'Rust reading: not yet. Rust Zero stays in your plan: 8 come before the first lesson that uses them and 2 are there though no lesson in this plan uses them.',
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
      // the first user over every lesson of the plan, R or T, not only the braid's first T user (plan.pairs)
      const userAt = (id: string) => plan.lessons.findIndex((l) => l !== id && usesR(id, l))
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

  test('the Curriculum says placement found Rust solid only for a solid anchor, never for a skipped one', () => {
    expect(rLayerNote('solid', true)).toBe(SOLID_NOTE)
    expect(rLayerNote('skipped', true)).toBe(SKIPPED_NOTE)
    for (const p of OTHER) {
      for (const a of ANCHORS) {
        for (const e of ['t0', 't3', 't5'] as const) {
          const note = rLayerNote(a, planFor(p, e, a).testOut.length > 0)
          if (a === 'solid') expect(note).toBe(SOLID_NOTE)
          else if (a === 'skipped') expect(note).not.toMatch(/solid/)
          else expect(note).toBeNull()
        }
      }
    }
    expect(rLayerNote(null, false)).toBeNull()
    // the Curriculum's Rust Zero layer reads its note from the anchor, not from plan.testOut alone
    const page = readFileSync(join(import.meta.dir, '../../src/pages/Curriculum.tsx'), 'utf8')
    expect(page).toContain('rNote={rLayerNote(placement?.rustAnchor, plan.testOut.length > 0)}')
    expect(page).not.toContain('placement found your Rust reading solid')
  })

  test('no line names a persona', () => {
    for (const p of ['serving-first', ...OTHER] as LearningPath[]) for (const a of ANCHORS) expect(anchorLine(a, p, PLAN)).not.toMatch(/\bWei\b|ML engineer/i)
  })
})
