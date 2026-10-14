/**
 * The Attention Zoo's two curves (W6, docs/specs/wave-2.md §11.4): the bytes a model stores (capacity) and the
 * bytes one decode step reads (bandwidth), against context from 1k to 1M tokens, on log axes. It is SVG, not
 * canvas, with a `SimMirror` table of the same numbers behind it. The curves are told apart by line style and
 * marker as well as colour, and each is named in a legend beside the chart.
 */

import { useId } from 'react'
import SimMirror from '@/components/sims/SimMirror'
import { zooCurves } from '@/lib/kv-zoo'
import type { ZooModel } from '@/lib/kv-zoo'
import { ZOO_CTX_STEPS, fmtBytes, fmtCtx, zooMirror } from '@/lib/sims/models/zoo'

const W = 360
const H = 236
const PAD = { l: 54, r: 12, t: 12, b: 36 }
/** One y tick per ×1024 (KiB, MiB, GiB, TiB): ten binary orders of magnitude. */
const TICK_BITS = 10

const log2 = (x: number): number => Math.log2(x)

export interface ZooChartProps {
  model: ZooModel
  /** The baseline's capacity curve, drawn for reference (null when the model is the baseline). */
  baseline: ZooModel | null
  /** The selected context, marked on both curves. */
  ctx: number
}

export default function ZooChart({ model, baseline, ctx }: ZooChartProps) {
  const mirrorId = useId()
  const { stored, read } = zooCurves(model, ZOO_CTX_STEPS)
  const ref = baseline === null ? null : zooCurves(baseline, ZOO_CTX_STEPS).stored
  const positives = [...stored, ...read, ...(ref ?? [])].filter((v) => v > 0)
  const lo = Math.floor(log2(Math.min(...positives)) / TICK_BITS) * TICK_BITS
  const hi = Math.max(Math.ceil(log2(Math.max(...positives)) / TICK_BITS) * TICK_BITS, lo + TICK_BITS)
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const n = ZOO_CTX_STEPS.length
  const px = (i: number): number => PAD.l + (i / (n - 1)) * iw
  const py = (y: number): number => PAD.t + ih - ((log2(y) - lo) / (hi - lo)) * ih
  const line = (ys: readonly number[]): string => ys.map((y, i) => `${px(i).toFixed(1)},${py(y).toFixed(1)}`).join(' ')
  const yTicks: number[] = []
  for (let b = lo; b <= hi; b += TICK_BITS) yTicks.push(2 ** b)
  const sel = ZOO_CTX_STEPS.indexOf(ctx)
  const identical = stored.every((v, i) => v === read[i])
  const label = `${model.name}: bytes stored and bytes read per decode step against context, 1k to 1M tokens, log scales. ${identical ? 'The two curves coincide.' : `At ${fmtCtx(ctx)} it stores ${fmtBytes(stored[sel])} and one step reads ${fmtBytes(read[sel])}.`}`

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} aria-describedby={mirrorId} className="h-auto w-full max-w-[640px] text-text-3">
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + ih} className="stroke-line-bright" />
        <line x1={PAD.l} y1={PAD.t + ih} x2={PAD.l + iw} y2={PAD.t + ih} className="stroke-line-bright" />
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} y1={py(t)} x2={PAD.l + iw} y2={py(t)} className="stroke-line" strokeDasharray="2 3" />
            <text x={PAD.l - 6} y={py(t) + 3} textAnchor="end" className="fill-current font-mono" fontSize="10">
              {fmtBytes(t)}
            </text>
          </g>
        ))}
        {ZOO_CTX_STEPS.map((t, i) =>
          i % 2 === 0 ? (
            <text key={t} x={px(i)} y={PAD.t + ih + 14} textAnchor="middle" className="fill-current font-mono" fontSize="10">
              {fmtCtx(t)}
            </text>
          ) : null,
        )}
        {sel >= 0 && <line x1={px(sel)} y1={PAD.t} x2={px(sel)} y2={PAD.t + ih} className="stroke-text-3" strokeWidth="1" />}
        {ref !== null && <polyline fill="none" points={line(ref)} className="stroke-text-3" strokeWidth="1.25" strokeDasharray="1 4" strokeLinecap="round" />}
        <polyline fill="none" points={line(stored)} className="stroke-t5" strokeWidth="2" />
        <polyline fill="none" points={line(read)} className="stroke-accent" strokeWidth="2" strokeDasharray="6 4" />
        {stored.map((y, i) => (
          <circle key={`s${i}`} cx={px(i)} cy={py(y)} r={i === sel ? 4.5 : 2.5} className="fill-t5" />
        ))}
        {read.map((y, i) => (
          <rect key={`r${i}`} x={px(i) - (i === sel ? 3.5 : 2)} y={py(y) - (i === sel ? 3.5 : 2)} width={i === sel ? 7 : 4} height={i === sel ? 7 : 4} className="fill-accent" />
        ))}
        <text x={PAD.l + iw / 2} y={H - 4} textAnchor="middle" className="fill-current font-mono" fontSize="10">
          context (tokens, log scale)
        </text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-2">
        <Key swatch="stored" text="stored (capacity)" />
        <Key swatch="read" text="read per step (bandwidth)" />
        {baseline !== null && <Key swatch="ref" text={`${baseline.name} stored`} />}
        {identical && <span className="text-text-3">the two curves coincide for this model</span>}
      </figcaption>
      <SimMirror id={mirrorId} table={zooMirror(model, ctx, baseline)} className="mt-2" />
    </figure>
  )
}

function Key({ swatch, text }: { swatch: 'stored' | 'read' | 'ref'; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden className="shrink-0">
        {swatch === 'stored' && (
          <>
            <line x1="1" y1="5" x2="25" y2="5" className="stroke-t5" strokeWidth="2" />
            <circle cx="13" cy="5" r="3" className="fill-t5" />
          </>
        )}
        {swatch === 'read' && (
          <>
            <line x1="1" y1="5" x2="25" y2="5" className="stroke-accent" strokeWidth="2" strokeDasharray="5 3" />
            <rect x="10" y="2" width="6" height="6" className="fill-accent" />
          </>
        )}
        {swatch === 'ref' && <line x1="1" y1="5" x2="25" y2="5" className="stroke-text-3" strokeWidth="1.25" strokeDasharray="1 4" strokeLinecap="round" />}
      </svg>
      {text}
    </span>
  )
}
