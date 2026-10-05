/**
 * The World's heap engine (docs/specs/wave-1.md §11.2): one pure, immutable heap that the
 * block-placement play, Compose, AllocatorSim (C9) and lab 01's in-browser reference run (C13)
 * all drive through a `PlacementDriver`.
 *
 * Sizes and addresses are bytes. The engine never chooses where an allocation goes: the driver
 * names a start, and the engine checks it, rounds the request to its size class, splits the run
 * (or gives a tail smaller than `minSplit` away as internal waste) and, on free, coalesces when
 * asked. Fixed-block classes carve the heap into equal blocks up front; an allocation then takes
 * as many blocks as it needs, one driver decision per block, and need not be contiguous: that is
 * the PagedAttention move (T2.L7), so a fixed-block heap has no external fragmentation at all.
 *
 * Integer arithmetic only (determinism lint, spec §16.3): no state outside the values passed in.
 */

import type { AllocRequest, HeapOp, HeapRun, HeapView, Placement, PlacementDriver } from './types'

/** Size classes as the engine applies them: exact sizes, powers of two, or fixed blocks of N bytes. */
export type SizeClasses = 'none' | 'pow2' | { fixed: number }

export interface HeapOptions {
  /** Heap size in bytes. */
  capacity: number
  /** Merge a freed run with its free neighbours at once (eager) or never (none). Fixed blocks never merge. */
  coalesce: boolean
  /** Smallest tail worth splitting off, in bytes; a smaller tail stays inside the allocation as internal waste. */
  minSplit: number
  /** The allocation unit: every request is rounded up to a multiple of it (16 B cells in the play). */
  granule: number
  classes: SizeClasses
}

export interface HeapState {
  readonly options: HeapOptions
  /** Address order, covering [0, capacity) exactly. */
  readonly runs: readonly HeapRun[]
}

export const DEFAULT_ALIGN = 8

const isFixed = (c: SizeClasses): c is { fixed: number } => typeof c === 'object'

/** Rounds `n` up to a multiple of `m` (m ≥ 1). */
export const roundUp = (n: number, m: number) => Math.ceil(n / m) * m

/** The smallest power of two ≥ n, by doubling (no Math.log, spec §16.3). */
export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/** The bytes one block of this request occupies before any split: its size class. */
export function classSize(size: number, options: HeapOptions): number {
  const base = roundUp(Math.max(1, size), options.granule)
  if (options.classes === 'pow2') return Math.max(options.granule, nextPow2(base))
  if (isFixed(options.classes)) return options.classes.fixed
  return base
}

/** How many blocks a request takes: 1, except under fixed-block classes. */
export function blocksFor(size: number, options: HeapOptions): number {
  return isFixed(options.classes) ? Math.ceil(Math.max(1, size) / options.classes.fixed) : 1
}

export function createHeap(options: HeapOptions): HeapState {
  if (isFixed(options.classes)) {
    const block = options.classes.fixed
    if (block <= 0 || options.capacity % block !== 0) throw new Error(`fixed block ${block} B does not divide the ${options.capacity} B heap`)
    const runs: HeapRun[] = []
    for (let start = 0; start < options.capacity; start += block) runs.push({ start, size: block, free: true })
    return { options, runs }
  }
  return { options, runs: [{ start: 0, size: options.capacity, free: true }] }
}

/** The read-only picture a driver and the UI see. */
export function viewOf(state: HeapState): HeapView {
  let totalFree = 0
  let largestRun = 0
  let internalWaste = 0
  for (const r of state.runs) {
    if (r.free) {
      totalFree += r.size
      if (r.size > largestRun) largestRun = r.size
    } else {
      internalWaste += r.size - (r.req ?? r.size)
    }
  }
  // Under fixed blocks any free block serves any request, so the largest request that fits is all of them.
  const largestFree = isFixed(state.options.classes) ? totalFree : largestRun
  return { capacity: state.options.capacity, runs: state.runs, totalFree, largestFree, internalWaste }
}

/** First aligned address in `run` at or after its start. */
export const alignedStart = (run: HeapRun, align: number) => roundUp(run.start, Math.max(1, align))

/** True when a block of `bytes` placed at the aligned start of `run` stays inside it. */
export function runFits(run: HeapRun, bytes: number, align: number): boolean {
  return run.free && alignedStart(run, align) + bytes <= run.start + run.size
}

/**
 * The request a driver is asked to place: the class-rounded size of one block, with the caller's
 * id and alignment. Under fixed blocks the driver places one block at a time.
 */
export function blockRequest(op: { id: number; size: number; align?: number }, options: HeapOptions): AllocRequest {
  return { id: op.id, size: classSize(op.size, options), align: op.align ?? DEFAULT_ALIGN }
}

export type PlaceResult = { ok: true; state: HeapState; at: number } | { ok: false; state: HeapState; reason: string }

/**
 * Places one block of `bytes` at `start`, recording `req` requested bytes in it. Fails without
 * changing the heap when [start, start + bytes) is not inside one free run.
 */
export function placeBlock(state: HeapState, id: number, bytes: number, req: number, start: number): PlaceResult {
  const runs = state.runs
  const i = runs.findIndex((r) => r.start <= start && start < r.start + r.size)
  if (i < 0) return { ok: false, state, reason: `cell ${start} is outside the heap` }
  const run = runs[i]
  if (!run.free) return { ok: false, state, reason: `${start} is inside a used run` }
  if (start + bytes > run.start + run.size) return { ok: false, state, reason: `${bytes} B does not fit in the ${run.size} B run at ${run.start}` }

  const lead = start - run.start
  let tail = run.start + run.size - (start + bytes)
  let size = bytes
  // A tail too small to be worth tracking goes with the allocation (internal waste).
  if (tail > 0 && tail < state.options.minSplit) {
    size += tail
    tail = 0
  }
  const pieces: HeapRun[] = []
  if (lead > 0) pieces.push({ start: run.start, size: lead, free: true })
  pieces.push({ start, size, free: false, id, req: Math.min(req, size) })
  if (tail > 0) pieces.push({ start: start + size, size: tail, free: true })
  const next = [...runs.slice(0, i), ...pieces, ...runs.slice(i + 1)]
  return { ok: true, state: { options: state.options, runs: next }, at: start }
}

/** Frees every run that carries `id`, coalescing eagerly when the options say so. Unknown ids are a no-op. */
export function freeId(state: HeapState, id: number): HeapState {
  if (!state.runs.some((r) => !r.free && r.id === id)) return state
  const freed = state.runs.map((r): HeapRun => (!r.free && r.id === id ? { start: r.start, size: r.size, free: true } : r))
  if (!state.options.coalesce || isFixed(state.options.classes)) return { options: state.options, runs: freed }
  const merged: HeapRun[] = []
  for (const r of freed) {
    const last = merged[merged.length - 1]
    if (last && last.free && r.free) merged[merged.length - 1] = { start: last.start, size: last.size + r.size, free: true }
    else merged.push(r)
  }
  return { options: state.options, runs: merged }
}

export interface AllocOutcome {
  ok: boolean
  state: HeapState
  /** The first block's start when it landed. */
  at?: number
  /** Every block's start (one, except under fixed blocks). */
  blocks?: number[]
  /** Why it did not land: no run fits, the driver declined, or the driver named a bad start. */
  reason?: string
}

/** Lets the driver place the request (block by block under fixed classes). All-or-nothing. */
export function allocWith(
  state: HeapState,
  op: { id: number; size: number; align?: number },
  place: (view: HeapView, req: AllocRequest) => Placement,
): AllocOutcome {
  const opts = state.options
  const req = blockRequest(op, opts)
  const count = blocksFor(op.size, opts)
  if (count > 1) {
    const freeBlocks = state.runs.filter((r) => r.free).length
    if (freeBlocks < count) return { ok: false, state, reason: `needs ${count} blocks, ${freeBlocks} free` }
  }
  let cur = state
  let left = op.size
  const blocks: number[] = []
  for (let k = 0; k < count; k++) {
    const p = place(viewOf(cur), req)
    if (p.kind === 'reject') return { ok: false, state, reason: fitsAnywhere(viewOf(cur), req) ? 'declined' : 'no run fits' }
    if (p.start % Math.max(1, req.align) !== 0) return { ok: false, state, reason: `${p.start} is not ${req.align}-aligned` }
    const res = placeBlock(cur, op.id, req.size, Math.min(left, req.size), p.start)
    if (!res.ok) return { ok: false, state, reason: res.reason }
    left -= req.size
    blocks.push(res.at)
    cur = res.state
  }
  return { ok: true, state: cur, at: blocks[0], blocks }
}

/** True when some free run can hold the request. */
export function fitsAnywhere(view: HeapView, req: AllocRequest): boolean {
  return view.runs.some((r) => runFits(r, req.size, req.align))
}

export interface OpResult {
  ok: boolean
  state: HeapState
  at?: number
  reason?: string
}

/** Applies one trace op: a free always succeeds, an alloc asks the driver. */
export function applyOp(state: HeapState, op: HeapOp, driver: PlacementDriver): OpResult {
  if (op.op === 'free') return { ok: true, state: freeId(state, op.id) }
  return allocWith(state, op, (v, r) => driver.place(v, r))
}

/** External fragmentation, 1 − largest/free, in whole per mille (0 when nothing is free). */
export function externalFragPermille(view: HeapView): number {
  return view.totalFree === 0 ? 0 : Math.round(((view.totalFree - view.largestFree) * 1000) / view.totalFree)
}

export interface TraceRun {
  /** Ops completed before the first failure (or the trace length). */
  survived: number
  /** Index of the first failed op, or null. */
  failedAt: number | null
  /** Per op, where the alloc landed (null for frees and for the failed op). */
  placements: (number | null)[]
  /** The heap after the last completed op. */
  final: HeapView
  /** Peak external fragmentation over the run, per mille. */
  peakExternalPermille: number
  /** Internal waste over every allocation made: wasted bytes / bytes handed out, per mille. */
  internalWastePermille: number
}

/** Runs a whole trace with one driver, stopping at the first failed alloc. */
export function runTrace(ops: readonly HeapOp[], driver: PlacementDriver, options: HeapOptions): TraceRun {
  let state = createHeap(options)
  const placements: (number | null)[] = []
  let failedAt: number | null = null
  let peakExternalPermille = 0
  let handedOut = 0
  let wasted = 0
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    const before = state
    const res = applyOp(state, op, driver)
    if (!res.ok) {
      failedAt = i
      break
    }
    state = res.state
    placements.push(op.op === 'alloc' ? (res.at ?? null) : null)
    if (op.op === 'alloc') {
      const added = usedBytes(state, op.id) - usedBytes(before, op.id)
      handedOut += added
      wasted += added - op.size
    }
    const ext = externalFragPermille(viewOf(state))
    if (ext > peakExternalPermille) peakExternalPermille = ext
  }
  return {
    survived: failedAt ?? ops.length,
    failedAt,
    placements,
    final: viewOf(state),
    peakExternalPermille,
    internalWastePermille: handedOut === 0 ? 0 : Math.round((wasted * 1000) / handedOut),
  }
}

/** Bytes the runs carrying `id` occupy. */
function usedBytes(state: HeapState, id: number): number {
  let n = 0
  for (const r of state.runs) if (!r.free && r.id === id) n += r.size
  return n
}
