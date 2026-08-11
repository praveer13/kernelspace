/** Re-verify every opt-in submission and publish the static leaderboard JSON. */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  LEADERBOARD_BENCHMARK_VERSION,
  LEADERBOARD_SCHEMA_VERSION,
  overallGoodput,
  scoreReferenceBenchmark,
  type LeaderboardDocument,
  type LeaderboardEntry,
} from '../src/lib/leaderboard'
import {
  loadBenchmarkTraces,
  REPO_ROOT,
  SUBMISSIONS_DIR,
  validateSubmission,
} from './submission-tools'

const traces = await loadBenchmarkTraces()
let names: string[] = []
try {
  names = await readdir(SUBMISSIONS_DIR)
} catch (cause) {
  if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
}

const artifactNames = names.filter((name) => name !== 'README.md')
const invalidNames = artifactNames.filter(
  (name) => !/^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\.(json|wasm)$/.test(name),
)
if (invalidNames.length > 0) throw new Error(`invalid files in submissions/: ${invalidNames.join(', ')}`)
const stems = artifactNames
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.slice(0, -'.json'.length))
  .sort()
const wasmStems = artifactNames
  .filter((name) => name.endsWith('.wasm'))
  .map((name) => name.slice(0, -'.wasm'.length))
  .sort()
if (JSON.stringify(stems) !== JSON.stringify(wasmStems)) {
  throw new Error('every submissions/<handle>.json must have exactly one matching .wasm')
}
const unique = new Set<string>()
const entries: LeaderboardEntry[] = []
for (const stem of stems) {
  const result = await validateSubmission(stem, traces)
  if (unique.has(result.manifest.handle)) throw new Error(`duplicate handle: ${result.manifest.handle}`)
  unique.add(result.manifest.handle)
  const scores = {
    labGoodput: result.verified.labGoodput,
    fleetGoodput: result.verified.fleetGoodput,
  }
  entries.push({
    rank: 0,
    handle: result.manifest.handle,
    ...(result.manifest.displayName ? { displayName: result.manifest.displayName } : {}),
    sourceCommit: result.manifest.sourceCommit,
    wasmSha256: result.verified.wasmSha256,
    ...scores,
    overallGoodput: overallGoodput(scores),
  })
}
entries.sort(
  (a, b) =>
    b.overallGoodput - a.overallGoodput ||
    b.labGoodput - a.labGoodput ||
    a.handle.localeCompare(b.handle),
)
entries.forEach((entry, index) => {
  entry.rank = index + 1
})

const reference = scoreReferenceBenchmark(traces.burstgpt, traces.lmsysShape)
const epoch = process.env.SOURCE_DATE_EPOCH
const gitEpoch = Bun.spawnSync([
  'git',
  'log',
  '-1',
  '--format=%ct',
  '--',
  'submissions',
]).stdout.toString().trim()
const artifactEpoch = epoch || gitEpoch
const generatedAt = artifactEpoch
  ? new Date(Number(artifactEpoch) * 1000).toISOString()
  : new Date().toISOString()
const document: LeaderboardDocument = {
  schemaVersion: LEADERBOARD_SCHEMA_VERSION,
  benchmarkVersion: LEADERBOARD_BENCHMARK_VERSION,
  generatedAt,
  scoring: 'overall = arithmetic mean(lab goodput, Fleet goodput); descending, then lab, then handle',
  traces: {
    burstgptRequestSha256: traces.burstgpt.requestSha256,
    lmsysShapeRequestSha256: traces.lmsysShape.requestSha256,
  },
  reference: { ...reference, overallGoodput: overallGoodput(reference) },
  entries,
}
const output = path.join(REPO_ROOT, 'public/leaderboard.json')
await Bun.write(output, `${JSON.stringify(document, null, 2)}\n`)
console.log(`wrote public/leaderboard.json · ${entries.length} opt-in entr${entries.length === 1 ? 'y' : 'ies'}`)
console.log(
  `reference · lab ${reference.labGoodput.toFixed(2)}% · Fleet ${reference.fleetGoodput.toFixed(2)}%`,
)
