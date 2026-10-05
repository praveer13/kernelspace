/**
 * The In-production card (docs/specs/wave-1.md §11.4): the Compose dials as real allocators set them. Every
 * number is a claim chip (W4) with its source, and each line says which dial it corresponds to. The
 * quotes and TTLs live with the claims (src/data/claims/production.ts); the owner verifies each quote.
 */

import { useId } from 'react'
import { ClaimValue } from '@/components/ClaimValue'
import { PRODUCTION_ROWS, type ProductionRow } from '@/data/plays'
import { formatClaimValue, type Claim } from '@/data/claims'

/** The chip's text: the claim as the registry formats it, or its bytes as KiB. */
const chipText = (row: ProductionRow) => (c: Claim) => (row.as === 'kib' && typeof c.value === 'number' ? `${c.value / 1024} KiB` : formatClaimValue(c))

export default function ProductionCard() {
  const uid = useId()
  return (
    <aside aria-labelledby={`${uid}-h`} data-phase="production" className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">In production</p>
      <h3 id={`${uid}-h`} className="mt-2 font-display text-h4 text-text-1">
        Your dials, set by real allocators
      </h3>
      <p className="mt-2 text-body-sm text-text-2">
        Lab 01&apos;s allocator is first fit: it takes the first hole that fits and moves on. The reference you just met is best fit: the smallest hole that fits. Real allocators mix
        the two, a quick rule where requests are common and a tighter search where they are not, because first fit costs less per call and best fit wastes less space. Tap a
        number for its source.
      </p>
      <ul className="mt-4 space-y-3">
        {PRODUCTION_ROWS.map((row) => (
          <li key={row.claim} className="text-body-sm text-text-2">
            <span className="mr-2 inline-block rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-accent">{row.dial}</span>
            {row.lead} <ClaimValue id={row.claim} format={chipText(row)} className="font-mono text-text-1" />
            {/^[.,:;]/.test(row.tail) ? '' : ' '}
            {row.tail}
          </li>
        ))}
      </ul>
    </aside>
  )
}
