import { afterAll, describe, expect, test } from 'bun:test'
import {
  Cluster,
  Engine,
  EpdCluster,
  makePrefixSharedRequestStream,
  makeRefManager,
  makeRefQueue,
  makeRefScheduler,
  makeRequestStream,
  PRACTICE_SEED,
  type EngineConfig,
  type RequestSpec,
} from '../../src/lib/fleet-model'
import { createFleetHost } from '../../src/lib/fleet-host'
import {
  describeFleetError,
  FleetTimeoutError,
  fleetLabel,
  openFleetSession,
  openPoolSession,
  runFleetJob,
  type FleetWorkerLike,
} from '../../src/lib/fleet-session'
import { disposeLabWorker } from '../../src/lib/lab-worker'
import { scoreReferenceBenchmark, scoreReferenceInWorker, verifyAndScoreScheduler } from '../../src/lib/leaderboard'
import { LabAbiError, LabTrapError, instantiateLab } from '../../src/lib/wasm-lab'
import { makeWasmScheduler } from '../../src/lib/wasm-scheduler'
import { getFleetTrafficProfile } from '../../src/lib/traces'
import { validateModule } from '../../src/pages/fleet/drivers'
import type { FleetReply, FleetRequest } from '../../src/workers/fleet-protocol'
import { loadBenchmarkTraces } from '../../scripts/submission-tools'

afterAll(() => disposeLabWorker())

/* ------------------------- a tiny hand-assembled lab module ------------------------- */

const uleb = (n: number): number[] => {
  const out: number[] = []
  do {
    let byte = n & 0x7f
    n >>>= 7
    if (n !== 0) byte |= 0x80
    out.push(byte)
  } while (n !== 0)
  return out
}

const sleb64 = (value: bigint): number[] => {
  const out: number[] = []
  for (;;) {
    const byte = Number(value & 0x7fn)
    value >>= 7n
    if ((value === 0n && (byte & 0x40) === 0) || (value === -1n && (byte & 0x40) !== 0)) {
      out.push(byte)
      return out
    }
    out.push(byte | 0x80)
  }
}

const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body]
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()]
const str = (s: string): number[] => [...uleb(s.length), ...new TextEncoder().encode(s)]
const packed = (ptr: number, len: number): number[] => [0x42, ...sleb64((BigInt(ptr) << 32n) | BigInt(len))]

const INIT_OK_AT = 1024
const ADMIT_NOTHING_AT = 1040
const REPORT_AT = 2048
const ADMIT_NOTHING = 'admit\npreempt'

/**
 * A zero-import lab module with the four ABI exports: ks_run returns a green one-check report for `lab`,
 * and ks_invoke answers "ok" to init and an empty admit/preempt action to everything else, which is a
 * well-formed (if useless) batching scheduler.
 */
function labModule(lab: string): ArrayBuffer {
  const report = JSON.stringify({ lab, version: 2, checks: [{ id: 'c', label: 'c', pass: true, msg: 'ok' }] })
  const ksAlloc = [0x00, 0x41, ...sleb64(4096n), 0x0b] // always the same scratch region
  const ksFree = [0x00, 0x0b]
  const ksRun = [0x00, ...packed(REPORT_AT, report.length), 0x0b]
  const ksInvoke = [
    0x00,
    0x20, 0x00, 0x2d, 0x00, 0x00, // local.get 0; i32.load8_u
    0x41, ...sleb64(105n), 0x46, // i32.const 'i'; i32.eq
    0x04, 0x7e, // if (result i64)
    ...packed(INIT_OK_AT, 2),
    0x05, // else
    ...packed(ADMIT_NOTHING_AT, ADMIT_NOTHING.length),
    0x0b,
    0x0b,
  ]
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7f, 0x01, 0x7f], [0x60, 0x02, 0x7f, 0x7f, 0x00], [0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e]])),
    ...section(3, vec([[0], [1], [2], [2]])),
    ...section(5, vec([[0x00, 0x01]])),
    ...section(7, vec([[...str('memory'), 0x02, 0x00], [...str('ks_alloc'), 0x00, 0], [...str('ks_free'), 0x00, 1], [...str('ks_run'), 0x00, 2], [...str('ks_invoke'), 0x00, 3]])),
    ...section(10, vec([[...uleb(ksAlloc.length), ...ksAlloc], [...uleb(ksFree.length), ...ksFree], [...uleb(ksRun.length), ...ksRun], [...uleb(ksInvoke.length), ...ksInvoke]])),
    ...section(
      11,
      vec(
        [
          [INIT_OK_AT, 'ok'],
          [ADMIT_NOTHING_AT, ADMIT_NOTHING],
          [REPORT_AT, report],
        ].map(([at, text]) => [0x00, 0x41, ...sleb64(BigInt(at as number)), 0x0b, ...str(text as string)]),
      ),
    ),
  ]
  return new Uint8Array(bytes).buffer
}

/* --------------------------- an in-process fake worker --------------------------- */

type Script = (req: FleetRequest, emit: (reply: FleetReply) => void) => void | Promise<void>

class FakeWorker implements FleetWorkerLike {
  onmessage: FleetWorkerLike['onmessage'] = null
  onerror: FleetWorkerLike['onerror'] = null
  terminated = false
  readonly received: FleetRequest[] = []

  constructor(private readonly script: Script) {
    queueMicrotask(() => this.deliver({ type: 'boot' }))
  }

  private deliver(reply: FleetReply) {
    if (!this.terminated) this.onmessage?.({ data: reply })
  }

  postMessage(msg: FleetRequest) {
    this.received.push(msg)
    if (this.terminated) return
    setTimeout(() => void this.script(msg, (reply) => this.deliver(reply)), 0)
  }

  terminate() {
    this.terminated = true
  }
}

/** The real host behind the fake worker: what fleet.worker.ts does, minus the thread. */
function hostScript(): Script {
  const host = createFleetHost()
  return (req, emit) => host.handle(req, emit)
}

function spawner(script: () => Script) {
  const workers: FakeWorker[] = []
  return {
    workers,
    spawn: () => {
      const w = new FakeWorker(script())
      workers.push(w)
      return w
    },
  }
}

const noModules = { sched: null, mgr: null, queue: null }

/* ------------------------------ the references ------------------------------ */

function directEngines(stream: RequestSpec[], cfg: EngineConfig, intakeCap: number, drain: number, sched = makeRefScheduler()) {
  const clone = stream.map((r) => ({ ...r }))
  const mine = new Engine(cfg, stream, sched, makeRefManager(cfg.numBlocks, cfg.blockSize), {
    intake: makeRefQueue(intakeCap),
    drainPerTick: drain,
  })
  const reference = new Engine(cfg, clone, makeRefScheduler(), makeRefManager(cfg.numBlocks, cfg.blockSize), {
    intake: makeRefQueue(intakeCap),
    drainPerTick: drain,
  })
  const step = () => {
    if (!mine.done) mine.step()
    if (!reference.done) reference.step()
  }
  const view = () => {
    const s = mine.stats()
    const rs = reference.stats()
    return {
      tick: mine.tick,
      mine: {
        met: s.sloMet,
        done: s.completed,
        p95: mine.ttftP95(),
        tpotP95: mine.tpotP95(),
        queueP95: mine.queueP95(),
        inputTokens: s.completedInputTokens,
        outputTokens: s.completedOutputTokens,
        autoPreempts: s.autoPreempts,
        capMisses: s.capacityMisses,
        shed: s.shed,
        waiting: s.waitingNow,
        running: s.runningNow,
      },
      reference: { met: rs.sloMet, done: rs.completed, p95: reference.ttftP95() },
      dump: mine.mgrDump(),
      violations: mine.violations.slice(0, 3),
      divergence: mine.divergence[0] ?? null,
      done: mine.done && reference.done,
    }
  }
  return { mine, reference, step, view }
}

const profile = getFleetTrafficProfile('synthetic')
const engineStream = () => makeRequestStream(240, 900, PRACTICE_SEED)

describe('session determinism: a session steps exactly like a direct run', () => {
  test('engine session, one tick per step, equals a direct Engine pair on every tick', async () => {
    const t = spawner(() => hostScript())
    const session = await openFleetSession(
      {
        mode: 'engine',
        slots: noModules,
        traffic: engineStream(),
        cfg: { engine: profile.config, intakeCap: profile.intakeCap, drainPerTick: profile.drainPerTick },
      },
      { spawn: t.spawn },
    )
    expect(session.total).toBe(240)
    const direct = directEngines(engineStream(), profile.config, profile.intakeCap, profile.drainPerTick)
    let ticks = 0
    for (;;) {
      const snap = await session.step(1)
      direct.step()
      const { tick, mine, reference, dump, violations, divergence, done } = direct.view()
      expect(snap).toEqual({ mode: 'engine', tick, mine, reference, dump, violations, divergence, done, total: 240 })
      ticks++
      if (snap.done || ticks > 6000) break
    }
    expect(ticks).toBeGreaterThan(100)
    expect(ticks).toBeLessThanOrEqual(6000)
    session.close()
  })

  test('batch size does not change the run: steps of 1, 7 and 500 end in the same state', async () => {
    const finals = []
    for (const batch of [1, 7, 500]) {
      const t = spawner(() => hostScript())
      const session = await openFleetSession(
        {
          mode: 'engine',
          slots: noModules,
          traffic: engineStream(),
          cfg: { engine: profile.config, intakeCap: profile.intakeCap, drainPerTick: profile.drainPerTick },
        },
        { spawn: t.spawn },
      )
      let snap = await session.step(batch)
      while (!snap.done) snap = await session.step(batch)
      finals.push(snap)
      session.close()
    }
    expect(finals[1]).toEqual(finals[0])
    expect(finals[2]).toEqual(finals[0])
  })

  test('a learner module in the slot runs inside the host and matches the same module driven directly', async () => {
    const bytes = labModule('batching-scheduler')
    const t = spawner(() => hostScript())
    const session = await openFleetSession(
      {
        mode: 'engine',
        slots: { ...noModules, sched: bytes },
        traffic: engineStream(),
        cfg: { engine: profile.config, intakeCap: profile.intakeCap, drainPerTick: profile.drainPerTick },
      },
      { spawn: t.spawn },
    )
    const sched = makeWasmScheduler(await instantiateLab(bytes))
    const direct = directEngines(engineStream(), profile.config, profile.intakeCap, profile.drainPerTick, sched)
    for (let i = 0; i < 60; i++) {
      const snap = await session.step(1)
      direct.step()
      const { tick, mine, reference } = direct.view()
      expect({ tick: snap.tick, mine: snap.mine, reference: snap.reference }).toEqual({ tick, mine, reference })
    }
    // a scheduler that admits nothing completes nothing, so the module really was the one driving
    expect((await session.step(1)).mine.done).toBe(0)
    session.close()
  })

  test('cluster session equals a direct Cluster on every tick', async () => {
    const worker: EngineConfig = { numBlocks: 128, blockSize: 16, maxRunning: 12, sloTtft: 40, prefillChunk: 128 }
    const stream = () => makePrefixSharedRequestStream(240, 900, PRACTICE_SEED)
    const t = spawner(() => hostScript())
    const session = await openFleetSession(
      { mode: 'cluster', slots: noModules, traffic: stream(), cfg: { worker, workers: 2, router: 'prefix', intakeCap: 32, drainPerTick: 6 } },
      { spawn: t.spawn },
    )
    const engines = [0, 1].map(
      () => new Engine(worker, [], makeRefScheduler(), makeRefManager(worker.numBlocks, worker.blockSize), { intake: makeRefQueue(32), drainPerTick: 6 }),
    )
    const direct = new Cluster(stream(), engines, 'prefix')
    for (let i = 0; i < 250; i++) {
      const snap = await session.step(1)
      if (!direct.done) direct.step()
      expect(snap.tick).toBe(direct.tick)
      expect(snap.done).toBe(direct.done)
      expect(snap.agg).toEqual(direct.aggregate())
      expect(snap.workers.map((w) => [w.waiting, w.running])).toEqual(direct.workers.map((w) => [w.stats().waitingNow, w.stats().runningNow]))
    }
    session.close()
  })

  test('EPD session reports the same verdict as running both topologies directly', async () => {
    const colocated: EngineConfig = { numBlocks: 192, blockSize: 16, maxRunning: 12, sloTtft: 40, prefillChunk: 128, interference: true, sloItl: 2 }
    const stream = () => makeRequestStream(240, 900, PRACTICE_SEED)
    const mk = (cfg: EngineConfig, prefillOnly: boolean) =>
      new Engine({ ...cfg, prefillOnly }, [], makeRefScheduler(), makeRefManager(cfg.numBlocks, cfg.blockSize), { intake: makeRefQueue(32), drainPerTick: 6 })
    const col = new Cluster(stream(), [mk(colocated, false), mk(colocated, false)], 'jsq')
    while (!col.done) col.step()
    const ca = col.aggregate()
    const pCfg = { ...colocated, numBlocks: Math.floor(colocated.numBlocks / 2), prefillOnly: true }
    const dCfg = { ...colocated, numBlocks: colocated.numBlocks * 2 - pCfg.numBlocks }
    const pre = mk(pCfg, true)
    const dec = mk(dCfg, false)
    const epd = new EpdCluster(stream(), [pre], [dec], { prefillCfg: pCfg, decodeCfg: dCfg, transferRate: 256 })
    while (!epd.done) epd.step()
    const ea = epd.aggregate()

    const t = spawner(() => hostScript())
    const session = await openFleetSession(
      { mode: 'epd', slots: noModules, traffic: stream(), cfg: { colocated, transferRate: 256, intakeCap: 32, drainPerTick: 6, maxTicks: 40000 } },
      { spawn: t.spawn },
    )
    let snap = await session.step(100)
    while (!snap.done) snap = await session.step(100)
    session.close()
    const result = snap.result!
    expect(result.colocated).toEqual({ goodput: Math.round((ca.sloMet / 240) * 1000) / 10, completed: ca.completed, shed: ca.shed, preempts: ca.autoPreempts })
    expect(result.epd).toEqual({ goodput: Math.round((ea.sloMet / 240) * 1000) / 10, completed: ea.completed, shed: ea.shed, preempts: ea.autoPreempts, delay: ea.avgDelay })
    expect(result.dumps).toEqual({ prefill: pre.mgrDump(), decode: dec.mgrDump() })
  })
})

describe('the watchdog', () => {
  const openMsg = { mode: 'engine' as const, slots: { ...noModules, sched: new ArrayBuffer(8) }, traffic: [] as RequestSpec[], cfg: { engine: profile.config, intakeCap: 8, drainPerTick: 2 } }

  /** Answers open, then streams tick progress 410..412 on `step` and never answers: a scheduler spinning at tick 412. */
  const spinsAt412: Script = (req, emit) => {
    if (req.cmd === 'open') emit({ type: 'ready', id: req.id, total: 0 })
    else if (req.cmd === 'step') for (const tick of [410, 411, 412]) emit({ type: 'tick', id: req.id, tick })
  }

  test('a step that outruns its budget terminates the worker and names the tick', async () => {
    const t = spawner(() => spinsAt412)
    const session = await openFleetSession(openMsg, { spawn: t.spawn, budgets: { step: 40 } })
    const started = Date.now()
    const error = await session.step(1).then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(FleetTimeoutError)
    const timeout = error as FleetTimeoutError
    expect(timeout.tick).toBe(412)
    expect(timeout.phase).toBe('step')
    expect(timeout.budgetMs).toBe(40)
    expect(timeout.message).toContain('your scheduler stopped responding at tick 412')
    expect(Date.now() - started).toBeLessThan(1000)
    expect(t.workers[0]!.terminated).toBe(true)
    // the session is over: it does not hang on a dead worker
    await expect(session.step(1)).rejects.toBeInstanceOf(FleetTimeoutError)
    expect(t.workers[0]!.received.filter((m) => m.cmd === 'step')).toHaveLength(1)
  })

  test('respawn: the next session gets a fresh worker and runs normally', async () => {
    let n = 0
    const t = spawner(() => (n++ === 0 ? spinsAt412 : hostScript()))
    const first = await openFleetSession(openMsg, { spawn: t.spawn, budgets: { step: 30 } })
    await expect(first.step(1)).rejects.toBeInstanceOf(FleetTimeoutError)
    expect(t.workers).toHaveLength(1)

    const second = await openFleetSession(
      { mode: 'engine', slots: noModules, traffic: engineStream(), cfg: { engine: profile.config, intakeCap: profile.intakeCap, drainPerTick: profile.drainPerTick } },
      { spawn: t.spawn, budgets: { step: 2000 } },
    )
    expect(t.workers).toHaveLength(2)
    expect(t.workers[0]!.terminated).toBe(true)
    expect(t.workers[1]!.terminated).toBe(false)
    expect((await second.step(3)).tick).toBe(3)
    second.close()
    expect(t.workers[1]!.terminated).toBe(true)
  })

  test('an open that never returns times out with the open budget', async () => {
    const t = spawner(() => () => {})
    const error = await openFleetSession(openMsg, { spawn: t.spawn, budgets: { open: 30 } }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(FleetTimeoutError)
    expect((error as FleetTimeoutError).phase).toBe('open')
    expect((error as FleetTimeoutError).message).toContain('did not finish loading within 0.03 s')
    expect(t.workers[0]!.terminated).toBe(true)
  })

  test('the default budgets are open 5 s, step 2 s, job 10 s', async () => {
    const { FLEET_JOB_BUDGET_MS, FLEET_OPEN_BUDGET_MS, FLEET_STEP_BUDGET_MS } = await import('../../src/workers/fleet-protocol')
    expect([FLEET_OPEN_BUDGET_MS, FLEET_STEP_BUDGET_MS, FLEET_JOB_BUDGET_MS]).toEqual([5000, 2000, 10_000])
    const t = spawner(() => spinsAt412)
    const session = await openFleetSession(openMsg, { spawn: t.spawn })
    const pending = session.step(1).catch((e: unknown) => e)
    await new Promise((resolve) => setTimeout(resolve, 100))
    // still waiting: nothing fires before 2 s
    expect(t.workers[0]!.terminated).toBe(false)
    session.close()
    expect(await pending).toBeInstanceOf(Error)
  })

  test('a job timeout names the scenario it was inside', async () => {
    const t = spawner(() => (req, emit) => {
      if (req.cmd === 'job') emit({ type: 'tick', id: req.id, tick: 931, scope: 'burst' })
    })
    const error = await runFleetJob({ bytes: null, burstgpt: {} as never, lmsysShape: {} as never }, { spawn: t.spawn, budgets: { job: 30 } }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(FleetTimeoutError)
    expect((error as FleetTimeoutError).message).toContain('your scheduler stopped responding at tick 931 of burst')
  })

  test('worker failures come back as the classes the panels already branch on', async () => {
    const failing = (kind: 'trap' | 'abi' | 'error', message: string): Script => (req, emit) => {
      if (req.cmd === 'open') emit({ type: 'ready', id: req.id, total: 0 })
      else emit({ type: 'failed', id: req.id, kind, message })
    }
    for (const [kind, ctor] of [['trap', LabTrapError], ['abi', LabAbiError], ['error', Error]] as const) {
      const t = spawner(() => failing(kind, 'boom'))
      const session = await openFleetSession(openMsg, { spawn: t.spawn })
      await expect(session.step(1)).rejects.toBeInstanceOf(ctor)
      session.close()
    }
  })

  test('a worker that crashes rejects the pending command', async () => {
    const crashing = new FakeWorker(() => {})
    const opening = openFleetSession(openMsg, { spawn: () => crashing, budgets: { open: 1000 } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    crashing.onerror?.({ message: 'wasm out of memory' })
    await expect(opening).rejects.toThrow('wasm out of memory')
  })

  test('timeouts are labelled by what the learner uploaded', () => {
    const bytes = new ArrayBuffer(1)
    expect(fleetLabel({ ...noModules, sched: bytes })).toBe('scheduler')
    expect(fleetLabel({ ...noModules, mgr: bytes })).toBe('block manager')
    expect(fleetLabel({ ...noModules, queue: bytes })).toBe('intake queue')
    expect(fleetLabel({ sched: bytes, mgr: bytes, queue: null })).toBe('stack')
    const e = describeFleetError(new FleetTimeoutError('scheduler', 'step', 412, 2000))
    expect(e).toMatchObject({ title: 'module stopped responding', timedOut: true })
    expect(describeFleetError(new LabTrapError()).timedOut).toBe(false)
  })

  test('a pool step that never returns names the tick it was given', async () => {
    const stuck: Script = (req, emit) => {
      if (req.cmd === 'open') emit({ type: 'ready', id: req.id, total: 0, dump: { numBlocks: 4, blockSize: 4, free: 4, refs: new Map(), seqs: new Map() } })
      else if (req.cmd === 'pool') emit({ type: 'tick', id: req.id, tick: req.tick })
    }
    const t = spawner(() => stuck)
    const session = await openPoolSession(
      { mode: 'pool', slots: { mgr: new ArrayBuffer(8) }, cfg: { numBlocks: 4, blockSize: 4 } },
      { spawn: t.spawn, budgets: { step: 30 } },
    )
    const error = await session.pool([{ kind: 'fork', a: 1, b: 2 }], 37).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FleetTimeoutError)
    expect((error as FleetTimeoutError).message).toContain('your block manager stopped responding at tick 37')
  })

  test('pool mode needs a block manager', async () => {
    const t = spawner(() => hostScript())
    await expect(openPoolSession({ mode: 'pool', slots: { mgr: null }, cfg: { numBlocks: 16, blockSize: 4 } }, { spawn: t.spawn })).rejects.toBeInstanceOf(LabAbiError)
    expect(t.workers[0]!.terminated).toBe(true)
  })
})

describe('reference modules earn no credit', () => {
  test('validateModule rejects a <lab>@reference build, and a learner build still passes', async () => {
    const reference = await validateModule(labModule('batching-scheduler@reference'), 'batching-scheduler')
    /* The lab worker (C1) now refuses a reference build at validateLabInWorker, before validateModule's own check. */
    expect(reference).toMatchObject({ ok: false, title: 'not a lab module' })
    expect(reference).toMatchObject({ detail: expect.stringContaining('reference modules earn no credit') })
    expect(await validateModule(labModule('batching-scheduler'), 'batching-scheduler')).toEqual({ ok: true })
    expect(await validateModule(labModule('mpmc-queue'), 'batching-scheduler')).toMatchObject({ ok: false, title: 'wrong lab module' })
  })

  test('the leaderboard rejects a @reference build before running anything', async () => {
    const stub = {} as never
    await expect(verifyAndScoreScheduler(labModule('batching-scheduler@reference'), stub, stub)).rejects.toThrow('reference modules earn no credit')
  })
})

describe('the leaderboard harness runs as a worker job', () => {
  test('the reference scores through a real fleet worker are identical to the in-process scores', async () => {
    const traces = await loadBenchmarkTraces()
    const inProcess = scoreReferenceBenchmark(traces.burstgpt, traces.lmsysShape)
    expect(inProcess).toEqual({ labGoodput: 76.6, fleetGoodput: 90.6 })
    expect(await scoreReferenceInWorker(traces.burstgpt, traces.lmsysShape)).toEqual(inProcess)
  }, 30_000)

  test('a submission is scored in the worker, and a failing harness comes back as the same message', async () => {
    const traces = await loadBenchmarkTraces()
    const job = await runFleetJob({ bytes: labModule('batching-scheduler'), burstgpt: traces.burstgpt, lmsysShape: traces.lmsysShape })
    // admits nothing, so nothing completes: the lab harness fails and the Fleet run is skipped
    expect(job.lab.pass).toBe(false)
    expect(job.fleet).toBeNull()
    await expect(verifyAndScoreScheduler(labModule('batching-scheduler'), traces.burstgpt, traces.lmsysShape)).rejects.toThrow(
      /^canonical lab harness failed — runs_clean: 0\/20 completed/,
    )
  }, 30_000)
})
