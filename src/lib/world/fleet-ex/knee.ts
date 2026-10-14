/**
 * The load knee (docs/specs/wave-3.md §5.3; t7.l2, `t7.goodput-curve`): one Engine, one seeded trace shaped like the
 * committed BurstGPT hour, replayed at six load multipliers. Goodput (SLO-met requests per second of the trace's
 * arrival window) climbs while the engine keeps up and falls once the queue grows past the TTFT SLO: you predict the
 * multiplier where it peaks.
 *
 * THE TRACE (`kneeTrace`; synthetic, labelled). Lengths are drawn from the quantiles of
 * public/traces/burstgpt-v2-busiest-hour.json (prompt: median 90, p90 358, p95 1,107; output: median 3, p90 37, p99 189),
 * linearly between knots, then clamped to 1,024 prompt and 128 output tokens so one request never fills the 4,096-token
 * pool. Arrivals clump: each gap is 5·g·u⁴ for u uniform in [0, 1), mean g = 2.6 ticks and coefficient of variation
 * 1.33 (the committed hour is index-sampled, so its own gaps are even, CV 0.33, and say nothing about bursts). Every
 * draw is a splitmix32 output and every step is +, − or ×, so a seed gives one trace in every browser (no Math.log, no
 * trig). tests/world/fleet-ex.test.ts re-reads the artifact and re-measures each of these numbers.
 *
 * THE SWEEP. The arrival window is fixed at 800 ticks (40 s). At multiplier m the base process runs m times faster and
 * is cut at the window, so the same requests arrive in the same order and the offered rate is m times the base: a
 * longer window would not do, because a trace compressed into a shorter one has a shorter denominator and its goodput
 * would rise again under overload. The engine is the burstgpt profile (src/lib/traces.ts: 256 blocks of 16, 8 running,
 * TTFT SLO 40 ticks, prefill chunk 128, intake 32, drain 8) with the reference block manager, the reference intake
 * queue and a first-come-first-served scheduler: the reference scheduler admits the shortest prompt first, which keeps
 * goodput climbing under overload and hides the knee (the test re-measures that). A point's goodput is `goodputRps`:
 * requests that met the SLO, wherever they finish, ÷ 40 s, never `Engine.goodput()`'s percentage.
 *
 * THE KNEE. Little's law bounds the rate: `maxRunning` slots, each held about ⌈prompt ÷ chunk⌉ + output ticks per request,
 * finish at most `kneeCapacityRps` per second. The offered rate at the measured peak is 0.76 … 1.07 of it (median 0.95)
 * on the banded seeds tested, because bursts queue before the mean rate reaches the bound.
 *
 * THE BAND (`kneeBand`): the peak is interior (not 0.5 or 2), at least 10 % above both ends (so there is a rise to find
 * and a collapse to fear) and at least 5 % above the best other point (so the answer is not a coin flip between
 * neighbours). The pass rule is exact: the prediction is the peak's multiplier. Acceptance is measured and printed by
 * tests/world/fleet-ex.test.ts.
 */

import { splitmix32u } from '@/lib/rng'
import {
  Engine,
  HEADROOM_TOKENS,
  makeRefManager,
  makeRefQueue,
  SIM_TICK_SECONDS,
  type EngineConfig,
  type RequestSpec,
  type SchedAction,
  type SchedulerDriver,
  type SchedView,
} from '@/lib/fleet-model'
import { getFleetTrafficProfile } from '@/lib/traces'
import type { FleetExerciseDef, SweepPoint, SweepResult } from './index'

/** The load multipliers, in order. */
export const KNEE_POINTS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

/** The arrival window in ticks (40 s at 50 ms per tick) and the mean gap between requests at multiplier 1. */
export const KNEE_WINDOW_TICKS = 800
export const KNEE_MEAN_GAP = 2.6

/** How far above both ends the peak must stand, and above the best other point, as ratios. */
export const KNEE_PEAK_MARGIN = 1.1
export const KNEE_RUNNER_UP_MARGIN = 1.05

/** Largest prompt and output the trace draws (the committed hour's p95 prompt is 1,107), so one request never fills the 4,096-token pool. */
const MAX_PROMPT = 1024
const MAX_OUTPUT = 128

/** Quantile knots [u, tokens] of the committed BurstGPT hour; tests/world/fleet-ex.test.ts re-reads the trace and checks them. */
const PROMPT_KNOTS: readonly (readonly [number, number])[] = [
  [0, 8], [0.1, 62], [0.25, 66], [0.5, 90], [0.75, 178], [0.9, 358], [0.95, 1107], [0.99, 3046], [1, 4096],
]
const OUTPUT_KNOTS: readonly (readonly [number, number])[] = [
  [0, 1], [0.1, 3], [0.25, 3], [0.5, 3], [0.75, 6], [0.9, 37], [0.95, 67], [0.99, 189], [1, 256],
]

const UNIT = 4294967296

/** The value at u on the piecewise-linear curve through the knots. */
function quantile(knots: readonly (readonly [number, number])[], u: number): number {
  for (let i = 1; i < knots.length; i++) {
    const [u1, v1] = knots[i]
    if (u <= u1) {
      const [u0, v0] = knots[i - 1]
      return v0 + ((v1 - v0) * (u - u0)) / (u1 - u0)
    }
  }
  return knots[knots.length - 1][1]
}

/**
 * The base process for this seed: arrival ticks (fractional, ascending, at multiplier 1) and lengths, drawn until the
 * arrivals pass twice the window, which is as far as the largest multiplier (2) reads.
 */
export function kneeProcess(seed: number): { at: number[]; prompt: number[]; output: number[] } {
  const next = splitmix32u(seed)
  const unit = () => next() / UNIT
  const at: number[] = []
  const prompt: number[] = []
  const output: number[] = []
  let t = 0
  for (;;) {
    const u = unit()
    t += 5 * KNEE_MEAN_GAP * u * u * u * u
    if (t >= 2 * KNEE_WINDOW_TICKS) break
    at.push(t)
    prompt.push(Math.min(MAX_PROMPT, Math.round(quantile(PROMPT_KNOTS, unit()))))
    output.push(Math.min(MAX_OUTPUT, Math.round(quantile(OUTPUT_KNOTS, unit()))))
  }
  return { at, prompt, output }
}

/**
 * The trace for this seed at load multiplier `load`: the base process sped up by `load` and cut at the window, so the
 * window stays 800 ticks and the offered rate is `load` times the base. Same requests, same order, at every multiplier.
 */
export function kneeTrace(seed: number, load = 1): RequestSpec[] {
  const { at, prompt, output } = kneeProcess(seed)
  const out: RequestSpec[] = []
  for (let i = 0; i < at.length && at[i] / load < KNEE_WINDOW_TICKS; i++) {
    out.push({ id: i + 1, arrival: Math.floor(at[i] / load), prompt: prompt[i], output: output[i] })
  }
  return out
}

/** SLO-met requests per second of the arrival window (50 ms per tick). The one rate every Fleet exercise reports. */
export const goodputRps = (sloMet: number, windowTicks: number): number => sloMet / (windowTicks * SIM_TICK_SECONDS)

/** First come, first served: admit the oldest waiting request while a slot and its prompt plus headroom fit. */
export function fifoScheduler(v: SchedView): SchedAction {
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

const FIFO: SchedulerDriver = { name: 'fifo', schedule: fifoScheduler }

/** Ticks past the last arrival the run may take before it is cut off (it never is on a banded seed). */
const DRAIN_TICKS = 20000

/**
 * Requests per second the engine can finish, from Little's law on the trace's mean request: `maxRunning` slots, each
 * held for about ⌈prompt ÷ chunk⌉ prefill ticks plus `output` decode ticks. Goodput peaks a little below this
 * (bursts queue before the mean rate reaches it); tests/world/fleet-ex.test.ts measures how far below.
 */
export function kneeCapacityRps(stream: readonly RequestSpec[], cfg: EngineConfig): number {
  const held = stream.reduce((a, r) => a + Math.ceil(r.prompt / cfg.prefillChunk) + r.output, 0) / stream.length
  return cfg.maxRunning / held / SIM_TICK_SECONDS
}

/** One point: the trace at `load` through the burstgpt profile's engine, scheduled by `scheduler` (first come, first served unless a test says otherwise). */
export function kneePoint(seed: number, load: number, scheduler: SchedulerDriver = FIFO): SweepPoint {
  const profile = getFleetTrafficProfile('burstgpt')
  const cfg: EngineConfig = profile.config
  const stream = kneeTrace(seed, load)
  const engine = new Engine(cfg, stream, scheduler, makeRefManager(cfg.numBlocks, cfg.blockSize), {
    intake: makeRefQueue(profile.intakeCap),
    drainPerTick: profile.drainPerTick,
  })
  const limit = KNEE_WINDOW_TICKS + DRAIN_TICKS
  while (!engine.done && engine.tick < limit) engine.step()
  const s = engine.stats()
  return {
    x: load,
    goodputRps: goodputRps(s.sloMet, KNEE_WINDOW_TICKS),
    ttftP95: engine.ttftP95(),
    metrics: {
      requests: stream.length,
      offeredRps: goodputRps(stream.length, KNEE_WINDOW_TICKS),
      capacityRps: kneeCapacityRps(stream, cfg),
      sloMet: s.sloMet,
      completed: s.completed,
      shed: s.shed,
    },
  }
}

export const kneeSweep = (seed: number): SweepResult => ({ points: KNEE_POINTS.map((load) => kneePoint(seed, load)) })

/** The index of the highest goodput; the lower multiplier wins a tie. */
const peakIndex = (r: SweepResult): number => r.points.reduce((best, p, i) => (p.goodputRps > r.points[best].goodputRps ? i : best), 0)

/** The multiplier where goodput peaks. */
export const kneeTruth = (r: SweepResult): number => r.points[peakIndex(r)].x

/**
 * The seed is a fair question: the peak is interior and at least 10 % above both ends (0.5 and 2), and the best
 * other point is at least 5 % lower, so the answer is not a coin flip between neighbours.
 */
export function kneeBand(r: SweepResult): boolean {
  const i = peakIndex(r)
  const last = r.points.length - 1
  if (i === 0 || i === last) return false
  const g = r.points.map((p) => p.goodputRps)
  const runnerUp = Math.max(...g.filter((_, j) => j !== i))
  return g[i] >= KNEE_PEAK_MARGIN * g[0] && g[i] >= KNEE_PEAK_MARGIN * g[last] && g[i] >= KNEE_RUNNER_UP_MARGIN * runnerUp
}

/** You pass when you name the multiplier where goodput peaks: exactly one of the six. */
export const kneePass = (prediction: number, r: SweepResult): boolean => prediction === kneeTruth(r)

/** The seed phone mode shows: the first in-band seed from 0 (tests/world/fleet-ex.test.ts re-derives it). */
export const KNEE_CANONICAL_SEED = 0

let canonical: SweepResult | undefined

export const kneeExercise: FleetExerciseDef = {
  id: 'knee',
  title: 'Find the knee',
  lessonId: 't7.l2',
  kcs: ['t7.goodput-curve', 't7.benchmark-hygiene'],
  unit: 'the load multiplier where goodput peaks',
  points: KNEE_POINTS,
  sweep: kneeSweep,
  truth: kneeTruth,
  band: kneeBand,
  pass: kneePass,
  productionClaims: ['production.vllm.max-num-seqs', 'production.sglang.max-running-requests'],
  get phone() {
    return { canonical: (canonical ??= kneeSweep(KNEE_CANONICAL_SEED)) }
  },
}
