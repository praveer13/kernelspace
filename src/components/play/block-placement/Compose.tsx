/**
 * Compose (docs/specs/wave-1.md §11.3): four dials turn into a placement policy that runs on the play's
 * own trace and on five fresh seeds, beside the reference. `ok` is "reproduced the reference or ran the
 * fixed-block spec"; each new spec is one `recordPlay` with phase `compose`.
 *
 * The five fresh traces are drawn at the first run (not at mount, so a render stays pure) and kept for
 * the session, so turning one dial changes the policy and nothing else.
 */

import { useId, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import {
  DEFAULT_DIALS,
  DIAL_DEFS,
  composeRecord,
  composeReport,
  composeTraces,
  freshEntropy,
  pct,
  specOf,
  traceLabel,
  type ComposeReport,
  type Dials,
} from '@/data/plays'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'
import type { ComposeRow } from '@/lib/world/policy'
import type { HeapTrace } from '@/lib/world/types'

export interface ComposeProps {
  /** The play's own trace: the first row of the table. */
  trace: HeapTrace
}

function Rows({ label, rows }: { label: string; rows: readonly ComposeRow[] }) {
  return (
    <tbody className={label === 'Reference' ? 'text-text-3' : 'text-text-2'}>
      {rows.map((r, i) => (
        <tr key={i}>
          <th scope="row" className="border-b border-line/60 py-1.5 pr-2 text-left font-normal text-text-1">
            {label} · {traceLabel(i)}
          </th>
          <td className="border-b border-line/60 px-2 py-1.5">
            {r.survived}/{r.ops}
          </td>
          <td className="border-b border-line/60 px-2 py-1.5">{pct(r.externalPermille)}</td>
          <td className="border-b border-line/60 px-2 py-1.5">{pct(r.internalWastePermille)}</td>
        </tr>
      ))}
    </tbody>
  )
}

export default function Compose({ trace }: ComposeProps) {
  const uid = useId()
  const recordPlay = useProgress((s) => s.recordPlay)
  const [dials, setDials] = useState<Dials>(DEFAULT_DIALS)
  const [traces, setTraces] = useState<HeapTrace[] | null>(null)
  const [report, setReport] = useState<{ report: ComposeReport; key: string } | null>(null)
  // Specs already written to the ledger this session: running the same dials again adds no event.
  const written = useRef(new Set<string>())

  const spec = specOf(dials)
  const key = JSON.stringify(spec)
  const stale = report !== null && report.key !== key

  const run = () => {
    const all = traces ?? composeTraces(trace, freshEntropy())
    if (!traces) setTraces(all)
    const rep = composeReport(spec, all)
    setReport({ report: rep, key })
    if (written.current.has(key)) return
    written.current.add(key)
    recordPlay(composeRecord(spec, rep, trace, written.current.size))
  }

  return (
    <section aria-labelledby={`${uid}-h`} data-phase="compose" className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">Compose</p>
      <h3 id={`${uid}-h`} className="mt-2 font-display text-h4 text-text-1">
        Turn the dials, then run your policy
      </h3>
      <p className="mt-2 text-body-sm text-text-2">
        The dials start as a plain first-fit allocator. Your policy runs on this trace and on five new ones, beside the reference. Can you make it place every block where the
        reference does? Can you make fragmentation impossible?
      </p>

      <div className="mt-4 space-y-4">
        {DIAL_DEFS.map((def) => (
          <fieldset key={def.key} className="min-w-0">
            <legend className="font-mono text-[12px] text-text-1">{def.label}</legend>
            <p className="mt-0.5 text-[12px] text-text-3">{def.hint}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {def.options.map((o) => (
                <label key={o.value} className="relative inline-flex">
                  <input
                    type="radio"
                    name={`${uid}-${def.key}`}
                    value={o.value}
                    checked={dials[def.key] === o.value}
                    onChange={() => setDials((d) => ({ ...d, [def.key]: o.value }))}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-sm border border-line bg-surface-2 px-3 font-mono text-[12px] text-text-2 transition-colors duration-150',
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
            <table className="mt-3 w-full border-collapse text-left font-mono text-[11px]">
              <caption className="sr-only">Your policy and the reference on each trace: ops survived, external fragmentation, internal waste</caption>
              <thead>
                <tr className="text-text-1">
                  <th scope="col" className="border-b border-line py-1 pr-2 font-medium">
                    Run
                  </th>
                  <th scope="col" className="border-b border-line px-2 py-1 font-medium">
                    Survived
                  </th>
                  <th scope="col" className="border-b border-line px-2 py-1 font-medium">
                    External
                  </th>
                  <th scope="col" className="border-b border-line px-2 py-1 font-medium">
                    Internal waste
                  </th>
                </tr>
              </thead>
              <Rows label="Your policy" rows={report.report.mine} />
              <Rows label="Reference" rows={report.report.ghost} />
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
