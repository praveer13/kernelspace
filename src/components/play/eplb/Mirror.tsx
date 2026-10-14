/**
 * The DOM mirror of the EPLB board (docs/specs/wave-3.md §5.2): the GPUs as a table of their copies, loads and the running
 * imbalance, and the experts as a table of loads and copy counts. They hold every number the board's rows and bars draw.
 *
 * The tables are visually hidden, and still in the accessibility tree, until "Show GPU table" is pressed (a 44 px button);
 * open, they scroll inside their own region, which takes the keyboard, never the page. The live region is turn-based, so it
 * is not throttled: a turn is one announcement ("Turn 6: #3's copy (70 ‰) on GPU 2, now 260 ‰. Busiest GPU 1.04× the mean.
 * Turn 7 of 24: the next copy is …"). The debrief mirrors each layer with the same component and no live line.
 */

import { useState } from 'react'
import { MirrorTableView } from '@/components/sims/SimMirror'
import type { EplbView } from '@/lib/world/eplb'
import { expertRows, gpuCaption, gpuRows } from './session'

export interface MirrorProps {
  /** The id the open region has, for the button's `aria-controls`. */
  id: string
  view: EplbView
  /** Names the tables: "Your GPUs", "The reference's GPUs". */
  title: string
  /** The last turn and the next, spoken when it changes. Omit it for a mirror that never speaks. */
  line?: string
}

export default function Mirror({ id, view, title, line }: MirrorProps) {
  const [open, setOpen] = useState(false)
  const caption = gpuCaption(view, title)
  return (
    <div data-play-mirror>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex min-h-11 items-center rounded-sm border border-line bg-surface-2 px-3 font-mono text-[11px] text-text-2 hover:border-line-bright hover:text-text-1 motion-safe:transition-colors motion-safe:duration-150"
      >
        {open ? 'Hide GPU table' : 'Show GPU table'}
      </button>
      <div
        id={id}
        // an open table scrolls, so it takes the keyboard (axe: scrollable-region-focusable); closed it is sr-only text
        {...(open ? { tabIndex: 0, role: 'region', 'aria-label': `${title}: GPU and expert tables` } : {})}
        className={open ? 'mt-2 max-h-72 space-y-4 overflow-auto rounded-sm border border-line bg-surface-1 p-2' : 'sr-only'}
      >
        <MirrorTableView table={{ caption, columns: ['GPU', 'Copies', 'Load', 'Of the mean'], rows: gpuRows(view) }} />
        <MirrorTableView
          table={{ caption: `${title}: experts, their loads and copies`, columns: ['Expert', 'Load', 'Copies', 'Per copy'], rows: expertRows(view) }}
        />
      </div>
      {line !== undefined && (
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {line}
        </div>
      )}
    </div>
  )
}
