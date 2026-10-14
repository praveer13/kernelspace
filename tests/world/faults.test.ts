/**
 * Fault physics (docs/specs/wave-2.md §9.1, task 2b-03).
 *
 * Three things are held here:
 *   1. No existing run changes. With no faults, Fleet and Fleet Week give the outputs they
 *      gave before FaultSpec v2 (a pinned hash, taken on the base commit), and an injector with an empty list
 *      is the same run as no injector at all.
 *   2. The hooks do what they say (usable blocks, drain rate, tenant tags, step slowdown, scheduler override,
 *      route, cordon, revive), and the injector lives in world/faults.ts with fleet-week.ts re-exporting it.
 *   3. The Opus check: each kind moves the metrics its catalog entry (§9.2's EXPECTED column for the first four,
 *      §9.1's Effect column for the two reserves) says it moves, on 32 graded seeds, against the same seed with
 *      no fault; and each kind's fix moves its headline metric back.
 *
 * The scenario (SCENARIO below) is a test fixture, not the incident world: 2b-10 picks the incident world's
 * workers, severities and SLOs. It is four Act I nodes (256 blocks, 16 running) with chunked-prefill
 * interference on, behind Act II's intake (32 deep, 6 per tick) and JSQ, on Fleet Week's graded traces.
 * Interference is on because without it TPOT is 1 tick per token by construction, and tenant-burst's catalog
 * entry ("TPOT up") could not be observed at all.
 *
 * Readings are taken over a window after the onset (WINDOW ticks). Latency is read on the cohort of trace
 * requests that ARRIVED in the window, so a node death's lost work cannot flatter the survivors' numbers;
 * a cohort request that never got a first token by the end of the run (shed, lost, or still waiting) counts
 * as an infinite TTFT. Thresholds are stated next to each assertion and sit outside the spread seen on these
 * 32 seeds, so a change to the physics that breaks a claim fails here while a tick of noise does not.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  Cluster,
  Engine,
  GUARD_AGE,
  HEADROOM_TOKENS,
  makePrefixSharedRequestStream,
  makeRefManager,
  makeRefQueue,
  makeRefScheduler,
  makeRequestStream,
  PRACTICE_SEED,
  referenceScheduler,
  type EngineConfig,
  type FinishedRequest,
  type RequestSpec,
  type SchedView,
} from '../../src/lib/fleet-model'
import * as week from '../../src/lib/fleet-week'
import { drawGradedSeeds } from '../../src/lib/graded-seed'
import { splitmix32u } from '../../src/lib/rng'
import {
  BURST_TENANT,
  FAULT_FIXES,
  FAULT_KINDS,
  GREEDY_GUARD_AGE,
  TENANT_CAP,
  faultActive,
  faultOnset,
  faultSpecProblems,
  headroomlessSchedule,
  makeFaultInjector,
  type FaultKind,
  type FaultSpec,
} from '../../src/lib/world/faults'
import { ALERT_LATEST, generateIncident, type IncidentSpec } from '../../src/lib/world/incident-spec'
import { IncidentRun, incidentFault, runExpert } from '../../src/lib/world/incident-sim'

const SLOW = 600_000

/* ------------------------------------------------------------------ */
/* 1. No existing run changes                                           */
/* ------------------------------------------------------------------ */

const sha = (v: unknown) => new Bun.CryptoHasher('sha256').update(JSON.stringify(v)).digest('hex')

const PRACTICE: week.FleetWeekSeeds = { seed: null, trace: PRACTICE_SEED, faults: 0xfa17, deathPick: 0, deathTick: 400 }
const NO_MODULES: week.ModuleBytes = { sched: null, mgr: null, queue: null }

/** Fleet and Fleet Week outputs with no FaultSpec v2 kind anywhere: what 2b-03 must not move. */
async function existingRuns() {
  const out: Record<string, unknown> = {}
  const cfg: EngineConfig = { numBlocks: 256, blockSize: 16, maxRunning: 16, sloTtft: 40, prefillChunk: 128 }
  for (const [name, c, intake] of [
    ['plain', cfg, false],
    ['intake', cfg, true],
    ['interference', { ...cfg, interference: true, sloItl: 3 }, true],
    ['small-pool', { ...cfg, numBlocks: 64 }, true],
  ] as const) {
    const e = new Engine(c, makeRequestStream(240, 900, PRACTICE_SEED), makeRefScheduler(), makeRefManager(c.numBlocks, 16), intake ? { intake: makeRefQueue(32), drainPerTick: 8 } : undefined)
    const samples: unknown[] = []
    e.recorder = (s) => samples.push(s)
    while (!e.done && e.tick < 20000) e.step()
    out[`engine/${name}`] = { tick: e.tick, stats: e.stats(), free: e.freeBlocks(), samples }
  }
  for (const router of ['rr', 'jsq', 'prefix'] as const) {
    const W = { numBlocks: 128, blockSize: 16, maxRunning: 12, sloTtft: 40, prefillChunk: 128 }
    const ws = Array.from({ length: 4 }, () => new Engine(W, [], makeRefScheduler(), makeRefManager(128, 16), { intake: makeRefQueue(32), drainPerTick: 6 }))
    const c = new Cluster(makePrefixSharedRequestStream(240, 900, PRACTICE_SEED), ws, router)
    while (!c.done && c.tick < 20000) c.step()
    out[`cluster/${router}`] = { tick: c.tick, agg: c.aggregate(), workers: ws.map((w) => w.stats()) }
  }
  const next = splitmix32u(0x2b03)
  const seeds = [PRACTICE, drawGradedSeeds(next()).seeds, drawGradedSeeds(next()).seeds]
  for (const [i, s] of seeds.entries()) {
    out[`week/${i}/policy`] = week.policyBaselines(s)
    out[`week/${i}/fleet2`] = week.referenceFleet(s, 2)
    out[`week/${i}/fleet4`] = week.referenceFleet(s, 4)
    out[`week/${i}/act1`] = await week.runAct1(NO_MODULES, s)
    out[`week/${i}/act2`] = await week.runAct2(NO_MODULES, { workers: 2, router: 'rr' }, s)
    out[`week/${i}/act3`] = week.evalAct3(s)
  }
  return out
}

/**
 * sha256 of `existingRuns()` on the base commit (wave-2b @ 34cb88b), before FaultSpec v2 existed. A change
 * here means a run with no faults no longer replays: fix the change, never the hash. (verify:seeds and the
 * leaderboard parity were also diffed before and after 2b-03; verify-leaderboard pins its own numbers.
 * 2b-17 retired the static incidents (`loadIncident`) and took their outputs out of this hash; it was re-taken on the
 * unchanged sources with only that line removed, so the rest still replays byte for byte.
 * 2b-21 made Act I pass only with a component of yours in the engine (§10.6): the three all-reference `runAct1`
 * results now read `pass: false`, `practice: true` and the install hint. Every number, the metrics, the Act II
 * results and `referenceFleet` were diffed against the previous sources and are unchanged; the hash was re-taken on
 * exactly that difference.)
 */
const EXISTING_RUNS_SHA256 = '6a0c134adea8d7cbea5a4a120c4b110858119e2309dc62a7da8a360ef6f8241a'

describe('no existing run changes', () => {
  test('Fleet and Fleet Week outputs are byte-identical to the base commit', async () => {
    expect(sha(await existingRuns())).toBe(EXISTING_RUNS_SHA256)
  }, SLOW)

  test('an injector with no faults is the same run as no injector', () => {
    const seeds = drawGradedSeeds(0x2b03_0001).seeds
    const plain = observe(seeds, null)
    const empty = observe(seeds, [])
    expect(sha(empty.agg)).toBe(sha(plain.agg))
    expect(empty.finished).toEqual(plain.finished)
  })

  test('fleet-week.ts re-exports the injector from world/faults.ts', () => {
    expect(week.makeFaultInjector).toBe(makeFaultInjector)
  })

  test('world/faults.ts imports only types from fleet-model.ts (page-safe for world/incident-spec)', () => {
    const src = readFileSync(path.join(import.meta.dir, '../../src/lib/world/faults.ts'), 'utf8')
    const imports = src.split('\n').filter((l) => /^import\b/.test(l))
    expect(imports.length).toBeGreaterThan(0)
    for (const line of imports) expect(line).toMatch(/^import type /)
  })

  test('the headroom-free policy keeps the reference guard and differs from it only in headroom', () => {
    expect(GREEDY_GUARD_AGE).toBe(GUARD_AGE)
    // a running decode with room for one more prompt but not its headroom
    const v: SchedView = {
      iter: 10,
      maxRunning: 4,
      memCap: 1024,
      memUsed: 0,
      waiting: [{ id: 2, arrival: 5, prompt: 512 - HEADROOM_TOKENS }],
      running: [{ id: 1, arrival: 0, prompt: 512, decoded: 0, prefillLeft: 0 }],
    }
    expect(referenceScheduler(v).admit).toEqual([])
    expect(headroomlessSchedule(v).admit).toEqual([2])
    // with no memory pressure the two agree, guard order included
    const roomy: SchedView = {
      iter: 5000,
      maxRunning: 3,
      memCap: 1 << 20,
      memUsed: 0,
      waiting: [
        { id: 1, arrival: 4000, prompt: 50 },
        { id: 2, arrival: 100, prompt: 900 },
        { id: 3, arrival: 4500, prompt: 20 },
        { id: 4, arrival: 4600, prompt: 10 },
      ],
      running: [],
    }
    expect(headroomlessSchedule(roomy)).toEqual(referenceScheduler(roomy))
  })
})

/* ------------------------------------------------------------------ */
/* 2. Data and hooks                                                    */
/* ------------------------------------------------------------------ */

describe('FaultSpec v2 is plain data with an onset and an optional until', () => {
  const ALL: FaultSpec[] = [
    { kind: 'node-death', worker: 1, atTick: 300, untilTick: 400 },
    { kind: 'flash-crowd', fromTick: 300, toTick: 500, every: 3, untilTick: 400 },
    { kind: 'pool-shrink', worker: 'all', atTick: 300, blocks: 96, untilTick: 400 },
    { kind: 'drain-stall', atTick: 300, perTick: 0.25, untilTick: 400 },
    { kind: 'tenant-burst', fromTick: 300, toTick: 600, every: 3, prompt: 1024, untilTick: 400 },
    { kind: 'straggler', worker: 0, atTick: 300, every: 4, untilTick: 400 },
    { kind: 'admission-greedy', atTick: 300, untilTick: 400 },
  ]

  test('every kind is covered, survives a structured clone and validates', () => {
    expect(ALL.map((f) => f.kind).sort()).toEqual([...FAULT_KINDS].sort())
    for (const f of ALL) {
      expect(structuredClone(f)).toEqual(f)
      expect(faultSpecProblems(f, 4)).toEqual([])
      expect(faultOnset(f)).toBe(300)
      expect(faultActive(f, 299)).toBe(false)
      expect(faultActive(f, 300)).toBe(true)
      expect(faultActive(f, 400)).toBe(false)
    }
  })

  test('every kind but the flash crowd has a fix', () => {
    expect(FAULT_KINDS.filter((k) => FAULT_FIXES[k] === null)).toEqual(['flash-crowd'])
  })

  test('bad specs are named', () => {
    expect(faultSpecProblems({ kind: 'node-death', worker: 4, atTick: 1 }, 4)).toEqual(['no worker 4'])
    expect(faultSpecProblems({ kind: 'admission-greedy', atTick: 10, untilTick: 10 })).toEqual(['untilTick must be a whole tick after the onset'])
    expect(faultSpecProblems({ kind: 'drain-stall', atTick: -1, perTick: -2 })).toHaveLength(2)
    expect(faultSpecProblems({ kind: 'straggler', worker: 0, atTick: 0, every: 1 })).toEqual(['every must be a whole number >= 2'])
    expect(faultSpecProblems({ kind: 'tenant-burst', fromTick: 5, toTick: 4, every: 0, prompt: 0 })).toHaveLength(3)
    expect(faultSpecProblems({ kind: 'nope' } as unknown as FaultSpec)).toEqual(['unknown fault kind "nope"'])
  })
})

const CFG: EngineConfig = { numBlocks: 64, blockSize: 16, maxRunning: 8, sloTtft: 40, prefillChunk: 128 }
const engine = (stream: RequestSpec[] = [], cfg = CFG, drainPerTick = 4) =>
  new Engine(cfg, stream, makeRefScheduler(), makeRefManager(cfg.numBlocks, cfg.blockSize), { intake: makeRefQueue(32), drainPerTick })

describe('Engine hooks', () => {
  test('usable blocks: ballast holds the rest of the pool, taking blocks as they free, and lets go on restore', () => {
    const stream = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, arrival: 0, prompt: 160, output: 20 }))
    const e = engine(stream, CFG, 8)
    e.step()
    // four fit with their headroom (4 x 208 tokens of 1,024): 40 of 64 blocks busy
    expect(64 - e.freeBlocks()).toBe(40)
    e.setUsableBlocks(16)
    expect(e.usableBlocks).toBe(16)
    // ballast took everything free; the running work still holds its blocks
    expect(e.freeBlocks()).toBe(0)
    // memCap still claims 64 blocks, so the scheduler over-admits into the smaller pool: capacity misses
    while (!e.done && e.tick < 2000) e.step()
    expect(e.stats().capacityMisses).toBeGreaterThan(0)
    // once the work drained the pool is held at 16 usable blocks
    expect(e.freeBlocks()).toBe(16)
    expect(e.stats().completed).toBe(6)
    e.setUsableBlocks(null)
    expect(e.freeBlocks()).toBe(64)
  })

  test('drain rate: fractions accrue across ticks, and null restores the configured drain', () => {
    const stream = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, arrival: 0, prompt: 16, output: 400 }))
    const e = engine(stream, { ...CFG, maxRunning: 64, numBlocks: 4096 })
    e.setDrain(0.25)
    expect(e.drainRate).toBe(0.25)
    for (let i = 0; i < 8; i++) e.step()
    expect(20 - e.intakeDepth).toBe(2)
    e.setDrain(null)
    expect(e.drainRate).toBe(4)
    e.step()
    expect(20 - e.intakeDepth).toBe(6)
  })

  test('step slowdown: a straggler runs one iteration in `every` ticks and decodes that slowly', () => {
    const stream = [{ id: 1, arrival: 0, prompt: 32, output: 41 }]
    const fast = engine(stream.map((r) => ({ ...r })))
    const slow = engine(stream.map((r) => ({ ...r })))
    const tpot = (e: Engine) => {
      let got: FinishedRequest | null = null
      e.onFinish = (r) => (got = r)
      while (!e.done && e.tick < 2000) e.step()
      return got as FinishedRequest | null
    }
    slow.setSlowdown(4)
    expect(slow.slowdown).toBe(4)
    const a = tpot(fast)
    const b = tpot(slow)
    expect(a?.tpot).toBe(1)
    expect(b?.tpot).toBe(4)
    expect(slow.iterations * 4).toBeGreaterThanOrEqual(slow.tick - 3)
    expect(fast.iterations).toBe(fast.tick)
  })

  test('tenant tags flow from the request to the completion record', () => {
    const e = engine([
      { id: 1, arrival: 0, prompt: 32, output: 4 },
      { id: 2, arrival: 0, prompt: 32, output: 4, tenant: 7 },
    ])
    const seen: [number, number][] = []
    e.onFinish = (r) => seen.push([r.id, r.tenant])
    while (!e.done) e.step()
    expect(seen.sort()).toEqual([[1, 0], [2, 7]])
    expect(e.tenantOf(2)).toBe(7)
    expect(e.tenantOf(99)).toBe(0)
  })

  test('scheduler override replaces the plugged scheduler and can delegate to it', () => {
    const e = engine(Array.from({ length: 4 }, (_, i) => ({ id: i + 1, arrival: 0, prompt: 32, output: 4 })))
    const calls: number[] = []
    e.schedOverride = (view, base) => {
      calls.push(view.iter)
      return { admit: base.schedule(view).admit.slice(0, 1), preempt: [] }
    }
    e.step()
    expect(e.stats().runningNow).toBe(1)
    e.schedOverride = null
    e.step()
    expect(e.stats().runningNow).toBe(4)
    expect(calls).toEqual([0])
  })
})

describe('Cluster hooks', () => {
  const W: EngineConfig = { numBlocks: 256, blockSize: 16, maxRunning: 16, sloTtft: 40, prefillChunk: 128 }
  const cluster = (n: number, stream: RequestSpec[] = []) =>
    new Cluster(stream, Array.from({ length: n }, () => engine([], W, 6)), 'rr')

  test('route sends an arrival through the router, and returns -1 with no live worker', () => {
    const c = cluster(2)
    expect(c.route({ id: 1, arrival: 0, prompt: 32, output: 4 })).toBe(0)
    expect(c.route({ id: 2, arrival: 0, prompt: 32, output: 4 })).toBe(1)
    c.workers.forEach((w) => w.kill())
    expect(c.route({ id: 3, arrival: 0, prompt: 32, output: 4 })).toBe(-1)
  })

  test('cordon routes around a worker while another is up', () => {
    const c = cluster(3)
    c.cordon(1)
    expect(c.isCordoned(1)).toBe(true)
    const picks = Array.from({ length: 6 }, (_, i) => c.route({ id: i + 1, arrival: 0, prompt: 32, output: 4 }))
    expect(picks).not.toContain(1)
    c.workers[0].kill()
    c.workers[2].kill()
    expect(c.route({ id: 9, arrival: 0, prompt: 32, output: 4 })).toBe(1)
  })

  test('revive brings a fresh node onto the cluster clock with its pool empty and its intake clear', () => {
    const stream = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, arrival: i, prompt: 200, output: 60 }))
    const c = cluster(2, stream)
    for (let i = 0; i < 30; i++) c.step()
    expect(c.revive(0)).toBe(false)
    const lost = c.workers[0].kill()
    expect(lost).toBeGreaterThan(0)
    for (let i = 0; i < 10; i++) c.step()
    expect(c.revive(0)).toBe(true)
    const w = c.workers[0]
    expect(w.killed).toBe(false)
    expect(w.tick).toBe(c.tick)
    expect(w.freeBlocks()).toBe(256)
    expect(w.intakeDepth).toBe(0)
    while (!c.done && c.tick < 5000) c.step()
    expect(c.done).toBe(true)
    expect(w.stats().completed).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */
/* 3. The Opus check: direction of effect on 32 graded seeds            */
/* ------------------------------------------------------------------ */

const SCENARIO = {
  workers: 4,
  cfg: { numBlocks: 256, blockSize: 16, maxRunning: 16, sloTtft: 40, prefillChunk: 128, interference: true } as EngineConfig,
  intakeCap: 32,
  drainPerTick: 6,
}
const ONSET = 300
const WINDOW = 300
/** Fix at ONSET + FIX_AFTER; fixed readings are taken over [fix + SETTLE, fix + SETTLE + WINDOW). */
const FIX_AFTER = 60
const SETTLE = 40
const RUN = ONSET + WINDOW + 600

/** The fault each claim is about, at the severity this test reads it on. */
const FAULT: Record<Exclude<FaultKind, 'flash-crowd'>, (until?: number) => FaultSpec> = {
  'node-death': (until) => ({ kind: 'node-death', worker: 0, atTick: ONSET, untilTick: until }),
  'pool-shrink': (until) => ({ kind: 'pool-shrink', worker: 'all', atTick: ONSET, blocks: 96, untilTick: until }),
  'drain-stall': (until) => ({ kind: 'drain-stall', atTick: ONSET, perTick: 0.25, untilTick: until }),
  'tenant-burst': (until) => ({ kind: 'tenant-burst', fromTick: ONSET, toTick: RUN, every: 3, prompt: 1024, untilTick: until }),
  straggler: (until) => ({ kind: 'straggler', worker: 0, atTick: ONSET, every: 4, untilTick: until }),
  'admission-greedy': (until) => ({ kind: 'admission-greedy', atTick: ONSET, untilTick: until }),
}

interface Reading {
  /** mean over the window of the summed intake depth of live workers */
  intakeDepth: number
  /** shed (intake overflow plus lost in-flight work) during the window */
  shed: number
  /** mean waiting list per live worker */
  waitingPerWorker: number
  /** mean free blocks as a fraction of the pool, over live workers */
  freeFrac: number
  autoPreempts: number
  capMisses: number
  /** iterations each worker ran in the window, over the window's ticks */
  iterRatio: number[]
  /** cohort (arrived in the window, untagged) TTFT p95; Infinity when more than 5 % never got a first token */
  ttftP95: number
  /** cohort TPOT p95 over the requests that finished */
  tpotP95: number
  /** cohort TPOT max: the worst-served request that arrived in the window */
  tpotMax: number
  /** cohort requests served (to completion) by worker 0 */
  cohortOn0: number
  /** TPOT p95 of the cohort requests worker 0 served */
  worker0TpotP95: number
  /** share of the window's completions sent by the burst tenant */
  tenantShare: number
}

interface Observation {
  agg: ReturnType<Cluster['aggregate']>
  finished: FinishedRequest[]
  read(from: number, to: number): Reading
}

const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] : 0)
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Run SCENARIO on these seeds with `faults` (null: no disrupt hook at all) for RUN ticks, recording what the probes would read. */
function observe(seeds: week.FleetWeekSeeds, faults: FaultSpec[] | null, workers = SCENARIO.workers): Observation {
  const ws = Array.from(
    { length: workers },
    () =>
      new Engine(SCENARIO.cfg, [], makeRefScheduler(), makeRefManager(SCENARIO.cfg.numBlocks, SCENARIO.cfg.blockSize), {
        intake: makeRefQueue(SCENARIO.intakeCap),
        drainPerTick: SCENARIO.drainPerTick,
      }),
  )
  const trace = week.traceFor(seeds)
  const c = new Cluster(trace, ws, 'jsq')
  if (faults) c.disrupt = makeFaultInjector(faults, splitmix32u(seeds.faults)).disrupt
  const finished: FinishedRequest[] = []
  const finishedOn: number[] = []
  const hook = (w: number) => (r: FinishedRequest) => {
    finished.push(r)
    finishedOn.push(w)
  }
  ws.forEach((w, i) => (w.onFinish = hook(i)))
  const ticks: { depth: number; waiting: number; free: number; shed: number; pre: number; miss: number; iters: number[] }[] = []
  while (c.tick < RUN) {
    c.step()
    // the hook follows a revived worker, which is the same Engine object
    const live = c.workers.filter((w) => !w.killed)
    const stats = c.workers.map((w) => w.stats())
    const sum = (k: 'shed' | 'autoPreempts' | 'capacityMisses') => stats.reduce((a, s) => a + s[k], 0)
    ticks.push({
      depth: live.reduce((a, w) => a + w.intakeDepth, 0),
      waiting: live.length ? live.reduce((a, w) => a + w.stats().waitingNow, 0) / live.length : 0,
      free: live.length ? live.reduce((a, w) => a + w.freeBlocks(), 0) / (live.length * SCENARIO.cfg.numBlocks) : 0,
      shed: sum('shed'),
      pre: sum('autoPreempts'),
      miss: sum('capacityMisses'),
      iters: c.workers.map((w) => w.iterations),
    })
  }
  const byId = new Map(finished.map((r) => [r.id, r]))
  const servedBy = new Map(finished.map((r, i) => [r.id, finishedOn[i]]))
  return {
    agg: c.aggregate(),
    finished,
    read(from, to) {
      const win = ticks.slice(from, to)
      const first = ticks[from - 1]
      const last = ticks[to - 1]
      const cohort = trace.filter((r) => r.arrival >= from && r.arrival < to)
      const ttfts = cohort.map((r) => byId.get(r.id)?.ttft ?? Infinity)
      const served = cohort.flatMap((r) => (byId.has(r.id) ? [byId.get(r.id) as FinishedRequest] : []))
      const on0 = served.filter((r) => servedBy.get(r.id) === 0)
      const done = finished.filter((r) => r.tick >= from && r.tick < to)
      return {
        intakeDepth: mean(win.map((t) => t.depth)),
        shed: last.shed - first.shed,
        waitingPerWorker: mean(win.map((t) => t.waiting)),
        freeFrac: mean(win.map((t) => t.free)),
        autoPreempts: last.pre - first.pre,
        capMisses: last.miss - first.miss,
        iterRatio: last.iters.map((n, w) => (n - first.iters[w]) / (to - from)),
        ttftP95: p95(ttfts),
        tpotP95: p95(served.map((r) => r.tpot)),
        tpotMax: Math.max(0, ...served.map((r) => r.tpot)),
        cohortOn0: on0.length,
        worker0TpotP95: p95(on0.map((r) => r.tpot)),
        tenantShare: done.length ? done.filter((r) => r.tenant === BURST_TENANT).length / done.length : 0,
      }
    },
  }
}

const GRADED_SEEDS = 32
/** Fixed entropy: the same 32 graded traces on every run. */
const ENTROPY = 0x2b03_5eed
const nextSeed = splitmix32u(ENTROPY)
const SEEDS: week.FleetWeekSeeds[] = Array.from({ length: GRADED_SEEDS }, () => drawGradedSeeds(nextSeed()).seeds)

const memo = new Map<string, Observation>()
function run(i: number, tag: string, faults: FaultSpec[], workers = SCENARIO.workers): Observation {
  const key = `${i}/${tag}/${workers}`
  let o = memo.get(key)
  if (!o) {
    o = observe(SEEDS[i], faults, workers)
    memo.set(key, o)
  }
  return o
}
const base = (i: number, workers?: number) => run(i, 'none', [], workers).read(ONSET, ONSET + WINDOW)
const faulted = (i: number, kind: keyof typeof FAULT, workers?: number) => run(i, kind, [FAULT[kind]()], workers).read(ONSET, ONSET + WINDOW)
const FIX_AT = ONSET + FIX_AFTER
const afterFix = (i: number, kind: keyof typeof FAULT, fixed: boolean) =>
  run(i, `${kind}${fixed ? '+fix' : ''}`, [FAULT[kind](fixed ? FIX_AT : undefined)]).read(FIX_AT + SETTLE, FIX_AT + SETTLE + WINDOW)

const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n)

/** At least this share of the seeds, for the two claims that hang on how JSQ happens to place a burst (see their tests). */
const MOST = 0.9

/** Every seed where `claim` fails, by index and the numbers that broke it. */
function breaks(claim: (i: number) => string | null): string[] {
  const out: string[] = []
  for (let i = 0; i < SEEDS.length; i++) {
    const why = claim(i)
    if (why) out.push(`seed ${i} (0x${(SEEDS[i].seed ?? 0).toString(16)}): ${why}`)
  }
  return out
}

/** TPOT is "flat" when it moves by at most this factor either way (cohort p95 noise on these seeds stays under 1.12). */
const TPOT_FLAT = 1.15

describe('graded seeds', () => {
  test('are 32 distinct traces, and the scenario is healthy before the onset (no shed, cohort TPOT p95 < 1.5)', () => {
    expect(new Set(SEEDS.map((s) => s.seed)).size).toBe(GRADED_SEEDS)
    const bad = breaks((i) => {
      const r = run(i, 'none', []).read(1, ONSET)
      return r.shed === 0 && r.tpotP95 < 1.5 ? null : `shed ${r.shed}, tpot p95 ${fmt(r.tpotP95)}`
    })
    expect(bad).toEqual([])
  }, SLOW)
})

describe('pool-shrink: kv ≈ 0 free and preempts rising, admission long, TTFT up with TPOT flat, intake normal, no errors', () => {
  test('against the same seed with no fault', () => {
    const bad = breaks((i) => {
      const a = base(i)
      const b = faulted(i, 'pool-shrink')
      if (b.freeFrac > 0.1) return `free ${fmt(b.freeFrac)} of the pool`
      if (b.autoPreempts < a.autoPreempts + 10) return `auto-preempts ${a.autoPreempts} -> ${b.autoPreempts}`
      if (b.capMisses < 1000) return `capacity misses ${b.capMisses}`
      if (b.waitingPerWorker < a.waitingPerWorker * 2) return `waiting/worker ${fmt(a.waitingPerWorker)} -> ${fmt(b.waitingPerWorker)}`
      if (b.ttftP95 <= a.ttftP95) return `ttft p95 ${a.ttftP95} -> ${b.ttftP95}`
      if (b.tpotP95 > a.tpotP95 * TPOT_FLAT) return `tpot p95 ${fmt(a.tpotP95)} -> ${fmt(b.tpotP95)}`
      if (b.intakeDepth > a.intakeDepth + 1) return `intake depth ${fmt(a.intakeDepth)} -> ${fmt(b.intakeDepth)}`
      return b.shed === a.shed ? null : `shed ${a.shed} -> ${b.shed}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('restore-pool gives the blocks back', () => {
    const bad = breaks((i) => {
      const u = afterFix(i, 'pool-shrink', false)
      const f = afterFix(i, 'pool-shrink', true)
      if (f.freeFrac < u.freeFrac + 0.15) return `free ${fmt(u.freeFrac)} -> ${fmt(f.freeFrac)}`
      return f.autoPreempts < u.autoPreempts ? null : `auto-preempts ${u.autoPreempts} -> ${f.autoPreempts}`
    })
    expect(bad).toEqual([])
  }, SLOW)
})

describe('drain-stall: intake full and shedding, admission near empty, kv high free, TTFT up with TPOT flat', () => {
  test('against the same seed with no fault', () => {
    const bad = breaks((i) => {
      const a = base(i)
      const b = faulted(i, 'drain-stall')
      if (b.intakeDepth < a.intakeDepth + 4) return `intake depth ${fmt(a.intakeDepth)} -> ${fmt(b.intakeDepth)}`
      if (b.waitingPerWorker > a.waitingPerWorker * 0.75) return `waiting/worker ${fmt(a.waitingPerWorker)} -> ${fmt(b.waitingPerWorker)}`
      if (b.freeFrac <= a.freeFrac) return `free ${fmt(a.freeFrac)} -> ${fmt(b.freeFrac)}`
      if (b.ttftP95 <= a.ttftP95) return `ttft p95 ${a.ttftP95} -> ${b.ttftP95}`
      return b.tpotP95 <= a.tpotP95 * TPOT_FLAT && b.tpotP95 >= a.tpotP95 / TPOT_FLAT ? null : `tpot p95 ${fmt(a.tpotP95)} -> ${fmt(b.tpotP95)}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test(`shedding: the window's burst overflows a stalled intake on >= ${MOST * 100}% of seeds (shed +5 or more)`, () => {
    // JSQ weighs waiting + running, not intake depth, so a burst lands on one worker per tick; when its two ticks
    // land on different workers, neither 32-deep queue overflows (seed 12 here) and only the depth shows the stall
    const bad = breaks((i) => (faulted(i, 'drain-stall').shed >= base(i).shed + 5 ? null : `shed ${base(i).shed} -> ${faulted(i, 'drain-stall').shed}`))
    expect(bad.length).toBeLessThanOrEqual(SEEDS.length * (1 - MOST))
  }, SLOW)

  test('restore-drain empties intake and stops the shedding', () => {
    const bad = breaks((i) => {
      const u = afterFix(i, 'drain-stall', false)
      const f = afterFix(i, 'drain-stall', true)
      if (f.intakeDepth > u.intakeDepth / 2) return `intake depth ${fmt(u.intakeDepth)} -> ${fmt(f.intakeDepth)}`
      return f.shed === 0 && f.shed <= u.shed ? null : `shed ${u.shed} -> ${f.shed}`
    })
    expect(bad).toEqual([])
  }, SLOW)
})

describe('node-death: one worker down, lost in-flight at onset, admission long per survivor, TPOT flat', () => {
  test('against the same seed with no fault', () => {
    const bad = breaks((i) => {
      const a = base(i)
      const b = faulted(i, 'node-death')
      if (b.iterRatio[0] !== 0 || b.iterRatio.slice(1).some((r) => r !== 1)) return `iterations ${b.iterRatio.map(fmt)}`
      if (b.shed < 1) return `shed ${b.shed} (nothing lost at the onset)`
      if (b.waitingPerWorker < a.waitingPerWorker * 1.1) return `waiting/worker ${fmt(a.waitingPerWorker)} -> ${fmt(b.waitingPerWorker)}`
      return b.tpotP95 <= a.tpotP95 * TPOT_FLAT ? null : `tpot p95 ${fmt(a.tpotP95)} -> ${fmt(b.tpotP95)}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('TTFT up and intake elevated: on two workers the survivor cannot serve the cohort (> 5% never get a first token)', () => {
    // On four workers the three survivors absorb the load: the cohort's TTFT p95 moved by x0.93 to x1.24 on these
    // seeds (on three it rose on all 32), so "TTFT up" is a claim about a small fleet (2b-10: run node-death on 2
    // workers, or read TTFT per survivor). "Intake elevated" is weaker still: the survivor's intake rises (summed
    // depth 0.21 -> 0.29 here) but stays under one request, because a 6-per-tick drain empties it every tick; on
    // four workers it does not move at all. 2b-10's classify must read it relative to the healthy fleet, or
    // EXPECTED must call node-death's intake normal.
    const bad = breaks((i) => {
      const a = base(i, 2)
      const b = faulted(i, 'node-death', 2)
      if (b.intakeDepth <= a.intakeDepth) return `intake depth ${fmt(a.intakeDepth)} -> ${fmt(b.intakeDepth)}`
      return b.ttftP95 === Infinity && a.ttftP95 < Infinity ? null : `ttft p95 ${a.ttftP95} -> ${b.ttftP95}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('replace-node: the fresh worker runs every tick and the survivors queue less', () => {
    const bad = breaks((i) => {
      const u = afterFix(i, 'node-death', false)
      const f = afterFix(i, 'node-death', true)
      if (f.iterRatio[0] !== 1) return `worker 0 iterations ${fmt(f.iterRatio[0])}`
      return f.waitingPerWorker < u.waitingPerWorker ? null : `waiting/worker ${fmt(u.waitingPerWorker)} -> ${fmt(f.waitingPerWorker)}`
    })
    expect(bad).toEqual([])
  }, SLOW)
})

describe('tenant-burst: TPOT up with long prompts dominating, kv low free, admission long, intake normal, no errors', () => {
  test('against the same seed with no fault', () => {
    const bad = breaks((i) => {
      const a = base(i)
      const b = faulted(i, 'tenant-burst')
      if (b.tpotP95 < a.tpotP95 * 1.2) return `tpot p95 ${fmt(a.tpotP95)} -> ${fmt(b.tpotP95)}`
      if (b.tenantShare < 0.25) return `the tenant's share of completions ${fmt(b.tenantShare)}`
      if (b.freeFrac > a.freeFrac * 0.6) return `free ${fmt(a.freeFrac)} -> ${fmt(b.freeFrac)}`
      if (b.waitingPerWorker <= a.waitingPerWorker) return `waiting/worker ${fmt(a.waitingPerWorker)} -> ${fmt(b.waitingPerWorker)}`
      if (b.intakeDepth > a.intakeDepth + 1) return `intake depth ${fmt(a.intakeDepth)} -> ${fmt(b.intakeDepth)}`
      return b.shed === a.shed ? null : `shed ${a.shed} -> ${b.shed}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test(`limit-tenant (${TENANT_CAP} running per worker) brings everyone else's TPOT back down`, () => {
    const bad = breaks((i) => {
      const u = afterFix(i, 'tenant-burst', false)
      const f = afterFix(i, 'tenant-burst', true)
      if (f.tpotP95 >= u.tpotP95) return `tpot p95 ${fmt(u.tpotP95)} -> ${fmt(f.tpotP95)}`
      return f.tenantShare < u.tenantShare ? null : `tenant share ${fmt(u.tenantShare)} -> ${fmt(f.tenantShare)}`
    })
    expect(bad).toEqual([])
  }, SLOW)
})

describe('straggler (reserve): the worker steps every `every` ticks and decodes that slowly', () => {
  test('against the same seed with no fault', () => {
    const bad = breaks((i) => {
      const a = base(i)
      const b = faulted(i, 'straggler')
      if (Math.abs(b.iterRatio[0] - 0.25) > 0.01 || b.iterRatio.slice(1).some((r) => r !== 1)) return `iterations ${b.iterRatio.map(fmt)}`
      // what it serves decodes at least twice as slowly (it may serve nothing: see the next test)
      if (b.cohortOn0 > 0 && b.worker0TpotP95 < a.worker0TpotP95 * 2) return `worker 0 tpot p95 ${fmt(a.worker0TpotP95)} -> ${fmt(b.worker0TpotP95)}`
      return b.shed === a.shed ? null : `shed ${a.shed} -> ${b.shed}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test(`JSQ still sends it work on >= ${MOST * 100}% of seeds, so the slow decode reaches the cohort (TPOT max >= 2x)`, () => {
    // its running requests linger, so JSQ steers away from it on its own; on 2 of these 32 seeds it served none of the cohort
    const bad = breaks((i) => {
      const b = faulted(i, 'straggler')
      return b.cohortOn0 > 0 && b.tpotMax >= base(i).tpotMax * 2 ? null : `served ${b.cohortOn0}, tpot max ${fmt(base(i).tpotMax)} -> ${fmt(b.tpotMax)}`
    })
    expect(bad.length).toBeLessThanOrEqual(SEEDS.length * (1 - MOST))
  }, SLOW)

  test('drain-node routes new work around it, so no cohort request decodes on it (cohort TPOT max < 2)', () => {
    const bad = breaks((i) => {
      const u = afterFix(i, 'straggler', false)
      const f = afterFix(i, 'straggler', true)
      if (f.cohortOn0 !== 0) return `worker 0 still served ${f.cohortOn0}`
      return f.tpotMax < 2 && f.tpotMax <= u.tpotMax ? null : `tpot max ${fmt(u.tpotMax)} -> ${fmt(f.tpotMax)}`
    })
    expect(bad).toEqual([])
  }, SLOW)
})

describe('admission-greedy (reserve): no headroom, so decode growth overflows the pool and auto-preempts', () => {
  test('against the same seed with no fault', () => {
    const bad = breaks((i) => {
      const a = base(i)
      const b = faulted(i, 'admission-greedy')
      // TTFT is not claimed: it moved by x0.91 to x1.75 on these seeds
      if (b.autoPreempts < a.autoPreempts + 5) return `auto-preempts ${a.autoPreempts} -> ${b.autoPreempts}`
      if (b.freeFrac >= a.freeFrac) return `free ${fmt(a.freeFrac)} -> ${fmt(b.freeFrac)}`
      return b.shed === a.shed ? null : `shed ${a.shed} -> ${b.shed}`
    })
    expect(bad).toEqual([])
  }, SLOW)

  test('restore-headroom ends the preempt storm', () => {
    const bad = breaks((i) => {
      const u = afterFix(i, 'admission-greedy', false)
      const f = afterFix(i, 'admission-greedy', true)
      return f.autoPreempts === 0 && u.autoPreempts > 0 ? null : `auto-preempts ${u.autoPreempts} -> ${f.autoPreempts}`
    })
    expect(bad).toEqual([])
  }, SLOW)
})

describe('the injector', () => {
  test('is deterministic: the same specs on the same seed give the same run and the same timeline', () => {
    const faults = Object.values(FAULT).map((f) => f(ONSET + 100))
    const one = makeFaultInjector(faults, splitmix32u(1))
    const two = makeFaultInjector(faults, splitmix32u(1))
    const a = observe(SEEDS[0], faults)
    const b = observe(SEEDS[0], faults)
    expect(sha(a.agg)).toBe(sha(b.agg))
    expect(a.finished).toEqual(b.finished)
    const c1 = new Cluster(week.traceFor(SEEDS[0]), [engine([], SCENARIO.cfg), engine([], SCENARIO.cfg)], 'jsq')
    const c2 = new Cluster(week.traceFor(SEEDS[0]), [engine([], SCENARIO.cfg), engine([], SCENARIO.cfg)], 'jsq')
    c1.disrupt = one.disrupt
    c2.disrupt = two.disrupt
    for (let t = 0; t < 600; t++) {
      c1.step()
      c2.step()
    }
    expect(one.timeline).toEqual(two.timeline)
    expect(one.events).toEqual(two.events)
    expect(one.timeline.map((e) => `${e.kind}:${e.phase}`)).toContain('admission-greedy:revert')
  })

  test('new kinds draw nothing from the flash crowd stream, so adding one never shifts a crowd', () => {
    const crowd: FaultSpec = { kind: 'flash-crowd', fromTick: 100, toTick: 400, every: 3 }
    const draws = (faults: FaultSpec[]) => {
      let n = 0
      const r = splitmix32u(5)
      const inj = makeFaultInjector(faults, () => (n++, r()))
      const c = new Cluster([], [engine([], SCENARIO.cfg), engine([], SCENARIO.cfg)], 'jsq')
      c.disrupt = inj.disrupt
      for (let t = 0; t < 500; t++) c.step()
      return n
    }
    const alone = draws([crowd])
    expect(alone).toBeGreaterThan(0)
    expect(draws([crowd, FAULT['tenant-burst'](), FAULT['pool-shrink'](), FAULT['admission-greedy'](), FAULT['drain-stall'](), FAULT.straggler()])).toBe(alone)
  })
})

/* ------------------------------------------------------------------ */
/* 8. A node death is an incident at every fleet size (BF2, F8)         */
/* ------------------------------------------------------------------ */

describe('a node death is a valid, alerting, diagnosable incident on two and on four workers', () => {
  const specs = (workers: 2 | 4, n: number): IncidentSpec[] => {
    const out: IncidentSpec[] = []
    for (let i = 0; out.length < n; i++) {
      const s = generateIncident('drill', `bf2-death-${i}`)
      if (s.fault === 'node-death' && s.workers === workers) out.push(s)
    }
    return out
  }

  for (const workers of [2, 4] as const) {
    test(`${workers} workers: the FaultSpec names a worker of the fleet, the alert fires, the expert names it and replace-node recovers`, () => {
      for (const spec of specs(workers, 24)) {
        const f = incidentFault(spec)
        expect(f.kind).toBe('node-death')
        expect(faultSpecProblems(f, workers)).toEqual([])
        const e = runExpert(spec)
        expect(e.named).toBe('node-death')
        expect(e.outcome.fixed).toBe(true)
        expect(e.outcome.recovered).toBe(true)
        // the alert comes from the miss fraction soon after the death, not from the fallback
        expect(e.outcome.alert - spec.onsetMinute).toBeLessThan(ALERT_LATEST)
      }
    }, SLOW)

    test(`${workers} workers: before the death the fleet meets its SLO, and the alert comes after the onset`, () => {
      for (const spec of specs(workers, 12)) {
        const run = new IncidentRun(spec)
        run.advanceTo(spec.onsetMinute)
        // a healthy fleet at this load stays under the alert threshold until the onset
        expect(Math.max(...run.missFractions)).toBeLessThan(0.2)
        expect(run.alert()).toBeGreaterThan(spec.onsetMinute)
      }
    }, SLOW)
  }

  test('the briefing, causes and fix whys never count the survivors or halve the fleet: they hold for two and four workers', () => {
    for (const inc of week.INCIDENTS) {
      for (const t of [inc.briefing, ...inc.causes.map((o) => o.why ?? ''), ...inc.mitigations.map((o) => o.why ?? '')]) {
        expect(t).not.toMatch(/\bsurvivors?\b|half the engines|one engine less|the other worker|both workers|the second worker/i)
      }
    }
  })
})
