/**
 * The P:D split (docs/specs/wave-3.md §5.3; t6.l3, `t6.epd-phases`): eight equal workers divided into p prefill and
 * 8 − p decode workers on one EpdCluster, p = 1 … 7, on the same seeded long-prompt trace. You predict the p with the
 * highest goodput.
 *
 * THE MODEL (flat tick, v1, labelled). Every worker is the same Engine (PD_ENGINE): one tick advances every running
 * sequence by one prefill chunk or one decode token. A prefill worker frees a sequence the tick its prefill ends and its
 * KV goes on the wire at PD_TRANSFER_RATE tokens per tick; a decode worker takes the KV when it has the blocks, or the
 * transfer waits (the overrun the lesson names). TTFT is measured where the first token lands, on the decode worker, so
 * it pays the prefill queue, the prefill, the transfer and any wait for decode blocks. Interference is on, as the spec
 * asks, but no worker of a split both prefills and decodes, so it never bites: that is what the split buys. Few prefill
 * workers starve TTFT in the prefill queue; few decode workers fill the decode pools and stall the transfers. Goodput
 * peaks between them: `goodputRps`, SLO-met requests ÷ the trace's arrival window in seconds (the rate knee.ts reports).
 *
 * THE WORKLOAD (`pdWorkload`; synthetic). The seed draws it: prompts start at 1,536 + 256a tokens (a = 0 … 4) and span
 * 1,024, outputs start at 4 + 6b (b = 0 … 6) and span 24, so the best split moves with the seed. The trace
 * (`pdTrace`) offers `PD_LOAD` = 1.2 times the workload's Little's-law capacity (`pdCapacity`) at uniform times over the
 * window, so the best split is just past saturation and every other split is further past it. Every draw is a
 * splitmix32 output.
 *
 * THE BAND (`pdBand`): the best split is interior (2 … 6 prefill workers), its goodput is at least 10 % above the
 * 1:7 and 7:1 ends and at least 5 % above every other split, so the answer is not a coin flip. The pass rule is
 * exact: the prediction is that p. Acceptance is measured and printed by tests/world/fleet-ex.test.ts.
 */

import { splitmix32u } from '@/lib/rng'
import {
  Engine,
  EpdCluster,
  makeRefManager,
  makeRefQueue,
  makeRefScheduler,
  type EngineConfig,
  type RequestSpec,
} from '@/lib/fleet-model'
import type { FleetExerciseDef, SweepPoint, SweepResult } from './index'
import { goodputRps } from './knee'

/** Prefill workers; the other 8 − p decode. */
export const PD_POINTS = [1, 2, 3, 4, 5, 6, 7] as const
export const PD_WORKERS = 8

export const PD_WINDOW_TICKS = 400
/** Offered load as a multiple of the workload's estimated capacity at its best split (`pdCapacity`). */
export const PD_LOAD = 1.2

/** KV transfer rate in tokens per tick, as the EPD panel sets it. */
export const PD_TRANSFER_RATE = 256

/** Every worker's engine: 12 running sequences, 1,024 blocks of 16 tokens, TTFT SLO 80 ticks, ITL SLO 2 ticks per token. */
export const PD_ENGINE: EngineConfig = {
  numBlocks: 1024,
  blockSize: 16,
  maxRunning: 12,
  sloTtft: 80,
  prefillChunk: 128,
  interference: true,
  sloItl: 2,
}

export const PD_MARGIN = 1.1
export const PD_RUNNER_UP_MARGIN = 1.05

/** Ticks past the window the run may take before it is cut off (it never is on a banded seed). */
const PD_DRAIN_TICKS = 20000

/** The workload a seed draws: prompt and output ranges in tokens (1,024 and 24 wide). */
export interface PdWorkload {
  prompt: { min: number; max: number }
  output: { min: number; max: number }
}

const inRange = (u: number, r: { min: number; max: number }) => r.min + (u % (r.max - r.min + 1))

/** The seed's workload: the prompt starts at 1,536 + 256a (a = 0 … 4), the output at 4 + 6b (b = 0 … 6). */
export function pdWorkload(seed: number): PdWorkload {
  const next = splitmix32u(seed ^ 0x9d5)
  const pmin = 1536 + 256 * (next() % 5)
  const omin = 4 + 6 * (next() % 7)
  return { prompt: { min: pmin, max: pmin + 1023 }, output: { min: omin, max: omin + 23 } }
}

/** Tokens of KV one worker holds. */
const WORKER_TOKENS = PD_ENGINE.numBlocks * PD_ENGINE.blockSize
/** Decode headroom per sequence, in tokens (the Engine's admission rule). */
const HEADROOM = 48

/**
 * Requests per tick a split of `prefill` prefill workers and 8 − `prefill` decode workers can finish, from Little's
 * law on the workload's mean request. A prefill worker keeps Np = min(running slots, ⌊KV ÷ (prompt + headroom)⌋) prompts
 * in prefill, each for ⌈prompt ÷ chunk⌉ ticks, so it finishes Cp = Np ÷ ⌈prompt ÷ chunk⌉ per tick; a decode worker keeps
 * Nd = min(slots, ⌊KV ÷ (prompt + output ÷ 2 + headroom)⌋) sequences, each for `output` ticks, so Cd = Nd ÷ output. The
 * pipeline moves min(p·Cp, (8 − p)·Cd): the slower side sets the rate.
 */
export function pdPipelineRate(w: PdWorkload, prefill: number): number {
  const prompt = (w.prompt.min + w.prompt.max) / 2
  const output = (w.output.min + w.output.max) / 2
  const cp = Math.min(PD_ENGINE.maxRunning, Math.floor(WORKER_TOKENS / (prompt + HEADROOM))) / Math.ceil(prompt / PD_ENGINE.prefillChunk)
  const cd = Math.min(PD_ENGINE.maxRunning, Math.floor(WORKER_TOKENS / (prompt + output / 2 + HEADROOM))) / output
  return Math.min(prefill * cp, (PD_WORKERS - prefill) * cd)
}

/**
 * The split the back-of-envelope picks: the p that maximises `pdPipelineRate` (the lower p on a tie). It names the
 * sweep's best split on 71 of 77 banded seeds in 0 … 79 and is within one of it on all 77 (tests/world/fleet-ex.test.ts).
 */
export const pdEstimateSplit = (w: PdWorkload): number =>
  PD_POINTS.reduce((best, p) => (pdPipelineRate(w, p) > pdPipelineRate(w, best) ? p : best), PD_POINTS[0])

/** Requests per tick the best split can finish; the trace offers `PD_LOAD` times this. */
export const pdCapacity = (w: PdWorkload): number => pdPipelineRate(w, pdEstimateSplit(w))

/** The trace for this seed, sorted by arrival: PD_LOAD × the estimated capacity, over the window. */
export function pdTrace(seed: number): RequestSpec[] {
  const w = pdWorkload(seed)
  const count = Math.round(PD_LOAD * pdCapacity(w) * PD_WINDOW_TICKS)
  const next = splitmix32u(seed)
  const out: RequestSpec[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      id: i + 1,
      arrival: next() % PD_WINDOW_TICKS,
      prompt: inRange(next(), w.prompt),
      output: inRange(next(), w.output),
    })
  }
  return out.sort((a, b) => a.arrival - b.arrival || a.id - b.id)
}

/** One point: `prefill` workers prefill, the rest decode, on this seed's trace. */
export function pdPoint(seed: number, prefill: number): SweepPoint {
  const stream = pdTrace(seed)
  const intake = () => ({ intake: makeRefQueue(32), drainPerTick: 6 })
  const make = (cfg: EngineConfig) => new Engine(cfg, [], makeRefScheduler(), makeRefManager(cfg.numBlocks, cfg.blockSize), intake())
  const pCfg: EngineConfig = { ...PD_ENGINE, prefillOnly: true }
  const prefillers = Array.from({ length: prefill }, () => make(pCfg))
  const decoders = Array.from({ length: PD_WORKERS - prefill }, () => make(PD_ENGINE))
  const cluster = new EpdCluster(stream, prefillers, decoders, { prefillCfg: pCfg, decodeCfg: PD_ENGINE, transferRate: PD_TRANSFER_RATE })
  const limit = PD_WINDOW_TICKS + PD_DRAIN_TICKS
  while (!cluster.done && cluster.tick < limit) cluster.step()
  const a = cluster.aggregate()
  return {
    x: prefill,
    goodputRps: goodputRps(a.sloMet, PD_WINDOW_TICKS),
    ttftP95: a.ttftP95,
    tpotP95: a.tpotP95,
    metrics: { requests: stream.length, sloMet: a.sloMet, completed: a.completed, shed: a.shed, transferDelay: a.avgDelay },
  }
}

export const pdSweep = (seed: number): SweepResult => ({ points: PD_POINTS.map((p) => pdPoint(seed, p)) })

/** The index of the highest goodput; the lower prefill count wins a tie. */
const bestIndex = (r: SweepResult): number => r.points.reduce((best, p, i) => (p.goodputRps > r.points[best].goodputRps ? i : best), 0)

/** The number of prefill workers with the highest goodput. */
export const pdTruth = (r: SweepResult): number => r.points[bestIndex(r)].x

/** The seed is a fair question (see the file header). */
export function pdBand(r: SweepResult): boolean {
  const i = bestIndex(r)
  const last = r.points.length - 1
  if (i === 0 || i === last) return false
  const g = r.points.map((p) => p.goodputRps)
  const runnerUp = Math.max(...g.filter((_, j) => j !== i))
  return g[i] >= PD_MARGIN * g[0] && g[i] >= PD_MARGIN * g[last] && g[i] >= PD_RUNNER_UP_MARGIN * runnerUp
}

/** You pass when you name the prefill-worker count with the highest goodput. */
export const pdPass = (prediction: number, r: SweepResult): boolean => prediction === pdTruth(r)

/** The seed phone mode shows: the first in-band seed from 0 (tests/world/fleet-ex.test.ts re-derives it). */
export const PD_CANONICAL_SEED = 1

let canonical: SweepResult | undefined

export const pdSplitExercise: FleetExerciseDef = {
  id: 'pd-split',
  title: 'Split the fleet',
  lessonId: 't6.l3',
  kcs: ['t6.epd-phases'],
  unit: 'the number of prefill workers (of 8) with the highest goodput',
  points: PD_POINTS,
  sweep: pdSweep,
  truth: pdTruth,
  band: pdBand,
  pass: pdPass,
  productionClaims: ['production.vllm.disagg', 'production.sglang.disagg'],
  get phone() {
    return { canonical: (canonical ??= pdSweep(PD_CANONICAL_SEED)) }
  },
}
