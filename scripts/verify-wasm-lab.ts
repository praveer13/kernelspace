/**
 * verify-wasm-lab — run the SAME ABI client the site uses against a built
 * lab module, headless. Proves the template traps cleanly and a solution
 * reports all-pass, without a browser.
 *
 *   bun scripts/verify-wasm-lab.ts <path-to.wasm> [expect-pass|expect-trap]
 */
import { runLabWasm, LabAbiError, LabTrapError } from '../src/lib/wasm-lab'

const [wasmPath, expect] = [process.argv[2], process.argv[3] ?? 'expect-pass']
if (!wasmPath) {
  console.error('usage: bun scripts/verify-wasm-lab.ts <module.wasm> [expect-pass|expect-trap]')
  process.exit(2)
}

const bytes = await Bun.file(wasmPath).arrayBuffer()
try {
  const report = await runLabWasm(bytes)
  const failed = report.checks.filter((c) => !c.pass)
  console.log(`lab=${report.lab} v${report.version} — ${report.checks.length} checks`)
  for (const c of report.checks) {
    console.log(`  ${c.pass ? '✓' : '✗'} ${c.id.padEnd(14)} ${c.msg}`)
  }
  if (failed.length > 0) {
    console.error(`FAIL: ${failed.length} check(s) failed`)
    process.exit(1)
  }
  if (expect === 'expect-trap') {
    console.error('FAIL: expected a trap but the module ran clean')
    process.exit(1)
  }
  console.log('OK: all checks pass over the wasm ABI')
} catch (e) {
  if (e instanceof LabTrapError) {
    console.log(`TRAP (as designed): ${e.message}`)
    process.exit(expect === 'expect-trap' ? 0 : 1)
  }
  if (e instanceof LabAbiError) {
    console.error(`ABI ERROR: ${e.message}`)
    process.exit(1)
  }
  throw e
}
