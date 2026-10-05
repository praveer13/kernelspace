import { describe, expect, test } from 'bun:test'
import {
  SKIP_AFTER_TURNS,
  asDecider,
  composeResult,
  endLine,
  handDecisions,
  largestRunRootCause,
  pendingAsk,
  placementSetup,
  playAll,
  playResult,
  playTurn,
  recoverable,
  rootCause,
  skipToDebrief,
  specData,
  startPlay,
  summarizePlacement,
  turnLine,
  type Decider,
  type PlacementSetup,
} from '../../src/lib/world/play'
import { bestFit, firstFit, makeNextFit, worstFit } from '../../src/lib/world/placement'
import { FIXED_SPEC, REFERENCE_SPEC } from '../../src/lib/world/policy'
import { drawPlacementTrace } from '../../src/lib/world/traces'
import { alignedStart, runFits } from '../../src/lib/world/heap'
import { splitmix32u } from '../../src/lib/rng'
import type { AllocRequest, HeapOp, HeapTrace, HeapView, Placement, PlacementDriver } from '../../src/lib/world/types'

type L = Decider<HeapView, AllocRequest, Placement>
const C = 16
const trace = (ops: HeapOp[]): HeapTrace => ({ id: 'test', seed: 7, capacity: 1024, ops, source: 'test' })

/** a(10) b(2) c(40), free b: a 2-cell hole at 10 and a 12-cell tail at 52. Then d(2), then e(12). */
const HOLE = trace([
  { op: 'alloc', id: 1, size: 10 * C },
  { op: 'alloc', id: 2, size: 2 * C },
  { op: 'alloc', id: 3, size: 40 * C },
  { op: 'free', id: 2 },
  { op: 'alloc', id: 4, size: 2 * C },
  { op: 'alloc', id: 5, size: 12 * C },
])

const lastFit: PlacementDriver = {
  name: 'last-fit',
  place(view, req) {
    const fits = view.runs.filter((r) => runFits(r, req.size, req.align))
    const r = fits[fits.length - 1]
    return r ? { kind: 'place', start: alignedStart(r, req.align) } : { kind: 'reject' }
  },
}
const randomFit = (seed: number): PlacementDriver => {
  const next = splitmix32u(seed)
  return {
    name: 'random-fit',
    place(view, req) {
      const fits = view.runs.filter((r) => runFits(r, req.size, req.align))
      return fits.length ? { kind: 'place', start: alignedStart(fits[next() % fits.length], req.align) } : { kind: 'reject' }
    },
  }
}

describe('the lockstep runner', () => {
  test('the ghost runs to completion up front and stays out of the learner’s state', () => {
    const setup = placementSetup(HOLE)
    const ps = startPlay(setup)
    expect(ps.ghost.ended).toBe('trace-end')
    expect(ps.ghost.steps.map((s) => s.at)).toEqual([0, 160, 192, undefined, 160, 832])
    expect(ps.mine.steps).toHaveLength(0)
    expect(ps.mine.next).toBe(0)
  })

  test('allocs wait for a decision, frees apply by themselves', () => {
    const setup = placementSetup(HOLE)
    let ps = startPlay(setup)
    for (let i = 0; i < 3; i++) {
      const ask = pendingAsk(setup, ps)
      expect(ask?.op).toBe(i)
      ps = playTurn(setup, ps, bestFit(ask!.view, ask!.req))
    }
    expect(pendingAsk(setup, ps)).toBeNull()
    expect(() => playTurn(setup, startPlay(setup), null)).toThrow()
    ps = playTurn(setup, ps, null)
    expect(ps.turns).toBe(4)
    expect(ps.mine.steps[3].view.runs.find((r) => r.start === 160)?.free).toBe(true)
  })

  test('playing the ghost’s own policy gives no divergence and a full score', () => {
    const setup = placementSetup(HOLE)
    const s = summarizePlacement(setup, playAll(setup, asDecider({ name: 'me', place: bestFit })))
    expect(s.divergence).toBeNull()
    expect(s.survived).toBe(6)
    expect(s.ghostSurvived).toBe(6)
    expect(playResult(s, { provenance: 'practice' }).score).toBe(1)
  })

  test('the turn cap ends both sides', () => {
    const setup: PlacementSetup = { ...placementSetup(HOLE), turnCap: 3 }
    const ps = playAll(setup, asDecider({ name: 'me', place: worstFit }))
    expect(ps.mine.ended).toBe('turn-cap')
    expect(ps.ghost.ended).toBe('turn-cap')
    const s = summarizePlacement(setup, ps)
    expect([s.survived, s.ghostSurvived, s.divergence]).toEqual([3, 3, null])
    expect(endLine(setup, ps)).toBe('turn cap reached after 3 turns')
  })

  test('the expert skip lets the ghost’s policy finish the learner’s own heap', () => {
    const t = drawPlacementTrace(31).trace
    const setup = placementSetup(t)
    let ps = startPlay(setup)
    while (ps.turns < SKIP_AFTER_TURNS) {
      const ask = pendingAsk(setup, ps)
      ps = playTurn(setup, ps, ask ? firstFit(ask.view, ask.req) : null)
    }
    ps = skipToDebrief(setup, ps)
    expect(ps.skipped).toBe(true)
    expect(ps.mine.ended).not.toBeNull()
    const s = summarizePlacement(setup, ps)
    expect(s.turns).toBe(SKIP_AFTER_TURNS)
    expect(s.skipped).toBe(true)
    // Decisions after the skip are the ghost's: never the root cause.
    if (s.divergence) expect(s.divergence.op).toBeLessThan(SKIP_AFTER_TURNS)
    expect(skipToDebrief(setup, ps)).toBe(ps)
  })
})

describe('the debrief (spec §11.2, as amended by C3’s review)', () => {
  test('decision: the placement that lost the run, named in the learner’s own heap', () => {
    const setup = placementSetup(HOLE)
    const ps = playAll(setup, asDecider({ name: 'me', place: worstFit }))
    expect(ps.mine.ended).toBe('failed')
    expect(endLine(setup, ps)).toBe('fragmentation stopped you: 12 cells free, largest run 10')
    const s = summarizePlacement(setup, ps)
    expect(s.survived).toBe(5)
    expect(s.ghostSurvived).toBe(6)
    const d = s.divergence!
    expect(d.kind).toBe('decision')
    expect(d.op).toBe(4)
    expect(d.failedOp).toBe(5)
    expect(d.mine.at).toBe(52 * C)
    expect(d.ghost.at).toBe(10 * C)
    expect(d.alternative).toEqual({ kind: 'place', start: 10 * C })
    expect(d.explanation).toBe(
      'At op 5 you put 2 cells in the 12-cell run at cell 52; the reference would have used the 2-cell gap at cell 10. From there even the reference runs out: op 6 needed 12 cells, and your largest run was 10.',
    )
    const r = playResult(s, { provenance: 'unseen', kcs: ['k'], ms: 9 })
    expect(r).toEqual({
      playId: 'block-placement',
      score: 5 / 6,
      ok: true,
      seed: 7,
      provenance: 'unseen',
      ms: 9,
      data: { phase: 'play', turns: 6, survived: 5, ghostSurvived: 6, skipped: false, divergenceOp: 4, kcs: ['k'] },
    })
  })

  test('outcome: the learner passed on a request that fit', () => {
    const setup = placementSetup(HOLE)
    const decliner: L = { name: 'me', decide: (v, r) => (r.id === 5 ? { kind: 'reject' } : bestFit(v, r)) }
    const s = summarizePlacement(setup, playAll(setup, decliner))
    expect(s.divergence?.kind).toBe('outcome')
    expect(s.divergence?.op).toBe(5)
    expect(s.divergence?.explanation).toBe('At op 6 you passed on 12 cells, but the 12-cell gap at cell 52 would have taken them.')
  })

  test('aria-live lines', () => {
    const setup = placementSetup(HOLE)
    const ps = playAll(setup, asDecider({ name: 'me', place: worstFit }))
    expect(turnLine(HOLE.ops, ps.mine.steps[0])).toBe('Placed 10 cells at cell 0. Largest free run: 54 cells.')
    expect(turnLine(HOLE.ops, ps.mine.steps[3])).toBe('Freed block 2. Largest free run: 12 cells.')
    expect(turnLine(HOLE.ops, ps.mine.steps[5])).toBe('12 cells fit nowhere. Largest free run: 10 cells.')
  })

  describe('on 50 banded seeds × 5 simulated learners', () => {
    const entropy = splitmix32u(2026)
    const traces = Array.from({ length: 50 }, () => drawPlacementTrace(entropy()).trace)
    const learners = (i: number): PlacementDriver[] => [
      { name: 'first-fit', place: firstFit },
      makeNextFit(),
      { name: 'worst-fit', place: worstFit },
      lastFit,
      randomFit(i),
    ]
    const runs = traces.flatMap((t, i) =>
      learners(i).map((l) => {
        const setup = placementSetup(t)
        const ps = playAll(setup, asDecider(l))
        return { t, setup, ps, s: summarizePlacement(setup, ps), learner: l.name }
      }),
    )

    test('every failure gets a decision divergence that departs from the reference on the learner’s heap', () => {
      let debriefs = 0
      for (const { t, setup, ps, s } of runs) {
        const failed = ps.mine.ended === 'failed'
        expect(s.divergence !== null).toBe(failed)
        if (!s.divergence) continue
        debriefs++
        const d = s.divergence
        expect(d.kind).toBe('decision')
        expect(d.op).toBeLessThan(d.failedOp)
        expect(t.ops[d.op].op).toBe('alloc')
        expect(d.alternative?.kind).toBe('place')
        expect(d.mine.at).not.toBe(d.alternative?.kind === 'place' ? d.alternative.start : undefined)
        // R holds just before the decision and never again after it.
        expect(recoverable(setup, ps.mine.before[d.op], d.op, t.ops.length)).toBe(true)
        for (let i = d.op + 1; i <= d.failedOp; i++) expect(recoverable(setup, ps.mine.before[i], i, t.ops.length)).toBe(false)
        expect(d.explanation).toMatch(/^At op \d+ you put \d+ cells? in the \d+-cell (run|gap) at cell \d+; the reference would have used the \d+-cell (run|gap) at cell \d+\. From there even the reference runs out: op \d+ needed \d+ cells, and your largest run was \d+\.$/)
      }
      expect(debriefs).toBeGreaterThan(100)
    })

    test('worst fit fails on every banded seed', () => {
      expect(runs.filter((r) => r.learner === 'worst-fit').every((r) => r.ps.mine.ended === 'failed')).toBe(true)
    })

    test('the spec’s first-draft rule, for the record: it blames identical placements and finds nothing on some', () => {
      let same = 0
      let none = 0
      let agree = 0
      let total = 0
      for (const { t, ps, s } of runs) {
        if (!s.divergence) continue
        total++
        const hand = handDecisions(ps.mine.steps, ps.turns)
        const d = largestRunRootCause(t.ops, ps.mine.steps, ps.ghost.steps, hand, (v) => v.largestFree, (o) => (o.op === 'alloc' ? o.size : 0))
        if (d < 0) none++
        else {
          if (ps.mine.steps[d].at === ps.ghost.steps[d].at) same++
          if (d === s.divergence.op) agree++
        }
        expect(rootCause(placementSetup(t), ps)?.op).toBe(s.divergence.op)
      }
      console.log(`root-cause review: ${total} debriefs; first draft found none on ${none}, blamed a placement identical to the reference's on ${same}, agreed on ${agree}`)
      expect(same + none).toBeGreaterThan(0)
    })

    test('is deterministic', () => {
      const { t } = runs[7]
      const a = summarizePlacement(placementSetup(t), playAll(placementSetup(t), asDecider({ name: 'w', place: worstFit })))
      const b = summarizePlacement(placementSetup(t), playAll(placementSetup(t), asDecider({ name: 'w', place: worstFit })))
      expect(a).toEqual(b)
    })
  })
})

describe('ledger results', () => {
  test('specData flattens a spec into cells', () => {
    expect(specData(REFERENCE_SPEC)).toEqual({ fit: 'best', coalesce: 'eager', minSplit: 1, classes: 'none' })
    expect(specData(FIXED_SPEC)).toEqual({ fit: 'first', coalesce: 'eager', minSplit: 1, classes: 'fixed:4' })
  })

  test('composeResult carries the spec and whether it reproduces the ghost', () => {
    const r = composeResult(REFERENCE_SPEC, { ok: true, equivalent: true, survived: 40, ghostSurvived: 40, tries: 2 }, { seed: 61, provenance: 'practice' })
    expect(r).toEqual({
      playId: 'block-placement',
      score: 1,
      ok: true,
      seed: 61,
      provenance: 'practice',
      data: { phase: 'compose', turns: 2, survived: 40, ghostSurvived: 40, spec: specData(REFERENCE_SPEC), equivalent: true },
    })
  })
})
