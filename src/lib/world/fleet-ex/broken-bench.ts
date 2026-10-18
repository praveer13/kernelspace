/**
 * The broken benchmark (docs/specs/wave-3.md §16.3; t7.l2, `t7.benchmark-hygiene`): a Fleet run was benchmarked with one
 * flaw, and the number it reported is wrong. You predict the p95 TTFT the benchmark should have reported, which is the
 * p95 TTFT of the same traffic with the flaw taken out. The sweep has two points: x = 0 the benchmark as it was run,
 * x = 1 the corrected run. The answer is the corrected run's p95 TTFT in milliseconds, a free number (`range`), and a
 * prediction passes within 30 % of it.
 *
 * THE FOUR FLAWS. All four are expressible on the Fleet engine's own mechanisms, so none is left out (the PR says so).
 * Each is a way a published number comes out of a run that is not the traffic it is quoted for (`BbFlaw`):
 *   - `closed-loop`: the benchmark ran 64 clients (one per slot), each sending its next request the moment its last one
 *     finished (`Engine.inject` from `onFinish`). A closed loop slows down when the server does, so a queue never forms,
 *     TTFT is prefill alone, and throughput sits at the engine's capacity (the lesson's "closed-loop concurrency", and
 *     coordinated omission). Production offers arrivals open loop at `load` times that capacity, a rate the engine
 *     cannot finish, and the queue grows.
 *   - `capped-output`: the benchmark capped every reply at `cap` tokens (`max_tokens`), so a request frees its slot a
 *     few ticks after its prefill and the same arrivals never queue. Real replies run to their own length.
 *   - `warm-cache`: every benchmark prompt repeats one prefix that is already in the cache (`RequestSpec.cachedPrefix`,
 *     which the Engine skips in prefill), so only the rest is prefilled. Production prompts are new.
 *   - `warm-up`: the benchmark counted its first ticks, while the engine was cold. A cold engine (kernels uncompiled,
 *     graphs uncaptured) is modelled with the Engine's straggler hook, `setSlowdown`: one tick in four runs until the
 *     engine warms. That is a stand-in, labelled: the flat-tick Engine has no compile or capture cost of its own. It is
 *     the one flaw that makes the number worse than the truth, not better. Production's engine, and the corrected run, start warm.
 *
 * THE MODEL (flat tick, v1, labelled). One Engine of `BB_ENGINE`: 64 running sequences, first come first served, one
 * prefill chunk of 128 tokens or one decode token per tick per sequence, 50 ms a tick. A request holds a slot for
 * ⌈prompt ÷ 128⌉ prefill ticks and then one tick per output token after the first (the reading counts every token, a tick
 * high), so Little's law bounds the rate at 64 ÷ the mean hold, and a request that waits for no one has a TTFT of
 * ⌈prompt ÷ 128⌉ − 1 ticks. KV is sized so it never binds (64 of the longest prompt with its reply fit), which keeps the
 * question about slots. Arrivals are uniform random times over a window of 400, 600, 800 or 1,000 ticks (20 to 50 s), and
 * the engine runs on after the window until every request has finished.
 *
 * THE CORRECTED RUN is always the same kind of run: production's arrivals, open loop, the real prompts and outputs, a
 * cold prefix cache, a warm engine. What the flaw changes is the load, so the reading differs (`bbRead`):
 *   - after `closed-loop` and `capped-output` production offers 1.15 to 4 times capacity. A queue grows for the whole
 *     window at (load − 1) times capacity, so the request arriving 95 % of the way through waits about
 *     (load − 1) × 95 % of the window, plus its prefill: that is the p95 (`bbQueue`). The fluid reading runs about 7 %
 *     high at the median, because the first requests find free slots and the queue starts a little late.
 *   - after `warm-cache` and `warm-up` it offers 0.3 to 0.5 of capacity, so almost nothing queues and the p95 is the
 *     prefill of a 95th-percentile prompt, ⌈P95 ÷ 128⌉ − 1 ticks.
 * `bbRead` applies that to the scene's facts and nothing else; tests/world/fleet-ex-more-a.test.ts measures how often it
 * passes and how often a guess that ignores the scene does (BF8). Past capacity the p95 depends on how long the run lasted,
 * which the lesson's note says: a p95 taken beyond the knee is not a latency number.
 *
 * THE DRAW (`bbCase`) draws the answer first, as the knee and the P:D split do (D39), so the flaw's label does not name it.
 * The seed draws the flaw (the four equally often) and then:
 *   - over capacity, the p95 request's wait, uniform in log over 100 … 2,503 ticks (`BB_QUEUE_GRID`: 67 waits, each
 *     1.05 times the last), then the prompt range (from 384 … 3,072 tokens, two or three times as wide), the output range
 *     (from 16 … 128 tokens, twice as wide) and a window on which that wait needs a load of 1.15 to 4 (`bbLoadFor`,
 *     rounded up to a hundredth), and for `capped-output` a cap of 4, 8 or 16 that keeps the capped run under 0.8 of its
 *     own engine, so that run cannot queue itself;
 *   - under capacity, the 95th-percentile prompt's prefill, 5 … 150 ticks weighted 1 ÷ ticks (`bbPrefillTicks`, uniform
 *     in log), then a prompt range two or three times as wide whose P95 lands mid-way through that chunk (`bbPromptFor`),
 *     the output range, the load and the window;
 *   - the flaw's own number (the cached share, or the cold ticks: 100, 150 or 200, and at least 3 × the answer's ticks,
 *     so a cold start long enough to move the p95 is counted however long the prompts are).
 * A traffic that offers fewer than 120 requests, or on which no cap fits, is drawn again; the answer never is. On fixed
 * prompt and load grids each flaw's answers bunched, and the best constant for each flaw label passed 35.6 % of rounds
 * and finished the exercise within 10 rounds 23.5 % of the time (the 3s review's G1). Drawn this way the flaw label alone
 * is no better than the scene-blind bound D39 sets for the knee (14 % within 10 rounds, 40 % within 30); the test
 * prints both.
 * The scene shows the traffic and what the benchmark did differently; it never shows either run's p95. The band
 * (`bbBand`): every request completes, the corrected run has at least 100 requests (a p95 of fewer is a rumour) and a p95
 * of at least 4 ticks, and the benchmark's p95 is at least 1.5 times too low (or too high), so the number it reported
 * cannot pass and the flaw matters. Every draw is a splitmix32 output and every step is +, −, ×, ÷ or a rounding, so a
 * seed gives one run in every browser.
 */

import { splitmix32u } from '@/lib/rng'
import {
  Engine,
  HEADROOM_TOKENS,
  makeRefManager,
  SIM_TICK_SECONDS,
  type EngineConfig,
  type RequestSpec,
  type SchedAction,
  type SchedulerDriver,
  type SchedView,
} from '@/lib/fleet-model'
import type { FleetExerciseDef, SceneFact, SweepPoint, SweepResult } from './index'
import { goodputRps } from './rate'

/** x = 0 is the benchmark as it was run, x = 1 the corrected run. */
export const BB_POINTS = [0, 1] as const
export const BB_AS_RUN = 0
export const BB_CORRECTED = 1

export const BB_FLAWS = ['closed-loop', 'capped-output', 'warm-cache', 'warm-up'] as const
export type BbFlaw = (typeof BB_FLAWS)[number]

/** The engine every run uses: KV is large enough that 64 sequences of the longest prompt never fill it. */
export const BB_ENGINE: EngineConfig = {
  numBlocks: 84000,
  blockSize: 16,
  maxRunning: 64,
  sloTtft: 40,
  prefillChunk: 128,
}

/** The arrival windows a seed draws from, in ticks (20, 30, 40 and 50 s at 50 ms a tick). */
export const BB_WINDOWS = [400, 600, 800, 1000] as const

/** The prompt and output ranges the grid draws from: a prompt range starts at `from` and is `width` times as wide, an output range is twice as wide. */
export const BB_PROMPT_FROM = [384, 544, 768, 1088, 1536, 2176, 3072] as const
export const BB_PROMPT_WIDTH = [2, 3] as const
export const BB_OUTPUT_FROM = [16, 24, 32, 48, 64, 96, 128] as const

/** Production's load as a multiple of the engine's capacity, after a flaw that hid a queue (from `BB_LOAD_MIN` to `BB_LOAD_MAX`) and after one that made the number too high or too low without one. */
export const BB_LOAD_MIN = 1.15
export const BB_LOAD_MAX = 4
export const BB_LOAD_LIGHT = [0.3, 0.4, 0.5] as const

/** Over capacity the answer is mostly the p95 request's wait, (load − 1) × 95 % of the window: drawn first, uniform in log from `BB_MIN_QUEUE_TICKS` up to this many ticks. */
export const BB_QUEUE_MAX_TICKS = 2600
/** The step of that grid: each wait is this many times the one before. */
export const BB_QUEUE_STEP = 1.05

/** Under capacity the answer is the prefill of a 95th-percentile prompt, ⌈P95 ÷ 128⌉ − 1 ticks: drawn first, weighted 1 ÷ ticks (uniform in log) over these. */
export const BB_PREFILL_MIN_TICKS = 5
export const BB_PREFILL_MAX_TICKS = 150
/** Light-load prompt ranges start at a multiple of this many tokens. */
export const BB_PROMPT_ROUND = 16

/**
 * The flaws' own numbers: the output cap, the share of each prompt cached, the ticks counted while cold (at least
 * `BB_COLD_PER_PREFILL` times the answer's prefill ticks, so a long prompt's cold start still moves the p95) and how cold
 * (one tick in `BB_COLD_EVERY` runs).
 */
export const BB_CAPS = [4, 8, 16] as const
export const BB_HITS = [75, 80, 90] as const
export const BB_COLD_TICKS = [100, 150, 200] as const
export const BB_COLD_EVERY = 4
export const BB_COLD_PER_PREFILL = 3

/** The share of the window the p95 request arrives after. */
export const BB_P95 = 0.95
/** The least wait in ticks a growing queue gives the p95 request on a drawn seed. */
export const BB_MIN_QUEUE_TICKS = 100
/** The most a capped run may load its own engine, as a share of capacity. */
export const BB_CAPPED_LOAD = 0.8

/** The benchmark has to be at least this many times off for the seed to be a question. */
export const BB_MIN_RATIO = 1.5
export const BB_MIN_REQUESTS = 100
/** A draw offers at least this many requests, so the band's 100 holds with room to spare. */
export const BB_DRAW_REQUESTS = 120
/** Draws of the traffic a seed may make before it takes the lightest the grids allow. */
export const BB_TRIES = 256
export const BB_MIN_TICKS = 4
/** A prediction passes within this share of the right answer. */
export const BB_TOLERANCE = 0.3

/** Salts the draws, so the case, the open-loop arrivals and the closed-loop lengths each have a stream of their own. */
const CASE_SALT = 0x62656e63
const STREAM_SALT = 0x6f70656e
const CLIENT_SALT = 0x636c6f73

/** Ticks past the window a run may take before it is cut off (it never is on a banded seed). */
const BB_DRAIN_TICKS = 20000

const inRange = (u: number, r: { min: number; max: number }) => r.min + (u % (r.max - r.min + 1))
const MS_PER_TICK = Math.round(SIM_TICK_SECONDS * 1000)

/** A seed's case: the flaw, the traffic it was benchmarked on, and the flaw's own number. */
export interface BbCase {
  flaw: BbFlaw
  prompt: { min: number; max: number }
  output: { min: number; max: number }
  /** Production's arrivals as a multiple of the engine's capacity on the real traffic. */
  load: number
  /** The arrival window in ticks. */
  window: number
  /** `capped-output`: tokens a reply was cut at. */
  cap?: number
  /** `warm-cache`: percent of every prompt already in the cache. */
  hit?: number
  /** `warm-up`: ticks counted while the engine was cold. */
  cold?: number
}

/** Ticks a request of the case holds a slot on average: ⌈mean prompt ÷ chunk⌉ for its prefill, then one tick per output token. */
export function bbHold(c: Pick<BbCase, 'prompt' | 'output'>, output = (c.output.min + c.output.max) / 2): number {
  const prompt = (c.prompt.min + c.prompt.max) / 2
  return Math.ceil(prompt / BB_ENGINE.prefillChunk) + output
}

/** Requests per tick the engine can finish on the real traffic: Little's law, slots ÷ the mean hold. */
export const bbCapacity = (c: Pick<BbCase, 'prompt' | 'output'>): number => BB_ENGINE.maxRunning / bbHold(c)

/**
 * Ticks the request at the 95th percentile of arrivals waits when the queue grows all window: it builds at (load − 1)
 * times capacity, so a request arriving 95 % of the way through has waited about (load − 1) × 95 % of the window.
 * Nothing queues at or under capacity. The fluid reading runs about 7 % high at the median on the banded seeds (the first
 * requests find free slots, so the queue starts a little late), and tests/world/fleet-ex-more-a.test.ts measures it.
 */
export const bbQueue = (load: number, window: number): number => (load > 1 ? (load - 1) * BB_P95 * window : 0)

/** The waits an over-capacity seed draws from: `BB_MIN_QUEUE_TICKS` … `BB_QUEUE_MAX_TICKS`, each `BB_QUEUE_STEP` times the last (products, so every browser builds the same grid). */
export const BB_QUEUE_GRID: readonly number[] = (() => {
  const grid: number[] = []
  for (let q = BB_MIN_QUEUE_TICKS; q <= BB_QUEUE_MAX_TICKS; q *= BB_QUEUE_STEP) grid.push(q)
  return grid
})()

/** The load that gives the p95 request a wait of `queue` ticks over `window`, rounded up to a hundredth so the wait is at least that. */
export const bbLoadFor = (queue: number, window: number): number => Math.ceil((1 + queue / (BB_P95 * window)) * 100) / 100

const PREFILL_WEIGHTS: readonly number[] = (() => {
  const cum: number[] = []
  let sum = 0
  for (let t = BB_PREFILL_MIN_TICKS; t <= BB_PREFILL_MAX_TICKS; t++) cum.push((sum += 1 / t))
  return cum
})()

/** A light-load seed's answer in ticks from one draw: `BB_PREFILL_MIN_TICKS` … `BB_PREFILL_MAX_TICKS`, weighted 1 ÷ ticks. */
export function bbPrefillTicks(u: number): number {
  const x = (u / 4294967296) * (PREFILL_WEIGHTS[PREFILL_WEIGHTS.length - 1] as number)
  const i = PREFILL_WEIGHTS.findIndex((c) => x < c)
  return BB_PREFILL_MIN_TICKS + (i < 0 ? PREFILL_WEIGHTS.length - 1 : i)
}

/**
 * The prompt range, `width` times as wide as its start, whose 95th percentile is mid-way through the `ticks` + 1-th
 * prefill chunk, so ⌈P95 ÷ 128⌉ − 1 = `ticks`: P95 = min + 0.95 × (max − min) with max = width × min − 1, solved for min
 * and rounded to `BB_PROMPT_ROUND` tokens (which moves P95 by under half a chunk).
 */
export function bbPromptFor(ticks: number, width: number): { min: number; max: number } {
  const p95 = BB_ENGINE.prefillChunk * (ticks + 0.5)
  const min = Math.round((p95 + BB_P95) / (1 + BB_P95 * (width - 1)) / BB_PROMPT_ROUND) * BB_PROMPT_ROUND
  return { min, max: min * width - 1 }
}

/**
 * The case the seed draws: the flaw, then its answer (an over-capacity wait from `BB_QUEUE_GRID`, or an under-capacity
 * prefill from `bbPrefillTicks`), then the traffic that gives it (see the file header). The answer is never redrawn: a
 * traffic that offers fewer than `BB_DRAW_REQUESTS` is (its output range, window and load or prompt range), and so is a
 * capped-output one on which every cap would load the capped run's own engine past `BB_CAPPED_LOAD`, because that run
 * must not queue itself; the cap is drawn among the ones that do not. The wait stays at least `BB_MIN_QUEUE_TICKS` (a
 * short queue is mostly noise), since `bbLoadFor` rounds the load up.
 */
function drawCase(seed: number): { c: BbCase; draws: number } {
  const next = splitmix32u(seed ^ CASE_SALT)
  const flaw = BB_FLAWS[next() % BB_FLAWS.length] as BbFlaw
  const over = isOver(flaw)
  // the answer first: the p95 request's wait over capacity, the p95 prompt's prefill under it
  const queue = over ? (BB_QUEUE_GRID[next() % BB_QUEUE_GRID.length] as number) : 0
  const ticks = over ? 0 : bbPrefillTicks(next())
  const light = over ? undefined : bbPromptFor(ticks, BB_PROMPT_WIDTH[next() % BB_PROMPT_WIDTH.length] as number)
  const windows = bbWindowsFor(queue)
  const pick = (): BbCase => {
    const omin = BB_OUTPUT_FROM[next() % BB_OUTPUT_FROM.length] as number
    const output = { min: omin, max: omin * 2 - 1 }
    if (light !== undefined) {
      const load = BB_LOAD_LIGHT[next() % BB_LOAD_LIGHT.length] as number
      const window = BB_WINDOWS[next() % BB_WINDOWS.length] as number
      return { flaw, prompt: light, output, load, window }
    }
    const from = BB_PROMPT_FROM[next() % BB_PROMPT_FROM.length] as number
    const prompt = { min: from, max: from * (BB_PROMPT_WIDTH[next() % BB_PROMPT_WIDTH.length] as number) - 1 }
    const window = windows[next() % windows.length] as number
    const c: BbCase = { flaw, prompt, output, load: bbLoadFor(queue, window), window }
    if (flaw !== 'capped-output') return c
    // the caps under which the capped run stays under BB_CAPPED_LOAD of its own engine, one at random
    const caps = BB_CAPS.filter((k) => (c.load * bbHold(c, k)) / bbHold(c) <= BB_CAPPED_LOAD)
    return caps.length === 0 ? c : { ...c, cap: caps[next() % caps.length] as number }
  }
  let c = pick()
  let draws = 1
  for (; draws <= BB_TRIES && !bbKeeps(c); draws++) c = pick()
  // never on seeds 0 … 99,999, none of which draws more than 21 times
  if (!bbKeeps(c)) c = bbLightest(flaw, queue, light)
  if (flaw === 'warm-cache') c = { ...c, hit: BB_HITS[next() % BB_HITS.length] as number }
  else if (flaw === 'warm-up') {
    c = { ...c, cold: Math.max(BB_COLD_TICKS[next() % BB_COLD_TICKS.length] as number, BB_COLD_PER_PREFILL * ticks) }
  }
  return { c, draws }
}

export const bbCase = (seed: number): BbCase => drawCase(seed).c

/** How many times the seed drew its traffic before a draw kept every rule (tests/world/fleet-ex-more-a.test.ts reads it). */
export const bbCaseDraws = (seed: number): number => drawCase(seed).draws

const isOver = (flaw: BbFlaw): boolean => flaw === 'closed-loop' || flaw === 'capped-output'

/**
 * The windows on which an over-capacity wait needs a load in `BB_LOAD_MIN` … `BB_LOAD_MAX`. Never none: 100 ticks needs
 * 1.27 on the 400-tick window, and the grid's last wait, 2,503, needs 3.64 on the 1,000-tick one.
 */
export const bbWindowsFor = (queue: number): number[] => BB_WINDOWS.filter((w) => bbLoadFor(queue, w) >= BB_LOAD_MIN && bbLoadFor(queue, w) <= BB_LOAD_MAX)

/** A traffic keeps the draw's rules: `BB_DRAW_REQUESTS` or more, an over-capacity wait of `BB_MIN_QUEUE_TICKS` or more, and a capped-output case has a cap that fits. */
export const bbKeeps = (c: BbCase): boolean =>
  c.load * bbCapacity(c) * c.window >= BB_DRAW_REQUESTS &&
  bbQueue(c.load, c.window) >= (isOver(c.flaw) ? BB_MIN_QUEUE_TICKS : 0) &&
  (c.flaw !== 'capped-output' || (c.cap !== undefined && (c.load * bbHold(c, c.cap)) / bbHold(c) <= BB_CAPPED_LOAD))

/**
 * The lightest traffic the grids allow for an answer, which a seed takes if `BB_TRIES` draws all break a rule, and which
 * keeps them all (the test checks every answer): over capacity the shortest prompts, the longest replies (so the
 * smallest cap fits) and the longest window the wait fits; under it the `light` prompt range, the shortest replies, the
 * highest load and the longest window.
 */
export function bbLightest(flaw: BbFlaw, queue: number, light?: { min: number; max: number }): BbCase {
  const over = isOver(flaw)
  const omin = (over ? BB_OUTPUT_FROM[BB_OUTPUT_FROM.length - 1] : BB_OUTPUT_FROM[0]) as number
  const output = { min: omin, max: omin * 2 - 1 }
  const from = BB_PROMPT_FROM[0] as number
  const prompt = light ?? { min: from, max: from * 2 - 1 }
  const window = (over ? bbWindowsFor(queue).at(-1) : BB_WINDOWS[BB_WINDOWS.length - 1]) as number
  const c: BbCase = { flaw, prompt, output, load: over ? bbLoadFor(queue, window) : (BB_LOAD_LIGHT[BB_LOAD_LIGHT.length - 1] as number), window }
  return flaw === 'capped-output' ? { ...c, cap: BB_CAPS[0] } : c
}

/** First come, first served: admit the oldest waiting request while a slot and its prompt plus headroom fit. */
function fifo(v: SchedView): SchedAction {
  let used = v.running.reduce((a, r) => a + r.prompt + r.decoded + HEADROOM_TOKENS, 0)
  let slots = v.maxRunning - v.running.length
  const admit: number[] = []
  for (const r of [...v.waiting].sort((a, b) => a.arrival - b.arrival || a.id - b.id)) {
    if (slots === 0 || used + r.prompt + HEADROOM_TOKENS > v.memCap) break
    admit.push(r.id)
    slots -= 1
    used += r.prompt + HEADROOM_TOKENS
  }
  return { admit, preempt: [] }
}

const FIFO: SchedulerDriver = { name: 'fifo', schedule: fifo }

/** Production's arrivals for the seed, sorted by arrival: uniform random times over the window, the real lengths. */
export function bbTrace(seed: number): RequestSpec[] {
  const c = bbCase(seed)
  const count = Math.round(c.load * bbCapacity(c) * c.window)
  const next = splitmix32u(seed ^ STREAM_SALT)
  const out: RequestSpec[] = []
  for (let i = 0; i < count; i++) {
    out.push({ id: i + 1, arrival: next() % c.window, prompt: inRange(next(), c.prompt), output: inRange(next(), c.output) })
  }
  return out.sort((a, b) => a.arrival - b.arrival || a.id - b.id)
}

/** What a run reports: the engine's completed requests and its p95 TTFT in ticks. */
interface Run {
  requests: number
  completed: number
  sloMet: number
  shed: number
  ttftP95: number
}

const finish = (engine: Engine, requests: number): Run => {
  const s = engine.stats()
  return { requests, completed: s.completed, sloMet: s.sloMet, shed: s.shed, ttftP95: engine.ttftP95() }
}

const newEngine = (stream: RequestSpec[]): Engine => new Engine(BB_ENGINE, stream, FIFO, makeRefManager(BB_ENGINE.numBlocks, BB_ENGINE.blockSize))

/** The stream replayed open loop on a warm engine; `coldTicks` runs it cold until then (`setSlowdown`). */
function runOpen(stream: RequestSpec[], window: number, coldTicks = 0): Run {
  const engine = newEngine(stream)
  if (coldTicks > 0) engine.setSlowdown(BB_COLD_EVERY)
  const limit = window + BB_DRAIN_TICKS
  while (!engine.done && engine.tick < limit) {
    if (coldTicks > 0 && engine.tick >= coldTicks) engine.setSlowdown(null)
    engine.step()
  }
  return finish(engine, stream.length)
}

/**
 * `BB_ENGINE.maxRunning` (64) closed-loop clients, one per slot, with no think time: each sends its next request on the
 * tick after its last one finished, and stops sending once the window has passed. The lengths are the traffic's, drawn
 * in the order the clients ask.
 */
function runClosed(seed: number, c: BbCase): Run {
  const next = splitmix32u(seed ^ CLIENT_SALT)
  const engine = newEngine([])
  let sent = 0
  const send = () => {
    sent += 1
    engine.inject({ id: sent, arrival: engine.tick, prompt: inRange(next(), c.prompt), output: inRange(next(), c.output) })
  }
  let finished = 0
  engine.onFinish = () => {
    finished += 1
  }
  for (let i = 0; i < BB_ENGINE.maxRunning; i++) send()
  const limit = c.window + BB_DRAIN_TICKS
  while (!engine.done && engine.tick < limit) {
    const before = finished
    engine.step()
    if (engine.tick < c.window) for (let i = before; i < finished; i++) send()
  }
  return finish(engine, sent)
}

/** One point of the sweep: the benchmark as it was run (`BB_AS_RUN`) or the corrected run (`BB_CORRECTED`). */
export function bbPoint(seed: number, x: number): SweepPoint {
  const c = bbCase(seed)
  const real = bbTrace(seed)
  let run: Run
  if (x === BB_CORRECTED) run = runOpen(real, c.window)
  else if (c.flaw === 'closed-loop') run = runClosed(seed, c)
  else if (c.flaw === 'capped-output') run = runOpen(real.map((r) => ({ ...r, output: Math.min(r.output, c.cap as number) })), c.window)
  else if (c.flaw === 'warm-cache') run = runOpen(real.map((r) => ({ ...r, cachedPrefix: Math.floor((r.prompt * (c.hit as number)) / 100) })), c.window)
  else run = runOpen(real, c.window, c.cold)
  return {
    x,
    goodputRps: goodputRps(run.sloMet, c.window),
    ttftP95: run.ttftP95,
    metrics: { requests: run.requests, sloMet: run.sloMet, completed: run.completed, shed: run.shed, ttftP95Ms: run.ttftP95 * MS_PER_TICK },
  }
}

export const bbSweep = (seed: number): SweepResult => ({ points: BB_POINTS.map((x) => bbPoint(seed, x)) })

const at = (r: SweepResult, x: number): SweepPoint => r.points.find((p) => p.x === x) as SweepPoint

/** The p95 TTFT the benchmark should have reported, in milliseconds: the corrected run's. */
export const bbTruth = (r: SweepResult): number => at(r, BB_CORRECTED).ttftP95 * MS_PER_TICK

/** The p95 TTFT the benchmark did report, in milliseconds. */
export const bbReported = (r: SweepResult): number => at(r, BB_AS_RUN).ttftP95 * MS_PER_TICK

/** The seed is a fair question (see the file header). */
export function bbBand(r: SweepResult): boolean {
  if (r.points.length !== BB_POINTS.length) return false
  const run = at(r, BB_AS_RUN)
  const fix = at(r, BB_CORRECTED)
  for (const p of [run, fix]) if ((p.metrics?.['completed'] ?? 0) !== (p.metrics?.['requests'] ?? -1) || (p.metrics?.['shed'] ?? 1) !== 0) return false
  if ((fix.metrics?.['requests'] ?? 0) < BB_MIN_REQUESTS || fix.ttftP95 < BB_MIN_TICKS) return false
  const lo = Math.min(run.ttftP95, fix.ttftP95)
  const hi = Math.max(run.ttftP95, fix.ttftP95)
  return hi >= BB_MIN_RATIO * Math.max(lo, 1)
}

/** You pass within `BB_TOLERANCE` of the corrected run's p95 TTFT. */
export const bbPass = (prediction: number, r: SweepResult): boolean => Math.abs(prediction - bbTruth(r)) <= BB_TOLERANCE * bbTruth(r)

/**
 * What the learner reads before predicting: the traffic (prompt and output lengths, production's arrival rate) and what
 * the benchmark did differently, as its report states it. All inputs of the seed, a pure function of it, and never
 * either run's p95. Production's rate and the lengths give the engine's Little's-law capacity, and with it which kind of
 * correction this is.
 */
export function bbScene(seed: number): SceneFact[] {
  const c = bbCase(seed)
  const facts: SceneFact[] = [
    { label: 'Prompts', value: c.prompt.min, to: c.prompt.max, unit: 'tokens' },
    { label: 'Outputs', value: c.output.min, to: c.output.max, unit: 'tokens' },
    { label: 'Window', value: c.window * SIM_TICK_SECONDS, unit: 'seconds of arrivals' },
    { label: 'Production arrivals', value: goodputRps(bbTrace(seed).length, c.window), unit: 'requests per second, at random times over the window' },
  ]
  if (c.flaw === 'closed-loop') {
    facts.push({ label: 'The benchmark sent', value: BB_ENGINE.maxRunning, unit: 'closed-loop clients, each sending its next request the moment its last one finished' })
  } else if (c.flaw === 'capped-output') {
    facts.push({ label: 'The benchmark cut every reply at', value: c.cap as number, unit: 'tokens (max_tokens), on production\'s arrivals' })
  } else if (c.flaw === 'warm-cache') {
    facts.push({ label: 'The benchmark reused one prompt prefix, already cached for', value: c.hit as number, unit: '% of every prompt (production prompts are new), on production\'s arrivals' })
  } else {
    facts.push({
      label: 'The benchmark counted its first',
      value: c.cold as number,
      unit: `ticks, while the engine was cold and ran one tick in ${BB_COLD_EVERY} (production's engine is warm), on production's arrivals`,
    })
  }
  return facts
}

/**
 * The scene's reading, which a learner makes by hand: the flaw names the correction. Capacity is slots ÷ the mean hold
 * (⌈mean prompt ÷ 128⌉ + mean output ticks); the load is production's rate ÷ it. Under capacity almost nothing queues
 * and the p95 is the prefill of a 95th-percentile prompt, ⌈P95 ÷ 128⌉ − 1 ticks. Over it the queue grows all window, and
 * the p95 request waits (load − 1) × 95 % of the window, plus its prefill. In milliseconds.
 */
export function bbRead(scene: readonly SceneFact[]): number {
  const [prompts, outputs, window, rate] = scene as [SceneFact, SceneFact, SceneFact, SceneFact]
  const prompt = { min: prompts.value, max: prompts.to as number }
  const hold = bbHold({ prompt, output: { min: outputs.value, max: outputs.to as number } })
  const load = (rate.value * SIM_TICK_SECONDS) / (BB_ENGINE.maxRunning / hold)
  const p95 = prompt.min + 0.95 * (prompt.max - prompt.min)
  const prefill = Math.ceil(p95 / BB_ENGINE.prefillChunk) - 1
  return (prefill + bbQueue(load, window.value / SIM_TICK_SECONDS)) * MS_PER_TICK
}

/** The seed phone mode shows: the first in-band seed from 0 (tests/world/fleet-ex-more-a.test.ts re-derives it). */
export const BB_CANONICAL_SEED = 0

let canonical: SweepResult | undefined

export const brokenBenchExercise: FleetExerciseDef = {
  id: 'broken-bench',
  title: 'The broken benchmark',
  lessonId: 't7.l2',
  kcs: ['t7.benchmark-hygiene'],
  unit: 'the p95 time to first token (ms) the benchmark should have reported',
  points: BB_POINTS,
  range: { min: 1, max: 600000 },
  sweep: bbSweep,
  truth: bbTruth,
  band: bbBand,
  pass: bbPass,
  scene: bbScene,
  productionClaims: [],
  get phone() {
    return { seed: BB_CANONICAL_SEED, canonical: (canonical ??= bbSweep(BB_CANONICAL_SEED)) }
  },
}
