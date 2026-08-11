import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Gauge,
  LoaderCircle,
  LockKeyhole,
  Trophy,
  Upload,
} from 'lucide-react'
import {
  LEADERBOARD_BENCHMARK_VERSION,
  isLeaderboardDocument,
  overallGoodput,
  parseSubmissionManifest,
  verifyAndScoreScheduler,
  type LeaderboardDocument,
  type SubmissionScores,
  type VerifiedSchedulerScore,
} from '@/lib/leaderboard'
import { loadTraceArtifact } from '@/lib/traces'
import { cn } from '@/lib/utils'

const PERSONAL_BEST_KEY = 'kernelspace:leaderboard-personal:v1'

interface PersonalBest extends SubmissionScores {
  schemaVersion: 1
  benchmarkVersion: string
  overallGoodput: number
  wasmSha256: string
  fileName: string
  scoredAt: string
}

function readPersonalBest(): PersonalBest | null {
  try {
    const raw = localStorage.getItem(PERSONAL_BEST_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PersonalBest>
    if (
      value.schemaVersion !== 1 ||
      value.benchmarkVersion !== LEADERBOARD_BENCHMARK_VERSION ||
      typeof value.labGoodput !== 'number' ||
      typeof value.fleetGoodput !== 'number' ||
      typeof value.overallGoodput !== 'number' ||
      typeof value.wasmSha256 !== 'string' ||
      typeof value.fileName !== 'string' ||
      typeof value.scoredAt !== 'string'
    ) {
      return null
    }
    return value as PersonalBest
  } catch {
    return null
  }
}

function ScoreCard({ label, value, note }: { label: string; value?: number; note: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-3">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold text-text-1">
        {value === undefined ? '—' : `${value.toFixed(2)}%`}
      </p>
      <p className="mt-2 text-body-sm text-text-3">{note}</p>
    </div>
  )
}

export default function Leaderboard() {
  const [view, setView] = useState<'personal' | 'public'>('personal')
  const [personalBest, setPersonalBest] = useState<PersonalBest | null>(() => readPersonalBest())
  const [latest, setLatest] = useState<VerifiedSchedulerScore | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publicBoard, setPublicBoard] = useState<LeaderboardDocument | null>(null)
  const [publicError, setPublicError] = useState<string | null>(null)
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [sourceCommit, setSourceCommit] = useState('')
  const [optIn, setOptIn] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/leaderboard.json', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`public board fetch failed: ${response.status}`)
        const value: unknown = await response.json()
        if (!isLeaderboardDocument(value)) throw new Error('public leaderboard artifact is malformed')
        if (!cancelled) setPublicBoard(value)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setPublicError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const runBenchmark = async (file: File) => {
    setRunning(true)
    setError(null)
    setLatest(null)
    try {
      const [bytes, burstgpt, lmsysShape] = await Promise.all([
        file.arrayBuffer(),
        loadTraceArtifact('/traces/burstgpt-v2-busiest-hour.json'),
        loadTraceArtifact('/traces/lmsys-chat-1m-published-shape.json'),
      ])
      const verified = await verifyAndScoreScheduler(bytes, burstgpt, lmsysShape)
      setLatest(verified)
      const scores = { labGoodput: verified.labGoodput, fleetGoodput: verified.fleetGoodput }
      const candidate: PersonalBest = {
        schemaVersion: 1,
        benchmarkVersion: LEADERBOARD_BENCHMARK_VERSION,
        ...scores,
        overallGoodput: overallGoodput(scores),
        wasmSha256: verified.wasmSha256,
        fileName: file.name,
        scoredAt: new Date().toISOString(),
      }
      if (!personalBest || candidate.overallGoodput > personalBest.overallGoodput) {
        localStorage.setItem(PERSONAL_BEST_KEY, JSON.stringify(candidate))
        setPersonalBest(candidate)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  const downloadManifest = () => {
    if (!personalBest || !optIn) return
    try {
      setError(null)
      const manifest = parseSubmissionManifest({
        schemaVersion: 1,
        handle: handle.trim(),
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        sourceCommit: sourceCommit.trim().toLowerCase(),
        wasmSha256: personalBest.wasmSha256,
        benchmarkVersion: LEADERBOARD_BENCHMARK_VERSION,
        scores: {
          labGoodput: personalBest.labGoodput,
          fleetGoodput: personalBest.fleetGoodput,
        },
        publish: true,
      })
      const url = URL.createObjectURL(
        new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: 'application/json' }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${manifest.handle}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const activeScore = latest
    ? {
        labGoodput: latest.labGoodput,
        fleetGoodput: latest.fleetGoodput,
        overallGoodput: overallGoodput(latest),
      }
    : personalBest

  return (
    <div className="mx-auto max-w-app px-6 pb-24 pt-16 lg:px-12">
      <Link
        to="/fleet"
        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 transition-colors hover:text-text-1"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> the fleet
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
            standing · zero-server
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-text-1 sm:text-4xl">
            Goodput, independently replayed
          </h1>
          <p className="mt-3 max-w-2xl text-body-lg text-text-2">
            Your scheduler runs locally against the canonical lab and Fleet harnesses. Personal best
            is the default; joining the public board takes an explicit pull request.
          </p>
        </div>
        <div className="flex rounded-lg border border-line bg-surface-1 p-1 font-mono text-[11px]">
          {(['personal', 'public'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setView(item)}
              className={cn(
                'rounded-md px-3 py-2 transition-colors',
                view === item ? 'bg-surface-3 text-accent' : 'text-text-3 hover:text-text-1',
              )}
            >
              {item === 'personal' ? 'personal best' : `public · ${publicBoard?.entries.length ?? '—'}`}
            </button>
          ))}
        </div>
      </div>

      {view === 'personal' ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-8 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <ScoreCard
              label="overall"
              value={activeScore?.overallGoodput}
              note="mean of lab and Fleet goodput"
            />
            <ScoreCard
              label="lab 06"
              value={activeScore?.labGoodput}
              note="mean across synthetic, BurstGPT, LMSYS-shape"
            />
            <ScoreCard
              label="Fleet"
              value={activeScore?.fleetGoodput}
              note="BurstGPT replay through block manager + intake"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
            <section className="rounded-xl border border-line bg-surface-1 p-6">
              <div className="flex items-start gap-3">
                <span className="rounded-lg border border-accent/30 bg-accent/10 p-2 text-accent">
                  <Gauge className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-text-1">Run the fixed benchmark</h2>
                  <p className="mt-1 text-body-sm text-text-2">
                    Choose the release WASM from Forge lab 06. The browser checks its ABI, reruns all
                    six checks independently, then drives the standardized Fleet.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={running}
                onClick={() => inputRef.current?.click()}
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md border border-accent/50 bg-accent/10 px-4 font-mono text-[12px] text-accent transition-colors hover:bg-accent/15 disabled:cursor-wait disabled:opacity-60"
              >
                {running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {running ? 'replaying seven scenarios…' : 'select batching_scheduler.wasm'}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".wasm,application/wasm"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void runBenchmark(file)
                  event.target.value = ''
                }}
              />
              {latest && (
                <div className="mt-5 rounded-lg border border-accent/30 bg-accent/5 p-4">
                  <p className="flex items-center gap-2 font-mono text-[11px] text-accent">
                    <CheckCircle2 className="h-4 w-4" /> independently verified · {latest.fleetTicks} Fleet ticks
                  </p>
                  <div className="mt-3 grid gap-1 font-mono text-[10px] text-text-3 sm:grid-cols-2">
                    {latest.lab.checks.map((check) => (
                      <span key={check.id}>✓ {check.id} · {check.message}</span>
                    ))}
                  </div>
                </div>
              )}
              {error && <p className="mt-4 font-mono text-[11px] leading-relaxed text-danger">{error}</p>}
            </section>

            <aside className="rounded-xl border border-line bg-ink p-6">
              <div className="flex items-center gap-2 text-text-1">
                <LockKeyhole className="h-4 w-4 text-accent" />
                <h2 className="font-mono text-[12px] uppercase tracking-[0.12em]">local by default</h2>
              </div>
              <p className="mt-3 text-body-sm leading-relaxed text-text-2">
                The WASM never leaves this tab. Only the best score, filename, and SHA-256 are saved
                in <code className="text-text-1">localStorage</code>. Clear this site&apos;s storage and it is gone.
              </p>
              {personalBest && (
                <div className="mt-4 border-t border-line pt-4 font-mono text-[10px] text-text-3">
                  <p>{personalBest.fileName}</p>
                  <p className="mt-1 break-all">sha256 {personalBest.wasmSha256}</p>
                  <p className="mt-1">saved {new Date(personalBest.scoredAt).toLocaleString()}</p>
                </div>
              )}
            </aside>
          </div>

          <section className="rounded-xl border border-line bg-surface-1 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text-1">Opt in to the public board</h2>
                <p className="mt-1 max-w-2xl text-body-sm text-text-2">
                  Generate the small JSON manifest, rename the scored WASM to the same handle, and
                  open a pull request with the pair. CI recomputes both numbers from trusted code.
                </p>
              </div>
              <a
                href="https://github.com/praveer13/kernelspace/tree/master/submissions"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-accent hover:underline"
              >
                submission rules <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-3">
                public handle
                <input
                  value={handle}
                  onChange={(event) => setHandle(event.target.value.toLowerCase())}
                  placeholder="your-handle"
                  className="mt-2 h-10 w-full rounded-md border border-line bg-ink px-3 font-mono text-[12px] normal-case tracking-normal text-text-1 outline-none focus:border-accent/60"
                />
              </label>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-3">
                display name · optional
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Name or team"
                  className="mt-2 h-10 w-full rounded-md border border-line bg-ink px-3 text-[12px] normal-case tracking-normal text-text-1 outline-none focus:border-accent/60"
                />
              </label>
              <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-3">
                source commit
                <input
                  value={sourceCommit}
                  onChange={(event) => setSourceCommit(event.target.value)}
                  placeholder="7–40 hex characters"
                  className="mt-2 h-10 w-full rounded-md border border-line bg-ink px-3 font-mono text-[12px] normal-case tracking-normal text-text-1 outline-none focus:border-accent/60"
                />
              </label>
            </div>
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-body-sm text-text-2">
              <input
                type="checkbox"
                checked={optIn}
                onChange={(event) => setOptIn(event.target.checked)}
                className="mt-1 accent-accent"
              />
              <span>
                I choose to publish this handle, display name, source commit, WASM hash, and scores
                in the repository&apos;s static leaderboard JSON.
              </span>
            </label>
            <button
              type="button"
              disabled={!personalBest || !optIn}
              onClick={downloadManifest}
              className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-line bg-surface-2 px-4 font-mono text-[11px] text-text-1 transition-colors hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-4 w-4" /> download {handle || '<handle>'}.json
            </button>
          </section>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-8">
          <section className="overflow-hidden rounded-xl border border-line bg-surface-1">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-6">
              <div className="flex items-start gap-3">
                <span className="rounded-lg border border-amber/30 bg-amber/10 p-2 text-amber">
                  <Trophy className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-text-1">Opt-in public standing</h2>
                  <p className="mt-1 text-body-sm text-text-2">
                    Overall is the arithmetic mean of lab and Fleet goodput. Public traces make
                    reproducibility inspectable—and overfitting possible.
                  </p>
                </div>
              </div>
              {publicBoard && (
                <p className="font-mono text-[10px] text-text-3">
                  {publicBoard.benchmarkVersion} · {publicBoard.generatedAt ? new Date(publicBoard.generatedAt).toLocaleString() : 'not published'}
                </p>
              )}
            </div>
            {publicError ? (
              <p className="p-6 font-mono text-[11px] text-danger">{publicError}</p>
            ) : !publicBoard ? (
              <p className="p-6 font-mono text-[11px] text-text-3">loading static artifact…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
                    <tr className="border-b border-line">
                      <th className="px-6 py-3 font-normal">rank</th>
                      <th className="px-4 py-3 font-normal">scheduler</th>
                      <th className="px-4 py-3 text-right font-normal">overall</th>
                      <th className="px-4 py-3 text-right font-normal">lab 06</th>
                      <th className="px-4 py-3 text-right font-normal">Fleet</th>
                      <th className="px-6 py-3 font-normal">source</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[12px]">
                    <tr className="border-b border-line bg-accent/[0.04] text-text-2">
                      <td className="px-6 py-4 text-text-3">ref</td>
                      <td className="px-4 py-4">kernelspace reference</td>
                      <td className="px-4 py-4 text-right text-accent">{publicBoard.reference.overallGoodput.toFixed(2)}%</td>
                      <td className="px-4 py-4 text-right">{publicBoard.reference.labGoodput.toFixed(2)}%</td>
                      <td className="px-4 py-4 text-right">{publicBoard.reference.fleetGoodput.toFixed(2)}%</td>
                      <td className="px-6 py-4 text-text-3">published baseline</td>
                    </tr>
                    {publicBoard.entries.map((entry) => (
                      <tr key={entry.handle} className="border-b border-line/70 text-text-2 last:border-0">
                        <td className="px-6 py-4 text-text-3">#{entry.rank}</td>
                        <td className="px-4 py-4">
                          <span className="text-text-1">{entry.displayName ?? entry.handle}</span>
                          {entry.displayName && <span className="ml-2 text-text-3">@{entry.handle}</span>}
                        </td>
                        <td className="px-4 py-4 text-right text-accent">{entry.overallGoodput.toFixed(2)}%</td>
                        <td className="px-4 py-4 text-right">{entry.labGoodput.toFixed(2)}%</td>
                        <td className="px-4 py-4 text-right">{entry.fleetGoodput.toFixed(2)}%</td>
                        <td className="px-6 py-4 text-text-3">{entry.sourceCommit.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {publicBoard.entries.length === 0 && (
                  <div className="border-t border-line px-6 py-10 text-center">
                    <p className="font-mono text-[12px] text-text-2">no public submissions yet</p>
                    <p className="mt-2 text-body-sm text-text-3">Your personal benchmark remains fully useful without one.</p>
                  </div>
                )}
              </div>
            )}
          </section>
        </motion.div>
      )}
    </div>
  )
}
