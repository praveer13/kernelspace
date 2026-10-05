import { makeRefScheduler } from './fleet-model'
import type { TraceArtifact } from './traces'
import { validateLabInWorker } from './lab-worker'
import { runFleetJob } from './fleet-session'
import { LabTimeoutError } from './wasm-lab'
import {
  runCanonicalLabHarness,
  runFleetBenchmark,
  type LabHarnessResult,
} from './leaderboard-harness'

export {
  runCanonicalLabHarness,
  simulateCanonicalScenario,
  type HarnessCheck,
  type HarnessStats,
  type LabHarnessResult,
} from './leaderboard-harness'

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

export interface VerifiedSchedulerScore extends SubmissionScores {
  wasmSha256: string
  lab: LabHarnessResult
  fleetTicks: number
  fleetCompleted: number
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
  /* Untrusted bytes first run in the worker (2 s budget); the main thread only sees a module that has already returned. */
  let validated
  try {
    validated = await validateLabInWorker(bytes)
  } catch (cause) {
    if (cause instanceof LabTimeoutError) throw new Error(`${cause.title} — ${cause.message}`, { cause })
    throw cause
  }
  const { report, hasInvoke } = validated
  if (!hasInvoke || !report) throw new Error('WASM lacks the lab 06 scheduler bridge')
  if (report.lab.endsWith('@reference')) {
    throw new Error(`${report.lab} is a reference build and earns no leaderboard credit; submit a module built from your own scheduler`)
  }
  if (report.lab !== 'batching-scheduler' || report.version < 2) {
    throw new Error(`expected batching-scheduler ABI v2+, got ${report.lab} v${report.version}`)
  }

  /* Admitted, but still untrusted: the harness and the Fleet run execute the module in a fleet worker under a 10 s budget. */
  const job = await runFleetJob({ bytes, burstgpt, lmsysShape })
  if (!job.lab.pass) {
    const failed = job.lab.checks.filter((check) => !check.pass).map((check) => `${check.id}: ${check.message}`)
    throw new Error(`canonical lab harness failed — ${failed.join('; ')}`)
  }
  if (!job.fleet) throw new Error('Fleet benchmark did not run')

  return {
    wasmSha256: await sha256Bytes(bytes),
    labGoodput: roundScore(job.lab.scores.mean),
    fleetGoodput: roundScore(job.fleet.goodput),
    lab: job.lab,
    fleetTicks: job.fleet.ticks,
    fleetCompleted: job.fleet.completed,
  }
}

/**
 * Canonical baseline published beside user entries; recomputed on every build.
 * The JS reference is trusted, so this runs in-process; `scoreReferenceInWorker` runs the same job through the worker.
 */
export function scoreReferenceBenchmark(
  burstgpt: TraceArtifact,
  lmsysShape: TraceArtifact,
): SubmissionScores {
  const lab = runCanonicalLabHarness(() => makeRefScheduler(), burstgpt, lmsysShape)
  if (!lab.pass) throw new Error('internal reference scheduler failed the canonical lab harness')
  const { fleet, total } = runFleetBenchmark(makeRefScheduler(), burstgpt)
  if (!fleet.done) throw new Error('internal reference Fleet benchmark exceeded 10,000 ticks')
  return {
    labGoodput: roundScore(lab.scores.mean),
    fleetGoodput: roundScore(fleet.goodput(total)),
  }
}

/** The reference baseline through the same one-shot worker job a submission takes (scripts/build-leaderboard.ts). */
export async function scoreReferenceInWorker(
  burstgpt: TraceArtifact,
  lmsysShape: TraceArtifact,
): Promise<SubmissionScores> {
  const job = await runFleetJob({ bytes: null, burstgpt, lmsysShape })
  if (!job.lab.pass || !job.fleet) throw new Error('internal reference scheduler failed the canonical lab harness')
  return { labGoodput: roundScore(job.lab.scores.mean), fleetGoodput: roundScore(job.fleet.goodput) }
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
