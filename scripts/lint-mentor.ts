/**
 * lint-mentor: holds lab 01's authored hint ladder to its limits (docs/specs/wave-1.md §13.2).
 *
 *   bun run verify:mentor
 *
 * For every required check of lab 01 (src/data/labs.ts), in src/data/forge/rust-allocator/ladder.ts:
 * - the ladder has R0 to R4, and R0 has the prompt and exactly three ideas;
 * - the word limits hold: R1 ≤ 60, R2 ≤ 40, R4 ≤ 80 (the prompt and each idea ≤ 30);
 * - R1 links to a lesson H2 that exists, and R2 names the check's function in lib.rs, which exists;
 * - R3 is at most three lines and is not Rust: no `fn `, `impl `, `pub `, `let `, `mut ` or `struct `,
 *   no `;`, no `::` and no line that ends a block with `{` or `}`;
 * - no rung quotes a `_solutions` file (labs/_solutions never ships, owner answer O1);
 * and there is no ladder for a check the lab does not have.
 * Limits live in ladder.ts (`LIMITS`), so the component and the lint cannot drift apart.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FORGE_LABS } from '../src/data/labs'
import { ALL_LESSONS } from '../src/data/lessons'
import { LADDER, LAB_ID, LIMITS, wordCount } from '../src/data/forge/rust-allocator/ladder'
import type { CheckLadder } from '../src/data/forge/rust-allocator/ladder'
import { extractHeadings } from '../src/pages/lesson/markdown'

const ROOT = resolve(import.meta.dir, '..')

export interface LintDeps {
  /** Required check ids of the lab, in grading order. */
  required: readonly string[]
  /** `labs/rust-allocator/src/lib.rs`. */
  libRs: string
  /** Lesson id -> the ids of its H2s as the lesson page renders them. */
  h2s: ReadonlyMap<string, ReadonlySet<string>>
}

/** Rust-looking R3 content: a keyword that starts a declaration, a statement end or a block edge. */
const RUST_WORD = /\b(fn|impl|pub|let|mut|struct)\s/
const RUST_PUNCT = /;|::/
const BLOCK_EDGE = /[{}]\s*$/

/** Every problem with the ladder, one line each; empty when it passes. */
export function lintLadder(ladder: Readonly<Record<string, CheckLadder>>, deps: LintDeps): string[] {
  const problems: string[] = []
  for (const id of Object.keys(ladder)) if (!deps.required.includes(id)) problems.push(`${id}: a ladder for a check lab 01 does not require`)
  for (const id of deps.required) {
    const c = ladder[id] as CheckLadder | undefined
    if (c === undefined) {
      problems.push(`${id}: no ladder (every required check needs R0 to R4)`)
      continue
    }
    const bad = (msg: string) => problems.push(`${id}: ${msg}`)
    const text = (rung: string, s: unknown): s is string => {
      if (typeof s === 'string' && s.trim() !== '') return true
      bad(`${rung} is missing`)
      return false
    }
    const limit = (rung: string, s: string, max: number) => {
      const n = wordCount(s)
      if (n > max) bad(`${rung} has ${n} words (limit ${max})`)
    }

    if (c.checkId !== id) bad(`checkId is ${JSON.stringify(c.checkId)}`)

    // R0
    if (text('R0 prompt', c.r0?.prompt)) limit('R0 prompt', c.r0.prompt, LIMITS.promptWords)
    const ideas = c.r0?.ideas ?? []
    if (ideas.length !== 3) bad(`R0 has ${ideas.length} ideas (needs three)`)
    ideas.forEach((idea, i) => {
      if (text(`R0 idea ${i + 1}`, idea)) limit(`R0 idea ${i + 1}`, idea, LIMITS.ideaWords)
    })
    if (new Set(ideas).size !== ideas.length) bad('R0 repeats an idea')

    // R1
    if (text('R1', c.r1?.text)) limit('R1', c.r1.text, LIMITS.r1Words)
    const link = c.r1?.link
    if (link === undefined) bad('R1 has no lesson link')
    else if (deps.h2s.get(link.lessonId)?.has(link.anchor) !== true) bad(`R1 links to #${link.anchor} in ${link.lessonId}, which is not an H2 there`)

    // R2
    if (text('R2', c.r2?.text)) {
      limit('R2', c.r2.text, LIMITS.r2Words)
      if (!c.r2.text.includes('lib.rs')) bad('R2 does not name lib.rs')
      if (!c.r2.text.includes(c.r2.fn)) bad(`R2 does not name ${c.r2.fn}`)
    }
    if (c.r2?.fn !== undefined && !new RegExp(`\\bfn ${c.r2.fn}\\(`).test(deps.libRs)) bad(`R2 points at ${c.r2.fn}, which lib.rs does not define`)

    // R3
    if (text('R3', c.r3)) {
      const lines = c.r3.split('\n')
      if (lines.length > LIMITS.r3Lines) bad(`R3 has ${lines.length} lines (limit ${LIMITS.r3Lines})`)
      if (lines.some((l) => l.trim() === '')) bad('R3 has an empty line')
      const word = RUST_WORD.exec(c.r3)
      if (word !== null) bad(`R3 reads as Rust: "${word[0].trim()}"`)
      if (RUST_PUNCT.test(c.r3)) bad('R3 reads as Rust: it has ";" or "::"')
      if (lines.some((l) => BLOCK_EDGE.test(l))) bad('R3 reads as Rust: a line ends in a brace')
      if (c.r3.includes('`')) bad('R3 is pseudo-code, not a code span')
    }

    // R4
    if (text('R4', c.r4)) limit('R4', c.r4, LIMITS.r4Words)

    // No rung quotes a private file.
    const all = [c.r0?.prompt, ...ideas, c.r1?.text, c.r2?.text, c.r3, c.r4]
    if (all.some((s) => typeof s === 'string' && s.includes('_solutions'))) bad('a rung mentions _solutions (the reference solutions never ship)')
  }
  return problems
}

function main(): number {
  const lab = FORGE_LABS.find((l) => l.id === LAB_ID)
  if (lab === undefined) {
    console.error(`lint-mentor: lab ${LAB_ID} is not in src/data/labs.ts`)
    return 1
  }
  const h2s = new Map<string, Set<string>>()
  for (const l of ALL_LESSONS) h2s.set(l.id, new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.id)))
  const required = lab.checks.filter((c) => c.optional !== true).map((c) => c.id)
  const libRs = readFileSync(join(ROOT, 'labs', LAB_ID, 'src', 'lib.rs'), 'utf8')
  const problems = lintLadder(LADDER, { required, libRs, h2s })
  if (problems.length > 0) {
    console.error(`lint-mentor: ${problems.length} problem${problems.length === 1 ? '' : 's'}`)
    for (const p of problems) console.error(`  ${p}`)
    return 1
  }
  console.log(`lint-mentor: ok, ${required.length} checks, ${required.length * 5} rungs (R0 to R4) within limits`)
  return 0
}

if (import.meta.main) process.exit(main())
