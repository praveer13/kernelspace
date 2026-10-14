/**
 * The scheduler play, "I was the scheduler" (docs/specs/wave-2.md §8.3; PLAN-100X §5.4 W1).
 *
 * THE WORLD is the Fleet `Engine` (fleet-model.ts) on a sampled BurstGPT minute (sched-traces.ts).
 * Its state is an immutable decision log: the learner's `SchedAction`s, one per turn, plus what
 * happens after the last one (`rest`: wait for the next decision, or let `referenceScheduler` finish
 * the run). `replaySched` replays a log through a fresh `Engine` with a replaying `SchedulerDriver`,
 * so nothing mutable is ever kept, cloned or edited: a run of ≤ 200 iterations replays in well under a
 * millisecond, and `schedModel` memoizes each log's replay. fleet-model.ts is used as it is.
 *
 * THE TURN RULE. An iteration is a turn when a request is waiting, a slot is free and at least one
 * waiting request fits the free memory (`prompt ≤ memCap − memUsed`, `running < maxRunning`); the
 * learner decides it. Every other iteration steps by itself with an empty action. The reference
 * never admits outside a turn (its accounting, Σ(prompt + decoded + 48) over the running requests,
 * is always above the blocks they hold), so a run the reference plays has its admissions exactly at
 * the turns. The play ends when the run does, or at the 60-turn cap, where the reference finishes the
 * learner's run; after 5 turns the learner may skip to the debrief, which does the same (`skipped`).
 *
 * THE GHOST is `referenceScheduler` on its own `Engine` (the same replay with an empty log), run by
 * `startSchedPlay` and kept in `SchedPlay.ghost`, which the play screen never reads (2b-11).
 *
 * THE DEBRIEF (`schedDivergence`; the Opus check below set the details):
 *   - outcome: the earliest-arriving request the ghost served within the TTFT SLO and the learner did
 *     not ("the request");
 *   - decision: over the learner's hand turns up to the iteration the request's fate was sealed, the
 *     reference's action on the learner's own view at each turn; the decision divergence is the latest
 *     turn where the two differ and from which handing the rest of the run to the reference serves the
 *     request in time. If no such turn exists, the earliest turn where they differ.
 *   Two actions differ when they admit different requests (the ones the Engine would actually take:
 *   tap order alone is not a difference) or the learner preempts.
 *
 * "Sealed" extends the spec's TTFT deadline. A request's TTFT is measured on the run that completes
 * it, so a request that got its first token in time can still miss when it is preempted later (by
 * hand, or by an auto-preempt after an admission without headroom) and recomputed. The walk therefore
 * starts at the iteration the request finished, not at its deadline. For a request that never got a
 * first token in time this changes nothing: no turn after the deadline can serve it in time.
 *
 * OPUS CHECK (2b-02; tests/world/sched.test.ts, "Opus check"). Six simulated learners (FCFS without
 * headroom, FCFS with the reference's headroom, longest first, one request per turn, a seeded random
 * tapper, and the reference with a preempt every seventh turn) on 50 minutes drawn into the band:
 * 300 plays, 240 of which lost a request the ghost served. Approved, with these findings:
 *   - every one of the 240 got a decision, and every decision was recoverable (the earliest-difference
 *     fallback never fired). Each learner's mistake got its own template: FCFS without headroom 50 of 50
 *     over headroom, FCFS 50 of 50 order, longest first 49 of 49 order, one per turn 13 of 13 held back,
 *     the preempter 29 of 29 preempted; the random tapper 33 over headroom, 9 order, 6 held back, 1 other;
 *   - the spec's deadline walk and the walk from the finish agreed on all 152 debriefs whose request was
 *     never preempted. Of the 88 whose request had its first token in time and lost it to a preemption,
 *     the deadline walk found no differing turn at all in 32 (FCFS without headroom matches the
 *     reference until the pool is full) and named an earlier turn in 49; it agreed in 7. Walking from
 *     the finish names the admission or the preempt that cost the recompute;
 *   - the over-headroom sentence carries two accountings, the free memory the learner saw (whole blocks)
 *     and the reference's own sum, pool - (tokens held + n x 48) (BF3 corrected the first version,
 *     which subtracted from the block-granular free figure): the spec's single number ("a 1,024-token
 *     prompt with 144 tokens free") reads as a request that could not have been admitted at all, and
 *     when the sum is zero or below the sentence says why free tokens still do not count;
 *   - of 15,065 hand turns, 4,219 differ from the reference in tap order and 3,806 in what the Engine
 *     admits: comparing tap order would have blamed 413 turns that changed nothing;
 *   - the outcome sentence comes first: the decision's consequence ("That cost #16 its deadline")
 *     reads as a cause only after the request has been named.
 */

import {
  Engine,
  HEADROOM_TOKENS,
  makeRefManager,
  referenceScheduler,
  type SchedAction,
  type SchedulerDriver,
  type SchedView,
  type SchedViewReq,
  type SchedViewRun,
} from '@/lib/fleet-model'
import type { PlayData, PlayResult } from '@/lib/ledger/types'
import { SKIP_AFTER_TURNS, TURN_CAP, type Decider, type LockstepModel } from './play'
import { RUN_GUARD, groups, type SchedTrace } from './sched-traces'
import type { SchedDecisionDivergence, SchedDecisionKind, SchedDivergence, SchedFrame, SchedOutcome } from './types'

export { SKIP_AFTER_TURNS, TURN_CAP }

export const SCHEDULER_PLAY_ID = 'scheduler'
/** The artifact's own sampled minute has no seed; its ledger rows would carry 0. The practice minute carries its pinned seed. */
export const SCHED_PRACTICE_SEED = 0

/* ------------------------------------------------------------------ */
/* Turns and actions                                                    */
/* ------------------------------------------------------------------ */

/** The turn rule: a request waits, a slot is free and some waiting request fits the free memory. */
export function isTurnView(v: SchedView): boolean {
  if (v.waiting.length === 0 || v.running.length >= v.maxRunning) return false
  const room = v.memCap - v.memUsed
  return v.waiting.some((r) => r.prompt <= room)
}

const NOTHING: SchedAction = Object.freeze({ admit: Object.freeze([]) as unknown as number[], preempt: Object.freeze([]) as unknown as number[] })

/** Why `action` is not a decision the learner could take at `view` (empty = fine). */
export function actionProblems(view: SchedView, action: SchedAction): string[] {
  const out: string[] = []
  const waiting = new Set(view.waiting.map((r) => r.id))
  const running = new Set(view.running.map((r) => r.id))
  if (new Set(action.admit).size !== action.admit.length) out.push('a request is admitted twice')
  for (const id of action.admit) if (!waiting.has(id)) out.push(`#${id} is not waiting`)
  if (action.preempt.length > 1) out.push('one preempt per turn')
  for (const id of action.preempt) if (!running.has(id)) out.push(`#${id} is not running`)
  return out
}

/** Tokens a running request holds in the pool: its prompt, plus every decoded token after the first. */
const heldTokens = (r: SchedViewRun) => r.prompt + Math.max(0, r.decoded - 1)
const blocksFor = (tokens: number, blockSize: number) => Math.ceil(tokens / blockSize)

/** The requests the Engine actually admits for `action`, in order: preempts free first, then admits stop at a full batch and skip what does not fit. */
export function effectiveAdmits(view: SchedView, action: SchedAction, blockSize: number): number[] {
  let free = (view.memCap - view.memUsed) / blockSize
  let running = view.running.length
  for (const id of action.preempt) {
    const r = view.running.find((x) => x.id === id)
    if (!r) continue
    free += blocksFor(heldTokens(r), blockSize)
    running--
  }
  const out: number[] = []
  for (const id of action.admit) {
    if (running >= view.maxRunning) break
    const w = view.waiting.find((x) => x.id === id)
    if (!w) continue
    const need = blocksFor(w.prompt, blockSize)
    if (need > free) continue
    out.push(id)
    free -= need
    running++
  }
  return out
}

const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x) => b.includes(x))

/** True when the learner's action differs from the reference's in effect: other requests admitted, or a preempt. */
export function actionsDiffer(view: SchedView, mine: SchedAction, reference: SchedAction, blockSize: number): boolean {
  return mine.preempt.length > 0 || reference.preempt.length > 0 || !sameSet(effectiveAdmits(view, mine, blockSize), effectiveAdmits(view, reference, blockSize))
}

/* ------------------------------------------------------------------ */
/* Replay                                                               */
/* ------------------------------------------------------------------ */

/** The whole state of one side of the play. Immutable. */
export interface SchedLog {
  /** One action per turn, in turn order. */
  readonly decisions: readonly SchedAction[]
  /** After the last decision: stop at the next turn, or let the reference finish the run. */
  readonly rest: 'wait' | 'reference'
}

export interface SchedTurnRecord {
  /** The frame the turn was decided from. */
  frame: SchedFrame
  action: SchedAction
  by: 'you' | 'reference'
}

export interface SchedReplay {
  /** Every turn reached, in order. */
  turns: SchedTurnRecord[]
  /** Where the replay stopped: the next undecided turn, the `stopAt` iteration, or the end of the run. */
  frame: SchedFrame
  outcomes: ReadonlyMap<number, SchedOutcome>
  met: number
  completed: number
  autoPreempts: number
  /** TTFT p95 over completed requests, in iterations. */
  ttftP95: number
  /** False only when the run guard stopped a run that would not finish. */
  finished: boolean
}

/** Thrown by the replaying driver to stop mid-iteration; the Engine it leaves half-stepped is dropped. */
class Stop {
  readonly view: SchedView
  constructor(view: SchedView) {
    this.view = view
  }
}

/**
 * Replays `log` on `trace` through a fresh Engine. With `stopAt`, stops at the start of that
 * iteration whatever it is (the side by side); a `wait` log stops at its first undecided turn.
 */
export function replaySched(trace: SchedTrace, log: SchedLog, stopAt = Number.POSITIVE_INFINITY): SchedReplay {
  const cfg = trace.cfg
  const outputs = new Map(trace.requests.map((r) => [r.id, r.output]))
  const arrivals = trace.requests.map((r) => r.arrival)
  const outcomes = new Map<number, SchedOutcome>()
  const preempts = new Map<number, number>()
  const turns: SchedTurnRecord[] = []
  let prevRunning = new Set<number>()
  let k = 0
  let hand = 0

  const frameOf = (v: SchedView, done: boolean): SchedFrame => {
    const s = engine.stats()
    return {
      iter: v.iter,
      turn: hand,
      view: v,
      running: v.running.map((r) => ({ ...r, output: outputs.get(r.id) ?? 0 })),
      blockSize: cfg.blockSize,
      free: v.memCap - v.memUsed,
      arrived: arrivals.filter((a) => a <= v.iter).length,
      total: trace.requests.length,
      completed: s.completed,
      met: s.sloMet,
      autoPreempts: s.autoPreempts,
      done,
    }
  }

  const driver: SchedulerDriver = {
    name: 'replay',
    schedule(v) {
      for (const w of v.waiting) if (prevRunning.has(w.id)) preempts.set(w.id, (preempts.get(w.id) ?? 0) + 1)
      prevRunning = new Set(v.running.map((r) => r.id))
      if (v.iter >= stopAt) throw new Stop(v)
      const turn = isTurnView(v)
      if (k < log.decisions.length) {
        if (!turn) return NOTHING
        const action = log.decisions[k++]
        turns.push({ frame: frameOf(v, false), action, by: 'you' })
        hand++
        return action
      }
      if (log.rest === 'wait') {
        if (!turn) return NOTHING
        throw new Stop(v)
      }
      const action = referenceScheduler(v)
      if (turn) turns.push({ frame: frameOf(v, false), action, by: 'reference' })
      return action
    },
  }

  const engine = new Engine(cfg, trace.requests.map((r) => ({ ...r })), driver, makeRefManager(cfg.numBlocks, cfg.blockSize))
  engine.onFinish = (r) => {
    outcomes.set(r.id, { id: r.id, arrival: r.arrival, prompt: r.prompt, ttft: r.ttft, met: r.sloMet, finishedAt: r.tick, preempted: preempts.get(r.id) ?? 0 })
  }
  let frame: SchedFrame | null = null
  try {
    while (!engine.done && engine.tick < RUN_GUARD) engine.step()
  } catch (e) {
    if (!(e instanceof Stop)) throw e
    frame = frameOf(e.view, false)
  }
  if (k < log.decisions.length && frame === null) throw new Error(`the run ended after ${k} of ${log.decisions.length} decisions`)
  const s = engine.stats()
  if (frame === null) {
    const end: SchedView = { iter: engine.tick, maxRunning: cfg.maxRunning, memCap: cfg.numBlocks * cfg.blockSize, memUsed: engine.memUsedTokens, waiting: [], running: [] }
    frame = frameOf(end, engine.done)
  }
  return {
    turns,
    frame,
    outcomes,
    met: s.sloMet,
    completed: s.completed,
    autoPreempts: s.autoPreempts,
    ttftP95: engine.ttftP95(),
    finished: engine.done,
  }
}

/* ------------------------------------------------------------------ */
/* The lockstep model                                                   */
/* ------------------------------------------------------------------ */

/** Ops are turn indices; the request is the scheduler's view at the turn; the decision a SchedAction. */
export type SchedModel = LockstepModel<SchedLog, number, SchedView, SchedAction, SchedFrame> & {
  /** The log's replay, memoized per log. */
  run(state: SchedLog): SchedReplay
}

const EMPTY_LOG: SchedLog = Object.freeze({ decisions: Object.freeze([]) as readonly SchedAction[], rest: 'wait' as const })

/** The scheduler world on one trace: pure, every view a memoized replay of the decision log. */
export function schedModel(trace: SchedTrace): SchedModel {
  const memo = new WeakMap<SchedLog, SchedReplay>()
  const run = (state: SchedLog): SchedReplay => {
    let r = memo.get(state)
    if (!r) {
      r = replaySched(trace, state)
      memo.set(state, r)
    }
    return r
  }
  const pending = (state: SchedLog) => {
    const f = run(state).frame
    return f.done || state.rest === 'reference' ? null : f
  }
  return {
    run,
    init: () => EMPTY_LOG,
    ask: (state) => pending(state)?.view ?? null,
    apply(state, _op, decision) {
      const f = pending(state)
      if (!f) return { ok: true, state }
      if (decision === null) throw new Error(`iteration ${f.iter} is a turn and needs a decision`)
      const problems = actionProblems(f.view, decision)
      if (problems.length) throw new Error(`iteration ${f.iter}: ${problems.join('; ')}`)
      const action: SchedAction = { admit: [...decision.admit], preempt: [...decision.preempt] }
      return { ok: true, state: Object.freeze({ decisions: Object.freeze([...state.decisions, action]), rest: state.rest }), at: f.iter }
    },
    view: (state) => run(state).frame,
  }
}

/* ------------------------------------------------------------------ */
/* The play                                                             */
/* ------------------------------------------------------------------ */

export interface SchedSetup {
  playId: string
  trace: SchedTrace
  model: SchedModel
  turnCap: number
}

/** The play on a trace, against the hidden ghost. */
export function schedSetup(trace: SchedTrace, turnCap = TURN_CAP): SchedSetup {
  return { playId: SCHEDULER_PLAY_ID, trace, model: schedModel(trace), turnCap }
}

export type SchedEnd = 'trace-end' | 'turn-cap'

export interface SchedPlay {
  /** The learner's decision log. */
  mine: SchedLog
  /** The ghost's whole run. Hidden until the debrief: the play screen never reads it. */
  ghost: SchedReplay
  /** Turns the learner decided by hand. */
  turns: number
  /** The learner took the skip: the reference finished the run. */
  skipped: boolean
  ended: SchedEnd | null
}

const REFERENCE_FROM_START: SchedLog = Object.freeze({ decisions: Object.freeze([]) as readonly SchedAction[], rest: 'reference' as const })

/** Starts a play: the learner at the first turn, the ghost's run already complete. */
export function startSchedPlay(setup: SchedSetup): SchedPlay {
  const mine = setup.model.init()
  const ghost = setup.model.run(REFERENCE_FROM_START)
  const ended: SchedEnd | null = setup.model.view(mine).done ? 'trace-end' : null
  return { mine, ghost, turns: 0, skipped: false, ended }
}

/** The learner's pending turn: its index, the frame to decide from and the scheduler's view; null once the play is over. */
export function schedPending(setup: SchedSetup, play: SchedPlay): { turn: number; frame: SchedFrame; view: SchedView } | null {
  if (play.ended) return null
  const view = setup.model.ask(play.mine, play.turns)
  return view === null ? null : { turn: play.turns, frame: setup.model.view(play.mine), view }
}

const handTo = (log: SchedLog): SchedLog => Object.freeze({ decisions: log.decisions, rest: 'reference' as const })

/** One turn: the learner's action at the pending turn. The reference finishes the run at the turn cap. */
export function schedTurn(setup: SchedSetup, play: SchedPlay, action: SchedAction): SchedPlay {
  if (play.ended) return play
  const res = setup.model.apply(play.mine, play.turns, action)
  const turns = play.turns + 1
  if (setup.model.view(res.state).done) return { ...play, mine: res.state, turns, ended: 'trace-end' }
  if (turns >= setup.turnCap) return { ...play, mine: handTo(res.state), turns, ended: 'turn-cap' }
  return { ...play, mine: res.state, turns }
}

/** The skip is offered after SKIP_AFTER_TURNS turns. */
export const canSkip = (play: SchedPlay) => !play.ended && play.turns >= SKIP_AFTER_TURNS

/** The expert skip: the reference finishes the learner's run from the learner's own state. */
export function skipSchedToDebrief(play: SchedPlay): SchedPlay {
  if (play.ended) return play
  return { ...play, mine: handTo(play.mine), skipped: true, ended: 'trace-end' }
}

/** A Fleet scheduler driver as a simulated learner. */
export const driverDecider = (d: SchedulerDriver): Decider<SchedFrame, SchedView, SchedAction> => ({ name: d.name, decide: (_f, v) => d.schedule(v) })

/** Plays a whole run with a synchronous learner: tests, the seed review and Compose's checks. */
export function playSchedAll(setup: SchedSetup, learner: Decider<SchedFrame, SchedView, SchedAction>): SchedPlay {
  let play = startSchedPlay(setup)
  for (let p = schedPending(setup, play); p; p = schedPending(setup, play)) play = schedTurn(setup, play, learner.decide(p.frame, p.view))
  return play
}

/** The learner's whole run (the reference's tail included once the play has ended). */
export const mineRun = (setup: SchedSetup, play: SchedPlay): SchedReplay => setup.model.run(play.mine)

/* ------------------------------------------------------------------ */
/* The debrief                                                          */
/* ------------------------------------------------------------------ */

/** 1024 → "1,024"; defined with the trace lines that share it. */
export { groups }
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const tok = (r: SchedViewReq) => `#${r.id} (${groups(r.prompt)} tokens)`
const ids = (xs: readonly number[]) => (xs.length === 1 ? `#${xs[0]}` : `${xs.slice(0, -1).map((x) => `#${x}`).join(', ')} and #${xs[xs.length - 1]}`)

/** "in 3 iterations", or "the iteration it arrived" for 0. */
const within = (ttft: number) => (ttft === 0 ? 'the iteration it arrived' : `in ${plural(ttft, 'iteration')}`)

/** The outcome sentence: the request, how long its first token took, and the reference's time. */
function outcomeSentence(req: SchedDivergence['request'], slo: number): string {
  const how = req.preempted > 0 ? 'was preempted and recomputed, so its first token came' : 'got its first token'
  return `#${req.id} (${groups(req.prompt)} tokens) arrived at iteration ${req.arrival} and ${how} ${plural(req.ttft, 'iteration')} later, against an SLO of ${slo}; the reference served it ${within(req.ghostTtft)}.`
}

/** "#16 its deadline", "#16, #20 and #23 their deadline", or "10 requests their deadline, #25 among them". */
function costPhrase(cost: readonly number[], about: number): string {
  if (cost.length === 1) return `#${cost[0]} its deadline`
  if (cost.length <= 4) return `${ids(cost)} their deadline`
  return `${cost.length} requests their deadline, #${cost.includes(about) ? about : cost[0]} among them`
}

/**
 * Classifies a differing turn and writes its sentence: wave-2 §8.3's four templates (preempted, over
 * headroom, order, held back), then a plain one. Every number comes from the learner's own view at the
 * turn; `cost` (the requests a hand-over at this turn would have saved) gives the consequence, and
 * `about` is the debrief's request.
 */
export function decisionSentence(
  frame: SchedFrame,
  mine: SchedAction,
  reference: SchedAction,
  cost: readonly number[],
  about: number,
): { kind: SchedDecisionKind; sentence: string } {
  const v = frame.view
  const at = `At iteration ${v.iter}`
  const byId = new Map(v.waiting.map((r) => [r.id, r]))
  if (mine.preempt.length > 0) {
    const r = v.running.find((x) => x.id === mine.preempt[0]) as SchedViewRun
    const when = r.prefillLeft > 0 ? 'while it was still prefilling' : `after ${plural(r.decoded, 'decode step')}`
    const what = cost.length === 0 ? '; the reference never preempts.' : `; recomputing it cost ${costPhrase(cost, about)}.`
    return { kind: 'preempted', sentence: `${at} you preempted #${r.id} ${when}${what}` }
  }
  const taken = effectiveAdmits(v, mine, frame.blockSize)
  const refTaken = reference.admit
  // Over headroom: in the learner's order, the first admission the reference's accounting refuses.
  // The sentence states the reference's own sum, pool - (tokens held + headroom x requests), which the free figure
  // (whole blocks, before any headroom) is not, so a learner can check the arithmetic.
  let held = v.running.reduce((a, r) => a + r.prompt + r.decoded, 0)
  let kept = v.running.length
  const before: number[] = []
  for (const id of taken) {
    const r = byId.get(id) as SchedViewReq
    const room = v.memCap - (held + kept * HEADROOM_TOKENS)
    if (r.prompt + HEADROOM_TOKENS > room && !refTaken.includes(id)) {
      const holders = plural(v.running.length, 'running request') + (before.length ? ` and the ${ids(before)} you admitted first` : '')
      const sum = `${groups(v.memCap)} - (${groups(held)} tokens held by your ${holders} + ${kept} × ${HEADROOM_TOKENS} tokens of headroom) = ${groups(room)}`
      const why =
        room <= 0
          ? `it counts ${sum}, so nothing is left for ${groups(r.prompt)} + ${HEADROOM_TOKENS}, even with ${groups(frame.free)} tokens free: the reference sets the headroom aside for decode growth before it spends free tokens on a new prompt`
          : `it counts ${sum}, and ${groups(r.prompt)} + ${HEADROOM_TOKENS} > ${groups(room)}`
      const sentence =
        `${at} you admitted #${id}, a ${groups(r.prompt)}-token prompt, with ${groups(frame.free)} tokens free. The reference skips it: ${why}.` +
        (cost.length ? ` That cost ${costPhrase(cost, about)}.` : '')
      return { kind: 'over-headroom', sentence }
    }
    held += r.prompt
    kept += 1
    before.push(id)
  }
  const skipped = refTaken.filter((id) => !taken.includes(id)).map((id) => byId.get(id) as SchedViewReq)
  const extra = taken.filter((id) => !refTaken.includes(id)).map((id) => byId.get(id) as SchedViewReq)
  const shortest = [...skipped].sort((a, b) => a.prompt - b.prompt)[0]
  const longest = [...extra].sort((a, b) => b.prompt - a.prompt)[0]
  if (shortest && longest && longest.prompt > shortest.prompt) {
    return { kind: 'order', sentence: `${at} you admitted ${tok(longest)} before ${tok(shortest)}. The reference takes the shortest first.` }
  }
  if (extra.length === 0 && skipped.length > 0) {
    const left = v.waiting.filter((r) => !taken.includes(r.id))
    const n = skipped.length
    const skippedIds = ids(skipped.map((r) => r.id))
    let sentence: string
    if (taken.length > 0) sentence = `${at} you admitted ${ids(taken)} and left ${plural(left.length, 'request')} waiting with room for ${n} more; the reference also admits ${skippedIds}.`
    else if (left.length === 1) sentence = `${at} you left ${tok(left[0])} waiting with room for it.`
    else sentence = `${at} you left ${left.length} requests waiting with room for ${n === left.length ? 'all of them' : `${n} of them`}; the reference admits ${skippedIds}.`
    return { kind: 'held-back', sentence }
  }
  const yours = taken.length ? `admitted ${ids(taken)}` : 'admitted nothing'
  const theirs = refTaken.length ? `admits ${ids(refTaken)}` : 'admits nothing'
  return { kind: 'other', sentence: `${at} you ${yours}; the reference ${theirs}.` }
}

/** Requests met by `other` and not by `mine`, by arrival then id. */
function lostTo(mine: SchedReplay, other: SchedReplay): number[] {
  return [...other.outcomes.values()]
    .filter((o) => o.met && !mine.outcomes.get(o.id)?.met)
    .sort((a, b) => a.arrival - b.arrival || a.id - b.id)
    .map((o) => o.id)
}

/**
 * The first divergence (see the file header), or null when the learner served every request the
 * ghost served within SLO. Deterministic: a pure function of the trace and the two logs.
 */
export function schedDivergence(setup: SchedSetup, play: SchedPlay): SchedDivergence | null {
  const { trace, model } = setup
  const slo = trace.cfg.sloTtft
  const mine = model.run(play.mine)
  const lost = lostTo(mine, play.ghost)
  if (lost.length === 0) return null
  const id = lost[0]
  const m = mine.outcomes.get(id) as SchedOutcome
  const g = play.ghost.outcomes.get(id) as SchedOutcome
  const request = { ...m, deadline: m.arrival + slo, ghostTtft: g.ttft }
  const outcome = outcomeSentence(request, slo)

  const handTurns = mine.turns.filter((t) => t.by === 'you' && t.frame.iter <= m.finishedAt)
  const takeOver = (turn: number) => replaySched(trace, { decisions: play.mine.decisions.slice(0, turn), rest: 'reference' })
  const reference = handTurns.map((t) => referenceScheduler(t.frame.view))
  const differs = handTurns.map((t, i) => actionsDiffer(t.frame.view, t.action, reference[i], t.frame.blockSize))
  let pick = -1
  let recoverable = false
  let handover: SchedReplay | null = null
  for (let i = handTurns.length - 1; i >= 0; i--) {
    if (!differs[i]) continue
    const run = takeOver(handTurns[i].frame.turn)
    if (run.outcomes.get(id)?.met) {
      pick = i
      recoverable = true
      handover = run
      break
    }
  }
  if (pick < 0) pick = differs.indexOf(true)
  if (pick < 0) return { request, outcome, decision: null, explanation: outcome }

  const t = handTurns[pick]
  handover ??= takeOver(t.frame.turn)
  const cost = lostTo(mine, handover)
  const { kind, sentence } = decisionSentence(t.frame, t.action, reference[pick], cost, id)
  const decision: SchedDecisionDivergence = {
    kind,
    turn: t.frame.turn,
    iter: t.frame.iter,
    mine: t.action,
    reference: reference[pick],
    recoverable,
    cost,
    sentence,
    mineFrame: t.frame,
    ghostFrame: replaySched(trace, REFERENCE_FROM_START, t.frame.iter).frame,
  }
  return { request, outcome, decision, explanation: `${outcome} ${sentence}` }
}

/* ------------------------------------------------------------------ */
/* Summary, lines and the ledger                                        */
/* ------------------------------------------------------------------ */

export interface SchedSummary {
  playId: string
  seed: number
  turns: number
  /** Requests the learner's run served within SLO. */
  survived: number
  ghostSurvived: number
  total: number
  skipped: boolean
  divergence: SchedDivergence | null
}

/** The play's summary for the debrief and the ledger. */
export function summarizeSched(setup: SchedSetup, play: SchedPlay): SchedSummary {
  return {
    playId: setup.playId,
    seed: setup.trace.seed ?? SCHED_PRACTICE_SEED,
    turns: play.turns,
    survived: setup.model.run(play.mine).met,
    ghostSurvived: play.ghost.met,
    total: setup.trace.requests.length,
    skipped: play.skipped,
    divergence: schedDivergence(setup, play),
  }
}

/** The aria-live line for one turn: "Iteration 37: admitted #12 (1,024 tokens). Free 1,104 → 64. 3 waiting." */
export function schedTurnLine(frame: SchedFrame, action: SchedAction): string {
  const v = frame.view
  const taken = effectiveAdmits(v, action, frame.blockSize)
  const byId = new Map(v.waiting.map((r) => [r.id, r]))
  let free = frame.free
  const parts: string[] = []
  for (const id of action.preempt) {
    const r = v.running.find((x) => x.id === id)
    if (!r) continue
    free += blocksFor(heldTokens(r), frame.blockSize) * frame.blockSize
    parts.push(`preempted #${id}`)
  }
  for (const id of taken) free -= blocksFor((byId.get(id) as SchedViewReq).prompt, frame.blockSize) * frame.blockSize
  parts.push(taken.length ? `admitted ${taken.map((id) => tok(byId.get(id) as SchedViewReq)).join(', ')}` : 'admitted nothing')
  const waiting = v.waiting.length - taken.length + action.preempt.length
  const mem = free === frame.free ? `Free ${groups(free)}.` : `Free ${groups(frame.free)} → ${groups(free)}.`
  return `Iteration ${v.iter}: ${parts.join(', ')}. ${mem} ${waiting} waiting.`
}

/** Why the play ended, for the end banner. */
export function schedEndLine(setup: SchedSetup, play: SchedPlay): string {
  const run = setup.model.run(play.mine)
  const served = `${run.met} of ${setup.trace.requests.length} requests got their first token within ${setup.trace.cfg.sloTtft} iterations`
  if (play.skipped) return `you skipped to the debrief and the reference finished your run: ${served}`
  if (play.ended === 'turn-cap') return `turn cap reached after ${setup.turnCap} turns; the reference finished your run: ${served}`
  return `every request completed: ${served}`
}

/** min(1, survived / ghostSurvived), 1 when the ghost served nothing. */
const ratio = (survived: number, ghostSurvived: number) => (ghostSurvived === 0 ? 1 : Math.min(1, survived / ghostSurvived))

/** The ledger result for a finished play (wave-2 §8.3): score = min(1, survived / ghostSurvived); ok = debriefed; divergenceOp = the decision's iteration. */
export function schedPlayResult(
  summary: SchedSummary,
  opts: { provenance: PlayResult['provenance']; kcs?: string[]; ms?: number },
): PlayResult {
  const data: PlayData = {
    phase: 'play',
    turns: summary.turns,
    survived: summary.survived,
    ghostSurvived: summary.ghostSurvived,
    skipped: summary.skipped,
  }
  const d = summary.divergence
  if (d) data.divergenceOp = d.decision?.iter ?? d.request.arrival
  if (opts.kcs) data.kcs = opts.kcs
  const out: PlayResult = { playId: summary.playId, score: ratio(summary.survived, summary.ghostSurvived), ok: true, seed: summary.seed, provenance: opts.provenance, data }
  if (opts.ms !== undefined) out.ms = opts.ms
  return out
}
