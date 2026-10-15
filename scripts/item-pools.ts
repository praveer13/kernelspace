/**
 * The pure half of verify-items v2 (spec §6.5, 2a-18): collectors for the pools that are not lesson quizzes, the item
 * structure rules, the Wave 2 bar and the always-B band. verify-items.ts is a script (top-level awaits, process.exit), so
 * anything a test must import lives here, next to item-cues.ts, which holds the strategies. No side effects.
 */

import { readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { QuizQuestion } from '../src/components/QuizBlock'
import type { Lesson } from '../src/data/lessons/types'
import { PROTEGE_STEPS, protegeErrors, stepQuestion, stepRef } from '../src/lib/learner/protege'
import { shuffledOrder } from '../src/lib/rng'
import { type CueQuestion, type CueStrategy, MAX_RANK_LESSON, MAX_RANK_SUBSET_OPTIONS, PASS_BAR, passProbability } from './item-cues'

/** Spec §6.5: every blind strategy's expected lessons passed over the lesson pool may be at most this. */
export const WAVE2_BAR = 2.0

/** The bar line verify-items prints, for a lesson pool of `lessons` lessons ("Wave 2 bar: ≤ 2 of 68"). */
export const barLine = (lessons: number) => `Wave 2 bar: ≤ ${WAVE2_BAR} of ${lessons}`

/* ------------------------------ structure ------------------------------ */

/** Structural defects of one item: option count, duplicates, `correct`, the explanation when required, a malformed `why`. */
export function structureErrors(q: QuizQuestion, needsExplanation: boolean): string[] {
  const { options, correct, multi, explanation, why } = q
  const errs: string[] = []
  if (!Array.isArray(options) || options.length < 2) errs.push('fewer than 2 options')
  if (Array.isArray(options) && options.length > MAX_RANK_SUBSET_OPTIONS) {
    errs.push(`${options.length} options; the rank-subset strategies of item-cues.ts cover at most ${MAX_RANK_SUBSET_OPTIONS}, raise MAX_RANK_SUBSET_OPTIONS`)
  }
  const texts = (options ?? []).map((o) => o.trim())
  if (new Set(texts).size !== texts.length) errs.push('duplicate option text')
  if (!Array.isArray(correct) || correct.length === 0) {
    errs.push('empty correct')
  } else {
    const n = options?.length ?? 0
    if (correct.some((c) => !Number.isInteger(c) || c < 0 || c >= n)) errs.push('correct index out of range')
    if (new Set(correct).size !== correct.length) errs.push('duplicate correct index')
    if (correct.length > 1 && !multi) errs.push('more than one correct index without multi: true')
  }
  if (needsExplanation && !explanation?.trim()) errs.push('missing or empty explanation')
  if (why !== undefined) {
    if (!Array.isArray(why) || why.length !== (options?.length ?? 0)) {
      errs.push(`why has ${Array.isArray(why) ? why.length : 'no'} entries for ${options?.length ?? 0} options`)
    } else if (why.some((w) => typeof w !== 'string' || !w.trim())) {
      errs.push('why has an empty entry')
    }
  }
  return errs
}

/* ------------------------------ pools ------------------------------ */

/** One learner-facing multiple-choice item outside the lesson quizzes, with the pool it belongs to. */
export interface PoolItem {
  pool: string
  /** The ledger ref: `item:<lessonId>.align.<n>` for an alignment item, `item:<lessonId>.iso.<n>.break` for a break item, `item:lab<NN>.twin.<n>` for a twin question. */
  ref: string
  /** The lesson the item is authored in (a twin's lab file name for a twin question). */
  lessonId: string
  q: QuizQuestion
  needsExplanation: boolean
  /** The KCs the item is read against: the block's, else the lesson's (iso); the item's own (twin). Not read by the gates. */
  kcs?: readonly string[]
}

/** The own pool of alignment items on code blocks (`CodeBlockData.align`, spec §17.2). */
export const ALIGN_POOL = 'align'

/**
 * Every alignment item of every code block, in lesson and block order. The ref is `item:<lessonId>.align.<n>`, with n the
 * 1-based count of the lesson's alignment items (spec §17.2). No lesson has one until Wave 2c, so the pool is empty today.
 */
export function collectAlignItems(lessons: readonly Lesson[]): PoolItem[] {
  const out: PoolItem[] = []
  for (const lesson of lessons) {
    let n = 0
    for (const block of lesson.blocks) {
      if (block.type !== 'code') continue
      for (const q of block.align ?? []) {
        n++
        out.push({ pool: ALIGN_POOL, ref: `item:${lesson.id}.align.${n}`, lessonId: lesson.id, q, needsExplanation: false })
      }
    }
  }
  return out
}

/** The own pool of P3 break items, `IsomorphismBlock.breakItem` (wave-3.md §11.1). */
export const ISO_POOL = 'iso'

/**
 * Every isomorphism block's break item, in lesson and block order. The ref is `item:<lessonId>.iso.<n>.break` with n the 1-based
 * count of the lesson's isomorphism blocks, those without a break item counted too (the lesson records the block's own align step as
 * `item:<lessonId>.iso.<n>`, so a block keeps its number whether or not it has a break item). The KCs are the block's, else the lesson's.
 */
export function collectIsoItems(lessons: readonly Lesson[]): PoolItem[] {
  const out: PoolItem[] = []
  for (const lesson of lessons) {
    let n = 0
    for (const block of lesson.blocks) {
      if (block.type !== 'isomorphism') continue
      n++
      if (!block.breakItem) continue
      out.push({ pool: ISO_POOL, ref: `item:${lesson.id}.iso.${n}.break`, lessonId: lesson.id, q: block.breakItem, needsExplanation: false, kcs: block.kcs ?? lesson.kcs })
    }
  }
  return out
}

/** The own pool of P4 protégé items: the find, tag and fix steps of every `ProtegeBlock` (wave-3.md §16.9). */
export const PROTEGE_POOL = 'protege'

/**
 * Every protégé block's three steps, in lesson and block order: `item:<lessonId>.protege.<n>.find`, `.tag` and `.fix`, with n the
 * 1-based count of the lesson's protégé blocks (src/lib/learner/protege.ts numbers them the same way). The find question is
 * built from the block (its options are sentence numbers); tag and fix are the block's own questions. The KCs are the block's, else the lesson's.
 */
export function collectProtegeItems(lessons: readonly Lesson[]): PoolItem[] {
  const out: PoolItem[] = []
  for (const lesson of lessons) {
    let n = 0
    for (const block of lesson.blocks) {
      if (block.type !== 'protege') continue
      n++
      for (const step of PROTEGE_STEPS) {
        out.push({ pool: PROTEGE_POOL, ref: stepRef(lesson.id, n, step), lessonId: lesson.id, q: stepQuestion(block, step), needsExplanation: false, kcs: block.kcs ?? lesson.kcs })
      }
    }
  }
  return out
}

/** The block-level defects of every protégé block (passage length, false sentence, find offer, one key per question), one line each naming the block. */
export function protegeFailures(lessons: readonly Lesson[]): string[] {
  return lessons.flatMap((lesson) => {
    let n = 0
    return lesson.blocks.flatMap((block) => {
      if (block.type !== 'protege') return []
      n++
      return protegeErrors(block).map((e) => `protege: item:${lesson.id}.protege.${n} "${block.title}": ${e}`)
    })
  })
}

/**
 * The structure of every entry of an own pool, plus the rule that each carries a why per option (the explanation is the why,
 * unless `needsExplanation`). Valid entries come back for the cue gates; the rest are named in `failures`.
 */
export function checkPoolItems<T extends { pool: string; ref: string; q: QuizQuestion; needsExplanation: boolean }>(
  entries: readonly T[],
): { valid: T[]; failures: string[] } {
  const valid: T[] = []
  const failures: string[] = []
  for (const e of entries) {
    const errs = structureErrors(e.q, e.needsExplanation)
    if (e.q.why === undefined) errs.push('missing per-option why')
    if (errs.length) failures.push(`structure: ${e.ref} (${e.pool}): ${errs.join('; ')}`)
    else valid.push(e)
  }
  return { valid, failures }
}

/* ------------------------------ PRIMM pools ------------------------------ */

/** One lab's PRIMM multiple-choice items: a pseudo-lesson, graded at PASS_BAR like a lesson. */
export interface PrimmLab {
  /** The directory under src/data/forge/. */
  lab: string
  items: readonly { id: string; q: QuizQuestion }[]
}

/** What a readdir discovery found, and what it could not load: a problem is a failure of verify:items, never a silent skip. */
export interface Discovery<T> {
  found: T[]
  /** One line per module that threw on import or exports its list as something that is not an array. */
  problems: string[]
}

/** The text of a thrown value, for a problem line. */
const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))

/**
 * Import one module and return its exports. A module that throws on import is a problem naming the file and the error, never a
 * skip: a throwing module would otherwise leave its pool and escape every gate.
 */
async function importModule(file: URL, label: string, problems: string[]): Promise<Record<string, unknown> | null> {
  try {
    return (await import(file.href)) as Record<string, unknown>
  } catch (e) {
    problems.push(`import: ${label} failed to import (${errorText(e)}); a pool module that does not load leaves its pool and escapes the gates`)
    return null
  }
}

/** Whether a file exists: a lab without a primm.ts is not a pool, a primm.ts that exists but does not load is a problem. */
const exists = (file: URL) =>
  stat(fileURLToPath(file)).then(
    (st) => st.isFile(),
    () => false,
  )

/**
 * Every `<dir>/<lab>/primm.ts` that exports `PRIMM_MC_ITEMS`, found by readdir so a new lab joins without a code change
 * (labs 02-03 when Wave 2c lands). A lab without a primm.ts, or whose primm.ts exports no list, is not a pool; a primm.ts that
 * throws on import, or exports a `PRIMM_MC_ITEMS` that is not an array, is a reported problem (`problems`).
 */
export async function discoverPrimm(dir: URL): Promise<Discovery<PrimmLab>> {
  const found: PrimmLab[] = []
  const problems: string[] = []
  const base = dir.href.endsWith('/') ? dir : new URL(`${dir.href}/`)
  const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = new URL(`${entry.name}/primm.ts`, base)
    if (!(await exists(file))) continue
    const label = `${entry.name}/primm.ts`
    const mod = await importModule(file, label, problems)
    if (!mod || !('PRIMM_MC_ITEMS' in mod)) continue
    if (Array.isArray(mod.PRIMM_MC_ITEMS)) found.push({ lab: entry.name, items: mod.PRIMM_MC_ITEMS as PrimmLab['items'] })
    else problems.push(`import: ${label} exports PRIMM_MC_ITEMS that is not an array`)
  }
  return { found, problems }
}

/* ------------------------------ twin pool ------------------------------ */

/** The own pool of production-twin tracing questions (`TWIN_ITEMS` of src/data/twins/<lab>.ts, wave-3.md §9). */
export const TWIN_POOL = 'twin'

/** One lab's twin questions, as the module exports them. */
export interface TwinFile {
  /** The file name under src/data/twins/, without `.ts`. */
  lab: string
  /** The module's `default.labNo` ('07'), else the file name: the ref reads `item:lab<labNo>.twin.<n>`. */
  labNo: string
  items: readonly { id: string; q: QuizQuestion; kcs?: readonly string[] }[]
}

/**
 * Every `<dir>/<lab>.ts` that exports `TWIN_ITEMS`, found by readdir so a twin joins without a code change (the discoverPrimm
 * pattern). The registry (`index.ts`) and `types.ts` are not twins; a file that exports no list is not a pool. A file that throws on
 * import, or exports a `TWIN_ITEMS` that is not an array, is a reported problem (`problems`), so hand-written twin content cannot leave the pool unseen.
 */
export async function discoverTwins(dir: URL): Promise<Discovery<TwinFile>> {
  const found: TwinFile[] = []
  const problems: string[] = []
  const base = dir.href.endsWith('/') ? dir : new URL(`${dir.href}/`)
  const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith('.ts')).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'index.ts' || entry.name === 'types.ts') continue
    const mod = await importModule(new URL(entry.name, base), `twins/${entry.name}`, problems)
    if (!mod || !('TWIN_ITEMS' in mod)) continue
    if (!Array.isArray(mod.TWIN_ITEMS)) {
      problems.push(`import: twins/${entry.name} exports TWIN_ITEMS that is not an array`)
      continue
    }
    const lab = entry.name.slice(0, -'.ts'.length)
    const dflt = mod.default as { labNo?: unknown } | undefined
    const labNo = typeof dflt?.labNo === 'string' ? dflt.labNo : lab
    found.push({ lab, labNo, items: mod.TWIN_ITEMS as TwinFile['items'] })
  }
  return { found, problems }
}

/** Every twin question, in lab and item order, with the ref `item:lab<NN>.twin.<n>` (n from 1 within the lab). */
export function collectTwinItems(twins: readonly TwinFile[]): PoolItem[] {
  return twins.flatMap((t) => t.items.map((item, i) => ({ pool: TWIN_POOL, ref: `item:lab${t.labNo}.twin.${i + 1}`, lessonId: t.lab, q: item.q, needsExplanation: false, kcs: item.kcs })))
}

/* ------------------------------ pseudo-lessons ------------------------------ */

/**
 * The failures of one pseudo-lesson (a spiral's eight items, a lab's PRIMM items): any strategy that passes it at PASS_BAR
 * with probability at least MAX_RANK_LESSON. Pseudo-lessons are not in the lesson pool of the Wave 2 bar, so each is held to
 * the per-lesson bar on its own.
 */
export function pseudoLessonFailures(name: string, items: readonly CueQuestion[], strategies: readonly CueStrategy[]): string[] {
  const out: string[] = []
  if (!items.length) return out
  for (const s of strategies) {
    const p = passProbability(items.map(s.pick))
    if (p >= MAX_RANK_LESSON) out.push(`pseudo-lesson: ${name} is passed with p=${p.toFixed(2)} by the strategy '${s.name}' (limit < ${MAX_RANK_LESSON}); rewrite the options so the cue does not separate the key`)
  }
  return out
}

/* ------------------------------ the Wave 2 bar ------------------------------ */

/** One blind strategy's expected lessons passed over the lesson pool. */
export interface BarRow {
  name: string
  family: string
  expected: number
}

/** A row above WAVE2_BAR is a failure, named with its family and the pool size. */
export function barFailures(rows: readonly BarRow[], lessons: number): string[] {
  return rows
    .filter((r) => r.expected > WAVE2_BAR)
    .map((r) => `bar: ${r.family} '${r.name}' passes ${r.expected.toFixed(2)} of ${lessons} lessons in expectation (${barLine(lessons)}); rewrite the options so the strategy does not separate the key`)
}

/* ------------------------------ always-B ------------------------------ */

/** Always pick display position B: under a per-attempt shuffle every authored option is equally likely there, so a single-key item is hit with 1 / options. */
export const pickDisplayB = (q: CueQuestion) => (q.correct.length === 1 ? 1 / q.options.length : 0)

export interface AlwaysB {
  /** Exact expected lessons passed (Poisson-binomial per lesson) and the standard deviation of that count. */
  expected: number
  sd: number
  /** Mean over the simulated attempts that really draw `order` per item, and its standard error. */
  simulated: number
  se: number
  attempts: number
  /** Whether the simulated mean is within two standard errors of the exact one. */
  inside: boolean
}

/**
 * Always-B stays inside its 2-SD band: the exact expectation of the blind learner who always takes display position B, and
 * the mean of `attempts` simulated attempts that draw the display order of every item with `order` (the shuffle the quiz
 * surfaces call) and click position B. A shuffle that favours a position, or a key that sits where the shuffle leaves it,
 * moves the simulated mean out of the band. Deterministic: the seed of each draw is a function of the attempt, lesson and item.
 */
export function alwaysBBand(lessons: readonly (readonly CueQuestion[])[], attempts = 2000, order: (n: number, seed: number) => number[] = shuffledOrder): AlwaysB {
  const ps = lessons.map((qs) => passProbability(qs.map(pickDisplayB)))
  const expected = ps.reduce((a, b) => a + b, 0)
  const sd = Math.sqrt(ps.reduce((a, p) => a + p * (1 - p), 0))
  let total = 0
  for (let attempt = 0; attempt < attempts; attempt++) {
    lessons.forEach((qs, li) => {
      let hits = 0
      qs.forEach((q, qi) => {
        const seed = (Math.imul(attempt + 1, 0x9e3779b1) ^ Math.imul(li * 64 + qi + 1, 0x85ebca6b)) >>> 0
        const shown = order(q.options.length, seed)
        if (q.correct.length === 1 && shown[1] === q.correct[0]) hits++
      })
      if (qs.length && hits / qs.length >= PASS_BAR) total++
    })
  }
  const simulated = total / attempts
  const se = sd / Math.sqrt(attempts)
  return { expected, sd, simulated, se, attempts, inside: Math.abs(simulated - expected) <= 2 * se }
}

/* ------------------------------ --subset: the content margin (wave-3.md §4.1) ------------------------------ */

/** At this many single-key items or more, a subset is judged against the margin; below it a hit rate moves 8 points or more per item. */
export const SUBSET_MIN_N = 12

/** The margin a subset of SUBSET_MIN_N items or more may sit above chance: tighter than the 15 points of the pools, so parallel subsets cannot push the merged pool past the gate. */
export const SUBSET_MARGIN = 0.1

/**
 * A selector is a comma-separated list of ref prefixes, or one /regex/ (optionally with flags). The prefixes are matched as written,
 * so a trailing space survives ('forge/kv-block-manager ' selects that lab and not 'forge/kv-block-manager-2'); only whitespace
 * before a prefix is dropped. Returns an error text for an empty selector or a regex that does not compile.
 */
export function parseSubset(selector: string): { matches: (ref: string) => boolean } | { error: string } {
  const asRegex = /^\/(.+)\/([a-z]*)$/s.exec(selector)
  if (asRegex) {
    try {
      const re = new RegExp(asRegex[1], asRegex[2].replace(/[gy]/g, ''))
      return { matches: (ref) => re.test(ref) }
    } catch (e) {
      return { error: `--subset: ${selector} is not a regular expression (${(e as Error).message})` }
    }
  }
  const prefixes = selector
    .split(',')
    .map((p) => p.trimStart())
    .filter((p) => p.length > 0)
  if (!prefixes.length) return { error: '--subset needs a comma-separated list of ref prefixes or one /regex/' }
  return { matches: (ref) => prefixes.some((p) => ref.startsWith(p)) }
}

/** One selected item, reduced to what the margin report reads: the cue strategies read `q`, the adversary's pick probability is given. */
export interface SubsetItem {
  ref: string
  q: CueQuestion
  /** The options-only adversary's probability of hitting the key (the held-out one verify-items trains). */
  adv: number
  /** The stem is telemetry (a Fleet Week Act IV item), so the stem-overlap strategies skip the item, as the item-level cue limit does. */
  stemless?: boolean
}

export interface SubsetRow {
  name: string
  /** The single-key items this row is over, and the chance rate of those items. */
  n: number
  chance: number
  hit: number
  /** True when the row has SUBSET_MIN_N items or more and its hit rate is above chance + SUBSET_MARGIN (the comparison of the gates, never a difference). */
  over: boolean
}

export interface SubsetReport {
  /** Selected items, whatever their kind. */
  selected: number
  /** Single-key items: the denominator of every rate, since one pick cannot hit a multi-select item. */
  n: number
  chance: number
  rows: SubsetRow[]
  adversary: SubsetRow
  /** Whether n is large enough for the margin to bind. */
  judged: boolean
  failures: string[]
}

/** The hit rate of every blind strategy and of the adversary over a subset, with the verdict: empty fails, n >= SUBSET_MIN_N is held to chance + SUBSET_MARGIN, fewer is only reported. */
export function subsetReport(items: readonly SubsetItem[], strategies: readonly CueStrategy[]): SubsetReport {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
  const single = items.filter((i) => i.q.correct.length === 1)
  const judged = single.length >= SUBSET_MIN_N
  const row = (name: string, rows: readonly SubsetItem[], pick: (i: SubsetItem) => number): SubsetRow => {
    const chance = mean(rows.map((i) => 1 / i.q.options.length))
    const hit = mean(rows.map(pick))
    return { name, n: rows.length, chance, hit, over: rows.length >= SUBSET_MIN_N && hit > chance + SUBSET_MARGIN }
  }
  const out = strategies.map((s) => row(s.name, s.name.startsWith('stem-overlap') ? single.filter((i) => !i.stemless) : single, (i) => s.pick(i.q)))
  const adversary = row('adversary', single, (i) => i.adv)
  const failures: string[] = []
  if (!items.length) failures.push('subset: the selector matches no item; a mistyped selector never passes on zero items')
  for (const r of [...out, adversary]) {
    if (r.over) {
      failures.push(
        `subset: '${r.name}' hits ${(r.hit * 100).toFixed(1)}% of the ${r.n} items (chance ${(r.chance * 100).toFixed(1)}% + ${SUBSET_MARGIN * 100} points = ${((r.chance + SUBSET_MARGIN) * 100).toFixed(1)}%); rewrite the options so the feature does not separate the key`,
      )
    }
  }
  return { selected: items.length, n: single.length, chance: mean(single.map((i) => 1 / i.q.options.length)), rows: out, adversary, judged, failures }
}
