/**
 * The pure half of verify-items v2 (spec §6.5, 2a-18): collectors for the pools that are not lesson quizzes, the item
 * structure rules, the Wave 2 bar and the always-B band. verify-items.ts is a script (top-level awaits, process.exit), so
 * anything a test must import lives here, next to item-cues.ts, which holds the strategies. No side effects.
 */

import { readdir } from 'node:fs/promises'
import type { QuizQuestion } from '../src/components/QuizBlock'
import type { Lesson } from '../src/data/lessons/types'
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
  /** The ledger ref: `item:<lessonId>.align.<n>` for an alignment item. */
  ref: string
  /** The lesson the item is authored in. */
  lessonId: string
  q: QuizQuestion
  needsExplanation: boolean
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

/**
 * Every `<dir>/<lab>/primm.ts` that exports `PRIMM_MC_ITEMS`, found by readdir so a new lab joins without a code change
 * (labs 02-03 when Wave 2c lands). A lab without a primm.ts, or whose primm.ts exports no list, is not a pool.
 */
export async function discoverPrimm(dir: URL): Promise<PrimmLab[]> {
  const labs: PrimmLab[] = []
  const base = dir.href.endsWith('/') ? dir : new URL(`${dir.href}/`)
  const entries = await readdir(base, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = new URL(`${entry.name}/primm.ts`, base)
    const mod = (await import(file.href).catch(() => null)) as { PRIMM_MC_ITEMS?: PrimmLab['items'] } | null
    if (Array.isArray(mod?.PRIMM_MC_ITEMS)) labs.push({ lab: entry.name, items: mod.PRIMM_MC_ITEMS })
  }
  return labs
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
