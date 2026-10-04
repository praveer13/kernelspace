/**
 * ClaimValue — a number from the claims registry (PLAN-100X §5.2 S2) rendered with its unit.
 * Tapping it opens the label, source, verification date, staleness, boundary and discrepancy.
 */
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatClaimValue, getClaim, staleSince, type Claim } from '@/data/claims'
import { cn } from '@/lib/utils'

const KIND_NOTE: Record<Claim['kind'], string> = {
  spec: 'vendor spec',
  price: 'dated price',
  benchmark: 'benchmark',
  status: 'status',
  derived: 'derived',
  synthetic: 'synthetic, no real-world source',
}

export function ClaimDetails({ claim }: { claim: Claim }) {
  // Staleness is computed in the browser so a deployed page ages without a rebuild.
  const [now] = useState(() => new Date())
  const stale = staleSince(claim, now)
  return (
    <div className="space-y-2 font-mono text-[11px] leading-relaxed text-text-2">
      <div>
        <p className="text-text-1">{claim.label}</p>
        <p className="text-accent">{formatClaimValue(claim)}</p>
      </div>
      <p className="text-text-3">
        {KIND_NOTE[claim.kind]} · verified {claim.verifiedAt}
        {stale && <span className="text-amber"> · stale since {stale}</span>}
      </p>
      {claim.source && (
        <p>
          <a
            href={claim.source.url}
            target="_blank"
            rel="noreferrer"
            className="text-info underline underline-offset-2"
          >
            {claim.source.title}
          </a>
          {claim.source.row && <span className="text-text-3"> · {claim.source.row}</span>}
          {claim.source.quote && <q className="mt-1 block text-text-3">{claim.source.quote}</q>}
        </p>
      )}
      {claim.derived && (
        <p className="text-text-3">
          <span className="text-text-2">{claim.derived.formula}</span> from {claim.derived.from.join(', ')}
        </p>
      )}
      {claim.boundary && <p className="text-text-3">Holds for: {claim.boundary}</p>}
      {claim.discrepancy && <p className="text-amber">Discrepancy: {claim.discrepancy}</p>}
    </div>
  )
}

interface ClaimValueProps {
  id: string
  /** Replaces the default "value unit" text, e.g. `(c) => '$' + c.value`. */
  format?: (claim: Claim) => string
  className?: string
}

export function ClaimValue({ id, format = formatClaimValue, className }: ClaimValueProps) {
  const claim = getClaim(id)
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={`${claim.label}: ${format(claim)}. Show source`}
        className={cn(
          'cursor-help underline decoration-dotted underline-offset-4 hover:text-accent',
          claim.kind === 'synthetic' && 'decoration-amber',
          className,
        )}
      >
        {format(claim)}
        {claim.kind === 'synthetic' && <sup className="ml-0.5 text-[9px] text-amber">synthetic</sup>}
      </PopoverTrigger>
      <PopoverContent className="w-80 border-line bg-surface-1 p-3">
        <ClaimDetails claim={claim} />
      </PopoverContent>
    </Popover>
  )
}
