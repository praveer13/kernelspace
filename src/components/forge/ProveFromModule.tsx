import type { ForgeBundle } from '@/data/forge/types'
import type { ForgeLab } from '@/data/labs'
import type { Credit } from '@/lib/forge/run'
import type { LabRunReport } from '@/lib/forge/types'

/**
 * Prove-it v2 on ForgeLab (docs/specs/wave-3.md §7.2, §2.3): questions drawn from the module the learner just ran. A
 * stub until 3b-04 fills it; it renders nothing, so ForgeLab mounts it already and 3b-04 never edits that page. It
 * gets the lab's bundle (whose `prove2` holds the templates) and the same run values InstallButton does.
 */
export interface ProveFromModuleProps {
  lab: ForgeLab
  bundle: ForgeBundle
  /** The module that produced `report`, as dropped. */
  bytes: ArrayBuffer
  report: LabRunReport
  credit: Credit
}

export default function ProveFromModule(props: ProveFromModuleProps): null {
  void props
  return null
}
