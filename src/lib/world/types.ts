/**
 * The World, Wave 1 slice (W1 Play → Compose → Code): shared types (docs/specs/wave-1.md §11).
 *
 * Types only. The block-placement play, the AllocatorSim refactor and lab 01's in-browser
 * reference run (F2) all use one pure heap engine (src/lib/world/heap.ts) driven through
 * `PlacementDriver`, the allocator equivalent of fleet-model's `SchedulerDriver`. The lockstep
 * runner (src/lib/world/play.ts) is generic so the Wave 2 scheduler play reuses it.
 */

import type { KcId } from '@/lib/kc/types'

/* ------------------------------------------------------------------ */
/* Heap engine                                                          */
/* ------------------------------------------------------------------ */

/** One trace op. Sizes are bytes; `align` defaults to 8. Ids are unique per trace. */
export type HeapOp = { op: 'alloc'; id: number; size: number; align?: number } | { op: 'free'; id: number }

export interface HeapTrace {
  /** e.g. `t1.l4-churn` */
  id: string
  /** uint32; practice traces use a fixed seed, graded runs a fresh one (spec §11.4). */
  seed: number
  capacity: number
  ops: readonly HeapOp[]
  /** Where the trace's shape comes from (lesson figure, AllocatorSim trace lab, lab 01 check). */
  source: string
}

/** A contiguous span in address order. Used spans carry the allocation id and the requested size. */
export interface HeapRun {
  start: number
  size: number
  free: boolean
  id?: number
  req?: number
}

export interface HeapView {
  capacity: number
  /** Address order; adjacent free runs exist only when coalescing is off. */
  runs: readonly HeapRun[]
  totalFree: number
  largestFree: number
  /** Bytes inside used runs that the requests did not ask for (internal fragmentation). */
  internalWaste: number
}

export interface AllocRequest {
  id: number
  size: number
  align: number
}

export type Placement = { kind: 'place'; start: number } | { kind: 'reject' }

/** A placement policy: the allocator equivalent of fleet-model's SchedulerDriver. Pure and synchronous. */
export interface PlacementDriver {
  name: string
  place(view: HeapView, req: AllocRequest): Placement
}

/** The learner's hands (W1 Play): resolves when the learner taps a free run, or "skip turn". */
export interface ManualDriver {
  name: 'you'
  place(view: HeapView, req: AllocRequest): Promise<Placement>
}

/* ------------------------------------------------------------------ */
/* Compose                                                              */
/* ------------------------------------------------------------------ */

/**
 * The four dials of the placement Compose step. `compilePolicy(spec)` returns a PlacementDriver plus
 * the engine options it implies; a test proves the reference spec reproduces the hidden ghost
 * exactly (spec §11.3).
 */
export interface PolicySpec {
  fit: 'first' | 'next' | 'best' | 'worst'
  coalesce: 'eager' | 'none'
  /** Smallest remainder worth splitting off (bytes); smaller tails are given away as internal waste. */
  minSplit: number
  /** Size classes: none (exact), powers of two, or fixed blocks of N bytes (the PagedAttention move). */
  classes: 'none' | 'pow2' | { fixed: number }
}

/* ------------------------------------------------------------------ */
/* Lockstep play (generic)                                              */
/* ------------------------------------------------------------------ */

export interface StepRecord<TView> {
  /** Index into the trace. */
  op: number
  ok: boolean
  /** Where the allocation landed, for placement plays. */
  at?: number
  view: TView
}

export interface Divergence<TView> {
  /** The op the debrief stops at. */
  op: number
  /** `outcome`: the learner failed where the ghost succeeded. `decision`: the root-cause choice (spec §11.2). */
  kind: 'outcome' | 'decision'
  mine: StepRecord<TView>
  ghost: StepRecord<TView>
  /** One sentence, e.g. "reference used the 160 B gap; you split the 2 KiB run". */
  explanation: string
}

export interface PlaySummary<TView> {
  playId: string
  seed: number
  turns: number
  /** Ops completed before the first failure (or the trace length). */
  survived: number
  ghostSurvived: number
  divergence: Divergence<TView> | null
  /** The expert skip was taken: the ghost played the remaining turns. */
  skipped: boolean
}

export interface PlayDef {
  id: string
  title: string
  /** Lesson the play lives in. */
  lessonId: string
  /** Nominal minutes (XP, spec §8.4). */
  minutes: number
  /** Turn cap (60) before the play ends with a debrief either way. */
  turnCap: number
  kcs: KcId[]
  /** Claim ids the In-production card cites. */
  productionClaims: string[]
}
