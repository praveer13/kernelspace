/**
 * The Fleet exercise panel's session (docs/specs/wave-3.md §5.3, task 3b-20): the pure model the component drives, so
 * the rules run under `bun test` (tests/fleet-ex/panel.test.ts) and the component keeps none of its own.
 *
 * A round is draw → predict → explain → saved.
 *   1. Draw. `freshSeed()` draws a seed, the fleet worker sweeps the exercise on it, and the seed is kept only if the
 *      exercise's band calls it a fair question (`drawFairSweep`); an out-of-band sweep is thrown away and another seed
 *      is drawn, so the learner never meets a coin flip. A seed the learner has already played is never drawn again.
 *      The sweep's outcome stays hidden: the learner sees only the seed's scene (`def.scene(seed)`: its load, its
 *      lengths), which is what the answer follows from.
 *   2. Predict. A number, before any outcome is shown: one of the sweep's points, locked once committed, with an
 *      optional "how sure". The lock grades it against the hidden sweep.
 *   3. Explain. The verdict, the chart and its table, then a line of at least 8 words (TaskPanel's rule) that unlocks
 *      the model answer and its three ideas, all three of which the line must cover before the round saves. The line
 *      is never stored: only the ticks are.
 *   4. Saved. One `item item:fleet.<id>` event (src `lesson`, `grp` = `<lessonId>#<block>`, the seed, provenance
 *      `unseen`). Every round also writes a `predict` event at its lock, as soon as it is graded and before anything is
 *      explained: the block's first carries the learner's confidence and its nominal seconds, like an item block's one
 *      prediction, and a later one is only the marker that the round was locked (`predictEvent`'s `first`).
 *
 * The exercise is done after `PASSES_NEEDED` (3) right predictions in a row, on fresh seeds, whose answers are not all
 * the same (`ANSWERS_NEEDED`, 2): repeating one value never gets there, and a guess that ignores the scene rarely
 * strings three together (tests/fleet-ex/done-rule.test.ts measures both). `readExercise` rebuilds that from the
 * ledger's events, so a reload shows "3/3 · done" and never asks again. A round whose lock was recorded and whose
 * `item` never was (the learner reloaded, or navigated away, between the lock and the save) counts as a miss, so
 * leaving after a wrong verdict cannot erase it from the run of rights (D39, D48). Nothing locks: another seed is
 * always on offer.
 */

import { byId } from '@/data/claims'
import { rev32 } from '@/lib/ledger/stable'
import type { Confidence, ItemResponse } from '@/lib/ledger/types'
import { MAX_EXPLAIN_CHARS, MIN_EXPLAIN_WORDS, explainReady, formatNumber, parseNumeric, wordCount } from '@/lib/sims/host'
import type { MirrorTable } from '@/lib/sims/types'
import { SIM_TICK_SECONDS } from '@/lib/fleet-model'
import { getFleetTrafficProfile } from '@/lib/traces'
import type { FleetExerciseDef, SceneFact, SweepPoint, SweepResult } from '@/lib/world/fleet-ex'
import { BB_AS_RUN, BB_COLD_EVERY, BB_ENGINE, BB_TOLERANCE, BB_WINDOWS, bbPass, bbReported, bbTruth } from '@/lib/world/fleet-ex/broken-bench'
import { KNEE_POINTS, KNEE_WINDOW_TICKS } from '@/lib/world/fleet-ex/knee'
import { PD_ENGINE, PD_LOAD, PD_TRANSFER_RATE, PD_WINDOW_TICKS, PD_WORKERS } from '@/lib/world/fleet-ex/pd-split'
import { PL_POINTS, plPass, plTruth } from '@/lib/world/fleet-ex/push-luck'
import { STR_GROUP, STR_POINTS, STR_TOLERANCE, strPass, strTruth } from '@/lib/world/fleet-ex/straggler'
import {
  TO_ENGINE,
  TO_PROBE_PAIRS,
  TO_SHARED,
  TO_SUFFIX,
  TO_TENANT,
  TO_TOLERANCE_GAP_MS,
  TO_TOLERANCE_POINTS,
  TO_TOLERANCE_SHARE,
  toAskOf,
  toAskOfTruth,
  toGap,
  toLost,
  toPass,
  toTolerance,
  toTruth,
} from '@/lib/world/fleet-ex/timing-oracle'

export { MAX_EXPLAIN_CHARS, MIN_EXPLAIN_WORDS, explainReady, wordCount }

/** Right predictions in a row, on fresh seeds, that finish the exercise. */
export const PASSES_NEEDED = 3
/** How many different right answers those predictions must include, so that repeating one value never finishes it. */
export const ANSWERS_NEEDED = 2
/** Seeds tried for one fair question before the round gives up (the bands accept 20 % or more, so 16 misses is a bug, never a learner's). */
export const MAX_DRAWS = 16
/** The ideas of the model answer, and how many the line must cover. */
export const IDEA_COUNT = 3
/** Nominal seconds of the prediction (a prequestion's, `PRE_NSEC`) and of a whole round, for XP and session sizing. */
export const PREDICT_NSEC = 20
export const ROUND_NSEC = 90
/** The codec rejects an item with more KCs than this (spec §3.2). */
const MAX_KCS = 6
const MS_PER_TICK = Math.round(SIM_TICK_SECONDS * 1000)

/* ------------------------------ refs and events ------------------------------ */

/** The ledger ref of an exercise: `item:fleet.<id>` (spec §3.2, no new ref grammar). */
export const exerciseRef = (id: string): `item:${string}` => `item:fleet.${id}`

/** `data.grp` of every event of one block, as the item block keys its own (`blockGrp`, item-block.ts; a test holds them equal). */
export const exerciseGrp = (lessonId: string, index: number): string => `${lessonId}#${index}`

/** What a round on `seed` asks the learner to predict: the exercise's `ask` for that seed, or its one `unit`. */
export const askFor = (def: Pick<FleetExerciseDef, 'unit' | 'ask'>, seed?: number): string => (seed !== undefined && def.ask !== undefined ? def.ask(seed) : def.unit)

/** The fingerprint the events are graded against: what a learner is asked and the points they may answer. */
export const exerciseRev = (def: Pick<FleetExerciseDef, 'id' | 'unit' | 'points'>): string => rev32({ id: def.id, unit: def.unit, points: [...def.points] })

/** What the panel reads of a ledger event; a loaded event and one just written share the shape. */
export interface ExerciseEvent {
  id?: string
  kind: string
  ref: string
  at: string
  ok?: boolean
  seed?: number
  data?: unknown
}

export interface BlockAt {
  id: string
  lessonId: string
  index: number
  needs: number
}

/** One round on the record: a saved one, or (`unsaved`) one locked and never saved, which counts as a miss. */
export interface Played {
  seed: number
  ok: boolean
  value: number
  truth: number
  /** Locked, with no `item` saved after it. `ok` is false whatever the lock graded. */
  unsaved?: true
}

export interface ExerciseState {
  /** The block's one prediction event exists. */
  predicted: boolean
  /** Rounds on the record, oldest first: the saved ones and the ones left unsaved. */
  played: Played[]
  /** Right predictions on distinct seeds, in all. */
  passes: number
  /** Right predictions in a row at the end of the record (a round on a seed already played is passed over). */
  run: number
  /** Different right answers among the last `needs` rounds of that run. */
  runAnswers: number
  /** Some `needs` rounds in a row were all right, on at least `ANSWERS_NEEDED` different answers. */
  done: boolean
  /** Every seed a saved round used: the next draw skips them. */
  seeds: Set<number>
}

/**
 * The done rule over saved rounds, oldest first: `needs` right in a row whose right answers are not all one value
 * (`ANSWERS_NEEDED`). A miss starts the run again; a round on a seed already played neither extends nor breaks it.
 * Once some window meets the rule the exercise stays done.
 */
export function runOf(played: readonly Played[], needs: number): { run: number; runAnswers: number; done: boolean } {
  const seen = new Set<number>()
  let trail: number[] = []
  let done = false
  for (const p of played) {
    if (seen.has(p.seed)) continue
    seen.add(p.seed)
    trail = p.ok ? [...trail, p.truth] : []
    if (trail.length >= needs && new Set(trail.slice(-needs)).size >= ANSWERS_NEEDED) done = true
  }
  return { run: trail.length, runAnswers: new Set(trail.slice(-needs)).size, done }
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const byTime = (a: ExerciseEvent, b: ExerciseEvent): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0)

/**
 * The block's state from the events that carry its `grp`: its rounds, how many pass, whether it is done. A `predict`
 * whose seed has no `item` is a round locked and never saved, and counts as a miss (`unsaved`), unless it is the round
 * still open in this tab (`open`, its seed), which has not had its chance to save yet.
 */
export function readExercise(events: readonly ExerciseEvent[], at: BlockAt, open?: number): ExerciseState {
  const grp = exerciseGrp(at.lessonId, at.index)
  const ref = exerciseRef(at.id)
  const mine = events.filter((e) => e.ref === ref && rec(e.data).src === 'lesson' && rec(e.data).grp === grp && typeof e.seed === 'number').sort(byTime)
  const graded = (e: ExerciseEvent): boolean => typeof rec(e.data).value === 'number' && typeof rec(e.data).truth === 'number'
  const saved = new Set(mine.filter((e) => e.kind === 'item' && graded(e)).map((e) => e.seed as number))
  const played: Played[] = []
  const left = new Set<number>()
  let predicted = false
  for (const e of mine) {
    const d = rec(e.data)
    const seed = e.seed as number
    if (e.kind === 'predict') {
      predicted = true
      if (graded(e) && !saved.has(seed) && seed !== open && !left.has(seed)) {
        left.add(seed)
        played.push({ seed, ok: false, value: d.value as number, truth: d.truth as number, unsaved: true })
      }
    } else if (e.kind === 'item' && graded(e)) {
      played.push({ seed, ok: e.ok === true, value: d.value as number, truth: d.truth as number })
    }
  }
  const passes = new Set(played.filter((p) => p.ok).map((p) => p.seed)).size
  return { predicted, played, passes, ...runOf(played, at.needs), seeds: new Set(played.map((p) => p.seed)) }
}

/** "2/3 right in a row · 1/2 different answers" and, once finished, "3/3 · done": the rule, said where the count is. */
export function progressText(s: Pick<ExerciseState, 'run' | 'runAnswers' | 'done'>, needs: number): string {
  if (s.done) return `${needs}/${needs} · done`
  return `${Math.min(s.run, needs)}/${needs} right in a row · ${Math.min(s.runAnswers, ANSWERS_NEEDED)}/${ANSWERS_NEEDED} different answers`
}

/** The event as the ledger holds it once written, for the page to keep until it reloads. */
export const exerciseEventOf = (r: ItemResponse, at: string, id: string): ExerciseEvent => ({
  id,
  kind: r.kind,
  ref: r.ref,
  at,
  ok: r.ok,
  ...(r.seed === undefined ? {} : { seed: r.seed }),
  data: r.data,
})

/* ------------------------------ the round ------------------------------ */

/** `start` waits for the learner to ask for a seed; `draw` finds a fair one; then the scene, the lock and the rest. */
export type Phase = 'start' | 'draw' | 'predict' | 'explain' | 'saved'

export interface Round {
  phase: Phase
  /** When the round was shown, and from the draw on when its scene was, so the prediction's time on task is known. */
  startedAt: number
  seed?: number
  /** The sweep on the seed, held from the draw and shown only after the lock. */
  result?: SweepResult
  prediction?: number
  conf?: Confidence
  committedAt?: number
  truth?: number
  ok?: boolean
  explain: string
  /** Indices of the ticked ideas, ascending. */
  ideas: number[]
  savedAt?: number
}

export type RoundAction =
  | { type: 'draw' }
  | { type: 'swept'; seed: number; result: SweepResult; at: number }
  | { type: 'commit'; prediction: number; conf?: Confidence; at: number }
  | { type: 'explain'; text: string }
  | { type: 'idea'; index: number }
  | { type: 'save'; at: number }
  | { type: 'next'; at: number }

/** A round that waits for the learner (`start`) or, after a saved one, goes straight to the draw. */
export const freshRound = (at: number, phase: 'start' | 'draw' = 'start'): Round => ({ phase, startedAt: at, explain: '', ideas: [] })

/** The line covers the model answer once it is long enough and all three ideas are ticked: what lets a round save. */
export const canSave = (r: Round): boolean => r.phase === 'explain' && explainReady(r.explain) && r.ideas.length === IDEA_COUNT

/**
 * Pure transition. An action out of phase is ignored, so a round reaches `saved` only through a sweep the exercise's
 * band accepts, a prediction committed while its outcome was hidden, and an explanation that covers the three ideas.
 */
export function reduceRound(def: FleetExerciseDef, state: Round, action: RoundAction): Round {
  switch (action.type) {
    case 'draw':
      return state.phase === 'start' ? { ...state, phase: 'draw' } : state
    case 'swept':
      if (state.phase !== 'draw' || !def.band(action.result)) return state
      return { ...state, phase: 'predict', seed: action.seed, result: action.result, startedAt: action.at }
    case 'commit': {
      if (state.phase !== 'predict' || state.result === undefined || !accepts(def, action.prediction)) return state
      return {
        ...state,
        phase: 'explain',
        prediction: action.prediction,
        conf: action.conf,
        committedAt: action.at,
        truth: def.truth(state.result),
        ok: def.pass(action.prediction, state.result),
      }
    }
    case 'explain':
      return state.phase === 'explain' ? { ...state, explain: action.text.slice(0, MAX_EXPLAIN_CHARS) } : state
    case 'idea': {
      if (state.phase !== 'explain' || !explainReady(state.explain)) return state
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= IDEA_COUNT) return state
      const has = state.ideas.includes(action.index)
      return { ...state, ideas: has ? state.ideas.filter((i) => i !== action.index) : [...state.ideas, action.index].sort() }
    }
    case 'save':
      return canSave(state) ? { ...state, phase: 'saved', savedAt: action.at } : state
    case 'next':
      return state.phase === 'saved' ? freshRound(action.at, 'draw') : state
  }
}

/** A prediction the exercise takes: one of its points, or (a `range` exercise) a number in the range. */
export const accepts = (def: Pick<FleetExerciseDef, 'points' | 'range'>, n: number): boolean =>
  def.range === undefined ? def.points.includes(n) : Number.isFinite(n) && n >= def.range.min && n <= def.range.max

/** A typed prediction as one the exercise takes, or null (the panel then says which values are allowed). */
export function parsePrediction(def: Pick<FleetExerciseDef, 'points' | 'range'>, text: string): number | null {
  const n = parseNumeric(text)
  return n !== null && accepts(def, n) ? n : null
}

/* ------------------------------ drawing a fair seed ------------------------------ */

/** No fair seed turned up in `MAX_DRAWS` draws. */
export class NoFairSeed extends Error {
  constructor(draws: number) {
    super(`no fair seed in ${draws} draws`)
    this.name = 'NoFairSeed'
  }
}

export interface DrawOptions {
  /** Seeds that must not be drawn: every seed the learner has played. */
  used: ReadonlySet<number>
  /** `freshSeed` in the page; tests pass a counter. */
  draw: () => number
  /** Runs the sweep in the fleet worker. */
  run: (id: string, seed: number) => Promise<SweepResult>
  maxDraws?: number
}

/**
 * A fresh seed whose sweep the exercise's band accepts, with that sweep. A seed already played is not run, and an
 * out-of-band sweep is dropped and another seed drawn. Rejects with `NoFairSeed` past `maxDraws` draws, and with
 * whatever `run` rejects with (a timeout, an unknown exercise).
 */
export async function drawFairSweep(def: FleetExerciseDef, options: DrawOptions): Promise<{ seed: number; result: SweepResult; draws: number }> {
  const max = options.maxDraws ?? MAX_DRAWS
  const tried = new Set<number>()
  for (let draws = 1; draws <= max; draws++) {
    const seed = options.draw() >>> 0
    if (options.used.has(seed) || tried.has(seed)) continue
    tried.add(seed)
    const result = await options.run(def.id, seed)
    if (def.band(result)) return { seed, result, draws }
  }
  throw new NoFairSeed(max)
}

/* ------------------------------ the ledger ------------------------------ */

export interface EventCtx {
  lessonId: string
  index: number
}

const kcsOf = (def: FleetExerciseDef): string[] => def.kcs.slice(0, MAX_KCS)

function filled(r: Round): Required<Pick<Round, 'prediction' | 'seed' | 'truth' | 'ok' | 'committedAt'>> {
  const { prediction, seed, truth, ok, committedAt } = r
  if (prediction === undefined || seed === undefined || truth === undefined || ok === undefined || committedAt === undefined) {
    throw new Error('a round writes its events only after its lock')
  }
  return { prediction, seed, truth, ok, committedAt }
}

/**
 * A round's `predict` event, written at its lock: the locked prediction against the sweep's answer on the round's
 * seed, `src: 'lesson'`. `ms` is the time from the round's scene being shown to the lock. The block's `first` carries
 * the learner's confidence and `PREDICT_NSEC`, as an item block's one prediction does. A later round's is only the
 * record that the lock happened, which is how a round left unsaved is found again: it adds no second calibration
 * sample (its `item` carries the confidence) and no time (the `item`'s `ROUND_NSEC` covers the round).
 */
export function predictEvent(def: FleetExerciseDef, ctx: EventCtx, round: Round, first = true): ItemResponse {
  const f = filled(round)
  return {
    kind: 'predict',
    ref: exerciseRef(def.id),
    rev: exerciseRev(def),
    score: f.ok ? 1 : 0,
    ok: f.ok,
    ...(first && round.conf ? { conf: round.conf } : {}),
    seed: f.seed,
    ms: Math.max(0, Math.round(f.committedAt - round.startedAt)),
    provenance: 'unseen',
    data: {
      src: 'lesson',
      value: f.prediction,
      unit: def.unit,
      truth: f.truth,
      kcs: kcsOf(def),
      nsec: first ? PREDICT_NSEC : 0,
      grp: exerciseGrp(ctx.lessonId, ctx.index),
      lessonId: ctx.lessonId,
    },
  }
}

/**
 * The `item` event of a saved round. The ticked ideas are recorded and the typed line never is: it stays in the
 * learner's browser, and `data` has no field for it. `ms` runs from the lock to the save.
 */
export function itemEvent(def: FleetExerciseDef, ctx: EventCtx, round: Round): ItemResponse {
  const f = filled(round)
  return {
    kind: 'item',
    ref: exerciseRef(def.id),
    rev: exerciseRev(def),
    score: f.ok ? 1 : 0,
    ok: f.ok,
    ...(round.conf ? { conf: round.conf } : {}),
    seed: f.seed,
    ms: Math.max(0, Math.round((round.savedAt ?? f.committedAt) - f.committedAt)),
    provenance: 'unseen',
    data: {
      src: 'lesson',
      value: f.prediction,
      unit: def.unit,
      truth: f.truth,
      ideas: [...round.ideas],
      kcs: kcsOf(def),
      nsec: ROUND_NSEC,
      grp: exerciseGrp(ctx.lessonId, ctx.index),
      lessonId: ctx.lessonId,
    },
  }
}

/* ------------------------------ copy ------------------------------ */

/** What the panel says about one exercise: its setup, how its points read, and the model answer's three ideas. */
export interface ExerciseCopy {
  /** What the sweep is, with every number read from the exercise's own constants. */
  setup: string
  /** The sweep's x column and axis. */
  xLabel: string
  /** A point as the table and the verdict name it. */
  pointLabel: (x: number) => string
  /** A point as the chart's axis names it. */
  tickLabel: (x: number) => string
  explainPrompt: string
  model: string
  ideas: readonly [string, string, string]
  /**
   * An exercise whose answer is not "the point where goodput peaks" (the stretch ones, §16.3) says its own chart,
   * verdict, table, earlier rounds and entry rule. Absent: the goodput chart of the knee and the P:D split.
   */
  view?: ExerciseView
}

export interface ExerciseView {
  /** The chart's y axis: its name in the chart's description, its short axis title, the answer's mark and the value plotted. `null`: no chart, the table alone. */
  plot: { label: string; axis: string; mark: string; of: (p: SweepPoint) => number } | null
  verdict: (prediction: number, result: SweepResult) => { ok: boolean; headline: string; detail: string }
  table: (result: SweepResult, prediction?: number) => MirrorTable
  /** An earlier round: "you said …, the answer was …". */
  played: (value: number, truth: number) => string
  /** What the prediction field says it takes, and says when it refuses a value (a `range` exercise; absent: "one of" the points). */
  entry?: { hint: string; error: string }
}

const seconds = (ticks: number): string => formatNumber(ticks * SIM_TICK_SECONDS)

function kneeCopy(): ExerciseCopy {
  const cfg = getFleetTrafficProfile('burstgpt').config
  const first = KNEE_POINTS[0]
  const last = KNEE_POINTS[KNEE_POINTS.length - 1]
  return {
    setup:
      `One engine serves a burst-shaped trace: request lengths follow the quantiles of the committed BurstGPT busiest hour, and arrivals clump. ` +
      `Each seed draws its own arrival rate. The same requests are replayed at ${KNEE_POINTS.length} load multipliers of that rate, ${formatNumber(first)}× to ${formatNumber(last)}×, each over a ${seconds(KNEE_WINDOW_TICKS)} s window. ` +
      `The engine runs ${cfg.maxRunning} sequences at once, first come, first served, and a request counts toward goodput only if its first token arrives within ${cfg.sloTtft} ticks (${seconds(cfg.sloTtft)} s). ` +
      `A flat-tick model (v1): one tick of ${MS_PER_TICK} ms advances every running sequence by one prefill chunk or one decode token. ` +
      `With ${cfg.maxRunning} slots each held H ticks per request, the engine finishes at most ${cfg.maxRunning} ÷ (H × ${formatNumber(SIM_TICK_SECONDS)} s) requests a second (Little's law).`,
    xLabel: 'Load',
    pointLabel: (x) => `${formatNumber(x)}× load`,
    tickLabel: (x) => `${formatNumber(x)}×`,
    explainPrompt: 'In a sentence or two, say why goodput peaks and then falls, instead of staying flat once load passes the peak.',
    model:
      'Below the knee the engine keeps up: its slots free as fast as requests arrive, so goodput follows the offered load. Past it, arrivals outrun the rate the slots free at (Little\'s law: slots ÷ the time a request holds one), ' +
      'a queue builds, and queued requests wait past the TTFT SLO. They are served late, so they do not count: goodput falls even though the engine cannot finish requests any faster.',
    ideas: [
      'Below the peak the engine keeps up, so goodput rises with the load.',
      'Past the peak arrivals outrun its capacity (slots ÷ time held), so a queue builds.',
      'Queued requests miss the TTFT SLO, so fewer count as goodput although the engine is as busy as before.',
    ],
  }
}

function pdSplitCopy(): ExerciseCopy {
  return {
    setup:
      `${PD_WORKERS} identical workers are split into p that prefill and ${PD_WORKERS} − p that decode, for p = 1 … ${PD_WORKERS - 1}, on one seeded trace of long prompts. ` +
      `Each seed draws its own prompt and output lengths. ` +
      `Each worker is a ${PD_ENGINE.maxRunning}-sequence engine. A prefill worker sends a finished prompt's KV to a decode worker at ${PD_TRANSFER_RATE} tokens per tick, and the transfer waits while the decode worker has no free blocks. ` +
      `The trace offers about ${formatNumber(PD_LOAD)}× the best split's estimated capacity over ${seconds(PD_WINDOW_TICKS)} s. A request counts toward goodput only if its first token lands within ${PD_ENGINE.sloTtft} ticks (${seconds(PD_ENGINE.sloTtft)} s) ` +
      `and no gap between its tokens exceeds ${PD_ENGINE.sloItl ?? 0} ticks. A flat-tick model (v1): one tick of ${MS_PER_TICK} ms advances every running sequence by one prefill chunk or one decode token, ` +
      `so a prompt holds a prefill slot for ⌈tokens ÷ ${PD_ENGINE.prefillChunk}⌉ ticks and an output holds a decode slot for one tick per token.`,
    xLabel: 'Prefill : decode',
    pointLabel: (x) => `${x} prefill, ${PD_WORKERS - x} decode`,
    tickLabel: (x) => `${x}:${PD_WORKERS - x}`,
    explainPrompt: 'In a sentence or two, say why goodput is lower at both ends of the split, not just one.',
    model:
      'Prefill and decode are two stages of one pipeline, and the slower stage sets the rate. With too few prefill workers, prompts queue before they start and the first token misses its SLO. ' +
      'With too few decode workers, the decode pools fill, finished prefills wait for blocks to move their KV, and requests miss their SLOs there. The best split gives each stage just enough workers that neither starves the other.',
    ideas: [
      'The slower of the two stages sets the pipeline\'s rate.',
      'Too few prefill workers: prompts queue, and the first token misses its SLO.',
      'Too few decode workers: decode pools fill, KV transfers wait for blocks, and requests miss their SLOs.',
    ],
  }
}

const msText = (n: number): string => `${formatNumber(n)} ms`

function brokenBenchCopy(): ExerciseCopy {
  const slots = BB_ENGINE.maxRunning
  const chunk = BB_ENGINE.prefillChunk
  const view: ExerciseView = {
    plot: null,
    entry: {
      hint: 'a number of milliseconds',
      error: 'Enter the p95 time to first token as a number of milliseconds, such as 1250.',
    },
    verdict: (prediction, result) => {
      const truth = bbTruth(result)
      const reported = bbReported(result)
      if (bbPass(prediction, result)) {
        return { ok: true, headline: 'Your prediction held.', detail: `The corrected run's p95 TTFT is ${msText(truth)} on this seed. The benchmark reported ${msText(reported)}.` }
      }
      return {
        ok: false,
        headline: 'Your prediction was off.',
        detail:
          `You said ${msText(prediction)}. The corrected run's p95 TTFT is ${msText(truth)} (within ${Math.round(BB_TOLERANCE * 100)}% is right: ` +
          `${formatNumber(truth * (1 - BB_TOLERANCE))} to ${formatNumber(truth * (1 + BB_TOLERANCE))} ms). The benchmark reported ${msText(reported)}.`,
      }
    },
    table: (result) => ({
      caption: 'The broken benchmark: p95 TTFT as run and corrected',
      columns: ['Run', 'p95 TTFT (ms)', 'Goodput (req/s)', 'SLO met'],
      rows: result.points.map((p) => [
        p.x === BB_AS_RUN ? 'The benchmark as run' : 'The corrected run (the answer)',
        formatNumber(p.ttftP95 * MS_PER_TICK),
        formatNumber(p.goodputRps),
        p.metrics?.sloMet === undefined || p.metrics.requests === undefined ? '' : `${p.metrics.sloMet} of ${p.metrics.requests}`,
      ]),
    }),
    played: (value, truth) => `you said ${msText(value)}, the corrected p95 was ${msText(truth)}`,
  }
  return {
    setup:
      `One engine serves production's traffic: ${slots} sequences at once, first come, first served. A flat-tick model (version 1): one tick of ${MS_PER_TICK} ms advances every running sequence by one prefill chunk of ${chunk} tokens or one decode token, ` +
      `so a request holds a slot ⌈prompt ÷ ${chunk}⌉ ticks for its prefill and then about one tick per output token. Production's requests arrive at random times over a window of ${seconds(Math.min(...BB_WINDOWS))} to ${seconds(Math.max(...BB_WINDOWS))} s that the scene gives, ` +
      `with prompt and output lengths spread evenly over the ranges the scene gives. A benchmark replayed this traffic and reported a p95 time to first token (TTFT), but it had one flaw, listed in the scene as what it did differently: ` +
      `closed-loop clients, replies cut short, a cached prompt prefix, or the engine's cold start counted (modelled as one tick in ${BB_COLD_EVERY} running until it warms). ` +
      `The corrected run is production's traffic as it is: open-loop arrivals, replies at their own length, new prompts, an engine already warm. Predict its p95 TTFT. ` +
      `With ${slots} slots each held H ticks the engine finishes at most ${slots} ÷ (H × ${formatNumber(SIM_TICK_SECONDS)} s) requests a second (Little's law), and a request that waits for no one has a TTFT of ⌈prompt ÷ ${chunk}⌉ − 1 ticks.`,
    xLabel: 'Run',
    pointLabel: (x) => (x === BB_AS_RUN ? 'the benchmark as run' : 'the corrected run'),
    tickLabel: (x) => (x === BB_AS_RUN ? 'as run' : 'corrected'),
    explainPrompt: "In a sentence or two, say why the benchmark's number was wrong, and whether it was too low or too high.",
    model:
      "A benchmark's number is true of the traffic and the engine state it ran, and of nothing else. Closed-loop clients send only after the last reply, so they slow down when the server does and no queue forms, while production's arrivals keep coming whatever the server does. " +
      "A reply cut short frees its slot early, so the same arrivals never queue, while real replies hold slots for their whole length. A cached prefix skips most of the prefill that production's new prompts must do. " +
      'Each of these hides work and reports a TTFT that is too low. Counting the cold start does the opposite: the slow first minutes happen once, and a steady-state number leaves them out. ' +
      "Little's law (slots ÷ the time a request holds one) says whether production's load queues. Under capacity almost nothing waits, and the p95 is the prefill of a 95th-percentile prompt. " +
      'Over it the queue grows for the whole window, and the p95 request waits about (load − 1) × 95% of the window, so a p95 past capacity depends on how long the run lasted.',
    ideas: [
      "A benchmark's number holds only for the traffic and engine state it ran, and the flaw changed one of them.",
      "Little's law (slots ÷ the time a request holds one) says whether production's load queues: under capacity the p95 is prefill alone, over it the queue grows all window.",
      'Closed loops, short replies and a warm cache hide work and report a TTFT that is too low; counting the cold start reports one that is too high.',
    ],
    view,
  }
}

function pushLuckCopy(): ExerciseCopy {
  const first = PL_POINTS[0]
  const last = PL_POINTS[PL_POINTS.length - 1]
  const speedupOf = (r: SweepResult, x: number): number | undefined => r.points.find((p) => p.x === x)?.metrics?.speedup
  const view: ExerciseView = {
    plot: { label: 'Speedup over plain decoding', axis: 'speedup (×)', mark: 'best', of: (p) => p.metrics?.speedup ?? 0 },
    verdict: (prediction, result) => {
      const truth = plTruth(result)
      const best = speedupOf(result, truth)
      const pick = speedupOf(result, prediction)
      const bestText = best === undefined ? '' : `${formatNumber(best)}×`
      if (plPass(prediction, result)) return { ok: true, headline: 'Your prediction held.', detail: `The speedup peaks at γ = ${truth} on this seed: ${bestText}.` }
      const below = pick === undefined || best === undefined || !(best > 0) ? '' : `, ${formatNumber(Math.round((1 - pick / best) * 1000) / 10)}% below the best`
      return {
        ok: false,
        headline: 'Your prediction was off.',
        detail: `You said γ = ${prediction}${pick === undefined ? '' : `, where the speedup is ${formatNumber(pick)}×${below}`}. It peaks at γ = ${truth}: ${bestText}.`,
      }
    },
    table: (result, prediction) => {
      const truth = plTruth(result)
      return {
        caption: 'Push your luck: speedup by draft length',
        columns: ['Draft length γ', 'Tokens per round', 'Round cost (target steps)', 'Speedup'],
        rows: result.points.map((p) => {
          const marks = [p.x === truth ? 'best' : '', p.x === prediction ? 'your pick' : ''].filter(Boolean)
          return [
            `γ = ${p.x}${marks.length > 0 ? ` (${marks.join(', ')})` : ''}`,
            formatNumber(p.metrics?.tokensPerRound ?? NaN),
            formatNumber(p.metrics?.roundCost ?? NaN),
            formatNumber(p.metrics?.speedup ?? NaN),
          ]
        }),
      }
    },
    played: (value, truth) => `you said γ = ${value}, the best was γ = ${truth}`,
  }
  return {
    setup:
      `A hypothetical drafter proposes γ tokens a round (the lesson's k) and the target verifies them in one pass. The target accepts each drafted token with probability α, independently, until the first rejection, and then adds one token of its own: ` +
      `the bonus token after a clean sweep, or the correction at the first rejection. A round emits (1 − α^(γ+1)) ÷ (1 − α) tokens on average, and costs one target step plus γ draft steps of c of a target step each, so γc + 1 target steps. ` +
      `Plain decoding emits one token per target step, and the speedup is a round's tokens divided by its cost: (1 − α^(γ+1)) ÷ ((1 − α)(γc + 1)). ` +
      `This is a model (version 1), not a Fleet run: the Fleet engine has no speculation, so the sweep computes that formula at γ = ${first} … ${last} for the seed's α and c, with powers as repeated products. ` +
      `The best γ beats the runner-up by at least 0.5%, so work to four significant digits.`,
    xLabel: 'Draft length γ',
    pointLabel: (x) => `γ = ${x}`,
    tickLabel: (x) => `${x}`,
    explainPrompt: 'In a sentence or two, say why the speedup falls again once the draft is long enough, instead of rising for ever.',
    model:
      'A drafted token counts only if every token before it was accepted, so each extra token adds a smaller α^(γ+1) of expected gain to the round, while it adds c to the cost of every round, accepted or not. ' +
      'The gain shrinks geometrically and the cost grows in a straight line, so the speedup rises while one more token raises the tokens per round by a larger share than it raises the cost, and falls once it does not. ' +
      'Past that draft length you are pushing your luck. Without a draft cost the expected tokens only rise with γ, which is why the question needs c.',
    ideas: [
      'A drafted token counts only if every earlier one was accepted, so each extra token adds a smaller expected gain, α^(γ+1).',
      'Each extra draft step adds c to the cost of every round, accepted or not, so the cost grows in a straight line.',
      'The speedup peaks where one more token stops raising the tokens per round by a larger share than the cost; past it a longer draft is slower.',
    ],
    view,
  }
}

const pointsText = (n: number): string => `${formatNumber(Math.round(n * 100) / 100)} point${n === 1 ? '' : 's'}`

function stragglerCopy(): ExerciseCopy {
  const first = STR_POINTS[0]
  const metricAt = (r: SweepResult, k: number, name: string): number => r.points.find((p) => p.x === k)?.metrics?.[name] ?? NaN
  const view: ExerciseView = {
    plot: null,
    entry: {
      hint: 'a percentage from 0 to 100',
      error: 'Enter the idle share as a percentage from 0 to 100, such as 62.5.',
    },
    verdict: (prediction, result) => {
      const truth = strTruth(result)
      const mean = metricAt(result, STR_GROUP, 'meanTokens')
      const longest = metricAt(result, STR_GROUP, 'longestTokens')
      const facts = `The mean length is ${formatNumber(mean)} tokens and the longest ${formatNumber(longest)}.`
      if (strPass(prediction, result)) return { ok: true, headline: 'Your prediction held.', detail: `The group of ${STR_GROUP} leaves ${formatNumber(truth)}% of its slot-time idle on this seed. ${facts}` }
      return {
        ok: false,
        headline: 'Your prediction was off.',
        detail: `You said ${formatNumber(prediction)}%. The group of ${STR_GROUP} leaves ${formatNumber(truth)}% idle (within ${STR_TOLERANCE} point is right: ${formatNumber(truth - STR_TOLERANCE)} to ${formatNumber(truth + STR_TOLERANCE)}). ${facts}`,
      }
    },
    table: (result) => ({
      caption: 'The rollout straggler: idle share of slot-time by group size',
      columns: ['Samples per group', 'Mean length (tokens)', 'Longest (tokens)', 'Idle share (%)'],
      rows: result.points.map((p) => [
        p.x === STR_GROUP ? `${p.x} (the answer)` : `${p.x}`,
        formatNumber(p.metrics?.meanTokens ?? NaN),
        formatNumber(p.metrics?.longestTokens ?? NaN),
        formatNumber(p.metrics?.idleShare ?? NaN),
      ]),
    }),
    played: (value, truth) => `you said ${formatNumber(value)}%, the idle share was ${formatNumber(truth)}%`,
  }
  return {
    setup:
      `A hypothetical RL group decodes ${STR_GROUP} samples of one prompt, each in a slot of its own, all at the same rate, and it is scored only when its longest sample is done. A slot sits idle from the moment its sample ends. ` +
      `Each seed draws ${STR_GROUP} output lengths with a long tail: one to three of them are reasoning-length chains and the rest are short, and the scene lists every length. ` +
      `With lengths l, a group lasts max l token-times, so its slot-time is ${STR_GROUP} × max l and the busy part is the sum of the lengths: the idle share is 1 − Σ l ÷ (${STR_GROUP} × max l), which is 1 − mean ÷ max. ` +
      `This is a model (version 1), not a Fleet run: the Fleet engine has no RL group, so the sweep computes that share for the seed's lengths, and also for the first k = ${first} … ${STR_GROUP} of them run as a smaller group. ` +
      `Predict the idle share of the whole group of ${STR_GROUP}, to within ${STR_TOLERANCE} percentage point.`,
    xLabel: 'Samples per group',
    pointLabel: (x) => `${x} samples`,
    tickLabel: (x) => `${x}`,
    explainPrompt: 'In a sentence or two, say why a group wastes most of its slot-time when one sample runs far longer than the rest.',
    model:
      'A synchronous group is scored when its longest sample finishes, so every slot is held for that long, but a slot is busy only for its own sample. The idle share is therefore one minus the mean length over the longest, ' +
      'and a long tail pushes the longest far above the mean: one chain of 21,000 tokens among seven of about 3,500 leaves nearly three quarters of the group\'s slot-time idle. The table shows the share move as samples join the group: a short sample adds a slot that is idle for most of the group\'s time, and a long one raises how long every slot waits. ' +
      'That idle slot-time is what partial rollout (checkpoint the long chain and resume it next step) and length-aware placement go after.',
    ideas: [
      'The group is scored only when its longest sample ends, so every slot is held for the longest length.',
      'A slot is busy only for its own sample\'s length, so the idle share is 1 − mean ÷ longest.',
      'A long tail puts the longest far above the mean, so most slot-time is idle; partial rollout and length-aware placement target exactly that.',
    ],
    view,
  }
}

function timingOracleCopy(): ExerciseCopy {
  const metricOf = (r: SweepResult, x: number, name: string): number => r.points.find((p) => p.x === x)?.metrics?.[name] ?? NaN
  const valueText = (gap: boolean, n: number): string => (gap ? msText(n) : pointsText(n))
  const view: ExerciseView = {
    plot: null,
    entry: {
      hint: 'milliseconds or percentage points, as asked',
      error: 'Enter the number asked for: the probe’s gap in milliseconds, such as 800, or the hit rate lost in percentage points, such as 7.5.',
    },
    verdict: (prediction, result) => {
      const gapAsked = toAskOf(result) === 'gap'
      const truth = toTruth(result)
      const lost = toLost(result)
      const shared = metricOf(result, TO_SHARED, 'hitRate')
      const tenant = metricOf(result, TO_TENANT, 'hitRate')
      const gap = `The probe sees a gap of ${msText(toGap(result, TO_SHARED))} with the shared cache and ${msText(toGap(result, TO_TENANT))} with the tenant in the key.`
      const price = `The tenant key loses ${pointsText(lost)} of hit rate on this seed (${formatNumber(shared)}% down to ${formatNumber(tenant)}%).`
      if (toPass(prediction, result)) {
        return { ok: true, headline: 'Your prediction held.', detail: gapAsked ? `${gap} ${price}` : `${price} ${gap}` }
      }
      const tol = toTolerance(result)
      const window = gapAsked
        ? `(within ${msText(tol)} is right: ${formatNumber(truth - tol)} to ${msText(truth + tol)})`
        : `(within ${formatNumber(Math.round(tol * 100) / 100)} is right: ${formatNumber(truth - tol)} to ${formatNumber(truth + tol)})`
      return {
        ok: false,
        headline: 'Your prediction was off.',
        detail: gapAsked
          ? `You said ${msText(prediction)}. With the shared cache the probe's gap is ${msText(truth)} ${window}, and ${msText(toGap(result, TO_TENANT))} with the tenant in the key. ${price}`
          : `You said ${pointsText(prediction)}. The shared cache hit ${formatNumber(shared)}% of requests and the tenant-keyed one ${formatNumber(tenant)}%: ${pointsText(truth)} lost ${window}. ${gap}`,
      }
    },
    table: (result) => ({
      caption: 'The timing oracle: hit rate, the probe and the fleet’s TTFT by cache key',
      columns: ['Cache key', 'Hit rate (%)', 'Probe, used prefix (ms)', 'Probe, unused prefix (ms)', 'Probe gap (ms)', 'TTFT p95 (ms)'],
      rows: result.points.map((p) => [
        p.x === TO_SHARED ? 'Shared across tenants' : 'Tenant in the key',
        formatNumber(p.metrics?.hitRate ?? NaN),
        formatNumber(p.metrics?.probeHitMs ?? NaN),
        formatNumber(p.metrics?.probeMissMs ?? NaN),
        formatNumber(p.metrics?.gapMs ?? NaN),
        formatNumber(p.metrics?.ttftP95Ms ?? NaN),
      ]),
    }),
    played: (value, truth) => {
      const gap = toAskOfTruth(truth) === 'gap'
      return `you said ${valueText(gap, value)}, ${gap ? 'the probe’s gap was' : 'the tenant key lost'} ${valueText(gap, truth)}`
    },
  }
  return {
    setup:
      `Tenants share one deployment, one engine of ${TO_ENGINE.maxRunning} sequences at once, first come, first served. A flat-tick model (version 1): one tick of ${MS_PER_TICK} ms advances every running sequence by one prefill chunk of ${TO_ENGINE.prefillChunk} tokens or one decode token. ` +
      `Every request is one of K shared prefixes, a prompt any tenant may send, plus a suffix of ${TO_SUFFIX.min} to ${TO_SUFFIX.max} tokens that is never repeated. A request that hits the prefix cache skips the cached prefix's prefill, so it holds a slot ⌈(prompt − cached) ÷ ${TO_ENGINE.prefillChunk}⌉ ticks for its prefill instead of ⌈prompt ÷ ${TO_ENGINE.prefillChunk}⌉. ` +
      `The sweep runs the same traffic twice. With the shared key a request hits if any tenant has sent its prefix before. With the tenant in the key it hits only if its own tenant has. ` +
      `The hit rate is the share of requests that hit. Each tenant sends each prefix at least once. After the traffic, a prober, a tenant outside the others, times ${TO_PROBE_PAIRS} pairs of guesses on an idle engine: one at a prefix the others used, one at a prefix nobody used. Their difference is the probe's gap. ` +
      `This is partly a model: the Fleet engine serves a hit (it skips the cached prefill) but has no cache to decide which requests hit, so the sweep decides in arrival order with an unbounded cache that holds a prefix from its first request. ` +
      `A real cache is bounded and fills when a prefill finishes, so a real tenant key loses at least this much. Each seed asks for one of two numbers and says which: ` +
      `the probe's gap with the shared key, in milliseconds, to within ${msText(TO_TOLERANCE_GAP_MS)} or ${Math.round(TO_TOLERANCE_SHARE * 100)}%, whichever is larger, ` +
      `or the hit rate the tenant key loses, in percentage points, to within ${formatNumber(TO_TOLERANCE_POINTS)} point or ${Math.round(TO_TOLERANCE_SHARE * 100)}%, whichever is larger.`,
    xLabel: 'Cache key',
    pointLabel: (x) => (x === TO_SHARED ? 'the shared cache' : 'the tenant in the key'),
    tickLabel: (x) => (x === TO_SHARED ? 'shared' : 'tenant'),
    explainPrompt: 'In a sentence or two, say how a shared cache lets a prober see what others sent, and what closing that costs.',
    model:
      'A hit skips the cached prefix\'s prefill, so a guess at a prefix someone used comes back faster than a guess at one nobody used. That gap is an observable bit, and a prober who times guesses reads it without ever seeing a KV tensor. ' +
      'Putting the tenant in the cache key gives each tenant its own namespace, so the prober\'s guesses all miss and the gap is zero. The price is that tenants no longer share work: with a shared key each prefix misses once in all, K misses, ' +
      'and with the tenant in the key each tenant misses it once, T × K. Of n requests that is K × (T − 1) ÷ n of them turned from hits into misses. How much that matters depends on the tenant mix, which is why the lesson says to measure the reuse you give up.',
    ideas: [
      'A hit skips the cached prefill, so a guess at a used prefix returns faster than one at an unused prefix: the gap is the oracle.',
      'With the tenant in the key the prober\'s namespace holds nothing of the others\', so every guess misses and the gap closes.',
      'The cost is the shared work: K misses in all become T × K, so the hit rate falls by K × (T − 1) ÷ n.',
    ],
    view,
  }
}

const COPIES: Readonly<Record<string, () => ExerciseCopy>> = { knee: kneeCopy, 'pd-split': pdSplitCopy, 'broken-bench': brokenBenchCopy, 'push-luck': pushLuckCopy, straggler: stragglerCopy, 'timing-oracle': timingOracleCopy }

/** The panel's copy for an exercise id. A later exercise (§16.3) adds a line here; a test fails until every listed exercise has one. */
export function copyFor(id: string): ExerciseCopy | null {
  return Object.hasOwn(COPIES, id) ? COPIES[id]() : null
}

/** What the prediction field says it takes and says when it refuses a value: the exercise's own words, or "one of" its points. */
export function entryText(def: Pick<FleetExerciseDef, 'points'>, copy: Pick<ExerciseCopy, 'view'>): { hint: string; error: string } {
  if (copy.view?.entry !== undefined) return copy.view.entry
  const allowed = def.points.map((p) => formatNumber(p)).join(', ')
  return { hint: `one of ${allowed}`, error: `Enter one of the points the sweep runs: ${allowed}.` }
}

/** A scene fact as the panel lists it: "Prompts: 1,792–2,815 tokens". */
export function sceneLine(f: SceneFact): string {
  return `${f.label}: ${formatNumber(f.value)}${f.to === undefined ? '' : `–${formatNumber(f.to)}`} ${f.unit}`
}

/* ------------------------------ what the sweep shows ------------------------------ */

const pointAt = (result: SweepResult, x: number): SweepPoint | undefined => result.points.find((p) => p.x === x)
const ms = (ticks: number): string => formatNumber(ticks * MS_PER_TICK)

/** The verdict in words: right or off, with the goodput at the learner's pick against the peak. */
export function verdictText(def: FleetExerciseDef, copy: ExerciseCopy, prediction: number, result: SweepResult): { ok: boolean; headline: string; detail: string } {
  if (copy.view !== undefined) return copy.view.verdict(prediction, result)
  const truth = def.truth(result)
  const peak = pointAt(result, truth)
  const pick = pointAt(result, prediction)
  const peakRps = peak === undefined ? NaN : peak.goodputRps
  if (def.pass(prediction, result)) {
    return { ok: true, headline: 'Your prediction held.', detail: `Goodput peaks at ${copy.pointLabel(truth)} on this seed: ${formatNumber(peakRps)} req/s.` }
  }
  const below = pick === undefined || !(peakRps > 0) ? '' : `, ${Math.round((1 - pick.goodputRps / peakRps) * 100)}% below the peak`
  return {
    ok: false,
    headline: 'Your prediction was off.',
    detail: `You said ${copy.pointLabel(prediction)}${pick === undefined ? '' : `, where goodput is ${formatNumber(pick.goodputRps)} req/s${below}`}. It peaks at ${copy.pointLabel(truth)}: ${formatNumber(peakRps)} req/s.`,
  }
}

/** The sweep as the DOM table that mirrors the chart. The learner's pick and the peak are named in the first cell. */
export function sweepTable(def: FleetExerciseDef, copy: ExerciseCopy, result: SweepResult, prediction?: number): MirrorTable {
  if (copy.view !== undefined) return copy.view.table(result, prediction)
  const truth = def.truth(result)
  const hasTpot = result.points.some((p) => p.tpotP95 !== undefined)
  const columns = [copy.xLabel, 'Goodput (req/s)', 'TTFT p95 (ms)', ...(hasTpot ? ['TPOT p95 (ms)'] : []), 'SLO met']
  const rows = result.points.map((p) => {
    const marks = [p.x === truth ? 'peak' : '', p.x === prediction ? 'your pick' : ''].filter(Boolean)
    const met = p.metrics?.sloMet
    const total = p.metrics?.requests
    return [
      `${copy.pointLabel(p.x)}${marks.length > 0 ? ` (${marks.join(', ')})` : ''}`,
      formatNumber(p.goodputRps),
      ms(p.ttftP95),
      ...(hasTpot ? [p.tpotP95 === undefined ? '' : ms(p.tpotP95)] : []),
      met === undefined || total === undefined ? '' : `${met} of ${total}`,
    ]
  })
  return { caption: `${def.title}: goodput by ${copy.xLabel.toLowerCase()}`, columns, rows }
}

/* ------------------------------ the In-production rows ------------------------------ */

export interface ProductionRow {
  dial: string
  lead: string
  /** Backticks mark code. */
  tail: string
}

/** What each claim says about the exercise's dial. A claim without a row falls back to its own label. */
export const PRODUCTION_ROWS: Readonly<Record<string, ProductionRow>> = {
  'production.vllm.max-num-seqs': {
    dial: 'running slots',
    lead: "vLLM's default cap on sequences running at once, on an H100 or H200 serving the OpenAI API, is",
    tail: '(`max_num_seqs`, used when the flag is not set). The sweep\'s engine has the same dial, `maxRunning`, at a toy size so that the knee falls inside the six multipliers. Little\'s law divides these slots by the time a request holds one.',
  },
  'production.sglang.max-running-requests': {
    dial: 'running slots',
    lead: 'SGLang sizes its cap on running requests from the KV pool when `--max-running-requests` is not set:',
    tail: '(computed from the KV pool\'s token capacity and the context length, then clamped to that range), so the number of slots follows the memory given to the KV cache.',
  },
  'production.vllm.disagg': {
    dial: 'a role per instance',
    lead: 'vLLM tells each instance its part in a disaggregated deployment with',
    tail: ': `kv_role` is `kv_producer`, `kv_consumer` or `kv_both`. The flag names one instance\'s part; the split you predict is how many workers you give each phase.',
  },
  'production.sglang.disagg': {
    dial: 'a mode per server',
    lead: 'SGLang starts a server as prefill-only or decode-only with',
    tail: '. Left unset, the server is not disaggregated. The split you predict is how many servers you start in each mode.',
  },
}

/** The releases the claims pin, in row order, read from the claims. */
export function pinnedReleases(claims: readonly string[]): string[] {
  const out: string[] = []
  for (const id of claims) {
    const pin = byId[id]?.pin
    const text = pin ? `${pin.repo} ${pin.ref}` : ''
    if (text && !out.includes(text)) out.push(text)
  }
  return out
}

