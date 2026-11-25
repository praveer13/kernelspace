/**
 * Writes src/data/lessons/claims.generated.ts: the claim values lesson modules read while they evaluate (K0-Z2 fix round).
 * A lesson reads them from this snapshot, so the lessons registry depends on no claims chunk and awaits nothing.
 * The ids are collected from the readers and from `[[c:<id>]]` tokens in lesson source; a token shown in a code sample is
 * counted conservatively (the scanners read raw TS, not rendered markdown).
 * The ids are collected from the readers (claimNumber, claimCite, claimRelease under src/data/lessons/ and in any file that
 * imports the reader), so no list is kept by hand. Run `bun scripts/gen-lesson-claims.ts` after a claim or a read changes;
 * `--check` exits 1 when the file is stale; `--out <path>` points the check or the write at another file.
 * tests/claims/k0-e2-cli.test.ts runs the command in the unit suite.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { claimNumber, formatClaimValue, getClaim } from '../src/data/claims'
import { claimTokensIn } from '../src/lib/claim-token-syntax'
import '../src/data/claims/all'
import { claimCite, claimRelease } from '../src/data/claims/cite'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const LESSONS = `${SRC}data/lessons/`

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = `${dir}${f}`
    return statSync(p).isDirectory() ? tsFiles(`${p}/`) : /\.tsx?$/.test(p) ? [p] : []
  })
}

/** The module specifiers of one file: static imports, side-effect imports, re-exports and import(). */
function specifiers(src: string): string[] {
  return [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]!)
}

/** A '@/' or relative specifier as an absolute path without extension; null for a package. */
function targetOf(file: string, spec: string): string | null {
  if (spec.startsWith('@/')) return `${SRC}${spec.slice(2)}`
  if (spec.startsWith('.')) return new URL(spec, `file://${file}`).pathname
  return null
}

function isClaimsPath(target: string): boolean {
  return target === `${SRC}data/claims` || target.startsWith(`${SRC}data/claims/`) || target.startsWith(`${SRC}data/claims.`)
}

/** The file a path stands for: the path itself, then .ts, .tsx, /index.ts, /index.tsx; null when none exists. */
function resolveFile(target: string): string | null {
  for (const c of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

/** The specifiers of one file that land in src/data/claims, read from that file alone. */
export function claimImports(file: string, src: string): string[] {
  return specifiers(src).filter((spec) => {
    const t = targetOf(file, spec)
    return t !== null && isClaimsPath(t)
  })
}

/**
 * Every path from a file under src/data/lessons/ to src/data/claims, through modules outside src/data/lessons/ too.
 * Depth first with a visited set; a module inside src/data/lessons/ is scanned as a lesson file of its own.
 * Each result reads "importer -> specifier" with the importer relative to src/.
 */
export function claimPathsFrom(entry: string, visited: Set<string> = new Set()): string[] {
  if (visited.has(entry)) return []
  visited.add(entry)
  const found: string[] = []
  for (const spec of specifiers(readFileSync(entry, 'utf8'))) {
    const t = targetOf(entry, spec)
    if (t === null) continue
    if (isClaimsPath(t)) {
      found.push(`${entry.slice(SRC.length)} -> ${spec}`)
      continue
    }
    const next = resolveFile(t)
    if (next && !next.startsWith(LESSONS)) found.push(...claimPathsFrom(next, visited))
  }
  return found
}

/** The ids read as claimNumber('<id>'), claimCite('<id>') or claimRelease('<id>') in the lessons and in every importer of the reader. */
export function lessonClaimReads(): { ids: string[]; files: string[]; tokenIds: string[] } {
  const reader = `${LESSONS}claims`
  const files = tsFiles(SRC).filter((f) => {
    if (f.endsWith('/lessons/claims.ts') || f.endsWith('claims.generated.ts')) return false
    if (f.startsWith(LESSONS)) return true
    return specifiers(readFileSync(f, 'utf8')).some((spec) => targetOf(f, spec) === reader)
  })
  const ids = new Set<string>()
  const tokenIds = new Set<string>()
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    for (const m of text.matchAll(/claim(?:Number|Cite|Release)\(\s*'([^']+)'/g)) ids.add(m[1]!)
    // a [[c:<id>]] token renders a claim in prose; it needs the value with its unit in the snapshot
    for (const t of claimTokensIn(text)) {
      ids.add(t.id)
      tokenIds.add(t.id)
    }
    // a statline chip that names a claim renders from the same snapshot row
    for (const m of text.matchAll(/\bclaim:\s*'([a-z0-9._-]+)'/g)) {
      ids.add(m[1]!)
      tokenIds.add(m[1]!)
    }
  }
  return { ids: [...ids].sort(), files, tokenIds: [...tokenIds].sort() }
}

/** Every id a lesson, or a file that imports ../claims, reads or renders as a token. Collected; nothing is typed here. */
export const LESSON_CLAIMS: string[] = lessonClaimReads().ids

/** The ids a lesson renders as a `[[c:<id>]]` token: the rows that also carry the value with its unit. */
export const LESSON_TOKEN_CLAIMS: string[] = lessonClaimReads().tokenIds

export const OUT = new URL('../src/data/lessons/claims.generated.ts', import.meta.url)

export function render(): string {
  const rows = LESSON_CLAIMS.map((id) => {
    const claim = getClaim(id)
    const parts = [`    cite: ${JSON.stringify(claimCite_(id))}`]

    if (typeof claim.value === 'number') parts.unshift(`    value: ${claimNumber(id)}`)
    if (claim.pin) parts.push(`    release: ${JSON.stringify(claimRelease(id))}`)
    return `  ${JSON.stringify(id)}: {\n${parts.join(',\n')},\n  },`
  })
  return `// Generated by scripts/gen-lesson-claims.ts from the claims registry; do not edit by hand.\nexport const LESSON_CLAIM_VALUES: Record<string, { value?: number; cite: string; release?: string }> = {\n${rows.join('\n')}\n}\n`
}

/**
 * The token map: only the ids lessons render as `[[c:<id>]]`, with the value, the cite and the read date. It is a
 * separate generated file so the prose chunk never imports the full lesson snapshot (K0-Z-D12: the entry's preload map
 * stays free of a claims chunk).
 */
export function renderTokens(): string {
  const rows = LESSON_TOKEN_CLAIMS.map((id) => {
    const claim = getClaim(id)
    const cite = claim.pin ? claimCite(id) : formatClaimValue(claim)
    return `  ${JSON.stringify(id)}: { text: ${JSON.stringify(formatClaimValue(claim))}, cite: ${JSON.stringify(cite)}, read: ${JSON.stringify(claim.verifiedAt)} },`
  })
  return `// Generated by scripts/gen-lesson-claims.ts from the claims registry; do not edit by hand.\nexport const LESSON_TOKEN_VALUES: Record<string, { text: string; cite: string; read: string }> = {\n${rows.join('\n')}\n}\n`
}

export const OUT_TOKENS = new URL('../src/data/lessons/claims.tokens.generated.ts', import.meta.url)

function claimCite_(id: string): string {
  return getClaim(id).pin ? claimCite(id) : String(getClaim(id).value)
}

if (import.meta.main) {
  const at = process.argv.indexOf('--out')
  const out = at >= 0 ? process.argv[at + 1] : undefined
  if (at >= 0 && !out) {
    console.error('--out needs a path')
    process.exit(2)
  }
  const check = process.argv.includes('--check')
  const put = (path: string, text: string): boolean => {
    if (check) {
      if (readFileSync(path, 'utf8') !== text) {
        console.error(`${path} is stale; run bun scripts/gen-lesson-claims.ts`)
        return false
      }
      return true
    }
    writeFileSync(path, text)
    return true
  }
  if (out) {
    process.exit(put(out, render()) ? 0 : 1)
  }
  const ok = put(OUT.pathname, render()) && put(OUT_TOKENS.pathname, renderTokens())
  process.exit(ok ? 0 : 1)
}
