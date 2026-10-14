/**
 * fleet-host — the worker side of a Fleet session (docs/specs/wave-1.md §15.1).
 *
 * A host owns at most one session: an Engine pair, a Cluster, an EPD comparison, a pool-mode block
 * manager, an incident (world/incident-sim's session over a Cluster, §9.5) or the tokenizer's token count (§10.5),
 * with every learner module instantiated here from the slot bytes and the JS reference drivers beside it.
 * A cluster's prefix router is the learner's radix cache when the `router` slot is filled (§10.3). fleet.worker.ts wires `handle` to postMessage; tests drive it in-process behind a fake
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
  type RouterDriver,
  type SchedulerDriver,
} from './fleet-model'
import { runSchedulerJob } from './leaderboard-harness'
import { instantiateLab, LabAbiError, LabTrapError } from './wasm-lab'
import { makeWasmManager, makeWasmQueue, makeWasmRouter, makeWasmTokenCounter, type Mod } from '../pages/fleet/drivers'
import { makeWasmScheduler } from './wasm-scheduler'
import { IncidentSession, runExpert, type StackFactory } from './world/incident-sim'
import type { FixId, Hypothesis, ProbeId } from './world/incident-spec'
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
  IncidentFinish,
  IncidentFixReply,
  IncidentOpen,
  IncidentProbeReply,
  IncidentReady,
  IncidentWaitReply,
  PoolOpen,
  PoolOpResult,
  PoolTickResult,
  TokensOpen,
} from '../workers/fleet-protocol'

type Progress = (tick: number, scope?: string) => void

/** An incident session's commands (§9.5). Each reports the tick it is about to run through `progress`, as `step` does. */
interface IncidentCommands {
  hypothesis(h: Hypothesis): void
  probe(probe: ProbeId, progress: Progress): IncidentProbeReply
  fix(fix: FixId, progress: Progress): IncidentFixReply
  wait(progress: Progress): IncidentWaitReply
  finish(progress: Progress): Promise<IncidentFinish>
}

interface HostSession {
  /** requests in the run (0 for pool and incident modes) */
  total: number
  /** the initial dump a pool session reports on open */
  dump?: PoolTickResult['dump']
  /** the alert minute and the limit an incident session opened at */
  incident?: IncidentReady
  step?(ticks: number, progress: Progress): FleetSnapshot
  pool?(ops: FleetOp[], tick: number, progress: Progress): PoolTickResult
  /** tokens mode: the token count of each text */
  count?(texts: string[]): number[]
  commands?: IncidentCommands
}

/** Loads a lab module from its bytes. */
type Instantiate = (bytes: ArrayBuffer) => Promise<Mod>

export interface FleetHostOptions {
  /**
   * How the prefix router and the token counter load their modules; defaults to `instantiateLab`. Tests hand in JS
   * stand-ins for the version 3 verbs, since no wasm built from a private solution is ever committed.
   */
  instantiate?: Instantiate
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

/**
 * The prefix router over the radix-cache slot: one module instance per cluster worker, since a lab module's
 * state is a singleton per instance. Undefined (the cluster keeps its reference router) when the slot is empty.
 */
async function routerFor(slots: Pick<FleetSlotBytes, 'router'>, workers: number, instantiate: Instantiate): Promise<RouterDriver | undefined> {
  if (!slots.router) return undefined
  const mods: Mod[] = []
  for (let w = 0; w < workers; w++) mods.push(await instantiate(slots.router))
  return makeWasmRouter(mods)
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

async function openCluster(o: ClusterOpen, instantiate: Instantiate): Promise<HostSession> {
  const { cfg } = o
  const workers = await buildWorkers(o.slots, cfg.workers, cfg.worker, cfg.intakeCap, cfg.drainPerTick)
  const cluster = new Cluster(o.traffic, workers, cfg.router, await routerFor(o.slots, cfg.workers, instantiate))
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

/* ------------------------------ incident ------------------------------ */

/** One worker's instantiated modules; a missing one runs the reference driver. */
interface WorkerModules {
  sched?: Mod
  mgr?: Mod
  queue?: Mod
}

/** Every worker gets its own instance of each module, since the modules hold state. */
async function incidentModules(slots: FleetSlotBytes, workers: number): Promise<WorkerModules[]> {
  const out: WorkerModules[] = []
  for (let w = 0; w < workers; w++) {
    out.push({
      ...(slots.sched ? { sched: await instantiateLab(slots.sched) } : {}),
      ...(slots.mgr ? { mgr: await instantiateLab(slots.mgr) } : {}),
      ...(slots.queue ? { queue: await instantiateLab(slots.queue) } : {}),
    })
  }
  return out
}

/** Where a session reports the tick it is about to run, and which run inside the command that is (the expert's replay, say). */
interface TickReporter {
  progress: Progress
  scope: string | undefined
}

/**
 * The stack factory over instantiated modules. The tick a stalled module is inside is reported by the cluster
 * (`onTick` below), not by a driver: the intake queue is popped before the scheduler runs, so a queue that spins at
 * tick 412 would otherwise be reported as stuck at the scheduler's last tick, 411 (a learner module can only be
 * stuck inside one of its own calls, and the page sees nothing after that).
 */
function incidentStack(mods: WorkerModules[]): StackFactory {
  return (w, cfg, intakeCap) => {
    const m = mods[w]
    return {
      sched: m.sched ? makeWasmScheduler(m.sched) : makeRefScheduler(),
      mgr: m.mgr ? makeWasmManager(m.mgr, cfg.numBlocks, cfg.blockSize) : makeRefManager(cfg.numBlocks, cfg.blockSize),
      queue: m.queue ? makeWasmQueue(m.queue, intakeCap) : makeRefQueue(intakeCap),
    }
  }
}

/** The options of a session or replay whose stalls name the cluster tick they were in. */
const incidentOptions = (mods: WorkerModules[], reporter: TickReporter) => ({
  stack: incidentStack(mods),
  onTick: (tick: number) => reporter.progress(tick, reporter.scope),
})

async function openIncident(o: IncidentOpen, progress: Progress, instantiate: Instantiate): Promise<HostSession> {
  const { spec, slots } = o
  // The incident cluster routes join-shortest-queue, which never asks a prefix cache, so the prefix-router slot
  // is only proven here: every worker's instance loads and answers `reset`, and a stale or unfinished one fails `open`.
  await routerFor(slots, spec.workers, instantiate)
  const reporter: TickReporter = { progress, scope: undefined }
  // the constructor simulates the warm-up to the alert, so a spinning module stalls `open`
  const session = new IncidentSession(spec, incidentOptions(await incidentModules(slots, spec.workers), reporter))
  const ended = () => session.ended
  let expert: Pick<IncidentFinish, 'expertBurn' | 'expert'> | null = null
  const reportTo = (p: Progress) => {
    reporter.progress = p
    reporter.scope = undefined
  }
  return {
    total: 0,
    incident: { alert: session.alertMinute, limit: session.limit },
    commands: {
      hypothesis: (h) => session.hypothesis(h),
      probe(probe, p) {
        reportTo(p)
        return { ...session.probe(probe), ended: ended() }
      },
      fix(fix, p) {
        reportTo(p)
        return { ...session.fix(fix), ended: ended() }
      },
      wait(p) {
        reportTo(p)
        return { ...session.wait(), ended: ended() }
      },
      async finish(p) {
        reportTo(p)
        const outcome = session.finish()
        if (!expert) {
          // the expert replays the incident on fresh instances of the same modules (W11): one scorer, one clock
          const expertReporter: TickReporter = { progress: p, scope: 'the expert replay' }
          const run = runExpert(spec, incidentOptions(await incidentModules(slots, spec.workers), expertReporter))
          expert = { expertBurn: run.outcome.burn, expert: { actions: run.actions, named: run.named, steps: run.steps } }
        }
        return { ...outcome, ...expert, actions: [...session.actions] }
      },
    },
  }
}

/* -------------------------------- tokens -------------------------------- */

async function openTokens(o: TokensOpen, instantiate: Instantiate): Promise<HostSession> {
  const count = makeWasmTokenCounter(await instantiate(o.slots.tokenizer))
  return { total: 0, count: (texts) => texts.map(count) }
}

function openSession(open: FleetOpen, progress: Progress, instantiate: Instantiate): Promise<HostSession> {
  switch (open.mode) {
    case 'tokens':
      return openTokens(open, instantiate)
    case 'engine':
      return openEngine(open)
    case 'cluster':
      return openCluster(open, instantiate)
    case 'epd':
      return openEpd(open)
    case 'pool':
      return openPool(open)
    case 'incident':
      return openIncident(open, progress, instantiate)
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

export function createFleetHost(options: FleetHostOptions = {}): FleetHost {
  const instantiate = options.instantiate ?? instantiateLab
  let session: HostSession | null = null
  let queue: Promise<void> = Promise.resolve()

  const run = async (req: FleetRequest, emit: (reply: FleetReply) => void) => {
    const { id } = req
    try {
      if (req.cmd === 'open') {
        session = null
        session = await openSession(req.open, (tick, scope) => emit({ type: 'tick', id, tick, ...(scope ? { scope } : {}) }), instantiate)
        emit({
          type: 'ready',
          id,
          total: session.total,
          ...(session.dump ? { dump: session.dump } : {}),
          ...(session.incident ? { incident: session.incident } : {}),
        })
      } else if (req.cmd === 'step') {
        if (!session?.step) throw new Error('no stepping session is open')
        const snapshot = session.step(req.ticks, (tick, scope) => emit({ type: 'tick', id, tick, ...(scope ? { scope } : {}) }))
        emit({ type: 'step', id, snapshot })
      } else if (req.cmd === 'pool') {
        if (!session?.pool) throw new Error('no pool session is open')
        emit({ type: 'pool', id, result: session.pool(req.ops, req.tick, (tick) => emit({ type: 'tick', id, tick })) })
      } else if (req.cmd === 'count') {
        if (!session?.count) throw new Error('no token-count session is open')
        emit({ type: 'count', id, counts: session.count(req.texts) })
      } else if (req.cmd === 'hypothesis' || req.cmd === 'probe' || req.cmd === 'fix' || req.cmd === 'wait' || req.cmd === 'finish') {
        const c = session?.commands
        if (!c) throw new Error('no incident session is open')
        const progress: Progress = (tick, scope) => emit({ type: 'tick', id, tick, ...(scope ? { scope } : {}) })
        if (req.cmd === 'hypothesis') {
          c.hypothesis(req.hypothesis)
          emit({ type: 'hypothesis', id })
        } else if (req.cmd === 'probe') emit({ type: 'probe', id, result: c.probe(req.probe, progress) })
        else if (req.cmd === 'fix') emit({ type: 'fix', id, result: c.fix(req.fix, progress) })
        else if (req.cmd === 'wait') emit({ type: 'wait', id, result: c.wait(progress) })
        else emit({ type: 'finish', id, result: await c.finish(progress) })
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
