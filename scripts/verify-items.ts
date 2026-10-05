/**
 * verify-items — quiz-integrity lint (PLAN-100X §5.1 V1, §7.4).
 *
 * FAILS on: (1) structural defects in any item, (2) a per-track increase in
 * the count of items whose key is strictly the longest option (ratchet against
 * scripts/baselines/verify-items.json), (3) a broken per-attempt shuffle, (4) exported
 * keys piling onto one option id, (5) a shuffled surface that stopped calling shuffledOrder,
 * (6) a malformed per-option `why` (length must equal options, no empty entries), a missing `why` in a track listed
 * in the baseline's `whyRequired`, or a `whyRequired` that lacks any of the hard-coded minimum gated set (r, t0 to t7,
 * fleet-week; the file may add tracks, never drop one), (7) more than MAX_SHORTEST_PASSES lessons
 * in a `whyRequired` track that a blind "always pick the shortest option" strategy passes, (8) in a
 * `whyRequired` track, a length-rank strategy (1st-longest, 2nd-longest, 2nd-shortest, shortest) whose
 * expected lessons passed exceeds MAX_RANK_EXPECTED or that passes any single lesson with probability
 * >= MAX_RANK_LESSON, (9) across all `whyRequired` tracks together, a length-rank strategy whose expected
 * lessons passed, summed over those tracks, exceeds MAX_RANK_AGGREGATE (the PLAN-100X exit criterion is at
 * most 1 of the 19 T0-T2 lessons; the per-track bars alone would allow one per track), (10) in a
 * `whyRequired` track, the key being strictly the longest option in more than MAX_KEY_LONGEST_SHARE of the
 * track's items (PLAN-100X 5.1 V1), (11) a lexical-cue strategy (the option containing parentheses, a colon,
 * ", so", or NOT containing because/since) that passes any single lesson with probability >= MAX_RANK_LESSON,
 * or whose expected passes over all gated lesson tracks exceed MAX_LEXICAL_AGGREGATE, (12) Fleet Week Act IV
 * (when gated): any length-rank or lexical-cue strategy that gets BOTH the cause and the mitigation of one
 * incident right with probability >= MAX_RANK_LESSON, or that passes the six items as one pseudo-lesson with
 * probability >= MAX_RANK_LESSON, (13) in a `whyRequired` track, an item whose key / mean-distractor length ratio
 * exceeds MAX_LENGTH_RATIO (PLAN-100X 5.1 V1), (14) the surface-feature blind strategies (see SURFACE_STRATEGIES):
 * for each feature f of characters, words, commas, clause markers (the count of , ; : ( )), parentheses, semicolons,
 * capitalised words, acronyms (tokens of 2+ capitals), digit characters, numbers and absolute or hedge words (always, never,
 * only, all, none, every, just, alone, solely, merely, whatever), "pick the option with the most f" and "pick the option with the fewest f" (ties broken
 * uniformly), plus "pick the option sharing the most words with the stem", the same restricted to words of 4+
 * letters, and "avoid options containing absolutes": any one passing any `whyRequired` lesson with probability >=
 * MAX_RANK_LESSON, or whose expected passes summed over all gated tracks exceed MAX_SURFACE_AGGREGATE. Act IV also
 * runs every feature strategy except the stem-overlap pair (its stem is telemetry, not text) through the per-incident
 * and pseudo-lesson gates of (12).
 *
 * The cross-validated gates below target the options-only cue-ablation bar of PLAN-100X directly, so that no single
 * feature can be gamed. They run over the gated items: every item of a `whyRequired` lesson track, Fleet Week Act IV
 * (when gated) and the errata retrieval items (src/data/errata/*.ts `items`, always gated; they have no lessons, so the
 * lesson-pass metrics do not apply to them and their rates are reported separately). Multi-select items cannot be hit by one
 * pick and count as misses. Chance is the mean of 1 / options over the evaluated single-key items.
 * (15) ODD-ONE-OUT, per item: for each binary feature (a reason connective: because, since, so, which means, as a result;
 * a parenthetical; a colon; a semicolon; a digit; an acronym; an absolute or hedge word; an enumeration of 2+ commas) the key may be
 * neither the ONLY option with the feature nor the ONLY option without it. One failure per item, naming the file, the item and
 * every feature that isolates the key.
 * (16) OPTIONS-ONLY ADVERSARY: a conditional logit (softmax over the options of one item) on per-option surface features:
 * counts of characters, words, commas, clause markers, parentheses, semicolons, colons, capitalised words, acronyms, digits,
 * numbers, absolutes and reason connectives, each with its within-item rank and z-score, plus the binary flags of (15)
 * (47 features, standardised on the training options). Trained with plain batch gradient descent and L2 (ADV_ITERATIONS
 * iterations from zero weights, no randomness) leave-one-track-out over the gated tracks (fleet-week is one fold), and
 * scored on the held-out track; the errata items are scored by the model trained on all gated tracks. A held-out item
 * counts as hit with the probability its argmax is the key (ties uniform); a lesson passes as in QuizBlock (correct / total
 * >= 0.8, Poisson-binomial over the items). FAILS when held-out expected lessons passed over the gated lesson tracks exceed
 * MAX_ADVERSARY_EXPECTED, or when the held-out item hit rate (gated lesson tracks plus Act IV, and the errata items on their
 * own) exceeds chance + MAX_HIT_OVER_CHANCE.
 * (17) REVIEWER COMPOSITE RULES: "cross out options with because/since, then a connective so, then a parenthetical, pick the
 * remaining option with the most , ; : ( )" and the simpler "cross out because/since/so and '(' then pick the most commas"
 * (a step that would cross out every option is skipped; ties uniform). Each FAILS when its expected lessons passed over the gated
 * lesson tracks exceed MAX_COMPOSITE_EXPECTED, or when any lesson is passed with probability >= MAX_RANK_LESSON.
 * (18) ITEM-LEVEL CUE LIMIT: every single-feature strategy of (8), (11) and (14) (length ranks, lexical cues, surface features,
 * stem overlap) FAILS when its item hit rate over all gated items exceeds chance + MAX_HIT_OVER_CHANCE; the lesson items and
 * the errata items are also held to the bar on their own (the pooled rate can hide a leaking pool). Act IV (six items) is only
 * judged inside the pooled rate; the stem-overlap pair skips it (its stem is telemetry).
 * REPORTS (never fails): the item-level hit rate of each surface-feature strategy against chance, longest-key rates, `why` coverage, the length-rank aggregate, the lexical-cue and
 * surface-feature expectations per track, the odd-one-out, adversary, composite and cue-limit tables per feature, per track and per lesson, and a blind-strategy simulation.
 *
 *   bun scripts/verify-items.ts
 *   bun scripts/verify-items.ts --update-baseline [--force]
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import type { QuizQuestion } from '../src/components/QuizBlock'
import { PRIMM_MC_ITEMS } from '../src/data/forge/rust-allocator/primm'
import { ALL_LESSONS, TRACK_IDS } from '../src/data/lessons'
import { INCIDENTS } from '../src/lib/fleet-week'
import { exportOrder, shuffledOrder } from '../src/lib/rng'

const BASELINE_URL = new URL('./baselines/verify-items.json', import.meta.url)
const PASS_BAR = 0.8 // QuizBlock.tsx: score = correct / total >= 0.8
const FLEET_TRACK = 'fleet-week'
/** Lab 01's PRIMM multiple-choice items (src/data/forge/rust-allocator/primm.ts): one pseudo-lesson, gated like a lesson track. */
const FORGE_TRACK = 'forge'
/** The baseline file must not be able to switch a gate off: these tracks are gated whatever it says. It may add tracks, never drop one. */
const MIN_GATED = ['r', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', FLEET_TRACK, FORGE_TRACK]
/** In a whyRequired track, at most this many lessons may be passed by always picking the shortest option. */
const MAX_SHORTEST_PASSES = 1
/** In a whyRequired track, no length-rank strategy may pass more than this many lessons in expectation... */
const MAX_RANK_EXPECTED = 1.0
/** ...or pass any single lesson with at least this probability. */
const MAX_RANK_LESSON = 0.5
/** Summed over every whyRequired track together, no length-rank strategy may pass more than this many lessons in expectation. */
const MAX_RANK_AGGREGATE = 1.0
/** PLAN-100X 5.1 V1: in a whyRequired track the key may be strictly the longest option in at most this share of items. */
const MAX_KEY_LONGEST_SHARE = 0.3
/** PLAN-100X 5.1 V1: in a whyRequired track no item's key / mean-distractor length ratio may exceed this. */
const MAX_LENGTH_RATIO = 1.3
/** Summed over every gated lesson track, no lexical-cue strategy may pass more than this many lessons in expectation. */
const MAX_LEXICAL_AGGREGATE = 2.0
/** Lessons any surface-feature strategy passes with at least this probability are listed on a watch list (reported, not failed). */
const WATCH_P = 0.1
/** Summed over every gated lesson track, no surface-feature strategy may pass more than this many lessons in expectation. */
const MAX_SURFACE_AGGREGATE = 2.0
/** Track label of the errata retrieval items (src/data/errata/*.ts `items`); they have no lessons. */
const ERRATA_TRACK = 'errata'
/** (16) The held-out item hit rate may exceed chance by at most this much (the PLAN-100X options-only cue-ablation bar); (18) the same for every single-feature strategy. */
const MAX_HIT_OVER_CHANCE = 0.15
/** (16) Held-out expected lessons passed by the cross-validated adversary, over the gated lesson tracks. */
const MAX_ADVERSARY_EXPECTED = 2.0
/** (17) Reviewer composite rules: expected lessons passed over the gated lesson tracks (every lesson must also stay below MAX_RANK_LESSON). */
const MAX_COMPOSITE_EXPECTED = 2.0
/** (16) Conditional-logit training: plain batch gradient descent from zero weights, a fixed schedule, L2 on the weights. */
const ADV_ITERATIONS = 400
const ADV_LEARNING_RATE = 0.5
const ADV_L2 = 0.01
/** (16) Two scores closer than this tie, and the pick is then uniform over the tied options. */
const TIE_EPSILON = 1e-9

interface Item {
  track: string
  lessonId: string | null // null for items that are not lesson quizzes
  /** 0-based question index within the lesson, as the markdown exporter counts it. */
  qi: number
  ref: string
  q: QuizQuestion
  /** Fleet Week incidents have no authored `explanation`; they are graded on telemetry. */
  needsExplanation: boolean
}

interface Baseline {
  longestKeyByTrack: Record<string, number>
  /** Track ids in which every item must carry a per-option `why`. */
  whyRequired?: string[]
}

const args = process.argv.slice(2)
const known = new Set(['--update-baseline', '--force'])
const unknown = args.filter((a) => !known.has(a))
if (unknown.length) {
  console.error(`unknown argument: ${unknown.join(' ')}`)
  console.error('usage: bun scripts/verify-items.ts [--update-baseline [--force]]')
  process.exit(1)
}
const updateBaseline = args.includes('--update-baseline')
const force = args.includes('--force')
if (force && !updateBaseline) {
  console.error('--force only applies together with --update-baseline')
  process.exit(1)
}

/* ------------------------------ collect ------------------------------ */

const items: Item[] = []
for (const lesson of ALL_LESSONS) {
  let n = 0
  for (const block of lesson.blocks) {
    if (block.type !== 'quiz') continue
    for (const q of block.questions) {
      n++
      items.push({
        track: lesson.trackId,
        lessonId: lesson.id,
        ref: `${lesson.id} q${n}`,
        qi: n - 1,
        q,
        needsExplanation: true,
      })
    }
  }
}

// Lab 01 PRIMM items: not a lesson quiz, so they are graded here as one pseudo-lesson at PASS_BAR.
PRIMM_MC_ITEMS.forEach((item, i) => {
  items.push({ track: FORGE_TRACK, lessonId: 'lab01.primm', qi: i, ref: `lab01 ${item.id}`, q: item.q, needsExplanation: false })
})

// Fleet Week Act IV: each incident asks a cause question and a mitigation question.
for (const incident of INCIDENTS) {
  for (const [kind, list] of [
    ['cause', incident.causes],
    ['mitigation', incident.mitigations],
  ] as const) {
    items.push({
      track: FLEET_TRACK,
      lessonId: null,
      qi: -1,
      ref: `fleet-week ${incident.id} ${kind}`,
      q: {
        q: `${incident.id} ${kind}`,
        options: list.map((o) => o.label),
        correct: list.flatMap((o, i) => (o.correct ? [i] : [])),
        // Only when every option carries one; a partial set is a structure error, not a silent skip.
        ...(list.some((o) => o.why !== undefined) ? { why: list.map((o) => o.why ?? '') } : {}),
      },
      needsExplanation: false,
    })
  }
}

const trackKeys = [...TRACK_IDS, FLEET_TRACK, FORGE_TRACK]
const failures: string[] = []

/* ------------------------- (1) structure ------------------------- */

function structureErrors(item: Item): string[] {
  const { options, correct, multi, explanation, why } = item.q
  const errs: string[] = []
  if (!Array.isArray(options) || options.length < 2) errs.push('fewer than 2 options')
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
  if (item.needsExplanation && !explanation?.trim()) errs.push('missing or empty explanation')
  if (why !== undefined) {
    if (!Array.isArray(why) || why.length !== (options?.length ?? 0)) {
      errs.push(`why has ${Array.isArray(why) ? why.length : 'no'} entries for ${options?.length ?? 0} options`)
    } else if (why.some((w) => typeof w !== 'string' || !w.trim())) {
      errs.push('why has an empty entry')
    }
  }
  return errs
}

const validItems: Item[] = []
for (const item of items) {
  const errs = structureErrors(item)
  if (errs.length) failures.push(`structure: ${item.ref}: ${errs.join('; ')}`)
  else validItems.push(item)
}

/* ------------------------- helpers ------------------------- */

const len = (s: string) => s.trim().length
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Indices of the longest option(s); more than one on a tie. */
function longestIndices(q: QuizQuestion): number[] {
  const lens = q.options.map(len)
  const max = Math.max(...lens)
  return lens.flatMap((l, i) => (l === max ? [i] : []))
}

/** Indices of the shortest option(s); more than one on a tie. */
function shortestIndices(q: QuizQuestion): number[] {
  const lens = q.options.map(len)
  const min = Math.min(...lens)
  return lens.flatMap((l, i) => (l === min ? [i] : []))
}

/** The key is strictly the longest option: a unique longest option that is correct. */
function keyIsLongest(q: QuizQuestion): boolean {
  const top = longestIndices(q)
  return top.length === 1 && q.correct.includes(top[0])
}

/* ------------------------- (2) ratchet ------------------------- */

const longestByTrack: Record<string, number> = {}
for (const t of trackKeys) longestByTrack[t] = validItems.filter((i) => i.track === t && keyIsLongest(i.q)).length

let baseline: Baseline | null = null
try {
  baseline = JSON.parse(await readFile(BASELINE_URL, 'utf8')) as Baseline
} catch {
  baseline = null
}

const increases: string[] = []
const improvements: string[] = []
for (const t of trackKeys) {
  const was = baseline?.longestKeyByTrack[t] ?? 0
  if (longestByTrack[t] > was) increases.push(`${t}: ${was} -> ${longestByTrack[t]}`)
  else if (longestByTrack[t] < was) improvements.push(`${t}: ${was} -> ${longestByTrack[t]}`)
}

let baselineWritten = false
if (updateBaseline) {
  if (baseline && increases.length && !force) {
    failures.push(`ratchet: refusing to update baseline, longest-key count increased (${increases.join(', ')}); pass --force to override`)
  } else {
    const next: Baseline = { longestKeyByTrack: longestByTrack, whyRequired: baseline?.whyRequired ?? MIN_GATED }
    await writeFile(BASELINE_URL, `${JSON.stringify(next, null, 2)}\n`)
    baselineWritten = true
  }
} else if (!baseline) {
  failures.push('ratchet: scripts/baselines/verify-items.json is missing or unreadable; run with --update-baseline')
} else if (increases.length) {
  failures.push(`ratchet: key-is-longest count increased (${increases.join(', ')}); rewrite distractors, do not raise the baseline`)
}

/* ------------------------- (2b) why coverage ------------------------- */

const hasWhy = (q: QuizQuestion) => q.why !== undefined
// Creating a baseline from scratch (--update-baseline with no file) starts from the minimum gated set, never from an empty one.
const whyRequired = baseline?.whyRequired ?? (updateBaseline ? MIN_GATED : [])
for (const t of whyRequired) {
  if (!trackKeys.includes(t)) failures.push(`why: whyRequired lists unknown track '${t}'`)
}
for (const t of MIN_GATED) {
  if (!whyRequired.includes(t)) {
    failures.push(`why: scripts/baselines/verify-items.json whyRequired lacks '${t}' (minimum gated set: ${MIN_GATED.join(', ')}); restore it, the gated set only grows`)
  }
}
for (const item of validItems) {
  if (whyRequired.includes(item.track) && !hasWhy(item.q)) {
    failures.push(`why: ${item.ref}: track ${item.track} requires per-option why`)
  }
}

/* ------------------------- (2c) V1 item rules ------------------------- */

/** Key (mean of the keys for a multi-select) over mean distractor length; NaN when there is no distractor. */
function lengthRatio(q: QuizQuestion): number {
  const key = mean(q.correct.map((c) => len(q.options[c])))
  const wrong = q.options.filter((_, oi) => !q.correct.includes(oi)).map(len)
  return wrong.length ? key / mean(wrong) : NaN
}

const longRatioItems = validItems.filter((i) => whyRequired.includes(i.track) && lengthRatio(i.q) > MAX_LENGTH_RATIO)
for (const i of longRatioItems) {
  failures.push(
    `ratio: ${i.ref} key / mean-distractor length is ${lengthRatio(i.q).toFixed(2)} (limit ${MAX_LENGTH_RATIO}); lengthen the distractors or shorten the key`,
  )
}
for (const t of whyRequired) {
  const rows = validItems.filter((i) => i.track === t)
  const longest = rows.filter((i) => keyIsLongest(i.q)).length
  if (rows.length && longest / rows.length > MAX_KEY_LONGEST_SHARE) {
    failures.push(
      `longest: track ${t} has the key strictly longest in ${longest}/${rows.length} items (${pct(longest / rows.length)}; limit ${MAX_KEY_LONGEST_SHARE * 100}%); shorten the key or lengthen distractors`,
    )
  }
}

/* ------------------------- (3) shuffle sanity ------------------------- */

const SEEDS = 10_000
const TOLERANCE = 0.02
const N = 4
const landed = Array.from({ length: N }, () => new Array<number>(N).fill(0)) // [authored][position]
let permutationBroken = 0
for (let n = 1; n <= 8; n++) {
  for (let seed = 0; seed < SEEDS; seed++) {
    const order = shuffledOrder(n, seed)
    const isPermutation = order.length === n && [...order].sort((a, b) => a - b).every((v, i) => v === i)
    if (!isPermutation) permutationBroken++
    if (n === N && isPermutation) order.forEach((authored, pos) => landed[authored][pos]++)
  }
}
if (permutationBroken) failures.push(`shuffle: ${permutationBroken} results were not permutations`)
if (shuffledOrder(N, 12345).join() !== shuffledOrder(N, 12345).join()) failures.push('shuffle: same seed gave different orders')

let worst = 0
for (let authored = 0; authored < N; authored++) {
  for (let pos = 0; pos < N; pos++) {
    const share = landed[authored][pos] / SEEDS
    worst = Math.max(worst, Math.abs(share - 1 / N))
    if (Math.abs(share - 1 / N) > TOLERANCE) {
      failures.push(`shuffle: authored ${authored} lands at position ${pos} ${(share * 100).toFixed(1)}% (want 25% +/- 2)`)
    }
  }
}

/* ------------------------- (4) exported key position ------------------------- */

// The markdown export permutes options with exportOrder; the keys must not pile onto one id.
const MAX_EXPORT_SHARE = 0.4
const exportedKeys: number[] = [] // exportedKeys[p] = keys exported at id o(p+1)
for (const item of validItems) {
  if (!item.lessonId || item.track === FORGE_TRACK) continue // never exported to markdown
  const order = exportOrder(item.lessonId, item.qi, item.q.options.length)
  order.forEach((authored, pos) => {
    if (item.q.correct.includes(authored)) exportedKeys[pos] = (exportedKeys[pos] ?? 0) + 1
  })
}
const totalExportedKeys = exportedKeys.reduce((a, b) => a + (b ?? 0), 0)
for (let pos = 0; pos < exportedKeys.length; pos++) {
  const share = totalExportedKeys ? (exportedKeys[pos] ?? 0) / totalExportedKeys : 0
  if (share > MAX_EXPORT_SHARE) {
    failures.push(`export: ${pct(share)} of keys sit at o${pos + 1} (limit ${MAX_EXPORT_SHARE * 100}%); the exported order leaks the key`)
  }
}

/* ------------------------- (5) surface guard ------------------------- */

const SHUFFLED_SURFACES = [
  'src/components/QuizBlock.tsx',
  'src/components/sims/PlaygroundShell.tsx',
  'src/pages/Curriculum.tsx',
  'src/pages/FleetWeek.tsx',
]
const importsShuffle = /import\s*\{[^}]*\bshuffledOrder\b[^}]*\}\s*from\s*'@\/lib\/rng'/
for (const file of SHUFFLED_SURFACES) {
  let src = ''
  try {
    src = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  } catch {
    failures.push(`surface: ${file} is missing or unreadable`)
    continue
  }
  if (!importsShuffle.test(src)) failures.push(`surface: ${file} does not import shuffledOrder from '@/lib/rng'`)
  if (!src.includes('shuffledOrder(')) failures.push(`surface: ${file} never calls shuffledOrder(; options would render in authored order`)
}

/* ------------------------- report ------------------------- */

console.log('verify-items report')
console.log('')
console.log('per track (items, key strictly longest, median key / mean-distractor length)')
console.log(`  ${'track'.padEnd(11)}${'items'.padStart(6)}${'key-longest'.padStart(13)}${'%'.padStart(8)}${'median ratio'.padStart(14)}`)
let totalItems = 0
let totalLongest = 0
for (const t of trackKeys) {
  const rows = validItems.filter((i) => i.track === t)
  const ratios = rows.map((i) => lengthRatio(i.q)).filter((r) => Number.isFinite(r))
  totalItems += rows.length
  totalLongest += longestByTrack[t]
  const share = rows.length ? longestByTrack[t] / rows.length : 0
  console.log(
    `  ${t.padEnd(11)}${String(rows.length).padStart(6)}${String(longestByTrack[t]).padStart(13)}${pct(share).padStart(8)}${median(ratios).toFixed(2).padStart(14)}`,
  )
}
console.log(`  ${'all'.padEnd(11)}${String(totalItems).padStart(6)}${String(totalLongest).padStart(13)}${pct(totalItems ? totalLongest / totalItems : 0).padStart(8)}`)

console.log('')
console.log(`items in gated tracks whose key / mean-distractor length ratio exceeds ${MAX_LENGTH_RATIO} (failed): ${longRatioItems.length}`)
for (const i of longRatioItems) console.log(`  ${i.ref.padEnd(40)} ratio ${lengthRatio(i.q).toFixed(2)}`)

console.log('')
console.log('why coverage per track (items with per-option why / items)')
for (const t of trackKeys) {
  const rows = validItems.filter((i) => i.track === t)
  const withWhy = rows.filter((i) => hasWhy(i.q)).length
  console.log(
    `  ${t.padEnd(11)}${`${withWhy}/${rows.length}`.padStart(9)}${pct(rows.length ? withWhy / rows.length : 0).padStart(8)}${whyRequired.includes(t) ? '  required' : ''}`,
  )
}

// Blind strategies on lesson quizzes under per-attempt shuffling. A lesson passes
// when correct / total >= PASS_BAR. Probabilities are per question and independent,
// so the pass probability is a Poisson-binomial tail computed exactly.
function passProbability(ps: number[]): number {
  let dist = [1]
  for (const p of ps) {
    const next = new Array<number>(dist.length + 1).fill(0)
    dist.forEach((mass, k) => {
      next[k] += mass * (1 - p)
      next[k + 1] += mass * p
    })
    dist = next
  }
  return dist.reduce((a, mass, k) => (k / ps.length >= PASS_BAR ? a + mass : a), 0)
}

// Shuffling makes every authored option equally likely at display position B, so a
// single-key item is hit with 1 / options. A multi-select needs the full set, so
// one pick never passes it.
const pickB = (q: QuizQuestion) => (q.correct.length === 1 ? 1 / q.options.length : 0)
// Lengths do not move when options are shuffled: take the longest (ties at random).
const pickLongest = (q: QuizQuestion) => {
  const top = longestIndices(q)
  return q.correct.length === 1 && top.includes(q.correct[0]) ? 1 / top.length : 0
}

// Same for the shortest option: a lone-key item is hit only when the key is among the shortest.
const pickShortest = (q: QuizQuestion) => {
  const low = shortestIndices(q)
  return q.correct.length === 1 && low.includes(q.correct[0]) ? 1 / low.length : 0
}

/**
 * Pick the option at a length rank (0 = longest when `fromLongest`, else 0 = shortest). Ties are broken
 * uniformly, so the pick is uniform over the options sharing the length at that rank. Lengths do not move
 * when options are shuffled. A multi-select needs the full set, so one pick never passes it.
 */
function pickRank(q: QuizQuestion, rank: number, fromLongest: boolean): number {
  if (q.correct.length !== 1 || rank >= q.options.length) return 0
  const lens = q.options.map(len).sort((a, b) => (fromLongest ? b - a : a - b))
  const at = lens[rank]
  const group = q.options.flatMap((o, i) => (len(o) === at ? [i] : []))
  return group.includes(q.correct[0]) ? 1 / group.length : 0
}

const RANK_STRATEGIES: { name: string; pick: (q: QuizQuestion) => number }[] = [
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
function pickMatching(q: QuizQuestion, matches: (option: string) => boolean): number {
  if (q.correct.length !== 1) return 0
  const hit = q.options.flatMap((o, i) => (matches(o) ? [i] : []))
  if (hit.length === 0) return 1 / q.options.length
  return hit.includes(q.correct[0]) ? 1 / hit.length : 0
}

const LEXICAL_STRATEGIES: { name: string; pick: (q: QuizQuestion) => number }[] = [
  { name: 'has-parentheses', pick: (q) => pickMatching(q, (o) => /[()]/.test(o)) },
  { name: 'has-colon', pick: (q) => pickMatching(q, (o) => o.includes(':')) },
  { name: 'has-", so"', pick: (q) => pickMatching(q, (o) => o.includes(', so')) },
  { name: 'no-because/since', pick: (q) => pickMatching(q, (o) => !/\b(because|since)\b/i.test(o)) },
]

/* ---- surface-feature strategies: a family generalising the length and lexical cues above ---- */

/** Absolute and hedge words: a distractor that claims too much ("always", "only") or a key that hedges ("just", "alone") both leak the key. */
const ABSOLUTE_WORDS = ['always', 'never', 'only', 'all', 'none', 'every', 'just', 'alone', 'solely', 'merely', 'whatever']
const ABSOLUTE = new RegExp(`\\b(${ABSOLUTE_WORDS.join('|')})\\b`, 'i')
const matchCount = (o: string, re: RegExp) => (o.match(re) ?? []).length
const tokensOf = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? []

/** Countable surface features of one option's text. */
const FEATURES: { name: string; count: (option: string) => number }[] = [
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
function pickByScore(q: QuizQuestion, score: (option: string) => number, extreme: 'most' | 'fewest'): number {
  if (q.correct.length !== 1) return 0
  const scores = q.options.map(score)
  const best = extreme === 'most' ? Math.max(...scores) : Math.min(...scores)
  const group = scores.flatMap((s, i) => (s === best ? [i] : []))
  return group.includes(q.correct[0]) ? 1 / group.length : 0
}

/** Distinct words (4+ letters when `minLength` is set) an option shares with the question stem. */
function stemOverlap(q: QuizQuestion, minLength: number): (option: string) => number {
  const stem = new Set(tokensOf(q.q).filter((w) => w.length >= minLength))
  return (option) => new Set(tokensOf(option).filter((w) => stem.has(w))).size
}

const SURFACE_STRATEGIES: { name: string; pick: (q: QuizQuestion) => number }[] = [
  ...FEATURES.flatMap((f) => [
    { name: `most-${f.name}`, pick: (q: QuizQuestion) => pickByScore(q, f.count, 'most') },
    { name: `fewest-${f.name}`, pick: (q: QuizQuestion) => pickByScore(q, f.count, 'fewest') },
  ]),
  { name: 'stem-overlap', pick: (q) => pickByScore(q, stemOverlap(q, 1), 'most') },
  { name: 'stem-overlap-4+', pick: (q) => pickByScore(q, stemOverlap(q, 4), 'most') },
  { name: 'avoid-absolutes', pick: (q) => pickMatching(q, (o) => !ABSOLUTE.test(o)) },
]

const byLesson = new Map<string, QuizQuestion[]>()
const trackOfLesson = new Map<string, string>()
for (const item of validItems) {
  if (!item.lessonId) continue
  byLesson.set(item.lessonId, [...(byLesson.get(item.lessonId) ?? []), item.q])
  trackOfLesson.set(item.lessonId, item.track)
}
const lessonPass = (strategy: (q: QuizQuestion) => number) =>
  [...byLesson.values()].map((qs) => passProbability(qs.map(strategy)))

const bPass = lessonPass(pickB)
const bMean = bPass.reduce((a, b) => a + b, 0)
const bSd = Math.sqrt(bPass.reduce((a, p) => a + p * (1 - p), 0))
const longestPass = lessonPass(pickLongest)
const longestMean = longestPass.reduce((a, b) => a + b, 0)
const shortestPass = lessonPass(pickShortest)
const shortestMean = shortestPass.reduce((a, b) => a + b, 0)

// (7) A lesson counts as passed by always-shortest when its pass probability is at least 50%
// (ties at random). Expected passes are reported per track alongside.
const lessonIds = [...byLesson.keys()]
const shortestPassedByTrack: Record<string, number> = {}
const shortestExpectedByTrack: Record<string, number> = {}
for (const t of trackKeys) {
  shortestPassedByTrack[t] = 0
  shortestExpectedByTrack[t] = 0
}
lessonIds.forEach((id, i) => {
  const t = trackOfLesson.get(id) as string
  shortestExpectedByTrack[t] += shortestPass[i]
  if (shortestPass[i] >= 0.5) shortestPassedByTrack[t]++
})
for (const t of whyRequired) {
  if (shortestPassedByTrack[t] > MAX_SHORTEST_PASSES) {
    failures.push(
      `shortest: track ${t} has ${shortestPassedByTrack[t]} lessons passed by always picking the shortest option (limit ${MAX_SHORTEST_PASSES}); lengthen the key or shorten a distractor`,
    )
  }
}

// (8) Length-rank strategies, per whyRequired track: expected lessons passed and the worst single lesson.
// (9) The same expectation summed over all whyRequired tracks: each track may stay under its own limit
// while the total exceeds the exit criterion (at most 1 of the 19 T0-T2 lessons).
const gatedTracks = trackKeys.filter((k) => k !== FLEET_TRACK && whyRequired.includes(k))
const gatedLessons = lessonIds.filter((id) => gatedTracks.includes(trackOfLesson.get(id) as string)).length
const rankAggregates: { name: string; expected: number }[] = []
console.log('')
console.log('length-rank strategies per track: expected lessons passed (worst single lesson p)')
for (const strat of RANK_STRATEGIES) {
  const pass = lessonPass(strat.pick)
  const cells: string[] = []
  let aggregate = 0
  for (const t of trackKeys.filter((k) => k !== FLEET_TRACK)) {
    let expected = 0
    let worstP = 0
    let worstId = ''
    lessonIds.forEach((id, i) => {
      if (trackOfLesson.get(id) !== t) return
      expected += pass[i]
      if (pass[i] > worstP) {
        worstP = pass[i]
        worstId = id
      }
    })
    const gated = whyRequired.includes(t)
    cells.push(`${t} ${expected.toFixed(2)}${gated ? '*' : ''}${worstP > 0 ? ` (${worstP.toFixed(2)} ${worstId})` : ''}`)
    if (!gated) continue
    aggregate += expected
    if (expected > MAX_RANK_EXPECTED) {
      failures.push(
        `rank: track ${t} expects ${expected.toFixed(2)} lessons passed by always picking the ${strat.name} option (limit ${MAX_RANK_EXPECTED}); rebalance option lengths`,
      )
    }
    if (worstP >= MAX_RANK_LESSON) {
      failures.push(
        `rank: ${worstId} is passed with p=${worstP.toFixed(2)} by always picking the ${strat.name} option (limit < ${MAX_RANK_LESSON}); rebalance option lengths`,
      )
    }
  }
  rankAggregates.push({ name: strat.name, expected: aggregate })
  if (aggregate > MAX_RANK_AGGREGATE) {
    failures.push(
      `rank: the gated tracks together (${gatedTracks.join(' + ')}, ${gatedLessons} lessons) expect ${aggregate.toFixed(2)} lessons passed by always picking the ${strat.name} option (limit ${MAX_RANK_AGGREGATE} in total); rebalance option lengths`,
    )
  }
  console.log(`  ${strat.name.padEnd(13)}${cells.join('  ')}`)
}
console.log(`  (* gated: expected <= ${MAX_RANK_EXPECTED}, every lesson p < ${MAX_RANK_LESSON})`)
console.log(
  `  aggregate over the gated tracks (${gatedTracks.join(' + ') || 'none'}, ${gatedLessons} lessons; limit <= ${MAX_RANK_AGGREGATE} in total): ${rankAggregates
    .map((a) => `${a.name} ${a.expected.toFixed(2)}`)
    .join('  ')}`,
)

// (11) Lexical-cue strategies, per whyRequired lesson track: expected lessons passed and the worst single lesson.
{
  const lessonTracks = trackKeys.filter((k) => k !== FLEET_TRACK)
  console.log('')
  console.log('lexical-cue strategies per track: expected lessons passed (worst single lesson p)')
  const totals: { name: string; expected: number }[] = []
  for (const strat of LEXICAL_STRATEGIES) {
    const pass = lessonPass(strat.pick)
    const cells: string[] = []
    let aggregate = 0
    for (const t of lessonTracks) {
      let expected = 0
      let worstP = 0
      let worstId = ''
      lessonIds.forEach((id, i) => {
        if (trackOfLesson.get(id) !== t) return
        expected += pass[i]
        if (pass[i] > worstP) {
          worstP = pass[i]
          worstId = id
        }
      })
      const gated = whyRequired.includes(t)
      cells.push(`${t} ${expected.toFixed(2)}${gated ? '*' : ''}${worstP > 0 ? ` (${worstP.toFixed(2)} ${worstId})` : ''}`)
      if (!gated) continue
      aggregate += expected
      if (worstP >= MAX_RANK_LESSON) {
        failures.push(
          `lexical: ${worstId} is passed with p=${worstP.toFixed(2)} by the strategy '${strat.name}' (limit < ${MAX_RANK_LESSON}); rewrite the options so the cue does not separate the key`,
        )
      }
    }
    totals.push({ name: strat.name, expected: aggregate })
    if (aggregate > MAX_LEXICAL_AGGREGATE) {
      failures.push(
        `lexical: the gated tracks together expect ${aggregate.toFixed(2)} lessons passed by the strategy '${strat.name}' (limit ${MAX_LEXICAL_AGGREGATE} in total); rewrite the options so the cue does not separate the key`,
      )
    }
    console.log(`  ${strat.name.padEnd(17)}${cells.join('  ')}`)
  }
  console.log(`  (* gated: every lesson p < ${MAX_RANK_LESSON})`)
  console.log(
    `  overall over the gated tracks (limit <= ${MAX_LEXICAL_AGGREGATE} per strategy): ${totals.map((a) => `${a.name} ${a.expected.toFixed(2)}`).join('  ')}`,
  )
}

// (14) Surface-feature strategies, per lesson track: expected lessons passed and the worst single lesson, with the
// overall expectation and worst lesson over every lesson. Gated tracks fail on any lesson at p >= MAX_RANK_LESSON and
// on an aggregate over the gated tracks above MAX_SURFACE_AGGREGATE.
{
  const lessonTracks = trackKeys.filter((k) => k !== FLEET_TRACK)
  console.log('')
  console.log('surface-feature strategies per track: expected lessons passed (worst single lesson p)')
  const singleKeyQs = [...byLesson.values()].flat().filter((q) => q.correct.length === 1)
  const chance = singleKeyQs.reduce((a, q) => a + 1 / q.options.length, 0) / singleKeyQs.length
  const totals: { name: string; expected: number; worstP: number; worstId: string; hit: number }[] = []
  const watch = new Map<string, string[]>() // lesson id -> strategies passing it with p >= WATCH_P
  for (const strat of SURFACE_STRATEGIES) {
    const pass = lessonPass(strat.pick)
    lessonIds.forEach((id, i) => {
      if (pass[i] >= WATCH_P) watch.set(id, [...(watch.get(id) ?? []), `${strat.name} ${pass[i].toFixed(2)}`])
    })
    const cells: string[] = []
    let aggregate = 0
    let overallWorstP = 0
    let overallWorstId = ''
    for (const t of lessonTracks) {
      let expected = 0
      let worstP = 0
      let worstId = ''
      lessonIds.forEach((id, i) => {
        if (trackOfLesson.get(id) !== t) return
        expected += pass[i]
        if (pass[i] > worstP) {
          worstP = pass[i]
          worstId = id
        }
      })
      const gated = whyRequired.includes(t)
      cells.push(`${t} ${expected.toFixed(2)}${gated ? '*' : ''}${worstP >= 0.005 ? ` (${worstP.toFixed(2)} ${worstId})` : ''}`)
      if (worstP > overallWorstP) {
        overallWorstP = worstP
        overallWorstId = worstId
      }
      if (!gated) continue
      aggregate += expected
      if (worstP >= MAX_RANK_LESSON) {
        failures.push(
          `surface: ${worstId} is passed with p=${worstP.toFixed(2)} by the strategy '${strat.name}' (limit < ${MAX_RANK_LESSON}); rewrite the options so the feature does not separate the key`,
        )
      }
    }
    const hit = singleKeyQs.reduce((a, q) => a + strat.pick(q), 0) / singleKeyQs.length
    totals.push({ name: strat.name, expected: aggregate, worstP: overallWorstP, worstId: overallWorstId, hit })
    if (aggregate > MAX_SURFACE_AGGREGATE) {
      failures.push(
        `surface: the gated tracks together expect ${aggregate.toFixed(2)} lessons passed by the strategy '${strat.name}' (limit ${MAX_SURFACE_AGGREGATE} in total); rewrite the options so the feature does not separate the key`,
      )
    }
    console.log(`  ${strat.name.padEnd(24)}${cells.join('  ')}`)
  }
  console.log(`  (* gated: every lesson p < ${MAX_RANK_LESSON}; overall over the gated tracks <= ${MAX_SURFACE_AGGREGATE} per strategy)`)
  console.log(`  overall expected passes of ${lessonIds.length} lessons, and the worst lesson, per strategy:`)
  for (const t of totals) {
    console.log(`    ${t.name.padEnd(24)}${t.expected.toFixed(2).padStart(6)}   worst ${t.worstP.toFixed(2)} ${t.worstId}`)
  }
  console.log(
    `  item-level hit rate over ${singleKeyQs.length} single-key lesson items (chance ${(chance * 100).toFixed(1)}%; reported, not gated; the lesson gates above need 4 of 4 right):`,
  )
  for (const t of totals) console.log(`    ${t.name.padEnd(24)}${(t.hit * 100).toFixed(1).padStart(5)}%`)
  console.log(`  lessons passed with p >= ${WATCH_P} by some surface-feature strategy (watch list, ${watch.size}):`)
  for (const [id, hits] of watch) console.log(`    ${id.padEnd(8)}${hits.join(', ')}`)
  const top = totals.reduce((a, b) => (b.expected > a.expected ? b : a))
  console.log(`  highest overall: ${top.name} ${top.expected.toFixed(2)} of ${lessonIds.length} (PLAN Wave 1 bar: <= 5)`)
}

// Fleet Week Act IV is not a lesson quiz, so the loops above skip it. Its six incident items
// (cause + mitigation per incident) are checked here the same way, as one pseudo-lesson graded at
// PASS_BAR, and per incident (the real unit), where the game needs the cause AND the mitigation right. Gated when
// the baseline lists 'fleet-week' in whyRequired.
{
  const fleetItems = validItems.filter((i) => i.track === FLEET_TRACK)
  const fleetQs = fleetItems.map((i) => i.q)
  const fleetGated = whyRequired.includes(FLEET_TRACK)
  const rankOf = (q: QuizQuestion): string => {
    const lens = q.options.map(len)
    const key = lens[q.correct[0]]
    const longer = lens.filter((l) => l > key).length
    const shorter = lens.filter((l) => l < key).length
    return `${longer + 1}${['st', 'nd', 'rd', 'th'][Math.min(longer, 3)]}-longest/${shorter + 1}${['st', 'nd', 'rd', 'th'][Math.min(shorter, 3)]}-shortest`
  }
  console.log('')
  console.log(`fleet-week Act IV (${fleetQs.length} items as one pseudo-lesson; per incident the cause and the mitigation must both be right)`)
  fleetItems.forEach((i) => console.log(`  ${i.ref.padEnd(40)} key ${rankOf(i.q)}  lengths ${i.q.options.map(len).join('/')}`))
  for (const strat of [...RANK_STRATEGIES, ...LEXICAL_STRATEGIES, ...SURFACE_STRATEGIES.filter((x) => !x.name.startsWith('stem-overlap'))]) {
    const ps = fleetQs.map(strat.pick)
    const lessonP = passProbability(ps)
    // The unit the game grades: both the cause and the mitigation of one incident right.
    const incidentPs = INCIDENTS.map((inc, k) => ps[2 * k] * ps[2 * k + 1])
    const worstIncident = Math.max(...incidentPs)
    const worstId = INCIDENTS[incidentPs.indexOf(worstIncident)].id
    console.log(
      `  ${strat.name.padEnd(17)}expected key hits ${ps.reduce((a, b) => a + b, 0).toFixed(2)}/${ps.length}  pseudo-lesson p ${lessonP.toFixed(2)}  worst incident p ${worstIncident.toFixed(2)}${fleetGated ? '*' : ''}`,
    )
    if (fleetGated && worstIncident >= MAX_RANK_LESSON) {
      failures.push(
        `rank: fleet-week incident ${worstId} gets cause and mitigation both right with p=${worstIncident.toFixed(2)} by the strategy '${strat.name}' (limit < ${MAX_RANK_LESSON}); rewrite the options`,
      )
    }
    if (fleetGated && lessonP >= MAX_RANK_LESSON) {
      failures.push(`rank: fleet-week is passed with p=${lessonP.toFixed(2)} by the strategy '${strat.name}' (limit < ${MAX_RANK_LESSON}); rewrite the options`)
    }
  }
  const fleetShortest = passProbability(fleetQs.map(pickShortest))
  console.log(`  always-shortest pseudo-lesson p ${fleetShortest.toFixed(2)}`)
}

/* ---- (15)-(18) odd-one-out, cross-validated options-only adversary, composite rules, item-level cue limit ---- */

const REASON = /\b(?:because|since|which means|as a result)\b|\bso(?![-\w])/gi
const REPO_ROOT = new URL('../', import.meta.url)

/** Source file of each lesson, found by its `id:` so lessons whose slug differs from the file name still resolve. */
const lessonFile = new Map<string, string>()
for (const track of await readdir(new URL('src/data/lessons/', REPO_ROOT), { withFileTypes: true })) {
  if (!track.isDirectory()) continue
  for (const name of await readdir(new URL(`src/data/lessons/${track.name}/`, REPO_ROOT))) {
    if (!name.endsWith('.ts')) continue
    const path = `src/data/lessons/${track.name}/${name}`
    const m = /^ {2}id: '([^']+)'/m.exec(await readFile(new URL(path, REPO_ROOT), 'utf8'))
    if (m) lessonFile.set(m[1], path)
  }
}

// Errata retrieval items (src/data/errata/*.ts `items`): single-answer, no lesson, always gated.
const errataItems: Item[] = []
const errataFile = new Map<Item, string>()
{
  const dir = new URL('src/data/errata/', REPO_ROOT)
  const files = (await readdir(dir)).filter((name) => name.endsWith('.ts') && /^\d/.test(name)).sort()
  for (const file of files) {
    const mod = (await import(new URL(file, dir).href)) as { default?: { items?: QuizQuestion[] } }
    ;(mod.default?.items ?? []).forEach((q, i) => {
      const item: Item = { track: ERRATA_TRACK, lessonId: null, qi: i, ref: `${file.slice(0, -3)}#${i}`, q, needsExplanation: false }
      const errs = structureErrors(item)
      if (errs.length) {
        failures.push(`structure: src/data/errata/${file} items[${i}]: ${errs.join('; ')}`)
      } else {
        errataItems.push(item)
        errataFile.set(item, `src/data/errata/${file}`)
      }
    })
  }
}

const gatedLessonItems = validItems.filter((i) => i.lessonId !== null && whyRequired.includes(i.track))
const gatedFleetItems = validItems.filter((i) => i.track === FLEET_TRACK && whyRequired.includes(FLEET_TRACK))
const gatedItems = [...gatedLessonItems, ...gatedFleetItems, ...errataItems]
const sourceOf = (i: Item): string =>
  i.track === ERRATA_TRACK
    ? (errataFile.get(i) as string)
    : i.track === FLEET_TRACK
      ? 'src/lib/fleet-week.ts'
      : (lessonFile.get(i.lessonId as string) ?? i.lessonId ?? i.ref)
const stemOf = (i: Item): string => {
  if (i.track === FLEET_TRACK) return i.ref
  const text = i.q.q.replace(/\s+/g, ' ').trim()
  return text.length > 100 ? `${text.slice(0, 97)}...` : text
}
const poolOf = (i: Item): 'lessons' | 'fleet-week' | 'errata' => (i.track === ERRATA_TRACK ? 'errata' : i.track === FLEET_TRACK ? 'fleet-week' : 'lessons')
const singleKey = (i: Item) => i.q.correct.length === 1
const chanceOf = (rows: Item[]) => (rows.length ? rows.reduce((a, i) => a + 1 / i.q.options.length, 0) / rows.length : NaN)
const hitRateOf = (rows: Item[], p: (i: Item) => number) => (rows.length ? rows.reduce((a, i) => a + p(i), 0) / rows.length : NaN)
const rate = (x: number) => (Number.isFinite(x) ? pct(x) : 'n/a')

/* ---- (15) odd-one-out: no binary feature may single out the key, either way ---- */

const BINARY_FLAGS: { name: string; has: (option: string) => boolean }[] = [
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
function oddOneOut(q: QuizQuestion): string[] {
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

const oddViolations = new Map<Item, string[]>()
for (const item of gatedItems) {
  const v = oddOneOut(item.q)
  if (v.length) oddViolations.set(item, v)
}
for (const [item, v] of oddViolations) {
  failures.push(`odd-one-out: ${sourceOf(item)} [${item.ref}] "${stemOf(item)}": ${v.join('; ')}; rewrite the options so no binary feature isolates the key`)
}

/* ---- (16) cross-validated options-only adversary: a conditional logit over per-option surface features ---- */

const ADVERSARY_COUNTS: { name: string; count: (option: string) => number }[] = [
  ...FEATURES,
  { name: 'colons', count: (o) => matchCount(o, /:/g) },
  { name: 'reason-connectives', count: (o) => matchCount(o, REASON) },
]
const ADV_FEATURES = ADVERSARY_COUNTS.length * 3 + BINARY_FLAGS.length

/** Per option: raw counts, within-item rank (0..1, ties averaged), within-item z-score, then the binary flags. */
function optionVectors(q: QuizQuestion): number[][] {
  const n = q.options.length
  const counts = q.options.map((o) => ADVERSARY_COUNTS.map((f) => f.count(o)))
  const ranks: number[][] = q.options.map(() => [])
  const zs: number[][] = q.options.map(() => [])
  ADVERSARY_COUNTS.forEach((_, j) => {
    const col = counts.map((c) => c[j])
    const m = mean(col)
    const sd = Math.sqrt(mean(col.map((x) => (x - m) ** 2)))
    col.forEach((x, k) => {
      const less = col.filter((y) => y < x).length
      const same = col.filter((y) => y === x).length
      ranks[k].push(n > 1 ? (less + (same - 1) / 2) / (n - 1) : 0)
      zs[k].push(sd > 0 ? (x - m) / sd : 0)
    })
  })
  return q.options.map((o, k) => [...counts[k], ...ranks[k], ...zs[k], ...BINARY_FLAGS.map((f) => (f.has(o) ? 1 : 0))])
}

const dot = (w: number[], x: number[]) => x.reduce((a, v, j) => a + v * w[j], 0)

function softmax(scores: number[]): number[] {
  const top = Math.max(...scores)
  const e = scores.map((s) => Math.exp(s - top))
  const z = e.reduce((a, b) => a + b, 0)
  return e.map((v) => v / z)
}

interface Logit {
  mu: number[]
  sd: number[]
  w: number[]
}

/** Zero-initialised batch gradient descent on the mean negative log-likelihood of the key plus (L2 / 2) |w|^2. No randomness. */
function trainLogit(rows: Item[]): Logit {
  const data = rows.map((i) => ({ x: optionVectors(i.q), key: i.q.correct[0] }))
  const all = data.flatMap((r) => r.x)
  const mu = Array.from({ length: ADV_FEATURES }, (_, j) => mean(all.map((x) => x[j])))
  const sd = Array.from({ length: ADV_FEATURES }, (_, j) => {
    const s = Math.sqrt(mean(all.map((x) => (x[j] - mu[j]) ** 2)))
    return s > 0 ? s : 1
  })
  const std = data.map((r) => ({ key: r.key, x: r.x.map((x) => x.map((v, j) => (v - mu[j]) / sd[j])) }))
  const w = new Array<number>(ADV_FEATURES).fill(0)
  for (let it = 0; it < ADV_ITERATIONS; it++) {
    const grad = new Array<number>(ADV_FEATURES).fill(0)
    for (const r of std) {
      const p = softmax(r.x.map((x) => dot(w, x)))
      p.forEach((pj, k) => {
        const g = pj - (k === r.key ? 1 : 0)
        for (let j = 0; j < ADV_FEATURES; j++) grad[j] += g * r.x[k][j]
      })
    }
    for (let j = 0; j < ADV_FEATURES; j++) w[j] -= ADV_LEARNING_RATE * (grad[j] / std.length + ADV_L2 * w[j])
  }
  return { mu, sd, w }
}

/** Probability the model's argmax pick for one item is the key (ties uniform). */
function logitPick(model: Logit, q: QuizQuestion): number {
  if (q.correct.length !== 1) return 0
  const scores = optionVectors(q).map((x) => dot(model.w, x.map((v, j) => (v - model.mu[j]) / model.sd[j])))
  const best = Math.max(...scores)
  const group = scores.flatMap((s, i) => (best - s <= TIE_EPSILON ? [i] : []))
  return group.includes(q.correct[0]) ? 1 / group.length : 0
}

// Leave-one-track-out over the gated tracks (every gated lesson track, plus fleet-week when gated). The errata
// items are held out of every fold and scored by the model trained on all the gated tracks.
const trainPool = [...gatedLessonItems, ...gatedFleetItems].filter(singleKey)
const heldOutP = new Map<Item, number>()
const foldTracks = [...new Set(trainPool.map((i) => i.track))]
for (const t of foldTracks) {
  const rest = trainPool.filter((i) => i.track !== t)
  if (!rest.length) continue
  const model = trainLogit(rest)
  for (const i of trainPool) if (i.track === t) heldOutP.set(i, logitPick(model, i.q))
}
if (trainPool.length && errataItems.length) {
  const model = trainLogit(trainPool)
  for (const i of errataItems) heldOutP.set(i, logitPick(model, i.q))
}
const advP = (i: Item) => heldOutP.get(i) ?? 0

/** Per-lesson pass probability over the gated lesson tracks under a per-item pick probability. */
function lessonPasses(p: (i: Item) => number): Map<string, number> {
  const per = new Map<string, number[]>()
  for (const i of gatedLessonItems) per.set(i.lessonId as string, [...(per.get(i.lessonId as string) ?? []), p(i)])
  return new Map([...per].map(([id, ps]) => [id, passProbability(ps)]))
}
const sumOf = (m: Map<string, number>, ids?: string[]) => [...m].reduce((a, [id, p]) => (!ids || ids.includes(id) ? a + p : a), 0)

const advLessons = lessonPasses(advP)
const advExpected = sumOf(advLessons)
const lessonRows = gatedLessonItems.filter(singleKey)
const fleetRows = gatedFleetItems.filter(singleKey)
const trackRows = [...lessonRows, ...fleetRows]
const errataRows = errataItems.filter(singleKey)
const advHitTracks = hitRateOf(trackRows, advP)
const advHitErrata = hitRateOf(errataRows, advP)
const chanceTracks = chanceOf(trackRows)
const chanceErrata = chanceOf(errataRows)
if (advExpected > MAX_ADVERSARY_EXPECTED) {
  failures.push(
    `adversary: the leave-one-track-out options-only model expects ${advExpected.toFixed(2)} lessons passed on held-out tracks (limit ${MAX_ADVERSARY_EXPECTED}); remove the surface cues, see the per-track and per-lesson report`,
  )
}
if (advHitTracks > chanceTracks + MAX_HIT_OVER_CHANCE) {
  failures.push(
    `adversary: held-out item hit rate over the gated tracks is ${pct(advHitTracks)} (chance ${pct(chanceTracks)} + ${MAX_HIT_OVER_CHANCE * 100} points = ${pct(chanceTracks + MAX_HIT_OVER_CHANCE)}); the options alone give the key away`,
  )
}
if (errataRows.length && advHitErrata > chanceErrata + MAX_HIT_OVER_CHANCE) {
  failures.push(
    `adversary: errata retrieval items are hit at ${pct(advHitErrata)} (chance ${pct(chanceErrata)} + ${MAX_HIT_OVER_CHANCE * 100} points = ${pct(chanceErrata + MAX_HIT_OVER_CHANCE)}) by a model trained on the gated tracks; rewrite their options`,
  )
}

/* ---- (17) reviewer composite rules ---- */

/** Cross out the options matching each pattern in turn (a step that would cross out every option is skipped), then pick the remaining option with the highest score. */
function pickElimination(q: QuizQuestion, steps: RegExp[], score: (option: string) => number): number {
  if (q.correct.length !== 1) return 0
  let candidates = q.options.map((_, i) => i)
  for (const re of steps) {
    const keep = candidates.filter((i) => !re.test(q.options[i]))
    if (keep.length) candidates = keep
  }
  const best = Math.max(...candidates.map((i) => score(q.options[i])))
  const group = candidates.filter((i) => score(q.options[i]) === best)
  return group.includes(q.correct[0]) ? 1 / group.length : 0
}

const COMPOSITES: { name: string; pick: (q: QuizQuestion) => number }[] = [
  {
    name: 'reviewer: cross out because/since, then "so", then a parenthetical; most , ; : ( )',
    pick: (q) => pickElimination(q, [/\b(?:because|since)\b/i, /\bso(?![-\w])/i, /\(/], (o) => matchCount(o, /[,;:()]/g)),
  },
  {
    name: 'simple: cross out because/since/so and "("; most commas',
    pick: (q) => pickElimination(q, [/\b(?:because|since|so(?![-\w]))|\(/i], (o) => matchCount(o, /,/g)),
  },
]
const compositeResults = COMPOSITES.map((c) => {
  const per = lessonPasses((i) => c.pick(i.q))
  const expected = sumOf(per)
  const worst = [...per].reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0] as [string, number])
  if (expected > MAX_COMPOSITE_EXPECTED) {
    failures.push(
      `composite: '${c.name}' expects ${expected.toFixed(2)} lessons passed over the gated tracks (limit ${MAX_COMPOSITE_EXPECTED}); rewrite the options so the rule does not separate the key`,
    )
  }
  for (const [id, p] of per) {
    if (p >= MAX_RANK_LESSON) {
      failures.push(
        `composite: ${lessonFile.get(id) ?? id} (${id}) is passed with p=${p.toFixed(2)} by '${c.name}' (limit < ${MAX_RANK_LESSON}); rewrite the options so the rule does not separate the key`,
      )
    }
  }
  return { ...c, per, expected, worst }
})

/* ---- (18) item-level cue limit: every single-feature strategy, over all gated items ---- */

const CUE_STRATEGIES = [...RANK_STRATEGIES, ...LEXICAL_STRATEGIES, ...SURFACE_STRATEGIES]
const cueRows = CUE_STRATEGIES.map((s) => {
  // The stem-overlap pair reads the question, which Act IV does not have (its stem is telemetry).
  const rows = (s.name.startsWith('stem-overlap') ? gatedItems.filter((i) => i.track !== FLEET_TRACK) : gatedItems).filter(singleKey)
  const chance = chanceOf(rows)
  const hit = hitRateOf(rows, (i) => s.pick(i.q))
  const by = (pool: string) => {
    const sub = rows.filter((i) => poolOf(i) === pool)
    return sub.length ? hitRateOf(sub, (i) => s.pick(i.q)) : NaN
  }
  const row = { name: s.name, rows: rows.length, chance, hit, lessons: by('lessons'), fleet: by('fleet-week'), errata: by('errata') }
  if (hit > chance + MAX_HIT_OVER_CHANCE) {
    failures.push(
      `cue: the strategy '${s.name}' hits ${pct(hit)} of ${rows.length} gated items (chance ${pct(chance)} + ${MAX_HIT_OVER_CHANCE * 100} points = ${pct(chance + MAX_HIT_OVER_CHANCE)}; lessons ${rate(row.lessons)}, fleet-week ${rate(row.fleet)}, errata ${rate(row.errata)}); rewrite the options so the feature does not separate the key`,
    )
  }
  // The pooled rate can hide a leaking pool, so the two pools large enough to judge are held to the bar on their own too.
  for (const pool of ['lessons', 'errata'] as const) {
    const sub = rows.filter((i) => poolOf(i) === pool)
    if (!sub.length || (hit > chance + MAX_HIT_OVER_CHANCE && sub.length === rows.length)) continue
    const subHit = hitRateOf(sub, (i) => s.pick(i.q))
    const subChance = chanceOf(sub)
    if (subHit > subChance + MAX_HIT_OVER_CHANCE) {
      failures.push(
        `cue: the strategy '${s.name}' hits ${pct(subHit)} of the ${sub.length} ${pool} items on their own (chance ${pct(subChance)} + ${MAX_HIT_OVER_CHANCE * 100} points = ${pct(subChance + MAX_HIT_OVER_CHANCE)}); rewrite the options so the feature does not separate the key`,
      )
    }
  }
  return row
})

/* ---- report ---- */

{
  const gatedTrackIds = trackKeys.filter((t) => t !== FLEET_TRACK && whyRequired.includes(t))
  console.log('')
  console.log(
    `item pool for the odd-one-out, adversary and cue rules: ${gatedLessonItems.length} gated lesson items, ${gatedFleetItems.length} Fleet Week Act IV items, ${errataItems.length} errata retrieval items`,
  )

  console.log('')
  console.log('odd-one-out violations per binary feature (items whose key is the only option with, or the only option without, the feature)')
  for (const flag of BINARY_FLAGS) {
    const hits = [...oddViolations].filter(([, v]) => v.some((m) => m.endsWith(flag.name)))
    const by = (pool: string) => hits.filter(([i]) => poolOf(i) === pool).length
    console.log(`  ${flag.name.slice(0, 98).padEnd(100)}${String(hits.length).padStart(4)}  (lessons ${by('lessons')}, fleet-week ${by('fleet-week')}, errata ${by('errata')})`)
  }
  console.log(`  items with at least one violation: ${oddViolations.size} of ${gatedItems.length}`)

  console.log('')
  console.log(
    `cross-validated options-only adversary: conditional logit, ${ADV_FEATURES} features, ${ADV_ITERATIONS} iterations at lr ${ADV_LEARNING_RATE}, L2 ${ADV_L2}, leave-one-track-out over ${foldTracks.join(', ')}`,
  )
  console.log(`  held-out item hit rate, gated lesson items   ${rate(hitRateOf(lessonRows, advP))}   (chance ${rate(chanceOf(lessonRows))})`)
  console.log(`  held-out item hit rate, Act IV items         ${rate(hitRateOf(fleetRows, advP))}   (chance ${rate(chanceOf(fleetRows))})`)
  console.log(
    `  held-out item hit rate, gated tracks         ${rate(advHitTracks)}   (chance ${rate(chanceTracks)}, limit ${rate(chanceTracks + MAX_HIT_OVER_CHANCE)})${advHitTracks > chanceTracks + MAX_HIT_OVER_CHANCE ? '  FAIL' : ''}`,
  )
  console.log(
    `  held-out item hit rate, errata items         ${rate(advHitErrata)}   (chance ${rate(chanceErrata)}, limit ${rate(chanceErrata + MAX_HIT_OVER_CHANCE)})${errataRows.length && advHitErrata > chanceErrata + MAX_HIT_OVER_CHANCE ? '  FAIL' : ''}`,
  )
  console.log(
    `  held-out expected lessons passed             ${advExpected.toFixed(2)} of ${advLessons.size}   (limit ${MAX_ADVERSARY_EXPECTED})${advExpected > MAX_ADVERSARY_EXPECTED ? '  FAIL' : ''}`,
  )

  console.log('')
  console.log('reviewer composite rules: expected lessons passed over the gated tracks (worst lesson p)')
  for (const c of compositeResults) {
    console.log(
      `  ${c.name}\n    expected ${c.expected.toFixed(2)} (limit ${MAX_COMPOSITE_EXPECTED}), worst ${c.worst[1].toFixed(2)} ${c.worst[0]}; item hit rate ${rate(hitRateOf(lessonRows, (i) => c.pick(i.q)))} on lessons, ${rate(hitRateOf(fleetRows, (i) => c.pick(i.q)))} on Act IV, ${rate(hitRateOf(errataRows, (i) => c.pick(i.q)))} on errata`,
    )
  }

  console.log('')
  console.log(`item-level cue limit: hit rate of every single-feature strategy over all gated items (above chance + ${MAX_HIT_OVER_CHANCE * 100} points fails)`)
  console.log(`  ${'strategy'.padEnd(26)}${'items'.padStart(6)}${'hit'.padStart(8)}${'chance'.padStart(8)}${'lessons'.padStart(9)}${'fleet'.padStart(8)}${'errata'.padStart(8)}`)
  for (const r of cueRows) {
    console.log(
      `  ${r.name.padEnd(26)}${String(r.rows).padStart(6)}${rate(r.hit).padStart(8)}${rate(r.chance).padStart(8)}${rate(r.lessons).padStart(9)}${rate(r.fleet).padStart(8)}${rate(r.errata).padStart(8)}${[r.hit - r.chance, r.lessons - chanceOf(lessonRows), r.errata - chanceOf(errataRows)].some((d) => d > MAX_HIT_OVER_CHANCE) ? '  FAIL' : ''}`,
    )
  }

  console.log('')
  console.log('per track (gated): items, items with an odd-one-out violation, adversary held-out hit rate, adversary and composite expected lessons passed')
  console.log(`  ${'track'.padEnd(12)}${'items'.padStart(6)}${'odd'.padStart(6)}${'adv hit'.padStart(9)}${'adv exp'.padStart(9)}${compositeResults.map((_, k) => `comp${k + 1}`.padStart(8)).join('')}`)
  for (const t of [...gatedTrackIds, ...(gatedFleetItems.length ? [FLEET_TRACK] : []), ERRATA_TRACK]) {
    const rows = gatedItems.filter((i) => i.track === t)
    if (!rows.length) continue
    const ids = [...new Set(rows.flatMap((i) => (i.lessonId ? [i.lessonId] : [])))]
    const exp = (m: Map<string, number>) => (ids.length ? sumOf(m, ids).toFixed(2) : 'n/a')
    console.log(
      `  ${t.padEnd(12)}${String(rows.length).padStart(6)}${String(rows.filter((i) => oddViolations.has(i)).length).padStart(6)}${rate(hitRateOf(rows.filter(singleKey), advP)).padStart(9)}${exp(advLessons).padStart(9)}${compositeResults.map((c) => exp(c.per).padStart(8)).join('')}`,
    )
  }

  console.log('')
  console.log('per lesson (gated): odd-one-out violating items / items, adversary held-out p(pass), composite p(pass) per rule (* = p >= 0.5)')
  for (const id of advLessons.keys()) {
    const rows = gatedLessonItems.filter((i) => i.lessonId === id)
    const odd = rows.filter((i) => oddViolations.has(i)).length
    const comps = compositeResults.map((c, k) => {
      const p = c.per.get(id) as number
      return `comp${k + 1} ${p.toFixed(2)}${p >= MAX_RANK_LESSON ? '*' : ' '}`
    })
    console.log(`  ${id.padEnd(8)}${`${odd}/${rows.length}`.padStart(5)}  adv ${(advLessons.get(id) as number).toFixed(2)}  ${comps.join('  ')}  ${lessonFile.get(id) ?? ''}`)
  }
}

console.log('')
console.log(`blind-strategy simulation: ${byLesson.size} lessons with a quiz, per-attempt shuffling, pass at >= ${PASS_BAR * 100}%`)
console.log(
  `  always pick display position B   expected lessons passed ${bMean.toFixed(2)}  (2-SD band ${Math.max(0, bMean - 2 * bSd).toFixed(2)} to ${(bMean + 2 * bSd).toFixed(2)})`,
)
console.log(`  always pick the longest option   lessons passed ${longestMean.toFixed(2)}  (ties broken at random)`)
console.log(`  always pick the shortest option  lessons passed ${shortestMean.toFixed(2)}  (ties broken at random)`)
console.log(
  `  shortest, lessons passed (p >= 50%) / expected, per track: ${trackKeys
    .filter((t) => t !== FLEET_TRACK)
    .map((t) => `${t} ${shortestPassedByTrack[t]}/${shortestExpectedByTrack[t].toFixed(2)}${whyRequired.includes(t) ? '*' : ''}`)
    .join('  ')}  (* limit ${MAX_SHORTEST_PASSES})`,
)
console.log(`  chance + 2 SD is the bar: ${(bMean + 2 * bSd).toFixed(2)} lessons`)
console.log('  note: shuffling does NOT defeat the longest-option cue; the Wave 0b distractor rewrite does.')

console.log('')
console.log(`exported key position (${totalExportedKeys} keys across lesson quizzes, limit ${MAX_EXPORT_SHARE * 100}% per id)`)
console.log(
  `  ${exportedKeys.map((c, pos) => `o${pos + 1} ${pct(totalExportedKeys ? (c ?? 0) / totalExportedKeys : 0)} (${c ?? 0})`).join('  ')}`,
)

console.log('')
console.log(`shuffle sanity: ${SEEDS} seeds, n=${N}, worst deviation from 25% is ${(worst * 100).toFixed(2)} points`)
console.log(
  `ratchet: ${baselineWritten ? 'baseline written' : baseline ? 'baseline loaded' : 'no baseline'}${improvements.length ? `; below baseline (${improvements.join(', ')}), run --update-baseline to lock it in` : ''}`,
)

if (failures.length) {
  console.error('')
  console.error(`verify-items: ${failures.length} failure(s)`)
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log('')
console.log('verify-items: ok')
