import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lstat, realpath } from 'node:fs/promises'
import {
  assertClaimMatches,
  parseSubmissionManifest,
  verifyAndScoreScheduler,
  type SubmissionManifest,
  type VerifiedSchedulerScore,
} from '../src/lib/leaderboard'
import { parseTraceArtifact, type TraceArtifact } from '../src/lib/traces'

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
export const SUBMISSIONS_DIR = process.env.KS_SUBMISSIONS_DIR
  ? path.resolve(process.env.KS_SUBMISSIONS_DIR)
  : path.join(REPO_ROOT, 'submissions')

export interface BenchmarkTraces {
  burstgpt: TraceArtifact
  lmsysShape: TraceArtifact
}

export interface ValidatedSubmission {
  stem: string
  manifestPath: string
  wasmPath: string
  manifest: SubmissionManifest
  verified: VerifiedSchedulerScore
}

export async function loadBenchmarkTraces(): Promise<BenchmarkTraces> {
  const [burstgpt, lmsysShape] = await Promise.all([
    parseTraceArtifact(
      await Bun.file(path.join(REPO_ROOT, 'public/traces/burstgpt-v2-busiest-hour.json')).json(),
    ),
    parseTraceArtifact(
      await Bun.file(path.join(REPO_ROOT, 'public/traces/lmsys-chat-1m-published-shape.json')).json(),
    ),
  ])
  return { burstgpt, lmsysShape }
}

export function submissionStem(inputPath: string): string {
  const absolute = path.resolve(REPO_ROOT, inputPath)
  const relative = path.relative(REPO_ROOT, absolute).split(path.sep).join('/')
  const match = /^submissions\/((?!.*--)[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)\.(json|wasm)$/.exec(relative)
  if (!match) throw new Error(`${inputPath}: expected submissions/<lowercase-handle>.{json,wasm}`)
  return match[1] as string
}

export async function validateSubmission(
  stem: string,
  traces: BenchmarkTraces,
): Promise<ValidatedSubmission> {
  const manifestPath = path.join(SUBMISSIONS_DIR, `${stem}.json`)
  const wasmPath = path.join(SUBMISSIONS_DIR, `${stem}.wasm`)
  for (const candidate of [manifestPath, wasmPath]) {
    const stat = await lstat(candidate).catch(() => null)
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error(`${stem}: submission pair must be regular files`)
    const resolved = await realpath(candidate)
    const relative = path.relative(SUBMISSIONS_DIR, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${stem}: submission file resolves outside submissions/`)
    }
  }
  const manifestFile = Bun.file(manifestPath)
  const wasmFile = Bun.file(wasmPath)
  if (!(await manifestFile.exists())) throw new Error(`${stem}: missing submissions/${stem}.json`)
  if (!(await wasmFile.exists())) throw new Error(`${stem}: missing submissions/${stem}.wasm`)
  if (manifestFile.size > 10_000) throw new Error(`${stem}: manifest exceeds 10,000 bytes`)

  let raw: unknown
  try {
    raw = await manifestFile.json()
  } catch (cause) {
    throw new Error(`${stem}: invalid manifest JSON`, { cause })
  }
  const manifest = parseSubmissionManifest(raw)
  if (manifest.handle !== stem) throw new Error(`${stem}: manifest handle must match the filename`)
  const bytes = await wasmFile.arrayBuffer()
  const verified = await verifyAndScoreScheduler(bytes, traces.burstgpt, traces.lmsysShape)
  assertClaimMatches(manifest, verified)
  return { stem, manifestPath, wasmPath, manifest, verified }
}
