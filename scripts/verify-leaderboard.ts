/** Deterministic parity and static-artifact checks for the Wave 4 benchmark. */
import assert from 'node:assert/strict'
import {
  LEADERBOARD_BENCHMARK_VERSION,
  isLeaderboardDocument,
  overallGoodput,
  parseSubmissionManifest,
  runCanonicalLabHarness,
  scoreReferenceBenchmark,
} from '../src/lib/leaderboard'
import { makeRefScheduler } from '../src/lib/fleet-model'
import { loadBenchmarkTraces, REPO_ROOT } from './submission-tools'
import path from 'node:path'

const traces = await loadBenchmarkTraces()
const lab = runCanonicalLabHarness(() => makeRefScheduler(), traces.burstgpt, traces.lmsysShape)
assert.equal(lab.pass, true)
assert.equal(lab.scores.synthetic, 62.5)
assert.equal(lab.scores.burstgpt, 90.625)
assert.equal(lab.scores.lmsysShape, 76.66666666666667)
assert.equal(Math.round(lab.scores.mean * 100) / 100, 76.6)

const reference = scoreReferenceBenchmark(traces.burstgpt, traces.lmsysShape)
assert.deepEqual(reference, { labGoodput: 76.6, fleetGoodput: 90.6 })
assert.equal(overallGoodput(reference), 83.6)

const raw: unknown = await Bun.file(path.join(REPO_ROOT, 'public/leaderboard.json')).json()
assert.equal(isLeaderboardDocument(raw), true)
if (!isLeaderboardDocument(raw)) throw new Error('leaderboard type narrowing failed')
assert.equal(raw.benchmarkVersion, LEADERBOARD_BENCHMARK_VERSION)
assert.equal(raw.traces.burstgptRequestSha256, traces.burstgpt.requestSha256)
assert.equal(raw.traces.lmsysShapeRequestSha256, traces.lmsysShape.requestSha256)
assert.deepEqual(raw.reference, { ...reference, overallGoodput: 83.6 })
for (const [index, entry] of raw.entries.entries()) {
  assert.equal(entry.rank, index + 1)
  assert.equal(entry.overallGoodput, overallGoodput(entry))
  if (index > 0) assert.ok(raw.entries[index - 1]!.overallGoodput >= entry.overallGoodput)
}

const valid = {
  schemaVersion: 1,
  handle: 'scheduler-1',
  sourceCommit: '0123456789abcdef',
  wasmSha256: 'a'.repeat(64),
  benchmarkVersion: LEADERBOARD_BENCHMARK_VERSION,
  scores: { labGoodput: 76.6, fleetGoodput: 90.6 },
  publish: true,
}
assert.equal(parseSubmissionManifest(valid).handle, 'scheduler-1')
for (const invalid of [
  { ...valid, handle: 'Scheduler' },
  { ...valid, handle: 'two--hyphens' },
  { ...valid, publish: false },
  { ...valid, scores: { ...valid.scores, fleetGoodput: 101 } },
  { ...valid, surprise: true },
]) {
  assert.throws(() => parseSubmissionManifest(invalid))
}

console.log('OK: Rust/TypeScript parity, reference scores, manifest strictness, and static artifact verified')
