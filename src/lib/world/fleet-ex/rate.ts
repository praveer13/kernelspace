/**
 * The one rate every Fleet exercise reports (docs/specs/wave-3.md §5.3): SLO-met requests per second of the trace's
 * arrival window, at the engine's 50 ms tick. It lives here, not in an exercise, so an exercise (the knee, the P:D
 * split, the stretch ones of §16.3) imports the rate without importing another exercise.
 */

import { SIM_TICK_SECONDS } from '@/lib/fleet-model'

/** SLO-met requests per second of the arrival window (50 ms per tick); never `Engine.goodput()`'s percentage. */
export const goodputRps = (sloMet: number, windowTicks: number): number => sloMet / (windowTicks * SIM_TICK_SECONDS)
