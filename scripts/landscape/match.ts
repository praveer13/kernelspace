/**
 * match — the watcher's matcher (docs/specs/wave-2.md §18).
 *
 * Reads release-note lines from the committed snapshot and flags the ones that could change a lesson or a claim,
 * naming the lesson and claim ids they touch. A line is a candidate when BOTH hold:
 *
 *   1. it hits the dossier's keyword rule (deprecated, removed, default, renamed, GA; serving-landscape.md:280); and
 *   2. it maps to at least one lesson or claim, in one of two ways:
 *        term  a term tag appears in the line: the title of a KC, the head of a lesson H2, a claim id's last
 *              segment (scoped to the repo the claim is about), or one of the dossier's own tags (KVBM,
 *              InferenceMAX, NIXL). The tag's lessons and claims are the candidate's.
 *        repo  no term hit, but the repo is one a lesson names (watchlist.ts `names`): the candidate carries every
 *              lesson that names the project, plus the claims about the repo. This is the net that catches a line
 *              no tag knows, such as llm-d's fs-connector deprecation, which the dossier's tags did not map.
 *
 * Everything exported here is pure (no clock, no disk, no network; the output depends only on the arguments)
 * except `loadCorpus`, which imports the repo's own data modules, and the `import.meta.main` block, which reads and writes files. The matcher is frozen at the commit that
 * pre-registers the keep bar (docs/prereg/watcher.md); tuning it after seeing a rating invalidates the score.
 *
 *   bun scripts/landscape/match.ts              write docs/backtest/candidates.json
 *   bun scripts/landscape/match.ts --lessons    print the lesson list a rater is given (id, title, hook)
 */
import type { Snapshot, SnapshotRelease } from './fetch'
import { WATCHLIST, watchRepo, type WatchRepo } from './watchlist'

/** The dossier's rule, with the inflections a release note uses (deprecates, removes, defaults to, renames). GA is the only case-sensitive word. */
const KEYWORDS = /\b(deprecat\w*|remov\w*|default\w*|renam\w*)/gi
const GA = /\bGA\b/g
export const KEYWORD_RULE = 'deprecat*|remov*|default*|renam* (any case) | GA (upper case)'

/** The dossier's own tags (serving-landscape.md:280): the baseline the term index extends. Their lessons are the ones whose text names them. */
export const DOSSIER_TAGS = ['KVBM', 'InferenceMAX', 'NIXL'] as const

/** Headings no lesson owns: they say what a section is for, not what it is about. */
const GENERIC_HEADS = new Set(['overview', 'summary', 'introduction', 'takeaways', 'key takeaways', 'what you learned', 'next steps', 'further reading', 'recap'])

export interface CorpusLesson {
  id: string
  title: string
  /** Heading text of each H2, as authored. */
  h2s: string[]
  /** Everything a learner or a claim token could name: title, hook and every block, as one string. */
  text: string
}
export interface CorpusClaim {
  id: string
  /** `owner/name` when the claim is about one repo (its `pin.repo`). */
  repo?: string
}
export interface CorpusKc {
  id: string
  title: string
  lessons: string[]
  claims: string[]
}
export interface Corpus {
  lessons: CorpusLesson[]
  claims: CorpusClaim[]
  kcs: CorpusKc[]
}

export type TermSource = 'kc' | 'h2' | 'claim' | 'tag'

export interface TermEntry {
  /** As shown in a candidate: `kc:KV offloading`. */
  label: string
  /** Normalized phrase (lower case, punctuation as single spaces) the line is searched for. */
  phrase: string
  source: TermSource
  lessons: string[]
  claims: string[]
  /** Only lines from these repos (lower-case `owner/name`) can hit the term; absent means every repo. */
  repos?: string[]
}

export interface TagIndex {
  terms: TermEntry[]
  /** Lower-case repo to the lessons whose text names the project. */
  anchors: Record<string, string[]>
  /** Lower-case repo to the claims that are about it. */
  repoClaims: Record<string, string[]>
}

/** Lower case, every run of non-alphanumerics one space: `llmd-fs-connector` and `LLMD fs_connector` read the same. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function names(text: string, name: string, exact: boolean): boolean {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`, exact ? '' : 'i').test(text)
}

const unique = (xs: readonly string[]) => [...new Set(xs)].sort()

/** The head of a heading: "Automatic Prefix Caching: the block-hash design" is about "Automatic Prefix Caching". */
export function headOf(heading: string): string {
  return heading.split(/\s*(?::|—|–| - |\()\s*/)[0].trim()
}

/** A phrase worth searching for: two words, or one long enough not to be everyday English. */
const distinctive = (phrase: string) => phrase.includes(' ') || phrase.length >= 9

/** The index of terms and anchors a corpus gives the matcher. */
export function buildIndex(corpus: Corpus, watchlist: readonly WatchRepo[] = WATCHLIST): TagIndex {
  const lessonsByClaim = (claimId: string) => corpus.lessons.filter((l) => l.text.includes(claimId)).map((l) => l.id)
  const watchIds = new Map(watchlist.map((w) => [w.id.toLowerCase(), w.repo.toLowerCase()]))
  const raw: TermEntry[] = []

  for (const kc of corpus.kcs) {
    const phrase = normalize(kc.title)
    if (distinctive(phrase)) raw.push({ label: `kc:${kc.title}`, phrase, source: 'kc', lessons: unique(kc.lessons), claims: unique(kc.claims) })
  }

  // a heading that heads sections in three or more lessons is a template, not a topic
  const headCount = new Map<string, number>()
  for (const l of corpus.lessons) for (const h of new Set(l.h2s.map((x) => normalize(headOf(x))))) headCount.set(h, (headCount.get(h) ?? 0) + 1)
  for (const l of corpus.lessons) {
    for (const h2 of l.h2s) {
      const head = headOf(h2)
      const phrase = normalize(head)
      if (!distinctive(phrase) || GENERIC_HEADS.has(phrase) || (headCount.get(phrase) ?? 0) >= 3) continue
      raw.push({ label: `h2:${head}`, phrase, source: 'h2', lessons: [l.id], claims: [] })
    }
  }

  const repoClaims: Record<string, string[]> = {}
  for (const c of corpus.claims) {
    const segments = c.id.split('.')
    const repos = unique([...(c.repo ? [c.repo.toLowerCase()] : []), ...segments.map((s) => watchIds.get(s)).filter((r): r is string => !!r)])
    for (const r of repos) (repoClaims[r] ??= []).push(c.id)
    const phrase = normalize(segments[segments.length - 1])
    if (segments.length > 1 && distinctive(phrase)) {
      raw.push({ label: `claim:${phrase}`, phrase, source: 'claim', lessons: unique(lessonsByClaim(c.id)), claims: [c.id], ...(repos.length ? { repos } : {}) })
    }
  }

  for (const tag of DOSSIER_TAGS) {
    raw.push({ label: `tag:${tag}`, phrase: normalize(tag), source: 'tag', lessons: unique(corpus.lessons.filter((l) => names(l.text, tag, true)).map((l) => l.id)), claims: [] })
  }

  // one entry per (phrase, repo scope): two KCs or headings with the same words pool their lessons and claims
  const merged = new Map<string, TermEntry>()
  for (const t of raw) {
    const key = `${t.phrase}|${t.repos?.join(',') ?? '*'}`
    const prior = merged.get(key)
    if (!prior) merged.set(key, { ...t })
    else {
      prior.lessons = unique([...prior.lessons, ...t.lessons])
      prior.claims = unique([...prior.claims, ...t.claims])
      if (!prior.label.includes(t.label)) prior.label += ` + ${t.label}`
    }
  }
  const terms = [...merged.values()].filter((t) => t.lessons.length > 0 || t.claims.length > 0).sort((a, b) => a.phrase.localeCompare(b.phrase) || a.label.localeCompare(b.label))

  const anchors: Record<string, string[]> = {}
  for (const w of watchlist) {
    anchors[w.repo.toLowerCase()] = unique(corpus.lessons.filter((l) => w.names.some((n) => names(l.text, n, !!w.exact))).map((l) => l.id))
  }
  for (const r of Object.keys(repoClaims)) repoClaims[r] = unique(repoClaims[r])
  return { terms, anchors, repoClaims }
}

/** The keyword rule's hits in a line, as written, in order. */
export function keywordHits(line: string): string[] {
  return [...(line.match(KEYWORDS) ?? []), ...(line.match(GA) ?? [])]
}

export interface ReleaseLine {
  /** 0 for the release title, otherwise the 1-based line number in the release body. */
  n: number
  text: string
}

/** Strip list, quote and heading markers and collapse whitespace: the text a rater copies and the matcher reads. */
export function cleanLine(raw: string): string {
  return raw.trim().replace(/^(?:[-*+>#]+\s+|\d+[.)]\s+)+/, '').replace(/\s+/g, ' ').trim()
}

/** Whether a cleaned line says anything: not a rule, a table divider or a changelog link. */
function isProse(text: string): boolean {
  return text.length >= 8 && /[A-Za-z]{3}/.test(text) && !/^\W*full changelog/i.test(text)
}

/** The lines of one release worth reading: its title, then each body line that says something. */
export function releaseLines(release: Pick<SnapshotRelease, 'name' | 'body'>): ReleaseLine[] {
  const out: ReleaseLine[] = []
  const title = cleanLine(release.name)
  if (isProse(title)) out.push({ n: 0, text: title })
  release.body.split('\n').forEach((raw, i) => {
    const text = cleanLine(raw)
    if (isProse(text)) out.push({ n: i + 1, text })
  })
  return out
}

/** The key a line is rated and scored under: repo and normalized text, so a line repeated in a later release is the same line. */
export const lineKey = (repo: string, text: string) => `${repo.toLowerCase()}|${normalize(cleanLine(text))}`

export interface NovelLine {
  repo: string
  /** The release a line first appeared in, by publication time. */
  tag: string
  releaseUrl: string
  n: number
  text: string
  key: string
  /** How many releases of the repo in the window carry the line. */
  seen: number
}

/**
 * Every distinct line of every release, at its first appearance. Nightly and rc builds repeat their notes
 * (one repo has ninety releases), and a repeated line is not new information, so it is read, rated and scored once.
 */
export function novelLines(snapshot: Pick<Snapshot, 'repos'>): NovelLine[] {
  const out: NovelLine[] = []
  for (const repo of snapshot.repos) {
    const bySeen = new Map<string, NovelLine>()
    const oldestFirst = [...repo.releases].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.tag.localeCompare(b.tag))
    for (const rel of oldestFirst) {
      for (const line of releaseLines(rel)) {
        const key = lineKey(repo.repo, line.text)
        const prior = bySeen.get(key)
        if (prior) prior.seen += 1
        else {
          const novel: NovelLine = { repo: repo.repo, tag: rel.tag, releaseUrl: rel.url, n: line.n, text: line.text, key, seen: 1 }
          bySeen.set(key, novel)
          out.push(novel)
        }
      }
    }
  }
  return out
}

export interface Candidate {
  /** `owner/name@tag#n`. */
  id: string
  repo: string
  tag: string
  releaseUrl: string
  n: number
  line: string
  key: string
  keywords: string[]
  via: 'term' | 'repo'
  /** The term labels that hit (empty for `repo`). */
  terms: string[]
  lessons: string[]
  claims: string[]
}

/** Fields only the matcher writes: a ratings file that carries one of them was not rated blind (score.ts refuses it). */
export const CANDIDATE_FIELDS: readonly (keyof Candidate)[] = ['id', 'keywords', 'via', 'terms', 'lessons', 'claims']

/** The candidate a line makes, or null. `repo` is `owner/name` as the snapshot spells it. */
export function matchLine(line: NovelLine, index: TagIndex): Candidate | null {
  const keywords = keywordHits(line.text)
  if (keywords.length === 0) return null
  const repoKey = line.repo.toLowerCase()
  const padded = ` ${normalize(line.text)} `
  const hits = index.terms.filter((t) => (!t.repos || t.repos.includes(repoKey)) && padded.includes(` ${t.phrase} `))
  const base = { id: `${line.repo}@${line.tag}#${line.n}`, repo: line.repo, tag: line.tag, releaseUrl: line.releaseUrl, n: line.n, line: line.text, key: line.key, keywords }
  if (hits.length > 0) {
    return { ...base, via: 'term', terms: hits.map((t) => t.label), lessons: unique(hits.flatMap((t) => t.lessons)), claims: unique(hits.flatMap((t) => t.claims)) }
  }
  const lessons = index.anchors[repoKey] ?? []
  if (lessons.length === 0 || !watchRepo(line.repo)) return null
  return { ...base, via: 'repo', terms: [], lessons, claims: index.repoClaims[repoKey] ?? [] }
}

/** Every candidate of a snapshot, in snapshot order. */
export function matchSnapshot(snapshot: Pick<Snapshot, 'repos'>, index: TagIndex): Candidate[] {
  const out: Candidate[] = []
  for (const line of novelLines(snapshot)) {
    const c = matchLine(line, index)
    if (c) out.push(c)
  }
  return out
}

/** The corpus of the real repo (lessons, claims, KCs), for the CLI and the tests that read the live data. */
export async function loadCorpus(): Promise<Corpus> {
  const [{ ALL_LESSONS }, { CLAIMS }, { KCS }] = await Promise.all([
    import('../../src/data/lessons/index.ts'),
    import('../../src/data/claims/index.ts'),
    import('../../src/data/kc/index.ts'),
  ])
  return {
    lessons: ALL_LESSONS.map((l: { id: string; title: string; hook: string; blocks: { type: string; md?: string }[] }) => ({
      id: l.id,
      title: l.title,
      h2s: l.blocks.flatMap((b) => (b.type === 'prose' && b.md ? b.md.split('\n').filter((x) => x.startsWith('## ')).map((x) => x.slice(3).trim()) : [])),
      text: `${l.title}\n${l.hook}\n${JSON.stringify(l.blocks)}`,
    })),
    claims: CLAIMS.map((c: { id: string; pin?: { repo: string } }) => ({ id: c.id, repo: c.pin?.repo })),
    kcs: KCS.map((k: { id: string; title: string; lessons: string[]; claims?: string[] }) => ({ id: k.id, title: k.title, lessons: [...k.lessons], claims: [...(k.claims ?? [])] })),
  }
}

if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import('node:fs')
  const { createHash } = await import('node:crypto')
  const corpus = await loadCorpus()
  if (process.argv.includes('--lessons')) {
    const { ALL_LESSONS } = await import('../../src/data/lessons/index.ts')
    for (const l of ALL_LESSONS) console.log(`${l.id}\t${l.title}\t${l.hook}`)
  } else {
    const raw = readFileSync('docs/backtest/snapshot.json', 'utf8')
    const snapshot = JSON.parse(raw) as Snapshot
    const index = buildIndex(corpus)
    const candidates = matchSnapshot(snapshot, index)
    const lines = novelLines(snapshot).length
    const out = {
      schema: 1,
      snapshot: { window: snapshot.window, fetchedAt: snapshot.fetchedAt, sha256: createHash('sha256').update(raw).digest('hex') },
      matcher: { keywordRule: KEYWORD_RULE, terms: index.terms.length, anchoredRepos: Object.values(index.anchors).filter((a) => a.length > 0).length },
      stats: {
        novelLines: lines,
        candidates: candidates.length,
        viaTerm: candidates.filter((c) => c.via === 'term').length,
        viaRepo: candidates.filter((c) => c.via === 'repo').length,
      },
      candidates,
    }
    writeFileSync('docs/backtest/candidates.json', `${JSON.stringify(out, null, 2)}\n`)
    console.log(`wrote docs/backtest/candidates.json: ${candidates.length} candidates of ${lines} distinct lines (${out.stats.viaTerm} by term, ${out.stats.viaRepo} by repo)`)
  }
}
