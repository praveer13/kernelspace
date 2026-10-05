/**
 * verify-guardrails — the H1 guardrail kit in every lab zip (docs/specs/wave-1.md §13.4).
 *
 * Unzips each lab zip and checks that
 *   - the five kit files are present and nothing private ships;
 *   - settings.json denies edits to that zip's TODO(you) file and wires the PreToolUse hook;
 *   - AGENTS.md lists exactly the lab's required check ids (from src/data/labs.ts), the explanation gate,
 *     the ladder and the AI-use card, and CLAUDE.md is `@AGENTS.md`;
 *   - the zip's own ks-guard.sh passes the fixture matrix under `sh`.
 *
 * Two sets of zips are checked. The generator's output (pack-labs.py into a temp dir) always has to be
 * 18/18. The committed public/labs/*.zip are repacked by C18; until then a zip with no kit at all is reported
 * as awaiting repack, and any zip that does carry the kit is held to the full check. C18 flips
 * REQUIRE_COMMITTED (or passes --require-committed) so a stale committed zip fails.
 *
 *   bun run verify:guardrails [--require-committed]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { dumpLabs, type LabDump } from './dump-labs'

const ROOT = resolve(import.meta.dirname, '..')
const REQUIRE_COMMITTED = false

export const KIT_FILES = [
  '.claude/settings.json',
  '.claude/hooks/ks-guard.sh',
  '.claude/output-styles/kernelspace-socratic.md',
  'AGENTS.md',
  'CLAUDE.md',
]

export const AI_USE_LABEL = 'hypotheses from a small preprint (N=52; groups n=2–7; speed-incentivised)'

// ---- the hook fixture matrix -------------------------------------------------------------------------------

export interface HookFixture {
  name: string
  /** stdin for the hook; a non-string is JSON-encoded */
  stdin: unknown
  env?: Record<string, string>
  expect: 'allow' | 'deny'
}

const tool = (name: string, input: Record<string, unknown>) => ({
  session_id: 'fixture',
  cwd: '/work',
  hook_event_name: 'PreToolUse',
  tool_name: name,
  tool_input: input,
})

/** The §13.4 matrix, for any protected file, plus the cases that make the guard fail closed. */
export function hookFixtures(todoFile: string): HookFixture[] {
  const base = todoFile.slice(todoFile.lastIndexOf('/') + 1)
  const abs = `/work/${todoFile}`
  return [
    { name: 'deny an Edit of the file', stdin: tool('Edit', { file_path: abs, old_string: 'a', new_string: 'b' }), expect: 'deny' },
    { name: 'deny a Write of the file', stdin: tool('Write', { file_path: abs, content: 'x' }), expect: 'deny' },
    { name: 'deny a MultiEdit of the file', stdin: tool('MultiEdit', { file_path: abs, edits: [] }), expect: 'deny' },
    { name: 'deny an Edit by relative path', stdin: tool('Edit', { file_path: `src/${base}`, new_string: 'b' }), expect: 'deny' },
    { name: `deny sed -i … ${base}`, stdin: tool('Bash', { command: `sed -i 's/a/b/' ${todoFile}` }), expect: 'deny' },
    { name: 'deny a redirect into the file', stdin: tool('Bash', { command: `cat notes.txt > ${todoFile}` }), expect: 'deny' },
    { name: 'deny a read-only command chained to a write', stdin: tool('Bash', { command: `cat ${todoFile}; rm ${todoFile}` }), expect: 'deny' },
    { name: 'deny an mcp tool that names the file', stdin: tool('mcp__fs__write_file', { path: abs, content: 'x' }), expect: 'deny' },
    { name: 'deny an unparseable payload', stdin: 'this is not json', expect: 'deny' },
    { name: 'deny an empty payload', stdin: '', expect: 'deny' },
    { name: 'deny a truncated payload', stdin: '{"tool_name":"Edit","tool_input":{"file_pa', expect: 'deny' },
    { name: 'allow cargo test', stdin: tool('Bash', { command: 'cargo test' }), expect: 'allow' },
    { name: 'allow a read-only look at the file', stdin: tool('Bash', { command: `grep -n TODO ${todoFile} | head -5` }), expect: 'allow' },
    { name: 'allow git diff of the file', stdin: tool('Bash', { command: `git diff -- ${todoFile}` }), expect: 'allow' },
    { name: 'allow an Edit of README.md', stdin: tool('Edit', { file_path: '/work/README.md', new_string: `see ${base}` }), expect: 'allow' },
    { name: 'allow an mcp tool that never names the file', stdin: tool('mcp__fs__list', { path: '/work' }), expect: 'allow' },
    { name: 'allow with KS_SOLO=0', stdin: tool('Edit', { file_path: abs, new_string: 'b' }), env: { KS_SOLO: '0' }, expect: 'allow' },
    { name: 'allow an unparseable payload with KS_SOLO=0', stdin: 'garbage', env: { KS_SOLO: '0' }, expect: 'allow' },
  ]
}

/** Runs one hook script under `shell`; the exit status is the verdict (2 blocks, 0 allows). */
export function runHook(shell: string, script: string, protectedFile: string, fixture: HookFixture): number | null {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  delete env.KS_SOLO
  Object.assign(env, fixture.env)
  const stdin = typeof fixture.stdin === 'string' ? fixture.stdin : JSON.stringify(fixture.stdin)
  const r = spawnSync(shell, [script, protectedFile], { input: stdin, env, encoding: 'utf8', timeout: 10_000 })
  return r.status
}

/** Fixtures whose verdict differs from the expectation, as readable lines. */
export function matrixFailures(shell: string, script: string, protectedFile: string): string[] {
  const out: string[] = []
  for (const f of hookFixtures(protectedFile)) {
    const status = runHook(shell, script, protectedFile, f)
    const got = status === 2 ? 'deny' : status === 0 ? 'allow' : `exit ${status}`
    if (got !== f.expect) out.push(`hook (${shell}): "${f.name}" expected ${f.expect}, got ${got}`)
  }
  return out
}

// ---- a small zip reader (no unzip binary, no dependency) ---------------------------------------------------

export function readZip(path: string): Map<string, Buffer> {
  const buf = readFileSync(path)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error(`${path}: no end-of-central-directory record`)
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const files = new Map<string, Buffer>()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${path}: bad central directory entry`)
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(dataStart, dataStart + size)
    if (method !== 0 && method !== 8) throw new Error(`${path}: ${name} uses compression method ${method}`)
    files.set(name, method === 0 ? raw : inflateRawSync(raw))
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

// ---- one zip -----------------------------------------------------------------------------------------------

/** The ids listed as `- \`id\`: label` lines under one `## <heading>` of AGENTS.md. */
function idsUnder(md: string, heading: string): string[] {
  const start = md.search(new RegExp(`^## ${heading}\\b.*$`, 'm'))
  if (start < 0) return []
  const rest = md.slice(start).split('\n').slice(1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  const body = end < 0 ? rest : rest.slice(0, end)
  return body.flatMap((line) => {
    const m = /^- `([^`]+)`/.exec(line)
    return m ? [m[1]] : []
  })
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

export function zipHasKit(files: Map<string, Buffer>): boolean {
  return [...files.keys()].some((n) => n.startsWith('.claude/'))
}

export function checkZip(lab: LabDump, files: Map<string, Buffer>, shells: string[]): string[] {
  const errors: string[] = []
  const err = (m: string) => errors.push(`${lab.zip}: ${m}`)
  for (const f of KIT_FILES) if (!files.has(f)) err(`missing ${f}`)
  for (const n of files.keys()) {
    const parts = n.split('/')
    if (parts.includes('_solutions') || parts.includes('target') || /\.(wasm|rlib|rmeta)$/.test(n)) err(`private or build artifact ${n}`)
    if (n.startsWith('.claude/') && !KIT_FILES.includes(n)) err(`unexpected kit file ${n}`)
  }
  if (!KIT_FILES.every((f) => files.has(f))) return errors
  const text = (n: string) => files.get(n)!.toString('utf8')

  // settings.json
  let settingsOk = false
  let hookArg = ''
  try {
    const s = JSON.parse(text('.claude/settings.json'))
    const deny: string[] = s?.permissions?.deny ?? []
    if (!deny.includes(`Edit(/${lab.todoFile})`)) err(`settings.json does not deny Edit(/${lab.todoFile})`)
    const pre = s?.hooks?.PreToolUse
    const entry = Array.isArray(pre) && pre.length === 1 ? pre[0] : undefined
    const hook = entry?.hooks?.[0]
    if (entry?.matcher !== 'Edit|Write|MultiEdit|NotebookEdit|Bash|mcp__.*') err('settings.json PreToolUse matcher is wrong')
    if (entry?.hooks?.length !== 1 || hook?.type !== 'command' || hook?.timeout !== 10) err('settings.json hook must be one command with timeout 10')
    const m = /ks-guard\.sh"? (\S+)$/.exec(String(hook?.command ?? ''))
    if (!m || !String(hook.command).startsWith('sh ')) err('settings.json hook command must be `sh …/ks-guard.sh <file>`')
    else hookArg = m[1]
    if (hookArg && hookArg !== lab.todoFile) err(`settings.json hook protects ${hookArg}, not ${lab.todoFile}`)
    if (s?.outputStyle !== 'kernelspace-socratic') err('settings.json outputStyle is not kernelspace-socratic')
    settingsOk = true
  } catch {
    err('settings.json is not valid JSON')
  }
  if (!files.has(lab.todoFile)) err(`the TODO file ${lab.todoFile} is not in the zip`)

  // the output style
  const style = text('.claude/output-styles/kernelspace-socratic.md')
  if (!/^---\nname: kernelspace-socratic\n/.test(style)) err('output style frontmatter must name kernelspace-socratic')
  if (!/3 lines/.test(style) || !/explanation gate/i.test(style)) err('output style lacks the 3-line fragment rule or the explanation gate')

  // AGENTS.md and CLAUDE.md
  const md = text('AGENTS.md')
  const required = idsUnder(md, 'Required checks')
  if (!sameIds(required, lab.required.map((c) => c.id))) err(`AGENTS.md required checks [${required}] differ from labs.ts [${lab.required.map((c) => c.id)}]`)
  const optional = idsUnder(md, 'Optional checks')
  if (!sameIds(optional, lab.optional.map((c) => c.id))) err(`AGENTS.md optional checks [${optional}] differ from labs.ts [${lab.optional.map((c) => c.id)}]`)
  if (!md.includes(`\`${lab.todoFile}\``)) err('AGENTS.md does not name the TODO file')
  if (!/Before any hint, have the student state the failing check id, the invariant it\s+tests and their hypothesis/.test(md)) err('AGENTS.md lacks the explanation gate')
  for (const rung of ['R0', 'R1', 'R2', 'R3', 'R4']) if (!md.includes(`**${rung}**`)) err(`AGENTS.md ladder lacks ${rung}`)
  if (!/^## AI-use card$/m.test(md) || !md.toLowerCase().includes(AI_USE_LABEL.toLowerCase())) err('AGENTS.md lacks the labelled AI-use card')
  if (/\bsix checks\b/i.test(md) && lab.required.length !== 6) err('AGENTS.md still says "six checks"')
  if (md.includes('{{')) err('AGENTS.md has an unfilled placeholder')
  if (text('CLAUDE.md').trim() !== '@AGENTS.md') err('CLAUDE.md must be @AGENTS.md')

  // the hook, as shipped, under sh
  if (settingsOk && hookArg) {
    const dir = mkdtempSync(join(tmpdir(), 'ks-guard-'))
    try {
      const script = join(dir, 'ks-guard.sh')
      writeFileSync(script, files.get('.claude/hooks/ks-guard.sh')!)
      for (const shell of shells) for (const m of matrixFailures(shell, script, hookArg)) err(m)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  return errors
}

// ---- main --------------------------------------------------------------------------------------------------

/** `sh`, plus dash when the machine has it, so the hook stays POSIX. KS_SHELLS="sh /path/to/dash" overrides. */
export function availableShells(): string[] {
  if (process.env.KS_SHELLS) return process.env.KS_SHELLS.split(/\s+/).filter(Boolean)
  const shells = ['sh']
  for (const extra of ['dash']) if (spawnSync('sh', ['-c', `command -v ${extra}`]).status === 0) shells.push(extra)
  return shells
}

function main(): number {
  const requireCommitted = REQUIRE_COMMITTED || process.argv.includes('--require-committed')
  const labs = dumpLabs()
  const shells = availableShells()
  const errors: string[] = []

  const tmp = mkdtempSync(join(tmpdir(), 'ks-zips-'))
  try {
    const pack = spawnSync('python3', [join(ROOT, 'scripts/pack-labs.py'), '--out', tmp], { cwd: ROOT, encoding: 'utf8' })
    if (pack.status !== 0) {
      console.error(`verify-guardrails: pack-labs.py failed\n${pack.stderr}`)
      return 1
    }
    let ok = 0
    for (const lab of labs) {
      const e = checkZip(lab, readZip(join(tmp, lab.zip)), shells)
      if (e.length === 0) ok++
      errors.push(...e)
    }
    console.log(`verify-guardrails: generated zips ${ok}/${labs.length} compliant (hook matrix under ${shells.join(', ')})`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  let committed = 0
  let stale = 0
  for (const lab of labs) {
    const path = join(ROOT, 'public/labs', lab.zip)
    if (!existsSync(path)) {
      errors.push(`${lab.zip}: not in public/labs`)
      continue
    }
    const files = readZip(path)
    if (!zipHasKit(files) && !requireCommitted) {
      stale++
      continue
    }
    const e = checkZip(lab, files, shells)
    if (e.length === 0) committed++
    errors.push(...e)
  }
  const note = stale > 0 ? `, ${stale} awaiting the C18 repack (--require-committed enforces)` : ''
  console.log(`verify-guardrails: committed zips ${committed}/${labs.length} compliant${note}`)

  for (const e of errors) console.error(`  ${e}`)
  if (errors.length > 0) {
    console.error(`verify-guardrails: ${errors.length} problem(s)`)
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(main())
