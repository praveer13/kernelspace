/**
 * DOM mirror of the heap grid (docs/specs/wave-1.md §11.2): the run list (start, size, free or used) as a
 * table, plus an aria-live line per turn ("Placed 3 cells at cell 12. Largest free run: 9 cells.").
 *
 * The table is visually hidden, and still in the accessibility tree, until "Show run list" is pressed.
 * The live region is turn-based, so it is not throttled: a turn is one announcement. The debrief mirrors
 * its two heaps with the same component and no live line.
 */

import { useState } from 'react'
import { MirrorTableView } from '@/components/sims/SimMirror'
import { cellWord } from '@/data/plays'
import { cells } from '@/lib/world/placement'
import type { HeapView } from '@/lib/world/types'

export interface MirrorProps {
  /** The id the grid's `aria-describedby` points at. */
  id: string
  view: HeapView
  /** Names the table: "Your heap", "The reference's heap after op 12". */
  title: string
  /** The last turn, spoken when it changes. Omit it for a mirror that never speaks. */
  line?: string
}

export default function Mirror({ id, view, title, line }: MirrorProps) {
  const [open, setOpen] = useState(false)
  const rows = view.runs.map((r) => [
    `cell ${cells(r.start)}`,
    cellWord(cells(r.size)),
    r.free ? 'free' : 'used',
    r.free ? '' : `block ${r.id}`,
  ])
  return (
    <div data-play-mirror>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex min-h-11 items-center rounded-sm border border-line bg-surface-2 px-3 font-mono text-[11px] text-text-2 transition-colors duration-150 hover:border-line-bright hover:text-text-1"
      >
        {open ? 'Hide run list' : 'Show run list'}
      </button>
      <div id={id} className={open ? 'mt-2 max-h-72 overflow-auto rounded-sm border border-line bg-surface-1 p-2' : 'sr-only'}>
        <MirrorTableView
          table={{
            caption: `${title}: ${cellWord(cells(view.totalFree))} free in ${view.runs.filter((r) => r.free).length} runs, largest ${cellWord(cells(view.largestFree))}`,
            columns: ['Start', 'Size', 'State', 'Block'],
            rows,
          }}
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
