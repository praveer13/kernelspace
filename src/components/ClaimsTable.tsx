/**
 * ClaimsTable — every claim in the registry, with its source and freshness.
 * The /freshness page mounts it; expiry only flags a row, it never hides one.
 */
import { useState } from 'react'
import { CLAIMS, formatClaimValue, staleSince } from '@/data/claims'
import { cn } from '@/lib/utils'

export function ClaimsTable({ className }: { className?: string }) {
  const [now] = useState(() => new Date())
  return (
    <div className={cn('overflow-x-auto rounded-md border border-line', className)}>
      <table className="w-full font-mono text-[12px]" data-testid="claims-table">
        <thead>
          <tr className="border-b border-line text-left text-text-3">
            <th className="p-2.5">claim</th>
            <th className="p-2.5">value</th>
            <th className="p-2.5">kind</th>
            <th className="p-2.5">source</th>
            <th className="p-2.5">verified</th>
            <th className="p-2.5">status</th>
          </tr>
        </thead>
        <tbody>
          {CLAIMS.map((claim) => {
            const stale = staleSince(claim, now)
            return (
              <tr key={claim.id} className="border-b border-line/60 align-top">
                <td className="p-2.5">
                  <div className="text-text-1">{claim.label}</div>
                  <div className="text-[10px] text-text-3">{claim.id}</div>
                  {claim.boundary && <div className="mt-1 text-[10px] text-text-3">Holds for: {claim.boundary}</div>}
                  {claim.discrepancy && (
                    <div className="mt-1 text-[10px] text-amber">Discrepancy: {claim.discrepancy}</div>
                  )}
                </td>
                <td className="whitespace-nowrap p-2.5 text-accent">{formatClaimValue(claim)}</td>
                <td className={cn('p-2.5', claim.kind === 'synthetic' ? 'text-amber' : 'text-text-3')}>{claim.kind}</td>
                <td className="p-2.5">
                  {claim.source ? (
                    <a
                      href={claim.source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-info underline underline-offset-2"
                    >
                      {claim.source.title}
                    </a>
                  ) : claim.derived ? (
                    <span className="text-text-3">{claim.derived.formula}</span>
                  ) : (
                    <span className="text-text-3">none (synthetic)</span>
                  )}
                  {claim.source?.quote && <q className="mt-1 block text-[10px] text-text-3">{claim.source.quote}</q>}
                </td>
                <td className="whitespace-nowrap p-2.5 text-text-3">{claim.verifiedAt}</td>
                <td className={cn('whitespace-nowrap p-2.5', stale ? 'text-amber' : 'text-text-3')}>
                  {stale ? `stale since ${stale}` : `fresh · ${claim.ttlDays} d`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default ClaimsTable
