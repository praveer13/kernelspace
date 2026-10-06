/**
 * Banded traces for the block-placement play (docs/specs/wave-1.md §11.2).
 *
 * `makePlacementTrace(seed)` derives 40 ops from a uint32 seed with splitmix32: bimodal sizes (1–2
 * and 6–10 cells, one request in five small), and frees that punch holes, half of them aimed at the
 * small blocks between large ones. Same seed, same trace, in every browser. All of its numbers are
 * synthetic (W4).
 *
 * The generator keeps the trace inside what two references can hold, so the pressure lands on
 * placement rather than on capacity: a request that the ghost (playing along on its own heap) could
 * not place, or that would push the live set past 64 cells once rounded to 4-cell blocks, becomes
 * a free instead. Rules 1 and 3 of the band below therefore rarely reject; rule 2 does the work.
 *
 * THE BAND. A seed is in band when, on its trace:
 *   1. the ghost (best fit, eager coalescing) survives every op;
 *   2. worst fit fails before 80 % of the ops, so careless placement visibly loses;
 *   3. fixed 4-cell blocks survive every op with internal waste in [15 %, 40 %].
 * "Play again with new numbers" draws fresh entropy and keeps the first in-band candidate, moving
 * to the next splitmix32 output of the entropy on each rejection, as Fleet Week's graded seeds do
 * (graded-seed.ts).
 *
 * ACCEPTANCE (measured 2026-10-05): 38.8 % of 10,000 splitmix32 draws and 39.4 % of seeds 0..9,999
 * are in band, so a fresh draw costs about 2.6 candidates (three short runs each, well under a
 * millisecond). On in-band traces, fixed 4-cell waste spans about 18–27 % (10th–90th percentile),
 * first fit fails on about a third and next fit on about 60 %. tests/world/traces.test.ts re-measures
 * the rate on 2,000 draws and fails outside [30 %, 50 %].
 */

import { splitmix32u } from '@/lib/rng'
import { allocWith, createHeap, freeId, runTrace } from './heap'
import { CELL_BYTES, PLAY_CELLS, PLAY_HEAP, bestFit, makeDriver } from './placement'
import { FIXED_BLOCK_CELLS, FIXED_SPEC, runGhost, runSpec } from './policy'
import type { HeapOp, HeapTrace } from './types'

/** Ops per trace. */
export const TRACE_OPS = 40
/** Request sizes in cells: the two modes (synthetic). */
export const SMALL_CELLS = { min: 1, max: 2 }
export const LARGE_CELLS = { min: 6, max: 10 }
/** Share of requests drawn from the small mode, percent. */
const SMALL_PCT = 20
/** Chance of an unforced free once three blocks are live, percent. */
const FREE_PCT = 10
/** Chance a free picks among the small blocks (a hole between large ones), percent. */
const HOLE_PCT = 50

export const BAND = {
  /** Worst fit must fail before this share of the ops (per mille). */
  worstFailsBeforePermille: 800,
  /** Fixed 4-cell blocks: internal waste over the run, per mille. */
  fixedWastePermille: { min: 150, max: 400 },
}

/** Uniform integer in [min, max] from a uint32 draw. */
const pick = (u: number, min: number, max: number) => min + (u % (max - min + 1))

/** The play's trace for this seed. */
export function makePlacementTrace(seed: number): HeapTrace {
  const next = splitmix32u(seed)
  const ops: HeapOp[] = []
  const live: { id: number; cells: number }[] = []
  // Live cells as fixed 4-cell blocks hold them: kept within the heap, so FIXED_SPEC survives.
  let blocked = 0
  let nextId = 1
  const asBlocks = (c: number) => Math.ceil(c / FIXED_BLOCK_CELLS) * FIXED_BLOCK_CELLS
  // The ghost plays along: a request it could not place becomes a free instead.
  let ghost = createHeap(PLAY_HEAP)
  while (ops.length < TRACE_OPS) {
    const small = next() % 100 < SMALL_PCT
    const c = small ? pick(next(), SMALL_CELLS.min, SMALL_CELLS.max) : pick(next(), LARGE_CELLS.min, LARGE_CELLS.max)
    const id = nextId
    const trial = allocWith(ghost, { id, size: c * CELL_BYTES }, bestFit)
    const full = blocked + asBlocks(c) > PLAY_CELLS || !trial.ok
    const mayFree = live.length >= 3 && next() % 100 < FREE_PCT
    if ((full || mayFree) && live.length > 0) {
      // Frees prefer the small blocks: they punch holes between the large ones.
      const smalls = live.filter((l) => l.cells <= SMALL_CELLS.max)
      const pool = smalls.length > 0 && next() % 100 < HOLE_PCT ? smalls : live
      const victim = pool[next() % pool.length]
      live.splice(live.indexOf(victim), 1)
      blocked -= asBlocks(victim.cells)
      ghost = freeId(ghost, victim.id)
      ops.push({ op: 'free', id: victim.id })
      continue
    }
    nextId++
    ghost = trial.state
    live.push({ id, cells: c })
    blocked += asBlocks(c)
    ops.push({ op: 'alloc', id, size: c * CELL_BYTES })
  }
  return { id: 't1.l4-placement', seed: seed >>> 0, capacity: PLAY_HEAP.capacity, ops, source: 'T1.L4 block-placement play (synthetic)' }
}

export interface BandCheck {
  inBand: boolean
  violations: string[]
  ghostSurvived: number
  worstSurvived: number
  fixedSurvived: number
  fixedWastePermille: number
}

/** Checks the three band rules on a trace. */
export function checkPlacementBand(trace: HeapTrace): BandCheck {
  const n = trace.ops.length
  const ghost = runGhost(trace)
  const worst = runTrace(trace.ops, makeDriver('worst'), { ...PLAY_HEAP, capacity: trace.capacity })
  const fixed = runSpec(FIXED_SPEC, trace)
  const violations: string[] = []
  if (ghost.failedAt !== null) violations.push(`ghost fails at op ${ghost.failedAt + 1}`)
  if (worst.survived * 1000 >= n * BAND.worstFailsBeforePermille) violations.push(`worst fit survives ${worst.survived} of ${n} ops`)
  if (fixed.failedAt !== null) violations.push(`fixed 4-cell blocks fail at op ${fixed.failedAt + 1}`)
  const w = fixed.internalWastePermille
  if (w < BAND.fixedWastePermille.min || w > BAND.fixedWastePermille.max) violations.push(`fixed 4-cell waste ${w}‰ outside the band`)
  return {
    inBand: violations.length === 0,
    violations,
    ghostSurvived: ghost.survived,
    worstSurvived: worst.survived,
    fixedSurvived: fixed.survived,
    fixedWastePermille: w,
  }
}

/** Give up after this many rejected candidates (see BAND_ACCEPTANCE: hitting it means the band no longer fits the generator). */
export const MAX_DRAWS = 256

export interface PlacementDraw {
  trace: HeapTrace
  band: BandCheck
  /** Candidates tried, rejected ones included. */
  draws: number
}

/** Turns entropy into an in-band trace: the entropy itself first, then its splitmix32 outputs. */
export function drawPlacementTrace(entropy: number): PlacementDraw {
  const more = splitmix32u(entropy)
  let candidate = entropy >>> 0
  for (let draws = 1; draws <= MAX_DRAWS; draws++) {
    const trace = makePlacementTrace(candidate)
    const band = checkPlacementBand(trace)
    if (band.inBand) return { trace, band, draws }
    candidate = more()
  }
  throw new Error(`no in-band placement trace in ${MAX_DRAWS} draws: the band no longer matches the generator`)
}

/**
 * The lesson embed's fixed seed: everyone shares the story. In band, and chosen because the
 * natural strategies lose on it the classic way: first fit drops 1 cell into the 15-cell run at
 * op 16 where the 1-cell gap at cell 31 was free, and fails at op 29 (tested).
 */
export const PLAY_PRACTICE_SEED = 61
