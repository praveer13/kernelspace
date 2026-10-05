import { describe, expect, test } from 'bun:test'
import { KCS } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { TrackId } from '../../src/data/lessons/types'
import type { Kc } from '../../src/lib/kc/types'
import {
  MAX_R_RUN,
  PATHS,
  braid,
  cachedPathPlan,
  labOfStep,
  labStep,
  pathOf,
  pathPlan,
  type PathGraph,
  type PathPlacement,
} from '../../src/lib/learner/paths'
import type { LearningPath } from '../../src/lib/ledger/types'

const GRAPH: PathGraph = { kcs: KCS, lessons: ALL_LESSONS, labs: FORGE_LABS }
const trackOf = (id: string) => id.split('.')[0]
const isR = (id: string) => trackOf(id) === 'r'
const R_LESSONS = ALL_LESSONS.filter((l) => l.trackId === 'r').map((l) => l.id)
const TRACKS: TrackId[] = ['r', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']
const ANCHORS: PathPlacement['rustAnchor'][] = ['solid', 'missed', 'skipped']

/** Longest run of consecutive R lessons in a lesson sequence. */
function longestRRun(lessons: readonly string[]): number {
  let run = 0
  let best = 0
  for (const id of lessons) {
    run = isR(id) ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

/** The first lesson of `order` after `r` whose KCs need a KC `r` introduces (directly or by revisiting it). */
function firstDependant(kcs: readonly Kc[], r: string, order: readonly string[]): string | null {
  const intro = new Set(kcs.filter((k) => k.lessons[0] === r).map((k) => k.id))
  for (const id of order) {
    if (isR(id)) continue
    const needs = kcs.some((k) => k.lessons.includes(id) && (intro.has(k.id) || k.requires.some((q) => intro.has(q))))
    if (needs) return id
  }
  return null
}

/** Every placement a walk can produce, coarsely: each entry track, anchor state, and no or one missed core KC. */
function placements(): PathPlacement[] {
  const out: PathPlacement[] = []
  const missedSets = [[], ['t0.locality'], ['t1.external-frag'], ['t2.address-translation'], ['t1.external-frag', 'r.borrow-rules']]
  for (const entryTrack of TRACKS.slice(1)) for (const rustAnchor of ANCHORS) for (const missedKcs of missedSets) out.push({ entryTrack, rustAnchor, missedKcs })
  return out
}

/* ------------------------------------------------------------------ */
/* The approved braid (Opus first, B22)                                */
/* ------------------------------------------------------------------ */

/**
 * The full-ramp braid for R + T0-T2, generated from the KC graph and approved for the UI (B22). A graph
 * change that moves an R lesson fails here: print the new braid, review it, then update this list.
 */
const APPROVED_BRAID = [
  't0.l1', 'r.l1', 't0.l2', 'r.l2', 't0.l3', 't0.l4', 'r.l3', 't0.l5', 't0.l6',
  't1.l1', 'r.l4', 't1.l2', 'r.l5', 't1.l3', 't1.l4', 't1.l5', 't1.l6',
  'r.l6', 't2.l1', 'r.l7', 't2.l2', 't2.l3', 't2.l4', 'r.l8', 'r.l10', 't2.l5', 'r.l9', 't2.l6', 't2.l7',
]

describe('the full-ramp braid', () => {
  const plan = pathPlan('full-ramp', GRAPH)
  const head = plan.lessons.filter((id) => ['r', 't0', 't1', 't2'].includes(trackOf(id)))

  test('prints the braid for R + T0-T2 with the edge each R lesson pairs on', () => {
    const lines = plan.pairs.map((p) => `  ${p.r.padEnd(5)} before ${String(p.t).padEnd(5)} ${p.via ? `${p.via.kc} requires ${p.via.needs}` : '(no dependant)'}${p.slid ? ' [slid by the cap]' : ''}`)
    console.log(`full-ramp braid (R + T0-T2):\n  ${head.join(' ')}\n${lines.join('\n')}`)
    expect(head).toEqual(APPROVED_BRAID)
  })

  test('the rest of the ramp is T3-T7 in curriculum order', () => {
    const rest = ALL_LESSONS.filter((l) => !['r', 't0', 't1', 't2'].includes(l.trackId)).map((l) => l.id)
    expect(plan.lessons.slice(head.length)).toEqual(rest)
    expect(plan.lessons.length).toBe(ALL_LESSONS.length)
    expect(new Set(plan.lessons).size).toBe(plan.lessons.length)
  })

  test('every R lesson sits immediately before its first dependant, never more than two in a row', () => {
    expect(longestRRun(plan.lessons)).toBeLessThanOrEqual(MAX_R_RUN)
    for (const p of plan.pairs) {
      expect(p.t).not.toBeNull()
      expect(p.slid).toBe(false)
      const at = plan.lessons.indexOf(p.r)
      const dep = plan.lessons.indexOf(p.t as string)
      expect(at).toBeLessThan(dep)
      // only R lessons (at most one other) stand between an R lesson and its first dependant
      expect(plan.lessons.slice(at + 1, dep).every(isR)).toBe(true)
      // and no T lesson earlier in the plan needs it
      expect(firstDependant(KCS, p.r, plan.lessons)).toBe(p.t)
    }
  })

  test('the pairing edges include the ones the spec names (§4.3)', () => {
    const pairOf = (r: string) => plan.pairs.find((p) => p.r === r)
    expect(pairOf('r.l1')?.via).toEqual({ kc: 't0.cache-lines', needs: 'r.bindings-expressions' })
    // t1.ownership-answer requires r.ownership-moves, but T0.L5 needs R.L3 first
    expect(plan.lessons.indexOf('r.l3')).toBeLessThan(plan.lessons.indexOf('t1.l6'))
  })

  test('respects every prerequisite edge: no KC comes before a KC it requires', () => {
    for (const path of PATHS) {
      const p = pathPlan(path, GRAPH)
      const at = new Map(p.lessons.map((id, i) => [id, i]))
      const intro = new Map(KCS.map((k) => [k.id, k.lessons[0]]))
      for (const k of KCS) {
        const here = at.get(k.lessons[0])
        if (here === undefined) continue
        for (const q of k.requires) {
          const there = at.get(intro.get(q) ?? '')
          if (there !== undefined) expect({ kc: k.id, ok: there <= here }).toEqual({ kc: k.id, ok: true })
        }
      }
    }
  })

  test('labs follow their host lesson once the readiness lessons are in', () => {
    const at = (step: string) => plan.steps.indexOf(step)
    expect(plan.steps.filter((s) => labOfStep(s)).length).toBe(FORGE_LABS.length)
    for (const lab of FORGE_LABS) {
      const pos = at(labStep(lab.id))
      expect(pos).toBeGreaterThan(at(lab.lessonId))
      for (const r of lab.readiness?.lessonIds ?? []) expect(pos).toBeGreaterThan(at(r))
    }
    expect(plan.steps.slice(at('t1.l3'), at('t1.l3') + 2)).toEqual(['t1.l3', 'lab:rust-allocator'])
    expect(plan.steps.slice(at('t2.l5'), at('t2.l5') + 2)).toEqual(['t2.l5', 'lab:mpmc-queue'])
  })
})

describe('braid() on fixtures', () => {
  const kc = (id: string, lessons: string[], requires: string[] = []): Kc => ({
    id,
    title: id,
    can: `You can ${id}`,
    track: id.split('.')[0] as TrackId,
    kind: 'concept',
    lessons,
    requires,
    since: '2026-10-05',
  })

  test('three R lessons due before one T lesson: the earliest slides back, still ahead of its dependant', () => {
    const kcs = [
      kc('r.a', ['r.l1']),
      kc('r.b', ['r.l2']),
      kc('r.c', ['r.l3']),
      kc('t0.x', ['t0.l1']),
      kc('t0.y', ['t0.l2'], ['r.a', 'r.b', 'r.c']),
    ]
    const b = braid(kcs, ['r.l1', 'r.l2', 'r.l3'], ['t0.l1', 't0.l2'])
    expect(b.lessons).toEqual(['r.l1', 't0.l1', 'r.l2', 'r.l3', 't0.l2'])
    expect(b.pairs.map((p) => [p.r, p.t, p.slid])).toEqual([['r.l1', 't0.l2', true], ['r.l2', 't0.l2', false], ['r.l3', 't0.l2', false]])
  })

  test('a long run in front of the first T lesson slides forward only as far as it must', () => {
    const kcs = [kc('r.a', ['r.l1']), kc('r.b', ['r.l2']), kc('r.c', ['r.l3']), kc('t0.y', ['t0.l1'], ['r.a', 'r.b', 'r.c']), kc('t0.z', ['t0.l2'])]
    const b = braid(kcs, ['r.l1', 'r.l2', 'r.l3'], ['t0.l1', 't0.l2'])
    expect(b.lessons).toEqual(['r.l1', 'r.l2', 't0.l1', 'r.l3', 't0.l2'])
    expect(longestRRun(b.lessons)).toBe(2)
  })

  test('an R lesson moves ahead of a later R lesson that builds on it', () => {
    const kcs = [kc('r.a', ['r.l1']), kc('r.b', ['r.l2'], ['r.a']), kc('t0.x', ['t0.l1'], ['r.b']), kc('t0.y', ['t0.l2'], ['r.a']), kc('t0.z', ['t0.l3'])]
    const b = braid(kcs, ['r.l1', 'r.l2'], ['t0.l1', 't0.l2', 't0.l3'])
    expect(b.lessons).toEqual(['r.l1', 'r.l2', 't0.l1', 't0.l2', 't0.l3'])
  })

  test('R lessons nobody needs follow the next R lesson instead of trailing the ramp', () => {
    const kcs = [kc('r.a', ['r.l1']), kc('r.b', ['r.l2']), kc('t0.x', ['t0.l1']), kc('t0.y', ['t0.l2'], ['r.b'])]
    expect(braid(kcs, ['r.l1', 'r.l2'], ['t0.l1', 't0.l2']).lessons).toEqual(['t0.l1', 'r.l1', 'r.l2', 't0.l2'])
    // the last R lesson with no dependant goes after the last T lesson
    expect(braid([kc('r.a', ['r.l1']), kc('t0.x', ['t0.l1'])], ['r.l1'], ['t0.l1']).lessons).toEqual(['t0.l1', 'r.l1'])
  })

  test('is deterministic', () => {
    expect(braid(KCS, R_LESSONS, ALL_LESSONS.filter((l) => l.trackId !== 'r').map((l) => l.id))).toEqual(
      braid(KCS, R_LESSONS, ALL_LESSONS.filter((l) => l.trackId !== 'r').map((l) => l.id)),
    )
  })
})

describe('serving-first and rust-systems', () => {
  test('serving-first: t0.l1, t0.l2, t4.l3, T5, T6, T7 (755 declared minutes), no R, no labs', () => {
    const plan = pathPlan('serving-first', GRAPH)
    const want = ['t0.l1', 't0.l2', 't4.l3', ...ALL_LESSONS.filter((l) => ['t5', 't6', 't7'].includes(l.trackId)).map((l) => l.id)]
    expect(plan.lessons).toEqual(want)
    expect(plan.steps).toEqual(want)
    const minutes = plan.lessons.reduce((m, id) => m + (ALL_LESSONS.find((l) => l.id === id)?.minutes ?? 0), 0)
    expect(minutes).toBe(755)
    expect(plan.testOut).toEqual([])
  })

  test('rust-systems: R.L1-R.L5, T1 (lab 01 after t1.l3), R.L6-R.L10, T2 (lab 04 after t2.l5), T3 (lab 05 after t3.l4)', () => {
    const plan = pathPlan('rust-systems', GRAPH)
    const t = (track: TrackId) => ALL_LESSONS.filter((l) => l.trackId === track).map((l) => l.id)
    expect(plan.lessons).toEqual([...R_LESSONS.slice(0, 5), ...t('t1'), ...R_LESSONS.slice(5), ...t('t2'), ...t('t3')])
    const labs = plan.steps.filter((s) => labOfStep(s))
    expect(labs).toEqual(['lab:rust-allocator', 'lab:mpmc-queue', 'lab:toy-executor'])
    for (const [lab, host] of [['lab:rust-allocator', 't1.l3'], ['lab:mpmc-queue', 't2.l5'], ['lab:toy-executor', 't3.l4']]) {
      expect(plan.steps.indexOf(lab)).toBe(plan.steps.indexOf(host) + 1)
    }
  })
})

describe('placement', () => {
  test('nobody placed is sent to R.L1 unless the anchor was missed on a path with R', () => {
    for (const path of PATHS) {
      for (const p of placements()) {
        const plan = pathPlan(path, GRAPH, p)
        const hasR1 = plan.lessons.includes('r.l1')
        expect({ path, anchor: p.rustAnchor, hasR1 }).toEqual({ path, anchor: p.rustAnchor, hasR1: p.rustAnchor === 'missed' && path !== 'serving-first' })
        if (p.rustAnchor !== 'missed' && path !== 'serving-first') expect(plan.testOut).toEqual(R_LESSONS)
      }
    }
  })

  test('never more than two R lessons in a row on the full ramp, for every placement', () => {
    for (const p of placements()) expect(longestRRun(pathPlan('full-ramp', GRAPH, p).lessons)).toBeLessThanOrEqual(MAX_R_RUN)
  })

  test('lessons before the entry track are skipped unless a missed KC of that track lives there', () => {
    const plan = pathPlan('full-ramp', GRAPH, { entryTrack: 't2', rustAnchor: 'solid', missedKcs: ['t0.locality'] })
    expect(plan.lessons.slice(0, 4)).toEqual(['t0.l2', 't0.l3', 't0.l4', 't2.l1'])
    expect(plan.lessons.some((id) => trackOf(id) === 't1')).toBe(false)
    expect(plan.skipped).toContain('t0.l1')
    expect(plan.skipped).toContain('t1.l4')
    // a missed R KC brings R back, not the T lesson that revisits it (T1.L6 and the borrow rules)
    const anchorMissed = pathPlan('full-ramp', GRAPH, { entryTrack: 't2', rustAnchor: 'missed', missedKcs: ['r.borrow-rules'] })
    expect(anchorMissed.lessons).not.toContain('t1.l6')
    expect(R_LESSONS.every((r) => anchorMissed.lessons.includes(r))).toBe(true)
  })

  test('a T5 entry with a solid anchor starts the ramp at T5', () => {
    const plan = pathPlan('full-ramp', GRAPH, { entryTrack: 't5', rustAnchor: 'solid', missedKcs: [] })
    expect(plan.lessons[0]).toBe('t5.l1')
    expect(plan.steps).not.toContain('lab:rust-allocator')
    expect(plan.steps).toContain('lab:kv-block-manager')
  })

  test('labs whose readiness lessons were tested out still follow their host', () => {
    const plan = pathPlan('rust-systems', GRAPH, { entryTrack: 't1', rustAnchor: 'solid', missedKcs: [] })
    expect(plan.lessons[0]).toBe('t1.l1')
    expect(plan.steps.indexOf('lab:rust-allocator')).toBe(plan.steps.indexOf('t1.l3') + 1)
  })

  test('plans are deterministic and memoised per graph', () => {
    const p: PathPlacement = { entryTrack: 't1', rustAnchor: 'missed', missedKcs: ['t1.external-frag'] }
    for (const path of PATHS) {
      expect(pathPlan(path, GRAPH, p)).toEqual(pathPlan(path, GRAPH, { ...p, missedKcs: [...p.missedKcs] }))
      expect(cachedPathPlan(path, GRAPH, p)).toBe(cachedPathPlan(path, GRAPH, { ...p }))
      expect(cachedPathPlan(path, GRAPH, p)).toEqual(pathPlan(path, GRAPH, p))
    }
  })
})

test('pathOf reads the boot:path working value and falls back to the full ramp', () => {
  for (const p of PATHS) expect(pathOf(p)).toBe(p)
  for (const v of [undefined, null, 3, 'fast', {}]) expect(pathOf(v)).toBe('full-ramp' as LearningPath)
})
