/**
 * The EPLB play's In-production card (docs/specs/wave-3.md §5.2): the model the toy layer shrinks, DeepSeek EPLB's rule that
 * the reference plays, and the engine flags that turn it on, as claim chips with their sources (W4). The claims live in the
 * lazy `moe` group, which this card imports, so the play's first paint carries none of them. Each pinned claim names the
 * release or commit it was read at, and the card prints those from the claims, never from its own text.
 */

import { useId } from 'react'
import { ClaimValue } from '@/components/ClaimValue'
import { EPLB_PRODUCTION_ROWS } from '@/data/plays'
import '@/data/claims/lazy/moe'
import { pinnedReleases } from './session'

/** "a, b and c". */
const list = (xs: readonly string[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

export default function ProductionCard() {
  const uid = useId()
  const releases = pinnedReleases()
  return (
    <aside aria-labelledby={`${uid}-h`} data-phase="production" className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">In production</p>
      <h3 id={`${uid}-h`} className="mt-2 font-display text-h4 text-text-1">
        Your two dials, set by real engines
      </h3>
      <p className="mt-2 text-body-sm text-text-2">
        The reference you just met is DeepSeek&apos;s published EPLB rule, and the two engines below ship EPLB switched off. A real layer has far more experts than
        yours, and its loads are measured while it serves, not dealt. Tap a number for its source.
      </p>
      {releases.length > 0 && <p className="mt-2 font-mono text-[11px] text-text-3">Read at {list(releases)}.</p>}
      <ul className="mt-4 space-y-3">
        {EPLB_PRODUCTION_ROWS.map((row) => (
          <li key={row.claim} className="text-body-sm text-text-2">
            <span className="mr-2 inline-block rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-accent">{row.dial}</span>
            {row.lead} <ClaimValue id={row.claim} className="font-mono text-text-1" />
            {/^[.,:;]/.test(row.tail) ? '' : ' '}
            {row.tail}
          </li>
        ))}
      </ul>
    </aside>
  )
}
