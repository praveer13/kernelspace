/**
 * fetch — the backtest snapshot (docs/specs/wave-2.md §18).
 *
 * Reads every release a watchlist repo published inside the fixed window from the hosting API, once, on the
 * implementer's machine, and writes docs/backtest/snapshot.json. That file is committed, so scoring never
 * touches the network and anyone can reproduce a score from the same bytes.
 *
 *   bun scripts/landscape/fetch.ts                 write docs/backtest/snapshot.json
 *   bun scripts/landscape/fetch.ts --from 2026-08-01 --to 2026-09-30 --out some/other.json
 *
 * GITHUB_TOKEN is optional and local only (the unauthenticated limit of 60 requests an hour covers a run, which
 * takes about 30). A repo whose fetch failed or ran out of budget is written with `complete: false` and a
 * `unverified` reason, never silently as "no releases" (serving-landscape.md:314: partial fetches are
 * [unverified]); the run exits 1 then, so a partial snapshot is not committed by accident.
 */
import { writeFileSync } from 'node:fs'
import { WATCHLIST, WATCH_WINDOW, type WatchRepo } from './watchlist'

export interface SnapshotRelease {
  tag: string
  name: string
  /** ISO timestamp the release was published. */
  publishedAt: string
  url: string
  prerelease: boolean
  /** The release notes as written, line endings normalized to \n. */
  body: string
}

export interface SnapshotRepo {
  id: string
  repo: string
  /** False when the fetch failed or hit a rate limit before it saw the whole window. */
  complete: boolean
  /** Why the repo is `[unverified]`; present only when `complete` is false. */
  unverified?: string
  releases: SnapshotRelease[]
}

export interface Snapshot {
  schema: 1
  window: { from: string; to: string }
  /** When the one fetch ran. */
  fetchedAt: string
  repos: SnapshotRepo[]
}

/** The raw shape of one entry of GET /repos/{owner}/{name}/releases that this file reads. */
export interface ApiRelease {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  draft: boolean
  prerelease: boolean
  created_at: string
  published_at: string | null
}

const DAY_MS = 86_400_000
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The window as epoch milliseconds: from 00:00 UTC of `from` up to, not including, the day after `to`. */
export function windowBounds(window: { from: string; to: string }): { start: number; end: number } {
  if (!DATE.test(window.from) || !DATE.test(window.to)) throw new Error(`window must be YYYY-MM-DD: ${window.from} → ${window.to}`)
  const start = Date.parse(`${window.from}T00:00:00Z`)
  const end = Date.parse(`${window.to}T00:00:00Z`) + DAY_MS
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) throw new Error(`empty window: ${window.from} → ${window.to}`)
  return { start, end }
}

/** True when a timestamp falls inside the window. */
export function inWindow(iso: string, window: { from: string; to: string }): boolean {
  const { start, end } = windowBounds(window)
  const t = Date.parse(iso)
  return !Number.isNaN(t) && t >= start && t < end
}

/** The releases of one API page that belong in the snapshot: published (not draft), inside the window, newest first. */
export function pickReleases(page: readonly ApiRelease[], window: { from: string; to: string }): SnapshotRelease[] {
  const out: SnapshotRelease[] = []
  for (const r of page) {
    if (r.draft || !r.published_at || !inWindow(r.published_at, window)) continue
    out.push({
      tag: r.tag_name,
      name: (r.name ?? '').trim(),
      publishedAt: r.published_at,
      url: r.html_url,
      prerelease: r.prerelease,
      body: (r.body ?? '').replace(/\r\n?/g, '\n').trim(),
    })
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.tag.localeCompare(b.tag))
}

/**
 * Whether paging can stop. The API lists releases by creation date, newest first, and a release is published
 * no earlier than it was created, so a page created wholly before the window opened (with a 30-day margin for
 * a release drafted early and published late) means nothing older can fall inside it.
 */
export function pastWindow(page: readonly ApiRelease[], window: { from: string; to: string }): boolean {
  if (page.length === 0) return true
  const { start } = windowBounds(window)
  return page.every((r) => Date.parse(r.created_at) < start - 30 * DAY_MS)
}

type Fetcher = (url: string, init: { headers: Record<string, string> }) => Promise<Response>

/** One repo's releases in the window. Never throws: a failure marks the repo unverified. */
export async function fetchRepo(
  w: WatchRepo,
  window: { from: string; to: string },
  opts: { token?: string; fetcher?: Fetcher; maxPages?: number } = {},
): Promise<SnapshotRepo> {
  const doFetch = opts.fetcher ?? ((url, init) => fetch(url, init))
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'kernelspace-watcher-backtest' }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  const releases: SnapshotRelease[] = []
  const maxPages = opts.maxPages ?? 30
  for (let page = 1; page <= maxPages; page++) {
    let res: Response
    try {
      res = await doFetch(`https://api.github.com/repos/${w.repo}/releases?per_page=100&page=${page}`, { headers })
    } catch (e) {
      return { id: w.id, repo: w.repo, complete: false, unverified: `network error on page ${page}: ${(e as Error).message}`, releases }
    }
    if (!res.ok) {
      const limited = res.status === 403 || res.status === 429
      const why = limited ? `rate limited (HTTP ${res.status}) on page ${page}` : `HTTP ${res.status} on page ${page}`
      return { id: w.id, repo: w.repo, complete: false, unverified: why, releases }
    }
    const items = (await res.json()) as ApiRelease[]
    releases.push(...pickReleases(items, window))
    if (items.length < 100 || pastWindow(items, window)) return { id: w.id, repo: w.repo, complete: true, releases: dedupe(releases) }
  }
  return { id: w.id, repo: w.repo, complete: false, unverified: `still inside the window after ${maxPages} pages`, releases: dedupe(releases) }
}

function dedupe(releases: SnapshotRelease[]): SnapshotRelease[] {
  const byTag = new Map(releases.map((r) => [r.tag, r]))
  return [...byTag.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.tag.localeCompare(b.tag))
}

/** The whole snapshot, repos in watchlist order. */
export async function buildSnapshot(
  window: { from: string; to: string },
  opts: { token?: string; fetcher?: Fetcher; now?: () => Date } = {},
): Promise<Snapshot> {
  const repos: SnapshotRepo[] = []
  for (const w of WATCHLIST) repos.push(await fetchRepo(w, window, opts))
  return { schema: 1, window: { ...window }, fetchedAt: (opts.now?.() ?? new Date()).toISOString(), repos }
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

export async function main(argv: readonly string[]): Promise<number> {
  const window = { from: arg(argv, '--from') ?? WATCH_WINDOW.from, to: arg(argv, '--to') ?? WATCH_WINDOW.to }
  const out = arg(argv, '--out') ?? 'docs/backtest/snapshot.json'
  windowBounds(window)
  const snapshot = await buildSnapshot(window, { token: process.env.GITHUB_TOKEN || undefined })
  writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`)
  let releases = 0
  for (const r of snapshot.repos) {
    releases += r.releases.length
    console.log(`${r.complete ? 'ok        ' : 'UNVERIFIED'} ${r.repo.padEnd(50)} ${String(r.releases.length).padStart(3)} releases${r.unverified ? `  [${r.unverified}]` : ''}`)
  }
  const partial = snapshot.repos.filter((r) => !r.complete)
  console.log(`wrote ${out}: ${snapshot.repos.length} repos, ${releases} releases in ${window.from} → ${window.to}`)
  if (partial.length > 0) {
    console.error(`${partial.length} repos are [unverified]; rerun (with GITHUB_TOKEN if rate limited) before committing the snapshot`)
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
