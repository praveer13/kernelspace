/**
 * Lab 06 in PRIMM stages (docs/specs/wave-3.md §8.2): Predict, Run, Investigate, Modify, Make.
 *
 * Three jobs live here, all pure (no DOM, no clock, no storage):
 *   1. the stage table of the Make step (`STAGES`, `stageRows`, `attemptsToGreen`);
 *   2. the in-browser reference run: the Fleet's `Engine` with `referenceScheduler` on a seeded 60-request trace
 *      (`runTrace`);
 *   3. the items: what the learner predicts, investigates and modifies (`PRIMM_ITEMS`). Each one is the ledger ref
 *      `item:lab06.primm.<id>`; grading and the ledger payload are the shared ones in src/lib/forge/primm.ts.
 *
 * The reference run is NOT the lab's harness. It is a labelled stand-in: the shape of the lab's `probe` (60 requests
 * over 300 iterations, 15 % heavy prompts, 6 slots, a 40-iteration first-token bound) on the Fleet's engine, with a
 * tighter pool than `probe` has (2,560 tokens, not 6,144) so that headroom shows. Every number here is a property of
 * that run and is synthetic.
 */

import { KC } from '@/data/kc/ids'
import type { ForgeLabCheck } from '@/data/labs'
import type { QuizQuestion } from '@/components/QuizBlock'
import type { ItemResponse } from '@/lib/ledger/types'
import { attemptsToGreen as attemptsToGreenOf, observationResponse, stageRows as stageRowsOf } from '@/lib/forge/primm'
import { Engine, makeRefManager, referenceScheduler, type EngineConfig, type RequestSpec, type SchedulerDriver, type TickSample } from '@/lib/fleet-model'
import { splitmix32u } from '@/lib/rng'
import { compileSchedPolicy } from '@/lib/world/sched-policy'
import type { AuthoredItem } from '@/lib/items/types'
import type { ChoicePrimm, NumberPrimm, PrimmItem, PrimmStep, PrimmStepId, ReferenceRunSpec, RunConfig, RunResult, StageInfo } from '../types'

// The shapes live in ../types (the Forge bundle contract), and what PRIMM does for every lab lives in
// src/lib/forge/primm.ts; both are re-exported here, as lab 02's module does.
export type { ChoicePrimm, NumberPrimm, PrimmItem, StageInfo }
export { currentStage, gradeChoice, gradeNumber, greenStage, itemRev, itemResponse, predictGraded, primmRef } from '@/lib/forge/primm'
export type { PrimmAnswer, PrimmGrade, StageRow } from '@/lib/forge/primm'

export const PRIMM_LAB = 'batching-scheduler'

/* ------------------------------------------------------------------ */
/* The Make step: four stages                                          */
/* ------------------------------------------------------------------ */

/**
 * The stage markers in `labs/batching-scheduler/src/scheduler.rs` (name, minutes). Which checks belong to which stage
 * comes from labs.ts. Stage 4's optional check (`overload_seeded`) is not required, so it never blocks the stage.
 */
export const STAGES: readonly StageInfo[] = [
  { n: 1, title: 'Legal moves', minutes: 2, goal: 'A `schedule` that admits the first waiting request that fits. The first green.' },
  { n: 2, title: 'Fill the batch', minutes: 10, goal: 'Walk the whole queue each call, so a burst fills the batch instead of trickling in.' },
  { n: 3, title: 'Order and aging', minutes: 20, goal: 'Smallest prompt first with headroom for decode growth, and aging so the longs run.' },
  { n: 4, title: 'Goodput', minutes: 25, goal: 'Clear the three replay traces’ goodput floors; the seeded overload is optional.' },
]

/** The stages with their checks (labs.ts `stage`) and which of them passed: the shared `stageRows`, bound to lab 06's stages. */
export const stageRows = (checks: readonly ForgeLabCheck[], passed: ReadonlySet<string>) => stageRowsOf(STAGES, checks, passed)

/** Attempts-to-green per stage (spec §13.1, descriptive only), over lab 06's stages. */
export const attemptsToGreen = (runs: readonly (readonly string[])[], checks: readonly ForgeLabCheck[]): (number | null)[] =>
  attemptsToGreenOf(STAGES, runs, checks)

/* ------------------------------------------------------------------ */
/* The reference run: the Fleet's engine on a seeded 60-request trace   */
/* ------------------------------------------------------------------ */

/** The pool, the traffic and the bound of the reference run. */
export const SCENE = {
  requests: 60,
  /** Arrivals are drawn over iterations [0, span). */
  span: 300,
  /** Out of 100 requests, about this many have a heavy prompt. */
  heavyPct: 15,
  light: { min: 64, max: 383 },
  heavy: { min: 768, max: 1791 },
  /** Tokens a request generates. */
  output: { min: 16, max: 63 },
  numBlocks: 160,
  blockSize: 16,
  maxRunning: 6,
  /** A request counts when its first token lands within this many iterations of its arrival. */
  sloTtft: 40,
  prefillChunk: 128,
  /** The run stops here if the engine has not finished (a scheduler that keeps evicting the same work). */
  maxTicks: 1500,
  /** One frame of the strip every this many iterations. */
  every: 8,
} as const

/** Tokens the pool holds: 160 blocks of 16. */
export const MEM_CAP = SCENE.numBlocks * SCENE.blockSize

/** The practice run's seed: fixed, so the numbers can be asked about. */
export const PRACTICE_SEED = 12

/**
 * `report` says which number the run's `value` is: `met`, the requests whose first token landed within the bound (the
 * Predict and Run steps), or `forced`, the sequences the engine had to evict because their next token had no block
 * (the Modify step). The trace and the pool are the same either way.
 */
export interface SchedConfig {
  seed: number
  order: 'sjf' | 'fcfs'
  headroom: 0 | 16 | 48
  report: 'met' | 'forced'
}

/** The reference run: shortest prompt first, 48 tokens of headroom. */
export const REFERENCE: SchedConfig = { seed: PRACTICE_SEED, order: 'sjf', headroom: 48, report: 'met' }

const commas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The seeded trace: ids 1 to 60, in arrival order. */
export function makeTrace(seed: number): RequestSpec[] {
  const next = splitmix32u(seed)
  const below = (n: number) => next() % n
  const out: RequestSpec[] = []
  for (let i = 0; i < SCENE.requests; i++) {
    const heavy = below(100) < SCENE.heavyPct
    const arrival = below(SCENE.span)
    const prompt = heavy ? SCENE.heavy.min + below(SCENE.heavy.max - SCENE.heavy.min + 1) : SCENE.light.min + below(SCENE.light.max - SCENE.light.min + 1)
    const output = SCENE.output.min + below(SCENE.output.max - SCENE.output.min + 1)
    out.push({ id: i + 1, arrival, prompt, output })
  }
  return out.sort((a, b) => a.arrival - b.arrival || a.id - b.id)
}

/** The reference scheduler itself for the reference dials, else the Compose dials' compiled policy (sched-policy.ts). */
function driverOf(c: SchedConfig): SchedulerDriver {
  if (c.order === 'sjf' && c.headroom === 48) return { name: 'reference', schedule: referenceScheduler }
  return compileSchedPolicy({ order: c.order, guard: c.order === 'sjf' ? 2000 : 0, headroom: c.headroom, preempt: 'none' }, SCENE.blockSize)
}

/** What a request is doing at the start of an iteration. */
const NOT_YET = 0
const WAITING = 1
const RUNNING = 2
const MET = 3
const LATE = 4

/** How full each state draws its cell (0 to 100): a request that finished late fades out, since goodput does not count it. */
const FILL = [0, 25, 60, 100, 12] as const

/** One frame of the strip. */
export interface SchedSample {
  /** Iterations applied so far. */
  op: number
  waiting: number
  running: number
  /** Requests that met the bound so far. */
  met: number
  /** Requests finished, in time or late. */
  done: number
  forced: number
  /** Per request, in arrival order: its fill. */
  cells: readonly number[]
}

export interface SchedRun {
  config: SchedConfig
  /** Iterations the run took. */
  total: number
  met: number
  done: number
  /** Sequences the engine evicted because their next token had no block. */
  forced: number
  ttftP95: number
  /** Every request finished before `SCENE.maxTicks`. */
  finished: boolean
  samples: readonly SchedSample[]
}

/**
 * Runs the Fleet's engine over the seeded trace with the config's scheduler, and samples it every `SCENE.every`
 * iterations. What each request is doing is read from the view the scheduler was shown at the start of that iteration
 * and from the engine's finish hook, so the strip shows the engine's own state, not a model of it.
 */
export function runTrace(config: SchedConfig): SchedRun {
  const trace = makeTrace(config.seed)
  const cfg: EngineConfig = { numBlocks: SCENE.numBlocks, blockSize: SCENE.blockSize, maxRunning: SCENE.maxRunning, sloTtft: SCENE.sloTtft, prefillChunk: SCENE.prefillChunk }
  const inner = driverOf(config)
  const views: { waiting: number[]; running: number[] }[] = []
  const watched: SchedulerDriver = {
    name: inner.name,
    schedule(view) {
      views.push({ waiting: view.waiting.map((r) => r.id), running: view.running.map((r) => r.id) })
      return inner.schedule(view)
    },
  }
  const engine = new Engine(cfg, trace.map((r) => ({ ...r })), watched, makeRefManager(cfg.numBlocks, cfg.blockSize))
  const ticks: TickSample[] = []
  engine.recorder = (s) => ticks.push(s)
  const finishedAt = new Map<number, { tick: number; met: boolean }>()
  engine.onFinish = (r) => finishedAt.set(r.id, { tick: r.tick, met: r.sloMet })
  while (!engine.done && engine.tick < SCENE.maxTicks) engine.step()

  const total = engine.tick
  const stateAt = (t: number): number[] => {
    const view = views[t]
    const waiting = new Set(view?.waiting)
    const running = new Set(view?.running)
    return trace.map((r) => {
      const f = finishedAt.get(r.id)
      if (f !== undefined && f.tick < t) return f.met ? MET : LATE
      if (running.has(r.id)) return RUNNING
      if (waiting.has(r.id) || r.arrival < t) return WAITING
      return NOT_YET
    })
  }
  const at = (t: number): SchedSample => {
    const states = stateAt(t)
    const count = (s: number) => states.filter((x) => x === s).length
    return {
      op: t,
      waiting: count(WAITING),
      running: count(RUNNING),
      met: count(MET),
      done: count(MET) + count(LATE),
      forced: t === 0 ? 0 : (ticks[t - 1]?.autoPreempts ?? 0),
      cells: states.map((s) => FILL[s]),
    }
  }
  const samples: SchedSample[] = []
  for (let t = 0; t < total; t += SCENE.every) samples.push(at(t))
  samples.push(at(total))

  const s = engine.stats()
  return { config, total, met: s.sloMet, done: s.completed, forced: s.autoPreempts, ttftP95: engine.ttftP95(), finished: engine.done, samples }
}

const orderWords = (c: SchedConfig) => (c.order === 'sjf' ? 'shortest prompt first' : 'first come first served')

/** One sentence on a finished run, for the strip’s caption and the Modify reveal. */
export function describeRun(run: SchedRun): string {
  const c = run.config
  const policy = `${orderWords(c)}, ${commas(c.headroom)} tokens of headroom`
  const pool = `${plural(SCENE.requests, 'request')} over ${SCENE.span} iterations, ${SCENE.maxRunning} slots, ${commas(MEM_CAP)} tokens`
  const stuck = run.finished ? '' : ` The engine had not finished after ${commas(SCENE.maxTicks)} iterations.`
  const forced = run.forced === 0 ? 'no sequence was evicted for want of a block' : `${plural(run.forced, 'sequence')} evicted for want of a block, each one’s work discarded`
  return `${policy}. ${pool}: ${run.met} of ${SCENE.requests} met the ${SCENE.sloTtft}-iteration first-token bound, the TTFT p95 was ${run.ttftP95} iterations, and ${forced}.${stuck}`
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

type KcList = AuthoredItem['kcs']

const choice = (
  id: string,
  step: ChoicePrimm['step'],
  kcs: KcList,
  q: Omit<QuizQuestion, 'kcs'>,
  nsec = 40,
): ChoicePrimm => ({ kind: 'choice', id, step, nsec, item: { id, kcs, q: { ...q, kcs: [...kcs] } } })

/** What the reference run ends with, quoted in the Predict and Modify items. */
const REFERENCE_RUN = runTrace(REFERENCE)

/**
 * The two limits on how fast the reference run's engine finishes requests, worked from the scene's own ranges (the
 * means of its uniform draws, 15 in 100 heavy) for the Predict item's explanation. A request admitted at one iteration
 * prefills a 128-token chunk an iteration, gets its first token as the last chunk lands, then decodes a token an
 * iteration (fleet-model.ts `Engine.step`): it holds a slot for its prefill plus its output less one. For each of those
 * iterations the reference scheduler counts it at its prompt, its 48 tokens of headroom and the tokens decoded so far
 * (`referenceScheduler`), so `tokenIters` is the pool it takes up over its life.
 */
export const LOAD = loadOf()

function loadOf() {
  const range = (r: { min: number; max: number }) => Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i)
  const mean = (xs: readonly number[], f: (x: number) => number) => xs.reduce((a, x) => a + f(x), 0) / xs.length
  const outputs = range(SCENE.output)
  const heavy = SCENE.heavyPct / 100
  const overPrompts = (f: (p: number) => number) => (1 - heavy) * mean(range(SCENE.light), f) + heavy * mean(range(SCENE.heavy), f)
  const chunks = (p: number) => Math.ceil(p / SCENE.prefillChunk)
  const output = mean(outputs, (o) => o)
  const prefill = overPrompts(chunks)
  const tokenIters = overPrompts((p) => mean(outputs, (o) => (p + REFERENCE.headroom) * (chunks(p) + o - 1) + ((o - 1) * o) / 2))
  return { prompt: overPrompts((p) => p), prefill, output, life: prefill + output - 1, tokenIters }
}

/** The p1 explanation's arithmetic, at the precision it prints. */
export const P1_ARITHMETIC = (() => {
  const life = Math.round(LOAD.life)
  const tokenIters = Math.round(LOAD.tokenIters / 1000) * 1000
  return {
    offered: SCENE.requests / SCENE.span,
    life,
    slotRate: Number((SCENE.maxRunning / life).toFixed(2)),
    tokenIters,
    poolRate: Number((MEM_CAP / tokenIters).toFixed(2)),
  }
})()

/** Whale and shorts of the lab's `convoy` check (lib.rs `scn_convoy`): the numbers the first Investigate item works through. */
const CONVOY = { memCap: 12288, whale: 8192, short: 128, shorts: 88, chunk: 128, slo: 40 } as const

export const PRIMM_ITEMS: readonly PrimmItem[] = [
  /* ---- Predict, before the learner downloads anything ---- */
  {
    kind: 'estimate',
    id: 'lab06.primm.p1',
    step: 'predict',
    nsec: 60,
    kcs: [KC.batchingThroughput, KC.schedOrder],
    prompt: `${SCENE.requests} requests arrive over ${SCENE.span} iterations at an engine with ${SCENE.maxRunning} slots and room for ${commas(MEM_CAP)} tokens (${SCENE.numBlocks} blocks of ${SCENE.blockSize}). About ${SCENE.heavyPct} in 100 have a prompt of ${commas(SCENE.heavy.min)} to ${commas(SCENE.heavy.max)} tokens; the rest have ${SCENE.light.min} to ${SCENE.light.max}. Each generates ${SCENE.output.min} to ${SCENE.output.max} tokens, and a request counts only if its first token lands within ${SCENE.sloTtft} iterations of its arrival. The reference scheduler admits the shortest prompt first, keeps 48 tokens of headroom per request and never preempts. How many of the ${SCENE.requests} requests count?`,
    unit: 'requests',
    factor: 1.5,
    explain: `Offered load is ${SCENE.requests} requests in ${SCENE.span} iterations, ${P1_ARITHMETIC.offered} an iteration. A request holds a slot for its prefill (a ${SCENE.prefillChunk}-token chunk an iteration, ${LOAD.prefill.toFixed(1)} iterations on average) and its decode (${LOAD.output} tokens on average), about ${P1_ARITHMETIC.life} iterations, so ${SCENE.maxRunning} slots finish at most ${SCENE.maxRunning} / ${P1_ARITHMETIC.life} = ${P1_ARITHMETIC.slotRate} requests an iteration. The pool binds harder: for each of those iterations the scheduler counts a request at its prompt (${Math.round(LOAD.prompt)} tokens on average), 48 tokens of headroom and what it has decoded, about ${commas(P1_ARITHMETIC.tokenIters)} token-iterations a request, so ${commas(MEM_CAP)} tokens packed full finish at most ${commas(MEM_CAP)} / ${commas(P1_ARITHMETIC.tokenIters)} = ${P1_ARITHMETIC.poolRate} an iteration. Both are under ${P1_ARITHMETIC.offered}, so the queue grows while requests arrive and some wait past the bound; the order decides which. Shortest-first keeps the short prompts moving and leaves the heavy ones for last, where the pool packs worst: two prompts over ${commas(MEM_CAP / 2)} tokens never fit in it together, and this run takes ${commas(REFERENCE_RUN.total)} iterations to finish all ${SCENE.requests}. In this run ${REFERENCE_RUN.met} of ${SCENE.requests} count.`,
  },
  choice('lab06.primm.p2', 'predict', [KC.schedOrder], {
    q: 'You write a scheduler that sorts the waiting requests smallest prompt first, keeps 48 tokens of headroom per running sequence and walks the whole queue each call. It has no starvation guard. Going through the stages in order (1, 2, 3, 4), which check goes red first?',
    options: [
      '`burst` in stage 2, because smallest-first leaves the batch half empty while the whole burst arrives',
      '`convoy` in stage 3, because the whale is admitted before the shorts that it will hold up',
      '`starvation` in stage 3, because the three longs stay behind the shorts that keep on arriving',
      '`goodput_score` in stage 4, because smallest-first misses a floor on the replay traces',
    ],
    correct: [2],
    why: [
      'Smallest-first fills the batch: it walks the whole queue and admits every request that fits. The calibration run for this design does not fail `burst`.',
      'Smallest-first sends the 8,192-token whale last, not first, so the shorts run at once. That order is what `convoy` asks for, and a scheduler that sorts this way passes it.',
      'With no aging, a short request always sorts ahead of a long one, and shorts keep arriving, so the three longs are not first in line before the run ends. `starvation` needs all three to complete, and it fails.',
      'Pure smallest-first scores 62.5 %, 90.6 % and 76.7 % on the three replay traces, over the floors of 55 %, 85 % and 70 %. It passes `goodput_score`; `starvation` stops it earlier.',
    ],
    explanation: 'Only `starvation` fails pure smallest-first. Aging, which moves an old request to the front, is what stage 3 adds.',
  }),

  /* ---- Investigate: the harness ---- */
  {
    kind: 'numeric',
    id: 'lab06.primm.i1',
    step: 'investigate',
    nsec: 45,
    kcs: [KC.schedOrder, KC.admissionHeadroom],
    prompt: `In the \`convoy\` check the engine has room for ${commas(CONVOY.memCap)} tokens. The ${commas(CONVOY.whale)}-token whale is admitted first, and each of the ${CONVOY.shorts} short requests needs ${CONVOY.short} tokens. How many shorts can run beside the whale, ignoring headroom?`,
    unit: 'shorts',
    truth: (CONVOY.memCap - CONVOY.whale) / CONVOY.short,
    lures: [
      { value: 96, miss: 'convoy.forgets-whale', message: '96 is 12,288 / 128: the whole pool divided among shorts. The whale already holds 8,192 tokens of it.' },
      { value: 88, miss: 'convoy.all-shorts', message: '88 is every short. They fit alone (88 x 128 = 11,264), but not beside the whale.' },
      { value: 64, miss: 'convoy.prefill-iterations', message: '64 is the whale’s prefill in iterations (8,192 / 128), not a count of requests that fit.' },
    ],
    explain: `The whale holds ${commas(CONVOY.whale)} of the ${commas(CONVOY.memCap)} tokens, leaving ${commas(CONVOY.memCap - CONVOY.whale)}; at ${CONVOY.short} tokens a short, ${(CONVOY.memCap - CONVOY.whale) / CONVOY.short} fit beside it. The other ${CONVOY.shorts - (CONVOY.memCap - CONVOY.whale) / CONVOY.short} wait, and the whale’s prefill alone takes ${CONVOY.whale / CONVOY.chunk} iterations, longer than the ${CONVOY.slo}-iteration bound. That is the convoy, and it is why the order is graded.`,
  },
  choice('lab06.primm.i2', 'investigate', [KC.admissionHeadroom], {
    q: 'The TODO file says no check catches too little headroom, even none, yet it advises about 48 tokens per running sequence. Why keep it?',
    options: [
      'Because an action that leaves less than the headroom free counts as illegal, and an illegal action fails the scenario at once',
      'Because only part of a prompt is reserved when it is admitted, and the headroom pays for the rest of the prompt',
      'Because goodput is divided by the memory in use, so memory left unused raises the score of the run',
      'Because decode keeps growing each running sequence, so a full pool forces an eviction',
    ],
    correct: [3],
    why: [
      'Legality tests only the action itself: the ids it names, the slot count, and whether admits and preempts push resident memory past the cap. A pool that is nearly full is legal.',
      'The whole prompt is reserved at admission, which is why a long prompt costs its full length up front. Headroom is for the tokens decode adds afterwards.',
      'Goodput is the share of requests that meet the first-token bound, met divided by total. Memory use does not enter it.',
      'Resident memory is prompt plus decoded tokens, and decode grows it every iteration. Admit up to the cap and the engine force-preempts a sequence, discarding its progress. The headroom is the room that growth needs.',
    ],
    explanation: 'Headroom is about decode growth, not about the score. Without it the pool thrashes: the engine evicts a sequence and the work is done twice.',
  }),
  choice('lab06.primm.i3', 'investigate', [KC.continuousBatching], {
    q: 'An old request is first in your order, but its prompt does not fit under the cap right now, and smaller requests wait behind it. What should the admit loop do with it?',
    options: [
      'Stop there, since admitting anything behind it would be unfair to it, and the next call will try it again',
      'Skip it and keep walking, and admit each later request that fits while there is free room to use',
      'Preempt a running request to make room, and give the oldest request the first claim on memory',
      'Drop it from the waiting list, since a request that cannot fit now will never be served at all',
    ],
    correct: [1],
    why: [
      'Stopping idles the free memory and slots while smaller requests could run. The batch stays small for no gain, and the old request does not fit any sooner.',
      'Walking on uses what is free this iteration. The old request is still first in line on the next call, so it is admitted as soon as enough room opens.',
      'A preempt discards the victim’s progress, and nothing here needs one: the old request only has to wait for room. The lab’s traces never need a preempt.',
      'Only admission takes a request off the waiting list. Dropping it would leave an id that is never served, and its goodput counts as lost.',
    ],
    explanation: 'The loop skips what does not fit and keeps walking. It stops only when the slots are full.',
  }),

  /* ---- Modify: one dial, predict, run ---- */
  {
    kind: 'estimate',
    id: 'lab06.primm.m1',
    step: 'modify',
    nsec: 60,
    kcs: [KC.admissionHeadroom, KC.continuousBatching],
    prompt: `You changed the policy; the trace and the pool are the same. The reference run, with 48 tokens of headroom, ends with ${REFERENCE_RUN.forced} sequences evicted because their next token had no free block. How many sequences does the engine evict in your run?`,
    unit: 'evictions',
    factor: 2,
    explain: `With no headroom, requests are admitted until the pool is full, and then every running sequence grows by a token each iteration; the first one that needs a new block when none is free is evicted, and its prefill and decode are done again. Headroom of 48 tokens is three blocks per sequence, which is the room that growth needs, so the reference run evicts ${REFERENCE_RUN.forced === 0 ? 'none' : plural(REFERENCE_RUN.forced, 'sequence')}.`,
  },
]

/** The multiple-choice items, as verify-items judges them (blind-strategy gates, every option with a why). */
export const PRIMM_MC_ITEMS: readonly AuthoredItem[] = PRIMM_ITEMS.flatMap((i) => (i.kind === 'choice' ? [i.item] : []))

export const itemById = (id: string): PrimmItem | undefined => PRIMM_ITEMS.find((i) => i.id === id)

/** Steps the panel walks through, in order. `run` has no item of its own: its evidence is `RUN_ITEM`. */
export const PRIMM_STEPS = [
  { id: 'predict', title: 'Predict', blurb: 'Before you download anything, guess how many of 60 requests a good scheduler serves in time, and which check catches one with no starvation guard.' },
  { id: 'run', title: 'Run', blurb: 'Watch the Fleet’s own engine and reference scheduler serve a seeded trace of 60 requests in your browser.' },
  { id: 'investigate', title: 'Investigate', blurb: 'Three questions about the convoy check, headroom and the admit loop.' },
  { id: 'modify', title: 'Modify', blurb: 'Take the headroom away, predict how often the engine has to evict a sequence, then run it.' },
  { id: 'make', title: 'Make', blurb: 'Build the scheduler in four stages. Each is green on this page before the next.' },
] as const satisfies readonly PrimmStep[]

export type { PrimmStepId }

/**
 * The Run step's own item: the reference run's observed value. Watching a strip is not an answer, so it carries
 * no KCs; only the time and the observed value are evidence.
 */
export const RUN_ITEM = { id: 'lab06.primm.r1', nsec: 45 }

/** The Run step's evidence: the requests the reference run served in time, of the trace. An observation, not a graded answer: no KCs. */
export const runResponse = (run: SchedRun, ms?: number): ItemResponse =>
  observationResponse(RUN_ITEM, { config: run.config as unknown as RunConfig, value: run.met, truth: SCENE.requests }, ms)

/* ------------------------------------------------------------------ */
/* The reference run as bundle data                                     */
/* ------------------------------------------------------------------ */

/** What `ReferenceRun` shows for a config, in the bundle's lab-neutral shape (frames, stats, one-line summary). */
function runSpecResult(config: RunConfig): RunResult {
  const cfg = config as unknown as SchedConfig
  const run = runTrace(cfg)
  const forced = cfg.report === 'forced'
  return {
    config,
    total: run.total,
    value: forced ? run.forced : run.met,
    // the most the value could be: every request in time, or one eviction per slot per iteration
    truth: forced ? run.total * SCENE.maxRunning : SCENE.requests,
    clean: run.finished,
    summary: describeRun(run),
    frames: run.samples.map((s) => {
      const arrived = s.cells.filter((c) => c > 0).length
      return {
        op: s.op,
        cells: s.cells,
        stats: [
          { label: 'waiting', value: String(s.waiting) },
          { label: 'running', value: String(s.running) },
          { label: 'met the bound', value: String(s.met) },
          { label: 'evictions', value: String(s.forced) },
        ],
        alt: `The ${SCENE.requests} requests in arrival order, at iteration ${s.op}. ${SCENE.requests - arrived} not yet arrived, ${s.waiting} waiting, ${s.running} running, ${s.met} finished within the ${SCENE.sloTtft}-iteration bound, ${s.done - s.met} finished late. ${s.forced} sequences evicted for want of a block so far.`,
      }
    }),
  }
}

/** Lab 06's Run and Modify steps as data: the bundle's `primm.run`. */
export const RUN_SPEC: ReferenceRunSpec = {
  item: RUN_ITEM,
  title: (config) => `Reference: the Fleet’s engine, ${orderWords(config as unknown as SchedConfig)}, ${config.headroom} tokens of headroom`,
  disclaimer: `Each cell is one request, in arrival order: faint has not arrived, light is waiting, half-bright is running, bright met the ${SCENE.sloTtft}-iteration first-token bound, and a request that finished late fades out, since goodput does not count it. This is the Fleet’s own engine and reference scheduler on the page’s own trace, shaped like the lab’s \`probe\` but with a tighter pool; it is not the lab’s harness.`,
  reference: { ...REFERENCE },
  run: runSpecResult,
  modify: {
    lead: `Change one thing about the reference run (${SCENE.requests} requests, ${SCENE.maxRunning} slots, ${commas(MEM_CAP)} tokens).`,
    dials: [
      { id: 'headroom0', label: 'headroom 48 becomes 0', config: { ...REFERENCE, headroom: 0, report: 'forced' } },
      { id: 'fcfs0', label: 'headroom 48 becomes 0 and shortest-first becomes first come first served', config: { ...REFERENCE, order: 'fcfs', headroom: 0, report: 'forced' } },
    ],
  },
}
