/**
 * ClaimsTable — every claim in the registry, with its source and freshness.
 * The /freshness page mounts it; expiry only flags a row, it never hides one.
 * Each row's id is its claim id, so `/freshness?tab=claims#<id>` (a ⌘K result) lands on it.
 *
 * It lists `ALL_CLAIMS` (all.ts) in the same order, but all.ts imports every group statically, and the physics groups
 * (`lazy/physics`, `lazy/ix-points`) would put about 13 KB gzip into this chunk (S5-D71). So the table imports the
 * groups before them itself, shows those at once, and loads the two physics groups by `await import()` when it mounts;
 * tests/changes/physics-tab.test.ts holds the mounted table to `ALL_CLAIMS`, id for id. A new lazy group goes in both lists.
 */
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { formatClaimValue, staleSince, type Claim } from '@/data/claims'
import { ENGINE_CLAIMS } from '@/data/claims/engines'
import { HARDWARE_CLAIMS } from '@/data/claims/hardware'
import { FIELD_CLAIMS } from '@/data/claims/lazy/field'
import { MOE_CLAIMS } from '@/data/claims/lazy/moe'
import { SERVING3_CLAIMS } from '@/data/claims/lazy/serving3'
import { TILING_CLAIMS } from '@/data/claims/lazy/tiling'
import { TWIN_CLAIMS } from '@/data/claims/lazy/twins'
import { MODEL_CLAIMS } from '@/data/claims/models'
import { PRICE_CLAIMS } from '@/data/claims/prices'
import { PRODUCTION_CLAIMS } from '@/data/claims/production'
import { SERVING_CLAIMS } from '@/data/claims/serving'
import { ZOO_CLAIMS } from '@/data/claims/zoo'
import { cn } from '@/lib/utils'

/** all.ts's order: the eager groups, then the lazy groups before the physics ones. */
const FIRST: readonly Claim[] = [
  ...HARDWARE_CLAIMS,
  ...MODEL_CLAIMS,
  ...PRICE_CLAIMS,
  ...PRODUCTION_CLAIMS,
  ...ENGINE_CLAIMS,
  ...SERVING_CLAIMS,
  ...ZOO_CLAIMS,
  ...MOE_CLAIMS,
  ...SERVING3_CLAIMS,
  ...TILING_CLAIMS,
  ...TWIN_CLAIMS,
  ...FIELD_CLAIMS,
]

/** The groups in order, a claim an earlier group holds skipped, as all.ts (and registerClaims) skip it. */
function inOrder(groups: readonly Claim[]): Claim[] {
  const held = new Set<string>()
  return groups.filter((c) => !held.has(c.id) && Boolean(held.add(c.id)))
}

async function loadPhysicsGroups(): Promise<readonly Claim[]> {
  const [{ PHYSICS_CLAIMS }, { IX_POINT_CLAIMS }] = await Promise.all([import('@/data/claims/lazy/physics'), import('@/data/claims/lazy/ix-points')])
  return [...PHYSICS_CLAIMS, ...IX_POINT_CLAIMS]
}

export function ClaimsTable({ className }: { className?: string }) {
  const [now] = useState(() => new Date())
  const [late, setLate] = useState<readonly Claim[] | 'loading' | 'failed'>('loading')
  const target = decodeURIComponent(useLocation().hash.slice(1))

  useEffect(() => {
    let live = true
    loadPhysicsGroups().then(
      (groups) => live && setLate(groups),
      () => live && setLate('failed'),
    )
    return () => {
      live = false
    }
  }, [])

  const claims = typeof late === 'string' ? inOrder(FIRST) : inOrder([...FIRST, ...late])

  // The table mounts after the tab's chunk loads, so the browser's own anchor scroll has already missed it; a physics
  // claim's row arrives later still, so this runs again when the physics groups land.
  useEffect(() => {
    if (target) document.getElementById(target)?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
  }, [target, late])

  return (
    <div className={cn('overflow-x-auto rounded-md border border-line', className)}>
      <p role="status" className={typeof late === 'string' ? 'p-2.5 font-mono text-[11px] text-text-3' : 'sr-only'}>
        {late === 'loading' ? 'loading the physics claims…' : late === 'failed' ? 'The physics claims did not load; reload the page to list them.' : ''}
      </p>
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
          {claims.map((claim) => {
            const stale = staleSince(claim, now)
            return (
              <tr
                key={claim.id}
                id={claim.id}
                className={cn('scroll-mt-24 border-b border-line/60 align-top', claim.id === target && 'bg-surface-2')}
              >
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
