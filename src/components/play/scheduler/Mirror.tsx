/**
 * DOM mirror of the scheduler play's KV bar and queues (docs/specs/wave-2.md §8.3): the waiting and running
 * requests as a table, plus an aria-live line per iteration ("Iteration 37: admitted #12 (1,024 tokens). Free
 * 1,104 → 64. 3 waiting.").
 *
 * The table is visually hidden, and still in the accessibility tree, until "Show request list" is pressed. The
 * live region is turn-based, so it is not throttled: a turn is one announcement. The debrief mirrors its two
 * frames with the same component and no live line.
 */

import { useState } from 'react'
import { MirrorTableView } from '@/components/sims/SimMirror'
import type { SchedFrame } from '@/lib/world/types'
import { groups, iterations, progressWords } from './session'

export interface MirrorProps {
  /** The id the KV bar's `aria-describedby` points at. */
  id: string
  frame: SchedFrame
  /** Names the table: "Your queues", "The reference's queues at iteration 37". */
  title: string
  /** The last turn, spoken when it changes. Omit it for a mirror that never speaks. */
  line?: string
}

export default function Mirror({ id, frame, title, line }: MirrorProps) {
  const [open, setOpen] = useState(false)
  const v = frame.view
  const rows = [
    ...v.waiting.map((r) => [`#${r.id}`, `${groups(r.prompt)} tokens`, 'waiting', `waited ${iterations(v.iter - r.arrival)}`]),
    ...frame.running.map((r) => [`#${r.id}`, `${groups(r.prompt)} tokens`, 'running', progressWords(r)]),
  ]
  return (
    <div data-play-mirror>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex min-h-11 items-center rounded-sm border border-line bg-surface-2 px-3 font-mono text-[11px] text-text-2 hover:border-line-bright hover:text-text-1 motion-safe:transition-colors motion-safe:duration-150"
      >
        {open ? 'Hide request list' : 'Show request list'}
      </button>
      <div id={id} className={open ? 'mt-2 max-h-72 overflow-auto rounded-sm border border-line bg-surface-1 p-2' : 'sr-only'}>
        <MirrorTableView
          table={{
            caption: `${title}, iteration ${v.iter}: ${v.waiting.length} waiting, ${v.running.length} of ${v.maxRunning} running, ${groups(frame.free)} of ${groups(v.memCap)} tokens free`,
            columns: ['Request', 'Prompt', 'State', 'Progress'],
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
