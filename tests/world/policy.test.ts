import { describe, expect, test } from 'bun:test'
import { createHeap, applyOp, runTrace, viewOf } from '../../src/lib/world/heap'
import { GHOST, PLAY_HEAP } from '../../src/lib/world/placement'
import {
  DIALS,
  FIXED_SPEC,
  REFERENCE_SPEC,
  compilePolicy,
  composeOk,
  composeTable,
  placesLikeGhost,
  runGhost,
  runSpec,
  specProblems,
} from '../../src/lib/world/policy'
import { drawPlacementTrace, makePlacementTrace } from '../../src/lib/world/traces'
import { splitmix32u } from '../../src/lib/rng'
import type { HeapOp, HeapTrace, PolicySpec } from '../../src/lib/world/types'

/** Unshaped churn: no ghost in the loop, so runs fail and the failure path is compared too. */
function stressTrace(seed: number): HeapTrace {
  const next = splitmix32u(seed)
  const ops: HeapOp[] = []
  const live: number[] = []
  for (let id = 1; ops.length < 60; id++) {
    if (live.length > 2 && next() % 100 < 35) ops.push({ op: 'free', id: live.splice(next() % live.length, 1)[0] })
    else {
      ops.push({ op: 'alloc', id, size: 16 * (1 + (next() % 12)) })
      live.push(id)
    }
  }
  return { id: 'stress', seed, capacity: 1024, ops, source: 'test' }
}

/** Every op placed by the ghost and by a spec, step by step: identical start addresses and outcomes. */
function sameEveryOp(spec: PolicySpec, trace: HeapTrace): boolean {
  const { driver, options } = compilePolicy(spec)
  let a = createHeap(options)
  let b = createHeap(PLAY_HEAP)
  for (const op of trace.ops) {
    const ra = applyOp(a, op, driver)
    const rb = applyOp(b, op, GHOST)
    if (ra.ok !== rb.ok || ra.at !== rb.at) return false
    if (!ra.ok) return true
    a = ra.state
    b = rb.state
  }
  return JSON.stringify(viewOf(a)) === JSON.stringify(viewOf(b))
}

describe('compilePolicy', () => {
  test('maps the four dials onto a driver and engine options', () => {
    const c = compilePolicy({ fit: 'worst', coalesce: 'none', minSplit: 48, classes: 'pow2' })
    expect(c.driver.name).toBe('worst-fit')
    expect(c.options).toEqual({ capacity: 1024, granule: 16, coalesce: false, minSplit: 48, classes: 'pow2' })
    expect(compilePolicy(FIXED_SPEC).options.classes).toEqual({ fixed: 64 })
  })

  test('the reference spec compiles to the ghost’s own engine options', () => {
    expect(compilePolicy(REFERENCE_SPEC).options).toEqual(PLAY_HEAP)
    expect(REFERENCE_SPEC).toEqual({ fit: 'best', coalesce: 'eager', minSplit: 16, classes: 'none' })
  })

  test('each compile gets a fresh next-fit rover', () => {
    const spec: PolicySpec = { ...REFERENCE_SPEC, fit: 'next' }
    expect(compilePolicy(spec).driver).not.toBe(compilePolicy(spec).driver)
  })

  test('rejects specs that cannot run', () => {
    expect(specProblems({ ...REFERENCE_SPEC, minSplit: 0 })).toHaveLength(1)
    expect(specProblems({ ...REFERENCE_SPEC, classes: { fixed: 48 } })).toHaveLength(1)
    expect(() => compilePolicy({ ...REFERENCE_SPEC, classes: { fixed: 48 } })).toThrow()
  })

  test('all 96 dial combinations run every banded trace deterministically', () => {
    const traces = [7, 8, 9].map((e) => drawPlacementTrace(e).trace)
    for (const fit of DIALS.fit)
      for (const coalesce of DIALS.coalesce)
        for (const m of DIALS.minSplitCells)
          for (const classes of DIALS.classes) {
            const spec: PolicySpec = { fit, coalesce, minSplit: m * 16, classes }
            for (const t of traces) expect(runSpec(spec, t)).toEqual(runSpec(spec, t))
          }
  })
})

describe('the equivalence test (spec §11.3): {best, eager, 1 cell, none} ≡ the ghost', () => {
  test('places every op identically on 1,000 play seeds', () => {
    for (let seed = 0; seed < 1000; seed++) expect(sameEveryOp(REFERENCE_SPEC, makePlacementTrace(seed))).toBe(true)
  })

  test('and on 300 unshaped traces, failures included', () => {
    let failures = 0
    for (let seed = 0; seed < 300; seed++) {
      const t = stressTrace(seed)
      expect(sameEveryOp(REFERENCE_SPEC, t)).toBe(true)
      if (runGhost(t).failedAt !== null) failures++
    }
    expect(failures).toBeGreaterThan(30)
  })

  test('placesLikeGhost agrees, and tells other specs apart', () => {
    const traces = [1, 2, 3, 4, 5, 6].map((e) => drawPlacementTrace(e).trace)
    expect(placesLikeGhost(REFERENCE_SPEC, traces)).toBe(true)
    for (const fit of ['first', 'next', 'worst'] as const) expect(placesLikeGhost({ ...REFERENCE_SPEC, fit }, traces)).toBe(false)
  })
})

describe('the fixed-block insight (spec §11.3)', () => {
  test('fixed 4-cell blocks survive 200 banded traces with 0 % external fragmentation and 15–40 % internal waste', () => {
    const entropy = splitmix32u(11)
    for (let i = 0; i < 200; i++) {
      const t = drawPlacementTrace(entropy()).trace
      const r = runSpec(FIXED_SPEC, t)
      expect(r.failedAt).toBeNull()
      expect(r.peakExternalPermille).toBe(0)
      expect(r.internalWastePermille).toBeGreaterThanOrEqual(150)
      expect(r.internalWastePermille).toBeLessThanOrEqual(400)
    }
  })
})

describe('Compose: the table and ok', () => {
  const traces = [21, 22, 23, 24, 25, 26].map((e) => drawPlacementTrace(e).trace)

  test('one row per trace for the spec and the ghost', () => {
    const table = composeTable(FIXED_SPEC, traces)
    expect(table.mine).toHaveLength(6)
    expect(table.ghost).toHaveLength(6)
    expect(table.ghost.every((r) => r.survived === r.ops)).toBe(true)
    expect(table.mine.every((r) => r.externalPermille === 0 && r.internalWastePermille > 0)).toBe(true)
    expect(table.ghost.every((r) => r.internalWastePermille === 0)).toBe(true)
  })

  test('ok for the reference (equivalent) or the fixed-block spec; not for worst fit', () => {
    expect(composeOk(REFERENCE_SPEC, traces)).toEqual({ ok: true, equivalent: true })
    expect(composeOk(FIXED_SPEC, traces)).toEqual({ ok: true, equivalent: false })
    expect(composeOk({ ...REFERENCE_SPEC, fit: 'worst' }, traces)).toEqual({ ok: false, equivalent: false })
  })

  test('worst fit fails early on every banded trace (band rule 2)', () => {
    for (const t of traces) expect(runTrace(t.ops, compilePolicy({ ...REFERENCE_SPEC, fit: 'worst' }).driver, PLAY_HEAP).survived).toBeLessThan(32)
  })
})
