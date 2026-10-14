/**
 * The EPLB play's world (docs/specs/wave-3.md §5.2; PLAN-100X §5.4 W5): replicate the hot experts of one MoE layer,
 * then place every copy on a GPU, against DeepSeek EPLB's balanced packing.
 *
 * THE SCENARIO (synthetic, labelled): one layer of 16 experts on 4 GPUs of 5 slots each, so 4 replicas fit. An
 * expert's load is its share of the layer's routed tokens in integer per mille, summing to 1,000. A copy carries its
 * expert's load split evenly over the expert's copies; a GPU's load is the sum of its copies'. The imbalance is the
 * busiest GPU's load over the mean (250 ‰), lower is better: the layer's expert phase waits at the combine barrier for
 * the busiest GPU (t6.l1). Loads are kept in units of 1/60 ‰ (`UNITS_PER_PERMILLE`): an expert has 1 to 5 copies and 60
 * divides by each, so a load per copy is an integer and every comparison, ties included, is exact.
 *
 * THE DRAW (`makeLoads`). The hottest expert's load is drawn uniformly in band rule 1's range (150–300 ‰) and put at a
 * seeded position; the other 15 share the rest (at least 1 ‰ each) in proportion to a product of three uniform draws
 * in 1–100, a skewed tail. `drawEplb(entropy)` keeps the first in-band candidate: the entropy itself, then its
 * splitmix32 outputs, as the other plays' draws do; `drawLoads(seed)` is its loads.
 *
 * THE BAND (`checkEplbBand`, wave-3.md §5.2):
 *   1. the hottest expert carries 150–300 ‰;
 *   2. round robin without replicas (the copies heaviest first, copy k on GPU k mod 4) has imbalance ≥ 1.40: careless
 *      placement visibly loses, and it is the number the play asks the learner to predict;
 *   3. the ghost reaches ≤ 1.10.
 * Acceptance (measured 2026-10-14): 58.5 % of candidates 0..9,999; tests/world/eplb.test.ts re-measures it on 2,000
 * and prints it, and bands/eplb.ts prints it for verify-plays. Rule 2 does the rejecting; rule 3 almost never does.
 *
 * THE TURN RULE (`eplbModel`, a `LockstepModel` of world/play.ts). 24 ops: 4 replicate turns, then 20 place turns.
 *   - A replicate turn asks for an expert to copy (Compose's `none` dial may answer null: no copy).
 *   - A place turn offers the heaviest unplaced copy by load per copy (ties: the lower expert number) and asks for a
 *     GPU with a free slot. Copies are fixed once the replicate turns are over, so the order is too. A place turn with
 *     no copy left (only after a `none` turn) applies by itself.
 *   - A decision outside the rules (a full GPU, an expert out of range) throws: the UI offers only legal moves.
 *   - After `SKIP_AFTER_TURNS` turns the learner may skip: the ghost's rule finishes the learner's own layer.
 *
 * THE GHOST is DeepSeek EPLB (`production.eplb.rebalance`): `replicate_experts` copies the expert with the most load
 * per copy, repeatedly, and `balanced_packing` puts each copy, heaviest first, on the least-loaded GPU with a free slot.
 * Ties go to the lower index, as `max` over a tensor and Python's `min` over packs do. It is run once, up front, and
 * hidden until the debrief.
 *
 * THE DEBRIEF (`eplbDivergence`), only when the learner ends above the ghost. With R(i) = "the ghost's rule, taking over
 * the learner's layer just before turn i, ends within the bound", R holds before turn 1 (that is the ghost's own run)
 * and fails after the last. The bound is the ghost's imbalance plus the pass margin (0.05) for a learner who missed the
 * pass, and the ghost's imbalance itself for one who passed but ended above it (`recoveryMargin`). Walking back from the
 * end, the first turn d with R(d) is where the learner lost it: R(d + 1) fails, and a decision equal to the ghost's rule
 * would have kept R, so d always departs from the reference on the learner's own layer. The debrief states the
 * outcome, then that decision:
 *   - outcome: "Your busiest GPU carries 1.38× the mean, so this layer's expert phase waits 38 % longer than a
 *     balanced one. The reference's busiest carries 1.06×."
 *   - replicate: "At turn 2 you copied expert #9 (60 ‰ per copy). The reference copies #3: 140 ‰ per copy is the
 *     heaviest." (loads per copy before the copy, both read from the learner's layer);
 *   - place: "At turn 15 you put #3's copy (70 ‰) on GPU 2, already at 260 ‰. The reference puts it on GPU 4, the least
 *     loaded with a free slot (190 ‰)." The reference's GPU is the ghost's pick on the learner's layer at that turn;
 *   - each decision sentence ends with its consequence: "From your layer after that turn, even the reference's rule
 *     ends at 1.12×; on its own it reaches 1.06×."
 * A decision that only breaks a tie differently gets its own wording ("…, which ties at 70 ‰ per copy and comes
 * first"; "…, also at 190 ‰: of the least loaded with a free slot, it takes the lowest number"). Experts are #1–#16
 * and GPUs 1–4 for the learner; turns count from 1, so turns 1–4 replicate and 5–24 place. Multipliers print with two
 * decimals, or more when two of them would otherwise read the same.
 *
 * OPUS CHECK (3a-14; tests/world/eplb.test.ts, "Opus check", which pins every count below): the turn rule, the band
 * and the sentences on 50 banded loads and six simulated learners: round robin (the reference's copies, the k-th copy
 * on GPU k mod 4), copying by total load, filling the GPUs in order, copying the coldest experts, the reference with
 * one slip (the second-least-loaded GPU at one seeded place turn) and a seeded random player. 300 plays, 229 ended
 * above the ghost. Approved, with these findings:
 *   - every one of the 229 got a decision at which R(d) held and R(d + 1) failed, and no later turn was recoverable;
 *     each departed from the reference on the learner's own layer. Each learner's mistake landed on its own kind:
 *     round robin 50 of 50 place, filling in order 50 of 50 place (turn 7 or 8: the third or fourth heavy copy on
 *     GPU 1), copying by total 28 of 28 replicate, cold copies 36 of 36 replicate, the slip 15 of 15 place, random 25
 *     replicate and 25 place;
 *   - the bound. With the exact bound alone (R = "ends at or below the ghost"), round robin, 0.10× above the ghost on one
 *     load, was blamed for turn 9, after which the reference still reached 1.006× against its own 1.005×, rather than
 *     for the later moves that cost the 0.10×. Against the pass margin, the turn named is the last one after which
 *     even the reference could not pass, so round robin's blame moved from turns 9–17 to 13–21, and the random
 *     player's from turns 1–8 to 3–14. A learner who passed keeps the exact bound (copying by total load: all 28 of its
 *     debriefs passed);
 *   - copying by total load costs little on these loads: 22 of 50 matched or beat the ghost and the rest stayed within
 *     the pass margin. Which expert to copy matters most when two experts are hot and the hottest outweighs a GPU's
 *     share (250 ‰), so the practice load is chosen to punish every shortcut (`EPLB_PRACTICE_SEED`; two experts at
 *     264 and 235 ‰), as the block-placement play's practice seed is chosen to punish first fit;
 *   - no replicas sometimes beats the ghost (20 copies at exactly 5 per GPU pack less freely than 16), so a learner can
 *     end below the reference; such a play has no debrief;
 *   - ties: none of the 229 named a tie, but the spec's single-number "already at 260 ‰" would misread one (two GPUs
 *     at one load: the reference takes the lower number), so a tie has its own wording, tested directly;
 *   - the consequence clause ("From your layer after that turn, even the reference's rule ends at 1.09×; on its own it
 *     reaches 1.03×") was added because the turn named is often not the learner's worst-looking move but the last one
 *     after which the reference cannot recover, and the two numbers show it.
 */

import type { PlayData, PlayResult } from '@/lib/ledger/types'
import { splitmix32u } from '@/lib/rng'
import { SKIP_AFTER_TURNS, type Decider, type LockstepModel, type LockstepSetup, type PlayState } from './play'

export { SKIP_AFTER_TURNS }

export const EPLB_PLAY_ID = 'eplb'
export const EXPERTS = 16
export const GPUS = 4
export const SLOTS_PER_GPU = 5
/** Spare slots, so replicate turns: 4. */
export const REPLICATE_TURNS = GPUS * SLOTS_PER_GPU - EXPERTS
/** One per slot: 20. */
export const PLACE_TURNS = GPUS * SLOTS_PER_GPU
export const EPLB_TURNS = REPLICATE_TURNS + PLACE_TURNS
export const TOTAL_PERMILLE = 1000
/** Loads are kept in 1/60 ‰: an expert has 1–5 copies, and 60 divides by each. */
export const UNITS_PER_PERMILLE = 60
/** The mean GPU's load, 250 ‰, in units. */
export const MEAN_UNITS = (TOTAL_PERMILLE * UNITS_PER_PERMILLE) / GPUS
/** The pass margin (wave-3.md §3.2, §5.2): within 0.05 of the ghost's imbalance, in units of load. */
export const PASS_MARGIN_UNITS = MEAN_UNITS / 20

/** The band (wave-3.md §5.2): imbalances in hundredths. */
export const EPLB_BAND = {
  hottestPermille: { min: 150, max: 300 },
  roundRobinMinHundredths: 140,
  ghostMaxHundredths: 110,
}

/* ------------------------------------------------------------------ */
/* Loads and the band                                                   */
/* ------------------------------------------------------------------ */

/** Splits `total` over `raw`'s proportions by largest remainder (ties to the lower index). */
function shares(raw: readonly number[], total: number): number[] {
  const sum = raw.reduce((a, b) => a + b, 0)
  const out = raw.map((r) => Math.floor((r * total) / sum))
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, rem: r * total - out[i] * sum })).sort((a, b) => b.rem - a.rem || a.i - b.i)
  for (const { i } of order) {
    if (left === 0) break
    out[i]++
    left--
  }
  return out
}

/** One candidate's 16 loads in integer per mille, summing to 1,000 (see the file header). Not banded: `drawLoads` is. */
export function makeLoads(candidate: number): number[] {
  const next = splitmix32u(candidate)
  const { min, max } = EPLB_BAND.hottestPermille
  const hot = min + (next() % (max - min + 1))
  const raw = Array.from({ length: EXPERTS - 1 }, () => (1 + (next() % 100)) * (1 + (next() % 100)) * (1 + (next() % 100)))
  const tail = shares(raw, TOTAL_PERMILLE - hot - (EXPERTS - 1)).map((x) => x + 1)
  const at = next() % EXPERTS
  return [...tail.slice(0, at), hot, ...tail.slice(at)]
}

/** Load per copy of each expert, in units. */
const perCopyOf = (loads: readonly number[], copies: readonly number[]) => loads.map((l, e) => (l * UNITS_PER_PERMILLE) / copies[e])

/** Round robin without replicas: the 16 experts heaviest first, the k-th on GPU k mod 4. The busiest GPU's load, in units. */
export function roundRobinUnits(loads: readonly number[]): number {
  const order = loads.map((l, e) => ({ e, l })).sort((a, b) => b.l - a.l || a.e - b.e)
  const gpu = new Array<number>(GPUS).fill(0)
  order.forEach(({ l }, k) => (gpu[k % GPUS] += l * UNITS_PER_PERMILLE))
  return Math.max(...gpu)
}

/** An imbalance in hundredths, rounded: 1.38× is 138. */
export const hundredths = (units: number) => Math.round((units * 100) / MEAN_UNITS)
/** The imbalance itself: the busiest GPU's load over the mean. */
export const imbalanceOf = (units: number) => units / MEAN_UNITS

export interface EplbBandCheck {
  inBand: boolean
  violations: string[]
  hottest: number
  /** Busiest GPU, in units: round robin without replicas, and the ghost. */
  roundRobin: number
  ghost: number
}

/** Checks the three band rules on one set of loads. */
export function checkEplbBand(loads: readonly number[]): EplbBandCheck {
  const hottest = Math.max(...loads)
  const roundRobin = roundRobinUnits(loads)
  const ghost = runEplb(loads, EPLB_GHOST).maxUnits
  const violations: string[] = []
  const { hottestPermille: h, roundRobinMinHundredths, ghostMaxHundredths } = EPLB_BAND
  if (hottest < h.min || hottest > h.max) violations.push(`the hottest expert carries ${hottest} ‰, outside ${h.min}–${h.max} ‰`)
  // Exact: units × 100 against the bound × the mean, never a rounded ratio.
  if (roundRobin * 100 < roundRobinMinHundredths * MEAN_UNITS) violations.push(`round robin without replicas reaches only ${times(roundRobin)}×`)
  if (ghost * 100 > ghostMaxHundredths * MEAN_UNITS) violations.push(`the reference reaches ${times(ghost)}×`)
  return { inBand: violations.length === 0, violations, hottest, roundRobin, ghost }
}

/** Give up after this many rejected candidates (acceptance is above half, so 256 never happens in practice). */
export const MAX_DRAWS = 256

export interface EplbDraw {
  loads: number[]
  /** The in-band candidate the loads came from. */
  candidate: number
  /** Candidates tried, rejected ones included. */
  draws: number
  band: EplbBandCheck
}

/** Turns entropy into in-band loads: the entropy itself first, then its splitmix32 outputs. */
export function drawEplb(entropy: number): EplbDraw {
  const more = splitmix32u(entropy)
  let candidate = entropy >>> 0
  for (let draws = 1; draws <= MAX_DRAWS; draws++) {
    const loads = makeLoads(candidate)
    const band = checkEplbBand(loads)
    if (band.inBand) return { loads, candidate, draws, band }
    candidate = more()
  }
  throw new Error(`no in-band EPLB loads in ${MAX_DRAWS} draws: the band no longer matches the generator`)
}

/** 16 in-band expert loads for this seed, in integer per mille summing to 1,000. */
export const drawLoads = (seed: number): number[] => drawEplb(seed).loads

/**
 * The practice load: the first candidate from 0 that is in band and on which every natural shortcut misses the ghost
 * by more than the pass margin: no replicas, copying by total load, and round-robin placement (each with the other
 * dial at the reference's setting). So on the practice load, Compose passes only with the reference's two dials.
 * `firstPracticeSeed` (eplb-policy.ts, where the dials live) re-derives it in the tests.
 */
export const EPLB_PRACTICE_SEED = 12

/** The practice load's 16 loads (the candidate itself, not a draw from it: it is in band). */
export const practiceLoads = (): number[] => makeLoads(EPLB_PRACTICE_SEED)

/* ------------------------------------------------------------------ */
/* The lockstep model                                                   */
/* ------------------------------------------------------------------ */

export type EplbOp = { kind: 'replicate' | 'place'; turn: number }

/** The 24 ops: 4 replicate turns, then 20 place turns. */
export const EPLB_OPS: readonly EplbOp[] = Object.freeze(
  Array.from({ length: EPLB_TURNS }, (_, turn): EplbOp => Object.freeze({ kind: turn < REPLICATE_TURNS ? 'replicate' : 'place', turn })),
)

/** The whole layer. Immutable. */
export interface EplbState {
  readonly loads: readonly number[]
  /** Copies per expert, 1–5. */
  readonly copies: readonly number[]
  /** Copies placed per expert. */
  readonly placed: readonly number[]
  /** The expert of each copy on each GPU, in placement order. */
  readonly gpus: readonly (readonly number[])[]
  /** Ops applied. */
  readonly turn: number
}

export interface EplbCopy {
  expert: number
  /** Its load per copy, in units. */
  units: number
}

export interface EplbGpu {
  /** The expert of each copy it holds, in placement order. */
  experts: readonly number[]
  /** Its load, in units. */
  units: number
  free: number
}

export interface EplbView {
  /** The next turn's index (0–23); 24 when done. */
  turn: number
  phase: 'replicate' | 'place' | 'done'
  loads: readonly number[]
  copies: readonly number[]
  /** Load per copy of each expert, in units. */
  perCopy: readonly number[]
  gpus: readonly EplbGpu[]
  /** Copies still to place, heaviest first: `queue[0]` is the copy a place turn offers. */
  queue: readonly EplbCopy[]
  /** The busiest GPU's load, in units. */
  maxUnits: number
}

export type EplbReq = { kind: 'replicate' } | { kind: 'place'; copy: EplbCopy }
/** A replicate decision names an expert, or null for no copy (Compose's `none`); a place decision names a GPU. */
export type EplbDecision = { kind: 'replicate'; expert: number | null } | { kind: 'place'; gpu: number }

/** Copies still to place, heaviest per copy first, ties to the lower expert. */
function queueOf(s: EplbState, perCopy: readonly number[]): EplbCopy[] {
  const out: EplbCopy[] = []
  for (let e = 0; e < EXPERTS; e++) for (let c = s.placed[e]; c < s.copies[e]; c++) out.push({ expert: e, units: perCopy[e] })
  return out.sort((a, b) => b.units - a.units || a.expert - b.expert)
}

/** The view of a layer. */
export function eplbView(s: EplbState): EplbView {
  const perCopy = perCopyOf(s.loads, s.copies)
  const gpus = s.gpus.map((experts) => ({ experts, units: experts.reduce((a, e) => a + perCopy[e], 0), free: SLOTS_PER_GPU - experts.length }))
  const queue = queueOf(s, perCopy)
  const phase = s.turn < REPLICATE_TURNS ? 'replicate' : queue.length > 0 && s.turn < EPLB_TURNS ? 'place' : 'done'
  return { turn: s.turn, phase, loads: s.loads, copies: s.copies, perCopy, gpus, queue, maxUnits: Math.max(...gpus.map((g) => g.units)) }
}

/** Why `decision` is not a legal move for `op` on `s` (empty = fine): decisions may come from untrusted input. */
export function eplbDecisionProblems(s: EplbState, op: EplbOp, decision: EplbDecision | null): string[] {
  if (op.turn !== s.turn) return [`turn ${op.turn + 1} is not the next turn (${s.turn + 1})`]
  if (decision === null) return [`turn ${op.turn + 1} needs a decision`]
  if (decision.kind !== op.kind) return [`turn ${op.turn + 1} is a ${op.kind} turn`]
  if (decision.kind === 'replicate') {
    const e = decision.expert
    if (e === null) return []
    if (!Number.isInteger(e) || e < 0 || e >= EXPERTS) return [`expert ${String(e)} is not 0–${EXPERTS - 1}`]
    return []
  }
  const g = decision.gpu
  if (!Number.isInteger(g) || g < 0 || g >= GPUS) return [`GPU ${String(g)} is not 0–${GPUS - 1}`]
  if (s.gpus[g].length >= SLOTS_PER_GPU) return [`GPU ${g + 1} has no free slot`]
  return []
}

export type EplbModel = LockstepModel<EplbState, EplbOp, EplbReq, EplbDecision, EplbView>
export type EplbSetup = LockstepSetup<EplbState, EplbOp, EplbReq, EplbDecision, EplbView>
export type EplbPlay = PlayState<EplbState, EplbView>

const freeze = <T>(xs: T[]): readonly T[] => Object.freeze(xs)

/** The layer as a lockstep world (see the file header). */
export function eplbModel(loads: readonly number[]): EplbModel {
  if (loads.length !== EXPERTS) throw new Error(`the play has ${EXPERTS} experts, not ${loads.length}`)
  if (!loads.every((l) => Number.isInteger(l) && l >= 0) || loads.reduce((a, b) => a + b, 0) !== TOTAL_PERMILLE) {
    throw new Error(`loads must be whole per mille summing to ${TOTAL_PERMILLE}`)
  }
  const fixed = freeze([...loads])
  return {
    init: () =>
      Object.freeze({
        loads: fixed,
        copies: freeze(new Array<number>(EXPERTS).fill(1)),
        placed: freeze(new Array<number>(EXPERTS).fill(0)),
        gpus: freeze(Array.from({ length: GPUS }, () => freeze<number>([]))),
        turn: 0,
      }),
    ask(state, op) {
      if (op.kind === 'replicate') return { kind: 'replicate' }
      const v = eplbView(state)
      return v.queue.length > 0 ? { kind: 'place', copy: v.queue[0] } : null
    },
    apply(state, op, decision) {
      if (op.kind === 'place' && eplbView(state).queue.length === 0) return { ok: true, state: Object.freeze({ ...state, turn: state.turn + 1 }) }
      const problems = eplbDecisionProblems(state, op, decision)
      if (problems.length) throw new Error(problems.join('; '))
      const d = decision as EplbDecision
      if (d.kind === 'replicate') {
        if (d.expert === null) return { ok: true, state: Object.freeze({ ...state, turn: state.turn + 1 }) }
        const copies = freeze(state.copies.map((c, e) => (e === d.expert ? c + 1 : c)))
        return { ok: true, state: Object.freeze({ ...state, copies, turn: state.turn + 1 }), at: d.expert }
      }
      const expert = eplbView(state).queue[0].expert
      const placed = freeze(state.placed.map((p, e) => (e === expert ? p + 1 : p)))
      const gpus = freeze(state.gpus.map((g, i) => (i === d.gpu ? freeze([...g, expert]) : g)))
      return { ok: true, state: Object.freeze({ ...state, placed, gpus, turn: state.turn + 1 }), at: d.gpu }
    },
    view: eplbView,
  }
}

/* ------------------------------------------------------------------ */
/* The ghost                                                            */
/* ------------------------------------------------------------------ */

/** The expert with the most load per copy, ties to the lower number: `replicate_experts`' choice. */
export function heaviestPerCopy(v: EplbView): number {
  let best = 0
  for (let e = 1; e < EXPERTS; e++) if (v.perCopy[e] > v.perCopy[best]) best = e
  return best
}

/** The least-loaded GPU with a free slot, ties to the lower number: `balanced_packing`'s choice. */
export function leastLoadedFree(v: EplbView): number {
  let best = -1
  for (let g = 0; g < GPUS; g++) if (v.gpus[g].free > 0 && (best < 0 || v.gpus[g].units < v.gpus[best].units)) best = g
  if (best < 0) throw new Error('no GPU has a free slot')
  return best
}

/** DeepSeek EPLB's balanced packing as a lockstep decider. */
export const EPLB_GHOST: Decider<EplbView, EplbReq, EplbDecision> = {
  name: 'DeepSeek EPLB',
  decide: (v, req) => (req.kind === 'replicate' ? { kind: 'replicate', expert: heaviestPerCopy(v) } : { kind: 'place', gpu: leastLoadedFree(v) }),
}

/* ------------------------------------------------------------------ */
/* The play                                                             */
/* ------------------------------------------------------------------ */

/** The play on one set of loads, against the hidden ghost. `seed` is what the ledger records. */
export function eplbSetup(loads: readonly number[], seed: number): EplbSetup {
  return { playId: EPLB_PLAY_ID, seed, model: eplbModel(loads), ops: EPLB_OPS, ghost: EPLB_GHOST, turnCap: EPLB_TURNS }
}

/** The skip is offered after `SKIP_AFTER_TURNS` turns. */
export const canSkipEplb = (ps: EplbPlay) => !ps.mine.ended && ps.turns >= SKIP_AFTER_TURNS

type EplbDecider = Decider<EplbView, EplbReq, EplbDecision>

/** `decider` playing a layer from turn `from` to the end: the final layer. */
function finish(model: EplbModel, state: EplbState, from: number, decider: EplbDecider): EplbState {
  let s = state
  for (let i = from; i < EPLB_OPS.length; i++) {
    const req = model.ask(s, EPLB_OPS[i])
    s = model.apply(s, EPLB_OPS[i], req === null ? null : decider.decide(model.view(s), req)).state
  }
  return s
}

/** A whole run of one decider on these loads: its final layer. Compose's row, the band's ghost. */
export function runEplb(loads: readonly number[], decider: EplbDecider): EplbView {
  const model = eplbModel(loads)
  return eplbView(finish(model, model.init(), 0, decider))
}

/** The ghost's rule finishing a layer from turn `from`: the busiest GPU's load at the end, in units. */
const handover = (setup: EplbSetup, state: EplbState, from: number) => eplbView(finish(setup.model, state, from, setup.ghost)).maxUnits

/* ------------------------------------------------------------------ */
/* The debrief                                                          */
/* ------------------------------------------------------------------ */

/** Expert e as the learner sees it: #1–#16. */
export const expertLabel = (e: number) => `#${e + 1}`
/** GPU g as the learner sees it: GPU 1–4. */
export const gpuLabel = (g: number) => `GPU ${g + 1}`

/** A load in units as per mille: "70 ‰", or "77.5 ‰" when it is not whole (one decimal). */
export function permille(units: number): string {
  if (units % UNITS_PER_PERMILLE === 0) return `${units / UNITS_PER_PERMILLE} ‰`
  return `${(Math.round((units * 10) / UNITS_PER_PERMILLE) / 10).toFixed(1)} ‰`
}

/** An imbalance as a multiplier with `decimals` places: "1.38". */
export const times = (units: number, decimals = 2) => imbalanceOf(units).toFixed(decimals)

/** Two imbalances printed so they read differently when they differ: two decimals, or more. */
function timesPair(a: number, b: number): [string, string] {
  let d = 2
  while (a !== b && d < 6 && times(a, d) === times(b, d)) d++
  return [times(a, d), times(b, d)]
}

export interface EplbDecisionDivergence {
  kind: 'replicate' | 'place'
  /** The op index; the learner's turn number is op + 1. */
  op: number
  mine: EplbDecision
  /** The ghost's rule on the learner's own layer at that turn. */
  reference: EplbDecision
  /** The learner's layer just before the turn: every number in the sentence is read from it. */
  before: EplbView
  /** The busiest GPU (units) when the ghost's rule takes over the learner's layer before the turn, and after it. */
  handoverBefore: number
  handoverAfter: number
  sentence: string
}

export interface EplbDivergence {
  /** The busiest GPU's load at the end, in units: the learner's, and the ghost's. */
  mineUnits: number
  ghostUnits: number
  outcome: string
  decision: EplbDecisionDivergence
  /** The outcome, then the decision. */
  explanation: string
}

/** The outcome sentence: the learner's imbalance as the expert phase's wait, then the reference's. */
export function outcomeSentence(mineUnits: number, ghostUnits: number): string {
  const [mine, ghost] = timesPair(mineUnits, ghostUnits)
  const pct = hundredths(mineUnits) - 100
  const longer = pct >= 1 ? `${pct} % longer` : 'under 1 % longer'
  return `Your busiest GPU carries ${mine}× the mean, so this layer's expert phase waits ${longer} than a balanced one. The reference's busiest carries ${ghost}×.`
}

/** The decision sentence for turn `op` (see the file header), with its consequence. */
export function decisionSentence(
  op: number,
  before: EplbView,
  mine: EplbDecision,
  reference: EplbDecision,
  after: { handoverAfter: number; ghostUnits: number },
): string {
  const at = `At turn ${op + 1}`
  let head: string
  if (mine.kind === 'replicate' && reference.kind === 'replicate') {
    const r = reference.expert as number
    const theirs = permille(before.perCopy[r])
    if (mine.expert === null) head = `${at} you made no copy. The reference copies ${expertLabel(r)}: ${theirs} per copy is the heaviest.`
    else {
      const m = mine.expert
      const yours = `${at} you copied expert ${expertLabel(m)} (${permille(before.perCopy[m])} per copy).`
      head =
        before.perCopy[m] === before.perCopy[r]
          ? `${yours} The reference copies ${expertLabel(r)}, which ties at ${theirs} per copy and comes first.`
          : `${yours} The reference copies ${expertLabel(r)}: ${theirs} per copy is the heaviest.`
    }
  } else if (mine.kind === 'place' && reference.kind === 'place') {
    const copy = before.queue[0]
    const m = before.gpus[mine.gpu].units
    const r = before.gpus[reference.gpu].units
    const yours = `${at} you put ${expertLabel(copy.expert)}'s copy (${permille(copy.units)}) on ${gpuLabel(mine.gpu)}`
    head =
      m === r
        ? `${yours}, at ${permille(m)}. The reference puts it on ${gpuLabel(reference.gpu)}, also at ${permille(r)}: of the least loaded with a free slot, it takes the lowest number.`
        : `${yours}, already at ${permille(m)}. The reference puts it on ${gpuLabel(reference.gpu)}, the least loaded with a free slot (${permille(r)}).`
  } else throw new Error('the two decisions are for different kinds of turn')
  const [then, own] = timesPair(after.handoverAfter, after.ghostUnits)
  return `${head} From your layer after that turn, even the reference's rule ends at ${then}×; on its own it reaches ${own}×.`
}

/**
 * How far above the ghost a hand-over may end and still count as recovered, in units: the pass margin for a learner
 * who missed the pass, so the turn named is the one after which even the reference could not pass; nothing for a
 * learner who passed but ended above the ghost, so the turn named is the one after which it could not match itself.
 */
export const recoveryMargin = (mineUnits: number, ghostUnits: number) => (eplbPasses(mineUnits, ghostUnits) ? 0 : PASS_MARGIN_UNITS)

/**
 * The first divergence (see the file header), or null when the learner ended at or below the ghost's imbalance.
 * Needs a finished play. Deterministic: a pure function of the loads and the two runs.
 */
export function eplbDivergence(setup: EplbSetup, ps: EplbPlay): EplbDivergence | null {
  if (!ps.mine.ended) throw new Error('the debrief needs a finished play')
  const mineUnits = eplbView(ps.mine.state).maxUnits
  const ghostUnits = eplbView(ps.ghost.state).maxUnits
  if (mineUnits <= ghostUnits) return null
  const bound = ghostUnits + recoveryMargin(mineUnits, ghostUnits)
  const n = ps.mine.steps.length
  let d = n - 1
  // R(n) fails (the learner ended above the bound); R(0) is the ghost's own run, so the walk always stops.
  while (d > 0 && handover(setup, ps.mine.before[d], d) > bound) d--
  const state = ps.mine.before[d]
  const before = eplbView(state)
  const req = setup.model.ask(state, setup.ops[d])
  if (req === null) throw new Error(`turn ${d + 1} asked nothing, so it cannot be where the run was lost`)
  const reference = setup.ghost.decide(before, req)
  const mine = mineDecision(ps.mine.steps[d].at, req)
  const handoverBefore = handover(setup, state, d)
  const handoverAfter = handover(setup, ps.mine.before[d + 1] ?? ps.mine.state, d + 1)
  const sentence = decisionSentence(d, before, mine, reference, { handoverAfter, ghostUnits })
  const outcome = outcomeSentence(mineUnits, ghostUnits)
  return {
    mineUnits,
    ghostUnits,
    outcome,
    decision: { kind: req.kind, op: d, mine, reference, before, handoverBefore, handoverAfter, sentence },
    explanation: `${outcome} ${sentence}`,
  }
}

/** The learner's decision at a step, from its record: `at` is the expert copied or the GPU chosen. */
function mineDecision(at: number | undefined, req: EplbReq): EplbDecision {
  if (req.kind === 'replicate') return { kind: 'replicate', expert: at ?? null }
  if (at === undefined) throw new Error('a place step always records its GPU')
  return { kind: 'place', gpu: at }
}

/* ------------------------------------------------------------------ */
/* Summary, lines and the ledger                                        */
/* ------------------------------------------------------------------ */

export interface EplbSummary {
  playId: string
  seed: number
  turns: number
  skipped: boolean
  /** The busiest GPU's load at the end, in units. */
  mineUnits: number
  ghostUnits: number
  /** Copies placed: 20 on a finished play. */
  placed: number
  ghostPlaced: number
  divergence: EplbDivergence | null
}

const placedOf = (s: EplbState) => s.placed.reduce((a, b) => a + b, 0)

/** The play's summary for the debrief and the ledger. */
export function summarizeEplb(setup: EplbSetup, ps: EplbPlay): EplbSummary {
  return {
    playId: setup.playId,
    seed: setup.seed,
    turns: ps.turns,
    skipped: ps.skipped,
    mineUnits: eplbView(ps.mine.state).maxUnits,
    ghostUnits: eplbView(ps.ghost.state).maxUnits,
    placed: placedOf(ps.mine.state),
    ghostPlaced: placedOf(ps.ghost.state),
    divergence: eplbDivergence(setup, ps),
  }
}

/** Whether an imbalance passes against the ghost's (wave-3.md §3.2): mine ≤ ghost + 0.05, compared exactly in units. */
export const eplbPasses = (mineUnits: number, ghostUnits: number) => mineUnits <= ghostUnits + PASS_MARGIN_UNITS

/**
 * The aria-live line for one turn: "Turn 2: copied expert #3, now 2 copies of 117.5 ‰." or "Turn 6: #3's copy (70 ‰)
 * on GPU 2, now 260 ‰. Busiest GPU 1.04× the mean." (the running imbalance, over the final mean of 250 ‰).
 */
export function eplbTurnLine(before: EplbView, decision: EplbDecision, after: EplbView): string {
  const at = `Turn ${before.turn + 1}:`
  if (decision.kind === 'replicate') {
    if (decision.expert === null) return `${at} no copy.`
    const e = decision.expert
    return `${at} copied expert ${expertLabel(e)}, now ${after.copies[e]} copies of ${permille(after.perCopy[e])}.`
  }
  const copy = before.queue[0]
  const busiest = `Busiest GPU ${times(after.maxUnits)}× the mean.`
  return `${at} ${expertLabel(copy.expert)}'s copy (${permille(copy.units)}) on ${gpuLabel(decision.gpu)}, now ${permille(after.gpus[decision.gpu].units)}. ${busiest}`
}

/** The ledger result for a finished play (wave-3.md §3.2): score = min(1, ghost ÷ mine); ok = mine ≤ ghost + 0.05. */
export function eplbPlayResult(summary: EplbSummary, opts: { provenance: PlayResult['provenance']; kcs?: string[]; ms?: number }): PlayResult {
  const mine = imbalanceOf(summary.mineUnits)
  const ghost = imbalanceOf(summary.ghostUnits)
  const data: PlayData = {
    phase: 'play',
    turns: summary.turns,
    survived: summary.placed,
    ghostSurvived: summary.ghostPlaced,
    skipped: summary.skipped,
    metric: { name: 'imbalance', mine, ghost, lowerIsBetter: true },
  }
  if (summary.divergence) data.divergenceOp = summary.divergence.decision.op
  if (opts.kcs) data.kcs = opts.kcs
  const out: PlayResult = {
    playId: summary.playId,
    score: Math.min(1, summary.ghostUnits / summary.mineUnits),
    ok: eplbPasses(summary.mineUnits, summary.ghostUnits),
    seed: summary.seed,
    provenance: opts.provenance,
    data,
  }
  if (opts.ms !== undefined) out.ms = opts.ms
  return out
}
