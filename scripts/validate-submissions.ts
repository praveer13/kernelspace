/** Validate one or more submissions; args may name either file in each pair. */
import { disposeLabWorker } from '../src/lib/lab-worker'
import { loadBenchmarkTraces, submissionStem, validateSubmission } from './submission-tools'

const inputs = process.argv.slice(2)
if (inputs.length === 0) {
  console.error('usage: bun scripts/validate-submissions.ts submissions/<handle>.json [more files]')
  process.exit(2)
}

const stems = [...new Set(inputs.map(submissionStem))].sort()
const traces = await loadBenchmarkTraces()
try {
  for (const stem of stems) {
    const result = await validateSubmission(stem, traces)
    for (const check of result.verified.lab.checks) {
      console.log(`  ${check.pass ? '✓' : '✗'} ${check.id.padEnd(14)} ${check.message}`)
    }
    console.log(
      `OK ${stem}: lab ${result.verified.labGoodput.toFixed(2)}% · ` +
        `Fleet ${result.verified.fleetGoodput.toFixed(2)}% · ` +
        `sha256 ${result.verified.wasmSha256.slice(0, 12)}…`,
    )
  }
} catch (cause) {
  /* bun cannot terminate a worker spinning inside wasm; a timed-out run would keep the process alive */
  console.error(cause)
  process.exit(1)
} finally {
  disposeLabWorker()
}
