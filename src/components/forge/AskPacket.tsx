/**
 * "Ask claude / ask chatgpt" with a context packet (docs/specs/wave-2.md §14.3): the failing checks and the rung
 * the learner reached, copied to the clipboard, beside the hint ladder. A stub until task 2c-06 fills it; the props
 * are final and ForgeLab mounts it with them, so that task never edits the page.
 *
 * Like `HintLadder`, the finished component reads the rung reached from the ledger's `hint:` acks and the failing
 * checks from `reports`, the graded runs of this visit, oldest first.
 */

import type { ForgeLab } from '@/data/labs'
import type { LabRunReport } from '@/lib/forge/types'

export interface AskPacketProps {
  lab: ForgeLab
  reports: readonly LabRunReport[]
}

/** A hidden marker for now: it shows where the finished component mounts, and for which lab. */
export function AskPacket({ lab }: AskPacketProps) {
  return <div hidden data-ask-packet={lab.id} />
}

export default AskPacket
