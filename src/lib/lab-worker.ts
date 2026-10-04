/**
 * lab-worker — main-thread client for src/workers/lab.worker.ts.
 *
 * Untrusted learner wasm never runs on the main thread: grading and Fleet
 * admission post the bytes to a worker and get the same results (or the same
 * LabTrapError / LabAbiError) back. A run that exceeds LAB_TIMEOUT_MS has its
 * worker terminated and recreated, and surfaces as a LabTimeoutError.
 */

import { LabAbiError, LabTimeoutError, LabTrapError, type LabReport } from './wasm-lab'
import type { LabRunMode, LabWorkerReply } from '../workers/lab-protocol'

export const LAB_TIMEOUT_MS = 2000

interface Handle {
  worker: Worker
  /** resolves once the worker has loaded its module — keeps startup out of the run budget */
  ready: Promise<void>
}

let handle: Handle | null = null
let nextId = 0
/* One worker, one run at a time: a timeout terminates the worker, so runs must not overlap. */
let chain: Promise<unknown> = Promise.resolve()

function spawn(): Handle {
  const worker = new Worker(new URL('../workers/lab.worker.ts', import.meta.url), { type: 'module' })
  const ready = new Promise<void>((resolve, reject) => {
    const onMessage = (ev: MessageEvent<LabWorkerReply>) => {
      if (ev.data.type !== 'ready') return
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      resolve()
    }
    const onError = () => reject(new Error('the lab worker failed to start'))
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
  })
  return { worker, ready }
}

function discard(h: Handle) {
  h.worker.terminate()
  if (handle === h) handle = null
}

async function dispatch(
  mode: LabRunMode,
  bytes: ArrayBuffer,
): Promise<{ report: LabReport | null; hasInvoke: boolean }> {
  const h = (handle ??= spawn())
  try {
    await h.ready
  } catch (e) {
    discard(h)
    throw e
  }
  const id = nextId++
  let phase: 'checks' | 'invoke' = 'checks'
  return new Promise((resolve, reject) => {
    const settle = () => {
      clearTimeout(timer)
      h.worker.removeEventListener('message', onMessage)
      h.worker.removeEventListener('error', onError)
    }
    const onMessage = (ev: MessageEvent<LabWorkerReply>) => {
      const m = ev.data
      if (m.type === 'ready' || m.id !== id) return
      if (m.type === 'phase') {
        phase = m.phase
        return
      }
      settle()
      if (m.type === 'done') {
        resolve({ report: m.report, hasInvoke: m.hasInvoke })
      } else if (m.kind === 'trap') {
        reject(new LabTrapError())
      } else if (m.kind === 'abi') {
        reject(new LabAbiError(m.message))
      } else {
        reject(new Error(m.message))
      }
    }
    const onError = (ev: ErrorEvent) => {
      settle()
      discard(h)
      reject(new Error(ev.message || 'the lab worker crashed'))
    }
    const timer = setTimeout(() => {
      settle()
      discard(h)
      reject(new LabTimeoutError(LAB_TIMEOUT_MS, phase))
    }, LAB_TIMEOUT_MS)
    h.worker.addEventListener('message', onMessage)
    h.worker.addEventListener('error', onError)
    /* no transfer list: callers keep their bytes (Fleet slots reuse them) */
    h.worker.postMessage({ id, mode, bytes })
  })
}

function run(mode: LabRunMode, bytes: ArrayBuffer) {
  const result = chain.then(() => dispatch(mode, bytes))
  chain = result.catch(() => {})
  return result
}

/** Forge grading: runLabWasm in a worker. Throws LabAbiError, LabTrapError or LabTimeoutError. */
export async function runLabInWorker(bytes: ArrayBuffer): Promise<LabReport> {
  const { report } = await run('grade', bytes)
  if (!report) throw new LabAbiError('lab worker returned no report — ABI violation.')
  return report
}

/**
 * Fleet admission: instantiate, check for the ks_invoke bridge, run the suite, then (if it is green)
 * exercise ks_invoke with the lab's canned calls — all inside the one LAB_TIMEOUT_MS budget.
 * `report` is null (checks not run) when the module has no bridge. Throws like runLabInWorker.
 */
export function validateLabInWorker(bytes: ArrayBuffer): Promise<{ report: LabReport | null; hasInvoke: boolean }> {
  return run('validate', bytes)
}

/**
 * Release the worker (scripts; the app keeps it for the page's lifetime).
 * Under bun, terminate() cannot interrupt a wasm infinite loop, so a script that saw a
 * LabTimeoutError must also call process.exit — the spinning worker thread keeps bun alive.
 */
export function disposeLabWorker() {
  if (handle) discard(handle)
}
