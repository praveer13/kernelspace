/**
 * The incident world (docs/specs/wave-2.md §9.2–9.3, task 2b-10): the generator, the catalogs, classify,
 * Streetlight and the expert (pure, world/incident-spec.ts), and the clock, burn and replay on the Fleet
 * engine (world/incident-sim.ts). Separability on 1,000 seeds per fault is tests/world/separability.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { FAULT_IDS } from '../../src/lib/ledger/constants'
import { incidentScore } from '../../src/lib/ledger/fold'
import { hash32 } from '../../src/lib/rng'
import { FAULT_FIXES, faultSpecProblems } from '../../src/lib/world/faults'
import {
  ALERT_LATEST,
  ALERT_MISS,
  BURN_BUDGET,
  CATEGORIES,
  EXPECTED,
  FIXES,
  FIX_IDS,
  INCIDENT_FAULTS,
  INCIDENT_SLO,
  LIMIT_MINUTES,
  ONSET_RANGE,
  PROBES,
  PROBE_IDS,
  RECOVER_MISS,
  RESERVE_FAULTS,
  WINDOW_MINUTES,
  WRONG_FIX_MINUTES,
  actionMinutes,
  alertMinute,
  averageMiss,
  burnOf,
  burnPercent,
  classify,
  consistentFaults,
  expertNext,
  fixFor,
  generateIncident,
  isStreetlight,
  missFraction,
  recoveredAt,
  streetlightFlags,
  type AdmissionReadings,
  type ErrorsReadings,
  type IncidentAction,
  type IncidentFault,
  type IncidentSpec,
  type IntakeReadings,
  type KvReadings,
  type LatencyReadings,
  type Observation,
  type WorkersReadings,
} from '../../src/lib/world/incident-spec'
import {
  FAULT_PARAMS,
  IncidentRun,
  IncidentSession,
  incidentFault,
  incidentTrace,
  referenceStack,
  replayIncident,
  runExpert,
  scoreIncident,
  type StackFactory,
} from '../../src/lib/world/incident-sim'

const SLOW = 120_000
const ROOT = path.join(import.meta.dir, '../..')

/** The first generated drill with this fault (and fleet size, when given). */
function specFor(fault: IncidentFault, workers?: 2 | 4, from = 0): IncidentSpec {
  for (let i = from; ; i++) {
    const s = generateIncident('drill', `incident-test-${i}`)
    if (s.fault === fault && (workers === undefined || s.workers === workers)) return s
  }
}

/* ------------------------------------------------------------------ */
/* The page-safe split                                                  */
/* ------------------------------------------------------------------ */

/** Every module incident-spec.ts loads at run time, following value imports and re-exports (`import type` is erased). */
function valueImportClosure(entry: string): string[] {
  const seen = new Set<string>()
  const resolve = (from: string, spec: string): string | null => {
    let base: string
    if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice(2))
    else if (spec.startsWith('.')) base = path.join(path.dirname(from), spec)
    else return null // a package
    for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) if (existsSync(c) && c.match(/\.tsx?$/)) return c
    throw new Error(`cannot resolve ${spec} from ${from}`)
  }
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/^(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s+'([^']+)'/gm)) {
      if (m[2]) continue
      const next = resolve(file, m[4])
      if (next) visit(next)
    }
    for (const m of src.matchAll(/^import\s+'([^']+)'/gm)) {
      const next = resolve(file, m[1])
      if (next) visit(next)
    }
  }
  visit(entry)
  return [...seen].map((f) => path.relative(ROOT, f))
}

describe('the split: incident-spec.ts is page-safe', () => {
  test('incident-spec.ts imports nothing from fleet-model.ts, directly or through anything it loads', () => {
    const closure = valueImportClosure(path.join(ROOT, 'src/lib/world/incident-spec.ts'))
    expect(closure).toContain('src/lib/world/faults.ts')
    expect(closure.filter((f) => f.includes('fleet-model'))).toEqual([])
    const direct = readFileSync(path.join(ROOT, 'src/lib/world/incident-spec.ts'), 'utf8')
    expect(direct).not.toMatch(/from\s+'[^']*fleet-model'/)
  })

  test('incident-sim.ts is the side that runs the engine', () => {
    expect(valueImportClosure(path.join(ROOT, 'src/lib/world/incident-sim.ts'))).toContain('src/lib/fleet-model.ts')
  })
})

/* ------------------------------------------------------------------ */
/* The generator                                                        */
/* ------------------------------------------------------------------ */

describe('generateIncident', () => {
  test('is seeded by hash32(`${ns}:${key}`) and deterministic', () => {
    const a = generateIncident('daily', '2027-05-03')
    expect(a.seed).toBe(hash32('daily:2027-05-03'))
    expect(generateIncident('daily', '2027-05-03')).toEqual(a)
    expect(a.ns).toBe('daily')
    expect(a.key).toBe('2027-05-03')
    // the namespace is part of the seed: a drill keyed by the same string is another incident
    expect(generateIncident('drill', '2027-05-03').seed).not.toBe(a.seed)
  })

  test('every field is in range and the spec survives a structured clone (it crosses the worker boundary)', () => {
    for (let i = 0; i < 500; i++) {
      const s = generateIncident('drill', i.toString(16))
      expect(INCIDENT_FAULTS).toContain(s.fault)
      expect([1, 2, 3]).toContain(s.severity)
      expect(s.onsetMinute).toBeGreaterThanOrEqual(ONSET_RANGE[0])
      expect(s.onsetMinute).toBeLessThanOrEqual(ONSET_RANGE[1])
      expect([2, 4]).toContain(s.workers)
      expect(s.slo).toEqual({ ...INCIDENT_SLO })
      expect(Number.isInteger(s.traceSeed) && s.traceSeed >= 0).toBe(true)
      expect(structuredClone(s)).toEqual(s)
    }
  })

  test('faults are balanced over seeds, and only the four in play are drawn', () => {
    const n = 4000
    const counts = Object.fromEntries(INCIDENT_FAULTS.map((f) => [f, 0])) as Record<IncidentFault, number>
    for (let i = 0; i < n; i++) counts[generateIncident('daily', `2027-01-01+${i}`).fault]++
    for (const f of INCIDENT_FAULTS) {
      expect(counts[f] / n).toBeGreaterThan(0.22)
      expect(counts[f] / n).toBeLessThan(0.28)
    }
    for (const r of RESERVE_FAULTS) expect(INCIDENT_FAULTS as readonly string[]).not.toContain(r)
  })

  test('every fault, node death included, runs on two and on four workers', () => {
    const sizes = Object.fromEntries(INCIDENT_FAULTS.map((f) => [f, new Set<number>()])) as Record<IncidentFault, Set<number>>
    for (let i = 0; i < 400; i++) {
      const s = generateIncident('drill', `sizes-${i}`)
      sizes[s.fault].add(s.workers)
    }
    for (const f of INCIDENT_FAULTS) expect([...sizes[f]].sort()).toEqual([2, 4])
  })

  test('the fleet size is independent of the fault: it tells nothing about which fault is running (F8)', () => {
    // the size is on the screen before the first probe, so P(fault | size) must be the base rate. 4,000 seeds: each of the
    // four faults holds 25 % of the two-worker incidents and of the four-worker ones, within sampling error (4 SD of a
    // binomial at p = 0.25 over ~2,000 draws is 3.9 points)
    const n = 4000
    const count = Object.fromEntries(INCIDENT_FAULTS.map((f) => [f, { 2: 0, 4: 0 }])) as Record<IncidentFault, Record<number, number>>
    const total = { 2: 0, 4: 0 } as Record<number, number>
    for (let i = 0; i < n; i++) {
      const s = generateIncident('drill', `independence-${i}`)
      count[s.fault][s.workers]++
      total[s.workers]++
    }
    expect(total[2]).toBeGreaterThan(n * 0.45)
    expect(total[4]).toBeGreaterThan(n * 0.45)
    for (const f of INCIDENT_FAULTS) {
      for (const w of [2, 4]) expect(Math.abs(count[f][w] / total[w] - 1 / INCIDENT_FAULTS.length)).toBeLessThan(0.04)
    }
  })

  test('the catalog faults are ledger FaultIds, the reserves included', () => {
    for (const f of [...INCIDENT_FAULTS, ...RESERVE_FAULTS]) expect(FAULT_IDS as readonly string[]).toContain(f)
  })
})

/* ------------------------------------------------------------------ */
/* Catalogs                                                             */
/* ------------------------------------------------------------------ */

describe('catalogs', () => {
  test('six probes in USE order down the pipeline, with the §9.2 costs', () => {
    expect([...PROBE_IDS]).toEqual(['intake', 'admission', 'kv', 'workers', 'latency', 'errors'])
    expect(PROBE_IDS.map((p) => PROBES[p].cost)).toEqual([2, 2, 2, 3, 3, 2])
    for (const p of PROBE_IDS) expect(PROBES[p].id).toBe(p)
  })

  test("one fix per catalog fault, each world/faults' revert for it", () => {
    expect(FIX_IDS.map((f) => FIXES[f].fault).sort()).toEqual([...INCIDENT_FAULTS].sort())
    for (const f of INCIDENT_FAULTS) {
      expect(fixFor(f)).toBe(FAULT_FIXES[f] as string)
      expect(FIXES[fixFor(f)].fault).toBe(f)
    }
  })

  test('EXPECTED gives every fault a category on every probe, from the probe’s own set, and the four vectors differ', () => {
    const keys = new Set<string>()
    for (const f of INCIDENT_FAULTS) {
      for (const p of PROBE_IDS) expect(CATEGORIES[p] as readonly string[]).toContain(EXPECTED[f][p])
      keys.add(PROBE_IDS.map((p) => EXPECTED[f][p]).join('|'))
    }
    expect(keys.size).toBe(INCIDENT_FAULTS.length)
  })

  test('the §9.2 signatures hold where the physics agree (node death’s intake is the one recorded change)', () => {
    expect(EXPECTED['drain-stall'].intake).toBe('full-shedding')
    expect(EXPECTED['drain-stall'].admission).toBe('near-empty')
    expect(EXPECTED['pool-shrink'].kv).toBe('exhausted')
    expect(EXPECTED['node-death'].workers).toBe('one-down')
    expect(EXPECTED['node-death'].errors).toBe('lost')
    expect(EXPECTED['tenant-burst'].latency).toBe('tpot-up')
    expect(EXPECTED['node-death'].intake).toBe('normal')
  })
})

/* ------------------------------------------------------------------ */
/* classify                                                             */
/* ------------------------------------------------------------------ */

const W = { from: 0, to: 10 }
const flat = (v: number | null, n = 10) => Array.from({ length: n }, () => v)

describe('classify', () => {
  const intake = (depth: number, shed = 0): IntakeReadings => ({
    probe: 'intake',
    window: W,
    depth: [flat(depth), flat(depth)],
    drainPerTick: [6, 6],
    configuredDrain: 6,
    capacity: 16,
    shed: [...flat(0, 9), shed] as number[],
  })
  test('intake: normal, elevated, full when a queue holds 40 % of its capacity or the intake sheds', () => {
    expect(classify(intake(0))).toBe('normal')
    expect(classify(intake(3))).toBe('elevated')
    expect(classify(intake(7))).toBe('full-shedding')
    expect(classify(intake(0, 2))).toBe('full-shedding')
  })

  const admission = (waiting: number): AdmissionReadings => ({ probe: 'admission', window: W, waiting: [flat(waiting)], admittedPerIter: [flat(0.2)], headroom: 48 })
  test('admission: near empty, normal, long', () => {
    expect(classify(admission(0))).toBe('near-empty')
    expect(classify(admission(1))).toBe('normal')
    expect(classify(admission(8))).toBe('long')
  })

  const kv = (free: number, preempts = 0): KvReadings => ({ probe: 'kv', window: W, free: [flat(free)], blocks: 512, preempts: flat(preempts) as number[], capMisses: flat(0) as number[] })
  test('kv: exhausted only with pressure, then low free, normal, high free', () => {
    expect(classify(kv(0.02, 3))).toBe('exhausted')
    expect(classify(kv(0.02, 0))).toBe('low-free')
    expect(classify(kv(0.2))).toBe('low-free')
    expect(classify(kv(0.55))).toBe('normal')
    expect(classify(kv(0.9))).toBe('high-free')
  })

  test('kv reads the tail: a pool that shrank two minutes ago reads exhausted though the window began healthy', () => {
    const r = kv(0.6)
    r.free = [[...flat(0.6, 7), 0.01, 0.01, 0.01] as number[]]
    r.preempts = [...flat(0, 7), 5, 5, 5] as number[]
    expect(classify(r)).toBe('exhausted')
  })

  const workers = (up: boolean[], iters: number[]): WorkersReadings => ({
    probe: 'workers',
    window: W,
    up: up.map((u) => Array.from({ length: 10 }, () => u)),
    iterations: iters.map((n, w) => flat(up[w] ? n : null)),
    ticksPerMinute: 20,
  })
  test('workers: all up, one down, one slow (the straggler reserve)', () => {
    expect(classify(workers([true, true], [20, 20]))).toBe('all-up')
    expect(classify(workers([false, true], [0, 20]))).toBe('one-down')
    expect(classify(workers([true, true], [5, 20]))).toBe('one-slow')
  })

  const latency = (ttft: number, tpot: number, longShare: number, n = 30): LatencyReadings => ({
    probe: 'latency',
    window: W,
    ttftP95: flat(ttft) as number[],
    tpotP95: flat(tpot) as number[],
    tail: { n, ttftP95: ttft, tpotP95: tpot, longShare },
    split: [],
    longPrompt: 512,
    slo: { ttft: 20, tpot: 2 },
  })
  test('latency: TPOT up needs long prompts holding the prefill; else TTFT up past the SLO; else normal', () => {
    expect(classify(latency(5, 2.3, 0.7))).toBe('tpot-up')
    expect(classify(latency(5, 2.3, 0))).toBe('normal')
    expect(classify(latency(40, 2.3, 0))).toBe('ttft-up')
    expect(classify(latency(40, 1.2, 0))).toBe('ttft-up')
    expect(classify(latency(8, 1.3, 0))).toBe('normal')
    // nothing completed in the tail: TPOT is unknown, TTFT (censored at the deadline) still reads
    expect(classify(latency(40, 0, 0, 0))).toBe('ttft-up')
  })

  const errors = (shed: number, lost: number): ErrorsReadings => ({ probe: 'errors', window: W, shed: [shed, ...flat(0, 9)] as number[], lost: [lost, ...flat(0, 9)] as number[] })
  test('errors: lost beats shed beats none, over the whole window', () => {
    expect(classify(errors(0, 0))).toBe('none')
    expect(classify(errors(4, 0))).toBe('shed')
    expect(classify(errors(4, 9))).toBe('lost')
  })
})

/* ------------------------------------------------------------------ */
/* Streetlight and the expert (pure)                                   */
/* ------------------------------------------------------------------ */

describe('Streetlight and the expert', () => {
  test('before any probe all four faults are consistent and no probe is Streetlight', () => {
    expect(consistentFaults([])).toEqual([...INCIDENT_FAULTS])
    for (const p of PROBE_IDS) expect(isStreetlight(p, [])).toBe(false)
  })

  test('after intake reads normal, admission is Streetlight (every remaining fault predicts "long")', () => {
    const seen: Observation[] = [{ probe: 'intake', category: 'normal' }]
    expect(consistentFaults(seen)).toEqual(['pool-shrink', 'node-death', 'tenant-burst'])
    expect(isStreetlight('admission', seen)).toBe(true)
    expect(isStreetlight('kv', seen)).toBe(false)
    expect(streetlightFlags([...seen, { probe: 'admission', category: 'long' }])).toEqual([false, true])
  })

  test('a repeated probe is Streetlight: the consistent faults already agree on what it shows', () => {
    const seen: Observation[] = [{ probe: 'kv', category: 'normal' }]
    expect(isStreetlight('kv', seen)).toBe(true)
  })

  test('one odd reading never empties the consistent set: the faults with the fewest mismatches stay', () => {
    const seen: Observation[] = [
      { probe: 'workers', category: 'one-down' },
      { probe: 'kv', category: 'exhausted' },
    ]
    expect(consistentFaults(seen)).toEqual(['pool-shrink', 'node-death'])
  })

  test('on each fault’s EXPECTED readings the expert walks USE order, skips Streetlight and names the fault', () => {
    const paths: Record<string, string[]> = {}
    for (const fault of INCIDENT_FAULTS) {
      const seen: Observation[] = []
      for (;;) {
        const move = expertNext(seen)
        if (move.kind === 'fix') {
          expect(move.fault).toBe(fault)
          expect(move.fix).toBe(fixFor(fault))
          break
        }
        expect(seen.map((o) => o.probe)).not.toContain(move.probe)
        expect(isStreetlight(move.probe, seen)).toBe(false)
        seen.push({ probe: move.probe, category: EXPECTED[fault][move.probe] })
      }
      // probes come in USE order
      const order = seen.map((o) => PROBE_IDS.indexOf(o.probe))
      expect(order).toEqual([...order].sort((a, b) => a - b))
      paths[fault] = seen.map((o) => o.probe)
    }
    expect(paths).toEqual({
      'pool-shrink': ['intake', 'kv'],
      'drain-stall': ['intake'],
      'node-death': ['intake', 'kv'],
      'tenant-burst': ['intake', 'kv'],
    })
  })
})

/* ------------------------------------------------------------------ */
/* The clock and the score (pure)                                       */
/* ------------------------------------------------------------------ */

describe('the clock and the score', () => {
  test('action costs: a probe its cost, the right fix 1, a wrong fix 5, a wait 1, a hypothesis 0', () => {
    expect(actionMinutes({ kind: 'probe', probe: 'workers' })).toBe(3)
    expect(actionMinutes({ kind: 'fix', fix: 'restore-pool' }, true)).toBe(1)
    expect(actionMinutes({ kind: 'fix', fix: 'restore-pool' }, false)).toBe(WRONG_FIX_MINUTES)
    expect(actionMinutes({ kind: 'wait' })).toBe(1)
    expect(actionMinutes({ kind: 'hypothesis', fault: 'unsure' })).toBe(0)
  })

  test('a minute’s miss fraction is misses over outcomes, capped at 1, and 0 with no outcome', () => {
    expect(missFraction(3, 12)).toBe(0.25)
    expect(missFraction(5, 5)).toBe(1)
    expect(missFraction(0, 0)).toBe(0)
  })

  test('the alert fires at the end of the first minute after the onset whose 5-minute average exceeds 0.2', () => {
    const f = [0, 0, 0, 0, 0, 0, 0.3, 0.4, 0.4, 0.4, 0.4]
    // onset 6: averages over 5 minutes are 0.06, 0.14, 0.22 at minute 8, so the alert is at clock minute 9
    expect(averageMiss(f, 8)).toBeCloseTo(0.22)
    expect(alertMinute(f, 6)).toBe(9)
    expect(averageMiss(f, 7) > ALERT_MISS).toBe(false)
    // nothing yet and the fallback not reached
    expect(alertMinute([0, 0, 0, 0], 2)).toBeNull()
    // the fallback fires ALERT_LATEST minutes after the onset
    expect(alertMinute(new Array(30).fill(0), 2)).toBe(2 + ALERT_LATEST)
  })

  test('recovery needs the right fix and a 5-minute average under 0.05', () => {
    const f = [0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 0]
    expect(recoveredAt(f, 7, null)).toBe(false)
    expect(recoveredAt(f, 7, 3)).toBe(true)
    expect(recoveredAt(f, 6, 3)).toBe(averageMiss(f, 6) < RECOVER_MISS)
    expect(recoveredAt(f, 2, 3)).toBe(false)
  })

  test('burn sums the minutes from the alert to the end; the share string’s percent is round(100 × burn / 30)', () => {
    expect(burnOf([1, 1, 0.5, 0.25, 0, 0], 2, 5)).toBe(0.75)
    expect(burnPercent(5.4)).toBe(18)
    expect(burnPercent(BURN_BUDGET)).toBe(100)
  })
})

/* ------------------------------------------------------------------ */
/* The run and the session (on the engine)                              */
/* ------------------------------------------------------------------ */

describe('the scenario', () => {
  test('every incident’s FaultSpec is valid plain data at every severity and fleet size', () => {
    for (const fault of INCIDENT_FAULTS) {
      for (const severity of [1, 2, 3] as const) {
        for (const workers of [2, 4] as const) {
          const spec = { ...specFor(fault), severity, workers }
          const f = incidentFault(spec)
          expect(faultSpecProblems(f, workers)).toEqual([])
          expect(structuredClone(f)).toEqual(f)
          expect(f.untilTick).toBeUndefined()
        }
      }
    }
    expect(FAULT_PARAMS.poolBlocks.every((b, i, a) => i === 0 || b < a[i - 1])).toBe(true)
  })

  test('the trace is deterministic per traceSeed and covers the longest possible incident', () => {
    const spec = specFor('pool-shrink')
    const a = incidentTrace(spec)
    expect(incidentTrace(spec)).toEqual(a)
    expect(incidentTrace({ ...spec, traceSeed: spec.traceSeed + 1 })).not.toEqual(a)
    const lastMinute = Math.floor(a[a.length - 1].arrival / 20)
    expect(lastMinute).toBeGreaterThanOrEqual(spec.onsetMinute + ALERT_LATEST + LIMIT_MINUTES - 1)
  })

  test('a healthy fleet does not miss: every minute before the onset stays under the recovery bar', () => {
    for (const fault of INCIDENT_FAULTS) {
      for (let k = 0; k < 6; k++) {
        const spec = specFor(fault, undefined, k * 50)
        const run = new IncidentRun(spec)
        run.advanceTo(spec.onsetMinute)
        // minute 0 fills the fleet; from minute 1 on, a healthy fleet meets its SLO
        expect(run.missFractions.slice(1).every((x) => x < RECOVER_MISS)).toBe(true)
      }
    }
  }, SLOW)
})

describe('the session', () => {
  test('starts at the alert, and every action advances the clock by its cost', () => {
    const spec = specFor('pool-shrink')
    const s = new IncidentSession(spec)
    expect(s.clock).toBe(s.alertMinute)
    expect(s.alertMinute).toBeGreaterThan(spec.onsetMinute)
    s.hypothesis('unsure')
    expect(s.clock).toBe(s.alertMinute)
    const p = s.probe('intake')
    expect(p.minute).toBe(s.alertMinute + 2)
    expect(p.readings.window).toEqual({ from: p.minute - WINDOW_MINUTES, to: p.minute })
    expect(p.category).toBe(classify(p.readings))
    const wrong = s.fix('restore-drain')
    expect(wrong).toEqual({ minute: s.alertMinute + 2 + WRONG_FIX_MINUTES, effective: false })
    expect(s.wait()).toEqual({ minute: wrong.minute + 1 })
    const right = s.fix('restore-pool')
    expect(right).toEqual({ minute: wrong.minute + 2, effective: true })
    // a second application of the right fix is a wrong move: 5 minutes, no effect
    expect(s.ended).toBe(false)
    expect(s.fix('restore-pool')).toEqual({ minute: right.minute + WRONG_FIX_MINUTES, effective: false })
  }, SLOW)

  test('the right fix recovers the incident; finish runs to the end and the burn is the sum of the minutes', () => {
    const spec = specFor('drain-stall')
    const s = new IncidentSession(spec)
    s.hypothesis('drain-stall')
    s.probe('intake')
    s.fix('restore-drain')
    const out = s.finish()
    expect(out.recovered).toBe(true)
    expect(out.fixed).toBe(true)
    expect(out.diagnosed).toBe(true)
    expect(out.end).toBeLessThan(out.alert + LIMIT_MINUTES)
    expect(out.burn).toBe(burnOf(s.run.missFractions, out.alert, out.end))
    expect(averageMiss(s.run.missFractions, out.end - 1)).toBeLessThan(RECOVER_MISS)
    // after the end nothing moves the clock or counts
    const end = s.clock
    s.probe('kv')
    s.wait()
    expect(s.clock).toBe(end)
    expect(s.outcome().probes).toEqual(['intake'])
  }, SLOW)

  test('without the right fix the incident runs to the limit, unrecovered', () => {
    const spec = specFor('node-death')
    const s = new IncidentSession(spec)
    s.fix('restore-pool')
    const out = s.finish()
    expect(out.fixed).toBe(false)
    expect(out.recovered).toBe(false)
    expect(out.end).toBe(out.alert + LIMIT_MINUTES)
    expect(out.fix).toBe('restore-pool')
    expect(out.diagnosed).toBe(false)
  }, SLOW)

  test('hypotheses: the first counts only before any probe; the one held at the right fix is `hypothesis`', () => {
    const spec = specFor('tenant-burst')
    const s = new IncidentSession(spec)
    s.hypothesis('pool-shrink')
    s.probe('latency')
    s.hypothesis('tenant-burst')
    s.fix('limit-tenant')
    s.hypothesis('unsure')
    const out = s.finish()
    expect(out.firstHypothesis).toBe('pool-shrink')
    expect(out.hypothesis).toBe('tenant-burst')
    expect(out.diagnosed).toBe(true)
    const late = new IncidentSession(spec)
    late.probe('kv')
    late.hypothesis('tenant-burst')
    expect(late.outcome().firstHypothesis).toBeUndefined()
  }, SLOW)

  test('Streetlight probes are counted and named from what the learner saw', () => {
    const spec = specFor('pool-shrink')
    const s = new IncidentSession(spec)
    s.hypothesis('unsure')
    expect(s.probe('intake').category).toBe('normal')
    expect(s.probe('admission').category).toBe('long')
    s.probe('kv')
    s.probe('kv')
    const out = s.outcome()
    expect(out.probes).toEqual(['intake', 'admission', 'kv', 'kv'])
    expect(out.streetlightProbes).toEqual(['admission', 'kv'])
    expect(out.streetlight).toBe(2)
  }, SLOW)

  test('the burn of every action log stays finite and JSON-safe, and readings cross a structured clone', () => {
    const spec = specFor('node-death')
    const s = new IncidentSession(spec)
    for (const p of PROBE_IDS) {
      const r = s.probe(p)
      expect(structuredClone(r.readings)).toEqual(r.readings)
      // no NaN or Infinity anywhere (JSON would turn them into null)
      expect(JSON.parse(JSON.stringify(r.readings))).toEqual(r.readings)
    }
    const out = s.finish()
    expect(Number.isFinite(out.burn) && out.burn >= 0).toBe(true)
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
  }, SLOW)
})

describe('determinism, the expert and one scorer (W10, W11)', () => {
  const LOG: IncidentAction[] = [
    { kind: 'hypothesis', fault: 'unsure' },
    { kind: 'probe', probe: 'latency' },
    { kind: 'probe', probe: 'errors' },
    { kind: 'hypothesis', fault: 'pool-shrink' },
    { kind: 'fix', fix: 'restore-pool' },
    { kind: 'wait' },
    { kind: 'probe', probe: 'workers' },
    { kind: 'hypothesis', fault: 'node-death' },
    { kind: 'fix', fix: 'replace-node' },
  ]

  test('the same action log gives the same outcome, burn to the bit, every time', () => {
    const spec = specFor('node-death')
    const a = replayIncident(spec, LOG)
    const b = replayIncident(spec, LOG)
    expect(b).toEqual(a)
    expect(a.fixed).toBe(true)
    // the first fix, a wrong one, went in while the hypothesis was pool-shrink: that is the one scored, and the later
    // revision to the right fault changes nothing
    expect(a.diagnosed).toBe(false)
    expect(a.fix).toBe('replace-node')
    expect(a.hypothesis).toBe('pool-shrink')
  }, SLOW)

  test('a live session and a replay of its log agree', () => {
    const spec = specFor('tenant-burst', 4)
    const s = new IncidentSession(spec)
    s.hypothesis('unsure')
    s.probe('intake')
    s.probe('kv')
    s.hypothesis('tenant-burst')
    s.fix('limit-tenant')
    expect(replayIncident(spec, s.actions)).toEqual(s.finish())
  }, SLOW)

  test('the expert is deterministic, and its burn is a replay of its own log on the same scorer', () => {
    for (const fault of INCIDENT_FAULTS) {
      const spec = specFor(fault)
      const e = runExpert(spec)
      expect(runExpert(spec)).toEqual(e)
      expect(e.named).toBe(fault)
      expect(e.outcome.firstHypothesis).toBe('unsure')
      expect(e.outcome.diagnosed).toBe(true)
      expect(e.outcome.streetlight).toBe(0)
      expect(replayIncident(spec, e.actions)).toEqual(e.outcome)
      expect(e.steps.map((st) => st.probe)).toEqual(e.outcome.probes)
    }
  }, SLOW)

  test('a learner who wanders pays more than the expert, and scoreIncident gives the ledger’s score inputs', () => {
    const spec = specFor('pool-shrink', 2)
    const scored = scoreIncident(spec, LOG.slice(0, 5))
    const expert = runExpert(spec).outcome
    expect(scored.expertBurn).toBe(expert.burn)
    expect(scored.burn).toBeGreaterThan(expert.burn)
    expect(scored.fixed).toBe(true)
    expect(scored.diagnosed).toBe(true)
    const score = incidentScore(scored)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  }, SLOW)

  test('a stack factory supplies each worker’s drivers; the reference factory is the default run', () => {
    const spec = specFor('drain-stall', 4)
    let calls = 0
    const counted: StackFactory = (w, cfg, cap) => {
      calls++
      return referenceStack(w, cfg, cap)
    }
    const a = replayIncident(spec, LOG.slice(0, 3), { stack: counted })
    expect(calls).toBe(spec.workers)
    expect(a).toEqual(replayIncident(spec, LOG.slice(0, 3)))
  }, SLOW)
})
