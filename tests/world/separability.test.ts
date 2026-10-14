/**
 * Separability of the incident world (docs/specs/wave-2.md §9.4, task 2b-10; the plan's "≥ 90 %").
 *
 * 1,000 generated incidents per fault on reference components. For each one, `signature` reads every probe
 * as the first thing taken at the alert (each at `alert + its cost`) and plays the USE-ordered expert on
 * the same run up to its fix. Required, per fault:
 *   - the observed category vector equals EXPECTED[fault], and the expert names that fault, on ≥ 90 % of seeds;
 *   - no two faults produce the same vector on ≥ 10 % of seeds (the share of one fault's seeds whose vector
 *     another fault also produced on at least 1 % of its own).
 * It prints the confusion matrix (injected fault by the expert's call), the categories per probe and the
 * alert delays. A scoring check on a sample per fault holds the expert to recovering inside the budget.
 *
 * OPUS CHECK (2b-10). The fault set, the thresholds and the scoring rule as approved here:
 *   - The first four faults stand (Q12): pool-shrink, drain-stall, node-death, tenant-burst. None failed,
 *     so straggler and admission-greedy stay in reserve.
 *   - Scenario (world/incident-sim's INCIDENT_SCENARIO): 512-block pools, 24 running slots, interference
 *     on, a 16-deep intake draining 6 per tick, JSQ, a steady chat trace at 55 % of capacity (node death
 *     +8 to +12 points by severity on two workers, +25 to +27 on four: a four-worker fleet at 55 % absorbs one
 *     death with no alert, and the size is drawn from the seed, never the fault). SLO: TTFT 20 ticks, TPOT 2
 *     ticks per token.
 *   - Scoring: each chat request's outcome counts once, in the minute it is known; a request whose TTFT
 *     deadline passes without a first token is a miss then. Before this the book counted completions only,
 *     and the reference's shortest-first order let long prompts starve unseen: node death alerted at the
 *     15-minute fallback on half the seeds and its "lost in flight" fell out of the probe window.
 *   - The SLO covers the chat traffic, not the burst tenant's own requests: `limit-tenant` caps them, so
 *     they queue for good and would keep the fleet from ever recovering.
 *   - EXPECTED's one change from §9.2 (node death's intake "normal") is explained above EXPECTED.
 *   - Thresholds sit in the gaps 1,000 tuning seeds per fault left: kv free at the alert ran 0.17–0.30 under a tenant
 *     burst, 0.37–0.63 on a node death's survivor and 0.82–0.99 under a drain stall (low < 0.35, high >
 *     0.78); TPOT p95 1.96–2.84 under a burst against ≤ 2.13 elsewhere, which is why "TPOT up" also asks
 *     that long prompts hold ≥ 35 % of the prefill (0.45–0.80 under a burst, 0 elsewhere).
 *   Result on this file's seeds (BF2: the fleet size is drawn from the seed, so node death runs on two and four
 *   workers): every expert call right, 1,000 of 1,000 per fault; every vector equal to EXPECTED but a node
 *   death's 39 (38 on four workers whose alert came late enough that the lost requests left the probe window,
 *   errors "none", and one whose survivors read kv "low free"); alerts 2–5 minutes after the onset (a tenant
 *   burst, and a four-worker node death, up to 13), never at the fallback; expert burn 1.4–8.9 burn-minutes
 *   on the sample.
 */
import { describe, expect, test } from 'bun:test'
import {
  BURN_BUDGET,
  CATEGORIES,
  EXPECTED,
  INCIDENT_FAULTS,
  LIMIT_MINUTES,
  PROBE_IDS,
  ALERT_LATEST,
  generateIncident,
  type CategoryVector,
  type IncidentFault,
  type IncidentSpec,
} from '../../src/lib/world/incident-spec'
import { replayIncident, runExpert, signature } from '../../src/lib/world/incident-sim'

const SLOW = 600_000
const PER_FAULT = 1000
const BAR = 0.9
const OVERLAP = 0.1

/** The first 1,000 generated drills of each fault, in key order: the generator picks the fault, as it does for learners. */
function seedsPerFault(): Record<IncidentFault, IncidentSpec[]> {
  const out = Object.fromEntries(INCIDENT_FAULTS.map((f) => [f, [] as IncidentSpec[]])) as Record<IncidentFault, IncidentSpec[]>
  for (let i = 0; INCIDENT_FAULTS.some((f) => out[f].length < PER_FAULT); i++) {
    const spec = generateIncident('drill', `separability-${i}`)
    if (out[spec.fault].length < PER_FAULT) out[spec.fault].push(spec)
  }
  return out
}

const key = (v: CategoryVector) => PROBE_IDS.map((p) => v[p]).join('|')

interface FaultResult {
  vectors: Map<string, number>
  matched: number
  confusion: Record<IncidentFault, number>
  perProbe: Record<string, Record<string, number>>
  delays: number[]
}

let results: Record<IncidentFault, FaultResult> | null = null
const SPECS = seedsPerFault()

function separability(): Record<IncidentFault, FaultResult> {
  if (results) return results
  const out = {} as Record<IncidentFault, FaultResult>
  for (const fault of INCIDENT_FAULTS) {
    const r: FaultResult = {
      vectors: new Map(),
      matched: 0,
      confusion: Object.fromEntries(INCIDENT_FAULTS.map((f) => [f, 0])) as Record<IncidentFault, number>,
      perProbe: Object.fromEntries(PROBE_IDS.map((p) => [p, {}])),
      delays: [],
    }
    for (const spec of SPECS[fault]) {
      const s = signature(spec)
      const k = key(s.vector)
      r.vectors.set(k, (r.vectors.get(k) ?? 0) + 1)
      if (k === key(EXPECTED[fault])) r.matched++
      r.confusion[s.expert]++
      for (const p of PROBE_IDS) r.perProbe[p][s.vector[p]] = (r.perProbe[p][s.vector[p]] ?? 0) + 1
      r.delays.push(s.alert - spec.onsetMinute)
    }
    out[fault] = r
  }
  results = out
  return out
}

describe('separability: 1,000 seeds per fault on reference components', () => {
  test('the seeds are 1,000 distinct generated incidents per fault, on both fleet sizes for every fault', () => {
    for (const fault of INCIDENT_FAULTS) {
      expect(SPECS[fault]).toHaveLength(PER_FAULT)
      expect(new Set(SPECS[fault].map((s) => s.seed)).size).toBe(PER_FAULT)
      const sizes = new Set(SPECS[fault].map((s) => s.workers))
      expect([...sizes].sort()).toEqual([2, 4])
    }
  })

  test(`the observed vector matches EXPECTED and the expert names the fault on >= ${BAR * 100}% of seeds; the matrix is printed`, () => {
    const res = separability()
    const pad = (s: string | number, n = 13) => String(s).padStart(n)
    console.log(`incident separability on ${PER_FAULT} seeds per fault (rows: injected; columns: the expert's call)`)
    console.log(`${''.padEnd(14)}${INCIDENT_FAULTS.map((f) => pad(f)).join('')}${pad('vector = EXPECTED', 19)}`)
    for (const fault of INCIDENT_FAULTS) {
      const r = res[fault]
      console.log(`${fault.padEnd(14)}${INCIDENT_FAULTS.map((f) => pad(r.confusion[f])).join('')}${pad(`${r.matched}/${PER_FAULT}`, 19)}`)
    }
    for (const fault of INCIDENT_FAULTS) {
      const r = res[fault]
      const d = [...r.delays].sort((a, b) => a - b)
      const probes = PROBE_IDS.map((p) => `${p} ${JSON.stringify(r.perProbe[p])}`).join('; ')
      console.log(`  ${fault}: alert ${d[0]}–${d[d.length - 1]} min after the onset (median ${d[d.length >> 1]}); ${probes}`)
    }
    for (const fault of INCIDENT_FAULTS) {
      expect(res[fault].matched / PER_FAULT).toBeGreaterThanOrEqual(BAR)
      expect(res[fault].confusion[fault] / PER_FAULT).toBeGreaterThanOrEqual(BAR)
    }
  }, SLOW)

  test(`no two faults produce the same vector on >= ${OVERLAP * 100}% of seeds`, () => {
    const res = separability()
    for (const f of INCIDENT_FAULTS) {
      for (const g of INCIDENT_FAULTS) {
        if (f === g) continue
        // vectors g produced on at least 1 % of its seeds
        const gs = new Set([...res[g].vectors].filter(([, n]) => n >= PER_FAULT * 0.01).map(([k]) => k))
        let shared = 0
        for (const [k, n] of res[f].vectors) if (gs.has(k)) shared += n
        expect({ f, g, share: shared / PER_FAULT < OVERLAP }).toEqual({ f, g, share: true })
      }
    }
  }, SLOW)

  test('every observed category is one the probe can return', () => {
    const res = separability()
    for (const fault of INCIDENT_FAULTS) {
      for (const p of PROBE_IDS) {
        for (const c of Object.keys(res[fault].perProbe[p])) expect(CATEGORIES[p] as readonly string[]).toContain(c)
      }
    }
  }, SLOW)

  test('the alert comes from the miss fraction, not the fallback, on >= 99% of seeds', () => {
    const res = separability()
    for (const fault of INCIDENT_FAULTS) {
      const fallback = res[fault].delays.filter((d) => d >= ALERT_LATEST).length
      expect(fallback / PER_FAULT).toBeLessThan(0.01)
    }
  }, SLOW)
})

describe('the scoring rule on a sample', () => {
  const SAMPLE = 40

  test(`the expert fixes, recovers and stays inside the ${BURN_BUDGET} burn-minute budget on ${SAMPLE} seeds per fault`, () => {
    for (const fault of INCIDENT_FAULTS) {
      const burns: number[] = []
      for (const spec of SPECS[fault].slice(0, SAMPLE)) {
        const e = runExpert(spec)
        expect({ seed: spec.seed, named: e.named, fixed: e.outcome.fixed, recovered: e.outcome.recovered }).toEqual({
          seed: spec.seed,
          named: fault,
          fixed: true,
          recovered: true,
        })
        expect(e.outcome.burn).toBeLessThan(BURN_BUDGET)
        burns.push(e.outcome.burn)
      }
      burns.sort((a, b) => a - b)
      console.log(`  ${fault}: expert burn ${burns[0]}–${burns[burns.length - 1]} (median ${burns[burns.length >> 1]}) burn-minutes on ${SAMPLE} seeds`)
    }
  }, SLOW)

  test('doing nothing costs far more than the expert: an unfixed incident runs to the limit and burns more', () => {
    for (const fault of INCIDENT_FAULTS) {
      for (const spec of SPECS[fault].slice(0, 5)) {
        const expert = runExpert(spec).outcome
        // an empty log: the clock runs out with no fix
        const idle = replayIncident(spec, [])
        expect(idle.recovered).toBe(false)
        expect(idle.end - idle.alert).toBe(LIMIT_MINUTES)
        expect(idle.burn).toBeGreaterThan(expert.burn)
      }
    }
  }, SLOW)
})
