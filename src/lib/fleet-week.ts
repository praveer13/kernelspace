/**
 * fleet-week — the 4-act capstone 2.0 (PLAN.md §3.7).
 *
 * Every act EXECUTES its claims against the simulators: no self-attested
 * checkboxes. Your engine runs, your fleet is disrupted, your business
 * case is recomputed, your incident diagnosis is graded on real telemetry.
 */

import {
  Cluster,
  Engine,
  HEADROOM_TOKENS,
  makeRefManager,
  makeRefQueue,
  makeRefScheduler,
  makeRequestStream,
  makeRng,
  routerLabel,
  type ClusterStats,
  type RouterKind,
  type SchedulerDriver,
  type SchedAction,
  type SchedView,
} from '@/lib/fleet-model'
import { KIND_SLOT } from '@/lib/engine/slots'
import type { FleetActMeta, FleetRunData, FleetRunResult, IncidentData, IncidentResult } from '@/lib/ledger/types'
import { incidentScore } from '@/lib/ledger/fold'
import { sha256Hex } from '@/lib/ledger/stable'
import { freshSeed, splitmix32u } from '@/lib/rng'
import { kcsFor, type FinishedIncident, type IncidentSource } from '@/lib/world/daily'
import { FAULT_LABELS, FAULT_SHORT, FIXES, INCIDENT_FAULTS, fixFor, generateIncident, type FixId, type IncidentFault, type IncidentSpec } from '@/lib/world/incident-spec'
import { makeFaultInjector, type FaultSpec } from '@/lib/world/faults'
import { instantiateLab } from '@/lib/wasm-lab'
import { atlasRow } from '@/data/atlas'
import { claimNumber } from '@/data/claims'
import { makeWasmManager, makeWasmQueue, makeWasmScheduler } from '@/pages/fleet/drivers'
import type { LabKind } from '@/pages/fleet/slots'

export interface ActResult {
  pass: boolean
  score: number // 0..1
  headline: string
  detail: string
  metrics: [string, string][]
  /** The graded seed this run drew (null for the fixed practice scenario); the same seed replays it exactly. */
  seed?: number | null
  /** An uncounted practice run: informational, not a verdict on the act. */
  practice?: boolean
  /**
   * The run's numbers for the ledger's `fleet-run` event (docs/specs/wave-2.md §10.6). Present only when one of
   * your components took part in Act I or II: an all-reference run is not evidence of your work.
   */
  run?: { goodput: number; refGoodput: number; ttftP95?: number }
}

export interface MeasurementEvidence {
  analysis: string
  screenshotName?: string
  screenshotBytes?: number
}

export type MeasurementActId = 'engine' | 'fleet'

/**
 * The only place Fleet Week seeds live. Every act's trace and fault stream is a
 * pure function of these; the sim worker draws them afresh for each job.
 *
 * Graded runs draw `seed` at grade time (src/lib/graded-seed.ts), derive the rest
 * from it with splitmix32, and keep it only if the reference baselines land in
 * the calibrated difficulty band. A practice scenario has `seed: null`:
 * it keeps the frozen makeRng streams and today's death (worker 0 at t400), so it
 * is reproducible and never graded.
 */
export interface FleetWeekSeeds {
  seed: number | null
  trace: number
  faults: number
  /** which worker dies, as a raw draw: the run takes it modulo its own worker count */
  deathPick: number
  /** the cluster tick of the node death */
  deathTick: number
}

/** The request trace for these seeds: frozen makeRng when practising, splitmix32 when graded. */
export function traceFor(seeds: FleetWeekSeeds) {
  return makeRequestStream(REQ_COUNT, SPAN, seeds.trace, seeds.seed === null ? undefined : splitmix32u(seeds.trace))
}

/** The flash-crowd draw stream for these seeds (uint32s), same split as the trace. */
function faultRng(seeds: FleetWeekSeeds): () => number {
  return seeds.seed === null ? makeRng(seeds.faults) : splitmix32u(seeds.faults)
}

/** The seed as shown to the learner, so a run can be quoted and replayed. */
export function seedLabel(seed: number | null): string {
  return seed === null ? 'practice (fixed)' : `0x${seed.toString(16).padStart(8, '0')}`
}

/** Uploaded lab modules as raw bytes — all a worker needs to instantiate them. */
export type ModuleBytes = Record<LabKind, ArrayBuffer | null>

/** Reports 0..1 while a batch runs; the worker forwards it to the page. */
export type ProgressFn = (fraction: number) => void

/**
 * Faults are data (FaultSpec v2) and their interpreter lives with the incident world in
 * src/lib/world/faults.ts (wave-2 §9.1); re-exported here so Fleet Week's callers keep one import.
 */
export { makeFaultInjector, type FaultSpec } from '@/lib/world/faults'

/**
 * Act II: a seed-drawn worker dies at a seed-drawn tick (practice: worker 0 at t400),
 * then a hot window slams the survivors at t600–750.
 */
export function act2Faults(seeds: FleetWeekSeeds, workers: number): FaultSpec[] {
  return [
    { kind: 'node-death', worker: seeds.deathPick % workers, atTick: seeds.deathTick },
    { kind: 'flash-crowd', fromTick: 600, toTick: 750, every: 3 },
  ]
}

const CFG = { numBlocks: 256, blockSize: 16, maxRunning: 16, sloTtft: 40, prefillChunk: 128 }
const WORKER_CFG = { numBlocks: 128, blockSize: 16, maxRunning: 12, sloTtft: 40, prefillChunk: 128 }
const REQ_COUNT = 240
const SPAN = 900

/** Requests finished or shed so far, as 0..1 of `total` (cheap enough to poll every few ticks). */
function drained(e: Engine, total: number): number {
  const s = e.stats()
  return Math.min(1, (s.completed + s.shed) / total)
}

/** Step an engine to completion (same 20000-tick guard everywhere); returns the ticks it took. */
function drain(e: Engine, total: number, onProgress?: ProgressFn): number {
  let guard = 0
  while (!e.done && guard < 20000) {
    e.step()
    guard++
    if (onProgress && guard % 50 === 0) onProgress(drained(e, total))
  }
  return guard
}

/* ------------------------ baselines on a seed ------------------------ */

/**
 * FCFS and SJF with the reference's headroom-aware fit, so the three policies
 * differ only in order. The reference is SJF plus an age guard.
 */
function admitInOrder(v: SchedView, order: SchedView['waiting']): SchedAction {
  let used = v.running.reduce((a, r) => a + r.prompt + r.decoded + HEADROOM_TOKENS, 0)
  let slots = v.maxRunning - v.running.length
  const admit: number[] = []
  for (const r of order) {
    if (slots === 0) break
    const cost = r.prompt + HEADROOM_TOKENS
    if (used + cost > v.memCap) continue
    admit.push(r.id)
    slots -= 1
    used += cost
  }
  return { admit, preempt: [] }
}

const FCFS_SCHEDULER: SchedulerDriver = {
  name: 'fcfs',
  schedule: (v) => admitInOrder(v, [...v.waiting].sort((a, b) => a.arrival - b.arrival || a.id - b.id)),
}

const SJF_SCHEDULER: SchedulerDriver = {
  name: 'sjf',
  schedule: (v) => admitInOrder(v, [...v.waiting].sort((a, b) => a.prompt - b.prompt || a.arrival - b.arrival)),
}

/** One reference-stack engine on this seed's trace, run to completion (the Act I/III machine). */
function simulateEngine(seeds: FleetWeekSeeds, cfg = CFG, sched = makeRefScheduler()): Engine {
  const e = new Engine(cfg, traceFor(seeds), sched, makeRefManager(cfg.numBlocks, cfg.blockSize), {
    intake: makeRefQueue(32),
    drainPerTick: 8,
  })
  drain(e, REQ_COUNT)
  return e
}

export interface PolicyOutcome {
  goodput: number
  completed: number
  shed: number
  ttftP95: number
  queueP95: number
}

/** FCFS, SJF and the reference on the SAME seed (Act I's machine): the seed's discrimination between policies. */
export function policyBaselines(seeds: FleetWeekSeeds): Record<'fcfs' | 'sjf' | 'reference', PolicyOutcome> {
  const outcome = (sched: SchedulerDriver): PolicyOutcome => {
    const e = simulateEngine(seeds, CFG, sched)
    const st = e.stats()
    return { goodput: e.goodput(REQ_COUNT), completed: st.completed, shed: st.shed, ttftP95: e.ttftP95(), queueP95: e.queueP95() }
  }
  return { fcfs: outcome(FCFS_SCHEDULER), sjf: outcome(SJF_SCHEDULER), reference: outcome(makeRefScheduler()) }
}

/** The reference engine's goodput on this seed with this hardware (Act I's reference; Act III's option). */
export function referenceGoodput(seeds: FleetWeekSeeds, cfg = CFG): number {
  return simulateEngine(seeds, cfg).goodput(REQ_COUNT)
}

export interface FleetBaseline {
  completedPct: number
  goodput: number
  injected: number
  /** the node death actually fired (it needs a live target on a multi-worker fleet) */
  deathFired: boolean
}

/** The all-reference fleet (JSQ unless `router` says otherwise) through this seed's node death and flash crowd: Act II's baseline. */
export function referenceFleet(seeds: FleetWeekSeeds, workers: 2 | 4, router: RouterKind = 'jsq'): FleetBaseline {
  const engines = Array.from(
    { length: workers },
    () =>
      new Engine(WORKER_CFG, [], makeRefScheduler(), makeRefManager(WORKER_CFG.numBlocks, WORKER_CFG.blockSize), {
        intake: makeRefQueue(32),
        drainPerTick: 6,
      }),
  )
  const cluster = new Cluster(traceFor(seeds), engines, router)
  const faults = makeFaultInjector(act2Faults(seeds, workers), faultRng(seeds))
  cluster.disrupt = faults.disrupt
  let guard = 0
  while (!cluster.done && guard < 20000) {
    cluster.step()
    guard++
  }
  const { completedPct, goodput } = fleetOutcome(cluster.aggregate(), faults.injected())
  return { completedPct, goodput, injected: faults.injected(), deathFired: faults.events.some((e) => e.includes('NODE DEATH')) }
}

async function buildStack(modules: ModuleBytes, numBlocks: number, blockSize: number) {
  const sched = modules.sched ? makeWasmScheduler(await instantiateLab(modules.sched)) : makeRefScheduler()
  const mgr = modules.mgr
    ? makeWasmManager(await instantiateLab(modules.mgr), numBlocks, blockSize)
    : makeRefManager(numBlocks, blockSize)
  const queue = modules.queue ? makeWasmQueue(await instantiateLab(modules.queue), 32) : makeRefQueue(32)
  return { sched, mgr, queue }
}

/** The kinds of module in `modules`: the components of yours that take part in a run. */
export const ownKindsOf = (modules: ModuleBytes): LabKind[] => (Object.keys(KIND_SLOT) as LabKind[]).filter((k) => modules[k] !== null)

/**
 * What Act I says to an all-reference run (docs/specs/wave-2.md §10.6): it is practice, and how to get a
 * component of your own into the engine. A module is installed on ForgeLab after a fresh-seed pass of its lab, or
 * by dropping it on the Fleet page, which runs the same check.
 */
export const INSTALL_HINT =
  'practice: install one of your components to pass Act I. Pass a lab on fresh seeds in the Forge (scheduler, block manager or intake queue) and press "Install in your engine", or drop that module on the Fleet page; then run the trace again.'

/* ------------------------------ ACT 1 ------------------------------ */

/**
 * Act I's verdict (§10.6). It races YOUR engine: against itself the reference ties, so an all-reference run proves
 * nothing and passes nothing, however close the goodputs are. With a component of yours in it the bar is the
 * old one: goodput within 3 points of the reference.
 */
export function act1Verdict(goodput: number, refGoodput: number, anyStudent: boolean): { pass: boolean; detail: string } {
  if (!anyStudent) return { pass: false, detail: INSTALL_HINT }
  const pass = goodput >= refGoodput - 3
  return {
    pass,
    detail: pass
      ? 'your engine holds the objective function against the reference stack.'
      : `the gap is the lesson: ${refGoodput - goodput} points. Revisit lab 06's policy shape — guard, size-awareness, headroom.`,
  }
}

/** The Engine: your stack vs the reference on the fleet trace. */
export async function runAct1(modules: ModuleBytes, seeds: FleetWeekSeeds, onProgress?: ProgressFn): Promise<ActResult> {
  const s = await buildStack(modules, CFG.numBlocks, CFG.blockSize)
  const mine = new Engine(CFG, traceFor(seeds), s.sched, s.mgr, {
    intake: s.queue,
    drainPerTick: 8,
  })
  const ref = new Engine(
    CFG,
    traceFor(seeds),
    makeRefScheduler(),
    makeRefManager(CFG.numBlocks, CFG.blockSize),
    { intake: makeRefQueue(32), drainPerTick: 8 },
  )
  let guard = 0
  while ((!mine.done || !ref.done) && guard < 20000) {
    if (!mine.done) mine.step()
    if (!ref.done) ref.step()
    guard++
    if (onProgress && guard % 50 === 0) onProgress(Math.min(drained(mine, REQ_COUNT), drained(ref, REQ_COUNT)))
  }
  const myG = mine.goodput(REQ_COUNT)
  const refG = ref.goodput(REQ_COUNT)
  const ms = mine.stats()
  const anyStudent = ownKindsOf(modules).length > 0
  const { pass, detail } = act1Verdict(myG, refG, anyStudent)
  return {
    pass,
    score: Math.min(1, myG / Math.max(1, refG)),
    headline: `goodput ${myG}% vs reference ${refG}%`,
    detail,
    metrics: [
      ['your goodput', `${myG}%`],
      ['reference goodput', `${refG}%`],
      ['completed', `${ms.completed}/${REQ_COUNT}`],
      ['shed', `${ms.shed}`],
      ['auto-preempts', `${ms.autoPreempts}`],
      ['ttft p95', `${mine.ttftP95()} iters`],
      ['tpot p95', `${mine.tpotP95().toFixed(1)} iters`],
      ['queue p95', `${mine.queueP95()} iters`],
      ['graded seed', seedLabel(seeds.seed)],
    ],
    seed: seeds.seed,
    ...(anyStudent ? { run: runNumbers(myG, refG, mine.ttftP95()) } : { practice: true }),
  }
}

/* ------------------------------ ACT 2 ------------------------------ */

/** Act II's pass bar: the survivors' completed share and SLO-met share, over arrivals plus the flash crowd. */
export const ACT2_BAR = { completedPct: 92, goodput: 40 }

/** The completed and goodput shares Act II grades (one decimal), shared with the seed-band baselines. */
export function fleetOutcome(agg: ClusterStats, injected: number) {
  const total = REQ_COUNT + injected
  return {
    total,
    completedPct: Math.round((agg.completed / total) * 1000) / 10,
    goodput: Math.round((agg.sloMet / total) * 1000) / 10,
  }
}

export interface Act2Choice {
  workers: 2 | 4
  router: RouterKind
}

/** The Fleet: survive a node death + a hot window with your topology choice. */
export async function runAct2(
  modules: ModuleBytes,
  choice: Act2Choice,
  seeds: FleetWeekSeeds,
  onProgress?: ProgressFn,
): Promise<ActResult> {
  const workerCfgs = Array.from({ length: choice.workers }, () => WORKER_CFG)
  const workers: Engine[] = []
  for (const cfg of workerCfgs) {
    const s = await buildStack(modules, cfg.numBlocks, cfg.blockSize)
    workers.push(new Engine(cfg, [], s.sched, s.mgr, { intake: s.queue, drainPerTick: 6 }))
  }
  const cluster = new Cluster(traceFor(seeds), workers, choice.router)
  const faults = makeFaultInjector(act2Faults(seeds, choice.workers), faultRng(seeds))
  cluster.disrupt = faults.disrupt
  let guard = 0
  while (!cluster.done && guard < 20000) {
    cluster.step()
    guard++
    if (onProgress && guard % 50 === 0) {
      const a = cluster.aggregate()
      onProgress(Math.min(1, (a.completed + a.shed) / (REQ_COUNT + faults.injected())))
    }
  }
  const agg = cluster.aggregate()
  const { total, completedPct, goodput } = fleetOutcome(agg, faults.injected())
  const pass = completedPct >= ACT2_BAR.completedPct && goodput >= ACT2_BAR.goodput
  // With a component of yours in the fleet, the ledger also gets the all-reference fleet on this topology and seed to compare with
  const own = ownKindsOf(modules).length > 0
  return {
    pass,
    score: Math.min(1, (completedPct / 100) * 0.5 + Math.min(1, goodput / 60) * 0.5),
    headline: `${completedPct}% completed, ${goodput}% goodput, ${agg.shed} shed (incl. node loss)`,
    detail: pass
      ? 'the fleet absorbed a node death and a flash crowd. Topology and routing did their job.'
      : 'the disruption won: check worker count (redundancy), router (JSQ rebalances), and whether your scheduler wasted the surviving capacity.',
    metrics: [
      ['topology', `${choice.workers} workers · ${routerLabel(choice.router)}`],
      ['completed', `${agg.completed}/${total} (${completedPct}%)`],
      ['goodput', `${goodput}%`],
      ['shed (node + intake)', `${agg.shed}`],
      ['auto-preempts', `${agg.autoPreempts}`],
      ['ttft p95', `${agg.ttftP95} iters`],
      ['tpot p95', `${agg.tpotP95.toFixed(1)} iters`],
      ['queue p95', `${agg.queueP95} iters`],
      ['graded seed', seedLabel(seeds.seed)],
      ...faults.events.map((e) => ['event', e] as [string, string]),
    ],
    seed: seeds.seed,
    ...(own ? { run: runNumbers(goodput, referenceFleet(seeds, choice.workers, choice.router).goodput, agg.ttftP95) } : {}),
  }
}

/* --------------------- Acts I and II as `fleet-run` events --------------------- */

/** A run's numbers for the ledger; `ttftP95` is left out when the run had none to report (the codec wants finite numbers). */
function runNumbers(goodput: number, refGoodput: number, ttftP95: number): NonNullable<ActResult['run']> {
  return { goodput, refGoodput, ...(Number.isFinite(ttftP95) ? { ttftP95 } : {}) }
}

/** The modules of a run as the ledger names them: slot, lab and content hash of the bytes that ran. */
export async function runComponents(slots: Record<LabKind, { bytes: ArrayBuffer; lab: string } | null>): Promise<FleetRunData['components']> {
  const out: FleetRunData['components'] = []
  for (const kind of Object.keys(KIND_SLOT) as LabKind[]) {
    const m = slots[kind]
    if (m) out.push({ slot: KIND_SLOT[kind], labId: m.lab, sha256: await sha256Hex(m.bytes) })
  }
  return out
}

/**
 * The `fleet-run` event of an Act I or II run (`fleet:act1`, `fleet:act2`), or null when there is nothing to
 * record: no component of yours took part, or the run carried no numbers. Seeds drawn at run time are `fresh`
 * (the façade grades them `unseen`); the fixed practice scenario is `practice`.
 */
export function fleetRunFor(mode: 'act1' | 'act2', result: ActResult, components: FleetRunData['components']): FleetRunResult | null {
  if (!result.run || components.length === 0) return null
  const fresh = result.seed !== undefined && result.seed !== null
  return {
    ...(fresh ? { seed: result.seed as number } : {}),
    data: { v: 1, mode, components, seeds: fresh ? 'fresh' : 'practice', goodput: result.run.goodput, refGoodput: result.run.refGoodput, ...(result.run.ttftP95 === undefined ? {} : { ttftP95: result.run.ttftP95 }) },
  }
}

/** The slice of the progress store `recordActRun` writes. */
export interface ActRunStore {
  getState(): { recordFleetRun(r: FleetRunResult): void }
}

/** Write the run's `fleet-run` event. Returns whether it wrote. */
export function recordActRun(store: ActRunStore, mode: 'act1' | 'act2', result: ActResult, components: FleetRunData['components']): boolean {
  const run = fleetRunFor(mode, result, components)
  if (!run) return false
  store.getState().recordFleetRun(run)
  return true
}

/**
 * Acts I–II are portfolio artifacts, not just benchmark buttons. The trace
 * still supplies half the score; the rest requires visual evidence and a
 * short causal analysis grounded in named metrics and the chosen lever.
 */
export function gradeMeasurementSubmission(
  actId: MeasurementActId,
  traceResult: ActResult,
  evidence: MeasurementEvidence,
): ActResult {
  const analysis = evidence.analysis.trim()
  const lower = analysis.toLowerCase()
  const words = analysis ? analysis.split(/\s+/).length : 0
  const metricTerms = [
    'ttft',
    'tpot',
    'queue',
    'kv hit',
    'cache hit',
    'goodput',
    'slo',
    '$/mtok',
    'cost',
    'shed',
    'preempt',
  ]
  const decisionTerms =
    actId === 'engine'
      ? ['scheduler', 'admission', 'headroom', 'batch', 'prefill', 'intake']
      : ['router', 'routing', 'worker', 'redundancy', 'jsq', 'round-robin', 'prefix', 'topology', 'node']
  const metricHits = new Set(metricTerms.filter((term) => lower.includes(term)))
  const decisionHits = new Set(decisionTerms.filter((term) => lower.includes(term)))
  const numericClaim = /(?:\d+(?:\.\d+)?\s*(?:%|ms|s\b|iters?\b|workers?\b|tokens?\b)|\$\s*\d)/i.test(
    analysis,
  )
  const screenshotOk =
    Boolean(evidence.screenshotName?.match(/\.(?:png|jpe?g|webp)$/i)) &&
    (evidence.screenshotBytes ?? 0) > 0
  const lengthOk = words >= 40 && words <= 150
  const analysisOk = lengthOk && metricHits.size >= 2 && decisionHits.size >= 1 && numericClaim
  const pass = traceResult.pass && screenshotOk && analysisOk
  const analysisScore =
    (lengthOk ? 0.35 : Math.min(words / 40, 1) * 0.15) +
    Math.min(metricHits.size / 2, 1) * 0.25 +
    Math.min(decisionHits.size, 1) * 0.2 +
    (numericClaim ? 0.2 : 0)
  const problems = [
    !traceResult.pass ? 'the executable trace gate is not green' : null,
    !screenshotOk ? 'attach a PNG, JPEG, or WebP dashboard screenshot' : null,
    !lengthOk ? `analysis is ${words} words; required range is 40–150` : null,
    metricHits.size < 2 ? `name at least two measured signals (${metricHits.size}/2)` : null,
    decisionHits.size < 1 ? 'connect the result to the engine or fleet lever you chose' : null,
    !numericClaim ? 'include at least one measured number with a unit' : null,
  ].filter(Boolean) as string[]

  return {
    pass,
    score:
      Math.min(1, traceResult.score) * 0.5 +
      (screenshotOk ? 0.15 : 0) +
      Math.min(1, analysisScore) * 0.35,
    headline: pass
      ? `measurement artifact accepted — ${words} words, ${metricHits.size} named signals`
      : problems[0] ?? 'measurement artifact needs another pass',
    detail: pass
      ? 'The executable result, dashboard evidence, and causal explanation now travel together as one portfolio artifact.'
      : problems.join(' · '),
    metrics: [
      ['trace gate', traceResult.pass ? 'pass' : 'not yet'],
      ['dashboard', screenshotOk ? evidence.screenshotName ?? 'attached' : 'missing'],
      ['analysis', `${words}/150 words`],
      ['named signals', `${metricHits.size} (need 2)`],
      ['decision lever', `${decisionHits.size} (need 1)`],
      ['measured number', numericClaim ? 'present' : 'missing'],
    ],
  }
}

/* ------------------------------ ACT 3 ------------------------------ */

export interface HwOption {
  id: string
  name: string
  desc: string
  hourlyUsd: number
  /** The claim behind `hourlyUsd`: dated for B200, labelled synthetic for the other two. */
  hourlyClaimId: string
  cfg: { numBlocks: number; blockSize: number; maxRunning: number; sloTtft: number; prefillChunk: number }
}

const H100_HW = atlasRow('h100')
const B200_HW = atlasRow('b200')
const H100_NODE_USD = 'synthetic.act3.h100-node-hourly'
const B200_NODE_USD = 'price.act3.b200-node-hourly'
const GB200_RACK_USD = 'synthetic.act3.gb200-nvl72-hourly'

export const HW_MENU: HwOption[] = [
  {
    id: 'h100',
    name: '8× H100 node',
    desc: `last-gen workhorse · ${H100_HW.hbmGb} GB HBM3 ×8 · $${claimNumber(H100_NODE_USD)}/hr (synthetic)`,
    hourlyUsd: claimNumber(H100_NODE_USD),
    hourlyClaimId: H100_NODE_USD,
    cfg: { numBlocks: 256, blockSize: 16, maxRunning: 16, sloTtft: 40, prefillChunk: 128 },
  },
  {
    id: 'b200',
    name: '4× B200 node',
    desc: `Blackwell · ≈${B200_HW.hbmGb} GB HBM3e per GPU as shipped ×4, ${((B200_HW.hbmBwGBs ?? 0) / (H100_HW.hbmBwGBs ?? 1)).toFixed(1)}× bandwidth · $${claimNumber(B200_NODE_USD)}/hr (4 × dated median, 2026-10)`,
    hourlyUsd: claimNumber(B200_NODE_USD),
    hourlyClaimId: B200_NODE_USD,
    cfg: { numBlocks: 512, blockSize: 16, maxRunning: 32, sloTtft: 40, prefillChunk: 256 },
  },
  {
    id: 'gb200',
    name: 'GB200 NVL72 rack',
    desc: `one NVLink domain · 72 GPUs · $${claimNumber(GB200_RACK_USD)}/hr (synthetic)`,
    hourlyUsd: claimNumber(GB200_RACK_USD),
    hourlyClaimId: GB200_RACK_USD,
    cfg: { numBlocks: 2048, blockSize: 16, maxRunning: 96, sloTtft: 40, prefillChunk: 512 },
  },
]

/** The sim's $/Mtok is not a market price: flat 50 ms ticks, a fixed trace and a fixed cache-hit assumption. */
export const ACT3_COST_LABEL = '[derived, v1 flat-tick physics; not a real-world $/Mtok]'

export interface Act3Eval {
  seed: number | null
  perOption: {
    id: string
    goodput: number
    sloMet: number
    tokensOut: number
    costPerMtok: number
    meetsSlo: boolean
  }[]
  bestValue: string
}

/** The Business: execute every hardware option, price it, compare to the claim. */
export function evalAct3(seeds: FleetWeekSeeds, onProgress?: ProgressFn): Act3Eval {
  const perOption: Act3Eval['perOption'] = []
  for (const [i, opt] of HW_MENU.entries()) {
    const e = new Engine(
      opt.cfg,
      traceFor(seeds),
      makeRefScheduler(),
      makeRefManager(opt.cfg.numBlocks, opt.cfg.blockSize),
      { intake: makeRefQueue(32), drainPerTick: 8 },
    )
    const guard = drain(e, REQ_COUNT, onProgress && ((f) => onProgress((i + f) / HW_MENU.length)))
    const stats = e.stats()
    // tokens produced = completed outputs (est. avg 56) + inputs (cache hit 40%)
    const ticks = guard
    const hours = (ticks * 0.05) / 3600 // 50ms/iter
    const cost = hours * opt.hourlyUsd
    const tokensOut = stats.completed * 56 + stats.completed * 288 * 0.6
    const costPerMtok = tokensOut > 0 ? (cost / tokensOut) * 1e6 : Infinity
    perOption.push({
      id: opt.id,
      goodput: e.goodput(REQ_COUNT),
      sloMet: stats.sloMet,
      tokensOut: Math.round(tokensOut),
      costPerMtok: Math.round(costPerMtok * 100) / 100,
      meetsSlo: e.goodput(REQ_COUNT) >= 50,
    })
  }
  const viable = perOption.filter((o) => o.meetsSlo)
  const best = (viable.length ? viable : perOption).reduce((a, b) => (a.costPerMtok <= b.costPerMtok ? a : b))
  return { seed: seeds.seed, perOption, bestValue: best.id }
}

/** Rubric for the design doc: claims must survive arithmetic and vocabulary. */
export function gradeAct3Doc(choiceId: string, claimCost: number, doc: string, evaluation: Act3Eval): ActResult {
  const chosen = evaluation.perOption.find((o) => o.id === choiceId)
  if (!chosen) {
    return { pass: false, score: 0, headline: 'unknown hardware option', detail: '', metrics: [] }
  }
  const words = doc.trim().split(/\s+/).filter(Boolean).length
  const vocab = ['goodput', 'slo', 'cache', 'batch', 'frontier', 'pareto', '$/mtok', 'cost', 'shed', 'slo', 'ttft']
  const hits = new Set(
    vocab.filter((v) => doc.toLowerCase().includes(v)).values(),
  )
  const costOk = Math.abs(claimCost - chosen.costPerMtok) / Math.max(1, chosen.costPerMtok) <= 0.25
  const sloOk = chosen.meetsSlo
  const docOk = words >= 60 && hits.size >= 3
  const pass = costOk && sloOk && docOk
  const problems = [
    !sloOk ? `your option misses the SLO (goodput ${chosen.goodput}% < 50%)` : null,
    !costOk ? `claimed $${claimCost}/Mtok vs simulated $${chosen.costPerMtok}/Mtok (>25% off)` : null,
    !docOk ? `doc too thin: ${words} words (need ≥60) with ${hits.size} vocabulary hits (need ≥3)` : null,
  ].filter(Boolean) as string[]
  return {
    pass,
    score: (costOk ? 0.45 : 0) + (sloOk ? 0.35 : 0) + (docOk ? 0.2 : (hits.size / 3) * 0.2),
    headline: pass
      ? `your ${chosen.id} choice holds: ${chosen.goodput}% goodput at $${chosen.costPerMtok}/Mtok`
      : problems[0] ?? 'ungradeable',
    detail: pass
      ? `best value on this trace was ${evaluation.bestValue} — ${choiceId === evaluation.bestValue ? 'you found it' : 'yours is defensible if the doc argues the constraint'}`
      : problems.join(' · '),
    metrics: [
      ['your pick', choiceId],
      ['simulated $/Mtok', `$${chosen.costPerMtok}`],
      ['your claim', `$${claimCost}`],
      ['goodput', `${chosen.goodput}%`],
      ['best value', evaluation.bestValue],
      ['doc', `${words} words · vocab ${hits.size}/3`],
      ['graded seed', seedLabel(evaluation.seed)],
    ],
    seed: evaluation.seed,
  }
}

/* ------------------------------ ACT 4 ------------------------------ */

/*
 * Act IV is probe drills (docs/specs/wave-2.md §9.8). A drill is an incident session on reference components,
 * generated from a seed drawn by `freshSeed()` when the drill starts and played with the Daily's hypothesis,
 * probe and fix flow; the session's `finish` scores it. The act passes after one passed drill on each of three
 * distinct faults. A retry is a new drill on a new seed, so nothing closes, and a drill on a seed the learner
 * has already seen (a replay, or no fresh seed at all) is practice and never counts.
 */

/**
 * One selectable cause or mitigation. `why` follows the quiz convention: the key's starts with
 * "Right: ", a distractor's names the misconception and why the telemetry rules it out. The debrief shows the
 * learner's pick and the key; scripts/verify-items.ts lints every one.
 */
export interface IncidentOption {
  id: string
  label: string
  correct: boolean
  why?: string
}

/**
 * One catalog fault as a pair of menus. Every entry holds the same hypothesis menu in `causes` and the same
 * fix menu in `mitigations` (same texts, same order); only `correct` and the whys vary. That is the menu a
 * drill's flow shows, so `verify-items` checks the options a learner chooses between, and a shared option set
 * gives a length or wording cue nothing to find.
 */
export interface Incident {
  id: string
  title: string
  briefing: string
  causes: IncidentOption[]
  mitigations: IncidentOption[]
}

/**
 * The fix menu's order. It is not the order of the faults, so a rule that picks the same position in both menus
 * (always the first, always the longest) does not land on one fault's pair of keys.
 */
const FIX_MENU: readonly FixId[] = ['replace-node', 'limit-tenant', 'restore-pool', 'restore-drain']

/** Why each hypothesis is right or wrong for the fault that is actually running: `CAUSE_WHYS[running][option]`. */
const CAUSE_WHYS: Record<IncidentFault, Record<IncidentFault, string>> = {
  'pool-shrink': {
    'pool-shrink':
      'Right: free KV blocks sit near zero and auto-preempts keep rising while every worker is up and the intake queue is normal. A misconfigured memory fraction shrank the pool, so the same traffic evicts and recomputes, and first tokens arrive late while TPOT stays flat.',
    'drain-stall':
      'A stalled drain starves the scheduler: its waiting list would be near empty and KV would sit mostly free. Here the waiting list is long and free blocks are near zero, so requests do reach the scheduler and memory is what refuses them.',
    'node-death':
      'A dead worker shows as one worker down and requests lost in flight at the onset. Every worker is up here and nothing was lost; the pressure is in the KV pool on all of them.',
    'tenant-burst':
      'A flooding tenant moves TPOT, with long prompts dominating the latency split. Here TPOT is flat and no tenant stands out, so who is sending the prompts does not explain a pool that is nearly out of blocks.',
  },
  'drain-stall': {
    'pool-shrink':
      'A shrunken pool shows free blocks near zero and auto-preempts rising. Here KV is mostly free and nothing is preempted, so memory is not the constraint; the requests are held upstream of it.',
    'drain-stall':
      "Right: the intake queue is full and shedding while the scheduler's waiting list is near empty and KV is mostly free. Requests are held in front of the engine because the drain feeds the scheduler too slowly, so the GPUs idle while queue delay and shed climb.",
    'node-death':
      'A dead worker shows as one worker down and requests lost in flight at the onset. Every worker is up and the errors here are requests shed at the queue, not requests lost mid-run.',
    'tenant-burst':
      "A flooding tenant raises TPOT, with long prompts dominating the latency split and a long scheduler waiting list. Here the waiting list is near empty and TPOT is not the metric that moved: requests are stuck before the scheduler.",
  },
  'node-death': {
    'pool-shrink':
      "A shrunken pool shows free blocks near zero on every worker that is up. The KV of every worker still up is in a normal range and the liveness probe shows one worker down, which a pool story cannot explain.",
    'drain-stall':
      'A stalled drain fills the intake queue and leaves the scheduler waiting list near empty, and it never loses a request already running. Here the waiting list is long, the intake queue is normal and requests were lost in flight.',
    'node-death':
      'Right: one worker is down in the liveness probe and the requests running on it were lost at the onset, so each worker still up carries more of the traffic. That gives a long waiting list and late first tokens, with the KV pool and the intake queue otherwise normal.',
    'tenant-burst':
      'A flooding tenant raises TPOT while every worker stays up. Here a worker is down and requests were lost, so capacity left the fleet; no tenant shifted it by sending long prompts.',
  },
  'tenant-burst': {
    'pool-shrink':
      'A shrunken pool shows free blocks near zero, preempts rising and a flat TPOT. Here KV is low rather than exhausted and TPOT is the metric that moved, with long prompts dominating the split.',
    'drain-stall':
      'A stalled drain leaves the scheduler waiting list near empty and KV mostly free. Here the waiting list is long and KV is low, so requests do reach the scheduler; it is the running ones that are slow.',
    'node-death':
      'A dead worker shows as one worker down and requests lost in flight. Every worker is up and nothing was lost; the slowdown is TPOT for requests that already started, and long prompts dominate it.',
    'tenant-burst':
      "Right: TPOT p95 is up and long prompts dominate the latency split, with every worker up and KV low but not exhausted. One tenant's long prefills take the engine's iterations away from everyone else's decodes.",
  },
}

/** Why each fix is right or wrong for the fault that is running: `FIX_WHYS[running][fix]`. */
const FIX_WHYS: Record<IncidentFault, Record<FixId, string>> = {
  'pool-shrink': {
    'restore-pool':
      'Right: putting the KV memory fraction back restores the usable blocks, which ends the preempt-and-recompute cycle that delays first tokens. It reverts the misconfiguration itself, and it takes one minute to roll out.',
    'restore-drain':
      'The drain rate is not the constraint: the intake queue is normal and the scheduler already has a long waiting list. Draining faster only hands more requests to a pool that cannot hold them.',
    'replace-node':
      'No worker is down, so there is nothing to replace, and a fresh node would come up with the same shrunken pool. The wrong fix costs five minutes of burn and leaves the fault in place.',
    'limit-tenant':
      'No tenant stands out in the latency split, so there is no noisy tenant to cap. Capping admissions would only turn away traffic in a fleet that is short of memory, not of fairness.',
  },
  'drain-stall': {
    'restore-pool':
      'Memory is not short: KV is mostly free and nothing is waiting at the scheduler. More blocks add capacity that already sits idle, so goodput does not move and the shedding goes on.',
    'restore-drain':
      'Right: the bottleneck is the intake drain, so restoring its rate lets the queue empty into a scheduler that has room. Shed stops, queue delay falls, and it takes one minute to roll out.',
    'replace-node':
      'Every worker is up, so a replacement changes nothing about the rate at which requests leave the queue. The wrong fix costs five minutes of burn while the queue keeps shedding.',
    'limit-tenant':
      'The latency split shows no tenant dominating, and the queue is full of ordinary requests. Capping one tenant does not speed up a drain that is slow for everybody.',
  },
  'node-death': {
    'restore-pool':
      "The KV pool of every worker still up is in a normal range, so there are no blocks to give back. The shortfall is a worker that is no longer serving, which no memory setting restores.",
    'restore-drain':
      'The intake queue is normal and each worker still up already drains it every tick, so a faster drain moves nothing. The overload shows in the waiting list, because there is one engine fewer to admit from it.',
    'replace-node':
      'Right: the liveness probe shows one worker down, so capacity is what is missing. A replacement node joins the router and takes its share of the traffic back, and it takes one minute to roll out.',
    'limit-tenant':
      'No tenant dominates the latency split; the load is ordinary traffic on a fleet one worker short. Capping a tenant sheds requests any worker still up could not have served anyway, and the dead worker stays dead.',
  },
  'tenant-burst': {
    'restore-pool':
      'KV is low but not exhausted and nothing is being preempted, so more blocks would sit unused. The delay is TPOT, from long prefills taking iterations, not a shortage of memory.',
    'restore-drain':
      'The intake queue is normal and the waiting list is long, so requests already leave the queue as fast as the scheduler can take them. A faster drain only lengthens the waiting list behind the same long prompts.',
    'replace-node':
      'Every worker is up and none was lost, so another node changes nothing about which prompts are running. The wrong fix costs five minutes of burn while the tenant keeps flooding.',
    'limit-tenant':
      "Right: capping the noisy tenant's admissions stops its long prefills from taking iterations from everyone else's decodes, so TPOT comes back. It reverts the cause rather than the symptom, and it takes one minute to roll out.",
  },
}

const BRIEFINGS: Record<IncidentFault, { title: string; briefing: string }> = {
  'pool-shrink': {
    title: 'incident 01 — the first tokens that kept slipping',
    briefing:
      'TTFT p95 is up while TPOT stays flat. Every worker is up and the intake queue is short, but free KV blocks hover near zero, auto-preempts rise, and the scheduler has a long waiting list.',
  },
  'drain-stall': {
    title: 'incident 02 — shed climbing, GPUs idle',
    briefing:
      "Queue delay is high and the shed count jumps at every burst, yet the engines sit mostly idle: the scheduler's waiting list is nearly empty and KV is mostly free. TPOT is normal once a request starts.",
  },
  'node-death': {
    title: 'incident 03 — the minute a worker stopped answering',
    briefing:
      'TTFT p95 is up fleet-wide and some requests failed in flight at one moment. One worker is no longer stepping, and each worker still up has a long waiting list. KV and the intake queue look normal.',
  },
  'tenant-burst': {
    title: 'incident 04 — everyone slowed down at once',
    briefing:
      "TPOT p95 is up and TTFT follows, with every worker up and nothing lost. One tenant's long prompts dominate the latency split, and KV runs low without running out.",
  },
}

/**
 * The menus as multiple-choice items: the labels are `FAULT_LABELS` and `FIXES`, the very text the flow shows, so what
 * `verify-items` gates is what a learner chooses between.
 */
const causeMenu = (running: IncidentFault): IncidentOption[] =>
  INCIDENT_FAULTS.map((fault) => ({ id: fault, label: FAULT_LABELS[fault], correct: fault === running, why: CAUSE_WHYS[running][fault] }))

const fixMenu = (running: IncidentFault): IncidentOption[] =>
  FIX_MENU.map((fix) => ({ id: fix, label: FIXES[fix].label, correct: fixFor(running) === fix, why: FIX_WHYS[running][fix] }))

/** One entry per catalog fault, each holding the shared hypothesis and fix menus (§9.8). */
export const INCIDENTS: Incident[] = INCIDENT_FAULTS.map((fault) => ({
  id: fault,
  title: BRIEFINGS[fault].title,
  briefing: BRIEFINGS[fault].briefing,
  causes: causeMenu(fault),
  mitigations: fixMenu(fault),
}))

/* ------------------------------- drills ------------------------------- */

/** Q5: the right fault, the right fix, and a burn within this multiple of the expert's plus `DRILL_BURN_SLACK`. */
export const DRILL_BURN_FACTOR = 2
export const DRILL_BURN_SLACK = 5
/** Q5: the act passes after one passed drill on each of this many distinct faults. */
export const DRILL_FAULTS_NEEDED = 3

/** What a finished drill reports that the rule reads (a slice of the session's `finish`). */
export interface DrillFacts {
  diagnosed: boolean
  fixed: boolean
  burn: number
  expertBurn: number
}

export const drillPassed = (d: DrillFacts): boolean => d.diagnosed && d.fixed && d.burn <= DRILL_BURN_FACTOR * d.expertBurn + DRILL_BURN_SLACK

/** A drill's score: the ledger's incident score for a passed drill (the expert's burn over yours), 0 otherwise. */
export const drillScore = (d: DrillFacts): number => (drillPassed(d) ? incidentScore(d) : 0)

/** A drill's seed as the incident's key and the ref's tail: eight hex digits, as `seedLabel` shows it. */
export const drillKey = (seed: number): string => (seed >>> 0).toString(16).padStart(8, '0')

/** What a drill plays: its seed, and the incident that seed generates. */
export interface Drill {
  seed: number
  /** a replay of an incident the learner has already seen: played, debriefed, never recorded or counted */
  practice: boolean
  source: IncidentSource
  spec: IncidentSpec
}

export function drillFor(seed: number, practice = false): Drill {
  const source: IncidentSource = { ns: 'drill', key: drillKey(seed) }
  return { seed: seed >>> 0, practice, source, spec: generateIncident(source.ns, source.key) }
}

/** A new drill on a seed drawn now: unseen, though not secret, as the labs' seeds are. `draw` is injectable for tests. */
export const startDrill = (draw: () => number = freshSeed): Drill => drillFor(draw())

/** The same incident again, for practice: it never writes an event and never counts. */
export const replayDrill = (d: Drill): Drill => ({ ...d, practice: true })

/** One passed drill that counts toward the act. At most one per fault is kept. */
export interface DrillCredit {
  fault: IncidentFault
  seed: number
  score: number
}

/** The credits, as the strings the progress store keeps in `fw:evidence:incident` (`credited`): fault, seed, score in thousandths. */
export const encodeCredits = (credits: readonly DrillCredit[]): string[] =>
  credits.map((c) => `${c.fault}:${drillKey(c.seed)}:${Math.round(c.score * 1000)}`)

const CREDIT_RE = /^([a-z-]+):([0-9a-f]{8}):(\d{1,4})$/

/**
 * Read the credits back. The stored list is untrusted (an import, an old build whose `credited` held static incident
 * ids, a hand edit), so an entry survives only if it parses, names a catalog fault, and that fault is the one its
 * seed generates; the first entry per fault and per seed wins.
 */
export function drillCreditsFrom(stored: { credited?: unknown } | undefined): DrillCredit[] {
  const raw = stored && Array.isArray(stored.credited) ? stored.credited : []
  const out: DrillCredit[] = []
  for (const entry of raw) {
    const m = typeof entry === 'string' ? CREDIT_RE.exec(entry) : null
    if (!m) continue
    const fault = INCIDENT_FAULTS.find((f) => f === m[1])
    const seed = parseInt(m[2], 16)
    const score = Number(m[3]) / 1000
    if (!fault || score > 1) continue
    if (drillFor(seed).spec.fault !== fault) continue
    if (out.some((c) => c.fault === fault || c.seed === seed)) continue
    out.push({ fault, seed, score })
  }
  return out
}

/** The mean score of the credits: the act's score. */
export const actScore = (credits: readonly DrillCredit[]): number => (credits.length === 0 ? 0 : credits.reduce((a, c) => a + c.score, 0) / credits.length)

export type DrillVerdict =
  /** passed on a new fault: counts */
  | 'credited'
  /** passed, but on a fault that already counts */
  | 'repeat-fault'
  /** played on a seed the learner had seen, or on no fresh seed: never counts, passed or not */
  | 'practice'
  /** not passed; the next drill is a new incident */
  | 'failed'

export interface DrillGrade {
  verdict: DrillVerdict
  /** the credits after this drill */
  credits: DrillCredit[]
  /** the act is passed with these credits */
  pass: boolean
  result: ActResult
}

/** The drill being graded: what it reported, on which seed (`null` for a practice drill on a fixed seed). */
export interface DrillAttempt extends DrillFacts {
  fault: IncidentFault
  seed: number | null
}

const faultName = (f: IncidentFault) => FAULT_SHORT[f]

/**
 * Grade one drill against the credits so far. Pure: `recordDrill` writes what it decides. A drill counts only if it
 * was on a fresh seed (`seed !== null`), passed, and is on a fault that does not count yet; a seed that already
 * earned a credit is not fresh again.
 */
export function gradeDrill(prior: readonly DrillCredit[], attempt: DrillAttempt, needed: number = DRILL_FAULTS_NEEDED): DrillGrade {
  const passed = drillPassed(attempt)
  const fresh = attempt.seed !== null && !prior.some((c) => c.seed === attempt.seed)
  let verdict: DrillVerdict
  if (!fresh) verdict = 'practice'
  else if (!passed) verdict = 'failed'
  else verdict = prior.some((c) => c.fault === attempt.fault) ? 'repeat-fault' : 'credited'
  const credits = verdict === 'credited' ? [...prior, { fault: attempt.fault, seed: attempt.seed as number, score: drillScore(attempt) }] : [...prior]
  const pass = credits.length >= needed
  const left = Math.max(0, needed - credits.length)
  const burn = `burn ${round1(attempt.burn)} against the expert's ${round1(attempt.expertBurn)} (limit ${round1(DRILL_BURN_FACTOR * attempt.expertBurn + DRILL_BURN_SLACK)})`
  const why = !attempt.diagnosed
    ? 'you did not hold the right fault when you fixed it'
    : !attempt.fixed
      ? 'the right fix did not go in before the clock ran out'
      : `${burn}, so the fleet burned too much budget`
  const headline =
    verdict === 'credited'
      ? `drill passed: ${faultName(attempt.fault)}`
      : verdict === 'repeat-fault'
        ? `passed again: ${faultName(attempt.fault)} already counts`
        : verdict === 'practice'
          ? passed
            ? 'practice drill: not counted'
            : 'practice drill'
          : 'drill not passed'
  const detail =
    verdict === 'credited'
      ? pass
        ? `${burn}. That is ${credits.length} distinct faults passed on fresh seeds, so Act IV is done.`
        : `${burn}. ${left} more ${left === 1 ? 'fault' : 'faults'} to go; each needs its own passed drill.`
      : verdict === 'repeat-fault'
        ? `${burn}. A second pass on the same fault does not add to the three; take a drill on a fault you have not passed.`
        : verdict === 'practice'
          ? 'This incident was already seen (a replay), so it is practice: the debrief is yours, nothing is recorded and it does not count. A new drill draws a new seed.'
          : `${why}. Retries are free: the next drill is a new incident on a new seed, and nothing is closed.`
  return {
    verdict,
    credits,
    pass,
    result: {
      pass,
      practice: verdict === 'practice',
      score: actScore(credits),
      headline,
      detail,
      metrics: [
        ['faults passed', `${credits.length}/${needed}`],
        ['this drill', passed ? 'passed' : 'not passed'],
        ['burn', `${round1(attempt.burn)} burn-min (expert ${round1(attempt.expertBurn)})`],
        ['drill seed', attempt.seed === null ? 'practice (seen)' : `0x${drillKey(attempt.seed)}`],
      ],
      seed: attempt.seed,
    },
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10

/**
 * The `incident` event of a drill (`src: 'drill'`, `act4: true`). Its ref names the fault (`inc:drill/<faultId>`, the
 * ledger's grammar), so the aggregate keeps one entry per fault; the drill's own seed rides on the event. The façade
 * grades it `unseen` for any drill, which is why a practice replay is never recorded.
 */
export function drillResult(drill: Drill, done: FinishedIncident, components: string[] = []): IncidentResult {
  const data: IncidentData = {
    v: 1,
    src: 'drill',
    fault: done.fault,
    severity: done.severity,
    ...(done.firstHypothesis === undefined ? {} : { firstHypothesis: done.firstHypothesis }),
    ...(done.hypothesis === undefined ? {} : { hypothesis: done.hypothesis }),
    probes: done.probes,
    ...(done.fix === undefined ? {} : { fix: done.fix }),
    diagnosed: done.diagnosed,
    fixed: done.fixed,
    burn: done.burn,
    expertBurn: done.expertBurn,
    streetlight: done.streetlight,
    components,
    act4: true,
    kcs: kcsFor(done.fault),
  }
  return { ref: `inc:drill/${done.fault}`, seed: drill.seed, data }
}

/** The slice of the progress store `recordDrill` reads and writes. */
export interface DrillStore {
  getState(): {
    fleetWeek: { actsDone: string[]; measurementEvidence?: Record<string, { credited?: string[] } | undefined> }
    recordIncident(r: IncidentResult): void
    setFleetWeekEvidence(actId: string, patch: { credited?: string[] }): void
    completeFleetWeekAct(actId: string, score: number, meta?: FleetActMeta): void
  }
}

/**
 * Record a finished drill and grade it against the learner's credits, which live in the progress store's working
 * state (`fw:evidence:incident`), so a reload or a second tab cannot reset them.
 *   - A fresh drill writes its `incident` event (provenance `unseen`, the drill's own seed), pass or fail.
 *   - A practice drill writes nothing, passed or not.
 *   - The drill that makes the third distinct fault completes the act once, with the mean drill score, the seed
 *     of that drill, provenance `unseen` and the faults and seeds that earned it.
 */
export function recordDrill(store: DrillStore, drill: Drill, done: FinishedIncident, components: string[] = []): DrillGrade {
  const state = store.getState()
  const prior = drillCreditsFrom(state.fleetWeek.measurementEvidence?.incident)
  const grade = gradeDrill(prior, { ...done, seed: drill.practice ? null : drill.seed })
  if (grade.verdict === 'practice') return grade
  state.recordIncident(drillResult(drill, done, components))
  if (grade.verdict === 'credited') {
    state.setFleetWeekEvidence('incident', { credited: encodeCredits(grade.credits) })
    if (grade.pass && !state.fleetWeek.actsDone.includes('incident')) {
      state.completeFleetWeekAct('incident', actScore(grade.credits), {
        seed: drill.seed,
        provenance: 'unseen',
        data: { faults: grade.credits.map((c) => c.fault), seeds: grade.credits.map((c) => drillKey(c.seed)) },
      })
    }
  }
  return grade
}
