/**
 * verify-determinism — the determinism lint of docs/specs/wave-1.md §16.3 (invariant W3).
 *
 * Generators, the world engine, the Fleet watchdog and the learner planners must give the same
 * output for the same input in Bun, Chrome, Firefox and Safari. This walks the TypeScript AST (so
 * comments and strings never trip it) of every file in scope and fails on:
 *   - everywhere in scope: Math.random, Date.now, new Date(, Date(), performance.now and
 *     crypto.getRandomValues (time arrives as a parameter, randomness as a seed);
 *   - also in families/** and world/**: Math.exp, log, log2, log10, pow, sin, cos, tan, atan2, cbrt
 *     and hypot, whose last-bit results differ between engines;
 *   - aliasing that would hide either: a bare `Math` or `Date` value, `const { random } = Math`,
 *     and computed access such as `Math[name]`.
 * Grading and statistics files (grade.ts, staircase.ts, fsrs.ts, calibration.ts) are exempt by name.
 *
 * Scope: src/lib/items/families/**, src/lib/items/core.ts, src/lib/world/**, src/lib/fleet-*.ts and
 * src/lib/learner/{composer,placement,ticket,paths,recommend}.ts. Scope files that do not exist yet
 * are fine: each owning task lands its file under the lint already running.
 *
 * The spec's hash fixture (generator outputs for 100 seeds per family, tests/fixtures/items/hashes.json)
 * needs the generators and joins this script with B5.
 *
 *   bun scripts/verify-determinism.ts [--root <dir>]
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

interface Finding {
  line: number
  col: number
  message: string
}

/** Members that read the clock or the entropy pool, by the global that owns them. */
const NONDETERMINISTIC: Record<string, { members: ReadonlySet<string>; why: string }> = {
  Math: { members: new Set(['random']), why: 'draw from the seeded rng instead' },
  Date: { members: new Set(['now']), why: 'time must arrive as a parameter' },
  performance: { members: new Set(['now']), why: 'time must arrive as a parameter' },
  crypto: { members: new Set(['getRandomValues']), why: 'draw from the seeded rng instead' },
}
/** Math functions whose last bit differs between engines (families/** and world/** only). */
const ENGINE_DEPENDENT_MATH = new Set(['exp', 'log', 'log2', 'log10', 'pow', 'sin', 'cos', 'tan', 'atan2', 'cbrt', 'hypot'])
/** Globals a bare reference to would hide a banned member behind an alias. */
const ALIAS_GUARDED = new Set(['Math', 'Date'])
const GLOBAL_ROOTS = new Set(['globalThis', 'window', 'self'])
const EXEMPT_FILES = new Set(['grade.ts', 'staircase.ts', 'fsrs.ts', 'calibration.ts'])

/** Strips parentheses and casts: `(Math as any).random` is still Math. */
function unwrap(e: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isTypeAssertionExpression(e) ||
    ts.isSatisfiesExpression(e)
  ) {
    e = e.expression
  }
  return e
}

/** The global an expression names: `Math`, `globalThis.Math` and `window.Math` all give "Math". */
function globalOf(raw: ts.Expression): string | undefined {
  const e = unwrap(raw)
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && GLOBAL_ROOTS.has(e.expression.text)) return e.name.text
  return undefined
}

/** True when `id` is the name being declared or a property key, not a use of the global. */
function isNameOnly(id: ts.Identifier): boolean {
  const p = id.parent
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isExpressionWithTypeArguments(p)) return true
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true
  if (ts.isBindingElement(p)) return p.propertyName === id || p.name === id
  if (ts.isVariableDeclaration(p) || ts.isParameter(p)) return p.name === id
  if (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)) return p.name === id
  if (ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) return p.name === id
  if (ts.isEnumMember(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) {
    return p.name === id
  }
  // `x instanceof Date` reads no clock.
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && p.right === id) return true
  return false
}

function lintSource(fileName: string, text: string, numeric: boolean): Finding[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: Finding[] = []
  const report = (node: ts.Node, message: string) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    found.push({ line: line + 1, col: character + 1, message })
  }
  /** Reports `<global>.<member>` when it is banned in this file's scope. */
  const checkMember = (node: ts.Node, global: string, member: string) => {
    const rule = NONDETERMINISTIC[global]
    if (rule?.members.has(member)) report(node, `${global}.${member} is nondeterministic: ${rule.why}`)
    else if (numeric && global === 'Math' && ENGINE_DEPENDENT_MATH.has(member)) {
      report(node, `Math.${member} rounds differently between engines: use arithmetic or a lookup table`)
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const g = globalOf(node.expression)
      if (g) checkMember(node, g, node.name.text)
    } else if (ts.isElementAccessExpression(node)) {
      const g = globalOf(node.expression)
      if (g && (g in NONDETERMINISTIC)) {
        const key = node.argumentExpression
        if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) checkMember(node, g, key.text)
        else report(node, `computed access on ${g} can reach a banned member: name the member`)
      }
    } else if (ts.isNewExpression(node)) {
      if (globalOf(node.expression) === 'Date') report(node, 'new Date( reads the clock: time must arrive as a parameter')
    } else if (ts.isCallExpression(node)) {
      if (globalOf(node.expression) === 'Date') report(node, 'Date() reads the clock: time must arrive as a parameter')
    } else if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const g = globalOf(node.initializer)
      if (g && g in NONDETERMINISTIC) {
        for (const el of node.name.elements) {
          const key = el.propertyName ?? el.name
          if (!el.dotDotDotToken && (ts.isIdentifier(key) || ts.isStringLiteral(key))) checkMember(el, g, key.text)
          else report(el, `destructuring ${g} with a rest or computed key can reach a banned member`)
        }
      }
    } else if (ts.isIdentifier(node) && ALIAS_GUARDED.has(node.text) && !isNameOnly(node)) {
      let child: ts.Node = node
      let p = node.parent
      while (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p) || ts.isTypeAssertionExpression(p) || ts.isSatisfiesExpression(p)) {
        child = p
        p = p.parent
      }
      // Member access, `new Date(` and `Date(` are judged above; destructuring is judged on the declaration.
      const judgedAbove =
        ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p) || ts.isNewExpression(p) || ts.isCallExpression(p)) && p.expression === child) ||
        (ts.isVariableDeclaration(p) && p.initializer === child && ts.isObjectBindingPattern(p.name))
      if (!judgedAbove) report(node, `a bare ${node.text} value can hide a banned member behind an alias: call ${node.text} members directly`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found.sort((a, b) => a.line - b.line || a.col - b.col)
}

/* ------------------------------ scope ------------------------------ */

/** Whether a repo-relative posix path is linted, and whether the engine-dependent Math ban applies. */
function scopeOf(rel: string): { numeric: boolean } | null {
  if (!/\.tsx?$/.test(rel) || rel.endsWith('.d.ts')) return null
  if (EXEMPT_FILES.has(path.posix.basename(rel))) return null
  if (rel.startsWith('src/lib/items/families/') || rel.startsWith('src/lib/world/')) return { numeric: true }
  if (rel === 'src/lib/items/core.ts') return { numeric: false }
  if (/^src\/lib\/fleet-[^/]*\.tsx?$/.test(rel)) return { numeric: false }
  if (/^src\/lib\/learner\/(composer|placement|ticket|paths|recommend)\.tsx?$/.test(rel)) return { numeric: false }
  return null
}

function walk(dir: string, base: string, out: string[]): void {
  let entries
  try {
    entries = readdirSync(path.join(base, dir), { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) walk(rel, base, out)
    else if (e.isFile()) out.push(rel)
  }
}

/* ------------------------------ self-test ------------------------------ */

/** The lint must flag and pass what the spec says it does; a regression here would silently weaken the gate. */
function selfTest(): string[] {
  const cases: { name: string; src: string; numeric: boolean; expect: number }[] = [
    { name: 'Math.random', src: 'const x = Math.random()', numeric: false, expect: 1 },
    { name: 'optional chain', src: 'const x = Math?.random()', numeric: false, expect: 1 },
    { name: 'string key', src: "const x = Math['random']()", numeric: false, expect: 1 },
    { name: 'computed key', src: 'const x = Math[name]()', numeric: false, expect: 1 },
    { name: 'globalThis prefix', src: 'const x = globalThis.Math.random()', numeric: false, expect: 1 },
    { name: 'cast', src: 'const x = (Math as any).random()', numeric: false, expect: 1 },
    { name: 'destructure', src: 'const { random } = Math', numeric: false, expect: 1 },
    { name: 'alias', src: 'const M = Math\nM.random()', numeric: false, expect: 1 },
    { name: 'Date.now', src: 'const t = Date.now()', numeric: false, expect: 1 },
    { name: 'new Date', src: 'const t = new Date(0)', numeric: false, expect: 1 },
    { name: 'Date()', src: 'const t = Date()', numeric: false, expect: 1 },
    { name: 'performance.now', src: 'const t = performance.now()', numeric: false, expect: 1 },
    { name: 'getRandomValues', src: 'crypto.getRandomValues(new Uint8Array(4))', numeric: false, expect: 1 },
    { name: 'pow in numeric scope', src: 'const x = Math.pow(2, 3) + Math.log2(8) + Math.hypot(3, 4)', numeric: true, expect: 3 },
    { name: 'pow outside numeric scope', src: 'const x = Math.pow(2, 3) + Math.log2(8)', numeric: false, expect: 0 },
    { name: 'exact Math is fine', src: 'const x = Math.floor(Math.sqrt(Math.max(1, 2))) + Math.imul(3, 4) + Math.abs(-1)', numeric: true, expect: 0 },
    { name: 'comments and strings', src: "// Math.random\n/* Date.now() */\nconst s = 'new Date(' + `Math.random`", numeric: true, expect: 0 },
    { name: 'type and static uses', src: 'let d: Date | undefined\nconst u = Date.UTC(2024, 0, 1)\nconst ok = d instanceof Date\ntype T = typeof Math', numeric: true, expect: 0 },
    { name: 'property names', src: 'const o = { Math: 1, Date: 2 }\no.Math\no.Date', numeric: true, expect: 0 },
  ]
  const failures: string[] = []
  for (const c of cases) {
    const got = lintSource('selftest.ts', c.src, c.numeric).length
    if (got !== c.expect) failures.push(`self-test "${c.name}": expected ${c.expect} finding(s), got ${got}`)
  }
  return failures
}

/* ------------------------------ main ------------------------------ */

const rootArg = process.argv.indexOf('--root')
const root = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1] ?? '') : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const selfFailures = selfTest()
if (selfFailures.length > 0) {
  for (const f of selfFailures) console.error(f)
  console.error('verify-determinism: the lint itself is broken')
  process.exit(1)
}

const all: string[] = []
walk('src/lib', root, all)
const files = all.filter((rel) => scopeOf(rel)).sort()

let failures = 0
for (const rel of files) {
  const found = lintSource(rel, readFileSync(path.join(root, rel), 'utf8'), scopeOf(rel)!.numeric)
  for (const f of found) console.error(`${rel}:${f.line}:${f.col} ${f.message}`)
  failures += found.length
}

if (failures > 0) {
  console.error(`verify-determinism: ${failures} finding(s) in ${files.length} file(s) (docs/specs/wave-1.md §16.3)`)
  process.exit(1)
}
console.log(`verify-determinism: ${files.length} file(s) in scope, 0 findings`)
