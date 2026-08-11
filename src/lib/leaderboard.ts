import {
  Engine,
  makeRefManager,
  makeRefQueue,
  makeRefScheduler,
  type RequestSpec,
  type SchedulerDriver,
  type SchedView,
} from './fleet-model'
import { getFleetTrafficProfile, traceToRequestStream, type TraceArtifact, type TraceRequest } from './traces'
import { instantiateLab } from './wasm-lab'
import { makeWasmScheduler } from './wasm-scheduler'

export const LEADERBOARD_SCHEMA_VERSION = 1 as const
export const LEADERBOARD_BENCHMARK_VERSION = 'wave4-2026-08-v1'
export const MAX_SUBMISSION_WASM_BYTES = 2_000_000
export const SCORE_TOLERANCE = 0.01

export interface SubmissionScores {
  labGoodput: number
  fleetGoodput: number
}

export interface SubmissionManifest {
  schemaVersion: 1
  handle: string
  displayName?: string
  sourceCommit: string
  wasmSha256: string
  benchmarkVersion: string
  scores: SubmissionScores
  publish: true
}

export interface LeaderboardEntry extends SubmissionScores {
  rank: number
  handle: string
  displayName?: string
  sourceCommit: string
  wasmSha256: string
  overallGoodput: number
}

export interface LeaderboardDocument {
  schemaVersion: 1
  benchmarkVersion: string
  generatedAt: string | null
  scoring: string
  traces: {
    burstgptRequestSha256: string
    lmsysShapeRequestSha256: string
  }
  reference: SubmissionScores & { overallGoodput: number }
  entries: LeaderboardEntry[]
}

export interface HarnessStats {
  total: number
  completed: number
  sloMet: number
  ttftP95: number
  lastFinish: number
  completedIds: number[]
}

export interface HarnessCheck {
  id: string
  pass: boolean
  message: string
}

export interface LabHarnessResult {
  pass: boolean
  checks: HarnessCheck[]
  scenarios: Record<string, HarnessStats>
  scores: {
    synthetic: number
    burstgpt: number
    lmsysShape: number
    mean: number
  }
}

export interface VerifiedSchedulerScore extends SubmissionScores {
  wasmSha256: string
  lab: LabHarnessResult
  fleetTicks: number
  fleetCompleted: number
}

interface CanonicalScenario {
  name: string
  requests: RequestSpec[]
  maxRunning: number
  memCap: number
  sloTtft: number
  iterations: number
}

interface HarnessSequence {
  spec: RequestSpec
  prefillLeft: number
  decoded: number
  ttft?: number
}

const CHUNK = 128
const MASK_64 = (1n << 64n) - 1n

class RustRng {
  private state: bigint

  constructor(seed: number) {
    this.state = BigInt(seed)
  }

  below(n: number): number {
    let x = this.state
    x ^= x >> 12n
    x ^= (x << 25n) & MASK_64
    x ^= x >> 27n
    this.state = x & MASK_64
    const output = (this.state * 0x2545f4914f6cdd1dn) & MASK_64
    return Number(output % BigInt(n))
  }
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0
}

function goodput(stats: HarnessStats): number {
  return stats.total === 0 ? 0 : stats.sloMet / stats.total
}

function cloneRequest(request: RequestSpec): RequestSpec {
  return {
    ...request,
    ...(request.tokens ? { tokens: [...request.tokens] } : {}),
  }
}

/** Independent TypeScript port of the public lab 06 simulator. */
export function simulateCanonicalScenario(
  scenario: CanonicalScenario,
  scheduler: SchedulerDriver,
): HarnessStats {
  let waiting: RequestSpec[] = []
  let running: HarnessSequence[] = []
  const ttfts: number[] = []
  const stats: HarnessStats = {
    total: scenario.requests.length,
    completed: 0,
    sloMet: 0,
    ttftP95: 0,
    lastFinish: 0,
    completedIds: [],
  }

  for (let tick = 0; tick < scenario.iterations; tick += 1) {
    for (const request of scenario.requests) {
      if (request.arrival === tick) waiting.push(cloneRequest(request))
    }
    const view: SchedView = {
      iter: tick,
      maxRunning: scenario.maxRunning,
      memCap: scenario.memCap,
      memUsed: running.reduce((sum, seq) => sum + seq.spec.prompt + seq.decoded, 0),
      waiting: waiting.map((request) => ({
        id: request.id,
        arrival: request.arrival,
        prompt: request.prompt,
      })),
      running: running.map((seq) => ({
        id: seq.spec.id,
        arrival: seq.spec.arrival,
        prompt: seq.spec.prompt,
        decoded: seq.decoded,
        prefillLeft: seq.prefillLeft,
      })),
    }
    const action = scheduler.schedule(view)
    if (new Set(action.admit).size !== action.admit.length) throw new Error(`t${tick}: duplicate admit id`)
    if (new Set(action.preempt).size !== action.preempt.length) throw new Error(`t${tick}: duplicate preempt id`)

    const waitingIds = new Set(waiting.map((request) => request.id))
    const runningIds = new Set(running.map((seq) => seq.spec.id))
    for (const id of action.admit) {
      if (!waitingIds.has(id)) throw new Error(`t${tick}: admitted id ${id} is not waiting`)
    }
    for (const id of action.preempt) {
      if (!runningIds.has(id)) throw new Error(`t${tick}: preempted id ${id} is not running`)
    }
    const postRunning = running.length - action.preempt.length + action.admit.length
    if (postRunning > scenario.maxRunning) {
      throw new Error(`t${tick}: ${postRunning} running exceeds ${scenario.maxRunning}`)
    }

    const preemptSet = new Set(action.preempt)
    const admitSet = new Set(action.admit)
    const currentMemory = running.reduce((sum, seq) => sum + seq.spec.prompt + seq.decoded, 0)
    const preemptedMemory = running
      .filter((seq) => preemptSet.has(seq.spec.id))
      .reduce((sum, seq) => sum + seq.spec.prompt + seq.decoded, 0)
    const admittedMemory = waiting
      .filter((request) => admitSet.has(request.id))
      .reduce((sum, request) => sum + request.prompt, 0)
    const postMemory = currentMemory - preemptedMemory + admittedMemory
    if (postMemory > scenario.memCap && postMemory > currentMemory) {
      throw new Error(`t${tick}: action pushed resident memory to ${postMemory} > ${scenario.memCap}`)
    }

    const keptRunning: HarnessSequence[] = []
    for (const seq of running) {
      if (preemptSet.has(seq.spec.id)) waiting.push(cloneRequest(seq.spec))
      else keptRunning.push(seq)
    }
    running = keptRunning

    const keptWaiting: RequestSpec[] = []
    for (const request of waiting) {
      if (admitSet.has(request.id)) {
        running.push({
          spec: cloneRequest(request),
          prefillLeft: Math.ceil(request.prompt / CHUNK),
          decoded: 0,
        })
      } else {
        keptWaiting.push(request)
      }
    }
    waiting = keptWaiting

    for (const seq of running) {
      if (seq.prefillLeft > 0) {
        seq.prefillLeft -= 1
        if (seq.prefillLeft === 0) {
          seq.decoded = 1
          seq.ttft = tick - seq.spec.arrival
        }
      } else {
        seq.decoded += 1
      }
    }
    const unfinished: HarnessSequence[] = []
    for (const seq of running) {
      if (seq.decoded >= seq.spec.output) {
        stats.completed += 1
        stats.completedIds.push(seq.spec.id)
        stats.lastFinish = Math.max(stats.lastFinish, tick)
        const ttft = seq.ttft ?? Number.MAX_SAFE_INTEGER
        ttfts.push(ttft)
        if (ttft <= scenario.sloTtft) stats.sloMet += 1
      } else {
        unfinished.push(seq)
      }
    }
    running = unfinished

    while (
      running.length > 0 &&
      running.reduce((sum, seq) => sum + seq.spec.prompt + seq.decoded, 0) > scenario.memCap
    ) {
      const victim = running.pop()
      if (victim) waiting.push(cloneRequest(victim.spec))
    }
  }
  stats.ttftP95 = percentile95(ttfts)
  return stats
}

function lightScenario(): CanonicalScenario {
  const rng = new RustRng(0x1164)
  const requests = Array.from({ length: 20 }, (_, id) => ({
    id,
    arrival: rng.below(200),
    prompt: 32 + rng.below(224),
    output: 16 + rng.below(48),
  }))
  return { name: 'light', requests, maxRunning: 8, memCap: 8192, sloTtft: 40, iterations: 800 }
}

function burstScenario(): CanonicalScenario {
  const rng = new RustRng(0xb57)
  const requests = Array.from({ length: 48 }, (_, id) => ({
    id,
    arrival: rng.below(6),
    prompt: 64 + rng.below(448),
    output: 32 + rng.below(64),
  }))
  return { name: 'burst', requests, maxRunning: 24, memCap: 8192, sloTtft: 90, iterations: 1200 }
}

function convoyScenario(): CanonicalScenario {
  const requests: RequestSpec[] = [{ id: 0, arrival: 0, prompt: 8192, output: 24 }]
  for (let id = 1; id <= 88; id += 1) requests.push({ id, arrival: 0, prompt: 128, output: 24 })
  return { name: 'convoy', requests, maxRunning: 96, memCap: 12288, sloTtft: 40, iterations: 1200 }
}

function starvationScenario(): CanonicalScenario {
  const rng = new RustRng(0x57a1)
  const requests: RequestSpec[] = []
  for (let id = 0; id < 3; id += 1) requests.push({ id, arrival: 0, prompt: 1024, output: 32 })
  for (let id = 3; id < 403; id += 1) {
    requests.push({
      id,
      arrival: id < 40 ? id % 3 : rng.below(2000),
      prompt: 96 + rng.below(160),
      output: 24 + rng.below(32),
    })
  }
  return { name: 'starvation', requests, maxRunning: 5, memCap: 12288, sloTtft: 250, iterations: 2500 }
}

function syntheticFleetScenario(): CanonicalScenario {
  const rng = new RustRng(0xf1e7)
  const requests: RequestSpec[] = []
  for (let id = 0; id < 400; id += 1) {
    const heavy = rng.below(100) < 12
    requests.push({
      id,
      arrival: rng.below(1400),
      prompt: heavy ? 1024 + rng.below(2048) : 64 + rng.below(448),
      output: 16 + rng.below(80),
    })
  }
  return { name: 'synthetic', requests, maxRunning: 12, memCap: 16384, sloTtft: 50, iterations: 2500 }
}

function traceScenario(
  name: string,
  rows: TraceRequest[],
  maxRunning: number,
  memCap: number,
  sloTtft: number,
  iterations: number,
): CanonicalScenario {
  return {
    name,
    requests: rows.map((row, id) => ({ id, arrival: row.t, prompt: row.p, output: row.o })),
    maxRunning,
    memCap,
    sloTtft,
    iterations,
  }
}

function scenarioCheck(id: string, pass: boolean, message: string): HarnessCheck {
  return { id, pass, message }
}

/** Run all six canonical lab checks without trusting the submitted ks_run report. */
export function runCanonicalLabHarness(
  schedulerFactory: () => SchedulerDriver,
  burstgpt: TraceArtifact,
  lmsysShape: TraceArtifact,
): LabHarnessResult {
  const scenarioList = [
    lightScenario(),
    burstScenario(),
    convoyScenario(),
    starvationScenario(),
    syntheticFleetScenario(),
    traceScenario('burstgpt', burstgpt.requests, 8, 4096, 40, 2200),
    traceScenario('lmsys-shape', lmsysShape.requests, 64, 32768, 120, 5000),
  ]
  const scenarios: Record<string, HarnessStats> = {}
  for (const scenario of scenarioList) {
    scenarios[scenario.name] = simulateCanonicalScenario(scenario, schedulerFactory())
  }

  const light = scenarios.light as HarnessStats
  const burst = scenarios.burst as HarnessStats
  const convoy = scenarios.convoy as HarnessStats
  const starvation = scenarios.starvation as HarnessStats
  const synthetic = scenarios.synthetic as HarnessStats
  const burstTrace = scenarios.burstgpt as HarnessStats
  const lmsys = scenarios['lmsys-shape'] as HarnessStats
  const longsDone = [0, 1, 2].filter((id) => starvation.completedIds.includes(id)).length
  const checks = [
    scenarioCheck('runs_clean', light.completed === light.total, `${light.completed}/${light.total} completed`),
    scenarioCheck('slo_light', goodput(light) >= 0.95, `${(goodput(light) * 100).toFixed(1)}% goodput`),
    scenarioCheck('burst', goodput(burst) >= 0.9, `${(goodput(burst) * 100).toFixed(1)}% goodput`),
    scenarioCheck(
      'convoy',
      convoy.sloMet >= 85 && convoy.completed === convoy.total,
      `${convoy.sloMet}/${convoy.total} SLO-met; ${convoy.completed} completed`,
    ),
    scenarioCheck(
      'starvation',
      longsDone === 3 && starvation.completed >= 100,
      `${longsDone}/3 longs; ${starvation.completed} completed`,
    ),
    scenarioCheck(
      'goodput_score',
      goodput(synthetic) >= 0.55 && goodput(burstTrace) >= 0.85 && goodput(lmsys) >= 0.7,
      `synthetic ${(goodput(synthetic) * 100).toFixed(1)}% · BurstGPT ${(goodput(burstTrace) * 100).toFixed(1)}% · LMSYS-shape ${(goodput(lmsys) * 100).toFixed(1)}%`,
    ),
  ]
  const scores = {
    synthetic: goodput(synthetic) * 100,
    burstgpt: goodput(burstTrace) * 100,
    lmsysShape: goodput(lmsys) * 100,
    mean: ((goodput(synthetic) + goodput(burstTrace) + goodput(lmsys)) / 3) * 100,
  }
  return { pass: checks.every((check) => check.pass), checks, scenarios, scores }
}

export function roundScore(value: number): number {
  return Math.round(value * 100) / 100
}

export function overallGoodput(scores: SubmissionScores): number {
  return roundScore((scores.labGoodput + scores.fleetGoodput) / 2)
}

export async function sha256Bytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Independently score a scheduler WASM against the canonical harness and Fleet. */
export async function verifyAndScoreScheduler(
  bytes: ArrayBuffer,
  burstgpt: TraceArtifact,
  lmsysShape: TraceArtifact,
): Promise<VerifiedSchedulerScore> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SUBMISSION_WASM_BYTES) {
    throw new Error(`WASM must be 1..${MAX_SUBMISSION_WASM_BYTES.toLocaleString()} bytes`)
  }
  const module = await instantiateLab(bytes)
  if (!module.hasInvoke) throw new Error('WASM lacks the lab 06 scheduler bridge')
  const report = module.runChecks()
  if (report.lab !== 'batching-scheduler' || report.version < 2) {
    throw new Error(`expected batching-scheduler ABI v2+, got ${report.lab} v${report.version}`)
  }

  const lab = runCanonicalLabHarness(() => makeWasmScheduler(module), burstgpt, lmsysShape)
  if (!lab.pass) {
    const failed = lab.checks.filter((check) => !check.pass).map((check) => `${check.id}: ${check.message}`)
    throw new Error(`canonical lab harness failed — ${failed.join('; ')}`)
  }

  const fleetModule = await instantiateLab(bytes.slice(0))
  const fleetScheduler = makeWasmScheduler(fleetModule)
  const profile = getFleetTrafficProfile('burstgpt')
  const stream = traceToRequestStream(burstgpt)
  const fleet = new Engine(
    profile.config,
    stream,
    fleetScheduler,
    makeRefManager(profile.config.numBlocks, profile.config.blockSize),
    { intake: makeRefQueue(profile.intakeCap), drainPerTick: profile.drainPerTick },
  )
  while (!fleet.done && fleet.tick < 10_000) fleet.step()
  if (!fleet.done) throw new Error('Fleet benchmark exceeded 10,000 ticks')
  if (fleet.violations.length > 0) throw new Error(`Fleet legality violation: ${fleet.violations[0]}`)

  return {
    wasmSha256: await sha256Bytes(bytes),
    labGoodput: roundScore(lab.scores.mean),
    fleetGoodput: roundScore(fleet.goodput(stream.length)),
    lab,
    fleetTicks: fleet.tick,
    fleetCompleted: fleet.stats().completed,
  }
}

/** Canonical baseline published beside user entries; recomputed on every build. */
export function scoreReferenceBenchmark(
  burstgpt: TraceArtifact,
  lmsysShape: TraceArtifact,
): SubmissionScores {
  const lab = runCanonicalLabHarness(() => makeRefScheduler(), burstgpt, lmsysShape)
  if (!lab.pass) throw new Error('internal reference scheduler failed the canonical lab harness')
  const profile = getFleetTrafficProfile('burstgpt')
  const stream = traceToRequestStream(burstgpt)
  const fleet = new Engine(
    profile.config,
    stream,
    makeRefScheduler(),
    makeRefManager(profile.config.numBlocks, profile.config.blockSize),
    { intake: makeRefQueue(profile.intakeCap), drainPerTick: profile.drainPerTick },
  )
  while (!fleet.done && fleet.tick < 10_000) fleet.step()
  if (!fleet.done) throw new Error('internal reference Fleet benchmark exceeded 10,000 ticks')
  return {
    labGoodput: roundScore(lab.scores.mean),
    fleetGoodput: roundScore(fleet.goodput(stream.length)),
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scoreField(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be a finite number from 0 to 100`)
  }
  return value
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
}

/** Strict manifest parser shared by CI and the browser submission builder. */
export function parseSubmissionManifest(value: unknown): SubmissionManifest {
  if (!plainObject(value)) throw new Error('submission manifest must be an object')
  const allowed = new Set([
    'schemaVersion',
    'handle',
    'displayName',
    'sourceCommit',
    'wasmSha256',
    'benchmarkVersion',
    'scores',
    'publish',
  ])
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (unexpected.length > 0) throw new Error(`unexpected manifest fields: ${unexpected.join(', ')}`)
  if (value.schemaVersion !== LEADERBOARD_SCHEMA_VERSION) throw new Error('unsupported submission schemaVersion')
  if (value.benchmarkVersion !== LEADERBOARD_BENCHMARK_VERSION) {
    throw new Error(`benchmarkVersion must be ${LEADERBOARD_BENCHMARK_VERSION}`)
  }
  if (
    typeof value.handle !== 'string' ||
    !/^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(value.handle)
  ) {
    throw new Error('handle must be 1..39 lowercase letters, digits, or single hyphens')
  }
  if (
    value.displayName !== undefined &&
    (typeof value.displayName !== 'string' ||
      value.displayName.trim().length === 0 ||
      value.displayName.length > 80 ||
      hasControlCharacters(value.displayName))
  ) {
    throw new Error('displayName must be 1..80 characters with no controls')
  }
  if (typeof value.sourceCommit !== 'string' || !/^[a-f0-9]{7,40}$/.test(value.sourceCommit)) {
    throw new Error('sourceCommit must be 7..40 lowercase hex characters')
  }
  if (typeof value.wasmSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.wasmSha256)) {
    throw new Error('wasmSha256 must be 64 lowercase hex characters')
  }
  if (!plainObject(value.scores)) throw new Error('scores must be an object')
  const scoreKeys = Object.keys(value.scores)
  if (scoreKeys.length !== 2 || !scoreKeys.includes('labGoodput') || !scoreKeys.includes('fleetGoodput')) {
    throw new Error('scores must contain exactly labGoodput and fleetGoodput')
  }
  if (value.publish !== true) throw new Error('publish must be true; public submission is explicit opt-in')
  return {
    schemaVersion: 1,
    handle: value.handle,
    ...(value.displayName ? { displayName: value.displayName as string } : {}),
    sourceCommit: value.sourceCommit,
    wasmSha256: value.wasmSha256,
    benchmarkVersion: LEADERBOARD_BENCHMARK_VERSION,
    scores: {
      labGoodput: scoreField(value.scores.labGoodput, 'scores.labGoodput'),
      fleetGoodput: scoreField(value.scores.fleetGoodput, 'scores.fleetGoodput'),
    },
    publish: true,
  }
}

export function assertClaimMatches(manifest: SubmissionManifest, verified: VerifiedSchedulerScore): void {
  if (manifest.wasmSha256 !== verified.wasmSha256) {
    throw new Error(`WASM SHA-256 mismatch: manifest ${manifest.wasmSha256}, actual ${verified.wasmSha256}`)
  }
  for (const key of ['labGoodput', 'fleetGoodput'] as const) {
    if (Math.abs(manifest.scores[key] - verified[key]) > SCORE_TOLERANCE) {
      throw new Error(`${key} mismatch: claimed ${manifest.scores[key]}, verified ${verified[key]}`)
    }
  }
}

export function isLeaderboardDocument(value: unknown): value is LeaderboardDocument {
  if (!plainObject(value) || value.schemaVersion !== 1 || typeof value.benchmarkVersion !== 'string') return false
  if (!Array.isArray(value.entries) || !plainObject(value.reference) || !plainObject(value.traces)) return false
  return value.entries.every(
    (entry) =>
      plainObject(entry) &&
      Number.isInteger(entry.rank) &&
      typeof entry.handle === 'string' &&
      typeof entry.labGoodput === 'number' &&
      typeof entry.fleetGoodput === 'number' &&
      typeof entry.overallGoodput === 'number',
  )
}
