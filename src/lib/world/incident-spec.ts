/**
 * world/incident-spec — the incident world as data (docs/specs/wave-2.md §9.2–9.4, task 2b-10).
 *
 * Pure and page-safe: it imports nothing from fleet-model.ts, at any depth (tests/world/incident.test.ts
 * walks the value imports), so the Daily page can read the catalogs, classify a reading and replay the
 * expert's decisions without pulling the engine into its bundle. world/incident-sim.ts runs a spec on the
 * Fleet engine; only the fleet worker host, the `sig` family and tests import that.
 *
 * WHAT IS HERE
 *   - `generateIncident(ns, key)`: an `IncidentSpec` from `hash32(`${ns}:${key}`)`, so everyone with the
 *     same date (or drill seed) gets the same incident without a server.
 *   - The catalogs: the four faults in play (`INCIDENT_FAULTS`, Q12) and the two held in reserve, the six
 *     probes in USE order with their costs, and the fixes.
 *   - Readings (what a probe shows: the last 10 incident minutes) and `classify`, which maps them to a
 *     category through `THRESHOLDS`. `EXPECTED[fault][probe]` is the category each fault produces.
 *   - The clock and the scoring rule as pure functions of per-minute miss fractions (`alertMinute`,
 *     `recoveredAt`, `burnOf`, `burnPercent`), so a session, a replay and a debrief agree to the bit.
 *   - Streetlight and the USE-ordered expert, both computed from `EXPECTED` alone.
 *
 * THE SCORING RULE (§9.3; the numbers below are scenario parameters, labelled synthetic)
 *   - One incident minute is `MINUTE_TICKS` engine ticks.
 *   - A request misses when its TTFT > `slo.ttft` or its TPOT > `slo.tpot`, or when it is shed or lost.
 *     Each request's outcome is counted once, in the minute it becomes known: at completion, when it
 *     is shed or lost, or when its TTFT deadline passes with no first token (a starving request is a
 *     miss from that moment, not when it finally completes). A minute's miss fraction is misses ÷
 *     outcomes in that minute (0 with no outcome). The SLO covers the chat traffic; a burst tenant's
 *     own requests are not chat (world/incident-sim's `SloBook` keeps the book).
 *   - The alert fires at the end of the first minute at or after the onset whose 5-minute average miss
 *     fraction exceeds `ALERT_MISS`; the learner's clock starts there. If none does within
 *     `ALERT_LATEST` minutes, the page fires then anyway (a slow fault is still an incident).
 *   - Every action advances the clock: a probe by its cost, the right fix by `FIX_MINUTES` (it lands
 *     when that minute is over), a wrong fix by `WRONG_FIX_MINUTES` with no effect, a wait by one.
 *   - The incident ends at the end of the first minute after the right fix landed whose 5-minute average
 *     falls below `RECOVER_MISS`, or `LIMIT_MINUTES` after the alert. `burn` is the sum of the minute
 *     fractions from the alert to the end, in burn-minutes; the budget is `BURN_BUDGET`.
 *
 * STREETLIGHT AND THE EXPERT (§9.3)
 *   A fault is consistent with what has been seen when no other catalog fault disagrees with fewer of
 *   the categories observed so far (`consistentFaults`: the faults with the fewest mismatches against
 *   `EXPECTED`; when one matches every observation this is exactly "the faults that match"). Taking the
 *   fewest mismatches rather than demanding a perfect match keeps one odd reading from emptying the set.
 *   A probe is Streetlight when every consistent fault predicts the same category for it, so it cannot
 *   tell them apart. The expert probes in USE order down the pipeline, skipping Streetlight probes and
 *   probes it has already read, until one fault remains, names it and applies its fix, then waits.
 *
 * OPUS CHECK (2b-10; tests/world/separability.test.ts): see the note above `EXPECTED`.
 */

import type { FaultId } from '@/lib/ledger/types'
import { hash32, splitmix32u } from '@/lib/rng'
import { FAULT_FIXES } from './faults'

/* ------------------------------------------------------------------ */
/* Catalogs                                                             */
/* ------------------------------------------------------------------ */

/** The faults in play (Q12): every generated incident injects one of these. */
export const INCIDENT_FAULTS = ['pool-shrink', 'drain-stall', 'node-death', 'tenant-burst'] as const satisfies readonly FaultId[]
/** Implemented in world/faults.ts and held in reserve: one replaces a first-four fault that fails separability. */
export const RESERVE_FAULTS = ['straggler', 'admission-greedy'] as const satisfies readonly FaultId[]

export type IncidentFault = (typeof INCIDENT_FAULTS)[number]

/** What a learner can name: a catalog fault, or "unsure". */
export type Hypothesis = IncidentFault | 'unsure'

/**
 * The hypothesis menu's wording: the one copy, shown by the flow (Hypothesis, Debrief) and gated by `verify-items`
 * through Act IV's `INCIDENTS`. One sentence per catalog fault with the same character and word count, and no
 * comma, colon, figure, acronym or hedge word, so no length or wording rule can tell the key from the rest.
 */
export const FAULT_LABELS: Record<IncidentFault, string> = {
  'pool-shrink': 'The cache memory pool shrank after a faulty setting',
  'drain-stall': 'The intake drain stalled far below the arrival rate',
  'node-death': 'A worker node died and dropped its running requests',
  'tenant-burst': 'One tenant flooded the fleet with very long prompts',
}

/**
 * The short form of each hypothesis label, for the places a full sentence does not fit: Act IV's "faults passed"
 * chips, its verdict lines and the debrief's quotes. The menus show `FAULT_LABELS`; this is a name for the same
 * fault, not a second menu, so it carries no gated text.
 */
export const FAULT_SHORT: Record<IncidentFault, string> = {
  'pool-shrink': 'Pool shrank',
  'drain-stall': 'Drain stalled',
  'node-death': 'Node died',
  'tenant-burst': 'Tenant flood',
}

/** The probes, in USE order down the pipeline (intake → admission → kv → workers → latency → errors). */
export const PROBE_IDS = ['intake', 'admission', 'kv', 'workers', 'latency', 'errors'] as const
export type ProbeId = (typeof PROBE_IDS)[number]

export interface ProbeDef {
  id: ProbeId
  label: string
  /** incident minutes the probe takes */
  cost: number
  /** what it shows, over the last `WINDOW_MINUTES` incident minutes */
  shows: string
}

export const PROBES: Record<ProbeId, ProbeDef> = {
  intake: { id: 'intake', label: 'Intake', cost: 2, shows: 'intake queue depth, drain rate and shed count' },
  admission: { id: 'admission', label: 'Admission', cost: 2, shows: "the scheduler's waiting list, admitted per iteration and decode headroom" },
  kv: { id: 'kv', label: 'KV cache', cost: 2, shows: 'free blocks, auto-preempts and capacity misses' },
  workers: { id: 'workers', label: 'Workers', cost: 3, shows: 'liveness and iterations per minute, per worker' },
  latency: { id: 'latency', label: 'Latency', cost: 3, shows: 'TTFT and TPOT p95, split by prompt-length band and tenant' },
  errors: { id: 'errors', label: 'Errors', cost: 2, shows: 'shed and lost in-flight requests over time' },
}

export type FixId = 'restore-pool' | 'restore-drain' | 'replace-node' | 'limit-tenant'

export interface FixDef {
  id: FixId
  /** the menu's full sentence, the one `verify-items` gates */
  label: string
  /** the short form for quotes in the debrief (see `FAULT_SHORT`) */
  short: string
  /** the fault it reverts */
  fault: IncidentFault
}

/**
 * The fix menu: one per catalog fault, from world/faults' revert column. The labels are the one copy the flow shows and
 * `verify-items` gates (Act IV's `INCIDENTS`), written to the same rule as `FAULT_LABELS`.
 */
export const FIXES: Record<FixId, FixDef> = {
  'restore-pool': { id: 'restore-pool', label: 'Put the cache memory fraction back where it was', short: 'Restore the pool', fault: 'pool-shrink' },
  'restore-drain': { id: 'restore-drain', label: 'Put the intake drain rate back where it belongs', short: 'Restore the drain', fault: 'drain-stall' },
  'replace-node': { id: 'replace-node', label: 'Replace the dead worker node with a healthy one', short: 'Replace the node', fault: 'node-death' },
  'limit-tenant': { id: 'limit-tenant', label: "Cap the noisy tenant's admissions at a low rate", short: 'Cap the tenant', fault: 'tenant-burst' },
}
export const FIX_IDS = Object.keys(FIXES) as FixId[]

/** The fix that reverts `fault` (world/faults' `FAULT_FIXES`, narrowed to the catalog). */
export function fixFor(fault: IncidentFault): FixId {
  return FAULT_FIXES[fault] as FixId
}

/* ------------------------------------------------------------------ */
/* The scenario clock and scoring parameters (synthetic)               */
/* ------------------------------------------------------------------ */

/** Engine ticks in one incident minute (a scenario scale). */
export const MINUTE_TICKS = 20
/** A probe shows this many incident minutes up to now. */
export const WINDOW_MINUTES = 10
/** classify reads the current state from the last few minutes of a window. */
export const TAIL_MINUTES = 3
/** Minutes averaged for the alert and the recovery. */
export const AVERAGE_MINUTES = 5
/** The alert fires when the 5-minute average miss fraction first exceeds this after the onset. */
export const ALERT_MISS = 0.2
/** ... or this many minutes after the onset, whichever comes first. */
export const ALERT_LATEST = 15
/** The incident ends when the 5-minute average falls below this after the right fix. */
export const RECOVER_MISS = 0.05
/** ... or this many minutes after the alert. */
export const LIMIT_MINUTES = 60
/** The error budget, in burn-minutes. */
export const BURN_BUDGET = 30
export const FIX_MINUTES = 1
export const WRONG_FIX_MINUTES = 5
export const WAIT_MINUTES = 1

/* ------------------------------------------------------------------ */
/* The generator                                                        */
/* ------------------------------------------------------------------ */

export type IncidentNs = 'daily' | 'drill' | 'team' | 'sig'

export interface IncidentSpec {
  /** hash32(`${ns}:${key}`) (rng.ts, FNV-1a) */
  seed: number
  ns: IncidentNs
  /** the date, a fresh seed's hex, or a team code + date */
  key: string
  /** from the catalog, balanced over seeds */
  fault: IncidentFault
  /** scales the fault's parameter (world/incident-sim's `FAULT_PARAMS`) */
  severity: 1 | 2 | 3
  /** incident minutes after the start */
  onsetMinute: number
  workers: 2 | 4
  /** ticks; scenario numbers, labelled synthetic */
  slo: { ttft: number; tpot: number }
  traceSeed: number
}

/** The service-level objective every incident is scored against (synthetic; see `SCENARIO_NOTE`). */
export const INCIDENT_SLO = { ttft: 20, tpot: 2 } as const

/** Earliest and latest onset minute: the fleet warms up to a steady state first. */
export const ONSET_RANGE = [8, 12] as const

export const SCENARIO_NOTE =
  'Synthetic scenario: one incident minute is 20 engine ticks, and the fleet, its traffic and its SLO are scenario numbers, not measurements of a real deployment.'

/**
 * The incident for `(ns, key)`. Pure and cheap: it draws from splitmix32 seeded by the FNV-1a hash of
 * the pair, so the same date gives everyone the same incident and a fresh drill seed a fresh one.
 */
export function generateIncident(ns: IncidentNs, key: string): IncidentSpec {
  const seed = hash32(`${ns}:${key}`)
  const next = splitmix32u(seed)
  const fault = INCIDENT_FAULTS[next() % INCIDENT_FAULTS.length]
  const severity = (1 + (next() % 3)) as 1 | 2 | 3
  const onsetMinute = ONSET_RANGE[0] + (next() % (ONSET_RANGE[1] - ONSET_RANGE[0] + 1))
  const workers = workersFor(next())
  const traceSeed = next()
  return { seed, ns, key, fault, severity, onsetMinute, workers, slo: { ...INCIDENT_SLO }, traceSeed }
}

/**
 * Fleet size: two or four workers, drawn from the seed and never from the fault. The size is on the screen before
 * the first probe (every per-worker reading has a row per worker), so a size that depended on the fault would
 * name it: node death once always ran on two workers, which ruled it out on any four-worker fleet. A death on
 * four workers is made an incident by `FAULT_PARAMS.deathLoad`, which offers the fleet more load so the three
 * survivors are overloaded as the one survivor of two is.
 */
function workersFor(draw: number): 2 | 4 {
  return draw % 2 === 0 ? 2 : 4
}

/* ------------------------------------------------------------------ */
/* Readings                                                             */
/* ------------------------------------------------------------------ */

/** The window a reading covers: incident minutes [from, to), oldest first in every series. */
export interface ReadingWindow {
  from: number
  to: number
}

/** Series indexed [worker][minute]; `null` while that worker is down. */
export type PerWorker = (number | null)[][]

export interface IntakeReadings {
  probe: 'intake'
  window: ReadingWindow
  /** mean queued requests per minute */
  depth: PerWorker
  /** requests drained per tick now, per worker (`null`: down) */
  drainPerTick: (number | null)[]
  /** the configured drain, per tick */
  configuredDrain: number
  capacity: number
  /** requests shed by a full intake, per minute, fleet-wide */
  shed: number[]
}

export interface AdmissionReadings {
  probe: 'admission'
  window: ReadingWindow
  /** mean waiting list per minute */
  waiting: PerWorker
  /** requests admitted per scheduler iteration */
  admittedPerIter: PerWorker
  /** decode headroom the scheduler budgets per running request, tokens */
  headroom: number
}

export interface KvReadings {
  probe: 'kv'
  window: ReadingWindow
  /** mean free share of the pool (0–1) per minute */
  free: PerWorker
  /** blocks in each worker's pool, as configured */
  blocks: number
  /** auto-preempts (a decode append failed) per minute, fleet-wide */
  preempts: number[]
  /** admissions the block manager refused per minute, fleet-wide */
  capMisses: number[]
}

export interface WorkersReadings {
  probe: 'workers'
  window: ReadingWindow
  /** whether each worker was up at the end of each minute */
  up: boolean[][]
  /** scheduler iterations run per minute */
  iterations: PerWorker
  ticksPerMinute: number
}

export interface LatencyBand {
  band: 'short' | 'long'
  tenant: number
  n: number
  ttftP95: number
  tpotP95: number
}

export interface LatencyReadings {
  probe: 'latency'
  window: ReadingWindow
  /** p95 over each minute's completions (0 in a minute with none) */
  ttftP95: number[]
  tpotP95: number[]
  /** over the last `TAIL_MINUTES` minutes: the current state the category reads */
  tail: { n: number; ttftP95: number; tpotP95: number; longShare: number }
  /** over the whole window, split by prompt-length band and tenant */
  split: LatencyBand[]
  /** prompts of at least this many tokens are "long" */
  longPrompt: number
  slo: { ttft: number; tpot: number }
}

export interface ErrorsReadings {
  probe: 'errors'
  window: ReadingWindow
  /** shed by a full intake, per minute */
  shed: number[]
  /** in flight on a node when it died, per minute */
  lost: number[]
}

export type ProbeReadings = IntakeReadings | AdmissionReadings | KvReadings | WorkersReadings | LatencyReadings | ErrorsReadings

/* ------------------------------------------------------------------ */
/* Categories and classify                                              */
/* ------------------------------------------------------------------ */

export interface CategoryByProbe {
  intake: 'normal' | 'elevated' | 'full-shedding'
  admission: 'near-empty' | 'normal' | 'long'
  kv: 'exhausted' | 'low-free' | 'normal' | 'high-free'
  workers: 'all-up' | 'one-down' | 'one-slow'
  latency: 'normal' | 'ttft-up' | 'tpot-up'
  errors: 'none' | 'shed' | 'lost'
}
export type Category = CategoryByProbe[ProbeId]

/** Every category a probe can return, in the order a menu shows them. */
export const CATEGORIES: { [P in ProbeId]: readonly CategoryByProbe[P][] } = {
  intake: ['normal', 'elevated', 'full-shedding'],
  admission: ['near-empty', 'normal', 'long'],
  kv: ['exhausted', 'low-free', 'normal', 'high-free'],
  workers: ['all-up', 'one-down', 'one-slow'],
  latency: ['normal', 'ttft-up', 'tpot-up'],
  errors: ['none', 'shed', 'lost'],
}

export const CATEGORY_LABELS: Record<Category, string> = {
  normal: 'normal',
  elevated: 'elevated',
  'full-shedding': 'full, shedding',
  'near-empty': 'near empty',
  long: 'long',
  exhausted: '≈ 0 free, preempts rising',
  'low-free': 'low free',
  'high-free': 'high free',
  'all-up': 'all up',
  'one-down': 'one down',
  'one-slow': 'one slow',
  'ttft-up': 'TTFT up, TPOT flat',
  'tpot-up': 'TPOT up, long prompts dominate',
  none: 'none',
  shed: 'shed',
  lost: 'lost in-flight at onset',
}

/**
 * The thresholds `classify` reads (the Opus check fixed them; see the note above `EXPECTED`). Every one
 * reads the tail of the window (the current state), except the errors probe, which reads events over
 * the whole window.
 */
export const THRESHOLDS = {
  /** intake: full when a live worker's queue holds this share of its capacity, or the intake shed */
  intakeFull: 0.4,
  /** intake: elevated at this many queued requests per live worker */
  intakeElevated: 2,
  /** admission: near empty below this many waiting per live worker; long at `admissionLong` or more */
  admissionEmpty: 0.5,
  admissionLong: 3,
  /** kv: exhausted below this free share with preempts or capacity misses in the tail */
  kvExhausted: 0.08,
  /** kv: low free below this share, high free above `kvHigh` */
  kvLow: 0.35,
  kvHigh: 0.78,
  /** workers: one slow when a live worker ran fewer than this share of the ticks as iterations */
  workerSlow: 0.6,
  /** latency: TPOT up when the tail's TPOT p95 is above this share of the TPOT SLO and long prompts hold `longShare` of the prefill */
  tpotUp: 0.9,
  longShare: 0.35,
  /** latency: TTFT up when the tail's TTFT p95 is above the TTFT SLO */
  ttftUp: 1,
}

/** Prompts of at least this many tokens are "long" in the latency split. */
export const LONG_PROMPT = 512

const tailOf = <T>(xs: T[]) => xs.slice(Math.max(0, xs.length - TAIL_MINUTES))
const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
/** Mean over the tail of each live worker's series, then over those workers (`[]` when none is up). */
function liveTailMeans(s: PerWorker): number[] {
  const out: number[] = []
  for (const series of s) {
    const tail = tailOf(series).filter((v): v is number => v !== null)
    if (tail.length) out.push(meanOf(tail))
  }
  return out
}

function classifyIntake(r: IntakeReadings): CategoryByProbe['intake'] {
  const depths = liveTailMeans(r.depth)
  const shedNow = tailOf(r.shed).some((n) => n > 0)
  if (shedNow || depths.some((d) => d >= THRESHOLDS.intakeFull * r.capacity)) return 'full-shedding'
  return meanOf(depths) >= THRESHOLDS.intakeElevated ? 'elevated' : 'normal'
}

function classifyAdmission(r: AdmissionReadings): CategoryByProbe['admission'] {
  const waiting = meanOf(liveTailMeans(r.waiting))
  if (waiting < THRESHOLDS.admissionEmpty) return 'near-empty'
  return waiting >= THRESHOLDS.admissionLong ? 'long' : 'normal'
}

function classifyKv(r: KvReadings): CategoryByProbe['kv'] {
  const free = meanOf(liveTailMeans(r.free))
  const pressure = tailOf(r.preempts).reduce((a, b) => a + b, 0) + tailOf(r.capMisses).reduce((a, b) => a + b, 0)
  if (free < THRESHOLDS.kvExhausted && pressure > 0) return 'exhausted'
  if (free < THRESHOLDS.kvLow) return 'low-free'
  return free > THRESHOLDS.kvHigh ? 'high-free' : 'normal'
}

function classifyWorkers(r: WorkersReadings): CategoryByProbe['workers'] {
  if (r.up.some((series) => series.length > 0 && !series[series.length - 1])) return 'one-down'
  const slow = r.iterations.some((series, w) => {
    const live = tailOf(series).filter((v, i): v is number => v !== null && tailOf(r.up[w])[i])
    return live.length > 0 && meanOf(live) < THRESHOLDS.workerSlow * r.ticksPerMinute
  })
  return slow ? 'one-slow' : 'all-up'
}

function classifyLatency(r: LatencyReadings): CategoryByProbe['latency'] {
  if (r.tail.n > 0 && r.tail.tpotP95 > THRESHOLDS.tpotUp * r.slo.tpot && r.tail.longShare >= THRESHOLDS.longShare) return 'tpot-up'
  return r.tail.ttftP95 > THRESHOLDS.ttftUp * r.slo.ttft ? 'ttft-up' : 'normal'
}

function classifyErrors(r: ErrorsReadings): CategoryByProbe['errors'] {
  if (r.lost.some((n) => n > 0)) return 'lost'
  return r.shed.some((n) => n > 0) ? 'shed' : 'none'
}

/** The category a probe's readings fall in. */
export function classify<P extends ProbeId>(readings: Extract<ProbeReadings, { probe: P }>): CategoryByProbe[P]
export function classify(readings: ProbeReadings): Category
export function classify(readings: ProbeReadings): Category {
  switch (readings.probe) {
    case 'intake':
      return classifyIntake(readings)
    case 'admission':
      return classifyAdmission(readings)
    case 'kv':
      return classifyKv(readings)
    case 'workers':
      return classifyWorkers(readings)
    case 'latency':
      return classifyLatency(readings)
    case 'errors':
      return classifyErrors(readings)
  }
}

/* ------------------------------------------------------------------ */
/* Signatures                                                           */
/* ------------------------------------------------------------------ */

export type CategoryVector = { [P in ProbeId]: CategoryByProbe[P] }

/**
 * The category each fault produces on each probe (§9.2's table).
 *
 * OPUS CHECK (2b-10; tests/world/separability.test.ts holds it on 1,000 seeds per fault and prints the
 * record). One cell differs from §9.2: node death's intake is "normal", not "elevated". The surviving workers'
 * drain (6 per tick) empties the intake every tick however overloaded the scheduler is, so the overload
 * shows in the waiting list (admission "long"), never in the queue; 2b-03's fault test measured the same
 * and asked 2b-10 to read it relative to the healthy fleet or call it normal. Calling it normal keeps the
 * four vectors distinct (node death still differs from pool shrink on kv, workers and errors).
 */
export const EXPECTED: Record<IncidentFault, CategoryVector> = {
  'pool-shrink': { intake: 'normal', admission: 'long', kv: 'exhausted', workers: 'all-up', latency: 'ttft-up', errors: 'none' },
  'drain-stall': { intake: 'full-shedding', admission: 'near-empty', kv: 'high-free', workers: 'all-up', latency: 'ttft-up', errors: 'shed' },
  'node-death': { intake: 'normal', admission: 'long', kv: 'normal', workers: 'one-down', latency: 'ttft-up', errors: 'lost' },
  'tenant-burst': { intake: 'normal', admission: 'long', kv: 'low-free', workers: 'all-up', latency: 'tpot-up', errors: 'none' },
}

/** One probe result as the learner (or the expert) saw it. */
export interface Observation {
  probe: ProbeId
  category: Category
}

/** How many observations disagree with `fault`'s expected categories. */
export function mismatches(fault: IncidentFault, observed: readonly Observation[]): number {
  let n = 0
  for (const o of observed) if (EXPECTED[fault][o.probe] !== o.category) n++
  return n
}

/** The catalog faults that disagree with the fewest observations (all four before the first probe). */
export function consistentFaults(observed: readonly Observation[]): IncidentFault[] {
  const counts = INCIDENT_FAULTS.map((f) => mismatches(f, observed))
  const least = Math.min(...counts)
  return INCIDENT_FAULTS.filter((_, i) => counts[i] === least)
}

/** A probe is Streetlight when every fault still consistent with `observed` predicts the same category for it. */
export function isStreetlight(probe: ProbeId, observed: readonly Observation[]): boolean {
  const candidates = consistentFaults(observed)
  return new Set(candidates.map((f) => EXPECTED[f][probe])).size <= 1
}

/** For each probe in `probes` (in the order taken), whether it was Streetlight given what had been seen before it. */
export function streetlightFlags(observed: readonly Observation[]): boolean[] {
  return observed.map((o, i) => isStreetlight(o.probe, observed.slice(0, i)))
}

/** The expert's next move given what it has seen: the first informative unread probe in USE order, or the fix once one fault remains. */
export type ExpertMove = { kind: 'probe'; probe: ProbeId } | { kind: 'fix'; fault: IncidentFault; fix: FixId }

export function expertNext(observed: readonly Observation[]): ExpertMove {
  const candidates = consistentFaults(observed)
  if (candidates.length > 1) {
    const read = new Set(observed.map((o) => o.probe))
    const probe = PROBE_IDS.find((p) => !read.has(p) && !isStreetlight(p, observed))
    if (probe) return { kind: 'probe', probe }
  }
  // one fault left, or nothing unread can split the rest: the first in catalog order
  const fault = candidates[0]
  return { kind: 'fix', fault, fix: fixFor(fault) }
}

/* ------------------------------------------------------------------ */
/* Actions, the clock and the score                                     */
/* ------------------------------------------------------------------ */

export type IncidentAction =
  | { kind: 'hypothesis'; fault: Hypothesis }
  | { kind: 'probe'; probe: ProbeId }
  | { kind: 'fix'; fix: FixId }
  | { kind: 'wait' }

/** Incident minutes an action takes. A fix's cost depends on whether it was the right one. */
export function actionMinutes(action: IncidentAction, rightFix = false): number {
  switch (action.kind) {
    case 'hypothesis':
      return 0
    case 'probe':
      return PROBES[action.probe].cost
    case 'fix':
      return rightFix ? FIX_MINUTES : WRONG_FIX_MINUTES
    case 'wait':
      return WAIT_MINUTES
  }
}

/** A minute's miss fraction from its counts (see the scoring rule above). */
export function missFraction(misses: number, outcomes: number): number {
  return outcomes === 0 ? 0 : Math.min(1, misses / outcomes)
}

/** The average miss fraction over the `AVERAGE_MINUTES` minutes ending with minute `m` (fewer at the very start). */
export function averageMiss(fractions: readonly number[], m: number): number {
  const from = Math.max(0, m - AVERAGE_MINUTES + 1)
  let sum = 0
  for (let i = from; i <= m; i++) sum += fractions[i]
  return sum / AVERAGE_MINUTES
}

/**
 * The clock minute the alert fires: the end of the first minute at or after `onset` whose average
 * exceeds `ALERT_MISS`, or `onset + ALERT_LATEST`. `null` while neither has been reached in `fractions`.
 */
export function alertMinute(fractions: readonly number[], onset: number): number | null {
  for (let m = onset; m < fractions.length && m < onset + ALERT_LATEST; m++) {
    if (averageMiss(fractions, m) > ALERT_MISS) return m + 1
  }
  return fractions.length >= onset + ALERT_LATEST ? onset + ALERT_LATEST : null
}

/** Whether the incident has recovered by the end of minute `m`, given the right fix landed at clock minute `fixedAt`. */
export function recoveredAt(fractions: readonly number[], m: number, fixedAt: number | null): boolean {
  return fixedAt !== null && m >= fixedAt && averageMiss(fractions, m) < RECOVER_MISS
}

/** Burn-minutes from the alert to the end (clock minutes [alert, end)). */
export function burnOf(fractions: readonly number[], alert: number, end: number): number {
  let sum = 0
  for (let m = alert; m < end && m < fractions.length; m++) sum += fractions[m]
  return Math.round(sum * 1000) / 1000
}

/** The share string's percentage: `round(100 × burn / BURN_BUDGET)`. */
export function burnPercent(burn: number): number {
  return Math.round((100 * burn) / BURN_BUDGET)
}
