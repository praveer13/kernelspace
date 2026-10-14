/**
 * The scheduler's In-production card (docs/specs/wave-2.md §8.5): the four Compose dials, and the two settings the
 * play fixes, as vLLM and SGLang set them. Every number is a claim chip (W4) with its source; each claim pins the
 * release it was read at (D19), and the card names those releases from the claims, never from its own text.
 */

import { useId } from 'react'
import { ClaimValue } from '@/components/ClaimValue'
import { SCHEDULER_PRODUCTION_ROWS } from '@/data/plays'
import { HEADROOM_TOKENS } from '@/lib/fleet-model'
import { pinnedReleases } from './session'

export default function ProductionCard() {
  const uid = useId()
  const releases = pinnedReleases()
  return (
    <aside aria-labelledby={`${uid}-h`} data-phase="production" className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">In production</p>
      <h3 id={`${uid}-h`} className="mt-2 font-display text-h4 text-text-1">
        Your dials, set by real engines
      </h3>
      <p className="mt-2 text-body-sm text-text-2">
        The reference you just met admits the shortest prompt first, keeps {HEADROOM_TOKENS} tokens of headroom for each running request and never preempts. Real engines
        expose the same choices as settings, and most of them default to something plainer. Tap a number for its source.
      </p>
      {releases.length > 0 && <p className="mt-2 font-mono text-[11px] text-text-3">Read at {releases.join(' and ')}.</p>}
      <ul className="mt-4 space-y-3">
        {SCHEDULER_PRODUCTION_ROWS.map((row) => (
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
