/**
 * The block-placement heap as a picture (docs/specs/wave-1.md §11.2): 64 cells of 16 B in rows of 16.
 *
 * The grid is the picture, not the control. At 360 px a cell is about 20 px wide, so the free-run chips
 * under it are the tap targets and the DOM mirror (Mirror.tsx) is the accessible twin. On wider screens
 * a click on a free run that fits works too (`onPick`); the picture itself is one `role="img"`.
 */

import { blockHue, cellWord } from '@/data/plays'
import { cells } from '@/lib/world/placement'
import type { HeapView } from '@/lib/world/types'
import { cn } from '@/lib/utils'

const COLUMNS = 16

/** A span of cells to outline. `you` and `ref` tell the debrief's two placements apart without colour alone (the legend names them). */
export interface GridMark {
  start: number
  size: number
  tone: 'you' | 'ref'
}

export interface GridProps {
  view: HeapView
  /** The picture's accessible name; the mirror it points at carries the detail. */
  label: string
  describedBy?: string
  /** Cells the focused or hovered chip would fill. */
  preview?: { start: number; size: number } | null
  /** The run a free just opened: outlined, and pulsing unless motion is reduced. */
  flash?: { start: number; size: number } | null
  marks?: readonly GridMark[]
  /** Starts (in bytes) of the free runs a click may pick. Absent: the picture is not clickable. */
  pickable?: ReadonlySet<number>
  onPick?: (start: number) => void
  className?: string
}

const inSpan = (i: number, s: { start: number; size: number } | null | undefined) => s != null && i >= s.start && i < s.start + s.size

export default function Grid({ view, label, describedBy, preview, flash, marks = [], pickable, onPick, className }: GridProps) {
  const n = cells(view.capacity)
  // Which run holds each cell, and whether the cell starts it.
  const runOf: number[] = new Array(n).fill(0)
  view.runs.forEach((r, k) => {
    for (let c = cells(r.start); c < cells(r.start + r.size) && c < n; c++) runOf[c] = k
  })
  const pick = (cell: number) => {
    const run = view.runs[runOf[cell]]
    if (run && run.free && pickable?.has(run.start)) onPick?.(run.start)
  }
  return (
    <div className={className}>
      <div
        role="img"
        aria-label={label}
        aria-describedby={describedBy}
        data-grid
        className="grid gap-px"
        style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}
        onClick={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
          if (el) pick(Number(el.dataset.cell))
        }}
      >
        {Array.from({ length: n }, (_, i) => {
          const run = view.runs[runOf[i]]
          const used = run !== undefined && !run.free
          const starts = run !== undefined && cells(run.start) === i
          const clickable = run !== undefined && run.free && pickable?.has(run.start) === true
          const mark = marks.find((m) => inSpan(i, m))
          return (
            <div
              key={i}
              data-cell={i}
              data-state={used ? 'used' : 'free'}
              className={cn(
                'aspect-square rounded-[2px]',
                used ? starts && 'border-l-2 border-ink' : 'border border-dashed border-line-bright',
                clickable && 'cursor-pointer hover:border-accent',
                inSpan(i, preview) && 'bg-text-1/25 ring-2 ring-inset ring-text-1',
                inSpan(i, flash) && 'ring-2 ring-inset ring-amber motion-safe:animate-pulse',
                mark && 'ring-2 ring-inset',
                mark?.tone === 'you' && 'ring-amber',
                mark?.tone === 'ref' && 'ring-accent',
              )}
              style={used ? { backgroundColor: `hsl(${blockHue(run.id ?? 0)} 55% 50%)` } : undefined}
            />
          )
        })}
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-text-3">
        {cellWord(n)} of 16 B, {COLUMNS} per row: cell 0 is top left. Dashed is free; solid is a block.
      </p>
    </div>
  )
}
