/**
 * The item block (Wave 2, docs/specs/wave-2.md §5.2): generated items inside a lesson, a prediction
 * first, done after `count` correct answers on fresh seeds. A level-0 stub (2a-03): it renders nothing
 * and exports its final props type, so 2a-12 fills this file without touching the lesson dispatcher.
 */

import type { ItemBlock as ItemBlockData } from '@/data/lessons/types'

export interface ItemBlockProps {
  lessonId: string
  /** The block's index in the lesson; the ledger group is `<lessonId>#<blockIndex>`. */
  blockIndex: number
  block: ItemBlockData
  trackColor: string
}

export default function ItemBlock(props: ItemBlockProps) {
  void props
  return null
}
