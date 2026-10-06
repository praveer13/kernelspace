/**
 * Placement drivers for the heap engine (docs/specs/wave-1.md §11.2–11.3): first, next, best and
 * worst fit, plus the hidden ghost of the block-placement play.
 *
 * Every driver places at the aligned start of the free run it picks, ties go to the lower address,
 * and a driver that finds no run that fits rejects. Next fit keeps a rover, so build a fresh driver
 * for every run (`makeDriver`); the others are stateless.
 *
 * The play's heap is synthetic (W4): 64 cells of 16 B, 1 KiB, the scale of AllocatorSim's heap.
 */

import { alignedStart, runFits, type HeapOptions } from './heap'
import type { AllocRequest, HeapRun, HeapView, Placement, PlacementDriver } from './types'

/** One cell of the play's grid, in bytes (synthetic scenario number). */
export const CELL_BYTES = 16
/** Cells in the play's heap: a 4 × 16 grid (synthetic scenario number). */
export const PLAY_CELLS = 64

export type Fit = 'first' | 'next' | 'best' | 'worst'

/** The play's heap: exact sizes in whole cells, split down to one cell, eager coalescing. */
export const PLAY_HEAP: HeapOptions = {
  capacity: PLAY_CELLS * CELL_BYTES,
  coalesce: true,
  minSplit: CELL_BYTES,
  granule: CELL_BYTES,
  classes: 'none',
}

const fitting = (view: HeapView, req: AllocRequest): HeapRun[] => view.runs.filter((r) => runFits(r, req.size, req.align))

const at = (run: HeapRun | undefined, req: AllocRequest): Placement =>
  run ? { kind: 'place', start: alignedStart(run, req.align) } : { kind: 'reject' }

/** The lowest-address run that fits. */
export function firstFit(view: HeapView, req: AllocRequest): Placement {
  return at(fitting(view, req)[0], req)
}

/** The smallest run that fits; the lower address wins a tie. */
export function bestFit(view: HeapView, req: AllocRequest): Placement {
  let pick: HeapRun | undefined
  for (const r of fitting(view, req)) if (!pick || r.size < pick.size) pick = r
  return at(pick, req)
}

/** The largest run that fits; the lower address wins a tie. */
export function worstFit(view: HeapView, req: AllocRequest): Placement {
  let pick: HeapRun | undefined
  for (const r of fitting(view, req)) if (!pick || r.size > pick.size) pick = r
  return at(pick, req)
}

/** Next fit: the first run that fits at or after the rover (the end of the last placement), wrapping to the start. */
export function makeNextFit(): PlacementDriver {
  let rover = 0
  return {
    name: 'next-fit',
    place(view, req) {
      const runs = fitting(view, req)
      const run = runs.find((r) => r.start >= rover) ?? runs[0]
      const p = at(run, req)
      if (p.kind === 'place') rover = p.start + req.size
      return p
    },
  }
}

/** The block-placement play's hidden ghost: best fit with eager coalescing, address-ordered ties. */
export const GHOST: PlacementDriver = { name: 'reference', place: bestFit }

/** A fresh driver for a fit dial value. */
export function makeDriver(fit: Fit): PlacementDriver {
  switch (fit) {
    case 'first':
      return { name: 'first-fit', place: firstFit }
    case 'best':
      return { name: 'best-fit', place: bestFit }
    case 'worst':
      return { name: 'worst-fit', place: worstFit }
    case 'next':
      return makeNextFit()
  }
}

/** One free run as the play's chip list shows it: whether it takes the request, and why not. */
export interface RunChoice {
  start: number
  size: number
  fits: boolean
  /** Empty when it fits, else e.g. "4 cells free, needs 6". */
  why: string
}

/** Bytes as whole cells (the play's unit). */
export const cells = (bytes: number) => Math.ceil(bytes / CELL_BYTES)

/** The free runs in address order, each marked as fitting or not, for the chip list (spec §11.2). */
export function runChoices(view: HeapView, req: AllocRequest): RunChoice[] {
  return view.runs
    .filter((r) => r.free)
    .map((r) => {
      const fits = runFits(r, req.size, req.align)
      return { start: r.start, size: r.size, fits, why: fits ? '' : `${cells(r.size)} cells free, needs ${cells(req.size)}` }
    })
}

/** The run (free or used) that holds `addr`, if any. */
export function runAt(view: HeapView, addr: number): HeapRun | undefined {
  return view.runs.find((r) => r.start <= addr && addr < r.start + r.size)
}
