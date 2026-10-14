/**
 * The DOM mirror of the cube's face views (docs/specs/wave-3.md §6.3): the scene's numbers as a table (FLOPs, bytes,
 * intensity, shared memory, CTAs per SM, the ridge), the same ones the pictures draw. The table is the first
 * representation and the pictures its companions (§6.4: "a DOM table first"): it is visually hidden, and still in the
 * accessibility tree, until "Show data table" is pressed. A stepper's change is announced through the shared live
 * region, at most once a second with the newest winning (SimMirror), so holding a button does not talk over itself.
 */

import SimMirror from '@/components/sims/SimMirror'
import type { CubeLevel } from '@/lib/world/tiling'
import { tableOf, type Explore } from './session'

export interface MirrorProps {
  /** The id the pictures' `aria-describedby` points at. */
  id: string
  level: CubeLevel
  explore: Explore
}

export default function Mirror({ id, level, explore }: MirrorProps) {
  const table = tableOf(level, explore)
  return (
    <div data-play-mirror>
      <SimMirror id={id} table={{ caption: table.caption, columns: table.columns, rows: table.rows, announce: table.announce }} />
    </div>
  )
}
