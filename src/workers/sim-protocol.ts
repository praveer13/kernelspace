/**
 * sim-protocol — the structured-clone messages between the Fleet Week page and
 * sim.worker. Specs go in (module bytes, topology choice, fresh entropy for the
 * graded seed), results and progress come out; nothing here holds a function.
 * Acts I–III, plus lab 06's bestiary (docs/specs/wave-3.md §8.3): Act IV's drills are incident sessions in the fleet
 * worker (docs/specs/wave-2.md §9.8).
 */

import type {
  Act2Choice,
  Act3Eval,
  ActResult,
  ModuleBytes,
} from '@/lib/fleet-week'
import type { BestiaryResult } from '@/lib/world/bestiary'

/** The jobs a receipt can re-run: `fleet-receipts.ts` rebuilds exactly these from a run record. */
export type SimJob =
  | { kind: 'act1'; modules: ModuleBytes }
  | { kind: 'act2'; modules: ModuleBytes; choice: Act2Choice }
  | { kind: 'act3' }

/**
 * Lab 06's bestiary: the twelve Compose-dial policies on the engine and graded seed the entropy draws. It carries no
 * module bytes and is no act, so it is not a `SimJob` and no receipt cites it.
 */
export interface BestiaryJob {
  kind: 'bestiary'
}

/** Every job the worker answers. */
export type SimRequestJob = SimJob | BestiaryJob

export interface SimResults {
  act1: ActResult
  act2: ActResult
  act3: Act3Eval
  bestiary: BestiaryResult
}

export interface SimRequest {
  id: number
  job: SimRequestJob
  /** fresh entropy: the worker draws the in-band graded seed from it at grade time */
  entropy: number
}

export type SimResponse =
  /** posted once when the worker's module has loaded, so startup stays out of a job's time budget */
  | { type: 'ready' }
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'result'; result: SimResults[SimRequestJob['kind']] }
  | { id: number; type: 'error'; message: string }
