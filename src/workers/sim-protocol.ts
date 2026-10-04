/**
 * sim-protocol — the structured-clone messages between the Fleet Week page and
 * sim.worker. Specs go in (module bytes, topology choice, fresh entropy for the
 * graded seed), results and progress come out; nothing here holds a function.
 */

import type {
  Act2Choice,
  Act3Eval,
  ActResult,
  Incident,
  ModuleBytes,
} from '@/lib/fleet-week'

export type SimJob =
  | { kind: 'act1'; modules: ModuleBytes }
  | { kind: 'act2'; modules: ModuleBytes; choice: Act2Choice }
  | { kind: 'act3' }
  | { kind: 'incident'; id: string }

export interface SimResults {
  act1: ActResult
  act2: ActResult
  act3: Act3Eval
  incident: Incident | null
}

export interface SimRequest {
  id: number
  job: SimJob
  /** fresh entropy: the worker draws the in-band graded seed from it at grade time */
  entropy: number
}

export type SimResponse =
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'result'; result: SimResults[SimJob['kind']] }
  | { id: number; type: 'error'; message: string }
