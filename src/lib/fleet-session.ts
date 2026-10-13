/**
 * fleet-session — main-thread client for src/workers/fleet.worker.ts (docs/specs/wave-1.md §15.1).
 *
 * Admitted learner wasm still never runs on the main thread: a session opens a worker, the worker
 * instantiates the slot bytes and holds the Engine, Cluster or EpdCluster, and the panels `await
 * session.step(n)` at their usual cadence. Every command has a budget (open 5 s, step 2 s, the
 * leaderboard job 10 s; an incident's probe, fix and wait take the step budget and its finish 5 s). When one expires the worker is terminated and the call rejects with a
 * FleetTimeoutError that names the tick the worker never finished; the page stays responsive throughout.
 *
 * One session owns one worker, so "respawn" is simply opening the next session.
 */

import { LabAbiError, LabTrapError } from './wasm-lab'
import {
  FLEET_FINISH_BUDGET_MS,
  FLEET_JOB_BUDGET_MS,
  FLEET_OPEN_BUDGET_MS,
  FLEET_STEP_BUDGET_MS,
  type ClusterOpen,
  type EngineOpen,
  type EpdOpen,
  type FleetReply,
  type FleetRequest,
  type FleetSlotBytes,
  type FleetSnapshotByMode,
  type IncidentFinish,
  type IncidentFixReply,
  type IncidentOpen,
  type IncidentProbeReply,
  type IncidentWaitReply,
  type LeaderboardJob,
  type LeaderboardJobResult,
  type PoolOpen,
  type PoolTickResult,
} from '../workers/fleet-protocol'
import type { FleetOp, ManagerDump } from './fleet-model'
import type { FixId, Hypothesis, ProbeId } from './world/incident-spec'

/** The slice of Worker the client uses; tests inject a fake through `FleetSessionOptions.spawn`. */
export interface FleetWorkerLike {
  postMessage(msg: FleetRequest): void
  terminate(): void
  onmessage: ((ev: { data: FleetReply }) => void) | null
  onerror: ((ev: { message?: string }) => void) | null
}

export interface FleetBudgets {
  open: number
  step: number
  job: number
  finish: number
}

export interface FleetSessionOptions {
  spawn?: () => FleetWorkerLike
  budgets?: Partial<FleetBudgets>
  /** what a timeout calls the learner's code ("scheduler", "block manager", ...); defaults from the slots */
  label?: string
}

export type FleetPhase = 'open' | 'step' | 'job' | 'finish'

/** A command outran its budget; the worker has been terminated. */
export class FleetTimeoutError extends Error {
  /** the tick the worker had started but never finished (0 when `open` itself timed out) */
  readonly tick: number
  readonly phase: FleetPhase
  readonly budgetMs: number
  /** which run inside the command was stuck: a leaderboard scenario, or the EPD topology */
  readonly scope: string | undefined

  constructor(label: string, phase: FleetPhase, tick: number, budgetMs: number, scope?: string) {
    const seconds = `${budgetMs / 1000} s`
    super(
      phase === 'open'
        ? `your ${label} did not finish loading within ${seconds}, so the fleet worker was stopped. Look for an infinite loop in init.`
        : `your ${label} stopped responding at tick ${tick}${scope ? ` of ${scope}` : ''} (no reply within ${seconds}), so the fleet worker was stopped.`,
    )
    this.name = 'FleetTimeoutError'
    this.tick = tick
    this.phase = phase
    this.budgetMs = budgetMs
    this.scope = scope
  }
}

const SLOT_NOUN = { sched: 'scheduler', mgr: 'block manager', queue: 'intake queue' } as const

/** Names the uploaded module in a timeout message: the one the learner uploaded, or "stack" for several. */
export function fleetLabel(slots: Partial<FleetSlotBytes>): string {
  const mine = (['sched', 'mgr', 'queue'] as const).filter((k) => slots[k])
  return mine.length === 1 ? SLOT_NOUN[mine[0]!] : 'stack'
}

export function spawnFleetWorker(): FleetWorkerLike {
  return new Worker(new URL('../workers/fleet.worker.ts', import.meta.url), { type: 'module' }) as unknown as FleetWorkerLike
}

type Command = FleetRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never

class Channel {
  private readonly worker: FleetWorkerLike
  private readonly label: string
  private readonly budgets: FleetBudgets
  /** resolves once the worker has loaded: startup stays out of every command budget */
  private readonly booted: Promise<void>
  private nextId = 0
  /* One command at a time: a timeout terminates the worker, so queued commands must not start behind it. */
  private chain: Promise<unknown> = Promise.resolve()
  private pending: { id: number; settle: (reply: FleetReply | Error) => void } | null = null
  private ended: Error | null = null
  private lastTick = 0
  private lastScope: string | undefined

  constructor(options: FleetSessionOptions, label: string) {
    this.worker = (options.spawn ?? spawnFleetWorker)()
    this.label = options.label ?? label
    this.budgets = {
      open: options.budgets?.open ?? FLEET_OPEN_BUDGET_MS,
      step: options.budgets?.step ?? FLEET_STEP_BUDGET_MS,
      job: options.budgets?.job ?? FLEET_JOB_BUDGET_MS,
      finish: options.budgets?.finish ?? FLEET_FINISH_BUDGET_MS,
    }
    this.booted = new Promise<void>((resolve, reject) => {
      this.worker.onmessage = (ev) => {
        const m = ev.data
        if (m.type === 'boot') resolve()
        else if (m.type === 'tick') this.onTick(m)
        else if (this.pending?.id === m.id) this.pending.settle(m)
      }
      this.worker.onerror = (ev) => {
        const crash = new Error(ev.message || 'the fleet worker crashed')
        this.end(crash)
        reject(crash)
      }
    })
    this.booted.catch(() => {})
  }

  private onTick(m: Extract<FleetReply, { type: 'tick' }>) {
    if (this.pending?.id !== m.id) return
    this.lastTick = m.tick
    this.lastScope = m.scope
  }

  /** Terminate the worker and fail whatever command is in flight, so no caller waits on a dead worker. */
  private end(reason: Error) {
    if (this.ended) return
    this.ended = reason
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.terminate()
    this.pending?.settle(reason)
  }

  /** Terminate the worker; later commands reject. */
  close() {
    this.end(new Error('this fleet session was closed'))
  }

  request(command: Command, phase: FleetPhase): Promise<FleetReply> {
    const result = this.chain.then(() => this.dispatch(command, phase))
    this.chain = result.catch(() => {})
    return result
  }

  private async dispatch(command: Command, phase: FleetPhase): Promise<FleetReply> {
    if (this.ended) throw this.ended
    await this.booted
    if (this.ended) throw this.ended
    const id = this.nextId++
    const budgetMs = this.budgets[phase]
    this.lastTick = 0
    this.lastScope = undefined
    return new Promise<FleetReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.end(new FleetTimeoutError(this.label, phase, this.lastTick, budgetMs, this.lastScope))
      }, budgetMs)
      this.pending = {
        id,
        settle: (reply) => {
          clearTimeout(timer)
          this.pending = null
          if (reply instanceof Error) reject(reply)
          else if (reply.type === 'failed') reject(rebuild(reply))
          else resolve(reply)
        },
      }
      this.worker.postMessage({ id, ...command } as FleetRequest)
    })
  }
}

/** The worker sends error kinds, not classes; panels branch on the same classes the main-thread drivers threw. */
function rebuild(m: Extract<FleetReply, { type: 'failed' }>): Error {
  if (m.kind === 'trap') return new LabTrapError(undefined, m.phase)
  if (m.kind === 'abi') return new LabAbiError(m.message)
  return new Error(m.message)
}

function expect<T extends FleetReply['type']>(reply: FleetReply, type: T): Extract<FleetReply, { type: T }> {
  if (reply.type !== type) throw new Error(`fleet worker answered "${reply.type}", expected "${type}"`)
  return reply as Extract<FleetReply, { type: T }>
}

export interface FleetSession<S> {
  /** requests in the run */
  readonly total: number
  /** Run up to `ticks` ticks (the panel's cadence is one per 60 ms) and return the snapshot after them. */
  step(ticks?: number): Promise<S>
  /** Terminate the worker. */
  close(): void
}

export interface PoolSession {
  /** the module's dump straight after `init` */
  readonly dump: ManagerDump
  /** Run tick `tick`'s ops against the module and the reference. */
  pool(ops: FleetOp[], tick: number): Promise<PoolTickResult>
  close(): void
}

/**
 * Open an engine, cluster or EPD session. Rejects with FleetTimeoutError if instantiating the modules takes
 * over 5 s, with LabTrapError / LabAbiError when a module traps or breaks the ABI while loading.
 */
export function openFleetSession(open: EngineOpen, options?: FleetSessionOptions): Promise<FleetSession<FleetSnapshotByMode['engine']>>
export function openFleetSession(open: ClusterOpen, options?: FleetSessionOptions): Promise<FleetSession<FleetSnapshotByMode['cluster']>>
export function openFleetSession(open: EpdOpen, options?: FleetSessionOptions): Promise<FleetSession<FleetSnapshotByMode['epd']>>
export async function openFleetSession(
  open: EngineOpen | ClusterOpen | EpdOpen,
  options: FleetSessionOptions = {},
): Promise<FleetSession<FleetSnapshotByMode[keyof FleetSnapshotByMode]>> {
  const channel = new Channel(options, fleetLabel(open.slots))
  try {
    const { total } = expect(await channel.request({ cmd: 'open', open }, 'open'), 'ready')
    return {
      total,
      async step(ticks = 1) {
        return expect(await channel.request({ cmd: 'step', ticks }, 'step'), 'step').snapshot as FleetSnapshotByMode[keyof FleetSnapshotByMode]
      },
      close: () => channel.close(),
    }
  } catch (e) {
    channel.close()
    throw e
  }
}

/** Pool mode: the learner's block manager, op by op, in lockstep with the JS reference inside the worker. */
export async function openPoolSession(open: PoolOpen, options: FleetSessionOptions = {}): Promise<PoolSession> {
  const channel = new Channel(options, fleetLabel(open.slots))
  try {
    const { dump } = expect(await channel.request({ cmd: 'open', open }, 'open'), 'ready')
    if (!dump) throw new Error('fleet worker opened the pool without a dump')
    return {
      dump,
      async pool(ops, tick) {
        return expect(await channel.request({ cmd: 'pool', tick, ops }, 'step'), 'pool').result
      },
      close: () => channel.close(),
    }
  } catch (e) {
    channel.close()
    throw e
  }
}

export interface IncidentClientSession {
  /** the clock minute the alert fired; the learner's clock starts here */
  readonly alert: number
  /** the last minute the incident may run to */
  readonly limit: number
  /** Log or revise a hypothesis; it costs no time. */
  hypothesis(h: Hypothesis): Promise<void>
  /** Take a probe: the clock advances by its cost and the reply is what it shows. */
  probe(id: ProbeId): Promise<IncidentProbeReply>
  /** Apply a fix: the right one reverts the fault, any other wastes time. `effective` says which. */
  fix(id: FixId): Promise<IncidentFixReply>
  /** Let one incident minute pass. */
  wait(): Promise<IncidentWaitReply>
  /** Run the clock on to the end and score it against the expert on the same modules. */
  finish(): Promise<IncidentFinish>
  close(): void
}

/**
 * Open an incident (§9.5) in a fleet worker: the incident cluster, built with the learner's module bytes in
 * the slots (null slots run the reference drivers), run up to its alert. Rejects with FleetTimeoutError if
 * that takes over 5 s, like the other modes. Every command after it is one at a time with a 2 s budget
 * (`finish` 5 s); when one expires the worker is terminated and the call rejects with FleetTimeoutError.
 */
export async function openIncidentSession(open: IncidentOpen, options: FleetSessionOptions = {}): Promise<IncidentClientSession> {
  const channel = new Channel(options, fleetLabel(open.slots))
  try {
    const ready = expect(await channel.request({ cmd: 'open', open }, 'open'), 'ready')
    if (!ready.incident) throw new Error('fleet worker opened the incident without its alert')
    return {
      alert: ready.incident.alert,
      limit: ready.incident.limit,
      async hypothesis(hypothesis) {
        expect(await channel.request({ cmd: 'hypothesis', hypothesis }, 'step'), 'hypothesis')
      },
      async probe(probe) {
        return expect(await channel.request({ cmd: 'probe', probe }, 'step'), 'probe').result
      },
      async fix(fix) {
        return expect(await channel.request({ cmd: 'fix', fix }, 'step'), 'fix').result
      },
      async wait() {
        return expect(await channel.request({ cmd: 'wait' }, 'step'), 'wait').result
      },
      async finish() {
        return expect(await channel.request({ cmd: 'finish' }, 'finish'), 'finish').result
      },
      close: () => channel.close(),
    }
  } catch (e) {
    channel.close()
    throw e
  }
}

/** The leaderboard harness as a one-shot job (10 s): lab harness, then the Fleet run. The worker is gone afterwards. */
export async function runFleetJob(job: LeaderboardJob, options: FleetSessionOptions = {}): Promise<LeaderboardJobResult> {
  const channel = new Channel(options, 'scheduler')
  try {
    return expect(await channel.request({ cmd: 'job', job }, 'job'), 'job').result
  } finally {
    channel.close()
  }
}

/** What a panel shows for a failed command: the same words the main-thread drivers used, plus whether "reset with reference drivers" helps. */
export function describeFleetError(e: unknown, fallbackTitle = 'engine error'): { title: string; detail: string; timedOut: boolean } {
  if (e instanceof FleetTimeoutError) {
    return { title: e.phase === 'open' ? 'module did not load' : 'module stopped responding', detail: e.message, timedOut: true }
  }
  if (e instanceof LabTrapError) {
    return { title: 'module trapped mid-run', detail: 'a todo!() or panic fired while the engine was driving your code.', timedOut: false }
  }
  if (e instanceof LabAbiError) return { title: 'ABI problem', detail: e.message, timedOut: false }
  return { title: fallbackTitle, detail: e instanceof Error ? e.message : String(e), timedOut: false }
}
