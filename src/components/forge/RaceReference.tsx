import type { ForgeLab } from '@/data/labs'
import type { Credit } from '@/lib/forge/run'
import type { LabRunReport } from '@/lib/forge/types'

/**
 * "Race the reference" on ForgeLab (docs/specs/wave-3.md §8.3, §2.3), shown after a run. A stub until 3b-09 fills it;
 * it renders nothing, so ForgeLab mounts it already and 3b-09 never edits that page. It gets the same run values
 * InstallButton does: the report, the credit `creditFor` gave it and the exact module bytes that ran.
 */
export interface RaceReferenceProps {
  lab: ForgeLab
  /** The module that produced `report`, as dropped. */
  bytes: ArrayBuffer
  report: LabRunReport
  credit: Credit
}

export default function RaceReference(props: RaceReferenceProps): null {
  void props
  return null
}
