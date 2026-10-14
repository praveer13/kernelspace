/**
 * score — precision and recall of the matcher against an independent rating (docs/specs/wave-2.md §18).
 *
 *   bun scripts/landscape/score.ts                         score docs/backtest/ratings.json, write docs/backtest/report.json
 *   bun scripts/landscape/score.ts --ratings other.json --out other-report.json
 *   bun scripts/landscape/score.ts --dry-run               also score while docs/prereg/watcher.md is unsigned (prints, never writes)
 *
 * The unit is a distinct release-note line (match.ts `novelLines`). A rating file says which lines should change
 * a lesson or a claim, written by a rater who has not seen docs/backtest/candidates.json:
 *
 *   { "schema": 1, "rater": "...", "ratedAt": "YYYY-MM-DD", "sawMatcherOutput": false,
 *     "lines": [ { "repo": "llm-d/llm-d", "tag": "v0.10.0", "line": "<the line, as in the snapshot>",
 *                  "shouldChange": { "lessons": ["t6.l3"], "claims": [] }, "note": "..." } ] }
 *
 * `checkRatings` refuses a file that lists matcher output: a top-level or per-line field the matcher writes
 * (id, keywords, via, terms, lessons, claims, candidates, ...), `sawMatcherOutput` other than false, or a rated set
 * that is exactly the flagged set. It also refuses a line the snapshot does not contain. Scoring itself needs the
 * keep bar signed (docs/prereg/watcher.md), so the bar cannot move after the numbers are known.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { CANDIDATE_FIELDS, lineKey, novelLines, type Candidate, type NovelLine } from './match'
import type { Snapshot } from './fetch'
import { watchRepo } from './watchlist'

/** The keep bar docs/prereg/watcher.md registers (a test holds the two files to the same numbers). */
export const KEEP_BAR = {
  minPrecision: 0.25,
  minRecall: 0.8,
  /** Flagged lines per week the 1.5 h weekly triage budget (PLAN-100X §8.2) can read at about a minute each. */
  maxFlagsPerWeek: 90,
  /** Fewer rated-true lines than this and the rates are too loose to decide on. */
  minTrueLines: 20,
} as const

const RATING_KEYS = new Set(['schema', 'rater', 'ratedAt', 'sawMatcherOutput', 'lines'])
const LINE_KEYS = new Set(['repo', 'tag', 'line', 'shouldChange', 'note'])
const MATCHER_KEYS = new Set<string>([...CANDIDATE_FIELDS, 'candidates', 'flagged', 'matcher', 'stats', 'precision', 'recall', 'key', 'n', 'releaseUrl', 'matched', 'score'])

export interface RatedLine {
  repo: string
  tag?: string
  line: string
  shouldChange?: { lessons?: string[]; claims?: string[] }
  note?: string
}
export interface Ratings {
  schema: 1
  rater: string
  ratedAt: string
  sawMatcherOutput: false
  lines: RatedLine[]
}

export interface RatingCheck {
  ratings?: Ratings
  /** Why the file was refused; empty when `ratings` is set. */
  errors: string[]
  /** Rated lines by `lineKey`, in the snapshot's spelling. */
  keys: Set<string>
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** Validate a ratings file against the snapshot's lines and the matcher's flagged keys. Pure. */
export function checkRatings(raw: unknown, lines: readonly Pick<NovelLine, 'key'>[], flagged: ReadonlySet<string>): RatingCheck {
  const errors: string[] = []
  const keys = new Set<string>()
  if (!isObject(raw)) return { errors: ['ratings must be a JSON object'], keys }
  for (const k of Object.keys(raw)) {
    if (MATCHER_KEYS.has(k)) errors.push(`refused: top-level "${k}" is matcher output; the rater must not have seen it`)
    else if (!RATING_KEYS.has(k)) errors.push(`unknown top-level field "${k}"`)
  }
  if (raw.schema !== 1) errors.push('schema must be 1')
  if (typeof raw.rater !== 'string' || !raw.rater.trim()) errors.push('rater must name who rated (the owner, or "fresh agent: <model>")')
  if (typeof raw.ratedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.ratedAt)) errors.push('ratedAt must be YYYY-MM-DD')
  if (raw.sawMatcherOutput !== false) errors.push('refused: sawMatcherOutput must be false (the rater attests they never saw docs/backtest/candidates.json)')
  if (!Array.isArray(raw.lines)) return { errors: [...errors, 'lines must be an array'], keys }

  const known = new Set(lines.map((l) => l.key))
  raw.lines.forEach((entry: unknown, i: number) => {
    const at = `lines[${i}]`
    if (!isObject(entry)) return void errors.push(`${at} must be an object`)
    for (const k of Object.keys(entry)) {
      if (MATCHER_KEYS.has(k)) errors.push(`refused: ${at} lists "${k}", a field only the matcher writes (rated lines take repo, line and optional shouldChange)`)
      else if (!LINE_KEYS.has(k)) errors.push(`${at}: unknown field "${k}"`)
    }
    if (typeof entry.repo !== 'string' || !watchRepo(entry.repo)) return void errors.push(`${at}: repo "${String(entry.repo)}" is not on the watchlist`)
    if (typeof entry.line !== 'string' || !entry.line.trim()) return void errors.push(`${at}: line must be the release-note text`)
    const key = lineKey(entry.repo, entry.line)
    if (!known.has(key)) return void errors.push(`${at}: no such line in the snapshot for ${entry.repo}: "${entry.line.slice(0, 80)}"`)
    if (keys.has(key)) return void errors.push(`${at}: line rated twice: "${entry.line.slice(0, 80)}"`)
    if (entry.shouldChange !== undefined) {
      const sc = entry.shouldChange
      const ok = isObject(sc) && Object.keys(sc).every((k) => k === 'lessons' || k === 'claims') && Object.values(sc).every((v) => Array.isArray(v) && v.every((s) => typeof s === 'string'))
      if (!ok) errors.push(`${at}: shouldChange takes only lessons and claims, as arrays of ids`)
    }
    keys.add(key)
  })

  if (errors.length === 0 && flagged.size > 3 && keys.size === flagged.size && [...keys].every((k) => flagged.has(k))) {
    errors.push('refused: the rated lines are exactly the matcher\'s flagged lines; that is its output, not an independent rating')
  }
  return errors.length > 0 ? { errors, keys } : { ratings: raw as unknown as Ratings, errors, keys }
}

export interface Interval {
  lo: number
  hi: number
}

/** Wilson score interval for k of n at 95 %; null when n is 0. */
export function wilson(k: number, n: number, z = 1.96): Interval | null {
  if (n === 0) return null
  const p = k / n
  const d = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) }
}

export interface Rates {
  flagged: number
  truth: number
  /** Flagged and rated true. */
  tp: number
  precision: number | null
  recall: number | null
  precisionCi: Interval | null
  recallCi: Interval | null
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b)

function rates(flagged: number, truth: number, tp: number): Rates {
  return { flagged, truth, tp, precision: ratio(tp, flagged), recall: ratio(tp, truth), precisionCi: wilson(tp, flagged), recallCi: wilson(tp, truth) }
}

export interface Report {
  schema: 1
  /** Which snapshot bytes were scored; set by the CLI. */
  snapshotSha256?: string
  rater: string
  ratedAt: string
  weeks: number
  pooled: Rates
  perRepo: Record<string, Rates>
  byVia: Record<'term' | 'repo', Rates>
  flagsPerWeek: number
  /** Of the true lines the matcher flagged and the rater tied to lessons or claims, the share whose candidate names one of them. */
  mapping: { rated: number; hit: number }
  /** Rated-true lines nobody flagged. */
  missed: { repo: string; tag: string; line: string }[]
  /** Repos with at least 3 true lines and none flagged. */
  blindRepos: string[]
  verdict: Verdict
}

export interface Verdict {
  outcome: 'keep' | 'drop' | 'underpowered'
  failures: string[]
}

const daysBetween = (w: { from: string; to: string }) => (Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / 86_400_000 + 1

/** Score candidates against checked ratings. Pure. */
export function score(candidates: readonly Candidate[], ratings: Ratings, lines: readonly NovelLine[], window: { from: string; to: string }): Report {
  const trueKeys = new Set(ratings.lines.map((r) => lineKey(r.repo, r.line)))
  const byKey = new Map(lines.map((l) => [l.key, l]))
  const flaggedKeys = new Set(candidates.map((c) => c.key))
  const repos = [...new Set([...candidates.map((c) => c.repo), ...ratings.lines.map((r) => watchRepo(r.repo)?.repo ?? r.repo)])].sort()
  const repoOf = (key: string) => byKey.get(key)?.repo ?? ''

  const tally = (pickFlagged: (c: Candidate) => boolean, pickTrue: (key: string) => boolean): Rates => {
    const f = candidates.filter(pickFlagged)
    const t = [...trueKeys].filter(pickTrue)
    return rates(f.length, t.length, f.filter((c) => trueKeys.has(c.key)).length)
  }
  const pooled = tally(() => true, () => true)
  const perRepo = Object.fromEntries(repos.map((r) => [r, tally((c) => c.repo === r, (k) => repoOf(k) === r)]))
  // precision by route says which net earns its flags; recall by route is the share of ALL true lines that route alone found
  const byVia = {
    term: tally((c) => c.via === 'term', () => true),
    repo: tally((c) => c.via === 'repo', () => true),
  }

  const missed = [...trueKeys].filter((k) => !flaggedKeys.has(k)).map((k) => byKey.get(k)).filter((l): l is NovelLine => !!l).map((l) => ({ repo: l.repo, tag: l.tag, line: l.text }))
  const blindRepos = repos.filter((r) => perRepo[r].truth >= 3 && perRepo[r].tp === 0)

  let rated = 0
  let hit = 0
  for (const r of ratings.lines) {
    const want = [...(r.shouldChange?.lessons ?? []), ...(r.shouldChange?.claims ?? [])]
    const c = candidates.find((x) => x.key === lineKey(r.repo, r.line))
    if (!c || want.length === 0) continue
    rated += 1
    if (want.some((id) => c.lessons.includes(id) || c.claims.includes(id))) hit += 1
  }

  const weeks = daysBetween(window) / 7
  const flagsPerWeek = candidates.length / weeks
  return {
    schema: 1,
    rater: ratings.rater,
    ratedAt: ratings.ratedAt,
    weeks: Math.round(weeks * 100) / 100,
    pooled,
    perRepo,
    byVia,
    flagsPerWeek: Math.round(flagsPerWeek * 10) / 10,
    mapping: { rated, hit },
    missed,
    blindRepos,
    verdict: judge(pooled, flagsPerWeek, ratings, candidates),
  }
}

/** The pre-registered decision (docs/prereg/watcher.md). */
export function judge(pooled: Rates, flagsPerWeek: number, ratings: Ratings, candidates: readonly Candidate[]): Verdict {
  if (pooled.truth < KEEP_BAR.minTrueLines) {
    return { outcome: 'underpowered', failures: [`only ${pooled.truth} rated-true lines; the bar needs at least ${KEEP_BAR.minTrueLines}`] }
  }
  const failures: string[] = []
  const fmt = (x: number | null) => (x === null ? 'n/a' : x.toFixed(3))
  if (pooled.precision === null || pooled.precision < KEEP_BAR.minPrecision) failures.push(`precision ${fmt(pooled.precision)} < ${KEEP_BAR.minPrecision}`)
  if (pooled.recall === null || pooled.recall < KEEP_BAR.minRecall) failures.push(`recall ${fmt(pooled.recall)} < ${KEEP_BAR.minRecall}`)
  if (flagsPerWeek > KEEP_BAR.maxFlagsPerWeek) failures.push(`${flagsPerWeek.toFixed(1)} flags a week > ${KEEP_BAR.maxFlagsPerWeek}`)
  const flagged = new Set(candidates.map((c) => c.key))
  for (const [repo, needle] of [['ai-dynamo/dynamo', 'kvbm'], ['llm-d/llm-d', 'fs connector']] as const) {
    const must = ratings.lines.filter((r) => r.repo.toLowerCase() === repo && /deprecat/i.test(r.line) && normalizeHas(r.line, needle))
    for (const r of must) if (!flagged.has(lineKey(r.repo, r.line))) failures.push(`the ${needle} deprecation was rated true and not flagged: "${r.line.slice(0, 80)}"`)
  }
  return { outcome: failures.length === 0 ? 'keep' : 'drop', failures }
}

const normalizeHas = (line: string, needle: string) => ` ${line.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `.includes(` ${needle} `)

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

/** True when the pre-registration carries an owner signature: a `Signed:` line with a name and a date. */
export function isSigned(prereg: string): boolean {
  return /^Signed:\s*\S.*\d{4}-\d{2}-\d{2}/m.test(prereg)
}

export function main(argv: readonly string[]): number {
  const ratingsPath = arg(argv, '--ratings') ?? 'docs/backtest/ratings.json'
  const out = arg(argv, '--out') ?? 'docs/backtest/report.json'
  const dryRun = argv.includes('--dry-run')
  const prereg = existsSync('docs/prereg/watcher.md') ? readFileSync('docs/prereg/watcher.md', 'utf8') : ''
  if (!isSigned(prereg) && !dryRun) {
    console.error('docs/prereg/watcher.md is not signed: the owner signs the keep bar before anything is scored (use --dry-run to look without writing)')
    return 1
  }
  if (!existsSync(ratingsPath)) {
    console.error(`no ratings at ${ratingsPath}: the independent rater writes it from the snapshot alone (see docs/prereg/watcher.md)`)
    return 1
  }
  const rawSnapshot = readFileSync('docs/backtest/snapshot.json', 'utf8')
  const snapshot = JSON.parse(rawSnapshot) as Snapshot
  const candidatesFile = JSON.parse(readFileSync('docs/backtest/candidates.json', 'utf8')) as { candidates: Candidate[] }
  const lines = novelLines(snapshot)
  const check = checkRatings(JSON.parse(readFileSync(ratingsPath, 'utf8')), lines, new Set(candidatesFile.candidates.map((c) => c.key)))
  if (!check.ratings) {
    for (const e of check.errors) console.error(e)
    return 1
  }
  const report = { ...score(candidatesFile.candidates, check.ratings, lines, snapshot.window), snapshotSha256: createHash('sha256').update(rawSnapshot).digest('hex') }
  const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`)
  console.log(`pooled: precision ${pct(report.pooled.precision)} (${report.pooled.tp}/${report.pooled.flagged}), recall ${pct(report.pooled.recall)} (${report.pooled.tp}/${report.pooled.truth}), ${report.flagsPerWeek} flags a week`)
  for (const [repo, r] of Object.entries(report.perRepo)) console.log(`  ${repo.padEnd(50)} P ${pct(r.precision).padStart(6)}  R ${pct(r.recall).padStart(6)}  flagged ${r.flagged}, true ${r.truth}`)
  console.log(`verdict: ${report.verdict.outcome}${report.verdict.failures.length ? ` (${report.verdict.failures.join('; ')})` : ''}`)
  if (dryRun) return 0
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`wrote ${out}`)
  return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
