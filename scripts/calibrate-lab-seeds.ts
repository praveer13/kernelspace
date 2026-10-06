/**
 * calibrate-lab-seeds — measure a template-v2 lab's checks on fresh seeds against the private
 * reference solution and its mutants, and write labs/<crate>/calibration.json (docs/specs/wave-1.md §12.4).
 *
 *   bun scripts/calibrate-lab-seeds.ts <lab> <solution.wasm|solution.rs> [--mutants <dir>] [--n 10000] [--mutant-n 1000] [--dry-run]
 *
 * - <lab> is a src/data/labs.ts id (rust-allocator, rust-zero-r1, …).
 * - A `.rs` solution or mutant replaces the crate's TODO file in a scratch copy of the crate, which is
 *   built for wasm (the solution with `--features reference` when the crate has it). A `.wasm` is used as is.
 * - Reference solutions live only in labs/_solutions/ (gitignored, never committed or packed);
 *   only the calibration file is committed.
 * - Every seeded check runs the reference on its default seed and on n fresh seeds, and must pass
 *   all of them. Each mutant runs every check on its default seed and on `--mutant-n` fresh seeds,
 *   and must fail at least one required check on the default seed and on ≥ 99 % of fresh seeds.
 * - In-process (no worker, no timeout): run trusted code only. A mutant that spins hangs the script.
 * Exit 1 when the reference misses a seed or a mutant escapes; the file is still written for review.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { FORGE_LABS, type ForgeLab } from '../src/data/labs'
import { abiOf, freshSeed, instantiator, listChecks, runCheck, type Instantiate } from '../src/lib/forge/run'
import type { ListReply } from '../src/lib/forge/types'
import { instantiateLab } from '../src/lib/wasm-lab'

const ROOT = resolve(import.meta.dir, '..')
const LABS = join(ROOT, 'labs')
const USAGE = 'usage: bun scripts/calibrate-lab-seeds.ts <lab> <solution.wasm|solution.rs> [--mutants <dir>] [--n 10000] [--mutant-n 1000] [--dry-run]'

/** A mutant must fail some required check on at least this share of fresh seeds. */
const MUTANT_FAIL_FLOOR = 0.99

function die(msg: string): never {
  console.error(`${msg}\n${USAGE}`)
  process.exit(2)
}

const args = process.argv.slice(2)
const labId = args.shift()
const solutionPath = args.shift()
if (!labId || !solutionPath) die('missing <lab> or <solution>')
let mutantsDir: string | undefined
let n = 10_000
let mutantN = 1_000
let dryRun = false
while (args.length > 0) {
  const a = args.shift()
  if (a === '--mutants') mutantsDir = args.shift()
  else if (a === '--n') n = Number(args.shift())
  else if (a === '--mutant-n') mutantN = Number(args.shift())
  else if (a === '--dry-run') dryRun = true
  else die(`unknown argument ${a}`)
}
if (!Number.isInteger(n) || n < 1 || !Number.isInteger(mutantN) || mutantN < 1) die('--n and --mutant-n take positive integers')

const lab = FORGE_LABS.find((l) => l.id === labId) ?? die(`no lab "${labId}" in src/data/labs.ts`)
const crateDir = join(LABS, lab.crateDir ?? lab.id)
const required = lab.checks.filter((c) => !c.optional).map((c) => c.id)

/* ------------------------------- building -------------------------------- */

const buildTarget = join(LABS, 'target', 'calibrate')

/** Build the crate with `source` as its TODO file, in a scratch copy, and return the wasm bytes. */
function buildWith(l: ForgeLab, source: string, reference: boolean): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), `kslab-calibrate-${l.id}-`))
  try {
    cpSync(join(LABS, l.crateDir ?? l.id), dir, {
      recursive: true,
      filter: (p) => !p.includes('/target') && basename(p) !== 'calibration.json',
    })
    cpSync(source, join(dir, l.editFile))
    const manifest = readFileSync(join(dir, 'Cargo.toml'), 'utf8')
      .replace(/path\s*=\s*"([^"]+)"/g, (_, p: string) => `path = ${JSON.stringify(resolve(crateDir, p))}`)
    const hasReference = /^\s*reference\s*=/m.test(manifest)
    writeFileSync(join(dir, 'Cargo.toml'), `${manifest}\n[workspace]\n`)
    const cmd = ['cargo', 'build', '--release', '--target', 'wasm32-unknown-unknown', '--quiet']
    if (reference && hasReference) cmd.push('--features', 'reference')
    const r = Bun.spawnSync(cmd, { cwd: dir, env: { ...process.env, CARGO_TARGET_DIR: buildTarget }, stderr: 'pipe', stdout: 'pipe' })
    if (r.exitCode !== 0) {
      console.error(r.stderr.toString())
      throw new Error(`cargo build failed for ${source}`)
    }
    return new Uint8Array(readFileSync(join(buildTarget, 'wasm32-unknown-unknown', 'release', basename(l.artifact))))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function load(path: string, reference: boolean): Uint8Array {
  if (path.endsWith('.wasm')) return new Uint8Array(readFileSync(path))
  if (path.endsWith('.rs')) return buildWith(lab, path, reference)
  return die(`${path} is neither .wasm nor .rs`)
}

/* ------------------------------- measuring ------------------------------- */

interface Module {
  make: Instantiate
  list: ListReply
  module: WebAssembly.Module
}

async function open(bytes: Uint8Array, what: string): Promise<Module> {
  const module = await WebAssembly.compile(bytes)
  if (WebAssembly.Module.imports(module).length > 0) throw new Error(`${what} has wasm imports`)
  const make = instantiator(module)
  const abi = abiOf(make())
  if (abi !== 2) throw new Error(`${what} speaks ABI ${abi}; calibration is for template v2`)
  return { make, list: listChecks(make), module }
}

/** Status of one check on one seed (undefined = the check's default seed). */
const status = (m: Module, id: string, seed?: number) => {
  const meta = m.list.checks.find((c) => c.id === id)
  if (!meta) throw new Error(`check ${id} is not listed`)
  return runCheck(m.make, m.list.lab, meta, seed)
}

const t0 = performance.now()
console.log(`calibrating ${lab.id} (${crateDir.replace(`${ROOT}/`, '')}), n=${n}, mutant n=${mutantN}`)
const ref = await open(load(solutionPath, true), 'the solution')
const ids = ref.list.checks.map((c) => c.id)
const missing = required.filter((id) => !ids.includes(id))
if (missing.length > 0) die(`the module does not list required check(s) ${missing.join(', ')}`)

interface CheckCalibration {
  seeded: boolean
  n: number
  referencePassRate: number
  mutants: Record<string, number>
  /** A failing reference seed, for the record. */
  referenceMiss?: { seed?: number; msg: string }
}
const checks: Record<string, CheckCalibration> = {}
const problems: string[] = []

for (const meta of ref.list.checks) {
  const runs = meta.seeded ? n + 1 : 1
  let passed = 0
  let miss: CheckCalibration['referenceMiss']
  for (let i = 0; i < runs; i++) {
    const seed = i === 0 ? undefined : freshSeed()
    const r = status(ref, meta.id, seed)
    if (r.status === 'pass') passed++
    else miss ??= { seed: r.seed ?? seed, msg: r.msg }
  }
  checks[meta.id] = { seeded: meta.seeded, n: runs, referencePassRate: passed / runs, mutants: {}, ...(miss ? { referenceMiss: miss } : {}) }
  console.log(`  reference ${meta.id.padEnd(16)} ${passed}/${runs}${meta.seeded ? ' (default seed + fresh)' : ' (unseeded)'}`)
  if (passed !== runs) problems.push(`the reference fails ${meta.id} on ${runs - passed} of ${runs} seeds, e.g. ${JSON.stringify(miss)}`)
}

/* `probe <seed>` on ks_invoke (systems labs): one deterministic line per seed */
let probe: { seed: number; reply: string } | undefined
if (typeof ref.make().ks_invoke === 'function') {
  const ask = async () => (await instantiateLab(ref.module)).invoke('probe 7').trim()
  const [a, b] = [await ask(), await ask()]
  if (a !== b) problems.push(`probe 7 is not deterministic: "${a}" then "${b}"`)
  if (a.startsWith('err')) problems.push(`probe 7 answered "${a}"`)
  probe = { seed: 7, reply: a }
  console.log(`  probe 7 → ${a}`)
}

const mutantSummary: Record<string, { defaultSeedFails: string[]; caughtBy: string[] }> = {}
if (mutantsDir) {
  const files = readdirSync(mutantsDir).filter((f) => f.endsWith('.rs') || f.endsWith('.wasm')).sort()
  if (files.length === 0) die(`no .rs or .wasm mutants in ${mutantsDir}`)
  for (const file of files) {
    const name = file.replace(/\.(rs|wasm)$/, '')
    const m = await open(load(join(mutantsDir, file), false), `mutant ${name}`)
    const defaultFails: string[] = []
    const caughtBy: string[] = []
    for (const meta of m.list.checks) {
      const runs = meta.seeded ? mutantN : 1
      if (status(m, meta.id).status !== 'pass') defaultFails.push(meta.id)
      let failed = 0
      for (let i = 0; i < runs; i++) if (status(m, meta.id, meta.seeded ? freshSeed() : undefined).status !== 'pass') failed++
      const rate = failed / runs
      checks[meta.id].mutants[name] = rate
      if (required.includes(meta.id) && rate >= MUTANT_FAIL_FLOOR) caughtBy.push(meta.id)
    }
    mutantSummary[name] = { defaultSeedFails: defaultFails.filter((id) => required.includes(id)), caughtBy }
    console.log(`  mutant ${name.padEnd(12)} default-seed fails: ${defaultFails.join(', ') || 'none'} · caught (≥ ${MUTANT_FAIL_FLOOR * 100} % of fresh seeds) by: ${caughtBy.join(', ') || 'NOTHING'}`)
    if (mutantSummary[name].defaultSeedFails.length === 0) problems.push(`mutant ${name} passes every required check on default seeds`)
    if (caughtBy.length === 0) problems.push(`mutant ${name} is not caught by any required check on ≥ ${MUTANT_FAIL_FLOOR * 100} % of fresh seeds`)
  }
}

const git = (cmd: string[]) => Bun.spawnSync(['git', ...cmd], { cwd: ROOT }).stdout.toString().trim()
const harnessPath = join(crateDir, 'src', 'lib.rs')
const calibration = {
  lab: lab.id,
  abi: 2,
  version: ref.list.version,
  commit: git(['rev-parse', '--short', 'HEAD']),
  date: new Date().toISOString().slice(0, 10),
  /** sha256 of the crate's src/lib.rs (the harness): verify:labs refuses a calibration of other checks. */
  harness: createHash('sha256').update(readFileSync(harnessPath)).digest('hex'),
  seeds: 'crypto.getRandomValues per run (fresh), plus each check\'s default seed',
  mutantN,
  checks,
  mutants: mutantSummary,
  ...(probe ? { probe } : {}),
}

const out = join(crateDir, 'calibration.json')
if (dryRun) console.log(JSON.stringify(calibration, null, 2))
else {
  writeFileSync(out, `${JSON.stringify(calibration, null, 2)}\n`)
  console.log(`wrote ${out.replace(`${ROOT}/`, '')}${existsSync(out) ? '' : ' (missing?)'}`)
}
console.log(`${Math.round((performance.now() - t0) / 1000)} s`)
for (const p of problems) console.error(`FAIL: ${p}`)
process.exit(problems.length > 0 ? 1 : 0)
