/**
 * The lockstep play runner and its debrief (docs/specs/wave-1.md §11.2; PLAN-100X §5.4 W1).
 *
 * Generic part: a `LockstepModel` says how a world applies one trace op. The learner's side moves
 * one op per turn (an op that asks for a decision waits for one; any other applies by itself), and
 * the hidden ghost plays the same ops on its own state. The ghost depends only on the trace, so it
 * is run once up front: step i of both sides is the same op. The play ends at the learner's first
 * failed op, at the trace's end, or at the turn cap. The Wave 2 scheduler play reuses all of it.
 *
 * THE DEBRIEF stops at the first divergence, and only when the learner did worse than the ghost:
 *   - outcome: the op where the learner failed and the ghost did not;
 *   - decision, the root cause: the learner's last decision that turned a run the reference's
 *     policy could still finish into one it could not. Formally, with R(i) = "the ghost's policy,
 *     taking over the learner's state just before op i, survives as far as the ghost's own run",
 *     the root cause is the latest hand decision d with R(d) true and R(d + 1) false; after it,
 *     R never holds again. A free applies identically on both paths and a decision that matches the
 *     reference's choice changes nothing, so d is always a hand decision that departs from the
 *     reference's policy on the learner's own heap. The outcome divergence is reported only when
 *     the learner passed on a request that fit (R held at the failed op itself).
 *
 * C3's review (Opus first: two batches of 50 banded seeds, five simulated learners each: first,
 * next, worst, last and random fit) replaced the spec's first draft of the decision rule ("the
 * earliest placement after which the learner's largest free run fell below the ghost's at the same
 * op and never again reached the failed request's size"). That draft is kept as
 * `largestRunRootCause` and compared in tests/world/play.test.ts. Over 300 debriefs (159 + 141) it
 * blamed a placement identical to the reference's 29 times, found no decision 23 times, agreed with
 * the rule above 148 times and otherwise mostly named a later, merely proximate placement (122).
 * Its sentence also named cells of the ghost's heap that were in use in the learner's. The rule
 * above found a decision in all 300, 3–12 ops (median, by learner) before the failure, and its
 * sentence names only the learner's heap: "At op 14 you put 2 cells in the 11-cell run at cell 1; the reference would have used the
 * 2-cell gap at cell 44. From there even the reference runs out: op 37 needed 10 cells, and your
 * largest run was 8."
 *
 * Placement part: the block-placement model on `heap.ts`, its sentences, and the ledger results.
 */

import type { PlayData, PlayResult } from '@/lib/ledger/types'
import { allocWith, blockRequest, createHeap, freeId, viewOf, type HeapOptions, type HeapState } from './heap'
import { CELL_BYTES, GHOST, PLAY_HEAP, cells, runAt } from './placement'
import type { AllocRequest, Divergence, HeapOp, HeapTrace, HeapView, Placement, PlacementDriver, PlaySummary, PolicySpec, StepRecord } from './types'

/* ------------------------------------------------------------------ */
/* Generic lockstep                                                     */
/* ------------------------------------------------------------------ */

/** How one world applies trace ops. Pure: apply returns a new state. */
export interface LockstepModel<TState, TOp, TReq, TDecision, TView> {
  init(): TState
  /** The decision `op` asks for in `state`, or null when it applies by itself. */
  ask(state: TState, op: TOp): TReq | null
  apply(state: TState, op: TOp, decision: TDecision | null): { ok: boolean; state: TState; at?: number }
  view(state: TState): TView
}

/** A synchronous player: the ghost, a compiled policy, or a simulated learner. */
export interface Decider<TView, TReq, TDecision> {
  name: string
  decide(view: TView, req: TReq): TDecision
}

export type EndReason = 'failed' | 'trace-end' | 'turn-cap'

/** One side's progress. Immutable: every step returns a new value. */
export interface SideState<TState, TView> {
  state: TState
  /** Index of the next op. */
  next: number
  steps: StepRecord<TView>[]
  /** `before[i]` is the state op i was applied to. */
  before: TState[]
  ended: EndReason | null
}

export interface LockstepSetup<TState, TOp, TReq, TDecision, TView> {
  playId: string
  seed: number
  model: LockstepModel<TState, TOp, TReq, TDecision, TView>
  ops: readonly TOp[]
  ghost: Decider<TView, TReq, TDecision>
  turnCap: number
}

/** A learner's play in progress, with the hidden ghost's whole run beside it. */
export interface PlayState<TState, TView> {
  mine: SideState<TState, TView>
  /** Hidden until the debrief. */
  ghost: SideState<TState, TView>
  /** Ops the learner played by hand (auto-applied ones included), before any skip. */
  turns: number
  skipped: boolean
}

type AnySetup<TState, TOp, TReq, TDecision, TView> = LockstepSetup<TState, TOp, TReq, TDecision, TView>

function sideAt<TState, TView>(state: TState, next: number, opsLength: number): SideState<TState, TView> {
  return { state, next, steps: [], before: [], ended: next >= opsLength ? 'trace-end' : null }
}

/** Applies the side's next op with `decision`; ends the side on a failure, the trace's end or the cap. */
function stepSide<TState, TOp, TReq, TDecision, TView>(
  setup: AnySetup<TState, TOp, TReq, TDecision, TView>,
  side: SideState<TState, TView>,
  decision: TDecision | null,
): SideState<TState, TView> {
  if (side.ended) return side
  const i = side.next
  const res = setup.model.apply(side.state, setup.ops[i], decision)
  const state = res.ok ? res.state : side.state
  const step: StepRecord<TView> = { op: i, ok: res.ok, view: setup.model.view(state) }
  if (res.at !== undefined) step.at = res.at
  const next = i + 1
  const ended: EndReason | null = !res.ok ? 'failed' : next >= setup.ops.length ? 'trace-end' : next >= setup.turnCap ? 'turn-cap' : null
  return { state, next, steps: [...side.steps, step], before: [...side.before, side.state], ended }
}

/** Plays a side to its end with a synchronous decider. */
function finishSide<TState, TOp, TReq, TDecision, TView>(
  setup: AnySetup<TState, TOp, TReq, TDecision, TView>,
  side: SideState<TState, TView>,
  decider: Decider<TView, TReq, TDecision>,
): SideState<TState, TView> {
  let s = side
  while (!s.ended) {
    const req = setup.model.ask(s.state, setup.ops[s.next])
    s = stepSide(setup, s, req === null ? null : decider.decide(setup.model.view(s.state), req))
  }
  return s
}

/** Starts a play: the learner at op 0, the ghost's run already complete. */
export function startPlay<TState, TOp, TReq, TDecision, TView>(setup: AnySetup<TState, TOp, TReq, TDecision, TView>): PlayState<TState, TView> {
  const empty = sideAt<TState, TView>(setup.model.init(), 0, setup.ops.length)
  return { mine: empty, ghost: finishSide(setup, empty, setup.ghost), turns: 0, skipped: false }
}

/** What the learner's next op asks for, or null when it applies by itself or the play is over. */
export function pendingAsk<TState, TOp, TReq, TDecision, TView>(
  setup: AnySetup<TState, TOp, TReq, TDecision, TView>,
  ps: PlayState<TState, TView>,
): { op: number; req: TReq; view: TView } | null {
  const m = ps.mine
  if (m.ended) return null
  const req = setup.model.ask(m.state, setup.ops[m.next])
  return req === null ? null : { op: m.next, req, view: setup.model.view(m.state) }
}

/** One turn: applies the learner's next op with `decision` (null for an op that asks nothing). */
export function playTurn<TState, TOp, TReq, TDecision, TView>(
  setup: AnySetup<TState, TOp, TReq, TDecision, TView>,
  ps: PlayState<TState, TView>,
  decision: TDecision | null,
): PlayState<TState, TView> {
  if (ps.mine.ended) return ps
  const asks = setup.model.ask(ps.mine.state, setup.ops[ps.mine.next]) !== null
  if (asks && decision === null) throw new Error(`op ${ps.mine.next} needs a decision`)
  return { ...ps, mine: stepSide(setup, ps.mine, asks ? decision : null), turns: ps.turns + 1 }
}

/** Turns before the expert skip is offered (spec §11.2). */
export const SKIP_AFTER_TURNS = 5

/** The expert skip: the ghost's policy finishes the learner's run on the learner's own state. */
export function skipToDebrief<TState, TOp, TReq, TDecision, TView>(
  setup: AnySetup<TState, TOp, TReq, TDecision, TView>,
  ps: PlayState<TState, TView>,
): PlayState<TState, TView> {
  if (ps.mine.ended) return ps
  return { ...ps, mine: finishSide(setup, ps.mine, setup.ghost), skipped: true }
}

/** Plays a whole run with a synchronous learner: for tests, the seed review and Compose. */
export function playAll<TState, TOp, TReq, TDecision, TView>(
  setup: AnySetup<TState, TOp, TReq, TDecision, TView>,
  learner: Decider<TView, TReq, TDecision>,
): PlayState<TState, TView> {
  let ps = startPlay(setup)
  while (!ps.mine.ended) {
    const ask = pendingAsk(setup, ps)
    ps = playTurn(setup, ps, ask ? learner.decide(ask.view, ask.req) : null)
  }
  return ps
}

/** Ops a side completed before its first failure. */
export const survivedOf = <TState, TView>(side: SideState<TState, TView>) => side.steps.filter((s) => s.ok).length

/** Index of a side's failed op, or -1. */
const failedIndex = <TView>(steps: readonly StepRecord<TView>[]) => steps.findIndex((s) => !s.ok)

/**
 * R(i): the ghost's policy, taking over `state` at op `from`, gets as far as the ghost's own run
 * (`horizon` ops completed, or the end).
 */
export function recoverable<TState, TOp, TReq, TDecision, TView>(
  setup: AnySetup<TState, TOp, TReq, TDecision, TView>,
  state: TState,
  from: number,
  horizon: number,
): boolean {
  const run = finishSide(setup, sideAt<TState, TView>(state, from, setup.ops.length), setup.ghost)
  const f = failedIndex(run.steps)
  return f < 0 || from + f >= horizon
}

/** Where the debrief stops, before any sentence is written. */
export interface RootCause {
  kind: 'outcome' | 'decision'
  op: number
  failedOp: number
}

/** The ops the learner decided by hand: decision ops among the first `turns`. */
export function handDecisions<TView>(steps: readonly StepRecord<TView>[], turns: number): Set<number> {
  const out = new Set<number>()
  for (const s of steps.slice(0, turns)) if (s.at !== undefined || !s.ok) out.add(s.op)
  return out
}

/** The root cause (see the file header), or null when the learner did at least as well as the ghost. */
export function rootCause<TState, TOp, TReq, TDecision, TView>(
  setup: AnySetup<TState, TOp, TReq, TDecision, TView>,
  ps: PlayState<TState, TView>,
): RootCause | null {
  const f = failedIndex(ps.mine.steps)
  if (f < 0) return null
  const g = ps.ghost.steps[f]
  if (!g || !g.ok) return null
  const gf = failedIndex(ps.ghost.steps)
  const horizon = gf < 0 ? setup.ops.length : gf
  const hand = handDecisions(ps.mine.steps, ps.turns)
  // R(f + 1) is false (the run failed), so the latest d with R(d) true is where R was lost for good.
  let d = f
  while (d > 0 && !recoverable(setup, ps.mine.before[d], d, horizon)) d--
  // d = f: the request fit and the learner passed on it. A non-hand d cannot lose R; it is a guard.
  if (d === f || !hand.has(d)) return { kind: 'outcome', op: f, failedOp: f }
  return { kind: 'decision', op: d, failedOp: f }
}

/**
 * The spec's first-draft rule, kept for comparison (see the file header): the earliest hand
 * decision d < f with measure(mine) < measure(ghost) after it, and measure(mine) < need(op f) from
 * d up to f. Returns -1 when nothing qualifies.
 */
export function largestRunRootCause<TOp, TView>(
  ops: readonly TOp[],
  mine: readonly StepRecord<TView>[],
  ghost: readonly StepRecord<TView>[],
  hand: ReadonlySet<number>,
  measure: (v: TView) => number,
  need: (op: TOp) => number,
): number {
  const f = failedIndex(mine)
  if (f < 0 || !ghost[f]?.ok) return -1
  const n = need(ops[f])
  let lo = f
  while (lo > 0 && measure(mine[lo - 1].view) < n) lo--
  for (let i = lo; i < f; i++) if (hand.has(i) && measure(mine[i].view) < measure(ghost[i].view)) return i
  return -1
}

/** Everything a sentence can draw on. */
export interface DivergenceFacts<TOp, TDecision, TView> extends RootCause {
  ops: readonly TOp[]
  mine: StepRecord<TView>
  ghost: StepRecord<TView>
  /** Both sides' views just before `op`. */
  mineBefore: TView
  ghostBefore: TView
  /** What the reference's policy would have done at `op` on the learner's own state. */
  alternative: TDecision | null
  /** The learner's view when the failed request arrived. */
  failedView: TView
}

/** A divergence with what the UI needs to show it: the failed op and the reference's move on the learner's heap. */
export interface DivergenceDetail<TView, TDecision> extends Divergence<TView> {
  failedOp: number
  mineBefore: TView
  alternative: TDecision | null
}

/** The first divergence with its sentence, or null. */
export function firstDivergence<TState, TOp, TReq, TDecision, TView>(
  setup: AnySetup<TState, TOp, TReq, TDecision, TView>,
  ps: PlayState<TState, TView>,
  explain: (facts: DivergenceFacts<TOp, TDecision, TView>) => string,
): DivergenceDetail<TView, TDecision> | null {
  const rc = rootCause(setup, ps)
  if (!rc) return null
  const { model, ops } = setup
  const stateBefore = ps.mine.before[rc.op]
  const req = model.ask(stateBefore, ops[rc.op])
  const mineBefore = model.view(stateBefore)
  const facts: DivergenceFacts<TOp, TDecision, TView> = {
    ...rc,
    ops,
    mine: ps.mine.steps[rc.op],
    ghost: ps.ghost.steps[rc.op],
    mineBefore,
    ghostBefore: model.view(ps.ghost.before[rc.op]),
    alternative: req === null ? null : setup.ghost.decide(mineBefore, req),
    failedView: ps.mine.steps[rc.failedOp].view,
  }
  return {
    op: rc.op,
    kind: rc.kind,
    mine: facts.mine,
    ghost: facts.ghost,
    explanation: explain(facts),
    failedOp: rc.failedOp,
    mineBefore,
    alternative: facts.alternative,
  }
}

export interface Summary<TView, TDecision> extends PlaySummary<TView> {
  divergence: DivergenceDetail<TView, TDecision> | null
}

/** The play's summary for the debrief and the ledger. */
export function summarize<TState, TOp, TReq, TDecision, TView>(
  setup: AnySetup<TState, TOp, TReq, TDecision, TView>,
  ps: PlayState<TState, TView>,
  explain: (facts: DivergenceFacts<TOp, TDecision, TView>) => string,
): Summary<TView, TDecision> {
  return {
    playId: setup.playId,
    seed: setup.seed,
    turns: ps.turns,
    survived: survivedOf(ps.mine),
    ghostSurvived: survivedOf(ps.ghost),
    divergence: firstDivergence(setup, ps, explain),
    skipped: ps.skipped,
  }
}

/* ------------------------------------------------------------------ */
/* The block-placement play                                             */
/* ------------------------------------------------------------------ */

export const BLOCK_PLACEMENT_ID = 'block-placement'
/** Turn cap before the play ends with a debrief either way (spec §11.2). */
export const TURN_CAP = 60

export type PlacementModel = LockstepModel<HeapState, HeapOp, AllocRequest, Placement, HeapView>
export type PlacementSetup = LockstepSetup<HeapState, HeapOp, AllocRequest, Placement, HeapView>
export type PlacementPlay = PlayState<HeapState, HeapView>
export type PlacementSummary = Summary<HeapView, Placement>

/** The heap as a lockstep world: an alloc asks where, a free applies by itself. One block per alloc. */
export function placementModel(options: HeapOptions = PLAY_HEAP): PlacementModel {
  if (typeof options.classes === 'object') throw new Error('the placement play places one block per alloc: no fixed-block classes')
  return {
    init: () => createHeap(options),
    ask: (state, op) => (op.op === 'alloc' ? blockRequest(op, state.options) : null),
    apply(state, op, decision) {
      if (op.op === 'free') return { ok: true, state: freeId(state, op.id) }
      const res = allocWith(state, op, () => decision ?? { kind: 'reject' })
      return res.ok ? { ok: true, state: res.state, at: res.at } : { ok: false, state }
    },
    view: viewOf,
  }
}

/** A placement driver as a lockstep decider. */
export const asDecider = (d: PlacementDriver): Decider<HeapView, AllocRequest, Placement> => ({ name: d.name, decide: (v, r) => d.place(v, r) })

/** The block-placement play on a trace, against the hidden ghost. */
export function placementSetup(trace: HeapTrace, turnCap = TURN_CAP): PlacementSetup {
  return {
    playId: BLOCK_PLACEMENT_ID,
    seed: trace.seed,
    model: placementModel({ ...PLAY_HEAP, capacity: trace.capacity }),
    ops: trace.ops,
    ghost: asDecider(GHOST),
    turnCap,
  }
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** "the 9-cell run at cell 30", or "the 2-cell gap at cell 30" when the request fills it exactly. */
function runPhrase(view: HeapView, at: number, reqCells: number): string {
  const run = runAt(view, at)
  const size = run ? cells(run.size) : reqCells
  return `the ${size}-cell ${size === reqCells ? 'gap' : 'run'} at cell ${cells(run ? run.start : at)}`
}

/**
 * The debrief's sentence for the block-placement play. Ops are numbered from 1 for the learner, and
 * every cell named is in the learner's own heap.
 */
export function explainPlacement(f: DivergenceFacts<HeapOp, Placement, HeapView>): string {
  const failed = f.ops[f.failedOp]
  const need = failed.op === 'alloc' ? cells(failed.size) : 0
  const op = f.ops[f.op]
  const k = op.op === 'alloc' ? cells(op.size) : 0
  const alt = f.alternative?.kind === 'place' ? runPhrase(f.mineBefore, f.alternative.start, k) : null
  if (f.kind === 'outcome') {
    if (alt) return `At op ${f.op + 1} you passed on ${plural(k, 'cell')}, but ${alt} would have taken them.`
    return `At op ${f.op + 1} you needed ${plural(need, 'cell')}: you had ${cells(f.mineBefore.totalFree)} free, but your largest run was ${cells(f.mineBefore.largestFree)}; the reference's was ${cells(f.ghostBefore.largestFree)}.`
  }
  const mine = f.mine.at === undefined ? 'nowhere' : runPhrase(f.mineBefore, f.mine.at, k)
  const largest = cells(f.failedView.largestFree)
  return `At op ${f.op + 1} you put ${plural(k, 'cell')} in ${mine}; the reference would have used ${alt ?? 'another run'}. From there even the reference runs out: op ${f.failedOp + 1} needed ${plural(need, 'cell')}, and your largest run was ${largest}.`
}

/** The play's summary with the placement debrief. */
export const summarizePlacement = (setup: PlacementSetup, ps: PlacementPlay): PlacementSummary => summarize(setup, ps, explainPlacement)

/** Why the play ended, for the end banner: "fragmentation stopped you: 9 cells free, largest run 4". */
export function endLine(setup: PlacementSetup, ps: PlacementPlay): string {
  const m = ps.mine
  if (m.ended === 'failed') {
    const v = m.steps[m.steps.length - 1].view
    return `fragmentation stopped you: ${cells(v.totalFree)} cells free, largest run ${cells(v.largestFree)}`
  }
  if (m.ended === 'turn-cap') return `turn cap reached after ${setup.turnCap} turns`
  return 'you placed every request in the trace'
}

/** The aria-live line for one turn ("Placed 3 cells at cell 12. Largest free run: 9 cells."). */
export function turnLine(ops: readonly HeapOp[], step: StepRecord<HeapView>): string {
  const op = ops[step.op]
  const largest = `Largest free run: ${plural(cells(step.view.largestFree), 'cell')}.`
  if (op.op === 'free') return `Freed block ${op.id}. ${largest}`
  if (!step.ok) return `${plural(cells(op.size), 'cell')} fit nowhere. ${largest}`
  return `Placed ${plural(cells(op.size), 'cell')} at cell ${cells(step.at ?? 0)}. ${largest}`
}

/** min(1, survived / ghostSurvived), 1 when the ghost survived nothing. */
const ratio = (survived: number, ghostSurvived: number) => (ghostSurvived === 0 ? 1 : Math.min(1, survived / ghostSurvived))

/** The ledger result for a finished play (spec §11.2): score = min(1, survived / ghostSurvived); ok = debriefed. */
export function playResult(
  summary: PlaySummary<HeapView>,
  opts: { provenance: PlayResult['provenance']; kcs?: string[]; ms?: number },
): PlayResult {
  const data: PlayData = {
    phase: 'play',
    turns: summary.turns,
    survived: summary.survived,
    ghostSurvived: summary.ghostSurvived,
    skipped: summary.skipped,
  }
  if (summary.divergence) data.divergenceOp = summary.divergence.op
  if (opts.kcs) data.kcs = opts.kcs
  const out: PlayResult = { playId: summary.playId, score: ratio(summary.survived, summary.ghostSurvived), ok: true, seed: summary.seed, provenance: opts.provenance, data }
  if (opts.ms !== undefined) out.ms = opts.ms
  return out
}

/** The ledger's flat form of a spec: classes as `none`, `pow2` or `fixed:<cells>`, minSplit in cells. */
export function specData(spec: PolicySpec): NonNullable<PlayData['spec']> {
  const classes = typeof spec.classes === 'object' ? `fixed:${cells(spec.classes.fixed)}` : spec.classes
  return { fit: spec.fit, coalesce: spec.coalesce, minSplit: Math.round(spec.minSplit / CELL_BYTES), classes }
}

/** The ledger result for one Compose run (spec §11.3). */
export function composeResult(
  spec: PolicySpec,
  outcome: { ok: boolean; equivalent: boolean; survived: number; ghostSurvived: number; tries: number },
  opts: { seed: number; provenance: PlayResult['provenance']; kcs?: string[]; ms?: number },
): PlayResult {
  const data: PlayData = {
    phase: 'compose',
    turns: outcome.tries,
    survived: outcome.survived,
    ghostSurvived: outcome.ghostSurvived,
    spec: specData(spec),
    equivalent: outcome.equivalent,
  }
  if (opts.kcs) data.kcs = opts.kcs
  const out: PlayResult = { playId: BLOCK_PLACEMENT_ID, score: ratio(outcome.survived, outcome.ghostSurvived), ok: outcome.ok, seed: opts.seed, provenance: opts.provenance, data }
  if (opts.ms !== undefined) out.ms = opts.ms
  return out
}
