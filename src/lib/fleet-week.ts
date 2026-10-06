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
  type TickSample,
} from '@/lib/fleet-model'
import { splitmix32u } from '@/lib/rng'
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
  /** An uncredited practice call: informational, not a verdict on the act. */
  practice?: boolean
  /** Act IV only: a first call was missed, so the act cannot be completed (no XP) until incidents on unseen seeds exist. */
  closed?: boolean
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
 * A fault the fleet suffers, as data: it crosses the worker boundary and is
 * interpreted inside the run (`makeFaultInjector`). Ticks are cluster ticks.
 */
export type FaultSpec =
  | { kind: 'node-death'; worker: number; atTick: number }
  | { kind: 'flash-crowd'; fromTick: number; toTick: number; every: number }

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

/** Interpret FaultSpecs as a Cluster.disrupt hook; `events` and `injected()` report what fired. */
export function makeFaultInjector(faults: FaultSpec[], rng: () => number) {
  const events: string[] = []
  let injected = 0
  const disrupt = (c: Cluster, tick: number) => {
    for (const f of faults) {
      if (f.kind === 'node-death') {
        // in-flight work on the dying worker is lost
        if (tick === f.atTick && c.workers.length > 1 && !c.workers[f.worker].killed) {
          const lost = c.workers[f.worker].kill()
          events.push(`t${f.atTick}: NODE DEATH — worker ${f.worker} lost with ${lost} in-flight requests`)
        }
      } else if (tick >= f.fromTick && tick <= f.toTick && tick % f.every === 0) {
        // extra arrivals slammed into the surviving fleet
        const alive = c.workers.filter((w) => !w.killed)
        if (alive.length > 0) {
          const w = alive[rng() % alive.length]
          w.inject({ id: 10000 + tick * 10 + (rng() % 10), arrival: tick, prompt: 64 + (rng() % 193), output: 16 + (rng() % 33) })
          injected++
        }
      }
    }
  }
  return { disrupt, events, injected: () => injected }
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

/** The all-reference fleet (JSQ) through this seed's node death and flash crowd: Act II's baseline. */
export function referenceFleet(seeds: FleetWeekSeeds, workers: 2 | 4): FleetBaseline {
  const engines = Array.from(
    { length: workers },
    () =>
      new Engine(WORKER_CFG, [], makeRefScheduler(), makeRefManager(WORKER_CFG.numBlocks, WORKER_CFG.blockSize), {
        intake: makeRefQueue(32),
        drainPerTick: 6,
      }),
  )
  const cluster = new Cluster(traceFor(seeds), engines, 'jsq')
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

/* ------------------------------ ACT 1 ------------------------------ */

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
  const pass = myG >= refG - 3
  const anyStudent = modules.sched || modules.mgr || modules.queue
  return {
    pass,
    score: Math.min(1, myG / Math.max(1, refG)),
    headline: `goodput ${myG}% vs reference ${refG}%`,
    detail: pass
      ? anyStudent
        ? 'your engine holds the objective function against the reference stack.'
        : 'all-reference run (upload your modules to race your own code).'
      : `the gap is the lesson: ${refG - myG} points. Revisit lab 06's policy shape — guard, size-awareness, headroom.`,
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
  }
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

/**
 * One selectable cause or mitigation. `why` follows the quiz convention: the key's starts with
 * "Right: ", a distractor's names the misconception and why the telemetry rules it out. The Act IV
 * page shows the chosen option's and the right one's after each call; scripts/verify-items.ts lints it.
 */
export interface IncidentOption {
  id: string
  label: string
  correct: boolean
  why?: string
}

export interface Incident {
  seed: number | null
  id: string
  title: string
  briefing: string
  telemetry: TickSample[]
  causes: IncidentOption[]
  mitigations: IncidentOption[]
}

function runIncidentEngine(seeds: FleetWeekSeeds, cfg = CFG, sched = makeRefScheduler()): TickSample[] {
  const e = new Engine(cfg, traceFor(seeds), sched, makeRefManager(cfg.numBlocks, cfg.blockSize), {
    intake: makeRefQueue(32),
    drainPerTick: 8,
  })
  const series: TickSample[] = []
  e.recorder = (s) => {
    if (s.tick % 10 === 0) series.push(s)
  }
  let guard = 0
  while (!e.done && guard < 20000) {
    e.step()
    guard++
  }
  return series
}

export const INCIDENTS: Omit<Incident, 'telemetry' | 'seed'>[] = [
  {
    id: 'kv-thrash',
    title: 'incident 01 — the p99 that climbed all shift',
    briefing:
      'gen_ai.server.time_to_first_token p95 has been climbing for hours while TPOT stays comparatively flat. Auto-preempts are nonzero and rising; free blocks hover near zero. Nothing was deployed today — but the traffic got longer-context this week.',
    causes: [
      {
        id: 'sched-bug',
        label: 'scheduler regression that admits too few requests per step, leaving the pool mostly idle',
        correct: false,
        why: 'The pool is not idle: free blocks sit near zero. Preemption only hits requests that were already admitted, so rising auto-preempts show the scheduler is admitting plenty and memory is the constraint.',
      },
      {
        id: 'pool-small',
        label: 'capacity wall, with allocations failing in a pool too small for the new context lengths',
        correct: true,
        why: 'Right: near-zero free blocks plus rising auto-preempts mean allocations fail and preempted requests restart by recompute. Longer contexts take more blocks each, so the same pool holds fewer sequences and TTFT climbs.',
      },
      {
        id: 'net-stall',
        label: 'network stall between workers, delaying the first token while decode stays normal',
        correct: false,
        why: 'A transfer stall would delay first tokens, but by itself it would not explain near-zero free blocks together with rising auto-preempts. Those are KV-allocation signals, so the pool is the better-supported cause.',
      },
      {
        id: 'queue-lie',
        label: 'intake queue silently dropping requests, with clients retrying in bursts behind each other',
        correct: false,
        why: 'Retry bursts would raise queue delay, but they do not explain free blocks near zero together with nonzero, rising auto-preempts. That signature points at the KV pool, not at intake.',
      },
    ],
    mitigations: [
      {
        id: 'restart',
        label: 'restart workers on an hourly schedule, to reclaim leaked blocks and clear any stale state over time',
        correct: false,
        why: 'Nothing is leaking: blocks return to the pool when requests finish. The pressure is live demand from long contexts, so a restart drops in-flight work and the preempt storm returns as traffic refills the pool.',
      },
      {
        id: 'bigger-pool',
        label: 'grow the pool with more memory, quantized blocks or an offload tier while capping admitted context',
        correct: true,
        why: 'Right: more usable blocks (HBM, FP8 KV at half the bytes of 16-bit, or an offload tier) remove the capacity wall, and a cap on admitted context stops one long request from evicting many others.',
      },
      {
        id: 'smaller-batch',
        label: 'lower max_running to cut preemptions, accepting a throughput ceiling in the meantime',
        correct: false,
        why: 'Fewer concurrent sequences does cut preemptions, but it only caps throughput: the pool stays too small for the new contexts and the cause is untouched. Adding blocks and capping context is what removes it.',
      },
      {
        id: 'chunked-prefill',
        label: 'enable chunked prefill, so long prompts stop blocking the decode steps of running requests',
        correct: false,
        why: 'Chunked prefill smooths prefill-decode interference, which shows up as TPOT spikes. TPOT is flat here; the pain is preemption from block exhaustion, which chunking does not relieve.',
      },
    ],
  },
  {
    id: 'intake-stall',
    title: 'incident 02 — shed climbing, GPUs idle',
    briefing:
      'The queue-delay p95 and shed count climb steadily, yet workers sit half-empty: running is low, the scheduler waiting list is near zero, and completions trickle. TPOT is normal once a request starts. The intake queue is not full on average.',
    causes: [
      {
        id: 'drain',
        label: 'intake drain set slower than the arrival rate, so the queue fills and sheds despite idle capacity',
        correct: true,
        why: 'Right: the scheduler has nothing waiting and running is low, so requests are held upstream. A drain slower than arrivals fills intake and sheds, while TPOT stays normal and GPUs idle.',
      },
      {
        id: 'pool-small',
        label: 'pool too small, so blocks run out and preempted requests re-queue until the backlog sheds',
        correct: false,
        why: 'A full pool shows near-zero free blocks, preemptions and a long scheduler waiting list. Workers here are half-empty with nothing waiting, so memory is not the constraint.',
      },
      {
        id: 'hot-expert',
        label: 'hot expert straggler, so one overloaded expert gates each step and slows the whole worker',
        correct: false,
        why: 'A straggler stretches step time, so TPOT would rise for requests already running. TPOT is normal once a request starts, which places the stall before the engine, not inside a step.',
      },
      {
        id: 'sched-bug',
        label: 'scheduler stuck with an admit step that returns nothing, so requests pile up while workers sit idle',
        correct: false,
        why: 'A stuck scheduler would show a long waiting list, because requests reach it and are not admitted. The waiting list is near zero, so the bottleneck sits upstream, at the intake drain.',
      },
    ],
    mitigations: [
      {
        id: 'bigger-pool',
        label: 'grow the pool to let each worker hold more sequences once the backlog finally arrives',
        correct: false,
        why: 'Memory is not short: nothing is waiting at the scheduler and workers are half-empty. More blocks add capacity that already sits idle and leave the drain bottleneck, and the shedding, untouched.',
      },
      {
        id: 'fix-drain',
        label: 'fix the drain configuration to match what admission can absorb, then rerun the test',
        correct: true,
        why: 'Right: the bottleneck is the drain rate, so match it to what admission can absorb. Re-running the flash-crowd test confirms shed and queue delay recover rather than assuming they do.',
      },
      {
        id: 'restart',
        label: 'restart the router to flush the queue, then watch whether the shed count returns',
        correct: false,
        why: 'A restart may clear the backlog briefly, but the drain is still slower than arrivals, so the queue refills and sheds again. It treats a configuration fault as a transient hang.',
      },
      {
        id: 'bigger-queue',
        label: 'enlarge the intake queue to buffer a flash crowd instead of shedding, and revisit the drain later',
        correct: false,
        why: 'A larger buffer postpones shedding but adds queue delay, because arrivals still outpace the drain. Under sustained load it still fills, and buffered requests miss the SLO instead of being shed.',
      },
    ],
  },
  {
    id: 'no-admission',
    title: 'incident 03 — goodput fell off a cliff at launch',
    briefing:
      'Launch day: concurrency is 4× normal. Goodput falls first, then queue-delay and TTFT p95 explode; TPOT for requests that already started is comparatively stable. The batch is enormous while completions crawl.',
    causes: [
      {
        id: 'no-admission',
        label: 'no admission control, so everything is admitted at once and the batch overcommits memory until queueing hurts latency',
        correct: true,
        why: 'Right: with no gate, 4× concurrency lands in one huge batch that overcommits KV. Completions crawl, queue delay and TTFT p95 explode and goodput falls, while TPOT for started requests holds.',
      },
      {
        id: 'pool-small',
        label: 'pool sized too small for launch-day contexts, so blocks run out and requests are preempted and recomputed repeatedly',
        correct: false,
        why: 'Pool size adds pressure but is not the root cause: an admit-everything policy overruns any finite pool at some load. The enormous batch with crawling completions points at missing admission control.',
      },
      {
        id: 'net-stall',
        label: 'network partition between router and workers, so every launch-day request including short prompts gets a delayed first token',
        correct: false,
        why: 'A partition would stall or fail requests already in flight, so TPOT would not be stable. The batch is huge and workers are busy, so the engine is overloaded rather than disconnected.',
      },
      {
        id: 'quant',
        label: 'quantization regression from a recent build or kernel change, so each decode step slows and goodput drops',
        correct: false,
        why: 'A slower kernel would raise TPOT for every request already started. TPOT is comparatively stable, so no per-step slowdown explains the collapse; the damage is in queueing and batch size, not the model build.',
      },
    ],
    mitigations: [
      {
        id: 'bigger-pool',
        label: 'grow the pool, so the oversized launch-day batch fits without any preemption',
        correct: false,
        why: 'More blocks raise the ceiling but not the policy. Admit-everything still overcommits a bigger pool at some load, and queue delay stays unbounded. A larger pool cannot replace a gate and a shed path.',
      },
      {
        id: 'admission',
        label: 'add admission control that sizes each admit to memory headroom, so the rest is shed honestly',
        correct: true,
        why: 'Right: a size- and headroom-aware gate admits only what fits and sheds the rest honestly, so KV never overcommits and admitted requests keep meeting the SLO. Lab 06 builds this shape.',
      },
      {
        id: 'smaller-model',
        label: 'switch to a smaller model for launch week, so each decode step is cheaper and the batch drains faster',
        correct: false,
        why: 'A smaller model lowers per-step cost but changes quality and means a deploy mid-incident. Every request is still admitted at once, so the batch still overcommits and the missing gate remains.',
      },
      {
        id: 'more-nodes',
        label: 'double the fleet tonight, so the extra concurrency spreads across twice as many workers behind the router',
        correct: false,
        why: 'Extra nodes spread load only as well as the router balances it, and each still admits everything. Provisioning takes time and money, and any burst past the new capacity collapses the same way.',
      },
    ],
  },
]

export function loadIncident(id: string, seeds: FleetWeekSeeds): Incident | null {
  const def = INCIDENTS.find((i) => i.id === id)
  if (!def) return null
  let telemetry: TickSample[]
  if (id === 'kv-thrash') {
    // pool too small + a scheduler with NO headroom: over-admission at
    // small sizes, decode growth overflows, auto-preempt storm
    const naiveSjf = {
      name: 'naive-sjf',
      schedule: (v: SchedView) => {
        const w = [...v.waiting].sort((a, b) => a.prompt - b.prompt || a.arrival - b.arrival)
        const used = v.running.reduce((a, r) => a + r.prompt + r.decoded, 0)
        const slots = v.maxRunning - v.running.length
        const admit: number[] = []
        let u = used
        for (const r of w) {
          if (admit.length >= slots) break
          if (u + r.prompt > v.memCap) continue
          admit.push(r.id)
          u += r.prompt
        }
        return { admit, preempt: [] }
      },
    }
    telemetry = runIncidentEngine(seeds, { ...CFG, numBlocks: 96 }, naiveSjf)
  } else if (id === 'intake-stall') {
    // drain misconfigured: intake empties at a crawl
    const e = new Engine(CFG, traceFor(seeds), makeRefScheduler(), makeRefManager(CFG.numBlocks, CFG.blockSize), {
      intake: makeRefQueue(32),
      drainPerTick: 1,
    })
    const series: TickSample[] = []
    e.recorder = (s) => {
      if (s.tick % 10 === 0) series.push(s)
    }
    let guard = 0
    while (!e.done && guard < 20000) {
      e.step()
      guard++
    }
    telemetry = series
  } else {
    // no admission control: a greedy scheduler admits everything that fits
    const greedy = {
      name: 'greedy',
      schedule: (v: SchedView) => ({ admit: v.waiting.map((r) => r.id), preempt: [] }),
    }
    telemetry = runIncidentEngine(seeds, CFG, greedy)
  }
  return { ...def, seed: seeds.seed, telemetry }
}

/**
 * Act IV credits only a learner's first call on each incident. The WhyList reveals the right
 * cause and mitigation after any call and the same incident can be re-opened, so a later call
 * proves recall of that reveal, not diagnosis from the telemetry. Later calls are practice:
 * graded and explained, but never counted toward the act or its XP.
 *
 * The act needs every incident right on its first call, so one missed first call closes it: no
 * call can undo that, and the act stays closed until incidents on unseen seeds exist. A closed act
 * still grades and records the first call on an incident that has not been called yet (it is not
 * practice), but `pass` can no longer be true, so no Act IV XP is awarded.
 */
export interface IncidentLedger {
  /** Incident ids with at least one call (the first call is the only one that counts). */
  attempted: string[]
  /** Incident ids whose first call named the right cause and the right mitigation. */
  credited: string[]
}

export const EMPTY_INCIDENT_LEDGER: IncidentLedger = { attempted: [], credited: [] }

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const INCIDENT_IDS: ReadonlySet<string> = new Set(INCIDENTS.map((i) => i.id))

/**
 * Distinct ids, first seen first, that name a real incident. A stored list is untrusted (an import, an old build,
 * a hand edit): `allDone` counts `credited.length`, so a repeated or invented id would stand in for an incident
 * that was never diagnosed.
 */
const incidentIds = (v: unknown): string[] => [...new Set(strings(v))].filter((id) => INCIDENT_IDS.has(id))

/**
 * The ledger is kept in the progress store's working state (`fw:evidence:incident`), not in component
 * state, so a reload or leaving the page cannot hand a learner a fresh first call on an incident whose
 * answer they have already seen. Reading it dedupes both lists and drops ids that are not in INCIDENTS.
 */
export function incidentLedgerFrom(stored: { attempted?: unknown; credited?: unknown } | undefined): IncidentLedger {
  if (!stored) return EMPTY_INCIDENT_LEDGER
  const attempted = incidentIds(stored.attempted)
  return { attempted, credited: incidentIds(stored.credited).filter((id) => attempted.includes(id)) }
}

/** Incidents whose first call was missed. Any one of them closes the act, because it needs every incident right first time. */
export const incidentMisses = (ledger: IncidentLedger): number => ledger.attempted.length - ledger.credited.length

/**
 * Shown for as long as a missed first call is on record. First-attempt-only credit has no way back inside
 * the current incident set: the act reopens only with incidents on seeds the learner has not seen.
 */
export const INCIDENT_CLOSED_NOTE =
  'A first call was missed, and Act IV needs every incident right on its first call, so the act is closed for now and earns no XP. Repeat calls on an incident are practice: graded and explained, but not marked. First calls on incidents you have not called yet are still graded and marked, but they cannot complete the act. Fresh incidents on unseen seeds arrive in a later update, and those will count.'

export function gradeIncidentCall(
  ledger: IncidentLedger,
  incident: { id: string; title: string },
  causeOk: boolean,
  mitigationOk: boolean,
  total: number = INCIDENTS.length,
): { ledger: IncidentLedger; practice: boolean; result: ActResult } {
  // never trust the caller's ledger either: a repeated or unknown id would inflate credited.length
  const prior = incidentLedgerFrom(ledger)
  const ok = causeOk && mitigationOk
  // an id outside INCIDENTS can never be credited
  const practice = !INCIDENT_IDS.has(incident.id) || prior.attempted.includes(incident.id)
  const next: IncidentLedger = practice
    ? prior
    : {
        attempted: [...prior.attempted, incident.id],
        credited: ok ? [...prior.credited, incident.id] : prior.credited,
      }
  const name = incident.title.split('—')[0].trim()
  const missed = incidentMisses(next)
  const metrics: [string, string][] = [
    ['first calls right', `${next.credited.length}/${total}`],
    ['cause', causeOk ? 'correct' : 'wrong'],
    ['mitigation', mitigationOk ? 'correct' : 'wrong'],
  ]
  const verdict = `cause ${causeOk ? '✓' : '✗'} · mitigation ${mitigationOk ? '✓' : '✗'}`
  const closed = missed > 0
  if (practice) {
    return {
      ledger: next,
      practice,
      result: {
        pass: false,
        practice: true,
        closed,
        score: next.credited.length / total,
        headline: ok ? `${name} diagnosed, not credited` : 'not diagnosed',
        detail: closed
          ? `${verdict}. Practice call: Act IV credits only first calls and a missed first call has closed it for now, so nothing here is credited. Fresh incidents on unseen seeds arrive in a later update.`
          : `${verdict}. Only the first call on an incident counts toward the act and XP; this one was practice.`,
        metrics,
      },
    }
  }
  const allDone = next.credited.length >= total
  const left = total - next.attempted.length
  let detail: string
  if (allDone) detail = 'all three incidents diagnosed with the right fix on the first call. The Planner would hire you.'
  else if (!ok) detail = `${verdict}. That was the first call on this incident, so it is now practice only: the right answer is shown below and a later call here will not count. Act IV needs every incident right on its first call, so it is closed for now and earns no XP. Fresh incidents on unseen seeds arrive in a later update.`
  else if (closed) detail = `${verdict}. Correct and marked, but ${missed} incident(s) were missed on the first call, so Act IV stays closed and earns no XP. Fresh incidents on unseen seeds arrive in a later update.`
  else detail = `${left} incident(s) left to call for the first time. Each needs the right cause and mitigation on its first call; a miss closes the act for now.`
  return {
    ledger: next,
    practice,
    result: {
      pass: allDone,
      closed,
      score: next.credited.length / total,
      headline: ok ? `correct — ${name} diagnosed` : 'wrong call — this incident is now practice only',
      detail,
      metrics,
    },
  }
}
