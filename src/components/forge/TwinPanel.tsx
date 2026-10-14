import type { ForgeLab } from '@/data/labs'

/**
 * "The production twin" on ForgeLab (docs/specs/wave-3.md §9, §2.3): once a lab is done, the file in a production
 * codebase that does what the learner just wrote. A stub until 3b-08 fills it; it renders nothing, so ForgeLab mounts
 * it already and 3b-08 never edits that page. A lab without a twin module will render nothing even then.
 */
export interface TwinPanelProps {
  lab: ForgeLab
  /** The lab is done (a credited pass of every required check is in the ledger). */
  done: boolean
}

export default function TwinPanel(props: TwinPanelProps): null {
  void props
  return null
}
