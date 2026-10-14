/**
 * build-rust-items — compiles the compile bank with the pinned rustc (docs/specs/wave-2.md §15.2).
 *
 * For every snippet of every group in src/data/rust-items, each code variant and the code after each
 * of its fixes is written into a temporary crate and checked by rustc 1.96.0, edition 2024, with
 * `--error-format=json` (`--emit=metadata` for a library snippet; a `run` snippet is built as a binary
 * and run, so a RefCell borrow panic is an outcome too). The first error's code, primary line and
 * message are recorded. The script fails on any mismatch with an authored outcome: a variant whose
 * error or line differs, an `ok` fix that does not compile, or a wrong fix that compiles without being
 * a labelled lure. It then writes `bank/<group>.json` (results, the rustc version and each snippet's
 * source hash), which verify-rust-items checks in the fast gate without rustc.
 *
 * The banks stay with the scripts and tests. From them it writes what the app loads instead
 * (docs/specs/wave-2.md §22.1: the bank data is a reported budget, and hashes and messages are no use to a
 * learner): `manifest.json`, the units the compile family draws from, with each variant's outcome code and
 * item kinds; `served/<group>.ts`, one chunk per group with its snippets and what rustc did after each fix;
 * and `museum.json`, the Error Museum's exhibits. verify-rust-items fails when any of them is stale.
 *
 *   bun scripts/build-rust-items.ts [--check] [--group a,b] [--force] [--jobs N]
 *   bun scripts/build-rust-items.ts --derived
 *
 * `--check` (the labs workflow) recompiles everything and fails unless each bank file is exactly what
 * it would write. Without it, a snippet whose hash and compiler are unchanged keeps its recorded
 * results unless `--force`. `--derived` runs no compiler: it rewrites the manifest, the served groups and
 * the museum from the committed banks. `RUSTC` overrides the compiler binary (default `rustc` on PATH); it
 * must report version 1.96.0.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bankUnits, loadRustGroups, variantCode } from '../src/data/rust-items'
import type { BankFile, BankOutcome, BankSnippet, ManifestVariant, Outcome, RustGroup, RustManifest, RustSnippet } from '../src/data/rust-items/types'
import { museumEntries } from '../src/lib/rust/museum'
import { checkSnippets, compareSnippet, EDITION, fixCode, RUSTC_VERSION, snippetHash } from './verify-rust-items'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ITEMS_DIR = path.join(ROOT, 'src/data/rust-items')
const BANK_DIR = path.join(ITEMS_DIR, 'bank')
const RUSTC = process.env.RUSTC || 'rustc'
/** rustc on one snippet takes well under a second; a run snippet's binary must finish in this. */
const COMPILE_TIMEOUT_MS = 60_000
const RUN_TIMEOUT_MS = 10_000

/* ------------------------------ rustc ------------------------------ */

interface Proc {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

function exec(file: string, args: string[], timeout: number, cwd?: string): Promise<Proc> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 16 * 1024 * 1024, cwd, env: { ...process.env, RUST_BACKTRACE: '0' } }, (err, stdout, stderr) => {
      const e = err as { code?: number | string; killed?: boolean; message: string } | null
      // a string code is a spawn failure (ENOENT): there is no compiler to ask
      if (e && typeof e.code === 'string') return reject(new Error(`cannot run ${file}: ${e.message}`))
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr), timedOut: Boolean(e?.killed) })
    })
  })
}

interface Span {
  file_name: string
  line_start: number
  is_primary: boolean
  expansion?: { span: Span } | null
}

interface Diagnostic {
  message: string
  level: string
  code: { code: string } | null
  spans: Span[]
}

/** A span's line in the snippet: a span inside a macro's expansion (`format!`) is reported at its call site. */
function snippetLine(span: Span | undefined, file: string): number | null {
  for (let s = span; s; s = s.expansion?.span) if (path.basename(s.file_name) === path.basename(file)) return s.line_start
  return null
}

/**
 * The first error in rustc's JSON diagnostics (one object per line of stderr): its code, primary line
 * in the snippet `file`, and message. The closing "aborting due to …" note has no span and is skipped.
 * An error rustc gives no code (some lifetime errors) is recorded as `none`, which no snippet can expect.
 */
export function firstError(stderr: string, file: string): { code: string; line: number; message: string } | null {
  for (const line of stderr.split('\n')) {
    if (!line.startsWith('{')) continue
    let d: Diagnostic
    try {
      d = JSON.parse(line) as Diagnostic
    } catch {
      continue
    }
    if (d.level !== 'error' || !Array.isArray(d.spans) || d.spans.length === 0) continue
    const primary = d.spans.find((s) => s.is_primary) ?? d.spans[0]
    return { code: d.code?.code ?? 'none', line: snippetLine(primary, file) ?? 0, message: d.message }
  }
  return null
}

/**
 * A panic from a run snippet's binary: the line it panicked at in the snippet, and RefCell's two
 * borrow failures named by the error types `try_borrow_mut` and `try_borrow` return. Rust 1.96 prints
 * "RefCell already borrowed"; older releases printed "already borrowed: BorrowMutError".
 */
export function panicOutcome(stderr: string, file: string): { code: string; line: number; message: string } | null {
  const m = /panicked at ([^\n]+?):(\d+):(\d+):\n([^\n]*)/.exec(stderr)
  if (!m) return null
  const message = m[4].trim()
  const inSnippet = path.basename(m[1]) === path.basename(file)
  let code = 'panic'
  if (/already mutably borrowed|BorrowError\b/.test(message)) code = 'BorrowError'
  else if (/already borrowed|BorrowMutError/.test(message)) code = 'BorrowMutError'
  return { code: inSnippet ? code : 'panic', line: inSnippet ? Number(m[2]) : 0, message }
}

/** rustc (and, for a run snippet, the binary) on one piece of code. */
export async function compile(code: string, run: boolean): Promise<BankOutcome> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rust-items-'))
  try {
    const file = path.join(dir, run ? 'main.rs' : 'lib.rs')
    await writeFile(file, `${code}\n`)
    const common = ['--edition', EDITION, '--error-format=json', '-A', 'warnings', '--crate-name', 'snippet', '-C', 'debuginfo=0']
    const args = run ? [...common, '--crate-type', 'bin', '-o', path.join(dir, 'snippet'), file] : [...common, '--crate-type', 'lib', '--emit=metadata', '--out-dir', dir, file]
    const c = await exec(RUSTC, args, COMPILE_TIMEOUT_MS, dir)
    if (c.timedOut) throw new Error(`rustc timed out on:\n${code}`)
    const err = firstError(c.stderr, file)
    if (err) return err
    if (c.code !== 0) throw new Error(`rustc failed without a diagnostic:\n${c.stderr}`)
    if (!run) return 'compiles'
    const r = await exec(path.join(dir, 'snippet'), [], RUN_TIMEOUT_MS, dir)
    if (r.timedOut) return { code: 'timeout', line: 0, message: `ran past ${RUN_TIMEOUT_MS / 1000} s` }
    if (r.code === 0) return 'compiles'
    return panicOutcome(r.stderr, file) ?? { code: 'exit', line: 0, message: `exited ${r.code}: ${r.stderr.trim().slice(0, 200)}` }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export async function rustcVersion(): Promise<string> {
  const v = await exec(RUSTC, ['--version'], COMPILE_TIMEOUT_MS)
  return v.stdout.trim()
}

/* ------------------------------ the bank ------------------------------ */

/** A gate that lets at most `jobs` calls run at once, across every snippet being built. */
export function limiter(jobs: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(task: () => Promise<T>): Promise<T> => {
    // a woken waiter rechecks: a task that arrived meanwhile may have taken the slot the finishing one freed
    while (active >= jobs) await new Promise<void>((r) => waiting.push(r))
    active++
    try {
      return await task()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

/** Every rustc result of one snippet, in authored order. */
async function buildSnippet(s: RustSnippet, limit: ReturnType<typeof limiter>): Promise<BankSnippet> {
  const tasks: Promise<BankOutcome>[] = []
  for (const v of s.variants) {
    tasks.push(limit(() => compile(variantCode(s, v), Boolean(s.run))))
    for (const f of v.fixes ?? []) tasks.push(limit(() => compile(fixCode(s, v, f), Boolean(s.run))))
  }
  const results = await Promise.all(tasks)
  let i = 0
  const variants: BankSnippet['variants'] = {}
  for (const v of s.variants) {
    const result = results[i++]
    const fixes: Record<string, Outcome> = {}
    for (const f of v.fixes ?? []) {
      const r = results[i++]
      fixes[f.id] = r === 'compiles' ? r : { code: r.code, line: r.line }
    }
    variants[v.id] = v.fixes ? { result, fixes } : { result }
  }
  return { hash: snippetHash(s), variants }
}

/** One line per variant, so a rebuilt bank diffs by variant. Key order is fixed, so the text is deterministic. */
export function formatBank(b: BankFile): string {
  const j = (x: unknown) => JSON.stringify(x)
  const snippets = Object.entries(b.snippets).map(([id, s]) => {
    const variants = Object.entries(s.variants).map(([vid, v]) => `        ${j(vid)}: ${j(v.fixes ? { result: v.result, fixes: v.fixes } : { result: v.result })}`)
    return `    ${j(id)}: {\n      "hash": ${j(s.hash)},\n      "variants": {\n${variants.join(',\n')}\n      }\n    }`
  })
  return `{\n  "group": ${j(b.group)},\n  "rustc": ${j(b.rustc)},\n  "edition": ${j(b.edition)},\n  "snippets": {\n${snippets.join(',\n')}\n  }\n}\n`
}

const bankFile = (group: string) => path.join(BANK_DIR, `${group}.json`)

/* ------------------------------ what the app loads ------------------------------ */

/** A manifest variant: its outcome code ('' when it compiles), `p` with a permission label, `f` with fixes. */
const manifestVariant = (v: RustSnippet['variants'][number]): string => `${v.expect === 'compiles' ? '' : v.expect.code}${v.permission && v.focus ? 'p' : ''}${v.fixes ? 'f' : ''}`

/** `manifest.json`: every group's snippets as [kcs, variants], a variant null when the bank does not confirm it. */
export function manifestOf(groups: readonly RustGroup[]): RustManifest {
  const confirmed = new Set(bankUnits(groups).units.map((u) => u.key))
  const out: RustManifest = { groups: {} }
  for (const g of groups) {
    out.groups[g.id] = g.snippets.map((s) => [[...s.kcs], s.variants.map((v): ManifestVariant => (confirmed.has(`${g.id}/${s.id}/${v.id}`) ? manifestVariant(v) : null))])
  }
  return out
}

/** One snippet per line, so a change diffs by snippet. */
export function formatManifest(m: RustManifest): string {
  const j = (x: unknown) => JSON.stringify(x)
  const groups = Object.entries(m.groups).map(([id, snippets]) => `    ${j(id)}: [\n${snippets.map((s) => `      ${j(s)}`).join(',\n')}\n    ]`)
  return `{\n  "groups": {\n${groups.join(',\n')}\n  }\n}\n`
}

const afterText = (o: Outcome): string => (o === 'compiles' ? o : `${o.code}@${o.line}`)

/** `served/<group>.ts`: the group's snippets and, per snippet and variant, what rustc did after each fix. */
export function servedSource(g: RustGroup): string {
  const rows = g.snippets.map((s) =>
    JSON.stringify(
      s.variants.map((v) => {
        if (!v.fixes) return null
        const done = g.bank?.snippets[s.id]?.variants[v.id]?.fixes
        return v.fixes.map((f) => (done?.[f.id] === undefined ? 'missing' : afterText(done[f.id])))
      }),
    ),
  )
  return [
    `/* Written by scripts/build-rust-items.ts from bank/${g.id}.json; do not edit. verify:rust-items fails when it is stale. */`,
    `import type { ServedGroup } from '../types'`,
    '',
    `export { SNIPPETS } from '../snippets/${g.id}'`,
    '',
    `/** By snippet and variant in authored order: what rustc did after each fix ('compiles' or <code>@<line>), null for a variant without fixes. */`,
    `export const AFTER: ServedGroup['AFTER'] = [`,
    ...rows.map((r) => `  ${r},`),
    ']',
    '',
  ].join('\n')
}

/** `museum.json`: the Error Museum's exhibits, built from the banks, so /errors loads no group. */
export function formatMuseum(groups: readonly RustGroup[]): string {
  return `${JSON.stringify(museumEntries(bankUnits(groups).units), null, 2)}\n`
}

/** Every file the app loads instead of the banks, by path relative to src/data/rust-items, with its text. */
export function derivedFiles(groups: readonly RustGroup[]): Map<string, string> {
  const out = new Map<string, string>([['manifest.json', formatManifest(manifestOf(groups))]])
  for (const g of groups) out.set(`served/${g.id}.ts`, servedSource(g))
  out.set('museum.json', formatMuseum(groups))
  return out
}

/** Write the derived files; a served group whose snippets no longer exist is removed. */
function writeDerived(groups: readonly RustGroup[]): number {
  const files = derivedFiles(groups)
  mkdirSync(path.join(ITEMS_DIR, 'served'), { recursive: true })
  for (const name of readdirSync(path.join(ITEMS_DIR, 'served'))) if (!files.has(`served/${name}`)) rmSync(path.join(ITEMS_DIR, 'served', name))
  for (const [rel, text] of files) writeFileSync(path.join(ITEMS_DIR, rel), text)
  return files.size
}

/* ------------------------------ main ------------------------------ */

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const check = argv.includes('--check')
  const force = argv.includes('--force')
  if (argv.includes('--derived')) {
    const groups = await loadRustGroups()
    const missing = groups.filter((g) => !g.bank).map((g) => g.id)
    if (missing.length > 0) {
      console.error(`build-rust-items: no bank for ${missing.join(', ')}; build it first (bun scripts/build-rust-items.ts --group ${missing.join(',')})`)
      process.exit(1)
    }
    console.log(`build-rust-items: wrote ${writeDerived(groups)} derived file(s) from the committed banks`)
    return
  }
  const only = flag('--group')?.split(',')
  const jobs = Number(flag('--jobs') ?? availableParallelism())
  const t0 = performance.now()

  const all = await loadRustGroups()
  const unknown = (only ?? []).filter((id) => !all.some((g) => g.id === id))
  if (unknown.length > 0) {
    console.error(`build-rust-items: no such group: ${unknown.join(', ')}`)
    process.exit(1)
  }
  const schema = checkSnippets(all)
  if (schema.length > 0) {
    for (const p of schema) console.error(p)
    console.error(`build-rust-items: ${schema.length} schema problem(s); fix them before building (bun scripts/verify-rust-items.ts)`)
    process.exit(1)
  }

  const version = await rustcVersion().catch((e: unknown) => {
    console.error(`build-rust-items: cannot run ${RUSTC}: ${e instanceof Error ? e.message : String(e)}`)
    return process.exit(1)
  })
  if (!version.startsWith(`rustc ${RUSTC_VERSION} `)) {
    console.error(`build-rust-items: ${RUSTC} is "${version}"; the bank is built by rustc ${RUSTC_VERSION} (rustup toolchain install ${RUSTC_VERSION}, or set RUSTC)`)
    process.exit(1)
  }

  const groups: RustGroup[] = all.filter((g) => !only || only.includes(g.id))
  const limit = limiter(Math.max(1, jobs))
  let compiled = 0
  let reused = 0
  // every snippet at once, rustc calls gated by --jobs; a snippet unchanged since its last build keeps its results
  const built = await Promise.all(
    groups.map((g) =>
      Promise.all(
        g.snippets.map((s) => {
          const old = g.bank?.snippets[s.id]
          const keep = !check && !force && old && g.bank?.rustc === version && old.hash === snippetHash(s)
          if (keep) reused++
          else compiled++
          return keep ? Promise.resolve(old) : buildSnippet(s, limit)
        }),
      ),
    ),
  )
  const problems: string[] = []
  const out = new Map<string, BankFile>()
  groups.forEach((g, gi) => {
    const bank: BankFile = { group: g.id, rustc: version, edition: EDITION, snippets: {} }
    g.snippets.forEach((s, si) => {
      const b = built[gi][si]
      bank.snippets[s.id] = b
      const at = `${g.id}/${s.id}`
      const found = compareSnippet(s, b, at)
      if (found.length === 0) return
      problems.push(...found)
      // what rustc said, so the author can see the real error
      for (const v of s.variants) {
        const r = b.variants[v.id]?.result
        if (r && r !== 'compiles') problems.push(`  ${at}/${v.id}: rustc: ${r.code} at line ${r.line}: ${r.message}`)
        for (const [fid, fr] of Object.entries(b.variants[v.id]?.fixes ?? {})) if (fr !== 'compiles') problems.push(`  ${at}/${v.id}/fix ${fid}: rustc: ${fr.code} at line ${fr.line}`)
      }
    })
    out.set(g.id, bank)
  })

  if (check) {
    for (const [id, bank] of out) {
      const file = bankFile(id)
      const want = formatBank(bank)
      if (!existsSync(file)) problems.push(`bank/${id}.json is missing; run bun scripts/build-rust-items.ts --group ${id}`)
      else if (readFileSync(file, 'utf8') !== want) problems.push(`bank/${id}.json is not what rustc ${RUSTC_VERSION} builds from snippets/${id}.ts now; run bun scripts/build-rust-items.ts --group ${id} and commit it`)
    }
  }

  const secs = ((performance.now() - t0) / 1000).toFixed(1)
  if (problems.length > 0) {
    for (const p of problems) console.error(p)
    console.error(`build-rust-items: ${problems.filter((p) => !p.startsWith('  ')).length} mismatch(es) with the authored outcomes${check ? '' : '; nothing written'} (${secs} s)`)
    process.exit(1)
  }
  if (!check) {
    mkdirSync(BANK_DIR, { recursive: true })
    for (const [id, bank] of out) writeFileSync(bankFile(id), formatBank(bank))
    // the app's files follow the banks: every group, with the banks just written in place of the old ones
    writeDerived(all.map((g) => (out.has(g.id) ? { ...g, bank: out.get(g.id)! } : g)))
  }
  const verb = check ? 'checked' : 'wrote'
  console.log(`build-rust-items: ${verb} ${out.size} group(s) with ${version}: ${compiled} snippet(s) compiled, ${reused} unchanged (${secs} s)`)
}

if (import.meta.main) await main()
