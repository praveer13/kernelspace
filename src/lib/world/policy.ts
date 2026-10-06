/**
 * Compose for the block-placement play (docs/specs/wave-1.md §11.3): four dials compile to a
 * placement driver plus the heap options they imply, and run on the same trace as the play.
 *
 * Dials, in the play's units (one cell is CELL_BYTES; `PolicySpec` itself carries bytes):
 *   fit       first, next, best, worst;
 *   coalesce  eager or none;
 *   minSplit  1, 2 or 3 cells: a smaller tail is given away with the allocation as internal waste;
 *   classes   none, powers of two, or fixed blocks of 2 or 4 cells.
 *
 * `REFERENCE_SPEC` = {best, eager, 1 cell, none} places every op exactly where the ghost does
 * (tested on 1,000 seeds). `FIXED_SPEC` = fixed 4-cell blocks survives every banded trace with 0 %
 * external fragmentation and 15–40 % internal waste: the PagedAttention move (T2.L7).
 */

import { externalFragPermille, runTrace, type HeapOptions, type SizeClasses, type TraceRun } from './heap'
import { CELL_BYTES, GHOST, PLAY_HEAP, makeDriver } from './placement'
import type { HeapTrace, PlacementDriver, PolicySpec } from './types'

/** The dial values the Compose panel offers. */
export const DIALS = {
  fit: ['first', 'next', 'best', 'worst'] as const,
  coalesce: ['eager', 'none'] as const,
  minSplitCells: [1, 2, 3] as const,
  classes: ['none', 'pow2', { fixed: 2 * CELL_BYTES }, { fixed: 4 * CELL_BYTES }] as const,
}

/** The spec that reproduces the ghost. */
export const REFERENCE_SPEC: PolicySpec = { fit: 'best', coalesce: 'eager', minSplit: CELL_BYTES, classes: 'none' }

/** The fixed-block insight's block, in cells. */
export const FIXED_BLOCK_CELLS = 4

/** Fixed 4-cell blocks: the fixed-block insight. */
export const FIXED_SPEC: PolicySpec = { fit: 'first', coalesce: 'eager', minSplit: CELL_BYTES, classes: { fixed: FIXED_BLOCK_CELLS * CELL_BYTES } }

export interface CompiledPolicy {
  driver: PlacementDriver
  options: HeapOptions
}

/** Why a spec cannot run on a heap of `capacity` bytes (empty = fine). */
export function specProblems(spec: PolicySpec, capacity = PLAY_HEAP.capacity): string[] {
  const out: string[] = []
  if (!Number.isInteger(spec.minSplit) || spec.minSplit < 1) out.push(`minSplit ${spec.minSplit} B is not a positive whole number of bytes`)
  if (typeof spec.classes === 'object') {
    const b = spec.classes.fixed
    if (!Number.isInteger(b) || b < 1 || capacity % b !== 0) out.push(`fixed blocks of ${b} B do not tile a ${capacity} B heap`)
  }
  return out
}

/** Compiles the four dials into a fresh driver (next fit keeps a rover) and the engine options. */
export function compilePolicy(spec: PolicySpec, base: HeapOptions = PLAY_HEAP): CompiledPolicy {
  const problems = specProblems(spec, base.capacity)
  if (problems.length) throw new Error(problems.join('; '))
  const classes: SizeClasses = typeof spec.classes === 'object' ? { fixed: spec.classes.fixed } : spec.classes
  return {
    driver: makeDriver(spec.fit),
    options: { capacity: base.capacity, granule: base.granule, coalesce: spec.coalesce === 'eager', minSplit: spec.minSplit, classes },
  }
}

/** True for a fixed-block spec. */
export const isFixedSpec = (spec: PolicySpec) => typeof spec.classes === 'object'

/** Runs a spec on a trace. */
export function runSpec(spec: PolicySpec, trace: HeapTrace): TraceRun {
  const { driver, options } = compilePolicy(spec, { ...PLAY_HEAP, capacity: trace.capacity })
  return runTrace(trace.ops, driver, options)
}

/** Runs the hidden ghost on a trace. */
export function runGhost(trace: HeapTrace): TraceRun {
  return runTrace(trace.ops, GHOST, { ...PLAY_HEAP, capacity: trace.capacity })
}

/** One row of Compose's table (spec §11.3). Percentages are whole per mille, formatted by the UI. */
export interface ComposeRow {
  label: string
  seed: number
  survived: number
  ops: number
  /** 1 − largest/free where the run stopped. */
  externalPermille: number
  internalWastePermille: number
}

function row(label: string, trace: HeapTrace, r: TraceRun): ComposeRow {
  return {
    label,
    seed: trace.seed,
    survived: r.survived,
    ops: trace.ops.length,
    externalPermille: externalFragPermille(r.final),
    internalWastePermille: r.internalWastePermille,
  }
}

/** The table: the spec and the ghost on each trace (the play's own, then the fresh seeds). */
export function composeTable(spec: PolicySpec, traces: readonly HeapTrace[]): { mine: ComposeRow[]; ghost: ComposeRow[] } {
  return {
    mine: traces.map((t) => row('your spec', t, runSpec(spec, t))),
    ghost: traces.map((t) => row('reference', t, runGhost(t))),
  }
}

/**
 * True when the spec places every op of every trace exactly where the ghost does and fails at the
 * same op (the ledger's `data.equivalent`).
 */
export function placesLikeGhost(spec: PolicySpec, traces: readonly HeapTrace[]): boolean {
  return traces.every((t) => {
    const a = runSpec(spec, t)
    const b = runGhost(t)
    return a.failedAt === b.failedAt && a.placements.length === b.placements.length && a.placements.every((p, i) => p === b.placements[i])
  })
}

/** Compose's `ok` (spec §11.3): the learner reproduced the ghost or ran the fixed-block spec. */
export function composeOk(spec: PolicySpec, traces: readonly HeapTrace[]): { ok: boolean; equivalent: boolean } {
  const equivalent = placesLikeGhost(spec, traces)
  return { ok: equivalent || isFixedSpec(spec), equivalent }
}
