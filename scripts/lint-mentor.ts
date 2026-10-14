/**
 * lint-mentor: holds every lab's authored hint ladder to its limits (docs/specs/wave-1.md §13.2, wave-2.md §13.1).
 *
 *   bun run verify:mentor
 *
 * For every lab with a Forge bundle (src/data/forge/<labId>/index.ts) that has a ladder, and for every required check
 * of that lab (src/data/labs.ts):
 * - the ladder has R0 to R4, and R0 has the prompt and exactly three ideas; a bundle with `fade: 'r2'` (wave-3.md
 *   §4.2, §8.2: ladders stop at R2 and the packet follows) needs R0 to R2 and may omit R3 and R4;
 * - the word limits hold: R1 ≤ 60, R2 ≤ 40, R4 ≤ 80 (the prompt and each idea ≤ 30);
 * - R1 links to a lesson H2 that exists, and R2 names the check's function in lib.rs, which exists;
 * - R3 is at most three lines and is not Rust: no `fn `, `impl `, `pub `, `let `, `mut ` or `struct `,
 *   no `;`, no `::` and no line that ends a block with `{` or `}`;
 * - no rung quotes a `_solutions` file (labs/_solutions never ships, owner answer O1);
 * every other rule stands for a faded bundle, and applies to an R3 or R4 it does write;
 * there is no ladder for a check the lab does not require, and the bundle's Ask-a-human label reads "[lab NN]".
 * Limits live in lab 01's ladder.ts (`LIMITS`), so the component and the lint cannot drift apart.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FORGE_LABS } from '../src/data/labs'
import { ALL_LESSONS } from '../src/data/lessons'
import { loadAllForgeBundles } from '../src/data/forge'
import { LIMITS, wordCount } from '../src/data/forge/rust-allocator/ladder'
import type { CheckLadder, ForgeBundle } from '../src/data/forge/types'
import { extractHeadings } from '../src/pages/lesson/markdown'

const ROOT = resolve(import.meta.dir, '..')

export interface LintDeps {
  /** Required check ids of the lab, in grading order. */
  required: readonly string[]
  /** The lab's `labs/<lab>/src/lib.rs`. */
  libRs: string
  /** Lesson id -> the ids of its H2s as the lesson page renders them. */
  h2s: ReadonlyMap<string, ReadonlySet<string>>
  /** `'r2'`: the bundle's ladders stop at R2, so R3 and R4 are optional. `lintBundle` sets it from the bundle. */
  fade?: 'r2'
}

/** Rust-looking R3 content: a keyword that starts a declaration, a statement end or a block edge. */
const RUST_WORD = /\b(fn|impl|pub|let|mut|struct)\s/
const RUST_PUNCT = /;|::/
const BLOCK_EDGE = /[{}]\s*$/

/** Every problem with the ladder, one line each; empty when it passes. */
export function lintLadder(ladder: Readonly<Record<string, CheckLadder>>, deps: LintDeps): string[] {
  const problems: string[] = []
  const faded = deps.fade === 'r2'
  for (const id of Object.keys(ladder)) if (!deps.required.includes(id)) problems.push(`${id}: a ladder for a check the lab does not require`)
  for (const id of deps.required) {
    const c = ladder[id] as CheckLadder | undefined
    if (c === undefined) {
      problems.push(`${id}: no ladder (every required check needs R0 to ${faded ? 'R2' : 'R4'})`)
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

    // R3 (a faded bundle may omit it; one it writes is held to the same rules)
    if ((c.r3 !== undefined || !faded) && text('R3', c.r3)) {
      const lines = c.r3.split('\n')
      if (lines.length > LIMITS.r3Lines) bad(`R3 has ${lines.length} lines (limit ${LIMITS.r3Lines})`)
      if (lines.some((l) => l.trim() === '')) bad('R3 has an empty line')
      const word = RUST_WORD.exec(c.r3)
      if (word !== null) bad(`R3 reads as Rust: "${word[0].trim()}"`)
      if (RUST_PUNCT.test(c.r3)) bad('R3 reads as Rust: it has ";" or "::"')
      if (lines.some((l) => BLOCK_EDGE.test(l))) bad('R3 reads as Rust: a line ends in a brace')
      if (c.r3.includes('`')) bad('R3 is pseudo-code, not a code span')
    }

    // R4 (as R3)
    if ((c.r4 !== undefined || !faded) && text('R4', c.r4)) limit('R4', c.r4, LIMITS.r4Words)

    // No rung quotes a private file.
    const all = [c.r0?.prompt, ...ideas, c.r1?.text, c.r2?.text, c.r3, c.r4]
    if (all.some((s) => typeof s === 'string' && s.includes('_solutions'))) bad('a rung mentions _solutions (the reference solutions never ship)')
  }
  return problems
}

/** The bundle's ladder keyed by check id; a check laddered twice is a problem. */
export function ladderOf(bundle: Pick<ForgeBundle, 'ladder'>): { ladder: Record<string, CheckLadder>; problems: string[] } {
  const ladder: Record<string, CheckLadder> = {}
  const problems: string[] = []
  for (const c of bundle.ladder) {
    if (c.checkId in ladder) problems.push(`${c.checkId}: laddered twice`)
    ladder[c.checkId] = c
  }
  return { ladder, problems }
}

/** The "[lab NN]" the Ask-a-human title starts with. */
const LABEL = /^\[lab \d\d\]$/

/** Every problem with one bundle's ladder and label, one line each; empty when it passes. */
export function lintBundle(bundle: ForgeBundle, deps: LintDeps): string[] {
  const { ladder, problems } = ladderOf(bundle)
  if (!LABEL.test(bundle.discussionsLabel)) problems.push(`discussionsLabel is ${JSON.stringify(bundle.discussionsLabel)} (it reads "[lab NN]")`)
  return [...problems, ...lintLadder(ladder, bundle.fade === undefined ? deps : { ...deps, fade: bundle.fade })]
}

async function main(): Promise<number> {
  const h2s = new Map<string, Set<string>>()
  for (const l of ALL_LESSONS) h2s.set(l.id, new Set(extractHeadings(l.blocks).filter((h) => h.level === 2).map((h) => h.id)))
  const failures: string[] = []
  const done: string[] = []
  for (const bundle of await loadAllForgeBundles()) {
    if (bundle.ladder.length === 0) continue
    const lab = FORGE_LABS.find((l) => l.id === bundle.labId)
    if (lab === undefined) {
      failures.push(`${bundle.labId}: the lab is not in src/data/labs.ts`)
      continue
    }
    const required = lab.checks.filter((c) => c.optional !== true).map((c) => c.id)
    const libRs = readFileSync(join(ROOT, 'labs', lab.crateDir ?? lab.id, 'src', 'lib.rs'), 'utf8')
    const problems = lintBundle(bundle, { required, libRs, h2s })
    for (const p of problems) failures.push(`${bundle.labId}: ${p}`)
    done.push(`${bundle.labId} ${required.length} checks, ${required.length * (bundle.fade === 'r2' ? 3 : 5)} rungs`)
  }
  if (failures.length > 0) {
    console.error(`lint-mentor: ${failures.length} problem${failures.length === 1 ? '' : 's'}`)
    for (const p of failures) console.error(`  ${p}`)
    return 1
  }
  if (done.length === 0) {
    console.error('lint-mentor: no lab has a ladder')
    return 1
  }
  console.log(`lint-mentor: ok, ${done.length} lab${done.length === 1 ? '' : 's'} (${done.join('; ')}), every rung within limits`)
  return 0
}

if (import.meta.main) process.exit(await main())
