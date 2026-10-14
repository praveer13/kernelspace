/**
 * Compose for the scheduler play (docs/specs/wave-2.md §8.4): four dials compile to a scheduler that runs on the
 * play's own minute and on five fresh ones, beside the reference. `ok` is "chose what the reference chooses at
 * every iteration, or served at least as many requests on every minute"; each new spec is one `recordPlay` with
 * phase `compose`.
 *
 * The five fresh minutes are drawn at the first run (not at mount, so a render stays pure) and kept for the
 * session, so turning one dial changes the policy and nothing else.
 */

import { useId, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { freshEntropy } from '@/data/plays'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'
import type { SchedComposeRow } from '@/lib/world/sched-policy'
import type { SchedSource, SchedTrace } from '@/lib/world/sched-traces'
import type { SchedPolicySpec } from '@/lib/world/types'
import {
  DEFAULT_SCHED_SPEC,
  SCHED_DIAL_DEFS,
  permille,
  schedComposeRecord,
  schedComposeReport,
  schedComposeTraces,
  schedTraceLabel,
  sloLine,
  withDial,
  type SchedComposeReport,
} from './session'

export interface ComposeProps {
  /** The play's own minute: the first row of the table. */
  trace: SchedTrace
  /** Where the fresh minutes are drawn from. */
  source: SchedSource
}

const CELL = 'border-b border-line/60 px-2 py-1.5'

function Rows({ label, rows }: { label: string; rows: readonly SchedComposeRow[] }) {
  return (
    <tbody className={label === 'Reference' ? 'text-text-3' : 'text-text-2'}>
      {rows.map((r, i) => (
        <tr key={i}>
          <th scope="row" className="border-b border-line/60 py-1.5 pr-2 text-left font-normal text-text-1">
            {label} · {schedTraceLabel(i)}
          </th>
          <td className={CELL}>
            {r.met}/{r.total}
          </td>
          <td className={CELL}>{permille(r.goodputPermille)}</td>
          <td className={CELL}>{r.finished ? r.ttftP95 : 'n/a'}</td>
          <td className={CELL}>{r.autoPreempts}</td>
        </tr>
      ))}
    </tbody>
  )
}

export default function Compose({ trace, source }: ComposeProps) {
  const uid = useId()
  const recordPlay = useProgress((s) => s.recordPlay)
  const [spec, setSpec] = useState<SchedPolicySpec>(DEFAULT_SCHED_SPEC)
  const [traces, setTraces] = useState<SchedTrace[] | null>(null)
  const [report, setReport] = useState<{ report: SchedComposeReport; key: string } | null>(null)
  // Specs already written to the ledger this session: running the same dials again adds no event.
  const written = useRef(new Set<string>())

  const key = JSON.stringify(spec)
  const stale = report !== null && report.key !== key

  const run = () => {
    const all = traces ?? schedComposeTraces(trace, source, freshEntropy())
    if (!traces) setTraces(all)
    const rep = schedComposeReport(spec, all)
    setReport({ report: rep, key })
    if (written.current.has(key)) return
    written.current.add(key)
    recordPlay(schedComposeRecord(spec, rep, trace, written.current.size))
  }

  return (
    <section aria-labelledby={`${uid}-h`} data-phase="compose" className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">Compose</p>
      <h3 id={`${uid}-h`} className="mt-2 font-display text-h4 text-text-1">
        Turn the dials, then run your policy
      </h3>
      <p className="mt-2 text-body-sm text-text-2">
        The dials start as a plain first-come-first-served scheduler. Your policy runs on this minute and on five new ones, beside the reference. Can you make it choose what
        the reference chooses?
      </p>

      <div className="mt-4 space-y-4">
        {SCHED_DIAL_DEFS.map((def) => (
          <fieldset key={def.key} className="min-w-0">
            <legend className="font-mono text-[12px] text-text-1">{def.label}</legend>
            <p className="mt-0.5 text-[12px] text-text-3">{def.hint}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {def.options.map((o) => (
                <label key={String(o.value)} className="relative inline-flex">
                  <input
                    type="radio"
                    name={`${uid}-${def.key}`}
                    value={String(o.value)}
                    checked={spec[def.key] === o.value}
                    onChange={() => setSpec((s) => withDial(s, def.key, o.value as never))}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-sm border border-line bg-surface-2 px-3 font-mono text-[12px] text-text-2 motion-safe:transition-colors motion-safe:duration-150',
                      'hover:border-line-bright hover:text-text-1 peer-checked:border-accent peer-checked:bg-accent-dim peer-checked:text-text-1',
                      'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                    )}
                  >
                    {o.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-5">
        <Button onClick={run}>Run my policy</Button>
      </div>

      <div role="status" aria-live="polite" className="mt-4">
        {report && (
          <div className={stale ? 'opacity-60' : undefined} data-compose-result>
            <p className="text-body-sm text-text-1">{report.report.note}</p>
            {stale && <p className="mt-1 font-mono text-[11px] text-amber">The dials changed since this run. Run again to see the new policy.</p>}
            <div role="region" aria-label="Compose results, scrolls sideways on a narrow screen" tabIndex={0} className="mt-3 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <table className="w-full min-w-[480px] border-collapse text-left font-mono text-[11px]">
                <caption className="sr-only">Your policy and the reference on each minute: requests within the SLO ({sloLine}), goodput, TTFT p95 in iterations, auto-preempts</caption>
                <thead>
                  <tr className="text-text-1">
                    <th scope="col" className="border-b border-line py-1 pr-2 font-medium">
                      Run
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-1 font-medium">
                      Within SLO
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-1 font-medium">
                      Goodput
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-1 font-medium">
                      TTFT p95
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-1 font-medium">
                      Auto-preempts
                    </th>
                  </tr>
                </thead>
                <Rows label="Your policy" rows={report.report.mine} />
                <Rows label="Reference" rows={report.report.ghost} />
              </table>
            </div>
            <p className="mt-2 font-mono text-[11px] text-text-3">
              SLO: {sloLine}. Goodput is the share of requests within it. An auto-preempt is the engine evicting a request whose decode ran out of memory.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
