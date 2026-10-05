/** Messages between the main thread and lab.worker.ts. Types only — safe to import from both sides. */

import type { LabReport } from '../lib/wasm-lab'
import type { CheckResult, ListReply } from '../lib/forge/types'

export type LabRunMode =
  /** Forge grading: run the self-check suite and return its report */
  | 'grade'
  /** Fleet admission: check the ks_invoke bridge exists, run the suite, then exercise ks_invoke */
  | 'validate'

export interface LabWorkerRequest {
  id: number
  mode: LabRunMode
  bytes: ArrayBuffer
  /** Template v2: seeded checks run on seeds drawn now ('fresh') or on the crate's own ('default', the default). */
  seeds?: 'fresh' | 'default'
  /** Template v2: the first check to run. A worker respawned after a timed-out check resumes past it. */
  startAt?: number
  /** Template v2, 'validate': every check before `startAt` passed (names the probe's timeout correctly). */
  priorGreen?: boolean
}

export type LabWorkerReply =
  | { type: 'ready' }
  /** Template v2: the module's `list` reply, before any check runs */
  | { type: 'listed'; id: number; list: ListReply }
  /** Template v2: check `index` is starting; the main thread's 2 s timer for it starts here */
  | { type: 'check-start'; id: number; index: number; check: string; seed?: number }
  | { type: 'check-done'; id: number; index: number; result: CheckResult }
  /** 'validate' only: the ks_invoke probe is starting (names the stage a timeout hit; it runs even after failing checks) */
  | { type: 'phase'; id: number; phase: 'invoke'; checksPassed: boolean }
  | {
      type: 'done'
      id: number
      /** 2: the results came as check-done messages and `report` is null. Absent means 1. */
      abi?: 1 | 2
      /** null in 'validate' mode when the module has no ks_invoke bridge, and for every v2 run */
      report: LabReport | null
      hasInvoke: boolean
    }
  /** `phase: 'invoke'` marks a trap in the ks_invoke probe after green checks */
  | { type: 'failed'; id: number; kind: 'trap' | 'abi' | 'error'; message: string; phase?: 'invoke' }
