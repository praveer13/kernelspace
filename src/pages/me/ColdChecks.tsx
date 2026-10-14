import type { ColdCheckRow, ColdCheckSummary } from '@/lib/learner/cold-checks'
import { COLD_LONG_DAYS, COLD_MIN_DAYS } from '@/lib/learner/cold-checks'
import { COLD_TRACK_MIN_N, proportionText } from '@/lib/learner/mirror'
import type { Proportion } from '@/lib/learner/outcomes'
import { getTrack } from '@/lib/tracks'

/**
 * /me, cold checks (wave-3.md §12.3, §12.5): Today's unannounced questions about ideas you have not met for a while,
 * at 7 days or more and at 30 days or more, overall and by track. Every figure states its n and an interval, or
 * "not enough data" below 10 checks. No framer-motion, so no MotionScope; no lesson content.
 */

const labelOf = (row: ColdCheckRow): string => {
  if (row.track === null) return 'All tracks'
  const t = getTrack(row.track)
  return t ? `${t.code} · ${t.name}` : row.track.toUpperCase()
}

function Figure({ row, band, p }: { row: ColdCheckRow; band: 'd7' | 'd30'; p: Proportion }) {
  const days = band === 'd7' ? COLD_MIN_DAYS : COLD_LONG_DAYS
  const ok = p.n >= COLD_TRACK_MIN_N
  return (
    <div className="mt-2 sm:mt-0" data-figure={`cold-${row.track ?? 'all'}-${band}`} data-n={p.n} data-enough={ok}>
      <dt className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">{days} days or more</dt>
      <dd className={ok ? 'text-body-sm text-text-1' : 'text-body-sm text-text-2'}>{proportionText(p, COLD_TRACK_MIN_N, 'checks')}</dd>
    </div>
  )
}

export default function ColdChecks({ cold }: { cold: ColdCheckSummary }) {
  const rows = [cold.overall, ...cold.tracks]
  return (
    <section aria-labelledby="mirror-cold-heading" className="rounded-lg border border-line bg-surface-1 p-6" data-mirror="cold-checks">
      <h2 id="mirror-cold-heading" className="font-display text-h3 text-text-1">
        Cold checks
      </h2>
      <p className="mt-2 max-w-[60ch] text-body-sm text-text-2">
        Today sometimes asks about an idea you have not met for a while, without warning and without a hint. This is how those went, counted by how
        long it had been. A figure needs {COLD_TRACK_MIN_N} checks before it shows a rate.
      </p>

      {cold.overall.d7.n === 0 ? (
        <p className="mt-4 text-body-sm text-text-2" data-figure="cold-all-d7" data-n={0} data-enough={false}>
          No cold check yet: not enough data (n = 0 checks, needs {COLD_TRACK_MIN_N}). They appear in Today once an idea has been away for {COLD_MIN_DAYS}{' '}
          days.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.track ?? 'all'} className="py-3 first:pt-0 last:pb-0" data-cold-row={row.track ?? 'all'}>
              <h3 className="text-body text-text-1">{labelOf(row)}</h3>
              <dl className="sm:grid sm:grid-cols-2 sm:gap-4">
                <Figure row={row} band="d7" p={row.d7} />
                <Figure row={row} band="d30" p={row.d30} />
              </dl>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-4 text-body-sm text-text-2">
        <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-2 hover:text-accent">How this is counted</summary>
        <p className="max-w-[60ch] pb-2">
          Only Today&apos;s unannounced questions count, and an answer you took a hint for does not. A check counts once in the 7-day band and again in
          the 30-day band when it was that old, and once in each track its ideas belong to. The interval is the Wilson 95 % interval on the share you got
          right: with few checks it is wide, and that width is the point.
        </p>
      </details>
    </section>
  )
}
