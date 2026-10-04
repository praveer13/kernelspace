/**
 * Scan graded Fleet Week seeds for degenerate ones (PLAN-100X §5.2 S3).
 *
 * Each of the 10,000 runs draws a graded seed exactly as the sim worker does
 * (drawGradedSeeds, rejection sampling included) from a fixed entropy stream,
 * so the scan is reproducible. A drawn seed is DEGENERATE, and fails the run, if
 *   1. arrivals: its trace is not 240 requests sorted inside [0, 900) over at
 *      least 50 distinct arrival ticks (zero arrivals, a collapsed clock);
 *   2. non-finite: any baseline number is NaN or +/-Infinity, or the reference
 *      completes nothing (Act III's $/Mtok would divide by zero);
 *   3. policies identical: FCFS, SJF and the reference give the same goodput,
 *      completions, shed, TTFT p95 and queue p95 on it (the seed cannot tell
 *      schedulers apart, so no Act I pass bar means anything);
 *   4. band: its reference baselines break any SEED_BAND rule, or its node death
 *      falls outside DEATH_TICKS;
 *   5. dead fault: the node death or the flash crowd never fired in a 2- or
 *      4-worker reference fleet;
 *   6. not reproducible: re-drawing the same entropy, or rebuilding the scenario
 *      from the accepted seed alone, gives different seeds or outcomes (checked on
 *      every 50th run).
 *
 * Timing: one graded draw costs about 40 ms (up to 4 reference simulations per
 * candidate, 1.3 candidates on average), plus about 12 ms for the policy baselines
 * checked here. 10,000 runs take about 9 minutes (549 s measured), far over the 20 s fast-gate budget, so
 * this runs in .github/workflows/nightly.yml, not in ci.yml or deploy.yml.
 *
 * Usage: bun run verify:seeds [--count N]   (default 10000; a small N is a smoke test)
 */
import { policyBaselines, traceFor, type PolicyOutcome } from '../src/lib/fleet-week'
import {
  DEATH_TICKS,
  bandViolations,
  deriveSeeds,
  drawGradedSeeds,
  type GradedDraw,
} from '../src/lib/graded-seed'
import { splitmix32u } from '../src/lib/rng'

const MASTER_SEED = 0x6b657a
const REQ_COUNT = 240
const SPAN = 900

const countFlag = process.argv.indexOf('--count')
const COUNT = countFlag >= 0 ? Number(process.argv[countFlag + 1]) : 10_000
if (!Number.isInteger(COUNT) || COUNT < 1) throw new Error('--count needs a positive integer')

function degeneracies(draw: GradedDraw): string[] {
  const { seeds, outcome } = draw
  const found: string[] = []

  const trace = traceFor(seeds)
  const arrivals = trace.map((r) => r.arrival)
  const sorted = arrivals.every((t, i) => i === 0 || arrivals[i - 1] <= t)
  if (trace.length !== REQ_COUNT || !sorted || arrivals.some((t) => t < 0 || t >= SPAN) || new Set(arrivals).size < 50) {
    found.push(`degenerate arrivals (${trace.length} requests, ${new Set(arrivals).size} distinct ticks)`)
  }

  const policies = policyBaselines(seeds)
  const numbers = [
    outcome.refGoodput,
    outcome.b200Goodput,
    outcome.fleet4.completedPct,
    outcome.fleet4.goodput,
    outcome.fleet2.completedPct,
    outcome.fleet2.goodput,
    ...Object.values(policies).flatMap((p) => Object.values(p)),
  ]
  if (numbers.some((n) => !Number.isFinite(n))) found.push('NaN or Infinity in a baseline')
  if (policies.reference.completed === 0) found.push('the reference completed nothing')

  const key = (p: PolicyOutcome) => JSON.stringify(p)
  if (key(policies.fcfs) === key(policies.sjf) && key(policies.sjf) === key(policies.reference)) {
    found.push('FCFS, SJF and the reference are identical')
  }

  found.push(...bandViolations(outcome).map((v) => `band violation: ${v}`))
  if (seeds.deathTick < DEATH_TICKS.min || seeds.deathTick > DEATH_TICKS.max) found.push(`death tick ${seeds.deathTick} outside the window`)

  for (const [name, fleet] of [['4-worker', outcome.fleet4], ['2-worker', outcome.fleet2]] as const) {
    if (!fleet.deathFired) found.push(`node death never fired in the ${name} fleet`)
    if (fleet.injected === 0) found.push(`flash crowd never fired in the ${name} fleet`)
  }
  return found
}

function reproducibility(entropy: number, draw: GradedDraw): string[] {
  const again = drawGradedSeeds(entropy)
  const replay = deriveSeeds(draw.seeds.seed ?? 0)
  const found: string[] = []
  if (JSON.stringify(again) !== JSON.stringify(draw)) found.push('re-drawing the same entropy changed the result')
  if (JSON.stringify(replay) !== JSON.stringify(draw.seeds)) found.push('deriveSeeds(accepted seed) does not rebuild the scenario')
  return found
}

const entropyStream = splitmix32u(MASTER_SEED)
const timings: number[] = []
let candidates = 0
const failures: string[] = []
const started = performance.now()

for (let i = 0; i < COUNT; i++) {
  const entropy = entropyStream()
  const t0 = performance.now()
  const draw = drawGradedSeeds(entropy)
  timings.push(performance.now() - t0)
  candidates += draw.draws
  const problems = [...degeneracies(draw), ...(i % 50 === 0 ? reproducibility(entropy, draw) : [])]
  for (const p of problems) failures.push(`run ${i} (seed 0x${(draw.seeds.seed ?? 0).toString(16).padStart(8, '0')}): ${p}`)
}

const total = performance.now() - started
const ranked = [...timings].sort((a, b) => a - b)
const at = (q: number) => ranked[Math.min(ranked.length - 1, Math.floor(q * ranked.length))]
const mean = timings.reduce((a, b) => a + b, 0) / timings.length

console.log(
  `${COUNT} graded draws · ${candidates} candidates simulated · ` +
    `acceptance ${((COUNT / candidates) * 100).toFixed(1)}% · ${(candidates / COUNT).toFixed(2)} candidates per draw`,
)
console.log(
  `draw time per run: mean ${mean.toFixed(1)} ms · p50 ${at(0.5).toFixed(1)} · p95 ${at(0.95).toFixed(1)} · max ${ranked[ranked.length - 1].toFixed(1)} · ` +
    `whole scan ${(total / 1000).toFixed(1)} s`,
)

if (failures.length > 0) {
  for (const f of failures.slice(0, 20)) console.error(`FAIL ${f}`)
  if (failures.length > 20) console.error(`... and ${failures.length - 20} more`)
  console.error(`FAIL: ${failures.length} degenerate seed finding(s) in ${COUNT} runs`)
  process.exit(1)
}
console.log(`OK: 0 degenerate seeds in ${COUNT} graded draws`)
