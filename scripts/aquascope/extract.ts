/**
 * extract — permission traces from a local Aquascope run (docs/specs/wave-2.md §17.1, D18).
 *
 * For every lesson code block with `permissions: {trace}`, runs `cargo aquascope permissions` on the
 * block's Rust at Aquascope's pinned nightly and writes `src/data/aquascope/<lessonId>.json`: per line,
 * each path's R/W/O before and after, and each use with the permissions it needs and has, plus the
 * code's sha256 (format: src/data/aquascope/types.ts). CI never runs this: Aquascope is research
 * software pinned to a nightly, so the traces are committed and tests/lesson/permission.test.ts fails
 * when a block's code no longer matches its trace's hash.
 *
 * One-time setup (Aquascope's README, at the pinned commit):
 *   rustup toolchain install nightly-2026-05-01 -c rust-src -c rustc-dev -c llvm-tools-preview -c miri
 *   cargo +nightly-2026-05-01 install aquascope_front --locked \
 *     --git https://github.com/cognitive-engineering-lab/aquascope --rev f2d0a06034b86765a91f10b7c8e40ec31ecb87a6
 *
 * Usage:
 *   bun scripts/aquascope/extract.ts                 every traced lesson block
 *   bun scripts/aquascope/extract.ts --lesson r.l4   one lesson (repeatable)
 *   bun scripts/aquascope/extract.ts --sample        re-extract sample.json from the code it carries
 *   bun scripts/aquascope/extract.ts --errors        the Error Museum's traces (errors.json), one per bank error code
 *   bun scripts/aquascope/extract.ts --check         extract, compare with the committed files, write nothing
 *
 * A snippet without `fn main` is wrapped in one for the run, and line numbers are mapped back. A borrow
 * error still yields a body (the point of most of these diagrams: its boundary shows the missing
 * permission, and Aquascope stops stepping at the error); a snippet whose body is tainted earlier is
 * re-run with `--should-fail`. Exit 0 on success, 1 on a difference under --check or an extraction
 * failure, 2 when the toolchain or Aquascope is missing.
 *
 * The spike (2c-05, 2026-10-05): Aquascope at that commit builds on nightly-2026-05-01 (rustc 1.97.0-nightly
 * f53b654a8) in about 90 s and src/data/aquascope/sample.json is its output, so lessons extract rather than
 * fall back. On NixOS the driver also needs zlib: LD_LIBRARY_PATH=$NIX_LD_LIBRARY_PATH bun scripts/aquascope/extract.ts.
 *
 * Q9 fallback: if the pinned toolchain will not build Aquascope, author traces by hand in the same
 * format with `source: 'hand'` (the diagram then says "drawn after Aquascope's model") for owner review.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ALL_LESSONS } from '../../src/data/lessons'
import {
  AQUASCOPE_COMMIT,
  AQUASCOPE_TOOLCHAIN,
  codeLines,
  traceShapeProblems,
  type PermissionChange,
  type PermissionTrace,
  type PermissionTraceFile,
  type PermissionUse,
  type Perms,
} from '../../src/data/aquascope/types'

const ROOT = path.resolve(import.meta.dir, '../..')
const OUT_DIR = path.join(ROOT, 'src/data/aquascope')
const SAMPLE = path.join(OUT_DIR, 'sample.json')
const ERRORS = path.join(OUT_DIR, 'errors.json')
const TIMEOUT_MS = 120_000

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

/* ------------------------------ Aquascope's output (crates/aquascope/src/analysis) ------------------------------ */

interface CharPos {
  line: number
  column: number
}
interface CharRange {
  start: CharPos
  end: CharPos
}
/** `ValueStep<bool>`: High = became true, Low = became false, None = unchanged (value when known). */
type ValueStep = { type: 'High'; value: boolean } | { type: 'Low' } | { type: 'None'; value?: boolean }
interface PermsDiff {
  read: ValueStep
  write: ValueStep
  drop: ValueStep
}
interface StepTable {
  from: CharRange
  to: CharRange
  state: [string, { permissions: PermsDiff }][]
}
interface LineDisplay {
  location: CharRange
  state: StepTable[]
}
interface RawPerms {
  read: boolean
  write: boolean
  drop: boolean
}
interface Boundary {
  location: CharPos
  expected: RawPerms
  actual: RawPerms
}
interface AnalysisOutput {
  boundaries: Boundary[]
  steps: LineDisplay[]
}
type BodyResult = { Ok: AnalysisOutput } | { Err: { type: string; msg?: string } }

/* ------------------------------ conversion (pure) ------------------------------ */

const permsOf = (r: boolean, w: boolean, o: boolean): Perms => `${r ? 'R' : ''}${w ? 'W' : ''}${o ? 'O' : ''}`
const rawPerms = (p: RawPerms): Perms => permsOf(p.read, p.write, p.drop)

/** Before and after of one ValueStep. */
function sides(s: ValueStep): [boolean, boolean] {
  if (s.type === 'High') return [false, true]
  if (s.type === 'Low') return [true, false]
  return [s.value ?? false, s.value ?? false]
}

/**
 * The place at a boundary. Aquascope reports a position, not a path: the start of an operand (`&v`,
 * `*z`), or for a method call the `.` after its receiver (`v.push` reports the dot). So read the place
 * that starts there, or else the one that ends there.
 */
export function pathAt(line: string, col: number): string {
  const ahead = /^(?:&(?:mut\s+)?)?\(?(\**)([A-Za-z_]\w*)/.exec(line.slice(col))
  if (ahead) return `${ahead[1]}${ahead[2]}`
  const behind = /(?:\((\*+)([A-Za-z_]\w*)\)|(\**)([A-Za-z_]\w*))$/.exec(line.slice(0, col))
  if (behind) return behind[2] ? `${behind[1]}${behind[2]}` : `${behind[3]}${behind[4]}`
  return `@${col}`
}

/** Plain code-unit order, the same on every machine (not `localeCompare`). */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * A path split for reading order: its base name, how many `*` dereference it, and the field or index
 * path after the base (`(*self).x` is `self`, depth 1, `.x`; `*r` is `r`, depth 1, ``). A path with no
 * name in it (`@12`) is its own base.
 */
export function pathParts(p: string): { base: string; depth: number; rest: string } {
  const m = /^([*(&\s]*)([A-Za-z_]\w*)(.*)$/.exec(p)
  if (!m) return { base: p, depth: 0, rest: '' }
  return { base: m[2], depth: (m[1].match(/\*/g) ?? []).length, rest: m[3].replace(/^\)/, '') }
}

/** Natural row order: by base name, then dereference depth, then field, so `r` comes before `*r` and `self` before `(*self).x`. */
export function pathOrder(a: string, b: string): number {
  const x = pathParts(a)
  const y = pathParts(b)
  return cmp(x.base, y.base) || x.depth - y.depth || cmp(x.rest, y.rest) || cmp(a, b)
}

/** Prepares a snippet for cargo: wrapped in `fn main` when it has none. `offset` lines precede the snippet. */
export function prepare(code: string): { source: string; offset: number } {
  if (/^\s*(pub\s+)?fn\s+main\s*\(/m.test(code)) return { source: `${code.replace(/\n$/, '')}\n`, offset: 0 }
  return { source: `fn main() {\n${code.replace(/\n$/, '')}\n}\n`, offset: 1 }
}

/**
 * A trace from Aquascope's `permissions` output for one file. Every body's steps and boundaries are
 * mapped to the snippet's 1-based lines; anything on a wrapper line is dropped. Several step tables
 * on one line for one path compose (the first before, the last after).
 */
export function toTrace(results: BodyResult[], code: string, offset: number): PermissionTrace {
  const lines = codeLines(code)
  const src = code.replace(/\n$/, '').split('\n')
  const inRange = (n: number) => n >= 1 && n <= lines
  const byKey = new Map<string, PermissionChange>()
  const uses: PermissionUse[] = []
  for (const r of results) {
    if (!('Ok' in r)) continue
    for (const display of r.Ok.steps) {
      const line = display.location.start.line + 1 - offset
      if (!inRange(line)) continue
      for (const table of display.state) {
        for (const [p, diff] of table.state) {
          const [r0, r1] = sides(diff.permissions.read)
          const [w0, w1] = sides(diff.permissions.write)
          const [o0, o1] = sides(diff.permissions.drop)
          const key = `${line}\u0000${p}`
          const prev = byKey.get(key)
          byKey.set(key, { line, path: p, before: prev ? prev.before : permsOf(r0, w0, o0), after: permsOf(r1, w1, o1) })
        }
      }
    }
    for (const b of r.Ok.boundaries) {
      const line = b.location.line + 1 - offset
      if (!inRange(line)) continue
      uses.push({ line, col: b.location.column, path: pathAt(src[line - 1] ?? '', b.location.column), needs: rawPerms(b.expected), has: rawPerms(b.actual) })
    }
  }
  // Aquascope lists the paths of one line in a run-dependent order, so ties are broken on every field, paths in reading order (pathOrder)
  const changes = [...byKey.values()].filter((c) => c.before !== c.after).sort((a, b) => a.line - b.line || pathOrder(a.path, b.path) || cmp(a.before, b.before) || cmp(a.after, b.after))
  uses.sort((a, b) => a.line - b.line || a.col - b.col || pathOrder(a.path, b.path) || cmp(a.needs, b.needs) || cmp(a.has, b.has))
  const order: string[] = []
  for (const x of [...changes, ...uses].sort((a, b) => a.line - b.line)) if (!order.includes(x.path)) order.push(x.path)
  return {
    sha256: sha256(code),
    source: 'aquascope',
    tool: { aquascope: AQUASCOPE_COMMIT, toolchain: AQUASCOPE_TOOLCHAIN },
    lines,
    paths: order,
    changes,
    uses: uses.filter((u) => u.needs !== ''),
  }
}

/** JSON with one line per change and per use, so a re-extraction diffs line by line. */
export function formatTraceFile(file: PermissionTraceFile): string {
  const rows = (xs: object[]) => (xs.length === 0 ? '[]' : `[\n${xs.map((x) => `        ${JSON.stringify(x)}`).join(',\n')}\n      ]`)
  const traces = Object.keys(file.traces)
    .sort()
    .map((key) => {
      const t = file.traces[key]
      const head = Object.entries(t)
        .filter(([k]) => k !== 'changes' && k !== 'uses' && k !== 'code')
        .map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      const body = [`      "changes": ${rows(t.changes)}`, `      "uses": ${rows(t.uses)}`]
      const code = t.code === undefined ? [] : [`      "code": ${JSON.stringify(t.code)}`]
      return `    ${JSON.stringify(key)}: {\n${[...head, ...body, ...code].join(',\n')}\n    }`
    })
  return `{\n  "v": 1,\n  "traces": {\n${traces.join(',\n')}\n  }\n}\n`
}

/* ------------------------------ running Aquascope ------------------------------ */

class SetupError extends Error {}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  return spawnSync(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, encoding: 'utf8', timeout: TIMEOUT_MS })
}

/** The pinned toolchain's sysroot, and proof that `cargo aquascope` runs on it. */
function toolchain(): { env: Record<string, string> } {
  const sysroot = run('rustc', [`+${AQUASCOPE_TOOLCHAIN}`, '--print', 'sysroot'])
  if (sysroot.status !== 0) {
    throw new SetupError(`rustc +${AQUASCOPE_TOOLCHAIN} is not installed: rustup toolchain install ${AQUASCOPE_TOOLCHAIN} -c rust-src -c rustc-dev -c llvm-tools-preview -c miri`)
  }
  // The driver links librustc_driver from the toolchain's lib. Keep any library path already set: on
  // NixOS the driver also needs zlib from $NIX_LD_LIBRARY_PATH (LD_LIBRARY_PATH=$NIX_LD_LIBRARY_PATH bun …).
  const lib = path.join(sysroot.stdout.trim(), 'lib')
  const withLib = (v: string | undefined) => (v ? `${lib}${path.delimiter}${v}` : lib)
  const env = {
    RUSTUP_TOOLCHAIN: AQUASCOPE_TOOLCHAIN,
    LD_LIBRARY_PATH: withLib(process.env.LD_LIBRARY_PATH),
    DYLD_LIBRARY_PATH: withLib(process.env.DYLD_LIBRARY_PATH),
  }
  // `cargo aquascope` reads cargo metadata before anything else, so even --version runs inside a crate.
  const probe = inCrate(env, 'fn main() {}\n', (crate) => run('cargo', ['aquascope', '--version'], { cwd: crate, env }))
  if (probe.status !== 0) {
    throw new SetupError(
      `cargo aquascope is not installed for ${AQUASCOPE_TOOLCHAIN}: cargo +${AQUASCOPE_TOOLCHAIN} install aquascope_front --locked ` +
        `--git https://github.com/cognitive-engineering-lab/aquascope --rev ${AQUASCOPE_COMMIT}\n${(probe.stderr ?? '').trim().slice(-600)}`,
    )
  }
  return { env }
}

function parseResults(stdout: string): BodyResult[] | null {
  const lastLine = stdout.trim().split('\n').at(-1) ?? ''
  try {
    const parsed: unknown = JSON.parse(lastLine)
    return Array.isArray(parsed) ? (parsed as BodyResult[]) : null
  } catch {
    return null
  }
}

/** Runs `f` in a throwaway binary crate whose main.rs is `source`, then removes the crate. */
function inCrate<T>(env: Record<string, string>, source: string, f: (crate: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'ks-aquascope-'))
  try {
    const made = run('cargo', ['new', '--bin', '--vcs', 'none', '--name', 'snippet', 'snippet'], { cwd: dir, env })
    if (made.status !== 0) throw new SetupError(`cargo +${AQUASCOPE_TOOLCHAIN} new failed: ${made.stderr}`)
    const crate = path.join(dir, 'snippet')
    writeFileSync(path.join(crate, 'src/main.rs'), source)
    return f(crate)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Runs Aquascope on one snippet; retries with --should-fail when the compiler rejects it. */
function extractOne(code: string, env: Record<string, string>): PermissionTrace {
  const { source, offset } = prepare(code)
  return inCrate(env, source, (crate) => {
    for (const shouldFail of [false, true]) {
      const args = ['aquascope', ...(shouldFail ? ['--should-fail'] : []), 'permissions']
      const out = run('cargo', args, { cwd: crate, env })
      const results = out.status === 0 ? parseResults(out.stdout) : null
      if (!results) {
        if (shouldFail) throw new Error(`aquascope failed (exit ${out.status}): ${out.stderr.slice(-2000)}`)
        continue
      }
      const built = results.some((r) => 'Ok' in r)
      if (!built) {
        if (shouldFail) throw new Error(`aquascope analysed no body: ${JSON.stringify(results).slice(0, 500)}`)
        continue
      }
      return toTrace(results, code, offset)
    }
    throw new Error('unreachable')
  })
}

/* ------------------------------ targets ------------------------------ */

interface Target {
  file: string
  label: string
  blocks: { key: string; code: string }[]
  /** sample.json and errors.json keep each trace's code (they have no lesson block). */
  keepCode: boolean
  /** errors.json: a hand-drawn trace whose hash still matches is kept when Aquascope cannot analyse its code. */
  keepHand?: boolean
}

function lessonTargets(only: string[]): Target[] {
  const out: Target[] = []
  for (const lesson of ALL_LESSONS) {
    if (only.length > 0 && !only.includes(lesson.id)) continue
    const blocks: Target['blocks'] = []
    for (const b of lesson.blocks) {
      if (b.type !== 'code' || !b.permissions) continue
      if (b.code === undefined) throw new Error(`${lesson.id}: a traced code block needs \`code\` (Rust), not tabs`)
      blocks.push({ key: b.permissions.trace, code: b.code })
    }
    if (blocks.length > 0) out.push({ file: path.join(OUT_DIR, `${lesson.id}.json`), label: lesson.id, blocks, keepCode: false })
  }
  for (const id of only) if (!ALL_LESSONS.some((l) => l.id === id)) throw new Error(`no lesson ${id}`)
  return out
}

/** The committed hand-drawn trace for a block, when its hash still matches the block's code. */
function handTrace(file: string, b: { key: string; code: string }): PermissionTrace | undefined {
  if (!existsSync(file)) return undefined
  const t = (JSON.parse(readFileSync(file, 'utf8')) as PermissionTraceFile).traces[b.key]
  return t && t.source === 'hand' && t.sha256 === sha256(b.code) ? t : undefined
}

function sampleTarget(): Target {
  const file = JSON.parse(readFileSync(SAMPLE, 'utf8')) as PermissionTraceFile
  const blocks = Object.entries(file.traces).map(([key, t]) => {
    if (t.code === undefined) throw new Error(`sample.json/${key} carries no code to extract from`)
    return { key, code: t.code }
  })
  return { file: SAMPLE, label: 'sample', blocks, keepCode: true }
}

/**
 * The Error Museum (§15.6, 2c-18): one block per error code, the code variant src/lib/rust/museum.ts
 * shows for it. The snippets live in the compile bank, so each trace keeps its code, as sample.json does.
 * Aquascope analyses a body that reaches borrow checking; a code rustc reports earlier (E0106, a missing
 * lifetime, stops before MIR) or at run time (BorrowMutError) has no body to analyse, so its trace is
 * drawn by hand in the same format (`source: 'hand'`, Q9) and kept here while its hash still matches.
 */
async function errorsTarget(): Promise<Target> {
  const { bankUnits, loadRustGroups } = await import('../../src/data/rust-items')
  const { museumEntries } = await import('../../src/lib/rust/museum')
  const blocks = museumEntries(bankUnits(await loadRustGroups()).units).map((e) => ({ key: e.code, code: e.source }))
  return { file: ERRORS, label: 'errors', blocks, keepCode: true, keepHand: true }
}

async function main(argv: string[]): Promise<number> {
  const only: string[] = []
  let sample = false
  let errors = false
  let check = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--lesson') only.push(argv[++i] ?? '')
    else if (a === '--sample') sample = true
    else if (a === '--errors') errors = true
    else if (a === '--check') check = true
    else {
      console.error(`extract: unknown argument ${a}`)
      return 2
    }
  }
  let env: Record<string, string>
  try {
    env = toolchain().env
  } catch (e) {
    if (e instanceof SetupError) {
      console.error(`extract: ${e.message}`)
      return 2
    }
    throw e
  }
  const targets = sample ? [sampleTarget()] : errors ? [await errorsTarget()] : lessonTargets(only)
  if (targets.length === 0) console.log('extract: no traced code blocks')
  let failed = 0
  for (const t of targets) {
    const before = failed
    const file: PermissionTraceFile = { v: 1, traces: {} }
    for (const b of t.blocks) {
      try {
        const trace = extractOne(b.code, env)
        file.traces[b.key] = t.keepCode ? { ...trace, code: b.code } : trace
        const problems = traceShapeProblems(`${t.label}/${b.key}`, file.traces[b.key])
        for (const p of problems) console.error(`extract: ${p}`)
        failed += problems.length
        console.log(`extract: ${t.label}/${b.key}: ${trace.changes.length} changes, ${trace.uses.length} uses`)
      } catch (e) {
        const kept = t.keepHand ? handTrace(t.file, b) : undefined
        if (kept) {
          file.traces[b.key] = kept
          console.log(`extract: ${t.label}/${b.key}: kept the hand-drawn trace (${(e as Error).message.split('\n')[0].slice(0, 120)})`)
          continue
        }
        console.error(`extract: ${t.label}/${b.key}: ${(e as Error).message}`)
        failed++
      }
    }
    const text = formatTraceFile(file)
    const rel = path.relative(ROOT, t.file)
    if (check) {
      const committed = existsSync(t.file) ? readFileSync(t.file, 'utf8') : ''
      if (committed !== text) {
        console.error(`extract: ${rel} differs from a fresh extraction`)
        failed++
      }
    } else if (failed === before) {
      writeFileSync(t.file, text)
      console.log(`extract: wrote ${rel}`)
    }
  }
  return failed === 0 ? 0 : 1
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
