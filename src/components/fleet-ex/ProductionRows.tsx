/**
 * The In-production rows of a Fleet exercise (docs/specs/wave-3.md §5.3, task 3b-20): the pinned claims that name the
 * real setting each sweep's dial stands for, as claim chips with their sources (W4) and the release each was read at.
 * `knee` reads the engines' running-batch caps (`production.vllm.max-num-seqs`, `production.sglang.max-running-requests`,
 * engines.ts); `pd-split` reads the disaggregation flags of the two engines (`lazy/serving3`, §4.4). The copy holds no
 * digits of its own: every number on the card is a claim chip, and the exercise's own constants are in its setup.
 */

import { useId } from 'react'
import type { ReactNode } from 'react'
import { ClaimValue } from '@/components/ClaimValue'
import { byId } from '@/data/claims'
import '@/data/claims/lazy/serving3'
import { PRODUCTION_ROWS, pinnedReleases } from './session'

/** Backticks mark code in the copy. */
function Inline({ text }: { text: string }): ReactNode {
  return text.split('`').map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="rounded-xs bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-text-1">
        {part}
      </code>
    ) : (
      part
    ),
  )
}

export interface ProductionRowsProps {
  /** `FleetExerciseDef.productionClaims`. */
  claims: readonly string[]
}

export default function ProductionRows({ claims }: ProductionRowsProps) {
  const uid = useId()
  const releases = pinnedReleases(claims)
  return (
    <aside aria-labelledby={`${uid}-h`} data-production className="mt-4 rounded-md border border-line bg-surface-2 p-4">
      <p className="section-label">In production</p>
      <h3 id={`${uid}-h`} className="mt-1.5 font-display text-body-sm font-medium text-text-1">
        The real setting behind the dial
      </h3>
      {releases.length > 0 && <p className="mt-1.5 font-mono text-[11px] text-text-3">Read at {releases.join(' and ')}. Tap a value for its source.</p>}
      <ul className="mt-3 space-y-3">
        {claims.map((id) => {
          const row = PRODUCTION_ROWS[id]
          return (
            <li key={id} className="text-body-sm text-text-2" data-claim={id}>
              {row ? (
                <>
                  <span className="mr-2 inline-block rounded-sm bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-accent">{row.dial}</span>
                  <Inline text={row.lead} /> <ClaimValue id={id} className="text-left font-mono text-text-1" />
                  {/^[.,:;]/.test(row.tail) ? '' : ' '}
                  <Inline text={row.tail} />
                </>
              ) : (
                <>
                  {byId[id]?.label ?? id}: <ClaimValue id={id} className="text-left font-mono text-text-1" />
                </>
              )}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
