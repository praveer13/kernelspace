/**
 * The DOM mirror of the cube's face views (docs/specs/wave-3.md §6.3): the scene's numbers as a table (FLOPs, bytes,
 * intensity, shared memory, CTAs per SM, the ridge), the same ones the pictures draw. The table is the first
 * representation and the pictures its companions (§6.4: "a DOM table first"): it is visually hidden, and still in the
 * accessibility tree, until "Show data table" is pressed (a 44 px button; it scrolls inside its own region, which takes
 * the keyboard, never the page). A stepper's change is announced through one live region, at most once a second with the
 * newest winning (`createAnnouncer`, the rule every sim's mirror speaks by), so holding a button does not talk over itself.
 */

import { useEffect, useRef, useState } from 'react'
import { MirrorTableView } from '@/components/sims/SimMirror'
import { createAnnouncer, type Announcer } from '@/lib/sims/announcer'
import type { CubeLevel } from '@/lib/world/tiling'
import { tableOf, type Explore } from './session'

export interface MirrorProps {
  /** The id the pictures' `aria-describedby` points at. */
  id: string
  level: CubeLevel
  explore: Explore
}

export default function Mirror({ id, level, explore }: MirrorProps) {
  const [open, setOpen] = useState(false)
  const [spoken, setSpoken] = useState('')
  const announcer = useRef<Announcer | null>(null)
  const table = tableOf(level, explore)

  useEffect(() => {
    const a = createAnnouncer({
      speak: setSpoken,
      now: Date.now,
      schedule: (fn, ms) => {
        const t = setTimeout(fn, ms)
        return () => clearTimeout(t)
      },
    })
    announcer.current = a
    return () => a.cancel()
  }, [])
  useEffect(() => {
    announcer.current?.push(table.announce)
  }, [table.announce])

  return (
    <div data-play-mirror>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex min-h-11 items-center rounded-sm border border-line bg-surface-2 px-3 font-mono text-[11px] text-text-2 hover:border-line-bright hover:text-text-1 motion-safe:transition-colors motion-safe:duration-150"
      >
        {open ? 'Hide data table' : 'Show data table'}
      </button>
      <div
        id={id}
        // an open table scrolls, so it takes the keyboard (axe: scrollable-region-focusable); closed it is sr-only text
        {...(open ? { tabIndex: 0, role: 'region', 'aria-label': table.caption } : {})}
        className={open ? 'mt-2 max-h-72 overflow-auto rounded-sm border border-line bg-surface-1 p-2' : 'sr-only'}
      >
        <MirrorTableView table={{ caption: table.caption, columns: table.columns, rows: table.rows }} />
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {spoken}
      </div>
    </div>
  )
}
