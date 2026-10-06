import type { Erratum } from '@/data/errata/schema'
import { selectChangeCards } from '@/lib/ledger/changes'
import { emptyAggregate } from '@/lib/ledger/fold'
import type { Aggregate, ChangeCard, IsoInstant } from '@/lib/ledger/types'

/** The consumer view of one lesson that the selector needs: `useProgress().lessons[id]`. */
export interface LessonView {
  status: string
  completedAt?: string
}

/** The two aggregate fields the selector reads, rebuilt from the façade's consumer view. */
function aggregateOf(lessons: Readonly<Record<string, LessonView>>, acks: Readonly<Record<string, IsoInstant>>): Aggregate {
  const agg = emptyAggregate()
  for (const [id, L] of Object.entries(lessons)) {
    // A lesson that was only read keeps its reading time, so it still gets its cards (wave-1.md §3.4).
    if ((L.status === 'done' || L.status === 'read') && L.completedAt) agg.lessons[id] = { done: true, completedAt: L.completedAt }
  }
  agg.acks = { ...acks }
  return agg
}

/** A card whose erratum was replaced by a newer one that also applies would repeat itself, so only the newest shows. */
function dropSuperseded(cards: ChangeCard[]): ChangeCard[] {
  const shown = new Set(cards.map((c) => c.erratum.id))
  const replaced = new Set<string>()
  for (const c of cards) if (c.erratum.supersedes && shown.has(c.erratum.id)) replaced.add(c.erratum.supersedes)
  return cards.filter((c) => !replaced.has(c.erratum.id))
}

/**
 * S4 cards for one learner (ledger spec §12.2, Addendum A4): errata dated on or after the day they
 * finished an affected lesson. A learner with no completed lessons gets none.
 */
export function changeCardsFor(
  lessons: Readonly<Record<string, LessonView>>,
  acks: Readonly<Record<string, IsoInstant>>,
  errata: readonly Erratum[],
): ChangeCard[] {
  return dropSuperseded(selectChangeCards(aggregateOf(lessons, acks), errata))
}
