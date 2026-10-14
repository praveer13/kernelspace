import type { TickSample } from '@/lib/fleet-model'
import type { MirrorTable } from '@/lib/sims/types'

export const SERIES: { key: keyof TickSample; label: string; color: string }[] = [
  { key: 'ttftP95', label: 'gen_ai · TTFT p95', color: '#FB7185' },
  { key: 'tpotP95', label: 'gen_ai · TPOT p95', color: '#22D3EE' },
  { key: 'queueP95', label: 'queue delay p95', color: '#FBBF24' },
  { key: 'waiting', label: 'waiting requests', color: '#5CA8FF' },
  { key: 'shed', label: 'shed', color: '#FF5C6C' },
  { key: 'autoPreempts', label: 'auto-preempts', color: '#A78BFA' },
]

/** The most rows the mirror table shows; a longer run is sampled evenly, first and last tick kept. */
export const MIRROR_MAX_ROWS = 12

export const fmt = (n: number | undefined) => (n === undefined ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n * 10) / 10}`)

/** Indexes of at most `max` samples spread evenly over `length`, always including the first and the last. */
export function sampleIndexes(length: number, max: number = MIRROR_MAX_ROWS): number[] {
  if (length <= 0) return []
  if (length <= max) return Array.from({ length }, (_, i) => i)
  const out: number[] = []
  for (let i = 0; i < max; i++) {
    const at = Math.round((i * (length - 1)) / (max - 1))
    if (out[out.length - 1] !== at) out.push(at)
  }
  return out
}

/** What a sparkline says to a screen reader: its name, how many samples, the range and the final value. */
export function sparklineLabel(label: string, values: readonly number[]): string {
  if (values.length === 0) return `${label}: no samples`
  return `${label} sparkline, ${values.length} samples, min ${fmt(Math.min(...values))}, max ${fmt(Math.max(...values))}, final ${fmt(values[values.length - 1])}`
}

/** The grid's DOM mirror: one row per sampled tick, one column per plotted series. */
export function telemetryMirror(series: readonly TickSample[]): MirrorTable {
  const idx = sampleIndexes(series.length)
  return {
    caption:
      series.length === 0
        ? 'Telemetry: no samples'
        : `Telemetry, ${idx.length} of ${series.length} ticks sampled evenly (first and last kept)`,
    columns: ['tick', ...SERIES.map((s) => s.label)],
    rows: idx.map((i) => [series[i].tick, ...SERIES.map((s) => fmt(series[i][s.key]))]),
  }
}
