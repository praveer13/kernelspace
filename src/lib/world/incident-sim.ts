/**
 * world/incident-sim — an incident spec run on the Fleet engine (docs/specs/wave-2.md §9.2–9.3, task 2b-10).
 *
 * `IncidentRun` is the world: a JSQ cluster of `spec.workers` engines (reference drivers, or the
 * learner's through `stack`), a seeded steady chat trace and one FaultSpec v2 from world/faults.ts at
 * the spec's onset. It steps an incident minute (`MINUTE_TICKS` ticks) at a time and keeps a record
 * per minute: what each probe can show, and the minute's miss fraction under the spec's SLO. Probes
 * only read records, so looking never changes the world; only a fix does.
 *
 * `IncidentSession` is the clock over a run (§9.3): it starts at the alert, takes the learner's actions
 * (hypothesis, probe, fix, wait) one at a time, and `finish()` runs on to recovery or the limit. The
 * outcome is a function of `(spec, stack, actions)` alone (W10): `replayIncident` replays a log, and
 * `runExpert` plays the USE-ordered expert through the same session class on the same stack, so the
 * learner's burn and the expert's come from one scorer on one clock (W11).
 *
 * The scenario (`INCIDENT_SCENARIO`, `FAULT_PARAMS`) is synthetic, and the Opus check tuned it so every
 * catalog fault alerts, shows its signature and recovers after its fix (tests/world/separability.test.ts).
 *
 * Only the fleet worker host, the `sig` family and tests import this file: it pulls in the engine.
 */

import {
  Cluster,
  Engine,
  HEADROOM_TOKENS,
  makeRefManager,
  makeRefQueue,
  makeRefScheduler,
  type EngineConfig,
  type ManagerDriver,
  type QueueDriver,
  type RequestSpec,
  type SchedulerDriver,
} from '@/lib/fleet-model'
import { splitmix32u } from '@/lib/rng'
import { makeFaultInjector, type FaultSpec } from './faults'
import {
  FIXES,
  LIMIT_MINUTES,
  LONG_PROMPT,
  MINUTE_TICKS,
  PROBES,
  TAIL_MINUTES,
  WINDOW_MINUTES,
  ALERT_LATEST,
  actionMinutes,
  alertMinute,
  burnOf,
  classify,
  consistentFaults,
  expertNext,
  missFraction,
  recoveredAt,
  streetlightFlags,
  type Category,
  type CategoryVector,
  type FixId,
  type Hypothesis,
  type IncidentAction,
  type IncidentFault,
  type IncidentSpec,
  type LatencyBand,
  type Observation,
  type PerWorker,
  type ProbeId,
  type ProbeReadings,
  PROBE_IDS,
} from './incident-spec'

/* ------------------------------------------------------------------ */
/* The scenario                                                         */
/* ------------------------------------------------------------------ */

/**
 * The fleet every incident runs on (synthetic; the Opus check chose it, tests/world/separability.test.ts).
 *   - A 512-block pool, so chat traffic is bound by running slots, not memory: KV free then reads "normal"
 *     on a healthy or overloaded worker, and only a shrunk pool or a burst of long prompts drains it.
 *   - 24 running slots, so a burst tenant's long prompts get in beside the chat and stack up; with 16 the
 *     chat filled the slots, the burst ran about one prompt at a time per worker, and `limit-tenant`
 *     (one running per worker) changed nothing.
 *   - Chunked-prefill interference on, so long prefills slow everyone's decode (the tenant-burst
 *     signature), and Act II's intake drain (6 per tick) behind a 16-deep queue, so a stalled drain fills
 *     it and sheds within a few minutes.
 *   - Offered load 55 % of capacity: a healthy fleet never misses its SLO, and a fixed one drains its
 *     backlog in minutes.
 */
export const INCIDENT_SCENARIO = {
  cfg: { numBlocks: 512, blockSize: 16, maxRunning: 24, sloTtft: 20, prefillChunk: 128, interference: true } satisfies EngineConfig,
  intakeCap: 16,
  drainPerTick: 6,
  /** requests a worker serves per tick at saturation on this trace (measured) */
  capacity: 0.507,
  /** offered load as a share of the fleet's capacity */
  load: 0.55,
  prompt: [32, 320] as const,
  output: [12, 64] as const,
}

export type IncidentScenario = typeof INCIDENT_SCENARIO

/**
 * Each fault's parameter by severity (1, 2, 3). `drainShare` is the stalled drain as a share of a
 * worker's arrival rate; `burstEvery` is the fleet-wide gap between a burst tenant's requests on a
 * one-worker fleet (it divides by the worker count); node death has no parameter, so its severity
 * raises the load the survivor inherits.
 */
export const FAULT_PARAMS = {
  poolBlocks: [96, 72, 48],
  drainShare: [0.4, 0.25, 0.1],
  burstPrompt: [1024, 1536, 1536],
  burstEvery: [4, 4, 3],
  deathLoad: [0.08, 0.1, 0.12],
}

/** Requests per tick the whole fleet is offered. */
function arrivalRate(spec: IncidentSpec, sc: IncidentScenario): number {
  const extra = spec.fault === 'node-death' ? FAULT_PARAMS.deathLoad[spec.severity - 1] : 0
  return (sc.load + extra) * sc.capacity * spec.workers
}

/** Minutes of trace every incident needs: warm-up, the latest alert and the limit after it. */
export function runMinutes(spec: IncidentSpec): number {
  return spec.onsetMinute + ALERT_LATEST + LIMIT_MINUTES + 1
}

/**
 * The steady chat trace: `rate` arrivals per tick, spread evenly with a seeded phase (bursty arrivals
 * would make a healthy fleet look like an incident on a two-worker fleet), prompts and outputs uniform.
 */
export function incidentTrace(spec: IncidentSpec, sc: IncidentScenario = INCIDENT_SCENARIO): RequestSpec[] {
  const next = splitmix32u(spec.traceSeed)
  const rate = arrivalRate(spec, sc)
  const ticks = runMinutes(spec) * MINUTE_TICKS
  const [pLo, pHi] = sc.prompt
  const [oLo, oHi] = sc.output
  const out: RequestSpec[] = []
  let credit = (next() % 1000) / 1000
  let id = 1
  for (let t = 0; t < ticks; t++) {
    credit += rate
    const n = Math.floor(credit)
    credit -= n
    for (let i = 0; i < n; i++) {
      out.push({ id: id++, arrival: t, prompt: pLo + (next() % (pHi - pLo + 1)), output: oLo + (next() % (oHi - oLo + 1)) })
    }
  }
  return out
}

/** The FaultSpec an incident injects at its onset (no `untilTick`: the session sets it when the right fix lands). */
export function incidentFault(spec: IncidentSpec, sc: IncidentScenario = INCIDENT_SCENARIO): FaultSpec {
  const atTick = spec.onsetMinute * MINUTE_TICKS
  const s = spec.severity - 1
  switch (spec.fault) {
    case 'pool-shrink':
      return { kind: 'pool-shrink', worker: 'all', atTick, blocks: FAULT_PARAMS.poolBlocks[s] }
    case 'drain-stall':
      return { kind: 'drain-stall', atTick, perTick: (arrivalRate(spec, sc) / spec.workers) * FAULT_PARAMS.drainShare[s] }
    case 'node-death':
      return { kind: 'node-death', worker: splitmix32u(spec.traceSeed ^ 0xdead)() % spec.workers, atTick }
    case 'tenant-burst':
      return {
        kind: 'tenant-burst',
        fromTick: atTick,
        toTick: runMinutes(spec) * MINUTE_TICKS,
        every: Math.max(1, Math.round(FAULT_PARAMS.burstEvery[s] / spec.workers)),
        prompt: FAULT_PARAMS.burstPrompt[s],
      }
  }
}

/* ------------------------------------------------------------------ */
/* The run                                                              */
/* ------------------------------------------------------------------ */

/** The drivers one worker runs: its scheduler, block manager and intake queue. */
export interface WorkerStack {
  sched: SchedulerDriver
  mgr: ManagerDriver
  queue: QueueDriver
}

/** Builds worker `w`'s drivers; the default is the reference stack. 2b-15 passes the learner's installed modules. */
export type StackFactory = (worker: number, cfg: EngineConfig, intakeCap: number) => WorkerStack

export const referenceStack: StackFactory = (_w, cfg, intakeCap) => ({
  sched: makeRefScheduler(),
  mgr: makeRefManager(cfg.numBlocks, cfg.blockSize),
  queue: makeRefQueue(intakeCap),
})

export interface IncidentOptions {
  stack?: StackFactory
  /** tuning and tests only */
  scenario?: IncidentScenario
}

interface Done {
  ttft: number
  tpot: number
  prompt: number
  tenant: number
}

/** What one incident minute left behind. */
interface MinuteRecord {
  up: boolean[]
  depth: (number | null)[]
  drain: (number | null)[]
  waiting: (number | null)[]
  admittedPerIter: (number | null)[]
  free: (number | null)[]
  iterations: (number | null)[]
  shed: number
  lost: number
  preempts: number
  capMisses: number
  done: Done[]
  /** chat TTFTs that became known this minute (at the first token, or censored at the deadline) */
  ttfts: number[]
  fraction: number
  headroom: number
}

/** Ticks the book waits past a deadline before calling it, so a first token on the deadline's tick has been seen. */
const SIGHTING_LAG = 2

interface OpenRequest {
  arrival: number
  output: number
  worker: number
  /** the iteration a view first showed it holding a token (its first token came no later than the tick before) */
  seenAt: number | null
}

/**
 * Every chat request's SLO outcome, decided once and as soon as it is known (§9.3): shed when the
 * intake refuses it, lost when its node dies, a miss once its TTFT deadline passes with no first token
 * (or its last token is overdue), and otherwise at completion by its TTFT and TPOT. Counting at the
 * deadline matters because the reference scheduler serves short prompts first: under overload a long
 * prompt starves without completing, and a book that waited for completions would see the incident late.
 * The book watches through thin wrappers around each worker's intake queue and scheduler, so it works
 * the same on the learner's modules.
 */
class SloBook {
  private readonly open = new Map<number, OpenRequest>()
  private misses = 0
  private outcomes = 0
  /** TTFTs that became known since the last take: at the first token, or censored at the deadline */
  private ttfts: number[] = []
  private readonly chat: Map<number, RequestSpec>
  private readonly slo: { ttft: number; tpot: number }
  /** the trace in arrival order, and how far `overdue` has checked that each request reached a worker */
  private readonly arrivals: RequestSpec[]
  private routedUpTo = 0
  private readonly routed = new Set<number>()

  constructor(trace: RequestSpec[], slo: { ttft: number; tpot: number }) {
    this.chat = new Map(trace.map((r) => [r.id, r]))
    this.arrivals = trace
    this.slo = slo
  }

  private decide(miss: boolean): void {
    this.outcomes++
    if (miss) this.misses++
  }

  pushed(id: number, worker: number, accepted: boolean): void {
    const r = this.chat.get(id)
    if (!r || this.routed.has(id)) return
    this.routed.add(id)
    if (!accepted) this.decide(true)
    else this.open.set(id, { arrival: r.arrival, output: r.output, worker, seenAt: null })
  }

  sawToken(id: number, iter: number): void {
    const o = this.open.get(id)
    if (!o || o.seenAt !== null) return
    o.seenAt = iter
    // a view runs every iteration, so the token landed on the tick before this one
    this.ttfts.push(iter - 1 - o.arrival)
  }

  finished(id: number, ttft: number, tpot: number): void {
    const o = this.open.get(id)
    if (!o) return
    this.open.delete(id)
    if (o.seenAt === null) this.ttfts.push(ttft)
    this.decide(ttft > this.slo.ttft || tpot > this.slo.tpot)
  }

  /** A node died: everything it held is lost. */
  lostOn(worker: number): void {
    for (const [id, o] of this.open) {
      if (o.worker !== worker) continue
      this.open.delete(id)
      this.decide(true)
    }
  }

  /** Call the requests whose deadline has certainly passed by `now` (the next tick to run). */
  overdue(now: number): void {
    const last = now - SIGHTING_LAG
    // a request the router could not place (no live worker) never reached an intake: shed
    for (; this.routedUpTo < this.arrivals.length && this.arrivals[this.routedUpTo].arrival < last; this.routedUpTo++) {
      if (!this.routed.has(this.arrivals[this.routedUpTo].id)) this.decide(true)
    }
    for (const [id, o] of this.open) {
      const late =
        o.seenAt === null ? o.arrival + this.slo.ttft < last : o.seenAt - 1 + (o.output - 1) * this.slo.tpot < last
      if (!late) continue
      this.open.delete(id)
      if (o.seenAt === null) this.ttfts.push(last - o.arrival)
      this.decide(true)
    }
  }

  /** Misses, outcomes and known TTFTs since the last take. */
  take(): { misses: number; outcomes: number; ttfts: number[] } {
    const out = { misses: this.misses, outcomes: this.outcomes, ttfts: this.ttfts }
    this.misses = 0
    this.outcomes = 0
    this.ttfts = []
    return out
  }
}

const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] : 0)

export class IncidentRun {
  readonly spec: IncidentSpec
  readonly scenario: IncidentScenario
  /** this run's copy of the fault: the right fix sets its `untilTick`, which the injector reads every tick */
  readonly fault: FaultSpec
  readonly cluster: Cluster
  private readonly records: MinuteRecord[] = []
  private readonly fractions: number[] = []
  private finished: Done[] = []
  private lost = 0
  private readonly book: SloBook
  /** the clock minute the right fix landed (its `untilTick` is the first tick of that minute) */
  fixedAt: number | null = null

  constructor(spec: IncidentSpec, opts: IncidentOptions = {}) {
    this.spec = spec
    this.scenario = opts.scenario ?? INCIDENT_SCENARIO
    const sc = this.scenario
    const cfg: EngineConfig = { ...sc.cfg, sloTtft: spec.slo.ttft }
    const stack = opts.stack ?? referenceStack
    const trace = incidentTrace(spec, sc)
    const book = new SloBook(trace, spec.slo)
    this.book = book
    const workers = Array.from({ length: spec.workers }, (_, w) => {
      const s = stack(w, cfg, sc.intakeCap)
      const queue: QueueDriver = {
        name: s.queue.name,
        push: (v) => {
          const ok = s.queue.push(v)
          book.pushed(v, w, ok)
          return ok
        },
        pop: () => s.queue.pop(),
      }
      const sched: SchedulerDriver = {
        name: s.sched.name,
        schedule: (view) => {
          for (const r of view.running) if (r.decoded > 0) book.sawToken(r.id, view.iter)
          return s.sched.schedule(view)
        },
      }
      const e = new Engine(cfg, [], sched, s.mgr, { intake: queue, drainPerTick: sc.drainPerTick })
      e.onFinish = (r) => {
        this.finished.push({ ttft: r.ttft, tpot: r.tpot, prompt: r.prompt, tenant: r.tenant })
        book.finished(r.id, r.ttft, r.tpot)
      }
      return e
    })
    this.cluster = new Cluster(trace, workers, 'jsq')
    this.fault = { ...incidentFault(spec, sc) }
    const injector = makeFaultInjector([this.fault], splitmix32u(spec.seed))
    this.cluster.disrupt = (c, t) => {
      const before = c.workers.map((w) => (w.killed ? -1 : w.stats().shed))
      injector.disrupt(c, t)
      c.workers.forEach((w, i) => {
        if (before[i] < 0 || !w.killed) return
        this.lost += w.stats().shed - before[i]
        book.lostOn(i)
      })
    }
  }

  /** Whole minutes simulated so far. */
  get minute(): number {
    return this.records.length
  }

  /** Every simulated minute's miss fraction. */
  get missFractions(): readonly number[] {
    return this.fractions
  }

  /** Simulate up to the end of clock minute `m - 1` (so `minute === m`). */
  advanceTo(m: number): void {
    while (this.records.length < m) this.stepMinute()
  }

  /** The right fix lands now, at the first tick of the current minute. */
  landFix(): void {
    if (this.fixedAt !== null) return
    this.fault.untilTick = this.cluster.tick
    this.fixedAt = this.minute
  }

  private stepMinute(): void {
    const c = this.cluster
    const ws = c.workers
    const n = ws.length
    const sum = (k: 'shed' | 'autoPreempts' | 'capacityMisses') => ws.reduce((a, w) => a + w.stats()[k], 0)
    const shed0 = sum('shed')
    const pre0 = sum('autoPreempts')
    const cap0 = sum('capacityMisses')
    const lost0 = this.lost
    const it0 = ws.map((w) => w.iterations)
    const flow0 = ws.map((w) => (w.killed ? null : w.stats().completed + w.stats().autoPreempts + w.stats().runningNow))
    const depth = new Array<number>(n).fill(0)
    const waiting = new Array<number>(n).fill(0)
    const free = new Array<number>(n).fill(0)
    const live = new Array<number>(n).fill(0)
    let everDown = new Array<boolean>(n).fill(false)
    for (let k = 0; k < MINUTE_TICKS; k++) {
      c.step()
      for (let w = 0; w < n; w++) {
        const e = ws[w]
        if (e.killed) {
          everDown[w] = true
          continue
        }
        live[w]++
        depth[w] += e.intakeDepth
        waiting[w] += e.stats().waitingNow
        free[w] += e.freeBlocks() / e.cfg.numBlocks
      }
    }
    everDown = everDown.map((d, w) => d || ws[w].killed)
    const done = this.finished
    this.finished = []
    const lost = this.lost - lost0
    const shed = sum('shed') - shed0 - lost
    // the SLO covers the chat traffic (the trace): a burst tenant's own requests, capped by limit-tenant, are not chat
    this.book.overdue(c.tick)
    const slo = this.book.take()
    const fraction = missFraction(slo.misses, slo.outcomes)
    const mean = (xs: number[], w: number) => (live[w] ? xs[w] / live[w] : null)
    const greedy = this.fault.kind === 'admission-greedy' && this.fixedAt === null && c.tick > this.fault.atTick
    this.records.push({
      up: ws.map((e) => !e.killed),
      depth: ws.map((_, w) => mean(depth, w)),
      drain: ws.map((e) => (e.killed ? null : e.drainRate)),
      waiting: ws.map((_, w) => mean(waiting, w)),
      admittedPerIter: ws.map((e, w) => {
        const before = flow0[w]
        const iters = e.iterations - it0[w]
        if (before === null || everDown[w] || iters <= 0) return null
        const s = e.stats()
        return (s.completed + s.autoPreempts + s.runningNow - before) / iters
      }),
      free: ws.map((_, w) => mean(free, w)),
      iterations: ws.map((e, w) => (e.killed ? null : e.iterations - it0[w])),
      shed,
      lost,
      preempts: sum('autoPreempts') - pre0,
      capMisses: sum('capacityMisses') - cap0,
      done,
      ttfts: slo.ttfts,
      fraction,
      headroom: greedy ? 0 : HEADROOM_TOKENS,
    })
    this.fractions.push(fraction)
  }

  /** What `probe` shows at clock minute `end` (the minutes [end - WINDOW_MINUTES, end)). Simulates up to `end` first. */
  readings(probe: ProbeId, end: number): ProbeReadings {
    if (!Number.isInteger(end) || end < 1) throw new RangeError(`a reading needs at least one whole minute, got ${end}`)
    this.advanceTo(end)
    const from = Math.max(0, end - WINDOW_MINUTES)
    const recs = this.records.slice(from, end)
    const window = { from, to: end }
    const n = this.spec.workers
    const perWorker = (k: 'depth' | 'waiting' | 'admittedPerIter' | 'free' | 'iterations'): PerWorker =>
      Array.from({ length: n }, (_, w) => recs.map((r) => r[k][w]))
    const last = recs[recs.length - 1]
    switch (probe) {
      case 'intake':
        return {
          probe,
          window,
          depth: perWorker('depth'),
          drainPerTick: last.drain,
          configuredDrain: this.scenario.drainPerTick,
          capacity: this.scenario.intakeCap,
          shed: recs.map((r) => r.shed),
        }
      case 'admission':
        return { probe, window, waiting: perWorker('waiting'), admittedPerIter: perWorker('admittedPerIter'), headroom: last.headroom }
      case 'kv':
        return {
          probe,
          window,
          free: perWorker('free'),
          blocks: this.scenario.cfg.numBlocks,
          preempts: recs.map((r) => r.preempts),
          capMisses: recs.map((r) => r.capMisses),
        }
      case 'workers':
        return {
          probe,
          window,
          up: Array.from({ length: n }, (_, w) => recs.map((r) => r.up[w])),
          iterations: perWorker('iterations'),
          ticksPerMinute: MINUTE_TICKS,
        }
      case 'latency': {
        const tailRecs = recs.slice(Math.max(0, recs.length - TAIL_MINUTES))
        const tail = tailRecs.flatMap((r) => r.done)
        const all = recs.flatMap((r) => r.done)
        const prefill = (xs: Done[]) => xs.reduce((a, r) => a + r.prompt, 0)
        const longTokens = prefill(tail.filter((r) => r.prompt >= LONG_PROMPT))
        const split: LatencyBand[] = []
        for (const band of ['short', 'long'] as const) {
          for (const tenant of [...new Set(all.map((r) => r.tenant))].sort((a, b) => a - b)) {
            const xs = all.filter((r) => r.tenant === tenant && (r.prompt >= LONG_PROMPT) === (band === 'long'))
            if (xs.length) split.push({ band, tenant, n: xs.length, ttftP95: p95(xs.map((r) => r.ttft)), tpotP95: round2(p95(xs.map((r) => r.tpot))) })
          }
        }
        return {
          probe,
          window,
          ttftP95: recs.map((r) => p95(r.ttfts)),
          tpotP95: recs.map((r) => round2(p95(r.done.map((d) => d.tpot)))),
          tail: {
            n: tail.length,
            ttftP95: p95(tailRecs.flatMap((r) => r.ttfts)),
            tpotP95: round2(p95(tail.map((r) => r.tpot))),
            longShare: tail.length ? round2(longTokens / Math.max(1, prefill(tail))) : 0,
          },
          split,
          longPrompt: LONG_PROMPT,
          slo: { ...this.spec.slo },
        }
      }
      case 'errors':
        return { probe, window, shed: recs.map((r) => r.shed), lost: recs.map((r) => r.lost) }
    }
  }

  /** The clock minute the alert fires, simulating until it does (always by `onset + ALERT_LATEST`). */
  alert(): number {
    for (;;) {
      const a = alertMinute(this.fractions, this.spec.onsetMinute)
      if (a !== null) return a
      this.stepMinute()
    }
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100

/* ------------------------------------------------------------------ */
/* The session                                                          */
/* ------------------------------------------------------------------ */

export interface ProbeResult {
  minute: number
  readings: ProbeReadings
  category: Category
}

export interface FixResult {
  minute: number
  effective: boolean
}

/** How an incident went, in IncidentData's terms (ledger types §3.2) plus the clock. */
export interface IncidentOutcome {
  fault: IncidentFault
  severity: 1 | 2 | 3
  firstHypothesis?: Hypothesis
  hypothesis?: Hypothesis
  probes: ProbeId[]
  fix?: FixId
  diagnosed: boolean
  fixed: boolean
  burn: number
  /** Streetlight probes taken, and which */
  streetlight: number
  streetlightProbes: ProbeId[]
  alert: number
  /** the clock minute the incident ended */
  end: number
  recovered: boolean
}

/**
 * The clock over an `IncidentRun` (§9.3). Construct it, then take actions; every action returns what the
 * learner sees. Once the incident has ended (recovered after the right fix, or the limit) further
 * actions change nothing and `ended` stays true.
 */
export class IncidentSession {
  readonly run: IncidentRun
  readonly spec: IncidentSpec
  readonly alertMinute: number
  clock: number
  ended = false
  recovered = false
  readonly actions: IncidentAction[] = []
  private firstHypothesis: Hypothesis | undefined
  private currentHypothesis: Hypothesis | undefined
  private hypothesisAtFix: Hypothesis | undefined
  private lastFix: FixId | undefined
  private readonly observed: Observation[] = []

  constructor(spec: IncidentSpec, opts: IncidentOptions = {}) {
    this.spec = spec
    this.run = new IncidentRun(spec, opts)
    this.alertMinute = this.run.alert()
    this.clock = this.alertMinute
  }

  /** The last minute the incident may run to. */
  get limit(): number {
    return this.alertMinute + LIMIT_MINUTES
  }

  /** Log or revise a hypothesis; it costs no time. The first one counts as `firstHypothesis` only before any probe. */
  hypothesis(h: Hypothesis): void {
    this.actions.push({ kind: 'hypothesis', fault: h })
    if (this.firstHypothesis === undefined && this.observed.length === 0) this.firstHypothesis = h
    this.currentHypothesis = h
  }

  /** Take a probe: the clock advances by its cost, then it shows the last `WINDOW_MINUTES` minutes. After the end it reads the final state and counts for nothing. */
  probe(probe: ProbeId): ProbeResult {
    this.actions.push({ kind: 'probe', probe })
    const counts = !this.ended
    this.tick(actionMinutes({ kind: 'probe', probe }))
    const readings = this.run.readings(probe, this.clock)
    const category = classify(readings)
    if (counts) this.observed.push({ probe, category })
    return { minute: this.clock, readings, category }
  }

  /**
   * Apply a fix. The right one (the injected fault's, the first time) takes `FIX_MINUTES` to roll out
   * and lands when that minute is over; any other costs `WRONG_FIX_MINUTES` and changes nothing.
   */
  fix(fix: FixId): FixResult {
    this.actions.push({ kind: 'fix', fix })
    if (this.ended) return { minute: this.clock, effective: false }
    const right = this.run.fixedAt === null && FIXES[fix].fault === this.spec.fault
    this.lastFix = fix
    // the hypothesis that counts is the one held when the right fix went in (or at the latest fix, until one does)
    if (this.run.fixedAt === null) this.hypothesisAtFix = this.currentHypothesis
    this.tick(actionMinutes({ kind: 'fix', fix }, right), right ? () => this.run.landFix() : undefined)
    return { minute: this.clock, effective: right && this.run.fixedAt !== null }
  }

  wait(): { minute: number } {
    this.actions.push({ kind: 'wait' })
    this.tick(actionMinutes({ kind: 'wait' }))
    return { minute: this.clock }
  }

  /** Let the clock run on to the end: recovery after the right fix, or the limit. */
  finish(): IncidentOutcome {
    while (!this.ended) this.tick(1)
    return this.outcome()
  }

  /** Advance `minutes` minutes one at a time, stopping early if the incident ends; `after` runs once the last minute is over. */
  private tick(minutes: number, after?: () => void): void {
    for (let i = 0; i < minutes && !this.ended; i++) {
      this.run.advanceTo(this.clock + 1)
      this.clock += 1
      if (i === minutes - 1) after?.()
      this.checkEnd()
    }
  }

  private checkEnd(): void {
    const m = this.clock - 1
    if (recoveredAt(this.run.missFractions, m, this.run.fixedAt)) {
      this.ended = true
      this.recovered = true
    } else if (this.clock >= this.limit) {
      this.ended = true
    }
  }

  /** The categories this session has observed, in order. */
  get observations(): readonly Observation[] {
    return this.observed
  }

  outcome(): IncidentOutcome {
    const flags = streetlightFlags(this.observed)
    const hypothesis = this.hypothesisAtFix ?? this.currentHypothesis
    const probes = this.observed.map((o) => o.probe)
    return {
      fault: this.spec.fault,
      severity: this.spec.severity,
      ...(this.firstHypothesis === undefined ? {} : { firstHypothesis: this.firstHypothesis }),
      ...(hypothesis === undefined ? {} : { hypothesis }),
      probes,
      ...(this.lastFix === undefined ? {} : { fix: this.lastFix }),
      diagnosed: hypothesis === this.spec.fault,
      fixed: this.run.fixedAt !== null,
      burn: burnOf(this.run.missFractions, this.alertMinute, this.clock),
      streetlight: flags.filter(Boolean).length,
      streetlightProbes: probes.filter((_, i) => flags[i]),
      alert: this.alertMinute,
      end: this.clock,
      recovered: this.recovered,
    }
  }
}

/** Replay an action log on a fresh session and run it to the end. Deterministic in `(spec, stack, actions)`. */
export function replayIncident(spec: IncidentSpec, actions: readonly IncidentAction[], opts: IncidentOptions = {}): IncidentOutcome {
  const s = new IncidentSession(spec, opts)
  for (const a of actions) {
    if (a.kind === 'hypothesis') s.hypothesis(a.fault)
    else if (a.kind === 'probe') s.probe(a.probe)
    else if (a.kind === 'fix') s.fix(a.fix)
    else s.wait()
  }
  return s.finish()
}

/** The expert's play (§9.3): USE order, Streetlight skipped, fix once one fault remains, then wait. */
export interface ExpertRun {
  actions: IncidentAction[]
  outcome: IncidentOutcome
  /** the fault the expert named and fixed */
  named: IncidentFault
  /** one line per step for the debrief */
  steps: { probe: ProbeId; category: Category; minute: number; candidates: IncidentFault[] }[]
}

function playExpert(s: IncidentSession): { named: IncidentFault; steps: ExpertRun['steps'] } {
  s.hypothesis('unsure')
  const steps: ExpertRun['steps'] = []
  while (!s.ended) {
    const move = expertNext(s.observations)
    if (move.kind === 'fix') {
      s.hypothesis(move.fault)
      s.fix(move.fix)
      return { named: move.fault, steps }
    }
    const r = s.probe(move.probe)
    steps.push({ probe: move.probe, category: r.category, minute: r.minute, candidates: consistentFaults(s.observations) })
  }
  // the clock ran out mid-diagnosis (it never has on the separability seeds)
  return { named: consistentFaults(s.observations)[0], steps }
}

/** The expert on this spec and stack, to the end; `outcome.burn` is `expertBurn`. */
export function runExpert(spec: IncidentSpec, opts: IncidentOptions = {}): ExpertRun {
  const s = new IncidentSession(spec, opts)
  const { named, steps } = playExpert(s)
  const outcome = s.finish()
  return { actions: [...s.actions], outcome, named, steps }
}

/** A learner's outcome with the expert's burn beside it: the fields an incident record needs. */
export function scoreIncident(spec: IncidentSpec, actions: readonly IncidentAction[], opts: IncidentOptions = {}): IncidentOutcome & { expertBurn: number } {
  return { ...replayIncident(spec, actions, opts), expertBurn: runExpert(spec, opts).outcome.burn }
}

/* ------------------------------------------------------------------ */
/* Signatures (the separability test)                                   */
/* ------------------------------------------------------------------ */

/**
 * The category every probe gives when it is the first thing taken at the alert (each read at
 * `alert + its cost`), on one unfixed run, plus the expert's diagnosis on the same run. Probes never
 * change the world, so one run serves both; the expert stops at its fix.
 */
export function signature(spec: IncidentSpec, opts: IncidentOptions = {}): { alert: number; vector: CategoryVector; expert: IncidentFault; expertProbes: ProbeId[] } {
  const run = new IncidentRun(spec, opts)
  const alert = run.alert()
  const vector = Object.fromEntries(PROBE_IDS.map((p) => [p, classify(run.readings(p, alert + PROBES[p].cost))])) as CategoryVector
  const observed: Observation[] = []
  let clock = alert
  for (;;) {
    const move = expertNext(observed)
    if (move.kind === 'fix') return { alert, vector, expert: move.fault, expertProbes: observed.map((o) => o.probe) }
    clock += PROBES[move.probe].cost
    observed.push({ probe: move.probe, category: classify(run.readings(move.probe, clock)) })
  }
}

