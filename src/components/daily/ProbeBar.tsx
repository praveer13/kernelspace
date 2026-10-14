import { useEffect, useId, useRef, type Ref } from 'react'
import { MirrorTableView } from '@/components/sims/SimMirror'
import { Sparkline } from '@/components/telemetry/Sparkline'
import { sparklineLabel } from '@/components/telemetry/series'
import type { IncidentClientSession } from '@/lib/fleet-session'
import { CATEGORY_LABELS, PROBES, PROBE_IDS, type ProbeId } from '@/lib/world/incident-spec'
import { readingView, sinceAlert, type FlowEntry, type FlowRun } from '@/lib/world/daily'
import type { IncidentProbeReply } from '@/workers/fleet-protocol'

export interface ProbeBarProps {
  session: Pick<IncidentClientSession, 'probe'>
  /** the clock minute the alert fired: readings are labelled against it */
  alert: number
  /** probes open once a hypothesis is logged, and close when the incident has ended */
  enabled: boolean
  /** why the bar is closed, when it is */
  closedReason?: string
  /** the flow's log so far, oldest first: the readings below the bar are its probe entries */
  log: readonly FlowEntry[]
  busy: boolean
  run: FlowRun
  onReading: (probe: ProbeId, reply: IncidentProbeReply) => void
}

const COLORS = ['#FB7185', '#22D3EE', '#FBBF24', '#5CA8FF', '#FF5C6C', '#A78BFA', '#34D399', '#F97316']

type ProbeEntry = Extract<FlowEntry, { kind: 'probe' }>

/** One reading: its category, a sparkline per series, and the table every sparkline is described by (mirror 7, spec §12). */
function Reading({ entry, alert, headingRef }: { entry: ProbeEntry; alert: number; headingRef?: Ref<HTMLHeadingElement> }) {
  const view = readingView(entry.readings, alert)
  const tableId = `${useId()}-reading`
  return (
    <article className="rounded-md border border-line bg-ink p-3" data-reading={entry.probe}>
      <h3 ref={headingRef} tabIndex={-1} className="font-display text-[16px] text-text-1 outline-none" data-reading-heading>
        {view.title} at {sinceAlert(entry.minute, alert)}: {CATEGORY_LABELS[entry.category]}
      </h3>
      {view.facts.map((f) => (
        <p key={f} className="mt-1 text-body-sm text-text-2">
          {f}
        </p>
      ))}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {view.series.map((s, i) => (
          <div key={s.label} className="rounded-md border border-line bg-surface-1 p-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">{s.label}</p>
            <Sparkline values={s.values} color={COLORS[i % COLORS.length]} label={sparklineLabel(s.label, s.values)} describedBy={tableId} />
            <p className="mt-1 font-mono text-[10px] text-text-3">now: {s.down?.[s.down.length - 1] ? 'down' : (s.values[s.values.length - 1] ?? '—')}</p>
          </div>
        ))}
      </div>
      <div
        id={tableId}
        role="region"
        aria-label={`${view.title} readings table`}
        tabIndex={0}
        className="mt-3 max-h-72 overflow-auto rounded-sm border border-line bg-surface-1 p-2"
      >
        {view.tables.map((t) => (
          <div key={t.caption} className="mb-3 last:mb-0">
            <MirrorTableView table={t} />
          </div>
        ))}
      </div>
    </article>
  )
}

/**
 * Step 3 of the flow (docs/specs/wave-2.md §9.7): a bar of the six probes, each showing the incident minutes it
 * costs, and the readings below. A reading opens as sparklines plus the table that describes them, newest first;
 * older ones fold into disclosures. After a probe, focus moves to the new reading.
 */
export default function ProbeBar({ session, alert, enabled, closedReason, log, busy, run, onReading }: ProbeBarProps) {
  const entries = log.filter((e): e is ProbeEntry => e.kind === 'probe')
  const newest = useRef<HTMLHeadingElement>(null)
  const seen = useRef(entries.length)
  useEffect(() => {
    // a new reading takes focus, so a keyboard learner lands on what the probe found
    if (entries.length > seen.current) newest.current?.focus()
    seen.current = entries.length
  }, [entries.length])
  async function take(probe: ProbeId) {
    const reply = await run(() => session.probe(probe))
    if (reply) onReading(probe, reply)
  }
  const taken = new Set(entries.map((e) => e.probe))
  const latest = entries[entries.length - 1]
  const earlier = entries.slice(0, -1).reverse()
  return (
    <section className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5" data-flow="probes">
      <h2 className="font-display text-h3 text-text-1">Probes</h2>
      <p className="mt-1 text-body-sm text-text-2">
        Each probe reads one resource, in USE terms (utilization, saturation, errors), and costs incident minutes while the fault keeps burning budget.
      </p>
      {!enabled && closedReason && (
        <p className="mt-2 text-body-sm text-amber" data-probes-closed>
          {closedReason}
        </p>
      )}
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {PROBE_IDS.map((id) => {
          const def = PROBES[id]
          return (
            <li key={id}>
              <button
                type="button"
                data-probe={id}
                disabled={!enabled || busy}
                onClick={() => void take(id)}
                className="flex h-full min-h-11 w-full flex-col items-start rounded-md border border-line bg-surface-2 px-3 py-2 text-left hover:border-line-bright disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-body-sm font-medium text-text-1">
                  {def.label}
                  {taken.has(id) && <span className="sr-only"> (already read)</span>}
                </span>
                <span className="font-mono text-[11px] text-text-2">
                  {def.cost} min{taken.has(id) ? ' · read' : ''}
                </span>
                <span className="mt-1 text-[11px] leading-snug text-text-3">{def.shows}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {latest && (
        <div className="mt-4 space-y-3" data-readings>
          <Reading entry={latest} alert={alert} headingRef={newest} />
          {earlier.map((e, i) => (
            <details key={`${e.probe}-${e.minute}-${i}`} className="rounded-md border border-line bg-surface-2 p-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-body-sm text-text-1">
                {PROBES[e.probe].label} at {sinceAlert(e.minute, alert)}: {CATEGORY_LABELS[e.category]}
              </summary>
              <div className="mt-2">
                <Reading entry={e} alert={alert} />
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  )
}
