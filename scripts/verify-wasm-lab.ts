/**
 * verify-wasm-lab — run the SAME ABI client the site uses against a built
 * lab module, headless. Proves the template traps cleanly and a solution
 * reports all-pass, without a browser. Runs through the lab worker, exactly
 * as the Forge does, so a spinning module proves the 2 s timeout too.
 *
 *   bun scripts/verify-wasm-lab.ts <module.wasm> expect-pass|expect-trap|expect-timeout|expect-reference
 *       [--seeds default|fresh|<n>] [--check <id>=pass|fail|trap|timeout]…
 *
 * Template v2 (docs/specs/wave-1.md §12.7):
 * - expect-trap: `list` succeeds and every required check traps on its own (v1: the whole run traps);
 * - expect-pass: every required check passes on default seeds; `--seeds <n>` adds n runs on fresh seeds;
 * - expect-timeout: at least one check timed out and the run went on (v1: the run timed out);
 * - expect-reference: the lab id ends with `@reference` and `creditFor` gives it nothing;
 * - `--check id=status` asserts one check's status on the default-seed run.
 * Every module must also instantiate with zero imports (W5). Required checks come from
 * src/data/labs.ts; a lab it does not know has every check required.
 */
import { LabAbiError, LabTimeoutError, LabTrapError } from '../src/lib/wasm-lab'
import { disposeLabWorker, runLab } from '../src/lib/lab-worker'
import { creditFor } from '../src/lib/forge/run'
import type { CheckStatus, LabRunReport } from '../src/lib/forge/types'
import { FORGE_LABS } from '../src/data/labs'

const MODES = ['expect-pass', 'expect-trap', 'expect-timeout', 'expect-reference'] as const
type Mode = (typeof MODES)[number]
const USAGE =
  'usage: bun scripts/verify-wasm-lab.ts <module.wasm> [expect-pass|expect-trap|expect-timeout|expect-reference] ' +
  '[--seeds default|fresh|<n>] [--check <id>=pass|fail|trap|timeout]…'

function usage(why: string): never {
  console.error(`${why}\n${USAGE}`)
  process.exit(2)
}

const args = process.argv.slice(2)
const wasmPath = args.shift()
if (!wasmPath || wasmPath.startsWith('--')) usage('no module given')
let mode: Mode = 'expect-pass'
let freshRuns = 0
const asserts = new Map<string, CheckStatus>()
while (args.length > 0) {
  const a = args.shift() as string
  if ((MODES as readonly string[]).includes(a)) mode = a as Mode
  else if (a === '--seeds') {
    const v = args.shift()
    if (v === 'default') freshRuns = 0
    else if (v === 'fresh') freshRuns = 1
    else if (v && /^\d+$/.test(v)) freshRuns = Number(v)
    else usage(`--seeds takes default, fresh or a count, not ${String(v)}`)
  } else if (a === '--check') {
    const m = /^([^=\s]+)=(pass|fail|trap|timeout)$/.exec(args.shift() ?? '')
    if (!m) usage('--check takes <id>=pass|fail|trap|timeout')
    asserts.set(m[1], m[2] as CheckStatus)
  } else usage(`unknown argument ${a}`)
}

const problems: string[] = []
const mark = (s: CheckStatus) => ({ pass: '✓', fail: '✗', trap: '!', timeout: '⏱' })[s]

function print(r: LabRunReport, title: string) {
  console.log(`${title}: lab=${r.lab}${r.reference ? '@reference' : ''} v${r.version} abi ${r.abi} seeds=${r.seeds} — ${r.checks.length} checks, ${Math.round(r.ms)} ms`)
  for (const c of r.checks) {
    const seed = c.seed === undefined ? '' : ` [seed ${c.seed}${c.fresh ? ', fresh' : ''}]`
    console.log(`  ${mark(c.status)} ${c.id.padEnd(16)} ${c.status.padEnd(7)} ${c.msg}${seed}`)
  }
}

function required(r: LabRunReport): string[] {
  const lab = FORGE_LABS.find((l) => l.id === r.lab)
  return lab ? lab.checks.filter((c) => !c.optional).map((c) => c.id) : r.checks.map((c) => c.id)
}

const bytes = await Bun.file(wasmPath).arrayBuffer()
let exitCode = 0
try {
  const imports = WebAssembly.Module.imports(await WebAssembly.compile(bytes))
  if (imports.length > 0) problems.push(`the module imports ${imports.map((i) => `${i.module}.${i.name}`).join(', ')}; a lab must instantiate with {} (W5)`)

  const report = await runLab(bytes, { seeds: 'default' })
  print(report, 'default seeds')
  const req = required(report)
  const byId = new Map(report.checks.map((c) => [c.id, c]))
  for (const id of req) if (!byId.has(id)) problems.push(`required check "${id}" is missing from the module`)

  for (const [id, want] of asserts) {
    const got = byId.get(id)?.status
    if (got !== want) problems.push(`--check ${id}=${want}, but it was ${got ?? 'missing'}`)
  }
  if (report.abi === 1 && (freshRuns > 0 || asserts.size > 0) && mode !== 'expect-pass') {
    console.log('note: a v1 module has no seeds and no per-check status beyond pass/fail')
  }

  if (mode === 'expect-pass') {
    const red = report.checks.filter((c) => req.includes(c.id) && c.status !== 'pass')
    if (red.length > 0) problems.push(`${red.length} required check(s) not green on default seeds: ${red.map((c) => `${c.id} (${c.status})`).join(', ')}`)
    if (report.abi === 2) {
      for (let i = 0; i < freshRuns; i++) {
        const fresh = await runLab(bytes, { seeds: 'fresh' })
        const bad = fresh.checks.filter((c) => req.includes(c.id) && c.status !== 'pass')
        if (bad.length > 0) {
          print(fresh, `fresh run ${i + 1}`)
          problems.push(`fresh run ${i + 1}: ${bad.map((c) => `${c.id} (${c.status}${c.seed === undefined ? '' : `, seed ${c.seed}`})`).join(', ')}`)
          break
        }
      }
      if (freshRuns > 0 && problems.length === 0) console.log(`fresh seeds: ${freshRuns} run(s), every required check green`)
    } else if (freshRuns > 0) {
      console.log('note: a v1 module ignores seeds; --seeds was not applied')
    }
  } else if (mode === 'expect-trap') {
    if (report.abi === 1) problems.push('expect-trap, but the v1 module ran without trapping')
    else {
      const notTrapped = report.checks.filter((c) => req.includes(c.id) && c.status !== 'trap')
      if (notTrapped.length > 0) problems.push(`expect-trap: ${notTrapped.map((c) => `${c.id} (${c.status})`).join(', ')} did not trap on the template`)
    }
  } else if (mode === 'expect-timeout') {
    if (report.abi === 1) problems.push('expect-timeout, but the v1 module returned')
    else if (!report.checks.some((c) => c.status === 'timeout')) problems.push('expect-timeout, but no check timed out')
  } else if (mode === 'expect-reference') {
    if (!report.reference) problems.push(`expect-reference, but the lab id "${report.lab}" has no @reference suffix`)
    const credit = creditFor({ ...report, seeds: 'fresh' }, {}, req)
    if (credit !== null) problems.push(`expect-reference, but creditFor gives it "${credit}"`)
  }
  if (report.abi === 2 && mode !== 'expect-reference' && report.reference) {
    problems.push('this is a reference build (@reference); use expect-reference')
  }
} catch (e) {
  if (e instanceof LabTrapError) {
    console.log(`TRAP: ${e.message}`)
    if (mode !== 'expect-trap') problems.push('the module trapped as a whole')
  } else if (e instanceof LabTimeoutError) {
    console.log(`TIMEOUT: ${e.message}`)
    if (mode !== 'expect-timeout') problems.push('the module timed out as a whole')
  } else if (e instanceof LabAbiError) {
    problems.push(`ABI error: ${e.message}`)
  } else {
    problems.push(`unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  }
} finally {
  disposeLabWorker()
}

if (problems.length > 0) {
  for (const p of problems) console.error(`FAIL: ${p}`)
  exitCode = 1
} else {
  console.log(`OK: ${mode}${freshRuns > 0 && mode === 'expect-pass' ? ` (+${freshRuns} fresh-seed runs)` : ''}`)
}
/* a spinning check's thread keeps bun alive after terminate(); exit explicitly */
process.exit(exitCode)
