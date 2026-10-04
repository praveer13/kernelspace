/**
 * sim-client — the page's handle on sim.worker: one lazily-started worker,
 * jobs multiplexed by id. Seeds are attached here, once, from fleetWeekSeeds().
 */

import { fleetWeekSeeds, type ModuleBytes } from '@/lib/fleet-week'
import type { SlotState } from '@/pages/fleet/slots'
import type { SimJob, SimRequest, SimResponse, SimResults } from '@/workers/sim-protocol'

interface Pending {
  resolve: (result: SimResults[SimJob['kind']]) => void
  reject: (error: Error) => void
  onProgress?: (fraction: number) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function fail(error: Error) {
  for (const p of pending.values()) p.reject(error)
  pending.clear()
  worker?.terminate()
  worker = null
}

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (event: MessageEvent<SimResponse>) => {
    const msg = event.data
    const p = pending.get(msg.id)
    if (!p) return
    if (msg.type === 'progress') {
      p.onProgress?.(msg.fraction)
      return
    }
    pending.delete(msg.id)
    if (msg.type === 'result') p.resolve(msg.result)
    else p.reject(new Error(msg.message))
  }
  w.onerror = (event) => fail(new Error(event.message || 'the simulation worker crashed'))
  worker = w
  return w
}

/** Run one Fleet Week job in the worker; resolves with its result, rejects with the worker's error. */
export function runSim<K extends SimJob['kind']>(
  job: Extract<SimJob, { kind: K }>,
  onProgress?: (fraction: number) => void,
): Promise<SimResults[K]> {
  const id = nextId++
  const request: SimRequest = { id, job, seeds: fleetWeekSeeds() }
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as Pending['resolve'], reject, onProgress })
    getWorker().postMessage(request)
  })
}

/** The bytes of whatever the learner has uploaded (structured clone copies them; the slots stay intact). */
export function moduleBytes(slots: SlotState): ModuleBytes {
  return { sched: slots.sched?.bytes ?? null, mgr: slots.mgr?.bytes ?? null, queue: slots.queue?.bytes ?? null }
}
