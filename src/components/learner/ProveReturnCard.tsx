import { Suspense, lazy, useEffect, useState } from 'react'
import type { ReturnEnv } from '@/lib/forge/prove-return'
import { getLedgerClient } from '@/lib/ledger/client'
import { daysBetween } from '@/lib/learner/reentry'

/**
 * The 30-day return on Today (docs/specs/wave-3.md §7.5, §2.3, task 3b-04): one question about a lab the learner first
 * proved a month ago, beside the Fleet Daily card on the done card and the empty state. `variant` is the word DailyCard
 * takes.
 *
 * This is the lazy mount and nothing more. It asks the ledger for `prove` events (Today has the engine loaded already)
 * and only when one is at least 30 local days old loads the card itself (ProveReturnBody: the due labs, the question,
 * the lab worker, the forms). A learner with nothing due fetches nothing, and /today's static closure does not grow:
 * this module imports only what the closure already holds, and the rest is its own chunk. ProveReturnBody decides
 * which lab, if any, can be asked, so this check only has to be cheap and never wrong the other way.
 */
export interface ProveReturnCardProps {
  variant: 'done' | 'empty'
  /** The ledger, the lab worker and the clock; tests replace them. */
  env?: Partial<ReturnEnv>
}

const ReturnBody = lazy(() => import('./ProveReturnBody'))

/** prove2.ts's RETURN_AFTER_DAYS, copied so this module imports none of prove2's code. */
const AFTER_DAYS = 30

/** Today's local day as `YYYY-MM-DD`, the form the ledger's `day` takes. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Whether any `prove` event is old enough for its lab's return to be due (the body works out which lab, and whether it was answered). */
async function anyDue(env: Partial<ReturnEnv> | undefined): Promise<boolean> {
  const today = env?.today?.() ?? localDay(new Date())
  const events = env?.events === undefined ? await (await getLedgerClient()).events({ kinds: ['prove'] }) : await env.events()
  return events.some((e) => e.kind === 'prove' && daysBetween(e.day, today) >= AFTER_DAYS)
}

export default function ProveReturnCard({ variant, env }: ProveReturnCardProps) {
  const [due, setDue] = useState(false)
  useEffect(() => {
    let live = true
    void anyDue(env)
      .catch(() => false)
      .then((yes) => {
        if (live) setDue(yes)
      })
    return () => {
      live = false
    }
  }, [env])
  if (!due) return null
  return (
    <Suspense fallback={null}>
      <ReturnBody variant={variant} {...(env === undefined ? {} : { env })} />
    </Suspense>
  )
}
