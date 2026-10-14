/**
 * The panel's way to the fleet worker, loaded only when a sweep runs (FleetExercise.tsx imports it lazily).
 *
 * It exists for the static closures (docs/specs/wave-3.md D32: no task after 3a grows them). /daily loads
 * `fleet-session` (which imports `wasm-lab`'s error classes) and `forge/run` (which imports `wasm-lab` too) statically,
 * and Rollup puts modules that the same entry points need into one chunk, so on wave-3a `wasm-lab` and `forge/run`
 * share the `run` chunk. A lazy import of `fleet-session` alone is a new entry point that needs `wasm-lab` and not
 * `forge/run`, and Rollup splits `wasm-lab` into a chunk of its own, which /daily then loads as one more file
 * (+0.4 KB gzip measured on 706102a). Importing `forge/run` here too keeps the two modules needed by the same entry
 * points, so the `run` chunk stays whole and /daily's closure is wave-3a's. The cost is `forge/run`'s 1.8 KB gzip,
 * fetched beside the fleet worker when a learner runs a sweep.
 */

import '@/lib/forge/run'
import { runFleetExercise } from '@/lib/fleet-session'
import type { SweepResult } from '@/lib/world/fleet-ex'

/** Runs the exercise's sweep on the seed in the fleet worker. */
export const runSweep = (id: string, seed: number): Promise<SweepResult> => runFleetExercise(id, seed)
