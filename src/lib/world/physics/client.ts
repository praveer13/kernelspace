/**
 * The clients that feed `EngineV2` (docs/specs/s5.md §6.2, S5-D9, S5-D10, S5-D53).
 *
 * A client is a `ClientDriver`: it hands the engine its requests as the clock passes their arrival. `closedLoop` is the
 * benchmark's closed loop with durations taken out of the schedule: all n requests arrive at t = 0, in id order, and the
 * engine's `maxNumSeqs = c` plays the client's concurrency, so admission (a slot freeing) is when the client would
 * have sent the next request; that is why TTFT is stamped from admission. `openLoop` (built and tested, unused in S5)
 * puts arrivals on the 50 ms grid. Lengths are drawn uniformly on the integers [⌊ratio·L⌋, L], prompt then output for
 * each request, from a splitmix32 stream (`src/lib/rng.ts`), so a seed gives the same requests in every runtime.
 */

import { splitmix32 } from '../../rng'

/** One request as the engine sees it: integer µs and token counts. */
export interface Request {
  id: number
  arrivalUs: number
  /** prompt tokens */
  prompt: number
  /** output tokens; fixed, as with the harness's `--ignore-eos` */
  output: number
}

/** The nominal shape a client draws from, so the engine can check its box (§6.3). */
export interface ClientShape {
  isl: number
  osl: number
  ratio: number
}

export interface ClientDriver {
  /** the next not-yet-injected arrival, or null when none is left */
  nextArrivalUs(): number | null
  /** requests with arrivalUs ≤ clockUs not yet injected, in (arrivalUs, id) order */
  due(clockUs: number): Request[]
  /** what the lengths were drawn from; a driver without it is out of the box unless the engine explores */
  readonly shape?: ClientShape
}

/** The open loop's arrival grid, µs (S5-D10: v1's 50 ms tick). */
export const ARRIVAL_GRID_US = 50_000

/** Integers uniform on [⌊ratio·L⌋, L]. `ratio · L` is one float product, as the harness's `int(isl * ratio)`. */
const lengthDraw = (rand: () => number, L: number, ratio: number): number => {
  const lo = Math.floor(ratio * L)
  return lo + Math.floor(rand() * (L - lo + 1))
}

/** A driver over requests already sorted by (arrivalUs, id). */
function fromSorted(requests: readonly Request[], shape: ClientShape): ClientDriver {
  let next = 0
  return {
    shape,
    nextArrivalUs: () => (next < requests.length ? requests[next].arrivalUs : null),
    due: (clockUs) => {
      const out: Request[] = []
      for (; next < requests.length && requests[next].arrivalUs <= clockUs; next++) out.push({ ...requests[next] })
      return out
    },
  }
}

const checkLengths = (isl: number, osl: number, ratio: number): void => {
  if (!Number.isInteger(isl) || !Number.isInteger(osl) || isl < 1 || osl < 1) throw new Error(`lengths must be positive integers: ${isl}/${osl}`)
  if (!(ratio > 0 && ratio <= 1)) throw new Error(`range ratio must lie in (0, 1]: ${ratio}`)
}

export interface ClosedLoopOptions {
  /** the client's concurrency; the engine's `maxNumSeqs` enforces it (§5.3) */
  conc: number
  /** requests in the run (the harness sends 10·c) */
  n: number
  isl: number
  osl: number
  ratio: number
  seed: number
}

/** All n requests queued at t = 0, ids 0 … n − 1 in draw order (S5-D9). */
export function closedLoop(o: ClosedLoopOptions): ClientDriver & { readonly conc: number } {
  checkLengths(o.isl, o.osl, o.ratio)
  if (!Number.isInteger(o.n) || o.n < 0) throw new Error(`n must be a non-negative integer: ${o.n}`)
  if (!Number.isInteger(o.conc) || o.conc < 1) throw new Error(`conc must be a positive integer: ${o.conc}`)
  const rand = splitmix32(o.seed)
  const requests: Request[] = []
  for (let id = 0; id < o.n; id++) {
    const prompt = lengthDraw(rand, o.isl, o.ratio)
    const output = lengthDraw(rand, o.osl, o.ratio)
    requests.push({ id, arrivalUs: 0, prompt, output })
  }
  return { ...fromSorted(requests, { isl: o.isl, osl: o.osl, ratio: o.ratio }), conc: o.conc }
}

export interface OpenLoopOptions {
  /** mean arrivals per second */
  ratePerS: number
  n: number
  seed: number
  /** nominal lengths; default the 1k/1k shape at range ratio 0.8 */
  isl?: number
  osl?: number
  ratio?: number
}

/**
 * n arrivals on the 50 ms grid at `ratePerS` on average. Each arrival tick is uniform on [0, span), span = ⌈20·n ÷ rate⌉
 * ticks: n uniform points on an interval are a Poisson process conditioned on its count, with no `Math.log` (§8.4).
 * Ids 0 … n − 1 follow (arrivalUs, draw order); lengths are drawn after the ticks, in id order.
 */
export function openLoop(o: OpenLoopOptions): ClientDriver {
  const isl = o.isl ?? 1024
  const osl = o.osl ?? 1024
  const ratio = o.ratio ?? 0.8
  checkLengths(isl, osl, ratio)
  if (!Number.isInteger(o.n) || o.n < 0) throw new Error(`n must be a non-negative integer: ${o.n}`)
  if (!(o.ratePerS > 0)) throw new Error(`ratePerS must be positive: ${o.ratePerS}`)
  const rand = splitmix32(o.seed)
  const ticksPerS = 1e6 / ARRIVAL_GRID_US
  const span = Math.max(1, Math.ceil((ticksPerS * o.n) / o.ratePerS))
  const ticks: { tick: number; draw: number }[] = []
  for (let draw = 0; draw < o.n; draw++) ticks.push({ tick: Math.floor(rand() * span), draw })
  ticks.sort((a, b) => a.tick - b.tick || a.draw - b.draw)
  const requests: Request[] = ticks.map(({ tick }, id) => ({ id, arrivalUs: tick * ARRIVAL_GRID_US, prompt: 0, output: 0 }))
  for (const r of requests) {
    r.prompt = lengthDraw(rand, isl, ratio)
    r.output = lengthDraw(rand, osl, ratio)
  }
  return fromSorted(requests, { isl, osl, ratio })
}
