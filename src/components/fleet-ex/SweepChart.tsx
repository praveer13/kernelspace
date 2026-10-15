/**
 * The sweep as an SVG line chart (docs/specs/wave-3.md §5.3, task 3b-20): goodput at each point of the sweep, the
 * answer marked with a filled dot and the learner's pick with a ring, and a `SimMirror` table that names the same
 * numbers (and TTFT p95, which the chart leaves to the table). The points are evenly spaced as categories, because
 * the sweeps' x values are steps of a dial, not a continuous axis. The chart is `aria-describedby` its table.
 */

import { useId } from 'react'
import SimMirror, { MirrorTableView } from '@/components/sims/SimMirror'
import { formatNumber } from '@/lib/sims/host'
import type { MirrorTable } from '@/lib/sims/types'
import type { SweepPoint, SweepResult } from '@/lib/world/fleet-ex'

const W = 320
const H = 200
const PAD = { l: 46, r: 14, t: 18, b: 38 }

export interface SweepChartProps {
  result: SweepResult
  /** The x axis title and how a point's tick reads (`copyFor(id)`). */
  xLabel: string
  tickLabel: (x: number) => string
  /** The point with the highest goodput, and the learner's pick if there is one. */
  answer: number
  pick?: number
  /** The table that mirrors the chart. */
  table: MirrorTable
  /** Phone mode shows the table open beside the chart. */
  tableOpen?: boolean
  /** What the y axis plots (the stretch exercises, §16.3); absent: goodput. `null`: no chart, the table alone, open. */
  y?: { label: string; axis: string; mark: string; of: (p: SweepPoint) => number } | null
}

const GOODPUT = { label: 'Goodput in requests per second', axis: 'goodput (req/s)', mark: 'peak', of: (p: SweepPoint) => p.goodputRps }

export default function SweepChart({ result, xLabel, tickLabel, answer, pick, table, tableOpen = false, y: yIn }: SweepChartProps) {
  const uid = useId()
  const mirrorId = `${uid}-mirror`
  const pts = result.points
  if (pts.length === 0) return null
  if (yIn === null) {
    return (
      <div data-sweep-chart>
        <div id={mirrorId} tabIndex={0} role="region" aria-label={table.caption} className="rounded-sm border border-line bg-surface-1 p-2">
          <MirrorTableView table={table} />
        </div>
      </div>
    )
  }
  const y = yIn ?? GOODPUT
  const ys = pts.map((p) => y.of(p))
  const yMax = Math.max(...ys) * 1.12 || 1
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const px = (i: number) => PAD.l + ((i + 0.5) / pts.length) * iw
  const py = (v: number) => PAD.t + ih - (v / yMax) * ih
  const answerAt = pts.findIndex((p) => p.x === answer)
  const pickAt = pick === undefined ? -1 : pts.findIndex((p) => p.x === pick)
  const yTicks = [0, yMax / 1.12 / 2, yMax / 1.12]
  const best = answerAt >= 0 ? pts[answerAt] : undefined
  const label =
    `${y.label} at each ${xLabel.toLowerCase()} point` +
    (best === undefined ? '.' : `. It peaks at ${tickLabel(best.x)} with ${formatNumber(y.of(best))}.`) +
    (pickAt >= 0 ? ` Your pick was ${tickLabel(pts[pickAt].x)}.` : '')

  return (
    <div data-sweep-chart>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} aria-describedby={mirrorId} className="h-auto w-full max-w-lg text-text-3">
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + ih} className="stroke-line" />
        <line x1={PAD.l} y1={PAD.t + ih} x2={PAD.l + iw} y2={PAD.t + ih} className="stroke-line" />
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l - 3} y1={py(t)} x2={PAD.l} y2={py(t)} className="stroke-line" />
            <text x={PAD.l - 6} y={py(t) + 3} textAnchor="end" className="fill-current font-mono" fontSize="9">
              {formatNumber(yIn === undefined ? t : Number(t.toPrecision(3)))}
            </text>
          </g>
        ))}
        <polyline fill="none" strokeWidth="1.5" className="stroke-text-3" points={pts.map((p, i) => `${px(i).toFixed(1)},${py(y.of(p)).toFixed(1)}`).join(' ')} />
        {pts.map((p, i) => (
          <g key={p.x}>
            <circle cx={px(i)} cy={py(y.of(p))} r={i === answerAt ? 5 : 2.5} className={i === answerAt ? 'fill-accent' : 'fill-text-3'} />
            <text x={px(i)} y={H - PAD.b + 13} textAnchor="middle" className="fill-current font-mono" fontSize="9">
              {tickLabel(p.x)}
            </text>
          </g>
        ))}
        {pickAt >= 0 && (
          <circle cx={px(pickAt)} cy={py(y.of(pts[pickAt]))} r={9} fill="none" strokeWidth="1.5" strokeDasharray="3 2" className="stroke-text-1" />
        )}
        {answerAt >= 0 && (
          <text x={px(answerAt)} y={py(y.of(pts[answerAt])) - 11} textAnchor="middle" className="fill-accent font-mono" fontSize="9">
            {y.mark}
          </text>
        )}
        {pickAt >= 0 && pickAt !== answerAt && (
          <text x={px(pickAt)} y={py(y.of(pts[pickAt])) - 13} textAnchor="middle" className="fill-current font-mono text-text-1" fontSize="9">
            you
          </text>
        )}
        <text x={PAD.l + iw / 2} y={H - 4} textAnchor="middle" className="fill-current font-mono" fontSize="9">
          {xLabel}
        </text>
        <text x={10} y={PAD.t + ih / 2} textAnchor="middle" transform={`rotate(-90 10 ${PAD.t + ih / 2})`} className="fill-current font-mono" fontSize="9">
          {y.axis}
        </text>
      </svg>
      {tableOpen ? (
        // the table scrolls inside its own region, which takes the keyboard (axe: scrollable-region-focusable)
        <div id={mirrorId} tabIndex={0} role="region" aria-label={table.caption} className="mt-2 overflow-x-auto rounded-sm border border-line bg-surface-1 p-2">
          <MirrorTableView table={table} />
        </div>
      ) : (
        <SimMirror id={mirrorId} table={table} className="mt-2" />
      )}
    </div>
  )
}
