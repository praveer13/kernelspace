/**
 * F4 permission traces (docs/specs/wave-2.md §17.1): the committed data a PermissionDiagram draws.
 *
 * One file per lesson, `src/data/aquascope/<lessonId>.json`, holds a trace per code block that sets
 * `CodeBlockData.permissions: {trace}`. A trace records, for each line of the block's Rust, every path
 * whose Read/Write/Own permissions change there (before and after), and each use of a path with the
 * permissions it needs and has. Aquascope calls Own "drop"; the trace says O, as the lessons do.
 *
 * Traces come from `scripts/aquascope/extract.ts`, a local run of Aquascope at its pinned nightly;
 * CI never runs Aquascope. A trace carries the sha256 of the code it was drawn from, so an edit to a
 * block without a fresh trace fails tests/lesson/permission.test.ts. Under the Q9 fallback a trace is
 * hand-authored in this format, `source: 'hand'`, and the diagram says "drawn after Aquascope's model".
 *
 * Pure data and pure helpers only: no hashing (the test and the script hash with node:crypto), so the
 * browser never ships a hash function for this.
 */

/** Aquascope's pins (computing-education.md:90): the toolchain its rust-toolchain.toml names, and the commit. */
export const AQUASCOPE_TOOLCHAIN = 'nightly-2026-05-01'
export const AQUASCOPE_COMMIT = 'f2d0a06034b86765a91f10b7c8e40ec31ecb87a6'

/** A permission set, letters in R W O order: 'RWO', 'RO', 'R', '' (none). */
export type Perms = string

export const PERM_LETTERS = ['R', 'W', 'O'] as const
export type PermLetter = (typeof PERM_LETTERS)[number]

export const PERM_NAMES: Record<PermLetter, string> = { R: 'read', W: 'write', O: 'own' }

const PERMS_RE = /^R?W?O?$/

/** One path's permissions changing on a line. `before` is '' when the path is not yet live. */
export interface PermissionChange {
  /** 1-based line of the block's code. */
  line: number
  /** A place as Aquascope prints it: `v`, `*r`, `s.0`. */
  path: string
  before: Perms
  after: Perms
}

/** A use of a path: the permissions the operation needs and the ones the path has there. */
export interface PermissionUse {
  line: number
  /** 0-based column of the use, as Aquascope reports it. */
  col: number
  path: string
  needs: Perms
  has: Perms
}

export interface PermissionTrace {
  /** sha256 (hex) of the block's `code`, UTF-8, exactly as authored. */
  sha256: string
  /** `aquascope`: extracted by scripts/aquascope/extract.ts. `hand`: drawn after Aquascope's model (Q9). */
  source: 'aquascope' | 'hand'
  /** Extracted traces: the Aquascope commit and toolchain that produced them. */
  tool?: { aquascope: string; toolchain: string }
  /** Hand-authored traces: the date the owner reviewed this trace (Q9); absent until then. */
  reviewed?: string
  /** Lines in the code; every line below is within 1…lines. */
  lines: number
  /** Column order: each path in the order it first appears. */
  paths: string[]
  changes: PermissionChange[]
  uses: PermissionUse[]
  /**
   * The code itself, only where no lesson block holds it (sample.json, and an errors file whose
   * snippets live in the compile bank). A lesson trace never repeats its block's code.
   */
  code?: string
}

export interface PermissionTraceFile {
  v: 1
  traces: Record<string, PermissionTrace>
}

/** The letters of a set, in R W O order. */
export const letters = (p: Perms): PermLetter[] => PERM_LETTERS.filter((l) => p.includes(l))

/** The permissions in `needs` that `has` lacks. */
export const missing = (needs: Perms, has: Perms): PermLetter[] => letters(needs).filter((l) => !has.includes(l))

/** The code's line count as the diagram and CodeBlock number it (a trailing newline adds no line). */
export const codeLines = (code: string): number => code.replace(/\n$/, '').split('\n').length

/** Problems with a trace on its own: shape, permission strings, lines in range, paths declared. */
export function traceShapeProblems(key: string, t: PermissionTrace): string[] {
  const out: string[] = []
  const at = `trace ${key}`
  if (!/^[0-9a-f]{64}$/.test(t.sha256)) out.push(`${at}: sha256 must be 64 hex characters`)
  if (t.source !== 'aquascope' && t.source !== 'hand') out.push(`${at}: source must be 'aquascope' or 'hand'`)
  if (t.source === 'aquascope' && !t.tool) out.push(`${at}: an extracted trace names its tool`)
  if (!Number.isInteger(t.lines) || t.lines < 1) out.push(`${at}: lines must be a positive integer`)
  if (t.code !== undefined && codeLines(t.code) !== t.lines) out.push(`${at}: lines is ${t.lines} but its code has ${codeLines(t.code)}`)
  const paths = new Set(t.paths)
  if (paths.size !== t.paths.length) out.push(`${at}: paths repeat`)
  const line = (n: number, what: string) => {
    if (!Number.isInteger(n) || n < 1 || n > t.lines) out.push(`${at}: ${what} line ${n} is outside 1…${t.lines}`)
  }
  const perms = (p: Perms, what: string) => {
    if (!PERMS_RE.test(p)) out.push(`${at}: ${what} '${p}' is not a subset of RWO in order`)
  }
  for (const c of t.changes) {
    line(c.line, `change of ${c.path}`)
    if (!paths.has(c.path)) out.push(`${at}: change on line ${c.line} names undeclared path ${c.path}`)
    perms(c.before, 'before')
    perms(c.after, 'after')
    if (c.before === c.after) out.push(`${at}: change of ${c.path} on line ${c.line} changes nothing`)
  }
  const seen = new Set<string>()
  for (const c of t.changes) {
    const k = `${c.line}\u0000${c.path}`
    if (seen.has(k)) out.push(`${at}: ${c.path} changes twice on line ${c.line}`)
    seen.add(k)
  }
  for (const u of t.uses) {
    line(u.line, `use of ${u.path}`)
    if (!paths.has(u.path)) out.push(`${at}: use on line ${u.line} names undeclared path ${u.path}`)
    perms(u.needs, 'needs')
    perms(u.has, 'has')
    if (u.needs === '') out.push(`${at}: use of ${u.path} on line ${u.line} needs nothing`)
  }
  return out
}

/** A block that points at a trace, as the hash check sees it. */
export interface TracedBlock {
  key: string
  code: string
}

/**
 * Problems between a lesson's traced code blocks and its trace file: a missing file or trace, a shape
 * problem, a hash that no longer matches the block's code, or a line count that disagrees. `sha256` is
 * passed in (node:crypto in the test and the script).
 */
export function traceProblems(
  where: string,
  blocks: readonly TracedBlock[],
  file: PermissionTraceFile | undefined,
  sha256: (text: string) => string,
): string[] {
  if (blocks.length === 0) return []
  if (!file) return [`${where}: no trace file for ${blocks.length} traced code block(s); run scripts/aquascope/extract.ts`]
  if (file.v !== 1) return [`${where}: trace file version ${String(file.v)} is not 1`]
  const out: string[] = []
  for (const b of blocks) {
    const t = Object.hasOwn(file.traces, b.key) ? file.traces[b.key] : undefined
    if (!t) {
      out.push(`${where}: no trace '${b.key}'`)
      continue
    }
    out.push(...traceShapeProblems(`${where}/${b.key}`, t))
    const hash = sha256(b.code)
    if (t.sha256 !== hash) out.push(`${where}/${b.key}: code hash ${hash.slice(0, 12)}… differs from the trace's ${t.sha256.slice(0, 12)}…; re-extract the trace`)
    if (t.lines !== codeLines(b.code)) out.push(`${where}/${b.key}: trace has ${t.lines} lines, code has ${codeLines(b.code)}`)
  }
  return out
}

/* ------------------------------ the table model ------------------------------ */

/** One permission letter in a cell: held or not after the line, and whether the line changed it. */
export interface PermMark {
  letter: PermLetter
  held: boolean
  change: 'gained' | 'lost' | null
}

export interface PermCell {
  path: string
  /** No state yet: the path is not live before or on this line. */
  empty: boolean
  /** The line changed this path's permissions. */
  changed: boolean
  marks: PermMark[]
  /** Uses of the path on this line, with what is missing (empty when the use is allowed). */
  uses: { needs: PermLetter[]; missing: PermLetter[] }[]
}

export interface PermRow {
  line: number
  /** The code of that line, trimmed of trailing space. */
  text: string
  cells: PermCell[]
  /** Some use on this line lacks a permission: the line the compiler rejects. */
  rejected: boolean
}

/**
 * The diagram as rows of lines × columns of paths. Only lines where a permission changes or a path is
 * used get a row. A cell carries the path's permissions after the line (carried forward from its last
 * change), each letter marked gained or lost when this line changed it.
 */
export function traceTable(trace: PermissionTrace, code: string): PermRow[] {
  const src = code.replace(/\n$/, '').split('\n')
  const rowLines = [...new Set([...trace.changes.map((c) => c.line), ...trace.uses.map((u) => u.line)])].sort((a, b) => a - b)
  const state = new Map<string, Perms>()
  return rowLines.map((line) => {
    const changes = trace.changes.filter((c) => c.line === line)
    const uses = trace.uses.filter((u) => u.line === line)
    const cells = trace.paths.map((path): PermCell => {
      const ch = changes.find((c) => c.path === path)
      const before = ch ? ch.before : (state.get(path) ?? '')
      const after = ch ? ch.after : before
      if (ch) state.set(path, after)
      const pathUses = uses.filter((u) => u.path === path).map((u) => ({ needs: letters(u.needs), missing: missing(u.needs, u.has) }))
      const live = state.has(path) || pathUses.length > 0
      return {
        path,
        empty: !live,
        changed: Boolean(ch),
        marks: PERM_LETTERS.map((letter) => {
          const was = before.includes(letter)
          const held = after.includes(letter)
          return { letter, held, change: ch && was !== held ? (held ? 'gained' : 'lost') : null }
        }),
        uses: pathUses,
      }
    })
    return { line, text: (src[line - 1] ?? '').trimEnd(), cells, rejected: cells.some((c) => c.uses.some((u) => u.missing.length > 0)) }
  })
}
