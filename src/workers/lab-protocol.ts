/** Messages between the main thread and lab.worker.ts. Types only — safe to import from both sides. */

import type { LabReport } from '../lib/wasm-lab'

export type LabRunMode =
  /** Forge grading: run the self-check suite and return its report */
  | 'grade'
  /** Fleet admission: check the ks_invoke bridge first, then run the suite */
  | 'validate'

export interface LabWorkerRequest {
  id: number
  mode: LabRunMode
  bytes: ArrayBuffer
}

export type LabWorkerReply =
  | { type: 'ready' }
  | {
      type: 'done'
      id: number
      /** null only in 'validate' mode when the module has no ks_invoke bridge */
      report: LabReport | null
      hasInvoke: boolean
    }
  | { type: 'failed'; id: number; kind: 'trap' | 'abi' | 'error'; message: string }
