/**
 * The World, Wave 1 slice (W1 Play → Compose → Code): shared types (docs/specs/wave-1.md §11).
 *
 * Types only. The block-placement play, the AllocatorSim refactor and lab 01's in-browser
 * reference run (F2) all use one pure heap engine (src/lib/world/heap.ts) driven through
 * `PlacementDriver`, the allocator equivalent of fleet-model's `SchedulerDriver`. The lockstep
 * runner (src/lib/world/play.ts) is generic so the Wave 2 scheduler play reuses it.
 *
 * Wave 2 adds the scheduler play's types (docs/specs/wave-2.md §8.3-8.4; src/lib/world/sched.ts,
 * sched-policy.ts). The scheduler's own types (`SchedView`, `SchedAction`) stay in fleet-model.
 */

import type { KcId } from '@/lib/kc/types'
import type { SchedAction, SchedView, SchedViewRun } from '@/lib/fleet-model'

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

/* ------------------------------------------------------------------ */
/* The scheduler play (Wave 2)                                          */
/* ------------------------------------------------------------------ */

/**
 * The four dials of the scheduler Compose step (wave-2 §8.4). `compileSchedPolicy(spec)` returns a
 * Fleet `SchedulerDriver`; `{sjf, 2000, 48, none}` gives `referenceScheduler`'s action at every iteration.
 */
export interface SchedPolicySpec {
  /** Arrival order, or shortest prompt first. */
  order: 'fcfs' | 'sjf'
  /** Iterations after which a waiting request goes first, FIFO (0 = no guard). */
  guard: 0 | 20 | 2000
  /** Tokens reserved per admitted request for decode growth. */
  headroom: 0 | 16 | 48 | 128
  /** On memory pressure, preempt the newest running request. */
  preempt: 'none' | 'newest'
}

/** A running request as the play shows it: the scheduler's view plus the output length, for a progress bar. */
export interface SchedFrameRun extends SchedViewRun {
  output: number
}

/**
 * One moment of a scheduler run: the start of iteration `iter`, before the scheduler decides. A turn's
 * frame is what the learner decides from; the last frame of a finished run has `done` set and empty lists.
 */
export interface SchedFrame {
  iter: number
  /** Hand turns decided before this frame. */
  turn: number
  /** What the scheduler sees: the reference's input. */
  view: SchedView
  /** `view.running` with each request's output length. */
  running: SchedFrameRun[]
  blockSize: number
  /** memCap − memUsed, in tokens (whole blocks). */
  free: number
  /** Requests that have arrived so far. */
  arrived: number
  total: number
  completed: number
  /** Completed requests whose first token came within the TTFT SLO. */
  met: number
  autoPreempts: number
  /** The run is over: every request completed. */
  done: boolean
}

/** One request's fate in a run. */
export interface SchedOutcome {
  id: number
  arrival: number
  prompt: number
  /** Iterations from arrival to the first token of the run that completed it. */
  ttft: number
  met: boolean
  /** The iteration its last token landed. */
  finishedAt: number
  /** Times it went back to the waiting list (by hand or by an auto-preempt) and was recomputed. */
  preempted: number
}

/** How the learner's decision differs from the reference's on the learner's own view (wave-2 §8.3). */
export type SchedDecisionKind = 'preempted' | 'over-headroom' | 'order' | 'held-back' | 'other'

export interface SchedDecisionDivergence {
  kind: SchedDecisionKind
  /** The learner's turn, from 0. */
  turn: number
  iter: number
  mine: SchedAction
  /** `referenceScheduler` on the learner's own view at that turn. */
  reference: SchedAction
  /** Handing the run to the reference at this turn serves the request in time; false for the fallback (no turn could). */
  recoverable: boolean
  /** Requests that a hand-over to the reference at this turn serves within SLO and the learner's run did not, by arrival. */
  cost: number[]
  sentence: string
  /** Both runs at the start of `iter`, for the side by side. */
  mineFrame: SchedFrame
  ghostFrame: SchedFrame
}

/** The scheduler debrief (`schedDivergence`): the request lost first, then the decision that lost it. */
export interface SchedDivergence {
  /** The earliest-arriving request the ghost served within SLO and the learner did not. */
  request: SchedOutcome & { deadline: number; ghostTtft: number }
  outcome: string
  /** Null only when no hand turn differs from the reference's choice before the request was lost. */
  decision: SchedDecisionDivergence | null
  /** The outcome sentence, then the decision sentence. */
  explanation: string
}
