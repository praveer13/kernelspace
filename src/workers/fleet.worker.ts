/**
 * fleet.worker — runs admitted learner wasm off the main thread.
 *
 * Admission (lab.worker.ts) proved the module returns once; it did not prove the engine's whole run
 * does. Every learner module is instantiated and driven here, so a scheduler that spins at tick 412
 * stalls this worker only: fleet-session.ts terminates it after the command's budget and reports the tick.
 * The leaderboard harness runs here too, as one `job`.
 */

import { createFleetHost } from '../lib/fleet-host'
import type { FleetReply, FleetRequest } from './fleet-protocol'

/* The app tsconfig has the DOM lib, not WebWorker — type just what we use. */
const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<FleetRequest>) => void) | null
  postMessage(msg: FleetReply): void
}

const host = createFleetHost()

scope.onmessage = (ev) => {
  void host.handle(ev.data, (reply) => scope.postMessage(reply))
}

scope.postMessage({ type: 'boot' })
