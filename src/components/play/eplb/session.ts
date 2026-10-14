/**
 * The EPLB play's session (docs/specs/wave-3.md §5.2, task 3b-02): what the components drive, as plain functions so the
 * rules run under `bun test` (tests/plays/eplb.test.ts) and a component keeps none of its own. The world is
 * src/lib/world/eplb.ts (the layer, the turn rule, the ghost, the debrief's sentences); this file adds what a screen
 * needs on top of it: the prediction that opens the play, the turn the learner is on, the aria-live line per turn, the
 * pass tally across loads (rebuilt from the ledger's play events), Compose's dials and report, and the ledger writes.
 *
 * THE LOOP. Predict (round robin without replicas: the busiest GPU's load over the mean, as a number), then 4 replicate
 * turns and 20 place turns by hand, then the debrief, then Compose. The ghost lives inside `play.ghost` (the lockstep
 * runner plays it up front) and is read only by the debrief: `stageOf` and everything the play screen draws are built from
 * the learner's own layer, so nothing before the debrief can show it.
 *
 * THE PREDICTION is written as a `predict` event (src `play`, ref `item:eplb.round-robin`) the moment it is locked in, with
 * its truth: the world's own round-robin placement, which band rule 2 also computes. It is scored on a log scale, as every
 * estimate in the course is (`score = max(0, 1 − logErr / log10(5 · factor))`), and counts as right within a factor of
 * `EPLB_RIGHT_FACTOR` (1.2, that is 20 %): an imbalance lies between 1 and 4, and the band puts round robin at 1.4 or
 * more, so the factor of 2 that the cube allows its intensities would call nearly every guess right.
 */

import { byId } from '@/data/claims'
import { EPLB } from '@/data/plays'
import type { ItemResponse, LedgerClient, LedgerEvent, PlayResult } from '@/lib/ledger/types'
import { rev32 } from '@/lib/ledger/stable'
import { splitmix32u } from '@/lib/rng'
import {
  EPLB_GHOST,
  EPLB_PLAY_ID,
  EPLB_PRACTICE_SEED,
  EPLB_TURNS,
  EXPERTS,
  GPUS,
  MEAN_UNITS,
  PASS_MARGIN_UNITS,
  REPLICATE_TURNS,
  SLOTS_PER_GPU,
  UNITS_PER_PERMILLE,
  canSkipEplb,
  drawEplb,
  eplbDecisionProblems,
  eplbPasses,
  eplbPlayResult,
  eplbSetup,
  eplbTurnLine,
  eplbView,
  expertLabel,
  gpuLabel,
  imbalanceOf,
  permille,
  practiceLoads,
  roundRobinUnits,
  runEplb,
  summarizeEplb,
  times,
  type EplbCopy,
  type EplbDecision,
  type EplbPlay,
  type EplbSetup,
  type EplbSummary,
  type EplbView,
} from '@/lib/world/eplb'
import { REFERENCE_EPLB_SPEC, eplbComposeResult, eplbEquivalent, firstDifference, runEplbSpec, type EplbPolicySpec } from '@/lib/world/eplb-policy'
import { pendingAsk, playTurn, skipToDebrief, startPlay } from '@/lib/world/play'

export { EPLB_PLAY_ID, EPLB_TURNS, EXPERTS, GPUS, MEAN_UNITS, REPLICATE_TURNS, SLOTS_PER_GPU, expertLabel, gpuLabel, permille, times }

/** The mean GPU's load in per mille: 250. */
export const MEAN_PERMILLE = MEAN_UNITS / UNITS_PER_PERMILLE

/** The lesson the play lives in: the events carry it as `lessonId`. */
export const EPLB_LESSON = 't6.l2'
/** A prediction within this factor of round robin's imbalance counts as right (20 %). */
export const EPLB_RIGHT_FACTOR = 1.2
/** Nominal seconds of the prediction (a prequestion's, `PRE_NSEC`; a test holds them equal). */
export const PREDICT_NSEC = 20
/** The ref of the opening prediction: one question, asked on a new load each session. */
export const PREDICT_REF = 'item:eplb.round-robin' as const
/** Its content fingerprint: the question and its unit, so a reworded question starts a new one. */
export const PREDICT_REV = rev32({ id: PREDICT_REF, q: 'busiest GPU load over the mean, round robin without replicas', unit: '×' })

/* ------------------------------------------------------------------ */
/* The prediction                                                       */
/* ------------------------------------------------------------------ */

export interface Prediction {
  value: number
  /** Round robin's imbalance on this load. */
  truth: number
  /** |log10(value / truth)|. */
  logErr: number
  ok: boolean
  score: number
}

/** An imbalance lies between 1 (every GPU the mean) and the GPU count (one GPU carries everything). */
export const PREDICT_RANGE = { min: 1, max: GPUS } as const

/**
 * The number a field holds: digits with a decimal point or comma, an optional trailing × or x. Whatever else is typed is a
 * problem to say, not a guess to make.
 */
export function parsePrediction(text: string): { ok: true; value: number } | { ok: false; problem: string } {
  const t = text.trim().replace(/\s*[×x]$/i, '')
  if (t === '') return { ok: false, problem: 'Type a number, such as 1.5.' }
  if (!/^\d+([.,]\d+)?$|^[.,]\d+$/.test(t)) return { ok: false, problem: 'That is not a number I can read. Digits and one decimal point only, such as 1.5.' }
  const value = Number(t.replace(',', '.'))
  if (value < PREDICT_RANGE.min || value > PREDICT_RANGE.max) {
    return { ok: false, problem: `The busiest GPU carries at least the mean (1×) and at most everything (${PREDICT_RANGE.max}× with ${GPUS} GPUs).` }
  }
  return { ok: true, value }
}

/** The prediction against round robin's imbalance on `loads`. */
export function predictionOf(value: number, loads: readonly number[]): Prediction {
  const truth = imbalanceOf(roundRobinUnits(loads))
  const logErr = Math.abs(Math.log10(value / truth))
  return {
    value,
    truth,
    logErr,
    ok: logErr <= Math.log10(EPLB_RIGHT_FACTOR) + 1e-9,
    score: Math.max(0, 1 - logErr / Math.log10(5 * EPLB_RIGHT_FACTOR)),
  }
}

const fixed2 = (x: number) => x.toFixed(2)

/** The prediction's error in the play's wording: what was said, what round robin gives, how far apart, and whether that counts. */
export function errorLine(p: Prediction): string {
  const factor = 10 ** p.logErr
  const pct = Math.round((EPLB_RIGHT_FACTOR - 1) * 100)
  const inside = p.ok ? `inside the ${pct} % that counts as right` : `outside the ${pct} % that counts as right`
  return `You predicted ${fixed2(p.value)}× for round robin without replicas; it gives ${fixed2(p.truth)}×. You were off by a factor of ${fixed2(factor)}, ${inside}.`
}

/* ------------------------------------------------------------------ */
/* One play session                                                     */
/* ------------------------------------------------------------------ */

export type EplbProvenance = 'practice' | 'unseen'

export interface EplbSession {
  /** What the ledger records: the in-band candidate the loads come from (`makeLoads(seed)`), or the practice seed. */
  seed: number
  provenance: EplbProvenance
  loads: readonly number[]
  setup: EplbSetup
  /** Both sides of the lockstep run. Only the debrief may read `play.ghost`. */
  play: EplbPlay
  /** Locked in before the first turn. */
  prediction: Prediction | null
  /** The last turn as the aria-live line says it. */
  line: string
  /** Set once the learner has asked for the debrief. */
  summary: EplbSummary | null
}

export function newSession(loads: readonly number[], seed: number, provenance: EplbProvenance): EplbSession {
  const setup = eplbSetup(loads, seed)
  return { seed, provenance, loads, setup, play: startPlay(setup), prediction: null, line: '', summary: null }
}

/** The pinned practice load, which the band checks and punishes every shortcut on. */
export const practiceSession = (): EplbSession => newSession(practiceLoads(), EPLB_PRACTICE_SEED, 'practice')

/** A new load: the first in-band candidate from `entropy`'s stream. */
export function freshSession(entropy: number): EplbSession {
  const d = drawEplb(entropy)
  return newSession(d.loads, d.candidate, d.candidate === EPLB_PRACTICE_SEED ? 'practice' : 'unseen')
}

/** What the learner faces now. Built from the learner's side only. */
export type EplbStage =
  | { kind: 'predict' }
  | { kind: 'turn'; turn: number; phase: 'replicate' | 'place'; view: EplbView; copy: EplbCopy | null }
  | { kind: 'over' }

/** The learner's layer now. */
export const viewOf = (s: EplbSession): EplbView => eplbView(s.play.mine.state)

export function stageOf(s: EplbSession): EplbStage {
  if (s.play.mine.ended) return { kind: 'over' }
  if (s.prediction === null) return { kind: 'predict' }
  const view = viewOf(s)
  if (view.phase === 'done') return { kind: 'over' }
  return { kind: 'turn', turn: view.turn, phase: view.phase, view, copy: view.phase === 'place' ? view.queue[0] : null }
}

/** Locks the prediction in. Only before the first turn, and only once. */
export function withPrediction(s: EplbSession, value: number): EplbSession {
  if (s.prediction !== null || s.play.turns > 0 || !(value >= PREDICT_RANGE.min && value <= PREDICT_RANGE.max)) return s
  return { ...s, prediction: predictionOf(value, s.loads) }
}

/** Turns that ask nothing apply by themselves (a place turn with no copy left, only after a Compose `none`). */
function settle(s: EplbSession, play: EplbPlay): EplbPlay {
  let p = play
  while (!p.mine.ended && pendingAsk(s.setup, p) === null) p = playTurn(s.setup, p, null)
  return p
}

function applyTurn(s: EplbSession, decision: EplbDecision): EplbSession {
  const st = stageOf(s)
  if (st.kind !== 'turn' || st.phase !== decision.kind) return s
  const op = s.setup.ops[s.play.mine.next]
  if (eplbDecisionProblems(s.play.mine.state, op, decision).length > 0) return s
  const play = settle(s, playTurn(s.setup, s.play, decision))
  const line = eplbTurnLine(st.view, decision, eplbView(play.mine.state))
  return { ...s, play, line }
}

/** A replicate turn: the learner copies expert `e` (0-based). */
export const copyExpert = (s: EplbSession, e: number): EplbSession => applyTurn(s, { kind: 'replicate', expert: e })

/** A place turn: the learner puts the offered copy on GPU `g` (0-based). A full GPU is ignored. */
export const placeOn = (s: EplbSession, g: number): EplbSession => applyTurn(s, { kind: 'place', gpu: g })

/** The expert skip (spec §5.2): offered after five turns. */
export const canSkip = (s: EplbSession): boolean => s.prediction !== null && s.summary === null && canSkipEplb(s.play)

/** The reference's rule finishes the learner's layer from where they stand. */
export function skip(s: EplbSession): EplbSession {
  if (!canSkip(s)) return s
  return { ...s, play: skipToDebrief(s.setup, s.play), line: '' }
}

/** Reaches the debrief: only a finished layer has one. */
export function debrief(s: EplbSession): EplbSession {
  if (!s.play.mine.ended || s.summary) return s
  return { ...s, summary: summarizeEplb(s.setup, s.play) }
}

/** What a screen reader hears for the next turn, after the last turn's line. */
export function nextTurnLine(st: EplbStage): string {
  if (st.kind !== 'turn') return ''
  const count = `Turn ${st.turn + 1} of ${EPLB_TURNS}`
  if (st.phase === 'replicate') return `${count}: copy an expert. ${REPLICATE_TURNS - st.turn} ${REPLICATE_TURNS - st.turn === 1 ? 'copy' : 'copies'} left to make.`
  const copy = st.copy as EplbCopy
  return `${count}: the next copy is ${expertLabel(copy.expert)}, ${permille(copy.units)}. Choose a GPU.`
}

/** The whole line for the live region: the last turn, then the next. */
export const announceOf = (s: EplbSession): string => [s.line, nextTurnLine(stageOf(s))].filter(Boolean).join(' ')

/* ------------------------------------------------------------------ */
/* What the board and the mirror show                                   */
/* ------------------------------------------------------------------ */

/** The next GPU from `from` in direction `dir` (wrapping) that has a free slot, or `from` when none does. */
export function nextWithRoom(view: EplbView, from: number, dir: 1 | -1): number {
  for (let i = 1; i <= GPUS; i++) {
    const g = (from + dir * i + GPUS * GPUS) % GPUS
    if (view.gpus[g].free > 0) return g
  }
  return from
}

/** The GPU table's rows: the copies each GPU holds, its load and its load over the mean. */
export function gpuRows(view: EplbView): string[][] {
  return view.gpus.map((g, i) => [
    gpuLabel(i),
    g.experts.length === 0 ? 'none yet' : g.experts.map((e) => `${expertLabel(e)} (${permille(view.perCopy[e])})`).join(', '),
    permille(g.units),
    `${times(g.units)}×`,
  ])
}

/** The expert table's rows: load, copies, and the load each copy carries. */
export function expertRows(view: EplbView): string[][] {
  return view.loads.map((l, e) => [expertLabel(e), `${l} ‰`, String(view.copies[e]), permille(view.perCopy[e])])
}

/** The GPU table's caption, with the running imbalance. */
export function gpuCaption(view: EplbView, title: string): string {
  const free = view.gpus.reduce((n, g) => n + g.free, 0)
  const busiest = view.maxUnits === 0 ? 'no copy placed yet' : `busiest GPU ${times(view.maxUnits)}× the mean of ${MEAN_PERMILLE} ‰`
  return `${title}, after ${view.turn} ${view.turn === 1 ? 'turn' : 'turns'}: ${busiest}, ${free} of ${view.gpus.length * SLOTS_PER_GPU} slots free`
}

/* ------------------------------------------------------------------ */
/* The pass tally                                                       */
/* ------------------------------------------------------------------ */

/** Fresh loads the pass needs on top of the practice load (spec §5.2, step 5; W5: "passes on 3 fresh seeds"). */
export const FRESH_LOADS_TO_PASS = 3

/**
 * How many loads the learner has passed by hand, within 0.05 of the reference. A skipped layer is the reference's, so it counts for
 * nothing. The ledger holds it: every debriefed play is a `play play:eplb` event (phase `play`) with its `ok`, its provenance and
 * its load seed, so `tallyFromEvents` rebuilds the tally after a reload and `tallyAfter` keeps it in step with each debrief.
 */
export interface Tally {
  practice: boolean
  /** Distinct new loads passed, by load seed. */
  fresh: readonly number[]
}

export const EMPTY_TALLY: Tally = { practice: false, fresh: [] }

/** Whether the debriefed layer is the learner's own and within 0.05 of the reference's. */
export const passedByHand = (s: EplbSession): boolean => s.summary !== null && !s.summary.skipped && eplbPasses(s.summary.mineUnits, s.summary.ghostUnits)

/** One load passed by hand: the practice load, or a new load once per seed. */
function tallyWith(t: Tally, provenance: EplbProvenance, seed: number): Tally {
  if (provenance === 'practice') return t.practice ? t : { ...t, practice: true }
  return t.fresh.includes(seed) ? t : { ...t, fresh: [...t.fresh, seed] }
}

/** The tally after a debrief: the practice load passed, or a new load added (once per load). */
export function tallyAfter(t: Tally, s: EplbSession): Tally {
  if (!passedByHand(s)) return t
  return tallyWith(t, s.provenance, s.seed)
}

/** The play's ref in the ledger. */
export const EPLB_PLAY_REF = `play:${EPLB_PLAY_ID}`

/**
 * The tally the recorded events hold, added to `t`. A pass is a `play play:eplb` event of phase `play` with `ok`, which `recordOf`
 * sets only for a layer the learner finished by hand within 0.05 (the `skipped` flag is checked as well). Provenance `practice`
 * is the practice load and `unseen` a new load, one per seed, as `tallyAfter` counts them. Compose runs (phase `compose`) are not
 * plays by hand, and other events are ignored.
 */
export function tallyFromEvents(events: Iterable<LedgerEvent>, t: Tally = EMPTY_TALLY): Tally {
  let out = t
  for (const e of events) {
    if (e.kind !== 'play' || e.ref !== EPLB_PLAY_REF || e.ok !== true) continue
    const data = e.data as { phase?: unknown; skipped?: unknown } | undefined
    if (data?.phase !== 'play' || data.skipped === true) continue
    if (e.provenance === 'practice') out = tallyWith(out, 'practice', EPLB_PRACTICE_SEED)
    else if (e.provenance === 'unseen' && typeof e.seed === 'number') out = tallyWith(out, 'unseen', e.seed)
  }
  return out
}

/** The ledger's tally, read through its events (in the app, the façade's `controls.engine()`). */
export async function ledgerTally(client: Pick<LedgerClient, 'events'>): Promise<Tally> {
  return tallyFromEvents(await client.events({ kinds: ['play'], refPrefix: EPLB_PLAY_REF }))
}

/** Two tallies as one: what the ledger held at mount and what this page added since, whichever arrived first. */
export function mergeTally(a: Tally, b: Tally): Tally {
  let out = b.practice ? tallyWith(a, 'practice', EPLB_PRACTICE_SEED) : a
  for (const seed of b.fresh) out = tallyWith(out, 'unseen', seed)
  return out
}

/** The pass is the practice load and three new ones. */
export const passed = (t: Tally): boolean => t.practice && t.fresh.length >= FRESH_LOADS_TO_PASS

/** The pass margin as a multiplier of the mean: 0.05. */
const MARGIN_TEXT = (PASS_MARGIN_UNITS / MEAN_UNITS).toFixed(2)

export function tallyLine(t: Tally): string {
  if (passed(t)) return `Passed: within ${MARGIN_TEXT} of the reference by hand on the practice load and on ${FRESH_LOADS_TO_PASS} new loads.`
  const loads = `${Math.min(t.fresh.length, FRESH_LOADS_TO_PASS)} of ${FRESH_LOADS_TO_PASS} new loads`
  return `Within ${MARGIN_TEXT} of the reference by hand: practice load ${t.practice ? 'yes' : 'not yet'}, ${loads}.`
}

/* ------------------------------------------------------------------ */
/* The ledger                                                           */
/* ------------------------------------------------------------------ */

/**
 * The `predict` event of the opening question (src `play`): an estimate with its truth, on the play's own ref. A new load's
 * prediction is unseen, the practice load's is practice (the cube's check events follow the same rule). Null before it is made.
 */
export function predictEvent(s: EplbSession, ms?: number): ItemResponse | null {
  const p = s.prediction
  if (p === null) return null
  return {
    kind: 'predict',
    ref: PREDICT_REF,
    rev: PREDICT_REV,
    score: p.score,
    ok: p.ok,
    seed: s.seed,
    ...(ms === undefined ? {} : { ms }),
    provenance: s.provenance,
    data: { src: 'play', value: p.value, unit: '×', truth: p.truth, nsec: PREDICT_NSEC, grp: `play:${EPLB_PLAY_ID}#0`, lessonId: EPLB_LESSON, kcs: [...EPLB.kcs] },
  }
}

/**
 * The ledger result of a debriefed play: metric `{name 'imbalance', mine, ghost, lowerIsBetter}`. A skipped layer was finished
 * by the reference, and the debrief says it does not count, so the ledger records it as not passed too.
 */
export function recordOf(s: EplbSession, ms?: number): PlayResult | null {
  if (!s.summary) return null
  const result = eplbPlayResult(s.summary, { provenance: s.provenance, kcs: [...EPLB.kcs], ms })
  return s.summary.skipped ? { ...result, ok: false } : result
}

/** The releases the card's claims pin, in row order, read from the claims; a commit sha shows its first seven characters. */
export function pinnedReleases(claims: readonly string[] = EPLB.productionClaims): string[] {
  const out: string[] = []
  for (const id of claims) {
    const pin = byId[id]?.pin
    if (!pin) continue
    const ref = /^[0-9a-f]{40}$/.test(pin.ref) ? pin.ref.slice(0, 7) : pin.ref
    const text = `${pin.repo} ${ref}`
    if (!out.includes(text)) out.push(text)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Compose (spec §5.2)                                                  */
/* ------------------------------------------------------------------ */

/** The plainest policy: no copies, round robin. The learner turns the dials from here. */
export const DEFAULT_EPLB_SPEC: EplbPolicySpec = { replicate: 'none', place: 'round-robin' }

export interface EplbDialDef {
  key: keyof EplbPolicySpec
  label: string
  hint: string
  options: readonly { value: string; label: string }[]
}

export const EPLB_DIAL_DEFS: readonly EplbDialDef[] = [
  {
    key: 'replicate',
    label: 'Replicate',
    hint: `Which expert gets each of the ${REPLICATE_TURNS} spare slots, one turn at a time.`,
    options: [
      { value: 'none', label: 'No copies' },
      { value: 'per-copy', label: 'Most load per copy' },
      { value: 'total', label: 'Most total load' },
    ],
  },
  {
    key: 'place',
    label: 'Place',
    hint: 'Copies go heaviest first. Round robin deals them to GPU 1, 2, 3, 4 and round again; least loaded sends each to the GPU with the lowest load that still has a free slot.',
    options: [
      { value: 'round-robin', label: 'Round robin' },
      { value: 'least-loaded', label: 'Least-loaded GPU' },
    ],
  },
]

/** One dial turned: the spec with `key` set. */
export function withDial<K extends keyof EplbPolicySpec>(spec: EplbPolicySpec, key: K, value: EplbPolicySpec[K]): EplbPolicySpec {
  return { ...spec, [key]: value }
}

/** Fresh loads on top of the play's own (spec §5.2: "the practice load and 5 fresh loads"). */
export const EPLB_COMPOSE_FRESH = 5

/** The play's load, then `count` in-band loads drawn from `entropy`. */
export function composeLoads(base: readonly number[], entropy: number, count = EPLB_COMPOSE_FRESH): (readonly number[])[] {
  const next = splitmix32u(entropy)
  const out: (readonly number[])[] = [base]
  for (let i = 0; i < count; i++) out.push(drawEplb(next()).loads)
  return out
}

/** What the table calls each load: the play's own, then the fresh ones. */
export const loadLabel = (i: number): string => (i === 0 ? 'this load' : `new load ${i}`)

export interface EplbComposeRow {
  /** Busiest GPU, in units, for the spec and for the reference. */
  mineUnits: number
  ghostUnits: number
  mine: number
  ghost: number
  /** mine − ghost, as a multiplier of the mean. */
  gap: number
  /** Within the pass margin of the reference on this load. */
  within: boolean
}

export interface EplbComposeReport {
  rows: EplbComposeRow[]
  ok: boolean
  equivalent: boolean
  /** Loads within the pass margin. */
  within: number
  note: string
}

const describeReference = () => {
  const r = REFERENCE_EPLB_SPEC
  return `${r.replicate === 'per-copy' ? 'copy the expert with the most load per copy' : r.replicate}, then put each copy on the least-loaded GPU with a free slot`
}

/** Runs the spec on every load and says what it shows. */
export function eplbComposeReport(spec: EplbPolicySpec, loadSets: readonly (readonly number[])[]): EplbComposeReport {
  const rows = loadSets.map((loads): EplbComposeRow => {
    const mineUnits = runEplbSpec(spec, loads).maxUnits
    const ghostUnits = runEplb(loads, EPLB_GHOST).maxUnits
    return { mineUnits, ghostUnits, mine: imbalanceOf(mineUnits), ghost: imbalanceOf(ghostUnits), gap: imbalanceOf(mineUnits) - imbalanceOf(ghostUnits), within: eplbPasses(mineUnits, ghostUnits) }
  })
  const equivalent = eplbEquivalent(spec, loadSets)
  const within = rows.filter((r) => r.within).length
  const ok = equivalent || within === rows.length
  const noun = `${rows.length} loads`
  let note: string
  if (equivalent) note = `Your spec chose exactly what the reference chooses at every turn, on all ${noun}: ${describeReference()}.`
  else if (ok) {
    const turn = firstDifference(spec, loadSets[0])
    note = `Your spec ended within 0.05 of the reference on all ${noun}, without choosing what it chooses${turn >= 0 ? `: on this load it first decides otherwise at turn ${turn + 1}` : ''}.`
  } else {
    const miss = rows.findIndex((r) => !r.within)
    note = `Your spec was within 0.05 of the reference on ${within} of ${noun}. On ${loadLabel(miss)} it ends at ${fixed2(rows[miss].mine)}× against the reference's ${fixed2(rows[miss].ghost)}×. Change a dial and run it again.`
  }
  return { rows, ok, equivalent, within, note }
}

/** The load a Compose run is recorded against: the play's own, with the provenance the play's record gives it. */
export type EplbComposeLoad = Pick<EplbSession, 'seed' | 'provenance'>

/**
 * The ledger result of one Compose run. `tries` counts the specs run so far. The record's seed and metric are the play's own load
 * (the table's first row), so it carries that load's provenance, as the play's own record does: `practice` on the practice load,
 * `unseen` on a new one. The five fresh loads beside it are drawn per session and are not recorded.
 */
export function eplbComposeRecord(spec: EplbPolicySpec, report: EplbComposeReport, load: EplbComposeLoad, tries: number): PlayResult {
  return eplbComposeResult(
    spec,
    { equivalent: report.equivalent, runs: report.rows.map((r) => ({ mineUnits: r.mineUnits, ghostUnits: r.ghostUnits })), tries },
    { seed: load.seed, provenance: load.provenance, kcs: [...EPLB.kcs] },
  )
}

/** The signed gap as a table cell: "+0.071", "−0.012", "0.000" (three decimals, so the 0.05 rule reads off the table). */
export function gapText(gap: number): string {
  const x = Math.round(gap * 1000) / 1000
  if (x === 0) return '0.000'
  return `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`
}
