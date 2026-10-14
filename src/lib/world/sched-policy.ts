/**
 * Compose for the scheduler play (docs/specs/wave-2.md §8.4): four dials compile to a Fleet
 * `SchedulerDriver` and run on the same minutes as the play.
 *
 * Dials:
 *   order     fcfs (arrival order) or sjf (shortest prompt first, ties by arrival);
 *   guard     0 (none), 20 or 2,000 iterations: a request that has waited longer goes first, FIFO;
 *   headroom  0, 16, 48 or 128 tokens reserved per request for decode growth;
 *   preempt   none, or newest: when the next decode step would run the pool dry, preempt the newest
 *             running requests (latest arrival first) until it would not, and admit nothing that
 *             iteration. The Engine's own answer to a dry pool is an auto-preempt of whichever request's
 *             append fails; this dial chooses the victim instead, as vLLM does by priority.
 *
 * `REFERENCE_SCHED_SPEC` = {sjf, 2000, 48, none} is `referenceScheduler` (fleet-model.ts): its
 * comparator, its guard test (`iter − arrival > guard`) and its admission loop are reproduced
 * exactly, so the compiled driver returns the same `SchedAction`, admit order included, at every
 * iteration (tests/world/sched-policy.test.ts: the practice minute, 1,000 banded minutes and 100
 * Fleet Week traces). The guard dial offers 20 because 2,000 never fires inside a minute.
 */

import { Engine, makeRefManager, referenceScheduler, type SchedAction, type SchedulerDriver, type SchedView } from '@/lib/fleet-model'
import type { PlayData, PlayResult, SchedSpecData } from '@/lib/ledger/types'
import { SCHEDULER_PLAY_ID } from './sched'
import { RUN_GUARD, SCHED_CFG, type SchedTrace } from './sched-traces'
import type { SchedPolicySpec } from './types'

/** The dial values the Compose panel offers. */
export const SCHED_DIALS = {
  order: ['fcfs', 'sjf'] as const,
  guard: [0, 20, 2000] as const,
  headroom: [0, 16, 48, 128] as const,
  preempt: ['none', 'newest'] as const,
}

/** The spec that reproduces the ghost. */
export const REFERENCE_SCHED_SPEC: SchedPolicySpec = { order: 'sjf', guard: 2000, headroom: 48, preempt: 'none' }

/** Why a spec is not one of the dial settings (empty = fine): ledger rows and URLs are untrusted. */
export function schedSpecProblems(spec: SchedPolicySpec): string[] {
  const out: string[] = []
  if (!SCHED_DIALS.order.includes(spec.order)) out.push(`order ${String(spec.order)} is not fcfs or sjf`)
  if (!SCHED_DIALS.guard.includes(spec.guard)) out.push(`guard ${String(spec.guard)} is not 0, 20 or 2000`)
  if (!SCHED_DIALS.headroom.includes(spec.headroom)) out.push(`headroom ${String(spec.headroom)} is not 0, 16, 48 or 128`)
  if (!SCHED_DIALS.preempt.includes(spec.preempt)) out.push(`preempt ${String(spec.preempt)} is not none or newest`)
  return out
}

type Waiting = SchedView['waiting'][number]
type Running = SchedView['running'][number]

/** The waiting list in the order the spec admits it: aged requests first (FIFO), then by the order dial. */
function admissionOrder(spec: SchedPolicySpec, v: SchedView): Waiting[] {
  const aged = (r: Waiting) => spec.guard > 0 && v.iter - r.arrival > spec.guard
  return [...v.waiting].sort((a, b) => {
    const aa = aged(a)
    const ab = aged(b)
    if (aa !== ab) return aa ? -1 : 1
    if (aa && ab) return a.arrival - b.arrival
    return spec.order === 'sjf' ? a.prompt - b.prompt || a.arrival - b.arrival : a.arrival - b.arrival
  })
}

/** Tokens a running request holds: its prompt and every decoded token after the first (the first comes with prefill). */
const held = (r: Running) => r.prompt + Math.max(0, r.decoded - 1)

/** The newest running requests to preempt so that every decoding request can append its next token. */
function pressureVictims(v: SchedView, blockSize: number): number[] {
  let free = (v.memCap - v.memUsed) / blockSize
  const decoding = (r: Running) => r.prefillLeft === 0
  const needs = (r: Running) => (decoding(r) && held(r) % blockSize === 0 ? 1 : 0)
  let need = v.running.reduce((a, r) => a + needs(r), 0)
  const victims: number[] = []
  const newest = [...v.running].sort((a, b) => b.arrival - a.arrival || b.id - a.id)
  for (const r of newest) {
    if (need <= free || victims.length >= v.running.length - 1) break
    victims.push(r.id)
    free += Math.ceil(held(r) / blockSize)
    need -= needs(r)
  }
  return victims
}

/** Compiles the four dials into a stateless driver. `blockSize` is the pool's, for the preempt dial. */
export function compileSchedPolicy(spec: SchedPolicySpec, blockSize = SCHED_CFG.blockSize): SchedulerDriver {
  const problems = schedSpecProblems(spec)
  if (problems.length) throw new Error(problems.join('; '))
  const name = `${spec.order}/guard ${spec.guard}/headroom ${spec.headroom}/preempt ${spec.preempt}`
  return {
    name,
    schedule(v: SchedView): SchedAction {
      if (spec.preempt === 'newest') {
        const preempt = pressureVictims(v, blockSize)
        if (preempt.length) return { admit: [], preempt }
      }
      let used = v.running.reduce((a, r) => a + r.prompt + r.decoded + spec.headroom, 0)
      let slots = v.maxRunning - v.running.length
      const admit: number[] = []
      for (const r of admissionOrder(spec, v)) {
        if (slots === 0) break
        const cost = r.prompt + spec.headroom
        if (used + cost > v.memCap) continue
        admit.push(r.id)
        slots -= 1
        used += cost
      }
      return { admit, preempt: [] }
    },
  }
}

/** One run of a driver over a trace on a fresh Engine: Compose's row. */
export interface SchedSpecRun {
  /** Requests within the TTFT SLO. */
  met: number
  total: number
  /** met / total, per mille (the UI formats it as a percentage). */
  goodputPermille: number
  /** TTFT p95 over completed requests, in iterations. */
  ttftP95: number
  autoPreempts: number
  completed: number
  finished: boolean
}

/** Runs a driver over a trace (the trace is not changed). */
export function runSchedDriver(trace: SchedTrace, driver: SchedulerDriver): SchedSpecRun {
  const e = new Engine(trace.cfg, trace.requests.map((r) => ({ ...r })), driver, makeRefManager(trace.cfg.numBlocks, trace.cfg.blockSize))
  while (!e.done && e.tick < RUN_GUARD) e.step()
  const s = e.stats()
  const total = trace.requests.length
  return {
    met: s.sloMet,
    total,
    goodputPermille: total ? Math.round((s.sloMet * 1000) / total) : 0,
    ttftP95: e.ttftP95(),
    autoPreempts: s.autoPreempts,
    completed: s.completed,
    finished: e.done,
  }
}

export const runSchedSpec = (spec: SchedPolicySpec, trace: SchedTrace) => runSchedDriver(trace, compileSchedPolicy(spec, trace.cfg.blockSize))
export const runSchedGhost = (trace: SchedTrace) => runSchedDriver(trace, { name: 'reference', schedule: referenceScheduler })

const sameAction = (a: SchedAction, b: SchedAction) =>
  a.admit.length === b.admit.length && a.admit.every((x, i) => x === b.admit[i]) && a.preempt.length === b.preempt.length && a.preempt.every((x, i) => x === b.preempt[i])

/**
 * Iterations where `driver` and `referenceScheduler`, shown the same view, return different actions,
 * on the reference's own run of `trace` (they share every view until the first difference). Empty =
 * the driver is the reference on this trace.
 */
export function referenceMismatches(trace: SchedTrace, driver: SchedulerDriver, limit = 1): number[] {
  const out: number[] = []
  const lockstep: SchedulerDriver = {
    name: 'lockstep',
    schedule(v) {
      const ref = referenceScheduler(v)
      if (out.length < limit && !sameAction(driver.schedule(v), ref)) out.push(v.iter)
      return ref
    },
  }
  runSchedDriver(trace, lockstep)
  return out
}

/** True when the spec returns the reference's action at every iteration of every trace (the ledger's `data.equivalent`). */
export function schedEquivalent(spec: SchedPolicySpec, traces: readonly SchedTrace[]): boolean {
  return traces.every((t) => referenceMismatches(t, compileSchedPolicy(spec, t.cfg.blockSize)).length === 0)
}

/** One row of Compose's table (wave-2 §8.4). */
export interface SchedComposeRow extends SchedSpecRun {
  label: string
  seed: number | null
}

/** The table: the spec and the ghost on each trace (the practice minute, then the fresh ones). */
export function schedComposeTable(spec: SchedPolicySpec, traces: readonly SchedTrace[]): { mine: SchedComposeRow[]; ghost: SchedComposeRow[] } {
  return {
    mine: traces.map((t) => ({ label: 'your spec', seed: t.seed, ...runSchedSpec(spec, t) })),
    ghost: traces.map((t) => ({ label: 'reference', seed: t.seed, ...runSchedGhost(t) })),
  }
}

/** Compose's `ok` (wave-2 §8.4): the spec is equivalent, or meets at least the ghost's count on every trace. */
export function schedComposeOk(spec: SchedPolicySpec, traces: readonly SchedTrace[]): { ok: boolean; equivalent: boolean } {
  const equivalent = schedEquivalent(spec, traces)
  return { ok: equivalent || traces.every((t) => runSchedSpec(spec, t).met >= runSchedGhost(t).met), equivalent }
}

/** The ledger's form of a spec. */
export const schedSpecData = (spec: SchedPolicySpec): SchedSpecData => ({ order: spec.order, guard: spec.guard, headroom: spec.headroom, preempt: spec.preempt })

/** The ledger result for one Compose run (wave-2 §8.4): score = min(1, met / ghost's met), summed over the traces. */
export function schedComposeResult(
  spec: SchedPolicySpec,
  outcome: { ok: boolean; equivalent: boolean; survived: number; ghostSurvived: number; tries: number },
  opts: { seed: number; provenance: PlayResult['provenance']; kcs?: string[]; ms?: number },
): PlayResult {
  const data: PlayData = {
    phase: 'compose',
    turns: outcome.tries,
    survived: outcome.survived,
    ghostSurvived: outcome.ghostSurvived,
    spec: schedSpecData(spec),
    equivalent: outcome.equivalent,
  }
  if (opts.kcs) data.kcs = opts.kcs
  const score = outcome.ghostSurvived === 0 ? 1 : Math.min(1, outcome.survived / outcome.ghostSurvived)
  const out: PlayResult = { playId: SCHEDULER_PLAY_ID, score, ok: outcome.ok, seed: opts.seed, provenance: opts.provenance, data }
  if (opts.ms !== undefined) out.ms = opts.ms
  return out
}
