/**
 * tokenize-lesson-citations — turn the `T#.L#` / `R.L#` citations in lesson prose into lesson tokens (Wave 1 stage 0,
 * task K1-3). A token is `[[l:t6.l12]]`: the id never changes, the renderer prints its label and links to the lesson,
 * and the structure release re-labels every citation from one order.
 *
 * Scope: the `md` property of every lesson block — the strings `ProseView` renders (prose, callout, deepdive, exercise
 * and other markdown-lite fields). It never touches:
 *   - a field a ledger fingerprint hashes (`q`, `options`, `correct`, `prompt`, `model`, `ideas`, `unit`, `truth`),
 *     so the K1-1 ref snapshot stays byte-identical;
 *   - errata (`before`/`after` quote what was published), drills (`R1`) and words such as `L2 cache` (neither matches);
 *   - fenced code, inline code, and heading lines (a heading's text becomes its anchor and the ⌘K index).
 * A citation that names no lesson is left for the allowlist test.
 *
 * Fence and heading state is tracked within one static chunk: an interpolated template that opened a fence in one chunk
 * and closed it in another (or a heading split by `${...}`) would be misread. No lesson field does either today; the
 * `md` shapes are literal, no-substitution template, interpolated template, and `+` concatenation.
 *
 *   bun scripts/tokenize-lesson-citations.ts --stats   what is convertible, by field and reason
 *   bun scripts/tokenize-lesson-citations.ts --check   exit 1 when a convertible citation remains
 *   bun scripts/tokenize-lesson-citations.ts --write   rewrite the lesson files
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { ALL_LESSONS } from '../src/data/lessons'
import { lessonLabel, lessonToken } from '../src/lib/lesson-label'

const LESSONS = join(import.meta.dir, '..', 'src/data/lessons')

export interface Citation {
  file: string
  line: number
  literal: string
  /** The lesson the literal names, when one exists. */
  lessonId: string | null
  /** Why it is not converted: none means it is convertible. */
  skip: 'code' | 'heading' | 'no-lesson' | 'label-mismatch' | null
}

const BY_ID = new Map(ALL_LESSONS.map((l) => [l.id, l]))
const CITE_RE = /\b(T[0-7]|R)\.L(\d{1,2})\b/g

/** The lesson a citation literal names, or null. */
export const lessonOf = (literal: string): string | null => {
  const id = literal.toLowerCase()
  return BY_ID.has(id) ? id : null
}

const TEXT_FIELDS = new Set(['md'])

const files = (dir: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...files(full))
    else if (name.endsWith('.ts')) out.push(full)
  }
  return out.sort()
}

/** The content range of one static chunk of a markdown string, with its text. */
interface Chunk {
  start: number
  end: number
  content: string
}

const propertyName = (node: ts.PropertyAssignment): string | null => {
  if (ts.isIdentifier(node.name)) return node.name.text
  if (ts.isStringLiteral(node.name)) return node.name.text
  return null
}

const lineOf = (source: ts.SourceFile, pos: number): number => source.getLineAndCharacterOfPosition(pos).line + 1

/**
 * The static text of one initializer: a string, a no-substitution template, the literal parts of an interpolated
 * template (the `${...}` parts are left alone), or the leaves of a `+` concatenation. A citation in any of them is a
 * citation in prose; only the `${...}` values are not scanned.
 */
const chunksOf = (node: ts.Node, sf: ts.SourceFile, source: string): Chunk[] => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const start = node.getStart(sf)
    const end = node.getEnd()
    return [{ start: start + 1, end: end - 1, content: source.slice(start + 1, end - 1) }]
  }
  if (ts.isTemplateExpression(node)) {
    const out: Chunk[] = []
    const head = node.head
    out.push({ start: head.getStart(sf) + 1, end: head.getEnd() - 2, content: source.slice(head.getStart(sf) + 1, head.getEnd() - 2) })
    for (const span of node.templateSpans) {
      const lit = span.literal
      const trailing = ts.isTemplateTail(lit) ? 1 : 2
      const start = lit.getStart(sf) + 1
      const end = lit.getEnd() - trailing
      out.push({ start, end, content: source.slice(start, end) })
    }
    return out
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return [...chunksOf(node.left, sf, source), ...chunksOf(node.right, sf, source)]
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return chunksOf(node.expression, sf, source)
  }
  if (ts.isConditionalExpression(node)) {
    return [...chunksOf(node.whenTrue, sf, source), ...chunksOf(node.whenFalse, sf, source)]
  }
  // An md field in a shape this codemod does not read would be invisible to --check, so say so instead.
  throw new Error(`unsupported md initializer (${ts.SyntaxKind[node.kind]}); extend chunksOf`)
}

/**
 * The citations in one markdown text, outside fenced code, inline code and headings, in source order.
 */
export function citationsIn(text: string, file = '', firstLine = 1): Citation[] {
  const out: Citation[] = []
  let fenced = false
  text.split('\n').forEach((line, i) => {
    const lineNo = firstLine + i
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced
      return
    }
    if (fenced) return
    const heading = /^\s*#{1,6}\s/.test(line)
    // split on inline code spans: the even parts are prose, the odd parts are code
    const parts = line.split('`')
    parts.forEach((part, j) => {
      if (j % 2 === 1) return
      for (const m of part.matchAll(CITE_RE)) {
        const literal = m[0]
        const lessonId = lessonOf(literal)
        const skip: Citation['skip'] = heading
          ? 'heading'
          : lessonId === null
            ? 'no-lesson'
            : lessonLabel(BY_ID.get(lessonId)!) === literal
              ? null
              : 'label-mismatch'
        out.push({ file, line: lineNo, literal, lessonId, skip })
      }
    })
  })
  return out
}

/** Replace every convertible citation in a markdown text with its token. */
export function tokenizeText(text: string): string {
  let fenced = false
  return text
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        fenced = !fenced
        return line
      }
      if (fenced) return line
      if (/^\s*#{1,6}\s/.test(line)) return line
      const parts = line.split('`')
      return parts
        .map((part, j) => {
          if (j % 2 === 1) return part
          return part.replace(CITE_RE, (literal: string) => {
            const lessonId = lessonOf(literal)
            return lessonId !== null && lessonLabel(BY_ID.get(lessonId)!) === literal ? lessonToken(lessonId) : literal
          })
        })
        .join('`')
    })
    .join('\n')
}

export interface MdField {
  file: string
  line: number
  start: number
  end: number
  content: string
}

/** Every static markdown chunk in a source text, with its content range (the `${...}` values are not chunks). */
export function mdFieldsIn(source: string, file = ''): MdField[] {
  const out: MdField[] = []
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const walk = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node)
      if (name !== null && TEXT_FIELDS.has(name)) {
        for (const chunk of chunksOf(node.initializer, sf, source)) {
          out.push({ file, line: lineOf(sf, chunk.start), start: chunk.start, end: chunk.end, content: chunk.content })
        }
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return out
}

/** Every static markdown chunk in the lesson files. */
export function mdFields(): MdField[] {
  const out: MdField[] = []
  for (const file of files(LESSONS)) out.push(...mdFieldsIn(readFileSync(file, 'utf8'), file))
  return out
}

/** Every citation in the static markdown chunks of one source text. */
export function citationsFromSource(source: string, file = ''): Citation[] {
  const out: Citation[] = []
  for (const field of mdFieldsIn(source, file)) out.push(...citationsIn(field.content, file, field.line))
  return out
}

/** Every citation in a `md` field, converted or not. */
export function scanLessonCitations(): Citation[] {
  const out: Citation[] = []
  for (const file of files(LESSONS)) out.push(...citationsFromSource(readFileSync(file, 'utf8'), file))
  return out
}

/** The md fields that still hold a convertible citation. */
export function remainingCitations(): Citation[] {
  return scanLessonCitations().filter((c) => c.skip === null)
}

const main = (): number => {
  const args = process.argv.slice(2)
  const mode = args[0] ?? '--stats'
  if (!['--stats', '--check', '--write'].includes(mode) || args.length > 1) {
    console.error('usage: bun scripts/tokenize-lesson-citations.ts [--stats | --check | --write]')
    return 2
  }

  const all = scanLessonCitations()
  const convertible = all.filter((c) => c.skip === null)
  const byReason = new Map<string, number>()
  for (const c of all) byReason.set(c.skip ?? 'convertible', (byReason.get(c.skip ?? 'convertible') ?? 0) + 1)

  if (mode === '--stats') {
    console.log(`${all.length} citations in md fields:`)
    for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${reason}`)
    const filesWith = new Set(convertible.map((c) => c.file)).size
    console.log(`convertible: ${convertible.length} in ${filesWith} files`)
    for (const c of all.filter((x) => x.skip !== null)) console.log(`  ${c.skip}  ${c.file}:${c.line}  ${c.literal}`)
    return 0
  }

  if (mode === '--check') {
    if (convertible.length === 0) {
      console.log(`no convertible citation remains in md fields (${all.length} citations, all skipped for a stated reason)`)
      return 0
    }
    console.error(`${convertible.length} convertible citation${convertible.length === 1 ? '' : 's'} remain:`)
    for (const c of convertible) console.error(`  ${c.file}:${c.line}  ${c.literal}`)
    console.error('run bun scripts/tokenize-lesson-citations.ts --write')
    return 1
  }

  // --write: one pass per file, replacing each md initializer with its tokenized content
  const byFile = new Map<string, MdField[]>()
  for (const field of mdFields()) {
    const list = byFile.get(field.file)
    if (list) list.push(field)
    else byFile.set(field.file, [field])
  }
  let changedFiles = 0
  let changedFields = 0
  let changedCitations = 0
  for (const [file, fields] of byFile) {
    let source = readFileSync(file, 'utf8')
    const edits: { start: number; end: number; text: string }[] = []
    for (const field of fields) {
      const next = tokenizeText(field.content)
      if (next === field.content) continue
      changedFields += 1
      changedCitations += citationsIn(field.content, file, field.line).filter((c) => c.skip === null).length
      edits.push({ start: field.start, end: field.end, text: next })
    }
    if (edits.length === 0) continue
    for (const e of edits.sort((a, b) => b.start - a.start)) {
      source = source.slice(0, e.start) + e.text + source.slice(e.end)
    }
    writeFileSync(file, source)
    changedFiles += 1
  }
  console.log(`tokenized ${changedCitations} citations in ${changedFields} md chunks across ${changedFiles} files`)
  return 0
}

if (import.meta.main) process.exit(main())
