/**
 * P1 prequestions (Wave 1, docs/specs/wave-1.md §9.1). Scaffold stub (B1): the props are final,
 * the body is a placeholder until B20 lands the answer card, the reveal and the ledger writes.
 */

import type { Prequestion } from '@/data/lessons/types'

export interface PrequestionsProps {
  lessonId: string
  /** The `predict` block's items, in authored order (refs `pre:<lessonId>#<i>`). */
  items: Prequestion[]
  trackColor: string
}

export default function Prequestions({ lessonId, items, trackColor }: PrequestionsProps) {
  return (
    <aside
      className="my-8 rounded-lg border border-line bg-surface-1 px-5 py-4"
      data-block="predict"
      data-lesson={lessonId}
    >
      <p className="font-mono text-label uppercase" style={{ color: trackColor }}>
        Before you read
      </p>
      <p className="mt-2 font-mono text-body-sm text-text-3">
        {items.length} prequestion{items.length === 1 ? '' : 's'} coming soon.
      </p>
    </aside>
  )
}
