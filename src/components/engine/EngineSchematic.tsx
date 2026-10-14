/* eslint-disable react-refresh/only-export-components -- the box model sits beside the component so one test reads both */
/**
 * The 2D schematic of your engine (docs/specs/wave-2.md §10.4): the eight slots in pipeline order, a grey box for
 * the reference module and a mint box for yours, each with its lab, short sha and install date, and a DOM list
 * that says the same in words. The SVG is a picture of that list (`aria-describedby`), so the list carries the
 * keyboard path: every row links to its lab. A click on a box goes there too, for pointer users; no link sits
 * inside the SVG, because axe's nested-interactive rule fails any control inside a role="img". 3D is out (PLAN §5.4.0: 2D for anything with at most two axes).
 *
 * Colour is never the only signal: a box says "yours" or "reference" as text.
 */

import { useId } from 'react'
import { Link, useNavigate } from 'react-router'
import { ENGINE_SLOT_ORDER, ENGINE_SLOTS } from '@/lib/engine/catalog'
import { localDateKey } from '@/lib/economy'
import type { EngineSlot, EngineSlots } from '@/lib/ledger/types'

/** viewBox units; the SVG scales to its container. */
export const BOX_W = 168
export const BOX_H = 58
const ROW = 80
const TOP = 28
const LEFT_X = 8
const RIGHT_X = 184
export const SCHEMATIC_W = 360
export const SCHEMATIC_H = TOP + 4 * ROW + BOX_H + 10

/** The request path, in order; the other three sit beside it. */
export const PIPELINE: readonly EngineSlot[] = ENGINE_SLOT_ORDER.slice(0, 5)
export const BESIDE: readonly EngineSlot[] = ENGINE_SLOT_ORDER.slice(5)

export interface SchematicBox {
  slot: EngineSlot
  label: string
  lab: string
  labNo: number
  /** The lab's page in the Forge. */
  href: string
  /** True when the slot holds your own installed module. */
  mine: boolean
  /** The first 7 hex digits of the module's sha256, or null for the reference. */
  shortSha: string | null
  /** The install day on the learner's local calendar (`YYYY-MM-DD`), or null for the reference. */
  installedOn: string | null
  x: number
  y: number
}

export const shortShaOf = (sha256: string): string => sha256.slice(0, 7)

/** The day an install instant falls on for the learner. An unreadable instant shows its own first ten characters. */
export function installDay(at: string): string {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at.slice(0, 10) : localDateKey(d)
}

/** The eight boxes, in `ENGINE_SLOT_ORDER`, from the slot map `engine:slots` holds (or the store's installed view). */
export function schematicBoxes(slots: EngineSlots): SchematicBox[] {
  return ENGINE_SLOT_ORDER.map((slot) => {
    const spec = ENGINE_SLOTS[slot]
    const own = slots[slot]
    const pipe = PIPELINE.indexOf(slot)
    // beside-the-pipeline boxes start one row down so the caption above them has room
    const row = pipe >= 0 ? pipe : BESIDE.indexOf(slot) + 1
    return {
      slot,
      label: spec.label,
      lab: spec.lab,
      labNo: spec.labNo,
      href: `/forge/${spec.lab}`,
      mine: own !== undefined,
      shortSha: own ? shortShaOf(own.sha256) : null,
      installedOn: own ? installDay(own.at) : null,
      x: pipe >= 0 ? LEFT_X : RIGHT_X,
      y: TOP + row * ROW,
    }
  })
}

export const ownCount = (boxes: readonly SchematicBox[]): number => boxes.filter((b) => b.mine).length

const labNo = (n: number): string => String(n).padStart(2, '0')

export interface EngineSchematicProps {
  /** `engine:slots`, or the store's `installed` map (it extends the entries with bytes). */
  installed: EngineSlots
  className?: string
}

export default function EngineSchematic({ installed, className }: EngineSchematicProps) {
  const listId = useId()
  const navigate = useNavigate()
  const boxes = schematicBoxes(installed)
  const own = ownCount(boxes)
  const summary = `Your engine: ${own} of ${boxes.length} slots hold your own modules, the rest are reference modules.`
  const byslot = new Map(boxes.map((b) => [b.slot, b]))
  const pipeline = PIPELINE.map((s) => byslot.get(s)!)

  return (
    <figure className={className}>
      <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr] md:items-start">
        <svg
          viewBox={`0 0 ${SCHEMATIC_W} ${SCHEMATIC_H}`}
          role="img"
          aria-label={summary}
          aria-describedby={listId}
          data-testid="engine-schematic"
          className="h-auto w-full max-w-[360px] select-none"
        >
          <defs>
            <marker id={`${listId}-arrow`} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" className="fill-text-3" />
            </marker>
          </defs>
          <text x={LEFT_X} y="16" className="fill-text-3 font-mono text-[10px] uppercase" letterSpacing="1.2">
            request path
          </text>
          <text x={RIGHT_X} y="16" className="fill-text-3 font-mono text-[10px] uppercase" letterSpacing="1.2">
            beside it
          </text>
          {pipeline.slice(0, -1).map((b) => (
            <line
              key={b.slot}
              x1={b.x + BOX_W / 2}
              y1={b.y + BOX_H}
              x2={b.x + BOX_W / 2}
              y2={b.y + ROW - 1}
              className="stroke-text-3"
              strokeWidth="1.5"
              markerEnd={`url(#${listId}-arrow)`}
            />
          ))}
          {boxes.map((b) => (
            // a click goes to the lab for pointer users; the SVG is a picture (role img), so the list below is the keyboard path
            <g key={b.slot} data-slot={b.slot} data-mine={b.mine ? 'yes' : 'no'} className="cursor-pointer" onClick={() => navigate(b.href)}>
              <rect
                x={b.x}
                y={b.y}
                width={BOX_W}
                height={BOX_H}
                rx="6"
                strokeWidth="1.5"
                className={b.mine ? 'fill-accent-dim stroke-accent' : 'fill-surface-2 stroke-line-bright'}
              />
              <text x={b.x + 10} y={b.y + 20} className="fill-text-1 font-sans text-[12px] font-semibold">
                {b.label}
              </text>
              <text x={b.x + BOX_W - 10} y={b.y + 20} textAnchor="end" className={b.mine ? 'fill-accent font-mono text-[10px] font-semibold' : 'fill-text-2 font-mono text-[10px]'}>
                {b.mine ? 'yours' : 'reference'}
              </text>
              <text x={b.x + 10} y={b.y + 37} className="fill-text-2 font-mono text-[10px]">
                {`lab ${labNo(b.labNo)} ${b.lab}`}
              </text>
              <text x={b.x + 10} y={b.y + 51} className={b.mine ? 'fill-accent font-mono text-[10px]' : 'fill-text-2 font-mono text-[10px]'}>
                {b.mine ? `${b.shortSha} · ${b.installedOn}` : 'built-in default'}
              </text>
            </g>
          ))}
        </svg>

        <figcaption>
          <p className="text-body-sm text-text-2">{summary}</p>
          <ol id={listId} aria-label="Your engine, slot by slot" className="mt-3 space-y-1.5">
            {boxes.map((b) => (
              <li
                key={b.slot}
                data-slot={b.slot}
                className={
                  b.mine
                    ? 'rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-body-sm text-text-2'
                    : 'rounded-md border border-line bg-surface-1 px-3 py-2 text-body-sm text-text-2'
                }
              >
                <Link to={b.href} className="text-text-1 underline decoration-line-bright underline-offset-2 hover:decoration-accent">
                  {b.label}
                </Link>
                <span className="font-mono text-[11px]">
                  {' '}
                  · lab {labNo(b.labNo)} {b.lab} ·{' '}
                </span>
                {b.mine ? (
                  <span className="font-mono text-[11px] text-accent">
                    yours · sha {b.shortSha} · installed {b.installedOn}
                  </span>
                ) : (
                  <span className="font-mono text-[11px]">reference</span>
                )}
              </li>
            ))}
          </ol>
        </figcaption>
      </div>
    </figure>
  )
}
