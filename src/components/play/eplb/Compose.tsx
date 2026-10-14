/**
 * Compose for the EPLB play (docs/specs/wave-3.md §5.2): two dials compile to a policy that plays the same 24 turns as you
 * did, on the play's own load and on five fresh ones, beside DeepSeek EPLB's rule. `ok` is "chose what the reference chooses
 * at every turn, or ended within 0.05 of it on every load"; each new spec is one `recordPlay` with phase `compose`.
 *
 * The five fresh loads are drawn at the first run (not at mount, so a render stays pure) and kept for the session, so turning
 * one dial changes the policy and nothing else.
 */

import { useId, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { freshEntropy } from '@/data/plays'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'
import type { EplbPolicySpec } from '@/lib/world/eplb-policy'
import {
  DEFAULT_EPLB_SPEC,
  EPLB_DIAL_DEFS,
  composeLoads,
  eplbComposeRecord,
  eplbComposeReport,
  gapText,
  loadLabel,
  withDial,
  type EplbComposeReport,
  type EplbComposeRow,
} from './session'

export interface ComposeProps {
  /** The play's own load: the first row of the table. */
  loads: readonly number[]
  /** What the ledger records the compose runs against: the play's load seed. */
  seed: number
}

const CELL = 'border-b border-line/60 px-2 py-1.5'
const x2 = (n: number) => `${n.toFixed(2)}×`

function Rows({ label, rows }: { label: string; rows: readonly EplbComposeRow[] }) {
  return (
    <tbody className="text-text-2">
      {rows.map((r, i) => (
        <tr key={i}>
          <th scope="row" className="border-b border-line/60 py-1.5 pr-2 text-left font-normal text-text-1">
            {label} · {loadLabel(i)}
          </th>
          <td className={CELL}>{x2(r.mine)}</td>
          <td className={CELL}>{x2(r.ghost)}</td>
          <td className={CELL}>{gapText(r.gap)}</td>
          <td className={CELL}>{r.within ? 'yes' : 'no'}</td>
        </tr>
      ))}
    </tbody>
  )
}

export default function Compose({ loads, seed }: ComposeProps) {
  const uid = useId()
  const recordPlay = useProgress((s) => s.recordPlay)
  const [spec, setSpec] = useState<EplbPolicySpec>(DEFAULT_EPLB_SPEC)
  const [loadSets, setLoadSets] = useState<(readonly number[])[] | null>(null)
  const [report, setReport] = useState<{ report: EplbComposeReport; key: string } | null>(null)
  // Specs already written to the ledger this session: running the same dials again adds no event.
  const written = useRef(new Set<string>())

  const key = JSON.stringify(spec)
  const stale = report !== null && report.key !== key

  const run = () => {
    const all = loadSets ?? composeLoads(loads, freshEntropy())
    if (!loadSets) setLoadSets(all)
    const rep = eplbComposeReport(spec, all)
    setReport({ report: rep, key })
    if (written.current.has(key)) return
    written.current.add(key)
    recordPlay(eplbComposeRecord(spec, rep, seed, written.current.size))
  }

  return (
    <section aria-labelledby={`${uid}-h`} data-phase="compose" className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">Compose</p>
      <h3 id={`${uid}-h`} className="mt-2 font-display text-h4 text-text-1">
        Turn the dials, then run your policy
      </h3>
      <p className="mt-2 text-body-sm text-text-2">
        The dials start as the plainest policy: no copies, round robin. Your policy plays all 24 turns on this load and on five new ones, beside the reference. Can you make it choose
        what the reference chooses, or finish within 0.05 of it?
      </p>

      <div className="mt-4 space-y-4">
        {EPLB_DIAL_DEFS.map((def) => (
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
          <div className={stale ? 'opacity-60' : undefined} data-compose-result data-ok={report.report.ok ? 'yes' : 'no'}>
            <p className="text-body-sm text-text-1">{report.report.note}</p>
            {stale && <p className="mt-1 font-mono text-[11px] text-amber">The dials changed since this run. Run again to see the new policy.</p>}
            <div
              role="region"
              aria-label="Compose results, scrolls sideways on a narrow screen"
              tabIndex={0}
              className="mt-3 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <table className="w-full min-w-[420px] border-collapse text-left font-mono text-[11px]">
                <caption className="sr-only">Your policy against the reference on each load: the busiest GPU as a multiple of the mean, the gap between them, and whether it is within 0.05</caption>
                <thead>
                  <tr className="text-text-1">
                    <th scope="col" className="border-b border-line py-1 pr-2 font-medium">
                      Run
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-1 font-medium">
                      Imbalance
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-1 font-medium">
                      Reference
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-1 font-medium">
                      Gap
                    </th>
                    <th scope="col" className="border-b border-line px-2 py-1 font-medium">
                      Within 0.05
                    </th>
                  </tr>
                </thead>
                <Rows label="Your policy" rows={report.report.rows} />
              </table>
            </div>
            <p className="mt-2 font-mono text-[11px] text-text-3">
              Imbalance is the busiest GPU&apos;s load over the mean, lower is better. The gap is yours minus the reference&apos;s, in multiples of the mean.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
