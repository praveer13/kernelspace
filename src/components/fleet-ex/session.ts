/**
 * The Fleet exercise panel's session (docs/specs/wave-3.md §5.3, task 3b-20): the pure model the component drives, so
 * the rules run under `bun test` (tests/fleet-ex/panel.test.ts) and the component keeps none of its own.
 *
 * A round is predict → run → explain → saved.
 *   1. Predict. A number, before any run: one of the sweep's points, locked once committed, with an optional "how sure".
 *   2. Run. `freshSeed()` draws a seed, the fleet worker sweeps the exercise on it, and the seed is kept only if the
 *      exercise's band calls it a fair question (`drawFairSweep`); an out-of-band sweep is thrown away and another seed
 *      is drawn, so the learner never meets a coin flip. A seed the learner has already played is never drawn again.
 *   3. Explain. The verdict, the chart and its table, then a line of at least 8 words (TaskPanel's rule) that unlocks
 *      the model answer and its three ideas, all three of which the line must cover before the round saves. The line
 *      is never stored: only the ticks are.
 *   4. Saved. One `item item:fleet.<id>` event (src `lesson`, `grp` = `<lessonId>#<block>`, the seed, provenance
 *      `unseen`). The first round of a block also writes the block's one `predict` event, as soon as its sweep is
 *      graded (its truth is not known before), the way an item block writes its one prediction before the practice.
 *
 * The exercise is done after `PASSES_NEEDED` right predictions on distinct fresh seeds, and `readExercise` rebuilds
 * that from the ledger's events, so a reload shows "3/3 · done" and never asks again. Nothing locks: another seed is
 * always on offer.
 */

import { byId } from '@/data/claims'
import { rev32 } from '@/lib/ledger/stable'
import type { Confidence, ItemResponse } from '@/lib/ledger/types'
import { MAX_EXPLAIN_CHARS, MIN_EXPLAIN_WORDS, explainReady, formatNumber, parseNumeric, wordCount } from '@/lib/sims/host'
import type { MirrorTable } from '@/lib/sims/types'
import { SIM_TICK_SECONDS } from '@/lib/fleet-model'
import { getFleetTrafficProfile } from '@/lib/traces'
import type { FleetExerciseDef, SweepPoint, SweepResult } from '@/lib/world/fleet-ex'
import { KNEE_POINTS, KNEE_WINDOW_TICKS } from '@/lib/world/fleet-ex/knee'
import { PD_ENGINE, PD_LOAD, PD_TRANSFER_RATE, PD_WINDOW_TICKS, PD_WORKERS } from '@/lib/world/fleet-ex/pd-split'

export { MAX_EXPLAIN_CHARS, MIN_EXPLAIN_WORDS, explainReady, wordCount }

/** Right predictions on distinct fresh seeds that finish the exercise. */
export const PASSES_NEEDED = 3
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

/** One saved round. */
export interface Played {
  seed: number
  ok: boolean
  value: number
  truth: number
}

export interface ExerciseState {
  /** The block's one prediction event exists. */
  predicted: boolean
  /** Saved rounds, oldest first. */
  played: Played[]
  /** Right predictions on distinct seeds. */
  passes: number
  done: boolean
  /** Every seed a saved round used: the next draw skips them. */
  seeds: Set<number>
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const byTime = (a: ExerciseEvent, b: ExerciseEvent): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0)

/** The block's state from the events that carry its `grp`: its saved rounds, how many pass, whether it is done. */
export function readExercise(events: readonly ExerciseEvent[], at: BlockAt): ExerciseState {
  const grp = exerciseGrp(at.lessonId, at.index)
  const ref = exerciseRef(at.id)
  const mine = events.filter((e) => e.ref === ref && rec(e.data).src === 'lesson' && rec(e.data).grp === grp && typeof e.seed === 'number').sort(byTime)
  const played: Played[] = []
  let predicted = false
  for (const e of mine) {
    const d = rec(e.data)
    if (e.kind === 'predict') predicted = true
    else if (e.kind === 'item' && typeof d.value === 'number' && typeof d.truth === 'number') {
      played.push({ seed: e.seed as number, ok: e.ok === true, value: d.value, truth: d.truth })
    }
  }
  const passes = new Set(played.filter((p) => p.ok).map((p) => p.seed)).size
  return { predicted, played, passes, done: passes >= at.needs, seeds: new Set(played.map((p) => p.seed)) }
}

/** "2/3" and, once finished, "3/3 · done". */
export const progressText = (passes: number, needs: number): string => `${Math.min(passes, needs)}/${needs}${passes >= needs ? ' · done' : ''}`

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

export type Phase = 'predict' | 'run' | 'explain' | 'saved'

export interface Round {
  phase: Phase
  /** When the round was shown, so the prediction's time on task is known. */
  startedAt: number
  prediction?: number
  conf?: Confidence
  committedAt?: number
  seed?: number
  result?: SweepResult
  truth?: number
  ok?: boolean
  explain: string
  /** Indices of the ticked ideas, ascending. */
  ideas: number[]
  savedAt?: number
}

export type RoundAction =
  | { type: 'commit'; prediction: number; conf?: Confidence; at: number }
  | { type: 'swept'; seed: number; result: SweepResult }
  | { type: 'explain'; text: string }
  | { type: 'idea'; index: number }
  | { type: 'save'; at: number }
  | { type: 'next'; at: number }

export const freshRound = (at: number): Round => ({ phase: 'predict', startedAt: at, explain: '', ideas: [] })

/** The line covers the model answer once it is long enough and all three ideas are ticked: what lets a round save. */
export const canSave = (r: Round): boolean => r.phase === 'explain' && explainReady(r.explain) && r.ideas.length === IDEA_COUNT

/**
 * Pure transition. An action out of phase is ignored, so a round reaches `saved` only through a committed prediction,
 * a sweep the exercise's band accepts, and an explanation that covers the three ideas.
 */
export function reduceRound(def: FleetExerciseDef, state: Round, action: RoundAction): Round {
  switch (action.type) {
    case 'commit':
      if (state.phase !== 'predict' || !def.points.includes(action.prediction)) return state
      return { ...state, phase: 'run', prediction: action.prediction, conf: action.conf, committedAt: action.at }
    case 'swept': {
      if (state.phase !== 'run' || state.prediction === undefined || !def.band(action.result)) return state
      return {
        ...state,
        phase: 'explain',
        seed: action.seed,
        result: action.result,
        truth: def.truth(action.result),
        ok: def.pass(state.prediction, action.result),
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
      return state.phase === 'saved' ? freshRound(action.at) : state
  }
}

/** A typed prediction as one of the exercise's points, or null (the panel then says which values are allowed). */
export function parsePrediction(def: Pick<FleetExerciseDef, 'points'>, text: string): number | null {
  const n = parseNumeric(text)
  return n !== null && def.points.includes(n) ? n : null
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
    throw new Error('a round writes its events only after its sweep')
  }
  return { prediction, seed, truth, ok, committedAt }
}

/**
 * The block's `predict` event: the locked prediction against the sweep's answer on the round's seed, `src: 'lesson'`.
 * `ms` is the time from the round being shown to the lock.
 */
export function predictEvent(def: FleetExerciseDef, ctx: EventCtx, round: Round): ItemResponse {
  const f = filled(round)
  return {
    kind: 'predict',
    ref: exerciseRef(def.id),
    rev: exerciseRev(def),
    score: f.ok ? 1 : 0,
    ok: f.ok,
    ...(round.conf ? { conf: round.conf } : {}),
    seed: f.seed,
    ms: Math.max(0, Math.round(f.committedAt - round.startedAt)),
    provenance: 'unseen',
    data: {
      src: 'lesson',
      value: f.prediction,
      unit: def.unit,
      truth: f.truth,
      kcs: kcsOf(def),
      nsec: PREDICT_NSEC,
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
}

const seconds = (ticks: number): string => formatNumber(ticks * SIM_TICK_SECONDS)

function kneeCopy(): ExerciseCopy {
  const cfg = getFleetTrafficProfile('burstgpt').config
  const first = KNEE_POINTS[0]
  const last = KNEE_POINTS[KNEE_POINTS.length - 1]
  return {
    setup:
      `One engine serves a burst-shaped trace: request lengths follow the quantiles of the committed BurstGPT busiest hour, and arrivals clump. ` +
      `The same requests are replayed at ${KNEE_POINTS.length} load multipliers, ${formatNumber(first)}× to ${formatNumber(last)}×, each over a ${seconds(KNEE_WINDOW_TICKS)} s window. ` +
      `The engine runs ${cfg.maxRunning} sequences at once, first come, first served, and a request counts toward goodput only if its first token arrives within ${cfg.sloTtft} ticks (${seconds(cfg.sloTtft)} s). ` +
      `A flat-tick model (v1): one tick of ${MS_PER_TICK} ms advances every running sequence by one prefill chunk or one decode token.`,
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
      `Each worker is a ${PD_ENGINE.maxRunning}-sequence engine. A prefill worker sends a finished prompt's KV to a decode worker at ${PD_TRANSFER_RATE} tokens per tick, and the transfer waits while the decode worker has no free blocks. ` +
      `The trace offers about ${formatNumber(PD_LOAD)}× the best split's estimated capacity over ${seconds(PD_WINDOW_TICKS)} s. A request counts toward goodput only if its first token lands within ${PD_ENGINE.sloTtft} ticks (${seconds(PD_ENGINE.sloTtft)} s) ` +
      `and no gap between its tokens exceeds ${PD_ENGINE.sloItl ?? 0} ticks. A flat-tick model (v1): one tick of ${MS_PER_TICK} ms advances every running sequence by one prefill chunk or one decode token.`,
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

const COPIES: Readonly<Record<string, () => ExerciseCopy>> = { knee: kneeCopy, 'pd-split': pdSplitCopy }

/** The panel's copy for an exercise id. A later exercise (§16.3) adds a line here; a test fails until every listed exercise has one. */
export function copyFor(id: string): ExerciseCopy | null {
  return Object.hasOwn(COPIES, id) ? COPIES[id]() : null
}

/* ------------------------------ what the sweep shows ------------------------------ */

const pointAt = (result: SweepResult, x: number): SweepPoint | undefined => result.points.find((p) => p.x === x)
const ms = (ticks: number): string => formatNumber(ticks * MS_PER_TICK)

/** The verdict in words: right or off, with the goodput at the learner's pick against the peak. */
export function verdictText(def: FleetExerciseDef, copy: ExerciseCopy, prediction: number, result: SweepResult): { ok: boolean; headline: string; detail: string } {
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

