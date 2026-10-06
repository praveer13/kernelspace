import { useState } from 'react'
import ItemCard from '@/components/items/ItemCard'
import type { ItemResult } from '@/lib/items/play'
import type { Gen } from '@/lib/items/types'
import { progressLabel } from '@/lib/learner/today'
import type { SessionSlot } from '@/lib/learner/types'
import { hash32 } from '@/lib/rng'

export interface SessionProps {
  slots: readonly SessionSlot[]
  /** The session id: it seeds the option order of each authored item. */
  grp: string
  /** The generator families that loaded, so the card grades with each family's own ratio rules. */
  gens: ReadonlyMap<string, Gen>
  /** Called once per item, on Submit. The caller grades nothing: it writes the ledger event. */
  onAnswer: (index: number, slot: SessionSlot, result: ItemResult) => void
  /** The last item's Next. */
  onFinish: () => void
  /** Focus the first item's first control on mount: a set the learner started by pressing a button has just unmounted it. */
  focusFirst?: boolean
}

/**
 * The warm cache (spec §6.8 step 2): one item card at a time, full width, in the shared item player. Each card
 * is keyed by its position, so the next item starts clean; after the verdict Next takes focus, and on the next
 * item the first control does. Nothing animates between items, so there is nothing for reduced motion to suppress.
 */
export default function Session({ slots, grp, gens, onAnswer, onFinish, focusFirst = false }: SessionProps) {
  const [index, setIndex] = useState(0)
  const slot = slots[index]
  if (!slot) return null
  const last = index === slots.length - 1
  const gen = slot.item.source === 'gen' ? gens.get(slot.item.inst.family) : undefined
  return (
    <section aria-label="Review session" data-session-item={index}>
      <ItemCard
        key={index}
        item={slot.item}
        // a generated item keeps its own seed: it is the one the ledger records, and it rebuilds the instance
        {...(slot.item.source === 'gen' ? {} : { seed: hash32(`${grp}:${index}`) })}
        {...(gen ? { gen } : {})}
        eyebrow={progressLabel(index, slots)}
        autoFocus={index > 0 || focusFirst}
        onResult={(result) => onAnswer(index, slot, result)}
        onNext={() => (last ? onFinish() : setIndex(index + 1))}
        nextLabel={last ? 'Finish' : 'Next'}
      />
    </section>
  )
}
