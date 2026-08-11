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
  makeRefManager,
  makeRefQueue,
  makeRefScheduler,
  makeRequestStream,
  makeRng,
  routerLabel,
  type RouterKind,
  type SchedView,
  type TickSample,
} from '@/lib/fleet-model'
import { instantiateLab } from '@/lib/wasm-lab'
import { makeWasmManager, makeWasmQueue, makeWasmScheduler } from '@/pages/fleet/drivers'
import type { SlotState } from '@/pages/fleet/slots'

export interface ActResult {
  pass: boolean
  score: number // 0..1
  headline: string
  detail: string
  metrics: [string, string][]
}

export interface MeasurementEvidence {
  analysis: string
  screenshotName?: string
  screenshotBytes?: number
}

export type MeasurementActId = 'engine' | 'fleet'

const CFG = { numBlocks: 256, blockSize: 16, maxRunning: 16, sloTtft: 40, prefillChunk: 128 }
const WORKER_CFG = { numBlocks: 128, blockSize: 16, maxRunning: 12, sloTtft: 40, prefillChunk: 128 }
const REQ_COUNT = 240
const SPAN = 900

async function buildStack(slots: SlotState, numBlocks: number, blockSize: number) {
  const sched = slots.sched ? makeWasmScheduler(await instantiateLab(slots.sched.bytes)) : makeRefScheduler()
  const mgr = slots.mgr
    ? makeWasmManager(await instantiateLab(slots.mgr.bytes), numBlocks, blockSize)
    : makeRefManager(numBlocks, blockSize)
  const queue = slots.queue ? makeWasmQueue(await instantiateLab(slots.queue.bytes), 32) : makeRefQueue(32)
  return { sched, mgr, queue }
}

/* ------------------------------ ACT 1 ------------------------------ */

/** The Engine: your stack vs the reference on the fleet trace. */
export async function runAct1(slots: SlotState): Promise<ActResult> {
  const s = await buildStack(slots, CFG.numBlocks, CFG.blockSize)
  const mine = new Engine(CFG, makeRequestStream(REQ_COUNT, SPAN, 0x5eed), s.sched, s.mgr, {
    intake: s.queue,
    drainPerTick: 8,
  })
  const ref = new Engine(
    CFG,
    makeRequestStream(REQ_COUNT, SPAN, 0x5eed),
    makeRefScheduler(),
    makeRefManager(CFG.numBlocks, CFG.blockSize),
    { intake: makeRefQueue(32), drainPerTick: 8 },
  )
  let guard = 0
  while ((!mine.done || !ref.done) && guard < 20000) {
    if (!mine.done) mine.step()
    if (!ref.done) ref.step()
    guard++
  }
  const myG = mine.goodput(REQ_COUNT)
  const refG = ref.goodput(REQ_COUNT)
  const ms = mine.stats()
  const pass = myG >= refG - 3
  const anyStudent = slots.sched || slots.mgr || slots.queue
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
    ],
  }
}

/* ------------------------------ ACT 2 ------------------------------ */

export interface Act2Choice {
  workers: 2 | 4
  router: RouterKind
}

/** The Fleet: survive a node death + a hot window with your topology choice. */
export async function runAct2(slots: SlotState, choice: Act2Choice): Promise<ActResult> {
  const workerCfgs = Array.from({ length: choice.workers }, () => WORKER_CFG)
  const workers: Engine[] = []
  for (const cfg of workerCfgs) {
    const s = await buildStack(slots, cfg.numBlocks, cfg.blockSize)
    workers.push(new Engine(cfg, [], s.sched, s.mgr, { intake: s.queue, drainPerTick: 6 }))
  }
  const cluster = new Cluster(makeRequestStream(REQ_COUNT, SPAN, 0x5eed), workers, choice.router)
  const events: string[] = []
  const rng = makeRng(0xd15)
  let injected = 0
  cluster.disrupt = (c, tick) => {
    // node death at tick 400: worker 0 dies, in-flight work lost
    if (tick === 400 && c.workers.length > 1 && !c.workers[0].killed) {
      const lost = c.workers[0].kill()
      events.push(`t400: NODE DEATH — worker 0 lost with ${lost} in-flight requests`)
    }
    // hot window at 600–750: extra arrivals slammed into the surviving fleet
    if (tick >= 600 && tick <= 750 && tick % 3 === 0) {
      const alive = c.workers.filter((w) => !w.killed)
      if (alive.length > 0) {
        const w = alive[rng() % alive.length]
        w.inject({ id: 10000 + tick * 10 + (rng() % 10), arrival: tick, prompt: 64 + (rng() % 193), output: 16 + (rng() % 33) })
        injected++
      }
    }
  }
  let guard = 0
  while (!cluster.done && guard < 20000) {
    cluster.step()
    guard++
  }
  const agg = cluster.aggregate()
  const total = REQ_COUNT + injected
  const completedPct = Math.round((agg.completed / total) * 1000) / 10
  const goodput = Math.round((agg.sloMet / total) * 1000) / 10
  const pass = completedPct >= 92 && goodput >= 40
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
      ...events.map((e) => ['event', e] as [string, string]),
    ],
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
  cfg: { numBlocks: number; blockSize: number; maxRunning: number; sloTtft: number; prefillChunk: number }
}

export const HW_MENU: HwOption[] = [
  {
    id: 'h100',
    name: '8× H100 node',
    desc: 'last-gen workhorse · 80 GB HBM3 ×8 · $25/hr',
    hourlyUsd: 25,
    cfg: { numBlocks: 256, blockSize: 16, maxRunning: 16, sloTtft: 40, prefillChunk: 128 },
  },
  {
    id: 'b200',
    name: '4× B200 node',
    desc: 'Blackwell · 192 GB HBM3e ×4, 2.4× bandwidth · $60/hr',
    hourlyUsd: 60,
    cfg: { numBlocks: 512, blockSize: 16, maxRunning: 32, sloTtft: 40, prefillChunk: 256 },
  },
  {
    id: 'gb200',
    name: 'GB200 NVL72 rack',
    desc: 'one NVLink domain · 72 GPUs · $900/hr',
    hourlyUsd: 900,
    cfg: { numBlocks: 2048, blockSize: 16, maxRunning: 96, sloTtft: 40, prefillChunk: 512 },
  },
]

export interface Act3Eval {
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
export async function evalAct3(): Promise<Act3Eval> {
  const perOption: Act3Eval['perOption'] = []
  for (const opt of HW_MENU) {
    const e = new Engine(
      opt.cfg,
      makeRequestStream(REQ_COUNT, SPAN, 0x5eed),
      makeRefScheduler(),
      makeRefManager(opt.cfg.numBlocks, opt.cfg.blockSize),
      { intake: makeRefQueue(32), drainPerTick: 8 },
    )
    let guard = 0
    while (!e.done && guard < 20000) {
      e.step()
      guard++
    }
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
  return { perOption, bestValue: best.id }
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
    ],
  }
}

/* ------------------------------ ACT 4 ------------------------------ */

export interface Incident {
  id: string
  title: string
  briefing: string
  telemetry: TickSample[]
  causes: { id: string; label: string; correct: boolean }[]
  mitigations: { id: string; label: string; correct: boolean }[]
}

function runIncidentEngine(cfg = CFG, sched = makeRefScheduler()): TickSample[] {
  const e = new Engine(cfg, makeRequestStream(REQ_COUNT, SPAN, 0x5eed), sched, makeRefManager(cfg.numBlocks, cfg.blockSize), {
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

export const INCIDENTS: Omit<Incident, 'telemetry'>[] = [
  {
    id: 'kv-thrash',
    title: 'incident 01 — the p99 that climbed all shift',
    briefing:
      'gen_ai.server.time_to_first_token p95 has been climbing for hours while TPOT stays comparatively flat. Auto-preempts are nonzero and rising; free blocks hover near zero. Nothing was deployed today — but the traffic got longer-context this week.',
    causes: [
      { id: 'sched-bug', label: 'scheduler bug — it admits nothing', correct: false },
      { id: 'pool-small', label: 'capacity wall: the KV pool is too small for the new context lengths — allocation failures force recompute preemption', correct: true },
      { id: 'net-stall', label: 'network stall between workers', correct: false },
      { id: 'queue-lie', label: 'intake queue dropping requests silently', correct: false },
    ],
    mitigations: [
      { id: 'restart', label: 'restart the workers nightly', correct: false },
      { id: 'bigger-pool', label: 'grow the pool (more HBM / FP8 KV / offload tier) and cap admitted context', correct: true },
      { id: 'smaller-batch', label: 'reduce max_running', correct: false },
      { id: 'ignore', label: 'ignore it — p95 will recover', correct: false },
    ],
  },
  {
    id: 'intake-stall',
    title: 'incident 02 — shed climbing, GPUs idle',
    briefing:
      'The queue-delay p95 and shed count climb steadily, yet workers sit half-empty: running is low, the scheduler waiting list is near zero, and completions trickle. TPOT is normal once a request starts. The intake queue is not full on average.',
    causes: [
      { id: 'drain', label: 'intake drain rate misconfigured — the queue is being emptied far slower than arrivals, so it fills and sheds despite idle capacity', correct: true },
      { id: 'pool-small', label: 'KV pool too small', correct: false },
      { id: 'hot-expert', label: 'hot expert straggler', correct: false },
      { id: 'sched-bug', label: 'scheduler stuck', correct: false },
    ],
    mitigations: [
      { id: 'bigger-pool', label: 'grow the KV pool', correct: false },
      { id: 'fix-drain', label: 'fix the drain configuration (match drain to admission capacity) and re-run the flash-crowd test', correct: true },
      { id: 'restart', label: 'restart the router', correct: false },
      { id: 'bigger-queue', label: 'just make the queue bigger', correct: false },
    ],
  },
  {
    id: 'no-admission',
    title: 'incident 03 — goodput fell off a cliff at launch',
    briefing:
      'Launch day: concurrency is 4× normal. Goodput falls first, then queue-delay and TTFT p95 explode; TPOT for requests that already started is comparatively stable. The batch is enormous while completions crawl.',
    causes: [
      { id: 'no-admission', label: 'no admission control — everything is admitted at once, the batch overcommits, KV pressure and queueing collapse the SLO', correct: true },
      { id: 'pool-small', label: 'pool too small', correct: false },
      { id: 'net-stall', label: 'network partition', correct: false },
      { id: 'quant', label: 'quantization regression', correct: false },
    ],
    mitigations: [
      { id: 'bigger-pool', label: 'grow the pool', correct: false },
      { id: 'admission', label: 'add admission control (size-aware, headroom-aware) and an honest shed path — the lab-06 shape', correct: true },
      { id: 'smaller-model', label: 'switch to a smaller model', correct: false },
      { id: 'more-nodes', label: 'double the fleet tonight', correct: false },
    ],
  },
]

export function loadIncident(id: string): Incident | null {
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
    telemetry = runIncidentEngine({ ...CFG, numBlocks: 96 }, naiveSjf)
  } else if (id === 'intake-stall') {
    // drain misconfigured: intake empties at a crawl
    const e = new Engine(CFG, makeRequestStream(REQ_COUNT, SPAN, 0x5eed), makeRefScheduler(), makeRefManager(CFG.numBlocks, CFG.blockSize), {
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
    telemetry = runIncidentEngine(CFG, greedy)
  }
  return { ...def, telemetry }
}
