/**
 * ClaimValue — a number from the claims registry (PLAN-100X §5.2 S2) rendered with its unit.
 * Tapping it opens the label, source, verification date, staleness, boundary and discrepancy.
 */
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { byId, formatClaimValue, getClaim, staleSince, type Claim } from '@/data/claims'
import { cn } from '@/lib/utils'

const KIND_NOTE: Record<Claim['kind'], string> = {
  spec: 'vendor spec',
  price: 'dated price',
  benchmark: 'benchmark',
  status: 'status',
  derived: 'derived',
  synthetic: 'synthetic, no real-world source',
}

function SourceLink({ source }: { source: NonNullable<Claim['source']> }) {
  return (
    <>
      <a href={source.url} target="_blank" rel="noreferrer" className="text-info underline underline-offset-2">
        {source.title}
      </a>
      {source.row && <span className="text-text-3"> · {source.row}</span>}
      {source.quote && <q className="mt-1 block text-text-3">{source.quote}</q>}
    </>
  )
}

/** One input of a derived claim: its label, value, source link and any discrepancy. */
function DerivedInput({ id }: { id: string }) {
  const input = byId[id]
  if (!input) return <li className="text-amber">{id} (unknown claim)</li>
  return (
    <li className="space-y-0.5 border-l border-line pl-2">
      <p>
        <span className="text-text-2">{input.label}</span> <span className="text-accent">{formatClaimValue(input)}</span>
      </p>
      {input.source ? (
        <p>
          <SourceLink source={input.source} />
        </p>
      ) : (
        <p className="text-text-3">{KIND_NOTE[input.kind]}</p>
      )}
      {input.discrepancy && <p className="text-amber">Discrepancy: {input.discrepancy}</p>}
    </li>
  )
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
          <SourceLink source={claim.source} />
        </p>
      )}
      {claim.derived && (
        <div className="space-y-1 text-text-3">
          <p>
            <span className="text-text-2">{claim.derived.formula}</span> from
          </p>
          <ul className="space-y-1.5">
            {claim.derived.from.map((id) => (
              <DerivedInput key={id} id={id} />
            ))}
          </ul>
        </div>
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
