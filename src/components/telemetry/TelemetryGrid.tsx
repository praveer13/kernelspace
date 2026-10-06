import { useId, useMemo } from 'react'
import SimMirror from '@/components/sims/SimMirror'
import type { TickSample } from '@/lib/fleet-model'
import { Sparkline } from './Sparkline'
import { fmt, SERIES, sparklineLabel, telemetryMirror } from './series'

/** The six sparklines of an incident's telemetry, and the table every one of them is described by (mirror 7, spec §12). */
export function TelemetryGrid({ series }: { series: TickSample[] }) {
  const mirrorId = `${useId()}-telemetry-mirror`
  const table = useMemo(() => telemetryMirror(series), [series])
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {SERIES.map((s) => {
          const values = series.map((t) => t[s.key] as number)
          return (
            <div key={s.key} className="rounded-md border border-line bg-ink p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">{s.label}</p>
              <Sparkline values={values} color={s.color} label={sparklineLabel(s.label, values)} describedBy={mirrorId} />
              <p className="mt-1 font-mono text-[10px] text-text-3">final: {fmt(series[series.length - 1]?.[s.key] as number)}</p>
            </div>
          )
        })}
      </div>
      <SimMirror id={mirrorId} table={table} className="mt-3" />
    </div>
  )
}
