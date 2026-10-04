/**
 * sim.worker — runs Fleet Week's batch acts off the main thread (PLAN-100X §7.3).
 * Learner wasm modules arrive as bytes and are instantiated here, so a slow or
 * trapping module can only stall this worker, never the page.
 */

import { evalAct3, loadIncident, runAct1, runAct2 } from '@/lib/fleet-week'
import { drawGradedSeeds } from '@/lib/graded-seed'
import type { SimJob, SimRequest, SimResponse, SimResults } from '@/workers/sim-protocol'

const ctx = self as unknown as { postMessage(message: SimResponse): void }

async function run(
  job: SimJob,
  entropy: number,
  onProgress: (fraction: number) => void,
): Promise<SimResults[SimJob['kind']]> {
  // every job is graded: it gets its own in-band seed, drawn here (rejection sampling simulates baselines)
  const { seeds } = drawGradedSeeds(entropy)
  switch (job.kind) {
    case 'act1':
      return runAct1(job.modules, seeds, onProgress)
    case 'act2':
      return runAct2(job.modules, job.choice, seeds, onProgress)
    case 'act3':
      return evalAct3(seeds, onProgress)
    case 'incident':
      return loadIncident(job.id, seeds)
  }
}

self.addEventListener('message', (event: MessageEvent<SimRequest>) => {
  const { id, job, entropy } = event.data
  run(job, entropy, (fraction) => ctx.postMessage({ id, type: 'progress', fraction }))
    .then((result) => ctx.postMessage({ id, type: 'result', result }))
    .catch((e: unknown) => ctx.postMessage({ id, type: 'error', message: e instanceof Error ? e.message : String(e) }))
})

ctx.postMessage({ type: 'ready' })
