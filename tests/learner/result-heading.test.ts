/**
 * The placement result's heading names the track of the plan's first lesson, the same start the button, Today and
 * Up Next name (K0-A2): it used to read the entry track alone, so a missed Rust anchor read "T5" over a "Start at R.L1" button.
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
    const h = resultHeading({ entryTrack: 't5', pattern: false, startLessonId: plan.lessons[0] })
    expect(h).toBe(`Start with ${code('r')} · ${name('r')}, then ${code('t5')} · ${name('t5')}`)
  })

  test('anchor solid or skipped, entry T5: the entry track only', () => {
    for (const rustAnchor of ['solid', 'skipped'] as const) {
      const plan = pathPlan('full-ramp', GRAPH, { entryTrack: 't5', rustAnchor, missedKcs: [] })
      const h = resultHeading({ entryTrack: 't5', pattern: false, startLessonId: plan.lessons[0] })
      expect(h).toBe(`Start at ${code('t5')} · ${name('t5')}`)
    }
  })

  test('a blind-answering pattern starts at the beginning', () => {
    expect(resultHeading({ entryTrack: 't5', pattern: true, startLessonId: 'r.l1' })).toBe('Start at the beginning')
  })

  test('an empty plan falls back to the entry track', () => {
    expect(resultHeading({ entryTrack: 't5', pattern: false, startLessonId: null })).toBe(`Start at ${code('t5')} · ${name('t5')}`)
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
            const h = resultHeading({ entryTrack, pattern: false, startLessonId: first })
            const track = first.split('.')[0]
            expect({ path, entryTrack, rustAnchor, named: h.includes(`${code(track)} · ${name(track)}`) }).toEqual({ path, entryTrack, rustAnchor, named: true })
            if (track !== entryTrack && track === 'r') expect(h).toContain(`${code(entryTrack)} · ${name(entryTrack)}`)
            checked++
          }
    expect(checked).toBeGreaterThan(100)
  })
})
