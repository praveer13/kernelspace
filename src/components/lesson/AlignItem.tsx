/* eslint-disable react-refresh/only-export-components -- the item and its ledger response are exported
   beside the component so the test grades and records exactly what the lesson plays */
/**
 * AlignItem (F4, docs/specs/wave-2.md §17.2): active alignment on a side-by-side. Passive Java/Python
 * beside Rust is far weaker than making the learner map one onto the other (learning-science.md:141),
 * so each code block with an `align` list asks, for example, "Here is the Java version. Which Rust line
 * does the compiler reject, and which permission is missing?" It is an authored choice item with a why
 * per option, played by the shared ItemCard (options in a fresh order per attempt, graded by authored
 * index) and written to the ledger as `item:<lessonId>.align.<n>` with `src: 'lesson'`, where n counts
 * alignment items across the lesson's code blocks in block order, from 1 (the numbering scripts/item-pools.ts
 * gives the same item, spec §17.2). A question without its own `kcs` is
 * recorded under the lesson's, as exit tickets and placement do.
 */
import { useState } from 'react'
import ItemCard from '@/components/items/ItemCard'
import type { QuizQuestion } from '@/components/QuizBlock'
import type { ItemResult } from '@/lib/items/play'
import type { PlayableItem } from '@/lib/items/types'
import type { ItemResponse } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'

/** The ledger caps an item's KCs (codec MAX_KCS); an authored item names 1-3. */
const MAX_KCS = 3

/** The authored item an alignment question plays as: `item:<lessonId>.align.<n>` (n from 1), under its own KCs or else the lesson's. */
export function alignItem(lessonId: string, n: number, q: QuizQuestion, lessonKcs: readonly string[] = []): PlayableItem {
  const kcs = q.kcs && q.kcs.length > 0 ? q.kcs : lessonKcs
  return { source: 'item', item: { id: `${lessonId}.align.${n}`, q, kcs: kcs.slice(0, MAX_KCS) } }
}

/** The ledger event for one answer (src 'lesson', the authored pick, the item's KCs). */
export function alignResponse(lessonId: string, r: ItemResult): ItemResponse {
  return {
    kind: 'item',
    ref: r.ref as ItemResponse['ref'],
    rev: r.rev,
    score: r.score,
    ok: r.ok,
    ...(r.conf ? { conf: r.conf } : {}),
    seed: r.seed,
    ms: r.ms,
    data: {
      src: 'lesson',
      pick: r.pick ?? [],
      lessonId,
      kcs: r.kcs,
      nsec: r.nsec,
      ...(r.grade.diagnosis ? { miss: r.grade.diagnosis.id } : {}),
    },
  }
}

export interface AlignItemProps {
  lessonId: string
  /** The item's number across the lesson's alignment items, counting from 1 as the ledger ref does. */
  n: number
  q: QuizQuestion
  /** The lesson's KCs, recorded when the question names none. */
  lessonKcs?: readonly string[]
  /** The familiar language beside the Rust, for the eyebrow ("Java ↔ Rust"). */
  langLabel?: string
  /** Pinned option order (tests); a fresh order per attempt otherwise. */
  seed?: number
}

export default function AlignItem({ lessonId, n, q, lessonKcs, langLabel, seed: seedProp }: AlignItemProps) {
  const recordItems = useProgress((s) => s.recordItems)
  const [seed, setSeed] = useState(() => seedProp ?? freshSeed())
  const [wrong, setWrong] = useState(false)
  const item = alignItem(lessonId, n, q, lessonKcs)
  const onResult = (r: ItemResult) => {
    recordItems([alignResponse(lessonId, r)])
    setWrong(!r.ok)
  }
  const retry = () => {
    setWrong(false)
    setSeed(freshSeed())
  }
  return (
    <section aria-label={`Alignment item ${n}`} className="mt-4">
      <ItemCard
        key={seed}
        item={item}
        seed={seed}
        onResult={onResult}
        onNext={wrong ? retry : undefined}
        nextLabel="Try again"
        eyebrow={`align · ${langLabel ? `${langLabel} ↔ ` : ''}Rust`}
      />
    </section>
  )
}
