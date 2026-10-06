/**
 * Messages between the main thread and fleet.worker.ts. Types and budgets only, safe to import from both sides.
 *
 * One worker holds one session: a single Engine, Cluster or EpdCluster (or a pool-mode block manager)
 * with its drivers. Learner modules are instantiated inside the worker from the slot bytes, so a module
 * that spins can only stall that worker; the client terminates it when a command outruns its budget.
 */

import type {
  ClusterStats,
  EngineConfig,
  FleetOp,
  ManagerDump,
  RequestSpec,
  RouterKind,
} from '../lib/fleet-model'
import type { LabHarnessResult } from '../lib/leaderboard'
import type { TraceArtifact } from '../lib/traces'

/** `open` includes instantiating every module in the stack. */
export const FLEET_OPEN_BUDGET_MS = 5000
/** One `step` or `pool` batch. */
export const FLEET_STEP_BUDGET_MS = 2000
/** The leaderboard harness: seven canonical scenarios plus the Fleet run, as one job. */
export const FLEET_JOB_BUDGET_MS = 10_000

/** Raw module bytes per Fleet slot; null = the JS reference driver. Never transferred, callers keep their bytes. */
export interface FleetSlotBytes {
  sched: ArrayBuffer | null
  mgr: ArrayBuffer | null
  queue: ArrayBuffer | null
}

/* ------------------------------- open ------------------------------- */

export interface EngineOpen {
  mode: 'engine'
  slots: FleetSlotBytes
  traffic: RequestSpec[]
  cfg: { engine: EngineConfig; intakeCap: number; drainPerTick: number }
}

export interface ClusterOpen {
  mode: 'cluster'
  slots: FleetSlotBytes
  traffic: RequestSpec[]
  cfg: { worker: EngineConfig; workers: number; router: RouterKind; intakeCap: number; drainPerTick: number }
}

/** Runs the colocated topology and then the prefill/decode split on the same traffic, one tick at a time. */
export interface EpdOpen {
  mode: 'epd'
  slots: FleetSlotBytes
  traffic: RequestSpec[]
  cfg: {
    /** two colocated workers; the EPD pools are cut from the same total blocks */
    colocated: EngineConfig
    transferRate: number
    intakeCap: number
    drainPerTick: number
    /** per-topology tick ceiling */
    maxTicks: number
  }
}

/** Pool mode: the learner's block manager alone, op by op against a JS reference in the same worker. */
export interface PoolOpen {
  mode: 'pool'
  slots: Pick<FleetSlotBytes, 'mgr'>
  cfg: { numBlocks: number; blockSize: number }
}

export type FleetOpen = EngineOpen | ClusterOpen | EpdOpen | PoolOpen

/* ----------------------------- snapshots ----------------------------- */

export interface EngineMineStats {
  met: number
  done: number
  p95: number
  tpotP95: number
  queueP95: number
  inputTokens: number
  outputTokens: number
  autoPreempts: number
  capMisses: number
  shed: number
  waiting: number
  running: number
}

export interface EngineSnapshot {
  mode: 'engine'
  tick: number
  mine: EngineMineStats
  reference: { met: number; done: number; p95: number }
  dump: ManagerDump
  /** first three engine legality violations, empty when none */
  violations: string[]
  /** first intake-queue divergence, null when the queue never disagreed with the shadow */
  divergence: string | null
  /** both engines have drained */
  done: boolean
  total: number
}

export interface ClusterWorkerRow {
  waiting: number
  running: number
  util: number
  cacheEntries: number
  dump: ManagerDump
}

export interface ClusterSnapshot {
  mode: 'cluster'
  tick: number
  agg: ClusterStats
  workers: ClusterWorkerRow[]
  done: boolean
}

export interface EpdSide {
  goodput: number
  completed: number
  shed: number
  preempts: number
  delay?: number
}

export interface EpdResult {
  colocated: EpdSide
  epd: EpdSide
  winner: 'colocated' | 'epd' | 'tie'
  dumps: { prefill: ManagerDump; decode: ManagerDump }
}

export interface EpdSnapshot {
  mode: 'epd'
  /** ticks run so far across both topologies */
  tick: number
  phase: 'colocated' | 'epd' | 'done'
  done: boolean
  result: EpdResult | null
}

export type FleetSnapshot = EngineSnapshot | ClusterSnapshot | EpdSnapshot

export interface FleetSnapshotByMode {
  engine: EngineSnapshot
  cluster: ClusterSnapshot
  epd: EpdSnapshot
}

/* -------------------------------- pool -------------------------------- */

export interface PoolOpResult {
  /** the line sent to the module's ks_invoke */
  cmd: string
  /** what the JS reference answered (`free` is always true) */
  ref: boolean
  /** the module's trimmed reply */
  got: string
}

export interface PoolTickResult {
  ops: PoolOpResult[]
  /** the module's free_blocks reply, and the reference's count */
  freeReply: number
  refFree: number
  /** the module's parsed dump, and the refcount multisets the conformance check compares */
  dump: ManagerDump
  multiset: number[]
  refMultiset: number[]
}

/* ------------------------------ leaderboard ------------------------------ */

export interface LeaderboardJob {
  /** the submitted scheduler; null scores the JS reference scheduler */
  bytes: ArrayBuffer | null
  burstgpt: TraceArtifact
  lmsysShape: TraceArtifact
}

export interface LeaderboardJobResult {
  lab: LabHarnessResult
  /** null when the canonical lab harness failed (the Fleet run is skipped, as before) */
  fleet: { goodput: number; ticks: number; completed: number } | null
}

/* ------------------------------- wire ------------------------------- */

export type FleetRequest =
  | { id: number; cmd: 'open'; open: FleetOpen }
  | { id: number; cmd: 'step'; ticks: number }
  /** `tick` is the panel's tick number, echoed as progress so a timeout can name it */
  | { id: number; cmd: 'pool'; tick: number; ops: FleetOp[] }
  | { id: number; cmd: 'job'; job: LeaderboardJob }
  | { id: number; cmd: 'close' }

export type FleetReply =
  /** the worker has loaded; keeps startup out of every command budget */
  | { type: 'boot' }
  /** progress: the tick the worker is about to run. A spin never reaches the next one, so the last one names it. */
  | { type: 'tick'; id: number; tick: number; scope?: string }
  | { type: 'ready'; id: number; total: number; dump?: ManagerDump }
  | { type: 'step'; id: number; snapshot: FleetSnapshot }
  | { type: 'pool'; id: number; result: PoolTickResult }
  | { type: 'job'; id: number; result: LeaderboardJobResult }
  | { type: 'closed'; id: number }
  | { type: 'failed'; id: number; kind: 'trap' | 'abi' | 'error'; message: string; phase?: 'invoke' }
