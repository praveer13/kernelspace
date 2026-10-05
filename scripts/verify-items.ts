/**
 * verify-items — quiz-integrity lint (PLAN-100X §5.1 V1, §7.4).
 *
 * FAILS on: (1) structural defects in any item, (2) a per-track increase in
 * the count of items whose key is strictly the longest option (ratchet against
 * scripts/baselines/verify-items.json), (3) a broken per-attempt shuffle, (4) exported
 * keys piling onto one option id, (5) a shuffled surface that stopped calling shuffledOrder,
 * (6) a malformed per-option `why` (length must equal options, no empty entries) or a missing
 * `why` in a track listed in the baseline's `whyRequired`, (7) more than MAX_SHORTEST_PASSES lessons
 * in a `whyRequired` track that a blind "always pick the shortest option" strategy passes, (8) in a
 * `whyRequired` track, a length-rank strategy (1st-longest, 2nd-longest, 2nd-shortest, shortest) whose
 * expected lessons passed exceeds MAX_RANK_EXPECTED or that passes any single lesson with probability
 * >= MAX_RANK_LESSON, (9) across all `whyRequired` tracks together, a length-rank strategy whose expected
 * lessons passed, summed over those tracks, exceeds MAX_RANK_AGGREGATE (the PLAN-100X exit criterion is at
 * most 1 of the 19 T0-T2 lessons; the per-track bars alone would allow one per track).
 * REPORTS (never fails): longest-key rates, `why` coverage, the length-rank aggregate and a blind-strategy simulation.
 *
 *   bun scripts/verify-items.ts
 *   bun scripts/verify-items.ts --update-baseline [--force]
 */

import { readFile, writeFile } from 'node:fs/promises'
import type { QuizQuestion } from '../src/components/QuizBlock'
import { ALL_LESSONS, TRACK_IDS } from '../src/data/lessons'
import { INCIDENTS } from '../src/lib/fleet-week'
import { exportOrder, shuffledOrder } from '../src/lib/rng'

const BASELINE_URL = new URL('./baselines/verify-items.json', import.meta.url)
const PASS_BAR = 0.8 // QuizBlock.tsx: score = correct / total >= 0.8
const FLEET_TRACK = 'fleet-week'
/** In a whyRequired track, at most this many lessons may be passed by always picking the shortest option. */
const MAX_SHORTEST_PASSES = 1
/** In a whyRequired track, no length-rank strategy may pass more than this many lessons in expectation... */
const MAX_RANK_EXPECTED = 1.0
/** ...or pass any single lesson with at least this probability. */
const MAX_RANK_LESSON = 0.5
/** Summed over every whyRequired track together, no length-rank strategy may pass more than this many lessons in expectation. */
const MAX_RANK_AGGREGATE = 1.0

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

const trackKeys = [...TRACK_IDS, FLEET_TRACK]
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
    const next: Baseline = { longestKeyByTrack: longestByTrack, whyRequired: baseline?.whyRequired ?? [] }
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
const whyRequired = baseline?.whyRequired ?? []
for (const t of whyRequired) {
  if (!trackKeys.includes(t)) failures.push(`why: whyRequired lists unknown track '${t}'`)
}
for (const item of validItems) {
  if (whyRequired.includes(item.track) && !hasWhy(item.q)) {
    failures.push(`why: ${item.ref}: track ${item.track} requires per-option why`)
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
  if (!item.lessonId) continue
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

// Fleet Week Act IV is not a lesson quiz, so the loops above skip it. Its six incident items
// (cause + mitigation per incident) are checked here the same way, as one pseudo-lesson graded at
// PASS_BAR, and per incident, where the game needs the cause AND the mitigation right. Gated when
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
  for (const strat of RANK_STRATEGIES) {
    const ps = fleetQs.map(strat.pick)
    const lessonP = passProbability(ps)
    const incidentPs = INCIDENTS.map((inc, k) => ps[2 * k] * ps[2 * k + 1])
    const worstIncident = Math.max(...incidentPs)
    console.log(
      `  ${strat.name.padEnd(13)}expected key hits ${ps.reduce((a, b) => a + b, 0).toFixed(2)}/${ps.length}  pseudo-lesson p ${lessonP.toFixed(2)}  worst incident p ${worstIncident.toFixed(2)}${fleetGated ? '*' : ''}`,
    )
    if (fleetGated && lessonP >= MAX_RANK_LESSON) {
      failures.push(`rank: fleet-week is passed with p=${lessonP.toFixed(2)} by always picking the ${strat.name} option (limit < ${MAX_RANK_LESSON}); rebalance option lengths`)
    }
    if (fleetGated && lessonP > MAX_RANK_EXPECTED) {
      failures.push(`rank: fleet-week expects ${lessonP.toFixed(2)} passes by always picking the ${strat.name} option (limit ${MAX_RANK_EXPECTED})`)
    }
  }
  const fleetShortest = passProbability(fleetQs.map(pickShortest))
  console.log(`  always-shortest pseudo-lesson p ${fleetShortest.toFixed(2)}`)
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
