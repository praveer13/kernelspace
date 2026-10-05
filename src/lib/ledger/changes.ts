import type { Erratum } from '@/data/errata/schema'
import type { Aggregate, ChangeCard, IsoInstant } from './types'

/**
 * Lesson -> when the learner first completed it (spec §6.6; Wave 0b's `seenClaims`).
 * Ledger v3 starts fresh, so every completion has a known time.
 */
export function selectSeen(agg: Aggregate): Record<string, { learnedAt: IsoInstant }> {
  const seen: Record<string, { learnedAt: IsoInstant }> = {}
  for (const [id, L] of Object.entries(agg.lessons)) {
    if (L.done && L.completedAt !== undefined) seen[id] = { learnedAt: L.completedAt }
  }
  return seen
}

/**
 * S4 change cards (spec §12.2 with Addendum A4): an erratum applies to a learner when its date is
 * later than their completion of an affected lesson. A completion on the fix day itself counts
 * as before it (conservative), so the cut-off is the end of the erratum's UTC day.
 *
 * Sorted: unacked first, then `date` descending, then id.
 */
export function selectChangeCards(agg: Aggregate, errata: readonly Erratum[]): ChangeCard[] {
  const seen = selectSeen(agg)
  const cards: ChangeCard[] = []
  for (const erratum of errata) {
    const cutoff = `${erratum.date}T23:59:59.999Z`
    const lessonIds = erratum.lessons.filter((id) => {
      const learnedAt = seen[id]?.learnedAt
      return learnedAt !== undefined && learnedAt <= cutoff
    })
    if (lessonIds.length === 0) continue
    const learnedAt = lessonIds.map((id) => seen[id].learnedAt).reduce((a, b) => (a <= b ? a : b))
    cards.push({ erratum, lessonIds, learnedAt, acked: agg.acks[`erratum:${erratum.id}`] !== undefined })
  }
  return cards.sort(
    (a, b) =>
      Number(a.acked) - Number(b.acked) ||
      b.erratum.date.localeCompare(a.erratum.date) ||
      a.erratum.id.localeCompare(b.erratum.id),
  )
}
