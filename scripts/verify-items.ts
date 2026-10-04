/**
 * verify-items — quiz-integrity lint (PLAN-100X §5.1 V1, §7.4).
 *
 * FAILS on: (1) structural defects in any item, (2) a per-track increase in
 * the count of items whose key is strictly the longest option (ratchet against
 * scripts/baselines/verify-items.json), (3) a broken per-attempt shuffle.
 * REPORTS (never fails): longest-key rates and a blind-strategy simulation.
 *
 *   bun scripts/verify-items.ts
 *   bun scripts/verify-items.ts --update-baseline [--force]
 */

import { readFile, writeFile } from 'node:fs/promises'
import type { QuizQuestion } from '../src/components/QuizBlock'
import { ALL_LESSONS, TRACK_IDS } from '../src/data/lessons'
import { INCIDENTS } from '../src/lib/fleet-week'
import { shuffledOrder } from '../src/lib/rng'

const BASELINE_URL = new URL('./baselines/verify-items.json', import.meta.url)
const PASS_BAR = 0.8 // QuizBlock.tsx: score = correct / total >= 0.8
const FLEET_TRACK = 'fleet-week'

interface Item {
  track: string
  lessonId: string | null // null for items that are not lesson quizzes
  ref: string
  q: QuizQuestion
  /** Fleet Week incidents have no authored `explanation`; they are graded on telemetry. */
  needsExplanation: boolean
}

interface Baseline {
  longestKeyByTrack: Record<string, number>
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
        q,
        needsExplanation: true,
      })
    }
  }
}

// Fleet Week Act IV: each incident asks a cause question and a mitigation question.
for (const incident of INCIDENTS) {
  for (const [kind, list] of [
    ['cause', incident.causes],
    ['mitigation', incident.mitigations],
  ] as const) {
    items.push({
      track: FLEET_TRACK,
      lessonId: null,
      ref: `fleet-week ${incident.id} ${kind}`,
      q: {
        q: `${incident.id} ${kind}`,
        options: list.map((o) => o.label),
        correct: list.flatMap((o, i) => (o.correct ? [i] : [])),
      },
      needsExplanation: false,
    })
  }
}

const trackKeys = [...TRACK_IDS, FLEET_TRACK]
const failures: string[] = []

/* ------------------------- (1) structure ------------------------- */

function structureErrors(item: Item): string[] {
  const { options, correct, multi, explanation } = item.q
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
    const next: Baseline = { longestKeyByTrack: longestByTrack }
    await writeFile(BASELINE_URL, `${JSON.stringify(next, null, 2)}\n`)
    baselineWritten = true
  }
} else if (!baseline) {
  failures.push('ratchet: scripts/baselines/verify-items.json is missing or unreadable; run with --update-baseline')
} else if (increases.length) {
  failures.push(`ratchet: key-is-longest count increased (${increases.join(', ')}); rewrite distractors, do not raise the baseline`)
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

/* ------------------------- report ------------------------- */

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

console.log('verify-items report')
console.log('')
console.log('per track (items, key strictly longest, median key / mean-distractor length)')
console.log(`  ${'track'.padEnd(11)}${'items'.padStart(6)}${'key-longest'.padStart(13)}${'%'.padStart(8)}${'median ratio'.padStart(14)}`)
let totalItems = 0
let totalLongest = 0
for (const t of trackKeys) {
  const rows = validItems.filter((i) => i.track === t)
  const ratios = rows.map((i) => {
    const key = mean(i.q.correct.map((c) => len(i.q.options[c])))
    const wrong = i.q.options.filter((_, oi) => !i.q.correct.includes(oi)).map(len)
    return wrong.length ? key / mean(wrong) : NaN
  }).filter((r) => Number.isFinite(r))
  totalItems += rows.length
  totalLongest += longestByTrack[t]
  const share = rows.length ? longestByTrack[t] / rows.length : 0
  console.log(
    `  ${t.padEnd(11)}${String(rows.length).padStart(6)}${String(longestByTrack[t]).padStart(13)}${pct(share).padStart(8)}${median(ratios).toFixed(2).padStart(14)}`,
  )
}
console.log(`  ${'all'.padEnd(11)}${String(totalItems).padStart(6)}${String(totalLongest).padStart(13)}${pct(totalItems ? totalLongest / totalItems : 0).padStart(8)}`)

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

const byLesson = new Map<string, QuizQuestion[]>()
for (const item of validItems) {
  if (!item.lessonId) continue
  byLesson.set(item.lessonId, [...(byLesson.get(item.lessonId) ?? []), item.q])
}
const lessonPass = (strategy: (q: QuizQuestion) => number) =>
  [...byLesson.values()].map((qs) => passProbability(qs.map(strategy)))

const bPass = lessonPass(pickB)
const bMean = bPass.reduce((a, b) => a + b, 0)
const bSd = Math.sqrt(bPass.reduce((a, p) => a + p * (1 - p), 0))
const longestPass = lessonPass(pickLongest)
const longestMean = longestPass.reduce((a, b) => a + b, 0)

console.log('')
console.log(`blind-strategy simulation: ${byLesson.size} lessons with a quiz, per-attempt shuffling, pass at >= ${PASS_BAR * 100}%`)
console.log(
  `  always pick display position B   expected lessons passed ${bMean.toFixed(2)}  (2-SD band ${Math.max(0, bMean - 2 * bSd).toFixed(2)} to ${(bMean + 2 * bSd).toFixed(2)})`,
)
console.log(`  always pick the longest option   lessons passed ${longestMean.toFixed(2)}  (ties broken at random)`)
console.log(`  chance + 2 SD is the bar: ${(bMean + 2 * bSd).toFixed(2)} lessons`)
console.log('  note: shuffling does NOT defeat the longest-option cue; the Wave 0b distractor rewrite does.')

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
