import { Activity } from 'lucide-react'
import {
  FLEET_WORKER_HOURLY_USD,
  SERVING_METRIC_NAMES,
  type ServingMetricsSnapshot,
} from '@/lib/fleet-model'

interface MetricsDashboardProps {
  metrics: ServingMetricsSnapshot
  scope: string
}

const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`)

const usd = (value: number | null) => {
  if (value === null) return '—'
  if (value < 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

export default function MetricsDashboard({ metrics, scope }: MetricsDashboardProps) {
  const cards = [
    {
      label: 'TTFT p95',
      value: ms(metrics.ttftP95Ms),
      name: SERVING_METRIC_NAMES.ttft,
      standard: true,
    },
    {
      label: 'TPOT p95',
      value: ms(metrics.tpotP95Ms),
      name: SERVING_METRIC_NAMES.tpot,
      standard: true,
    },
    {
      label: 'queue delay p95',
      value: ms(metrics.queueP95Ms),
      name: SERVING_METRIC_NAMES.queue,
      standard: false,
    },
    {
      label: 'KV hit rate',
      value: `${metrics.kvHitRate.toFixed(1)}%`,
      name: SERVING_METRIC_NAMES.kvHit,
      standard: false,
    },
    {
      label: 'goodput',
      value: `${metrics.goodput.toFixed(1)}%`,
      name: SERVING_METRIC_NAMES.goodput,
      standard: false,
    },
    {
      label: '$ / Mtok',
      value: usd(metrics.costPerMtok),
      name: SERVING_METRIC_NAMES.cost,
      standard: false,
    },
  ]

  return (
    <section
      data-testid="fleet-metrics-dashboard"
      aria-label="Fleet observability metrics dashboard"
      className="rounded-lg border border-accent/40 bg-surface-1 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent">
            <Activity className="h-3.5 w-3.5" /> instrument your engine
          </p>
          <p className="mt-1 font-mono text-[10px] text-text-3">
            {scope} · 50 ms/tick · {metrics.deliveredTokens.toLocaleString()} delivered tokens
          </p>
        </div>
        <p className="max-w-md text-right font-mono text-[9px] leading-relaxed text-text-3">
          Capture this panel for Fleet Week. Cost uses ${FLEET_WORKER_HOURLY_USD.toFixed(2)} per
          worker-hour; input + output tokens are the denominator.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <div
            key={card.name}
            data-metric={card.name}
            className="min-w-0 rounded border border-line bg-ink p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-3">
                {card.label}
              </p>
              <span className="rounded border border-line px-1 py-0.5 font-mono text-[8px] uppercase text-text-3">
                {card.standard ? 'OTel' : 'ext'}
              </span>
            </div>
            <p className="mt-1 font-mono text-lg text-text-1">{card.value}</p>
            <p className="mt-2 break-all font-mono text-[8px] leading-relaxed text-text-3">
              {card.name}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-text-3">
        TTFT and TPOT use the OpenTelemetry GenAI model-server histogram names. Queue, cache,
        goodput, and cost are clearly namespaced Kernelspace extensions rather than invented
        standards. The cards show p95 after aggregation, not averages.
      </p>
    </section>
  )
}
