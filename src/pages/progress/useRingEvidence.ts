import { useEffect, useState } from 'react'
import { selectColdChecks } from '@/lib/economy'
import type { ColdChecks } from '@/lib/economy'
import type { AmberRing } from '@/lib/learner/ring-recall'
import type { RingRecall } from '@/lib/learner/summary'
import { useProgress } from '@/lib/progress'

export interface RingEvidence {
  /** `selectColdChecks` over the ledger; undefined until the ledger has been read (ROOT is not earned without it). */
  cold: ColdChecks | undefined
  /** Predicted recall per ring, for the amber nudge; empty until the cards have been replayed. */
  recall: Partial<Record<AmberRing, RingRecall>>
}

const NONE: RingEvidence = { cold: undefined, recall: {} }

/**
 * What the ring panel needs beyond the snapshot: ROOT's cold checks and each ring's predicted recall. Both
 * come from the events, so they load on demand (the ledger engine, the lesson corpus and the review model)
 * after the rings have painted, and are read again when the aggregate or the records cards replay from change.
 * A failed load leaves the snapshot rings as they are; nothing here gates or revokes a ring.
 */
export function useRingEvidence(): RingEvidence {
  const events = useProgress((s) => s.aggregate.events)
  const week = useProgress((s) => s.working['boot:week'])
  const placement = useProgress((s) => s.working['placement:result'])
  const [evidence, setEvidence] = useState<RingEvidence>(NONE)

  useEffect(() => {
    let live = true
    Promise.all([import('@/lib/ledger/client'), import('@/lib/learner/today'), import('@/lib/learner/ring-recall')])
      .then(async ([{ getLedgerClient }, { loadTodayContent }, { ringRecalls }]) => {
        const [client, content] = await Promise.all([getLedgerClient(), loadTodayContent()])
        const log = await client.events()
        return { cold: selectColdChecks(log), recall: ringRecalls(log, content, { week, placement }) }
      })
      .then((next) => live && setEvidence(next))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [events, week, placement])

  return evidence
}
