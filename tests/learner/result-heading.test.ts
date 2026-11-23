/**
 * The placement result's heading names the track of the plan's first lesson, the same start the button, Today and
 * Up Next name (K0-A2): it used to read the entry track alone, so a missed Rust anchor read "T5" over a "Start at R.L1" button.
 * Its "then" part names the track of the plan's next non-R lesson, never the entry track (K0-FIX-LEARNER-APP): rust-systems has
 * no T0, T4 or T5 lessons, and its heading named them.
 */
import { describe, expect, test } from 'bun:test'
import { resultHeading } from '../../src/components/learner/result-heading'
import { KCS } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { TrackId } from '../../src/data/lessons/types'
import { PATHS, pathPlan, type PathPlacement } from '../../src/lib/learner/paths'
import { getTrack } from '../../src/lib/tracks'

const GRAPH = { kcs: KCS, lessons: ALL_LESSONS, labs: FORGE_LABS }
const TRACKS: TrackId[] = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']
const ANCHORS: PathPlacement['rustAnchor'][] = ['solid', 'missed', 'skipped']
const code = (id: string) => (getTrack(id) as NonNullable<ReturnType<typeof getTrack>>).code
const name = (id: string) => (getTrack(id) as NonNullable<ReturnType<typeof getTrack>>).name

describe('resultHeading', () => {
  test('anchor missed, entry T5, plan opens on a Rust Zero lesson: names Rust Zero and T5', () => {
    const plan = pathPlan('full-ramp', GRAPH, { entryTrack: 't5', rustAnchor: 'missed', missedKcs: [] })
    expect(plan.lessons[0]).toBe('r.l1')
    const h = resultHeading({ entryTrack: 't5', pattern: false, startLessonId: plan.lessons[0], lessons: plan.lessons })
    expect(h).toBe(`Start with ${code('r')} · ${name('r')}, then ${code('t5')} · ${name('t5')}`)
  })

  test('anchor solid or skipped, entry T5: the entry track only', () => {
    for (const rustAnchor of ['solid', 'skipped'] as const) {
      const plan = pathPlan('full-ramp', GRAPH, { entryTrack: 't5', rustAnchor, missedKcs: [] })
      const h = resultHeading({ entryTrack: 't5', pattern: false, startLessonId: plan.lessons[0], lessons: plan.lessons })
      expect(h).toBe(`Start at ${code('t5')} · ${name('t5')}`)
    }
  })

  test('a blind-answering pattern starts at the beginning', () => {
    expect(resultHeading({ entryTrack: 't5', pattern: true, startLessonId: 'r.l1', lessons: ['r.l1', 't0.l1'] })).toBe('Start at the beginning')
  })

  test('no lesson left to start falls back to the entry track when the plan has it', () => {
    expect(resultHeading({ entryTrack: 't5', pattern: false, startLessonId: null, lessons: ['t5.l1'] })).toBe(`Start at ${code('t5')} · ${name('t5')}`)
    expect(resultHeading({ entryTrack: 't5', pattern: false, startLessonId: null, lessons: ['r.l1', 't1.l1'] })).toBe(`Start at ${code('r')} · ${name('r')}`)
  })

  test('an empty plan names no track', () => {
    const plan = pathPlan('rust-systems', GRAPH, { entryTrack: 't5', rustAnchor: 'solid', missedKcs: [] })
    expect(plan.lessons).toEqual([])
    expect(resultHeading({ entryTrack: 't5', pattern: false, startLessonId: null, lessons: plan.lessons })).toBe('Your placement skips every lesson on this path')
  })

  test('rust-systems, anchor missed: the "then" track is the next track in the plan, and the ten-lesson plan names Rust Zero alone', () => {
    const early = pathPlan('rust-systems', GRAPH, { entryTrack: 't0', rustAnchor: 'missed', missedKcs: [] })
    expect(early.lessons.some((id) => id.startsWith('t0.'))).toBe(false)
    expect(resultHeading({ entryTrack: 't0', pattern: false, startLessonId: early.lessons[0], lessons: early.lessons })).toBe(`Start with ${code('r')} · ${name('r')}, then ${code('t1')} · ${name('t1')}`)
    for (const entryTrack of ['t4', 't5'] as const) {
      const late = pathPlan('rust-systems', GRAPH, { entryTrack, rustAnchor: 'missed', missedKcs: [] })
      expect(late.lessons.every((id) => id.startsWith('r.'))).toBe(true)
      expect(resultHeading({ entryTrack, pattern: false, startLessonId: late.lessons[0], lessons: late.lessons })).toBe(`Start with ${code('r')} · ${name('r')}`)
    }
  })

  test('the "then" track follows the lesson the learner starts at, not the head of the plan', () => {
    const plan = pathPlan('rust-systems', GRAPH, { entryTrack: 't1', rustAnchor: 'missed', missedKcs: [] })
    expect(resultHeading({ entryTrack: 't1', pattern: false, startLessonId: 'r.l6', lessons: plan.lessons })).toBe(`Start with ${code('r')} · ${name('r')}, then ${code('t2')} · ${name('t2')}`)
  })

  test('for every path, entry track and anchor the heading names the track of plan.lessons[0]', () => {
    let checked = 0
    for (const path of PATHS)
      for (const entryTrack of TRACKS)
        for (const rustAnchor of ANCHORS)
          for (const missedKcs of [[], ['t1.external-frag', 'r.borrow-rules']]) {
            const plan = pathPlan(path, GRAPH, { entryTrack, rustAnchor, missedKcs })
            const first = plan.lessons[0]
            if (!first) continue
            const h = resultHeading({ entryTrack, pattern: false, startLessonId: first, lessons: plan.lessons })
            const track = first.split('.')[0]
            expect({ path, entryTrack, rustAnchor, named: h.includes(`${code(track)} · ${name(track)}`) }).toEqual({ path, entryTrack, rustAnchor, named: true })
            // every track the heading names has a lesson in the plan
            const inPlan = new Set(plan.lessons.map((id) => id.split('.')[0]))
            const absent = ['r', ...TRACKS].filter((t) => !inPlan.has(t) && h.includes(`${code(t)} · ${name(t)}`))
            expect({ path, entryTrack, rustAnchor, absent }).toEqual({ path, entryTrack, rustAnchor, absent: [] })
            // a plan that opens on Rust Zero names the track of its first other lesson, or Rust Zero alone
            const next = plan.lessons.find((id) => !id.startsWith('r.'))?.split('.')[0]
            if (track === 'r' && track !== entryTrack) expect(h).toBe(next ? `Start with ${code('r')} · ${name('r')}, then ${code(next)} · ${name(next)}` : `Start with ${code('r')} · ${name('r')}`)
            checked++
          }
    expect(checked).toBeGreaterThan(100)
  })
})
