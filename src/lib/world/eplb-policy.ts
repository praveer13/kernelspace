/**
 * Compose for the EPLB play (docs/specs/wave-3.md §5.2): two dials compile to a lockstep decider that plays the same
 * 24 turns as the learner.
 *
 * Dials:
 *   replicate  none (no copy on any replicate turn: 16 copies, 4 slots stay empty), per-copy (copy the expert with
 *              the most load per copy), or total (copy the expert with the most total load, which keeps copying the
 *              hottest one);
 *   place      round-robin (the k-th copy offered goes to GPU k mod 4, or the next GPU after it with a free slot) or
 *              least-loaded (the least-loaded GPU with a free slot).
 * Ties go to the lower expert or GPU number.
 *
 * `REFERENCE_EPLB_SPEC` = {per-copy, least-loaded} is DeepSeek EPLB, the ghost (eplb.ts). The compiled decider is
 * written here on its own, by comparator, so the equivalence test means something: it returns the ghost's decision at
 * every turn of the ghost's run (tests/world/eplb-policy.test.ts: the practice load and 1,000 banded loads).
 * {none, round-robin} is band rule 2's round robin without replicas (`roundRobinUnits`), also tested.
 */

import type { EplbSpecData, PlayData, PlayResult } from '@/lib/ledger/types'
import { EPLB_GHOST, EPLB_OPS, EPLB_PLAY_ID, GPUS, checkEplbBand, eplbModel, eplbPasses, imbalanceOf, makeLoads, runEplb, type EplbDecision, type EplbReq, type EplbView } from './eplb'
import type { Decider } from './play'

export type EplbPolicySpec = EplbSpecData

/** The dial values the Compose panel offers. */
export const EPLB_DIALS = {
  replicate: ['none', 'per-copy', 'total'] as const,
  place: ['round-robin', 'least-loaded'] as const,
}

/** The spec that reproduces the ghost. */
export const REFERENCE_EPLB_SPEC: EplbPolicySpec = { replicate: 'per-copy', place: 'least-loaded' }

/** Why a spec is not one of the dial settings (empty = fine): ledger rows and URLs are untrusted. */
export function eplbSpecProblems(spec: EplbPolicySpec): string[] {
  const out: string[] = []
  if (!EPLB_DIALS.replicate.includes(spec.replicate)) out.push(`replicate ${String(spec.replicate)} is not none, per-copy or total`)
  if (!EPLB_DIALS.place.includes(spec.place)) out.push(`place ${String(spec.place)} is not round-robin or least-loaded`)
  return out
}

/** The index whose key is largest (or smallest), ties to the lower index, over the indices `ok` admits; -1 if none. */
function pick(n: number, key: (i: number) => number, better: (a: number, b: number) => boolean, ok: (i: number) => boolean = () => true): number {
  let best = -1
  for (let i = 0; i < n; i++) if (ok(i) && (best < 0 || better(key(i), key(best)))) best = i
  return best
}

const more = (a: number, b: number) => a > b
const less = (a: number, b: number) => a < b

/** Compiles the two dials into a stateless decider: every choice is read from the view. */
export function compileEplbPolicy(spec: EplbPolicySpec): Decider<EplbView, EplbReq, EplbDecision> {
  const problems = eplbSpecProblems(spec)
  if (problems.length) throw new Error(problems.join('; '))
  return {
    name: `${spec.replicate}/${spec.place}`,
    decide(v, req): EplbDecision {
      if (req.kind === 'replicate') {
        if (spec.replicate === 'none') return { kind: 'replicate', expert: null }
        const key = spec.replicate === 'per-copy' ? (e: number) => v.loads[e] / v.copies[e] : (e: number) => v.loads[e]
        return { kind: 'replicate', expert: pick(v.loads.length, key, more) }
      }
      const hasRoom = (g: number) => v.gpus[g].free > 0
      if (spec.place === 'least-loaded') return { kind: 'place', gpu: pick(GPUS, (g) => v.gpus[g].units, less, hasRoom) }
      // Round robin: the k-th copy placed (k counts every copy already on a GPU) goes to GPU k mod 4, or on from there.
      const k = v.gpus.reduce((a, g) => a + g.experts.length, 0)
      for (let step = 0; step < GPUS; step++) if (hasRoom((k + step) % GPUS)) return { kind: 'place', gpu: (k + step) % GPUS }
      throw new Error('no GPU has a free slot')
    },
  }
}

/** One spec's run on one set of loads: Compose's row. */
export interface EplbSpecRun {
  /** The busiest GPU's load, in units. */
  maxUnits: number
  imbalance: number
  /** Each GPU's load at the end, in units. */
  gpuUnits: number[]
}

/** Runs a spec over the 24 turns on these loads. */
export function runEplbSpec(spec: EplbPolicySpec, loads: readonly number[]): EplbSpecRun {
  const v = runEplb(loads, compileEplbPolicy(spec))
  return { maxUnits: v.maxUnits, imbalance: imbalanceOf(v.maxUnits), gpuUnits: v.gpus.map((g) => g.units) }
}

const sameDecision = (a: EplbDecision, b: EplbDecision) =>
  a.kind === 'replicate' && b.kind === 'replicate' ? a.expert === b.expert : a.kind === 'place' && b.kind === 'place' && a.gpu === b.gpu

/**
 * The first turn (0-based) of the ghost's run where the spec decides otherwise, or -1 when it decides the same at
 * every turn: then its run is the ghost's, turn for turn.
 */
export function firstDifference(spec: EplbPolicySpec, loads: readonly number[]): number {
  const policy = compileEplbPolicy(spec)
  const model = eplbModel(loads)
  let s = model.init()
  for (let i = 0; i < EPLB_OPS.length; i++) {
    const req = model.ask(s, EPLB_OPS[i])
    if (req === null) {
      s = model.apply(s, EPLB_OPS[i], null).state
      continue
    }
    const v = model.view(s)
    const ghost = EPLB_GHOST.decide(v, req)
    if (!sameDecision(policy.decide(v, req), ghost)) return i
    s = model.apply(s, EPLB_OPS[i], ghost).state
  }
  return -1
}

/** Whether a spec reproduces the ghost at every turn on every one of these loads. */
export const eplbEquivalent = (spec: EplbPolicySpec, loadSets: readonly (readonly number[])[]) => loadSets.every((l) => firstDifference(spec, l) < 0)

/** The ledger's flat form of a spec (a copy: the dials are already flat). */
export const eplbSpecData = (spec: EplbPolicySpec): EplbSpecData => ({ replicate: spec.replicate, place: spec.place })

/**
 * The ledger result for one Compose run (wave-3.md §3.2): `ok` when the spec is equivalent, or within 0.05 of the
 * ghost on every load it ran on. `mineUnits` and `ghostUnits` are the busiest GPU's loads on the play's own load.
 */
export function eplbComposeResult(
  spec: EplbPolicySpec,
  outcome: { equivalent: boolean; runs: { mineUnits: number; ghostUnits: number }[]; tries: number },
  opts: { seed: number; provenance: PlayResult['provenance']; kcs?: string[]; ms?: number },
): PlayResult {
  if (outcome.runs.length === 0) throw new Error('a Compose result needs at least one run')
  const first = outcome.runs[0]
  const ok = outcome.equivalent || outcome.runs.every((r) => eplbPasses(r.mineUnits, r.ghostUnits))
  const data: PlayData = {
    phase: 'compose',
    turns: outcome.tries,
    survived: outcome.runs.filter((r) => eplbPasses(r.mineUnits, r.ghostUnits)).length,
    ghostSurvived: outcome.runs.length,
    spec: eplbSpecData(spec),
    equivalent: outcome.equivalent,
    metric: { name: 'imbalance', mine: imbalanceOf(first.mineUnits), ghost: imbalanceOf(first.ghostUnits), lowerIsBetter: true },
  }
  if (opts.kcs) data.kcs = opts.kcs
  const out: PlayResult = { playId: EPLB_PLAY_ID, score: Math.min(1, first.ghostUnits / first.mineUnits), ok, seed: opts.seed, provenance: opts.provenance, data }
  if (opts.ms !== undefined) out.ms = opts.ms
  return out
}

/** The natural shortcuts, each one dial away from the reference: no replicas, copying by total load, round robin. */
export const EPLB_SHORTCUTS: readonly EplbPolicySpec[] = Object.freeze([
  { replicate: 'none', place: 'least-loaded' },
  { replicate: 'total', place: 'least-loaded' },
  { replicate: 'per-copy', place: 'round-robin' },
])

/** Whether every shortcut misses the ghost by more than the pass margin on these loads. */
export function shortcutsMiss(loads: readonly number[]): boolean {
  const ghost = runEplb(loads, EPLB_GHOST).maxUnits
  return EPLB_SHORTCUTS.every((s) => !eplbPasses(runEplbSpec(s, loads).maxUnits, ghost))
}

/** How `EPLB_PRACTICE_SEED` was found: the first candidate from 0 in band on which every shortcut misses. */
export function firstPracticeSeed(limit = 10_000): number {
  for (let c = 0; c < limit; c++) {
    const loads = makeLoads(c)
    if (checkEplbBand(loads).inBand && shortcutsMiss(loads)) return c
  }
  throw new Error(`no practice candidate below ${limit}`)
}
