/**
 * fleet-host — the worker side of a Fleet session (docs/specs/wave-1.md §15.1).
 *
 * A host owns at most one session: an Engine pair, a Cluster, an EPD comparison or a pool-mode block
 * manager, with every learner module instantiated here from the slot bytes and the JS reference drivers
 * beside it. fleet.worker.ts wires `handle` to postMessage; tests drive it in-process behind a fake
 * worker, so a session's steps can be compared with a direct Engine run on the same inputs.
 *
 * Imports nothing that spawns a worker of its own.
 */

import {
  Cluster,
  dumpRefMultiset,
  Engine,
  EpdCluster,
  makeRefManager,
  makeRefQueue,
  makeRefScheduler,
  parseDump,
  RefBlockManager,
  type EngineConfig,
  type FleetOp,
  type ManagerDriver,
  type QueueDriver,
  type RequestSpec,
  type SchedulerDriver,
} from './fleet-model'
import { runSchedulerJob } from './leaderboard-harness'
import { instantiateLab, LabAbiError, LabTrapError } from './wasm-lab'
import { makeWasmManager, makeWasmQueue } from '../pages/fleet/drivers'
import { makeWasmScheduler } from './wasm-scheduler'
import type {
  ClusterOpen,
  ClusterSnapshot,
  EngineOpen,
  EngineSnapshot,
  EpdOpen,
  EpdResult,
  EpdSide,
  EpdSnapshot,
  FleetOpen,
  FleetReply,
  FleetRequest,
  FleetSlotBytes,
  FleetSnapshot,
  PoolOpen,
  PoolOpResult,
  PoolTickResult,
} from '../workers/fleet-protocol'

type Progress = (tick: number, scope?: string) => void

interface HostSession {
  /** requests in the run (0 for pool mode) */
  total: number
  /** the initial dump a pool session reports on open */
  dump?: PoolTickResult['dump']
  step?(ticks: number, progress: Progress): FleetSnapshot
  pool?(ops: FleetOp[], tick: number, progress: Progress): PoolTickResult
}

export interface FleetHost {
  /** Handle one command and emit its reply (and, for step and job, progress) through `emit`. Commands run in arrival order. */
  handle(req: FleetRequest, emit: (reply: FleetReply) => void): Promise<void>
}

const cloneRequest = (r: RequestSpec): RequestSpec => ({ ...r, ...(r.tokens ? { tokens: [...r.tokens] } : {}) })

async function schedulerFor(slots: Pick<FleetSlotBytes, 'sched'>): Promise<SchedulerDriver> {
  return slots.sched ? makeWasmScheduler(await instantiateLab(slots.sched)) : makeRefScheduler()
}

async function managerFor(slots: Pick<FleetSlotBytes, 'mgr'>, numBlocks: number, blockSize: number): Promise<ManagerDriver> {
  return slots.mgr ? makeWasmManager(await instantiateLab(slots.mgr), numBlocks, blockSize) : makeRefManager(numBlocks, blockSize)
}

async function queueFor(slots: Pick<FleetSlotBytes, 'queue'>, cap: number): Promise<QueueDriver> {
  return slots.queue ? makeWasmQueue(await instantiateLab(slots.queue), cap) : makeRefQueue(cap)
}

/* ------------------------------- engine ------------------------------- */

async function openEngine(o: EngineOpen): Promise<HostSession> {
  const { slots, traffic: stream, cfg } = o
  const referenceStream = stream.map(cloneRequest)
  const schedMine = await schedulerFor(slots)
  const mgrMine = await managerFor(slots, cfg.engine.numBlocks, cfg.engine.blockSize)
  const queueMine = await queueFor(slots, cfg.intakeCap)
  const mine = new Engine(cfg.engine, stream, schedMine, mgrMine, {
    intake: queueMine,
    intakeShadow: slots.queue ? makeRefQueue(cfg.intakeCap) : undefined,
    drainPerTick: cfg.drainPerTick,
  })
  const reference = new Engine(
    cfg.engine,
    referenceStream,
    makeRefScheduler(),
    makeRefManager(cfg.engine.numBlocks, cfg.engine.blockSize),
    { intake: makeRefQueue(cfg.intakeCap), drainPerTick: cfg.drainPerTick },
  )
  const snapshot = (): EngineSnapshot => {
    const s = mine.stats()
    const rs = reference.stats()
    return {
      mode: 'engine',
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
      total: stream.length,
    }
  }
  return {
    total: stream.length,
    step(ticks, progress) {
      for (let i = 0; i < ticks && !(mine.done && reference.done); i++) {
        progress(mine.tick)
        if (!mine.done) mine.step()
        if (!reference.done) reference.step()
      }
      return snapshot()
    },
  }
}

/* ------------------------------- cluster ------------------------------- */

async function buildWorkers(slots: FleetSlotBytes, count: number, cfg: EngineConfig, intakeCap: number, drain: number, prefillOnly?: boolean) {
  const workers: Engine[] = []
  for (let i = 0; i < count; i++) {
    const sched = await schedulerFor(slots)
    const mgr = await managerFor(slots, cfg.numBlocks, cfg.blockSize)
    const queue = await queueFor(slots, intakeCap)
    workers.push(new Engine(prefillOnly === undefined ? cfg : { ...cfg, prefillOnly }, [], sched, mgr, { intake: queue, drainPerTick: drain }))
  }
  return workers
}

async function openCluster(o: ClusterOpen): Promise<HostSession> {
  const { cfg } = o
  const workers = await buildWorkers(o.slots, cfg.workers, cfg.worker, cfg.intakeCap, cfg.drainPerTick)
  const cluster = new Cluster(o.traffic, workers, cfg.router)
  const snapshot = (): ClusterSnapshot => ({
    mode: 'cluster',
    tick: cluster.tick,
    agg: cluster.aggregate(),
    workers: cluster.workers.map((w, index) => {
      const s = w.stats()
      const dump = w.mgrDump()
      return {
        waiting: s.waitingNow,
        running: s.runningNow,
        util: Math.round(((dump.numBlocks - dump.free) / dump.numBlocks) * 100),
        cacheEntries: cluster.cacheEntries(index),
        dump,
      }
    }),
    done: cluster.done,
  })
  return {
    total: o.traffic.length,
    step(ticks, progress) {
      for (let i = 0; i < ticks && !cluster.done; i++) {
        progress(cluster.tick)
        cluster.step()
      }
      return snapshot()
    },
  }
}

/* --------------------------------- epd --------------------------------- */

async function openEpd(o: EpdOpen): Promise<HostSession> {
  const { cfg, slots } = o
  const col = cfg.colocated
  const total = o.traffic.length
  const fresh = () => o.traffic.map(cloneRequest)

  const colocated = new Cluster(fresh(), await buildWorkers(slots, 2, col, cfg.intakeCap, cfg.drainPerTick, false), 'jsq')
  const pCfg = { ...col, numBlocks: Math.floor(col.numBlocks / 2), prefillOnly: true }
  const dCfg = { ...col, numBlocks: col.numBlocks * 2 - pCfg.numBlocks }
  const [pre] = await buildWorkers(slots, 1, pCfg, cfg.intakeCap, cfg.drainPerTick, true)
  const [dec] = await buildWorkers(slots, 1, dCfg, cfg.intakeCap, cfg.drainPerTick, false)
  const split = new EpdCluster(fresh(), [pre], [dec], { prefillCfg: pCfg, decodeCfg: dCfg, transferRate: cfg.transferRate })

  let phase: EpdSnapshot['phase'] = 'colocated'
  let ticks = 0
  let guard = 0
  let colSide: EpdSide | null = null
  let result: EpdResult | null = null
  const pct = (met: number) => Math.round((met / total) * 1000) / 10

  const snapshot = (): EpdSnapshot => ({ mode: 'epd', tick: ticks, phase, done: phase === 'done', result })
  return {
    total,
    step(n, progress) {
      for (let i = 0; i < n && phase !== 'done'; i++) {
        if (phase === 'colocated') {
          if (colocated.done || guard >= cfg.maxTicks) {
            const a = colocated.aggregate()
            colSide = { goodput: pct(a.sloMet), completed: a.completed, shed: a.shed, preempts: a.autoPreempts }
            phase = 'epd'
            guard = 0
            continue
          }
          progress(colocated.tick, 'colocated')
          colocated.step()
        } else {
          if (split.done || guard >= cfg.maxTicks) {
            const a = split.aggregate()
            const epdSide: EpdSide = { goodput: pct(a.sloMet), completed: a.completed, shed: a.shed, preempts: a.autoPreempts, delay: a.avgDelay }
            const c = colSide as EpdSide
            result = {
              colocated: c,
              epd: epdSide,
              winner: c.goodput > epdSide.goodput ? 'colocated' : epdSide.goodput > c.goodput ? 'epd' : 'tie',
              dumps: { prefill: pre.mgrDump(), decode: dec.mgrDump() },
            }
            phase = 'done'
            continue
          }
          progress(split.tick, 'EPD')
          split.step()
        }
        guard++
        ticks++
      }
      return snapshot()
    },
  }
}

/* --------------------------------- pool --------------------------------- */

async function openPool(o: PoolOpen): Promise<HostSession> {
  if (!o.slots.mgr) throw new LabAbiError('pool mode needs a block-manager module')
  const mod = await instantiateLab(o.slots.mgr)
  mod.invoke(`init ${o.cfg.numBlocks} ${o.cfg.blockSize}`)
  const ref = new RefBlockManager(o.cfg.numBlocks, o.cfg.blockSize)
  const dump = parseDump(mod.invoke('dump'))
  return {
    total: 0,
    dump,
    pool(ops, tick, progress) {
      progress(tick)
      const results: PoolOpResult[] = []
      for (const op of ops) {
        let refResult = true
        if (op.kind === 'allocate') refResult = ref.allocate(op.a, op.n ?? 0)
        else if (op.kind === 'append') refResult = ref.append(op.a, op.n ?? 0)
        else if (op.kind === 'fork') refResult = ref.fork(op.a, op.b ?? 0)
        else ref.free(op.a)
        const cmd =
          op.kind === 'allocate'
            ? `allocate ${op.a} ${op.n}`
            : op.kind === 'append'
              ? `append ${op.a} ${op.n}`
              : op.kind === 'fork'
                ? `fork ${op.a} ${op.b}`
                : `free ${op.a}`
        results.push({ cmd, ref: refResult, got: mod.invoke(cmd).trim() })
      }
      const freeReply = Number(mod.invoke('free_blocks').trim())
      const parsed = parseDump(mod.invoke('dump'))
      return {
        ops: results,
        freeReply,
        refFree: ref.freeBlocks,
        dump: parsed,
        multiset: dumpRefMultiset(parsed),
        refMultiset: ref.refcountMultiset(),
      }
    },
  }
}

function openSession(open: FleetOpen): Promise<HostSession> {
  switch (open.mode) {
    case 'engine':
      return openEngine(open)
    case 'cluster':
      return openCluster(open)
    case 'epd':
      return openEpd(open)
    case 'pool':
      return openPool(open)
  }
}

/* --------------------------------- host --------------------------------- */

function failure(id: number, e: unknown): FleetReply {
  if (e instanceof LabTrapError) {
    return { type: 'failed', id, kind: 'trap', message: e.message, ...(e.phase === 'invoke' ? { phase: 'invoke' as const } : {}) }
  }
  return {
    type: 'failed',
    id,
    kind: e instanceof LabAbiError ? 'abi' : 'error',
    message: e instanceof Error ? e.message : String(e),
  }
}

export function createFleetHost(): FleetHost {
  let session: HostSession | null = null
  let queue: Promise<void> = Promise.resolve()

  const run = async (req: FleetRequest, emit: (reply: FleetReply) => void) => {
    const { id } = req
    try {
      if (req.cmd === 'open') {
        session = null
        session = await openSession(req.open)
        emit({ type: 'ready', id, total: session.total, ...(session.dump ? { dump: session.dump } : {}) })
      } else if (req.cmd === 'step') {
        if (!session?.step) throw new Error('no stepping session is open')
        const snapshot = session.step(req.ticks, (tick, scope) => emit({ type: 'tick', id, tick, ...(scope ? { scope } : {}) }))
        emit({ type: 'step', id, snapshot })
      } else if (req.cmd === 'pool') {
        if (!session?.pool) throw new Error('no pool session is open')
        emit({ type: 'pool', id, result: session.pool(req.ops, req.tick, (tick) => emit({ type: 'tick', id, tick })) })
      } else if (req.cmd === 'job') {
        const result = await runSchedulerJob(req.job, (scope, tick) => emit({ type: 'tick', id, tick, scope }))
        emit({ type: 'job', id, result })
      } else {
        session = null
        emit({ type: 'closed', id })
      }
    } catch (e) {
      emit(failure(id, e))
    }
  }

  return {
    handle(req, emit) {
      const next = queue.then(() => run(req, emit))
      queue = next
      return next
    },
  }
}
