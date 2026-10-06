/**
 * verify-labs — build every lab crate for wasm and check it through the same ABI client the site uses
 * (docs/specs/wave-1.md §12.7). Runs in the labs workflow, not the fast gate.
 *
 *   bun run verify:labs [--no-build] [--lab <id>]…
 *
 * For every crate in src/data/labs.ts:
 * - the template builds and instantiates with zero imports (W5);
 * - template v1: the whole run traps (`verify-wasm-lab … expect-trap`), as before;
 * - template v2 (exports `ks_abi_version`):
 *   - every required check traps on its own (`expect-trap`);
 *   - `list` names exactly the labs.ts checks, in order, with the same labels and, where labs.ts
 *     declares them, the same stages;
 *   - the `--features reference` build reports `<id>@reference` and earns nothing (`expect-reference`);
 *   - `calibration.json` matches the harness and shows the reference passing every seed and each
 *     mutant caught by a required check on ≥ 99 % of fresh seeds (§12.4).
 * Crates still on template v1 pass on the v1 rules until their C12 task migrates them.
 *
 * Zip freshness (C18): `python3 scripts/pack-labs.py` is re-run into a temp dir, and every public/labs/<zip> must hold
 * exactly the same members with the same bytes. A zip packed before a lab source, the guardrail kit or a check id
 * changed is stale; the zip is the learner's workspace, so it must match the sources the checks ran on. No member of a
 * zip may be under `_solutions` or `target`, or be a .wasm, .rlib or .rmeta.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { FORGE_LABS, type ForgeLab } from '../src/data/labs'
import { abiOf, instantiator, listChecks } from '../src/lib/forge/run'
import type { ListReply } from '../src/lib/forge/types'
import { readZip } from './verify-guardrails'

const ROOT = resolve(import.meta.dir, '..')
const LABS = join(ROOT, 'labs')
const RELEASE = join(LABS, 'target', 'wasm32-unknown-unknown', 'release')
const REFERENCE_TARGET = join(LABS, 'target', 'reference')
const REFERENCE_RELEASE = join(REFERENCE_TARGET, 'wasm32-unknown-unknown', 'release')
const MUTANT_FAIL_FLOOR = 0.99
/** Fewer fresh seeds than this cannot show a reference pass rate of 1 with any confidence. */
const MIN_SEEDS = 1000

const args = process.argv.slice(2)
const build = !args.includes('--no-build')
const only = args.flatMap((a, i) => (args[i - 1] === '--lab' ? [a] : []))
const labs = only.length > 0 ? FORGE_LABS.filter((l) => only.includes(l.id)) : FORGE_LABS
if (only.length > 0 && labs.length !== only.length) {
  console.error(`unknown lab id in --lab: ${only.filter((id) => !FORGE_LABS.some((l) => l.id === id)).join(', ')}`)
  process.exit(2)
}

const failures: string[] = []
const fail = (lab: string, msg: string) => failures.push(`${lab}: ${msg}`)

function sh(cmd: string[], cwd: string): { ok: boolean; out: string } {
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe', env: process.env })
  return { ok: r.exitCode === 0, out: `${r.stdout.toString()}${r.stderr.toString()}` }
}

const crateDir = (l: ForgeLab) => join(LABS, l.crateDir ?? l.id)
const manifest = (l: ForgeLab) => readFileSync(join(crateDir(l), 'Cargo.toml'), 'utf8')
const packageName = (l: ForgeLab) => /^name\s*=\s*"([^"]+)"/m.exec(manifest(l))?.[1] ?? l.id
const hasReferenceFeature = (l: ForgeLab) => /^\s*reference\s*=/m.test(manifest(l))

/** `bun scripts/verify-wasm-lab.ts <wasm> <mode>`, the site's own client in its own process. */
function verifyWasm(l: ForgeLab, wasm: string, mode: string): boolean {
  const r = sh([process.execPath, join(ROOT, 'scripts', 'verify-wasm-lab.ts'), wasm, mode], ROOT)
  if (!r.ok) fail(l.id, `${mode} failed:\n${r.out.trim().replace(/^/gm, '    ')}`)
  return r.ok
}

function checkList(l: ForgeLab, list: ListReply) {
  const want = l.checks.map((c) => c.id).join(',')
  const got = list.checks.map((c) => c.id).join(',')
  if (want !== got) fail(l.id, `list ids [${got}] differ from labs.ts [${want}]`)
  for (const c of l.checks) {
    const m = list.checks.find((x) => x.id === c.id)
    if (!m) continue
    if (m.label !== c.label) fail(l.id, `check ${c.id}: the module's label "${m.label}" differs from labs.ts "${c.label}"`)
    if (c.stage !== undefined && m.stage !== c.stage) fail(l.id, `check ${c.id}: stage ${m.stage} in the module, ${c.stage} in labs.ts`)
  }
  if (list.lab !== l.id) fail(l.id, `the template's lab id is "${list.lab}"`)
}

function checkCalibration(l: ForgeLab, list: ListReply) {
  const path = join(crateDir(l), 'calibration.json')
  if (!existsSync(path)) {
    fail(l.id, `no calibration.json (run scripts/calibrate-lab-seeds.ts ${l.id} <solution> --mutants <dir>)`)
    return
  }
  let cal: {
    lab?: string
    abi?: number
    harness?: string
    checks?: Record<string, { seeded?: boolean; n?: number; referencePassRate?: number; mutants?: Record<string, number> }>
  }
  try {
    cal = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail(l.id, 'calibration.json is not JSON')
    return
  }
  if (cal.lab !== l.id || cal.abi !== 2) fail(l.id, `calibration.json is for ${String(cal.lab)} abi ${String(cal.abi)}`)
  const harness = createHash('sha256').update(readFileSync(join(crateDir(l), 'src', 'lib.rs'))).digest('hex')
  if (cal.harness !== harness) fail(l.id, 'calibration.json was measured on a different src/lib.rs: recalibrate after changing the checks')
  const checks = cal.checks ?? {}
  const listed = list.checks.map((c) => c.id)
  const extra = Object.keys(checks).filter((id) => !listed.includes(id))
  if (extra.length > 0) fail(l.id, `calibration.json has checks the module does not list: ${extra.join(', ')}`)
  const required = new Set(l.checks.filter((c) => !c.optional).map((c) => c.id))
  const mutants = new Map<string, number>()
  for (const meta of list.checks) {
    const c = checks[meta.id]
    if (!c) {
      fail(l.id, `calibration.json has no entry for ${meta.id}`)
      continue
    }
    if (c.seeded !== meta.seeded) fail(l.id, `calibration.json says ${meta.id} is ${c.seeded ? '' : 'not '}seeded; the module disagrees`)
    if (meta.seeded && (c.n ?? 0) < MIN_SEEDS) fail(l.id, `${meta.id} was calibrated on ${c.n ?? 0} seeds (< ${MIN_SEEDS})`)
    if (c.referencePassRate !== 1) fail(l.id, `the reference passes ${meta.id} at ${String(c.referencePassRate)}, not 1`)
    for (const [name, rate] of Object.entries(c.mutants ?? {})) {
      if (required.has(meta.id)) mutants.set(name, Math.max(mutants.get(name) ?? 0, rate))
      else mutants.set(name, mutants.get(name) ?? 0)
    }
  }
  if (mutants.size === 0) fail(l.id, 'calibration.json lists no mutants')
  for (const [name, best] of mutants) {
    if (best < MUTANT_FAIL_FLOOR) fail(l.id, `mutant ${name} fails no required check on ≥ ${MUTANT_FAIL_FLOOR * 100} % of seeds (best ${best})`)
  }
}

const isPrivate = (name: string) => {
  const parts = name.split('/')
  return parts.includes('_solutions') || parts.includes('target') || /\.(wasm|rlib|rmeta)$/.test(name)
}

/** The committed zip against a fresh `pack-labs.py` run: same members in the same order, same bytes, nothing private. */
function checkZipFresh(l: ForgeLab, fresh: string) {
  const name = basename(l.zip)
  const committedPath = join(ROOT, 'public', 'labs', name)
  if (!existsSync(committedPath)) {
    fail(l.id, `public/labs/${name} is missing`)
    return
  }
  let committed: Map<string, Buffer>
  let packed: Map<string, Buffer>
  try {
    committed = readZip(committedPath)
    packed = readZip(join(fresh, name))
  } catch (e) {
    fail(l.id, `${name}: ${e instanceof Error ? e.message : String(e)}`)
    return
  }
  const leaked = [...committed.keys()].filter(isPrivate)
  if (leaked.length > 0) fail(l.id, `${name} ships private or build files: ${leaked.join(', ')}`)
  const drift = [
    ...[...packed.keys()].filter((n) => !committed.has(n)).map((n) => `missing ${n}`),
    ...[...committed.keys()].filter((n) => !packed.has(n)).map((n) => `unexpected ${n}`),
    ...[...packed.keys()].filter((n) => committed.has(n) && !committed.get(n)!.equals(packed.get(n)!)).map((n) => `changed ${n}`),
  ]
  if (drift.length === 0 && [...committed.keys()].join('\n') !== [...packed.keys()].join('\n')) drift.push('members are in a different order')
  if (drift.length > 0) fail(l.id, `public/labs/${name} is stale (${drift.join('; ')}): run python3 scripts/pack-labs.py and commit the zips`)
}

function checkZipsFresh() {
  const dir = mkdtempSync(join(tmpdir(), 'ks-labs-zips-'))
  try {
    const r = sh(['python3', join(ROOT, 'scripts', 'pack-labs.py'), '--out', dir], ROOT)
    if (!r.ok) {
      failures.push(`pack-labs.py failed, so zip freshness is unchecked:\n${r.out.trim().replace(/^/gm, '    ')}`)
      return
    }
    for (const l of labs) checkZipFresh(l, dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const t0 = performance.now()
checkZipsFresh()
const zipFailures = failures.length
if (build) {
  console.log('building every lab template (wasm32-unknown-unknown, release)…')
  const r = sh(['cargo', 'build', '--release', '--target', 'wasm32-unknown-unknown', '--workspace', '--quiet'], LABS)
  if (!r.ok) {
    console.error(r.out)
    console.error('FAIL: the lab workspace does not build')
    process.exit(1)
  }
}

const rows: string[] = []
for (const l of labs) {
  const before = failures.length
  const wasm = join(RELEASE, basename(l.artifact))
  if (!existsSync(wasm)) {
    fail(l.id, `${wasm.replace(`${ROOT}/`, '')} was not built`)
    rows.push(`  ✗ ${l.id}`)
    continue
  }
  const module = await WebAssembly.compile(readFileSync(wasm))
  const imports = WebAssembly.Module.imports(module)
  if (imports.length > 0) fail(l.id, `imports ${imports.map((i) => `${i.module}.${i.name}`).join(', ')}; a lab must instantiate with {}`)
  const abi = imports.length > 0 ? 0 : abiOf(instantiator(module)())

  if (abi === 1) {
    if (hasReferenceFeature(l)) fail(l.id, 'has a `reference` feature but still exports the v1 ABI')
    verifyWasm(l, wasm, 'expect-trap')
  } else if (abi === 2) {
    verifyWasm(l, wasm, 'expect-trap')
    let list: ListReply | null = null
    try {
      list = listChecks(instantiator(module))
    } catch (e) {
      fail(l.id, `list: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (list) {
      checkList(l, list)
      checkCalibration(l, list)
    }
    if (!hasReferenceFeature(l)) fail(l.id, 'template v2 crates need a `reference` feature (Cargo.toml [features])')
    else {
      const r = sh(
        ['cargo', 'build', '--release', '--target', 'wasm32-unknown-unknown', '--quiet', '-p', packageName(l), '--features', 'reference', '--target-dir', REFERENCE_TARGET],
        LABS,
      )
      if (!r.ok) fail(l.id, `the --features reference build failed:\n${r.out}`)
      else verifyWasm(l, join(REFERENCE_RELEASE, basename(l.artifact)), 'expect-reference')
    }
  } else if (imports.length === 0) {
    fail(l.id, `reports ABI ${abi}; this host speaks 1 and 2`)
  }
  rows.push(`  ${failures.length === before ? '✓' : '✗'} ${l.id.padEnd(22)} template v${abi === 2 ? 2 : 1}${abi === 2 ? ' (per check, calibrated, reference refused)' : ''}`)
}

console.log(rows.join('\n'))
console.log(`${labs.length} lab(s), ${Math.round((performance.now() - t0) / 1000)} s. Zips: ${zipFailures === 0 ? 'all match a fresh pack-labs run' : `${zipFailures} problem(s)`}.`)
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL: ${f}`)
  process.exit(1)
}
console.log('OK: every lab template checks out')
process.exit(0)
