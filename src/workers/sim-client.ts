/**
 * sim-client — the page's handle on sim.worker: one lazily-started worker, one job at a
 * time. Every job carries fresh entropy; the worker draws the graded seed from it at grade time.
 *
 * Learner wasm runs inside that worker, so a module that spins can only stall the worker. A job
 * that exceeds SIM_TIMEOUT_MS has its worker terminated and respawned (mirroring lab-worker) and
 * rejects with a SimTimeoutError; jobs run strictly in sequence, so a stuck one can never leave
 * the next one queued behind a worker that will not answer.
 */

import type { ModuleBytes } from '@/lib/fleet-week'
import { freshSeed } from '@/lib/rng'
import type { SlotState } from '@/pages/fleet/slots'
import type { SimJob, SimRequest, SimResponse, SimResults } from '@/workers/sim-protocol'

/** A job's run budget (worker startup excluded). An honest act with the reference stack takes about 0.2 s (headless Chromium); this leaves slow devices and heavy learner modules wide headroom. */
export const SIM_TIMEOUT_MS = 10_000
/** How long a fresh worker may take to load before the start is treated as failed. */
export const SIM_START_TIMEOUT_MS = 20_000

/** The job ran past SIM_TIMEOUT_MS (typically a module stuck in an infinite loop); its worker was terminated. */
export class SimTimeoutError extends Error {
  constructor(ms: number) {
    super(
      `the simulation was still running after ${ms / 1000} s, so it was stopped. A module that never returns (an infinite loop) does this — fix it and run again.`,
    )
    this.name = 'SimTimeoutError'
  }
}

interface Handle {
  worker: Worker
  /** resolves once the worker has loaded its module — keeps startup out of the run budget */
  ready: Promise<void>
}

let handle: Handle | null = null
let nextId = 1
/* One worker, one job at a time: a timeout terminates the worker, so jobs must not overlap. */
let chain: Promise<unknown> = Promise.resolve()

function spawn(): Handle {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
  const ready = new Promise<void>((resolve, reject) => {
    const settle = () => {
      clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    const onMessage = (event: MessageEvent<SimResponse>) => {
      if (event.data.type !== 'ready') return
      settle()
      resolve()
    }
    const onError = () => {
      settle()
      reject(new Error('the simulation worker failed to start'))
    }
    const timer = setTimeout(() => {
      settle()
      reject(new Error('the simulation worker did not start in time'))
    }, SIM_START_TIMEOUT_MS)
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
  })
  return { worker, ready }
}

function discard(h: Handle) {
  h.worker.terminate()
  if (handle === h) handle = null
}

async function dispatch<K extends SimJob['kind']>(
  request: SimRequest,
  onProgress?: (fraction: number) => void,
): Promise<SimResults[K]> {
  const h = (handle ??= spawn())
  try {
    await h.ready
  } catch (e) {
    discard(h)
    throw e
  }
  return new Promise((resolve, reject) => {
    const settle = () => {
      clearTimeout(timer)
      h.worker.removeEventListener('message', onMessage)
      h.worker.removeEventListener('error', onError)
    }
    const onMessage = (event: MessageEvent<SimResponse>) => {
      const msg = event.data
      if (msg.type === 'ready' || msg.id !== request.id) return
      if (msg.type === 'progress') {
        onProgress?.(msg.fraction)
        return
      }
      settle()
      if (msg.type === 'result') resolve(msg.result as SimResults[K])
      else reject(new Error(msg.message))
    }
    const onError = (event: ErrorEvent) => {
      settle()
      discard(h)
      reject(new Error(event.message || 'the simulation worker crashed'))
    }
    const timer = setTimeout(() => {
      settle()
      discard(h)
      reject(new SimTimeoutError(SIM_TIMEOUT_MS))
    }, SIM_TIMEOUT_MS)
    h.worker.addEventListener('message', onMessage)
    h.worker.addEventListener('error', onError)
    h.worker.postMessage(request)
  })
}

/**
 * Run one Fleet Week job in the worker. Resolves with its result; rejects with the worker's error
 * (a trapping module), a SimTimeoutError (a spinning one), or a start/crash error. Every outcome
 * leaves the next call with a working worker.
 */
export function runSim<K extends SimJob['kind']>(
  job: Extract<SimJob, { kind: K }>,
  onProgress?: (fraction: number) => void,
): Promise<SimResults[K]> {
  const request: SimRequest = { id: nextId++, job, entropy: freshSeed() }
  const result = chain.then(() => dispatch<K>(request, onProgress))
  chain = result.catch(() => {})
  return result
}

/** The bytes of whatever the learner has uploaded (structured clone copies them; the slots stay intact). */
export function moduleBytes(slots: SlotState): ModuleBytes {
  return { sched: slots.sched?.bytes ?? null, mgr: slots.mgr?.bytes ?? null, queue: slots.queue?.bytes ?? null }
}
