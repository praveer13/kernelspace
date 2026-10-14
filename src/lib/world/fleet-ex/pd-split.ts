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
 * peaks between them: `goodputRps` (rate.ts), SLO-met requests ÷ the trace's arrival window in seconds.
 *
 * THE WORKLOAD (`pdWorkload`; synthetic). The seed draws it from a grid: prompts start at 1,536 + 256a tokens
 * (a = 0 … 4) and span 1,024, outputs start at 4 + 6b (b = 0 … 6) and span 24, so the best split moves with the seed.
 * It first draws the split the back-of-envelope (`pdEstimateSplit`) names, each of the four the grid can name (2 … 5)
 * equally often, then one of the grid's workloads that names it: drawn cell by cell, 19 of the 35 cells name 3 and
 * 3 was the right answer on half the banded seeds, so naming it every time passed without reading the scene. The
 * learner reads the workload (`pdScene`) before predicting. The trace
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
import type { FleetExerciseDef, SceneFact, SweepPoint, SweepResult } from './index'
import { goodputRps } from './rate'

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

/** The grid's workload at (a, b): prompts from 1,536 + 256a (a = 0 … 4), outputs from 4 + 6b (b = 0 … 6). */
const cell = (a: number, b: number): PdWorkload => {
  const pmin = 1536 + 256 * a
  const omin = 4 + 6 * b
  return { prompt: { min: pmin, max: pmin + 1023 }, output: { min: omin, max: omin + 23 } }
}

let byEstimate: readonly (readonly PdWorkload[])[] | undefined

/** The grid's 35 workloads grouped by the split the back-of-envelope names for them, in ascending order of that split. */
export function pdWorkloadsBySplit(): readonly (readonly PdWorkload[])[] {
  if (byEstimate) return byEstimate
  const groups = new Map<number, PdWorkload[]>()
  for (let a = 0; a < 5; a++) {
    for (let b = 0; b < 7; b++) {
      const w = cell(a, b)
      const p = pdEstimateSplit(w)
      groups.set(p, [...(groups.get(p) ?? []), w])
    }
  }
  return (byEstimate = [...groups].sort((x, y) => x[0] - y[0]).map(([, ws]) => ws))
}

/**
 * The seed's workload. It first draws which split the back-of-envelope names (each split the grid can name, 2 … 5,
 * equally often), then a workload of the grid that names it, so no one answer is right on more than about a third of
 * banded seeds (tests/fleet-ex/done-rule.test.ts). A copy, so a caller cannot change the grid.
 */
export function pdWorkload(seed: number): PdWorkload {
  const next = splitmix32u(seed ^ 0x9d5)
  const groups = pdWorkloadsBySplit()
  const group = groups[next() % groups.length]
  const w = group[next() % group.length]
  return { prompt: { ...w.prompt }, output: { ...w.output } }
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
 * sweep's best split on 79 of 80 banded seeds in 0 … 79 and is within one of it on all 80 (tests/world/fleet-ex.test.ts).
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

/**
 * What the learner reads before predicting: the seed's prompt and output lengths. A prompt holds a prefill slot for
 * ⌈prompt ÷ 128⌉ ticks and an output a decode slot for one tick per token, so the split that gives each stage its
 * share of the work follows from them. Inputs only, a pure function of the seed.
 */
export function pdScene(seed: number): SceneFact[] {
  const w = pdWorkload(seed)
  return [
    { label: 'Prompts', value: w.prompt.min, to: w.prompt.max, unit: 'tokens' },
    { label: 'Outputs', value: w.output.min, to: w.output.max, unit: 'tokens' },
  ]
}

/** The seed phone mode shows: the first in-band seed from 0 (tests/world/fleet-ex.test.ts re-derives it). */
export const PD_CANONICAL_SEED = 0

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
  scene: pdScene,
  productionClaims: ['production.vllm.disagg', 'production.sglang.disagg'],
  get phone() {
    return { seed: PD_CANONICAL_SEED, canonical: (canonical ??= pdSweep(PD_CANONICAL_SEED)) }
  },
}
