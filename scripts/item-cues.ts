/**
 * Item-level surface-cue strategies shared by verify-items (lesson, Act IV, errata, prequestion, diagram-prediction
 * and spiral items) and verify-generators (generator multiple-choice variants): length ranks, lexical cues, the surface-feature
 * family, stem overlap and the odd-one-out binary flags. Pure and free of side effects, so a script can
 * import it without running a lint. A `CueQuestion` is the shape both callers reduce an item to; the
 * picks return the probability one blind pick hits the key (ties uniform; a multi-select is never hit).
 */

import type { QuizQuestion } from '../src/components/QuizBlock'
import type { Lesson } from '../src/data/lessons/types'

/** The shape the strategies read: the stem, the option texts and the indices of the keys (a `QuizQuestion` fits). */
export interface CueQuestion {
  q: string
  options: string[]
  /** Indices of the correct options. */
  correct: number[]
}

export type CueStrategy = { name: string; pick: (q: CueQuestion) => number }

/** An item's blind-strategy hit rate may exceed chance by at most this much (the PLAN-100X options-only cue-ablation bar). */
export const MAX_HIT_OVER_CHANCE = 0.15

export const len = (s: string) => s.trim().length

/** Indices of the longest option(s); more than one on a tie. */
export function longestIndices(q: CueQuestion): number[] {
  const lens = q.options.map(len)
  const max = Math.max(...lens)
  return lens.flatMap((l, i) => (l === max ? [i] : []))
}

/** Indices of the shortest option(s); more than one on a tie. */
export function shortestIndices(q: CueQuestion): number[] {
  const lens = q.options.map(len)
  const min = Math.min(...lens)
  return lens.flatMap((l, i) => (l === min ? [i] : []))
}

/**
 * Pick the option at a length rank (0 = longest when `fromLongest`, else 0 = shortest). Ties are broken
 * uniformly, so the pick is uniform over the options sharing the length at that rank. Lengths do not move
 * when options are shuffled. A multi-select needs the full set, so one pick never passes it.
 */
export function pickRank(q: CueQuestion, rank: number, fromLongest: boolean): number {
  if (q.correct.length !== 1 || rank >= q.options.length) return 0
  const lens = q.options.map(len).sort((a, b) => (fromLongest ? b - a : a - b))
  const at = lens[rank]
  const group = q.options.flatMap((o, i) => (len(o) === at ? [i] : []))
  return group.includes(q.correct[0]) ? 1 / group.length : 0
}

export const RANK_STRATEGIES: CueStrategy[] = [
  { name: '1st-longest', pick: (q) => pickRank(q, 0, true) },
  { name: '2nd-longest', pick: (q) => pickRank(q, 1, true) },
  { name: '2nd-shortest', pick: (q) => pickRank(q, 1, false) },
  { name: 'shortest', pick: (q) => pickRank(q, 0, false) },
]

/**
 * Lexical cues the length gate cannot see. A strategy picks uniformly among the options its predicate
 * matches; when it matches none (or every option) the cue says nothing and the pick is uniform over all
 * options. A multi-select needs the full set, so one pick never passes it.
 */
export function pickMatching(q: CueQuestion, matches: (option: string) => boolean): number {
  if (q.correct.length !== 1) return 0
  const hit = q.options.flatMap((o, i) => (matches(o) ? [i] : []))
  if (hit.length === 0) return 1 / q.options.length
  return hit.includes(q.correct[0]) ? 1 / hit.length : 0
}

export const LEXICAL_STRATEGIES: CueStrategy[] = [
  { name: 'has-parentheses', pick: (q) => pickMatching(q, (o) => /[()]/.test(o)) },
  { name: 'has-colon', pick: (q) => pickMatching(q, (o) => o.includes(':')) },
  { name: 'has-", so"', pick: (q) => pickMatching(q, (o) => o.includes(', so')) },
  { name: 'no-because/since', pick: (q) => pickMatching(q, (o) => !/\b(because|since)\b/i.test(o)) },
]

/* ---- surface-feature strategies: a family generalising the length and lexical cues above ---- */

/** Absolute and hedge words: a distractor that claims too much ("always", "only") or a key that hedges ("just", "alone") both leak the key. */
export const ABSOLUTE_WORDS = ['always', 'never', 'only', 'all', 'none', 'every', 'just', 'alone', 'solely', 'merely', 'whatever']
export const ABSOLUTE = new RegExp(`\\b(${ABSOLUTE_WORDS.join('|')})\\b`, 'i')
export const matchCount = (o: string, re: RegExp) => (o.match(re) ?? []).length
export const tokensOf = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? []

/** Countable surface features of one option's text. */
export const FEATURES: { name: string; count: (option: string) => number }[] = [
  { name: 'characters', count: (o) => len(o) },
  { name: 'words', count: (o) => o.trim().split(/\s+/).filter(Boolean).length },
  { name: 'commas', count: (o) => matchCount(o, /,/g) },
  { name: 'clause-markers', count: (o) => matchCount(o, /[,;:()]/g) },
  { name: 'parentheses', count: (o) => matchCount(o, /[()]/g) },
  { name: 'semicolons', count: (o) => matchCount(o, /;/g) },
  { name: 'capitalised', count: (o) => matchCount(o, /(?<![A-Za-z0-9])[A-Z]/g) },
  { name: 'acronyms', count: (o) => matchCount(o, /(?<![A-Za-z0-9])[A-Z]{2,}[0-9]*(?![A-Za-z])/g) },
  { name: 'digits', count: (o) => matchCount(o, /\d/g) },
  { name: 'numbers', count: (o) => matchCount(o, /\d+/g) },
  { name: 'absolutes', count: (o) => matchCount(o, new RegExp(ABSOLUTE.source, 'gi')) },
]

/**
 * Pick the option with the highest (or lowest) score; ties, including the case where every option ties, are
 * broken uniformly. Scores do not move when options are shuffled. A multi-select needs the full set, so one
 * pick never passes it.
 */
export function pickByScore(q: CueQuestion, score: (option: string) => number, extreme: 'most' | 'fewest'): number {
  if (q.correct.length !== 1) return 0
  const scores = q.options.map(score)
  const best = extreme === 'most' ? Math.max(...scores) : Math.min(...scores)
  const group = scores.flatMap((s, i) => (s === best ? [i] : []))
  return group.includes(q.correct[0]) ? 1 / group.length : 0
}

/** Distinct words (4+ letters when `minLength` is set) an option shares with the question stem. */
export function stemOverlap(q: CueQuestion, minLength: number): (option: string) => number {
  const stem = new Set(tokensOf(q.q).filter((w) => w.length >= minLength))
  return (option) => new Set(tokensOf(option).filter((w) => stem.has(w))).size
}

export const SURFACE_STRATEGIES: CueStrategy[] = [
  ...FEATURES.flatMap((f) => [
    { name: `most-${f.name}`, pick: (q: CueQuestion) => pickByScore(q, f.count, 'most') },
    { name: `fewest-${f.name}`, pick: (q: CueQuestion) => pickByScore(q, f.count, 'fewest') },
  ]),
  { name: 'stem-overlap', pick: (q) => pickByScore(q, stemOverlap(q, 1), 'most') },
  { name: 'stem-overlap-4+', pick: (q) => pickByScore(q, stemOverlap(q, 4), 'most') },
  { name: 'avoid-absolutes', pick: (q) => pickMatching(q, (o) => !ABSOLUTE.test(o)) },
]

export const REASON = /\b(?:because|since|which means|as a result)\b|\bso(?![-\w])/gi

export const BINARY_FLAGS: { name: string; has: (option: string) => boolean }[] = [
  { name: 'a reason connective (because, since, so, which means, as a result)', has: (o) => matchCount(o, REASON) > 0 },
  { name: 'a parenthetical', has: (o) => /[()]/.test(o) },
  { name: 'a colon', has: (o) => o.includes(':') },
  { name: 'a semicolon', has: (o) => o.includes(';') },
  { name: 'a digit', has: (o) => /\d/.test(o) },
  { name: 'an acronym', has: (o) => matchCount(o, /(?<![A-Za-z0-9])[A-Z]{2,}[0-9]*(?![A-Za-z])/g) > 0 },
  { name: `an absolute or hedge word (${ABSOLUTE_WORDS.join(', ')})`, has: (o) => ABSOLUTE.test(o) },
  { name: 'an enumeration (2+ commas)', has: (o) => matchCount(o, /,/g) >= 2 },
]

/** Messages for each flag on which a single-key item's key is the only option with the feature, or the only option without it. */
export function oddOneOut(q: CueQuestion): string[] {
  if (q.correct.length !== 1) return []
  const key = q.correct[0]
  const out: string[] = []
  for (const flag of BINARY_FLAGS) {
    const has = q.options.map(flag.has)
    const withIt = has.filter(Boolean).length
    if (has[key] && withIt === 1) out.push(`the key is the only option with ${flag.name}`)
    if (!has[key] && withIt === q.options.length - 1) out.push(`the key is the only option without ${flag.name}`)
  }
  return out
}

/** Every single-feature strategy of the item-level cue limit. */
export const CUE_STRATEGIES: CueStrategy[] = [...RANK_STRATEGIES, ...LEXICAL_STRATEGIES, ...SURFACE_STRATEGIES]

/* ---- the authored pools that are not lesson quizzes: each is held to the item-level bar on its own ---- */

/** The pools of learner-facing multiple-choice items outside the lesson quizzes (Wave 1, the owner's item-validity rule). */
export const OWN_POOLS = ['prequestion', 'predictAt', 'spiral'] as const
export type OwnPool = (typeof OWN_POOLS)[number]

/** One item of an own pool, reduced to what the lint reads. */
export interface PoolEntry {
  pool: OwnPool
  /** The ledger ref: `pre:<lessonId>#<i>`, `dia:<lessonId>#<blockIndex>` or `item:<id>`. */
  ref: string
  /** The lesson the item is authored in. */
  lessonId: string
  q: QuizQuestion
  /** Spiral items carry an authored explanation; prequestions and predictions are explained by their per-option why. */
  needsExplanation: boolean
}

/**
 * Every choice prequestion (`predict` blocks; numeric ones have no options), every `DiagramBlock.predictAt` option set
 * and every spiral item (`ticket.spiral`), in lesson order. Refs match the ledger's, so a failure names the item.
 */
export function collectOwnPools(lessons: readonly Lesson[]): PoolEntry[] {
  const out: PoolEntry[] = []
  for (const lesson of lessons) {
    lesson.blocks.forEach((block, bi) => {
      if (block.type === 'predict') {
        block.items.forEach((p, i) => {
          if (p.kind !== 'choice') return
          out.push({ pool: 'prequestion', ref: `pre:${lesson.id}#${i}`, lessonId: lesson.id, q: { q: p.q, options: p.options, correct: p.correct, why: p.why }, needsExplanation: false })
        })
      } else if (block.type === 'diagram' && block.predictAt) {
        const d = block.predictAt
        out.push({ pool: 'predictAt', ref: `dia:${lesson.id}#${bi}`, lessonId: lesson.id, q: { q: d.prompt, options: d.options, correct: d.correct, why: d.why }, needsExplanation: false })
      }
    })
    for (const item of lesson.ticket?.spiral ?? []) {
      out.push({ pool: 'spiral', ref: `item:${item.id}`, lessonId: lesson.id, q: item.q, needsExplanation: true })
    }
  }
  return out
}

/** One strategy's result over one pool. */
export interface PoolCueRow {
  name: string
  items: number
  chance: number
  hit: number
}

const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

/** Hit rate of every single-feature strategy over the single-key items of one pool, with the chance rate of the same items. */
export function poolCueRows(items: { q: CueQuestion }[]): PoolCueRow[] {
  const rows = items.filter((i) => i.q.correct.length === 1)
  return CUE_STRATEGIES.map((s) => ({
    name: s.name,
    items: rows.length,
    chance: meanOf(rows.map((i) => 1 / i.q.options.length)),
    hit: meanOf(rows.map((i) => s.pick(i.q))),
  }))
}

/**
 * The failures of one pool held to the item-level bar on its own, as rule 18 does for the errata items: any single-feature
 * strategy above chance + MAX_HIT_OVER_CHANCE, and any item whose key a binary feature isolates (odd-one-out). Empty when
 * the pool is empty.
 */
export function poolCueFailures(pool: string, items: { ref: string; q: CueQuestion }[]): string[] {
  const out: string[] = []
  for (const r of poolCueRows(items)) {
    if (r.items > 0 && r.hit > r.chance + MAX_HIT_OVER_CHANCE) {
      out.push(
        `cue: the strategy '${r.name}' hits ${(r.hit * 100).toFixed(1)}% of the ${r.items} ${pool} items on their own (chance ${(r.chance * 100).toFixed(1)}% + ${MAX_HIT_OVER_CHANCE * 100} points = ${((r.chance + MAX_HIT_OVER_CHANCE) * 100).toFixed(1)}%); rewrite the options so the feature does not separate the key`,
      )
    }
  }
  for (const i of items) {
    const v = oddOneOut(i.q)
    if (v.length) out.push(`odd-one-out: ${pool} ${i.ref} "${i.q.q.slice(0, 80)}": ${v.join('; ')}; rewrite the options so no binary feature isolates the key`)
  }
  return out
}
