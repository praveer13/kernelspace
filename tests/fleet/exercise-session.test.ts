/**
 * The exercise job and the P:D worker counts (docs/specs/wave-3.md §5.3; task 3b-03). A job {kind: 'exercise', id, seed}
 * runs FLEET_EXERCISES[id].sweep(seed) in the fleet worker and replies with its SweepResult inside the 10 s job budget;
 * the worker, host and session know no exercise by name; EpdOpen takes {prefill, decode} counts with 1 + 1 the default,
 * which leaves every existing EPD run byte-identical; EpdCluster's aggregate gains TPOT p95, which the EPD session's
 * result does not carry.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  Cluster,
  Engine,
  EpdCluster,
  makeRefManager,
  makeRefQueue,
  makeRefScheduler,
  makeRequestStream,
  PRACTICE_SEED,
  type EngineConfig,
} from '../../src/lib/fleet-model'
import { createFleetHost } from '../../src/lib/fleet-host'
import { FleetTimeoutError, openFleetSession, runFleetExercise, type FleetWorkerLike } from '../../src/lib/fleet-session'
import { FLEET_EXERCISES, type FleetExerciseDef, type SweepResult } from '../../src/lib/world/fleet-ex'
import { FLEET_JOB_BUDGET_MS, type EpdOpen, type FleetReply, type FleetRequest } from '../../src/workers/fleet-protocol'

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
function spawner(script: () => Script = () => {
  const host = createFleetHost()
  return (req, emit) => host.handle(req, emit)
}) {
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

/* ------------------------------- the exercise job ------------------------------- */

describe('the exercise job', () => {
  test('runs FLEET_EXERCISES[id].sweep(seed) in the worker and returns its SweepResult', async () => {
    const t = spawner()
    for (const [id, seed] of [['knee', 7], ['pd-split', 1], ['knee', 0xffffffff]] as const) {
      const got = await runFleetExercise(id, seed, { spawn: t.spawn })
      expect(got).toEqual((FLEET_EXERCISES[id] as FleetExerciseDef).sweep(seed))
    }
    // one-shot: each job opened its own worker and closed it
    expect(t.workers).toHaveLength(3)
    expect(t.workers.every((w) => w.terminated)).toBe(true)
    expect(t.workers[0]?.received.map((m) => m.cmd)).toEqual(['job'])
    expect(t.workers[0]?.received[0]).toMatchObject({ cmd: 'job', job: { kind: 'exercise', id: 'knee', seed: 7 } })
  })

  test('rides the job budget, 10 s, and a stuck sweep times out with the worker stopped', async () => {
    expect(FLEET_JOB_BUDGET_MS).toBe(10_000)
    const t = spawner(() => () => {})
    const error = await runFleetExercise('knee', 1, { spawn: t.spawn, budgets: { job: 30 } }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(FleetTimeoutError)
    expect((error as FleetTimeoutError).phase).toBe('job')
    expect((error as FleetTimeoutError).budgetMs).toBe(30)
    expect(t.workers[0]?.terminated).toBe(true)
  })

  test('every sweep of both exercises finishes inside the real default budget (seeds 0 … 4, worst printed)', async () => {
    let worst = 0
    for (const id of ['knee', 'pd-split']) {
      for (let seed = 0; seed < 5; seed++) {
        const t0 = performance.now()
        await runFleetExercise(id, seed, { spawn: spawner().spawn })
        worst = Math.max(worst, performance.now() - t0)
      }
    }
    console.log(`slowest exercise job over seeds 0–4, through host and session: ${worst.toFixed(0)} ms of ${FLEET_JOB_BUDGET_MS} ms`)
    expect(worst).toBeLessThan(FLEET_JOB_BUDGET_MS / 5)
  })

  test('an unknown id, an inherited name or a seed that is not a uint32 fails the job and nothing else', async () => {
    const t = spawner()
    for (const id of ['no-such-exercise', 'toString', 'constructor', '__proto__', '']) {
      await expect(runFleetExercise(id, 1, { spawn: t.spawn })).rejects.toThrow(`unknown Fleet exercise "${id}"`)
    }
    for (const seed of [-1, 1.5, 2 ** 32, NaN, Infinity]) {
      await expect(runFleetExercise('knee', seed, { spawn: t.spawn })).rejects.toThrow('an exercise seed is a uint32')
    }
  })

  test('dispatches by id only: an exercise added to the table runs with no change to protocol, host or session', async () => {
    const table = FLEET_EXERCISES as Record<string, FleetExerciseDef>
    const canned: SweepResult = { points: [{ x: 3, goodputRps: 1.5, ttftP95: 4 }] }
    const calls: number[] = []
    table['probe-exercise'] = {
      id: 'probe-exercise',
      title: 'probe',
      lessonId: 't7.l2',
      kcs: [],
      unit: 'nothing',
      points: [3],
      sweep: (seed) => {
        calls.push(seed)
        return canned
      },
      truth: () => 3,
      band: () => true,
      pass: () => true,
      productionClaims: [],
      phone: { canonical: canned },
    }
    try {
      expect(await runFleetExercise('probe-exercise', 99, { spawn: spawner().spawn })).toEqual(canned)
      expect(calls).toEqual([99])
    } finally {
      delete table['probe-exercise']
    }
    await expect(runFleetExercise('probe-exercise', 99, { spawn: spawner().spawn })).rejects.toThrow('unknown Fleet exercise')
  })

  test('the protocol, host and session files name no exercise', async () => {
    for (const file of ['src/workers/fleet-protocol.ts', 'src/lib/fleet-host.ts', 'src/lib/fleet-session.ts', 'src/workers/fleet.worker.ts']) {
      const text = await Bun.file(join(import.meta.dir, '..', '..', file)).text()
      for (const id of Object.keys(FLEET_EXERCISES)) expect(text).not.toMatch(new RegExp(`['"\`]${id}['"\`]`))
    }
  })

  test('a job with no `kind` is the leaderboard\'s and takes its old path, not the exercise lookup', async () => {
    const host = createFleetHost()
    const exercise: FleetReply[] = []
    await host.handle({ id: 5, cmd: 'job', job: { kind: 'exercise', id: 'knee', seed: 2 } }, (r) => exercise.push(r))
    expect(exercise.map((r) => r.type)).toEqual(['exercise'])
    // malformed leaderboard input fails inside the harness, which is how we know it ran
    const old: FleetReply[] = []
    await host.handle({ id: 6, cmd: 'job', job: { bytes: new ArrayBuffer(8), burstgpt: {} as never, lmsysShape: {} as never } }, (r) => old.push(r))
    const last = old.at(-1)
    expect(last?.type).toBe('failed')
    expect((last as Extract<FleetReply, { type: 'failed' }>).message).not.toContain('exercise')
  })
})

/* --------------------------- the P:D split on any worker counts --------------------------- */

const colocated: EngineConfig = { numBlocks: 192, blockSize: 16, maxRunning: 12, sloTtft: 40, prefillChunk: 128, interference: true, sloItl: 2 }
const stream = () => makeRequestStream(240, 900, PRACTICE_SEED)

function epdOpen(workers?: { prefill: number; decode: number }): EpdOpen {
  return {
    mode: 'epd',
    slots: noModules,
    traffic: stream(),
    cfg: { colocated, transferRate: 256, intakeCap: 32, drainPerTick: 6, maxTicks: 40000, ...(workers ? { workers } : {}) },
  }
}

async function runEpd(open: EpdOpen) {
  const t = spawner()
  const session = await openFleetSession(open, { spawn: t.spawn })
  let snap = await session.step(100)
  while (!snap.done) snap = await session.step(100)
  session.close()
  return snap
}

/** The same two topologies by hand, with the cut the host documents: a prefill worker gets half an engine's blocks. */
function direct(prefill: number, decode: number) {
  const mk = (cfg: EngineConfig, prefillOnly: boolean) =>
    new Engine({ ...cfg, prefillOnly }, [], makeRefScheduler(), makeRefManager(cfg.numBlocks, cfg.blockSize), { intake: makeRefQueue(32), drainPerTick: 6 })
  const col = new Cluster(stream(), Array.from({ length: prefill + decode }, () => mk(colocated, false)), 'jsq')
  while (!col.done) col.step()
  const pCfg = { ...colocated, numBlocks: Math.floor(colocated.numBlocks / 2), prefillOnly: true }
  const dCfg = { ...colocated, numBlocks: Math.floor(((prefill + decode) * colocated.numBlocks - prefill * pCfg.numBlocks) / decode) }
  const pre = Array.from({ length: prefill }, () => mk(pCfg, true))
  const dec = Array.from({ length: decode }, () => mk(dCfg, false))
  const epd = new EpdCluster(stream(), pre, dec, { prefillCfg: pCfg, decodeCfg: dCfg, transferRate: 256 })
  while (!epd.done) epd.step()
  return { ca: col.aggregate(), ea: epd.aggregate(), pre, dec, dCfg }
}

describe('EpdOpen takes {prefill, decode} worker counts', () => {
  test('1 + 1 is the default: the existing run is byte-identical to the one this session pinned before the change', async () => {
    const snap = await runEpd(epdOpen())
    const r = snap.result!
    // captured from the host before it took counts (the same 240-request practice stream, 192-block workers)
    expect(snap.tick).toBe(2800)
    expect(r.colocated).toEqual({ goodput: 23.8, completed: 240, shed: 0, preempts: 0 })
    expect(r.epd).toEqual({ goodput: 39.2, completed: 219, shed: 21, preempts: 24, delay: 95.8 })
    expect(r.winner).toBe('epd')
    expect([r.dumps.prefill.numBlocks, r.dumps.prefill.free, r.dumps.decode.numBlocks, r.dumps.decode.free]).toEqual([96, 96, 288, 288])
  })

  test('an explicit {1, 1} equals leaving it out', async () => {
    const a = await runEpd(epdOpen())
    const b = await runEpd(epdOpen({ prefill: 1, decode: 1 }))
    expect(b).toEqual(a)
  })

  test('the EPD session\'s result keeps its shape: no TPOT p95 in either side', async () => {
    const snap = await runEpd(epdOpen({ prefill: 3, decode: 5 }))
    expect(Object.keys(snap)).toEqual(['mode', 'tick', 'phase', 'done', 'result'])
    expect(Object.keys(snap.result!)).toEqual(['colocated', 'epd', 'winner', 'dumps'])
    expect(Object.keys(snap.result!.colocated)).toEqual(['goodput', 'completed', 'shed', 'preempts'])
    expect(Object.keys(snap.result!.epd)).toEqual(['goodput', 'completed', 'shed', 'preempts', 'delay'])
  })

  test('3 + 5 matches the two topologies run by hand on 8 workers', async () => {
    const snap = await runEpd(epdOpen({ prefill: 3, decode: 5 }))
    const { ca, ea, pre, dec, dCfg } = direct(3, 5)
    const r = snap.result!
    expect(r.colocated).toEqual({ goodput: Math.round((ca.sloMet / 240) * 1000) / 10, completed: ca.completed, shed: ca.shed, preempts: ca.autoPreempts })
    expect(r.epd).toEqual({ goodput: Math.round((ea.sloMet / 240) * 1000) / 10, completed: ea.completed, shed: ea.shed, preempts: ea.autoPreempts, delay: ea.avgDelay })
    expect(r.dumps).toEqual({ prefill: (pre[0] as Engine).mgrDump(), decode: (dec[0] as Engine).mgrDump() })
    // the cut: three half-engines of 96 blocks, five decode pools sharing the other 1,536 − 288 blocks
    expect(r.dumps.prefill.numBlocks).toBe(96)
    expect(r.dumps.decode.numBlocks).toBe(dCfg.numBlocks)
    expect(dCfg.numBlocks).toBe(249)
    // more GPUs than the 1 + 1 comparison serve the same traffic better, on both topologies
    const base = (await runEpd(epdOpen())).result!
    expect(r.colocated.goodput).toBeGreaterThan(base.colocated.goodput)
    expect(r.epd.goodput).toBeGreaterThan(base.epd.goodput)
  })

  test('every split from 1:7 to 7:1 opens and finishes', async () => {
    for (let p = 1; p <= 7; p++) {
      const snap = await runEpd(epdOpen({ prefill: p, decode: 8 - p }))
      expect(snap.done).toBe(true)
      expect(snap.result?.epd.completed).toBeGreaterThan(0)
    }
  })

  test('counts under 1, or that are not whole numbers, fail the open', async () => {
    for (const workers of [{ prefill: 0, decode: 1 }, { prefill: 1, decode: 0 }, { prefill: 1.5, decode: 2 }, { prefill: 2, decode: -1 }, { prefill: NaN, decode: 1 }]) {
      await expect(openFleetSession(epdOpen(workers), { spawn: spawner().spawn })).rejects.toThrow('an EPD split needs at least one prefill and one decode worker')
    }
  })
})

describe('EpdCluster\'s aggregate reports TPOT p95', () => {
  test('it is the 95th percentile of the decode workers\' per-request TPOT, and nothing else changes', () => {
    const { ea, dec } = direct(2, 2)
    const tpots = dec.flatMap((w) => w.stats().tpots).sort((a, b) => a - b)
    expect(tpots.length).toBe(ea.completed)
    expect(ea.tpotP95).toBe(tpots[Math.max(0, Math.ceil(tpots.length * 0.95) - 1)] as number)
    expect(ea.tpotP95).toBeGreaterThanOrEqual(1)
    expect(Object.keys(ea).sort()).toEqual(['autoPreempts', 'avgDelay', 'completed', 'inFlight', 'shed', 'sloMet', 'tpotP95', 'ttftP95'])
  })
})
