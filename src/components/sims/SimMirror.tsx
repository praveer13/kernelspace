/**
 * DOM mirror of a canvas (P2, docs/specs/wave-1.md §10.5): the plotted series and current points as a
 * table, plus a live region for discrete results.
 *
 *   <canvas role="img" aria-label="…" aria-describedby={MIRROR_ID} />
 *   <SimMirror id={MIRROR_ID} table={{ caption, columns, rows, announce }} />
 *
 * The table is visually hidden (still in the accessibility tree) until "Show data table" is pressed. The
 * live region speaks `table.announce` when it changes, at most once per second. A sim sets `announce`
 * only on a discrete result ("decode at batch 32 is bandwidth-bound: 64 FLOP/B, ridge 295"), never per frame.
 * `verify:plays` requires every canvas in src/components/sims to render this or carry the waiver comment.
 */

import { useEffect, useRef, useState } from 'react'
import { announceDelay } from '@/lib/sims/host'
import type { MirrorTable } from '@/lib/sims/types'

/** The table alone (phone mode shows it open beside its chart). */
export function MirrorTableView({ table }: { table: MirrorTable }) {
  return (
    <table className="w-full border-collapse text-left font-mono text-[11px] text-text-2">
      <caption className="mb-1.5 text-left text-text-2">{table.caption}</caption>
      <thead>
        <tr>
          {table.columns.map((c) => (
            <th key={c} scope="col" className="border-b border-line px-2 py-1 font-medium text-text-1">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, i) =>
              i === 0 ? (
                <th key={i} scope="row" className="border-b border-line/60 px-2 py-1 font-normal text-text-1">
                  {cell}
                </th>
              ) : (
                <td key={i} className="border-b border-line/60 px-2 py-1">
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** `text`, delayed so that no two changes are spoken less than a second apart (the newest wins). */
function useThrottledAnnouncement(text: string | undefined): string {
  const [spoken, setSpoken] = useState('')
  const lastText = useRef('')
  const lastAt = useRef<number | null>(null)
  useEffect(() => {
    if (text === undefined || text === '' || text === lastText.current) return
    const id = setTimeout(() => {
      lastText.current = text
      lastAt.current = Date.now()
      setSpoken(text)
    }, announceDelay(lastAt.current, Date.now()))
    return () => clearTimeout(id)
  }, [text])
  return spoken
}

export interface SimMirrorProps {
  /** The id the canvas's `aria-describedby` points at (on the table's container). */
  id: string
  table: MirrorTable
  className?: string
}

export default function SimMirror({ id, table, className }: SimMirrorProps) {
  const [open, setOpen] = useState(false)
  const spoken = useThrottledAnnouncement(table.announce)
  return (
    <div className={className} data-sim-mirror>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="rounded-sm border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-text-2 transition-colors duration-150 hover:border-line-bright hover:text-text-1"
      >
        {open ? 'Hide data table' : 'Show data table'}
      </button>
      <div id={id} className={open ? 'mt-2 max-h-72 overflow-auto rounded-sm border border-line bg-surface-1 p-2' : 'sr-only'}>
        <MirrorTableView table={table} />
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {spoken}
      </div>
    </div>
  )
}
