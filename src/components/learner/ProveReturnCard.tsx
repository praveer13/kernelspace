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
 * the lab worker, the forms). A learner with nothing due, or whose due returns are all answered, fetches nothing, and /today's static closure does not grow:
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

const atMs = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/**
 * Whether some lab's return can be due: a lab whose first `prove` event (the earliest by instant, as prove2.ts's
 * `firstProve`) is 30 or more local days old and which has no answered return among the prove events read (a prove event
 * with `data.return`, as prove-return.ts's `returnAnswered`). A learner who answered every return they were due therefore
 * loads nothing. A return answered as a v1 follow-up is an `item` event, which this check does not read, so that learner
 * still loads the body once per visit and it renders nothing. The body decides which lab can be asked; this check may say
 * yes too often and must never say no to a lab that is due.
 */
async function anyDue(env: Partial<ReturnEnv> | undefined): Promise<boolean> {
  const today = env?.today?.() ?? localDay(new Date())
  const events = env?.events === undefined ? await (await getLedgerClient()).events({ kinds: ['prove'] }) : await env.events()
  const first = new Map<string, { at: number; day: string }>()
  const answered = new Set<string>()
  for (const e of events) {
    if (e.kind !== 'prove' || !e.ref.startsWith('prove:')) continue
    const d: unknown = e.data
    if (typeof d === 'object' && d !== null && (d as { return?: unknown }).return === true) answered.add(e.ref)
    const at = atMs(e.at)
    const best = first.get(e.ref)
    if (best === undefined || at < best.at) first.set(e.ref, { at, day: e.day })
  }
  for (const [ref, f] of first) if (!answered.has(ref) && daysBetween(f.day, today) >= AFTER_DAYS) return true
  return false
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
