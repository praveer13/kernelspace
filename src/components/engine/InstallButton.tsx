import type { ForgeLab } from '@/data/labs'
import type { Credit } from '@/lib/forge/run'
import type { LabRunReport } from '@/lib/forge/types'

/**
 * "Install in your engine" on ForgeLab (docs/specs/wave-2.md §10.2, §2.3), shown after a run. A stub until 2b-12
 * fills it; it renders nothing, so ForgeLab mounts it already and 2b-12 never edits that page. It gets the run's
 * report, the credit `creditFor` gave it and the exact module bytes that ran, so it can refuse a reference build
 * or a run without fresh-seed passes, and otherwise install the bytes content-addressed.
 */
export interface InstallButtonProps {
  lab: ForgeLab
  report: LabRunReport
  credit: Credit
  /** The module that produced `report`, as dropped. */
  bytes: ArrayBuffer
}

export default function InstallButton(props: InstallButtonProps): null {
  void props
  return null
}
