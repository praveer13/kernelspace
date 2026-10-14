/**
 * The cube's three linked face views (docs/specs/wave-3.md §6.3, games-3d.md:190–196): A's Tm × k slab, B's k × Tn slab
 * and C's Tm × Tn tile, unfolded around the tile as SVG grids with the current tile lit. FLOPs are the volume of the
 * tile and the bytes it reads are the areas of the two slab faces, so intensity is volume ÷ lit surface. Level 4 adds the
 * wave map: the output grid with one wave's tiles lit and the distinct A rows and B columns it reads marked on the edges.
 * FlashAttention's level draws the same three faces for Q, Kᵀ and the score matrix S, with lengths on a log scale.
 *
 * The pictures are `role="img"` with a name and `aria-describedby` the DOM table (Mirror.tsx), which carries every
 * number they draw. Nothing here animates, and no colour tells two faces apart alone: each carries its letter and the
 * legend names it.
 */

import { cn } from '@/lib/utils'
import type { CubeLevel } from '@/lib/world/tiling'
import { EDGE, MAX_LINES, fixed, layoutFaces, layoutWave, wavesOf, type Explore, type Rect } from './session'

/** Gridlines every `unit` elements along an edge of `count` elements drawn `length` long, with at most MAX_LINES of them. */
function lines(count: number, length: number): number[] {
  let unit = 1
  while (count / unit > MAX_LINES) unit *= 2
  const out: number[] = []
  for (let at = unit; at < count; at += unit) out.push((at / count) * length)
  return out
}

function Face({ rect, rows, cols, tone, letter }: { rect: Rect; rows: number; cols: number; tone: 'a' | 'b' | 'c'; letter: string }) {
  const fill = tone === 'a' ? 'fill-info/25' : tone === 'b' ? 'fill-amber/25' : 'fill-accent/30'
  const stroke = tone === 'a' ? 'stroke-info' : tone === 'b' ? 'stroke-amber' : 'stroke-accent'
  return (
    <g data-face={letter}>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} className={cn(fill, stroke)} strokeWidth={1.5} />
      {lines(cols, rect.w).map((x, i) => (
        <line key={`c${i}`} x1={rect.x + x} y1={rect.y} x2={rect.x + x} y2={rect.y + rect.h} className="stroke-line-bright" strokeWidth={0.5} />
      ))}
      {lines(rows, rect.h).map((y, i) => (
        <line key={`r${i}`} x1={rect.x} y1={rect.y + y} x2={rect.x + rect.w} y2={rect.y + y} className="stroke-line-bright" strokeWidth={0.5} />
      ))}
      {rect.w >= 16 && rect.h >= 16 && (
        <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2} textAnchor="middle" dominantBaseline="central" className="fill-text-1 font-mono" fontSize={13}>
          {letter}
        </text>
      )}
    </g>
  )
}

export interface Mirror2DProps {
  level: CubeLevel
  explore: Explore
  /** The id of the DOM table that carries every number these pictures draw. */
  describedBy: string
}

/** The legend line of a face: its letter, what it holds and its size. */
function faceName(level: CubeLevel, letter: 'A' | 'B' | 'C'): string {
  if (level.id === 'flash') return letter === 'A' ? 'Q block' : letter === 'B' ? 'Kᵀ' : 'S block'
  return letter === 'A' ? 'A slab' : letter === 'B' ? 'B slab' : 'C tile'
}

export default function Mirror2D({ level, explore, describedBy }: Mirror2DProps) {
  const flash = level.id === 'flash'
  const f = layoutFaces(explore, flash)
  const size = (letter: 'A' | 'B' | 'C', [r, c]: [number, number]) => `${faceName(level, letter)} ${fixed(r)} × ${fixed(c)}`
  const legend = [size('A', f.dims.a), size('B', f.dims.b), size('C', f.dims.c)]
  const faces = `Three linked faces: ${legend.join(', ')}.`
  const w = level.id === 'raster' ? wavesOf(explore).chosen : null
  const map = w ? layoutWave(w) : null
  return (
    <div data-views className="space-y-4">
      <figure>
        <svg
          viewBox={`0 0 ${f.width} ${f.height}`}
          role="img"
          aria-label={faces}
          aria-describedby={describedBy}
          className="mx-auto h-auto w-full max-w-[320px]"
          style={{ aspectRatio: `${f.width} / ${f.height}` }}
        >
          <Face rect={f.a} rows={f.dims.a[0]} cols={f.dims.a[1]} tone="a" letter="A" />
          <Face rect={f.b} rows={f.dims.b[0]} cols={f.dims.b[1]} tone="b" letter="B" />
          <Face rect={f.c} rows={f.dims.c[0]} cols={f.dims.c[1]} tone="c" letter="C" />
        </svg>
        <figcaption className="mt-1.5 font-mono text-[11px] text-text-3">
          {legend.join(' · ')}
          {flash ? '. Lengths are on a log scale; S is never written to memory.' : '. C stays in registers; only A and B are read.'}
        </figcaption>
      </figure>
      {map && w && (
        <figure>
          <svg
            viewBox={`0 0 ${map.width} ${map.height}`}
            role="img"
            aria-label={`One wave of ${w.tiles} tiles lit on the output grid: ${w.rows} tile rows and ${w.cols} tile columns touched`}
            aria-describedby={describedBy}
            className="mx-auto h-auto w-full max-w-[320px]"
            style={{ aspectRatio: `${map.width} / ${map.height}` }}
          >
            {map.litCols.map((c) => (
              <rect key={`c${c}`} x={EDGE + c * map.cellW} y={0} width={map.cellW} height={EDGE - 2} className="fill-info" />
            ))}
            {map.litRows.map((r) => (
              <rect key={`r${r}`} x={0} y={EDGE + r * map.cellH} width={EDGE - 2} height={map.cellH} className="fill-amber" />
            ))}
            <rect x={EDGE} y={EDGE} width={map.cols * map.cellW} height={map.rows * map.cellH} className="fill-transparent stroke-line-bright" strokeWidth={0.75} />
            {map.lit.map(([r, c]) => (
              <rect key={`${r}:${c}`} x={EDGE + c * map.cellW} y={EDGE + r * map.cellH} width={map.cellW} height={map.cellH} className="fill-accent/40 stroke-accent" strokeWidth={0.5} />
            ))}
          </svg>
          <figcaption className="mt-1.5 font-mono text-[11px] text-text-3" data-wave-caption>
            The wave: {w.tiles} tiles, {explore.raster === 'row' ? 'row-major' : `grouped by ${explore.group}`}. It reads {w.rows} A row panels (left edge) and {w.cols} B column panels (top edge).
            Cells are stretched to fit, not to scale.
          </figcaption>
        </figure>
      )}
    </div>
  )
}
