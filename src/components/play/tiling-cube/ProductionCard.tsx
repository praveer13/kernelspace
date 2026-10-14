/**
 * The cube's In-production card (docs/specs/wave-3.md §6.3): the hardware numbers the six levels priced, and the one
 * kernel setting that matches a dial, as claim chips with their sources (W4). The H100 figures are spec claims; the
 * Triton group size is pinned to the release it was read at, and the card names that release from the claim.
 */

import { useId } from 'react'
import { ClaimValue } from '@/components/ClaimValue'
import { TILING_CUBE, TILING_CUBE_PRODUCTION_ROWS } from '@/data/plays'
import '@/data/claims/lazy/tiling'
import { pinnedReleases } from './session'

export default function ProductionCard() {
  const uid = useId()
  const releases = pinnedReleases(TILING_CUBE.productionClaims)
  return (
    <aside aria-labelledby={`${uid}-h`} data-phase="production" className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">In production</p>
      <h3 id={`${uid}-h`} className="mt-2 font-display text-h4 text-text-1">
        Your tile, set by real hardware
      </h3>
      <p className="mt-2 text-body-sm text-text-2">
        The levels priced tiles on an H100&apos;s own numbers, and a real kernel is tuned against the same ones: Triton&apos;s tutorial autotunes over a list of tile shapes and
        depths for the chip, so a setting you read there is a starting point and not a law. Tap a number for its source.
      </p>
      {releases.length > 0 && <p className="mt-2 font-mono text-[11px] text-text-3">Read at {releases.join(' and ')}.</p>}
      <ul className="mt-4 space-y-3">
        {TILING_CUBE_PRODUCTION_ROWS.map((row) => (
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
